"use client";

import { useState } from "react";
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
        className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>
          ▸
        </span>
        {open ? "Hide" : "Show"} grounding — {chunks.length} retrieved passage
        {chunks.length !== 1 ? "s" : ""}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {chunks.map((chunk, i) => (
            <div
              key={i}
              className="rounded-lg bg-black/30 border border-arena-border/60 p-3 text-xs leading-relaxed"
            >
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                {chunk.ethical_dilemma_type &&
                  chunk.ethical_dilemma_type !== "None" && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-700/70 text-slate-200 font-medium">
                      {chunk.ethical_dilemma_type}
                    </span>
                  )}
                {chunk.topic_keywords?.slice(0, 4).map((kw, j) => (
                  <span
                    key={j}
                    className="px-1.5 py-0.5 rounded bg-slate-800/70 text-slate-400"
                  >
                    {kw}
                  </span>
                ))}
                {chunk.page_num != null && (
                  <span className="ml-auto text-slate-500">
                    p.{chunk.page_num}
                  </span>
                )}
              </div>

              {chunk.philosophical_summary && (
                <p className="italic text-slate-300 mb-1.5">
                  "{chunk.philosophical_summary}"
                </p>
              )}

              <p className="text-slate-500 line-clamp-4">{chunk.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
