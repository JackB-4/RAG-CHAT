const API = 'http://127.0.0.1:8000';

// Simple persisted chat sessions
let sessions = [];
let activeSessionId = null;
let defaultTopK = parseInt(localStorage.getItem('steve.topK')||'5',10)||5;
// Persisted retrieval alpha for hybrid search blending
let defaultAlpha = parseFloat(localStorage.getItem('steve.alpha')||'0.6') || 0.6;
try {
  sessions = JSON.parse(localStorage.getItem('steve.sessions') || '[]');
  activeSessionId = localStorage.getItem('steve.activeSession') || null;
} catch {}
function saveSessions(){
  localStorage.setItem('steve.sessions', JSON.stringify(sessions));
  localStorage.setItem('steve.activeSession', activeSessionId || '');
  localStorage.setItem('steve.topK', String(defaultTopK));
  localStorage.setItem('steve.alpha', String(defaultAlpha));
}
function getSession(id){ return sessions.find(s=>s.id===id); }
function newSession(title='New Chat'){
  const id = String(Date.now());
  const s = { id, title, createdAt: Date.now(), messages: [] };
  sessions.unshift(s); activeSessionId = id; saveSessions();
  return s;
}
function renameSession(id,title){ const s=getSession(id); if(s){ s.title=title; saveSessions(); } }
function deleteSession(id){ sessions = sessions.filter(s=>s.id!==id); if(activeSessionId===id){ activeSessionId = sessions[0]?.id || null; } saveSessions(); }

const qs = (s, el=document) => el.querySelector(s);
const qsa = (s, el=document) => Array.from(el.querySelectorAll(s));

// Lightweight Markdown renderer (safe subset)
function renderMarkdown(md='') {
  if (!md) return '';
  // Normalize newlines
  let work = String(md).replace(/\r\n/g, '\n');
  // Extract fenced code blocks first -> placeholders
  const fences = [];
  work = work.replace(/```([a-zA-Z0-9_+\-]*)[ \t]*\n([\s\S]*?)\n```/g, (m, lang, code) => {
    const idx = fences.length;
    fences.push({ lang: (lang||'').trim(), code });
    return `\u0000FENCE${idx}\u0000`;
  });
  const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmtInline = (s) => {
    // Inline code
    s = s.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
    // Links [text](http...)
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, txt, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
    // Autolink plain URLs
    s = s.replace(/(?<![">])(https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+)/g, (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
    // Bold and italics (basic)
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
    // Strikethrough
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // Task list checkboxes [ ] / [x]
    s = s.replace(/\[( |x|X)\]\s+(.*?)(?=<|$)/g, (m, chk, rest) => `<input type="checkbox" disabled ${/x/i.test(chk)?'checked':''}/> ${rest}`);
    return s;
  };
  // Escape everything up front (keeps #, -, digits etc)
  work = escapeHtml(work);
  // Split lines and build blocks
  const lines = work.split('\n');
  const out = [];
  let inUl = false, inOl = false, inBq = false;
  let para = [];
  const closePara = () => { if (para.length) { out.push(`<p>${fmtInline(para.join(' '))}</p>`); para = []; } };
  const closeLists = () => { if (inUl) { out.push('</ul>'); inUl=false; } if (inOl) { out.push('</ol>'); inOl=false; } };
  const closeQuote = () => { if (inBq) { out.push('</blockquote>'); inBq=false; } };
  const pushFence = (idx) => { closePara(); closeLists(); closeQuote(); const f = fences[idx]; const code = escapeHtml(f.code); const lang = f.lang ? ` class="lang-${f.lang}"` : ''; out.push(`<pre><code${lang}>${code}</code></pre>`); };
  // Table parsing (GFM) — very light support for single header separator line
  const isTableSep = (line) => /^[\s\-:\|]+$/.test(line.trim());
  const toCells = (line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c=>c.trim());

  for (let i=0;i<lines.length;i++) {
    const L = lines[i];
    const fenceMatch = L.match(/^\u0000FENCE(\d+)\u0000$/);
    if (fenceMatch) { pushFence(parseInt(fenceMatch[1],10)); continue; }
    if (!L.trim()) { closePara(); closeLists(); closeQuote(); continue; }
    // Table detection: header | sep | rows
    if (L.includes('|') && i+1<lines.length && isTableSep(lines[i+1])) {
      const header = toCells(L);
      const sep = lines[i+1];
      i += 1;
      const rows = [];
      while (i+1<lines.length && lines[i+1].includes('|') && !/^\s*$/.test(lines[i+1])) { rows.push(toCells(lines[i+1])); i += 1; }
      closePara(); closeLists(); closeQuote();
      const cols = header.length;
      const thead = `<thead><tr>${header.map(h=>`<th>${fmtInline(h)}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map(r=>`<tr>${Array.from({length:cols}).map((_,ci)=>`<td>${fmtInline(r[ci]||'')}</td>`).join('')}</tr>`).join('')}</tbody>`;
      out.push(`<table class="md-table">${thead}${tbody}</table>`);
      continue;
    }
    // Headings
    let m = L.match(/^\s*(#{1,6})\s+(.+)$/);
    if (m) { closePara(); closeLists(); closeQuote(); const lvl = m[1].length; out.push(`<h${lvl}>${fmtInline(m[2])}</h${lvl}>`); continue; }
    // Horizontal rule
    if (/^\s*(?:\*\*\*|---|___)\s*$/.test(L)) { closePara(); closeLists(); closeQuote(); out.push('<hr/>'); continue; }
    // Blockquote (single-level)
    m = L.match(/^\s*>\s?(.*)$/);
    if (m) { if (!inBq) { closePara(); closeLists(); out.push('<blockquote>'); inBq=true; } out.push(fmtInline(m[1]||'')); out.push('<br/>'); continue; } else { closeQuote(); }
    // Lists
    m = L.match(/^\s*[-*+]\s+(.+)$/);
    if (m) { closePara(); if (inOl) { out.push('</ol>'); inOl=false; } if (!inUl) { out.push('<ul>'); inUl=true; } out.push(`<li>${fmtInline(m[1])}</li>`); continue; }
    m = L.match(/^\s*(\d+)\.\s+(.+)$/);
    if (m) { closePara(); if (inUl) { out.push('</ul>'); inUl=false; } if (!inOl) { out.push('<ol>'); inOl=true; } out.push(`<li>${fmtInline(m[2])}</li>`); continue; }
    // Paragraph line
    para.push(L.trim());
  }
  closePara(); closeLists(); closeQuote();
  let html = out.join('\n');
  // Replace any trailing <br/> inside blockquotes
  html = html.replace(/(<blockquote>[\s\S]*?)<br\/>\n?(?=<\/blockquote>)/g, '$1');
  return html;
}

function switchView(id) {
  qsa('.nav-btn').forEach(b => b.classList.remove('active'));
  qsa('.view').forEach(v => v.classList.remove('visible'));
  qs(`[data-view="${id}"]`).classList.add('active');
  qs(`#view-${id}`).classList.add('visible');
  // top tabs highlight sync
  qsa('.tab-btn').forEach(b => b.classList.remove('active'));
  const t = qs(`.tab-btn[data-view="${id}"]`); if (t) t.classList.add('active');
}

function renderSessionList(){
  const wrap = qs('#sessions'); if (!wrap) return;
  wrap.innerHTML = '';
  sessions.forEach(s => {
    const item = document.createElement('div'); item.className = 'session-item' + (s.id===activeSessionId?' active':'');
    item.innerHTML = `<div class="session-title">${s.title||'Untitled'}</div><div class="session-time">${new Date(s.createdAt).toLocaleString()}</div>`;
    item.onclick = ()=>{ activeSessionId = s.id; saveSessions(); renderChat(); };
    wrap.appendChild(item);
  });
}

function loadSession(id){
  const s = getSession(id); if (!s) return;
  const box = qs('#chat-box'); if (!box) return;
  box.innerHTML = '';
  const msgs = (s.messages||[]);
  if (!msgs.length) {
    showEmptyChatAnimation(box);
  } else {
    hideEmptyChatAnimation();
    msgs.forEach(m => addMsg(m.role, m.content, m.sources||[]));
  }
}

async function fetchJSON(url, opts={}) { const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers||{}) } }); if (!r.ok) throw new Error(await r.text()); return r.json(); }

function renderHome() {
  qs('#view-home').innerHTML = `
    <div class="vstack" style="gap:16px;">
      <div class="card vstack">
        <h2>Welcome to STEVE</h2>
        <p class="text-dim">Offline RAG chat using LM Studio for local LLM and embeddings.</p>
        <div class="hstack" style="flex-wrap:wrap; gap:8px;">
          <span class="tag">Backend: http://127.0.0.1:8000</span>
          <span id="lm-tag" class="tag">LM Studio: checking...</span>
        </div>
      </div>
      <div class="quick-links">
        <div class="quick-card" data-goto="chat" title="Open Chat">
          <div class="title">💬 Chat</div>
          <div class="desc">Ask questions with knowledgebase context. Streams tokens as they arrive.</div>
        </div>
        <div class="quick-card" data-goto="lookup" title="Open Lookup">
          <div class="title">🔎 Lookup</div>
          <div class="desc">Search your knowledgebases by hybrid retrieval (semantic + keyword).</div>
        </div>
        <div class="quick-card" data-goto="kb" title="Manage Knowledgebases">
          <div class="title">📚 Knowledgebases</div>
          <div class="desc">Create, ingest files or URLs, and manage documents.</div>
        </div>
        <div class="quick-card" data-goto="settings" title="Open Settings">
          <div class="title">⚙️ Settings</div>
          <div class="desc">Connection, models, default Top K, and retrieval alpha.</div>
        </div>
      </div>
    </div>
  `;
  qsa('.quick-card').forEach(c => c.onclick = () => { switchView(c.dataset.goto); if (c.dataset.goto==='chat') renderChat(); if (c.dataset.goto==='lookup') renderLookup(); if (c.dataset.goto==='kb') renderKB(); if (c.dataset.goto==='settings') renderSettings(); });
  loadHealth();
}

async function loadHealth(){
  try {
    const h = await fetchJSON(`${API}/health`);
    const lm = document.getElementById('lm-tag'); if (lm) lm.textContent = `LM Studio: ${h.lm.base_url}`;
  } catch(e){}
}

async function loadModels(){
  const el = qs('#models'); el.innerHTML = '';
  try {
    const data = await fetchJSON(`${API}/models`);
    const items = (data.data||[]);
    if (!items.length) { el.innerHTML = '<div class="text-dim">No models reported. Ensure LM Studio server is running and a model is loaded.</div>'; return; }
    items.forEach(m => {
      const row = document.createElement('div'); row.className='list-item';
      row.innerHTML = `<div>${m.id}</div><div class="tag">${m.object||''}</div>`;
      el.appendChild(row);
    });
  } catch(e){ el.innerHTML = `<div class="text-dim">Failed to fetch models: ${e.message}</div>`; }
}

function renderKB() {
  qs('#view-kb').innerHTML = `
    <div class="vstack" style="gap:16px;">
      <div class="card vstack">
        <h3>Knowledgebases</h3>
        <div class="hstack">
          <input id="kb-name" class="input" placeholder="New knowledgebase name"/>
          <button id="kb-create" class="button">Create</button>
        </div>
      </div>
      <div class="card vstack">
        <div class="hstack" style="justify-content: space-between; align-items: baseline;">
          <h3>All Knowledgebases</h3>
          <span class="text-dim">Tip: Drag & drop files or URLs onto a row</span>
        </div>
        <div id="kb-list" class="list"></div>
      </div>
      <div class="card vstack">
        <div class="hstack" style="justify-content: space-between; align-items: baseline;">
          <h3>All Documents</h3>
          <button id="refresh-docs" class="button secondary">Refresh</button>
        </div>
        <div id="all-docs" class="list"></div>
      </div>
    </div>
  `;
  loadKBs();
  loadAllDocs();
  qs('#kb-create').onclick = async () => {
    const name = qs('#kb-name').value.trim(); if (!name) return;
    await fetchJSON(`${API}/kb`, { method: 'POST', body: JSON.stringify({ name }) });
    qs('#kb-name').value = '';
    loadKBs();
  };
  qs('#refresh-docs').onclick = loadAllDocs;
}

async function loadKBs() {
  const data = await fetchJSON(`${API}/kb`);
  const el = qs('#kb-list');
  el.innerHTML = '';
  data.forEach(kb => {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `
      <div class="hstack" style="gap:8px;">
        <div style="font-weight:700;">${kb.name}</div>
        <span class="tag" title="Documents in this knowledgebase">${kb.doc_count} docs</span>
      </div>
      <div class="hstack">
        <button class="button secondary" data-file>Add File</button>
        <button class="button secondary" data-url>Ingest URL</button>
        <button class="button secondary" data-manage>Manage</button>
        <button class="button danger" data-delete>Delete</button>
      </div>
    `;
    row.querySelector('[data-file]').onclick = async () => {
      const btn = row.querySelector('[data-file]');
      const picker = document.createElement('input'); picker.type='file'; picker.style.display='none'; document.body.appendChild(picker);
      picker.onchange = async () => {
        if (!picker.files.length) { picker.remove(); return; }
        btn.disabled = true; const spin = document.createElement('div'); spin.className='spinner'; btn.after(spin);
        const fd = new FormData(); fd.append('kb_id', kb.id); fd.append('file', picker.files[0]);
        const pathProp = picker.files[0].path || picker.files[0].webkitRelativePath || '';
        if (pathProp) fd.append('file_path', pathProp);
        const r = await fetch(`${API}/ingest/file`, { method: 'POST', body: fd });
        spin.remove(); btn.disabled = false;
        if (!r.ok) toast(await r.text(), 'error'); else { toast('File ingested', 'success'); loadKBs(); }
        picker.remove();
      };
      picker.click();
    };
    row.querySelector('[data-url]').onclick = async () => {
      const url = await showPrompt({ title: 'Enter URL to ingest', placeholder: 'https://example.com/page', defaultValue: '' });
      if (!url) return;
      const btn = row.querySelector('[data-url]'); btn.disabled = true; const spin = document.createElement('div'); spin.className='spinner'; btn.after(spin);
      try { await fetchJSON(`${API}/ingest/url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kb_id: kb.id, url }) }); toast('URL ingested', 'success'); loadKBs(); }
      catch(e){ toast(e.message || 'Failed to ingest URL', 'error'); }
      finally { spin.remove(); btn.disabled=false; }
    };
    row.querySelector('[data-manage]').onclick = () => openManageKB(kb);
    row.querySelector('[data-delete]').onclick = async () => {
      const ok = await showConfirm({ title: `Delete KB "${kb.name}" and all its documents?`, okText: 'Delete' });
      if (!ok) return;
      await fetchJSON(`${API}/kb/${kb.id}`, { method: 'DELETE' });
      loadKBs();
    };

    // Drag & drop support
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.style.outline = '1px dashed var(--accent)'; });
    row.addEventListener('dragleave', () => { row.style.outline = 'none'; });
    row.addEventListener('drop', async (e) => {
      e.preventDefault(); row.style.outline = 'none';
      const dt = e.dataTransfer;
      // Files
      if (dt.files && dt.files.length) {
        const hdrSpin = document.createElement('div'); hdrSpin.className='spinner'; row.querySelector('.hstack').appendChild(hdrSpin);
        for (const f of dt.files) {
          const fd = new FormData(); fd.append('kb_id', kb.id); fd.append('file', f);
          if (f.path) fd.append('file_path', f.path);
          const r = await fetch(`${API}/ingest/file`, { method: 'POST', body: fd });
          if (!r.ok) toast(await r.text(), 'error');
        }
        hdrSpin.remove(); toast('Dropped files ingested', 'success'); loadKBs();
        return;
      }
      // URLs or text
      const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
      if (uri && /^https?:\/\//i.test(uri.trim())) {
        const hdrSpin = document.createElement('div'); hdrSpin.className='spinner'; row.querySelector('.hstack').appendChild(hdrSpin);
        try { await fetchJSON(`${API}/ingest/url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kb_id: kb.id, url: uri.trim() }) }); toast('URL ingested', 'success'); loadKBs(); }
        catch(e) { toast(e.message || 'Failed to ingest URL', 'error'); }
        finally { hdrSpin.remove(); }
      }
    });
    el.appendChild(row);
  });
}

async function loadAllDocs() {
  const wrap = qs('#all-docs'); if (!wrap) return;
  wrap.innerHTML = '<div class="hstack"><div class="spinner"></div><div class="text-dim">Loading...</div></div>';
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Request timed out')), 12000));
  try {
    const data = await Promise.race([fetchJSON(`${API}/documents`), timeout]);
    const docs = data.documents || [];
    wrap.innerHTML = '';
    if (!docs.length) { wrap.innerHTML = '<div class="text-dim">No documents ingested yet.</div>'; return; }
    docs.forEach(d => {
      const row = document.createElement('div'); row.className='list-item';
      row.innerHTML = `<div style="max-width:70%"><div style="font-weight:600;">${d.title||d.source}</div><div class="text-dim">${d.type} · ${d.kb_name}</div></div><button class="button secondary" data-del>Delete</button>`;
      row.querySelector('[data-del]').onclick = async () => {
        const ok = await showConfirm({ title: 'Delete this document?', okText: 'Delete' });
        if (!ok) return;
        await fetchJSON(`${API}/doc/${d.id}`, { method: 'DELETE' });
        row.remove();
        toast('Document deleted', 'success');
      };
      wrap.appendChild(row);
    });
  } catch(e){ wrap.innerHTML = `<div class=\"text-dim\">Failed to load documents: ${e.message}</div>`; }
}

function openManageKB(kb) {
  const modal = document.createElement('div');
  modal.style.position='fixed'; modal.style.inset='0'; modal.style.background='rgba(0,0,0,0.5)'; modal.style.zIndex='9999';
  modal.innerHTML = `
    <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:720px;max-height:70vh;overflow:auto;" class="card vstack">
      <div class="hstack" style="justify-content:space-between;">
        <h3>Manage: ${kb.name}</h3>
        <button class="button secondary" data-close>Close</button>
      </div>
      <div id="docs" class="list"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('[data-close]').onclick = () => modal.remove();
  (async () => {
    try {
      const data = await fetchJSON(`${API}/kb/${kb.id}/docs`);
      const docs = data.documents || [];
      const el = modal.querySelector('#docs');
      if (!docs.length) { el.innerHTML = '<div class="text-dim">No documents in this knowledgebase yet.</div>'; return; }
      docs.forEach(d => {
        const row = document.createElement('div'); row.className='list-item';
        row.innerHTML = `<div style="max-width:70%"><div style="font-weight:600;">${d.title||d.source}</div><div class="text-dim">${d.type}</div></div><button class="button secondary" data-del>Delete</button>`;
        row.querySelector('[data-del]').onclick = async () => {
          const ok = await showConfirm({ title: 'Delete this document?', okText: 'Delete' });
          if (!ok) return;
          await fetchJSON(`${API}/doc/${d.id}`, { method: 'DELETE' });
          row.remove();
          toast('Document deleted', 'success');
        };
        el.appendChild(row);
      });
    } catch(e) {
      modal.querySelector('#docs').innerHTML = `<div class="text-dim">Failed to load docs: ${e.message}</div>`;
    }
  })();
}

function renderChat() {
  qs('#view-chat').innerHTML = `
    <div class="chat-layout">
      <div class="session-list">
        <div class="session-actions">
          <button id="new-chat" class="button" style="-webkit-app-region:no-drag">New</button>
          <button id="rename-chat" class="button secondary" style="-webkit-app-region:no-drag">Rename</button>
        </div>
        <div id="sessions" class="vstack"></div>
        <div class="session-actions bottom">
          <button id="del-chat" class="button danger" style="-webkit-app-region:no-drag">Delete</button>
        </div>
      </div>
      <div class="vstack" style="gap:16px;">
        <div class="card" style="display:flex; gap:16px; align-items:center; justify-content:space-between;">
          <div style="flex:1 1 auto;">
            <div class="text-dim" style="margin-bottom:6px;">Select knowledgebases</div>
            <div id="kb-checks" class="kb-tiles" style="max-height:220px; overflow:auto;"></div>
          </div>
          <div class="hstack" style="gap:8px; align-items:center;">
            <button id="select-all" class="button secondary">Select all</button>
          </div>
        </div>
        <div class="card vstack">
          <div id="chat-box" class="chat-box vstack"></div>
          <div class="hstack" style="align-items:flex-end;">
            <textarea id="chat-input" class="textarea" placeholder="Ask anything..."></textarea>
            <div class="vstack" style="gap:8px; align-items: flex-end;">
              <label class="vstack" style="gap:4px; align-items:flex-end;">
                <span class="text-dim" style="font-size:11px;">Context docs</span>
                <select id="ctx-k" class="input" style="width:96px;">
                  <option value="3">3</option>
                  <option value="5" selected>5</option>
                  <option value="8">8</option>
                  <option value="12">12</option>
                </select>
              </label>
              <button id="chat-send" class="button">Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  // Always refresh list when entering the Chat tab
  refreshKBChecks();
  qs('#chat-send').onclick = sendChat;
  qs('#chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  // Open links in chat via preload to external browser
  const chatBox = qs('#chat-box');
  if (chatBox) {
    chatBox.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && a.href && /^https?:\/\//i.test(a.href)) {
        e.preventDefault();
        if (window.steve && window.steve.openExternal) window.steve.openExternal(a.href);
      }
    });
  }
  // Toggle behavior: if all selected, unselect all; else select all
  qs('#select-all').onclick = ()=>{
    const checks = qs('#kb-checks').querySelectorAll('input[type=checkbox]');
    const allSel = Array.from(checks).length>0 && Array.from(checks).every(c=>c.checked);
    checks.forEach(c=>c.checked = !allSel);
  };
  // sessions
  qs('#new-chat').onclick = ()=>{ const s=newSession('New Chat'); renderChat(); loadSession(s.id); };
  qs('#rename-chat').onclick = async ()=>{ if(!activeSessionId) return; const s=getSession(activeSessionId); if(!s) return; const name=await showPrompt({ title: 'Rename chat', defaultValue: s.title||'' }); if(name){ renameSession(activeSessionId, name.trim()); renderSessionList(); } };
  qs('#del-chat').onclick = async ()=>{ if(activeSessionId){ const ok = await showConfirm({ title: 'Delete this chat?', okText: 'Delete' }); if(!ok) return; deleteSession(activeSessionId); renderChat(); } };
  renderSessionList();
  if(!activeSessionId && sessions.length) activeSessionId=sessions[0].id; if(!activeSessionId) newSession('New Chat');
  loadSession(activeSessionId);
  // Apply saved defaultTopK if it matches an option and persist when changed
  const ctxSel = qs('#ctx-k');
  if (ctxSel) {
    const val = String(defaultTopK);
    if (Array.from(ctxSel.options).some(o => o.value === val)) ctxSel.value = val;
    ctxSel.addEventListener('change', () => {
      defaultTopK = Math.max(1, parseInt(ctxSel.value, 10));
      saveSessions();
    });
  }
}

// Empty chat Lottie animation helpers
let __emptyAnim = null;
function showEmptyChatAnimation(host) {
  try {
    hideEmptyChatAnimation();
    const container = document.createElement('div');
    container.id = '__empty_chat';
    container.style.cssText = 'display:grid;place-items:center;flex:1;min-height:240px;opacity:0.85;';
    const inner = document.createElement('div');
  inner.style.width = '380px';
  inner.style.height = '380px';
    inner.style.filter = 'drop-shadow(0 8px 18px rgba(0,0,0,0.35))';
    container.appendChild(inner);
    host.appendChild(container);
    if (window.lottie) {
      __emptyAnim = window.lottie.loadAnimation({
        container: inner,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: '../assets/DxBJZT8L9n.json'
      });
    } else {
      const ph = document.createElement('div'); ph.className='text-dim'; ph.textContent='Start chatting…'; container.appendChild(ph);
    }
  } catch {}
}
function hideEmptyChatAnimation() {
  try {
    const el = document.getElementById('__empty_chat');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (__emptyAnim && __emptyAnim.destroy) { __emptyAnim.destroy(); }
    __emptyAnim = null;
  } catch {}
}

async function refreshKBSelect() { await refreshKBChecks(); }

async function refreshKBChecks() {
  const wrap = qs('#kb-checks');
  if (!wrap) return;
  wrap.innerHTML = '';
  const list = await fetchJSON(`${API}/kb`);
  if (!list.length) { wrap.innerHTML = '<div class="text-dim">No knowledgebases yet.</div>'; return; }
  list.forEach(k => {
    const row = document.createElement('label'); row.className='kb-tile';
    row.innerHTML = `<input type="checkbox" value="${k.id}"><div><div class="name">${k.name}</div><div class="meta">${k.doc_count} docs</div></div>`;
    wrap.appendChild(row);
  });
  const input = qs('#chat-input'); if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
}

function pickSelectedKBs() {
  return Array.from(document.querySelectorAll('#kb-checks input[type=checkbox]:checked')).map(i => parseInt(i.value,10));
}

// Lightweight toast notifications
function toast(msg, type='info', timeout=2600) {
  const t = document.createElement('div');
  const bg = type==='error' ? '#3b0d0d' : type==='success' ? '#0d2f1a' : '#1f2937';
  const br = type==='error' ? '#ef4444' : type==='success' ? '#22c55e' : '#9ca3af';
  t.textContent = msg;
  t.style.cssText = `position:fixed; right:16px; bottom:16px; background:${bg}; border:1px solid ${br}; color:#e5e7eb; padding:10px 12px; border-radius:8px; box-shadow:0 6px 16px rgba(0,0,0,0.35); z-index:99999; opacity:0; transform:translateY(8px); transition:opacity .15s, transform .15s;`;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)'; });
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(() => t.remove(), 200); }, timeout);
}

// In-app prompt and confirm modals for reliable input in Electron
async function showPrompt({ title = 'Input', placeholder = '', defaultValue = '' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:grid;place-items:center;';
    const card = document.createElement('div');
    card.className = 'card vstack';
    card.style.cssText = 'width:520px;gap:12px;';
    card.innerHTML = `
      <div style="font-weight:700;">${title}</div>
      <input class="input" id="__prompt_input" placeholder="${placeholder}" />
      <div class="hstack" style="justify-content:flex-end;gap:8px;">
        <button class="button secondary" id="__cancel">Cancel</button>
        <button class="button" id="__ok">OK</button>
      </div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const input = card.querySelector('#__prompt_input');
    input.value = defaultValue;
    input.focus();
    input.select();
    const done = (val) => { overlay.remove(); resolve(val); };
    card.querySelector('#__cancel').onclick = () => done(null);
    card.querySelector('#__ok').onclick = () => done(input.value.trim());
    input.addEventListener('keydown', (e) => { if (e.key==='Enter') { e.preventDefault(); done(input.value.trim()); } });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(null); });
  });
}

async function showConfirm({ title = 'Are you sure?', okText = 'OK', cancelText = 'Cancel' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:grid;place-items:center;';
    const card = document.createElement('div');
    card.className = 'card vstack';
    card.style.cssText = 'width:420px;gap:12px;';
    card.innerHTML = `
      <div style="font-weight:700;">${title}</div>
      <div class="hstack" style="justify-content:flex-end;gap:8px;">
        <button class="button secondary" id="__cancel">${cancelText}</button>
        <button class="button danger" id="__ok">${okText}</button>
      </div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const done = (val) => { overlay.remove(); resolve(val); };
    card.querySelector('#__cancel').onclick = () => done(false);
    card.querySelector('#__ok').onclick = () => done(true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
  });
}

function addMsg(role, content, sources=[]) {
  const box = qs('#chat-box');
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  wrap.innerHTML = `<div class="msg-content">${renderMarkdown(content)}</div>`;
  if (sources.length) {
    // Deduplicate by document id or source path
    const seen = new Set();
    const uniq = [];
    for (const s of sources) {
      const key = s.document_id || s.source || s.title;
      if (!key || seen.has(key)) continue; seen.add(key); uniq.push(s);
    }
    if (uniq.length) {
      const src = document.createElement('div'); src.className = 'srcs';
      src.innerHTML = 'Sources:';
      const list = document.createElement('ul'); list.style.margin='6px 0 0'; list.style.padding='0 0 0 18px';
      uniq.forEach(s => {
        const li = document.createElement('li');
        const name = s.title || s.source || 'Untitled';
        const meta = [];
        if (s.kb_id) meta.push(`KB #${s.kb_id}`);
        if (s.document_id) meta.push(`Doc ${s.document_id}`);
        const a = document.createElement('a');
        const p = s.file_path || s.source || '';
        const snippet = (s.text || '').slice(0, 500);
        if (p && /^https?:\/\//i.test(p)) {
          a.href = p; a.target = '_blank'; a.rel = 'noopener';
          a.onclick = (e) => { e.preventDefault(); if (window.steve && window.steve.openExternal) window.steve.openExternal(p); };
        } else {
          a.href = '#';
          a.onclick = (e) => {
            e.preventDefault();
            if (p && window.steve && window.steve.openPath) { window.steve.openPath(p); }
            else {
              // fallback preview snippet
              const overlay = document.createElement('div');
              overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:grid;place-items:center;';
              const card = document.createElement('div');
              card.className = 'card vstack';
              card.style.cssText = 'width:640px;max-height:70vh;overflow:auto;gap:12px;';
              card.innerHTML = `<div style="font-weight:700;">${name}</div><div class="text-dim">${renderMarkdown(snippet || 'No preview available.')}</div><div class="hstack" style="justify-content:flex-end;"><button class="button secondary" id="__close">Close</button></div>`;
              overlay.appendChild(card);
              document.body.appendChild(overlay);
              card.querySelector('#__close').onclick = () => overlay.remove();
              overlay.addEventListener('click', (ev)=>{ if(ev.target===overlay) overlay.remove(); });
            }
          };
        }
        a.textContent = name + (meta.length?` (${meta.join(' · ')})`:'' );
        if (snippet) a.title = snippet.slice(0, 120) + (snippet.length>120?'…':'');
        li.appendChild(a);
        list.appendChild(li);
      });
      src.appendChild(list);
      wrap.appendChild(src);
    }
  }
  const actions = document.createElement('div'); actions.className='actions';
  const copyBtn = document.createElement('button'); copyBtn.className='mini'; copyBtn.textContent='Copy';
  copyBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(content); toast('Copied'); } catch { /* ignore */ }
  };
  actions.appendChild(copyBtn);
  wrap.appendChild(actions);
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

async function sendChat() {
  const text = qs('#chat-input').value.trim(); if (!text) return;
  const kb_ids = pickSelectedKBs(); if (!kb_ids.length) { toast('Select at least one KB', 'error'); return; }
  // Remove empty state if present
  hideEmptyChatAnimation();
  addMsg('user', text);
  qs('#chat-input').value='';
  try {
  const ctxKSel = qs('#ctx-k');
  const ctxK = ctxKSel ? Math.max(1, parseInt(ctxKSel.value, 10)) : defaultTopK;
  const body = { kb_ids, messages: [{ role: 'user', content: text }], top_k: ctxK };
    const box = qs('#chat-box');
    const wrap = document.createElement('div'); wrap.className='msg assistant';
    const contentEl = document.createElement('div'); contentEl.className='msg-content'; contentEl.innerHTML = '';
    wrap.appendChild(contentEl);
    box.appendChild(wrap); box.scrollTop = box.scrollHeight;

  let sources = null;
  let acc = '';
  let hadStreamError = false;
  const tryManualStream = async () => {
      const resp = await fetch(`${API}/chat/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }, body: JSON.stringify(body) });
      if (!resp.ok || !resp.body) { hadStreamError = true; throw new Error(await resp.text()); }
      const reader = resp.body.getReader(); const decoder = new TextDecoder();
      let buffer = '';
      for(;;) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx); buffer = buffer.slice(idx+2);
          const lines = block.split('\n');
          let event = 'message'; let data = '';
          for (const l of lines) {
            if (l.startsWith('event:')) event = l.slice(6).trim();
            else if (l.startsWith('data:')) data += l.slice(5).trim();
          }
          if (event === 'sources') { try { sources = JSON.parse(data); } catch { /* ignore */ } }
          else if (event === 'token') { let t; try { t = JSON.parse(data); } catch { t = data; } acc += t; contentEl.innerHTML = renderMarkdown(acc); }
          else if (event === 'error') { hadStreamError = true; let t; try { t = JSON.parse(data); } catch { t = data; } acc = t; contentEl.innerHTML = renderMarkdown(acc); }
        }
      }
  };

  if (window.steve && window.steve.fetchEventSource) {
      try {
        await window.steve.fetchEventSource(`${API}/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify(body),
          openWhenHidden: true,
          onopen(resp) {
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          },
          onmessage(ev) {
            if (ev.event === 'sources') { try { sources = JSON.parse(ev.data); } catch { sources = null; } }
            else if (ev.event === 'token') { let t; try { t = JSON.parse(ev.data); } catch { t = ev.data; } acc += t; contentEl.innerHTML = renderMarkdown(acc); }
            else if (ev.event === 'error') { hadStreamError = true; let t; try { t = JSON.parse(ev.data); } catch { t = ev.data; } acc = t; contentEl.innerHTML = renderMarkdown(acc); }
          },
          onerror(err) { hadStreamError = true; throw err; }
        });
      } catch(e) {
        // Try manual SSE as a second attempt
        try { await tryManualStream(); } catch { /* fall through to non-stream */ }
      }
    } else {
      try { await tryManualStream(); } catch { /* fall through to non-stream */ }
    }
    // Fallback to non-streaming if stream errored or produced no content
  if (hadStreamError || !contentEl.textContent) {
      try {
        const resp = await fetchJSON(`${API}/chat`, { method: 'POST', body: JSON.stringify(body) });
    contentEl.innerHTML = renderMarkdown(resp.reply || '');
    sources = resp.sources || sources;
      } catch (e2) {
    contentEl.innerHTML = renderMarkdown('Error: ' + (e2.message || 'Chat failed'));
      }
    }
    if (sources && sources.length) {
      const seen = new Set();
      const uniq = [];
      for (const s of sources) { const key = s.document_id || s.source || s.title; if (!key || seen.has(key)) continue; seen.add(key); uniq.push(s); }
      if (uniq.length) {
        const src = document.createElement('div'); src.className='srcs';
        src.innerHTML = 'Sources:';
        const list = document.createElement('ul'); list.style.margin='6px 0 0'; list.style.padding='0 0 0 18px';
        uniq.forEach(s => { const li=document.createElement('li'); const meta=[]; if(s.kb_id) meta.push(`KB #${s.kb_id}`); if(s.document_id) meta.push(`Doc ${s.document_id}`); const a=document.createElement('a'); a.href='#'; a.textContent=(s.title||s.source||'Untitled') + (meta.length?` (${meta.join(' · ')})`:'' ); a.onclick=(e)=>{ e.preventDefault(); const p=s.file_path||s.source||s.title; if(!p) return; if(/^https?:\/\//i.test(p)) { if(window.steve && window.steve.openExternal) window.steve.openExternal(p); } else { if(window.steve && window.steve.openPath) window.steve.openPath(p); } }; li.appendChild(a); list.appendChild(li); });
        src.appendChild(list);
        wrap.appendChild(src);
      }
    }
    const actions = document.createElement('div'); actions.className='actions';
    const copyBtn = document.createElement('button'); copyBtn.className='mini'; copyBtn.textContent='Copy';
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(acc || contentEl.textContent || contentEl.innerText || ''); toast('Copied'); } catch {} };
    actions.appendChild(copyBtn);
    wrap.appendChild(actions);

    const s = getSession(activeSessionId) || newSession('New Chat');
    const wasEmpty = (s.messages||[]).length === 0;
    s.messages.push({ role: 'user', content: text });
    // Only auto-title if the session is empty AND still has a default/empty title
    if (wasEmpty && (!s.title || /^New Chat$/i.test(s.title))) {
      s.title = text.slice(0, 48) + (text.length>48?'…':'');
    }
  s.messages.push({ role: 'assistant', content: acc || contentEl.textContent || '', sources: sources||[] });
    saveSessions();
  } catch(e) { addMsg('assistant', 'Error: '+e.message); }
}

function renderLookup() {
  qs('#view-lookup').innerHTML = `
    <div class="vstack" style="gap:16px;">
      <div class="card vstack">
        <h3>Document Lookup</h3>
        <p class="text-dim">Search your knowledgebases for relevant snippets using hybrid retrieval (semantic + keyword). Great for finding source passages before chatting.</p>
      </div>
      <div class="card vstack">
        <div class="hstack" style="justify-content:space-between; align-items:center;">
          <div class="text-dim">Select knowledgebases</div>
          <div class="hstack">
            <button id="lookup-all" class="button secondary">All</button>
            <button id="lookup-none" class="button secondary">None</button>
          </div>
        </div>
        <div style="flex:1 1 auto;">
          <div id="lookup-kb-checks" class="kb-tiles" style="max-height:220px; overflow:auto;"></div>
        </div>
      </div>
      <div class="card hstack">
        <input id="lookup-q" class="input" placeholder="Search query"/>
        <button id="lookup-run" class="button">Search</button>
      </div>
      <div id="lookup-results"></div>
    </div>
  `;
  (async () => {
    const list = await fetchJSON(`${API}/kb`);
    const wrap = qs('#lookup-kb-checks');
    if (!list.length) { wrap.innerHTML = '<div class="text-dim">No knowledgebases yet.</div>'; return; }
    list.forEach(k => { const row=document.createElement('label'); row.className='kb-tile'; row.innerHTML=`<input type="checkbox" value="${k.id}"><div><div class="name">${k.name}</div><div class="meta">${k.doc_count} docs</div></div>`; wrap.appendChild(row); });
    qs('#lookup-all').onclick=()=> wrap.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true);
    qs('#lookup-none').onclick=()=> wrap.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false);
  })();
  const runLookup = async () => {
    const kb_ids = Array.from(document.querySelectorAll('#lookup-kb-checks input[type=checkbox]:checked')).map(i=>parseInt(i.value,10));
    const query = qs('#lookup-q').value.trim(); if (!query || !kb_ids.length) { toast('Enter query and choose knowledgebases', 'error'); return; }
    const host = qs('#lookup-results');
    host.innerHTML = '';
    const card = document.createElement('div'); card.className='card vstack'; host.appendChild(card);
    card.innerHTML = '<div class="hstack"><div class="spinner"></div><div class="text-dim">Searching...</div></div>';
    const data = await fetchJSON(`${API}/search`, { method: 'POST', body: JSON.stringify({ kb_ids, query, top_k: 50, hybrid: true, alpha: defaultAlpha })});
    // Group by document
    const groups = new Map();
    for (const r of (data.results||[])) {
      const g = groups.get(r.document_id) || { doc: r, matches: [] };
      g.matches.push(r);
      g.doc = { ...g.doc, title: r.title, source: r.source, file_path: r.file_path, kb_id: r.kb_id };
      groups.set(r.document_id, g);
    }
    card.innerHTML = '';
    if (groups.size === 0) { card.innerHTML = '<div class="text-dim">No results.</div>'; return; }
    const wrap = document.createElement('div'); wrap.className='list'; card.appendChild(wrap);
    for (const [docId, g] of groups.entries()) {
      const name = g.doc.title || g.doc.source || `Document ${docId}`;
      const item = document.createElement('div'); item.className='list-item';
      item.innerHTML = `
        <div style="max-width:70%">
          <div style="font-weight:700;">${name}</div>
          <div class="text-dim">${g.matches.length} match${g.matches.length>1?'es':''}</div>
        </div>
        <div class="hstack">
          <button class="button secondary" data-preview>Preview</button>
          <button class="button" data-open>Open</button>
        </div>
      `;
      item.querySelector('[data-preview]').onclick = () => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:grid;place-items:center;';
        const card = document.createElement('div'); card.className='card vstack'; card.style.cssText='width:800px;max-height:80vh;overflow:auto;gap:12px;';
        card.innerHTML = `<div style=\"font-weight:800;\">${name}</div><div id=\"__matches\" class=\"list\"></div><div class=\"hstack\" style=\"justify-content:flex-end;\"><button class=\"button secondary\" id=\"__close\">Close</button></div>`;
        overlay.appendChild(card); document.body.appendChild(overlay);
        card.querySelector('#__close').onclick = () => overlay.remove(); overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.remove(); });
        const mwrap = card.querySelector('#__matches');
        g.matches.slice(0, 30).forEach(m => {
          const safeText = (m.text||'').replace(/</g,'&lt;');
          const row = document.createElement('div'); row.className='list-item';
          row.innerHTML = `<div style=\"max-width:70%\">${safeText}</div><div class=\"text-dim\">score ${(m.score||0).toFixed(3)}</div>`;
          mwrap.appendChild(row);
        });
      };
      item.querySelector('[data-open]').onclick = () => {
        const p = g.doc.file_path || g.doc.source || '';
        if (p && /^https?:\/\//i.test(p)) { if (window.steve && window.steve.openExternal) window.steve.openExternal(p); }
        else if (p) { if (window.steve && window.steve.openPath) window.steve.openPath(p); }
        else { toast('No openable path for this document', 'error'); }
      };
      wrap.appendChild(item);
    }
  };
  qs('#lookup-run').onclick = runLookup;
  qs('#lookup-q').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); runLookup(); } });
}

function initNav() {
  const onNav = (b) => {
    switchView(b.dataset.view);
    if (b.dataset.view === 'home') renderHome();
    if (b.dataset.view === 'kb') renderKB();
    if (b.dataset.view === 'chat') renderChat();
    if (b.dataset.view === 'lookup') renderLookup();
    if (b.dataset.view === 'settings') renderSettings();
  };
  qsa('.nav-btn').forEach(b => b.onclick = () => onNav(b));
  qsa('.tab-btn').forEach(b => b.onclick = () => onNav(b));
}

function renderSettings() {
  qs('#view-settings').innerHTML = `
    <div class="vstack" style="gap:16px;">
      <div class="card vstack">
        <h3>Connection & Models</h3>
        <div class="vstack">
          <label class="vstack" style="gap:6px;">
            <span class="text-dim">Base URL (OpenAI-compatible)</span>
            <input id="endpoint" class="input" placeholder="e.g. http://127.0.0.1:1234/v1"/>
          </label>
          <label class="vstack" style="gap:6px;">
            <span class="text-dim">API Key (optional)</span>
            <input id="api-key" class="input" placeholder="lm-studio or other"/>
          </label>
        </div>
        <div class="hstack" style="flex-wrap:wrap;">
          <label class="vstack" style="gap:6px; min-width:260px;">
            <span class="text-dim">Embedding Model</span>
            <select id="embed-model" class="input"></select>
          </label>
          <label class="vstack" style="gap:6px; min-width:260px;">
            <span class="text-dim">Chat Model</span>
            <select id="chat-model" class="input"></select>
          </label>
          <label class="vstack" style="gap:6px; width:120px;">
            <span class="text-dim">Default Top K</span>
            <input id="top-k" type="number" min="1" max="50" class="input" placeholder="5"/>
          </label>
          <label class="vstack" style="gap:6px; width:160px;">
            <span class="text-dim">Hybrid alpha (0–1)</span>
            <input id="alpha" type="number" min="0" max="1" step="0.05" class="input" placeholder="0.6"/>
          </label>
          <div style="flex:1 1 auto;"></div>
          <button id="save-settings" class="button" title="Save and apply settings">Save</button>
        </div>
      </div>
    </div>
  `;
  loadSettings();
}

function loadLocalConfig() { try { return JSON.parse(localStorage.getItem('steve.config')||'{}'); } catch { return {}; } }
function saveLocalConfig(cfg) { localStorage.setItem('steve.config', JSON.stringify(cfg||{})); }

async function loadSettings() {
  try {
    const localCfg = loadLocalConfig();
    if (localCfg && Object.keys(localCfg).length) {
      qs('#endpoint').value = localCfg.openai_base_url || '';
      qs('#api-key').value = localCfg.openai_api_key || '';
      qs('#top-k').value = String(localCfg.top_k || defaultTopK);
      qs('#alpha').value = String(localCfg.retrieval_alpha ?? defaultAlpha);
    }
    const cfg = await fetchJSON(`${API}/config`);
    // Persist to local and in-memory defaults
    saveLocalConfig(cfg);
    qs('#endpoint').value = cfg.openai_base_url || '';
    qs('#api-key').value = cfg.openai_api_key || '';
    qs('#top-k').value = String(cfg.top_k || defaultTopK);
    qs('#alpha').value = String(cfg.retrieval_alpha ?? defaultAlpha);
    defaultTopK = cfg.top_k || defaultTopK;
    defaultAlpha = (typeof cfg.retrieval_alpha === 'number' ? cfg.retrieval_alpha : defaultAlpha);
    const models = await fetchJSON(`${API}/models`);
    const opts = (models.data||[]).map(m => m.id);
    const embedSel = qs('#embed-model'); const chatSel = qs('#chat-model');
    embedSel.innerHTML = ''; chatSel.innerHTML = '';
    opts.forEach(id => {
      const e = document.createElement('option'); e.value = id; e.textContent = id; embedSel.appendChild(e);
      const c = document.createElement('option'); c.value = id; c.textContent = id; chatSel.appendChild(c);
    });
    // Prefer locally saved selection, then backend cfg
    const saved = loadLocalConfig();
  embedSel.value = (saved.embedding_model || cfg.embedding_model || opts[0] || '');
  chatSel.value = (saved.chat_model || cfg.chat_model || opts[0] || '');
  // Persist selections immediately when changed
  embedSel.addEventListener('change', () => { const conf = loadLocalConfig(); conf.embedding_model = embedSel.value; saveLocalConfig(conf); });
  chatSel.addEventListener('change', () => { const conf = loadLocalConfig(); conf.chat_model = chatSel.value; saveLocalConfig(conf); });
  qs('#top-k').addEventListener('change', () => { const conf = loadLocalConfig(); conf.top_k = Math.max(1, parseInt(qs('#top-k').value||'5',10)); saveLocalConfig(conf); defaultTopK = conf.top_k; saveSessions(); });
  qs('#alpha').addEventListener('change', () => { const conf = loadLocalConfig(); const v = parseFloat(qs('#alpha').value||'0.6'); conf.retrieval_alpha = Math.min(1, Math.max(0, isNaN(v)?0.6:v)); saveLocalConfig(conf); defaultAlpha = conf.retrieval_alpha; saveSessions(); });
    qs('#save-settings').onclick = async () => {
      defaultTopK = Math.max(1, parseInt(qs('#top-k').value||String(defaultTopK),10));
      defaultAlpha = Math.min(1, Math.max(0, parseFloat(qs('#alpha').value||String(defaultAlpha))));
      const payload = {
        openai_base_url: qs('#endpoint').value.trim(),
        openai_api_key: qs('#api-key').value.trim(),
        embedding_model: embedSel.value,
        chat_model: chatSel.value,
        top_k: defaultTopK,
        retrieval_alpha: defaultAlpha
      };
      try {
        const applied = await fetchJSON(`${API}/config`, { method: 'POST', body: JSON.stringify(payload) });
        const merged = { ...(applied.current || payload) };
        // persist chosen models too
        merged.embedding_model = embedSel.value;
        merged.chat_model = chatSel.value;
        saveLocalConfig(merged);
        toast('Settings saved', 'success'); saveSessions();
      }
      catch(e){ toast('Failed to save settings: '+e.message, 'error'); }
    };
    // Proactively push local settings to backend once when app starts if different
    const bootCfg = loadLocalConfig();
    const needPush = bootCfg && (bootCfg.openai_base_url || bootCfg.embedding_model || bootCfg.chat_model || bootCfg.top_k || typeof bootCfg.retrieval_alpha === 'number');
    if (needPush) {
      try { await fetchJSON(`${API}/config`, { method: 'POST', body: JSON.stringify({
        openai_base_url: bootCfg.openai_base_url,
        openai_api_key: bootCfg.openai_api_key,
        embedding_model: bootCfg.embedding_model || embedSel.value,
        chat_model: bootCfg.chat_model || chatSel.value,
        top_k: bootCfg.top_k || defaultTopK,
        retrieval_alpha: (typeof bootCfg.retrieval_alpha==='number'?bootCfg.retrieval_alpha:defaultAlpha)
      }) }); } catch {}
    }
  } catch(e){
    qs('#view-settings').innerHTML = `<div class="card">Failed to load settings: ${e.message}</div>`;
  }
}

// init
initNav();
// sidebar toggle with chevron flip and ARIA labels
const sidebarToggle = document.getElementById('sidebar-toggle');
function updateSidebarToggle(){
  if (!sidebarToggle) return;
  const icon = sidebarToggle.querySelector('.icon');
  const collapsed = document.body.classList.contains('sidebar-collapsed');
  if (icon) icon.textContent = collapsed ? '❯' : '❮';
  const title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  sidebarToggle.title = title;
  sidebarToggle.setAttribute('aria-label', title);
}
if (sidebarToggle) {
  sidebarToggle.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    document.body.classList.toggle('sidebar-collapsed');
    updateSidebarToggle();
  });
  sidebarToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sidebarToggle.click(); }
  });
  updateSidebarToggle();
}
switchView('home');
renderHome();
