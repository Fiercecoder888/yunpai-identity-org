# Enterprise Assistant NDJSON Chat Stream

The stream now requires a Yunpai browser session through the Gateway and is
persisted to PostgreSQL. `message_start` may include `user_message_id`,
`assistant_message_id`, `run_id`, and `conversation_version` in addition to its
compatible canonical `conversation_id`. The frontend sends a UUID
`client_message_id`; a duplicate receives HTTP 409 and reloads canonical
history rather than writing twice. See
`docs/development/anonymous-auth-chat-history.md`.

Conversation and message history APIs use independent opaque cursors. The
frontend appends deduplicated pages. Delete conflicts return `active_run` or
`version_conflict` so the UI can present the correct recovery.

## Default User Entry

The root route `/` renders the enterprise assistant conversation page. A created or selected conversation is addressable at `/c/{conversation_id}` and a page refresh reloads that server history. New conversation IDs use RFC 9562 UUIDv6 while existing UUID records remain compatible. The previous dashboard and module pages remain available as the debugging/admin workbench under `/dashboard`, `/tasks`, `/modules/*`, and `/audit`.

The frontend default chat path is:

```text
POST /api/orchestrator/chat/stream
Accept: application/x-ndjson
Content-Type: application/json
```

The API gateway rewrites it to:

```text
POST http://orchestrator:9000/chat/stream
```

The legacy `/api/orchestrator/invoke` plus `/api/orchestrator/jobs/{id}` polling flow remains as a compatibility fallback. It is not the default ChatGPT-like assistant experience.

## Request

```json
{
  "message": "当前有哪些采购风险？",
  "session_id": "dashboard-chat-uuid",
  "conversation_id": "assistant",
  "use_memory": true,
  "tools": [],
  "context": {
    "page": "assistant",
    "active_module": "m4"
  },
  "options": {
    "stream_tokens": true,
    "stream_tool_events": true,
    "max_steps": 10
  }
}
```

`message` is required and must be non-empty. `tools` is caller intent only; backend allowlist and permission checks remain authoritative.

## Response

The response content type is:

```text
application/x-ndjson; charset=utf-8
```

Each line is one JSON object terminated by `\n`.

Supported P0 events:

```json
{"type":"message_start","message_id":"msg_abc","session_id":"dashboard-chat-uuid","conversation_id":"assistant","created_at":"2026-07-16T00:00:00Z"}
{"type":"memory_recall","similar_episodes":2,"recent_session":5}
{"type":"delta","message_id":"msg_abc","content":"当前风险主要集中在"}
{"type":"error","message_id":"msg_abc","code":"llm_unavailable","message":"LLM 服务暂不可用","recoverable":true}
{"type":"message_done","message_id":"msg_abc","finish_reason":"stop","usage":{"input_tokens":0,"output_tokens":0}}
```

Implemented backend-emitted tool events:

`tool_start`, `tool_result`, and `tool_error` are produced by the orchestrator `ChatService` while executing real server-allowlisted `ToolRegistry` calls. They are not a frontend-reserved protocol, MSW behavior, or mock-only capability.

```json
{"type":"tool_start","message_id":"msg_abc","step_id":"step_001","tool":"list_m5_schedules","label":"查询排程列表"}
{"type":"tool_result","message_id":"msg_abc","step_id":"step_001","tool":"list_m5_schedules","status":"ok","duration_ms":348.2,"summary":"找到 3 个排程版本"}
{"type":"tool_error","message_id":"msg_abc","step_id":"step_001","tool":"list_m5_schedules","status":"failed","duration_ms":1000.0,"error":"M5 service unavailable"}
```

## Error Strategy

Request validation errors return HTTP 400 before the stream starts. Provider or business errors after the stream starts are emitted as `error` events followed by `message_done` with `finish_reason: "error"`. Client abort uses `AbortController`; the backend stops the stream and records cancellation through memory hooks when available.

## Architecture Decisions

The frontend uses only the unified `/api` gateway via `toApiUrl('/orchestrator/chat/stream')`. It does not add provider-specific base URLs and does not call external LLM providers or module internal addresses directly.

No standalone LLM proxy, M5/M6 generic chat backend, or first-version WebSocket endpoint is introduced. The orchestrator owns model access through its OpenAI-compatible streaming client. Real/default mode requires the server-side `ORCH_LLM_API_KEY`; missing keys fail closed with `llm_unavailable`. The deterministic fake provider is enabled only by explicit `ORCH_LLM_PROVIDER=fake` in local/test/mock execution.

## Tool Events

`tool_start`, `tool_result`, and `tool_error` are emitted by the orchestrator `ChatService` around real server-side `ToolRegistry` bound-tool calls. The server allowlist is configured with `ORCH_CHAT_ALLOWED_TOOLS`; the client `tools` field may only narrow that allowlist and cannot grant access. Tool results and errors are summarized before streaming so provider payloads, secrets, and exception stacks are not exposed.
