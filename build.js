#!/usr/bin/env node
// Build interactive HTML page from memory entries

const fs = require("fs");
const path = require("path");

const MEMORY_DIR = path.join(__dirname, "memory");
const OUTPUT = path.join(__dirname, "index.html");

function loadMemories() {
  const entries = [];
  if (!fs.existsSync(MEMORY_DIR)) return entries;

  for (const file of fs.readdirSync(MEMORY_DIR)) {
    if (!file.endsWith(".json")) continue;
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(MEMORY_DIR, file), "utf8")
      );
      entries.push(data);
    } catch (e) {
      console.error(`Failed to parse ${file}:`, e.message);
    }
  }

  entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return entries;
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

function formatDate(ts) {
  return new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

function buildHtml(entries) {
  const sessions = new Map();
  for (const e of entries) {
    if (!sessions.has(e.sessionId)) {
      sessions.set(e.sessionId, []);
    }
    sessions.get(e.sessionId).push(e);
  }

  let cardsHtml = "";
  for (const [sessionId, sessionEntries] of sessions) {
    const latest = sessionEntries[0];
    const count = sessionEntries.length;
    const typeIcons = { compaction: "🗜️", snapshot: "📸" };

    cardsHtml += `
    <div class="card">
      <div class="card-header" onclick="this.parentElement.classList.toggle('expanded')">
        <span class="session-id">${escapeHtml(sessionId.slice(0, 8))}...</span>
        <span class="meta">${formatDate(latest.timestamp)} · ${count} entries · ${latest.model?.id || "?"}</span>
        <span class="arrow">▾</span>
      </div>
      <div class="card-body">`;

    for (const e of sessionEntries) {
      const icon = typeIcons[e.type] || "📄";
      cardsHtml += `
        <div class="entry ${e.type}">
          <div class="entry-header">
            <span>${icon} ${e.type}</span>
            <span>${formatDate(e.timestamp)}</span>
          </div>
          <div class="entry-summary">${escapeHtml(e.summary || "(no summary)")}</div>
          ${e.tokensBefore ? `<div class="entry-tokens">Tokens: ${e.tokensBefore} → ${e.tokensAfter}</div>` : ""}
        </div>`;
    }

    cardsHtml += `
      </div>
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Om's Pi Agent Memory</title>
<style>
  :root {
    --bg: #0d1117;
    --card-bg: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --text-dim: #8b949e;
    --accent: #58a6ff;
    --green: #3fb950;
    --orange: #d29922;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height: 1.6;
    min-height: 100vh;
  }
  header {
    background: var(--card-bg);
    border-bottom: 1px solid var(--border);
    padding: 16px 24px;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  header h1 { font-size: 20px; color: var(--accent); }
  header p { color: var(--text-dim); font-size: 14px; margin-top: 4px; }
  .container { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
  .stats {
    display: flex;
    gap: 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .stat {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    flex: 1;
    min-width: 120px;
    text-align: center;
  }
  .stat .num { font-size: 28px; font-weight: bold; color: var(--accent); }
  .stat .label { color: var(--text-dim); font-size: 12px; margin-top: 4px; }
  .card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .card-header {
    padding: 12px 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    user-select: none;
  }
  .card-header:hover { background: rgba(255,255,255,0.03); }
  .session-id { font-weight: 600; color: var(--accent); font-size: 14px; }
  .meta { color: var(--text-dim); font-size: 12px; flex: 1; }
  .arrow { color: var(--text-dim); transition: transform 0.2s; }
  .card.expanded .arrow { transform: rotate(180deg); }
  .card-body { display: none; padding: 0 16px 16px; }
  .card.expanded .card-body { display: block; }
  .entry {
    padding: 10px 12px;
    margin-top: 8px;
    border-radius: 6px;
    border-left: 3px solid var(--border);
  }
  .entry.compaction { border-left-color: var(--orange); }
  .entry.snapshot { border-left-color: var(--green); }
  .entry-header {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 6px;
  }
  .entry-summary {
    font-size: 14px;
    color: var(--text);
    max-height: 200px;
    overflow-y: auto;
  }
  .entry-tokens {
    font-size: 11px;
    color: var(--text-dim);
    margin-top: 6px;
  }
  .search {
    margin-bottom: 20px;
  }
  .search input {
    width: 100%;
    padding: 10px 16px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
  }
  .search input:focus { outline: none; border-color: var(--accent); }
  footer {
    text-align: center;
    padding: 24px;
    color: var(--text-dim);
    font-size: 12px;
  }
  footer a { color: var(--accent); }
  .empty { text-align: center; padding: 48px; color: var(--text-dim); }
</style>
</head>
<body>
<header>
  <h1>🧠 Om's Pi Agent Memory</h1>
  <p>Auto-generated from pi coding agent sessions · Last updated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
</header>
<div class="container">
  <div class="stats">
    <div class="stat"><div class="num">${sessions.size}</div><div class="label">Sessions</div></div>
    <div class="stat"><div class="num">${entries.length}</div><div class="label">Memory Entries</div></div>
    <div class="stat"><div class="num">${entries.filter(e => e.type === "compaction").length}</div><div class="label">Compactions</div></div>
  </div>
  <div class="search">
    <input type="text" id="search" placeholder="Search memories..." oninput="filterCards()">
  </div>
  <div id="cards">
    ${cardsHtml || '<div class="empty">No memories yet. Start chatting with pi to create them!</div>'}
  </div>
</div>
<footer>
  <a href="https://github.com/vachit-in/om-memory">om-memory</a> · Powered by <a href="https://github.com/earendil-works/pi-coding-agent">pi</a>
</footer>
<script>
  function filterCards() {
    const q = document.getElementById('search').value.toLowerCase();
    document.querySelectorAll('.card').forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }
  // Auto-expand most recent
  document.querySelector('.card')?.classList.add('expanded');
</script>
</body>
</html>`;
}

const entries = loadMemories();
const html = buildHtml(entries);
fs.writeFileSync(OUTPUT, html);
console.log(`Built ${OUTPUT} with ${entries.length} entries`);
