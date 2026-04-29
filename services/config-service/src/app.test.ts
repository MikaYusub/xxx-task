import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config service", () => {
  it("returns 404 for unknown users", async () => {
    const response = await request(createApp()).get("/v1/config/missing-user");

    expect(response.status).toBe(404);
  });

  it("returns a LoRA config after local seeding", async () => {
    vi.stubEnv("ENABLE_LOCAL_ENDPOINTS", "true");
    const app = createApp();

    await request(app).post("/v1/local/users/user-1").expect(201);
    const response = await request(app).get("/v1/config/user-1").expect(200);

    expect(response.body.lora_url).toContain("https://huggingface.co/");
    expect(response.body.lora_weight).toBeGreaterThanOrEqual(0);
    expect(response.body.lora_weight).toBeLessThanOrEqual(1);
    expect(response.body.updated_at).toBe("2026-02-03T10:00:00Z");
  });

  it("returns a predefined LoRA config on each seeded lookup", async () => {
    vi.stubEnv("ENABLE_LOCAL_ENDPOINTS", "true");
    const app = createApp();

    await request(app).post("/v1/local/users/user-1").expect(201);
    const first = await request(app).get("/v1/config/user-1").expect(200);
    const second = await request(app).get("/v1/config/user-1").expect(200);

    expect(first.body.lora_url).toContain("https://huggingface.co/");
    expect(second.body.lora_url).toContain("https://huggingface.co/");
  });

  it("allows the static reviewer console to seed local config", async () => {
    const response = await request(createApp()).options("/v1/local/users/user-1").expect(204);

    expect(response.headers["access-control-allow-origin"]).toBe("*");
  });

  it("hides local seed endpoint unless local endpoints are enabled", async () => {
    vi.stubEnv("ENABLE_LOCAL_ENDPOINTS", "false");

    await request(createApp()).post("/v1/local/users/user-1").expect(404);
  });
});
