<div align="center">

# Offline RAG Chat for Windows

Electron UI + Python FastAPI backend. Fully offline installer. Local docs in, answers out.

</div>

## Download

- Grab the latest installer (.exe) from GitHub Releases.
- Works on Windows 10/11 (x64). No Node.js or Python required for end users.

## What’s inside

- Electron app (unpacked, asar disabled) — easy to inspect and tweak after install
- Packaged FastAPI backend (PyInstaller onedir) with all Python deps
- SQLite database for knowledge base lives under the app's resources backend data folder (inside `install_dir/resources/backend/.../data/knowledge.db`).

## Install and run

1) Run the installer and choose an install directory (assisted installer).
2) Launch the app from the Start menu or the desktop shortcut.
3) Optional for fully-offline AI: start a local LLM server (e.g., LM Studio) and set the Base URL, API key, and models in Settings.

Notes
- The app auto-starts the bundled backend on launch if one isn’t already running.
- Since asar is disabled, you can edit installed files at: `%LocalAppData%\Programs\steve-rag\resources\app`

## Features (highlights)

- Drag-and-drop ingest: PDF, DOCX, XLSX/XLS, PPTX/PPT, CSV, TXT, and web URLs
- Hybrid retrieval (semantic + keyword via SQLite FTS5), tunable alpha and Top-K
- Chat via OpenAI-compatible endpoints (models, embeddings, chat/completions)
- Streaming responses via SSE with graceful fallback to non-streaming
- In-app chat management: multi-chat, rename, delete, clear

## Build from source (Windows)

Requirements for building only (end users don’t need these):
- Node.js LTS (for Electron packaging)
- Python 3.12 (for backend and PyInstaller)

Build steps (PowerShell):

```powershell
# From repo root
scripts\make-installer.ps1 -Clean
```

The installer will be written to: `electron\dist\*.exe`

## Development (optional)

- Backend dev (separate):
   - `python -m venv .venv; .\.venv\Scripts\Activate.ps1`
   - `pip install -r backend/requirements.txt`
   - `python backend/app.py`  # http://127.0.0.1:8000
- Electron dev:
   - `cd electron`
   - `npm install`
   - `npm start`

## Release automation

- Pushing a tag like `v0.1.0` triggers a Windows build in GitHub Actions and attaches the installer to the Release.
- See `.github/workflows/windows-installer.yml` for details.

## Troubleshooting

- SmartScreen warns about an unrecognized app: we don’t sign builds. Click “More info” → “Run anyway”.
- LLM errors like `{ "error": "'prompt' field is required" }`: your server may only support `/v1/completions`. The backend auto-falls back.
- Make sure the Base URL ends with `/v1`; the backend normalizes if missing.
- Ensure a model is loaded in your local LLM server and embeddings + chat endpoints are available.

## Privacy

- Everything runs locally. Your documents stay on your machine.

---

For packaging details, see `packaging-notes.md`.
