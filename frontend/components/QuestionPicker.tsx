"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { QUESTION_GROUPS } from "@/lib/questions";

export default function QuestionPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (question: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-3 rounded-xl bg-arena-raised border px-3.5 py-2.5 text-sm text-left text-white transition-colors ${
          open ? "border-white/40" : "border-arena-border hover:border-white/25"
        }`}
      >
        <span className="truncate">{value}</span>
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          className="shrink-0 text-muted"
        >
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute z-20 mt-2 w-full max-h-80 overflow-y-auto rounded-xl border border-arena-border bg-[hsl(201,60%,16%)] shadow-2xl shadow-black/50 py-1.5"
          >
            {QUESTION_GROUPS.map((group) => (
              <div key={group.tier} className="mb-1 last:mb-0">
                <div className="px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {group.tier}
                </div>
                {group.questions.map((q) => {
                  const active = q === value;
                  return (
                    <button
                      type="button"
                      key={q}
                      onClick={() => {
                        onChange(q);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-white/10 text-white"
                          : "text-white/70 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {q}
                    </button>
                  );
                })}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
