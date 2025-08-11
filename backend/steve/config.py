import os
from pydantic import BaseModel

class Settings(BaseModel):
    # Paths
    base_dir: str = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    data_dir: str = os.path.join(base_dir, "data")
    db_path: str = os.path.join(data_dir, "knowledge.db")

    # LM Studio / OpenAI-compatible endpoints
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "http://127.0.0.1:1234/v1")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "lm-studio")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    chat_model: str = os.getenv("CHAT_MODEL", "gpt-3.5-turbo")

    # RAG params
    top_k: int = int(os.getenv("TOP_K", "5"))
    max_chunk_tokens: int = int(os.getenv("MAX_CHUNK_TOKENS", "512"))
    chunk_overlap_tokens: int = int(os.getenv("CHUNK_OVERLAP_TOKENS", "64"))
    # Retrieval blending alpha (0..1). Higher favors semantic over keyword.
    retrieval_alpha: float = float(os.getenv("RETRIEVAL_ALPHA", "0.6"))

    # Embedding client
    embedding_batch_size: int = int(os.getenv("EMBEDDING_BATCH_SIZE", "128"))
    embedding_timeout_seconds: float = float(os.getenv("EMBEDDING_TIMEOUT_SECONDS", "120"))
    embedding_max_retries: int = int(os.getenv("EMBEDDING_MAX_RETRIES", "3"))

settings = Settings()
