# Data Pipeline — Persona Knowledge Base

This folder contains the full preprocessing, embedding, and retrieval pipeline that converts
biography PDFs into a hybrid RAG knowledge base for each debate persona.

---

## Overview

The pipeline is split into two offline phases and one runtime module:

| Component | Role |
|---|---|
| `01_parse_and_tag.py` | Extract PDF text → clean chunks → LLM philosophical tagging → JSONL |
| `02_embed_and_store.py` | Load JSONL → BGE-large embeddings → Supabase upsert + BM25 index |
| `retrieval_v2.py` | Runtime: hybrid dense + sparse retrieval with RRF fusion |
| `supabase_v2_setup.sql` | One-time Supabase schema setup |
| `requirements_rag.txt` | Python dependencies for this pipeline |

---

## Folder Structure

```
data/
├── gandhi.pdf                   biography source (not committed — provide your own)
├── mandela.pdf
├── karl-marx.docx               .docx sources are supported alongside .pdf
│
├── 01_parse_and_tag.py
├── 02_embed_and_store.py
├── retrieval_v2.py
├── supabase_v2_setup.sql
├── requirements_rag.txt
│
├── processed/                   created by Phase 1
│   ├── gandhi_tagged.jsonl
│   ├── mandela_tagged.jsonl
│   └── marx_tagged.jsonl
│
└── bm25_index.pkl               created by Phase 2
```

---

## Dependencies

```bash
pip install -r data/requirements_rag.txt
```

| Package | Version | Purpose |
|---|---|---|
| `pymupdf` | ≥1.24.0 | PDF text extraction |
| `sentence-transformers` | ≥3.0.0 | BGE-large-en-v1.5 encoding |
| `torch` | ≥2.2.0 | GPU backend |
| `rank-bm25` | ≥0.2.2 | Sparse BM25 index |
| `requests` | ≥2.31.0 | Ollama HTTP client |
| `supabase` | ≥2.10.0 | Vector store client |

**GPU install for PyTorch (CUDA 12.1):**
```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

---

## Step 0 — Supabase Schema Setup

Run `data/supabase_v2_setup.sql` once in your **Supabase SQL Editor** before running any pipeline scripts.

This creates:
- `persona_chunks` table — stores content, metadata, and `VECTOR(1024)` embeddings
- B-tree index on `persona_id` — fast per-persona filtering
- GIN index on `topic_keywords` — array query support
- `match_persona_chunks(query_embedding, match_count, p_persona_id)` — cosine similarity RPC function

> The IVFFlat vector index is intentionally **not** created here. IVFFlat requires
> data to be present to build its cluster centroids. Create it after Phase 2 completes
> (see Step 3 below).

---

## Step 1 — Parse & Tag (`01_parse_and_tag.py`)

**Requires:** `SEGMIND_API_KEY` set in `.env` (same key used by the debate agents).

### What it does

1. **Extract** — PyMuPDF reads each PDF page by page
2. **Clean** — rejoins hyphenated line-breaks, removes isolated page numbers, collapses whitespace
3. **Filter** — skips boilerplate pages: TOC (dot-leader detection), copyright, bibliography, index, short pages (<30 words)
4. **Chunk** — sliding-window splitter, ~1,500 characters per chunk, 300-character overlap, snaps to sentence boundaries
5. **Tag** — each chunk is sent to Llama 3.1 8B via Segmind API which returns structured JSON:
   - `topic_keywords` — 3–5 core themes
   - `ethical_dilemma_type` — one of 11 fixed categories (see taxonomy below)
   - `philosophical_summary` — one sentence capturing the moral stance
6. **Save** — appends one JSON record per line to `data/processed/<persona>_tagged.jsonl`, flushing after every record

### Run

```bash
# Process all three personas
python data/01_parse_and_tag.py

# Process a single persona (useful for resuming or re-running one file)
python data/01_parse_and_tag.py gandhi
python data/01_parse_and_tag.py mandela
python data/01_parse_and_tag.py marx
```

### Sample output

```
============================================================
  Debate Arena — Phase 1: Parse & Tag
============================================================

  Persona : gandhi  ←  gandhi.pdf
  Pages extracted      : 487
  Chunks produced      : 724
  Chunks to process    : 724

  [   1/ 724   0.1%]  chunk    0  (p.12)  …  [2.3s]  Ahimsa, Non-violence, British Rule
  [   2/ 724   0.3%]  chunk    1  (p.13)  …  [1.9s]  Satyagraha, Truth-force, Resistance
  ...
```

**Estimated time:** ~2–4 seconds per chunk on 8 GB GPU → ~2–3 hours for all three personas.

**Resume support:** The script tracks processed `chunk_index` values in the JSONL file.
If interrupted, re-running automatically skips completed chunks and continues from where it stopped.

### Output format (one line per chunk)

```json
{
  "persona_id": "gandhi",
  "chunk_index": 42,
  "page_num": 87,
  "content": "Gandhi believed that...",
  "source": "/path/to/gandhi.pdf",
  "topic_keywords": ["Ahimsa", "Civil Disobedience", "Colonial Resistance"],
  "ethical_dilemma_type": "Violence vs. Non-violence",
  "philosophical_summary": "True strength lies in voluntary suffering that exposes injustice."
}
```

---

## Step 2 — Embed & Store (`02_embed_and_store.py`)

**Requires:** Phase 1 complete for all three personas. `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set in `.env`.

### What it does

1. **Load** — reads all `data/processed/*_tagged.jsonl` files into memory
2. **Model** — downloads (first run only, ~1.3 GB) and loads `BAAI/bge-large-en-v1.5` via `sentence-transformers`
3. **Embed** — encodes all passage texts in GPU batches of 32 → 1024-dimensional normalised float32 vectors
4. **Store (dense)** — clears existing rows per persona in Supabase, then batch-inserts all chunks with their embeddings
5. **Store (sparse)** — builds a `BM25Okapi` index over all chunks, pre-computes a `persona_id → positions` lookup map, serialises to `data/bm25_index.pkl`

### Run

```bash
python data/02_embed_and_store.py
```

### Sample output

```
[1/4]  Loading tagged JSONL files from data/processed/…
  gandhi_tagged.jsonl      724 chunks
  mandela_tagged.jsonl     711 chunks
  marx_tagged.jsonl        698 chunks
  Total chunks: 2133

[2/4]  Loading embedding model 'BAAI/bge-large-en-v1.5'…
  Embedding dim: 1024

[3/4]  Embedding 2133 passage chunks…
  100%|████████████████| 67/67 [08:42<00:00]

[4/4]  Storing in Supabase + building BM25 index…
  Cleared existing rows for persona_id='gandhi'
  Cleared existing rows for persona_id='mandela'
  Cleared existing rows for persona_id='marx'
  Inserting 2133 rows in batches of 50…
  BM25 index saved → data/bm25_index.pkl  (12.3 MB)
```

**Estimated time:** ~10–20 minutes (embedding dominates).

### Step 2b — Create the IVFFlat index (after data is loaded)

Run this in your **Supabase SQL Editor** immediately after Phase 2 completes:

```sql
CREATE INDEX idx_persona_chunks_embedding
    ON persona_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);
```

> If you already ran Phase 2 before creating the index, run `REINDEX TABLE persona_chunks;` instead.

---

## Runtime Retrieval (`retrieval_v2.py`)

This module is imported directly by `agents/debate_graph.py` and called once per agent turn.

### Function signature

```python
retrieve_context_for_persona(
    persona_id: str,   # "gandhi" | "mandela" | "marx"
    query:      str,   # the debate question
    k:          int,   # number of final passages to return (default: 5)
) -> str              # formatted context block, or "" if retrieval fails
```

### Retrieval pipeline

```
debate question
      │
      ├── embed with BGE-large (query prefix) ──► Supabase cosine search
      │                                            filtered by persona_id
      │                                            → top 15 dense results
      │
      └── tokenise + BM25.get_scores() ─────────► persona-filtered ranking
                                                   from bm25_index.pkl
                                                   → top 15 sparse results
                                          │
                                          ▼
                            Reciprocal Rank Fusion  (RRF, k=60)
                            deduplication on first 120 chars of content
                                          │
                                          ▼
                                  top 5 fused results
                                          │
                                          ▼
                          formatted with metadata headers:

                          [Theme: Ahimsa, Civil Disobedience]
                          [Dilemma type: Violence vs. Non-violence]
                          [Stance: Soul-force ultimately prevails over brute force.]

                          <raw passage text>

                          ---
                          (next passage)
                                          │
                                          ▼
                          injected into Llama 3.1 8B system prompt
```

### Design decisions

| Decision | Reason |
|---|---|
| BGE asymmetric encoding | Queries use `"Represent this sentence for searching relevant passages: "` prefix; passages are encoded without prefix — matches BGE-large-en-v1.5 training setup |
| Over-fetch before fusion | Both retrievers fetch `k × 3 = 15` candidates so RRF has enough diversity to rerank meaningfully |
| Metadata headers in context | LLM sees the philosophical framing (theme, dilemma type, stance) before the raw text — primes the model with the persona's logic, not just facts |
| Non-fatal fallback | Any retrieval failure returns `""` — the debate continues without context rather than crashing |
| `lru_cache(maxsize=1)` on all singletons | BGE model, BM25 index, and Supabase client are loaded once per server process and reused across all requests |

---

## Tagging Taxonomy

The `ethical_dilemma_type` field uses a fixed 11-value vocabulary applied by the tagging LLM:

| Value | Applied when the chunk deals with... |
|---|---|
| `Conflict Resolution` | Navigating disputes between groups or individuals |
| `Duty vs. Desire` | Personal obligation conflicting with self-interest |
| `Personal Integrity` | Upholding principles under pressure or threat |
| `Justice vs. Mercy` | Punishment versus forgiveness |
| `Individual vs. Collective` | Personal rights versus group welfare |
| `Violence vs. Non-violence` | Moral legitimacy of force |
| `Means vs. Ends` | Whether methods are justified by outcomes |
| `Power and Leadership` | Responsibility and corruption of authority |
| `Identity and Belonging` | Nation, race, religion, community |
| `Historical Context` | Factual or narrative content with no clear ethical dilemma |
| `None` | Chunk contains no identifiable ethical stance |

---

## Re-running the Pipeline

Both scripts are idempotent and safe to re-run:

| Scenario | Action |
|---|---|
| Phase 1 interrupted mid-way | Re-run `01_parse_and_tag.py` — already-tagged chunks are skipped |
| Re-tag a single persona | Delete `data/processed/<persona>_tagged.jsonl`, re-run `01_parse_and_tag.py <persona>` |
| Re-embed after editing tags | Re-run `02_embed_and_store.py` — deletes and re-inserts all rows before uploading |
| Full reset | Delete all JSONL files in `processed/` and `bm25_index.pkl`, re-run both scripts |
