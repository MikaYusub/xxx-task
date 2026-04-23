import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("config service", () => {
  it("returns 404 for unknown users", async () => {
    const response = await request(createApp()).get("/v1/config/missing-user");

    expect(response.status).toBe(404);
  });

  it("returns a LoRA config after local seeding", async () => {
    const app = createApp();

    await request(app).post("/v1/local/users/user-1").expect(201);
    const response = await request(app).get("/v1/config/user-1").expect(200);

    expect(response.body.lora_url).toContain("https://huggingface.co/");
    expect(response.body.lora_weight).toBeGreaterThanOrEqual(0);
    expect(response.body.lora_weight).toBeLessThanOrEqual(1);
    expect(response.body.updated_at).toBe("2026-02-03T10:00:00Z");
  });
});
