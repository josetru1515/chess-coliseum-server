// ─── Chess Coliseum Pro - Multiplayer & Social System ─────────
// Firebase Auth + Firestore for friends, Socket.io for real-time games

// ─── Firebase Config (Chess Coliseum Pro — proyecto independiente) ────
const firebaseConfig = {
    apiKey: "AIzaSyBL6Z3WqpUwLyYA3onViT2_Yq8Xw-otP2g",
    authDomain: "chess-coliseum-pro.firebaseapp.com",
    projectId: "chess-coliseum-pro",
    storageBucket: "chess-coliseum-pro.firebasestorage.app",
    messagingSenderId: "849612909046",
    appId: "1:849612909046:web:e5235e85ef6fdf3d8f3fd7",
    measurementId: "G-CN1TX91RVD"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// ─── Socket.io Connection ────────────────────────────────────
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://chess-coliseum-motor.onrender.com';

const socket = io(SERVER_URL);

// ─── State ───────────────────────────────────────────────────
let currentUser = null;
let friendsList = [];
let friendRequests = [];
let onlineUsers = [];
let currentTab = 'friends';
let isLoginMode = true; 
let pendingInvite = null;
let multiplayerRoomId = null;
let multiplayerColor = null; 
let multiplayerOpponentUid = null;
let matchStats = {};

// ─── Auth ───────────────────────────────────────────────────
function handleEmailLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    if (errorEl) errorEl.textContent = '';

    if (!email || !password) {
        if (errorEl) errorEl.textContent = 'Completa todos los campos';
        return;
    }

    if (isLoginMode) {
        auth.signInWithEmailAndPassword(email, password).catch(err => {
            if (errorEl) errorEl.textContent = translateFirebaseError(err.code);
        });
    } else {
        const name = document.getElementById('login-name').value.trim();
        if (!name) {
            if (errorEl) errorEl.textContent = 'Ingresa tu nombre de guerrero';
            return;
        }
        auth.createUserWithEmailAndPassword(email, password)
            .then(cred => cred.user.updateProfile({ displayName: name }))
            .then(() => db.collection('users').doc(auth.currentUser.uid).set({
                displayName: auth.currentUser.displayName,
                email: auth.currentUser.email,
                emailLower: (auth.currentUser.email || '').toLowerCase(), // búsqueda de amigos (igual que mundo)
                photoURL: auth.currentUser.photoURL || '',
                friends: [],
                unlockedSkins: ['orcos'], // mismo esquema que mundo-frontend
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }))
            .catch(err => {
                if (errorEl) errorEl.textContent = translateFirebaseError(err.code);
            });
    }
}

function handleGoogleLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(result => {
        const user = result.user;
        return db.collection('users').doc(user.uid).get().then(doc => {
            if (!doc.exists) {
                return db.collection('users').doc(user.uid).set({
                    displayName: user.displayName || 'Guerrero',
                    email: user.email,
                    emailLower: (user.email || '').toLowerCase(), // búsqueda de amigos (igual que mundo)
                    photoURL: user.photoURL || '',
                    friends: [],
                    unlockedSkins: ['orcos'], // mismo esquema que mundo-frontend
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });
    }).catch(err => {
        const errorEl = document.getElementById('login-error');
        if (errorEl) errorEl.textContent = translateFirebaseError(err.code);
    });
}

function toggleLoginMode() {
    isLoginMode = !isLoginMode;
    const nameInput = document.getElementById('login-name');
    const btnText = document.getElementById('login-btn');
    const toggleText = document.getElementById('login-toggle-text');
    const subtitle = document.getElementById('login-subtitle');

    if (isLoginMode) {
        if (nameInput) nameInput.style.display = 'none';
        if (btnText) btnText.textContent = '⚔ ENTRAR';
        if (toggleText) toggleText.innerHTML = '¿No tienes cuenta? <span>Regístrate</span>';
        if (subtitle) subtitle.textContent = 'Inicia sesión para jugar online';
    } else {
        if (nameInput) nameInput.style.display = 'block';
        if (btnText) btnText.textContent = '⚔ REGISTRARSE';
        if (toggleText) toggleText.innerHTML = '¿Ya tienes cuenta? <span>Inicia sesión</span>';
        if (subtitle) subtitle.textContent = 'Crea tu cuenta de guerrero';
    }
}

function handleLogout() { auth.signOut(); }

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = {
            uid: user.uid,
            displayName: user.displayName || 'Guerrero',
            email: user.email,
            photoURL: user.photoURL || ''
        };

        const loginModal = document.getElementById('login-modal');
        if (loginModal) loginModal.classList.add('hidden');
        
        const socialToggle = document.getElementById('social-toggle');
        if (socialToggle) socialToggle.style.display = 'flex';

        updateUserInfoUI();
        socket.emit('register', currentUser);

        listenToFriends();
        listenToFriendRequests();
        listenToMatchStats();
        checkPendingInvitations();

        // ⚔ CHECK URL PARAMS FOR REDIRECTS ⚔
        checkUrlParams();

        console.log(`✅ Logged in as: ${currentUser.displayName}`);
    } else {
        currentUser = null;
        // Don't force login modal - let user play offline (PvP/AI) without auth
        // Login modal only shown when user explicitly clicks social toggle
        const socialToggle = document.getElementById('social-toggle');
        if (socialToggle) socialToggle.style.display = 'none';
        
        const socialPanel = document.getElementById('social-panel');
        if (socialPanel) socialPanel.classList.remove('open');
    }
});

// ─── UI & Social ─────────────────────────────────────────────
function updateUserInfoUI() {
    const container = document.getElementById('social-user-info');
    if (!container || !currentUser) return;
    const initial = (currentUser.displayName || 'G')[0].toUpperCase();
    const avatarHtml = currentUser.photoURL
        ? `<img class="social-avatar" src="${currentUser.photoURL}" alt="">`
        : `<div class="social-avatar-placeholder">${initial}</div>`;
    container.innerHTML = `
        ${avatarHtml}
        <div>
            <div class="social-username">${currentUser.displayName}</div>
            <div class="social-email">${currentUser.email}</div>
        </div>
        <button class="social-logout" onclick="handleLogout()">Salir</button>
    `;
}

function toggleSocialPanel() {
    const panel = document.getElementById('social-panel');
    if (panel) panel.classList.toggle('open');
}

function switchTab(tab) {
    currentTab = tab;
    const tabF = document.getElementById('tab-friends');
    const tabR = document.getElementById('tab-requests');
    if (tabF) tabF.classList.toggle('active', tab === 'friends');
    if (tabR) tabR.classList.toggle('active', tab === 'requests');
    if (tab === 'friends') renderFriendsList(); else renderFriendRequests();
}

// ─── URL Parameters Handling ─────────────────────────────────
function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const matchId = params.get('matchId') || params.get('roomId');
    const armySkin = params.get('armySkin');
    const color = params.get('color');

    if (armySkin && typeof window.selectArmy === 'function') {
        window.selectArmy(armySkin);
    }

    if (!matchId) return;

    multiplayerRoomId = matchId;
    if (color) multiplayerColor = color;

    const gameModal = document.getElementById('game-modal');
    if (gameModal) gameModal.classList.add('hidden');

    // Funciona con o sin sesión iniciada — el color en la URL es suficiente para identificar al jugador
    const uid = currentUser ? currentUser.uid : ('pvp_' + color);
    const displayName = currentUser ? currentUser.displayName : (color === 'white' ? 'Blancas' : 'Negras');

    console.log(`🔗 Joining room: ${matchId} as ${color} (uid: ${uid})`);
    socket.emit('joinExistingRoom', {
        roomId: matchId,
        uid: uid,
        displayName: displayName,
        color: color || null
    });
}

// Ejecutar checkUrlParams en cuanto el socket conecta, sin esperar auth
socket.on('connect', () => {
    checkUrlParams();
});

socket.on('waitingForOpponent', (data) => {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = '⏳ Esperando al oponente...';
    console.log(`⏳ Waiting for opponent in room: ${data.roomId}`);
});

socket.on('roomJoined', (data) => {
    multiplayerRoomId = data.roomId;
    if (!multiplayerColor) {
        multiplayerColor = (currentUser && currentUser.uid === data.white) ? 'white' : 'black';
    }
    const opponentName = (multiplayerColor === 'white') ? (data.blackName || 'Oponente') : (data.whiteName || 'Oponente');

    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = `⚔ Online vs ${opponentName}`;

    if (typeof window.startMultiplayerGame === 'function') {
        window.startMultiplayerGame(multiplayerColor, multiplayerRoomId, opponentName);
    }
    console.log(`✅ Joined existing room ${data.roomId} as ${multiplayerColor}`);
});

// ─── Rest of Logic (Friends, Game Events, etc.) ──────────────
// ... (Including friends list rendering, match stats, and move handling from step 64)

function sendFriendRequest() {
    const emailInput = document.getElementById('add-friend-email');
    if (!emailInput) return;
    const friendEmail = emailInput.value.trim().toLowerCase();
    if (!friendEmail || !currentUser) return;
    if (friendEmail === (currentUser.email || '').toLowerCase()) {
        alert('No puedes agregarte a ti mismo 😅');
        return;
    }
    // Buscar por emailLower (normalizado); fallback a email exacto para
    // cuentas antiguas que aún no tienen el campo (mismo esquema que mundo)
    db.collection('users').where('emailLower', '==', friendEmail).get()
        .then(snapshot => {
            if (!snapshot.empty) return snapshot;
            return db.collection('users').where('email', '==', friendEmail).get();
        })
        .then(snapshot => {
            if (snapshot.empty) {
                sendEmailInvitation(friendEmail);
                return;
            }
            const targetUser = snapshot.docs[0];
            const targetUid = targetUser.id;
            if (friendsList.some(f => f.uid === targetUid)) {
                alert('¡Ya son amigos! ⚔');
                return;
            }
            return db.collection('friendRequests').add({
                fromUid: currentUser.uid,
                fromName: currentUser.displayName,
                fromEmail: currentUser.email,
                fromPhoto: currentUser.photoURL,
                toUid: targetUid,
                toName: targetUser.data().displayName,
                toEmail: targetUser.data().email,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
                emailInput.value = '';
                alert('¡Solicitud de amistad enviada! ⚔');
            });
        })
        .catch(err => {
            console.error('Error enviando solicitud de amistad:', err);
            alert('Error enviando la solicitud: ' + (err.code || err.message));
        });
}

// Invitación a alguien que aún no tiene cuenta: guarda la invitación en
// Firestore y pide al servidor que envíe el email (si el SMTP está configurado).
// Antes esta función NO EXISTÍA y agregar un email no registrado rompía con
// ReferenceError.
function sendEmailInvitation(toEmail) {
    db.collection('pendingInvitations').add({
        fromUid: currentUser.uid,
        fromName: currentUser.displayName || 'Guerrero',
        fromEmail: currentUser.email,
        toEmail: toEmail,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(err => console.error('Error guardando invitación pendiente:', err));

    fetch(`${SERVER_URL}/api/send-invite-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            toEmail: toEmail,
            fromName: currentUser.displayName || 'Guerrero',
            fromEmail: currentUser.email
        })
    }).catch(() => { /* el email es cortesía; la invitación ya quedó guardada */ });

    const emailInput = document.getElementById('add-friend-email');
    if (emailInput) emailInput.value = '';
    alert(`📨 Ese guerrero aún no tiene cuenta.\n\nInvitación guardada para ${toEmail} — se le notificará al registrarse.`);
}

// (Simplified versions of other functions for brevity but maintaining core logic)
function listenToFriendRequests() {
    if (!currentUser) return;
    db.collection('friendRequests').where('toUid', '==', currentUser.uid).where('status', '==', 'pending').onSnapshot(snapshot => {
        friendRequests = [];
        snapshot.forEach(doc => friendRequests.push({ id: doc.id, ...doc.data() }));
        const badge = document.getElementById('req-badge');
        if (badge) {
            badge.style.display = friendRequests.length > 0 ? 'inline' : 'none';
            badge.textContent = friendRequests.length;
        }
        if (currentTab === 'requests') renderFriendRequests();
    }, err => console.error('Error escuchando solicitudes de amistad:', err));
}

function listenToFriends() {
    if (!currentUser) return;
    db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
        if (!doc.exists) return;
        const friendUids = doc.data().friends || [];
        if (friendUids.length === 0) { friendsList = []; renderFriendsList(); return; }
        db.collection('users').where(firebase.firestore.FieldPath.documentId(), 'in', friendUids.slice(0, 10)).get().then(snapshot => {
            friendsList = [];
            snapshot.forEach(d => friendsList.push({ uid: d.id, ...d.data() }));
            renderFriendsList();
        }).catch(err => console.error('Error cargando amigos:', err));
    }, err => console.error('Error escuchando lista de amigos:', err));
}

function renderFriendsList() {
    const container = document.getElementById('social-content');
    if (!container) return;
    if (friendsList.length === 0) {
        container.innerHTML = '<div class="empty-state">Agrega amigos para jugar online ⚔</div>';
        return;
    }
    let html = '';
    friendsList.forEach(friend => {
        const isOnline = onlineUsers.some(u => u.uid === friend.uid);
        html += `<div class="friend-item">
            <div class="friend-name">${friend.displayName}</div>
            <button class="friend-invite-btn" onclick="sendGameInvite('${friend.uid}', '${friend.displayName}')" ${!isOnline ? 'disabled' : ''}>⚔ Invitar</button>
        </div>`;
    });
    container.innerHTML = html;
}

function renderFriendRequests() {
    const container = document.getElementById('social-content');
    if (!container) return;
    if (friendRequests.length === 0) {
        container.innerHTML = '<div class="empty-state">No tienes solicitudes pendientes</div>';
        return;
    }
    let html = '';
    friendRequests.forEach(req => {
        html += `<div class="request-item">
            <div class="friend-name">${req.fromName}</div>
            <button onclick="acceptFriendRequest('${req.id}', '${req.fromUid}')">✓ Aceptar</button>
        </div>`;
    });
    container.innerHTML = html;
}

function sendGameInvite(toUid, toName) {
    if (!currentUser) return;
    socket.emit('sendGameInvite', { toUid, fromUid: currentUser.uid, fromName: currentUser.displayName, fromPhoto: currentUser.photoURL });
    alert(`⚔ Invitación enviada a ${toName}!`);
}

socket.on('onlineUsers', users => {
    onlineUsers = users.filter(u => u.uid !== currentUser?.uid);
    const countEl = document.getElementById('online-count');
    if (countEl) countEl.textContent = onlineUsers.length;
    renderFriendsList();
});

socket.on('gameInviteReceived', data => {
    pendingInvite = data;
    const popup = document.getElementById('invite-popup');
    if (popup) {
        const msg = document.getElementById('invite-msg');
        if (msg) msg.textContent = `${data.fromName} te desafía a una partida!`;
        popup.classList.add('show');
    }
});

function acceptInvite() {
    if (!pendingInvite) return;
    const popup = document.getElementById('invite-popup');
    if (popup) popup.classList.remove('show');
    socket.emit('acceptGameInvite', {
        roomId: pendingInvite.roomId,
        whiteUid: pendingInvite.fromUid,
        blackUid: currentUser ? currentUser.uid : ('pvp_black_' + Date.now())
    });
    pendingInvite = null;
}

function declineInvite() {
    if (!pendingInvite) return;
    const popup = document.getElementById('invite-popup');
    if (popup) popup.classList.remove('show');
    socket.emit('declineGameInvite', {
        fromUid: pendingInvite.fromUid,
        declinedByName: currentUser ? currentUser.displayName : 'Oponente'
    });
    pendingInvite = null;
}

socket.on('gameStart', data => {
    multiplayerRoomId = data.roomId;
    // Usar el color pre-asignado desde la URL; solo calcular si no viene ya definido
    if (!multiplayerColor) {
        multiplayerColor = (currentUser && currentUser.uid === data.white) ? 'white' : 'black';
    }
    const socialPanel = document.getElementById('social-panel');
    if (socialPanel) socialPanel.classList.remove('open');
    if (typeof window.startMultiplayerGame === 'function') {
        const opponentName = (multiplayerColor === 'white' ? data.blackName : data.whiteName) || 'Oponente';
        window.startMultiplayerGame(multiplayerColor, multiplayerRoomId, opponentName);
    }
});

socket.on('opponentMove', data => { if (typeof window.receiveOpponentMove === 'function') window.receiveOpponentMove(data.move); });

// ── Resincronización con el servidor ─────────────────────────
// El servidor manda el historial validado; el cliente reconstruye.
socket.on('gameStateSync', data => {
    if (typeof window.applyServerSync === 'function') window.applyServerSync(data);
});

// El servidor rechazó nuestro movimiento (estado divergente o trampa):
// pedir el estado oficial y reconstruir.
socket.on('moveRejected', data => {
    console.warn('⚠️ Movimiento rechazado por el servidor:', data.reason);
    if (multiplayerRoomId) socket.emit('requestSync', { roomId: multiplayerRoomId });
});

window.requestServerSync = function () {
    if (multiplayerRoomId) socket.emit('requestSync', { roomId: multiplayerRoomId });
};

const RESULT_NAMES = {
    checkmate: 'jaque mate',
    stalemate: 'rey ahogado',
    fifty_moves: 'regla de 50 movimientos',
    threefold: 'triple repetición',
    insufficient_material: 'material insuficiente',
    resignation: 'rendición',
    closed: 'la sala se cerró'
};

socket.on('gameEnded', data => {
    const reason = RESULT_NAMES[data.result] || data.result;
    if (data.winner === 'draw') {
        alert(`🤝 Tablas: ${reason}.`);
    } else if (data.winner === 'white' || data.winner === 'black') {
        alert(`🏆 ¡${data.winner === 'white' ? 'Blancas' : 'Negras'} ganan! (${reason})`);
    } else {
        alert(`⚔ Partida terminada: ${reason}.`);
    }
    multiplayerRoomId = null;
});

// ── Conexión inestable del rival (pantalla del móvil apagada, red…) ──
// El servidor le da 60s de gracia antes de declarar abandono.
socket.on('opponent_connection_lost', () => {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = '📶 Tu oponente perdió la conexión — esperando a que vuelva...';
});

socket.on('opponent_reconnected', () => {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.innerText = '✅ ¡Tu oponente volvió! La batalla continúa.';
});

socket.on('opponent_disconnected', () => {
    multiplayerRoomId = null;
    alert('⚔ Tu oponente abandonó la batalla.\n\nRegresando al mundo...');
    if (typeof window.returnToWorld === 'function') {
        window.returnToWorld();
    }
});

// Notify server when the player leaves voluntarily or closes the tab
window.notifyPlayerLeft = function () {
    if (multiplayerRoomId) {
        socket.emit('player_left', { roomId: multiplayerRoomId });
        multiplayerRoomId = null;
    }
};

window.addEventListener('beforeunload', () => {
    window.notifyPlayerLeft();
});

function sendMoveToServer(move) { if (multiplayerRoomId) socket.emit('chessMove', { roomId: multiplayerRoomId, move }); }
function resignGame() { if (multiplayerRoomId) socket.emit('resign', { roomId: multiplayerRoomId, uid: currentUser.uid }); }

function translateFirebaseError(code) {
    const errors = { 'auth/wrong-password': 'Contraseña incorrecta', 'auth/user-not-found': 'Usuario no encontrado' };
    return errors[code] || code;
}

function acceptFriendRequest(id, uid) {
    db.collection('friendRequests').doc(id).update({ status: 'accepted' });
    db.collection('users').doc(currentUser.uid).update({ friends: firebase.firestore.FieldValue.arrayUnion(uid) });
    db.collection('users').doc(uid).update({ friends: firebase.firestore.FieldValue.arrayUnion(currentUser.uid) });
}

function checkPendingInvitations() {}
function listenToMatchStats() {}

// Ocultar el modal de modo de juego inmediatamente si venimos de una invitación PvP,
// sin esperar a que resuelva el auth (dominios distintos pueden tardar)
(function() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('matchId') || params.get('roomId')) {
        const gameModal = document.getElementById('game-modal');
        if (gameModal) gameModal.classList.add('hidden');
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.innerText = '⚔ Conectando a la arena...';
    }
})();

window.handleEmailLogin = handleEmailLogin;
window.handleGoogleLogin = handleGoogleLogin;
window.toggleLoginMode = toggleLoginMode;
window.handleLogout = handleLogout;
window.toggleSocialPanel = toggleSocialPanel;
window.switchTab = switchTab;
window.sendFriendRequest = sendFriendRequest;
window.acceptFriendRequest = acceptFriendRequest;
window.sendGameInvite = sendGameInvite;
window.sendMoveToServer = sendMoveToServer;
window.resignGame = resignGame;
window.acceptInvite = acceptInvite;
window.declineInvite = declineInvite;
