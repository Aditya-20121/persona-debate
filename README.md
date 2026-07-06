# Debate Arena — Backend

FastAPI backend that powers the multi-agent debate system. Uses **LangGraph** to orchestrate
sequential AI personas, **Llama 3.1 8B** (via Segmind API) for debate responses,
**BGE-large-en-v1.5** (local) for dense embeddings, and **Supabase pgvector + BM25** for hybrid
retrieval.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API framework | FastAPI + Uvicorn |
| Agent orchestration | LangGraph |
| Debate LLM | Llama 3.1 8B — Segmind API (`langchain-openai`, OpenAI-compatible) |
| Tagging LLM (data pipeline only) | Qwen2.5 1.5B — local via Ollama |
| Dense embeddings | `BAAI/bge-large-en-v1.5` — local via `sentence-transformers` |
| Sparse index | BM25Okapi (`rank-bm25`, persisted to `data/bm25_index.pkl`) |
| Vector store | Supabase pgvector (`persona_chunks` table) |
| Retrieval strategy | Dense + sparse fused with Reciprocal Rank Fusion (RRF) |
| Streaming | `sse-starlette` (Server-Sent Events) |
| Validation | Pydantic v2 |

---

## Project Structure

```
debate-ai-backend/
│
├── main.py                      # FastAPI app — CORS, SSE /debate/start endpoint
├── requirements.txt             # Runtime dependencies
├── .env.example                 # Environment variable template
│
├── agents/
│   ├── personas.py              # Persona configs + system prompts + few-shot examples
│   └── debate_graph.py          # LangGraph state machine (Llama 3.1 8B via Segmind)
│
├── models/
│   └── schemas.py               # Pydantic request/response models
│
└── data/                        # RAG pipeline (see data/README.md for full details)
    ├── README.md                # Complete pipeline walkthrough
    ├── 01_parse_and_tag.py      # PDF → chunks → Qwen2.5 tagging → JSONL
    ├── 02_embed_and_store.py    # JSONL → BGE embeddings → Supabase + BM25 index
    ├── retrieval_v2.py          # Runtime hybrid retrieval (imported by debate_graph.py)
    ├── supabase_v2_setup.sql    # Run once in Supabase SQL editor
    └── requirements_rag.txt     # Additional deps for the data pipeline
```

---

## Prerequisites

- Python 3.10+
- A [Segmind](https://segmind.com) account with API access to `llama-v3p1-8b-instruct`
- A [Supabase](https://supabase.com) project (free tier works)
- GPU with ~1.3 GB VRAM for BGE-large embeddings at retrieval time
- [Ollama](https://ollama.com) — only needed for the one-time data pipeline (PDF tagging)

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
SEGMIND_BASE_URL=https://api.segmind.com/v1
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

Place the three biography PDFs in `data/`:
```
data/gandhi.pdf
data/hitler.pdf
data/mandela.pdf
```

Run the two-phase pipeline (**requires Ollama + `qwen2.5:1.5b` for Phase 1 only**):

```bash
# Start Ollama for the tagging step
ollama serve
ollama pull qwen2.5:1.5b

# Phase 1 — PDF → clean chunks → LLM philosophical tagging → JSONL (~2–3 hrs, resumable)
python data/01_parse_and_tag.py

# Phase 2 — JSONL → BGE embeddings → Supabase + BM25 index (~15 min)
python data/02_embed_and_store.py
```

After Phase 2, run this in Supabase SQL editor to build the vector similarity index:

```sql
CREATE INDEX idx_persona_chunks_embedding
    ON persona_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);
```

See **[data/README.md](data/README.md)** for the full pipeline walkthrough.

### Step 5 — Start the server

```bash
python main.py
```

- API: `http://localhost:8000`
- Interactive docs: `http://localhost:8000/docs`

---

## How It Works

### Persona Design — Few-Shot Calibration

Each persona (`agents/personas.py`) is configured with:

1. **Identity + worldview** — who they are and the philosophical foundation they argue from
2. **Rhetorical style** — specific patterns (Gandhi's Socratic questions, Mandela's testimony, Hitler's zero-sum framing)
3. **Debate stance** — how they position against each other specifically
4. **Two few-shot examples** — concrete 4-6 sentence responses calibrated to the exact voice, giving the LLM a sound to match rather than a description to interpret
5. **Hard rules** — sentence count, required rhetorical moves, no bullet points, no meta-commentary

### LangGraph State Machine

```
[START] → mandela_node → gandhi_node → hitler_node
               ↑                            ↓
               └──── increment_round ←──── (if rounds remain)
                                            ↓
                                          [END]
```

**Shared state** (`DebateState`):
- `question` — the debate topic
- `history` — append-only list of all messages (`operator.add`)
- `current_round`, `max_rounds`, `phase` (`opening` → `rebuttal` → `closing`)

**Each agent node per turn:**
1. Calls `retrieve_context_for_persona()` — hybrid RAG (dense + BM25 + RRF)
2. Injects top-5 retrieved passages with philosophical metadata headers into system prompt
3. Builds phase-appropriate user prompt (opening / rebuttal / closing)
4. Calls **Llama 3.1 8B** via Segmind API — `max_tokens=900`, `temperature=0.7`
5. Appends response to shared history

### Hybrid RAG Retrieval

```
Debate question
      │
      ├── BGE-large-en-v1.5 (local) ──► Supabase cosine search ──────────┐
      │   encode with query prefix       filtered by persona_id           │
      │                                  top 15 dense results             ├── RRF (k=60) ──► top 5
      └── BM25Okapi (in-memory) ───────► persona-filtered keyword search ─┘
          from bm25_index.pkl            top 15 sparse results
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

The philosophical metadata headers prime the LLM with the persona's *mindset* before the raw
evidence — separating persona simulation from plain fact retrieval.

### SSE Streaming

`POST /debate/start` streams each agent turn as a Server-Sent Event:

```
data: {"type":"message","persona_id":"mandela","name":"Nelson Mandela","text":"...","round":0}
data: {"type":"message","persona_id":"gandhi","name":"Mahatma Gandhi","text":"...","round":0}
data: {"type":"message","persona_id":"hitler","name":"Adolf Hitler","text":"...","round":0}
...
data: {"type":"done"}
```

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
  "persona_ids": ["mandela", "gandhi", "hitler"],
  "max_rounds": 2
}
```

| Field | Type | Default | Constraints |
|---|---|---|---|
| `question` | string | required | 5–500 characters |
| `persona_ids` | list | `["mandela","gandhi","hitler"]` | valid persona IDs |
| `max_rounds` | int | `2` | 1–5 |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SEGMIND_API_KEY` | Yes | — | Segmind API key |
| `SEGMIND_BASE_URL` | No | `https://api.segmind.com/v1` | Segmind API base URL |
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
