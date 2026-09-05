"""39092 专用 M0 Data Backend。

该服务只承载 39092 的上传候选、人工审批、canonical 版本、ledger 和 outbox。
本地默认使用 SQLite 进行可回滚开发；部署到 PostgreSQL 时执行
``migrations/39092_m0_backend_v1.sql``，并把 ``YUNPAI_M0_DB`` 指向专用连接。
它不读取或迁移 39085/MinerU 数据。
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


SCHEMA = """
CREATE TABLE IF NOT EXISTS import_batches (
  batch_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, task_id TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_documents (
  document_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, filename TEXT NOT NULL,
  sha256 TEXT NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(batch_id) REFERENCES import_batches(batch_id)
);
CREATE TABLE IF NOT EXISTS import_candidates (
  candidate_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, document_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, candidate_json TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, FOREIGN KEY(batch_id) REFERENCES import_batches(batch_id)
);
CREATE TABLE IF NOT EXISTS approval_records (
  approval_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, candidate_id TEXT,
  actor TEXT NOT NULL, decision TEXT NOT NULL, approval_mode TEXT NOT NULL,
  reason TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS canonical_entities (
  entity_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  canonical_key TEXT NOT NULL, current_version INTEGER NOT NULL,
  lifecycle_status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, entity_type, canonical_key)
);
CREATE TABLE IF NOT EXISTS canonical_entity_versions (
  entity_id TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL, source_batch_id TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(entity_id, version), FOREIGN KEY(entity_id) REFERENCES canonical_entities(entity_id)
);
CREATE TABLE IF NOT EXISTS canonical_ledger (
  ledger_id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, entity_id TEXT NOT NULL,
  version INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
  approval_mode TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS canonical_outbox (
  outbox_id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL, event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
"""


class M0Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._init()

    def _connect(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init(self):
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    def ingest(self, records: list[dict[str, Any]], *, tenant_id: str, task_id: str) -> dict[str, Any]:
        batch_id = uuid4().hex[:16]
        now = _now()
        with self._connect() as conn:
            conn.execute("INSERT INTO import_batches VALUES (?, ?, ?, ?, ?, ?)",
                         (batch_id, tenant_id, task_id, "awaiting_review", now, now))
            for item in records:
                filename = str(item.get("filename") or "document.json")
                payload = item.get("records", item)
                raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
                document_id = uuid4().hex
                sha256 = hashlib.sha256(raw.encode()).hexdigest()
                candidate_id = uuid4().hex
                conn.execute("INSERT INTO source_documents VALUES (?, ?, ?, ?, ?, ?)",
                             (document_id, batch_id, filename, sha256, raw, now))
                conn.execute("INSERT INTO import_candidates VALUES (?, ?, ?, ?, ?, ?, ?)",
                             (candidate_id, batch_id, document_id, str(item.get("entity_type") or "order"),
                              json.dumps(item, ensure_ascii=False), "candidate", now))
        return {"batch_id": batch_id, "status": "awaiting_review", "candidate_count": len(records)}

    def publish(self, batch_id: str, *, actor: str, reason: str = "", human_override: bool = False) -> dict[str, Any]:
        with self._connect() as conn:
            batch = conn.execute("SELECT * FROM import_batches WHERE batch_id=?", (batch_id,)).fetchone()
            if batch is None:
                return {"status": "not_found", "batch_id": batch_id}
            candidates = conn.execute("SELECT * FROM import_candidates WHERE batch_id=?", (batch_id,)).fetchall()
            published = 0
            for candidate in candidates:
                data = json.loads(candidate["candidate_json"])
                key = str(data.get("canonical_key") or data.get("product_code") or data.get("order_id") or candidate["candidate_id"])
                entity_type = candidate["entity_type"]
                entity = conn.execute(
                    "SELECT * FROM canonical_entities WHERE tenant_id=? AND entity_type=? AND canonical_key=?",
                    (batch["tenant_id"], entity_type, key),
                ).fetchone()
                entity_id = entity["entity_id"] if entity else uuid4().hex
                version = int(entity["current_version"]) + 1 if entity else 1
                checksum = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                if entity:
                    conn.execute("UPDATE canonical_entities SET current_version=?, updated_at=? WHERE entity_id=?",
                                 (version, _now(), entity_id))
                else:
                    conn.execute("INSERT INTO canonical_entities VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                                 (entity_id, batch["tenant_id"], entity_type, key, version, "active", _now(), _now()))
                conn.execute("INSERT INTO canonical_entity_versions VALUES (?, ?, ?, ?, ?, ?)",
                             (entity_id, version, json.dumps(data, ensure_ascii=False), checksum, batch_id, _now()))
                approval_id = uuid4().hex
                mode = "human_override" if human_override else "standard"
                conn.execute("INSERT INTO approval_records VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                             (approval_id, batch_id, candidate["candidate_id"], actor, "approve", mode, reason, _now()))
                ledger_id = uuid4().hex
                conn.execute("INSERT INTO canonical_ledger VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                             (ledger_id, batch_id, entity_id, version, "publish", actor, mode, _now()))
                conn.execute("INSERT INTO canonical_outbox VALUES (?, ?, ?, ?, ?, ?)",
                             (uuid4().hex, ledger_id, "canonical.entity.published",
                              json.dumps({"entity_id": entity_id, "version": version}, ensure_ascii=False),
                              "pending", _now()))
                conn.execute("UPDATE import_candidates SET status='published' WHERE candidate_id=?",
                             (candidate["candidate_id"],))
                published += 1
            conn.execute("UPDATE import_batches SET status='published', updated_at=? WHERE batch_id=?", (_now(), batch_id))
        return self.readback(batch_id) | {"status": "published", "published": published}

    def readback(self, batch_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            entities = conn.execute(
                "SELECT e.entity_id,e.entity_type,e.canonical_key,v.version,v.payload_json,v.checksum "
                "FROM canonical_entities e JOIN canonical_entity_versions v "
                "ON v.entity_id=e.entity_id AND v.version=e.current_version "
                "JOIN canonical_ledger l ON l.entity_id=e.entity_id AND l.version=v.version "
                "WHERE l.batch_id=?", (batch_id,)).fetchall()
            ledger = conn.execute("SELECT COUNT(*) AS n FROM canonical_ledger WHERE batch_id=?", (batch_id,)).fetchone()["n"]
            outbox = conn.execute(
                "SELECT COUNT(*) AS n FROM canonical_outbox WHERE ledger_id IN "
                "(SELECT ledger_id FROM canonical_ledger WHERE batch_id=?)", (batch_id,)).fetchone()["n"]
        return {
            "batch_id": batch_id,
            "canonical_readback_available": True,
            "approved_candidates": len(entities),
            "ledger_count": int(ledger),
            "outbox_count": int(outbox),
            "entities": [dict(row) for row in entities],
        }


def create_app():
    from fastapi import FastAPI, Header

    app = FastAPI(title="Yunpai 39092 M0 Data Backend", version="1.0.0")
    store = M0Store(os.getenv("YUNPAI_M0_DB", "runtime/yunpai-39092-m0.sqlite"))

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "yunpai-39092-m0", "database": store.path}

    @app.post("/api/m0/catalog/ingest/validate")
    async def validate(body: dict[str, Any]):
        records = body.get("records") if isinstance(body.get("records"), list) else []
        return {"publishable": bool(records), "candidate_count": len(records)}

    @app.post("/api/m0/catalog/ingest/publish")
    async def publish(body: dict[str, Any], x_yunpai_principal: str | None = Header(None)):
        records = body.get("records") if isinstance(body.get("records"), list) else []
        approval = body.get("approval") if isinstance(body.get("approval"), dict) else {}
        result = store.ingest(records, tenant_id="default", task_id=str(body.get("task_id") or "39092"))
        return {"data": store.publish(
            result["batch_id"],
            actor=str(approval.get("approved_by") or x_yunpai_principal or "operator"),
            reason=str(approval.get("reason") or ""),
            human_override=str(approval.get("mode")) == "human_override",
        )}

    @app.get("/api/m0/catalog/readback/{batch_id}")
    async def readback(batch_id: str):
        return {"data": store.readback(batch_id)}

    return app
