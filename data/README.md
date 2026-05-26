# data/ — Persona Knowledge Pipeline

This folder contains everything needed to convert the three biography PDFs into
a production-quality RAG knowledge base that powers the Debate Arena personas.

---

## Why this exists

The original system stored hand-written `.txt` summaries for each persona and
retrieved them with Jina embeddings.  This pipeline replaces that with:

- **Full biographies** (500-page PDFs) as the knowledge source
- **Philosophical tagging** of every chunk (themes, dilemma type, moral stance)
  so the retriever returns *mindset*, not just facts
- **Hybrid retrieval** (dense BGE + sparse BM25) fused with RRF for higher
  recall than either method alone
- **Rich context headers** injected into every prompt so Claude is primed with
  the persona's worldview before reading the raw evidence

---

## Folder contents

```
data/
├── gandhi.pdf                  source biography
├── hitler.pdf                  source biography
├── mandela.pdf                 source biography
│
├── 01_parse_and_tag.py         Phase 1 — PDF → cleaned chunks → LLM tagging → JSONL
├── 02_embed_and_store.py       Phase 2 — JSONL → BGE embeddings → Supabase + BM25
├── retrieval_v2.py             Runtime retrieval module (used by the debate graph)
├── supabase_v2_setup.sql       Supabase schema (run once before Phase 2)
├── requirements_rag.txt        Additional pip dependencies for the pipeline
│
└── processed/                  Auto-created by Phase 1
    ├── gandhi_tagged.jsonl     Tagged chunks — one JSON record per line
    ├── hitler_tagged.jsonl
    └── mandela_tagged.jsonl
```

`bm25_index.pkl` is created by Phase 2 and also lives in this folder.

---

## Prerequisites

### 1. Install dependencies

```bash
pip install -r data/requirements_rag.txt
```

Key packages:
| Package | Purpose |
|---|---|
| `pymupdf` | PDF text extraction |
| `requests` | HTTP calls to the local Ollama server |
| `sentence-transformers` | BGE-large-en-v1.5 passage/query encoding |
| `torch` | GPU backend for sentence-transformers |
| `rank-bm25` | BM25Okapi sparse index |

### 2. Install and start Ollama

Ollama runs the small local LLM used for tagging each chunk.

```bash
# Download Ollama from https://ollama.com and install it, then:
ollama serve                   # keep this running in a separate terminal
ollama pull qwen2.5:1.5b       # ~1 GB download, needed for Phase 1 tagging
```

### 3. Set up Supabase (run once)

Open your Supabase project → SQL editor → paste and run **`data/supabase_v2_setup.sql`**.

This creates:
- Table `persona_chunks` with `VECTOR(1024)` column for BGE embeddings
- B-tree index on `persona_id` for fast filtering
- GIN index on `topic_keywords` for array queries
- SQL function `match_persona_chunks(query_embedding, match_count, p_persona_id)`
  used by the Python retriever

> **Important — IVFFlat index:** The setup SQL deliberately leaves the vector
> similarity index commented out.  IVFFlat needs data to initialise its
> cluster centroids.  After Phase 2 finishes inserting rows, run this in
> Supabase SQL editor:
> ```sql
> CREATE INDEX idx_persona_chunks_embedding
>     ON persona_chunks
>     USING ivfflat (embedding vector_cosine_ops)
>     WITH (lists = 50);
> ```

---

## Running the pipeline

### Phase 1 — Parse & Tag  (`01_parse_and_tag.py`)

**What it does:**

1. Opens each PDF with PyMuPDF page by page
2. Cleans the raw text: rejoins hyphenated line-breaks, strips page numbers,
   collapses whitespace
3. Filters boilerplate pages: TOC (dot-leader detection), copyright, bibliography,
   index, pages with fewer than 30 words
4. Applies a sliding-window chunker (~1 500 characters, 300-character overlap)
   that snaps to the nearest sentence boundary
5. For each chunk, calls **Qwen2.5-1.5B** locally via Ollama with a structured
   prompt that extracts:
   - `topic_keywords` — 3–5 core themes (e.g. "Non-violence", "Civil Disobedience")
   - `ethical_dilemma_type` — one of 11 fixed categories
   - `philosophical_summary` — one sentence capturing the moral stance
6. Writes one JSON record per chunk to `data/processed/<persona>_tagged.jsonl`
   and flushes after each line (**crash-safe**)

**Run it:**

```bash
# All three personas
python data/01_parse_and_tag.py

# Single persona (useful for testing or re-running one file)
python data/01_parse_and_tag.py gandhi
python data/01_parse_and_tag.py mandela
python data/01_parse_and_tag.py hitler
```

**Expected output (sample):**

```
============================================================
  Debate Arena — Phase 1: Parse & Tag
============================================================

────────────────────────────────────────────────────────────
  Persona : gandhi  ←  gandhi.pdf
  Extracting pages…
  Pages extracted      : 487
  Chunking…
  Chunks produced      : 724
  Chunks to process    : 724
  [   1/ 724   0.1%]  chunk    0  (p.12)  …  [2.3s]  Ahimsa, Non-violence, British Rule
  [   2/ 724   0.3%]  chunk    1  (p.12)  …  [1.9s]  Satyagraha, Truth-force, Resistance
  ...
```

**Estimated time:** ~2–4 seconds per chunk on 8 GB GPU.
For 3 × ~700 chunks ≈ 2–3 hours total.

**Resume support:** If the script is interrupted, re-running it will skip
already-tagged chunks (identified by `chunk_index`) and continue from where it
left off. You can safely Ctrl-C and restart.

---

### Phase 2 — Embed & Store  (`02_embed_and_store.py`)

**Prerequisites:** Phase 1 must be 100% complete for all three personas.

**What it does:**

1. Loads all `data/processed/*_tagged.jsonl` files into memory
2. Downloads (first run only, ~1.3 GB) and loads **BAAI/bge-large-en-v1.5**
   via `sentence-transformers`
3. Encodes every passage text in GPU batches of 32 → 1024-dimensional
   normalised float32 vectors
4. Connects to Supabase, deletes any existing rows for each persona (idempotent
   re-runs are safe), then batch-inserts all rows with their embeddings
5. Tokenises every chunk for BM25 and builds a **BM25Okapi** index over the
   full corpus, pre-computing a `persona_id → chunk positions` lookup map
6. Serialises the BM25 index + chunk metadata to `data/bm25_index.pkl`

**Run it:**

```bash
python data/02_embed_and_store.py
```

**Expected output:**

```
============================================================
  Debate Arena — Phase 2: Embed & Store
============================================================

[1/4]  Loading tagged JSONL files from data/processed/…
  gandhi_tagged.jsonl                    724 chunks
  hitler_tagged.jsonl                    698 chunks
  mandela_tagged.jsonl                   711 chunks
       Total chunks: 2133

[2/4]  Loading embedding model 'BAAI/bge-large-en-v1.5'…
       (first run downloads ~1.3 GB — subsequent runs use cache)
       Embedding dim: 1024

[3/4]  Embedding 2133 passage chunks…
       Batches: 100%|████████████████| 67/67 [08:42<00:00,  7.8s/it]
       Done.  Shape: (2133, 1024)

[4/4]  Storing in Supabase + building BM25 index…
  Cleared existing rows for persona_id='gandhi'
  Cleared existing rows for persona_id='hitler'
  Cleared existing rows for persona_id='mandela'
  Inserting 2133 rows in batches of 50…
  Rows     1 –    50  inserted
  ...
  BM25 index saved → data\bm25_index.pkl  (12.3 MB)
```

**Estimated time:** ~10–20 minutes (embedding is the slow step).

After this step completes, run the IVFFlat index SQL shown in the Supabase
section above.

---

## How retrieval works at debate time  (`retrieval_v2.py`)

This module is the runtime component.  It is imported by
`agents/debate_graph.py` instead of the old `agents/retrieval.py`.

For every persona turn in the debate graph, `retrieve_context_for_persona()` is
called with the persona's ID and the debate question.

**Internal steps:**

```
debate question
      │
      ▼
BGE-large-en-v1.5                      BM25Okapi
encode with query prefix               tokenise & score
      │                                      │
      ▼                                      ▼
Supabase cosine search             persona-filtered BM25 ranking
(filtered by persona_id)           (from bm25_index.pkl)
top 15 dense results               top 15 sparse results
      │                                      │
      └──────────────┬───────────────────────┘
                     ▼
          Reciprocal Rank Fusion (RRF, k=60)
          deduplication on first 120 chars
                     │
                     ▼
              top 5 fused results
                     │
                     ▼
          Format with metadata headers:
          [Theme: Non-violence, Civil Disobedience]  [Dilemma type: Violence vs. Non-violence]
          [Stance: Soul-force ultimately prevails over brute force.]

          <raw passage text>
          ---
          ...
                     │
                     ▼
          Injected into Claude system prompt
```

**Why this is better than the original:**
- The LLM receives the *philosophical framing* of each passage, not just raw
  text — it is primed with the persona's moral logic before reading the evidence
- RRF catches relevant chunks that dense search misses (exact terminology) and
  that BM25 misses (semantic similarity without shared keywords)
- All models are cached after the first call so there's no per-request load cost

---

## Tagging taxonomy

The `ethical_dilemma_type` field uses a fixed 11-value vocabulary:

| Value | When used |
|---|---|
| `Conflict Resolution` | Navigating disputes between groups or individuals |
| `Duty vs. Desire` | Personal obligation conflicting with self-interest |
| `Personal Integrity` | Upholding one's principles under pressure |
| `Justice vs. Mercy` | Punishment vs. forgiveness |
| `Individual vs. Collective` | Personal rights vs. group welfare |
| `Violence vs. Non-violence` | Moral legitimacy of force |
| `Means vs. Ends` | Whether methods are justified by outcomes |
| `Power and Leadership` | Responsibility and corruption of authority |
| `Identity and Belonging` | Nation, race, religion, community |
| `Historical Context` | Factual/narrative content without a clear dilemma |
| `None` | No ethical dilemma identified |

---

## Integration with the debate system

The only change to the existing codebase was a one-line import update in
`agents/debate_graph.py`:

```python
# Before
from agents.retrieval import retrieve_context_for_persona

# After
from data.retrieval_v2 import retrieve_context_for_persona
```

The function signature is identical — no other changes were needed.
The old `agents/retrieval.py` and `persona_knowledge/*.txt` files are no longer
used and can be safely removed once the new pipeline is verified.

---

## Re-running the pipeline

Both scripts are designed for safe re-execution:

- **Phase 1** checks `chunk_index` values already in the JSONL file and skips
  them. Run it again any time without duplicating records.
- **Phase 2** deletes and re-inserts all rows for each persona before upserting.
  Run it again after updating the JSONL files.

To process a single persona from scratch, delete its JSONL file and re-run
Phase 1 for that persona, then re-run Phase 2 (which re-processes all three).
