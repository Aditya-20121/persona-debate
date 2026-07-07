# Debate Arena

Gandhi, Mandela, and Marx — resurrected as AI debaters, arguing in their own voice, grounded
in their real writings through hybrid retrieval-augmented generation.

A **FastAPI + LangGraph** backend orchestrates sequential persona agents powered by
**Llama 3.1 8B** (Segmind API), each turn grounded by hybrid retrieval
(**BGE-large-en-v1.5** dense + **BM25** sparse, fused with RRF) over **Supabase pgvector**.
A cinematic **Next.js frontend** streams the debate live with expandable RAG grounding per turn.

## Demo

▶ **[Watch the demo video](demo_debate.MP4)** — a full debate from motion selection to closing
statements, including the retrieved-passages panel.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API framework | FastAPI + Uvicorn |
| Agent orchestration | LangGraph |
| Debate LLM | Llama 3.1 8B — Segmind API (official `segmind` SDK) |
| Tagging LLM (data pipeline) | Llama 3.1 8B — Segmind API (same SDK, parallelized) |
| Dense embeddings | `BAAI/bge-large-en-v1.5` — local via `sentence-transformers` |
| Sparse index | BM25Okapi (`rank-bm25`, persisted to `data/bm25_index.pkl`) |
| Vector store | Supabase pgvector (`persona_chunks` table) |
| Retrieval strategy | Dense + sparse fused with Reciprocal Rank Fusion (RRF) |
| Streaming | `sse-starlette` (Server-Sent Events) |
| Validation | Pydantic v2 |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS + Framer Motion |

---

## Project Structure

```
debate-ai-backend/
│
├── main.py                      # FastAPI app — CORS, SSE /debate/start endpoint
├── requirements.txt             # Runtime dependencies
├── .env.example                 # Environment variable template
├── debate_questions.md          # 25 curated motions, tiered by clash quality
├── demo_debate.MP4              # Demo recording
│
├── agents/
│   ├── personas.py              # Persona configs + system prompts + few-shot examples
│   └── debate_graph.py          # LangGraph state machine (Llama 3.1 8B via Segmind SDK)
│
├── models/
│   └── schemas.py               # Pydantic request/response models (incl. RetrievedChunk)
│
├── data/                        # RAG pipeline (see data/README.md for full details)
│   ├── README.md                # Complete pipeline walkthrough
│   ├── 01_parse_and_tag.py      # PDF/DOCX → chunks → Llama 3.1 8B tagging → JSONL
│   ├── 02_embed_and_store.py    # JSONL → BGE embeddings → Supabase + BM25 index
│   ├── retrieval_v2.py          # Runtime hybrid retrieval (imported by debate_graph.py)
│   ├── 03_test_retrieval.py     # Retrieval smoke test (run after Phase 2)
│   ├── supabase_v2_setup.sql    # Run once in Supabase SQL editor
│   └── requirements_rag.txt     # Additional deps for the data pipeline
│
└── frontend/                    # Next.js UI — cinematic hero + live debate stream
    ├── app/page.tsx              # Stage machine: hero → setup → debate
    ├── components/               # Hero, DebateSetupForm, MessageBubble, QuestionPicker, ...
    └── lib/                      # api.ts (SSE client), personas.ts, questions.ts
```

---

## Prerequisites

- Python 3.10+
- Node.js 18+ (for the frontend)
- A [Segmind](https://segmind.com) account with API access to `llama-v3p1-8b-instruct`
- A [Supabase](https://supabase.com) project (free tier works)

---

## Setup

### Step 1 — Clone and install dependencies

```bash
git clone https://github.com/Aditya-20121/persona-debate.git
cd persona-debate

pip install -r requirements.txt
pip install -r data/requirements_rag.txt
```

### Step 2 — Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Segmind — Llama 3.1 8B serverless API
SEGMIND_API_KEY=your_segmind_api_key_here
SEGMIND_MODEL=llama-v3p1-8b-instruct

# Supabase — pgvector knowledge store
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key_here
```

> **Segmind API key:** Sign in at [segmind.com](https://segmind.com) → API Keys → Create key.
>
> **Supabase credentials:** Project Settings → API → copy Project URL and `service_role` key.

### Step 3 — Set up the Supabase schema

Open your Supabase project → **SQL Editor** → paste and run `data/supabase_v2_setup.sql`.

This creates:
- `persona_chunks` table with `VECTOR(1024)` column
- Indexes on `persona_id` and `topic_keywords`
- `match_persona_chunks(query_embedding, match_count, p_persona_id)` SQL function

> ⚠️ Do not create the IVFFlat index yet — it must be built after data is loaded (Step 4).

### Step 4 — Build the RAG knowledge base (one-time)

Place the three biography source files in `data/` (PDF and DOCX are both supported):
```
data/gandhi.pdf
data/mandela.pdf
data/karl-marx.docx
```

Run the two-phase pipeline (requires `SEGMIND_API_KEY` in `.env`). Smoke-test first:

```bash
# Optional smoke test — tag only 10 chunks per persona (~1 min)
python data/01_parse_and_tag.py gandhi --limit 10

# Phase 1 — source docs → clean chunks → Llama 3.1 8B tagging (6 parallel workers,
#           ~30 min for ~2,500 chunks, resumable if interrupted)
python data/01_parse_and_tag.py

# Phase 2 — JSONL → BGE embeddings → Supabase + BM25 index
#           (~15 min on GPU, ~90 min on CPU)
python data/02_embed_and_store.py

# Verify the full retrieval path end-to-end
python data/03_test_retrieval.py
```

After Phase 2, run this in Supabase SQL editor to build the vector similarity index:

```sql
CREATE INDEX idx_persona_chunks_embedding
    ON persona_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);
```

See **[data/README.md](data/README.md)** for the full pipeline walkthrough.

### Step 5 — Start the backend

```bash
python main.py
```

- API: `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs`

### Step 6 — Start the frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open `http://localhost:3000` (any `localhost:30xx` port works — CORS covers auto-bumped ports).

**Using the UI:**

1. Land on the cinematic hero and hit **Begin Debate**
2. Set the speaking order by **dragging debaters** into position (the 1st speaker opens each
   round; the last speaker gets the final word), and toggle any debater In/Out
3. Pick a motion from the curated list (`debate_questions.md`) or write your own (5–500 chars)
4. Choose rounds (1–5) and whether to show RAG grounding
5. Turns reveal one at a time with a "preparing an argument" indicator between speakers; each
   card has a **Show grounding** toggle revealing the retrieved passages (theme, dilemma type,
   stance, excerpt) that grounded that argument

---

## How It Works

### Persona Design — Few-Shot Calibration

Each persona (`agents/personas.py`) is configured with:

1. **Identity + worldview** — who they are and the philosophical foundation they argue from
2. **Rhetorical style** — specific patterns (Gandhi's Socratic questions, Mandela's testimony, Marx's materialist critique)
3. **Debate stance** — how they position against each other specifically
4. **Two few-shot examples** — concrete 4-6 sentence responses calibrated to the exact voice, giving the LLM a sound to match rather than a description to interpret
5. **Hard rules** — sentence count, required rhetorical moves, no bullet points, no meta-commentary

### LangGraph State Machine

```
[START] → speaker₁ → speaker₂ → speaker₃
              ↑                     ↓
              └── increment_round ←─┘  (if rounds remain)
                                    ↓
                                  [END]
```

Nodes are chained in the exact order `persona_ids` arrives — the frontend's drag-to-reorder
list directly controls who opens and who closes each round.

**Shared state** (`DebateState`):
- `question` — the debate topic
- `history` — append-only list of all messages (`operator.add`)
- `current_round`, `max_rounds`, `phase` (`opening` → `rebuttal` → `closing`)

**Each agent node per turn:**

1. Builds a turn-aware retrieval query — rebuttal/closing turns retrieve against the
   opponent's last argument as well as the question, so counter-evidence surfaces
2. Runs hybrid RAG (dense + BM25 + RRF) and injects the top-3 passages with philosophical
   metadata headers into the system prompt
3. Builds a phase-appropriate user prompt ending with a hard brevity rule
   (≤3 short paragraphs / 160 words)
4. Calls **Llama 3.1 8B** via the Segmind SDK — `max_tokens=450`, `temperature=0.7`
5. Appends the response (plus its retrieved chunks) to shared history

### Hybrid RAG Retrieval

```
Turn-aware query (question + opponent's last claim)
      │
      ├── BGE-large-en-v1.5 (local) ──► Supabase cosine search ──────────┐
      │   encode with query prefix       filtered by persona_id           │
      │                                  top 3×k dense results            ├── RRF (k=60) ──► top k
      └── BM25Okapi (in-memory) ───────► persona-filtered keyword search ─┘
          from bm25_index.pkl            top 3×k sparse results
                                                  │
                                                  ▼
                              [Theme: Non-violence, Civil Disobedience]
                              [Dilemma type: Violence vs. Non-violence]
                              [Stance: Soul-force prevails over brute force.]
                              <raw passage text>
                                                  │
                                                  ▼
                              Injected into Llama 3.1 8B system prompt
```

Two details make this retrieval persona-aware rather than plain fact lookup:

- **Enriched retrieval key** — what gets embedded (and BM25-tokenised) is
  `philosophical_summary + topic keywords + content`, not raw text alone. Debate questions
  are abstract while biography text is narrative; the summary bridges that gap.
- **Metadata headers** — the LLM sees the persona's *mindset* (theme, dilemma type, stance)
  before the raw evidence.

### SSE Streaming

`POST /debate/start` streams each agent turn as a Server-Sent Event:

```
data: {"type":"message","persona_id":"mandela","name":"Nelson Mandela","text":"...","round":0,"retrieved_chunks":[...]}
data: {"type":"message","persona_id":"gandhi","name":"Mahatma Gandhi","text":"...","round":0,"retrieved_chunks":[...]}
data: {"type":"message","persona_id":"marx","name":"Karl Marx","text":"...","round":0,"retrieved_chunks":[...]}
...
data: {"type":"done"}
```

Each message carries the `retrieved_chunks` that grounded it (content, keywords, dilemma
type, stance, page number) so clients can render a "show grounding" panel per turn.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Health check — `{"status": "ok"}` |
| `GET` | `/personas` | List all personas (id, name, emoji, tagline) |
| `POST` | `/debate/start` | Start a debate → SSE stream |

### POST /debate/start

```json
{
  "question": "Is violence ever justified in the pursuit of justice?",
  "persona_ids": ["mandela", "gandhi", "marx"],
  "max_rounds": 2
}
```

| Field | Type | Default | Constraints |
|---|---|---|---|
| `question` | string | required | 5–500 characters |
| `persona_ids` | list | `["mandela","gandhi","marx"]` | valid persona IDs |
| `max_rounds` | int | `2` | 1–5 |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SEGMIND_API_KEY` | Yes | — | Segmind API key (read by the official SDK) |
| `SEGMIND_MODEL` | No | `llama-v3p1-8b-instruct` | Model identifier |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | — | Service role key (bypasses RLS) |

---

## Troubleshooting

**`401 Unauthorized` from Segmind**
Check that `SEGMIND_API_KEY` is set correctly in `.env` and has not expired.

**`404 model not found` from Segmind**
Verify `SEGMIND_MODEL=llama-v3p1-8b-instruct` matches the model name exactly as shown at
[segmind.com/models/llama-v3p1-8b-instruct](https://www.segmind.com/models/llama-v3p1-8b-instruct/api).

**`FileNotFoundError: BM25 index not found at data/bm25_index.pkl`**
Phase 2 of the data pipeline hasn't been run yet. Run `python data/02_embed_and_store.py`.

**Persona breaking character / ignoring instructions**
Reduce `temperature` from `0.7` to `0.4` in `debate_graph.py → get_llm()`.
