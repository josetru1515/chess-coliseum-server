const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, updateDoc, doc } = require('firebase/firestore');

const firebaseConfig = {
    apiKey: "AIzaSyBL6Z3WqpUwLyYA3onViT2_Yq8Xw-otP2g",
    authDomain: "chess-coliseum-pro.firebaseapp.com",
    projectId: "chess-coliseum-pro"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function resetAllSkins() {
    const usersSnap = await getDocs(collection(db, 'users'));
    let count = 0;
    for (const userDoc of usersSnap.docs) {
        await updateDoc(doc(db, 'users', userDoc.id), { unlockedSkins: ['orcos'] });
        console.log(`Reset: ${userDoc.data().email || userDoc.id}`);
        count++;
    }
    console.log(`\nDone. Reset ${count} users to ['orcos'].`);
    process.exit(0);
}

resetAllSkins().catch(err => { console.error(err); process.exit(1); });
