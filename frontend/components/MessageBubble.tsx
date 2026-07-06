import { motion } from "framer-motion";
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
  const paragraphs = event.text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.21, 0.6, 0.35, 1] }}
      className={`rounded-lg border border-arena-border border-l-2 ${
        theme?.edge ?? "border-l-zinc-600"
      } bg-arena-panel`}
    >
      <header className="flex items-center gap-2.5 px-5 pt-4">
        <PersonaAvatar personaId={event.persona_id} emoji={emoji} size="sm" />
        <span
          className={`text-sm font-semibold tracking-wide ${
            theme?.text ?? "text-zinc-200"
          }`}
        >
          {event.name}
        </span>
        <span className="ml-auto text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          {phaseLabel(event.round, maxRounds)} · Round {event.round + 1}
        </span>
      </header>

      <div className="px-5 pb-4 pt-3 space-y-3">
        {paragraphs.map((para, i) => (
          <p
            key={i}
            className="font-serif text-[15.5px] leading-[1.75] text-zinc-200"
          >
            {para}
          </p>
        ))}

        {showChunks && <RetrievedChunks chunks={event.retrieved_chunks} />}
      </div>
    </motion.article>
  );
}
