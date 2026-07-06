import { AnimatePresence, motion } from "framer-motion";
import { DebateEvent, Persona } from "@/lib/types";
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
    <div className="space-y-5">
      <AnimatePresence initial={false}>
        {messages.map((m, i) => (
          <MessageBubble
            key={i}
            event={m}
            emoji={EMOJI_BY_PERSONA[m.persona_id] ?? "🎙️"}
            maxRounds={maxRounds}
            showChunks={showChunks}
          />
        ))}
      </AnimatePresence>

      {isStreaming && nextPersona && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex gap-3"
        >
          <PersonaAvatar personaId={nextPersona.id} emoji={nextPersona.emoji} />
          <div className="flex-1 rounded-2xl rounded-tl-sm border border-arena-border bg-arena-panel px-4 py-3 flex items-center gap-2.5">
            <span className="text-sm text-slate-400">
              {nextPersona.name} is composing a response
            </span>
            <TypingDots />
          </div>
        </motion.div>
      )}

      {errorText && (
        <div className="rounded-xl border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
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
          className="w-1.5 h-1.5 rounded-full bg-slate-500"
          animate={{ y: [0, -4, 0] }}
          transition={{
            duration: 0.9,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}
