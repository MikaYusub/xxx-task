import os
import sys
import types
import uuid
from pathlib import Path

os.environ["API_KEY"] = "test-key"
os.environ["FIRESTORE_EMULATOR_HOST"] = "127.0.0.1:8080"
os.environ["GOOGLE_CLOUD_PROJECT"] = "demo-local"
os.environ["INFERENCE_MODE"] = "fake"

import pytest
from fastapi.testclient import TestClient

from app import main


def make_client(tmp_path, monkeypatch, claim="claimed"):
    completed = {}
    failed = {}

    monkeypatch.setattr(main, "output_dir", tmp_path)
    monkeypatch.setattr(main, "claim_job", lambda _doc_id: claim)
    monkeypatch.setattr(
        main,
        "complete_job",
        lambda doc_id, output_path: completed.update({"doc_id": doc_id, "output_path": output_path}),
    )
    monkeypatch.setattr(
        main,
        "fail_job",
        lambda doc_id, error_code, error_message: failed.update(
            {"doc_id": doc_id, "error_code": error_code, "error_message": error_message}
        ),
    )

    return TestClient(main.app), completed, failed


def test_rejects_missing_bearer(tmp_path, monkeypatch):
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.post(
        "/generate",
        json={"doc_id": "doc-1", "prompt": "hello"},
    )

    assert response.status_code == 401


def test_generates_fake_png_and_marks_done(tmp_path, monkeypatch):
    test_client, completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": "doc-1", "prompt": "hello"},
    )

    assert response.status_code == 200
    assert (tmp_path / "doc-1.png").exists()
    assert completed["doc_id"] == "doc-1"
    assert completed["output_path"].endswith("doc-1.png")


def test_duplicate_done_returns_existing_png(tmp_path, monkeypatch):
    (tmp_path / "doc-1.png").write_bytes(b"existing")
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch, claim="done")

    response = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": "doc-1", "prompt": "hello"},
    )

    assert response.status_code == 200
    assert response.json()["image"] == "ZXhpc3Rpbmc="


def test_valid_processing_lease_blocks_duplicate(tmp_path, monkeypatch):
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch, claim="in_progress")

    response = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": "doc-1", "prompt": "hello"},
    )

    assert response.status_code == 409


def test_rejects_lora_url_without_weight(tmp_path, monkeypatch):
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": "doc-1", "prompt": "hello", "lora_url": "https://huggingface.co/x/y"},
    )

    assert response.status_code == 422


def test_rejects_lora_weight_without_url(tmp_path, monkeypatch):
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": "doc-1", "prompt": "hello", "lora_weight": 0.8},
    )

    assert response.status_code == 422


def test_rejects_unknown_generate_fields(tmp_path, monkeypatch):
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": "doc-1", "prompt": "hello", "extra": "nope"},
    )

    assert response.status_code == 422


def test_local_mode_switches_to_fake(tmp_path, monkeypatch):
    monkeypatch.setenv("ENABLE_LOCAL_ENDPOINTS", "true")
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.post("/v1/local/mode", json={"mode": "fake"})

    assert response.status_code == 200
    assert response.json() == {"mode": "fake"}
    assert test_client.get("/v1/local/mode").json() == {"mode": "fake"}


def test_local_mode_rejects_unknown_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("ENABLE_LOCAL_ENDPOINTS", "true")
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.post("/v1/local/mode", json={"mode": "turbo"})

    assert response.status_code == 422


def test_local_mode_is_hidden_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("ENABLE_LOCAL_ENDPOINTS", raising=False)
    test_client, _completed, _failed = make_client(tmp_path, monkeypatch)

    response = test_client.get("/v1/local/mode")

    assert response.status_code == 404


def test_stale_worker_cannot_fail_reclaimed_job():
    assert main.can_fail_job({"status": "PROCESSING", "processing_owner": main.processing_owner})
    assert not main.can_fail_job({"status": "PROCESSING", "processing_owner": "new-owner"})
    assert not main.can_fail_job({"status": "QUEUED", "processing_owner": main.processing_owner})


def test_emulator_queued_to_done_and_duplicate_returns_existing_png(tmp_path, monkeypatch):
    doc_id = f"pytest-{uuid.uuid4()}"
    doc_ref = main.db.collection("generation_requests").document(doc_id)

    try:
        doc_ref.set({"user_id": "user-1", "prompt": "hello", "status": "QUEUED"})
    except Exception as error:
        pytest.skip(f"Firestore emulator is not running: {error}")

    monkeypatch.setattr(main, "output_dir", tmp_path)
    test_client = TestClient(main.app)

    response = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": doc_id, "prompt": "hello"},
    )

    duplicate = test_client.post(
        "/generate",
        headers={"Authorization": "Bearer test-key"},
        json={"doc_id": doc_id, "prompt": "hello"},
    )
    data = doc_ref.get().to_dict()

    assert response.status_code == 200
    assert duplicate.status_code == 200
    assert data["status"] == "DONE"
    assert data["output_path"].endswith(f"{doc_id}.png")
    assert (tmp_path / f"{doc_id}.png").exists()


def test_unloads_lora_when_pipeline_supports_it():
    class Pipe:
        def __init__(self):
            self.unloaded = 0

        def unload_lora_weights(self):
            self.unloaded += 1

    pipe = Pipe()

    main.unload_lora(pipe)

    assert pipe.unloaded == 1


def test_real_pipeline_uses_required_model_and_scheduler(monkeypatch):
    monkeypatch.setattr(main, "pipe_cache", None)

    class Scheduler:
        config = {"name": "old"}

    class Pipe:
        scheduler = Scheduler()
        model_id = ""

        @classmethod
        def from_pretrained(cls, model_id):
            cls.model_id = model_id
            return cls()

    class LcmScheduler:
        @classmethod
        def from_config(cls, config):
            return {"from_config": config}

    pipe = main.get_pipe(Pipe, LcmScheduler)

    assert Pipe.model_id == "SimianLuo/LCM_Dreamshaper_v7"
    assert pipe.scheduler == {"from_config": {"name": "old"}}
    assert main.get_pipe(Pipe, LcmScheduler) is pipe


def test_real_lora_is_loaded_with_named_adapter(tmp_path, monkeypatch):
    calls = []
    request = main.LoraGenerateRequest(
        doc_id="doc-1",
        prompt="hello",
        lora_url="https://huggingface.co/org/model/resolve/main/adapter.safetensors",
        lora_weight=0.8,
    )

    class Pipe:
        def load_lora_weights(self, path, adapter_name):
            calls.append(("load", path, adapter_name))

        def set_adapters(self, names, adapter_weights):
            calls.append(("set", names, adapter_weights))

        def unload_lora_weights(self):
            calls.append(("unload",))

        def __call__(self, prompt, num_inference_steps, guidance_scale):
            calls.append(("run", prompt, num_inference_steps, guidance_scale))
            return type("Result", (), {"images": [Image()]})()

    class Image:
        def save(self, path, format):
            Path(path).write_bytes(b"png")

    monkeypatch.setattr(main, "get_pipe", lambda _diffusion, _scheduler: Pipe())
    monkeypatch.setattr(main, "download_lora", lambda _url: tmp_path / "adapter.safetensors")
    monkeypatch.setitem(
        sys.modules,
        "diffusers",
        types.SimpleNamespace(DiffusionPipeline=object, LCMScheduler=object),
    )

    main.write_real_image(request, tmp_path / "out.png")

    assert ("load", str(tmp_path / "adapter.safetensors"), "style") in calls
    assert ("set", ["style"], [0.8]) in calls
    assert ("run", "hello", 4, 8.0) in calls
