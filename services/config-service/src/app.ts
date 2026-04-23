import express from "express";
import { loraConfigs } from "./configs.js";

const seededUsers = new Set(
  (process.env.CONFIG_USER_ALLOWLIST ?? "")
    .split(",")
    .map((userId) => userId.trim())
    .filter(Boolean),
);

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/v1/local/users/:user_id", (request, response) => {
    seededUsers.add(request.params.user_id);
    response.status(201).json({ user_id: request.params.user_id });
  });

  app.get("/v1/config/:user_id", (request, response) => {
    if (!seededUsers.has(request.params.user_id)) {
      response.status(404).json({ error: "CONFIG_NOT_FOUND" });
      return;
    }

    const index = Math.floor(Math.random() * loraConfigs.length);
    response.json(loraConfigs[index]);
  });

  return app;
}
