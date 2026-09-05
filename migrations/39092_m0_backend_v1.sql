-- 39092 专用 M0 PostgreSQL schema；不与 39085/MinerU 共用。
CREATE SCHEMA IF NOT EXISTS yunpai_39092_m0;
SET search_path TO yunpai_39092_m0;

CREATE TABLE IF NOT EXISTS import_batches (
  batch_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, task_id TEXT NOT NULL,
  status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_documents (
  document_id UUID PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),
  filename TEXT NOT NULL, sha256 TEXT NOT NULL, content_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS import_candidates (
  candidate_id UUID PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),
  document_id UUID NOT NULL REFERENCES source_documents(document_id),
  entity_type TEXT NOT NULL, candidate_json JSONB NOT NULL, status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS approval_records (
  approval_id UUID PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),
  candidate_id UUID, actor TEXT NOT NULL, decision TEXT NOT NULL,
  approval_mode TEXT NOT NULL, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS canonical_entities (
  entity_id UUID PRIMARY KEY, tenant_id TEXT NOT NULL, entity_type TEXT NOT NULL,
  canonical_key TEXT NOT NULL, current_version INTEGER NOT NULL,
  lifecycle_status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, entity_type, canonical_key)
);
CREATE TABLE IF NOT EXISTS canonical_entity_versions (
  entity_id UUID NOT NULL REFERENCES canonical_entities(entity_id), version INTEGER NOT NULL,
  payload_json JSONB NOT NULL, checksum TEXT NOT NULL, source_batch_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(entity_id, version)
);
CREATE TABLE IF NOT EXISTS canonical_ledger (
  ledger_id UUID PRIMARY KEY, batch_id TEXT NOT NULL, entity_id UUID NOT NULL,
  version INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL,
  approval_mode TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS canonical_outbox (
  outbox_id UUID PRIMARY KEY, ledger_id UUID NOT NULL, event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
