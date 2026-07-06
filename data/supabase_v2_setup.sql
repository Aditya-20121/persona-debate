-- =============================================================================
-- Debate Arena — v2 Supabase Schema
-- =============================================================================
-- Run this once in your Supabase SQL editor BEFORE running Phase 2
-- (data/02_embed_and_store.py).
--
-- This schema replaces the original persona_knowledge table.
-- The old table is left untouched; the new pipeline uses persona_chunks.
-- =============================================================================

-- Ensure pgvector extension is available
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Table: persona_chunks
-- Stores PDF-sourced knowledge chunks with rich philosophical metadata and
-- 1024-dimensional BGE-large embeddings (BAAI/bge-large-en-v1.5).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persona_chunks (
    id                     BIGSERIAL   PRIMARY KEY,
    persona_id             TEXT        NOT NULL,           -- "gandhi" | "mandela" | "marx"
    content                TEXT        NOT NULL,           -- raw passage text
    topic_keywords         TEXT[]      NOT NULL DEFAULT '{}', -- e.g. {"Non-violence","Colonialism"}
    ethical_dilemma_type   TEXT        DEFAULT 'None',     -- see tagging taxonomy
    philosophical_summary  TEXT        DEFAULT '',         -- one-sentence stance summary
    chunk_index            INTEGER,                        -- sequential position within persona
    page_num               INTEGER,                        -- source PDF page (approximate)
    source                 TEXT        DEFAULT '',         -- absolute path to source PDF
    embedding              VECTOR(1024)                    -- BGE-large-en-v1.5 passage embedding
);

-- Index: fast persona_id equality filter (used in every query)
CREATE INDEX IF NOT EXISTS idx_persona_chunks_persona_id
    ON persona_chunks (persona_id);

-- Index: keyword-array filtering for potential future topic-scoped queries
CREATE INDEX IF NOT EXISTS idx_persona_chunks_keywords
    ON persona_chunks
    USING GIN (topic_keywords);

-- ⚠️  IVFFlat index — IMPORTANT: run this block SEPARATELY, AFTER
--    data/02_embed_and_store.py has finished inserting all rows.
--    IVFFlat requires data to be present to initialise its centroids;
--    creating it on an empty table gives poor query performance.
--
--    Step A (this file, before Phase 2): creates table + GIN + B-tree indexes.
--    Step B (after Phase 2 completes):  paste and run the block below.
--
-- CREATE INDEX idx_persona_chunks_embedding
--     ON persona_chunks
--     USING ivfflat (embedding vector_cosine_ops)
--     WITH (lists = 50);
--
-- If you already ran Phase 2 before creating the index, just run:
--     REINDEX TABLE persona_chunks;


-- -----------------------------------------------------------------------------
-- Function: match_persona_chunks
-- Returns top-k chunks for a given persona, ordered by cosine similarity.
-- Called from Python as:
--   client.rpc("match_persona_chunks", {
--       "query_embedding": [...],
--       "match_count": 15,
--       "p_persona_id": "gandhi"
--   }).execute()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_persona_chunks(
    query_embedding   VECTOR(1024),
    match_count       INTEGER DEFAULT 10,
    p_persona_id      TEXT    DEFAULT ''
)
RETURNS TABLE (
    id                     BIGINT,
    content                TEXT,
    topic_keywords         TEXT[],
    ethical_dilemma_type   TEXT,
    philosophical_summary  TEXT,
    chunk_index            INTEGER,
    page_num               INTEGER,
    similarity             FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pc.id,
        pc.content,
        pc.topic_keywords,
        pc.ethical_dilemma_type,
        pc.philosophical_summary,
        pc.chunk_index,
        pc.page_num,
        -- Convert cosine distance to similarity: 1 = identical, 0 = orthogonal
        1.0 - (pc.embedding <=> query_embedding)  AS similarity
    FROM
        persona_chunks pc
    WHERE
        pc.persona_id = p_persona_id
    ORDER BY
        pc.embedding <=> query_embedding   -- ascending distance = descending similarity
    LIMIT match_count;
END;
$$;


-- -----------------------------------------------------------------------------
-- Optional: helper view for quick inspection
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW persona_chunk_stats AS
SELECT
    persona_id,
    COUNT(*)                                AS total_chunks,
    ROUND(AVG(LENGTH(content)))::INT        AS avg_content_chars,
    COUNT(*) FILTER (WHERE philosophical_summary <> '')  AS tagged_chunks,
    MIN(page_num)                           AS first_page,
    MAX(page_num)                           AS last_page
FROM persona_chunks
GROUP BY persona_id
ORDER BY persona_id;
