import assert from "node:assert";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { logger, setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();
setGlobalOptions({ region: "us-central1", timeoutSeconds: 540, memory: "512MiB" });

const db = getFirestore();
const maxAttempts = 3;
const configTimeoutMs = 1_500;
const inferenceTimeoutMs = 8 * 60_000;
const configTtlMs = 60_000;

type JobStatus = "CREATED" | "QUEUED" | "PROCESSING" | "DONE" | "FAILED";

type LoraConfig = {
  lora_url: string;
  lora_weight: number;
  updated_at: string;
};

type ConfigResult =
  | { type: "found"; config: LoraConfig }
  | { type: "none" }
  | { type: "temporary_failure"; message: string };

type InferenceRequest =
  | { doc_id: string; prompt: string }
  | { doc_id: string; prompt: string; lora_url: string; lora_weight: number };

type CachedConfig = {
  expiresAt: number;
  result: ConfigResult;
};

const configCache = new Map<string, CachedConfig>();

export const onGenerationRequestCreated = onDocumentCreated(
  "generation_requests/{docId}",
  async (event) => {
    const docId = event.params.docId;
    const data = event.data?.data();

    if (!data) {
      return;
    }

    const queued = await queueCreatedRequest(docId);

    if (!queued) {
      logger.info("create trigger ignored", { doc_id: docId, status: data.status });
      return;
    }

    await dispatchQueuedRequest(docId, String(data.user_id), String(data.prompt));
  },
);

export const recoverStuckGenerationRequests = onSchedule("every 5 minutes", async () => {
  const now = Timestamp.now();
  const staleJobs = await db
    .collection("generation_requests")
    .where("status", "==", "PROCESSING")
    .where("lease_expires_at", "<", now)
    .limit(20)
    .get();

  for (const staleJob of staleJobs.docs) {
    const recovered = await recoverStaleJob(staleJob.id);

    if (recovered.type === "requeued") {
      await dispatchQueuedRequest(staleJob.id, recovered.userId, recovered.prompt);
    }
  }
});

async function queueCreatedRequest(docId: string) {
  const ref = db.collection("generation_requests").doc(docId);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data();

    if (!data || data.status !== "CREATED") {
      return false;
    }

    transaction.update(ref, {
      status: "QUEUED" satisfies JobStatus,
      queued_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
      attempt_count: 0,
    });

    return true;
  });
}

async function dispatchQueuedRequest(docId: string, userId: string, prompt: string) {
  const configResult = await getUserConfig(userId);

  if (configResult.type === "temporary_failure") {
    await markFailed(docId, "CONFIG_UNAVAILABLE", configResult.message);
    return;
  }

  const body: InferenceRequest =
    configResult.type === "found"
      ? {
          doc_id: docId,
          prompt,
          lora_url: configResult.config.lora_url,
          lora_weight: configResult.config.lora_weight,
        }
      : { doc_id: docId, prompt };

  const response = await postInference(body);

  if (response.type === "ok" || response.type === "duplicate") {
    return;
  }

  await markDispatchFailed(docId, response.errorCode, response.message);
}

async function getUserConfig(userId: string): Promise<ConfigResult> {
  const cached = configCache.get(userId);

  if (cached && cached.expiresAt > Date.now()) {
    logger.info("config cache hit", { user_id: userId, result: cached.result.type });
    return cached.result;
  }

  const result = await fetchUserConfig(userId);

  if (result.type !== "temporary_failure") {
    configCache.set(userId, { result, expiresAt: Date.now() + configTtlMs });
  }

  return result;
}

async function fetchUserConfig(userId: string): Promise<ConfigResult> {
  const url = `${requiredEnv("CONFIG_SERVICE_URL")}/v1/config/${encodeURIComponent(userId)}`;

  for (const attempt of [1, 2]) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), configTimeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const latency_ms = Date.now() - startedAt;

      if (response.status === 404) {
        logger.info("config lookup none", { user_id: userId, latency_ms });
        return { type: "none" };
      }

      if (response.ok) {
        const config = (await response.json()) as LoraConfig;
        assertValidConfig(config);
        logger.info("config lookup found", { user_id: userId, latency_ms });
        return { type: "found", config };
      }

      logger.warn("config lookup failed", {
        user_id: userId,
        attempt,
        status: response.status,
        latency_ms,
      });
    } catch (error) {
      logger.warn("config lookup error", {
        user_id: userId,
        attempt,
        error: errorMessage(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return { type: "temporary_failure", message: "Config service unavailable" };
}

async function postInference(body: InferenceRequest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), inferenceTimeoutMs);

  try {
    const response = await fetch(`${requiredEnv("INFERENCE_SERVER_URL")}/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requiredEnv("API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (response.ok) {
      return { type: "ok" as const };
    }

    if (response.status === 409) {
      return { type: "duplicate" as const };
    }

    return {
      type: "failed" as const,
      errorCode: "INFERENCE_ERROR",
      message: await response.text(),
    };
  } catch (error) {
    return {
      type: "failed" as const,
      errorCode: "INFERENCE_UNREACHABLE",
      message: errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function markDispatchFailed(docId: string, errorCode: string, message: string) {
  const ref = db.collection("generation_requests").doc(docId);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data();

    if (!data || data.status === "DONE" || data.status === "FAILED") {
      return;
    }

    if (data.status === "PROCESSING" && leaseIsValid(data.lease_expires_at)) {
      logger.warn("dispatch failed while inference lease is still valid", {
        doc_id: docId,
        error_code: errorCode,
      });
      return;
    }

    transaction.update(ref, failurePatch(errorCode, message));
  });
}

async function markFailed(docId: string, errorCode: string, message: string) {
  const ref = db.collection("generation_requests").doc(docId);
  await ref.update(failurePatch(errorCode, message));
}

function failurePatch(errorCode: string, message: string) {
  return {
    status: "FAILED" satisfies JobStatus,
    error_code: errorCode,
    error_message: message.slice(0, 1000),
    finished_at: FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
}

async function recoverStaleJob(docId: string) {
  const ref = db.collection("generation_requests").doc(docId);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.data();

    if (!data || data.status !== "PROCESSING" || leaseIsValid(data.lease_expires_at)) {
      return { type: "ignored" as const };
    }

    const attemptCount = Number(data.attempt_count ?? 0);

    if (attemptCount >= maxAttempts) {
      transaction.update(ref, failurePatch("LEASE_EXPIRED", "Processing lease expired"));
      logger.warn("stale job failed", { doc_id: docId, attempt_count: attemptCount });
      return { type: "failed" as const };
    }

    transaction.update(ref, {
      status: "QUEUED" satisfies JobStatus,
      processing_owner: FieldValue.delete(),
      lease_expires_at: FieldValue.delete(),
      updated_at: FieldValue.serverTimestamp(),
    });

    logger.warn("stale job requeued", { doc_id: docId, attempt_count: attemptCount });

    return {
      type: "requeued" as const,
      userId: String(data.user_id),
      prompt: String(data.prompt),
    };
  });
}

function leaseIsValid(value: unknown) {
  return value instanceof Timestamp && value.toMillis() > Date.now();
}

function assertValidConfig(config: LoraConfig) {
  assert(config.lora_url.startsWith("https://huggingface.co/"));
  assert(config.lora_weight >= 0);
  assert(config.lora_weight <= 1);
}

function requiredEnv(name: string) {
  const value = process.env[name];
  assert(value, `${name} is required`);
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
