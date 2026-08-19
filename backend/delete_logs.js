import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const keyPath = path.join(__dirname, 'serviceAccountKey.json');
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function deleteCollection(collectionPath, batchSize) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve, 0).catch(reject);
  });
}

async function deleteQueryBatch(query, resolve, totalDeleted) {
  const snapshot = await query.get();

  if (snapshot.size === 0) {
    console.log(`Finished! Total documents deleted: ${totalDeleted}`);
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });

  await batch.commit();
  const newTotal = totalDeleted + snapshot.size;
  console.log(`Deleted batch of ${snapshot.size} (Total: ${newTotal})...`);

  process.nextTick(() => {
    deleteQueryBatch(query, resolve, newTotal);
  });
}

console.log("Starting batch deletion of 'threat_logs'...");
deleteCollection('threat_logs', 500).catch(console.error);