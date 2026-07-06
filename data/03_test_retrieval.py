"""
Retrieval smoke test
====================
Run AFTER Phase 2 to verify the full retrieval path works end-to-end:
BGE query embedding → Supabase dense search → BM25 sparse search → RRF fusion.

  python data/03_test_retrieval.py
  python data/03_test_retrieval.py "Should the oppressed forgive their oppressors?"
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))
load_dotenv(Path(__file__).parent.parent / ".env")

from data.retrieval_v2 import retrieve_context_for_persona  # noqa: E402

DEFAULT_QUESTION = "Is violence ever justified in the pursuit of justice?"
PERSONA_IDS = ["gandhi", "mandela", "marx"]


if __name__ == "__main__":
    question = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_QUESTION

    print("=" * 70)
    print("  Retrieval smoke test")
    print(f"  Question: {question}")
    print("=" * 70)

    all_ok = True
    for pid in PERSONA_IDS:
        t0 = time.time()
        context = retrieve_context_for_persona(persona_id=pid, query=question, k=3)
        elapsed = time.time() - t0

        print(f"\n{'─' * 70}")
        print(f"  {pid.upper()}   ({elapsed:.2f}s)")
        print(f"{'─' * 70}")
        if not context:
            print("  [FAIL] empty context — check Supabase rows and bm25_index.pkl")
            all_ok = False
        else:
            print(context[:1200])
            if len(context) > 1200:
                print(f"  … (+{len(context) - 1200} more chars)")

    print("\n" + "=" * 70)
    print("  RESULT:", "ALL PERSONAS RETRIEVED OK" if all_ok else "FAILURES — see above")
    print("=" * 70)
