import { DebateEvent, DebateStartPayload } from "./types";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * POST /debate/start returns an SSE stream, but the browser's native
 * EventSource can't send a POST body — so we read the response body
 * ourselves and parse "data: {...}" frames (blank-line delimited, per
 * the SSE spec). Comment-only frames (the server's keep-alive pings)
 * are silently skipped.
 */
export async function streamDebate(
  payload: DebateStartPayload,
  onEvent: (evt: DebateEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_URL}/debate/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Debate request failed (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // sse-starlette emits CRLF ("\r\n\r\n") frame separators, not the bare
    // "\n\n" the SSE spec's minimal example uses — normalize so both (and
    // any client that only sends LF) parse the same way.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim());

      if (dataLines.length === 0) continue; // ping / comment-only frame

      try {
        const evt = JSON.parse(dataLines.join("")) as DebateEvent;
        onEvent(evt);
      } catch {
        // malformed frame — ignore rather than crash the stream
      }
    }
  }
}

export async function fetchPersonas() {
  const res = await fetch(`${API_URL}/personas`);
  if (!res.ok) throw new Error("Failed to load personas");
  return res.json();
}
