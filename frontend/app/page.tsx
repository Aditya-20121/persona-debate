"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Hero from "@/components/Hero";
import DebateSetupForm from "@/components/DebateSetupForm";
import DebateTranscript from "@/components/DebateTranscript";
import { streamDebate } from "@/lib/api";
import { personaById } from "@/lib/personas";
import { DebateEvent, DebateStartPayload, Persona } from "@/lib/types";

type Stage = "hero" | "setup" | "running" | "done";

// Minimum time each message stays alone on screen before the next queued
// one appears. Turns usually arrive 15-60s apart anyway; this only matters
// when several events land close together — without it they'd all render
// in the same frame.
const REVEAL_DWELL_MS = 1800;

export default function Home() {
  const [stage, setStage] = useState<Stage>("hero");
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

  if (stage === "hero") {
    return <Hero onBegin={() => setStage("setup")} />;
  }

  return (
    <main className="min-h-screen px-4 pb-16">
      <nav className="flex items-center justify-between max-w-3xl mx-auto py-6 mb-8">
        <button
          onClick={() => {
            handleReset();
            setStage("hero");
          }}
          className="font-display text-2xl tracking-tight text-white"
        >
          Debate Arena
        </button>
        {stage !== "setup" && (
          <button
            onClick={handleReset}
            className="liquid-glass rounded-full px-5 py-2 text-xs text-white hover:scale-[1.03] transition-transform"
          >
            New debate
          </button>
        )}
      </nav>

      <AnimatePresence mode="wait">
        {stage === "setup" ? (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div className="max-w-2xl mx-auto text-center mb-10">
              <h1 className="font-display text-4xl sm:text-5xl leading-[0.95] tracking-[-1.5px] text-white">
                Set the <em className="not-italic text-muted">stage.</em>
              </h1>
              <p className="mt-4 text-sm text-muted leading-relaxed">
                Choose your debaters, put forward a motion, and watch it
                unfold.
              </p>
            </div>
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
              <div className="mb-10 text-center border-b border-arena-border pb-8">
                <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted mb-3">
                  The motion
                </div>
                <div className="font-display text-2xl sm:text-3xl text-white leading-tight max-w-2xl mx-auto">
                  {payload.question}
                </div>
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
                <div className="mt-10 text-center text-[11px] uppercase tracking-[0.18em] text-muted">
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
