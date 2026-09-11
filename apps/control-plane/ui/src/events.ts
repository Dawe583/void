import type { Row } from "./api";
/** A completed message is authoritative; streamed fragments are transient. */
export function transcriptEvents(source: Row[]): Row[] {
  const result: Row[] = [];
  let delta = "",
    at = "",
    seq = 0;
  const tools = new Map<string, number>();
  for (const event of source) {
    if (event.type === "message.delta") {
      delta += event.payload?.text ?? event.text ?? "";
      at = event.at;
      seq = event.seq;
      continue;
    }
    if (event.type === "message.completed") delta = "";
    if (event.type === "run.status" || event.type === "usage.reported")
      continue;
    const callId = event.payload?.callId;
    if (
      callId &&
      (event.type === "tool.started" || event.type === "tool.result")
    ) {
      const prior = tools.get(callId);
      const status =
        event.type === "tool.started"
          ? "requested"
          : event.payload?.result?.isError
            ? "failed"
            : "completed";
      if (prior !== undefined) {
        const previous = result[prior];
        result[prior] = {
          ...event,
          id: previous.id,
          seq: previous.seq,
          payload: { ...previous.payload, ...event.payload, status },
        };
        continue;
      }
      tools.set(callId, result.length);
      result.push({ ...event, payload: { ...event.payload, status } });
      continue;
    }
    result.push(event);
  }
  if (delta)
    result.push({ seq: "stream-" + seq, kind: "assistant", text: delta, at });
  return result;
}
