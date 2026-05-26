"""
Phase 1 — Parse & Tag
=====================
Converts each persona PDF into tagged JSONL chunks ready for embedding.

Pipeline per PDF:
  1. Extract text page-by-page with PyMuPDF
  2. Filter boilerplate pages (TOC, copyright, index, preface)
  3. Sliding-window chunker with sentence-boundary snap (~1 500 chars / chunk)
  4. Tag each chunk via local Qwen2.5-1.5B (Ollama) → JSON metadata
  5. Append to data/processed/<persona>_tagged.jsonl (resume-safe)

Prereqs:
  pip install pymupdf requests
  ollama pull qwen2.5:1.5b          # model must be running in Ollama

Run:
  python data/01_parse_and_tag.py
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import fitz  # PyMuPDF
import requests

# ── Paths ────────────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent
PROCESSED_DIR = DATA_DIR / "processed"
PROCESSED_DIR.mkdir(exist_ok=True)

# Each PDF filename maps to its persona_id in the debate system
PERSONAS: dict[str, str] = {
    "gandhi.pdf": "gandhi",
    "hitler.pdf": "hitler",
    "mandela.pdf": "mandela",
}

# ── Ollama config ─────────────────────────────────────────────────────────────
OLLAMA_BASE = "http://localhost:11434"
OLLAMA_MODEL = "qwen2.5:1.5b"

# ── Chunking config ───────────────────────────────────────────────────────────
CHUNK_TARGET_CHARS = 1_500   # ~375–400 words, ~500 BPE tokens
CHUNK_OVERLAP_CHARS = 300
MIN_CHUNK_CHARS = 200
MIN_CHUNK_WORDS = 35

# ── Boilerplate detection keywords ────────────────────────────────────────────
_BOILERPLATE_PHRASES = (
    "all rights reserved",
    "isbn ",
    "printed in",
    "first published",
    "copyright ©",
    "published by",
    "no part of this",
    "cataloging-in-publication",
    "library of congress",
    "acknowledgements",
    "acknowledgments",
    "bibliography",
    "index\n",
    "further reading",
    "select bibliography",
)

# ── LLM tagging prompt ────────────────────────────────────────────────────────
# Keep it tight so the 1.5 B model doesn't hallucinate
_TAGGING_PROMPT = """\
You are an expert biographer. Read the text below and output ONLY a JSON object — \
no explanation, no markdown, no code fences.

Text:
{text}

JSON fields (required):
  "topic_keywords"         – list of 3-5 core themes (strings)
  "ethical_dilemma_type"  – one of: "Conflict Resolution", "Duty vs. Desire",
                            "Personal Integrity", "Justice vs. Mercy",
                            "Individual vs. Collective", "Violence vs. Non-violence",
                            "Means vs. Ends", "Power and Leadership",
                            "Identity and Belonging", "Historical Context", "None"
  "philosophical_summary" – one sentence: the moral stance or worldview in this text

Example:
{{"topic_keywords":["Non-violence","Civil Disobedience","Colonial Resistance"],"ethical_dilemma_type":"Violence vs. Non-violence","philosophical_summary":"Moral strength lies in refusing to answer violence with violence, as soul-force ultimately prevails over brute force."}}
"""


# ─────────────────────────────────────────────────────────────────────────────
# Text extraction
# ─────────────────────────────────────────────────────────────────────────────

def extract_pages(pdf_path: Path) -> list[dict]:
    """Return list of {page_num, text} dicts for every page in the PDF."""
    doc = fitz.open(str(pdf_path))
    pages = []
    for idx, page in enumerate(doc, start=1):
        raw = page.get_text("text")
        cleaned = _clean_raw_text(raw)
        if cleaned:
            pages.append({"page_num": idx, "text": cleaned})
    doc.close()
    return pages


def _clean_raw_text(text: str) -> str:
    """Normalise whitespace and fix common PDF extraction artefacts."""
    # Rejoin soft-hyphenated line breaks  ("hyphen-\nnation" → "hyphenation")
    text = re.sub(r"-\n(\w)", r"\1", text)
    # Collapse blank lines to at most one
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Strip lines that are just a page number (isolated digit sequence)
    text = re.sub(r"(?m)^\s*\d{1,4}\s*$", "", text)
    # Strip per-line leading/trailing whitespace
    lines = [ln.strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln).strip()


def _is_boilerplate(text: str) -> bool:
    """Return True if the page looks like front/back matter to skip."""
    word_count = len(text.split())
    if word_count < 30:
        return True  # nearly empty page

    lower = text.lower()

    # Copyright / legal pages
    if any(phrase in lower for phrase in _BOILERPLATE_PHRASES):
        return True

    # Table-of-contents: many lines with "… 123" dot-leader patterns
    dot_leader_lines = len(re.findall(r"\.{3,}\s*\d+", text))
    if dot_leader_lines >= 3:
        return True

    # Index pages: dense short entries, majority lines have page refs
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if lines:
        page_ref_ratio = sum(1 for ln in lines if re.search(r"\d+$", ln)) / len(lines)
        if page_ref_ratio > 0.6 and word_count < 200:
            return True

    return False


# ─────────────────────────────────────────────────────────────────────────────
# Chunking
# ─────────────────────────────────────────────────────────────────────────────

def chunk_pages(pages: list[dict]) -> list[dict]:
    """
    Concatenate non-boilerplate pages and apply a sliding-window splitter
    that snaps to sentence boundaries.
    Returns list of {chunk_index, page_num, char_start, char_end, text}.
    """
    # Build one big string, tracking which page each character came from
    full_text = ""
    page_spans: list[dict] = []  # {start, end, page_num}

    for page in pages:
        if _is_boilerplate(page["text"]):
            continue
        start = len(full_text)
        full_text += page["text"] + "\n\n"
        page_spans.append({"start": start, "end": len(full_text), "page_num": page["page_num"]})

    chunks: list[dict] = []
    pos = 0
    idx = 0

    while pos < len(full_text):
        end = pos + CHUNK_TARGET_CHARS
        slice_ = full_text[pos:end]

        # Snap to last sentence boundary if we're not at the very end
        if end < len(full_text):
            # Prefer ". " boundary (avoid splitting mid-sentence)
            snap = max(
                slice_.rfind(". "),
                slice_.rfind(".\n"),
                slice_.rfind("? "),
                slice_.rfind("! "),
            )
            if snap > CHUNK_TARGET_CHARS // 2:
                slice_ = slice_[: snap + 1]

        text = slice_.strip()
        if len(text) >= MIN_CHUNK_CHARS and len(text.split()) >= MIN_CHUNK_WORDS:
            # Identify which page this chunk started on
            page_num = _page_at(pos, page_spans)
            chunks.append({
                "chunk_index": idx,
                "page_num": page_num,
                "char_start": pos,
                "char_end": pos + len(text),
                "text": text,
            })
            idx += 1

        advance = len(slice_) - CHUNK_OVERLAP_CHARS
        if advance <= 0:
            advance = max(1, len(slice_))
        pos += advance

    return chunks


def _page_at(pos: int, spans: list[dict]) -> int | None:
    for span in spans:
        if span["start"] <= pos < span["end"]:
            return span["page_num"]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Ollama / LLM tagging
# ─────────────────────────────────────────────────────────────────────────────

def _ollama_tag(text: str, retries: int = 2) -> dict:
    """
    Call local Ollama to tag a chunk.  Returns metadata dict.
    On repeated failure returns a safe default so the pipeline keeps running.
    """
    # Truncate to avoid blowing the small model's context (keep ~900 chars)
    prompt = _TAGGING_PROMPT.format(text=text[:900])

    for attempt in range(retries + 1):
        try:
            resp = requests.post(
                f"{OLLAMA_BASE}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "format": "json",
                    "stream": False,
                    "options": {
                        "temperature": 0.05,   # near-deterministic for structured output
                        "num_predict": 256,
                        "top_p": 0.9,
                    },
                },
                timeout=90,
            )
            resp.raise_for_status()
            meta = json.loads(resp.json()["response"])

            # Validate structure
            keywords = meta.get("topic_keywords", [])
            dilemma  = meta.get("ethical_dilemma_type", "None")
            summary  = meta.get("philosophical_summary", "")

            if not isinstance(keywords, list):
                keywords = []
            # Clamp list length
            keywords = [str(k) for k in keywords[:5]]

            return {
                "topic_keywords": keywords,
                "ethical_dilemma_type": str(dilemma)[:80],
                "philosophical_summary": str(summary)[:300],
            }

        except (json.JSONDecodeError, KeyError, AssertionError) as exc:
            if attempt < retries:
                time.sleep(1)
                continue
            print(f"\n    [WARN] tag parse error (attempt {attempt+1}): {exc}")
        except requests.RequestException as exc:
            if attempt < retries:
                time.sleep(2)
                continue
            print(f"\n    [WARN] Ollama request error: {exc}")

    return {
        "topic_keywords": [],
        "ethical_dilemma_type": "None",
        "philosophical_summary": "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Per-persona processing
# ─────────────────────────────────────────────────────────────────────────────

def process_persona(pdf_name: str, persona_id: str) -> None:
    pdf_path = DATA_DIR / pdf_name
    if not pdf_path.exists():
        print(f"  [SKIP] {pdf_path} not found.")
        return

    out_path = PROCESSED_DIR / f"{persona_id}_tagged.jsonl"

    # Resume: collect already-processed chunk indices
    done: set[int] = set()
    if out_path.exists():
        with open(out_path, "r", encoding="utf-8") as fh:
            for line in fh:
                try:
                    done.add(json.loads(line)["chunk_index"])
                except Exception:
                    pass

    print(f"\n{'─'*60}")
    print(f"  Persona : {persona_id}  ←  {pdf_name}")

    print("  Extracting pages…")
    pages = extract_pages(pdf_path)
    print(f"  Pages extracted      : {len(pages)}")

    print("  Chunking…")
    chunks = chunk_pages(pages)
    print(f"  Chunks produced      : {len(chunks)}")
    if done:
        print(f"  Already tagged       : {len(done)}  (resuming from last checkpoint)")

    remaining = [c for c in chunks if c["chunk_index"] not in done]
    print(f"  Chunks to process    : {len(remaining)}")

    with open(out_path, "a", encoding="utf-8") as fh:
        for i, chunk in enumerate(remaining):
            pct = (i + 1) / len(remaining) * 100
            print(
                f"  [{i+1:>4}/{len(remaining)}  {pct:5.1f}%]  "
                f"chunk {chunk['chunk_index']:>4}  (p.{chunk['page_num']})  …",
                end="",
                flush=True,
            )
            t0 = time.time()
            meta = _ollama_tag(chunk["text"])
            elapsed = time.time() - t0

            record = {
                "persona_id": persona_id,
                "chunk_index": chunk["chunk_index"],
                "page_num": chunk["page_num"],
                "content": chunk["text"],
                "source": str(pdf_path),
                **meta,
            }
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            fh.flush()

            kw_preview = ", ".join(meta["topic_keywords"][:3]) or "—"
            print(f"  [{elapsed:.1f}s]  {kw_preview}")

    print(f"\n  Saved → {out_path}")
    print(f"  Total records in file: {len(done) + len(remaining)}")


# ─────────────────────────────────────────────────────────────────────────────
# Preflight check
# ─────────────────────────────────────────────────────────────────────────────

def _check_ollama() -> bool:
    try:
        resp = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=5)
        models = [m["name"] for m in resp.json().get("models", [])]
        if not any(OLLAMA_MODEL.split(":")[0] in m for m in models):
            print(f"[ERROR] Model '{OLLAMA_MODEL}' is not pulled in Ollama.")
            print(f"        Run:  ollama pull {OLLAMA_MODEL}")
            return False
        return True
    except Exception as exc:
        print(f"[ERROR] Cannot reach Ollama at {OLLAMA_BASE}: {exc}")
        print("        Make sure Ollama is running:  ollama serve")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  Debate Arena — Phase 1: Parse & Tag")
    print("=" * 60)

    if not _check_ollama():
        sys.exit(1)

    # Optionally filter to a single persona: python 01_parse_and_tag.py gandhi
    target = sys.argv[1] if len(sys.argv) > 1 else None

    for pdf_name, persona_id in PERSONAS.items():
        if target and persona_id != target:
            continue
        process_persona(pdf_name, persona_id)

    print("\n" + "=" * 60)
    print("  Phase 1 complete — tagged JSONL files are in data/processed/")
    print("  Next: run  python data/02_embed_and_store.py")
    print("=" * 60)
