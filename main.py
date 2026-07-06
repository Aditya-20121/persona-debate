import json
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
from dotenv import load_dotenv

from agents.debate_graph import build_debate_graph
from agents.personas import get_all_personas, PERSONAS
from models.schemas import DebateStartRequest, PersonaOut, SSEEvent

load_dotenv()


# ── App setup ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Debate API starting up...")
    yield
    print("Debate API shutting down...")


app = FastAPI(
    title="Debate Arena API",
    description="Multi-agent historical persona debate powered by LangGraph + Gemma 3 (local)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "ok", "message": "Debate Arena API is running"}


@app.get("/personas", response_model=list[PersonaOut])
async def list_personas():
    """Return all available personas for the frontend to render."""
    return [
        PersonaOut(
            id=p["id"],
            name=p["name"],
            emoji=p["emoji"],
            tagline=p["tagline"],
        )
        for p in get_all_personas()
    ]


@app.post("/debate/start")
async def start_debate(payload: DebateStartRequest):
    """
    SSE streaming endpoint.
    Accepts the debate config and streams back each agent turn as a server-sent event.

    Frontend connects with:
        const es = new EventSource('/debate/start')  ← not ideal for POST
    
    Since EventSource doesn't support POST, we use a two-step approach:
    1. POST /debate/start  → returns a session_id
    2. GET  /debate/stream/{session_id} → SSE stream

    For simplicity in development, this single endpoint accepts POST and
    returns the full stream. Use the GET /debate/stream endpoint for the
    real frontend integration.
    """
    # Validate persona IDs
    for pid in payload.persona_ids:
        if pid not in PERSONAS:
            raise HTTPException(status_code=400, detail=f"Unknown persona: {pid}")

    async def event_generator():
        try:
            graph = build_debate_graph(persona_ids=payload.persona_ids)

            initial_state = {
                "question": payload.question,
                "history": [],
                "current_round": 0,
                "max_rounds": payload.max_rounds,
                "persona_order": payload.persona_ids,
                "phase": "opening",
            }

            # astream yields one dict per node execution
            async for chunk in graph.astream(initial_state):
                for node_name, node_output in chunk.items():
                    if node_name == "increment_round":
                        continue  # skip internal bookkeeping node

                    messages = node_output.get("history", [])
                    if not messages:
                        continue

                    msg = messages[-1]  # the message this node just added
                    event = SSEEvent(
                        type="message",
                        persona_id=msg["persona_id"],
                        name=msg["name"],
                        text=msg["text"],
                        round=msg["round"],
                        retrieved_chunks=msg.get("retrieved_chunks", []),
                    )
                    yield {"data": event.model_dump_json()}
                    await asyncio.sleep(0)  # yield control to event loop

            # Signal completion
            done_event = SSEEvent(type="done")
            yield {"data": done_event.model_dump_json()}

        except Exception as e:
            error_event = SSEEvent(type="error", error=str(e))
            yield {"data": error_event.model_dump_json()}

    return EventSourceResponse(event_generator())


# ── Dev server ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
