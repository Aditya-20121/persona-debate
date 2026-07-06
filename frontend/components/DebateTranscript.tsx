import { motion } from "framer-motion";
import { DebateEvent, Persona } from "@/lib/types";
import { PERSONA_THEME } from "@/lib/personas";
import MessageBubble from "./MessageBubble";
import PersonaAvatar from "./PersonaAvatar";

const EMOJI_BY_PERSONA: Record<string, string> = {
  gandhi: "🕊️",
  mandela: "✊",
  marx: "⚒️",
};

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
    <div className="space-y-4">
      {messages.map((m, i) => (
        <MessageBubble
          key={i}
          event={m}
          emoji={EMOJI_BY_PERSONA[m.persona_id] ?? "🎙️"}
          maxRounds={maxRounds}
          showChunks={showChunks}
        />
      ))}

      {isStreaming && nextPersona && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className={`rounded-lg border border-arena-border border-l-2 ${
            PERSONA_THEME[nextPersona.id]?.edge ?? "border-l-zinc-600"
          } bg-arena-panel/60 px-5 py-4 flex items-center gap-3`}
        >
          <PersonaAvatar
            personaId={nextPersona.id}
            emoji={nextPersona.emoji}
            size="sm"
          />
          <span className="text-sm text-zinc-400">
            {nextPersona.name} is preparing an argument
          </span>
          <TypingDots />
        </motion.div>
      )}

      {errorText && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/25 px-5 py-4 text-sm text-red-300">
          {errorText}
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full bg-zinc-500"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.2,
          }}
        />
      ))}
    </div>
  );
}
