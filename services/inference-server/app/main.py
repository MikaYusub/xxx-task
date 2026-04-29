from __future__ import annotations

import base64
import hashlib
import os
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from fastapi import Body, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import firestore
from PIL import Image, ImageDraw
from pydantic import BaseModel, ConfigDict

api_key = os.environ["API_KEY"]
project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", "demo-local")
output_dir = Path(os.environ.get("OUTPUT_DIR", "outputs"))
lora_cache_dir = Path(os.environ.get("LORA_CACHE_DIR", "cache/lora"))
inference_mode = os.environ.get("INFERENCE_MODE", "fake")
runtime_mode = inference_mode
lease_seconds = int(os.environ.get("LEASE_SECONDS", "1800"))
processing_owner = os.environ.get("PROCESSING_OWNER", f"inference-{uuid.uuid4()}")

output_dir.mkdir(parents=True, exist_ok=True)
lora_cache_dir.mkdir(parents=True, exist_ok=True)

db = firestore.Client(project=project_id)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if inference_mode == "real":
        from diffusers import DiffusionPipeline, LCMScheduler

        get_pipe(DiffusionPipeline, LCMScheduler)

    yield


app = FastAPI(title="Codeway Inference Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4173"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class NoLoraGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc_id: str
    prompt: str


class LoraGenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc_id: str
    prompt: str
    lora_url: str
    lora_weight: float


class ModeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str


GenerateRequest = NoLoraGenerateRequest | LoraGenerateRequest


@app.get("/healthz")
def healthz():
    return {"ok": True, "mode": runtime_mode}


@app.get("/v1/local/mode")
def get_mode():
    require_local_endpoints()
    return {"mode": runtime_mode}


@app.post("/v1/local/mode")
def set_mode(request: ModeRequest):
    global runtime_mode

    require_local_endpoints()

    if request.mode not in ["fake", "real"]:
        raise HTTPException(status_code=422, detail="mode must be fake or real")

    if request.mode == "real":
        from diffusers import DiffusionPipeline, LCMScheduler

        get_pipe(DiffusionPipeline, LCMScheduler)

    runtime_mode = request.mode
    return {"mode": runtime_mode}


@app.post("/generate")
def generate(request: GenerateRequest = Body(), authorization: str = Header("")):
    require_auth(authorization)
    validate_request(request)

    claim = claim_job(request.doc_id)

    if claim == "done":
        return {"image": encode_output(request.doc_id)}

    if claim == "in_progress":
        raise HTTPException(status_code=409, detail="Job is already processing")

    try:
        image_path = output_path(request.doc_id)
        tmp_path = image_path.with_suffix(".tmp.png")

        if runtime_mode == "fake":
            write_fake_image(request, tmp_path)
        elif runtime_mode == "real":
            write_real_image(request, tmp_path)
        else:
            raise RuntimeError(f"Unknown inference mode={runtime_mode}")

        os.replace(tmp_path, image_path)
        complete_job(request.doc_id, str(image_path))

        return {"image": encode_output(request.doc_id)}
    except Exception as error:
        fail_job(request.doc_id, "GENERATION_FAILED", str(error))
        raise HTTPException(status_code=500, detail=str(error)) from error


def require_auth(authorization: str):
    if authorization != f"Bearer {api_key}":
        raise HTTPException(status_code=401, detail="Unauthorized")


def require_local_endpoints():
    if os.environ.get("ENABLE_LOCAL_ENDPOINTS") != "true":
        raise HTTPException(status_code=404, detail="Not found")


def validate_request(request: GenerateRequest):
    if not request.doc_id:
        raise HTTPException(status_code=422, detail="doc_id is required")

    if not request.prompt or len(request.prompt) > 1000:
        raise HTTPException(status_code=422, detail="prompt must be 1-1000 characters")

    if not has_lora(request):
        return

    parsed = urlparse(request.lora_url)

    if parsed.hostname != "huggingface.co":
        raise HTTPException(status_code=422, detail="lora_url host is not trusted")

    if request.lora_weight < 0 or request.lora_weight > 1:
        raise HTTPException(status_code=422, detail="lora_weight must be 0.0-1.0")


def has_lora(request: GenerateRequest):
    return isinstance(request, LoraGenerateRequest)


def claim_job(doc_id: str):
    doc_ref = db.collection("generation_requests").document(doc_id)
    transaction = db.transaction()

    @firestore.transactional
    def claim(transaction):
        snapshot = doc_ref.get(transaction=transaction)
        data = snapshot.to_dict()

        if data is None:
            raise HTTPException(status_code=404, detail="Job document not found")

        if data["status"] == "DONE" and output_path(doc_id).exists():
            return "done"

        if data["status"] == "PROCESSING" and lease_is_valid(data.get("lease_expires_at")):
            return "in_progress"

        if data["status"] not in ["QUEUED", "PROCESSING"]:
            raise HTTPException(status_code=409, detail=f"Job is {data['status']}")

        attempt_count = int(data.get("attempt_count", 0)) + 1
        transaction.update(
            doc_ref,
            {
                "status": "PROCESSING",
                "processing_owner": processing_owner,
                "lease_expires_at": datetime.now(timezone.utc)
                + timedelta(seconds=lease_seconds),
                "started_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP,
                "attempt_count": attempt_count,
            },
        )
        return "claimed"

    return claim(transaction)


def complete_job(doc_id: str, path: str):
    doc_ref = db.collection("generation_requests").document(doc_id)
    transaction = db.transaction()

    @firestore.transactional
    def complete(transaction):
        snapshot = doc_ref.get(transaction=transaction)
        data = snapshot.to_dict()

        if data is None:
            raise RuntimeError("Job document not found")

        if data["status"] == "DONE":
            return

        if data["processing_owner"] != processing_owner:
            raise RuntimeError("Processing lease was lost")

        transaction.update(
            doc_ref,
            {
                "status": "DONE",
                "output_path": path,
                "finished_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
        )

    complete(transaction)


def fail_job(doc_id: str, error_code: str, error_message: str):
    doc_ref = db.collection("generation_requests").document(doc_id)
    transaction = db.transaction()

    @firestore.transactional
    def fail(transaction):
        snapshot = doc_ref.get(transaction=transaction)
        data = snapshot.to_dict()

        if data is None or data["status"] == "DONE":
            return

        if not can_fail_job(data):
            return

        transaction.update(
            doc_ref,
            {
                "status": "FAILED",
                "error_code": error_code,
                "error_message": error_message[:1000],
                "finished_at": firestore.SERVER_TIMESTAMP,
                "updated_at": firestore.SERVER_TIMESTAMP,
            },
        )

    fail(transaction)


def can_fail_job(data):
    return data["status"] == "PROCESSING" and data["processing_owner"] == processing_owner


def lease_is_valid(value):
    return isinstance(value, datetime) and value > datetime.now(timezone.utc)


def output_path(doc_id: str):
    return output_dir / f"{doc_id}.png"


def encode_output(doc_id: str):
    return base64.b64encode(output_path(doc_id).read_bytes()).decode("ascii")


def write_fake_image(request: GenerateRequest, path: Path):
    digest = hashlib.sha256(request.doc_id.encode("utf-8")).digest()
    color = (digest[0], digest[1], digest[2])
    image = Image.new("RGB", (512, 512), color)
    draw = ImageDraw.Draw(image)
    draw.text((24, 24), request.prompt[:80], fill=(255, 255, 255))
    image.save(path, format="PNG")


def write_real_image(request: GenerateRequest, path: Path):
    from diffusers import DiffusionPipeline, LCMScheduler

    pipe = get_pipe(DiffusionPipeline, LCMScheduler)
    unload_lora(pipe)

    try:
        if has_lora(request):
            lora_path = download_lora(request.lora_url)
            pipe.load_lora_weights(str(lora_path), adapter_name="style")
            if hasattr(pipe, "set_adapters"):
                pipe.set_adapters(["style"], adapter_weights=[request.lora_weight])

        image = pipe(
            request.prompt,
            num_inference_steps=4,
            guidance_scale=8.0,
        ).images[0]
        image.save(path, format="PNG")
    finally:
        unload_lora(pipe)


def unload_lora(pipe):
    if hasattr(pipe, "unload_lora_weights"):
        pipe.unload_lora_weights()


pipe_cache = None


def get_pipe(diffusion_pipeline, lcm_scheduler):
    global pipe_cache

    if pipe_cache is None:
        pipe = diffusion_pipeline.from_pretrained("SimianLuo/LCM_Dreamshaper_v7")
        pipe.scheduler = lcm_scheduler.from_config(pipe.scheduler.config)
        pipe_cache = pipe

    return pipe_cache


def download_lora(url: str):
    parsed = urlparse(url)

    if parsed.hostname != "huggingface.co":
        raise RuntimeError("LoRA host is not trusted")

    filename = hashlib.sha256(url.encode("utf-8")).hexdigest() + ".safetensors"
    path = lora_cache_dir / filename

    if path.exists():
        return path

    tmp_path = lora_cache_dir / f"{filename}.{uuid.uuid4()}.tmp"

    try:
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        tmp_path.write_bytes(response.content)
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    return path
