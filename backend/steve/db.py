import os
import sqlite3
from contextlib import contextmanager

from .config import settings

os.makedirs(os.path.dirname(os.path.abspath(settings.db_path)), exist_ok=True)

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS knowledgebase (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kb_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    title TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    meta TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(kb_id) REFERENCES knowledgebase(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
    content,
    document_id UNINDEXED,
    tokenize = 'porter'
);

CREATE TABLE IF NOT EXISTS embedding (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    vector BLOB NOT NULL,
    text TEXT NOT NULL,
    model TEXT,
    dim INTEGER,
    is_normalized INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(document_id) REFERENCES document(id)
);

CREATE INDEX IF NOT EXISTS idx_embedding_doc ON embedding(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_kb ON document(kb_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_embedding_doc_chunk ON embedding(document_id, chunk_index);

-- Chunk-level FTS for hybrid alignment
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    content,
    document_id UNINDEXED,
    chunk_index UNINDEXED,
    tokenize = 'porter'
);
"""

@contextmanager
def get_conn():
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()

with get_conn() as conn:
    conn.executescript(SCHEMA_SQL)
    # Lightweight migrations for existing DBs: add columns if missing
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(embedding)").fetchall()}
        if "model" not in cols:
            conn.execute("ALTER TABLE embedding ADD COLUMN model TEXT")
        if "dim" not in cols:
            conn.execute("ALTER TABLE embedding ADD COLUMN dim INTEGER")
        if "is_normalized" not in cols:
            conn.execute("ALTER TABLE embedding ADD COLUMN is_normalized INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass
    # Ensure indexes exist (idempotent in SQLite with IF NOT EXISTS above)
    # Backfill chunk_fts from existing embeddings if empty
    try:
        cnt = conn.execute("SELECT COUNT(*) AS c FROM chunk_fts").fetchone()["c"]
        if cnt == 0:
            rows = conn.execute("SELECT document_id, chunk_index, text FROM embedding").fetchall()
            for r in rows:
                conn.execute(
                    "INSERT INTO chunk_fts(content, document_id, chunk_index) VALUES(?,?,?)",
                    (r["text"], r["document_id"], r["chunk_index"]),
                )
    except Exception:
        # ignore if table not present or other issues
        pass
