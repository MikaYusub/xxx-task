import assert from "node:assert";
import { spawnSync } from "node:child_process";
import net from "node:net";

const prompt = process.argv.slice(2).join(" ").trim();
assert(prompt, "Prompt is required");

await waitForPort("127.0.0.1", 9099, "Auth emulator");
await waitForPort("127.0.0.1", 8080, "Firestore emulator");
await waitForPort("127.0.0.1", 5001, "Functions emulator");

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

async function waitForPort(host, port, name) {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const connected = await canConnect(host, port);

    if (connected) {
      return;
    }

    await sleep(1_000);
  }

  throw new Error(`${name} did not become ready on ${host}:${port}`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });

    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
