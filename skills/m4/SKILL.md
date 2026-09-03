---
name: yunpai-m4-procurement
description: Manage Yunpai purchase suggestions, purchase-order review, supplier replies, supply snapshots, tracking, and alerts. Use for M4 procurement execution after M3 has produced confirmed shortages.
---

# M4 采购

## 职责
接收 M3 缺料建议，生成采购草稿、供应商沟通和 ETA/到货追踪。发送、批准和到货事实都是受控副作用，必须绑定 TaskID、revision、checksum 和幂等键。

## 使用方式
Orchestrator 桥接入口为 `import_m4_purchase_suggestions_json({suggestions:[{item_code,item_name,quantity,unit,supplier_name,required_date,project_code}],...})`。PO 审核、消息、回复、供应快照和预警必须调用对应专用工具；完整接口见 [references/tools.md](references/tools.md)。

## 失败语义
供应商或权威 ETA 缺失时保持 `needs_review`，不得生成已发送、已收货或库存增加的假事实；人工补充后才允许 PO 审批/消息发送。
