import os
import time
from dataclasses import dataclass
from typing import TypedDict, Annotated
import operator

from functools import lru_cache

from segmind import SegmindClient
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

from agents.personas import PERSONAS, PersonaConfig
from data.retrieval_v2 import retrieve_context_and_chunks_for_persona

# Segmind's REST contract is POST /v1/<model-name> (model in the path), not
# OpenAI's shared /v1/chat/completions — so debate turns use Segmind's
# official SDK directly instead of langchain_openai.ChatOpenAI.
_ROLE_MAP = {SystemMessage: "system", HumanMessage: "user"}

# The module-level segmind.chat_sync() uses a lazily-built client with a
# 30s HTTP timeout, which is too short once the prompt includes the full
# debate transcript + persona system prompt + RAG context — later rounds
# grow the prompt and Segmind's serverless inference has variable (cold
# start) latency, so generous headroom + one retry is needed.
_SEGMIND_TIMEOUT_S = 180.0
_SEGMIND_RETRIES = 1


@lru_cache(maxsize=1)
def _client() -> SegmindClient:
    return SegmindClient(timeout=_SEGMIND_TIMEOUT_S)


@dataclass
class _LLMResponse:
    content: str


class SegmindChatLLM:
    """Minimal invoke(messages) -> response.content wrapper, just enough
    surface area for the agent node below."""

    def __init__(self, model: str, max_tokens: int, temperature: float):
        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature

    def invoke(self, messages: list[BaseMessage]) -> _LLMResponse:
        payload = [
            {"role": _ROLE_MAP.get(type(m), "user"), "content": m.content}
            for m in messages
        ]

        last_exc: Exception | None = None
        for attempt in range(_SEGMIND_RETRIES + 1):
            try:
                reply = _client().chat_sync(
                    self.model,
                    messages=payload,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                )
                return _LLMResponse(content=reply.text or "")
            except Exception as exc:
                last_exc = exc
                if attempt < _SEGMIND_RETRIES:
                    time.sleep(2)
        raise last_exc


# ── Shared state ────────────────────────────────────────────────────────────

class DebateMessage(TypedDict):
    persona_id: str
    name: str
    text: str
    round: int
    retrieved_chunks: list[dict]


class DebateState(TypedDict):
    question: str
    history: Annotated[list[DebateMessage], operator.add]
    current_round: int
    max_rounds: int
    persona_order: list[str]
    phase: str  # "opening" | "rebuttal" | "closing"


# ── Build LLM ────────────────────────────────────────────────────────────────

def get_llm() -> SegmindChatLLM:
    return SegmindChatLLM(
        model=os.getenv("SEGMIND_MODEL", "llama-v3p1-8b-instruct"),
        # Headroom above the ~160-word limit enforced in the per-turn
        # prompts, so a slightly-over response isn't cut off mid-sentence.
        max_tokens=450,
        temperature=0.7,
    )


# Appended to every turn's user prompt. The persona system prompts already
# ask for 4-6 sentences, but an 8B model drifts into essay mode once the
# transcript grows — restating the limit at the end of the user message
# (recency) keeps responses readable.
_BREVITY_RULE = (
    "\n\nHARD LIMIT: respond in at most 3 short paragraphs and 160 words total. "
    "No preamble, no summary of the debate so far — go straight to your argument."
)


# ── Agent node factory ───────────────────────────────────────────────────────

def make_agent_node(persona: PersonaConfig):
    """
    Returns a LangGraph node function for the given persona.

    Each turn:
    1. Retrieves relevant knowledge chunks for this persona (turn-aware:
       rebuttal/closing turns retrieve against the opponent's last argument
       as well as the question, so counter-evidence surfaces)
    2. Builds the full transcript context
    3. Calls Llama 3.1 8B (Segmind API) with grounded historical context injected into the prompt
    """

    def node(state: DebateState) -> dict:
        llm = get_llm()
        phase = state.get("phase", "opening")

        # Turn-aware retrieval query: on rebuttal/closing turns, what the
        # persona needs evidence AGAINST is the opponent's last claim, not
        # just the original question.
        retrieval_query = state["question"]
        if state["history"]:
            last = state["history"][-1]
            retrieval_query = (
                f"{state['question']}\n"
                f"Countering {last['name']}'s argument: {last['text'][:500]}"
            )

        # Retrieve grounded knowledge (non-fatal if unavailable)
        retrieved_context, retrieved_chunks = retrieve_context_and_chunks_for_persona(
            persona_id=persona["id"],
            query=retrieval_query,
            k=3,
        )

        # Build system prompt — inject retrieved knowledge if available
        system_content = persona["system_prompt"]
        if retrieved_context:
            system_content += (
                "\n\n--- RELEVANT HISTORICAL CONTEXT (use to ground your arguments) ---\n"
                + retrieved_context
                + "\n--- END CONTEXT ---"
            )

        # Build user prompt based on phase and transcript so far
        if not state["history"]:
            user_content = (
                f"Debate question: \"{state['question']}\"\n\n"
                "Give your opening argument. State your position clearly and directly. "
                "Ground it in your actual historical experience and beliefs."
                + _BREVITY_RULE
            )
        else:
            transcript = "\n\n".join(
                f"{msg['name']}: {msg['text']}"
                for msg in state["history"]
            )
            last_speaker = state["history"][-1]["name"]
            last_argument = state["history"][-1]["text"]

            if phase == "closing":
                user_content = (
                    f"Debate question: \"{state['question']}\"\n\n"
                    f"Full debate so far:\n{transcript}\n\n"
                    "This is your closing statement. Summarize why your position has won "
                    "this debate. Be decisive, reference what was said, and end with a "
                    "powerful final line that defines your worldview."
                    + _BREVITY_RULE
                )
            else:
                user_content = (
                    f"Debate question: \"{state['question']}\"\n\n"
                    f"Debate so far:\n{transcript}\n\n"
                    f"{last_speaker} just argued:\n\"{last_argument}\"\n\n"
                    f"Directly address {last_speaker}'s argument first — identify its "
                    f"weakest point and challenge it by name. Then advance your own position "
                    f"with a concrete example from your life or your ideology."
                    + _BREVITY_RULE
                )

        messages = [
            SystemMessage(content=system_content),
            HumanMessage(content=user_content),
        ]

        response = llm.invoke(messages)

        new_message: DebateMessage = {
            "persona_id": persona["id"],
            "name": persona["name"],
            "text": response.content,
            "round": state["current_round"],
            "retrieved_chunks": retrieved_chunks,
        }

        return {"history": [new_message]}

    node.__name__ = persona["id"]
    return node


# ── Round counter node ────────────────────────────────────────────────────────

def increment_round(state: DebateState) -> dict:
    new_round = state["current_round"] + 1
    max_rounds = state["max_rounds"]

    # Determine debate phase based on round position
    if new_round == 0:
        phase = "opening"
    elif new_round >= max_rounds - 1:
        phase = "closing"
    else:
        phase = "rebuttal"

    return {"current_round": new_round, "phase": phase}


# ── Routing logic ─────────────────────────────────────────────────────────────

def should_continue(state: DebateState) -> str:
    """After the last persona in a round, decide to loop or end."""
    if state["current_round"] >= state["max_rounds"]:
        return END
    return "increment_round"


# ── Graph builder ─────────────────────────────────────────────────────────────

def build_debate_graph(persona_ids: list[str] | None = None):
    """
    Builds and compiles the LangGraph debate graph.
    persona_ids: ordered list of persona IDs to include (default: all 3).
    """
    if persona_ids is None:
        persona_ids = ["mandela", "gandhi", "marx"]

    personas = [PERSONAS[pid] for pid in persona_ids]
    graph = StateGraph(DebateState)

    # Add one node per persona
    for persona in personas:
        graph.add_node(persona["id"], make_agent_node(persona))

    # Add round increment node
    graph.add_node("increment_round", increment_round)

    # Entry point
    graph.set_entry_point(personas[0]["id"])

    # Chain personas sequentially within a round
    for i in range(len(personas) - 1):
        graph.add_edge(personas[i]["id"], personas[i + 1]["id"])

    # After last persona: conditional — loop or end
    graph.add_conditional_edges(
        personas[-1]["id"],
        should_continue,
        {END: END, "increment_round": "increment_round"},
    )

    # After incrementing round, restart from first persona
    graph.add_edge("increment_round", personas[0]["id"])

    return graph.compile()
