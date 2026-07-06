import { DebateEvent, Persona } from "@/lib/types";
import MessageBubble from "./MessageBubble";
import PersonaAvatar from "./PersonaAvatar";

export default function DebateTranscript({
  messages,
  maxRounds,
  showChunks,
  isStreaming,
  nextPersona,
  errorText,
}: {
  messages: DebateEvent[];
  maxRounds: number;
  showChunks: boolean;
  isStreaming: boolean;
  nextPersona: Persona | null;
  errorText: string | null;
}) {
  return (
    <div className="space-y-5">
      {messages.map((m, i) => (
        <MessageBubble
          key={i}
          event={m}
          emoji={m.persona_id ? emojiFor(m) : "🎙️"}
          maxRounds={maxRounds}
          showChunks={showChunks}
        />
      ))}

      {isStreaming && nextPersona && (
        <div className="flex gap-3 animate-pulse-soft">
          <PersonaAvatar personaId={nextPersona.id} emoji={nextPersona.emoji} />
          <div className="flex-1 rounded-2xl rounded-tl-sm border border-arena-border bg-arena-panel/60 px-4 py-3 flex items-center">
            <span className="text-sm text-slate-400">
              {nextPersona.name} is composing a response…
            </span>
          </div>
        </div>
      )}

      {errorText && (
        <div className="rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {errorText}
        </div>
      )}
    </div>
  );
}

function emojiFor(m: DebateEvent): string {
  // messages carry name/persona_id but not emoji — this file intentionally
  // stays decoupled from lib/personas so it works for any persona_id the
  // backend returns, falling back to a generic mic if unknown.
  const map: Record<string, string> = {
    gandhi: "🕊️",
    mandela: "✊",
    marx: "⚒️",
  };
  return map[m.persona_id] ?? "🎙️";
}
