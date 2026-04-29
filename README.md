# Codeway Barcelona Backend Case

Local backend platform for AI image generation requests.

This repository contains the four required case components:

- Publisher Client: anonymous Firebase Auth + Firestore write.
- Cloud Function: Firebase Functions v2 trigger on `generation_requests/{document_id}`.
- Inference Server: Python + FastAPI image generation API.
- Config Service: TypeScript REST API for per-user LoRA config.

Firestore is the source of truth for request state. Local generated images are saved to
`outputs/{doc_id}.png`.

## Quick Start

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Start local services:

```bash
docker compose up --build
```

The default Docker path uses fake deterministic inference so reviewers can verify the pipeline
quickly. Generated PNGs are still written to `outputs/{doc_id}.png`.

3. In another shell, create a request:

```bash
npm install
npm run demo -- "a forest cabin in winter, oil painting style"
```

The demo command runs the Publisher inside Docker, signs in anonymously, writes the Firestore
request, and prints the anonymous user id plus Firestore document id.

To exercise the LoRA path with local Node 20, seed the anonymous UID before the Publisher writes
the request:

```bash
npm run publisher -- --seed-config "a forest cabin in winter, oil painting style"
```

The Publisher prints the anonymous user id and Firestore document id. Use the Firebase
Emulator UI at `http://127.0.0.1:4000/firestore` to inspect request status. Generated PNGs are
written to `outputs/{doc_id}.png`.

## Model

The fast Docker path runs fake inference by default. To run the required CPU diffusion model:

```bash
docker compose -f docker-compose.yml -f docker-compose.real.yml up --build
```

The real path installs `services/inference-server/requirements-real.txt`, including the CPU PyTorch
wheel, and runs `SimianLuo/LCM_Dreamshaper_v7` with `LCMScheduler`, `steps=4`, and
`guidance_scale=8.0`. The first startup downloads the model into `cache/huggingface` and can take
several minutes on CPU. The real requirements also install PEFT because Diffusers needs it to load
LoRA adapters.

## Local Ports

- Firebase Emulator UI: `http://127.0.0.1:4000`
- Firestore emulator: `127.0.0.1:8080`
- Auth emulator: `127.0.0.1:9099`
- Functions emulator: `127.0.0.1:5001`
- Pub/Sub emulator: `127.0.0.1:8085`
- Config Service: `http://127.0.0.1:3000`
- Inference Server: `http://127.0.0.1:8000`

## Environment

Required values are shown in `.env.example`.

`INFERENCE_MODE=fake` is the default for fast local verification. The real Docker override sets
`INFERENCE_MODE=real`.

## Publisher Client

The Publisher uses anonymous Firebase Auth and writes exactly this client-owned shape:

```json
{
  "user_id": "uid-of-authenticated-user",
  "prompt": "a forest cabin in winter, oil painting style",
  "status": "CREATED"
}
```

Run:

```bash
npm run publisher -- "an astronaut riding a horse, oil painting"
```

Docker-only demo:

```bash
npm run demo -- "an astronaut riding a horse, oil painting"
```

Add `--seed-config` before the prompt to make the local Config Service return a LoRA for that
anonymous user.

## Config Service API

### Get user config

```http
GET /v1/config/{user_id}
```

`200`:

```json
{
  "lora_url": "https://huggingface.co/vislupus/SD1.5-LoRA-Your-Name-Style/resolve/main/yn_style_v1-000039.safetensors",
  "lora_weight": 0.8,
  "updated_at": "2026-02-03T10:00:00Z"
}
```

`404` means the user has no config and generation continues without LoRA.

### Local seed helper

```http
POST /v1/local/users/{user_id}
```

Adds an anonymous local test user to the Config allowlist.

## Inference API

### Generate

```http
POST /generate
Authorization: Bearer your-secret-key-here
Content-Type: application/json
```

```json
{
  "doc_id": "firestore-document-id",
  "prompt": "a forest cabin in winter, oil painting style",
  "lora_url": "https://huggingface.co/org/model/resolve/main/adapter.safetensors",
  "lora_weight": 0.8
}
```

Omit both `lora_url` and `lora_weight` for no-LoRA generation. Supplying only one LoRA field is
rejected.

`200`:

```json
{
  "image": "<base64-encoded-PNG>"
}
```

## Checks

Use Node 20 or the Docker workflow for JavaScript checks.

```bash
npm run build
npm test
```

`npm test` runs workspace tests and Firestore security-rules tests through the Firestore emulator.

Python checks use Python 3.11, matching the inference Docker image:

```bash
cd services/inference-server
py -3.11 -m pip install -r requirements.txt
py -3.11 -m pytest
```

The Python suite includes an emulator-backed test for `QUEUED -> PROCESSING -> DONE`, output file
creation, and duplicate `/generate` returning the existing result. Start the Firestore emulator first
to exercise that path; otherwise run the full Docker stack.

## Documentation

- `README.md`: local setup and API documentation.
- `DESIGN.md`: architecture, trade-offs, scaling, retries, stuck-job recovery, and production deployment notes.
