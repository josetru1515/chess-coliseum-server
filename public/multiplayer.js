// ─── Chess Coliseum Pro - Multiplayer & Social System ─────────
// Firebase Auth + Firestore for friends, Socket.io for real-time games

// ─── Firebase Config ─────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyDIoozFa_dI7O_ehrS6Rmn2MTrimgmUhgI",
    authDomain: "growing-now.firebaseapp.com",
    projectId: "growing-now",
    storageBucket: "growing-now.firebasestorage.app",
    messagingSenderId: "1089538196243",
    appId: "1:1089538196243:web:c7f92eb4708c11f8f990e6",
    measurementId: "G-68QNF7VF1G"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ─── Socket.io Connection ────────────────────────────────────
// Automáticamente detecta si estás en local o en el servidor desplegado
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://chess-coliseum-motor.onrender.com'; // Servidor multijugador en la nube (Render)

const socket = io(SERVER_URL);

// ─── State ───────────────────────────────────────────────────
let currentUser = null;
let friendsList = [];
let friendRequests = [];
let onlineUsers = [];
let currentTab = 'friends';
let isLoginMode = true; // true = login, false = register
let pendingInvite = null;
let multiplayerRoomId = null;
let multiplayerColor = null; // 'white' or 'black' - assigned color in multiplayer
let multiplayerOpponentUid = null;
let matchStats = {};

// ─── Auth: Email Login/Register ──────────────────────────────
function handleEmailLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    errorEl.textContent = '';

    if (!email || !password) {
        errorEl.textContent = 'Completa todos los campos';
        return;
    }

    if (isLoginMode) {
        // Login
        auth.signInWithEmailAndPassword(email, password)
            .catch(err => {
                errorEl.textContent = translateFirebaseError(err.code);
            });
    } else {
        // Register
        const name = document.getElementById('login-name').value.trim();
        if (!name) {
            errorEl.textContent = 'Ingresa tu nombre de guerrero';
            return;
        }
        auth.createUserWithEmailAndPassword(email, password)
            .then(cred => {
                return cred.user.updateProfile({ displayName: name });
            })
            .then(() => {
                // Create user document in Firestore
                return db.collection('users').doc(auth.currentUser.uid).set({
                    displayName: auth.currentUser.displayName,
                    email: auth.currentUser.email,
                    photoURL: auth.currentUser.photoURL || '',
                    friends: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            })
            .catch(err => {
                errorEl.textContent = translateFirebaseError(err.code);
            });
    }
}

// ─── Auth: Google Login ──────────────────────────────────────
function handleGoogleLogin() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(result => {
            // Check if user document exists, create if not
            const user = result.user;
            return db.collection('users').doc(user.uid).get().then(doc => {
                if (!doc.exists) {
                    return db.collection('users').doc(user.uid).set({
                        displayName: user.displayName || 'Guerrero',
                        email: user.email,
                        photoURL: user.photoURL || '',
                        friends: [],
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            });
        })
        .catch(err => {
            document.getElementById('login-error').textContent = translateFirebaseError(err.code);
        });
}

// ─── Auth: Toggle Login/Register Mode ────────────────────────
function toggleLoginMode() {
    isLoginMode = !isLoginMode;
    const nameInput = document.getElementById('login-name');
    const btnText = document.getElementById('login-btn');
    const toggleText = document.getElementById('login-toggle-text');
    const subtitle = document.getElementById('login-subtitle');

    if (isLoginMode) {
        nameInput.style.display = 'none';
        btnText.textContent = '⚔ ENTRAR';
        toggleText.innerHTML = '¿No tienes cuenta? <span>Regístrate</span>';
        subtitle.textContent = 'Inicia sesión para jugar online';
    } else {
        nameInput.style.display = 'block';
        btnText.textContent = '⚔ REGISTRARSE';
        toggleText.innerHTML = '¿Ya tienes cuenta? <span>Inicia sesión</span>';
        subtitle.textContent = 'Crea tu cuenta de guerrero';
    }
    document.getElementById('login-error').textContent = '';
}

// ─── Auth: Handle Logout ─────────────────────────────────────
function handleLogout() {
    auth.signOut();
}

// ─── Auth: State Observer ────────────────────────────────────
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = {
            uid: user.uid,
            displayName: user.displayName || 'Guerrero',
            email: user.email,
            photoURL: user.photoURL || ''
        };

        // Hide login, show social
        document.getElementById('login-modal').classList.add('hidden');
        document.getElementById('social-toggle').style.display = 'flex';

        // Update user info in social panel
        updateUserInfoUI();

        // Register with Socket.io server
        socket.emit('register', currentUser);

        // Ensure user document exists in Firestore
        db.collection('users').doc(user.uid).get().then(doc => {
            if (!doc.exists) {
                db.collection('users').doc(user.uid).set({
                    displayName: currentUser.displayName,
                    email: currentUser.email,
                    photoURL: currentUser.photoURL,
                    friends: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
        });

        // Start listening for friends and requests
        listenToFriends();
        listenToFriendRequests();
        listenToMatchStats();

        // Check for pending invitations sent to this email before registration
        checkPendingInvitations();

        console.log(`✅ Logged in as: ${currentUser.displayName}`);
    } else {
        currentUser = null;
        document.getElementById('login-modal').classList.remove('hidden');
        document.getElementById('social-toggle').style.display = 'none';
        document.getElementById('social-panel').classList.remove('open');
    }
});

// ─── UI: Update User Info ────────────────────────────────────
function updateUserInfoUI() {
    const container = document.getElementById('social-user-info');
    if (!currentUser) return;

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

// ─── Social Panel Toggle ─────────────────────────────────────
function toggleSocialPanel() {
    document.getElementById('social-panel').classList.toggle('open');
}

// ─── Tab Switching ───────────────────────────────────────────
function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tab-friends').classList.toggle('active', tab === 'friends');
    document.getElementById('tab-requests').classList.toggle('active', tab === 'requests');

    if (tab === 'friends') {
        renderFriendsList();
    } else {
        renderFriendRequests();
    }
}

// ─── Firestore: Send Friend Request ──────────────────────────
function sendFriendRequest() {
    const emailInput = document.getElementById('add-friend-email');
    const friendEmail = emailInput.value.trim().toLowerCase();

    if (!friendEmail || !currentUser) return;
    if (friendEmail === currentUser.email.toLowerCase()) {
        alert('No puedes agregarte a ti mismo 😅');
        return;
    }

    // Find user by email
    db.collection('users').where('email', '==', friendEmail).get()
        .then(snapshot => {
            if (snapshot.empty) {
                // User not registered - send email invitation!
                sendEmailInvitation(friendEmail);
                return;
            }

            const targetUser = snapshot.docs[0];
            const targetUid = targetUser.id;
            const targetData = targetUser.data();

            // Check if already friends
            if (friendsList.some(f => f.uid === targetUid)) {
                alert('¡Ya son amigos! ⚔');
                return;
            }

            // Create friend request
            db.collection('friendRequests').add({
                fromUid: currentUser.uid,
                fromName: currentUser.displayName,
                fromEmail: currentUser.email,
                fromPhoto: currentUser.photoURL,
                toUid: targetUid,
                toName: targetData.displayName,
                toEmail: targetData.email,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            }).then(() => {
                emailInput.value = '';
                alert('¡Solicitud de amistad enviada! ⚔');
            });
        })
        .catch(err => {
            console.error('Error sending friend request:', err);
            alert('Error al enviar solicitud');
        });
}

// ─── Send Email Invitation (user not registered) ─────────────
function sendEmailInvitation(toEmail) {
    const emailInput = document.getElementById('add-friend-email');

    // Call server endpoint to send email
    fetch('/api/send-invite-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            toEmail: toEmail,
            fromName: currentUser.displayName,
            fromEmail: currentUser.email
        })
    })
        .then(res => res.json())
        .then(data => {
            // Also save a pending invitation in Firestore 
            // so when the user registers, they get auto-matched
            db.collection('pendingInvitations').add({
                fromUid: currentUser.uid,
                fromName: currentUser.displayName,
                fromEmail: currentUser.email,
                toEmail: toEmail,
                status: 'pending',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            emailInput.value = '';
            if (data.emailSent === false) {
                alert(`📨 ¡Invitación guardada!\n\nEl guerrero con email ${toEmail} aún no tiene cuenta.\nCuando se registre, recibirá tu solicitud de amistad automáticamente.\n\n💡 Comparte este link para que se una:\nhttps://growing-now.web.app/`);
            } else {
                alert(`📧 ¡Email de invitación enviado a ${toEmail}!\n\nSe le ha enviado un correo con un link para unirse a Chess Coliseum.`);
            }
        })
        .catch(err => {
            console.error('Error sending email invitation:', err);
            alert(`📨 Invitación guardada para ${toEmail}.\n\nComparte este link para que se una:\nhttps://growing-now.web.app/`);
        });
}

// ─── Check Pending Invitations (auto-convert on registration) ─
function checkPendingInvitations() {
    if (!currentUser) return;

    // Hacemos la consulta solo por email para evitar el error de índice compuesto de Firestore,
    // y filtramos el estado en memoria.
    db.collection('pendingInvitations')
        .where('toEmail', '==', currentUser.email.toLowerCase())
        .get()
        .then(snapshot => {
            snapshot.forEach(doc => {
                const invite = doc.data();

                if (invite.status === 'pending') {
                    // Convertir a una solicitud de amistad real
                    db.collection('friendRequests').add({
                        fromUid: invite.fromUid,
                        fromName: invite.fromName,
                        fromEmail: invite.fromEmail,
                        fromPhoto: invite.fromPhoto || '',
                        toUid: currentUser.uid,
                        toName: currentUser.displayName,
                        toEmail: currentUser.email,
                        status: 'pending',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    })
                        .then(() => {
                            // Marcar la invitación inicial como procesada
                            db.collection('pendingInvitations').doc(doc.id).update({ status: 'converted' });
                            console.log(`📬 ¡Invitación de ${invite.fromName} convertida con éxito!`);
                        })
                        .catch(e => console.error("Error al convertir la solicitud real: ", e));
                }
            });
        })
        .catch(err => {
            console.error("Error buscando invitaciones pendientes:", err);
        });
}

// ─── Firestore: Listen to Friend Requests ────────────────────
function listenToFriendRequests() {
    if (!currentUser) return;

    // Listen for requests sent TO current user
    db.collection('friendRequests')
        .where('toUid', '==', currentUser.uid)
        .where('status', '==', 'pending')
        .onSnapshot(snapshot => {
            friendRequests = [];
            snapshot.forEach(doc => {
                friendRequests.push({ id: doc.id, ...doc.data() });
            });

            // Update badge
            const badge = document.getElementById('req-badge');
            if (friendRequests.length > 0) {
                badge.style.display = 'inline';
                badge.textContent = friendRequests.length;
            } else {
                badge.style.display = 'none';
            }

            if (currentTab === 'requests') {
                renderFriendRequests();
            }
        });
}

// ─── Firestore: Accept Friend Request ────────────────────────
function acceptFriendRequest(requestId, fromUid) {
    // Update request status
    db.collection('friendRequests').doc(requestId).update({ status: 'accepted' });

    // Add each other as friends
    db.collection('users').doc(currentUser.uid).update({
        friends: firebase.firestore.FieldValue.arrayUnion(fromUid)
    });
    db.collection('users').doc(fromUid).update({
        friends: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
    });
}

// ─── Firestore: Decline Friend Request ───────────────────────
function declineFriendRequest(requestId) {
    db.collection('friendRequests').doc(requestId).update({ status: 'declined' });
}

// ─── Firestore: Listen to Friends List ───────────────────────
function listenToFriends() {
    if (!currentUser) return;

    db.collection('users').doc(currentUser.uid).onSnapshot(doc => {
        if (!doc.exists) return;
        const data = doc.data();
        const friendUids = data.friends || [];

        if (friendUids.length === 0) {
            friendsList = [];
            if (currentTab === 'friends') renderFriendsList();
            return;
        }

        // Fetch all friend user documents
        // Firestore 'in' queries support max 10 items, so batch if needed
        const batches = [];
        for (let i = 0; i < friendUids.length; i += 10) {
            const batch = friendUids.slice(i, i + 10);
            batches.push(
                db.collection('users').where(firebase.firestore.FieldPath.documentId(), 'in', batch).get()
            );
        }

        Promise.all(batches).then(results => {
            friendsList = [];
            results.forEach(snapshot => {
                snapshot.forEach(doc => {
                    friendsList.push({ uid: doc.id, ...doc.data() });
                });
            });
            if (currentTab === 'friends') renderFriendsList();
        });
    });
}

// ─── Firestore: Listen to Match Stats ───────────────────────
function listenToMatchStats() {
    if (!currentUser) return;

    db.collection('matchStats')
        .where('players', 'array-contains', currentUser.uid)
        .onSnapshot(snapshot => {
            matchStats = {};
            snapshot.forEach(doc => {
                matchStats[doc.id] = doc.data();
            });
            if (currentTab === 'friends') renderFriendsList();
        });
}

// ─── UI: Render Friends List ─────────────────────────────────
function renderFriendsList() {
    const container = document.getElementById('social-content');

    if (friendsList.length === 0) {
        container.innerHTML = '<div class="empty-state">Agrega amigos para jugar online ⚔<br><br>Comparte tu email para que te agreguen</div>';
        return;
    }

    let html = '';
    friendsList.forEach(friend => {
        const isOnline = onlineUsers.some(u => u.uid === friend.uid);
        const initial = (friend.displayName || 'G')[0].toUpperCase();
        const statusClass = isOnline ? 'online' : 'offline';
        const statusText = isOnline ? 'En línea' : 'Desconectado';
        const inviteDisabled = !isOnline || multiplayerRoomId ? 'disabled' : '';

        // Match Stats Math
        const pairId = [currentUser.uid, friend.uid].sort().join('_');
        const stats = matchStats[pairId];
        let statsHtml = '';
        if (stats && stats.played > 0) {
            const myWins = stats[`wins_${currentUser.uid}`] || 0;
            const friendWins = stats[`wins_${friend.uid}`] || 0;
            statsHtml = `<div class="friend-stats">⚔ ${myWins} - ${friendWins} | Partidas: ${stats.played}</div>`;
        } else {
            statsHtml = `<div class="friend-stats-empty">Sin batallas previas</div>`;
        }

        html += `
            <div class="friend-item">
                <div class="friend-avatar-letter">${initial}</div>
                <div class="friend-info">
                    <div class="friend-name">${friend.displayName}</div>
                    <div class="friend-status ${statusClass}">
                        <span class="status-dot ${statusClass}"></span> ${statusText}
                    </div>
                    ${statsHtml}
                </div>
                <button class="friend-invite-btn" onclick="sendGameInvite('${friend.uid}', '${friend.displayName}')" ${inviteDisabled}>
                    ⚔ Invitar
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ─── UI: Render Friend Requests ──────────────────────────────
function renderFriendRequests() {
    const container = document.getElementById('social-content');

    if (friendRequests.length === 0) {
        container.innerHTML = '<div class="empty-state">No tienes solicitudes pendientes</div>';
        return;
    }

    let html = '';
    friendRequests.forEach(req => {
        const initial = (req.fromName || 'G')[0].toUpperCase();
        html += `
            <div class="request-item">
                <div class="friend-avatar-letter">${initial}</div>
                <div class="friend-info">
                    <div class="friend-name">${req.fromName}</div>
                    <div class="friend-status offline">${req.fromEmail}</div>
                </div>
                <div class="request-actions">
                    <button class="req-accept" onclick="acceptFriendRequest('${req.id}', '${req.fromUid}')">✓ Aceptar</button>
                    <button class="req-decline" onclick="declineFriendRequest('${req.id}')">✕</button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ─── Socket.io: Online Users ─────────────────────────────────
socket.on('onlineUsers', (users) => {
    onlineUsers = users.filter(u => u.uid !== currentUser?.uid);
    document.getElementById('online-count').textContent = onlineUsers.length;
    if (currentTab === 'friends') renderFriendsList();
});

// ─── Socket.io: Game Invitations ─────────────────────────────
function sendGameInvite(toUid, toName) {
    if (!currentUser) return;
    socket.emit('sendGameInvite', {
        toUid,
        fromUid: currentUser.uid,
        fromName: currentUser.displayName,
        fromPhoto: currentUser.photoURL
    });
    alert(`⚔ Invitación enviada a ${toName}!`);
}

socket.on('gameInviteReceived', (data) => {
    pendingInvite = data;
    const popup = document.getElementById('invite-popup');
    document.getElementById('invite-msg').textContent =
        `${data.fromName} te desafía a una partida de ajedrez`;
    popup.classList.add('show');

    // Play notification sound (optional)
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.frequency.value = 880;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.1;
        oscillator.start();
        setTimeout(() => { oscillator.frequency.value = 1100; }, 150);
        setTimeout(() => { oscillator.stop(); }, 300);
    } catch (e) { /* ignore audio errors */ }

    document.getElementById('invite-accept-btn').onclick = () => {
        popup.classList.remove('show');
        // Invitee plays black, inviter plays white
        socket.emit('acceptGameInvite', {
            roomId: data.roomId,
            whiteUid: data.fromUid,
            blackUid: currentUser.uid
        });
    };

    document.getElementById('invite-decline-btn').onclick = () => {
        popup.classList.remove('show');
        socket.emit('declineGameInvite', {
            fromUid: data.fromUid,
            declinedByName: currentUser.displayName
        });
        pendingInvite = null;
    };
});

socket.on('inviteError', (data) => {
    alert(`⚠ ${data.message}`);
});

socket.on('gameInviteDeclined', (data) => {
    alert(`😢 ${data.declinedByName} rechazó tu desafío.`);
});

// ─── Socket.io: Game Start ───────────────────────────────────
socket.on('gameStart', (data) => {
    multiplayerRoomId = data.roomId;

    if (currentUser.uid === data.white) {
        multiplayerColor = 'white';
        multiplayerOpponentUid = data.black;
    } else {
        multiplayerColor = 'black';
        multiplayerOpponentUid = data.white;
    }

    // Close modal and social panel
    document.getElementById('game-modal').classList.add('hidden');
    document.getElementById('social-panel').classList.remove('open');

    // Update UI
    const opponentName = multiplayerColor === 'white' ? data.blackName : data.whiteName;
    document.getElementById('status').innerText = `⚔ Online vs ${opponentName}`;

    // Set game mode to multiplayer
    if (typeof window.startMultiplayerGame === 'function') {
        window.startMultiplayerGame(multiplayerColor, multiplayerRoomId, opponentName);
    }

    console.log(`🎮 Multiplayer started! You are ${multiplayerColor} in room ${multiplayerRoomId}`);
});

// ─── Socket.io: Receive Opponent Move ────────────────────────
socket.on('opponentMove', (data) => {
    if (typeof window.receiveOpponentMove === 'function') {
        window.receiveOpponentMove(data.move);
    }
});

socket.on('gameEnded', (data) => {
    // Determine winner and update stats
    if (multiplayerRoomId && multiplayerOpponentUid && currentUser) {
        const iWon = (multiplayerColor === data.winner);
        const isDraw = (data.result === 'draw' || data.result === 'stalemate');

        // Only one client should update the stats to prevent double counting
        // The winner updates it. If draw, the 'white' player updates it.
        if (iWon || (isDraw && multiplayerColor === 'white')) {
            const pairId = [currentUser.uid, multiplayerOpponentUid].sort().join('_');
            const matchData = {
                players: [currentUser.uid, multiplayerOpponentUid],
                played: firebase.firestore.FieldValue.increment(1)
            };
            if (iWon) {
                matchData[`wins_${currentUser.uid}`] = firebase.firestore.FieldValue.increment(1);
            }
            db.collection('matchStats').doc(pairId).set(matchData, { merge: true }).catch(console.error);
        }
    }

    multiplayerRoomId = null;
    multiplayerColor = null;
    multiplayerOpponentUid = null;
    const msg = data.result === 'resignation'
        ? '🏳️ ¡El oponente se rindió!'
        : `🏁 Partida terminada: ${data.winner === 'white' ? 'Blancas' : 'Negras'} ganan!`;
    alert(msg);
    if (document.getElementById('reset-btn')) {
        document.getElementById('reset-btn').style.display = 'inline-block';
    }
});

// ─── Send Move to Server ─────────────────────────────────────
function sendMoveToServer(moveData) {
    if (multiplayerRoomId) {
        socket.emit('chessMove', {
            roomId: multiplayerRoomId,
            move: moveData
        });
    }
}

// ─── Send Game Over to Server ────────────────────────────────
function sendGameOverToServer(result, winner) {
    if (multiplayerRoomId) {
        // Only the winner (or white if draw) sends to avoid duplicate calls
        if ((result !== 'draw' && multiplayerColor === winner) || (result === 'draw' && multiplayerColor === 'white') || (result === 'stalemate' && multiplayerColor === 'white')) {
            socket.emit('gameOver', {
                roomId: multiplayerRoomId,
                result: result,
                winner: winner
            });
        }
    }
}

function resignGame() {
    if (multiplayerRoomId && currentUser) {
        socket.emit('resign', {
            roomId: multiplayerRoomId,
            uid: currentUser.uid
        });
        multiplayerRoomId = null;
        multiplayerColor = null;
    }
}

// ─── Share via WhatsApp ──────────────────────────────────────
function shareViaWhatsApp() {
    if (!currentUser) return;

    const url = 'https://growing-now.web.app/';
    const message = `⚔ ¡${currentUser.displayName} te desafía a una batalla épica en Chess Coliseum!\n\nÚnete a la Arena aquí: ${url}\n\nMi correo es: ${currentUser.email}`;

    // Create the whatsapp API URL
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;

    // Open in new tab
    window.open(whatsappUrl, '_blank');
}

// ─── Helper: Translate Firebase Errors ───────────────────────
function translateFirebaseError(code) {
    const errors = {
        'auth/email-already-in-use': 'Este email ya está registrado',
        'auth/invalid-email': 'Email inválido',
        'auth/user-not-found': 'No existe una cuenta con este email',
        'auth/wrong-password': 'Contraseña incorrecta',
        'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
        'auth/too-many-requests': 'Demasiados intentos. Espera un momento.',
        'auth/popup-closed-by-user': 'Se cerró la ventana de Google',
        'auth/invalid-credential': 'Credenciales inválidas. Revisa email y contraseña.',
    };
    return errors[code] || 'Error: ' + code;
}

// ─── Expose functions to global scope ────────────────────────
window.handleEmailLogin = handleEmailLogin;
window.handleGoogleLogin = handleGoogleLogin;
window.toggleLoginMode = toggleLoginMode;
window.handleLogout = handleLogout;
window.toggleSocialPanel = toggleSocialPanel;
window.switchTab = switchTab;
window.sendFriendRequest = sendFriendRequest;
window.acceptFriendRequest = acceptFriendRequest;
window.declineFriendRequest = declineFriendRequest;
window.sendGameInvite = sendGameInvite;
window.sendMoveToServer = sendMoveToServer;
window.sendGameOverToServer = sendGameOverToServer;
window.resignGame = resignGame;
window.shareViaWhatsApp = shareViaWhatsApp;
