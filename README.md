# Debate Arena — Backend

FastAPI backend that powers the multi-agent debate system. Uses **LangGraph** to orchestrate
sequential AI personas, **Gemma 3 4B Q8** (local via Ollama, zero API cost) for debate responses,
**BGE-large-en-v1.5** (local) for dense embeddings, and **Supabase pgvector + BM25** for hybrid
retrieval. All LLM inference runs on a local GPU — no external API keys required for debate.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API framework | FastAPI + Uvicorn |
| Agent orchestration | LangGraph |
| Debate LLM | Gemma 3 4B (Q8_0) — local via Ollama (`langchain-ollama`) |
| Tagging LLM (pipeline only) | Qwen2.5 1.5B — local via Ollama |
| Dense embeddings | `BAAI/bge-large-en-v1.5` — local via `sentence-transformers` |
| Sparse index | BM25Okapi (`rank-bm25`, file `data/bm25_index.pkl`) |
| Vector store | Supabase pgvector (`persona_chunks` table) |
| Retrieval strategy | Dense + sparse fused with Reciprocal Rank Fusion (RRF) |
| Streaming | `sse-starlette` (Server-Sent Events) |
| Validation | Pydantic v2 |

---

## GPU Memory Layout

Both models fit simultaneously on an 8 GB GPU:

| Component | VRAM |
|---|---|
| Gemma 3 4B Q8 (Ollama, debate LLM) | ~4.5 GB |
| BGE-large-en-v1.5 (sentence-transformers, retrieval) | ~1.3 GB |
| Overhead | ~0.5 GB |
| **Total** | **~6.3 GB** |

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
│   └── debate_graph.py          # LangGraph state machine (uses Gemma 3 via Ollama)
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

### Hardware
- **GPU**: 8 GB VRAM (RTX 3070 / 4060 class or better)
- **RAM**: 16 GB recommended (BGE model + Supabase client + FastAPI)
- **Disk**: ~7 GB free (Gemma 3 Q8 ~4.5 GB + BGE-large ~1.3 GB + processed data)

### Software
- Python 3.10+
- [Ollama](https://ollama.com) installed and running

---

## Setup (Step by Step)

### Step 1 — Clone and install Python dependencies

```bash
git clone https://github.com/peshkash17/debate-ai-backend.git
cd debate-ai-backend

pip install -r requirements.txt
pip install -r data/requirements_rag.txt
```

### Step 2 — Install Ollama and pull both models

```bash
# macOS/Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows: download installer from https://ollama.com

# Start the Ollama server (keep this terminal open)
ollama serve

# In a new terminal, pull the two models used by the system:
ollama pull gemma3:4b-it-q8_0     # Debate LLM — ~4.5 GB download
ollama pull qwen2.5:1.5b           # Tagging LLM (Phase 1 pipeline only) — ~1 GB download
```

### Step 3 — Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
# Ollama — local LLM for debate responses (no API key needed)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b-it-q8_0

# Supabase — pgvector knowledge store
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key_here
```

> **Where to get Supabase credentials:**
> 1. Create a free project at [supabase.com](https://supabase.com)
> 2. Go to **Project Settings → API**
> 3. Copy **Project URL** → `SUPABASE_URL`
> 4. Copy **service_role** key (not anon key) → `SUPABASE_SERVICE_KEY`

### Step 4 — Set up the Supabase schema

Open your Supabase project → **SQL Editor** → paste and run the contents of
`data/supabase_v2_setup.sql`.

This creates:
- `persona_chunks` table with `VECTOR(1024)` column
- B-tree index on `persona_id`
- GIN index on `topic_keywords`
- `match_persona_chunks(query_embedding, match_count, p_persona_id)` SQL function

> ⚠️ **Do not create the IVFFlat index yet.** It must be built after data is
> loaded (Step 5). The setup SQL has the command commented out with instructions.

### Step 5 — Build the RAG knowledge base (one-time, ~3 hours)

Place the three biography PDFs in the `data/` folder:
```
data/gandhi.pdf
data/hitler.pdf
data/mandela.pdf
```

Then run the two-phase pipeline:

```bash
# Phase 1: PDF → clean chunks → Qwen2.5 philosophical tagging → JSONL
# Fully resumable — safe to Ctrl-C and restart at any time
python data/01_parse_and_tag.py

# Phase 2: JSONL → BGE-large embeddings → Supabase upsert + BM25 index
python data/02_embed_and_store.py
```

After Phase 2 completes, run this in Supabase SQL editor to build the vector index:

```sql
CREATE INDEX idx_persona_chunks_embedding
    ON persona_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 50);
```

For the full pipeline walkthrough including expected output, timing, and troubleshooting,
see **[data/README.md](data/README.md)**.

### Step 6 — Start the server

```bash
python main.py
```

```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Debate API starting up...
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
4. **Two few-shot examples** — concrete 4-6 sentence responses calibrated to the exact voice, so Gemma 3 has a template to match rather than inferring style purely from description
5. **Hard rules** — sentence count, required rhetorical moves, no bullet points, no meta-commentary

The few-shot examples are the most important calibration layer for a local 4B model. They show
the model exactly what "Gandhi arguing about violence" *sounds like*, not just what Gandhi believed.

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
3. Builds phase-appropriate user prompt (opening / rebuttal / closing instruction)
4. Calls **Gemma 3 4B Q8** via Ollama — `num_predict=900`, `temperature=0.7`
5. Appends response to shared history

### Hybrid RAG Retrieval

```
Debate question
      │
      ├── BGE-large-en-v1.5 (local GPU) ──► Supabase cosine search ─┐
      │   encode with query prefix          filtered by persona_id    │
      │                                     top 15 dense results      │
      │                                                               ├── RRF fusion (k=60) ──► top 5
      └── BM25Okapi (in-memory) ────────► persona-filtered keyword ──┘
          from bm25_index.pkl               search, top 15 sparse results
                                                     │
                                                     ▼
                                 [Theme: Non-violence, Civil Disobedience]
                                 [Dilemma type: Violence vs. Non-violence]
                                 [Stance: Soul-force prevails over brute force.]
                                 <raw passage text>
                                                     │
                                                     ▼
                                 Injected into Gemma 3 system prompt
```

The philosophical metadata headers (theme, ethical dilemma type, moral stance) prime Gemma 3
with the persona's *mindset* before it reads the raw evidence — this is what separates persona
simulation from plain fact retrieval.

### SSE Streaming

`POST /debate/start` streams back Server-Sent Events as each agent turn completes:

```
data: {"type":"message","persona_id":"mandela","name":"Nelson Mandela","text":"...","round":0}
data: {"type":"message","persona_id":"gandhi","name":"Mahatma Gandhi","text":"...","round":0}
data: {"type":"message","persona_id":"hitler","name":"Adolf Hitler","text":"...","round":0}
data: {"type":"message","persona_id":"mandela","name":"Nelson Mandela","text":"...","round":1}
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

**Request body:**
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
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server address |
| `OLLAMA_MODEL` | No | `gemma3:4b-it-q8_0` | Ollama model tag for debate LLM |
| `SUPABASE_URL` | Yes | — | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | — | Service role key (bypasses RLS) |

---

## Troubleshooting

**`ollama: connection refused`**
Ollama server isn't running. Start it with `ollama serve` in a separate terminal.

**`model not found: gemma3:4b-it-q8_0`**
Pull the model first: `ollama pull gemma3:4b-it-q8_0`

**`FileNotFoundError: BM25 index not found at data/bm25_index.pkl`**
Phase 2 hasn't been run yet, or was interrupted. Run `python data/02_embed_and_store.py`.

**`CUDA out of memory`**
Close other GPU processes. If the issue persists, set `OLLAMA_NUM_GPU=0` in your shell to
force Ollama to CPU (slower but safe), and BGE-large will remain on GPU.

**Gemma 3 ignoring character instructions / breaking persona**
This is a known limitation of smaller local models. The few-shot examples in `agents/personas.py`
are the primary mitigation. If persona drift is severe, reduce `temperature` from `0.7` to `0.4`
in `debate_graph.py → get_llm()`.
