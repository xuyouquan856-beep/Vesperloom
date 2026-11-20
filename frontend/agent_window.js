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
  queuedMessage: "",
  activePromptText: "",
  sessionLoadSeq: 0,
  rafRenderPending: false,
  busyOps: new Set(),
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

function toggleAgentSubPane(pane) {
  if (agentState.activePane === pane) {
    switchAgentPane("chat");
  } else {
    switchAgentPane(pane);
  }
}

function switchAgentPane(pane = "chat") {
  agentState.activePane = pane;
  ["chat", "sessions", "skills"].forEach(p => {
    document.getElementById(`agent-pane-${p}`)?.classList.toggle("hidden", p !== pane);
  });
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
      btnEl.className = "spring-btn px-2 py-0.5 rounded-[5px] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.06] transition-colors shrink-0 whitespace-nowrap";
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
          `<div class="my-1.5 p-2.5 rounded-[8px] bg-black/25 border border-[var(--border-hairline)] overflow-x-auto"><code class="!bg-transparent !border-0 !p-0 block whitespace-pre-wrap" onclick="copyAgentCodeTag(this)" title="点击复制代码块">${escapeHtml(codeLines.join("\n"))}</code></div>`
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
      `<div class="my-1.5 p-2.5 rounded-[8px] bg-black/25 border border-[var(--border-hairline)] overflow-x-auto"><code class="!bg-transparent !border-0 !p-0 block whitespace-pre-wrap" onclick="copyAgentCodeTag(this)" title="点击复制代码块">${escapeHtml(codeLines.join("\n"))}</code></div>`
    );
  }
  flushTable();
  closeList();
  return `<div class="agent-prose">${out.join("")}</div>`;
}

function renderDiffActionCard(uiAct) {
  const p = uiAct.payload || {};
  const added = Array.isArray(p.added) ? p.added : [];
  const removed = Array.isArray(p.removed) ? p.removed : [];
  const snapId = uiAct._snapId || "";
  if (uiAct.type === "patch_prompt_blocks" || added.length || removed.length) {
    return `
      <div class="agent-diff-box mt-1.5">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--status-success)] shrink-0"></span>
            <span class="font-medium text-[var(--text-primary)] truncate">${escapeHtml(uiAct.summary || "已更新提示词")}</span>
          </div>
          ${snapId ? `<button type="button" onclick="undoAgentPromptPatch('${escapeHtml(snapId)}')" class="spring-btn px-2 py-0.5 rounded-[5px] ui-btn text-[11px] shrink-0">撤回</button>` : ""}
        </div>
        ${added.length ? `<div class="agent-diff-line-add">+ ${escapeHtml(added.join(", "))}</div>` : ""}
        ${removed.length ? `<div class="agent-diff-line-del">− ${escapeHtml(removed.join(", "))}</div>` : ""}
      </div>
    `;
  }
  return `
    <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border border-[var(--border-hairline)] bg-white/[0.025] text-[11.5px] text-[var(--text-secondary)] mt-1">
      <svg class="w-3 h-3 text-[var(--status-success)] shrink-0 stroke-current fill-none" stroke-width="2" viewBox="0 0 16 16" aria-hidden="true"><use href="#ic-check"/></svg>
      <span>${escapeHtml(uiAct.summary || uiAct.type)}</span>
    </div>
  `;
}

function _fmtDurationMs(ms) {
  if (typeof ms !== "number" || ms <= 0) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function renderToolTimelineHtml(events, activeTools = [], isActiveTurn = false, existingOpen = null) {
  const list = Array.isArray(events) ? events : [];
  const runningList = Array.isArray(activeTools) ? activeTools : [];
  if (!list.length && !runningList.length && !isActiveTurn) return "";
  const count = list.length + runningList.length;
  const activeStep = runningList[runningList.length - 1];
  const latest = activeStep
    ? `执行 ${activeStep.name}...`
    : list.length
    ? list[list.length - 1].summary || list[list.length - 1].name
    : "分析当前工作台上下文...";
  const label = isActiveTurn
    ? `<span class="inline-flex items-center gap-1.5 min-w-0"><span class="agent-thinking-dots text-[var(--text-secondary)]" aria-hidden="true"><span></span><span></span><span></span></span><span class="truncate">${escapeHtml(latest)}</span></span>`
    : `<span class="truncate">已执行 ${list.length} 项步骤 · ${escapeHtml(latest)}</span>`;

  const doneStepsHtml = list
    .map(t => {
      const dur = _fmtDurationMs(t.duration_ms);
      return `
      <div class="agent-timeline-step ${t.ok !== false ? "is-ok" : ""}">
        <span class="truncate">${escapeHtml(t.summary || t.name)}</span>
        <span class="text-[10.5px] ${t.ok !== false ? "text-[var(--text-muted)]" : "text-[var(--status-warning)]"} shrink-0">${dur ? `${dur} · ` : ""}${t.ok !== false ? "完成" : "提示"}</span>
      </div>
    `;
    })
    .join("");

  const runningStepsHtml = runningList
    .map(
      t => `
      <div class="agent-timeline-step is-running">
        <span class="truncate">${escapeHtml(t.name)}...</span>
        <span class="text-[10.5px] text-[var(--status-warning)] shrink-0">运行中</span>
      </div>
    `
    )
    .join("");

  const isOpen = existingOpen !== null ? existingOpen : isActiveTurn;
  return `
    <details class="agent-timeline" ${isOpen ? "open" : ""}>
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
  const isOpen = existingOpen !== null ? existingOpen : isActiveTurn && !hasContent;
  return `
    <details class="agent-reasoning" ${isOpen ? "open" : ""}>
      <summary>
        ${isActiveTurn && !hasContent ? '<span class="agent-thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>' : ""}
        <span>思考过程 (${txt.length} 字)</span>
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
    return escapeHtml(m.content);
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

  if (!agentState.messages.length) {
    box.innerHTML = `
      <div class="py-5 px-0.5 space-y-4">
        <div class="space-y-1.5">
          <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/[0.04] border border-[var(--border-hairline)] text-[10.5px] font-mono text-[var(--text-muted)]">
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--status-success)]"></span>
            NAI V5 · 21 Tools · 8 Skills · 100K Ctx
          </div>
          <div class="font-semibold text-[15px] tracking-[-0.01em] text-[var(--text-primary)]">Studio Agent 创作副驾</div>
          <p class="text-[12.5px] text-[var(--text-muted)] leading-relaxed">
            支持实时流式思考、多模态画布与图库审阅、100K 长上下文，可直译大白话改 Tag、导演构思、管画师库与作品图库。
          </p>
        </div>
        <div class="grid grid-cols-1 gap-2">
          <button type="button" onclick="quickSendAgent('我现在没什么灵感，帮我构思 3 个风格反差鲜明的二次元画面方向吧')" class="spring-btn group p-3 rounded-[11px] ui-card hover:border-[var(--border-hover)] text-left space-y-0.5 transition-colors">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">没灵感？导演互动构思</div>
            <div class="text-[11.5px] text-[var(--text-muted)]">通过简短对话敲定角色、构图与三层光影氛围</div>
          </button>
          <button type="button" onclick="quickSendAgent('给当前提示词加上微风吹起发丝、黄昏丁达尔逆光和梦幻散景光斑')" class="spring-btn group p-3 rounded-[11px] ui-card hover:border-[var(--border-hover)] text-left space-y-0.5 transition-colors">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">大白话实时转译 Danbooru / V5 标签</div>
            <div class="text-[11.5px] text-[var(--text-muted)]">精准增量写入对应区块，支持一键撤回 Diff</div>
          </button>
          <button type="button" onclick="quickSendAgent('帮我看一下当前中央画布里的图像哪里还可以优化，直接帮我改一版提示词或切到合适的模式')" class="spring-btn group p-3 rounded-[11px] ui-card hover:border-[var(--border-hover)] text-left space-y-0.5 transition-colors">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">多模态视觉看图诊断与修图</div>
            <div class="text-[11.5px] text-[var(--text-muted)]">直接看懂画布构图/手部/光影问题并联动重绘与改词</div>
          </button>
          <button type="button" onclick="quickSendAgent('帮我盘点画师库分类，看看近期图库里哪些图最值得收藏与复刻')" class="spring-btn group p-3 rounded-[11px] ui-card hover:border-[var(--border-hover)] text-left space-y-0.5 transition-colors">
            <div class="text-[12.5px] font-medium text-[var(--text-primary)]">批量整理画师库与作品图库</div>
            <div class="text-[11.5px] text-[var(--text-muted)]">联网查 Danbooru、看预览打标签、0点补预览与载回配方</div>
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
  if (!raw) return;

  if (agentState.streaming) {
    if (raw !== agentState.activePromptText && raw !== agentState.queuedMessage) {
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
  }
  hideSlashMenu();
  renderQuickReplies([]);

  agentState.activePromptText = raw;
  agentState.messages.push({ role: "user", content: raw });
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
  setAgentStreamStatus("连接推理流...", true);
  refreshAgentLiveStrip();

  try {
    const res = await fetch("/api/agent/chat/stream", {
      method: "POST",
      signal: myAbort.signal,
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

// ================= Slash /skill Autocomplete & Input Keybindings =================
function handleAgentInputChange() {
  autoGrowAgentInput();
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
      <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-white/[0.05] border border-[var(--border-hairline)] font-mono text-[10.5px] text-[var(--text-secondary)]">
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
