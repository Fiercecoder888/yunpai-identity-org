from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

ToolHandler = Callable[[dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    module: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    execution: str = "sync"
    base_url: str = ""
    method: str = "POST"
    path: str = ""
    timeout_s: float = 60.0
    tool_type: str = "tool"
    agent_endpoints: dict[str, Any] = field(default_factory=dict)
    tags: tuple[str, ...] = field(default_factory=tuple)

    def as_mcp_tool(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": f"[{self.module}] {self.description}",
            "inputSchema": self.input_schema,
            "annotations": {"module": self.module, "execution": self.execution, "type": self.tool_type},
        }
