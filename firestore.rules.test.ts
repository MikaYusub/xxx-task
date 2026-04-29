import fs from "node:fs";
import {
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, test } from "vitest";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const projectId = "demo-local";
const userId = "user-1";
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

test("allows authenticated users to create their own CREATED request", async () => {
  const db = testEnv.authenticatedContext(userId).firestore();

  await assertSucceeds(
    setDoc(doc(db, "generation_requests/doc-1"), {
      user_id: userId,
      prompt: "a forest cabin in winter",
      status: "CREATED",
    }),
  );
});

test("rejects missing prompt", async () => {
  const db = testEnv.authenticatedContext(userId).firestore();

  await assertFails(
    setDoc(doc(db, "generation_requests/doc-1"), {
      user_id: userId,
      status: "CREATED",
    }),
  );
});

test("rejects incorrect user_id", async () => {
  const db = testEnv.authenticatedContext(userId).firestore();

  await assertFails(
    setDoc(doc(db, "generation_requests/doc-1"), {
      user_id: "user-2",
      prompt: "a forest cabin in winter",
      status: "CREATED",
    }),
  );
});

test("rejects statuses other than CREATED", async () => {
  const db = testEnv.authenticatedContext(userId).firestore();

  await assertFails(
    setDoc(doc(db, "generation_requests/doc-1"), {
      user_id: userId,
      prompt: "a forest cabin in winter",
      status: "QUEUED",
    }),
  );
});

test("rejects client updates and deletes", async () => {
  const db = testEnv.authenticatedContext(userId).firestore();
  const ref = doc(db, "generation_requests/doc-1");

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "generation_requests/doc-1"), {
      user_id: userId,
      prompt: "a forest cabin in winter",
      status: "CREATED",
    });
  });

  await assertSucceeds(getDoc(ref));
  await assertFails(updateDoc(ref, { status: "QUEUED" }));
  await assertFails(deleteDoc(ref));
});

test("rejects missing document reads without rule evaluation errors", async () => {
  const db = testEnv.authenticatedContext(userId).firestore();

  await assertFails(getDoc(doc(db, "generation_requests/missing-doc")));
});
