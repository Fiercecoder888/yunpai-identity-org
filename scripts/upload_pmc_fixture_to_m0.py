#!/usr/bin/env python
"""把 PMC-W-H128 合成测试数据包转成 M0 canonical 实体并上传。

用法:
    .venv/bin/python scripts/upload_pmc_fixture_to_m0.py <fixture.json> \
        [--db runtime/yunpai-m0.sqlite] [--tenant tenant-main]

将 fixture 的 Machine/Station/Worker/WorkerQualification/Tooling/WorkerCalendar
映射为 M0 的 equipment_master/station_master/worker_master/tooling_master/
production_calendar 实体，并附带 Order，ingest + publish 后 list_entities 回读。

注意：本数据包为 test_only 合成数据（fixture_metadata.promotion_to_production_allowed=false），
所有资源实体统一保留 value_origin=synthetic_fixture 与 production_use_allowed=false，
仅用于「系统链路验收」，不得作为真实生产事实。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from yunpai_langgraph.m0_backend import M0Store  # noqa: E402

FACTORY_CALENDAR = "CAL-BB-DAY-TEST"


def _status(value: object) -> str:
    text = str(value or "").lower()
    if "maintenance" in text or "down" in text or "inactive" in text:
        return "maintenance"
    return "available"


def _rows(fixture: dict, name: str) -> list[dict]:
    sheets = fixture.get("sheets", {})
    value = sheets.get(name)
    return value if isinstance(value, list) else []


def build_records(fixture: dict) -> list[dict]:
    rate_by_machine: dict[str, float] = {}
    for ps in _rows(fixture, "ProcessingStandard"):
        mid = ps.get("machine_id")
        rate = ps.get("standard_rate")
        if mid and isinstance(rate, (int, float)) and float(rate) > 0:
            rate_by_machine[mid] = max(rate_by_machine.get(mid, 0.0), float(rate))

    quals_by_worker: dict[str, list[dict]] = {}
    for q in _rows(fixture, "WorkerQualification"):
        wid = q.get("worker_id")
        if wid:
            quals_by_worker.setdefault(wid, []).append(q)

    records: list[dict] = []

    for m in _rows(fixture, "Machine"):
        mid = str(m.get("machine_id") or "")
        if not mid:
            continue
        equipment_name = str(m.get("equipment_name") or "machine")
        records.append({
            "filename": "Machine.xlsx", "entity_type": "equipment_master",
            "equipment_code": mid,
            "equipment_type": equipment_name,
            "capability_codes": [equipment_name],
            "capacity_per_hour": str(int(rate_by_machine.get(mid, 100.0))),
            "efficiency_factor": "1.0",
            "status": _status(m.get("available_status")),
            "calendar_ref": FACTORY_CALENDAR,
            "value_origin": "synthetic_fixture",
            "production_use_allowed": False,
        })

    for s in _rows(fixture, "Station"):
        sid = str(s.get("station_id") or "")
        if not sid:
            continue
        records.append({
            "filename": "Station.xlsx", "entity_type": "station_master",
            "station_code": sid,
            "work_center_code": str(s.get("line_id") or sid),
            "parallel_slots": int(s.get("machine_capacity") or 1),
            "status": _status(s.get("active_status")),
            "calendar_ref": FACTORY_CALENDAR,
            "value_origin": "synthetic_fixture",
            "production_use_allowed": False,
        })

    for w in _rows(fixture, "Worker"):
        wid = str(w.get("worker_id") or "")
        if not wid:
            continue
        quals = quals_by_worker.get(wid, [])
        records.append({
            "filename": "Worker.xlsx", "entity_type": "worker_master",
            "person_code": wid,
            "skill_codes": sorted({str(q.get("qualification_level")) for q in quals if q.get("qualification_level")}),
            "qualified_operation_codes": sorted({str(q.get("operation_id")) for q in quals if q.get("operation_id")}),
            "max_parallel_tasks": 1,
            "status": _status(w.get("employment_status")),
            "calendar_ref": FACTORY_CALENDAR,
            "value_origin": "synthetic_fixture",
            "production_use_allowed": False,
        })

    for t in _rows(fixture, "Tooling"):
        tid = str(t.get("tooling_id") or "")
        if not tid:
            continue
        records.append({
            "filename": "Tooling.xlsx", "entity_type": "tooling_master",
            "tooling_code": tid,
            "tooling_type": str(t.get("tooling_type") or "fixture"),
            "capability_codes": [str(t.get("tooling_type") or "fixture")],
            "compatible_product_codes": [str(t["compatible_product_id"])] if t.get("compatible_product_id") else [],
            "quantity_available": 1,
            "status": _status(t.get("available_status")),
            "calendar_ref": FACTORY_CALENDAR,
            "value_origin": str(t.get("value_origin") or "synthetic_fixture"),
            "production_use_allowed": False,
        })

    wc_rows = _rows(fixture, "WorkerCalendar")
    if wc_rows:
        first = wc_rows[0]
        start_day = str(first.get("effective_from") or "2026-07-03")
        intervals = []
        from datetime import datetime as _dt, timedelta as _td
        cur = _dt.strptime(start_day, "%Y-%m-%d")
        end = cur + _td(days=29)  # 30 天窗口，保证 34 工序 × 800 PCS 的排程容量
        # 生成多天班次（effective_from..effective_to，含两端），保证足够排程窗口
        while cur <= end:
            d = cur.strftime("%Y-%m-%d")
            if first.get("shift_start_1") and first.get("shift_end_1"):
                intervals.append({"calendar_ref": FACTORY_CALENDAR, "shift_code": "DAY",
                                  "start_at": f"{d}T{first['shift_start_1']}:00+08:00",
                                  "end_at": f"{d}T{first['shift_end_1']}:00+08:00"})
            if first.get("shift_start_2") and first.get("shift_end_2"):
                intervals.append({"calendar_ref": FACTORY_CALENDAR, "shift_code": "DAY2",
                                  "start_at": f"{d}T{first['shift_start_2']}:00+08:00",
                                  "end_at": f"{d}T{first['shift_end_2']}:00+08:00"})
            cur += _td(days=1)
        records.append({
            "filename": "WorkerCalendar.xlsx", "entity_type": "production_calendar",
            "calendar_ref": FACTORY_CALENDAR,
            "working_intervals": intervals,
            "unavailability": [],
            "value_origin": "synthetic_fixture",
            "production_use_allowed": False,
        })

    for o in _rows(fixture, "Order"):
        records.append({
            "filename": "Order.xlsx", "entity_type": "order",
            "order_id": str(o.get("customer_order_id") or ""),
            "product_code": str(o.get("customer_part_no") or ""),
            "product_name": str(o.get("product_name") or ""),
            "quantity": o.get("quantity"),
            "due_date": str(o.get("due_date") or ""),
            "value_origin": str(o.get("value_origin") or "source_fact"),
            "production_use_allowed": False,
        })

    return records


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("fixture", help="fixture JSON 路径")
    ap.add_argument("--db", default="runtime/yunpai-m0.sqlite")
    ap.add_argument("--tenant", default="tenant-main")
    args = ap.parse_args()

    fixture = json.load(open(args.fixture, encoding="utf-8"))
    meta = fixture.get("fixture_metadata", {})
    if not meta.get("promotion_to_production_allowed", True):
        print("fixture: promotion_to_production_allowed=false (test_only)，按系统链路验收口径上传")

    records = build_records(fixture)
    store = M0Store(args.db)
    batch = store.ingest(records, tenant_id=args.tenant, task_id="pmc-fixture-upload")
    result = store.publish(
        batch["batch_id"], actor="operator",
        reason="合成测试数据包经人工审批（system-chain-acceptance, test_only）",
    )
    print(f"batch={batch['batch_id']} status={result.get('status')} published={result.get('approved_candidates')}")
    for et in ("equipment_master", "station_master", "worker_master", "tooling_master", "production_calendar", "order"):
        r = store.list_entities(et, tenant_id=args.tenant)
        print(f"  {et}: {r['count']}")


if __name__ == "__main__":
    main()
