import sqlite3
from typing import List, Tuple, Optional, Dict
import json
import numpy as np
import re

from .db import get_conn
from .config import settings


def create_kb(name: str) -> int:
    with get_conn() as conn:
        cur = conn.execute("INSERT INTO knowledgebase(name) VALUES(?)", (name,))
        return cur.lastrowid


def list_kb() -> List[Tuple[int, str]]:
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name FROM knowledgebase ORDER BY created_at DESC").fetchall()
        return [(r["id"], r["name"]) for r in rows]


def add_document(kb_id: int, source: str, title: str, type_: str, content: str, meta: Optional[dict] = None) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO document(kb_id, source, title, type, content, meta) VALUES(?,?,?,?,?,?)",
            (kb_id, source, title, type_, content, json.dumps(meta or {})),
        )
        doc_id = cur.lastrowid
        # also insert into document-level FTS for quick lookup
        conn.execute("INSERT INTO doc_fts(content, document_id) VALUES(?,?)", (content, doc_id))
        return doc_id


def upsert_embeddings(document_id: int, chunks: List[str], vectors: List[List[float]]):
    with get_conn() as conn:
        for idx, (text, vec) in enumerate(zip(chunks, vectors)):
            arr = np.asarray(vec, dtype=np.float32)
            dim = int(arr.shape[0]) if arr.ndim == 1 else 0
            # Normalize once and store; cosine becomes dot product at query time
            norm = float(np.linalg.norm(arr))
            if norm > 0:
                arr = arr / norm
                is_norm = 1
            else:
                is_norm = 0
            # UPSERT by document_id + chunk_index
            conn.execute(
                """
                INSERT INTO embedding(document_id, chunk_index, vector, text, model, dim, is_normalized)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(document_id, chunk_index) DO UPDATE SET
                    vector=excluded.vector,
                    text=excluded.text,
                    model=excluded.model,
                    dim=excluded.dim,
                    is_normalized=excluded.is_normalized
                """,
                (document_id, idx, arr.tobytes(), text, settings.embedding_model, dim, is_norm),
            )
            # Insert/update chunk-level FTS for hybrid alignment (delete-then-insert to emulate upsert)
            conn.execute("DELETE FROM chunk_fts WHERE document_id=? AND chunk_index=?", (document_id, idx))
            conn.execute(
                "INSERT INTO chunk_fts(content, document_id, chunk_index) VALUES(?,?,?)",
                (text, document_id, idx)
            )


def kb_docs(kb_ids: List[int]) -> List[int]:
    if not kb_ids:
        return []
    with get_conn() as conn:
        qmarks = ",".join(["?"] * len(kb_ids))
        rows = conn.execute(f"SELECT id FROM document WHERE kb_id IN ({qmarks})", kb_ids).fetchall()
        return [r["id"] for r in rows]


def semantic_search(kb_ids: List[int], query_vec: List[float], top_k: int = 5) -> List[Dict]:
    # brute-force cosine search over selected docs' embeddings
    doc_ids = kb_docs(kb_ids)
    if not doc_ids:
        return []
    qmarks = ",".join(["?"] * len(doc_ids))
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT e.document_id, e.chunk_index, e.vector, e.text, e.dim, d.source, d.title, d.kb_id, d.meta FROM embedding e JOIN document d ON e.document_id=d.id WHERE e.document_id IN ({qmarks})",
            doc_ids,
        ).fetchall()
    q = np.asarray(query_vec, dtype=np.float32)
    # Normalize query to match stored normalized vectors
    qn = q / np.linalg.norm(q) if np.linalg.norm(q) != 0 else q
    scored = []
    for r in rows:
        v = np.frombuffer(r["vector"], dtype=np.float32)
        # Skip if dimensions don't match (can happen if model changed and old rows lack dim)
        if v.shape[0] != q.shape[0]:
            continue
        # Stored vectors may be normalized; use dot if both are normalized, else fallback to cosine
        if float(np.linalg.norm(v)) in (0.0, 1.0):
            sim = float(np.dot(qn, v))
        else:
            denom = (np.linalg.norm(q) * np.linalg.norm(v))
            sim = float(np.dot(q, v) / denom) if denom != 0 else 0.0
        meta = {}
        try:
            meta = json.loads(r["meta"]) if r["meta"] else {}
        except Exception:
            meta = {}
        scored.append({
            "document_id": r["document_id"],
            "chunk_index": r["chunk_index"],
            "text": r["text"],
            "source": r["source"],
            "title": r["title"],
            "score": sim,
            "kb_id": r["kb_id"],
            "file_path": meta.get("file_path"),
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]

def _sanitize_fts_query(q: str) -> str:
    # Keep alphanumerics/underscore, space-separate tokens for FTS MATCH
    toks = re.findall(r"[\w]+", q.lower())
    return " ".join(toks)


def keyword_search(kb_ids: List[int], query: str, top_k: int = 20) -> List[Dict]:
    doc_ids = kb_docs(kb_ids)
    if not doc_ids:
        return []
    qmarks = ",".join(["?"] * len(doc_ids))
    safe = _sanitize_fts_query(query)
    if not safe:
        return []
    # Prefer chunk-level FTS if available for better hybrid alignment
    try:
        with get_conn() as conn:
            rows = conn.execute(
                f"SELECT f.document_id, f.chunk_index, f.content, d.source, d.title, d.kb_id, d.meta, bm25(chunk_fts) AS rank FROM chunk_fts f JOIN document d ON d.id=f.document_id WHERE f.document_id IN ({qmarks}) AND chunk_fts MATCH ? ORDER BY rank LIMIT ?",
                (*doc_ids, safe, top_k)
            ).fetchall()
    except sqlite3.OperationalError:
        # Fallback to document-level FTS
        try:
            with get_conn() as conn:
                rows = conn.execute(
                    f"SELECT f.document_id, 0 as chunk_index, f.content, d.source, d.title, d.kb_id, d.meta, bm25(doc_fts) AS rank FROM doc_fts f JOIN document d ON d.id=f.document_id WHERE f.document_id IN ({qmarks}) AND doc_fts MATCH ? ORDER BY rank LIMIT ?",
                    (*doc_ids, safe, top_k)
                ).fetchall()
        except sqlite3.OperationalError:
            rows = []
    out: List[Dict] = []
    for r in rows:
        # lower bm25 is better; convert to score-ish
        score = 1.0 / (1.0 + float(r["rank"]))
        meta = {}
        try:
            meta = json.loads(r.get("meta")) if isinstance(r, dict) and r.get("meta") else json.loads(r["meta"]) if r["meta"] else {}
        except Exception:
            meta = {}
        out.append({
            "document_id": r["document_id"],
            "chunk_index": r["chunk_index"],
            "text": r["content"],
            "source": r["source"],
            "title": r["title"],
            "score": score,
            "kb_id": r["kb_id"],
            "file_path": meta.get("file_path"),
        })
    return out

def hybrid_search(kb_ids: List[int], query: str, query_vec: List[float], top_k: int = 10, alpha: float = 0.6) -> List[Dict]:
    sem = semantic_search(kb_ids, query_vec, top_k=top_k)
    kw = keyword_search(kb_ids, query, top_k=max(20, top_k * 2))
    # index by (document_id, chunk_index) to blend per chunk
    merged: Dict[Tuple[int, int], Dict] = {}
    for item in sem:
        merged[(item["document_id"], item["chunk_index"])] = {**item, "sem": item["score"], "kw": 0.0}
    for item in kw:
        key = (item["document_id"], item["chunk_index"])
        if key in merged:
            merged[key]["kw"] = max(merged[key].get("kw", 0.0), item["score"])  # take best kw score
        else:
            merged[key] = {**item, "sem": 0.0, "kw": item["score"]}
    results = []
    for v in merged.values():
        v["score"] = alpha * v.get("sem", 0.0) + (1 - alpha) * v.get("kw", 0.0)
        results.append(v)
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]

def list_documents(kb_id: int) -> List[Dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, source, title, type, created_at FROM document WHERE kb_id=? ORDER BY created_at DESC",
            (kb_id,)
        ).fetchall()
        return [dict(id=r["id"], source=r["source"], title=r["title"], type=r["type"], created_at=r["created_at"]) for r in rows]

def delete_document(doc_id: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM embedding WHERE document_id=?", (doc_id,))
        conn.execute("DELETE FROM doc_fts WHERE document_id=?", (doc_id,))
        conn.execute("DELETE FROM chunk_fts WHERE document_id=?", (doc_id,))
        conn.execute("DELETE FROM document WHERE id=?", (doc_id,))

def delete_kb(kb_id: int):
    with get_conn() as conn:
        rows = conn.execute("SELECT id FROM document WHERE kb_id=?", (kb_id,)).fetchall()
        doc_ids = [r["id"] for r in rows]
        if doc_ids:
            qmarks = ",".join(["?"] * len(doc_ids))
            conn.execute(f"DELETE FROM embedding WHERE document_id IN ({qmarks})", doc_ids)
            conn.execute(f"DELETE FROM doc_fts WHERE document_id IN ({qmarks})", doc_ids)
            conn.execute(f"DELETE FROM chunk_fts WHERE document_id IN ({qmarks})", doc_ids)
            conn.execute(f"DELETE FROM document WHERE id IN ({qmarks})", doc_ids)
        conn.execute("DELETE FROM knowledgebase WHERE id=?", (kb_id,))

def get_document(doc_id: int) -> Optional[Dict]:
    with get_conn() as conn:
        r = conn.execute(
            "SELECT id, kb_id, source, title, type, content, meta FROM document WHERE id=?",
            (doc_id,)
        ).fetchone()
        if not r:
            return None
        try:
            meta = json.loads(r["meta"]) if r["meta"] else {}
        except Exception:
            meta = {}
        return {
            "id": r["id"],
            "kb_id": r["kb_id"],
            "source": r["source"],
            "title": r["title"],
            "type": r["type"],
            "content": r["content"],
            "file_path": meta.get("file_path"),
        }

def get_documents_by_ids(doc_ids: List[int]) -> Dict[int, Dict]:
    if not doc_ids:
        return {}
    qmarks = ",".join(["?"] * len(doc_ids))
    out: Dict[int, Dict] = {}
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT id, kb_id, source, title, type, content, meta FROM document WHERE id IN ({qmarks})",
            doc_ids
        ).fetchall()
        for r in rows:
            try:
                meta = json.loads(r["meta"]) if r["meta"] else {}
            except Exception:
                meta = {}
            out[r["id"]] = {
                "id": r["id"],
                "kb_id": r["kb_id"],
                "source": r["source"],
                "title": r["title"],
                "type": r["type"],
                "content": r["content"],
                "file_path": meta.get("file_path"),
            }
    return out
