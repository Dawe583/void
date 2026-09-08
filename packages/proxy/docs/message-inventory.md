# MCP message inventory (client and server halves)

Single-author inventory of every message the VOID proxy can meet on the wire.
Scope: JSON-RPC 2.0 framing, MCP lifecycle, and the `@modelcontextprotocol/sdk` 1.30.0 TypeScript SDK implementation as source of truth (`packages/proxy/node_modules/@modelcontextprotocol/sdk`).
Every fact carries a `file:line` citation into `packages/proxy/node_modules/@modelcontextprotocol/sdk/dist/esm/` (shortened below as `sdk/`).
Builders implement from this file alone; do not consult the spec from memory.

Direction key: C->S means client-to-server, S->C means server-to-client.
Requests have an `id`; notifications and responses route by method or id.

## 1. Lifecycle: initialize handshake

Message order is fixed: `initialize` request (C->S), `initialize` result (S->C), `notifications/initialized` (C->S); only then may either side send anything else.

- The `Client.connect()` sends `initialize` with `protocolVersion: LATEST_PROTOCOL_VERSION` (`'2025-11-25'`), `capabilities` and `clientInfo` (`sdk/client/index.js:282-289`), validates the result against `SUPPORTED_PROTOCOL_VERSIONS` and rejects otherwise (`sdk/client/index.js:293-295`), then sends `notifications/initialized` (`sdk/client/index.js:303-305`). On failure it calls `close()` and rethrows (`sdk/client/index.js:312-316`).
- Version negotiation on the server: if the requested version is in `SUPPORTED_PROTOCOL_VERSIONS` the server echoes it back; otherwise it responds with `LATEST_PROTOCOL_VERSION` (`sdk/server/index.js:259-263`). Both sides then use the version in the result.
- `SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']` (`sdk/types.js:4`), `LATEST_PROTOCOL_VERSION = '2025-11-25'` (`sdk/types.js:2`), `DEFAULT_NEGOTIATED_PROTOCOL_VERSION = '2025-03-26'` (`sdk/types.js:3`). Note the generated spec draft file carries a different, non-negotiable constant `"DRAFT-2026-v1"` marked `@internal` and never used for negotiation (`sdk/spec.types.js:12`).
- The client sets the negotiated version on HTTP transports via `transport.setProtocolVersion` when present (`sdk/client/index.js:299-301`); stdio ignores it.
- `InitializeRequest.params` (C->S): `protocolVersion: string`, `capabilities: ClientCapabilities`, `clientInfo: Implementation` (`sdk/types.js:458-465`).
- `InitializeResult` (S->C): `protocolVersion: string`, `capabilities: ServerCapabilities`, `serverInfo: Implementation`, optional `instructions: string` (`sdk/types.js:539-552`).
- `Implementation` = `{ name: string, title?: string, icons?: Icon[], version: string, websiteUrl?: string, description?: string }` (`sdk/types.js:315-331` via `BaseMetadataSchema` at `sdk/types.js:298-310`, `IconsSchema` at `sdk/types.js:281-294`).
- `notifications/initialized` carries only optional `params._meta` (`sdk/types.js:556-559`).
- A reconnecting `Client.connect()` on a transport with `sessionId !== undefined` skips initialization entirely (`sdk/client/index.js:276-280`).

### ClientCapabilities, every field

`{ experimental?: Record<string, object>, sampling?: { context?: object, tools?: object }, elicitation?: { form?: { applyDefaults?: boolean }, url?: object }, roots?: { listChanged?: boolean }, tasks?: ClientTasksCapability, extensions?: Record<string, object> }` (`sdk/types.js:413-457`).
The empty `elicitation: {}` object is normalized to `{ form: {} }` at parse time for backwards compatibility (`sdk/types.js:335-345`); form mode is implied when neither `form` nor `url` is present (`sdk/client/index.js:60-69`).
`ClientTasksCapability` = `{ list?: object, cancel?: object, requests?: { sampling?: { createMessage?: object }, elicitation?: { create?: object } } }` (`sdk/types.js:349-381`).

### ServerCapabilities, every field

`{ experimental?: Record<string, object>, logging?: object, completions?: object, prompts?: { listChanged?: boolean }, resources?: { subscribe?: boolean, listChanged?: boolean }, tools?: { listChanged?: boolean }, tasks?: ServerTasksCapability, extensions?: Record<string, object> }` (`sdk/types.js:477-535`).
`ServerTasksCapability` = `{ list?: object, cancel?: object, requests?: { tools?: { call?: object } } }` (`sdk/types.js:385-409`).

### Automatic handlers installed by constructors

- `Protocol` constructor installs defaults on both sides: `ping` auto-pong, `notifications/cancelled` and `notifications/progress` handlers (`sdk/shared/protocol.js:27-35`). `Server` constructor additionally installs `initialize` and `notifications/initialized` handlers (`sdk/server/index.js:52-53`).

## 2. Every request method, direction, and shape

JSON-RPC request envelope: `{ jsonrpc: '2.0', id: string | number (integer), method: string, params?: { _meta?: RequestMeta } }` strictly validated (`sdk/types.js:114-120`); `RequestId` is string or integer (`sdk/types.js:110`).
Request params and result bodies below omit the `_meta?: RequestMeta` common field for brevity; `RequestMeta` = `{ progressToken?: string | number, 'io.modelcontextprotocol/related-task'?: { taskId: string } }` (`sdk/types.js:45-54`).

### Client to server

| Method | Params | Result |
| --- | --- | --- |
| `initialize` | `protocolVersion`, `capabilities`, `clientInfo` (`sdk/types.js:458-472`) | `protocolVersion`, `capabilities`, `serverInfo`, `instructions?` (`sdk/types.js:539-552`) |
| `ping` | none (`sdk/types.js:565-568`) | `EmptyResult` = `{ _meta? }` strict (`sdk/types.js:221`) |
| `tools/list` | `cursor?: string` (`sdk/types.js:601-611`, `:1277-1279`) | `tools: Tool[]`, `nextCursor?` (`sdk/types.js:1283-1285`) |
| `tools/call` | `name: string`, `arguments?: Record<string, unknown>`, `task?: { ttl?: number, pollInterval?: number }` (`sdk/types.js:1328-1344`) | `CallToolResult` or `CreateTaskResult` (see section 4) |
| `resources/list` | `cursor?` (`sdk/types.js:857-859`) | `resources: Resource[]`, `nextCursor?` (`sdk/types.js:863-865`) |
| `resources/templates/list` | `cursor?` (`sdk/types.js:869-871`) | `resourceTemplates: ResourceTemplate[]`, `nextCursor?` (`sdk/types.js:875-877`) |
| `resources/read` | `uri: string` (`sdk/types.js:878-896`) | `contents: Array<TextResourceContents \| BlobResourceContents>`; extends `ResultSchema`, so no `nextCursor` (`sdk/types.js:900-902`) |
| `resources/subscribe` | `uri` (`sdk/types.js:910-917`) | `EmptyResult` (`sdk/client/index.js:468-470`) |
| `resources/unsubscribe` | `uri` (`sdk/types.js:918-925`) | `EmptyResult` (`sdk/client/index.js:471-473`) |
| `prompts/list` | `cursor?` (`sdk/types.js:983-985`) | `prompts: Prompt[]`, `nextCursor?` (`sdk/types.js:989-991`) |
| `prompts/get` | `name: string`, `arguments?: Record<string, string>` (`sdk/types.js:995-1011`) | `description?`, `messages: Array<{ role: 'user' \| 'assistant', content: ContentBlock }>` (`sdk/types.js:1141-1154`) |
| `completion/complete` | `ref: PromptReference \| ResourceTemplateReference`, `argument: { name, value }`, `context?: { arguments?: Record<string, string> }` (`sdk/types.js:1854-1884`) | `completion: { values: string[] (max 100), total?, hasMore? }` (`sdk/types.js:1900-1915`) |
| `logging/setLevel` | `level: 'debug' \| 'info' \| 'notice' \| 'warning' \| 'error' \| 'critical' \| 'alert' \| 'emergency'` (`sdk/types.js:1380-1396`) | `EmptyResult` (`sdk/client/index.js:450-452`) |
| `tasks/get` | `taskId: string` (`sdk/types.js:669-674`) | Task object fields (`sdk/types.js:678`) |
| `tasks/result` | `taskId` (`sdk/types.js:682-687`) | the original request result shape, loose (`sdk/types.js:694`) |
| `tasks/list` | `cursor?` (`sdk/types.js:698-700`) | `tasks: Task[]`, `nextCursor?` (`sdk/types.js:704-706`) |
| `tasks/cancel` | `taskId` (`sdk/types.js:710-715`) | Task object fields (`sdk/types.js:719`) |

`ClientRequestSchema` union confirms this set: ping, initialize, completion/complete, logging/setLevel, prompts/get, prompts/list, resources/list, resources/templates/list, resources/read, resources/subscribe, resources/unsubscribe, tools/call, tools/list, tasks/get, tasks/result, tasks/list, tasks/cancel (`sdk/types.js:1956-1974`).

`tasks/result` exists only when a TaskStore is configured on the receiving side (`sdk/shared/protocol.js:39-40`, handler at `:52-121`); the request is sent by `Protocol.getTaskResult()` regardless (`sdk/shared/protocol.js:764-767`).

### Server to client

| Method | Params | Result |
| --- | --- | --- |
| `ping` | none | `EmptyResult` |
| `sampling/createMessage` | `messages: SamplingMessage[]`, `modelPreferences?`, `systemPrompt?`, `includeContext?: 'none' \| 'thisServer' \| 'allServers'`, `temperature?`, `maxTokens: integer`, `stopSequences?`, `metadata?`, `tools?: Tool[]`, `toolChoice?: { mode: 'auto' \| 'required' \| 'none' }`, `task?` (`sdk/types.js:1511-1559`) | `CreateMessageResult` or `CreateMessageResultWithTools` (see below) |
| `elicitation/create` | form: `mode?: 'form'`, `message: string`, `requestedSchema: { type: 'object', properties: Record<string, PrimitiveSchemaDefinition>, required?: string[] }`; url: `mode: 'url'`, `message`, `elicitationId: string`, `url: string (url format)` (`sdk/types.js:1731-1786`) | `ElicitResult`: `action: 'accept' \| 'decline' \| 'cancel'`, `content?: Record<string, string \| number \| boolean \| string[]>` (`sdk/types.js:1810-1825`) |
| `roots/list` | none (`sdk/types.js:1938-1941`) | `roots: Array<{ uri: string (must start file://), name? }>` (`sdk/types.js:1920-1947`) |
| `tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel` | same shapes as above (`sdk/types.js:1993-2002`) | same |

`ServerRequestSchema` union: ping, sampling/createMessage, elicitation/create, roots/list, tasks/get, tasks/result, tasks/list, tasks/cancel (`sdk/types.js:1993-2002`).

`CreateMessageResult` (no tools in request): `{ model: string, stopReason?: 'endTurn' \| 'stopSequence' \| 'maxTokens' \| string, role: 'user' \| 'assistant', content: TextContent \| ImageContent \| AudioContent }` (`sdk/types.js:1565-1586`).
`CreateMessageResultWithTools` (tools present): content may also be an array and may include `ToolUseContent` (`sdk/types.js:1591-1613`); stopReason may be `'toolUse'` (`sdk/types.js:1607`).
Which schema applies is chosen by `params.tools \|\| params.toolChoice` (`sdk/server/index.js:327-331`, `sdk/client/index.js:253-256`).
`SamplingMessage` = `{ role, content: block \| block[] }` where block is text, image, audio, `tool_use` (`{ type: 'tool_use', name, id, input: Record<string, unknown> }`, `sdk/types.js:1081-1103`) or `tool_result` (`{ type: 'tool_result', toolUseId, content: ContentBlock[] (default []), structuredContent?, isError? }`, `sdk/types.js:1468-1479`).

### Task object shape (shared)

`Task` = `{ taskId: string, status: 'working' \| 'input_required' \| 'completed' \| 'failed' \| 'cancelled', ttl: number \| null, createdAt: string (ISO 8601), lastUpdatedAt: string, pollInterval?: number, statusMessage?: string }` (`sdk/types.js:622-648`). `CreateTaskResult` = `{ task: Task }` (`sdk/types.js:652-654`).

## 3. Every notification, exact payload shapes

Notification envelope: `{ jsonrpc: '2.0', method: string, params?: { _meta? } }` strictly validated, no `id` field allowed (`sdk/types.js:125-131`). Discrimination is schema-based: requests must carry `id`, notifications must not; error responses may omit `id` (`sdk/types.js:178`).

Both directions:

- `notifications/cancelled`: `params.requestId?: RequestId` (optional!), `params.reason?: string` (`sdk/types.js:222-247`). Handling: look up the abort controller for `requestId` and abort it with `reason` (`sdk/shared/protocol.js:169-176`).
- `notifications/progress`: `params.progressToken: string \| number` (required), `progress: number`, `total?: number`, `message?: string` (`sdk/types.js:570-600`). The receiver maps `Number(progressToken)` to its request-id keyed handler (`sdk/shared/protocol.js:424-448`).
- `notifications/tasks/status`: `params` = Task object fields merged with `_meta` (`sdk/types.js:658-665`). Sent by the task-store side whenever task status changes or is updated (`sdk/shared/protocol.js:1042-1046`, `:1070-1074`).

Client to server:

- `notifications/initialized`: optional `params._meta` only (`sdk/types.js:556-559`).
- `notifications/roots/list_changed`: optional `params._meta` only (`sdk/types.js:1951-1953`); capability check requires client `roots.listChanged` (`sdk/client/index.js:382-386`).

Server to client:

- `notifications/message` (logging): `params.level: LoggingLevel`, `params.logger?: string`, `params.data: unknown` (`sdk/types.js:1400-1420`). Capability check requires server `logging` (`sdk/server/index.js:164-168`).
- `notifications/resources/updated`: `params.uri: string` (`sdk/types.js:929-941`); requires server `resources` capability (`sdk/server/index.js:169-174`).
- `notifications/resources/list_changed`: no payload beyond `_meta` (`sdk/types.js:906-909`); requires server `resources` capability.
- `notifications/tools/list_changed`: no payload beyond `_meta` (`sdk/types.js:1348-1351`); requires server `tools` capability.
- `notifications/prompts/list_changed`: no payload beyond `_meta` (`sdk/types.js:1158-1161`); requires server `prompts` capability.
- `notifications/elicitation/complete`: `params.elicitationId: string` (`sdk/types.js:1792-1806`); requires client `elicitation.url` capability (`sdk/server/index.js:185-189`).

Union membership confirms direction (`sdk/types.js:1975-1981` client notifications; `sdk/types.js:2003-2013` server notifications).

Client auto-resubscribe behavior: when `options.listChanged` is configured, `Client` registers handlers for `notifications/tools/list_changed`, `notifications/prompts/list_changed`, `notifications/resources/list_changed` that call `listTools()` / `listPrompts()` / `listResources()` again, with `autoRefresh` default true and `debounceMs` default 300 (`sdk/client/index.js:106-139`, `:560-608`, `sdk/types.js:1356-1375`). The proxy must NOT auto-list; it relays the notification unchanged. The client also validates `notifications/elicitation/complete` needs `elicitation.url` capability, and `notifications/cancelled` and `notifications/progress` are always allowed for both sides (`sdk/client/index.js:380-396`, `sdk/server/index.js:162-196`).

## 4. Content blocks and tool results

`ContentBlockSchema` union (`sdk/types.js:1131-1137`):

- `text`: `{ type: 'text', text: string, annotations?, _meta? }` (`sdk/types.js:1015-1030`)
- `image`: `{ type: 'image', data: base64 string, mimeType: string, annotations?, _meta? }` (`sdk/types.js:1034-1053`); `data` is validated as base64 via `atob` (`sdk/types.js:750-760`).
- `audio`: `{ type: 'audio', data: base64, mimeType, annotations?, _meta? }` (`sdk/types.js:1057-1076`)
- `resource_link`: full `Resource` shape plus `type: 'resource_link'` (`sdk/types.js:1125-1127`); the `Resource` base is `{ name, title?, icons?, uri, description?, mimeType?, size?, annotations?, _meta? }` (`sdk/types.js:791-823`).
- `resource` (embedded): `{ type: 'resource', resource: TextResourceContents \| BlobResourceContents, annotations?, _meta? }` (`sdk/types.js:1107-1119`).

Sampling results additionally admit `tool_use` and `tool_result` blocks inside `SamplingMessageContentBlock` (see section 2).

`CallToolResult` = `{ content: ContentBlock[] (defaults to []), structuredContent?: Record<string, unknown>, isError?: boolean }` plus `_meta?` (`sdk/types.js:1289-1318`).

- If the tool defines `outputSchema`, `structuredContent` MUST be present unless `isError` is true; the SDK client enforces this (`sdk/client/index.js:486-508`).
- Tool-level errors belong in `isError: true` inside the result, not in a JSON-RPC error response, so the LLM can see them (`sdk/types.js:1304-1316`).
- Compatibility mode for protocol `2024-10-07` accepts `{ toolResult: unknown }` instead (`sdk/types.js:1320-1324`).

`Tool` = `{ name, title?, icons?, description?, inputSchema: { type: 'object', properties?, required? } (loose), outputSchema?: same shape, annotations?: ToolAnnotations, execution?: { taskSupport?: 'required' \| 'optional' \| 'forbidden' }, _meta? }` (`sdk/types.js:1229-1273`).

`ToolAnnotations`, all optional booleans unless noted, all hints only and never trusted: `title?: string`, `readOnlyHint?: boolean` (default false), `destructiveHint?: boolean` (default true), `idempotentHint?: boolean` (default false), `openWorldHint?: boolean` (default true) (`sdk/types.js:1173-1211`). The schema comment states clients should never make tool use decisions based on annotations from untrusted servers (`sdk/types.js:1166-1172`).

`Annotations` on content blocks (audience/priority, distinct from ToolAnnotations): `{ audience?: Array<'user' \| 'assistant'>, priority?: number (0..1), lastModified?: ISO 8601 }` (`sdk/types.js:774-787`).

`ResourceContents` variants: text `{ uri, mimeType?, _meta?, text: string }`, blob `{ uri, mimeType?, _meta?, blob: base64 }` (`sdk/types.js:724-766`).

`Prompt` = `{ name, title?, icons?, description?, arguments?: Array<{ name, description?, required? }>, _meta? }` (`sdk/types.js:946-979`).

## 5. Pagination

- `cursor` and `nextCursor` are opaque strings (`sdk/types.js:19-21`, `:601-618`). The SDK never parses or generates them; servers produce and interpret them.
- A request carries `cursor?` to fetch the page after that position (`sdk/types.js:601-607`). A response carries `nextCursor?` to signal more results; absence means the list is complete (`sdk/types.js:612-618`).
- The proxy must forward cursor bytes unchanged and must not cache or reorder pages. Note the SDK parses params strictly for some requests (`z.string()` cursor) and `PaginatedRequestSchema` makes params optional entirely (`sdk/types.js:609-611`).
- Paginated methods: `tools/list`, `resources/list`, `resources/templates/list`, `prompts/list`, `tasks/list` (citations in section 2 tables).

## 6. Error model and timeouts

JSON-RPC error envelope: `{ jsonrpc: '2.0', id: string \| number \| undefined (optional), error: { code: number, message: string, data? } }` (`sdk/types.js:175-194`).

Codes (`sdk/types.js:158-171`; duplicates in `sdk/spec.types.js:16-20`):

| Code | Constant | Meaning |
| --- | --- | --- |
| -32700 | ParseError | malformed JSON / invalid message on the wire |
| -32600 | InvalidRequest | request envelope invalid |
| -32601 | MethodNotFound | no handler for method, or fallback handler absent |
| -32602 | InvalidParams | params failed schema validation |
| -32603 | InternalError | handler threw non-McpError, or any unexpected condition |
| -32000 | ConnectionClosed | SDK-internal: transport closed while request in flight; the SDK only rejects the local promise with this code, it never sends it on the wire |
| -32001 | RequestTimeout | SDK-internal: request timeout; the SDK rejects locally with `data: { timeout }` and sends `notifications/cancelled` on the wire instead of the code |
| -32042 | UrlElicitationRequired | MCP-specific; carries `data.elicitations` |

Behavior rules:

- Unknown method on the receiving side: reply `-32601 MethodNotFound` with the request id, or enqueue for a task if the request is task-augmented (`sdk/shared/protocol.js:284-313`).
- Handler throws: if the error has an integer `code` it is passed through, else `-32603` with `error.message` (`sdk/shared/protocol.js:389-402`).
- Result fails schema validation on the sender side: the promise rejects locally; the wire response was already well formed (`sdk/shared/protocol.js:688-708`).
- Unknown message type (not request/notification/response): reported via `onerror`, never a wire error (`sdk/shared/protocol.js:242-244`).
- Malformed JSON or non-JSON-RPC on stdio: `deserializeMessage` throws inside `readMessage`, the catch in `processReadBuffer` reports `onerror` and keeps listening for later lines; the ReadBuffer keeps no partial poison (`sdk/shared/stdio.js:34-36`, `sdk/server/stdio.js:40-52`). A chunk that overflows the 10 MiB default buffer makes `append` clear the buffer and throw, which the data handler turns into `onerror` plus `close()` (`sdk/shared/stdio.js:10-17`, `:2`, `sdk/server/stdio.js:14-23`).
- Default request timeout is 60000 ms; each request can override `timeout`, `maxTotalTimeout`, and `resetTimeoutOnProgress` (`sdk/shared/protocol.js:8`, `:712-714`; option docs `sdk/shared/protocol.d.ts:61-98`).
- On timeout the SDK sends `notifications/cancelled` with the request id and rejects with `McpError(-32001)` carrying `data: { timeout }` (`sdk/shared/protocol.js:670-687`, `:713`).
- On transport close all pending requests reject with `McpError(-32000, 'Connection closed')` (`sdk/shared/protocol.js:248-269`).
- `McpError` message format on the wire: `'MCP error {code}: {message}'`; `McpError.fromError` special-cases `-32042` into `UrlElicitationRequiredError` (`sdk/types.js:2029-2064`).

## 7. Protocol base class mechanics

Citations are `sdk/shared/protocol.js` unless noted.

- State: monotonically increasing integer `_requestMessageId` starting at 0 (`:16`, used at `:637`); request ids are small sequential integers, never UUIDs. (`randomUUID` appears elsewhere in the SDK only to generate HTTP session ids, e.g. `sdk/server/sse.js:21`, never for request ids.) This matters for the proxy: both halves number independently and id remapping is mandatory (WP-01 trap).
- Handler maps keyed by method string: `_requestHandlers`, `_notificationHandlers`, `_responseHandlers` keyed by numeric message id, `_progressHandlers` keyed by numeric progress token, `_requestHandlerAbortControllers` keyed by the request id value, `_timeoutInfo` (`:17-26`).
- `connect(transport)` wraps the transport callbacks and routes by discrimination: `isJSONRPCResultResponse`/`isJSONRPCErrorResponse` to `_onresponse`, `isJSONRPCRequest` to `_onrequest`, `isJSONRPCNotification` to `_onnotification`, else `onerror('Unknown message type')` (`:215-247`). It chains any transport callbacks already set: the previous callback runs first, then the Protocol routing (`:219-231`); the Protocol takes ownership of the transport (`:210-213`).
- Sending a request: checks transport present, optionally enforces strict capabilities (`:619-635`), aborts if signal already aborted (`:636`), assigns `id = _requestMessageId++` (`:637-641`), injects `_meta.progressToken = messageId` when `onprogress` is provided (`:643-652`), and installs the response handler before send (`:688-708`).
- Cancellation: `options.signal` abort triggers `cancel(reason)` which deletes handlers, cleans the timeout, sends `notifications/cancelled` with `{ requestId, reason: String(reason) }` and rejects locally with `McpError(-32001)` (or the original McpError) (`:670-711`). The far side aborts its handler controller with the reason (`:169-176`), so in-flight handler output after cancellation is dropped (result and error paths both check `signal.aborted` first, `:369-392`).
- Timeout: `timeout` option or `DEFAULT_REQUEST_TIMEOUT_MSEC` (`:712-714`); a timeout fires `cancel` with `RequestTimeout` (`:713`); `resetTimeoutOnProgress` restarts the window on each progress notification, bounded by `maxTotalTimeout` which rejects immediately when exceeded (`:187-209`, `:424-448`).
- Progress wiring: `onprogress` callback is stored under the numeric message id; incoming progress token `Number(progressToken)` looks it up; unknown tokens are reported via `onerror` and dropped (`:424-448`).
- Debounced notifications: methods listed in `debouncedNotificationMethods` options, only when the notification has no params and no related ids, coalesce same-tick duplicates through a microtask (`:818-861`).
- Response side: `_onresponse` converts error responses into `McpError` rejections; task responses keep progress handlers alive (`:449-493`).
- `close()` just calls `transport.close()` (`:497-502`). Transport `onclose` triggers `_onclose` which aborts all in-flight handler controllers, clears every map and timer, fires the public `onclose`, then rejects every pending response with ConnectionClosed (`:248-269`).
- `onclose` and `onerror` semantics: transport callbacks are chained after any user callbacks set before connect; `onclose` also fires for explicit `close()` (`sdk/shared/transport.d.ts:60-71`); `onerror` is non-fatal out-of-band reporting (`sdk/shared/transport.d.ts:66-71`).
- `setRequestHandler` extracts the method literal from the schema and wraps the handler so every incoming request is schema-parsed first (`:886-893`). A parse failure rejects through the handler promise chain; the error path maps it to `-32603` on the wire unless the error carries an integer code (`:394-402`). The SDK `Server` and `Client` subclasses throw `McpError(-32602)` explicitly for invalid `tools/call`, `elicitation/create` and `sampling/createMessage` params and results (`sdk/server/index.js:106-136`, `sdk/client/index.js:180-265`).
- `fallbackRequestHandler` and `fallbackNotificationHandler`: when set, unknown methods reach them instead of automatic MethodNotFound; notifications without handler are silently dropped when no fallback exists (`:273-283`, `:284-313`).

## 8. stdio transport

All citations `sdk/shared/stdio.js`, `sdk/server/stdio.js`, `sdk/client/stdio.js`.

Framing:

- One JSON-RPC message per line, UTF-8, terminated by `\n`. `serializeMessage` appends the newline; `deserializeMessage` parses the line then schema-validates with `JSONRPCMessageSchema` (`sdk/shared/stdio.js:34-39`).
- `ReadBuffer.append(chunk)`: buffers partial lines; if buffer exceeds `maxBufferSize` (default `STDIO_DEFAULT_MAX_BUFFER_SIZE = 10 * 1024 * 1024` bytes, `:2`), it clears itself and throws (`:10-17`).
- `ReadBuffer.readMessage()`: finds the first `\n`, slices the line, strips one trailing `\r` (CRLF tolerance), returns the parsed message or null when no complete line is buffered yet; leftover bytes stay buffered (`:18-29`).
- Both transports loop `processReadBuffer()` until `readMessage()` returns null, so multiple messages in one chunk are all delivered, and a partial trailing message waits for more bytes (`sdk/server/stdio.js:40-52`, `sdk/client/stdio.js:129-142`).

Server side `StdioServerTransport`:

- Constructed over `process.stdin`/`process.stdout` by default; accepts injected streams and `maxBufferSize` option (`sdk/server/stdio.js:8-28`).
- `start()` attaches `data` and `error` listeners once; second start throws (`:32-39`).
- On data: append to ReadBuffer and drain; an overflow error is reported via `onerror` then `close()` (`:14-23`).
- `send()` serializes and writes; if the write returns false (kernel buffer full) it waits for the `drain` event before resolving. This is the backpressure path; the promise does not resolve until the OS accepted the bytes (`:69-79`).
- `close()`: removes listeners, pauses stdin only if no other `data` listeners remain, clears the ReadBuffer, fires `onclose` (`:54-68`).
- No signal handling; SIGTERM/SIGINT behavior is the host process business, not the transport (`sdk/server/stdio.js` entire file, no process signal code).

Client side `StdioClientTransport`:

- Constructor takes the server command spec: `{ command, args?, env?, stderr?: 'pipe' \| 'overlapped' \| 'inherit' \| ..., cwd?, maxBufferSize? }` (`sdk/client/stdio.js:48-56`); `StdioServerParameters.stderr` defaults to `inherit`, meaning the child inherits the parent stderr and its logs pass through (`:71`).
- Default inherited environment vars are only `HOME LOGNAME PATH SHELL TERM USER` on Unix (sudo-inspired list) and a Windows list; values starting with `()` (shell functions) are skipped for security (`:8-42`). Explicit `env` merges over these defaults (`:65-75`).
- `start()` spawns with `cross-spawn`, `shell: false`, `windowsHide` on win32; resolves on `spawn` event, rejects on spawn error; `close` event on the child fires transport `onclose` (`:60-107`).
- stderr: when `stderr === 'pipe' \|\| 'overlapped'`, a `PassThrough` is created at construction time so listeners can attach before spawn, and the child stderr is piped into it; `get stderr()` returns the PassThrough or the raw child stderr (`:50-55`, `:103-105`, `:109-120`).
- `send()` writes to child stdin with the same drain-event backpressure as the server side; throws `Not connected` if the child is gone (`:179-192`).
- `close()` sequence: end child stdin, wait up to 2000 ms for exit, then `SIGTERM`, wait up to 2000 ms again, then `SIGKILL`; ReadBuffer cleared at the end (`:143-178`). The 2000 ms windows are `.unref()`ed so they never hold the event loop (`:158`, `:166`).
- Overflow and parse errors on the read side mirror the server: `onerror` then `close()` on append failure; per-line parse errors are reported and the loop continues (`:90-102`, `:129-142`).

Implication for the VOID proxy: the proxy is a stdio server to the agent and a stdio client to the upstream, so it owns one `StdioServerTransport` facing the agent and one `StdioClientTransport` facing the upstream. Each direction has its own `ReadBuffer`; a slow agent reading its stdout produces backpressure the proxy must forward by awaiting `send()` in order.

## Traps for implementers

1. Id remapping is mandatory. The SDK numbers requests from 0 upward on both halves (`sdk/shared/protocol.js:16`, `:637`). A proxy that forwards ids unchanged will collide as soon as both sides issue requests in the same session (agent request 0 vs upstream response to its own request 0). Maintain two maps: agent-request-id to upstream-request-id for C->S, and upstream-request-id to agent-request-id for S->C, and translate in both directions. Same for progress tokens: `_meta.progressToken` is the sender request id by default (`sdk/shared/protocol.js:643-652`), so tokens crossing the proxy must be remapped to the far side request id space.
2. Progress token equals the request id. Because `Protocol.request` sets `_meta.progressToken = messageId`, a forwarded request must carry the progress token the far side will echo in `notifications/progress`. If the proxy rewrites request ids, it must rewrite `progressToken` in `_meta` identically, or progress notifications will be dropped with `unknown token` errors (`sdk/shared/protocol.js:424-431`).
3. `notifications/cancelled` cancels by request id, not by method. When the agent cancels, the proxy must translate the `requestId` to the upstream id before forwarding, and must keep the mapping until the response arrives. Cancelling an unknown id is a no-op on the receiving side (`sdk/shared/protocol.js:169-176`), so a lost mapping means a leaked upstream request.
4. Timeout mismatch. The SDK defaults each request to 60 s and auto-cancels on expiry by sending `notifications/cancelled` (`sdk/shared/protocol.js:712-714`, `:670-687`). The proxy must not time out faster than the agent; if the proxy cancels early the agent sees a phantom error. There is no wire-visible timeout, so the proxy should only cancel upstream when the agent cancels, and must never let its own 60 s timer fire while the upstream is still working.
5. `tools/call` with `outputSchema`. If the upstream tool defines `outputSchema`, the result must contain `structuredContent` unless `isError` is set, and the agent SDK validates this (`sdk/client/index.js:486-508`). The proxy must not strip `structuredContent` while rewriting content arrays, and must not inject `structuredContent` when absent.
6. Protocol version negotiation is asymmetric. The server answers with the requested version when supported, else jumps to `LATEST_PROTOCOL_VERSION` (`sdk/server/index.js:259-263`). A proxy that blindly forwards the agent's `initialize` must re-run negotiation upstream and answer the agent with a version it supports; forwarding the upstream answer verbatim can strand the agent on an unsupported version. Also `DEFAULT_NEGOTIATED_PROTOCOL_VERSION` ('2025-03-26') exists for pre-2025-11-25 clients (`sdk/types.js:3`).
7. Empty result strictness. `EmptyResultSchema = ResultSchema.strict()` rejects any extra fields (`sdk/types.js:221`): ping, subscribe, unsubscribe, setLevel results must carry nothing beyond `_meta` when crossing the proxy.
8. Envelope strictness. All four envelope schemas (`JSONRPCRequestSchema`, `JSONRPCNotificationSchema`, `JSONRPCResultResponseSchema`, `JSONRPCErrorResponseSchema`) are `.strict()`: any unexpected top-level field makes the message fail `JSONRPCMessageSchema` parsing in `deserializeMessage`, surfacing as a transport `onerror`, and the line is skipped without a wire error (`sdk/types.js:114-131`, `:210-215`, `sdk/shared/stdio.js:34-36`). The proxy must therefore not add fields to envelopes it forwards.

## Source of truth

- Package: `@modelcontextprotocol/sdk` 1.30.0, pinned in `packages/proxy/package.json`.
- Files read in full: `dist/esm/types.js` (2065 lines), `dist/esm/shared/protocol.js` (1107 lines), `dist/esm/shared/stdio.js` (40 lines), `dist/esm/server/stdio.js` (81 lines), `dist/esm/client/stdio.js` (194 lines), `dist/esm/server/index.js` (429 lines), `dist/esm/client/index.js` (613 lines), `dist/esm/shared/transport.js` (39 lines), `dist/esm/spec.types.js` (24 lines), plus `.d.ts` companions for `protocol` and `transport` interfaces.
- No facts are drawn from memory or from the prose specification; only from the SDK implementation above.
