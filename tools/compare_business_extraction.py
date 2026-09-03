from __future__ import annotations

import base64
import json
import shlex
import re
import subprocess
import sys
from pathlib import Path

import httpx

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "/Volumes/外置硬盘/云湃业务数据")
BASE_URL = "http://192.168.110.19:39092/api"
SSH_KEY = "/Users/murkydoubloon45/.ssh/id_ed25519_company"
SSH_TARGET = "wjc@192.168.110.19"
EXTENSIONS = (".xlsx", ".xls", ".csv", ".tsv", ".json", ".md", ".txt", ".docx", ".pdf", ".dwg", ".zip", ".rar", ".et", ".ps1", ".py", ".7z")


def remote_extraction(batch_id: str) -> dict:
    code = (
        "import sqlite3,json;"
        "c=sqlite3.connect('/home/wjc/yunpai-langgraph/current/runtime/yunpai-business-catalog.sqlite');"
        "r=c.execute('select metadata_json from source_files where batch_id=? order by filename',("
        + repr(batch_id)
        + ",)).fetchall();"
        "print(json.dumps([json.loads(x[0]).get('extraction',{}) for x in r],ensure_ascii=False))"
    )
    result = subprocess.run(
        ["ssh", "-i", SSH_KEY, "-o", "StrictHostKeyChecking=no", SSH_TARGET, f"python3 -c {shlex.quote(code)}"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def kind_for(path: Path) -> str:
    text = str(path).lower()
    if any(token in text for token in ("bom", "物料清单")):
        return "bom"
    if any(token in text for token in ("sop", "工艺", "作业指导")):
        return "sop"
    if any(token in text for token in ("库存", "入库", "出库")):
        return "inventory"
    if any(token in text for token in ("订单", "备货", "po-20", "cg20")):
        return "order"
    return "document"


def summarize(extraction: dict) -> dict:
    summary = {key: extraction.get(key) for key in ("sheet_count", "bom_line_count", "delimiter", "row_count_estimate", "top_level_type", "record_count", "page_count", "paragraph_count", "text_chars_sample") if key in extraction}
    if "sheets" in extraction:
        summary["sheets"] = [(sheet.get("name"), sheet.get("bom_line_count"), sheet.get("nonempty_row_count")) for sheet in extraction["sheets"]]
    if "rows" in extraction:
        summary["row_count"] = len(extraction["rows"])
    if "sample_rows" in extraction:
        summary["sample_row_count"] = len(extraction["sample_rows"])
    return summary


def normalize_extraction(value):
    if isinstance(value, dict):
        return {key: normalize_extraction(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize_extraction(item) for item in value]
    if isinstance(value, str) and (match := re.match(r"^[0-9a-f]{16}-\d{3}-(.+)$", value)):
        return match.group(1)
    return value


def main() -> None:
    files_by_ext: dict[str, list[Path]] = {ext: [] for ext in EXTENSIONS}
    for path in ROOT.rglob("*"):
        if path.is_file() and not path.name.startswith(("._", "~$")) and path.suffix.lower() in files_by_ext:
            files_by_ext[path.suffix.lower()].append(path)
    report = {"root": str(ROOT), "types": {}, "remote": BASE_URL}
    with httpx.Client(timeout=240) as client:
        for ext in EXTENSIONS:
            selected = sorted(files_by_ext[ext], key=lambda p: (p.stat().st_size, str(p)))[:3]
            entry = {"available": len(files_by_ext[ext]), "selected": [str(p) for p in selected], "status": "insufficient_samples"}
            if len(selected) < 3:
                report["types"][ext] = entry
                continue
            local = []
            documents = []
            for path in selected:
                from yunpai_langgraph.business_catalog import extract_file

                local_result = extract_file(path, root=path.parent, parse_xlsx=True, deep_limit_bytes=12_000_000)
                local.append(local_result["extraction"])
                documents.append({
                    "filename": path.name,
                    "content_type": "application/octet-stream",
                    "content_b64": base64.b64encode(path.read_bytes()).decode("ascii"),
                    "kind": kind_for(path),
                })
            request = {"message": f"提取并保留这三份{ext}文件的全部内容和字段证据", "business_data_mode": "upload", "documents": documents}
            response = client.post(BASE_URL + "/runs", json={"request": request, "tenant_id": f"extract-compare-{ext[1:]}-20260903"})
            response.raise_for_status()
            payload = response.json()
            batch = payload["current_result"]["batch"]
            remote = remote_extraction(batch["batch_id"])
            local = sorted((normalize_extraction(item) for item in local), key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True, default=str))
            remote = sorted((normalize_extraction(item) for item in remote), key=lambda item: json.dumps(item, ensure_ascii=False, sort_keys=True, default=str))
            equal = local == remote
            entry.update({
                "status": "pass" if equal and batch["error_count"] == 0 else "mismatch",
                "batch_id": batch["batch_id"],
                "run_id": payload["run_id"],
                "error_count": batch["error_count"],
                "local_summary": [summarize(item) for item in local],
                "remote_summary": [summarize(item) for item in remote],
                "exact_equal": equal,
            })
            report["types"][ext] = entry
            print(ext, entry["status"], "batch", batch["batch_id"], "equal", equal, flush=True)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
