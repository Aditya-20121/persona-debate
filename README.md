# Debate Arena — Backend

FastAPI backend that powers the multi-agent debate system. Uses **LangGraph** to orchestrate
sequential AI personas, **Gemma 3 4B** (local via Ollama, 8-bit quantized) for debate responses,
**BGE-large-en-v1.5** for dense embeddings, and **Supabase pgvector + BM25** for hybrid RAG retrieval.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API framework | FastAPI + Uvicorn |
| Agent orchestration | LangGraph |
| LLM (debate responses) | Gemma 3 4B Q8 — local via Ollama (`langchain-ollama`) |
| Embeddings (retrieval) | `BAAI/bge-large-en-v1.5` — local via `sentence-transformers` |
| Vector store | Supabase pgvector (`persona_chunks` table) |
| Sparse index | BM25Okapi (`rank-bm25`, persisted to `data/bm25_index.pkl`) |
| Retrieval strategy | Hybrid dense + sparse, fused with Reciprocal Rank Fusion (RRF) |
| Streaming | `sse-starlette` (Server-Sent Events) |
| Validation | Pydantic v2 |

---

## Project Structure

```
debate-ai-backend/
├── main.py                          # FastAPI app, CORS, SSE /debate/start endpoint
├── requirements.txt
├── .env.example                     # Environment variable template
│
├── agents/
│   ├── personas.py                  # Persona configs + system prompts (Mandela, Gandhi, Hitler)
│   ├── debate_graph.py              # LangGraph state machine — uses Gemma 3 via Ollama
│   └── retrieval.py                 # Legacy (unused — superseded by data/retrieval_v2.py)
│
├── models/
│   └── schemas.py                   # Pydantic request/response models
│
└── data/                            # RAG knowledge pipeline (see data/README.md)
    ├── README.md                    # Full pipeline instructions
    ├── 01_parse_and_tag.py          # PDF → chunks → LLM tagging → JSONL
    ├── 02_embed_and_store.py        # JSONL → BGE embeddings → Supabase + BM25
    ├── retrieval_v2.py              # Runtime: hybrid RRF retrieval (used by debate_graph.py)
    ├── supabase_v2_setup.sql        # Schema for persona_chunks table
    ├── requirements_rag.txt         # Extra deps for the pipeline
    ├── gandhi.pdf                   # Source biography (not committed — provide your own)
    ├── hitler.pdf
    ├── mandela.pdf
    └── processed/                   # Tagged JSONL files (generated, not committed)
```

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
pip install -r data/requirements_rag.txt
```

### 2. Install and start Ollama

Ollama serves both the debate LLM (Gemma 3) and the tagging LLM (Qwen2.5).

```bash
# Install from https://ollama.com, then:
ollama serve                        # keep running in a separate terminal

# Pull both models
ollama pull gemma3:4b-it-q8_0      # ~4.5 GB — debate agent LLM
ollama pull qwen2.5:1.5b            # ~1 GB  — PDF tagging LLM (Phase 1 only)
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Ollama — local LLM for debate responses (no API key needed)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma3:4b-it-q8_0

# Supabase — pgvector knowledge store
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 4. Build the RAG knowledge base (one-time)

See **[data/README.md](data/README.md)** for the full walkthrough. Summary:

```bash
# a. Run supabase_v2_setup.sql in your Supabase SQL Editor

# b. Phase 1 — parse PDFs + tag chunks with Qwen2.5-1.5B (~2–3 hrs, resumable)
python data/01_parse_and_tag.py

# c. Phase 2 — embed with BGE-large + upload to Supabase + build BM25 (~15 min)
python data/02_embed_and_store.py

# d. Run the IVFFlat index SQL in Supabase (see data/README.md)
```

### 5. Run the dev server

```bash
python main.py
```

API running at `http://localhost:8000`  
Interactive docs at `http://localhost:8000/docs`

---

## How It Works

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
- `history` — append-only list of all messages (via `operator.add`)
- `current_round`, `max_rounds`, `phase` (opening / rebuttal / closing)

**Each agent node:**
1. Retrieves top-5 relevant passages from Supabase + BM25 via RRF fusion
2. Injects retrieved passages (with philosophical metadata headers) into the system prompt
3. Builds user prompt with full transcript + phase-appropriate instruction
4. Calls **Gemma 3 4B** (local, 8-bit Q8 via Ollama) and appends the response to shared history

### Hybrid RAG Pipeline

```
Debate question
      │
      ├─── BGE-large-en-v1.5 (local) ──► Supabase cosine search (dense)  ─┐
      │                                  filtered by persona_id             │
      │                                                                     ├── RRF fusion ──► top-5 chunks
      └─── BM25Okapi (in-memory) ──────► persona-filtered keyword search  ─┘
                                         (sparse)
                                                │
                                                ▼
                               [Theme: ...] [Dilemma type: ...] [Stance: ...]
                               <raw passage text>
                                                │
                                                ▼
                               Injected into Gemma system prompt
```

The philosophical metadata headers (theme, ethical dilemma type, moral stance) prime the LLM
with the persona's *mindset* before it reads the raw evidence — this is what separates persona
simulation from plain fact retrieval.

### SSE Streaming

The `/debate/start` endpoint accepts a POST and streams back Server-Sent Events:

```
data: {"type":"message","persona_id":"gandhi","name":"Mahatma Gandhi","text":"...","round":0}
data: {"type":"message","persona_id":"mandela","name":"Nelson Mandela","text":"...","round":0}
...
data: {"type":"done"}
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/` | Health check |
| GET | `/personas` | List all personas (id, name, emoji, tagline) |
| POST | `/debate/start` | Start debate → SSE stream |

### POST /debate/start

**Request body:**
```json
{
  "question": "Is violence ever justified in the pursuit of justice?",
  "persona_ids": ["mandela", "gandhi", "hitler"],
  "max_rounds": 2
}
```

**Constraints:**
- `question`: 5–500 characters
- `persona_ids`: valid persona IDs (default: all three)
- `max_rounds`: 1–5 (default 2)

---

## GPU Memory Layout

With an 8 GB GPU, both models fit simultaneously:

| Component | VRAM |
|---|---|
| Gemma 3 4B Q8 (Ollama) | ~4.5 GB |
| BGE-large-en-v1.5 (sentence-transformers) | ~1.3 GB |
| Overhead | ~0.5 GB |
| **Total** | **~6.3 GB** |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | No | Ollama server URL (default: `http://localhost:11434`) |
| `OLLAMA_MODEL` | No | Model tag (default: `gemma3:4b-it-q8_0`) |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (bypasses RLS — backend only) |
