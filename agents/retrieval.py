"""
Supabase pgvector retrieval for persona knowledge.

Each persona has a set of knowledge chunks stored in Supabase with embeddings.
At debate time, we embed the debate question and retrieve the top-K most
relevant passages for each persona, injecting them as grounded context.

Embeddings: Jina AI jina-embeddings-v3 (1024 dims, free tier 1M tokens/month)
Vector store: Supabase pgvector via LangChain SupabaseVectorStore
"""

import os
from functools import lru_cache

from langchain_community.embeddings import JinaEmbeddings
from langchain_community.vectorstores import SupabaseVectorStore
from supabase import create_client, Client


# ── Supabase client ───────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_supabase_client() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
    return create_client(url, key)


# ── Embeddings ────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embeddings() -> JinaEmbeddings:
    return JinaEmbeddings(
        jina_api_key=os.getenv("JINA_API_KEY"),
        model_name="jina-embeddings-v3",
    )


# ── Vector store ──────────────────────────────────────────────────────────────

def get_vector_store() -> SupabaseVectorStore:
    """
    Returns a LangChain SupabaseVectorStore pointing at the persona_knowledge table.
    Uses the match_persona_knowledge SQL function for filtered similarity search.
    """
    return SupabaseVectorStore(
        client=get_supabase_client(),
        embedding=get_embeddings(),
        table_name="persona_knowledge",
        query_name="match_persona_knowledge",
    )


# ── Retrieval ─────────────────────────────────────────────────────────────────

def retrieve_context_for_persona(
    persona_id: str,
    query: str,
    k: int = 3,
) -> str:
    """
    Retrieve the top-K most relevant knowledge chunks for a persona
    given the debate question. Returns a formatted string to inject
    into the persona's system prompt.

    Args:
        persona_id: e.g. "mandela", "gandhi", "hitler"
        query: the debate question
        k: number of chunks to retrieve

    Returns:
        Formatted string of relevant historical context, or empty string
        if retrieval fails (debate continues without it).
    """
    try:
        store = get_vector_store()
        docs = store.similarity_search(
            query=query,
            k=k,
            filter={"persona_id": persona_id},
        )
        if not docs:
            return ""

        passages = [doc.page_content for doc in docs]
        return "\n\n---\n\n".join(passages)

    except Exception as e:
        # Non-fatal: if retrieval fails, debate proceeds without grounded context
        print(f"[retrieval] Warning: failed to retrieve context for {persona_id}: {e}")
        return ""
