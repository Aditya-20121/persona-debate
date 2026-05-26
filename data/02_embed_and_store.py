"""
Phase 2 — Embed & Store
=======================
Loads the tagged JSONL files produced by Phase 1, embeds them with
BAAI/bge-large-en-v1.5 (local, sentence-transformers), upserts to
Supabase, and builds a persisted BM25 index.

Run AFTER Phase 1 is fully complete:
  python data/02_embed_and_store.py

Prerequisites:
  pip install sentence-transformers rank-bm25 torch supabase python-dotenv
  SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env
  supabase_v2_setup.sql must have been run in your Supabase project
"""

from __future__ import annotations

import json
import os
import pickle
import sys
from pathlib import Path

import numpy as np
from dotenv import load_dotenv

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent
PROCESSED_DIR = DATA_DIR / "processed"
BM25_PATH = DATA_DIR / "bm25_index.pkl"

load_dotenv(DATA_DIR.parent / ".env")

# ── Config ────────────────────────────────────────────────────────────────────
EMBEDDING_MODEL_ID = "BAAI/bge-large-en-v1.5"
SUPABASE_TABLE     = "persona_chunks"
EMBED_BATCH_SIZE   = 32    # chunks per GPU batch
UPSERT_BATCH_SIZE  = 50    # rows per Supabase insert call

# BGE asymmetric retrieval: queries get a prefix, passages do not.
BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


# ─────────────────────────────────────────────────────────────────────────────
# Data loading
# ─────────────────────────────────────────────────────────────────────────────

def load_all_chunks() -> list[dict]:
    chunks: list[dict] = []
    jsonl_files = sorted(PROCESSED_DIR.glob("*_tagged.jsonl"))
    if not jsonl_files:
        print(f"[ERROR] No *_tagged.jsonl files found in {PROCESSED_DIR}")
        print("        Run Phase 1 first:  python data/01_parse_and_tag.py")
        sys.exit(1)

    for path in jsonl_files:
        count_before = len(chunks)
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        chunks.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        print(f"  {path.name:<35}  {len(chunks) - count_before:>5} chunks")

    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# Embedding
# ─────────────────────────────────────────────────────────────────────────────

def embed_passages(texts: list[str], model) -> np.ndarray:
    """
    Encode passage texts (no prefix) in batches.
    Returns float32 array of shape (N, dim), L2-normalised.
    """
    embeddings = model.encode(
        texts,
        batch_size=EMBED_BATCH_SIZE,
        show_progress_bar=True,
        normalize_embeddings=True,   # cosine similarity = dot product after this
        convert_to_numpy=True,
    )
    return embeddings.astype("float32")


# ─────────────────────────────────────────────────────────────────────────────
# Supabase upsert
# ─────────────────────────────────────────────────────────────────────────────

def upsert_to_supabase(chunks: list[dict], embeddings: np.ndarray, client) -> None:
    # Delete existing rows per persona so re-running is safe
    persona_ids = sorted({c["persona_id"] for c in chunks})
    for pid in persona_ids:
        client.table(SUPABASE_TABLE).delete().eq("persona_id", pid).execute()
        print(f"  Cleared existing rows for persona_id='{pid}'")

    print(f"  Inserting {len(chunks)} rows in batches of {UPSERT_BATCH_SIZE}…")
    for start in range(0, len(chunks), UPSERT_BATCH_SIZE):
        end = min(start + UPSERT_BATCH_SIZE, len(chunks))
        batch_c = chunks[start:end]
        batch_e = embeddings[start:end]

        rows = [
            {
                "persona_id":            c["persona_id"],
                "content":               c["content"],
                "topic_keywords":        c.get("topic_keywords", []),
                "ethical_dilemma_type":  c.get("ethical_dilemma_type", "None"),
                "philosophical_summary": c.get("philosophical_summary", ""),
                "chunk_index":           c["chunk_index"],
                "page_num":              c.get("page_num"),
                "source":                c.get("source", ""),
                "embedding":             e.tolist(),
            }
            for c, e in zip(batch_c, batch_e)
        ]
        client.table(SUPABASE_TABLE).insert(rows).execute()
        print(f"  Rows {start + 1:>5} – {end:>5}  inserted")


# ─────────────────────────────────────────────────────────────────────────────
# BM25 index
# ─────────────────────────────────────────────────────────────────────────────

def build_and_save_bm25(chunks: list[dict]) -> None:
    from rank_bm25 import BM25Okapi

    print(f"  Tokenising {len(chunks)} documents…")
    tokenised = [c["content"].lower().split() for c in chunks]
    bm25 = BM25Okapi(tokenised)

    # Store the index together with the lightweight chunk metadata needed at
    # retrieval time (we deliberately exclude the raw embeddings to keep the
    # file small — those live in Supabase).
    index_data = {
        "bm25": bm25,
        "chunks": [
            {
                "persona_id":            c["persona_id"],
                "content":               c["content"],
                "chunk_index":           c["chunk_index"],
                "topic_keywords":        c.get("topic_keywords", []),
                "ethical_dilemma_type":  c.get("ethical_dilemma_type", "None"),
                "philosophical_summary": c.get("philosophical_summary", ""),
            }
            for c in chunks
        ],
        # Pre-build a persona → index map so retrieval doesn't scan the list
        "persona_index_map": _build_persona_map(chunks),
    }

    with open(BM25_PATH, "wb") as fh:
        pickle.dump(index_data, fh, protocol=pickle.HIGHEST_PROTOCOL)

    size_mb = BM25_PATH.stat().st_size / 1024 / 1024
    print(f"  BM25 index saved → {BM25_PATH}  ({size_mb:.1f} MB)")


def _build_persona_map(chunks: list[dict]) -> dict[str, list[int]]:
    """Map persona_id → list of integer positions in the chunks list."""
    mapping: dict[str, list[int]] = {}
    for i, c in enumerate(chunks):
        mapping.setdefault(c["persona_id"], []).append(i)
    return mapping


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from sentence_transformers import SentenceTransformer
    from supabase import create_client

    print("=" * 60)
    print("  Debate Arena — Phase 2: Embed & Store")
    print("=" * 60)

    # ── Step 1: Load tagged chunks ────────────────────────────────────────────
    print("\n[1/4]  Loading tagged JSONL files from data/processed/…")
    chunks = load_all_chunks()
    print(f"       Total chunks: {len(chunks)}")

    # ── Step 2: Load BGE model ────────────────────────────────────────────────
    print(f"\n[2/4]  Loading embedding model '{EMBEDDING_MODEL_ID}'…")
    print("       (first run downloads ~1.3 GB — subsequent runs use cache)")
    model = SentenceTransformer(EMBEDDING_MODEL_ID)
    dim = model.get_sentence_embedding_dimension()
    print(f"       Embedding dim: {dim}")
    if dim != 1024:
        print(f"[WARN] Expected 1024-dim for BGE-large; got {dim}.")
        print("       Update VECTOR({dim}) in supabase_v2_setup.sql if needed.")

    # ── Step 3: Embed ─────────────────────────────────────────────────────────
    print(f"\n[3/4]  Embedding {len(chunks)} passage chunks…")
    texts = [c["content"] for c in chunks]
    embeddings = embed_passages(texts, model)
    print(f"       Done.  Shape: {embeddings.shape}")

    # ── Step 4a: Supabase upsert ──────────────────────────────────────────────
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not supabase_url or not supabase_key:
        print("\n[ERROR] SUPABASE_URL or SUPABASE_SERVICE_KEY not set in .env")
        sys.exit(1)

    print("\n[4/4]  Storing in Supabase + building BM25 index…")
    client = create_client(supabase_url, supabase_key)
    upsert_to_supabase(chunks, embeddings, client)

    # ── Step 4b: BM25 ────────────────────────────────────────────────────────
    build_and_save_bm25(chunks)

    print("\n" + "=" * 60)
    print("  Phase 2 complete.")
    print("  Dense vectors  → Supabase table 'persona_chunks'")
    print(f"  Sparse index   → {BM25_PATH}")
    print("  agents/debate_graph.py already imports data.retrieval_v2 — no further changes needed.")
    print("=" * 60)
