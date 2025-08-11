import os
import json
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from typing import List
import asyncio
import httpx
from openai import OpenAI

from steve.config import settings
from steve.models import KBCreate, KBItem, IngestURL, SearchQuery, ChatRequest, ChatResponse
from steve import ingest
from steve.embedding import embed_texts
from steve.service import create_kb, list_kb, add_document, upsert_embeddings, semantic_search, list_documents, delete_document, delete_kb, hybrid_search, get_document, get_documents_by_ids
from steve.service import list_documents as list_documents_by_kb
from steve.db import get_conn

app = FastAPI(title="STEVE RAG Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "lm": {
            "base_url": settings.openai_base_url,
            "embedding_model": settings.embedding_model,
            "chat_model": settings.chat_model,
        }
    }

@app.get("/models")
async def models():
    def _v1(path: str) -> str:
        base = (settings.openai_base_url or "").rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        return f"{base}{path}"
    url = _v1("/models")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {settings.openai_api_key}"})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LM Studio not reachable: {e}")

@app.get("/config")
async def config():
    return {
        "openai_base_url": settings.openai_base_url,
    "openai_api_key": settings.openai_api_key,
        "embedding_model": settings.embedding_model,
        "chat_model": settings.chat_model,
        "top_k": settings.top_k,
    "retrieval_alpha": settings.retrieval_alpha,
    }

@app.post("/kb", response_model=KBItem)
async def kb_create(item: KBCreate):
    kb_id = create_kb(item.name)
    return KBItem(id=kb_id, name=item.name)

@app.get("/kb", response_model=List[KBItem])
async def kb_list():
    # include document counts
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT k.id, k.name, COUNT(d.id) AS doc_count FROM knowledgebase k LEFT JOIN document d ON d.kb_id = k.id GROUP BY k.id ORDER BY k.created_at DESC"
        ).fetchall()
        items = [KBItem(id=r["id"], name=r["name"], doc_count=r["doc_count"]) for r in rows]
    return items

@app.get("/kb/{kb_id}/docs")
async def kb_docs_list(kb_id: int):
    return {"documents": list_documents(kb_id)}

@app.get("/documents")
async def docs_list():
    # list all documents with KB name
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT d.id, d.source, d.title, d.type, d.created_at, k.id AS kb_id, k.name AS kb_name FROM document d JOIN knowledgebase k ON d.kb_id=k.id ORDER BY d.created_at DESC"
        ).fetchall()
        data = [
            dict(id=r["id"], source=r["source"], title=r["title"], type=r["type"], created_at=r["created_at"], kb_id=r["kb_id"], kb_name=r["kb_name"]) for r in rows
        ]
    return {"documents": data}

@app.get("/doc/{doc_id}")
async def doc_get(doc_id: int):
    doc = get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc

@app.delete("/kb/{kb_id}")
async def kb_delete(kb_id: int):
    delete_kb(kb_id)
    return {"status": "deleted"}

@app.delete("/doc/{doc_id}")
async def doc_delete(doc_id: int):
    delete_document(doc_id)
    return {"status": "deleted"}

@app.post("/ingest/url")
async def ingest_url(payload: IngestURL):
    title, text = ingest.read_url(payload.url)
    doc_id = add_document(payload.kb_id, payload.url, title, "url", text)
    chunks = ingest.chunk_text(text, settings.max_chunk_tokens, settings.chunk_overlap_tokens)
    vectors = await embed_texts(chunks)
    upsert_embeddings(doc_id, chunks, vectors)
    return {"document_id": doc_id, "chunks": len(chunks)}

@app.post("/ingest/file")
async def ingest_file(kb_id: int = Form(...), file: UploadFile = File(...), file_path: str | None = Form(None)):
    data = await file.read()
    name = file.filename or "file"
    ext = (name.split(".")[-1] or "").lower()
    try:
        if ext in ["pdf"]:
            text = ingest.read_pdf(data)
            typ = "pdf"
        elif ext in ["docx"]:
            text = ingest.read_docx(data)
            typ = "docx"
            
        elif ext in ["doc"]:
            # unsupported by python-docx; fallback to best-effort decode
            text = data.decode(errors="ignore")
            typ = "doc"
        elif ext in ["xlsx", "xls"]:
            text = ingest.read_xlsx(data)
            typ = "xlsx"
        elif ext in ["csv"]:
            text = ingest.read_csv(data)
            typ = "csv"
        elif ext in ["pptx"]:
            text = ingest.read_pptx(data)
            typ = "pptx"
        elif ext in ["ppt"]:
            # python-pptx doesn't support legacy .ppt; fallback
            text = data.decode(errors="ignore")
            typ = "ppt"
        else:
            text = data.decode(errors="ignore")
            typ = "text"
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    # Store original file path (if provided by Electron) for later opening
    meta = {"file_path": file_path} if file_path else None
    doc_id = add_document(kb_id, name, name, typ, text, meta=meta)
    chunks = ingest.chunk_text(text, settings.max_chunk_tokens, settings.chunk_overlap_tokens)
    vectors = await embed_texts(chunks)
    upsert_embeddings(doc_id, chunks, vectors)
    return {"document_id": doc_id, "chunks": len(chunks)}

@app.post("/search")
async def search(payload: SearchQuery):
    top_k = payload.top_k or settings.top_k
    qvec = (await embed_texts([payload.query]))[0]
    if getattr(payload, "hybrid", True):
        alpha = getattr(payload, "alpha", None)
        if alpha is None:
            alpha = settings.retrieval_alpha
        results = hybrid_search(payload.kb_ids, payload.query, qvec, top_k, alpha)
    else:
        results = semantic_search(payload.kb_ids, qvec, top_k)
    return {"results": results}

@app.post("/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest):
    # Build system prompt with top-k contexts
    q = payload.messages[-1].content if payload.messages else ""
    qvec = (await embed_texts([q]))[0]
    contexts = hybrid_search(payload.kb_ids, q, qvec, payload.top_k or settings.top_k, settings.retrieval_alpha)
    context_text = "\n\n".join([f"[Source: {c['title'] or c['source']}]\n{c['text']}" for c in contexts])
    messages = [
        {"role": "system", "content": "You are a helpful assistant. Use the provided context to answer. If unsure, say you don't know."},
        {"role": "system", "content": f"Context to use:\n{context_text}"},
    ] + [m.model_dump() for m in payload.messages]

    try:
        client = OpenAI(base_url=settings.openai_base_url, api_key=settings.openai_api_key)
        # Primary: chat.completions
        resp = client.chat.completions.create(
            model=settings.chat_model,
            messages=messages,
            temperature=0.2,
        )
        reply = resp.choices[0].message.content if getattr(resp, "choices", None) else ""
        if not reply:
            # Fallback to legacy completions with prompt
            prompt = "\n".join([f"{m['role'].upper()}: {m['content']}" for m in messages])
            resp2 = client.completions.create(model=settings.chat_model, prompt=prompt, temperature=0.2)
            reply = resp2.choices[0].text if getattr(resp2, "choices", None) else ""
        return ChatResponse(reply=reply or "", sources=contexts)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream chat error: {str(e)}")

@app.api_route("/chat/stream", methods=["GET", "POST"])
async def chat_stream(request: Request, payload: ChatRequest | None = None, p: str | None = Query(None)):
    """
    Streams tokens as SSE.
    - POST: JSON body = ChatRequest
    - GET : ?p=<urlencoded ChatRequest JSON>  (handy for EventSource)
    """
    # ---- parse incoming payload ----
    if request.method == "GET":
        if not p:
            raise HTTPException(status_code=400, detail="Missing ?p query parameter with ChatRequest JSON")
        try:
            payload = ChatRequest(**json.loads(p))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid ChatRequest in ?p: {e}")
    elif payload is None:
        raise HTTPException(status_code=400, detail="Missing ChatRequest payload")

    if not payload.messages:
        raise HTTPException(status_code=400, detail="'messages' cannot be empty")

    # ---- build augmented messages with context ----
    q = payload.messages[-1].content
    qvec = (await embed_texts([q]))[0]
    ctx_k = payload.top_k or settings.top_k
    contexts = hybrid_search(payload.kb_ids, q, qvec, ctx_k, settings.retrieval_alpha)
    context_text = "\n\n".join([f"[Source: {c['title'] or c['source']}]\n{c['text']}" for c in contexts])

    messages = [
        {"role": "system", "content": "You are a helpful assistant. Use the provided context to answer. If unsure, say you don't know."},
        {"role": "system", "content": f"Context to use:\n{context_text}"},
    ] + [m.model_dump() for m in payload.messages]

    # ---- utilities ----
    def _v1(path: str) -> str:
        base = (settings.openai_base_url or "").rstrip("/")
        if not base.endswith("/v1"):
            base += "/v1"
        return f"{base}{path}"

    def messages_to_prompt(msgs: list[dict]) -> str:
        lines = []
        for m in msgs:
            role = (m.get("role") or "").lower()
            if role == "system": prefix = "SYSTEM"
            elif role == "user": prefix = "USER"
            elif role == "assistant": prefix = "ASSISTANT"
            else: prefix = role.upper() or "USER"
            lines.append(f"{prefix}: {m.get('content','')}")
        # Optional: prime the assistant role
        lines.append("ASSISTANT:")
        return "\n".join(lines)

    def iterator():
        # send sources up-front
        yield f"event: sources\ndata: {json.dumps(contexts)}\n\n"
        try:
            client = OpenAI(base_url=settings.openai_base_url, api_key=settings.openai_api_key)
            # Preferred: chat.completions streaming
            try:
                stream = client.chat.completions.create(
                    model=settings.chat_model,
                    messages=messages,
                    temperature=0.2,
                    stream=True,
                )
                for chunk in stream:
                    try:
                        delta = getattr(chunk.choices[0].delta, 'content', None)
                    except Exception:
                        delta = None
                    if delta:
                        yield f"event: token\ndata: {json.dumps(delta)}\n\n"
            except Exception:
                # Fallback: legacy /completions streaming with synthesized prompt
                prompt = messages_to_prompt(messages)
                stream2 = client.completions.create(
                    model=settings.chat_model,
                    prompt=prompt,
                    temperature=0.2,
                    stream=True,
                )
                for chunk in stream2:
                    try:
                        delta = chunk.choices[0].text
                    except Exception:
                        delta = None
                    if delta:
                        yield f"event: token\ndata: {json.dumps(delta)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps(str(e))}\n\n"
        yield "event: done\ndata: {}\n\n"

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(iterator(), headers=headers, media_type="text/event-stream")

@app.post("/config")
async def update_config(payload: dict):
    # Update runtime settings
    updated = {}
    def _norm_base(u: str) -> str:
        if not u:
            return u
        u = u.strip().rstrip('/')
        if not u.endswith('/v1'):
            u += '/v1'
        return u
    for key in ("openai_base_url", "openai_api_key", "embedding_model", "chat_model", "top_k", "retrieval_alpha"):
        if key in payload and payload[key] is not None and payload[key] != "":
            val = payload[key]
            if key == "openai_base_url":
                val = _norm_base(val)
            setattr(settings, key, val)
            updated[key] = val
    return {"updated": updated, "current": {
        "openai_base_url": settings.openai_base_url,
        "openai_api_key": settings.openai_api_key,
        "embedding_model": settings.embedding_model,
        "chat_model": settings.chat_model,
        "top_k": settings.top_k,
        "retrieval_alpha": settings.retrieval_alpha,
    }}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
