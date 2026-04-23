import assert from "node:assert";
import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
} from "firebase/auth";
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-local";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const args = process.argv.slice(2);
const seedConfig = args.includes("--seed-config");
const prompt = args.filter((arg) => arg !== "--seed-config").join(" ").trim();

assert(prompt.length > 0, "Prompt is required");
assert(prompt.length <= 1000, "Prompt must be at most 1000 characters");

const app = initializeApp({
  apiKey: "demo-local",
  authDomain: `${projectId}.firebaseapp.com`,
  projectId,
});

const auth = getAuth(app);
const firestore = getFirestore(app);

connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
connectFirestoreEmulator(firestore, firestoreHost.split(":")[0], Number(firestoreHost.split(":")[1]));

const credential = await signInAnonymously(auth);
const userId = credential.user.uid;

if (seedConfig) {
  const configServiceUrl = process.env.CONFIG_SERVICE_URL ?? "http://127.0.0.1:3000";

  await fetch(`${configServiceUrl}/v1/local/users/${encodeURIComponent(userId)}`, {
    method: "POST",
  });
}

const doc = await addDoc(collection(firestore, "generation_requests"), {
  user_id: userId,
  prompt,
  status: "CREATED",
});

console.log(
  JSON.stringify(
    {
      doc_id: doc.id,
      user_id: userId,
      config_seeded: seedConfig,
      config_seed_url: `http://127.0.0.1:3000/v1/local/users/${userId}`,
    },
    null,
    2,
  ),
);
