import express from "express";
import { loraConfigs } from "./configs.js";

export function createApp() {
  const seededUsers = new Set(
    (process.env.CONFIG_USER_ALLOWLIST ?? "")
      .split(",")
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
  const assignedConfigs = new Map<string, (typeof loraConfigs)[number]>();
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/v1/local/users/:user_id", (request, response) => {
    seededUsers.add(request.params.user_id);
    assignedConfigs.set(request.params.user_id, randomConfig());
    response.status(201).json({ user_id: request.params.user_id });
  });

  app.get("/v1/config/:user_id", (request, response) => {
    if (!seededUsers.has(request.params.user_id)) {
      response.status(404).json({ error: "CONFIG_NOT_FOUND" });
      return;
    }

    if (!assignedConfigs.has(request.params.user_id)) {
      assignedConfigs.set(request.params.user_id, randomConfig());
    }

    response.json(assignedConfigs.get(request.params.user_id));
  });

  return app;
}

function randomConfig() {
  const index = Math.floor(Math.random() * loraConfigs.length);
  return loraConfigs[index];
}
