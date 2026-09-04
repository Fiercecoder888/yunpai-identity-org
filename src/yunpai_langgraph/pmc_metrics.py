"""PMC P1 目标驱动指标：on_time_rate / total_tardiness_minutes / 资源负载。

任务书/PMC P1：必须接入交期、优先级、迟交、换型、资源负载和目标权重，输出
on_time_rate、total_tardiness_minutes、资源负载等指标。本模块为纯函数，
输入 v2 求解的 operations/resource_intervals 与 order_snapshots，不改动求解器。
"""

from __future__ import annotations

from datetime import datetime
from typing import Any


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def order_due_priority(order_snapshots: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """order_line_id -> {due_time, priority, product_code, order_id}。

    未提供交期的行不参与 on_time 统计（不把缺失当准时）。
    """
    facts: dict[str, dict[str, Any]] = {}
    for snapshot in order_snapshots or []:
        order_id = str(snapshot.get("order_id") or "")
        for line in snapshot.get("lines") or []:
            line_id = str(line.get("order_line_id") or "")
            if not line_id:
                continue
            facts[line_id] = {
                "order_id": order_id,
                "product_code": str(line.get("product_code") or ""),
                "due_time": line.get("due_date"),
                "priority": str(line.get("priority") or "normal"),
            }
    return facts


def compute_order_metrics(operations: list[dict[str, Any]], order_snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    """按订单行计算完成时间并对照交期。

    返回：
    {
      "on_time_rate": float|None,      # 有交期行中准时比例；无交期输入时 null
      "total_tardiness_minutes": int|None,
      "tardiness_orders": [{order_line_id, due_time, completion_time, tardiness_minutes}],
      "order_count": int,
      "lines_with_due": int,
      "on_time_count": int,
    }
    """
    due_map = order_due_priority(order_snapshots)
    completion_by_line: dict[str, datetime] = {}
    for operation in operations:
        line_id = str(operation.get("order_line_id") or "")
        end = _parse_dt(operation.get("plan_end"))
        if not line_id or not end:
            continue
        current = completion_by_line.get(line_id)
        if current is None or end > current:
            completion_by_line[line_id] = end

    tardy: list[dict[str, Any]] = []
    on_time = 0
    lines_with_due = 0
    total_tardiness_minutes = 0
    for line_id, completion in completion_by_line.items():
        due = due_map.get(line_id, {}).get("due_time")
        due_dt = _parse_dt(due)
        if due_dt is None:
            continue  # 无真实交期不误报准时
        lines_with_due += 1
        tardiness_minutes = int((completion - due_dt).total_seconds() // 60)
        if tardiness_minutes <= 0:
            on_time += 1
        else:
            total_tardiness_minutes += tardiness_minutes
            tardy.append({
                "order_line_id": line_id,
                "order_id": due_map[line_id].get("order_id"),
                "product_code": due_map[line_id].get("product_code"),
                "due_time": due,
                "completion_time": completion.isoformat(),
                "tardiness_minutes": tardiness_minutes,
            })
    return {
        "order_count": len(completion_by_line),
        "lines_with_due": lines_with_due,
        "on_time_count": on_time,
        "on_time_rate": round(on_time / lines_with_due, 4) if lines_with_due else None,
        "total_tardiness_minutes": total_tardiness_minutes if lines_with_due else None,
        "tardiness_orders": sorted(tardy, key=lambda item: item["tardiness_minutes"], reverse=True),
    }


def compute_resource_load(resource_intervals: list[dict[str, Any]], *, makespan_minutes: int | float | None) -> dict[str, Any]:
    """把 v2 的 resource_intervals 折叠为资源负载（利用率）指标。

    resource_intervals 结构（pmc_v2_scheduler 输出）：每段含
    resource_type/resource_code/start/end 分钟（或 start_minute/end_minute）。
    返回 {load_by_resource: [{resource_type, resource_code, busy_minutes, makespan_minutes, utilization}], total_busy_minutes}
    """
    if makespan_minutes is None or makespan_minutes <= 0:
        return {"load_by_resource": [], "total_busy_minutes": 0, "makespan_minutes": None}
    busy: dict[tuple[str, str], int] = {}
    for segment in resource_intervals or []:
        rtype = str(segment.get("resource_type") or "resource")
        rcode = str(segment.get("resource_code") or segment.get("code") or "")
        start = segment.get("start_minute", segment.get("start"))
        end = segment.get("end_minute", segment.get("end"))
        try:
            duration = max(0, int(end) - int(start))
        except (TypeError, ValueError):
            duration = 0
        if not rcode or duration <= 0:
            continue
        key = (rtype, rcode)
        busy[key] = busy.get(key, 0) + duration
    load_by_resource = [
        {
            "resource_type": rtype,
            "resource_code": rcode,
            "busy_minutes": minutes,
            "makespan_minutes": int(makespan_minutes),
            "utilization": round(minutes / max(1, int(makespan_minutes)), 4),
        }
        for (rtype, rcode), minutes in sorted(busy.items(), key=lambda item: item[1], reverse=True)
    ]
    return {
        "load_by_resource": load_by_resource,
        "total_busy_minutes": sum(item["busy_minutes"] for item in load_by_resource),
        "makespan_minutes": int(makespan_minutes),
    }
