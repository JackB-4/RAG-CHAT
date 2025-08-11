const { contextBridge, shell } = require('electron');

const api = {};
// Expose safe helpers for opening files/links first so they are available immediately
api.openPath = (p) => { try { if (typeof p === 'string' && p.length) shell.openPath(p); } catch {} };
api.openExternal = (url) => { try { if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url); } catch {} };

// Optional SSE helper
// fetchEventSource is optional; not required for offline

contextBridge.exposeInMainWorld('steve', api);
