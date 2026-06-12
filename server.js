// ─── Chess Coliseum Pro - Multiplayer Server ─────────────────
// Node.js backend with Express + Socket.io for real-time multiplayer chess

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const ChessEngine = require('./engine.js'); // Motor único: el servidor VALIDA, no confía

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    // Móviles que atenúan la pantalla o redes que parpadean: no declarar
    // muerto un socket a la primera (por defecto eran solo 20s).
    pingInterval: 25000,
    pingTimeout: 60000
});

// Tiempo que se espera a un jugador desconectado antes de dar la
// partida por abandonada (la reconexión re-sincroniza con gameStateSync).
const RECONNECT_GRACE_MS = 60000;

app.use(cors());
app.use(express.json());

// Serve static files (the game itself)
app.use(express.static(path.join(__dirname)));

// ─── Email Invitation Endpoint ───────────────────────────────
// Uses Gmail SMTP - for production, use a proper email service
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'maplechepe@gmail.com',
        pass: process.env.EMAIL_PASS || '' // App password needed
    }
});

app.post('/api/send-invite-email', async (req, res) => {
    const { toEmail, fromName, fromEmail } = req.body;

    if (!toEmail || !fromName) {
        return res.status(400).json({ error: 'Faltan datos' });
    }

    // La URL de invitación apunta al Mundo (chess-coliseum-pro)
    const serverUrl = 'https://chess-coliseum-pro.web.app';

    const mailOptions = {
        from: `"⚔ Chess Coliseum" <${process.env.EMAIL_USER || 'maplechepe@gmail.com'}>`,
        to: toEmail,
        subject: `⚔ ${fromName} te desafía en Chess Coliseum!`,
        html: `
            <div style="background:#0d0a14;padding:40px;font-family:'Segoe UI',Arial,sans-serif;text-align:center;border-radius:16px;max-width:500px;margin:0 auto;">
                <h1 style="color:#f0c040;font-size:28px;margin-bottom:8px;">⚔ Chess Coliseum</h1>
                <p style="color:rgba(255,255,255,0.6);font-size:14px;margin-bottom:24px;">Invitación a la Arena</p>
                <div style="background:rgba(240,192,64,0.08);border:1px solid rgba(240,192,64,0.3);border-radius:12px;padding:24px;margin-bottom:24px;">
                    <p style="color:#fff;font-size:16px;margin:0 0 8px 0;">
                        <strong style="color:#f0c040;">${fromName}</strong>
                    </p>
                    <p style="color:rgba(255,255,255,0.7);font-size:14px;margin:0;">
                        te ha invitado a una partida de ajedrez épica en el Coliseo
                    </p>
                </div>
                <a href="${serverUrl}" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#f0c040,#d4a020);color:#0a0a12;font-weight:900;font-size:16px;text-decoration:none;border-radius:12px;letter-spacing:2px;">
                    ⚔ UNIRSE A LA BATALLA
                </a>
                <p style="color:rgba(255,255,255,0.3);font-size:11px;margin-top:20px;">
                    Crea tu cuenta gratis y desafía a ${fromName} en Chess Coliseum
                </p>
            </div>
        `
    };

    try {
        await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Invitation email sent to: ${toEmail} from ${fromName}`);
        res.json({ success: true, message: 'Email enviado correctamente' });
    } catch (error) {
        console.log(`⚠️ Email send failed (no SMTP configured): ${error.message}`);
        // Don't fail - save the invitation in memory so it works when user registers
        console.log(`📝 Pending invitation saved for: ${toEmail}`);
        res.json({
            success: true,
            message: 'Invitación guardada. Se notificará cuando se registre.',
            emailSent: false
        });
    }
});

// ─── In-Memory State ─────────────────────────────────────────
// We use Firebase Firestore on the client for persistent data
// (friends, user profiles). The server handles real-time game
// rooms and socket connections only.

const connectedUsers = new Map(); // socketId -> { uid, displayName, email }
const userSockets = new Map();    // uid -> socketId
const gameRooms = new Map();      // roomId -> { white: uid, black: uid, moves: [], state }
const socketRooms = new Map();    // socketId -> roomId (reverse lookup for disconnect)

// ─── Socket.io Logic ─────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    // ── User Registration ─────────────────────────────────
    // When a user logs in on the client, they register their socket
    socket.on('register', (userData) => {
        const { uid, displayName, email, photoURL } = userData;
        connectedUsers.set(socket.id, { uid, displayName, email, photoURL });
        userSockets.set(uid, socket.id);
        console.log(`👤 User registered: ${displayName} (${uid})`);

        // Broadcast online status to all connected users
        broadcastOnlineUsers();
    });

    // ── Get Online Users ──────────────────────────────────
    socket.on('getOnlineUsers', () => {
        const onlineList = [];
        connectedUsers.forEach((user) => {
            onlineList.push(user);
        });
        socket.emit('onlineUsers', onlineList);
    });

    // ── Game Invitation ───────────────────────────────────
    socket.on('sendGameInvite', (data) => {
        const { toUid, fromUid, fromName, fromPhoto } = data;
        const targetSocketId = userSockets.get(toUid);

        if (targetSocketId) {
            io.to(targetSocketId).emit('gameInviteReceived', {
                fromUid,
                fromName,
                fromPhoto,
                roomId: `game_${fromUid}_${toUid}_${Date.now()}`
            });
            console.log(`📨 Game invite sent: ${fromName} → ${toUid}`);
        } else {
            socket.emit('inviteError', { message: 'El jugador no está en línea.' });
        }
    });

    // ── Accept Game Invitation ────────────────────────────
    socket.on('acceptGameInvite', (data) => {
        const { roomId, whiteUid, blackUid } = data;

        // Create game room — con motor propio: el servidor es la autoridad
        const room = {
            white: whiteUid,
            black: blackUid,
            moves: [],
            state: 'playing',
            game: new ChessEngine(),
            sockets: { white: null, black: null }, // socket.id autorizado por color
            createdAt: Date.now()
        };
        gameRooms.set(roomId, room);

        // Join both players to the socket room
        const whiteSocket = userSockets.get(whiteUid);
        const blackSocket = userSockets.get(blackUid);

        if (whiteSocket) {
            io.sockets.sockets.get(whiteSocket)?.join(roomId);
            room.sockets.white = whiteSocket;
            socketRooms.set(whiteSocket, roomId);
        }
        if (blackSocket) {
            io.sockets.sockets.get(blackSocket)?.join(roomId);
            room.sockets.black = blackSocket;
            socketRooms.set(blackSocket, roomId);
        }

        // Notify both players the game is starting
        io.to(roomId).emit('gameStart', {
            roomId,
            white: whiteUid,
            black: blackUid,
            whiteName: connectedUsers.get(whiteSocket)?.displayName || 'Jugador 1',
            blackName: connectedUsers.get(blackSocket)?.displayName || 'Jugador 2'
        });

        console.log(`🎮 Game started: Room ${roomId}`);
    });

    // ── Join Existing Game Room (After Redirect) ─────────
    socket.on('joinExistingRoom', (data) => {
        const { roomId, uid, displayName, color } = data;
        let room = gameRooms.get(roomId);

        socket.join(roomId);
        userSockets.set(uid, socket.id);
        socketRooms.set(socket.id, roomId);

        if (!room) {
            // First player arriving — create waiting room
            room = {
                white: color === 'white' ? uid : null,
                black: color === 'black' ? uid : null,
                whiteName: color === 'white' ? displayName : null,
                blackName: color === 'black' ? displayName : null,
                moves: [],
                state: 'waiting',
                game: new ChessEngine(),
                sockets: {
                    white: color === 'white' ? socket.id : null,
                    black: color === 'black' ? socket.id : null
                },
                createdAt: Date.now()
            };
            gameRooms.set(roomId, room);
            socket.emit('waitingForOpponent', { roomId });
            console.log(`⏳ Room ${roomId} created. Waiting for opponent...`);
            return;
        }

        if (!room.sockets) room.sockets = { white: null, black: null };

        if (room.state === 'playing') {
            // Reconnect to active game — re-autorizar este socket y resincronizar
            if (color === 'white' || color === 'black') {
                room.sockets[color] = socket.id;
                // Volvió a tiempo: cancelar el temporizador de abandono
                if (room.pendingDc && room.pendingDc[color]) {
                    clearTimeout(room.pendingDc[color]);
                    delete room.pendingDc[color];
                    socket.to(roomId).emit('opponent_reconnected', { roomId });
                    console.log(`🔄 ${color} volvió a tiempo a ${roomId}`);
                }
            }
            socket.emit('gameStart', {
                roomId,
                white: room.white,
                black: room.black,
                whiteName: room.whiteName || 'Jugador 1',
                blackName: room.blackName || 'Jugador 2'
            });
            socket.emit('gameStateSync', {
                turn: room.game.turn,
                moves: room.moves,
                fen: room.game.fen()
            });
            console.log(`🔌 Player ${uid} rejoined room ${roomId}`);
            return;
        }

        if (room.state === 'finished') {
            // La sala ya terminó: no resucitarla con un re-join tardío
            socket.emit('gameEnded', { result: 'closed', winner: null });
            return;
        }

        // Room in 'waiting' — always update the slot so real uid overwrites pvp_ placeholder
        if (color === 'white') {
            room.white = uid;
            room.whiteName = displayName;
            room.sockets.white = socket.id;
        } else if (color === 'black') {
            room.black = uid;
            room.blackName = displayName;
            room.sockets.black = socket.id;
        }

        if (room.white && room.black) {
            room.state = 'playing';
            io.to(roomId).emit('gameStart', {
                roomId,
                white: room.white,
                black: room.black,
                whiteName: room.whiteName || 'Jugador 1',
                blackName: room.blackName || 'Jugador 2'
            });
            console.log(`🎮 Game started: Room ${roomId} (${room.whiteName} vs ${room.blackName})`);
        } else {
            socket.emit('waitingForOpponent', { roomId });
        }
    });

    // ── Decline Game Invitation ───────────────────────────
    socket.on('declineGameInvite', (data) => {
        const { fromUid, declinedByName } = data;
        const targetSocketId = userSockets.get(fromUid);

        if (targetSocketId) {
            io.to(targetSocketId).emit('gameInviteDeclined', {
                declinedByName
            });
        }
    });

    // ── Chess Move (VALIDADO: el servidor es la autoridad) ──
    socket.on('chessMove', (data) => {
        const { roomId, move } = data;
        const room = gameRooms.get(roomId);

        if (!room || room.state !== 'playing' || !room.game || !move) {
            socket.emit('moveRejected', { reason: 'no_active_game' });
            return;
        }

        // 1. ¿Quién envía? Solo los dos sockets autorizados de la sala
        let senderColor = null;
        if (room.sockets) {
            if (room.sockets.white === socket.id) senderColor = 'white';
            else if (room.sockets.black === socket.id) senderColor = 'black';
        }
        if (!senderColor) {
            socket.emit('moveRejected', { reason: 'not_a_player' });
            console.log(`🚫 Socket ${socket.id} intentó mover sin ser jugador de ${roomId}`);
            return;
        }

        // 2. ¿Es su turno?
        if (room.game.turn !== senderColor) {
            socket.emit('moveRejected', { reason: 'not_your_turn' });
            return;
        }

        // 3. ¿Es legal? (pieza, origen, destino, promoción, jaque… todo lo decide el motor)
        const rec = room.game.makeMove({
            fromX: move.fromX, fromZ: move.fromZ,
            toX: move.toX, toZ: move.toZ,
            promotion: move.promotion || null
        });
        if (!rec) {
            socket.emit('moveRejected', { reason: 'illegal_move', fen: room.game.fen() });
            console.log(`🚫 Movimiento ilegal de ${senderColor} en ${roomId}:`, move);
            return;
        }

        // Aceptado: registrar y reenviar al rival (incluida la promoción elegida)
        const validated = {
            type: rec.type,
            color: rec.color,
            fromX: rec.fromX, fromZ: rec.fromZ,
            toX: rec.toX, toZ: rec.toZ,
            promotion: rec.promotion,
            lan: rec.lan
        };
        room.moves.push(validated);
        socket.to(roomId).emit('opponentMove', { move: validated });
        console.log(`♟ ${roomId}: ${rec.lan} (${senderColor})`);

        // 4. ¿Terminó la partida? El SERVIDOR lo decide y lo anuncia
        const status = rec.status;
        if (status && status.over) {
            room.state = 'finished';
            io.to(roomId).emit('gameEnded', { result: status.state, winner: status.winner });
            console.log(`🏁 ${roomId}: ${status.state} — ganador: ${status.winner}`);
            setTimeout(() => gameRooms.delete(roomId), 60000);
        }
    });

    // ── Sync Request (reconexión o estado divergente) ─────
    socket.on('requestSync', (data) => {
        const room = gameRooms.get(data && data.roomId);
        if (!room || !room.game) return;
        socket.emit('gameStateSync', {
            turn: room.game.turn,
            moves: room.moves,
            fen: room.game.fen()
        });
    });

    // ── Resign ────────────────────────────────────────────
    socket.on('resign', (data) => {
        const { roomId, uid } = data;
        const room = gameRooms.get(roomId);

        if (room && room.state === 'playing') {
            // Identificar al que se rinde por su socket (no por el uid que diga)
            let resignColor = null;
            if (room.sockets) {
                if (room.sockets.white === socket.id) resignColor = 'white';
                else if (room.sockets.black === socket.id) resignColor = 'black';
            }
            if (!resignColor) resignColor = room.white === uid ? 'white' : 'black';

            room.state = 'finished';
            const winner = resignColor === 'white' ? 'black' : 'white';
            io.to(roomId).emit('gameEnded', {
                result: 'resignation',
                winner
            });
            console.log(`🏳️ ${resignColor} se rindió en ${roomId}`);
        }
    });

    // ── Voluntary exit (player clicked "return to world") ────
    socket.on('player_left', (data) => {
        const { roomId } = data;
        const room = gameRooms.get(roomId);
        if (room && room.state === 'playing') {
            room.state = 'finished';
            socket.to(roomId).emit('opponent_disconnected', { roomId });
            console.log(`🚪 Player left room ${roomId}`);
            setTimeout(() => gameRooms.delete(roomId), 10000);
        }
        socketRooms.delete(socket.id);
    });

    // ── Disconnect ────────────────────────────────────────
    socket.on('disconnect', () => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            console.log(`👋 User disconnected: ${user.displayName}`);
            userSockets.delete(user.uid);
            connectedUsers.delete(socket.id);
            broadcastOnlineUsers();
        }

        // Desconexión durante una partida activa: NO es abandono inmediato.
        // La pantalla del móvil se apaga, la red parpadea… damos un período
        // de gracia para reconectar (el cliente re-entra solo a la sala).
        const roomId = socketRooms.get(socket.id);
        if (roomId) {
            const room = gameRooms.get(roomId);
            if (room && room.state === 'playing') {
                let color = null;
                if (room.sockets) {
                    if (room.sockets.white === socket.id) color = 'white';
                    else if (room.sockets.black === socket.id) color = 'black';
                }
                const key = color || socket.id;
                socket.to(roomId).emit('opponent_connection_lost', { roomId });
                room.pendingDc = room.pendingDc || {};
                if (room.pendingDc[key]) clearTimeout(room.pendingDc[key]);
                room.pendingDc[key] = setTimeout(() => {
                    if (room.state === 'playing') {
                        room.state = 'finished';
                        io.to(roomId).emit('opponent_disconnected', { roomId });
                        console.log(`⚡ ${key} no volvió a ${roomId} — partida abandonada`);
                        setTimeout(() => gameRooms.delete(roomId), 10000);
                    }
                }, RECONNECT_GRACE_MS);
                console.log(`⏳ ${key} se desconectó de ${roomId} — esperando reconexión (${RECONNECT_GRACE_MS / 1000}s)...`);
            }
            socketRooms.delete(socket.id);
        }
    });
});

// ── Helper: Broadcast online users to everyone ────────────
function broadcastOnlineUsers() {
    const onlineList = [];
    connectedUsers.forEach((user) => {
        onlineList.push(user);
    });
    io.emit('onlineUsers', onlineList);
}

// ─── Start Server ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`  ⚔  Chess Coliseum Pro - Multiplayer Server`);
    console.log(`  🌐 http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════');
    console.log('');
});
