from pydantic import BaseModel, Field


class DebateStartRequest(BaseModel):
    question: str = Field(..., min_length=5, max_length=500)
    persona_ids: list[str] = Field(
        default=["mandela", "gandhi", "marx"],
        description="Ordered list of persona IDs to include in the debate",
    )
    max_rounds: int = Field(default=2, ge=1, le=5)


class RetrievedChunk(BaseModel):
    """One RAG passage retrieved to ground a persona's turn."""
    content: str
    topic_keywords: list[str] = []
    ethical_dilemma_type: str = ""
    philosophical_summary: str = ""
    chunk_index: int | None = None
    page_num: int | None = None


class DebateMessage(BaseModel):
    persona_id: str
    name: str
    text: str
    round: int
    retrieved_chunks: list[RetrievedChunk] = []


class DebateResponse(BaseModel):
    question: str
    messages: list[DebateMessage]


class PersonaOut(BaseModel):
    id: str
    name: str
    emoji: str
    tagline: str


class SSEEvent(BaseModel):
    """Shape of each SSE data payload sent to the frontend."""
    type: str          # "message" | "done" | "error"
    persona_id: str = ""
    name: str = ""
    text: str = ""
    round: int = 0
    retrieved_chunks: list[RetrievedChunk] = []
    error: str = ""
