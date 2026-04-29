import { beforeEach, describe, expect, it, vi } from "vitest";

const docs = new Map<string, Record<string, unknown>>();
const fetchMock = vi.fn();

class TestTimestamp {
  constructor(private readonly ms: number) {}

  toMillis() {
    return this.ms;
  }

  static now() {
    return new TestTimestamp(Date.now());
  }
}

const FieldValue = {
  serverTimestamp: () => "server-time",
  delete: () => ({ type: "delete" }),
};

vi.mock("firebase-admin/app", () => ({
  initializeApp: vi.fn(),
}));

vi.mock("firebase-functions/v2", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
  setGlobalOptions: vi.fn(),
}));

vi.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: vi.fn((_path, handler) => handler),
}));

vi.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: vi.fn((_schedule, handler) => handler),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue,
  Timestamp: TestTimestamp,
  getFirestore: () => ({
    collection: () => ({
      doc: (id: string) => ({
        id,
        update: async (patch: Record<string, unknown>) => {
          const data = docs.get(id);
          expect(data).toBeDefined();
          docs.set(id, applyPatch(data!, patch));
        },
      }),
    }),
    runTransaction: async (callback: (transaction: Transaction) => Promise<unknown>) =>
      callback(new Transaction()),
  }),
}));

class Transaction {
  async get(ref: { id: string }) {
    return { data: () => docs.get(ref.id) };
  }

  update(ref: { id: string }, patch: Record<string, unknown>) {
    const data = docs.get(ref.id);
    expect(data).toBeDefined();
    docs.set(ref.id, applyPatch(data!, patch));
  }
}

function applyPatch(data: Record<string, unknown>, patch: Record<string, unknown>) {
  const next = { ...data };

  for (const [key, value] of Object.entries(patch)) {
    if (isDelete(value)) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }

  return next;
}

function isDelete(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "delete"
  );
}

async function loadFunctions() {
  const functions = await import("./index.js");
  functions.clearConfigCache();
  return functions;
}

beforeEach(() => {
  docs.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.CONFIG_SERVICE_URL = "http://config";
  process.env.INFERENCE_SERVER_URL = "http://inference";
  process.env.API_KEY = "test-key";
});

describe("generation request function", () => {
  it("queues CREATED docs before dispatching to inference", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "CREATED", user_id: "user-1", prompt: "hello" });
    fetchMock
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true });

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    expect(docs.get("doc-1")?.status).toBe("QUEUED");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://inference/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ doc_id: "doc-1", prompt: "hello" }),
      }),
    );
  });

  it("treats config 404 as no LoRA", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "CREATED", user_id: "user-1", prompt: "hello" });
    fetchMock
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({ status: 200, ok: true });

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toEqual({ doc_id: "doc-1", prompt: "hello" });
  });

  it("fails the job when config returns 5xx twice", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "CREATED", user_id: "user-1", prompt: "hello" });
    fetchMock
      .mockResolvedValueOnce({ status: 500, ok: false })
      .mockResolvedValueOnce({ status: 503, ok: false });

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    expect(docs.get("doc-1")?.status).toBe("FAILED");
    expect(docs.get("doc-1")?.error_code).toBe("CONFIG_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks inference 500 as failed", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "CREATED", user_id: "user-1", prompt: "hello" });
    fetchMock
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({ status: 500, ok: false, text: async () => "boom" });

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    expect(docs.get("doc-1")?.status).toBe("FAILED");
    expect(docs.get("doc-1")?.error_code).toBe("INFERENCE_ERROR");
  });

  it("marks unreachable inference as failed", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "CREATED", user_id: "user-1", prompt: "hello" });
    fetchMock
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockRejectedValueOnce(new Error("network down"));

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    expect(docs.get("doc-1")?.status).toBe("FAILED");
    expect(docs.get("doc-1")?.error_code).toBe("INFERENCE_UNREACHABLE");
  });

  it("does not fail jobs already processing in inference", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "CREATED", user_id: "user-1", prompt: "hello" });
    fetchMock
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({
        status: 409,
        ok: false,
        text: async () => '{"detail":"Job is already processing"}',
      });

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    expect(docs.get("doc-1")?.status).toBe("QUEUED");
  });

  it("marks unexpected inference conflicts as failed", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "CREATED", user_id: "user-1", prompt: "hello" });
    fetchMock
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({
        status: 409,
        ok: false,
        text: async () => '{"detail":"Job is CREATED"}',
      });

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    expect(docs.get("doc-1")?.status).toBe("FAILED");
    expect(docs.get("doc-1")?.error_code).toBe("INFERENCE_ERROR");
  });

  it("ignores duplicate create delivery after CREATED is gone", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", { status: "QUEUED", user_id: "user-1", prompt: "hello" });

    await functions.onGenerationRequestCreated({
      params: { docId: "doc-1" },
      data: { data: () => docs.get("doc-1") },
    });

    expect(docs.get("doc-1")?.status).toBe("QUEUED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("stale recovery", () => {
  it("requeues expired PROCESSING jobs below max attempts", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", {
      status: "PROCESSING",
      user_id: "user-1",
      prompt: "hello",
      attempt_count: 2,
      processing_owner: "old",
      lease_expires_at: new TestTimestamp(Date.now() - 1),
    });

    const result = await functions.recoverStaleJob("doc-1");

    expect(result.type).toBe("requeued");
    expect(docs.get("doc-1")?.status).toBe("QUEUED");
    expect(docs.get("doc-1")?.processing_owner).toBeUndefined();
    expect(docs.get("doc-1")?.lease_expires_at).toBeUndefined();
  });

  it("fails expired PROCESSING jobs at max attempts", async () => {
    const functions = await loadFunctions();
    docs.set("doc-1", {
      status: "PROCESSING",
      user_id: "user-1",
      prompt: "hello",
      attempt_count: 3,
      processing_owner: "old",
      lease_expires_at: new TestTimestamp(Date.now() - 1),
    });

    const result = await functions.recoverStaleJob("doc-1");

    expect(result.type).toBe("failed");
    expect(docs.get("doc-1")?.status).toBe("FAILED");
    expect(docs.get("doc-1")?.error_code).toBe("LEASE_EXPIRED");
  });
});
