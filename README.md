# Debate Arena — Backend

FastAPI backend that powers the multi-agent debate system. Uses **LangGraph** to orchestrate sequential AI personas, **Claude** (Anthropic) for debate responses, **Jina AI** for embeddings, and **Supabase pgvector** for RAG-based persona knowledge retrieval.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API framework | FastAPI + Uvicorn |
| Agent orchestration | LangGraph |
| LLM | Claude (Anthropic) via `langchain-anthropic` |
| Embeddings | Jina `jina-embeddings-v3` (1024 dims) |
| Vector store | Supabase pgvector |
| Streaming | `sse-starlette` (Server-Sent Events) |
| Validation | Pydantic v2 |

---

## Project Structure

```
backend/
├── main.py                          # FastAPI app, CORS, SSE /debate/start endpoint
├── requirements.txt
├── .env.example                     # Environment variable template
├── supabase_setup.sql               # Run once in Supabase SQL Editor
│
├── agents/
│   ├── personas.py                  # Persona configs + system prompts
│   ├── debate_graph.py              # LangGraph state machine
│   ├── retrieval.py                 # Supabase pgvector retrieval (RAG)
│   └── persona_knowledge/
│       ├── mandela.txt              # Nelson Mandela knowledge base
│       ├── gandhi.txt               # Mahatma Gandhi knowledge base
│       └── hitler.txt               # Adolf Hitler (educational) knowledge base
│
├── models/
│   └── schemas.py                   # Pydantic request/response models
│
└── scripts/
    └── seed_knowledge.py            # One-time script: embed & upload knowledge to Supabase
```

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Anthropic — Claude for debate responses
ANTHROPIC_API_KEY=sk-ant-...

# Jina AI — free embeddings (1M tokens/month free at jina.ai)
JINA_API_KEY=jina_...

# Supabase — pgvector knowledge store
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

### 3. Set up Supabase

Run `supabase_setup.sql` once in the **Supabase SQL Editor**. This creates:
- `persona_knowledge` table with `VECTOR(1024)` column
- `ivfflat` cosine similarity index
- `match_persona_knowledge` SQL function for LangChain retrieval

### 4. Seed persona knowledge

```bash
python -m scripts.seed_knowledge
```

This reads the three `.txt` knowledge files, chunks them by section, embeds each chunk with Jina, and uploads to Supabase. **Run this once** before starting the server (or re-run any time you update the knowledge files).

Expected output:
```
[mandela] 10 chunks embedded and uploaded
[gandhi]  10 chunks embedded and uploaded
[hitler]  10 chunks embedded and uploaded
=== Seeding complete ===
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

**Each node:**
1. Retrieves top-3 relevant knowledge chunks from Supabase for that persona (RAG)
2. Injects retrieved context into the system prompt
3. Builds user prompt with full transcript + instruction to rebut the previous speaker
4. Calls Claude and appends the response to shared history

### RAG Pipeline

```
Debate question
      │
      ▼
Jina embed (1024 dims)
      │
      ▼
Supabase pgvector similarity search
      │ (filtered by persona_id)
      ▼
Top-3 relevant passages
      │
      ▼
Injected into Claude system prompt
```

### SSE Streaming

The `/debate/start` endpoint accepts a POST and streams back Server-Sent Events:

```json
{ "type": "message", "persona_id": "gandhi", "name": "Mahatma Gandhi", "text": "...", "round": 0 }
{ "type": "done" }
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
- `persona_ids`: must be valid persona IDs
- `max_rounds`: 1–5 (default 2)

---

## Adding a New Persona

**1. Add to `agents/personas.py`:**

```python
"churchill": {
    "id": "churchill",
    "name": "Winston Churchill",
    "emoji": "🎩",
    "tagline": "British resolve & empire",
    "system_prompt": "You are Winston Churchill..."
}
```

**2. Create `agents/persona_knowledge/churchill.txt`** with speeches, quotes, and known positions (sectioned with `== HEADING ==`).

**3. Re-run the seed script:**
```bash
python -m scripts.seed_knowledge
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key from console.anthropic.com |
| `JINA_API_KEY` | Yes | Jina API key from jina.ai (free tier available) |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (bypasses RLS — backend only) |
