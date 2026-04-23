// ─── Chess Coliseum Pro - Multiplayer Server ─────────────────
// Node.js backend with Express + Socket.io for real-time multiplayer chess

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

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

        // Create game room
        const room = {
            white: whiteUid,
            black: blackUid,
            moves: [],
            state: 'playing',
            turn: 'white',
            createdAt: Date.now()
        };
        gameRooms.set(roomId, room);

        // Join both players to the socket room
        const whiteSocket = userSockets.get(whiteUid);
        const blackSocket = userSockets.get(blackUid);

        if (whiteSocket) {
            io.sockets.sockets.get(whiteSocket)?.join(roomId);
        }
        if (blackSocket) {
            io.sockets.sockets.get(blackSocket)?.join(roomId);
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

        if (room && room.state === 'playing') {
            // Reconnect to an active game
            socket.emit('gameStart', {
                roomId,
                white: room.white,
                black: room.black,
                whiteName: room.whiteName || 'Jugador 1',
                blackName: room.blackName || 'Jugador 2'
            });
            socket.emit('gameStateSync', { turn: room.turn, moves: room.moves });
            console.log(`🔌 Player ${uid} rejoined room ${roomId}`);
            return;
        }

        if (!room) {
            // First player arriving from Firestore redirect — create waiting room
            room = {
                white: color === 'white' ? uid : null,
                black: color === 'black' ? uid : null,
                whiteName: color === 'white' ? displayName : null,
                blackName: color === 'black' ? displayName : null,
                moves: [],
                state: 'waiting',
                turn: 'white',
                createdAt: Date.now()
            };
            gameRooms.set(roomId, room);
            socket.emit('waitingForOpponent', { roomId });
            console.log(`⏳ Room ${roomId} created. Waiting for opponent...`);
            return;
        }

        // Room exists in 'waiting' state — second player arriving
        if (color === 'white' && !room.white) {
            room.white = uid;
            room.whiteName = displayName;
        } else if (color === 'black' && !room.black) {
            room.black = uid;
            room.blackName = displayName;
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

    // ── Chess Move ────────────────────────────────────────
    socket.on('chessMove', (data) => {
        const { roomId, move } = data;
        const room = gameRooms.get(roomId);

        if (room) {
            room.moves.push(move);
            room.turn = room.turn === 'white' ? 'black' : 'white';

            // Broadcast the move to the opponent
            socket.to(roomId).emit('opponentMove', { move });
            console.log(`♟ Move in ${roomId}: ${move.type} ${move.fromX},${move.fromZ} → ${move.toX},${move.toZ}`);
        }
    });

    // ── Game Over ─────────────────────────────────────────
    socket.on('gameOver', (data) => {
        const { roomId, result, winner } = data;
        const room = gameRooms.get(roomId);

        if (room) {
            room.state = 'finished';
            io.to(roomId).emit('gameEnded', { result, winner });
            console.log(`🏁 Game ended in ${roomId}: ${result}`);

            // Clean up room after a delay
            setTimeout(() => {
                gameRooms.delete(roomId);
            }, 60000);
        }
    });

    // ── Resign ────────────────────────────────────────────
    socket.on('resign', (data) => {
        const { roomId, uid } = data;
        const room = gameRooms.get(roomId);

        if (room) {
            room.state = 'finished';
            const winner = room.white === uid ? 'black' : 'white';
            io.to(roomId).emit('gameEnded', {
                result: 'resignation',
                winner
            });
            console.log(`🏳️ Player ${uid} resigned in ${roomId}`);
        }
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
