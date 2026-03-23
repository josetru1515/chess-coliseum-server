const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyDIoozFa_dI7O_ehrS6Rmn2MTrimgmUhgI",
    authDomain: "growing-now.firebaseapp.com",
    projectId: "growing-now"
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
