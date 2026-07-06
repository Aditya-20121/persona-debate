"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import DebateSetupForm from "@/components/DebateSetupForm";
import DebateTranscript from "@/components/DebateTranscript";
import { streamDebate } from "@/lib/api";
import { personaById } from "@/lib/personas";
import { DebateEvent, DebateStartPayload, Persona } from "@/lib/types";

type Stage = "setup" | "running" | "done";

export default function Home() {
  const [stage, setStage] = useState<Stage>("setup");
  const [payload, setPayload] = useState<DebateStartPayload | null>(null);
  const [messages, setMessages] = useState<DebateEvent[]>([]);
  const [showChunks, setShowChunks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function handleStart(p: DebateStartPayload, chunks: boolean) {
    setPayload(p);
    setShowChunks(chunks);
    setMessages([]);
    setError(null);
    setStage("running");

    const controller = new AbortController();
    abortRef.current = controller;

    streamDebate(
      p,
      (evt) => {
        if (evt.type === "message") {
          setMessages((prev) => [...prev, evt]);
        } else if (evt.type === "error") {
          setError(evt.error || "The debate stream encountered an error.");
        } else if (evt.type === "done") {
          setStage("done");
        }
      },
      controller.signal
    )
      .catch((err) => {
        if (err?.name !== "AbortError") {
          setError(err?.message ?? "Failed to reach the debate server.");
        }
      })
      .finally(() => {
        setStage((s) => (s === "running" ? "done" : s));
      });
  }

  function handleReset() {
    abortRef.current?.abort();
    setStage("setup");
    setPayload(null);
    setMessages([]);
    setError(null);
  }

  const nextPersona: Persona | null =
    payload && payload.persona_ids.length > 0
      ? personaById(
          payload.persona_ids[messages.length % payload.persona_ids.length]
        ) ?? null
      : null;

  return (
    <main className="min-h-screen px-4 py-10 sm:py-16">
      <div className="max-w-3xl mx-auto mb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Debate Arena
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Gandhi, Mandela, and Marx — arguing in their own voice, grounded in
          their real writings via hybrid RAG.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {stage === "setup" ? (
          <motion.div
            key="setup"
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <DebateSetupForm onStart={handleStart} />
          </motion.div>
        ) : (
          payload && (
            <motion.div
              key="debate"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="max-w-3xl mx-auto"
            >
              <div className="flex items-start justify-between gap-4 mb-6 rounded-xl border border-arena-border bg-arena-panel px-4 py-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-0.5">
                    Debating
                  </div>
                  <div className="text-sm font-medium text-slate-200">
                    {payload.question}
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-arena-border text-slate-300 hover:bg-white/5 transition-colors"
                >
                  New debate
                </button>
              </div>

              <DebateTranscript
                messages={messages}
                maxRounds={payload.max_rounds}
                showChunks={showChunks}
                isStreaming={stage === "running"}
                nextPersona={stage === "running" ? nextPersona : null}
                errorText={error}
              />

              {stage === "done" && !error && (
                <div className="mt-6 text-center text-xs text-slate-500">
                  Debate complete.
                </div>
              )}
            </motion.div>
          )
        )}
      </AnimatePresence>
    </main>
  );
}
