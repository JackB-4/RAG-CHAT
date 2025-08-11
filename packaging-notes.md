# Packaging to a single Windows installer (offline)

Goal: one .exe installer that includes the Electron app and the Python backend as a bundled executable, requiring no internet.

High-level steps:

1) Python backend -> single EXE
   - Use PyInstaller to freeze FastAPI app and deps
   - Example: `pyinstaller --name steve-backend --onefile backend\app.py`
   - Ensure `uvicorn` and FastAPI are included; entrypoint may be a small runner that starts Uvicorn

2) Electron app
   - Use electron-builder for Windows NSIS target
   - Place backend exe inside `electron/resources/backend/` and configure electron to spawn it on startup (and kill on exit)

3) App startup
   - On app start, if backend not running, spawn the backend exe (listens on 127.0.0.1:8000)
   - Wait for /health to return 200 before enabling UI

4) Offline assets
   - All JS/CSS/HTML are local
   - LM Studio must be installed by the user separately, or bundle a link/instruction. If you want to bundle a specific local model, ensure licensing permits it.

5) Code signing (optional but recommended)
   - Configure a Windows code signing certificate in electron-builder for fewer SmartScreen warnings

6) NSIS scripting (optional)
   - Custom installer steps like installing a Start Menu shortcut that launches Electron

Notes:
- If you prefer a truly single binary, explore PyOxidizer for Python; but PyInstaller is simpler.
- For larger models or embeddings, keep them external to avoid huge installer size.
