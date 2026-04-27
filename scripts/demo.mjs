import assert from "node:assert";
import { spawnSync } from "node:child_process";

const prompt = process.argv.slice(2).join(" ").trim();
assert(prompt, "Prompt is required");

const result = spawnSync(
  "docker",
  [
    "compose",
    "run",
    "--rm",
    "publisher",
    "sh",
    "-c",
    `npm install && npm run publisher -- ${JSON.stringify(prompt)}`,
  ],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
