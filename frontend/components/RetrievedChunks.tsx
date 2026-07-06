"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RetrievedChunk } from "@/lib/types";

export default function RetrievedChunks({
  chunks,
}: {
  chunks: RetrievedChunk[];
}) {
  const [open, setOpen] = useState(false);

  if (!chunks || chunks.length === 0) return null;

  return (
    <div className="mt-3 border-t border-arena-border/60 pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.15 }}
          className="inline-block"
        >
          ▸
        </motion.span>
        {open ? "Hide" : "Show"} grounding — {chunks.length} retrieved passage
        {chunks.length !== 1 ? "s" : ""}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-2 space-y-2">
              {chunks.map((chunk, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-black/25 border border-arena-border/60 p-3 text-xs leading-relaxed"
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    {chunk.ethical_dilemma_type &&
                      chunk.ethical_dilemma_type !== "None" && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-700/70 text-zinc-200 font-medium">
                          {chunk.ethical_dilemma_type}
                        </span>
                      )}
                    {chunk.topic_keywords?.slice(0, 4).map((kw, j) => (
                      <span
                        key={j}
                        className="px-1.5 py-0.5 rounded bg-zinc-800/70 text-zinc-400"
                      >
                        {kw}
                      </span>
                    ))}
                    {chunk.page_num != null && (
                      <span className="ml-auto text-zinc-500">
                        p.{chunk.page_num}
                      </span>
                    )}
                  </div>

                  {chunk.philosophical_summary && (
                    <p className="italic text-zinc-300 mb-1.5">
                      "{chunk.philosophical_summary}"
                    </p>
                  )}

                  <p className="text-zinc-500 line-clamp-4">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
