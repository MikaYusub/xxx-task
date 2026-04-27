import os
import uuid

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
