const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const isDev = !app.isPackaged;

let backendProc = null;

function pollHealth(url, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.request(url, { method: 'GET' }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(tick, 400);
      });
      req.end();
    };
    tick();
  });
}

async function ensureBackend() {
  const ok = await pollHealth('http://127.0.0.1:8000/health');
  if (ok) return;
  // Try to spawn packaged backend if exists
  const exe = path.join(process.resourcesPath || __dirname, 'backend', 'steve-backend', 'steve-backend.exe');
  try {
    backendProc = spawn(exe, [], { detached: true, stdio: 'ignore' });
    backendProc.unref();
  } catch {}
  await new Promise(r => setTimeout(r, 800));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    backgroundColor: '#0b0f19',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'robot_18310819.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    }
  });
  // Remove the default menu bar completely
  try { Menu.setApplicationMenu(null); } catch {}
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev && process.env.OPEN_DEVTOOLS === '1') {
    win.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  ensureBackend().finally(createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
