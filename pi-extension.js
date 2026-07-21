// om-memory Pi Extension
// Pi agent treats this repo as its memory home.
// - Loads past context at session start
// - Saves on compaction
// - Reads/writes only from ~/om-memory

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const HOME = require("os").homedir();
const MEMORY_REPO = path.join(HOME, "om-memory");
const MEMORY_DIR = path.join(MEMORY_REPO, "memory");
const INDEX_FILE = path.join(MEMORY_DIR, "_index.json");

// ─── Repo helpers ──────────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function loadIndex() {
  try {
    if (fs.existsSync(INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
    }
  } catch {}
  return [];
}

function saveIndex(entries) {
  ensureDir();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2));
}

function gitSync() {
  // Only push if this is a real git repo with a remote
  try {
    execSync("git rev-parse --git-dir", { cwd: MEMORY_REPO, stdio: "pipe" });
    execSync("git remote get-url origin", { cwd: MEMORY_REPO, stdio: "pipe" });
  } catch {
    return; // No git repo or no remote
  }
  try {
    const cwd = MEMORY_REPO;
    execSync("git pull --rebase origin main", { cwd, stdio: "pipe", timeout: 10000 });
    execSync("git add -A", { cwd, stdio: "pipe" });
    const diff = execSync("git diff --staged --stat", { cwd, stdio: "pipe", encoding: "utf8" });
    if (!diff.trim()) return;
    execSync(`git commit -m "memory: ${new Date().toISOString()}"`, {
      cwd, stdio: "pipe",
    });
    execSync("git push origin main", { cwd, stdio: "pipe", timeout: 15000 });
  } catch {
    // Silent skip
  }
}

function addMemory(entry) {
  ensureDir();
  const index = loadIndex();
  index.unshift(entry);

  // Keep last 200 entries max
  const trimmed = index.slice(0, 200);
  saveIndex(trimmed);

  // Also save individual file
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}_${(entry.sessionId || "s").slice(0, 8)}.json`;
  fs.writeFileSync(path.join(MEMORY_DIR, filename), JSON.stringify(entry, null, 2));

  // Attempt git sync (non-blocking)
  setTimeout(() => gitSync(), 100);
}

function searchMemory(query) {
  const index = loadIndex();
  if (!query) return index.slice(0, 10);

  const q = query.toLowerCase();
  return index
    .filter((e) => JSON.stringify(e).toLowerCase().includes(q))
    .slice(0, 20);
}

function getRecentContext(maxEntries = 5) {
  const index = loadIndex();
  return index
    .filter((e) => e.type === "compaction" || e.type === "snapshot")
    .slice(0, maxEntries);
}

// ─── Extension ─────────────────────────────────────────────────────────────

module.exports = function (pi) {
  let memoryLoaded = false;

  // Register /memory command
  pi.registerCommand({
    name: "memory",
    description: "Search or view pi agent memory",
    execute: async (ctx) => {
      const args = ctx.args?.trim() || "";
      if (args === "recent") {
        const entries = getRecentContext(5);
        const lines = ["## Recent Memory", ""];
        for (const e of entries) {
          lines.push(
            `- **${e.type}** (${new Date(e.timestamp).toLocaleString()}): ${(e.summary || "").slice(0, 150)}...`
          );
        }
        ctx.reply(lines.join("\n"));
      } else if (args === "stats") {
        const index = loadIndex();
        const sessions = new Set(index.map((e) => e.sessionId)).size;
        const compactions = index.filter((e) => e.type === "compaction").length;
        ctx.reply(
          `## Memory Stats\n\n- **Total entries:** ${index.length}\n- **Unique sessions:** ${sessions}\n- **Compactions:** ${compactions}\n- **Repo:** [om-memory](https://github.com/vachit-in/om-memory)\n- **Live page:** [vachit-in.github.io/om-memory](https://vachit-in.github.io/om-memory)`
        );
      } else if (args) {
        const results = searchMemory(args);
        if (results.length === 0) {
          ctx.reply("No memories found matching your query.");
        } else {
          const lines = [`## Memory search: "${args}"`, ""];
          for (const e of results) {
            lines.push(
              `- **${e.type}** [${new Date(e.timestamp).toLocaleString()}] ${(e.summary || "").slice(0, 200)}`
            );
          }
          ctx.reply(lines.join("\n"));
        }
      } else {
        const recent = getRecentContext(5);
        const lines = [
          "## Pi Agent Memory",
          "",
          "Use `/memory recent` to see recent entries",
          "Use `/memory stats` for statistics",
          "Use `/memory <query>` to search",
          "",
          "### Recent:",
        ];
        for (const e of recent) {
          lines.push(
            `- **${e.type}**: ${(e.summary || "").slice(0, 120)}...`
          );
        }
        ctx.reply(lines.join("\n"));
      }
    },
  });

  // Register /save-memory command (manual save)
  pi.registerCommand({
    name: "save-memory",
    description: "Manually save a memory note",
    execute: async (ctx) => {
      const text = ctx.args?.trim();
      if (!text) {
        ctx.reply("Usage: /save-memory <your note>");
        return;
      }
      const model = pi.agent?.state?.model;
      addMemory({
        timestamp: new Date().toISOString(),
        sessionId: pi.session?.sessionId || "manual",
        sessionFile: pi.session?.sessionFile || "",
        type: "manual",
        summary: text,
        model: model ? { provider: model.provider, id: model.id } : null,
      });
      ctx.reply(`✅ Saved to memory: "${text.slice(0, 100)}..."`);
    },
  });

  // Register /switch-whatsapp - hand this session to WhatsApp bot
  pi.registerCommand({
    name: "switch-whatsapp",
    description: "Hand this session over to the WhatsApp bot",
    execute: async (ctx) => {
      const sessionFile = pi.session?.sessionFile;
      if (!sessionFile) {
        ctx.reply("❌ This session has no file (ephemeral). Cannot switch.");
        return;
      }
      const sessionId = pi.session?.sessionId || "?";
      const sessionName = pi.session?.sessionName || "unnamed";
      const model = pi.agent?.state?.model;

      const pointer = {
        sessionFile,
        sessionId,
        sessionName,
        model: model ? `${model.provider}/${model.id}` : "?",
        timestamp: new Date().toISOString(),
      };

      const pointerPath = path.join(MEMORY_REPO, ".whatsapp-session");
      fs.writeFileSync(pointerPath, JSON.stringify(pointer, null, 2));
      gitSync();

      ctx.reply(
        `📲 *Session handed to WhatsApp bot!*\n\n` +
        `Session: ${sessionName}\n` +
        `Model: ${pointer.model}\nSession ID: ${sessionId.slice(0, 8)}...\n\n` +
        `Open WhatsApp and send a message to continue from here.`
      );
    },
  });

  // Load past context on first agent start
  pi.on("agent_start", () => {
    if (memoryLoaded) return;
    memoryLoaded = true;

    const recent = getRecentContext(3);
    if (recent.length === 0) return;

    // Inject past context as a system message via a tool call
    const contextLines = [
      "\n---",
      "## Recent Memory (from previous sessions)",
      "You have access to your memory repo at /Users/om/om-memory.",
      "Use `/memory` to search past contexts. Use `/save-memory` to persist important info.",
      "",
    ];
    for (const e of recent) {
      contextLines.push(
        `[${new Date(e.timestamp).toLocaleString()}] **${e.type}** (session ${(e.sessionId || "").slice(0, 8)}): ${e.summary || ""}`
      );
    }
    contextLines.push("---\n");

    // Store as context that pi can reference
    pi._memoryContext = contextLines.join("\n");
  });

  // Auto-save on compaction
  pi.on("compaction_end", (event) => {
    if (!event.result || event.aborted) return;

    const model = pi.agent?.state?.model;
    addMemory({
      timestamp: new Date().toISOString(),
      sessionId: pi.session?.sessionId || "unknown",
      sessionFile: pi.session?.sessionFile || "",
      type: "compaction",
      summary: event.result.summary || "",
      tokensBefore: event.result.tokensBefore || 0,
      tokensAfter: event.result.estimatedTokensAfter || 0,
      model: model ? { provider: model.provider, id: model.id } : null,
    });
  });

  // Periodic snapshots
  pi.on("agent_settled", () => {
    const state = pi.agent?.state;
    if (!state) return;
    const messages = state.messages || [];
    if (messages.length < 4) return;

    const lastSaveKey = "__om_memory_last_count";
    const currentCount = messages.length;
    const lastCount = pi[lastSaveKey] || 0;
    if (currentCount - lastCount < 10) return;
    pi[lastSaveKey] = currentCount;

    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const lastText =
      lastAssistant?.content?.find((c) => c.type === "text")?.text || "";

    addMemory({
      timestamp: new Date().toISOString(),
      sessionId: pi.session?.sessionId || "unknown",
      sessionFile: pi.session?.sessionFile || "",
      type: "snapshot",
      summary: lastText.slice(0, 500),
      model: state.model
        ? { provider: state.model.provider, id: state.model.id }
        : null,
    });
  });
};
