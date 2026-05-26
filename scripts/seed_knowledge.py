"""
One-time script to embed persona knowledge files and upload them to Supabase.

Run from the backend/ directory:
    python -m scripts.seed_knowledge

This will:
1. Read each persona's .txt knowledge file
2. Split it into chunks (by section)
3. Embed each chunk with OpenAI text-embedding-3-small
4. Upsert into the Supabase persona_knowledge table

Re-running is safe — it deletes existing rows for a persona before re-inserting.
"""

import os
import sys

# Allow running from backend/ directory
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from langchain_community.embeddings import JinaEmbeddings
from langchain_community.vectorstores import SupabaseVectorStore
from langchain_core.documents import Document
from supabase import create_client


KNOWLEDGE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "agents", "persona_knowledge"
)

PERSONA_IDS = ["mandela", "gandhi", "hitler"]


def load_and_chunk(persona_id: str) -> list[Document]:
    """
    Load a persona knowledge file and split into chunks by section (== heading ==).
    Each chunk becomes one vector in Supabase.
    """
    filepath = os.path.join(KNOWLEDGE_DIR, f"{persona_id}.txt")
    with open(filepath, "r", encoding="utf-8") as f:
        text = f.read()

    # Split on section headers (lines starting with ==)
    raw_sections = []
    current_section = []
    for line in text.splitlines():
        if line.startswith("==") and current_section:
            raw_sections.append("\n".join(current_section).strip())
            current_section = [line]
        else:
            current_section.append(line)
    if current_section:
        raw_sections.append("\n".join(current_section).strip())

    docs = []
    for i, section in enumerate(raw_sections):
        if len(section) < 30:
            continue
        docs.append(Document(
            page_content=section,
            metadata={
                "persona_id": persona_id,
                "chunk_index": i,
                "source": filepath,
            }
        ))

    print(f"  [{persona_id}] {len(docs)} chunks loaded")
    return docs


def seed():
    print("=== Debate Arena — Seeding Persona Knowledge ===\n")

    # Validate env
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "JINA_API_KEY"):
        if not os.getenv(key):
            print(f"ERROR: {key} not set in .env")
            sys.exit(1)

    supabase = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
    embeddings = JinaEmbeddings(
        jina_api_key=os.getenv("JINA_API_KEY"),
        model_name="jina-embeddings-v3",
    )

    for persona_id in PERSONA_IDS:
        print(f"Processing: {persona_id}")

        # Delete existing rows for this persona to allow clean re-seeding
        supabase.table("persona_knowledge").delete().eq(
            "metadata->>persona_id", persona_id
        ).execute()
        print(f"  [{persona_id}] existing rows deleted")

        docs = load_and_chunk(persona_id)
        if not docs:
            print(f"  [{persona_id}] WARNING: no chunks found, skipping")
            continue

        SupabaseVectorStore.from_documents(
            documents=docs,
            embedding=embeddings,
            client=supabase,
            table_name="persona_knowledge",
            query_name="match_persona_knowledge",
        )
        print(f"  [{persona_id}] {len(docs)} chunks embedded and uploaded\n")

    print("=== Seeding complete ===")


if __name__ == "__main__":
    seed()
