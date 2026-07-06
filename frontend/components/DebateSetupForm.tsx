"use client";

import { useState } from "react";
import { motion, Reorder, useDragControls } from "framer-motion";
import { PERSONAS, personaById } from "@/lib/personas";
import { DEFAULT_QUESTION } from "@/lib/questions";
import { DebateStartPayload, Persona } from "@/lib/types";
import PersonaAvatar from "./PersonaAvatar";
import QuestionPicker from "./QuestionPicker";

const ORDINALS = ["1st", "2nd", "3rd"];

export default function DebateSetupForm({
  onStart,
}: {
  onStart: (payload: DebateStartPayload, showChunks: boolean) => void;
}) {
  // Display order = speaking order. The backend chains the debate graph in
  // exactly the order persona_ids arrive, so dragging rows here changes who
  // opens, who rebuts, and who gets the last word each round.
  const [order, setOrder] = useState<string[]>(PERSONAS.map((p) => p.id));
  const [selected, setSelected] = useState<Set<string>>(
    new Set(PERSONAS.map((p) => p.id))
  );
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [presetQuestion, setPresetQuestion] = useState(DEFAULT_QUESTION);
  const [customQuestion, setCustomQuestion] = useState("");
  const [maxRounds, setMaxRounds] = useState(2);
  const [showChunks, setShowChunks] = useState(true);

  const question = mode === "preset" ? presetQuestion : customQuestion.trim();
  const questionValid = question.length >= 5 && question.length <= 500;
  const personasValid = selected.size >= 2;
  const canStart = questionValid && personasValid;

  const speakingOrder = order.filter((id) => selected.has(id));

  function togglePersona(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 2) next.delete(id); // never allow fewer than 2
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    onStart(
      { question, persona_ids: speakingOrder, max_rounds: maxRounds },
      showChunks
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      onSubmit={handleSubmit}
      className="w-full max-w-2xl mx-auto rounded-2xl border border-arena-border bg-arena-panel backdrop-blur-sm p-6 sm:p-8 space-y-8"
    >
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Debaters · Speaking order
          </h2>
          <span className="text-[11px] text-muted/70">drag to reorder</span>
        </div>

        <Reorder.Group
          axis="y"
          values={order}
          onReorder={setOrder}
          className="space-y-2"
        >
          {order.map((id) => {
            const p = personaById(id);
            if (!p) return null;
            const active = selected.has(id);
            const position = speakingOrder.indexOf(id);
            return (
              <DebaterRow
                key={id}
                persona={p}
                active={active}
                ordinal={position >= 0 ? ORDINALS[position] ?? `${position + 1}th` : "—"}
                onToggle={() => togglePersona(id)}
              />
            );
          })}
        </Reorder.Group>

        <p className="text-[11px] text-muted/70 mt-2">
          The 1st speaker opens each round; the last speaker gets the final
          word.
        </p>
        {!personasValid && (
          <p className="text-xs text-red-300 mt-1">
            Select at least 2 debaters.
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            The motion
          </h2>
          <div className="relative flex rounded-full bg-black/20 p-0.5 text-xs">
            {(["preset", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="relative px-3.5 py-1.5 rounded-full"
              >
                {mode === m && (
                  <motion.div
                    layoutId="mode-pill"
                    className="absolute inset-0 rounded-full bg-arena-raised border border-arena-border"
                    transition={{ duration: 0.18 }}
                  />
                )}
                <span
                  className={`relative z-10 ${
                    mode === m ? "text-white" : "text-muted"
                  }`}
                >
                  {m === "preset" ? "Choose from list" : "Write my own"}
                </span>
              </button>
            ))}
          </div>
        </div>

        {mode === "preset" ? (
          <QuestionPicker value={presetQuestion} onChange={setPresetQuestion} />
        ) : (
          <div>
            <textarea
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="e.g. Is compromise with an unjust system betrayal or wisdom?"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-xl bg-arena-raised border border-arena-border px-3.5 py-2.5 text-sm text-white placeholder:text-muted/60 focus:outline-none focus:border-white/40 transition-colors"
            />
            <div className="flex justify-between mt-1 text-[11px] text-muted/70">
              <span>5–500 characters</span>
              <span>{customQuestion.length}/500</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted block mb-2">
            Rounds
          </label>
          <div className="flex rounded-xl bg-arena-raised border border-arena-border p-1 gap-1">
            {[1, 2, 3, 4, 5].map((n) => {
              const active = maxRounds === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMaxRounds(n)}
                  className="relative flex-1 py-1.5 rounded-lg text-sm"
                >
                  {active && (
                    <motion.div
                      layoutId="rounds-pill"
                      className="absolute inset-0 rounded-lg bg-white/15 border border-white/20"
                      transition={{ duration: 0.18 }}
                    />
                  )}
                  <span
                    className={`relative z-10 ${
                      active ? "text-white font-medium" : "text-muted"
                    }`}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted block mb-2">
            RAG grounding
          </label>
          <button
            type="button"
            onClick={() => setShowChunks((v) => !v)}
            className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors ${
              showChunks
                ? "border-white/30 bg-arena-raised text-white"
                : "border-arena-border bg-transparent text-muted"
            }`}
          >
            {showChunks ? "Show retrieved chunks" : "Hidden"}
          </button>
        </div>
      </div>

      <motion.button
        type="submit"
        disabled={!canStart}
        whileHover={canStart ? { scale: 1.015 } : {}}
        whileTap={canStart ? { scale: 0.99 } : {}}
        className="liquid-glass w-full rounded-full py-4 text-base text-white transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Begin Debate
      </motion.button>
    </motion.form>
  );
}

function DebaterRow({
  persona,
  active,
  ordinal,
  onToggle,
}: {
  persona: Persona;
  active: boolean;
  ordinal: string;
  onToggle: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={persona.id}
      dragListener={false}
      dragControls={controls}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 select-none bg-arena-panel ${
        active ? "border-white/20" : "border-arena-border opacity-45"
      }`}
    >
      {/* Drag handle — dragging is scoped here so the include toggle stays
          an ordinary click target */}
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab active:cursor-grabbing touch-none text-muted hover:text-white transition-colors px-0.5"
        aria-label={`Drag to change ${persona.name}'s speaking position`}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
          <circle cx="2.5" cy="2.5" r="1.4" />
          <circle cx="7.5" cy="2.5" r="1.4" />
          <circle cx="2.5" cy="8" r="1.4" />
          <circle cx="7.5" cy="8" r="1.4" />
          <circle cx="2.5" cy="13.5" r="1.4" />
          <circle cx="7.5" cy="13.5" r="1.4" />
        </svg>
      </button>

      <span
        className={`w-9 text-[11px] font-semibold uppercase tracking-wide ${
          active ? "text-white/80" : "text-muted/60"
        }`}
      >
        {ordinal}
      </span>

      <PersonaAvatar personaId={persona.id} emoji={persona.emoji} size="sm" />

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-white truncate">
          {persona.name}
        </div>
        <div className="text-[11px] text-muted truncate">
          {persona.tagline}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        className={`shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors ${
          active
            ? "border-white/25 bg-white/10 text-white"
            : "border-arena-border text-muted hover:text-white"
        }`}
      >
        {active ? "In" : "Out"}
      </button>
    </Reorder.Item>
  );
}
