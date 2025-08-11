from typing import List, Optional
import asyncio
import os
import numpy as np
import httpx
from .config import settings

# Simple OpenAI-compatible embedding client to LM Studio with batching and retries
async def embed_texts(texts: List[str], model: Optional[str] = None) -> List[List[float]]:
    if not texts:
        return []
    base = (settings.openai_base_url or "").rstrip("/")
    if not base.endswith("/v1"):
        base += "/v1"
    url = f"{base}/embeddings"
    headers = {
        "Authorization": f"Bearer {settings.openai_api_key}",
        "Content-Type": "application/json",
    }
    model_name = model or settings.embedding_model

    results: List[Optional[List[float]]] = [None] * len(texts)
    batch = max(1, int(settings.embedding_batch_size))

    async with httpx.AsyncClient(timeout=settings.embedding_timeout_seconds) as client:
        for start in range(0, len(texts), batch):
            chunk = texts[start:start + batch]
            payload = {"input": chunk, "model": model_name}
            attempt = 0
            while True:
                try:
                    resp = await client.post(url, headers=headers, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    items = data.get("data") or []
                    if len(items) != len(chunk):
                        # preserve order by best-effort mapping
                        emb_list = [None] * len(chunk)
                        for i, it in enumerate(items):
                            try:
                                emb_list[i] = it["embedding"]
                            except Exception:
                                emb_list[i] = None
                    else:
                        emb_list = [it.get("embedding") for it in items]
                    for i, emb in enumerate(emb_list):
                        results[start + i] = emb if emb is not None else []
                    break
                except Exception:
                    attempt += 1
                    if attempt >= int(settings.embedding_max_retries):
                        # mark failures as empty embedding to avoid crash; caller may skip
                        for i in range(len(chunk)):
                            if results[start + i] is None:
                                results[start + i] = []
                        break
                    await asyncio.sleep(min(2 ** attempt, 10))

    # Replace any empty entries with zeros of median dimension (best-effort)
    dims = [len(r) for r in results if r]
    dim = dims[0] if dims else 0
    fixed: List[List[float]] = []
    for r in results:
        if r and (dim == 0 or len(r) == dim):
            fixed.append(r)
        elif dim > 0:
            fixed.append([0.0] * dim)
        else:
            fixed.append([])
    return fixed

# Cosine similarity

def cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)
