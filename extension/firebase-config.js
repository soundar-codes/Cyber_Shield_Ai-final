import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDLjlB2CJTe8U4ixHx7ul6D6xob_4i7yHY",
  authDomain: "cybershield-e1127.firebaseapp.com",
  projectId: "cybershield-e1127",
  storageBucket: "cybershield-e1127.firebasestorage.app",
  messagingSenderId: "750321830675",
  appId: "1:750321830675:web:075af062a343d5c3ad68e6",
  measurementId: "G-1TYLK0FDWX"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function createHash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString();
}
async function wasRecentlyLogged(url, type) {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const q = query(
      collection(db, "threat_logs"),
      where("website_url", "==", url),
      where("threat_type", "==", type),
      where("detected_at", ">", oneHourAgo)
    );
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
  } catch (e) {
    console.error("Error checking recent logs:", e);
    return false;
  }
}
export async function logThreat(url, type) {
  try {
    const alreadyLogged = await wasRecentlyLogged(url, type);
    if (alreadyLogged) {
      console.log("Threat already logged recently, skipping duplicate...");
      return;
    }

    await addDoc(collection(db, "threat_logs"), {
      website_url: url,
      threat_type: type,
      detected_at: serverTimestamp(),
      hash: createHash(`${url}_${type}`)
    });
    console.log("New threat logged to Firebase!");
  } catch (e) {
    console.error("Firebase Error: ", e);
  }
}

