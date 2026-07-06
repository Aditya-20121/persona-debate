"use client";

import { useState } from "react";
import { PERSONAS } from "@/lib/personas";
import { QUESTION_GROUPS, DEFAULT_QUESTION } from "@/lib/questions";
import { DebateStartPayload } from "@/lib/types";
import PersonaAvatar from "./PersonaAvatar";

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
    // Preserve the fixed mandela/gandhi/marx ordering the backend expects
    const persona_ids = PERSONAS.filter((p) => selected.has(p.id)).map(
      (p) => p.id
    );
    onStart({ question, persona_ids, max_rounds: maxRounds }, showChunks);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-2xl mx-auto rounded-2xl border border-arena-border bg-arena-panel/60 backdrop-blur p-6 sm:p-8 space-y-7"
    >
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">
          Debaters
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PERSONAS.map((p) => {
            const active = selected.has(p.id);
            return (
              <button
                type="button"
                key={p.id}
                onClick={() => togglePersona(p.id)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                  active
                    ? "border-slate-500 bg-white/5"
                    : "border-arena-border bg-transparent opacity-50 hover:opacity-80"
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
              </button>
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
          <div className="flex rounded-lg bg-black/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("preset")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                mode === "preset"
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Choose from list
            </button>
            <button
              type="button"
              onClick={() => setMode("custom")}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                mode === "custom"
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Write my own
            </button>
          </div>
        </div>

        {mode === "preset" ? (
          <select
            value={presetQuestion}
            onChange={(e) => setPresetQuestion(e.target.value)}
            className="w-full rounded-lg bg-black/30 border border-arena-border px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            {QUESTION_GROUPS.map((group) => (
              <optgroup key={group.tier} label={group.tier}>
                {group.questions.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <div>
            <textarea
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="e.g. Is compromise with an unjust system betrayal or wisdom?"
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-lg bg-black/30 border border-arena-border px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
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
            className="w-full rounded-lg bg-black/30 border border-arena-border px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-500"
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
            className={`w-full rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              showChunks
                ? "border-teal-600/50 bg-teal-950/40 text-teal-300"
                : "border-arena-border bg-black/30 text-slate-400"
            }`}
          >
            {showChunks ? "Show retrieved chunks" : "Hidden"}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={!canStart}
        className="w-full rounded-xl bg-gradient-to-r from-teal-600 via-amber-600 to-red-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/30 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
      >
        Start Debate
      </button>
    </form>
  );
}
