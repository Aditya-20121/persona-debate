import { DebateEvent } from "@/lib/types";
import { PERSONA_THEME } from "@/lib/personas";
import PersonaAvatar from "./PersonaAvatar";
import RetrievedChunks from "./RetrievedChunks";

function phaseLabel(round: number, maxRounds: number): string {
  if (round === 0) return "Opening";
  if (round >= maxRounds - 1) return "Closing";
  return "Rebuttal";
}

export default function MessageBubble({
  event,
  emoji,
  maxRounds,
  showChunks,
}: {
  event: DebateEvent;
  emoji: string;
  maxRounds: number;
  showChunks: boolean;
}) {
  const theme = PERSONA_THEME[event.persona_id as keyof typeof PERSONA_THEME];

  return (
    <div className="flex gap-3 animate-fade-in-up">
      <PersonaAvatar personaId={event.persona_id} emoji={emoji} />
      <div
        className={`flex-1 rounded-2xl rounded-tl-sm border ${
          theme?.border ?? "border-arena-border"
        } ${theme?.bg ?? "bg-arena-panel"} px-4 py-3`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`font-semibold ${theme?.text ?? "text-slate-200"}`}>
            {event.name}
          </span>
          <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-black/30 text-slate-400">
            {phaseLabel(event.round, maxRounds)} · Round {event.round + 1}
          </span>
        </div>
        <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">
          {event.text}
        </p>
        {showChunks && <RetrievedChunks chunks={event.retrieved_chunks} />}
      </div>
    </div>
  );
}
