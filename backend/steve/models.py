from pydantic import BaseModel
from typing import List, Optional

class KBCreate(BaseModel):
    name: str

class KBItem(BaseModel):
    id: int
    name: str
    doc_count: int = 0

class IngestURL(BaseModel):
    kb_id: int
    url: str

class SearchQuery(BaseModel):
    kb_ids: List[int]
    query: str
    top_k: int = 5
    hybrid: bool = True
    alpha: float = 0.6  # weight for semantic score

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    kb_ids: List[int]
    messages: List[ChatMessage]
    top_k: int = 5

class ChatResponse(BaseModel):
    reply: str
    sources: List[dict]
