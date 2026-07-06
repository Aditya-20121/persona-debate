"""
Retrieval v2 — RRF Fusion
=========================
Drop-in replacement for agents/retrieval.py.

Strategy
--------
1. Dense search  : BGE-large-en-v1.5 query embedding → Supabase cosine search
2. Sparse search : BM25Okapi over the full corpus, filtered to persona_id
3. Fusion        : Reciprocal Rank Fusion (RRF) over the two ranked lists
4. Formatting    : Inject theme/stance headers so the LLM is "primed" before
                   reading the raw passage text

Usage (drop-in)
---------------
Replace every import of `agents.retrieval.retrieve_context_for_persona` with:

    from data.retrieval_v2 import retrieve_context_for_persona

The function signature and return type are identical.
"""

from __future__ import annotations

import os
import pickle
from functools import lru_cache
from pathlib import Path

import numpy as np

# ── Paths & constants ─────────────────────────────────────────────────────────
_DATA_DIR   = Path(__file__).parent
_BM25_PATH  = _DATA_DIR / "bm25_index.pkl"

_EMBED_MODEL_ID = "BAAI/bge-large-en-v1.5"
_SUPABASE_TABLE = "persona_chunks"
_RRF_K          = 60      # RRF smoothing constant (standard value)
_BGE_QUERY_PFX  = "Represent this sentence for searching relevant passages: "


# ─────────────────────────────────────────────────────────────────────────────
# Lazily-loaded singletons (first call pays the load cost, then cached)
# ─────────────────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _embedding_model():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(_EMBED_MODEL_ID)


@lru_cache(maxsize=1)
def _bm25_index() -> dict:
    if not _BM25_PATH.exists():
        raise FileNotFoundError(
            f"BM25 index not found at {_BM25_PATH}. "
            "Run data/02_embed_and_store.py first."
        )
    with open(_BM25_PATH, "rb") as fh:
        return pickle.load(fh)


@lru_cache(maxsize=1)
def _supabase_client():
    from supabase import create_client
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_KEY"]
    return create_client(url, key)


# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Dense retrieval (Supabase pgvector)
# ─────────────────────────────────────────────────────────────────────────────

def _embed_query(query: str) -> list[float]:
    model = _embedding_model()
    vec: np.ndarray = model.encode(
        _BGE_QUERY_PFX + query,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )
    return vec.tolist()


def _dense_search(persona_id: str, query_vec: list[float], k: int) -> list[dict]:
    """
    Returns up to k results from Supabase, ordered by cosine similarity.
    Each result has: content, topic_keywords, ethical_dilemma_type,
    philosophical_summary, chunk_index, page_num, similarity.
    """
    client = _supabase_client()
    result = client.rpc(
        "match_persona_chunks",
        {
            "query_embedding": query_vec,
            "match_count":     k,
            "p_persona_id":    persona_id,
        },
    ).execute()
    return result.data or []


# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — Sparse retrieval (BM25)
# ─────────────────────────────────────────────────────────────────────────────

def _bm25_search(persona_id: str, query: str, k: int) -> list[dict]:
    """
    Returns up to k results from the in-memory BM25 index, filtered to
    the requested persona.
    """
    data  = _bm25_index()
    bm25  = data["bm25"]
    chunks: list[dict] = data["chunks"]
    # Persona → positions map built at index time for O(1) lookup
    persona_map: dict[str, list[int]] = data.get("persona_index_map", {})

    persona_positions = persona_map.get(persona_id, [])
    if not persona_positions:
        return []

    tokens = query.lower().split()
    all_scores: np.ndarray = bm25.get_scores(tokens)

    # Filter to this persona, rank, take top-k
    scored = [(i, float(all_scores[i])) for i in persona_positions]
    scored.sort(key=lambda x: x[1], reverse=True)

    return [
        {**chunks[i], "bm25_score": score}
        for i, score in scored[:k]
    ]


# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Reciprocal Rank Fusion
# ─────────────────────────────────────────────────────────────────────────────

def _rrf_fuse(
    dense_results: list[dict],
    sparse_results: list[dict],
    top_k: int,
) -> list[dict]:
    """
    Combine two ranked lists using RRF.  Deduplication key is the first
    120 characters of the content string.
    """
    rrf_scores: dict[str, float] = {}
    docs:        dict[str, dict]  = {}

    def _key(doc: dict) -> str:
        return doc["content"][:120]

    for rank, doc in enumerate(dense_results):
        doc_key = _key(doc)
        rrf_scores[doc_key] = rrf_scores.get(doc_key, 0.0) + 1.0 / (_RRF_K + rank + 1)
        docs.setdefault(doc_key, doc)

    for rank, doc in enumerate(sparse_results):
        doc_key = _key(doc)
        rrf_scores[doc_key] = rrf_scores.get(doc_key, 0.0) + 1.0 / (_RRF_K + rank + 1)
        docs.setdefault(doc_key, doc)

    ranked = sorted(rrf_scores, key=lambda key: rrf_scores[key], reverse=True)
    return [docs[key] for key in ranked[:top_k]]


# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — Format context for LLM injection
# ─────────────────────────────────────────────────────────────────────────────

def _format_chunks(fused: list[dict]) -> str:
    """
    Each chunk is prefixed with its philosophical metadata so the LLM sees
    both the stance *and* the raw evidence before composing its answer.
    """
    parts: list[str] = []
    for doc in fused:
        keywords = ", ".join(doc.get("topic_keywords", [])) or "—"
        dilemma  = doc.get("ethical_dilemma_type", "")
        summary  = doc.get("philosophical_summary", "")
        content  = doc.get("content", "")

        header = f"[Theme: {keywords}]"
        if dilemma and dilemma != "None":
            header += f"  [Dilemma type: {dilemma}]"
        if summary:
            header += f"\n[Stance: {summary}]"

        parts.append(f"{header}\n\n{content}")

    return "\n\n---\n\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Public API  (same signature as the original agents/retrieval.py)
# ─────────────────────────────────────────────────────────────────────────────

def retrieve_context_for_persona(
    persona_id: str,
    query:      str,
    k:          int = 5,
) -> str:
    """
    Retrieve the top-k most relevant passages for *persona_id* given *query*.

    Uses dense (BGE cosine) + sparse (BM25) search fused via RRF.
    Returns a formatted string ready to be injected into the LLM system prompt.
    Returns "" on any failure so the debate continues without context.

    Parameters
    ----------
    persona_id : str   one of "gandhi", "mandela", "marx"
    query      : str   the debate question / topic
    k          : int   final number of passages to return after fusion

    Returns
    -------
    str  formatted context block, or "" if retrieval fails
    """
    try:
        fetch_k = k * 3   # over-fetch before fusion so RRF has room to rerank

        query_vec  = _embed_query(query)
        dense      = _dense_search(persona_id, query_vec, fetch_k)
        sparse     = _bm25_search(persona_id, query, fetch_k)
        fused      = _rrf_fuse(dense, sparse, top_k=k)

        if not fused:
            return ""

        return _format_chunks(fused)

    except FileNotFoundError as exc:
        # BM25 index missing — probably haven't run Phase 2 yet
        print(f"[WARN] {exc}")
        return ""
    except Exception as exc:
        print(f"[WARN] Retrieval failed for persona='{persona_id}': {exc}")
        return ""
