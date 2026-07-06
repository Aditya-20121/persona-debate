"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { PERSONAS } from "@/lib/personas";
import { DEFAULT_QUESTION } from "@/lib/questions";
import { DebateStartPayload } from "@/lib/types";
import PersonaAvatar from "./PersonaAvatar";
import QuestionPicker from "./QuestionPicker";

export default function DebateSetupForm({
  onStart,
}: {
  onStart: (payload: DebateStartPayload, showChunks: boolean) => void;
}) {
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
    const persona_ids = PERSONAS.filter((p) => selected.has(p.id)).map(
      (p) => p.id
    );
    onStart({ question, persona_ids, max_rounds: maxRounds }, showChunks);
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      onSubmit={handleSubmit}
      className="w-full max-w-2xl mx-auto rounded-2xl border border-arena-border bg-arena-panel p-6 sm:p-8 space-y-7"
    >
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">
          Debaters
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PERSONAS.map((p) => {
            const active = selected.has(p.id);
            return (
              <motion.button
                type="button"
                key={p.id}
                onClick={() => togglePersona(p.id)}
                whileTap={{ scale: 0.97 }}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${
                  active
                    ? "border-slate-600 bg-white/[0.04]"
                    : "border-arena-border bg-transparent opacity-45 hover:opacity-75"
                }`}
              >
                <PersonaAvatar personaId={p.id} emoji={p.emoji} size="sm" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-100 truncate">
                    {p.name}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">
                    {p.tagline}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
        {!personasValid && (
          <p className="text-xs text-red-400 mt-2">
            Select at least 2 debaters.
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-300">
            Debate topic
          </h2>
          <div className="relative flex rounded-lg bg-black/25 p-0.5 text-xs">
            {(["preset", "custom"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="relative px-3 py-1.5 rounded-md"
              >
                {mode === m && (
                  <motion.div
                    layoutId="mode-pill"
                    className="absolute inset-0 rounded-md bg-arena-raised"
                    transition={{ duration: 0.18 }}
                  />
                )}
                <span
                  className={`relative z-10 ${
                    mode === m ? "text-white" : "text-slate-400"
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
              className="w-full resize-none rounded-lg bg-arena-raised border border-arena-border px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-accent transition-colors"
            />
            <div className="flex justify-between mt-1 text-[11px] text-slate-500">
              <span>5–500 characters</span>
              <span>{customQuestion.length}/500</span>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-semibold text-slate-300 block mb-2">
            Rounds
          </label>
          <select
            value={maxRounds}
            onChange={(e) => setMaxRounds(Number(e.target.value))}
            className="w-full rounded-lg bg-arena-raised border border-arena-border px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-accent transition-colors"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-semibold text-slate-300 block mb-2">
            RAG grounding
          </label>
          <button
            type="button"
            onClick={() => setShowChunks((v) => !v)}
            className={`w-full rounded-lg border px-3.5 py-2.5 text-sm font-medium transition-colors ${
              showChunks
                ? "border-accent/40 bg-accent-soft text-accent"
                : "border-arena-border bg-arena-raised text-slate-400"
            }`}
          >
            {showChunks ? "Show retrieved chunks" : "Hidden"}
          </button>
        </div>
      </div>

      <motion.button
        type="submit"
        disabled={!canStart}
        whileHover={canStart ? { scale: 1.01 } : {}}
        whileTap={canStart ? { scale: 0.98 } : {}}
        className="w-full rounded-xl bg-accent py-3.5 text-sm font-semibold text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent-hover"
      >
        Start Debate
      </motion.button>
    </motion.form>
  );
}
