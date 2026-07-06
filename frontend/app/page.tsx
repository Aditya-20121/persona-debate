"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import DebateSetupForm from "@/components/DebateSetupForm";
import DebateTranscript from "@/components/DebateTranscript";
import { streamDebate } from "@/lib/api";
import { personaById } from "@/lib/personas";
import { DebateEvent, DebateStartPayload, Persona } from "@/lib/types";

type Stage = "setup" | "running" | "done";

// Minimum time each message stays alone on screen before the next queued
// one appears. Turns usually arrive 15-60s apart anyway; this only matters
// when several events land close together — without it they'd all render
// in the same frame.
const REVEAL_DWELL_MS = 1800;

export default function Home() {
  const [stage, setStage] = useState<Stage>("setup");
  const [payload, setPayload] = useState<DebateStartPayload | null>(null);
  const [visible, setVisible] = useState<DebateEvent[]>([]);
  const [showChunks, setShowChunks] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<DebateEvent[]>([]);
  const revealingRef = useRef(false);
  const streamEndedRef = useRef(false);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    };
  }, []);

  function maybeFinish() {
    if (
      streamEndedRef.current &&
      queueRef.current.length === 0 &&
      !revealingRef.current
    ) {
      setStage((s) => (s === "running" ? "done" : s));
    }
  }

  function pump() {
    if (revealingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      maybeFinish();
      return;
    }
    revealingRef.current = true;
    setVisible((v) => [...v, next]);
    dwellTimerRef.current = setTimeout(() => {
      revealingRef.current = false;
      pump();
    }, REVEAL_DWELL_MS);
  }

  function handleStart(p: DebateStartPayload, chunks: boolean) {
    setPayload(p);
    setShowChunks(chunks);
    setVisible([]);
    setError(null);
    setStage("running");
    queueRef.current = [];
    revealingRef.current = false;
    streamEndedRef.current = false;

    const controller = new AbortController();
    abortRef.current = controller;

    streamDebate(
      p,
      (evt) => {
        if (evt.type === "message") {
          queueRef.current.push(evt);
          pump();
        } else if (evt.type === "error") {
          setError(evt.error || "The debate stream encountered an error.");
        }
        // "done" is handled when the stream closes (finally below), after
        // the reveal queue drains.
      },
      controller.signal
    )
      .catch((err) => {
        if (err?.name !== "AbortError") {
          setError(err?.message ?? "Failed to reach the debate server.");
        }
      })
      .finally(() => {
        streamEndedRef.current = true;
        maybeFinish();
      });
  }

  function handleReset() {
    abortRef.current?.abort();
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    queueRef.current = [];
    revealingRef.current = false;
    streamEndedRef.current = false;
    setStage("setup");
    setPayload(null);
    setVisible([]);
    setError(null);
  }

  const nextPersona: Persona | null =
    payload && payload.persona_ids.length > 0
      ? personaById(
          payload.persona_ids[visible.length % payload.persona_ids.length]
        ) ?? null
      : null;

  return (
    <main className="min-h-screen px-4 py-12 sm:py-16">
      <div className="max-w-2xl mx-auto mb-12 text-center">
        <h1 className="font-serif text-4xl sm:text-5xl font-semibold tracking-tight text-zinc-50">
          Debate Arena
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          Gandhi, Mandela, and Marx — arguing in their own voice, grounded in
          their real writings.
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
              className="max-w-2xl mx-auto"
            >
              <div className="flex items-start justify-between gap-4 mb-8 border-b border-arena-border pb-5">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500 mb-1">
                    The motion
                  </div>
                  <div className="font-serif text-lg text-zinc-100 leading-snug">
                    {payload.question}
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md border border-arena-border text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 transition-colors"
                >
                  New debate
                </button>
              </div>

              <DebateTranscript
                messages={visible}
                maxRounds={payload.max_rounds}
                showChunks={showChunks}
                isStreaming={stage === "running"}
                nextPersona={stage === "running" ? nextPersona : null}
                errorText={error}
              />

              {stage === "done" && !error && (
                <div className="mt-8 text-center text-[11px] uppercase tracking-[0.14em] text-zinc-600">
                  — Debate concluded —
                </div>
              )}
            </motion.div>
          )
        )}
      </AnimatePresence>
    </main>
  );
}
