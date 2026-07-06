"""
Phase 1 — Parse & Tag
=====================
Converts each persona source document into tagged JSONL chunks ready for embedding.

Pipeline per document:
  1. Extract text (PyMuPDF for .pdf, python-docx for .docx)
  2. Keep only the configured page range, then filter residual boilerplate
  3. Sliding-window chunker with sentence-boundary snap (~1 500 chars / chunk)
  4. Tag each chunk via Segmind API (Llama 3.1 8B) → JSON metadata
     (runs PARALLEL_WORKERS requests concurrently)
  5. Append to data/processed/<persona>_tagged.jsonl (resume-safe)

Prereqs:
  pip install pymupdf python-docx openai python-dotenv
  SEGMIND_API_KEY set in .env

Run:
  python data/01_parse_and_tag.py           # all personas
  python data/01_parse_and_tag.py gandhi    # single persona
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import fitz  # PyMuPDF
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

# ── Paths ────────────────────────────────────────────────────────────────────
DATA_DIR = Path(__file__).parent
PROCESSED_DIR = DATA_DIR / "processed"
PROCESSED_DIR.mkdir(exist_ok=True)

# Each source filename maps to its persona_id in the debate system.
# Supported formats: .pdf, .docx
PERSONAS: dict[str, str] = {
    "gandhi.pdf": "gandhi",
    "mandela.pdf": "mandela",
    "karl-marx.docx": "marx",
}

# Main-text page range per PDF (1-based, inclusive). Pages outside the range
# are skipped entirely — this is more reliable than heuristics for skipping
# front matter (contents, copyright) and back matter (index, bibliography).
# Open each PDF once, note where the actual text starts/ends, and set it here.
# None = no manual range; fall back to heuristic boilerplate detection only.
# (.docx files have no pages — ranges do not apply to them.)
PAGE_RANGES: dict[str, tuple[int, int] | None] = {
    "gandhi.pdf": None,   # TODO: set after eyeballing, e.g. (9, 380)
    "mandela.pdf": None,  # TODO: set after eyeballing
}

# ── Segmind / LLM config ──────────────────────────────────────────────────────
_SEGMIND_MODEL = os.getenv("SEGMIND_MODEL", "llama-v3p1-8b-instruct")
PARALLEL_WORKERS = 6  # concurrent tagging requests to the Segmind API
_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.getenv("SEGMIND_API_KEY")
        if not api_key:
            print("[ERROR] SEGMIND_API_KEY is not set. Add it to your .env file.")
            sys.exit(1)
        _client = OpenAI(
            api_key=api_key,
            base_url=os.getenv("SEGMIND_BASE_URL", "https://api.segmind.com/v1"),
        )
    return _client


# ── Chunking config ───────────────────────────────────────────────────────────
CHUNK_TARGET_CHARS = 1_500
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

def extract_pages(doc_path: Path) -> list[dict]:
    """
    Return list of {page_num, text} dicts for the document.
    PDFs: one dict per page, respecting PAGE_RANGES if configured.
    DOCX: paragraphs grouped into synthetic "pages" of ~3000 chars
          (page_num is the ordinal of the group, since .docx has no pages).
    """
    if doc_path.suffix.lower() == ".docx":
        return _extract_docx(doc_path)
    return _extract_pdf(doc_path)


def _extract_pdf(pdf_path: Path) -> list[dict]:
    page_range = PAGE_RANGES.get(pdf_path.name)
    doc = fitz.open(str(pdf_path))
    pages = []
    for idx, page in enumerate(doc, start=1):
        if page_range and not (page_range[0] <= idx <= page_range[1]):
            continue
        raw = page.get_text("text")
        cleaned = _clean_raw_text(raw)
        if cleaned:
            pages.append({"page_num": idx, "text": cleaned})
    doc.close()
    return pages


def _extract_docx(docx_path: Path) -> list[dict]:
    from docx import Document

    doc = Document(str(docx_path))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]

    # Group paragraphs into synthetic pages so downstream chunking/boilerplate
    # filtering works the same as for PDFs.
    pages: list[dict] = []
    buffer: list[str] = []
    buf_len = 0
    group_num = 1

    for para in paragraphs:
        buffer.append(para)
        buf_len += len(para)
        if buf_len >= 3_000:
            pages.append({"page_num": group_num, "text": _clean_raw_text("\n".join(buffer))})
            buffer, buf_len = [], 0
            group_num += 1

    if buffer:
        pages.append({"page_num": group_num, "text": _clean_raw_text("\n".join(buffer))})

    return [p for p in pages if p["text"]]


def _clean_raw_text(text: str) -> str:
    text = re.sub(r"-\n(\w)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"(?m)^\s*\d{1,4}\s*$", "", text)
    lines = [ln.strip() for ln in text.splitlines()]
    return "\n".join(ln for ln in lines if ln).strip()


def _is_boilerplate(text: str) -> bool:
    word_count = len(text.split())
    if word_count < 30:
        return True

    lower = text.lower()
    if any(phrase in lower for phrase in _BOILERPLATE_PHRASES):
        return True

    dot_leader_lines = len(re.findall(r"\.{3,}\s*\d+", text))
    if dot_leader_lines >= 3:
        return True

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
    full_text = ""
    page_spans: list[dict] = []

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

        if end < len(full_text):
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
# Segmind / LLM tagging
# ─────────────────────────────────────────────────────────────────────────────

def _segmind_tag(text: str, retries: int = 2) -> dict:
    """Call Segmind API (Llama 3.1 8B) to tag a chunk. Returns metadata dict."""
    prompt = _TAGGING_PROMPT.format(text=text[:1_500])

    for attempt in range(retries + 1):
        try:
            response = _get_client().chat.completions.create(
                model=_SEGMIND_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": "You output only valid JSON. No markdown, no explanation, no code fences.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.05,
                max_tokens=256,
            )
            raw = response.choices[0].message.content or ""

            raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
            raw = re.sub(r"\s*```$", "", raw)

            meta = json.loads(raw)

            keywords = meta.get("topic_keywords", [])
            dilemma  = meta.get("ethical_dilemma_type", "None")
            summary  = meta.get("philosophical_summary", "")

            if not isinstance(keywords, list):
                keywords = []
            keywords = [str(k) for k in keywords[:5]]

            return {
                "topic_keywords": keywords,
                "ethical_dilemma_type": str(dilemma)[:80],
                "philosophical_summary": str(summary)[:300],
            }

        except (json.JSONDecodeError, KeyError) as exc:
            if attempt < retries:
                time.sleep(1)
                continue
            print(f"\n    [WARN] tag parse error (attempt {attempt+1}): {exc}")
        except Exception as exc:
            if attempt < retries:
                time.sleep(2)
                continue
            print(f"\n    [WARN] Segmind API error: {exc}")

    return {
        "topic_keywords": [],
        "ethical_dilemma_type": "None",
        "philosophical_summary": "",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Per-persona processing
# ─────────────────────────────────────────────────────────────────────────────

def process_persona(doc_name: str, persona_id: str) -> None:
    doc_path = DATA_DIR / doc_name
    if not doc_path.exists():
        print(f"  [SKIP] {doc_path} not found.")
        return

    out_path = PROCESSED_DIR / f"{persona_id}_tagged.jsonl"

    done: set[int] = set()
    if out_path.exists():
        with open(out_path, "r", encoding="utf-8") as fh:
            for line in fh:
                try:
                    done.add(json.loads(line)["chunk_index"])
                except Exception:
                    pass

    print(f"\n{'─'*60}")
    print(f"  Persona : {persona_id}  ←  {doc_name}")

    print("  Extracting pages…")
    pages = extract_pages(doc_path)
    print(f"  Pages extracted      : {len(pages)}")

    print("  Chunking…")
    chunks = chunk_pages(pages)
    print(f"  Chunks produced      : {len(chunks)}")
    if done:
        print(f"  Already tagged       : {len(done)}  (resuming from last checkpoint)")

    remaining = [c for c in chunks if c["chunk_index"] not in done]
    print(f"  Chunks to process    : {len(remaining)}  ({PARALLEL_WORKERS} parallel workers)")

    if not remaining:
        print("  Nothing to do.")
        return

    write_lock = threading.Lock()
    completed = 0
    t_start = time.time()

    def tag_and_save(chunk: dict) -> None:
        nonlocal completed
        meta = _segmind_tag(chunk["text"])
        record = {
            "persona_id": persona_id,
            "chunk_index": chunk["chunk_index"],
            "page_num": chunk["page_num"],
            "content": chunk["text"],
            "source": str(doc_path),
            **meta,
        }
        with write_lock:
            with open(out_path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            completed += 1
            pct = completed / len(remaining) * 100
            rate = completed / max(time.time() - t_start, 1e-6)
            eta_min = (len(remaining) - completed) / max(rate, 1e-6) / 60
            kw_preview = ", ".join(meta["topic_keywords"][:3]) or "—"
            print(
                f"  [{completed:>4}/{len(remaining)}  {pct:5.1f}%  "
                f"ETA {eta_min:4.1f}m]  chunk {chunk['chunk_index']:>4}  {kw_preview}"
            )

    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as pool:
        futures = [pool.submit(tag_and_save, c) for c in remaining]
        for fut in as_completed(futures):
            fut.result()  # surface any unexpected exception

    print(f"\n  Saved → {out_path}")
    print(f"  Total records in file: {len(done) + len(remaining)}")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  Debate Arena — Phase 1: Parse & Tag")
    print("=" * 60)

    # Fail fast if the API key is missing before processing any documents
    _get_client()

    target = sys.argv[1] if len(sys.argv) > 1 else None

    for doc_name, persona_id in PERSONAS.items():
        if target and persona_id != target:
            continue
        process_persona(doc_name, persona_id)

    print("\n" + "=" * 60)
    print("  Phase 1 complete — tagged JSONL files are in data/processed/")
    print("  Next: run  python data/02_embed_and_store.py")
    print("=" * 60)
