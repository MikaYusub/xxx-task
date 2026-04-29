import express from "express";
import { loraConfigs } from "./configs.js";

export function createApp() {
  const seededUsers = new Set(
    (process.env.CONFIG_USER_ALLOWLIST ?? "")
      .split(",")
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
  const app = express();

  app.use((_request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  app.use(express.json());

  app.options("*", (_request, response) => {
    response.sendStatus(204);
  });

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  if (process.env.ENABLE_LOCAL_ENDPOINTS === "true") {
    app.post("/v1/local/users/:user_id", (request, response) => {
      seededUsers.add(request.params.user_id);
      response.status(201).json({ user_id: request.params.user_id });
    });
  }

  app.get("/v1/config/:user_id", (request, response) => {
    if (!seededUsers.has(request.params.user_id)) {
      response.status(404).json({ error: "CONFIG_NOT_FOUND" });
      return;
    }

    response.json(randomConfig());
  });

  return app;
}

function randomConfig() {
  const index = Math.floor(Math.random() * loraConfigs.length);
  return loraConfigs[index];
}
