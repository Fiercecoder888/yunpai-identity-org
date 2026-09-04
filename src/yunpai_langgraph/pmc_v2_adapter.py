"""Bridge the current M5 payload to the frozen WIP PMC v2 scheduler.

The adapter deliberately keeps the v2 snapshot boundary visible in the
result.  Legacy callers can continue using the old baseline scheduler, while
payloads carrying approved standard minutes and explicit calendars/resources
use the constrained engine.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any

from .pmc_v2_scheduler import schedule_operations
from .pmc_wip_projection import project_wip_pmc
from .pmc_v2_snapshots import (
    PmcError, build_constraint_snapshot, build_order_snapshot,
    build_supply_snapshot, finalize_snapshot, validate_bundle,
)

TZ = timezone(timedelta(hours=8))


def _status(value: Any) -> str:
    text = str(value or "ACTIVE").upper()
    return {"AVAILABLE": "ACTIVE", "ACTIVE": "ACTIVE", "MAINTENANCE": "MAINTENANCE", "DOWN": "INACTIVE", "DISABLED": "INACTIVE", "INACTIVE": "INACTIVE"}.get(text, "ACTIVE")


def _iso(value: Any, fallback: datetime) -> str:
    if value:
        text = str(value)
        if "T" not in text:
            text = f"{text}T08:00:00+08:00"
        return text
    return fallback.isoformat()


def _calendar(payload: dict[str, Any]) -> dict[str, Any]:
    windows = payload.get("calendar_windows") or payload.get("calendar") or []
    if isinstance(windows, dict):
        windows = windows.get("working_intervals") or windows.get("windows") or []
    intervals = []
    for item in windows:
        if not isinstance(item, dict):
            continue
        start = item.get("start_at")
        end = item.get("end_at")
        if not start and item.get("date"):
            start = f"{item['date']}T{item.get('start', '08:00')}:00+08:00"
            end = f"{item['date']}T{item.get('end', '17:00')}:00+08:00"
        if start and end:
            intervals.append({"calendar_ref": str(item.get("calendar_ref") or "CAL-DEFAULT"), "start_at": str(start), "end_at": str(end), "shift_code": str(item.get("shift_code") or item.get("shift") or "DAY")})
    if not intervals:
        raise PmcError("BLOCKED_INPUT", "MISSING_CALENDAR working intervals are required for PMC v2")
    unavailable = payload.get("resource_unavailability") or []
    return finalize_snapshot({"snapshot_id": f"SNAP-CAL-{payload.get('scenario_id', 'M5')}", "revision": 1, "working_intervals": intervals, "unavailability": list(unavailable)})


def _resources(payload: dict[str, Any], calendar: dict[str, Any]) -> dict[str, Any]:
    items = payload.get("resources") or []
    explicit = payload.get("resource_snapshot")
    if isinstance(explicit, dict):
        return explicit
    cal_ref = str((calendar.get("working_intervals") or [{}])[0].get("calendar_ref") or "CAL-DEFAULT")
    equipment, persons, tooling, stations = [], [], [], []
    for item in items:
        code = str(item.get("resource_id") or item.get("code") or "")
        if not code:
            continue
        kind = str(item.get("resource_type") or item.get("type") or "equipment").upper()
        if kind in {"PERSON", "OPERATOR", "LABOR"}:
            persons.append({"person_code": code, "skill_codes": list(item.get("skills") or item.get("skill_codes") or []), "qualified_operation_codes": list(item.get("qualified_operation_codes") or []), "max_parallel_tasks": int(item.get("max_parallel_tasks") or 1), "status": _status(item.get("status")), "calendar_ref": str(item.get("calendar_ref") or cal_ref)})
        elif kind == "TOOLING":
            tooling.append({"tooling_code": code, "tooling_type": str(item.get("tooling_type") or "fixture"), "capability_codes": list(item.get("capability_codes") or []), "compatible_product_codes": list(item.get("compatible_product_codes") or []), "quantity_available": int(item.get("quantity_available") or item.get("capacity") or 1), "status": _status(item.get("status")), "calendar_ref": str(item.get("calendar_ref") or cal_ref)})
        elif kind == "STATION":
            stations.append({"station_code": code, "work_center_code": str(item.get("work_center_code") or code), "parallel_slots": int(item.get("parallel_slots") or 1), "status": _status(item.get("status")), "calendar_ref": str(item.get("calendar_ref") or cal_ref)})
        else:
            equipment.append({"equipment_code": code, "equipment_type": str(item.get("equipment_type") or item.get("name") or "machine"), "capability_codes": list(item.get("capability_codes") or item.get("capabilities") or []), "capacity_per_hour": str(item.get("capacity_per_hour") or item.get("capacity") or 60), "efficiency_factor": str(item.get("efficiency_factor") or item.get("efficiency") or 1), "status": _status(item.get("status")), "calendar_ref": str(item.get("calendar_ref") or cal_ref)})
    return finalize_snapshot({"snapshot_id": f"SNAP-RES-{payload.get('scenario_id', 'M5')}", "revision": 1, "equipment": equipment, "tooling": tooling, "persons": persons, "stations": stations})


def _routes(payload: dict[str, Any], orders: list[dict[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for raw in payload.get("routing_steps") or []:
        product = str(raw.get("product_id") or raw.get("product_code") or "")
        if not product:
            continue
        grouped.setdefault(product, []).append(raw)
    routes: dict[str, Any] = {}
    for product, raw_ops in grouped.items():
        raw_ops = sorted(raw_ops, key=lambda x: int(x.get("sequence") or x.get("sequence_no") or 0))
        ops = []
        for index, raw in enumerate(raw_ops, start=1):
            code = str(raw.get("operation_id") or raw.get("op_code") or f"OP-{index:03d}")
            eligible = raw.get("eligible_resources") or []
            eq_codes = list(raw.get("required_equipment_codes") or [])
            if not eq_codes:
                eq_codes = [str(x.get("resource_id")) for x in eligible if x.get("resource_id") and str(x.get("resource_type") or "equipment").upper() not in {"PERSON", "TOOLING", "STATION"}]
            std = raw.get("standard_minutes")
            if std is None:
                std = raw.get("std_minutes")
            if std is None and eligible:
                std = eligible[0].get("standard_minutes")
            if std is None:
                raise PmcError("BLOCKED_INPUT", f"MISSING_STANDARD_MINUTES op_code={code}")
            loss = raw.get("loss_rate")
            yield_rate = raw.get("yield_rate")
            if yield_rate is None:
                yield_rate = 1 - float(loss or 0)
            predecessors = raw.get("predecessors")
            if predecessors is None:
                predecessor = raw.get("predecessor")
                predecessors = [str(predecessor)] if predecessor else ([ops[-1]["op_code"]] if ops else [])
            groups = {
                "required_equipment_codes": eq_codes,
                "required_equipment_capabilities": list(raw.get("required_equipment_capabilities") or raw.get("capability_codes") or []),
                "required_person_codes": list(raw.get("required_person_codes") or []),
                "required_skill_codes": list(raw.get("required_skill_codes") or raw.get("required_skills") or []),
                "required_tooling_codes": list(raw.get("required_tooling_codes") or []),
                "required_station_codes": list(raw.get("required_station_codes") or []),
            }
            if not any(groups.values()):
                raise PmcError("BLOCKED_INPUT", f"MISSING_RESOURCE_REQUIREMENT op_code={code}")
            op = {"op_code": code, "name": str(raw.get("operation_name") or raw.get("name") or code), "sequence_no": index, "predecessors": predecessors, "standard_minutes": float(std), "quantity_basis": int(raw.get("quantity_basis") or raw.get("batch_size") or 1), "batch_size": int(raw.get("batch_size") or raw.get("quantity_basis") or 1), "setup_minutes": int(raw.get("setup_minutes") or 0), "setup_family": raw.get("setup_family"), "parallel_allowed": bool(raw.get("parallel_allowed", False)), "yield_rate": float(yield_rate), **groups, "approval_ref": str(raw.get("approval_ref") or payload.get("route_approval_ref") or "APPROVED-ROUTE")}
            if raw.get("transfer_batch_size") is not None:
                op["transfer_batch_size"] = int(raw["transfer_batch_size"])
            ops.append(op)
        flow_mode = str(payload.get("execution_model") or payload.get("flow_mode") or "").upper()
        route = {"snapshot_id": f"SNAP-RT-{product}", "revision": 1, "product_code": product, "route_code": str(payload.get("route_code") or f"ROUTE-{product}"), "route_version": str(payload.get("route_version") or "approved-v2"), "approval_ref": str(payload.get("route_approval_ref") or "APPROVED-ROUTE"), "operations": ops}
        if flow_mode:
            route["execution_model"] = flow_mode
        if payload.get("transfer_batch_size") is not None:
            route["transfer_batch_size"] = int(payload["transfer_batch_size"])
        routes[product] = finalize_snapshot(route)
    if not routes:
        raise PmcError("BLOCKED_INPUT", "MISSING_ROUTE_SNAPSHOT no routes")
    return routes


def build_bundle(payload: dict[str, Any]) -> dict[str, Any]:
    supplied = payload.get("pmc_v2_bundle")
    if isinstance(supplied, dict):
        return supplied
    orders = []
    for raw in payload.get("orders") or []:
        orders.append(build_order_snapshot({"order_id": str(raw.get("order_id") or ""), "order_no": str(raw.get("order_no") or raw.get("order_id") or ""), "lines": [{"order_line_id": raw.get("order_line_id") or f"{raw.get('order_id')}::L1", "product_code": str(raw.get("product_id") or raw.get("product_code") or ""), "qty": raw.get("quantity"), "uom": raw.get("uom") or "PCS", "due_date": raw.get("due_time"), "priority": raw.get("priority")}]}, snapshot_id=f"SNAP-ORD-{raw.get('order_id')}"))
    calendar = _calendar(payload)
    bundle = {"bundle_version": "pmc-input-bundle.v2", "order_snapshots": orders, "routes": _routes(payload, orders), "resource_snapshot": _resources(payload, calendar), "calendar_snapshot": calendar, "supply_snapshot": build_supply_snapshot(payload.get("supply_entries") or _supply_entries(payload)), "constraint_snapshot": build_constraint_snapshot(payload.get("changeover_rules") or payload.get("setup_matrix") or {}, constraint_version="wip-v2")}
    return bundle


def _supply_entries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entries = []
    for item in payload.get("wip_status") or []:
        if not isinstance(item, dict):
            continue
        entries.append({"order_line_id": str(item.get("order_line_id") or f"{item.get('order_id')}::L1"), "op_code": item.get("op_code") or item.get("next_operation_id"), "readiness": "READY" if str(item.get("status") or item.get("readiness") or "").upper() in {"READY", "COMPLETED"} else "NOT_READY", "earliest_ready_at": item.get("earliest_ready_at") or item.get("ready_at"), "requirement_ref": str(item.get("requirement_ref") or "WIP-SNAPSHOT"), "inventory_snapshot_ref": str(item.get("inventory_snapshot_ref") or "INV-SNAPSHOT")})
    for item in payload.get("material_availability") or []:
        if not isinstance(item, dict):
            continue
        entries.append({"order_line_id": str(item.get("order_line_id") or f"{item.get('order_id')}::L1"), "op_code": item.get("op_code"), "readiness": "READY" if str(item.get("readiness") or "").upper() == "READY" else "NOT_READY", "earliest_ready_at": item.get("earliest_ready_at"), "requirement_ref": str(item.get("requirement_ref") or item.get("material_code") or "MATERIAL"), "inventory_snapshot_ref": str(item.get("inventory_snapshot_ref") or "INV-SNAPSHOT"), "shortage_ref": item.get("shortage_ref"), "purchase_ref": item.get("purchase_ref")})
    return entries


def _require_production_facts(payload: dict[str, Any]) -> None:
    """PMC P0：显式生产发布请求拒绝默认值注入。

    仅当 scenario_purpose=production 且 production_use_allowed=true（真实发布
    意图，而非 wip_pmc/检查预览）时执行；缺显式事实抛 PmcError（BLOCKED_INPUT），
    不自动补 APPROVED-ROUTE / approved-v2 / capacity 60 / efficiency 1 / 08:00-17:00。
    """
    purpose = str(payload.get("scenario_purpose") or "production")
    allowed = str(payload.get("production_use_allowed") or "").lower() in {"true", "1", "yes"}
    if purpose != "production" or not allowed:
        return
    if not str(payload.get("route_approval_ref") or payload.get("approval_ref") or "").strip():
        raise PmcError("BLOCKED_INPUT", "MISSING_APPROVAL_REF production PMC 需要显式 route_approval_ref，禁止默认 APPROVED-ROUTE")
    if not str(payload.get("route_version") or "").strip():
        raise PmcError("BLOCKED_INPUT", "MISSING_ROUTE_VERSION production PMC 需要显式 route_version，禁止默认 approved-v2")
    calendar_windows = payload.get("calendar_windows") or payload.get("calendar") or []
    if isinstance(calendar_windows, dict):
        calendar_windows = calendar_windows.get("working_intervals") or calendar_windows.get("windows") or []
    for item in calendar_windows:
        if not isinstance(item, dict):
            continue
        if not (item.get("start_at") and item.get("end_at")):
            raise PmcError("BLOCKED_INPUT", "MISSING_CALENDAR_WINDOW production PMC 需要逐窗口显式 start_at/end_at，禁止按日期补 08:00-17:00")
    for item in payload.get("resources") or []:
        if not isinstance(item, dict):
            continue
        code = str(item.get("resource_id") or item.get("code") or "")
        kind = str(item.get("resource_type") or item.get("type") or "equipment").upper()
        if not code or kind in {"PERSON", "OPERATOR", "LABOR", "STATION"}:
            continue
        if not (item.get("capacity_per_hour") is not None or item.get("capacity") is not None):
            raise PmcError("BLOCKED_INPUT", f"MISSING_CAPACITY equipment_code={code} production PMC 需要显式 capacity，禁止默认 60/h")
        if not (item.get("efficiency_factor") is not None or item.get("efficiency") is not None):
            raise PmcError("BLOCKED_INPUT", f"MISSING_EFFICIENCY equipment_code={code} production PMC 需要显式 efficiency，禁止默认 1")


def run_pmc_v2(payload: dict[str, Any]) -> dict[str, Any]:
    _require_production_facts(payload)
    bundle = build_bundle(payload)
    validate_bundle(bundle)
    operations, intervals, blocks = schedule_operations(bundle)
    route_meta = {code: {op["op_code"]: op for op in route["operations"]} for code, route in bundle["routes"].items()}
    enriched = []
    for op in operations:
        meta = route_meta.get(op["product_code"], {}).get(op["op_code"], {})
        enriched.append({**op, "operation_name": meta.get("name", op["op_code"]), "sequence_no": meta.get("sequence_no"), "standard_minutes": meta.get("standard_minutes"), "quantity_basis": meta.get("quantity_basis"), "yield_rate": meta.get("yield_rate", 1), "loss_rate": round(1 - float(meta.get("yield_rate", 1)), 6), "setup_family": meta.get("setup_family"), "wip_state": "released"})
    starts = [op["plan_start"] for op in enriched]
    ends = [op["plan_end"] for op in enriched]
    digest = sha256(str(bundle).encode("utf-8")).hexdigest()
    processing = sum(float(op["processing_minutes"]) for op in enriched)
    setup = sum(float(op["setup_minutes"]) for op in enriched)
    schedule_start = starts[0] if starts else None
    makespan = max((int((datetime.fromisoformat(x.replace('Z', '+00:00')) - datetime.fromisoformat(schedule_start.replace('Z', '+00:00'))).total_seconds() / 60) for x in ends), default=0) if schedule_start else 0
    flow_modes = sorted({str(route.get("execution_model") or route.get("flow_mode")) for route in bundle["routes"].values() if route.get("execution_model") or route.get("flow_mode")})
    schedule = {"scenario_id": payload.get("scenario_id"), "scenario_purpose": payload.get("scenario_purpose", "production"), "plan_version": f"wip-v2-{digest[:10]}", "algorithm_version": "pmc-v2-streaming-20260903" if "STREAMING_FLOW" in flow_modes else "pmc-v2-frozen-20260902", "execution_model": "STREAMING_FLOW" if "STREAMING_FLOW" in flow_modes else "BATCH_FLOW", "solver_status": "feasible" if not blocks else "blocked", "operations": enriched, "resource_intervals": intervals, "blocks": blocks, "metrics": {"operation_count": len(enriched), "makespan_minutes": makespan, "processing_minutes": round(processing, 2), "setup_minutes": round(setup, 2), "wip_deferred_count": sum(1 for e in bundle["supply_snapshot"].get("entries", []) if e.get("readiness") == "NOT_READY" and e.get("earliest_ready_at")), "batch_operation_count": sum(1 for op in enriched if op.get("batch_index") is not None)}, "validation_report": {"status": "pass" if not blocks else "fail", "errors": blocks}}
    # The scheduler is the source of plan times; the WIP projector adds the
    # station/worker/buffer facts required by the standalone WIP PMC package.
    # A production plan is blocked when those bindings are absent or marked
    # test-only, but the full inspection artifact is still returned.
    wip_requested = bool(payload.get("wip_pmc") or payload.get("wip_pmc_mode") or payload.get("scenario_purpose") == "wip_pmc")
    wip = project_wip_pmc(
        schedule,
        {**bundle["resource_snapshot"], "calendar_snapshot": bundle["calendar_snapshot"]},
        source_ref="wip-pmc-reuse-20260901",
        production_allowed=payload.get("production_use_allowed", True),
        require_bindings=wip_requested,
    )
    wip_blocks = []
    if wip_requested and wip["summary_metrics"].get("missing_station_bindings"):
        wip_blocks.append({"reason_code": "MISSING_STATION_BINDING", "reason": "WIP PMC 需要逐工序真实工位绑定；当前输入缺少工位编码"})
    if wip_requested and wip["summary_metrics"].get("missing_worker_bindings"):
        wip_blocks.append({"reason_code": "MISSING_WORKER_BINDING", "reason": "WIP PMC 需要逐工序人员绑定；当前输入缺少人员编码"})
    blocks.extend(wip_blocks)
    schedule["solver_status"] = "feasible" if not blocks else "blocked"
    schedule["validation_report"] = {"status": "pass" if not blocks else "fail", "errors": blocks}
    schedule.update({
        "wip_version": "wip-pmc-reuse-20260901",
        "production_blocked": bool(blocks) or wip["production_blocked"],
        "state_segments": wip["state_segments"],
        "wip_segments": wip["wip_segments"],
        "wip_edges": wip["wip_edges"],
        "edge_wip_statistics": wip["edge_wip_statistics"],
        "worker_utilization": wip["worker_utilization"],
        "station_utilization": wip["station_utilization"],
        "bottleneck_facts": wip["bottleneck_facts"],
        "summary_metrics": wip["summary_metrics"],
        "wip_source_ref": wip["source_ref"],
    })
    # PMC P1：目标驱动指标（on_time/tardiness/资源负载），纯计算、不影响求解结果。
    try:
        from .pmc_metrics import compute_order_metrics, compute_resource_load

        order_metrics = compute_order_metrics(enriched, bundle["order_snapshots"])
        load_metrics = compute_resource_load(intervals, makespan_minutes=makespan if makespan is not None else 0)
        schedule["metrics"].update({
            "on_time_rate": order_metrics["on_time_rate"],
            "total_tardiness_minutes": order_metrics["total_tardiness_minutes"],
            "tardiness_orders": order_metrics["tardiness_orders"],
            "resource_load_minutes": load_metrics["total_busy_minutes"],
            "resource_load_by_resource": load_metrics["load_by_resource"],
        })
    except Exception:  # 指标计算失败不吞求解结果（metrics 缺失时前端显示 -）
        pass
    result = {"success": not blocks, "data": {"idempotency_key": payload.get("idempotency_key", ""), "schedule": schedule, "scenario_purpose": payload.get("scenario_purpose", "production"), "lifecycle_status": "draft", "input_hash": digest, "algorithm_version": "pmc-v2-frozen-20260902", "input_package": {"order_snapshots": bundle["order_snapshots"], "routes": bundle["routes"], "resource_snapshot": bundle["resource_snapshot"], "calendar_snapshot": bundle["calendar_snapshot"], "supply_snapshot": bundle["supply_snapshot"], "constraint_snapshot": bundle["constraint_snapshot"]}, "validator": schedule["validation_report"], "blocks": blocks, "wip": bundle["supply_snapshot"].get("entries", []), "wip_pmc": wip}, "errors": [{"code": "BLOCKED_INPUT", "message": b.get("reason", "") , "details": [b]} for b in blocks], "trace_id": f"m5:pmc-v2:{digest[:12]}", "evidence": [{"module": "m5", "source_ref": "pmc_v2_frozen", "evidence_ref": "pmc-v2-frozen-20260902", "detail": "WIP/工时/产能/换型/日历约束求解"}, {"module": "m5", "source_ref": "wip-pmc-reuse-20260901", "evidence_ref": "wip-pmc-reuse-20260901", "detail": "工位状态段、工位间 WIP、人工利用率投影"}]}
    # PMC P0 计划持久化（可选）：提供 plan_store_db 时把本次求解写为 draft，
    # 回填持久 plan_version 与 solver_hash；不改变默认 local 求解行为。
    plan_db = payload.get("plan_store_db") or payload.get("plan_db_path")
    if plan_db:
        try:
            from .pmc_plan_store import PmcPlanStore

            store = PmcPlanStore(plan_db)
            solver_hash = f"pmc-v2:{digest[:16]}"
            scenario_id = str(payload.get("scenario_id") or f"scenario-{digest[:8]}")
            plan = store.save_draft(
                scenario_id=scenario_id, purpose=str(payload.get("scenario_purpose") or "production"),
                payload=payload, input_hash=digest, solver_hash=solver_hash,
                idempotency_key=str(payload.get("idempotency_key") or f"ik-{digest[:12]}"),
                task_id=str(payload.get("tracking_task_id") or ""),
            )
            data = result.setdefault("data", {})
            schedule.setdefault("plan_version", plan.get("plan_version"))
            data["plan_version"] = plan.get("plan_version")
            data["solver_hash"] = solver_hash
            data["scenario_id"] = scenario_id
            data["plan_store"] = {"scenario_id": scenario_id, "plan_version": plan.get("plan_version"), "lifecycle_status": "draft", "head": plan.get("head")}
            data.setdefault("evidence", [])
        except Exception as exc:  # 持久化失败不吞求解结果，附加错误可见。
            result.setdefault("data", {})["plan_store_error"] = str(exc)
    return result
