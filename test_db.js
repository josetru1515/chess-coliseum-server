const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyBL6Z3WqpUwLyYA3onViT2_Yq8Xw-otP2g",
    authDomain: "chess-coliseum-pro.firebaseapp.com",
    projectId: "chess-coliseum-pro"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function test() {
    try {
        console.log('--- friendRequests ---');
        const frSnap = await getDocs(collection(db, 'friendRequests'));
        frSnap.forEach(doc => console.log(doc.id, doc.data()));

        console.log('--- pendingInvitations ---');
        const piSnap = await getDocs(collection(db, 'pendingInvitations'));
        piSnap.forEach(doc => console.log(doc.id, doc.data()));

        console.log('--- users ---');
        const usrSnap = await getDocs(collection(db, 'users'));
        usrSnap.forEach(doc => console.log(doc.id, doc.data().email, doc.data().displayName));

        process.exit(0);
    } catch (err) {
        console.error('Error fetching data:', err);
    }
}
test();
