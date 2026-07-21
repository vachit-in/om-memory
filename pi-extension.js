// Pi extension: auto-push memory on compaction
// Install: add to ~/.pi/agent/extensions/ or .pi/extensions/

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const MEMORY_REPO = path.join(require("os").homedir(), "om-memory");
const MEMORY_DIR = path.join(MEMORY_REPO, "memory");

function ensureRepo() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

function gitPush(filePath, sessionId) {
  try {
    const cwd = MEMORY_REPO;
    execSync("git pull --rebase origin main", { cwd, stdio: "pipe" });
    execSync("git add -A", { cwd, stdio: "pipe" });
    const msg = `memory: ${sessionId} - ${new Date().toISOString()}`;
    execSync(`git commit -m "${msg}"`, { cwd, stdio: "pipe" });
    execSync("git push origin main", { cwd, stdio: "pipe" });
    return true;
  } catch (e) {
    console.error("[om-memory] git push failed:", e.message);
    return false;
  }
}

function saveMemory(sessionData) {
  ensureRepo();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${ts}_${sessionData.sessionId || "unknown"}.json`;
  const filePath = path.join(MEMORY_DIR, filename);

  const entry = {
    timestamp: new Date().toISOString(),
    sessionId: sessionData.sessionId || "unknown",
    sessionFile: sessionData.sessionFile || "",
    sessionName: sessionData.sessionName || "",
    type: sessionData.type || "compaction",
    summary: sessionData.summary || "",
    tokensBefore: sessionData.tokensBefore || 0,
    tokensAfter: sessionData.estimatedTokensAfter || 0,
    model: sessionData.model || null,
  };

  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
  gitPush(filePath, entry.sessionId);
}

// Pi extension entry point
module.exports = function (pi) {
  // Hook into compaction end
  pi.on("compaction_end", (event) => {
    if (!event.result || event.aborted) return;

    const state = pi.agent?.state;
    const model = state?.model;

    saveMemory({
      type: "compaction",
      sessionId: pi.session?.sessionId,
      sessionFile: pi.session?.sessionFile,
      sessionName: pi.session?.sessionName,
      summary: event.result.summary,
      tokensBefore: event.result.tokensBefore,
      estimatedTokensAfter: event.result.estimatedTokensAfter,
      model: model ? { provider: model.provider, id: model.id } : null,
    });
  });

  // Hook into agent_settled to save periodic snapshots
  pi.on("agent_settled", () => {
    const state = pi.agent?.state;
    if (!state) return;

    const messages = state.messages || [];
    if (messages.length < 4) return; // Skip tiny sessions

    // Only save every ~10 messages
    const lastSaveKey = `__om_memory_last_count`;
    const currentCount = messages.length;
    const lastCount = pi[lastSaveKey] || 0;
    if (currentCount - lastCount < 10) return;
    pi[lastSaveKey] = currentCount;

    // Get last assistant text
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    const lastText = lastAssistant?.content?.find(c => c.type === "text")?.text || "";

    saveMemory({
      type: "snapshot",
      sessionId: pi.session?.sessionId,
      sessionFile: pi.session?.sessionFile,
      summary: lastText.slice(0, 500),
      model: state.model ? { provider: state.model.provider, id: state.model.id } : null,
    });
  });
};
