-- ============================================================
-- Debate Arena — Supabase pgvector setup
-- Run this entire file in your Supabase SQL Editor once.
-- ============================================================

-- 1. Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;


-- 2. Create the persona knowledge table
--    - content     : the raw text chunk
--    - metadata    : JSON with persona_id, chunk_index, source
--    - embedding   : 1024-dim vector (Jina jina-embeddings-v3)
CREATE TABLE IF NOT EXISTS persona_knowledge (
    id        BIGSERIAL PRIMARY KEY,
    content   TEXT                NOT NULL,
    metadata  JSONB               NOT NULL DEFAULT '{}',
    embedding VECTOR(1024)
);


-- 3. Index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS persona_knowledge_embedding_idx
    ON persona_knowledge
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);


-- 4. Index for fast persona filtering
CREATE INDEX IF NOT EXISTS persona_knowledge_persona_id_idx
    ON persona_knowledge ((metadata->>'persona_id'));


-- 5. Match function used by LangChain SupabaseVectorStore
--    Filters by persona_id in metadata, returns top-K by cosine similarity.
CREATE OR REPLACE FUNCTION match_persona_knowledge(
    query_embedding  VECTOR(1024),
    match_count      INT     DEFAULT 3,
    filter           JSONB   DEFAULT '{}'
)
RETURNS TABLE (
    id         BIGINT,
    content    TEXT,
    metadata   JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pk.id,
        pk.content,
        pk.metadata,
        1 - (pk.embedding <=> query_embedding) AS similarity
    FROM persona_knowledge pk
    WHERE pk.metadata @> filter
    ORDER BY pk.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


-- ============================================================
-- Verification queries (run these to confirm setup)
-- ============================================================

-- Should return the extension:
-- SELECT * FROM pg_extension WHERE extname = 'vector';

-- After seeding, check row counts per persona:
-- SELECT metadata->>'persona_id' AS persona, COUNT(*) AS chunks
-- FROM persona_knowledge
-- GROUP BY metadata->>'persona_id';

-- Test the match function manually:
-- SELECT id, content, similarity
-- FROM match_persona_knowledge(
--     '[0.1, 0.2, ...]'::vector(1536),  -- replace with real embedding
--     3,
--     '{"persona_id": "mandela"}'
-- );
