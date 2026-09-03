from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


@lru_cache(maxsize=8)
def load_workflow(workflow_id: str = "m0_m5") -> dict[str, Any]:
    path = Path(__file__).with_name("workflows") / f"{workflow_id}.json"
    if not path.exists():
        raise KeyError(f"unknown workflow: {workflow_id}")
    workflow = json.loads(path.read_text(encoding="utf-8"))
    seen: set[str] = set()
    for step in workflow.get("steps", []):
        if step["id"] in seen:
            raise ValueError(f"duplicate workflow step: {step['id']}")
        missing = set(step.get("depends_on", [])) - seen
        if missing:
            raise ValueError(f"step {step['id']} has unresolved dependencies: {sorted(missing)}")
        seen.add(step["id"])
    return workflow
