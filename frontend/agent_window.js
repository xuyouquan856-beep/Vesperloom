// ============================================================================
// NAI Studio — Floating Studio Agent Window, SSE Runtime & Skills Manager
// Inspired by Claude Code, Codex CLI & ComfyUI/NovelAI Prompt-Diff Copilots
// ============================================================================

const AGENT_WIN_STORAGE_KEY = "nai_studio_agent_win_v1";

const agentState = {
  open: false,
  minimized: false,
  docked: true,
  activePane: "chat",
  mode: "agent",
  memory: "",
  sessionId: null,
  sessions: [],
  messages: [],
  skills: [],
  pinnedSkills: [],
  pendingAttachments: [],
  pendingMentions: [],
  proposalCache: {},
  editingSkillSlug: null,
  streaming: false,
  abortController: null,
  undoSnapshots: {},
  queuedMessage: "",
  activePromptText: "",
  sessionLoadSeq: 0,
  rafRenderPending: false,
  busyOps: new Set(),
};

function initStudioAgentWindow(bootstrapData = {}) {
  agentState.skills = Array.isArray(bootstrapData.skills) ? bootstrapData.skills : [];
  agentState.sessions = Array.isArray(bootstrapData.agent_sessions) ? bootstrapData.agent_sessions : [];
  try {
    const savedMode = localStorage.getItem("nai_studio_agent_mode");
    if (savedMode === "ask" || savedMode === "agent") agentState.mode = savedMode;
  } catch (e) {}

  restoreAgentWindowGeometry();
  setupAgentWindowDragAndResize();
  setupAgentDropZone();
  renderAgentModelPill();
  renderAgentModeButton();
  refreshAgentLiveStrip();
  renderAgentPinnedSkillsBar();
  renderAgentAttachmentsBar();
  renderAgentSkillsList();
  renderAgentSessionsList();

  if (agentState.sessions.length > 0) {
    loadAgentSession(agentState.sessions[0].id, false);
  } else {
    renderAgentMessages();
  }

  // Listen to live prompt edits on Classic textareas too
  ["prompt-input", "uc-input"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
      if (state.promptWorkspaceMode === "classic") {
        syncClassicToStructured();
      }
      refreshAgentLiveStrip();
    });
  });

  // Global Alt+A shortcut to toggle Agent window
  window.addEventListener("keydown", e => {
    if (e.altKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      toggleAgentWindow();
    }
  });
}

function renderAgentModelPill() {
  const pill = document.getElementById("agent-model-pill");
  const txt = document.getElementById("agent-model-pill-text");
  const hasKey = Boolean(state.config?.llm_api_key_set || state.config?.llm_api_key_masked);
  const modelName = state.config?.llm_model || "qwen4-max";
  if (txt) {
    txt.textContent = hasKey ? modelName : "未配置 LLM";
  } else if (pill) {
    pill.textContent = hasKey ? modelName : "未配置 LLM";
  }
  if (pill) {
    pill.style.borderColor = hasKey ? "" : "rgba(245, 158, 11, 0.55)";
    pill.style.color = hasKey ? "" : "var(--status-warn, #f59e0b)";
  }
}

function closeAgentQuickModelMenu() {
  const pop = document.getElementById("agent-quick-model-popover");
  if (pop) pop.classList.add("hidden");
}

function renderAgentQuickModelList() {
  const listEl = document.getElementById("agent-quick-model-list");
  const hostEl = document.getElementById("agent-quick-provider-host");
  if (!listEl) return;
  const baseUrl = String(state.config?.llm_base_url || "").trim();
  if (hostEl) {
    try {
      hostEl.textContent = baseUrl ? new URL(baseUrl).host : "未配置地址";
    } catch (_) {
      hostEl.textContent = baseUrl || "未配置地址";
    }
  }
  const current = String(state.config?.llm_model || "qwen4-max").trim();
  const pool = [];
  const seen = new Set();
  const pushM = (m) => {
    const s = String(m || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    pool.push(s);
  };
  pushM(current);
  (state.llmModels || []).forEach(pushM);

  listEl.innerHTML = pool.slice(0, 24).map((m) => {
    const active = m === current;
    return `<button type="button" data-quick-model="${escapeHtml(m)}" class="w-full text-left px-2 py-1.5 rounded-[6px] font-mono text-[11.5px] flex items-center justify-between gap-2 transition-colors ${active ? "bg-[var(--accent-soft,rgba(56,189,248,0.14))] text-[var(--accent)] font-semibold" : "text-[var(--text-secondary)] hover:bg-[var(--btn-hover-bg)] hover:text-[var(--text-primary)]"}">
      <span class="truncate">${escapeHtml(m)}</span>
      ${active ? '<span class="text-[10px] shrink-0">✓</span>' : ""}
    </button>`;
  }).join("");
  listEl.querySelectorAll("[data-quick-model]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetModel = btn.getAttribute("data-quick-model");
      if (targetModel) selectAgentQuickModel(targetModel);
    });
  });
}

function toggleAgentQuickModelMenu(event) {
  if (event) event.stopPropagation();
  const pop = document.getElementById("agent-quick-model-popover");
  if (!pop) return;
  const willOpen = pop.classList.contains("hidden");
  if (willOpen) {
    renderAgentQuickModelList();
    pop.classList.remove("hidden");
  } else {
    pop.classList.add("hidden");
  }
}

async function selectAgentQuickModel(modelId) {
  const m = String(modelId || "").trim();
  if (!m) return;
  closeAgentQuickModelMenu();
  state.config.llm_model = m;
  renderAgentModelPill();
  const customInput = document.getElementById("settings-llm-model-custom");
  if (customInput) customInput.value = m;
  const lbl = document.getElementById("llm-model-select-label");
  if (lbl) lbl.textContent = m;
  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_model: m }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.config) state.config = data.config;
      renderAgentModelPill();
      showToast(`已切换 Agent 模型：${m}`);
    }
  } catch (e) {
    showToast("切换模型失败：" + e.message);
  }
}

async function refreshAgentQuickModels(event) {
  if (event) event.stopPropagation();
  const btn = event?.currentTarget;
  if (btn) { btn.disabled = true; btn.textContent = "拉取中..."; }
  try {
    const res = await fetch("/api/llm/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "拉取失败");
    const list = data.recommended?.length ? data.recommended : (data.all_models || []);
    if (list.length) {
      state.llmModels = list;
      renderAgentQuickModelList();
      showToast(`已获取 ${list.length} 个可用模型`);
    } else {
      showToast("未返回模型列表，可手动在配置中输入 Model ID");
    }
  } catch (e) {
    showToast(e.message || "拉取模型失败，请先配置 LLM API");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "↻ 拉取列表"; }
  }
}

document.addEventListener("click", (ev) => {
  const pop = document.getElementById("agent-quick-model-popover");
  const pill = document.getElementById("agent-model-pill");
  if (!pop || pop.classList.contains("hidden")) return;
  if (!pop.contains(ev.target) && (!pill || !pill.contains(ev.target))) {
    pop.classList.add("hidden");
  }
});

function syncAgentDockClasses() {
  const win = document.getElementById("agent-window");
  const dockBtn = document.getElementById("agent-dock-btn");
  const dockIcon = document.getElementById("agent-dock-icon-use");
  if (!win) return;
  const isDocked = Boolean(agentState.docked);
  win.classList.toggle("is-docked", isDocked);
  document.body.classList.toggle("agent-docked-open", Boolean(agentState.open && isDocked));
  if (dockBtn) {
    dockBtn.classList.toggle("is-active", isDocked);
    dockBtn.setAttribute("title", isDocked ? "切换为独立可移动悬浮窗" : "停靠至右侧边栏（不遮挡画布）");
  }
  if (dockIcon) {
    dockIcon.setAttribute("href", isDocked ? "#ic-float-win" : "#ic-dock-right");
  }
}

function toggleAgentDockMode(force) {
  const next = typeof force === "boolean" ? force : !agentState.docked;
  agentState.docked = next;
  if (next && agentState.minimized) {
    toggleMinimizeAgentWindow(false);
  }
  syncAgentDockClasses();
  if (!next && agentState.open) {
    clampAgentWindowToViewport();
  }
  saveAgentWindowGeometry();
  window.dispatchEvent(new Event("resize"));
}

function toggleAgentWindow(force) {
  const win = document.getElementById("agent-window");
  const btn = document.getElementById("toggle-agent-btn");
  if (!win) return;
  const next = typeof force === "boolean" ? force : win.classList.contains("hidden");
  agentState.open = next;
  win.classList.toggle("hidden", !next);
  if (btn) {
    btn.classList.toggle("is-active", next);
    btn.setAttribute("aria-pressed", String(next));
  }
  syncAgentDockClasses();
  if (next) {
    if (!agentState.docked) clampAgentWindowToViewport();
    renderAgentModelPill();
    refreshAgentLiveStrip();
    setTimeout(() => document.getElementById("agent-input")?.focus(), 40);
  }
  window.dispatchEvent(new Event("resize"));
}

function toggleMinimizeAgentWindow(force) {
  if (agentState.docked) {
    toggleAgentWindow(false);
    return;
  }
  const win = document.getElementById("agent-window");
  const body = document.getElementById("agent-body-wrap");
  const grip = document.getElementById("agent-resize-handle");
  if (!win || !body) return;
  const next = typeof force === "boolean" ? force : !agentState.minimized;
  agentState.minimized = next;
  win.classList.toggle("is-minimized", next);
  body.classList.toggle("hidden", next);
  grip?.classList.toggle("hidden", next);
}

function toggleAgentSubPane(pane) {
  if (agentState.activePane === pane) {
    switchAgentPane("chat");
  } else {
    switchAgentPane(pane);
  }
}

function switchAgentPane(pane = "chat") {
  agentState.activePane = pane;
  ["chat", "sessions", "skills", "memory"].forEach(p => {
    document.getElementById(`agent-pane-${p}`)?.classList.toggle("hidden", p !== pane);
  });
  // Context telemetry strip is ONLY shown in chat view, never cluttering sessions, skills or memory
  document.getElementById("agent-live-strip")?.classList.toggle("hidden", pane !== "chat");
  document.querySelectorAll(".agent-icon-btn[data-agent-tab]").forEach(btn => {
    const act = btn.dataset.agentTab === pane;
    btn.classList.toggle("is-active", act);
    btn.setAttribute("aria-pressed", String(act));
  });
  if (pane === "sessions") fetchAndRenderAgentSessions();
  if (pane === "skills") {
    closeSkillEditor();
    fetchAndRenderAgentSkills();
  }
  if (pane === "memory") fetchAndRenderAgentMemory();
}

function toggleAgentMode() {
  agentState.mode = agentState.mode === "ask" ? "agent" : "ask";
  try {
    localStorage.setItem("nai_studio_agent_mode", agentState.mode);
  } catch (e) {}
  renderAgentModeButton();
  showToast(agentState.mode === "ask" ? "已切换为「咨询模式」（只读分析与方案卡，不改动工作台）" : "已切换为「协同模式」（可直接读写工作台与资源库）");
}

function renderAgentModeButton() {
  const btn = document.getElementById("agent-mode-toggle");
  const lbl = document.getElementById("agent-mode-label");
  if (!btn || !lbl) return;
  const isAsk = agentState.mode === "ask";
  lbl.textContent = isAsk ? "咨询" : "协同";
  btn.className = isAsk
    ? "spring-btn inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-[var(--status-warning-tint)] text-[var(--status-warning)] border border-[var(--border-control)] transition-colors shrink-0 whitespace-nowrap"
    : "spring-btn inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium bg-[var(--accent-primary-tint)] text-[var(--accent-primary)] border border-[var(--accent-primary-border)] transition-colors shrink-0 whitespace-nowrap";
}

async function fetchAndRenderAgentMemory() {
  try {
    const res = await fetch("/api/agent/memory");
    if (!res.ok) return;
    const data = await res.json();
    agentState.memory = data.content || "";
    const ta = document.getElementById("agent-memory-textarea");
    if (ta) ta.value = agentState.memory;
    updateAgentMemoryCounter();
  } catch (e) {}
}

function updateAgentMemoryCounter() {
  const ta = document.getElementById("agent-memory-textarea");
  const cnt = document.getElementById("agent-memory-count");
  if (ta && cnt) cnt.textContent = `${ta.value.trim().length} 字`;
}

function appendMemoryQuickChip(ruleText) {
  const ta = document.getElementById("agent-memory-textarea");
  if (!ta || !ruleText) return;
  if (ta.value.includes(ruleText)) {
    showToast("该条偏好已在记忆本中");
    return;
  }
  const prefix = ta.value.trim() ? `${ta.value.trim()}\n` : "## 审美与创作偏好\n";
  ta.value = `${prefix}- ${ruleText}\n`;
  updateAgentMemoryCounter();
  ta.focus();
}

function clearAgentMemoryEditor() {
  const ta = document.getElementById("agent-memory-textarea");
  if (ta) ta.value = "";
  updateAgentMemoryCounter();
}

async function saveAgentMemoryFromEditor() {
  const ta = document.getElementById("agent-memory-textarea");
  const btn = document.getElementById("agent-memory-save-btn");
  if (!ta) return;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch("/api/agent/memory", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: ta.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "保存失败");
    agentState.memory = data.content || "";
    updateAgentMemoryCounter();
    showToast("已保存个人审美记忆本，将在所有会话中自动生效");
  } catch (err) {
    showToast(err.message || "保存记忆失败");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function compactCurrentAgentSession() {
  if (!agentState.sessionId || agentState.streaming) return;
  if (agentState.messages.length < 2) {
    showToast("当前对话较短，无需压缩");
    return;
  }
  const btn = document.getElementById("agent-compact-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "压缩中...";
  }
  try {
    const res = await fetch(`/api/agent/sessions/${encodeURIComponent(agentState.sessionId)}/compact`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "压缩失败");
    agentState.messages = [{ role: "assistant", content: data.summary || "已压缩会话上下文。" }];
    renderAgentMessages(true);
    showToast(`已将 ${data.before_count} 条历史消息压缩为阶段摘要`);
  } catch (err) {
    showToast(err.message || "压缩会话失败");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "压缩";
    }
  }
}

// ================= Window Drag, Resize & Geometry Persistence =================
function restoreAgentWindowGeometry() {
  const win = document.getElementById("agent-window");
  if (!win) return;
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_WIN_STORAGE_KEY) || "{}");
    if (typeof saved.docked === "boolean") {
      agentState.docked = saved.docked;
    } else {
      agentState.docked = true;
    }
    if (typeof saved.width === "number" && saved.width >= 340) win.style.width = `${saved.width}px`;
    if (typeof saved.height === "number" && saved.height >= 420) win.style.height = `${saved.height}px`;
    if (typeof saved.left === "number" && typeof saved.top === "number") {
      win.style.right = "auto";
      win.style.bottom = "auto";
      win.style.left = `${saved.left}px`;
      win.style.top = `${saved.top}px`;
    }
  } catch (e) {}
  syncAgentDockClasses();
}

function saveAgentWindowGeometry() {
  const win = document.getElementById("agent-window");
  if (!win) return;
  try {
    const prev = JSON.parse(localStorage.getItem(AGENT_WIN_STORAGE_KEY) || "{}");
    const patch = { ...prev, docked: Boolean(agentState.docked) };
    if (!win.classList.contains("hidden") && !agentState.docked) {
      const rect = win.getBoundingClientRect();
      patch.left = Math.round(rect.left);
      patch.top = Math.round(rect.top);
      patch.width = Math.round(rect.width);
      patch.height = Math.round(rect.height);
    }
    localStorage.setItem(AGENT_WIN_STORAGE_KEY, JSON.stringify(patch));
  } catch (e) {}
}

function clampAgentWindowToViewport() {
  const win = document.getElementById("agent-window");
  if (!win || win.classList.contains("hidden")) return;
  const rect = win.getBoundingClientRect();
  const maxW = Math.max(340, window.innerWidth - 16);
  const maxH = Math.max(420, window.innerHeight - 56);
  const w = Math.min(rect.width || 432, maxW);
  const h = Math.min(rect.height || 610, maxH);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
  const top = Math.max(48, Math.min(rect.top, window.innerHeight - (agentState.minimized ? 48 : h) - 8));
  win.style.right = "auto";
  win.style.bottom = "auto";
  win.style.width = `${w}px`;
  if (!agentState.minimized) win.style.height = `${h}px`;
  win.style.left = `${left}px`;
  win.style.top = `${top}px`;
}

function setupAgentWindowDragAndResize() {
  const win = document.getElementById("agent-window");
  const bar = document.getElementById("agent-titlebar");
  const grip = document.getElementById("agent-resize-handle");
  if (!win || !bar) return;

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;

  bar.addEventListener("pointerdown", e => {
    if (agentState.docked || e.button !== 0 || e.target.closest("button")) return;
    dragging = true;
    const rect = win.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    win.style.right = "auto";
    win.style.bottom = "auto";
    win.style.left = `${origLeft}px`;
    win.style.top = `${origTop}px`;
    bar.setPointerCapture?.(e.pointerId);
  });

  bar.addEventListener("pointermove", e => {
    if (!dragging) return;
    const rect = win.getBoundingClientRect();
    const nextLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, origLeft + (e.clientX - startX)));
    const nextTop = Math.max(46, Math.min(window.innerHeight - 44, origTop + (e.clientY - startY)));
    win.style.left = `${nextLeft}px`;
    win.style.top = `${nextTop}px`;
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    saveAgentWindowGeometry();
  };
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);

  if (grip) {
    let resizing = false;
    let rStartX = 0;
    let rStartY = 0;
    let origW = 432;
    let origH = 610;

    grip.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      resizing = true;
      const rect = win.getBoundingClientRect();
      rStartX = e.clientX;
      rStartY = e.clientY;
      origW = rect.width;
      origH = rect.height;
      win.style.right = "auto";
      win.style.bottom = "auto";
      win.style.left = `${rect.left}px`;
      win.style.top = `${rect.top}px`;
      grip.setPointerCapture?.(e.pointerId);
    });

    grip.addEventListener("pointermove", e => {
      if (!resizing) return;
      const rect = win.getBoundingClientRect();
      const maxW = Math.min(760, window.innerWidth - rect.left - 8);
      const maxH = window.innerHeight - rect.top - 8;
      const nextW = Math.max(340, Math.min(maxW, origW + (e.clientX - rStartX)));
      const nextH = Math.max(420, Math.min(maxH, origH + (e.clientY - rStartY)));
      win.style.width = `${nextW}px`;
      win.style.height = `${nextH}px`;
    });

    const endResize = () => {
      if (!resizing) return;
      resizing = false;
      saveAgentWindowGeometry();
    };
    grip.addEventListener("pointerup", endResize);
    grip.addEventListener("pointercancel", endResize);
  }

  window.addEventListener("resize", () => {
    if (agentState.open) clampAgentWindowToViewport();
  });
}

// ================= Real-Time Workbench Snapshot & Telemetry Strip =================
function collectLiveWorkbenchState() {
  if (state.promptWorkspaceMode === "classic") {
    syncClassicToStructured();
  }
  const artist = (document.getElementById("block-artist-input")?.value || "").trim();
  const character = (document.getElementById("block-character-input")?.value || "").trim();
  const lighting = (document.getElementById("block-lighting-input")?.value || "").trim();
  const negative = (document.getElementById("block-negative-input")?.value || document.getElementById("uc-input")?.value || "").trim();
  const stageImg = document.getElementById("stage-img");
  const hasStage = Boolean((state.stageImageUrl || state.stageImageB64) && stageImg && !stageImg.classList.contains("hidden"));
  const lint = state.lastLintResult || {};

  return {
    model: state.currentModel || "nai-diffusion-5-full",
    model_short: state.models?.[state.currentModel]?.short_name || "V5 Full",
    prompt_mode: state.promptWorkspaceMode || "classic",
    action: state.action || "generate",
    width: state.width || 832,
    height: state.height || 1216,
    steps: state.steps || 28,
    scale: state.scale || 5.0,
    cfg_rescale: state.cfg_rescale || 0.0,
    sampler: state.sampler || "k_euler_ancestral",
    scheduler: state.scheduler || "karras",
    seed: Number(document.getElementById("seed-input")?.value || 0),
    opus_free_guard: state.config?.opus_free_guard !== false,
    stage_has_image: hasStage,
    stage_image_url: hasStage ? state.stageImageUrl || "" : "",
    stage_image_b64: hasStage && !state.stageImageUrl && state.stageImageB64 ? state.stageImageB64 : "",
    blocks: { artist, character, lighting, negative },
    prompt: document.getElementById("prompt-input")?.value || "",
    uc: document.getElementById("uc-input")?.value || "",
    lint_issue_count: lint.issue_count || 0,
    lint_issues: (lint.issues || []).map(x => ({ message: x.message, severity: x.severity, replacement: x.replacement })),
  };
}

function refreshAgentLiveStrip() {
  const telEl = document.getElementById("agent-live-telemetry");
  const btnEl = document.getElementById("agent-live-audit-btn");
  const topDot = document.getElementById("agent-topbar-dot");
  renderAgentModelPill();
  if (!telEl) return;

  const aCnt = parsePromptSegments(document.getElementById("block-artist-input")?.value || "").length;
  const cCnt = parsePromptSegments(document.getElementById("block-character-input")?.value || "").length;
  const lCnt = parsePromptSegments(document.getElementById("block-lighting-input")?.value || "").length;
  const nCnt = parsePromptSegments(document.getElementById("block-negative-input")?.value || document.getElementById("uc-input")?.value || "").length;
  const mShort = state.models?.[state.currentModel]?.short_name || "V5 Full";
  const actMap = { generate: "文生图", img2img: "图生图", infill: "重绘", outpaint: "扩图" };
  telEl.textContent = `${mShort} (${actMap[state.action] || "文生图"}) · 画${aCnt} / 人${cCnt} / 光${lCnt} / 负${nCnt}`;

  const issueCnt = state.lastLintResult?.issue_count || 0;
  if (topDot) {
    topDot.classList.toggle("hidden", issueCnt === 0 && !agentState.streaming);
    topDot.className = `w-1.5 h-1.5 rounded-full ${issueCnt > 0 ? "bg-[var(--status-warning)]" : "bg-[var(--status-success)]"}`;
  }
  if (btnEl) {
    if (issueCnt > 0) {
      btnEl.textContent = `${issueCnt}处问题 · 修复`;
      btnEl.className = "spring-btn px-2 py-0.5 rounded-[5px] text-[11px] font-medium text-[var(--status-warning)] bg-[var(--status-warning-tint)] hover:opacity-90 transition-opacity shrink-0 whitespace-nowrap";
    } else {
      btnEl.textContent = "体检";
      btnEl.className = "spring-btn px-2 py-0.5 rounded-[5px] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--btn-hover-bg)] transition-colors shrink-0 whitespace-nowrap";
    }
  }
}

// ================= Bidirectional Live UI Action Dispatcher & Undo =================
function snapshotCurrentPrompts() {
  const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  agentState.undoSnapshots[id] = {
    artist: document.getElementById("block-artist-input")?.value || "",
    character: document.getElementById("block-character-input")?.value || "",
    lighting: document.getElementById("block-lighting-input")?.value || "",
    negative: document.getElementById("block-negative-input")?.value || "",
    prompt: document.getElementById("prompt-input")?.value || "",
    uc: document.getElementById("uc-input")?.value || "",
  };
  return id;
}

function undoAgentPromptPatch(snapId) {
  const snap = agentState.undoSnapshots[snapId];
  if (!snap) {
    showToast("该历史快照已过期");
    return;
  }
  const aEl = document.getElementById("block-artist-input");
  const cEl = document.getElementById("block-character-input");
  const lEl = document.getElementById("block-lighting-input");
  const nEl = document.getElementById("block-negative-input");
  if (aEl) aEl.value = snap.artist;
  if (cEl) cEl.value = snap.character;
  if (lEl) lEl.value = snap.lighting;
  if (nEl) nEl.value = snap.negative;
  syncStructuredToClassic();
  showToast("已撤回 Agent 对提示词的该次修改");
}

function flashPromptBlockCard(blockKey) {
  const card = document.getElementById(`block-card-${blockKey}`);
  const classicWrap = document.getElementById(blockKey === "negative" ? "uc-editor-wrap" : "prompt-editor-wrap");
  [card, classicWrap].forEach(el => {
    if (!el) return;
    el.classList.remove("block-agent-flash");
    void el.offsetWidth;
    el.classList.add("block-agent-flash");
  });
}

function applyAgentUiAction(action) {
  if (!action || !action.type) return null;
  const p = action.payload || {};

  if (action.type === "patch_prompt_blocks") {
    if (state.promptWorkspaceMode === "classic") {
      syncClassicToStructured();
    }
    const snapId = snapshotCurrentPrompts();
    const blocks = p.blocks || {};
    ["artist", "character", "lighting", "negative"].forEach(k => {
      if (k in blocks && blocks[k] !== undefined) {
        const el = document.getElementById(`block-${k}-input`);
        if (el) el.value = blocks[k];
        flashPromptBlockCard(k);
      }
    });
    syncStructuredToClassic();
    refreshAgentLiveStrip();
    return { snapId, added: p.added || [], removed: p.removed || [], summary: action.summary };
  }

  if (action.type === "set_workbench_params") {
    if (p.model && state.models?.[p.model]) {
      selectModel(p.model, false);
    }
    if (typeof p.width === "number" && typeof p.height === "number") {
      const guardOn = state.config?.opus_free_guard !== false;
      if (!guardOn || p.width * p.height <= 1048576) {
        state.width = p.width;
        state.height = p.height;
        renderResolutionButtons();
      }
    }
    if (typeof p.steps === "number") {
      const guardOn = state.config?.opus_free_guard !== false;
      state.steps = guardOn ? Math.min(28, Math.max(1, p.steps)) : Math.min(50, Math.max(1, p.steps));
      const el = document.getElementById("steps-val");
      if (el) el.textContent = String(state.steps);
    }
    if (typeof p.scale === "number") {
      state.scale = Math.max(1.0, Math.min(10.0, Number(p.scale)));
      const el = document.getElementById("scale-val");
      if (el) el.textContent = state.scale.toFixed(1);
    }
    if (typeof p.cfg_rescale === "number") {
      state.cfg_rescale = Math.max(0.0, Math.min(1.0, Number(p.cfg_rescale)));
      const el = document.getElementById("rescale-val");
      if (el) el.textContent = state.cfg_rescale.toFixed(2);
    }
    if (p.sampler) selectSampler(p.sampler);
    if (p.scheduler) selectScheduler(p.scheduler);
    if (typeof p.seed === "number") {
      const sIn = document.getElementById("seed-input");
      if (sIn) sIn.value = String(Math.max(0, Math.floor(p.seed)));
    }
    if (typeof p.variety_plus === "boolean" && p.variety_plus !== state.varietyPlus) {
      toggleVarietyPlus();
    }
    if (typeof p.alpha_transparency === "boolean" && p.alpha_transparency !== state.alphaTransparency) {
      toggleAlphaTransparency();
    }
    if (typeof p.auto_quality === "boolean" && p.auto_quality !== state.autoQuality) {
      toggleAutoQuality();
    }
    if (typeof p.batch_count === "number") {
      setBatchCount(p.batch_count);
    }
    if (typeof updateStageInfoPill === "function") updateStageInfoPill();
    updateCostEstimate();
    refreshAgentLiveStrip();
    return { summary: action.summary };
  }

  if (action.type === "set_workbench_mode") {
    switchTab("workbench");
    if (p.action) setWorkbenchAction(p.action);
    if (typeof p.i2i_strength === "number") {
      const sEl = document.getElementById("i2i-strength");
      const vEl = document.getElementById("i2i-strength-val");
      if (sEl) sEl.value = String(p.i2i_strength);
      if (vEl) vEl.textContent = String(p.i2i_strength);
    }
    if (p.outpaint_direction) {
      setOutpaintDir(p.outpaint_direction);
    }
    refreshAgentLiveStrip();
    return { summary: action.summary };
  }

  if (action.type === "load_oc_character") {
    const card = p.card;
    if (card) {
      const snapId = snapshotCurrentPrompts();
      if (p.apply_to_character_block !== false) {
        const cEl = document.getElementById("block-character-input");
        if (cEl) cEl.value = card.prompt || "";
        flashPromptBlockCard("character");
        syncStructuredToClassic();
        refreshAgentLiveStrip();
      }
      return { snapId, added: parsePromptSegments(card.prompt || "").slice(0, 6), removed: [], summary: action.summary };
    }
  }

  if (action.type === "run_director_tool") {
    switchTab("workbench");
    setTimeout(() => {
      runDirectorTool(p.req_type || "lineart", {
        emotion: p.emotion || "happy",
        defry: p.defry ?? 0,
        prompt: p.prompt || "",
      });
    }, 60);
    return { summary: action.summary };
  }

  if (action.type === "trigger_generate_image") {
    switchTab("workbench");
    setTimeout(() => triggerGenerate(), 80);
    return { summary: action.summary };
  }

  if (action.type === "refresh_artists") {
    fetch("/api/artists")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.artists)) {
          state.artists = data.artists;
          if (typeof renderArtistCatPills === "function") renderArtistCatPills();
          if (typeof renderArtistModalCatSelect === "function") renderArtistModalCatSelect();
          if (typeof renderArtistsGrid === "function") renderArtistsGrid();
        }
        if (p.generate_preview_artist_id && typeof generateArtistCard === "function") {
          setTimeout(() => generateArtistCard(p.generate_preview_artist_id, p.model || "nai-diffusion-4-5-full"), 120);
        } else if (p.backfill_missing && typeof startArtistBackfillQueue === "function") {
          setTimeout(() => startArtistBackfillQueue(p.model || "nai-diffusion-4-5-full"), 120);
        }
      })
      .catch(() => {});
    return { summary: action.summary };
  }

  if (action.type === "refresh_mix_presets") {
    fetch("/api/mix-presets")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.presets)) {
          state.mixPresets = data.presets;
          if (typeof renderMixPresets === "function") renderMixPresets();
        }
      })
      .catch(() => {});
    return { summary: action.summary };
  }

  if (action.type === "refresh_gallery") {
    fetch("/api/gallery?limit=24&offset=0&sort=newest")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.items)) {
          state.gallery = data.items;
          state.galleryTotal = Number(data.total ?? data.items.length);
          if (typeof renderStorageBadges === "function") renderStorageBadges();
          if (typeof renderWorkbenchHistory === "function") renderWorkbenchHistory();
        }
        if (typeof renderFullGallery === "function") renderFullGallery(true);
      })
      .catch(() => {});
    return { summary: action.summary };
  }

  if (action.type === "load_gallery_item") {
    if (p.item && typeof setStageFromGalleryItem === "function") {
      setStageFromGalleryItem(p.item, true);
      switchTab("workbench");
      refreshAgentLiveStrip();
    }
    return { summary: action.summary };
  }

  if (action.type === "refresh_memory") {
    if (typeof p.memory === "string") {
      agentState.memory = p.memory;
      const ta = document.getElementById("agent-memory-textarea");
      if (ta) {
        ta.value = p.memory;
        updateAgentMemoryCounter();
      }
    }
    showToast(action.summary || "已更新个人审美记忆本");
    return { summary: action.summary };
  }

  if (action.type === "refresh_oc_cards") {
    fetch("/api/oc-cards")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.cards)) {
          state.ocCards = data.cards;
          if (typeof renderOcCardsList === "function") renderOcCardsList();
          if (typeof renderCharacterSlots === "function") renderCharacterSlots();
        }
      })
      .catch(() => {});
    return { summary: action.summary };
  }

  if (action.type === "run_xyz_matrix") {
    if (typeof toggleXyzModal === "function") toggleXyzModal(true);
    const xt = document.getElementById("xyz-x-type");
    const xv = document.getElementById("xyz-x-values");
    const yt = document.getElementById("xyz-y-type");
    const yv = document.getElementById("xyz-y-values");
    if (xt && p.x_type) xt.value = p.x_type;
    if (xv && p.x_values !== undefined) xv.value = p.x_values;
    if (yt && p.y_type) yt.value = p.y_type;
    if (yv && p.y_values !== undefined) yv.value = p.y_values;
    if (typeof updateXyzPreview === "function") updateXyzPreview();
    return { summary: action.summary };
  }

  return { summary: action.summary };
}

// ================= Chat Stream Rendering & Rich Editorial Markdown =================
function copyAgentCodeTag(el) {
  const txt = el?.textContent?.trim() || "";
  if (!txt) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(txt).then(() => {
      showToast(`已复制标签: ${txt.slice(0, 36)}`);
    }).catch(() => {});
  }
}

function formatAgentInline(raw) {
  let s = escapeHtml(String(raw || ""));
  s = s.replace(/`([^`\n]+)`/g, '<code onclick="copyAgentCodeTag(this)" title="点击复制">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return s;
}

function formatAgentMarkdown(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!src) return "";
  const lines = src.split("\n");
  const out = [];
  let listType = null; // "ul" | "ol"
  let inCodeBlock = false;
  let codeLines = [];
  let tableRows = [];

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const flushTable = () => {
    if (!tableRows.length) return;
    const rows = tableRows.map(r =>
      r
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(c => c.trim())
    );
    const hasSep = rows.length >= 2 && rows[1].every(c => /^:?-{2,}:?$/.test(c));
    let html = '<div class="agent-table-wrap"><table>';
    if (hasSep) {
      html += `<thead><tr>${rows[0].map(c => `<th>${formatAgentInline(c)}</th>`).join("")}</tr></thead><tbody>`;
      for (let i = 2; i < rows.length; i++) {
        html += `<tr>${rows[i].map(c => `<td>${formatAgentInline(c)}</td>`).join("")}</tr>`;
      }
      html += "</tbody>";
    } else {
      html += "<tbody>";
      for (const r of rows) {
        html += `<tr>${r.map(c => `<td>${formatAgentInline(c)}</td>`).join("")}</tr>`;
      }
      html += "</tbody>";
    }
    html += "</table></div>";
    out.push(html);
    tableRows = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      closeList();
      flushTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLines = [];
      } else {
        inCodeBlock = false;
        out.push(
          `<div class="my-1.5 p-2.5 rounded-[8px] bg-[var(--code-block-bg)] border border-[var(--border-hairline)] overflow-x-auto"><code class="!bg-transparent !border-0 !p-0 block whitespace-pre-wrap" onclick="copyAgentCodeTag(this)" title="点击复制代码块">${escapeHtml(codeLines.join("\n"))}</code></div>`
        );
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }
    if (/^\|.+\|$/.test(trimmed)) {
      closeList();
      tableRows.push(trimmed);
      continue;
    }
    flushTable();
    if (!trimmed) {
      closeList();
      continue;
    }
    if (/^[-*_]{3,}$/.test(trimmed)) {
      closeList();
      out.push("<hr/>");
      continue;
    }
    const hMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (hMatch) {
      closeList();
      out.push(`<h4>${formatAgentInline(hMatch[1])}</h4>`);
      continue;
    }
    const ulMatch = trimmed.match(/^[-*•]\s+(.+)$/);
    if (ulMatch) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${formatAgentInline(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${formatAgentInline(olMatch[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${formatAgentInline(trimmed)}</p>`);
  }

  if (inCodeBlock && codeLines.length) {
    out.push(
      `<div class="my-1.5 p-2.5 rounded-[8px] bg-[var(--code-block-bg)] border border-[var(--border-hairline)] overflow-x-auto"><code class="!bg-transparent !border-0 !p-0 block whitespace-pre-wrap" onclick="copyAgentCodeTag(this)" title="点击复制代码块">${escapeHtml(codeLines.join("\n"))}</code></div>`
    );
  }
  flushTable();
  closeList();
  return `<div class="agent-prose">${out.join("")}</div>`;
}

function applyAgentProposal(pid, andGenerate = false) {
  const item = agentState.proposalCache[pid];
  if (!item) return;
  const snapId = snapshotCurrentPrompts();
  const blocks = {};
  if (item.artist) blocks.artist = item.artist;
  if (item.character) blocks.character = item.character;
  if (item.lighting) blocks.lighting = item.lighting;
  if (item.negative) blocks.negative = item.negative;
  if (Object.keys(blocks).length) {
    applyAgentUiAction({ type: "patch_prompt_blocks", summary: `套用方案「${item.title}」`, payload: { mode: "replace", blocks } });
  }
  const params = {};
  if (item.scale !== undefined && item.scale !== null) params.scale = item.scale;
  if (item.steps !== undefined && item.steps !== null) params.steps = item.steps;
  if (Object.keys(params).length) {
    applyAgentUiAction({ type: "set_workbench_params", summary: "同步方案参数", payload: params });
  }
  showToast(`已套用方案「${item.title}」${andGenerate ? "，开始生图..." : ""}`);
  if (andGenerate && typeof triggerGenerate === "function") {
    setTimeout(() => triggerGenerate(), 80);
  }
}

function renderDiffActionCard(uiAct) {
  const p = uiAct.payload || {};
  if (uiAct.type === "proposals" && Array.isArray(p.proposals) && p.proposals.length) {
    const cards = p.proposals
      .map((prop, i) => {
        const pid = `prop_${i}_${(prop.title || "").slice(0, 12)}_${(prop.artist || "").length}_${(prop.character || "").length}`;
        agentState.proposalCache[pid] = prop;
        const previewTags = [prop.artist, prop.character, prop.lighting].filter(Boolean).join(", ");
        return `
        <div class="p-2.5 rounded-[9px] border border-[var(--border-control)] bg-[var(--surface-panel-alt)] space-y-1.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-semibold text-[12px] text-[var(--text-primary)]">${escapeHtml(prop.title)}</div>
              ${prop.subtitle ? `<div class="text-[11px] text-[var(--text-secondary)] mt-0.5">${escapeHtml(prop.subtitle)}</div>` : ""}
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" onclick="applyAgentProposal('${escapeHtml(pid)}', false)" class="spring-btn px-2 py-0.5 rounded-[5px] ui-btn text-[11px] font-medium">试套用</button>
              <button type="button" onclick="applyAgentProposal('${escapeHtml(pid)}', true)" class="spring-btn px-2 py-0.5 rounded-[5px] ui-btn-accent text-[11px] font-medium">套用生图</button>
            </div>
          </div>
          ${previewTags ? `<div class="font-mono text-[10.5px] text-[var(--text-muted)] line-clamp-2 bg-[var(--code-block-bg)] rounded-[5px] px-2 py-1">${escapeHtml(previewTags)}</div>` : ""}
        </div>`;
      })
      .join("");
    return `<div class="space-y-1.5 mt-1">${cards}</div>`;
  }
  const added = Array.isArray(p.added) ? p.added : [];
  const removed = Array.isArray(p.removed) ? p.removed : [];
  const snapId = uiAct._snapId || "";
  if (uiAct.type === "patch_prompt_blocks" || added.length || removed.length) {
    return `
      <div class="agent-diff-box mt-1">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0"></span>
            <span class="font-semibold text-[12px] text-[var(--text-primary)] truncate">${escapeHtml(uiAct.summary || "已同步更新工作台提示词")}</span>
          </div>
          ${snapId ? `<button type="button" onclick="undoAgentPromptPatch('${escapeHtml(snapId)}')" class="spring-btn inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] ui-btn text-[11px] font-medium text-[var(--text-primary)] shrink-0" title="一键回滚本次提示词修改"><svg class="ui-ic-sm ui-ic" aria-hidden="true"><use href="#ic-undo"/></svg><span>一键撤回</span></button>` : ""}
        </div>
        ${added.length ? `<div class="agent-diff-line-add">+ ${escapeHtml(added.join(", "))}</div>` : ""}
        ${removed.length ? `<div class="agent-diff-line-del">− ${escapeHtml(removed.join(", "))}</div>` : ""}
      </div>
    `;
  }
  return `
    <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-subgroup)] text-[11.5px] font-medium text-[var(--text-primary)] mt-1">
      <svg class="w-3.5 h-3.5 text-[var(--status-success)] shrink-0 stroke-current fill-none" stroke-width="2" viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-check"/></svg>
      <span>${escapeHtml(uiAct.summary || uiAct.type)}</span>
    </div>
  `;
}

function _fmtDurationMs(ms) {
  if (typeof ms !== "number" || ms <= 0) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const AGENT_TOOL_LABELS = {
  read_skill: "读取创作技能",
  search_artist_catalog: "检索本地画师库",
  search_danbooru_tags: "检索标签词典",
  lookup_danbooru_character: "Danbooru 角色考据",
  lookup_danbooru_artists: "Danbooru 画师情报",
  list_oc_and_snippets: "读取 OC 与词条库",
  query_gallery: "检索作品图库",
  get_current_model_rules: "读取模型规范",
  validate_and_lint_prompt: "语法与权重体检",
  patch_prompt_blocks: "写入四区块提示词",
  remove_prompt_tags: "精简移除标签",
  set_workbench_params: "调整工作台参数",
  set_workbench_mode: "切换画布模式",
  load_oc_character: "载入 OC 角色卡",
  save_oc_character: "保存 OC 角色卡",
  run_director_tool: "执行 Director 后处理",
  run_xyz_matrix: "预填 X/Y 参数矩阵",
  trigger_generate_image: "触发工作台出图",
  manage_artist_catalog: "维护本地画师库",
  manage_mix_presets: "管理画师混搭预设",
  manage_gallery_items: "整理作品图库",
  inspect_artist_previews: "视觉分析画师预览",
  inspect_canvas_stage: "视觉诊断当前画布",
  inspect_gallery_images: "视觉对比图库作品",
  update_creator_memory: "更新个人审美记忆",
  present_creative_proposals: "生成灵感方案卡片",
};

function _friendlyToolLabel(name) {
  return AGENT_TOOL_LABELS[name] || name;
}

function renderToolTimelineHtml(events, activeTools = [], isActiveTurn = false, existingOpen = null) {
  const list = Array.isArray(events) ? events : [];
  const runningList = Array.isArray(activeTools) ? activeTools : [];
  if (!list.length && !runningList.length && !isActiveTurn) return "";
  const count = list.length + runningList.length;
  const activeStep = runningList[runningList.length - 1];
  const latest = activeStep
    ? `正在执行 · ${_friendlyToolLabel(activeStep.name)}`
    : list.length
    ? list[list.length - 1].summary || _friendlyToolLabel(list[list.length - 1].name)
    : "正在分析工作台与创作上下文...";
  const label = isActiveTurn
    ? `<span class="inline-flex items-center gap-2 min-w-0"><span class="agent-orbital-spinner" aria-hidden="true"></span><span class="agent-shimmer-text font-medium truncate">${escapeHtml(latest)}</span></span>`
    : `<span class="truncate">已执行 ${list.length} 项步骤 · ${escapeHtml(latest)}</span>`;

  const doneStepsHtml = list
    .map(t => {
      const dur = _fmtDurationMs(t.duration_ms);
      return `
      <div class="agent-timeline-step ${t.ok !== false ? "is-ok" : ""}">
        <span class="truncate">${escapeHtml(t.summary || _friendlyToolLabel(t.name))}</span>
        <span class="text-[10.5px] ${t.ok !== false ? "text-[var(--text-muted)]" : "text-[var(--status-warning)]"} shrink-0">${dur ? `${dur} · ` : ""}${t.ok !== false ? "完成" : "提示"}</span>
      </div>
    `;
    })
    .join("");

  const runningStepsHtml = runningList
    .map(
      t => `
      <div class="agent-timeline-step is-running">
        <span class="agent-shimmer-text truncate">${escapeHtml(_friendlyToolLabel(t.name))}...</span>
        <span class="text-[10.5px] text-[var(--accent-primary)] shrink-0">执行中</span>
      </div>
    `
    )
    .join("");

  const isOpen = existingOpen !== null ? existingOpen : isActiveTurn;
  return `
    <details class="agent-timeline ${isActiveTurn ? "is-active" : ""}" ${isOpen ? "open" : ""}>
      <summary>
        <div class="flex items-center gap-1.5 min-w-0">
          <svg class="w-3.5 h-3.5 agent-timeline-chevron text-[var(--text-muted)] shrink-0 stroke-current fill-none" stroke-width="1.8" viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-chevron-right"/></svg>
          ${label}
        </div>
        ${count ? `<span class="font-mono text-[10.5px] text-[var(--text-muted)] shrink-0">${count}</span>` : ""}
      </summary>
      ${doneStepsHtml || runningStepsHtml ? `<div class="agent-timeline-steps">${doneStepsHtml}${runningStepsHtml}</div>` : ""}
    </details>
  `;
}

function renderReasoningBlockHtml(reasoning, isActiveTurn = false, hasContent = false, existingOpen = null) {
  const txt = String(reasoning || "").trim();
  if (!txt) return "";
  const isThinkingNow = isActiveTurn && !hasContent;
  const isOpen = existingOpen !== null ? existingOpen : isThinkingNow;
  return `
    <details class="agent-reasoning ${isThinkingNow ? "is-thinking" : ""}" ${isOpen ? "open" : ""}>
      <summary>
        ${isThinkingNow ? '<span class="agent-orbital-spinner" aria-hidden="true"></span>' : ""}
        <span class="${isThinkingNow ? "agent-shimmer-text font-medium" : ""}">${isThinkingNow ? `深度思考中 · ${txt.length} 字` : `已思考 (${txt.length} 字)`}</span>
      </summary>
      <div class="agent-reasoning-body custom-scroll">${escapeHtml(txt)}</div>
    </details>
  `;
}

function renderUsageFooterHtml(m) {
  const parts = [];
  if (m.usage && (m.usage.prompt_tokens || m.usage.total_tokens)) {
    const used = Number(m.usage.total_tokens || m.usage.prompt_tokens || 0);
    const budget = Number(m.context_budget || 100000);
    const usedK = used >= 1000 ? `${(used / 1000).toFixed(1)}K` : `${used}`;
    const budgetK = `${Math.round(budget / 1000)}K`;
    parts.push(`${usedK} / ${budgetK} tokens`);
  }
  if (m.elapsed_ms) {
    parts.push(_fmtDurationMs(m.elapsed_ms));
  }
  if (!parts.length) return "";
  return `<div class="agent-usage-footer">${escapeHtml(parts.join(" · "))}</div>`;
}

function renderSingleMessageInner(m, idx, totalLen, domState = {}) {
  if (m.role === "user") {
    const imgsHtml =
      Array.isArray(m.attachments) && m.attachments.length
        ? `<div class="flex flex-wrap gap-1.5 mb-1.5">${m.attachments
            .map(a => `<img src="${a.data_url}" alt="${escapeHtml(a.name || "参考图")}" class="w-14 h-14 rounded-[6px] object-cover border border-[var(--border-control)]" />`)
            .join("")}</div>`
        : "";
    return `${imgsHtml}${escapeHtml(m.content)}`;
  }
  const isStreamingThis = agentState.streaming && idx === totalLen - 1;
  const timelineHtml = renderToolTimelineHtml(
    m.tool_events,
    isStreamingThis ? m._activeTools || [] : [],
    isStreamingThis && !m.content,
    domState.timelineOpen ?? null
  );
  const reasoningHtml = renderReasoningBlockHtml(
    m.reasoning,
    isStreamingThis,
    Boolean(m.content),
    domState.reasoningOpen ?? null
  );
  const actionsHtml = (m.ui_actions || []).map(a => renderDiffActionCard(a)).join("");
  const usageHtml = !isStreamingThis ? renderUsageFooterHtml(m) : "";
  return `
    ${reasoningHtml}
    ${timelineHtml}
    ${actionsHtml}
    ${m.content ? `<div>${formatAgentMarkdown(m.content)}</div>` : ""}
    ${usageHtml}
  `;
}

function scrollAgentToBottomIfNear(force = false) {
  const box = document.getElementById("agent-messages");
  if (!box) return;
  const dist = box.scrollHeight - box.scrollTop - box.clientHeight;
  if (force || dist < 90) {
    box.scrollTop = box.scrollHeight;
  }
}

function scheduleActiveAssistantRender(forceScroll = false) {
  if (agentState.rafRenderPending) return;
  agentState.rafRenderPending = true;
  requestAnimationFrame(() => {
    agentState.rafRenderPending = false;
    const box = document.getElementById("agent-messages");
    if (!box || !agentState.messages.length) return;
    const lastIdx = agentState.messages.length - 1;
    const el = box.querySelector(`[data-agent-msg-idx="${lastIdx}"]`);
    const m = agentState.messages[lastIdx];
    if (!el || !m || m.role !== "assistant") {
      renderAgentMessages(forceScroll);
      return;
    }
    const existingTimeline = el.querySelector("details.agent-timeline");
    const existingReasoning = el.querySelector("details.agent-reasoning");
    const domState = {
      timelineOpen: existingTimeline ? existingTimeline.open : null,
      reasoningOpen: existingReasoning ? existingReasoning.open : null,
    };
    el.innerHTML = renderSingleMessageInner(m, lastIdx, agentState.messages.length, domState);
    const rBody = el.querySelector(".agent-reasoning-body");
    if (rBody) rBody.scrollTop = rBody.scrollHeight;
    scrollAgentToBottomIfNear(forceScroll);
  });
}

function renderAgentMessages(forceScroll = false) {
  const box = document.getElementById("agent-messages");
  if (!box) return;
  const compactBtn = document.getElementById("agent-compact-btn");
  if (compactBtn) {
    compactBtn.classList.toggle("hidden", !agentState.sessionId || agentState.messages.length < 2);
  }

  if (!agentState.messages.length) {
    box.innerHTML = `
      <div class="py-4 px-0.5 space-y-4">
        <div class="space-y-1.5">
          <div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--accent-primary-tint)] text-[11px] font-medium text-[var(--accent-primary)]">
            <svg class="ui-ic-sm ui-ic" aria-hidden="true"><use href="#ic-sparkles"/></svg>
            <span>视觉创作导演 · 实时联动工作台</span>
          </div>
          <div class="font-semibold text-[15px] tracking-[-0.01em] text-[var(--text-primary)]">想画什么样的画面？</div>
          <p class="text-[12px] text-[var(--text-muted)] leading-relaxed">
            直接用日常语言描述角色、光影或画风偏好，我会检索本地画师库与 Danbooru 词表，实时同步至工作台并支持一键撤回。
          </p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" onclick="quickSendAgent('我现在没什么灵感，帮我构思 3 个风格反差鲜明的二次元画面方向吧')" class="spring-btn group p-3 rounded-[11px] ui-card text-left space-y-1.5 transition-all">
            <div class="w-7 h-7 rounded-[7px] bg-[var(--accent-primary-tint)] text-[var(--accent-primary)] flex items-center justify-center">
              <svg class="ui-ic" aria-hidden="true"><use href="#ic-sparkles"/></svg>
            </div>
            <div class="text-[12.5px] font-semibold text-[var(--text-primary)]">导演灵感访谈</div>
            <div class="text-[11px] text-[var(--text-muted)] leading-snug">提供 3 组反差视觉提案，一键拍板落地四区块</div>
          </button>
          <button type="button" onclick="quickSendAgent('给当前提示词加上微风吹起发丝、黄昏丁达尔逆光和梦幻散景光斑')" class="spring-btn group p-3 rounded-[11px] ui-card text-left space-y-1.5 transition-all">
            <div class="w-7 h-7 rounded-[7px] bg-[var(--status-success-tint)] text-[var(--status-success)] flex items-center justify-center">
              <svg class="ui-ic" aria-hidden="true"><use href="#ic-edit"/></svg>
            </div>
            <div class="text-[12.5px] font-semibold text-[var(--text-primary)]">大白话转译改词</div>
            <div class="text-[11px] text-[var(--text-muted)] leading-snug">自然语言秒转 V5/Danbooru 标签并增量写入</div>
          </button>
          <button type="button" onclick="quickSendAgent('帮我看一下当前中央画布里的图像哪里还可以优化，直接帮我改一版提示词或切到合适的模式')" class="spring-btn group p-3 rounded-[11px] ui-card text-left space-y-1.5 transition-all">
            <div class="w-7 h-7 rounded-[7px] bg-[var(--status-warning-tint)] text-[var(--status-warning)] flex items-center justify-center">
              <svg class="ui-ic" aria-hidden="true"><use href="#ic-image"/></svg>
            </div>
            <div class="text-[12.5px] font-semibold text-[var(--text-primary)]">看图诊断与修图</div>
            <div class="text-[11px] text-[var(--text-muted)] leading-snug">多模态审阅当前画布构图/光影并联动调优</div>
          </button>
          <button type="button" onclick="quickSendAgent('从我的本地画师库里挑 3 套不同氛围的高熟度画师混搭方案，告诉我各自特点')" class="spring-btn group p-3 rounded-[11px] ui-card text-left space-y-1.5 transition-all">
            <div class="w-7 h-7 rounded-[7px] bg-[var(--accent-primary-tint)] text-[var(--accent-primary)] flex items-center justify-center">
              <svg class="ui-ic" aria-hidden="true"><use href="#ic-layers"/></svg>
            </div>
            <div class="text-[12.5px] font-semibold text-[var(--text-primary)]">画师检索与混搭</div>
            <div class="text-[11px] text-[var(--text-muted)] leading-snug">按多维风格标签与熟度科学配比黄金权重</div>
          </button>
        </div>
      </div>
    `;
    return;
  }

  const totalLen = agentState.messages.length;
  box.innerHTML = agentState.messages
    .map((m, idx) => {
      if (m.role === "user") {
        return `<div data-agent-msg-idx="${idx}" class="agent-msg-user">${escapeHtml(m.content)}</div>`;
      }
      return `<div data-agent-msg-idx="${idx}" class="agent-msg-assistant space-y-2">${renderSingleMessageInner(m, idx, totalLen)}</div>`;
    })
    .join("");

  scrollAgentToBottomIfNear(forceScroll);
}

function renderQuickReplies(options = []) {
  const wrap = document.getElementById("agent-quick-replies");
  if (!wrap) return;
  if (!Array.isArray(options) || !options.length) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");
  wrap.innerHTML = options
    .map(
      opt => `
      <button type="button" onclick="quickSendAgent('${escapeHtml(opt)}')" class="spring-btn px-2.5 py-1 rounded-[6px] ui-btn text-[11.5px] text-[var(--text-primary)]">
        ${escapeHtml(opt)}
      </button>
    `
    )
    .join("");
}

function renderQueuedPromptChip() {
  const bar = document.getElementById("agent-queue-chip");
  const txt = document.getElementById("agent-queue-chip-text");
  if (!bar) return;
  const q = (agentState.queuedMessage || "").trim();
  bar.classList.toggle("hidden", !q);
  if (txt && q) txt.textContent = `排队下一条: ${q}`;
}

function clearQueuedAgentPrompt() {
  agentState.queuedMessage = "";
  renderQueuedPromptChip();
}

function quickSendAgent(text) {
  const clean = String(text || "").trim();
  if (!clean) return;
  if (!agentState.open) toggleAgentWindow(true);
  switchAgentPane("chat");
  if (agentState.streaming) {
    if (clean === agentState.activePromptText || clean === agentState.queuedMessage) {
      showToast("当前指令正在处理或已排队");
      return;
    }
    agentState.queuedMessage = clean;
    renderQueuedPromptChip();
    showToast("已加入下一条队列，将在本轮结束后自动发送");
    return;
  }
  sendAgentMessage(clean);
}

function abortAgentStream() {
  clearQueuedAgentPrompt();
  if (agentState.abortController) {
    agentState.abortController.abort();
  }
}

function setAgentStreamStatus(text, show = true) {
  const wrap = document.getElementById("agent-stream-status");
  const txt = document.getElementById("agent-stream-status-text");
  const dot = document.getElementById("agent-live-dot");
  if (dot) dot.classList.toggle("is-busy", Boolean(show));
  if (!wrap) return;
  wrap.classList.toggle("hidden", !show);
  if (txt && text !== undefined) txt.textContent = text;
}

function autoGrowAgentInput() {
  const inp = document.getElementById("agent-input");
  if (!inp) return;
  inp.style.height = "auto";
  inp.style.height = `${Math.min(120, Math.max(24, inp.scrollHeight))}px`;
}

function openAgentSlashQuick() {
  const inp = document.getElementById("agent-input");
  if (!inp) return;
  const val = inp.value;
  if (!/(?:^|\s)\/[a-zA-Z0-9_\-\u4e00-\u9fff]*$/.test(val)) {
    inp.value = val ? `${val.trimEnd()} /` : "/";
  }
  inp.focus();
  autoGrowAgentInput();
  handleAgentInputChange();
}

async function sendAgentMessage(overrideText = null) {
  const inp = document.getElementById("agent-input");
  const raw = typeof overrideText === "string" ? overrideText.trim() : (inp?.value || "").trim();
  const attachmentsToSend = typeof overrideText === "string" ? [] : [...agentState.pendingAttachments];
  const mentionsToSend = typeof overrideText === "string" ? [] : [...agentState.pendingMentions];
  if (!raw && !attachmentsToSend.length) return;

  if (agentState.streaming) {
    if (raw && raw !== agentState.activePromptText && raw !== agentState.queuedMessage) {
      agentState.queuedMessage = raw;
      if (typeof overrideText !== "string" && inp) {
        inp.value = "";
        autoGrowAgentInput();
      }
      renderQueuedPromptChip();
      showToast("已加入下一条队列，将在本轮完成后自动执行");
    }
    return;
  }

  if (typeof overrideText !== "string" && inp) {
    inp.value = "";
    autoGrowAgentInput();
    agentState.pendingAttachments = [];
    agentState.pendingMentions = [];
    renderAgentAttachmentsBar();
  }
  hideSlashMenu();
  renderQuickReplies([]);

  const displayRaw = raw || "请分析我附带的参考图并给出提示词建议";
  agentState.activePromptText = displayRaw;
  agentState.messages.push({ role: "user", content: displayRaw, attachments: attachmentsToSend });
  const assistantMsg = {
    role: "assistant",
    content: "",
    reasoning: "",
    tool_events: [],
    _activeTools: [],
    ui_actions: [],
  };
  agentState.messages.push(assistantMsg);

  agentState.streaming = true;
  const myAbort = new AbortController();
  agentState.abortController = myAbort;
  renderAgentMessages(true);

  const sendBtn = document.getElementById("agent-send-btn");
  const stopBtn = document.getElementById("agent-stop-btn");
  sendBtn?.classList.add("hidden");
  stopBtn?.classList.remove("hidden");
  setAgentStreamStatus(agentState.mode === "ask" ? "咨询模式分析中..." : "连接推理流...", true);
  refreshAgentLiveStrip();

  try {
    const res = await fetch("/api/agent/chat/stream", {
      method: "POST",
      signal: myAbort.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: displayRaw,
        session_id: agentState.sessionId,
        workbench_state: collectLiveWorkbenchState(),
        pinned_skills: agentState.pinnedSkills,
        agent_mode: agentState.mode,
        attachments: attachmentsToSend,
        mentions: mentionsToSend,
      }),
    });

    if (!res.ok || !res.body) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Agent 请求失败 (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;
        let ev = null;
        try {
          ev = JSON.parse(jsonStr);
        } catch (e) {
          continue;
        }
        handleAgentSseEvent(ev, assistantMsg);
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      assistantMsg._activeTools = [];
      assistantMsg.content += (assistantMsg.content ? "\n\n" : "") + "*[已停止生成]*";
    } else {
      assistantMsg._activeTools = [];
      assistantMsg.content = `请求失败：${err.message || "未知错误"}`;
      showToast(err.message || "Agent 请求失败");
    }
    scheduleActiveAssistantRender(true);
  } finally {
    if (agentState.abortController === myAbort) {
      agentState.streaming = false;
      agentState.abortController = null;
      agentState.activePromptText = "";
      assistantMsg._activeTools = [];
      sendBtn?.classList.remove("hidden");
      stopBtn?.classList.add("hidden");
      setAgentStreamStatus("", false);
      scheduleActiveAssistantRender();
      refreshAgentLiveStrip();
      const nextQueued = (agentState.queuedMessage || "").trim();
      if (nextQueued) {
        agentState.queuedMessage = "";
        renderQueuedPromptChip();
        setTimeout(() => sendAgentMessage(nextQueued), 60);
      }
    }
  }
}

function handleAgentSseEvent(ev, assistantMsg) {
  if (!ev || !ev.type) return;
  if (ev.type === "session") {
    agentState.sessionId = ev.session_id;
    return;
  }
  if (ev.type === "status") {
    setAgentStreamStatus(ev.text || "处理中...", true);
    return;
  }
  if (ev.type === "reasoning_delta") {
    assistantMsg.reasoning = (assistantMsg.reasoning || "") + (ev.text || "");
    setAgentStreamStatus("正在深度思考...", true);
    scheduleActiveAssistantRender();
    return;
  }
  if (ev.type === "tool_start") {
    assistantMsg._activeTools = assistantMsg._activeTools || [];
    assistantMsg._activeTools.push({ id: ev.id, name: ev.name });
    setAgentStreamStatus(`执行 ${ev.name}...`, true);
    scheduleActiveAssistantRender();
    return;
  }
  if (ev.type === "tool_result") {
    assistantMsg._activeTools = (assistantMsg._activeTools || []).filter(t => t.id !== ev.id && t.name !== ev.name);
    assistantMsg.tool_events.push({
      id: ev.id,
      name: ev.name,
      summary: ev.summary,
      ok: ev.ok,
      duration_ms: ev.duration_ms,
    });
    scheduleActiveAssistantRender();
    return;
  }
  if (ev.type === "ui_action") {
    const actObj = ev.action || ev;
    const applied = applyAgentUiAction(actObj);
    const enriched = { ...actObj, _snapId: applied?.snapId || "" };
    assistantMsg.ui_actions.push(enriched);
    scheduleActiveAssistantRender();
    return;
  }
  if (ev.type === "delta") {
    assistantMsg.content += ev.text || "";
    setAgentStreamStatus("生成回复中...", true);
    scheduleActiveAssistantRender();
    return;
  }
  if (ev.type === "done") {
    assistantMsg._activeTools = [];
    if (typeof ev.reply === "string" && ev.reply.trim()) {
      assistantMsg.content = ev.reply;
    }
    if (ev.usage) assistantMsg.usage = ev.usage;
    if (ev.context_budget) assistantMsg.context_budget = ev.context_budget;
    if (ev.elapsed_ms) assistantMsg.elapsed_ms = ev.elapsed_ms;
    scheduleActiveAssistantRender(true);
    renderQuickReplies(ev.quick_replies || []);
    return;
  }
  if (ev.type === "error") {
    assistantMsg._activeTools = [];
    assistantMsg.content = `错误：${ev.message || "Agent 执行失败"}`;
    scheduleActiveAssistantRender(true);
  }
}

// ================= Slash /skill & @ Context Mention + Image Attachment Handling =================
function openAgentMentionQuick() {
  const inp = document.getElementById("agent-input");
  if (!inp) return;
  const cur = inp.value;
  inp.value = cur && !cur.endsWith(" ") ? `${cur} @` : `${cur}@`;
  inp.focus();
  autoGrowAgentInput();
  handleAgentInputChange();
}

function _buildMentionCandidates(q) {
  const s = typeof state !== "undefined" ? state : {};
  const out = [];
  if (!q || "当前画布stagecanvas".includes(q)) {
    out.push({ type: "stage", id: 0, label: "当前画布", sub: "引用画布成图与参数", tag: "stage", badge: "画布" });
  }
  const ocMatches = [];
  (s.ocCards || []).forEach(c => {
    if (!q || `${c.name} ${c.prompt}`.toLowerCase().includes(q)) {
      ocMatches.push({ type: "oc", id: c.id, label: c.name, sub: (c.prompt || "").slice(0, 40), tag: c.name, badge: "OC" });
    }
  });
  const artistMatches = [];
  const sortedArtists = [...(s.artists || [])].sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
  sortedArtists.forEach(a => {
    if (!q || `${a.name} ${a.tag} ${a.category} ${(a.style_tags || []).join(" ")}`.toLowerCase().includes(q)) {
      artistMatches.push({
        type: "artist",
        id: a.id,
        label: a.name,
        sub: a.tag,
        tag: a.tag,
        thumb: a.preview_url || "",
        badge: a.category || "画师",
      });
    }
  });
  const galleryMatches = [];
  (s.gallery || []).slice(0, 24).forEach(g => {
    if (!q || `图库 ${g.id} ${g.seed} ${g.model_short} ${g.notes || ""} ${g.prompt || ""}`.toLowerCase().includes(q)) {
      galleryMatches.push({
        type: "gallery",
        id: g.id,
        label: `图库#${g.id}`,
        sub: `#${g.seed} · ${g.model_short}`,
        tag: String(g.id),
        thumb: g.image_url,
        badge: "图库",
      });
    }
  });
  if (!q) {
    out.push(...ocMatches.slice(0, 3), ...artistMatches.slice(0, 6), ...galleryMatches.slice(0, 4));
    return out.slice(0, 14);
  }
  out.push(...ocMatches, ...artistMatches, ...galleryMatches);
  return out.slice(0, 14);
}

function insertAgentMention(type, id, label, tag) {
  const inp = document.getElementById("agent-input");
  if (!inp) return;
  inp.value = inp.value.replace(/(?:^|\s)@[^\s@]*$/, ` @${label} `).trimStart();
  if (!agentState.pendingMentions.some(m => m.type === type && String(m.id) === String(id) && m.label === label)) {
    agentState.pendingMentions.push({ type, id, label, tag });
  }
  hideSlashMenu();
  autoGrowAgentInput();
  inp.focus();
}

function _addAgentImageFile(file) {
  if (!file || !file.type?.startsWith("image/")) return;
  if (agentState.pendingAttachments.length >= 3) {
    showToast("单次最多附带 3 张参考图");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 768;
      let w = img.width, h = img.height;
      if (Math.max(w, h) > maxDim) {
        const ratio = maxDim / Math.max(w, h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = cv.toDataURL("image/jpeg", 0.86);
      agentState.pendingAttachments.push({ name: file.name || "pasted_ref.jpg", data_url: dataUrl });
      renderAgentAttachmentsBar();
    };
    img.src = String(reader.result || "");
  };
  reader.readAsDataURL(file);
}

function handleAgentPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const it of items) {
    if (it.type && it.type.startsWith("image/")) {
      e.preventDefault();
      const f = it.getAsFile();
      if (f) _addAgentImageFile(f);
      showToast("已粘贴参考图，发送后 Agent 将直接视觉分析");
      return;
    }
  }
}

function handleAgentImageUpload(event) {
  const files = [...(event.target?.files || [])];
  files.forEach(f => _addAgentImageFile(f));
  if (event.target) event.target.value = "";
}

function setupAgentDropZone() {
  const pane = document.getElementById("agent-pane-chat");
  if (!pane || pane.dataset.dropBound) return;
  pane.dataset.dropBound = "1";
  pane.addEventListener("dragover", e => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) {
      e.preventDefault();
      pane.classList.add("ring-1", "ring-[var(--accent-primary)]");
    }
  });
  pane.addEventListener("dragleave", () => pane.classList.remove("ring-1", "ring-[var(--accent-primary)]"));
  pane.addEventListener("drop", e => {
    pane.classList.remove("ring-1", "ring-[var(--accent-primary)]");
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type?.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    files.forEach(f => _addAgentImageFile(f));
    showToast(`已拖入 ${files.length} 张参考图`);
  });
}

function removeAgentAttachment(idx) {
  agentState.pendingAttachments.splice(idx, 1);
  renderAgentAttachmentsBar();
}

function sendAgentAttachmentToI2I(idx) {
  const att = agentState.pendingAttachments[idx];
  if (!att?.data_url) return;
  if (typeof setStageLocalImage === "function" && typeof setWorkbenchAction === "function") {
    setStageLocalImage(att.data_url);
    setWorkbenchAction("img2img");
    showToast("已将该参考图设为工作台图生图底图");
  }
}

function renderAgentAttachmentsBar() {
  const bar = document.getElementById("agent-attachments-bar");
  if (!bar) return;
  if (!agentState.pendingAttachments.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  bar.innerHTML = agentState.pendingAttachments
    .map(
      (att, idx) => `
      <div class="group relative inline-flex items-center gap-1.5 pr-1.5 rounded-[7px] bg-[var(--surface-subgroup)] border border-[var(--border-control)] overflow-hidden">
        <img src="${att.data_url}" alt="" class="w-8 h-8 object-cover shrink-0" />
        <button type="button" onclick="sendAgentAttachmentToI2I(${idx})" class="text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]" title="同时设为图生图底图">图生图</button>
        <button type="button" onclick="removeAgentAttachment(${idx})" class="text-[var(--text-muted)] hover:text-[var(--status-danger)] text-[12px] leading-none px-0.5" title="移除参考图">×</button>
      </div>`
    )
    .join("");
}

function handleAgentInputChange() {
  autoGrowAgentInput();
  const inp = document.getElementById("agent-input");
  const menu = document.getElementById("agent-slash-menu");
  if (!inp || !menu) return;
  const val = inp.value;

  const atMatch = val.match(/(?:^|\s)@([^\s@]*)$/);
  if (atMatch) {
    const q = atMatch[1].toLowerCase();
    const cands = _buildMentionCandidates(q);
    if (!cands.length) {
      hideSlashMenu();
      return;
    }
    menu.classList.remove("hidden");
    menu.innerHTML = cands
      .map(
        c => `
        <button type="button" onclick="insertAgentMention('${escapeHtml(c.type)}', ${Number(c.id) || 0}, '${escapeHtml(c.label).replace(/'/g, "\\'")}', '${escapeHtml(c.tag || "").replace(/'/g, "\\'")}')" class="ui-menu-item w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 text-[12px]">
          <div class="flex items-center gap-2 min-w-0">
            ${c.thumb ? `<img src="${c.thumb}" alt="" class="w-6 h-7 rounded-[4px] object-cover object-top shrink-0" />` : ""}
            <div class="min-w-0 truncate">
              <span class="font-medium text-[var(--text-primary)]">@${escapeHtml(c.label)}</span>
              <span class="text-[11px] font-mono text-[var(--text-muted)] ml-1.5">${escapeHtml(c.sub || "")}</span>
            </div>
          </div>
          <span class="text-[10px] px-1.5 py-[1px] rounded-[4px] ui-badge text-[var(--text-muted)] shrink-0">${escapeHtml(c.badge)}</span>
        </button>`
      )
      .join("");
    return;
  }

  const m = val.match(/(?:^|\s)\/([a-zA-Z0-9_\-\u4e00-\u9fff]*)$/);
  if (!m) {
    hideSlashMenu();
    return;
  }
  const q = m[1].toLowerCase();
  const matches = agentState.skills.filter(
    s => s.name.toLowerCase().includes(q) || (s.title || "").toLowerCase().includes(q)
  );
  if (!matches.length) {
    hideSlashMenu();
    return;
  }
  menu.classList.remove("hidden");
  menu.innerHTML = matches
    .map(
      s => `
      <button type="button" onclick="insertSlashSkill('${escapeHtml(s.name)}')" class="ui-menu-item w-full text-left px-2.5 py-1.5 flex items-center justify-between gap-2 text-[12px]">
        <div class="truncate">
          <span class="font-mono font-semibold text-[var(--text-primary)]">/${escapeHtml(s.name)}</span>
          <span class="text-[var(--text-secondary)] ml-1.5">${escapeHtml(s.title)}</span>
        </div>
        <span class="text-[10.5px] text-[var(--text-muted)] shrink-0">${s.builtin ? "内置" : "自定义"}</span>
      </button>
    `
    )
    .join("");
}

function hideSlashMenu() {
  document.getElementById("agent-slash-menu")?.classList.add("hidden");
}

function insertSlashSkill(skillName) {
  const inp = document.getElementById("agent-input");
  if (!inp) return;
  inp.value = inp.value.replace(/(?:^|\s)\/[a-zA-Z0-9_\-\u4e00-\u9fff]*$/, ` /${skillName} `).trimStart();
  if (!agentState.pinnedSkills.includes(skillName)) {
    agentState.pinnedSkills.push(skillName);
    renderAgentPinnedSkillsBar();
    renderAgentSkillsList();
  }
  hideSlashMenu();
  autoGrowAgentInput();
  inp.focus();
}

function handleAgentInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendAgentMessage();
  } else if (e.key === "Escape") {
    hideSlashMenu();
  }
}

// ================= Persistent Sessions Management =================
async function startNewAgentSession() {
  clearQueuedAgentPrompt();
  if (agentState.abortController) {
    agentState.abortController.abort();
    agentState.streaming = false;
    agentState.abortController = null;
  }
  agentState.sessionLoadSeq += 1;
  agentState.sessionId = null;
  agentState.messages = [];
  document.getElementById("agent-send-btn")?.classList.remove("hidden");
  document.getElementById("agent-stop-btn")?.classList.add("hidden");
  setAgentStreamStatus("", false);
  renderQuickReplies([]);
  renderAgentMessages();
  switchAgentPane("chat");
  refreshAgentLiveStrip();
  document.getElementById("agent-input")?.focus();
}

async function fetchAndRenderAgentSessions() {
  try {
    const res = await fetch("/api/agent/sessions");
    const data = await res.json();
    if (Array.isArray(data.sessions)) agentState.sessions = data.sessions;
  } catch (e) {}
  renderAgentSessionsList();
}

function formatAgentSessionTime(rawTs) {
  if (!rawTs) return "近期对话";
  let d = null;
  if (typeof rawTs === "number" || /^\d+(?:\.\d+)?$/.test(String(rawTs).trim())) {
    const num = Number(rawTs);
    d = new Date(num > 1e12 ? num : num * 1000);
  } else {
    const str = String(rawTs).trim();
    d = new Date(str.includes("T") ? str : str.replace(" ", "T") + "Z");
  }
  if (!d || Number.isNaN(d.getTime())) return String(rawTs).slice(0, 16);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin >= 0 && diffMin < 1) return "刚刚";
  if (diffMin >= 1 && diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr >= 1 && diffHr < 24) return `${diffHr} 小时前`;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${m}-${day} ${hh}:${mm}`;
}

function renderAgentSessionsList() {
  const wrap = document.getElementById("agent-sessions-list");
  if (!wrap) return;
  if (!agentState.sessions.length) {
    wrap.innerHTML = `<div class="text-[12px] text-[var(--text-muted)] py-8 text-center">暂无历史对话记录</div>`;
    return;
  }
  wrap.innerHTML = agentState.sessions
    .map(s => {
      const isCur = s.id === agentState.sessionId;
      const act = isCur ? "border-[var(--accent-primary)] bg-[var(--accent-primary-tint)]" : "";
      const timeLabel = formatAgentSessionTime(s.updated_at || s.created_at);
      const msgCnt = typeof s.message_count === "number" ? ` · ${s.message_count} 条消息` : "";
      return `
        <div class="group p-2.5 rounded-[9px] ui-card flex items-center justify-between gap-2 ${act}">
          <button type="button" onclick="loadAgentSession('${escapeHtml(s.id)}', true)" class="flex-1 min-w-0 text-left space-y-0.5">
            <div class="flex items-center gap-1.5">
              ${isCur ? `<span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] shrink-0"></span>` : ""}
              <span class="text-[12.5px] font-medium text-[var(--text-primary)] truncate">${escapeHtml(s.title || "新创作对话")}</span>
            </div>
            <div class="text-[11px] text-[var(--text-muted)]">${escapeHtml(timeLabel)}${escapeHtml(msgCnt)}</div>
          </button>
          <button type="button" onclick="deleteAgentSessionById('${escapeHtml(s.id)}')" aria-label="删除会话" title="删除会话" class="spring-btn w-7 h-7 rounded-[6px] ui-btn-ghost flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--status-danger)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <svg class="ui-ic-sm ui-ic" aria-hidden="true"><use href="#ic-trash"/></svg>
          </button>
        </div>
      `;
    })
    .join("");
}

async function loadAgentSession(sessionId, switchToChat = true) {
  const mySeq = ++agentState.sessionLoadSeq;
  clearQueuedAgentPrompt();
  if (agentState.abortController) {
    agentState.abortController.abort();
    agentState.streaming = false;
    agentState.abortController = null;
    document.getElementById("agent-send-btn")?.classList.remove("hidden");
    document.getElementById("agent-stop-btn")?.classList.add("hidden");
    setAgentStreamStatus("", false);
  }
  try {
    const res = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    if (mySeq !== agentState.sessionLoadSeq) return;
    if (res.ok && data.session) {
      agentState.sessionId = data.session.id;
      agentState.messages = Array.isArray(data.session.messages) ? data.session.messages : [];
      if (Array.isArray(data.session.pinned_skills)) {
        agentState.pinnedSkills = data.session.pinned_skills;
        renderAgentPinnedSkillsBar();
      }
      renderAgentMessages(true);
      if (switchToChat) switchAgentPane("chat");
    }
  } catch (e) {}
}

async function deleteAgentSessionById(sessionId) {
  const lockKey = `del_sess_${sessionId}`;
  if (agentState.busyOps.has(lockKey)) return;
  agentState.busyOps.add(lockKey);
  try {
    await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    agentState.sessions = agentState.sessions.filter(x => x.id !== sessionId);
    if (agentState.sessionId === sessionId) {
      agentState.sessionId = null;
      agentState.messages = [];
      renderAgentMessages();
    }
    renderAgentSessionsList();
  } catch (e) {
  } finally {
    agentState.busyOps.delete(lockKey);
  }
}

// ================= Progressive Disclosure SKILL.md Manager =================
function togglePinSkill(name) {
  const idx = agentState.pinnedSkills.indexOf(name);
  if (idx >= 0) agentState.pinnedSkills.splice(idx, 1);
  else agentState.pinnedSkills.push(name);
  renderAgentPinnedSkillsBar();
  renderAgentSkillsList();
}

function renderAgentPinnedSkillsBar() {
  const bar = document.getElementById("agent-pinned-skills");
  if (!bar) return;
  if (!agentState.pinnedSkills.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  bar.innerHTML = agentState.pinnedSkills
    .map(
      name => `
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-[var(--surface-subgroup)] border border-[var(--border-hairline)] font-mono text-[10.5px] text-[var(--text-secondary)]">
        /${escapeHtml(name)}
        <button type="button" onclick="togglePinSkill('${escapeHtml(name)}')" class="opacity-65 hover:opacity-100 text-[var(--text-primary)] leading-none">×</button>
      </span>
    `
    )
    .join("");
}

async function fetchAndRenderAgentSkills() {
  try {
    const res = await fetch("/api/agent/skills");
    const data = await res.json();
    if (Array.isArray(data.skills)) agentState.skills = data.skills;
  } catch (e) {}
  renderAgentSkillsList();
}

function renderAgentSkillsList() {
  const wrap = document.getElementById("agent-skills-list");
  if (!wrap) return;
  wrap.innerHTML = agentState.skills
    .map(s => {
      const pinned = agentState.pinnedSkills.includes(s.name);
      return `
        <div onclick="openSkillEditor('${escapeHtml(s.name)}')" class="group p-3 rounded-[10px] ui-card space-y-1.5 cursor-pointer">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex items-center gap-2">
              <span class="text-[12.5px] font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-primary)] transition-colors truncate">${escapeHtml(s.title)}</span>
              <span class="px-1.5 py-[1px] rounded-[4px] ui-badge font-mono text-[10px] text-[var(--text-muted)] shrink-0">/${escapeHtml(s.name)}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
              <button type="button" onclick="togglePinSkill('${escapeHtml(s.name)}')" class="spring-btn inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] ui-btn text-[11px] ${pinned ? "is-active" : "text-[var(--text-secondary)]"}" title="${pinned ? "已挂载至对话上下文，点击取消" : "固定挂载至每轮对话"}">
                <svg class="ui-ic-sm ui-ic" aria-hidden="true"><use href="#ic-pin"/></svg>
                <span>${pinned ? "已挂载" : "挂载"}</span>
              </button>
            </div>
          </div>
          <p class="text-[11.5px] text-[var(--text-muted)] leading-relaxed line-clamp-2">${escapeHtml(s.description)}</p>
        </div>
      `;
    })
    .join("");
}

async function openSkillEditor(name = null) {
  const browser = document.getElementById("agent-skills-browser");
  const editor = document.getElementById("agent-skill-editor");
  const heading = document.getElementById("skill-editor-heading");
  const delBtn = document.getElementById("skill-delete-btn");
  const nameIn = document.getElementById("skill-edit-name");
  const titleIn = document.getElementById("skill-edit-title");
  const descIn = document.getElementById("skill-edit-desc");
  const trigIn = document.getElementById("skill-edit-triggers");
  const bodyIn = document.getElementById("skill-edit-content");
  if (!browser || !editor) return;

  browser.classList.add("hidden");
  editor.classList.remove("hidden");

  if (!name) {
    agentState.editingSkillSlug = null;
    if (heading) heading.textContent = "新建自定义 SKILL.md";
    if (delBtn) delBtn.classList.add("hidden");
    if (nameIn) {
      nameIn.value = "";
      nameIn.disabled = false;
    }
    if (titleIn) titleIn.value = "";
    if (descIn) descIn.value = "";
    if (trigIn) trigIn.value = "";
    if (bodyIn) bodyIn.value = "# 自定义技能指令\n\n1. 在此编写该技能的标签规则、画师组合或工作流步骤...";
    return;
  }

  try {
    const res = await fetch(`/api/agent/skills/${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!res.ok || !data.skill) throw new Error("读取 Skill 失败");
    const sk = data.skill;
    agentState.editingSkillSlug = sk.name;
    if (heading) heading.textContent = `编辑 Skill：${sk.title}`;
    if (delBtn) delBtn.classList.toggle("hidden", Boolean(sk.builtin));
    if (nameIn) {
      nameIn.value = sk.name;
      nameIn.disabled = Boolean(sk.builtin);
    }
    if (titleIn) titleIn.value = sk.title || "";
    if (descIn) descIn.value = sk.description || "";
    if (trigIn) trigIn.value = sk.triggers || "";
    if (bodyIn) bodyIn.value = sk.content || "";
  } catch (err) {
    showToast(err.message || "加载 Skill 失败");
    closeSkillEditor();
  }
}

function closeSkillEditor() {
  agentState.editingSkillSlug = null;
  document.getElementById("agent-skill-editor")?.classList.add("hidden");
  document.getElementById("agent-skills-browser")?.classList.remove("hidden");
}

async function saveEditingSkill() {
  if (agentState.busyOps.has("save_skill")) return;
  const name = document.getElementById("skill-edit-name")?.value.trim() || "";
  const title = document.getElementById("skill-edit-title")?.value.trim() || "";
  const description = document.getElementById("skill-edit-desc")?.value.trim() || "";
  const triggers = document.getElementById("skill-edit-triggers")?.value.trim() || "";
  const content = document.getElementById("skill-edit-content")?.value.trim() || "";
  if (!name || !content) {
    showToast("请填写 Skill 标识名称与 Markdown 正文");
    return;
  }
  agentState.busyOps.add("save_skill");
  try {
    const res = await fetch("/api/agent/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, title, description, triggers, content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "保存失败");
    showToast(`已保存 Skill /${data.skill.name}`);
    closeSkillEditor();
    await fetchAndRenderAgentSkills();
  } catch (err) {
    showToast(err.message || "保存 Skill 失败");
  } finally {
    agentState.busyOps.delete("save_skill");
  }
}

async function deleteEditingSkill() {
  if (!agentState.editingSkillSlug || agentState.busyOps.has("del_skill")) return;
  agentState.busyOps.add("del_skill");
  try {
    const res = await fetch(`/api/agent/skills/${encodeURIComponent(agentState.editingSkillSlug)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "删除失败");
    agentState.pinnedSkills = agentState.pinnedSkills.filter(x => x !== agentState.editingSkillSlug);
    renderAgentPinnedSkillsBar();
    showToast("已删除自定义 Skill");
    closeSkillEditor();
    await fetchAndRenderAgentSkills();
  } catch (err) {
    showToast(err.message || "删除 Skill 失败");
  } finally {
    agentState.busyOps.delete("del_skill");
  }
}
