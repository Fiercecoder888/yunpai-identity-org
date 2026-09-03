---
name: yunpai-m3-material-planning
description: Calculate and review Yunpai MRP, material matching, shortages, readiness snapshots, and demand feedback. Use for M3 procurement requirements and material-readiness questions, not purchase-order execution.
---

# M3 物料需求

## 职责
按不可变库存/在途快照计算 MRP、物料匹配和缺料。M3 拥有运行事实，不写 M0 canonical，也不预占库存。

## 使用方式
正式计算使用 `run_m3_procurement_requirements({order:{project_id,order_id,bom_id,product_name,order_qty,due_date},bom:{bom_id,product_name,lines}})`；齐套快照和反馈使用正式专用工具，`LEGACY` 工具只用于兼容。完整接口见 [references/tools.md](references/tools.md)。

## 规则
`required = order.quantity * bom.quantity_per`；`shortage=max(0,required-available)`。缺 approved BOM、权威库存或交期时 `data_incomplete/BLOCKED_INPUT`；M3→M4 只能通过 Orchestrator 桥接。
