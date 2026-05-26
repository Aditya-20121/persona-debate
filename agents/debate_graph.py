import os
from typing import TypedDict, Annotated
import operator

from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

from agents.personas import PERSONAS, PersonaConfig
from data.retrieval_v2 import retrieve_context_for_persona


# ── Shared state ────────────────────────────────────────────────────────────

class DebateMessage(TypedDict):
    persona_id: str
    name: str
    text: str
    round: int


class DebateState(TypedDict):
    question: str
    history: Annotated[list[DebateMessage], operator.add]
    current_round: int
    max_rounds: int
    persona_order: list[str]
    phase: str  # "opening" | "rebuttal" | "closing"


# ── Build LLM ────────────────────────────────────────────────────────────────

def get_llm() -> ChatOllama:
    return ChatOllama(
        model=os.getenv("OLLAMA_MODEL", "gemma3:4b-it-q8_0"),
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        num_predict=900,
        temperature=0.7,
    )


# ── Agent node factory ───────────────────────────────────────────────────────

def make_agent_node(persona: PersonaConfig):
    """
    Returns a LangGraph node function for the given persona.

    Each turn:
    1. Retrieves top-3 relevant knowledge chunks from Supabase for this persona
    2. Builds the full transcript context
    3. Calls Gemma 3 (local via Ollama) with grounded historical context injected into the prompt
    """

    def node(state: DebateState) -> dict:
        llm = get_llm()
        phase = state.get("phase", "opening")

        # Retrieve grounded knowledge from Supabase (non-fatal if unavailable)
        retrieved_context = retrieve_context_for_persona(
            persona_id=persona["id"],
            query=state["question"],
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
                )
            else:
                user_content = (
                    f"Debate question: \"{state['question']}\"\n\n"
                    f"Debate so far:\n{transcript}\n\n"
                    f"{last_speaker} just argued:\n\"{last_argument}\"\n\n"
                    f"Directly address {last_speaker}'s argument first — identify its "
                    f"weakest point and challenge it by name. Then advance your own position "
                    f"with a concrete example from your life or your ideology."
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
        persona_ids = ["mandela", "gandhi", "hitler"]

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
