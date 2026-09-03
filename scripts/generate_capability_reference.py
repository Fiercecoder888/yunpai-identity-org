from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_ROOT = ROOT / "registry" / "tool-manifests"
OUTPUT = ROOT / "docs" / "M0_M5_FUNCTION_REFERENCE.md"


def schema_type(schema: Any) -> str:
    if not isinstance(schema, dict):
        return "any"
    value = schema.get("type")
    if isinstance(value, list):
        return " | ".join(str(item) for item in value)
    if value:
        return str(value)
    if "oneOf" in schema:
        return "oneOf"
    if "anyOf" in schema:
        return "anyOf"
    return "any"


def field_table(schema: dict[str, Any]) -> list[str]:
    required = set(schema.get("required") or [])
    properties = schema.get("properties") or {}
    if not properties:
        alternatives = []
        for key in ("oneOf", "anyOf"):
            alternatives.extend(schema.get(key) or [])
        for alternative in alternatives:
            properties.update(alternative.get("properties") or {})
            required.update(alternative.get("required") or [])
    if not properties:
        return ["无固定顶层字段；以 JSON Schema 的组合约束为准。"]
    lines = ["| 字段 | 类型 | 必填 | 说明 |", "|---|---|---:|---|"]
    for name, value in properties.items():
        description = str(value.get("description") or "-").replace("\n", " ").replace("|", "\\|")
        lines.append(f"| `{name}` | `{schema_type(value)}` | {'是' if name in required else '否'} | {description} |")
    return lines


def main() -> None:
    manifests = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(MANIFEST_ROOT.glob("m*.json"))]
    total = sum(len(manifest["tools"]) for manifest in manifests)
    lines = [
        "# M0-M5 完整功能与接口参考",
        "",
        "> 本文由 `scripts/generate_capability_reference.py` 从 `registry/tool-manifests/*.json` 生成。JSON manifest 是完整机器可读合同，本文用于人工检索。",
        "",
        f"当前共收录 **{total}** 个工具。所有写操作必须透传根 `X-Yunpai-Task-ID`；模块响应仍受 manifest 输出 Schema、租户、幂等、revision/checksum 和人工 Gate 约束。",
        "",
        "| 模块 | 数量 | 领域职责 |",
        "|---|---:|---|",
    ]
    duties = {
        "m0": "数据导入、canonical 事实、来源/证据、版本与回滚",
        "m1": "多模态文件解析、订单字段、审核和解析任务查询",
        "m2": "BOM/SOP 历史检索、受控生成和制品查询",
        "m3": "MRP、物料匹配、缺料、齐套与需求反馈",
        "m4": "采购建议、PO 审核、供应商回复、ETA 和预警",
        "m5": "PMC 排程、重排、知识、消息、派工和报工",
    }
    for manifest in manifests:
        lines.append(f"| {manifest['module'].upper()} | {len(manifest['tools'])} | {duties[manifest['module']]} |")
    for manifest in manifests:
        module = manifest["module"]
        section_start = len(lines)
        lines.extend(["", f"## {module.upper()} 能力", "", f"默认服务地址：`{manifest.get('base_url', '')}`。完整 Schema：`registry/tool-manifests/{module}.json`。"])
        for tool in manifest["tools"]:
            http = tool.get("http") or {}
            lines.extend([
                "", f"### `{tool['name']}`", "", str(tool.get("description") or "-"), "",
                f"- 类型：`{tool.get('type', 'tool')}`",
                f"- 执行：`{tool.get('execution', 'sync')}`",
                f"- HTTP：`{http.get('method', 'POST')} {http.get('path', '')}`，超时 `{http.get('timeout_s', 60)}s`",
                "", "输入：", "", *field_table(tool.get("input_schema") or {}),
                "", "输出：", "", *field_table(tool.get("output_schema") or {}),
            ])
            if tool.get("type") == "agent":
                lines.extend(["", f"Agent 端点：`{json.dumps(tool.get('agent_endpoints', {}), ensure_ascii=False)}`"])
        reference = ROOT / "skills" / module / "references" / "tools.md"
        reference.parent.mkdir(parents=True, exist_ok=True)
        reference.write_text(
            f"# {module.upper()} 工具接口\n\n本文由工具 manifest 自动生成；只在需要选择或调用 {module.upper()} 工具时读取。\n"
            + "\n".join(lines[section_start:]) + "\n",
            encoding="utf-8",
        )
    OUTPUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"generated {OUTPUT.relative_to(ROOT)} with {total} tools")


if __name__ == "__main__":
    main()
