from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from .business_catalog import ingest_tree


SkillHandler = Callable[[dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class SkillSpec:
    name: str
    description: str
    handler: SkillHandler
    tags: tuple[str, ...] = field(default_factory=tuple)


class SkillRegistry:
    """总规划 Agent 可见的高阶能力；Skill 内部可以编排多个工具或数据处理步骤。"""

    def __init__(self) -> None:
        self.specs: dict[str, SkillSpec] = {}

    def register(self, spec: SkillSpec) -> None:
        if spec.name in self.specs:
            raise ValueError(f"duplicate skill: {spec.name}")
        self.specs[spec.name] = spec

    async def call(self, name: str, payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        if name not in self.specs:
            raise KeyError(f"unknown skill: {name}")
        return await self.specs[name].handler(payload, context)

    def catalog(self) -> list[dict[str, Any]]:
        return [{"name": spec.name, "description": spec.description, "tags": list(spec.tags)} for spec in self.specs.values()]


def _safe_name(filename: str) -> str:
    name = Path(filename).name
    return name if name and name not in {".", ".."} else "upload.bin"


async def identify_business_data(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """识别外部资料或上传文件，并写入可审核候选库。"""
    db_path = payload.get("db_path") or "runtime/yunpai-business-catalog.sqlite"
    root_path = payload.get("root_path") or payload.get("business_data_root")
    if root_path:
        result = ingest_tree(root_path, db_path, batch_id=f"batch-{context.get('task_id', 'skill')}")
    else:
        files = payload.get("files") or []
        if not isinstance(files, list) or not files:
            raise ValueError("业务资料 Skill 需要 root_path 或 files")
        staging = Path(payload.get("staging_dir") or "runtime/business-upload-staging") / str(context.get("task_id", "skill"))
        staging.mkdir(parents=True, exist_ok=True)
        for index, item in enumerate(files, start=1):
            if not isinstance(item, dict):
                continue
            encoded = item.get("content_b64")
            if not isinstance(encoded, str):
                continue
            raw = base64.b64decode(encoded, validate=True)
            digest = hashlib.sha256(raw).hexdigest()[:16]
            # Include the upload index so same-name/same-content files do not
            # overwrite one another in the staging batch.
            (staging / f"{digest}-{index:03d}-{_safe_name(str(item.get('filename') or 'upload.bin'))}").write_bytes(raw)
        result = ingest_tree(staging, db_path, batch_id=f"batch-{context.get('task_id', 'skill')}", parse_xlsx=True, deep_limit_bytes=12_000_000)
    return {
        "skill": "business-data-identification",
        "status": "candidate_created",
        "schema_version": "yunpai.business-catalog.v1",
        "batch": result,
        "evidence": [{"module": "orchestrator", "source_ref": result["root_path"], "evidence_ref": f"business-catalog:{result['batch_id']}", "detail": "文件哈希、分类和字段观察已写入候选库"}],
    }


def build_default_skill_registry() -> SkillRegistry:
    registry = SkillRegistry()
    registry.register(SkillSpec(
        name="business-data-identification",
        description="识别云湃业务资料，抽取订单/BOM/工程文档字段，保留文件哈希和字段级证据，并写入可审核候选库。",
        handler=identify_business_data,
        tags=("upload", "m0", "m1", "evidence", "catalog"),
    ))
    return registry
