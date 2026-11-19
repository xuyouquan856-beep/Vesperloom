// ============================================================================
// NAI Studio — Floating Studio Agent Window, SSE Runtime & Skills Manager
// Inspired by Claude Code, Codex CLI & ComfyUI/NovelAI Prompt-Diff Copilots
// ============================================================================

const AGENT_WIN_STORAGE_KEY = "nai_studio_agent_win_v1";

const agentState = {
  open: false,
  minimized: false,
  activePane: "chat",
  sessionId: null,
  sessions: [],
  messages: [],
  skills: [],
  pinnedSkills: [],
  editingSkillSlug: null,
  streaming: false,
  abortController: null,
  undoSnapshots: {},
};

function initStudioAgentWindow(bootstrapData = {}) {
  agentState.skills = Array.isArray(bootstrapData.skills) ? bootstrapData.skills : [];
  agentState.sessions = Array.isArray(bootstrapData.agent_sessions) ? bootstrapData.agent_sessions : [];

  restoreAgentWindowGeometry();
  setupAgentWindowDragAndResize();
  renderAgentModelPill();
  refreshAgentLiveStrip();
  renderAgentPinnedSkillsBar();
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
  if (pill) pill.textContent = state.config?.llm_model || "qwen4-max";
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
  if (next) {
    clampAgentWindowToViewport();
    renderAgentModelPill();
    refreshAgentLiveStrip();
    setTimeout(() => document.getElementById("agent-input")?.focus(), 40);
  }
}

function toggleMinimizeAgentWindow(force) {
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

function switchAgentPane(pane = "chat") {
  agentState.activePane = pane;
  ["chat", "sessions", "skills"].forEach(p => {
    document.getElementById(`agent-pane-${p}`)?.classList.toggle("hidden", p !== pane);
  });
  document.querySelectorAll(".agent-pane-btn").forEach(btn => {
    const act = btn.dataset.agentTab === pane;
    btn.className = act
      ? "agent-pane-btn px-2 py-0.5 rounded-[4px] bg-[var(--cta-bg)] text-[var(--cta-fg)] font-medium"
      : "agent-pane-btn px-2 py-0.5 rounded-[4px] text-[var(--text-muted)] hover:text-[var(--text-primary)]";
  });
  if (pane === "sessions") fetchAndRenderAgentSessions();
  if (pane === "skills") {
    closeSkillEditor();
    fetchAndRenderAgentSkills();
  }
}

// ================= Window Drag, Resize & Geometry Persistence =================
function restoreAgentWindowGeometry() {
  const win = document.getElementById("agent-window");
  if (!win) return;
  try {
    const saved = JSON.parse(localStorage.getItem(AGENT_WIN_STORAGE_KEY) || "{}");
    if (typeof saved.width === "number" && saved.width >= 340) win.style.width = `${saved.width}px`;
    if (typeof saved.height === "number" && saved.height >= 420) win.style.height = `${saved.height}px`;
    if (typeof saved.left === "number" && typeof saved.top === "number") {
      win.style.right = "auto";
      win.style.bottom = "auto";
      win.style.left = `${saved.left}px`;
      win.style.top = `${saved.top}px`;
    }
  } catch (e) {}
}

function saveAgentWindowGeometry() {
  const win = document.getElementById("agent-window");
  if (!win || win.classList.contains("hidden")) return;
  const rect = win.getBoundingClientRect();
  try {
    localStorage.setItem(
      AGENT_WIN_STORAGE_KEY,
      JSON.stringify({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    );
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
    if (e.button !== 0 || e.target.closest("button")) return;
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
    action: state.workbenchAction || "generate",
    width: state.width || 832,
    height: state.height || 1216,
    steps: state.steps || 28,
    scale: state.scale || 5.0,
    cfg_rescale: state.cfgRescale || 0.0,
    sampler: state.sampler || "k_euler_ancestral",
    scheduler: state.scheduler || "karras",
    seed: Number(document.getElementById("seed-input")?.value || 0),
    opus_free_guard: state.config?.opus_free_guard !== false,
    stage_has_image: hasStage,
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
  telEl.textContent = `${mShort} (${actMap[state.workbenchAction] || "文生图"}) · 画${aCnt} / 人${cCnt} / 光${lCnt} / 负${nCnt}`;

  const issueCnt = state.lastLintResult?.issue_count || 0;
  if (topDot) {
    topDot.classList.toggle("hidden", issueCnt === 0 && !agentState.streaming);
    topDot.className = `w-1.5 h-1.5 rounded-full ${issueCnt > 0 ? "bg-[var(--status-warning)]" : "bg-[var(--status-success)]"}`;
  }
  if (btnEl) {
    if (issueCnt > 0) {
      btnEl.textContent = `⚠ ${issueCnt}处问题 · 修复`;
      btnEl.className = "spring-btn px-2 py-0.5 rounded-[4px] ui-btn text-[11px] text-[var(--status-warning)] border-[var(--status-warning)] shrink-0 whitespace-nowrap";
    } else {
      btnEl.textContent = "实时体检";
      btnEl.className = "spring-btn px-2 py-0.5 rounded-[4px] ui-btn text-[11px] shrink-0 whitespace-nowrap";
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
      state.cfgRescale = Math.max(0.0, Math.min(1.0, Number(p.cfg_rescale)));
      const el = document.getElementById("rescale-val");
      if (el) el.textContent = state.cfgRescale.toFixed(2);
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

  return { summary: action.summary };
}

// ================= Chat Stream Rendering & Markdown Lite =================
function formatAgentMarkdown(text) {
  const esc = escapeHtml(String(text || ""));
  return esc
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>");
}

function renderDiffActionCard(uiAct) {
  const p = uiAct.payload || {};
  const added = Array.isArray(p.added) ? p.added : [];
  const removed = Array.isArray(p.removed) ? p.removed : [];
  const snapId = uiAct._snapId || "";
  if (uiAct.type === "patch_prompt_blocks" || (added.length || removed.length)) {
    return `
      <div class="agent-diff-box space-y-1.5 mt-1.5">
        <div class="flex items-center justify-between gap-2">
          <span class="font-sans font-medium text-[var(--text-primary)]">${escapeHtml(uiAct.summary || "已更新提示词")}</span>
          ${snapId ? `<button type="button" onclick="undoAgentPromptPatch('${escapeHtml(snapId)}')" class="spring-btn font-sans px-2 py-0.5 rounded-[4px] ui-btn text-[11px]">撤回修改</button>` : ""}
        </div>
        ${added.length ? `<div class="text-[var(--status-success)] break-words">+ ${escapeHtml(added.join(", "))}</div>` : ""}
        ${removed.length ? `<div class="text-[var(--status-danger)] break-words">− ${escapeHtml(removed.join(", "))}</div>` : ""}
      </div>
    `;
  }
  return `
    <div class="agent-tool-card flex items-center justify-between gap-2 mt-1">
      <span class="text-[var(--status-success)] font-medium">✓ ${escapeHtml(uiAct.summary || uiAct.type)}</span>
    </div>
  `;
}

function renderAgentMessages() {
  const box = document.getElementById("agent-messages");
  if (!box) return;

  if (!agentState.messages.length) {
    box.innerHTML = `
      <div class="py-4 px-1 space-y-3">
        <div class="space-y-1">
          <div class="font-semibold text-[13.5px] text-[var(--text-primary)]">你好，我是 NAI Studio 实时创作助手</div>
          <p class="text-[12px] text-[var(--text-muted)] leading-relaxed">
            我能实时读取你的四区块提示词与画布状态，把大白话直接转成精准 Tag、陪你构思灵感、调用 Skills，以及控制工作台参数与 Director 工具。
          </p>
        </div>
        <div class="grid grid-cols-1 gap-1.5 pt-1">
          <button type="button" onclick="quickSendAgent('我现在没什么灵感，帮我构思 3 个风格反差鲜明的二次元画面方向吧')" class="spring-btn p-2.5 rounded-[9px] ui-btn text-left space-y-0.5">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">没灵感？导演互动构思</div>
            <div class="text-[11px] text-[var(--text-muted)]">通过简短对话确定角色、动作与情绪光影</div>
          </button>
          <button type="button" onclick="quickSendAgent('给当前提示词加上微风吹起发丝、黄昏丁达尔逆光和梦幻散景光斑')" class="spring-btn p-2.5 rounded-[9px] ui-btn text-left space-y-0.5">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">说大白话实时改提示词</div>
            <div class="text-[11px] text-[var(--text-muted)]">自动转译 Danbooru / V5 标签并增量写入对应区块</div>
          </button>
          <button type="button" onclick="quickSendAgent('请审阅我当前的提示词和参数，看看有没有语法冲突或能提升画质感的地方')" class="spring-btn p-2.5 rounded-[9px] ui-btn text-left space-y-0.5">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">实时审阅并优化当前提示词</div>
            <div class="text-[11px] text-[var(--text-muted)]">检测语法权重问题并搭配本地画师库风格</div>
          </button>
          <button type="button" onclick="quickSendAgent('帮我把当前画布提取成干净线稿 (Director Line Art)')" class="spring-btn p-2.5 rounded-[9px] ui-btn text-left space-y-0.5">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">语音/对话操控 Director 与工作台</div>
            <div class="text-[11px] text-[var(--text-muted)]">提取线稿、改表情、切换图生图/重绘、调采样与分辨率</div>
          </button>
        </div>
      </div>
    `;
    return;
  }

  box.innerHTML = agentState.messages
    .map(m => {
      if (m.role === "user") {
        return `<div class="agent-msg-user">${escapeHtml(m.content)}</div>`;
      }
      const toolsHtml = (m.tool_events || [])
        .map(
          t => `
          <div class="agent-tool-card flex items-center justify-between gap-2 font-mono">
            <span class="truncate text-[var(--text-secondary)]">⚡ ${escapeHtml(t.summary || t.name)}</span>
            <span class="text-[10.5px] ${t.ok !== false ? "text-[var(--status-success)]" : "text-[var(--status-warning)]"} shrink-0">${t.ok !== false ? "完成" : "提示"}</span>
          </div>
        `
        )
        .join("");

      const actionsHtml = (m.ui_actions || []).map(a => renderDiffActionCard(a)).join("");

      return `
        <div class="agent-msg-assistant space-y-1.5">
          ${toolsHtml ? `<div class="space-y-1">${toolsHtml}</div>` : ""}
          ${actionsHtml}
          ${m.content ? `<div class="pt-0.5">${formatAgentMarkdown(m.content)}</div>` : ""}
        </div>
      `;
    })
    .join("");

  box.scrollTop = box.scrollHeight;
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

function quickSendAgent(text) {
  if (!agentState.open) toggleAgentWindow(true);
  switchAgentPane("chat");
  const inp = document.getElementById("agent-input");
  if (inp) inp.value = text;
  sendAgentMessage();
}

function abortAgentStream() {
  if (agentState.abortController) {
    agentState.abortController.abort();
  }
}

async function sendAgentMessage() {
  if (agentState.streaming) return;
  const inp = document.getElementById("agent-input");
  const raw = (inp?.value || "").trim();
  if (!raw) return;
  if (inp) inp.value = "";
  hideSlashMenu();
  renderQuickReplies([]);

  agentState.messages.push({ role: "user", content: raw });
  const assistantMsg = { role: "assistant", content: "", tool_events: [], ui_actions: [] };
  agentState.messages.push(assistantMsg);
  renderAgentMessages();

  agentState.streaming = true;
  agentState.abortController = new AbortController();
  const sendBtn = document.getElementById("agent-send-btn");
  const stopBtn = document.getElementById("agent-stop-btn");
  const statusEl = document.getElementById("agent-stream-status");
  sendBtn?.classList.add("hidden");
  stopBtn?.classList.remove("hidden");
  if (statusEl) {
    statusEl.classList.remove("hidden");
    statusEl.textContent = "正在连接 Studio Agent...";
  }
  refreshAgentLiveStrip();

  try {
    const res = await fetch("/api/agent/chat/stream", {
      method: "POST",
      signal: agentState.abortController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: raw,
        session_id: agentState.sessionId,
        workbench_state: collectLiveWorkbenchState(),
        pinned_skills: agentState.pinnedSkills,
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
        handleAgentSseEvent(ev, assistantMsg, statusEl);
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      assistantMsg.content += (assistantMsg.content ? "\n\n" : "") + "_[已停止生成]_";
    } else {
      assistantMsg.content = `请求失败：${err.message || "未知错误"}`;
      showToast(err.message || "Agent 请求失败");
    }
    renderAgentMessages();
  } finally {
    agentState.streaming = false;
    agentState.abortController = null;
    sendBtn?.classList.remove("hidden");
    stopBtn?.classList.add("hidden");
    statusEl?.classList.add("hidden");
    refreshAgentLiveStrip();
  }
}

function handleAgentSseEvent(ev, assistantMsg, statusEl) {
  if (!ev || !ev.type) return;
  if (ev.type === "session") {
    agentState.sessionId = ev.session_id;
    return;
  }
  if (ev.type === "status") {
    if (statusEl) statusEl.textContent = ev.text || "处理中...";
    return;
  }
  if (ev.type === "tool_start") {
    if (statusEl) statusEl.textContent = `执行工具: ${ev.name}...`;
    return;
  }
  if (ev.type === "tool_result") {
    assistantMsg.tool_events.push({ id: ev.id, name: ev.name, summary: ev.summary, ok: ev.ok });
    renderAgentMessages();
    return;
  }
  if (ev.type === "ui_action") {
    const actObj = ev.action || ev;
    const applied = applyAgentUiAction(actObj);
    const enriched = { ...actObj, _snapId: applied?.snapId || "" };
    assistantMsg.ui_actions.push(enriched);
    renderAgentMessages();
    return;
  }
  if (ev.type === "delta") {
    assistantMsg.content += ev.text || "";
    renderAgentMessages();
    return;
  }
  if (ev.type === "done") {
    if (ev.reply && !assistantMsg.content) assistantMsg.content = ev.reply;
    renderAgentMessages();
    renderQuickReplies(ev.quick_replies || []);
    return;
  }
  if (ev.type === "error") {
    assistantMsg.content = `错误：${ev.message || "Agent 执行失败"}`;
    renderAgentMessages();
  }
}

// ================= Slash /skill Autocomplete & Input Keybindings =================
function handleAgentInputChange() {
  const inp = document.getElementById("agent-input");
  const menu = document.getElementById("agent-slash-menu");
  if (!inp || !menu) return;
  const val = inp.value;
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
  agentState.sessionId = null;
  agentState.messages = [];
  renderQuickReplies([]);
  renderAgentMessages();
  switchAgentPane("chat");
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

function renderAgentSessionsList() {
  const wrap = document.getElementById("agent-sessions-list");
  if (!wrap) return;
  if (!agentState.sessions.length) {
    wrap.innerHTML = `<div class="text-[12px] text-[var(--text-muted)] py-8 text-center">暂无历史对话记录</div>`;
    return;
  }
  wrap.innerHTML = agentState.sessions
    .map(s => {
      const act = s.id === agentState.sessionId ? "border-[var(--border-focus)]" : "";
      return `
        <div class="p-2.5 rounded-[9px] ui-card flex items-center justify-between gap-2 ${act}">
          <button type="button" onclick="loadAgentSession('${escapeHtml(s.id)}', true)" class="flex-1 min-w-0 text-left">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)] truncate">${escapeHtml(s.title || "新创作对话")}</div>
            <div class="text-[11px] font-mono text-[var(--text-muted)]">${escapeHtml(s.id)}</div>
          </button>
          <button type="button" onclick="deleteAgentSessionById('${escapeHtml(s.id)}')" class="spring-btn px-2 py-0.5 rounded-[5px] ui-btn text-[11px] text-[var(--status-danger)] shrink-0">删除</button>
        </div>
      `;
    })
    .join("");
}

async function loadAgentSession(sessionId, switchToChat = true) {
  try {
    const res = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`);
    const data = await res.json();
    if (res.ok && data.session) {
      agentState.sessionId = data.session.id;
      agentState.messages = Array.isArray(data.session.messages) ? data.session.messages : [];
      if (Array.isArray(data.session.pinned_skills)) {
        agentState.pinnedSkills = data.session.pinned_skills;
        renderAgentPinnedSkillsBar();
      }
      renderAgentMessages();
      if (switchToChat) switchAgentPane("chat");
    }
  } catch (e) {}
}

async function deleteAgentSessionById(sessionId) {
  try {
    await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    agentState.sessions = agentState.sessions.filter(x => x.id !== sessionId);
    if (agentState.sessionId === sessionId) {
      agentState.sessionId = null;
      agentState.messages = [];
      renderAgentMessages();
    }
    renderAgentSessionsList();
  } catch (e) {}
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
  bar.innerHTML =
    `<span class="text-[var(--text-muted)] mr-0.5">已激活 Skill:</span>` +
    agentState.pinnedSkills
      .map(
        name => `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] ui-badge font-mono text-[11px] text-[var(--text-primary)]">
          /${escapeHtml(name)}
          <button type="button" onclick="togglePinSkill('${escapeHtml(name)}')" class="opacity-70 hover:opacity-100">×</button>
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
        <div class="p-3 rounded-[10px] ui-card space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[12.5px] font-semibold text-[var(--text-primary)] truncate">${escapeHtml(s.title)}</div>
              <div class="text-[11px] font-mono text-[var(--text-muted)]">/${escapeHtml(s.name)} · ${s.builtin ? "内置核心" : "自定义"}</div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button type="button" onclick="togglePinSkill('${escapeHtml(s.name)}')" class="spring-btn px-2 py-0.5 rounded-[5px] ui-btn text-[11px] ${pinned ? "is-active" : ""}">${pinned ? "已固定 ✓" : "固定启用"}</button>
              <button type="button" onclick="openSkillEditor('${escapeHtml(s.name)}')" class="spring-btn px-2 py-0.5 rounded-[5px] ui-btn text-[11px]">查看/编辑</button>
            </div>
          </div>
          <p class="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">${escapeHtml(s.description)}</p>
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
  const name = document.getElementById("skill-edit-name")?.value.trim() || "";
  const title = document.getElementById("skill-edit-title")?.value.trim() || "";
  const description = document.getElementById("skill-edit-desc")?.value.trim() || "";
  const triggers = document.getElementById("skill-edit-triggers")?.value.trim() || "";
  const content = document.getElementById("skill-edit-content")?.value.trim() || "";
  if (!name || !content) {
    showToast("请填写 Skill 标识名称与 Markdown 正文");
    return;
  }
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
  }
}

async function deleteEditingSkill() {
  if (!agentState.editingSkillSlug) return;
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
  }
}
