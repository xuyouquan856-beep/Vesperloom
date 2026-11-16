/* ==========================================================================
   NAI Studio — Frontend Application Logic (app.js)
   Full Model Capability Sync + Bespoke Glass Select + Live NAI API Integration
   ========================================================================== */

const state = {
  config: {},
  models: {},
  resolutions: [],
  account: {},
  storage: {},
  gallery: [],
  artists: [],
  mixPresets: [],
  snippets: [],
  emotions: [],
  ocCards: [],
  wildcards: [],

  // Current Workbench Recipe State
  currentModel: "nai-diffusion-5-full",
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5.0,
  cfg_rescale: 0.0,
  sampler: "k_euler_ancestral",
  scheduler: "karras",
  seed: 0,
  seedLocked: false,
  ucPreset: "heavy",
  autoQuality: true,
  alphaTransparency: false,
  varietyPlus: false,
  sm: false,
  smDyn: false,
  decrisper: false,
  weightMode: "brackets", // 'brackets' | 'numeric'

  // Action Mode: 'generate' | 'img2img' | 'infill' | 'outpaint'
  action: "generate",
  stageImageB64: "",
  stageImageUrl: "",
  stageItemId: null,
  outpaintDir: "right",

  // Multi-Character State
  useCoords: true,
  characters: [],

  // Vibe & Reference State
  vibes: [],

  // Active Artist Mix applied to Workbench
  activeArtistMix: [],
  // Artist Mixer Tab State
  mixerItems: [
    { tag: "artist:rella", name: "Rella", weight: 0.9 },
    { tag: "artist:ciloranko", name: "Ciloranko", weight: 0.7 },
  ],
  artistCatFilter: "all",
  // Gallery pagination state
  galleryFavOnly: false,
  galleryTotal: 0,
  galleryHasMore: false,
  galleryOffset: 0,

  // Linter & V2.1/V2.2/V2.3 Interactive State
  lastLintResult: null,
  promptUndoStack: [],
  mutedTags: new Set(),
  batchCount: 1,
  queuePollTimer: null,
  stageZoom: 1,
  stagePanX: 0,
  stagePanY: 0,
  checkerboard: false,
  inpaintMode: "brush",
  focusInpaint: true,
  inpaintUndoStack: [],
  lightboxIdx: 0,
  inlineMatches: [],
  inlineSelIdx: 0,
  inlineTarget: null,
  preciseRefs: [],
  immersionMode: false,
  pendingOcAvatarB64: "",
  pendingInspectMeta: null,
  pendingInspectB64: "",
  currentWildcardName: "",
};

// ================= Toast & Helpers =================
function showToast(msg, duration = 2800) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add("hidden"), duration);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uiIcon(name, cls = "") {
  return `<svg class="ui-ic ${cls}" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
}

// ================= Custom Glass Dropdown System (No Native <select>) =================
function toggleGlassSelect(id, force) {
  const trigger = document.getElementById(`${id}-trigger`);
  const menu = document.getElementById(`${id}-menu`);
  if (!trigger || !menu) return;

  const isOpen = !menu.classList.contains("hidden");
  const nextOpen = typeof force === "boolean" ? force : !isOpen;

  // Close all other glass selects first
  document.querySelectorAll(".glass-select-menu").forEach(m => m.classList.add("hidden"));
  document.querySelectorAll(".glass-select-trigger").forEach(b => b.classList.remove("open"));

  if (nextOpen) {
    menu.classList.remove("hidden", "drop-up");
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom + 270 > window.innerHeight && rect.top > 240) {
      menu.classList.add("drop-up");
    }
    trigger.classList.add("open");
  }
}

document.addEventListener("click", e => {
  if (!e.target.closest("[id$='-select-wrap']")) {
    document.querySelectorAll(".glass-select-menu").forEach(m => m.classList.add("hidden"));
    document.querySelectorAll(".glass-select-trigger").forEach(b => b.classList.remove("open"));
  }
  const bgMenu = document.getElementById("bg-menu");
  if (bgMenu && !bgMenu.classList.contains("hidden")) {
    if (!e.target.closest("#bg-menu") && !e.target.closest("#bg-toggle-btn")) {
      bgMenu.classList.add("hidden");
    }
  }
  const dirMenu = document.getElementById("director-menu");
  if (dirMenu && !dirMenu.classList.contains("hidden")) {
    if (!e.target.closest("#director-menu") && !e.target.closest("[onclick*='toggleDirectorMenu']")) {
      dirMenu.classList.add("hidden");
    }
  }
  const tagMenu = document.getElementById("tag-suggestions-menu");
  if (tagMenu && !tagMenu.classList.contains("hidden")) {
    if (!e.target.closest("#tag-suggestions-menu") && !e.target.closest("#tag-search-input")) {
      tagMenu.classList.add("hidden");
    }
  }
});

// ================= Bootstrap & Initialization =================
async function bootstrapApp() {
  try {
    const res = await fetch("/api/bootstrap?fast=1");
    const data = await res.json();
    state.config = data.config || {};
    state.models = data.models || {};
    state.resolutions = data.resolutions || [];
    state.account = data.account || {};
    state.storage = data.storage || {};
    state.gallery = data.gallery || [];
    state.galleryOffset = state.gallery.length;
    state.galleryTotal = Number(data.gallery_total ?? state.gallery.length);
    state.galleryHasMore = state.galleryOffset < state.galleryTotal;
    state.artists = data.artists || [];
    state.mixPresets = data.mix_presets || [];
    state.snippets = data.snippets || [];
    state.emotions = data.emotions || [];
    state.ocCards = data.oc_cards || [];
    state.wildcards = data.wildcards || [];

    state.currentModel = state.config.default_model || "nai-diffusion-5-full";
    state.autoQuality = state.config.auto_quality_tags !== false;

    // Apply saved appearance
    if (state.config.theme === "light") {
      document.documentElement.classList.add("light");
      document.getElementById("theme-label").textContent = "深色模式";
      document.getElementById("theme-icon-use")?.setAttribute("href", "#ic-moon");
    } else {
      document.getElementById("theme-label").textContent = "浅色模式";
      document.getElementById("theme-icon-use")?.setAttribute("href", "#ic-sun");
    }
    const legacyDefaultBg = !state.config.bg_hex || ["#0b262c", "#0b0c0e"].includes(state.config.bg_hex.toLowerCase());
    const savedBg = legacyDefaultBg ? "#091319" : state.config.bg_hex;
    applyBgHex(savedBg, null, false);
    setGlassClarity(state.config.glass_clarity || 88, false);

    renderAccountHeader();
    renderStorageBadges();
    renderResolutionButtons();
    renderSnippetsBar();
    populateDirectorEmotions();
    selectModel(state.currentModel, false);

    renderWorkbenchHistory();
    renderArtistsGrid();
    renderMixer();
    renderMixPresets();
    renderFullGallery();
    populateSettingsForm();
    renderOcCardsList();

    // Load latest gallery image onto stage if available
    if (state.gallery.length > 0) {
      setStageFromGalleryItem(state.gallery[0], false);
    }

    setupPromptListeners();
    setupInpaintCanvas();
    setupStageInteraction();
    setupInlineAutocomplete();
    setupGlobalHotkeys();
    initWorkspacePanels();
    switchInspectorTab("prompts");
    updateLeftRefsBadge();
    renderTagPillsBar();
    if (data.queue?.running) {
      startQueuePolling();
    }
    switchTab("workbench");
    refreshAccountStatus(false);
  } catch (err) {
    console.error("Bootstrap error:", err);
    showToast("初始化加载失败，请检查后端服务是否正常运行");
  }
}

// ================= Workspace Sidebars: Collapse & Drag Resize =================
const WORKSPACE_LAYOUT_KEY = "nai_studio_workspace_layout_v1";

function loadWorkspaceLayout() {
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_LAYOUT_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function saveWorkspaceLayout(patch) {
  const cur = loadWorkspaceLayout();
  try {
    localStorage.setItem(WORKSPACE_LAYOUT_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch (e) {}
}

function toggleLeftPanel(force) {
  const panel = document.getElementById("left-panel");
  const resizer = document.getElementById("left-resizer");
  const btn = document.getElementById("toggle-left-panel-btn");
  if (!panel) return;
  const nextCollapsed = typeof force === "boolean" ? !force : !panel.classList.contains("is-collapsed");
  panel.classList.toggle("is-collapsed", nextCollapsed);
  resizer?.classList.toggle("hidden", nextCollapsed);
  btn?.classList.toggle("is-active", !nextCollapsed);
  saveWorkspaceLayout({ leftCollapsed: nextCollapsed });
}

function toggleRightPanel(force) {
  const panel = document.getElementById("right-panel");
  const resizer = document.getElementById("right-resizer");
  const btn = document.getElementById("toggle-right-panel-btn");
  if (!panel) return;
  const nextCollapsed = typeof force === "boolean" ? !force : !panel.classList.contains("is-collapsed");
  panel.classList.toggle("is-collapsed", nextCollapsed);
  resizer?.classList.toggle("hidden", nextCollapsed);
  btn?.classList.toggle("is-active", !nextCollapsed);
  saveWorkspaceLayout({ rightCollapsed: nextCollapsed });
}

function initWorkspacePanels() {
  const saved = loadWorkspaceLayout();
  const rootStyle = document.documentElement.style;
  if (saved.leftWidth) rootStyle.setProperty("--left-panel-w", `${Math.max(320, Math.min(520, Number(saved.leftWidth)))}px`);
  if (saved.rightWidth) rootStyle.setProperty("--right-panel-w", `${Math.max(210, Math.min(360, Number(saved.rightWidth)))}px`);
  if (saved.leftCollapsed) toggleLeftPanel(false);
  if (saved.rightCollapsed) toggleRightPanel(false);

  const bindResizer = (resizerId, side) => {
    const resizer = document.getElementById(resizerId);
    const panel = document.getElementById(side === "left" ? "left-panel" : "right-panel");
    if (!resizer || !panel) return;
    resizer.addEventListener("pointerdown", e => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      resizer.classList.add("is-dragging");
      panel.style.transition = "none";

      const onMove = mv => {
        const dx = mv.clientX - startX;
        const raw = side === "left" ? startW + dx : startW - dx;
        const minW = side === "left" ? 320 : 210;
        const maxW = side === "left" ? 520 : 360;
        const nextW = Math.round(Math.max(minW, Math.min(maxW, raw)));
        rootStyle.setProperty(side === "left" ? "--left-panel-w" : "--right-panel-w", `${nextW}px`);
      };
      const onUp = () => {
        resizer.classList.remove("is-dragging");
        panel.style.transition = "";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const finalW = Math.round(panel.getBoundingClientRect().width);
        saveWorkspaceLayout(side === "left" ? { leftWidth: finalW } : { rightWidth: finalW });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  };

  bindResizer("left-resizer", "left");
  bindResizer("right-resizer", "right");
}

// ================= Left Inspector Tabs & Reference Counter =================
function switchInspectorTab(tab) {
  ["prompts", "sampling", "refs"].forEach(id => {
    document.getElementById(`inspector-pane-${id}`)?.classList.toggle("hidden", id !== tab);
  });
  document.querySelectorAll(".inspector-tab-btn").forEach(btn => {
    const act = btn.dataset.inspector === tab;
    btn.className = act
      ? "inspector-tab-btn py-1 rounded-[6px] font-medium bg-[var(--cta-bg)] text-[var(--cta-fg)] transition-colors"
      : "inspector-tab-btn py-1 rounded-[6px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors";
  });
}

function switchPromptSide(side) {
  ["pos", "uc"].forEach(id => {
    document.getElementById(`prompt-side-${id}`)?.classList.toggle("hidden", id !== side);
  });
  document.querySelectorAll(".prompt-side-btn").forEach(btn => {
    const act = btn.dataset.promptSide === side;
    btn.className = act
      ? "prompt-side-btn px-2.5 py-1 rounded-[5px] font-medium bg-[var(--cta-bg)] text-[var(--cta-fg)] transition-colors inline-flex items-center gap-1.5"
      : "prompt-side-btn px-2.5 py-1 rounded-[5px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors inline-flex items-center gap-1.5";
  });
  document.getElementById("inline-autocomplete-menu")?.classList.add("hidden");
  if (side === "pos") {
    document.getElementById("prompt-input")?.focus();
  } else {
    document.getElementById("uc-input")?.focus();
  }
}

function updateLeftRefsBadge() {
  const badge = document.getElementById("left-refs-badge");
  if (!badge) return;
  const spec = state.models[state.currentModel];
  const charCount = spec?.supports_multi_char ? state.characters.length : 0;
  const vibeCount = spec?.supports_vibe ? state.vibes.length : 0;
  const prefCount = spec?.supports_precise_ref ? state.preciseRefs.length : 0;
  const total = charCount + vibeCount + prefCount;
  badge.textContent = total > 0 ? `(${total})` : "";
  badge.classList.toggle("hidden", total === 0);
}

// ================= Tab Navigation =================
function switchTab(tab) {
  ["workbench", "artists", "gallery", "settings"].forEach(id => {
    const el = document.getElementById(`view-${id}`);
    if (el) el.classList.toggle("hidden", id !== tab);
  });
  const indicator = document.getElementById("tab-indicator");
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  document.querySelectorAll(".tab-btn").forEach(btn => {
    const isAct = btn.dataset.tab === tab;
    btn.style.color = isAct ? "var(--cta-fg)" : "var(--text-muted)";
  });
  if (activeBtn && indicator) {
    indicator.style.width = `${activeBtn.offsetWidth}px`;
    indicator.style.transform = `translateX(${activeBtn.offsetLeft - 2}px)`;
  }
  if (tab === "gallery") renderFullGallery();
  if (tab === "artists") {
    renderArtistsGrid();
    renderMixer();
  }
}

window.addEventListener("resize", () => {
  const activeTab = ["workbench", "artists", "gallery", "settings"].find(
    id => !document.getElementById(`view-${id}`).classList.contains("hidden")
  );
  if (activeTab) switchTab(activeTab);
});

// ================= Account, Storage & Opus Guard =================
function renderAccountHeader() {
  const acc = state.account || {};
  const tierEl = document.getElementById("account-tier-badge");
  const v5El = document.getElementById("v5-quota-badge");
  const anlasEl = document.getElementById("anlas-display");
  const connPill = document.getElementById("settings-conn-pill");

  if (acc.connected) {
    if (tierEl) tierEl.textContent = acc.is_opus ? "Opus 订阅" : acc.tier_name;
    if (v5El) {
      const rem = acc.v5_remaining_percent ?? 100;
      const mins = Math.round((acc.v5_next_percent_seconds || 0) / 60);
      v5El.textContent = `V5 算力剩余 ${rem}% (${mins}m恢复1%)`;
    }
    if (anlasEl) anlasEl.textContent = (acc.anlas ?? 0).toLocaleString();
    if (connPill) {
      connPill.textContent = `已连接 ${acc.is_opus ? "Opus (0点数免费激活)" : acc.tier_name}`;
      connPill.className = "px-2 py-1 rounded-[6px] ui-badge text-[var(--status-success)] text-[12px] font-mono";
    }
  } else {
    if (tierEl) tierEl.textContent = "未连接";
    if (connPill) {
      connPill.textContent = "连接异常";
      connPill.className = "px-2 py-1 rounded-[6px] ui-badge text-[var(--status-danger)] text-[12px] font-mono";
    }
  }

  // Opus Guard Pill
  const guardOn = state.config.opus_free_guard !== false;
  const pill = document.getElementById("opus-guard-pill");
  const label = document.getElementById("opus-guard-label");
  const sw = document.getElementById("settings-opus-switch");
  if (pill && label) {
    pill.className = "spring-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] ui-chip whitespace-nowrap";
    pill.querySelector("svg")?.setAttribute("class", `ui-ic ${guardOn ? "text-[var(--status-success)]" : "text-[var(--status-warning)]"}`);
    pill.querySelector("use")?.setAttribute("href", guardOn ? "#ic-shield" : "#ic-alert");
    label.textContent = guardOn ? "Opus 免费保护: 开" : "Opus 免费保护: 关";
  }
  if (sw) sw.classList.toggle("on", guardOn);
}

async function refreshAccountStatus(toast = false) {
  try {
    const res = await fetch("/api/account");
    state.account = await res.json();
    renderAccountHeader();
    if (toast) showToast("已同步 NovelAI 官方订阅与 V5 算力状态");
  } catch (e) {
    if (toast) showToast("刷新账号状态失败");
  }
}

async function toggleOpusGuard() {
  const next = state.config.opus_free_guard === false;
  state.config.opus_free_guard = next;
  if (next && state.steps > 28) {
    state.steps = 28;
    document.getElementById("steps-val").textContent = "28";
  }
  if (next && state.width * state.height > 1048576) {
    state.width = 832;
    state.height = 1216;
    renderResolutionButtons();
  }
  renderAccountHeader();
  updateCostEstimate();
  await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opus_free_guard: next }),
  });
  showToast(next ? "已开启 Opus 0点数免费保护锁（自动拦截付费参数）" : "已关闭 Opus 免费保护锁");
}

function renderStorageBadges() {
  const st = state.storage || {};
  const navCnt = document.getElementById("nav-gallery-count");
  if (navCnt) navCnt.textContent = state.gallery.length;
  const badge = document.getElementById("gallery-storage-badge");
  if (badge) {
    badge.textContent = `存储于 ${st.output_dir || "D:\\NAI-Studio\\outputs"} (${st.total_size_mb || 0} MB) · C盘占用 0 Bytes`;
  }
  const det = document.getElementById("settings-storage-detail");
  if (det) {
    det.textContent = `当前位于 ${st.drive || "D:"} 盘 · 图库共 ${st.gallery_png_count || 0} 张原图 + ${st.artist_card_count || 0} 张画师卡 · C盘占用 0 Bytes`;
  }
}

// ================= Model Selection & Strict Capability Synchronization =================
function renderModelSelectMenu() {
  const menu = document.getElementById("model-select-menu");
  if (!menu) return;
  menu.innerHTML = Object.values(state.models)
    .map(m => {
      const active = m.id === state.currentModel ? "active" : "";
      return `
        <button type="button" onclick="selectModel('${m.id}')" class="glass-select-option ${active}">
          <div class="flex flex-col gap-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0 rounded-[6px] bg-[var(--accent-tint)] border border-[var(--border-control)] text-[12px] font-mono text-[var(--text-primary)]">${m.short_name}</span>
              <span class="font-semibold truncate">${escapeHtml(m.name)}</span>
            </div>
            <span class="text-[12px] text-[var(--text-muted)] line-clamp-1">${escapeHtml(m.description)}</span>
          </div>
          <span class="text-[12px] px-2 py-1 rounded-[6px] ui-badge shrink-0 font-mono text-[var(--status-success)]">${escapeHtml(m.badge)}</span>
        </button>
      `;
    })
    .join("");
}

function selectModel(modelId, notify = true) {
  const spec = state.models[modelId] || Object.values(state.models)[0];
  if (!spec) return;
  state.currentModel = spec.id;

  // Update Model Select Trigger UI
  document.getElementById("model-select-family-pill").textContent = spec.short_name;
  document.getElementById("model-select-label").textContent = spec.name;
  document.getElementById("model-select-badge").textContent = spec.badge;
  document.getElementById("model-opus-tag").textContent = spec.opus_note;
  toggleGlassSelect("model-select", false);
  renderModelSelectMenu();

  // 1. Render Model Capability Sync Badges
  const capEl = document.getElementById("model-cap-badges");
  const badges = [];
  if (spec.supports_multi_char) {
    badges.push(`<span class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] ui-badge text-[var(--text-secondary)]">${uiIcon("check", "ui-ic-sm text-[var(--status-success)]")}多角色站位 (${spec.max_characters}人)</span>`);
  } else {
    badges.push(`<span class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] ui-badge text-[var(--text-muted)]">无多角色分区</span>`);
  }
  if (spec.supports_alpha_transparency) {
    badges.push(`<span class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] ui-badge text-[var(--text-secondary)]">${uiIcon("check", "ui-ic-sm text-[var(--status-success)]")}原生透明底</span>`);
  }
  if (spec.supports_vibe) {
    badges.push(
      `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] ui-badge text-[var(--text-secondary)]">${uiIcon("check", "ui-ic-sm text-[var(--status-success)]")}Vibe 参考${spec.vibe_raw_image_free ? " (原图免费)" : ""}</span>`
    );
  } else {
    badges.push(`<span class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] ui-badge text-[var(--text-muted)]">V5 暂不支持 Vibe/Precise</span>`);
  }
  if (spec.supports_precise_ref) {
    badges.push(`<span class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] ui-badge text-[var(--text-secondary)]">${uiIcon("check", "ui-ic-sm text-[var(--status-success)]")}Precise 精准参考</span>`);
  }
  if (spec.supports_smea) {
    badges.push(`<span class="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] ui-badge text-[var(--text-secondary)]">${uiIcon("check", "ui-ic-sm text-[var(--status-success)]")}SMEA/DYN</span>`);
  }
  capEl.innerHTML = badges.join("");

  // 2. Sync V5 Exclusive Alpha Transparency Bar
  const alphaBar = document.getElementById("v5-alpha-bar");
  if (alphaBar) {
    alphaBar.classList.toggle("hidden", !spec.supports_alpha_transparency);
    if (!spec.supports_alpha_transparency) {
      state.alphaTransparency = false;
      document.getElementById("alpha-switch")?.classList.remove("on");
    }
  }

  // 3. Sync Weight Mode ({} vs ::)
  const wmBtn = document.getElementById("weight-mode-btn");
  if (!spec.supports_numeric_weight) {
    state.weightMode = "brackets";
    if (wmBtn) {
      wmBtn.textContent = "语法: {} (V3锁定)";
      wmBtn.classList.add("opacity-75");
    }
  } else if (wmBtn) {
    wmBtn.textContent = state.weightMode === "numeric" ? "语法: 1.1::" : "语法: {}";
    wmBtn.classList.remove("opacity-75");
  }

  // 4. Sync Multi-Character Section (V4/V4.5/V5 vs V3)
  const v3CharNotice = document.getElementById("multi-char-v3-notice");
  const charSlotsList = document.getElementById("char-slots-list");
  const charActions = document.getElementById("multi-char-actions");
  if (spec.supports_multi_char) {
    v3CharNotice?.classList.add("hidden");
    charSlotsList?.classList.remove("hidden");
    charActions?.classList.remove("hidden");
    renderCharacterSlots();
  } else {
    v3CharNotice?.classList.remove("hidden");
    charSlotsList?.classList.add("hidden");
    charActions?.classList.add("hidden");
  }

  // 5. Sync Vibe Transfer & Precise Reference Section
  const refCapPill = document.getElementById("ref-cap-pill");
  const v5UnsupBox = document.getElementById("ref-v5-unsupported-box");
  const vibeSupBox = document.getElementById("ref-vibe-supported-box");
  const precSupBox = document.getElementById("ref-precise-supported-box");
  const vibeCostHint = document.getElementById("vibe-cost-hint");
  const vibeUploadLabel = document.getElementById("vibe-upload-label");

  if (!spec.supports_vibe && !spec.supports_precise_ref) {
    // V5: Neither Vibe nor Precise Ref is supported
    if (refCapPill) {
      refCapPill.textContent = `${spec.short_name} 暂不支持参考图`;
      refCapPill.className = "text-[12px] px-2 py-1 rounded-[6px] ui-badge text-[var(--status-warning)]";
    }
    v5UnsupBox?.classList.remove("hidden");
    vibeSupBox?.classList.add("hidden");
  } else {
    v5UnsupBox?.classList.add("hidden");
    vibeSupBox?.classList.remove("hidden");
    if (spec.vibe_raw_image_free) {
      if (refCapPill) {
        refCapPill.textContent = "V3 原图 Vibe 0点数免费";
        refCapPill.className = "text-[12px] px-2 py-1 rounded-[6px] ui-badge text-[var(--status-success)]";
      }
      if (vibeCostHint) vibeCostHint.textContent = "上传任意 PNG/JPG 均 0 Anlas 免费";
      if (vibeUploadLabel) vibeUploadLabel.textContent = "上传参考图 PNG/JPG (V3 0点数免费)";
    } else {
      if (refCapPill) {
        refCapPill.textContent = spec.supports_precise_ref ? "支持 Vibe + Precise 参考" : "支持 Vibe 风格参考";
        refCapPill.className = "text-[12px] px-2 py-1 rounded-[6px] ui-badge text-[var(--text-primary)]";
      }
      if (vibeCostHint) vibeCostHint.textContent = "导入 .naiv4vibe 0点数免费 (原图编码需 2 Anlas)";
      if (vibeUploadLabel) vibeUploadLabel.textContent = "导入 .naiv4vibe (0点数) 或参考图";
    }
    precSupBox?.classList.toggle("hidden", !spec.supports_precise_ref);
  }

  // 6. Sync UC Presets Dropdown, Sampler Dropdown, Scheduler Dropdown
  renderUcSelectMenu(spec);
  renderSamplerSelectMenu(spec);
  renderSchedulerSelectMenu(spec);

  // 7. Sync Variety+ vs SMEA/DYN/Decrisper Toggles
  document.getElementById("v45-extra-toggles")?.classList.toggle("hidden", !spec.supports_variety_plus);
  document.getElementById("v3-smea-toggles")?.classList.toggle("hidden", !spec.supports_smea);

  // 8. Re-lint Prompt for the selected model & update stage info + cost estimate
  runPromptLinter();
  renderActiveArtistMixBar();
  updateStageInfoPill();
  updateCostEstimate();
  updateLeftRefsBadge();

  if (notify) {
    showToast(`已切换模型：${spec.name}（界面功能已按模型能力自动同步）`);
  }
}

// ================= UC Preset, Sampler & Scheduler Custom Glass Selects =================
function renderUcSelectMenu(spec) {
  const presets = spec.uc_presets || {};
  if (!presets[state.ucPreset]) state.ucPreset = "heavy";
  const currentObj = presets[state.ucPreset] || Object.values(presets)[0];
  document.getElementById("uc-select-label").textContent = currentObj ? currentObj.label : "强力预设";

  const menu = document.getElementById("uc-select-menu");
  if (!menu) return;
  menu.innerHTML = Object.entries(presets)
    .map(([key, obj]) => {
      const act = key === state.ucPreset ? "active" : "";
      return `
        <button type="button" onclick="selectUcPreset('${key}')" class="glass-select-option ${act}">
          <span>${escapeHtml(obj.label)}</span>
        </button>
      `;
    })
    .join("");
}

function selectUcPreset(key) {
  const spec = state.models[state.currentModel];
  if (!spec || !spec.uc_presets[key]) return;
  state.ucPreset = key;
  document.getElementById("uc-select-label").textContent = spec.uc_presets[key].label;
  document.getElementById("uc-input").value = spec.uc_presets[key].tags;
  toggleGlassSelect("uc-select", false);
  renderUcSelectMenu(spec);
}

function renderSamplerSelectMenu(spec) {
  const samplers = spec.samplers || [];
  if (!samplers.some(s => s.id === state.sampler)) {
    state.sampler = spec.default_sampler || "k_euler_ancestral";
  }
  const cur = samplers.find(s => s.id === state.sampler) || samplers[0];
  if (cur) document.getElementById("sampler-select-label").textContent = cur.label.split(" ")[0];

  const menu = document.getElementById("sampler-select-menu");
  if (!menu) return;
  menu.innerHTML = samplers
    .map(s => {
      const act = s.id === state.sampler ? "active" : "";
      return `
        <button type="button" onclick="selectSampler('${s.id}')" class="glass-select-option ${act}">
          <span>${escapeHtml(s.label)}</span>
        </button>
      `;
    })
    .join("");
}

function selectSampler(samplerId) {
  state.sampler = samplerId;
  const spec = state.models[state.currentModel];
  toggleGlassSelect("sampler-select", false);
  if (spec) renderSamplerSelectMenu(spec);
}

function renderSchedulerSelectMenu(spec) {
  const scheds = spec.schedulers || [];
  if (!scheds.some(s => s.id === state.scheduler)) {
    state.scheduler = spec.default_scheduler || "karras";
  }
  const cur = scheds.find(s => s.id === state.scheduler) || scheds[0];
  if (cur) document.getElementById("scheduler-select-label").textContent = cur.label;

  const menu = document.getElementById("scheduler-select-menu");
  if (!menu) return;
  menu.innerHTML = scheds
    .map(s => {
      const act = s.id === state.scheduler ? "active" : "";
      return `
        <button type="button" onclick="selectScheduler('${s.id}')" class="glass-select-option ${act}">
          <span>${escapeHtml(s.label)}</span>
        </button>
      `;
    })
    .join("");
}

function selectScheduler(schedId) {
  state.scheduler = schedId;
  const spec = state.models[state.currentModel];
  toggleGlassSelect("scheduler-select", false);
  if (spec) renderSchedulerSelectMenu(spec);
}

// ================= Resolution Buttons & Steppers =================
function renderResolutionButtons() {
  const wrap = document.getElementById("resolution-buttons");
  if (!wrap) return;
  wrap.innerHTML = state.resolutions
    .slice(0, 5)
    .map(r => {
      const isAct = r.width === state.width && r.height === state.height;
      const cls = isAct
        ? "is-active"
        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]";
      return `
        <button type="button" onclick="selectResolution(${r.width}, ${r.height})" class="spring-btn py-1.5 px-1 rounded-[6px] ui-btn text-center ${cls}">
          <div class="text-[12px] leading-tight">${escapeHtml(r.label)}</div>
          <div class="text-[11px] font-mono opacity-75">${r.sub}</div>
        </button>
      `;
    })
    .join("");
}

function selectResolution(w, h) {
  state.width = w;
  state.height = h;
  renderResolutionButtons();
  updateStageInfoPill();
  updateCostEstimate();
}

function stepParam(key, delta) {
  if (key === "steps") {
    let next = state.steps + delta;
    if (state.config.opus_free_guard !== false && next > 28) {
      next = 28;
      showToast("Opus 0点数免费保护已锁定最高 28 步");
    }
    state.steps = Math.max(1, Math.min(50, next));
    document.getElementById("steps-val").textContent = String(state.steps);
  } else if (key === "scale") {
    state.scale = Math.max(1.0, Math.min(10.0, Math.round((state.scale + delta) * 10) / 10));
    document.getElementById("scale-val").textContent = state.scale.toFixed(1);
  } else if (key === "cfg_rescale") {
    state.cfg_rescale = Math.max(0.0, Math.min(1.0, Math.round((state.cfg_rescale + delta) * 100) / 100));
    document.getElementById("rescale-val").textContent = state.cfg_rescale.toFixed(2);
  }
  updateStageInfoPill();
  updateCostEstimate();
}

function updateSeedLockBtn() {
  const btn = document.getElementById("lock-seed-btn");
  if (!btn) return;
  btn.innerHTML = `${uiIcon(state.seedLocked ? "lock" : "unlock")}<span>${state.seedLocked ? "锁定" : "未锁"}</span>`;
  btn.classList.toggle("is-active", state.seedLocked);
}

function randomizeSeed() {
  state.seed = 0;
  state.seedLocked = false;
  document.getElementById("seed-input").value = "0";
  updateSeedLockBtn();
}

function toggleSeedLock() {
  state.seedLocked = !state.seedLocked;
  updateSeedLockBtn();
}

function toggleAlphaTransparency() {
  state.alphaTransparency = !state.alphaTransparency;
  document.getElementById("alpha-switch")?.classList.toggle("on", state.alphaTransparency);
  showToast(state.alphaTransparency ? "已开启 V5 原生透明底 (Alpha Transparency)" : "已关闭 V5 原生透明底");
}

function toggleAutoQuality() {
  state.autoQuality = !state.autoQuality;
  document.getElementById("quality-switch")?.classList.toggle("on", state.autoQuality);
}

function toggleVarietyPlus() {
  state.varietyPlus = !state.varietyPlus;
  document.getElementById("variety-switch")?.classList.toggle("on", state.varietyPlus);
}

function toggleSmea() {
  state.sm = !state.sm;
  if (!state.sm) state.smDyn = false;
  document.getElementById("smea-switch")?.classList.toggle("on", state.sm);
  document.getElementById("smea-dyn-switch")?.classList.toggle("on", state.smDyn);
}

function toggleSmeaDyn() {
  state.smDyn = !state.smDyn;
  if (state.smDyn) state.sm = true;
  document.getElementById("smea-switch")?.classList.toggle("on", state.sm);
  document.getElementById("smea-dyn-switch")?.classList.toggle("on", state.smDyn);
}

function toggleDecrisper() {
  state.decrisper = !state.decrisper;
  document.getElementById("decrisper-switch")?.classList.toggle("on", state.decrisper);
}

function updateStageInfoPill() {
  const spec = state.models[state.currentModel];
  const shortName = spec ? spec.short_name : "V5 Full";
  const el = document.getElementById("stage-info-pill");
  if (el) el.textContent = `${shortName} · ${state.width}×${state.height} · Steps ${state.steps}`;
}

let _costTimer = null;
let _costController = null;

function computeInstantCostBadge() {
  const spec = state.models[state.currentModel] || {};
  const pixels = Number(state.width || 832) * Number(state.height || 1216);
  const steps = Number(state.steps || 28);
  const hasRawVibe = state.vibes.some(v => Boolean(v.raw_image) && !v.encoding);
  const hasPreciseRef = Boolean(spec.supports_precise_ref && state.preciseRefs.length > 0);
  const isOpus = true;
  const baseOpusFree = isOpus && pixels <= 1048576 && steps <= 28;

  let extraAnlas = 0;
  if (hasPreciseRef) extraAnlas += 5;
  if (hasRawVibe && spec.supports_vibe && !spec.vibe_raw_image_free) extraAnlas += 2;
  if ((spec.family === "v4" || spec.family === "v4_5") && state.vibes.length > 4) {
    extraAnlas += (state.vibes.length - 4) * 2;
  }

  if (baseOpusFree && extraAnlas === 0) {
    return {
      is_opus_free: true,
      badge: spec.uses_v5_quota ? "0 Anlas · V5免费" : "0 Anlas · 无限免费",
    };
  }
  const baseCost = baseOpusFree ? 0 : Math.max(5, Math.round((pixels / 1048576) * (steps / 28) * 16));
  return {
    is_opus_free: false,
    badge: `预计消耗 ${baseCost + extraAnlas} Anlas`,
  };
}

function renderCostBadge(est) {
  const badge = document.getElementById("cost-estimate-badge");
  if (!badge || !est) return;
  badge.textContent = est.badge;
  badge.className = est.is_opus_free
    ? "hidden sm:inline-block text-[12px] px-2 py-1 rounded-[6px] ui-badge text-[var(--status-success)] font-mono whitespace-nowrap"
    : "hidden sm:inline-block text-[12px] px-2 py-1 rounded-[6px] ui-badge text-[var(--status-warning)] font-mono whitespace-nowrap";
}

function updateCostEstimate() {
  renderCostBadge(computeInstantCostBadge());
  const hasRawVibe = state.vibes.some(v => Boolean(v.raw_image) && !v.encoding);
  const spec = state.models[state.currentModel];
  const hasPreciseRef = Boolean(spec?.supports_precise_ref && state.preciseRefs.length > 0);

  clearTimeout(_costTimer);
  _costTimer = setTimeout(async () => {
    if (_costController) _costController.abort();
    _costController = new AbortController();
    try {
      const res = await fetch("/api/estimate-cost", {
        method: "POST",
        signal: _costController.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: state.currentModel,
          width: state.width,
          height: state.height,
          steps: state.steps,
          n_samples: 1,
          has_vibe_raw_encode: hasRawVibe,
          vibe_count: state.vibes.length,
          has_precise_ref: hasPreciseRef,
        }),
      });
      const est = await res.json();
      renderCostBadge(est);
    } catch (e) {}
  }, 120);
}

// ================= Prompt Linter, Weight Adjuster & Hybrid Tag Search =================
let _lintTimer = null;
let _lintController = null;
let _tagTimer = null;
let _tagController = null;

function syncPromptImmediateVisuals() {
  const ta = document.getElementById("prompt-input");
  const bd = document.getElementById("prompt-backdrop");
  if (!ta || !bd) return;
  if (!state.lastLintResult || state.lastLintResult._raw !== ta.value) {
    const escaped = escapeHtml(ta.value);
    bd.innerHTML = ta.value.endsWith("\n") ? `${escaped}\u200b` : escaped;
  }
  bd.scrollTop = ta.scrollTop;
  bd.scrollLeft = ta.scrollLeft;
  renderTagPillsBar();
  updateDynamicPromptIndicator();
}

function bindSwitchA11y() {
  document.querySelectorAll(".glass-switch").forEach(sw => {
    if (sw.dataset.a11yBound) return;
    sw.dataset.a11yBound = "1";
    sw.setAttribute("role", "switch");
    if (!sw.hasAttribute("tabindex")) sw.setAttribute("tabindex", "0");
    sw.setAttribute("aria-checked", sw.classList.contains("on") ? "true" : "false");
    sw.addEventListener("keydown", e => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        sw.click();
      }
    });
    const obs = new MutationObserver(() => {
      sw.setAttribute("aria-checked", sw.classList.contains("on") ? "true" : "false");
    });
    obs.observe(sw, { attributes: true, attributeFilter: ["class"] });
  });
}

function setupPromptListeners() {
  bindSwitchA11y();
  const ta = document.getElementById("prompt-input");
  const bd = document.getElementById("prompt-backdrop");
  if (ta && bd) {
    ta.addEventListener("input", () => {
      syncPromptImmediateVisuals();
      clearTimeout(_lintTimer);
      _lintTimer = setTimeout(() => {
        runPromptLinter();
      }, 80);
    });
    ta.addEventListener("scroll", () => {
      bd.scrollTop = ta.scrollTop;
      bd.scrollLeft = ta.scrollLeft;
    });
  }

  const searchIn = document.getElementById("tag-search-input");
  if (searchIn) {
    searchIn.addEventListener("input", () => {
      clearTimeout(_tagTimer);
      _tagTimer = setTimeout(() => queryTagSuggestions(searchIn.value), 60);
    });
    searchIn.addEventListener("focus", () => {
      if (searchIn.value.trim()) queryTagSuggestions(searchIn.value);
    });
  }
}

async function runPromptLinter() {
  const ta = document.getElementById("prompt-input");
  const bd = document.getElementById("prompt-backdrop");
  const btn = document.getElementById("lint-status-btn");
  const listEl = document.getElementById("lint-issues-list");
  if (!ta || !bd) return;

  const promptSnapshot = ta.value;
  if (_lintController) _lintController.abort();
  _lintController = new AbortController();

  try {
    const res = await fetch("/api/prompt/lint", {
      method: "POST",
      signal: _lintController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptSnapshot, model: state.currentModel }),
    });
    const data = await res.json();
    if (ta.value !== promptSnapshot) return;
    data._raw = promptSnapshot;
    state.lastLintResult = data;
    const rawHtml = data.highlighted_html || escapeHtml(ta.value);
    bd.innerHTML = ta.value.endsWith("\n") ? `${rawHtml}\u200b` : rawHtml;
    bd.scrollTop = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
    renderTagPillsBar();
    updateDynamicPromptIndicator();

    if (data.issue_count > 0) {
      btn.innerHTML = `${uiIcon("alert", "ui-ic-sm")}<span>发现 ${data.issue_count} 处可规范</span>`;
      btn.className = "spring-btn inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-[6px] ui-btn text-[var(--status-warning)] border-[var(--status-warning)]";
      listEl.innerHTML = data.issues
        .map(
          (iss, idx) => `
          <div class="flex items-center justify-between gap-2 py-1 px-2 rounded-[6px] ui-subgroup">
            <span class="truncate text-[var(--text-secondary)]">${escapeHtml(iss.message)}</span>
            <button onclick="applySingleLintFix(${idx})" class="shrink-0 text-[12px] px-2 py-1 rounded-[6px] ui-btn">修复</button>
          </div>
        `
        )
        .join("");
    } else {
      btn.innerHTML = `${uiIcon("check", "ui-ic-sm")}<span>格式规范</span>`;
      btn.className = "spring-btn inline-flex items-center gap-1 text-[12px] px-2 py-1 rounded-[6px] ui-btn text-[var(--status-success)]";
      document.getElementById("lint-drawer")?.classList.add("hidden");
    }
  } catch (e) {}
}

function toggleLintDrawer() {
  const dr = document.getElementById("lint-drawer");
  if (!dr) return;
  if (state.lastLintResult && state.lastLintResult.issue_count > 0) {
    dr.classList.toggle("hidden");
  } else {
    showToast("当前提示词完全符合 NovelAI 官方语法规范");
  }
}

function applyAllPromptFixes() {
  if (!state.lastLintResult) return;
  const ta = document.getElementById("prompt-input");
  state.promptUndoStack.push(ta.value);
  ta.value = state.lastLintResult.fixed_prompt;
  document.getElementById("undo-lint-btn")?.classList.remove("hidden");
  runPromptLinter();
  showToast("已一键规范所有提示词语法");
}

function applySingleLintFix(idx) {
  const issues = state.lastLintResult?.issues || [];
  const iss = issues[idx];
  if (!iss) return;
  const ta = document.getElementById("prompt-input");
  state.promptUndoStack.push(ta.value);
  ta.value = ta.value.slice(0, iss.start) + iss.replacement + ta.value.slice(iss.end);
  document.getElementById("undo-lint-btn")?.classList.remove("hidden");
  runPromptLinter();
}

function undoPromptFix() {
  if (!state.promptUndoStack.length) return;
  const ta = document.getElementById("prompt-input");
  ta.value = state.promptUndoStack.pop();
  if (!state.promptUndoStack.length) {
    document.getElementById("undo-lint-btn")?.classList.add("hidden");
  }
  runPromptLinter();
}

function toggleWeightMode() {
  const spec = state.models[state.currentModel];
  if (spec && !spec.supports_numeric_weight) {
    showToast("当前 V3 模型仅支持 {} 与 [] 括号权重语法");
    return;
  }
  state.weightMode = state.weightMode === "brackets" ? "numeric" : "brackets";
  document.getElementById("weight-mode-btn").textContent =
    state.weightMode === "numeric" ? "语法: 1.1::" : "语法: {}";
}

async function adjustSelectedWeight(delta) {
  const ta = document.getElementById("prompt-input");
  if (!ta) return;
  let start = ta.selectionStart;
  let end = ta.selectionEnd;
  const val = ta.value;

  // If no text is highlighted, automatically expand to the comma-separated tag at cursor
  if (start === end) {
    const leftComma = val.lastIndexOf(",", Math.max(0, start - 1));
    const rightComma = val.indexOf(",", start);
    start = leftComma === -1 ? 0 : leftComma + 1;
    end = rightComma === -1 ? val.length : rightComma;
  }
  const selected = val.slice(start, end).trim();
  if (!selected) {
    showToast("请先将光标放在某个标签上或选中标签");
    return;
  }

  try {
    const res = await fetch("/api/prompt/weight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: selected,
        delta,
        mode: state.weightMode,
        model: state.currentModel,
      }),
    });
    const data = await res.json();
    const prefixSpace = val.slice(start, end).startsWith(" ") ? " " : "";
    const replacement = prefixSpace + data.adjusted;
    ta.value = val.slice(0, start) + replacement + val.slice(end);
    ta.focus();
    ta.setSelectionRange(start + prefixSpace.length, start + replacement.length);
    runPromptLinter();
  } catch (e) {}
}

async function queryTagSuggestions(query) {
  const menu = document.getElementById("tag-suggestions-menu");
  if (!menu) return;
  const q = (query || "").trim();
  if (!q) {
    if (_tagController) _tagController.abort();
    menu.classList.add("hidden");
    return;
  }
  if (_tagController) _tagController.abort();
  _tagController = new AbortController();
  try {
    const res = await fetch(`/api/tags/suggest?q=${encodeURIComponent(q)}&model=${encodeURIComponent(state.currentModel)}`, {
      signal: _tagController.signal,
    });
    const data = await res.json();
    const tags = data.tags || [];
    if (!tags.length) {
      menu.classList.add("hidden");
      return;
    }
    menu.innerHTML = tags
      .map(
        t => `
        <button type="button" onclick="insertTagFromSearch('${escapeHtml(t.tag)}')" class="ui-menu-item w-full flex items-center justify-between px-3 py-2 text-left text-[12.5px]">
          <div>
            <span class="font-mono font-semibold text-[var(--text-primary)]">${escapeHtml(t.tag)}</span>
            <span class="ml-2 text-[12px] text-[var(--text-muted)]">${escapeHtml(t.cn || "")}</span>
          </div>
          <span class="text-[12px] font-mono text-[var(--text-muted)]">${t.count ? (t.count / 1000).toFixed(0) + "k" : t.cat || ""}</span>
        </button>
      `
      )
      .join("");
    menu.classList.remove("hidden");
  } catch (e) {}
}

function insertTagFromSearch(tag) {
  const ta = document.getElementById("prompt-input");
  const cur = ta.value.trim();
  ta.value = cur ? (cur.endsWith(",") ? `${cur} ${tag}` : `${cur}, ${tag}`) : tag;
  document.getElementById("tag-suggestions-menu")?.classList.add("hidden");
  document.getElementById("tag-search-input").value = "";
  syncPromptImmediateVisuals();
  runPromptLinter();
}

function renderSnippetsBar() {
  const bar = document.getElementById("snippets-bar");
  if (!bar) return;
  bar.innerHTML = state.snippets
    .map(s => {
      const cleanLabel = String(s.label || "").replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D\s]+/gu, "").trim() || s.label;
      const delBtn =
        s.cat === "custom"
          ? `<span onclick="event.stopPropagation();deleteSnippetRecord(${s.id})" class="ml-1 text-[var(--status-danger)] hover:opacity-80" title="删除自定义预设词条">×</span>`
          : "";
      return `
      <button type="button" onclick="toggleSnippetTag('${escapeHtml(s.tags)}')" class="spring-btn inline-flex items-center px-2 py-1 rounded-[6px] ui-btn text-[12px]" title="${escapeHtml(s.tags)}">
        <span>${escapeHtml(cleanLabel)}</span>${delBtn}
      </button>
    `;
    })
    .join("");
}

function toggleSnippetTag(tags) {
  const ta = document.getElementById("prompt-input");
  if (!ta) return;
  if (ta.value.includes(tags)) {
    ta.value = ta.value
      .replace(tags, "")
      .replace(/,\s*,+/g, ", ")
      .replace(/^\s*,\s*|\s*,\s*$/g, "");
  } else {
    const cur = ta.value.trim();
    ta.value = cur ? `${cur}, ${tags}` : tags;
  }
  syncPromptImmediateVisuals();
  runPromptLinter();
}

// ================= Multi-Character Positioning (V4 / V4.5 / V5) =================
const GRID_COORDS = [0.1, 0.3, 0.5, 0.7, 0.9];

function toggleUseCoords() {
  state.useCoords = !state.useCoords;
  const btn = document.getElementById("use-coords-btn");
  if (btn) {
    btn.innerHTML = `${uiIcon(state.useCoords ? "pin" : "compass", "ui-ic-sm")}<span>${state.useCoords ? "站位: 开" : "自动站位"}</span>`;
    btn.classList.toggle("is-active", state.useCoords);
  }
  renderCharacterSlots();
}

function addCharacterSlot() {
  if (state.characters.length >= 6) {
    showToast("最多支持添加 6 个快捷角色分控槽位");
    return;
  }
  const defaultX = state.characters.length % 2 === 0 ? 0.3 : 0.7;
  state.characters.push({
    prompt: state.characters.length === 0 ? "girl, silver hair, blue eyes, serafuku, smile" : "girl, black hair, red eyes, white dress",
    uc: "lowres, bad anatomy",
    x: defaultX,
    y: 0.5,
  });
  renderCharacterSlots();
}

function removeCharacterSlot(idx) {
  state.characters.splice(idx, 1);
  renderCharacterSlots();
}

function setCharCoord(idx, x, y) {
  if (!state.characters[idx]) return;
  state.characters[idx].x = x;
  state.characters[idx].y = y;
  renderCharacterSlots();
}

function appendCharInteraction(idx, tag) {
  if (!state.characters[idx]) return;
  const cur = state.characters[idx].prompt.trim();
  state.characters[idx].prompt = cur ? `${cur}, ${tag}` : tag;
  renderCharacterSlots();
}

function renderCharacterSlots() {
  const wrap = document.getElementById("char-slots-list");
  if (!wrap) return;
  if (!state.characters.length) {
    wrap.innerHTML = `<div class="text-[12.5px] text-[var(--text-muted)]">尚未添加角色分控。</div>`;
    renderCharStageOverlay();
    updateLeftRefsBadge();
    return;
  }
  wrap.innerHTML = state.characters
    .map((ch, idx) => {
      let gridHtml = "";
      if (state.useCoords) {
        gridHtml = `<div class="grid grid-cols-5 gap-1 p-2 rounded-[10px] ui-subgroup shrink-0" title="点击格子指定角色在画布中的 5×5 站位坐标">`;
        for (const gy of GRID_COORDS) {
          for (const gx of GRID_COORDS) {
            const act = Math.abs(ch.x - gx) < 0.08 && Math.abs(ch.y - gy) < 0.08;
            const cls = act ? "bg-[var(--cta-bg)] border border-[var(--cta-bg)]" : "bg-[var(--border-control)] hover:bg-[var(--border-hover)]";
            gridHtml += `<button type="button" onclick="setCharCoord(${idx}, ${gx}, ${gy})" class="w-3 h-3 rounded-[3px] ${cls}"></button>`;
          }
        }
        gridHtml += `</div>`;
      }
      return `
        <div class="rounded-[10px] ui-card p-3 space-y-2">
          <div class="flex items-center justify-between text-[12px]">
            <div class="flex items-center gap-2">
              ${ch.avatar_url ? `<img src="${escapeHtml(ch.avatar_url)}" alt="" class="w-5 h-5 rounded-[6px] object-cover border border-[var(--border-control)]" />` : ""}
              <span class="font-semibold text-[var(--text-primary)]">角色 #${idx + 1}${ch.oc_name ? ` · ${escapeHtml(ch.oc_name)}` : ""} ${state.useCoords ? `(X:${Number(ch.x).toFixed(2)} Y:${Number(ch.y).toFixed(2)})` : "(自动站位)"}</span>
            </div>
            <div class="flex items-center gap-1 text-[12px]">
              <button type="button" onclick="appendCharInteraction(${idx}, 'source#hugging')" class="px-2 py-1 rounded-[6px] ui-btn" title="主动动作">source#</button>
              <button type="button" onclick="appendCharInteraction(${idx}, 'target#hugging')" class="px-2 py-1 rounded-[6px] ui-btn" title="被动动作">target#</button>
              <button type="button" onclick="appendCharInteraction(${idx}, 'mutual#holding hands')" class="px-2 py-1 rounded-[6px] ui-btn" title="双方互动">mutual#</button>
              <button type="button" onclick="removeCharacterSlot(${idx})" class="ml-1 text-[var(--status-danger)] hover:underline">删除</button>
            </div>
          </div>
          <div class="flex items-start gap-2">
            ${gridHtml}
            <div class="flex-1 space-y-2">
              <textarea rows="2" oninput="state.characters[${idx}].prompt=this.value" placeholder="角色 #${idx + 1} 外貌、服饰与动作提示词..." class="char-prompt-ta w-full ui-well rounded-[6px] p-2 text-[12px] font-mono">${escapeHtml(ch.prompt)}</textarea>
              <input type="text" value="${escapeHtml(ch.uc)}" oninput="state.characters[${idx}].uc=this.value" placeholder="该角色专属排除词" class="w-full ui-well rounded-[6px] px-2 py-1 text-[12px] font-mono" />
            </div>
          </div>
        </div>
      `;
    })
    .join("");
  renderCharStageOverlay();
  updateLeftRefsBadge();
}

// ================= Vibe Transfer Handling =================
async function handleVibeUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch(`/api/vibe/parse?model=${encodeURIComponent(state.currentModel)}`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "解析失败");
    const added = (data.vibes || []).map(v => ({
      ...v,
      name: file.name,
      anlas_cost: data.anlas_cost || 0,
    }));
    state.vibes.push(...added);
    renderVibeList();
    updateCostEstimate();
    showToast(`已载入 ${added.length} 组 Vibe 参考（预计附加 ${data.anlas_cost || 0} Anlas）`);
  } catch (err) {
    showToast(err.message || "载入 Vibe 失败");
  }
  event.target.value = "";
}

function clearVibes() {
  state.vibes = [];
  renderVibeList();
  updateCostEstimate();
}

// Precise Reference (V4.5) Handling
function handlePreciseRefUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      state.preciseRefs.push({
        name: file.name,
        image: ev.target.result,
        mode: "character&style",
        strength: 1.0,
        fidelity: 1.0,
      });
      renderPreciseRefList();
      updateCostEstimate();
    };
    reader.readAsDataURL(file);
  });
  event.target.value = "";
}

function removePreciseRef(idx) {
  state.preciseRefs.splice(idx, 1);
  renderPreciseRefList();
  updateCostEstimate();
}

function renderPreciseRefList() {
  const wrap = document.getElementById("precise-refs-list");
  if (!wrap) return;
  updateLeftRefsBadge();
  if (!state.preciseRefs.length) {
    wrap.innerHTML = `<div class="text-[12px] text-[var(--muted-foreground)]">未添加精准参考图（适合锁定特定角色脸型与服装细节）</div>`;
    return;
  }
  wrap.innerHTML = state.preciseRefs
    .map(
      (r, i) => `
      <div class="p-2 rounded-[10px] ui-card space-y-2">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <img src="${r.image}" alt="" class="w-8 h-8 rounded-[6px] object-cover shrink-0 border border-[var(--border-control)]" />
            <span class="truncate font-mono text-[12px]">${escapeHtml(r.name || `Ref #${i + 1}`)}</span>
          </div>
          <select onchange="state.preciseRefs[${i}].mode=this.value" class="ui-well rounded-[6px] px-2 py-1 text-[12px]">
            <option value="character&style" ${r.mode === "character&style" ? "selected" : ""}>角色+画风</option>
            <option value="character" ${r.mode === "character" ? "selected" : ""}>仅角色</option>
            <option value="style" ${r.mode === "style" ? "selected" : ""}>仅画风</option>
          </select>
          <button type="button" onclick="removePreciseRef(${i})" class="text-[var(--status-danger)] text-[12px] shrink-0">移除</button>
        </div>
        <div class="grid grid-cols-2 gap-2 text-[12px]">
          <label class="flex items-center gap-1">强度 <input type="range" min="0.1" max="1.0" step="0.05" value="${r.strength}" oninput="state.preciseRefs[${i}].strength=parseFloat(this.value)" class="flex-1" /></label>
          <label class="flex items-center gap-1">保真 <input type="range" min="0.1" max="1.0" step="0.05" value="${r.fidelity}" oninput="state.preciseRefs[${i}].fidelity=parseFloat(this.value)" class="flex-1" /></label>
        </div>
      </div>
    `
    )
    .join("");
}

function renderVibeList() {
  const wrap = document.getElementById("vibe-items-list");
  const clearBtn = document.getElementById("vibe-clear-btn");
  if (!wrap) return;
  updateLeftRefsBadge();
  clearBtn?.classList.toggle("hidden", state.vibes.length === 0);
  if (!state.vibes.length) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = state.vibes
    .map(
      (v, i) => `
      <div class="p-2 rounded-[10px] ui-card space-y-1">
        <div class="flex justify-between text-[12px]">
          <span class="truncate font-mono">${escapeHtml(v.name || `Vibe #${i + 1}`)}</span>
          <span class="text-[var(--status-success)] font-mono">${v.encoding ? "已编码 0点数" : v.anlas_cost + " Anlas"}</span>
        </div>
        <div class="flex items-center gap-2 text-[12px]">
          <span>强度</span>
          <input type="range" min="0.1" max="1.0" step="0.05" value="${v.strength || 0.6}" oninput="state.vibes[${i}].strength=parseFloat(this.value)" class="flex-1" />
        </div>
      </div>
    `
    )
    .join("");
}

// ================= Workbench Action Modes (T2I, I2I, Inpaint, Outpaint, Director) =================
function setWorkbenchAction(act) {
  state.action = act;
  ["generate", "img2img", "infill", "outpaint"].forEach(k => {
    const btn = document.getElementById(`act-btn-${k}`);
    if (btn) {
      btn.className =
        k === act
          ? "spring-btn px-2 py-1 rounded-[6px] ui-btn-ghost is-active whitespace-nowrap"
          : "spring-btn px-2 py-1 rounded-[6px] ui-btn-ghost whitespace-nowrap";
    }
  });

  const modeLabels = {
    generate: "模式：文生图",
    img2img: "模式：图生图重绘",
    infill: "模式：局部涂抹重绘 (Inpaint)",
    outpaint: "模式：智能扩图 (Outpaint)",
  };
  document.getElementById("stage-mode-pill").textContent = modeLabels[act] || "模式：文生图";

  document.getElementById("i2i-toolbar")?.classList.toggle("hidden", act !== "img2img");
  document.getElementById("inpaint-toolbar")?.classList.toggle("hidden", act !== "infill");
  document.getElementById("outpaint-toolbar")?.classList.toggle("hidden", act !== "outpaint");
  const canvas = document.getElementById("inpaint-canvas");
  canvas?.classList.toggle("hidden", act !== "infill");
  document.getElementById("inpaint-cursor-ring")?.classList.add("hidden");
  if (act === "infill" && canvas) {
    const img = document.getElementById("stage-img");
    const targetW = (img && !img.classList.contains("hidden") && img.naturalWidth) ? img.naturalWidth : state.width;
    const targetH = (img && !img.classList.contains("hidden") && img.naturalHeight) ? img.naturalHeight : state.height;
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      state.inpaintUndoStack = [];
    }
  }
}

function toggleFocusInpaint() {
  state.focusInpaint = !state.focusInpaint;
  const btn = document.getElementById("focus-inpaint-btn");
  if (btn) {
    btn.textContent = state.focusInpaint ? "局部高清: 开" : "局部高清: 关";
    btn.className = state.focusInpaint
      ? "spring-btn px-2 py-1 rounded-[6px] ui-btn text-[var(--status-success)] text-[12px]"
      : "spring-btn px-2 py-1 rounded-[6px] ui-btn text-[var(--text-muted)] text-[12px]";
  }
}

function setOutpaintDir(dir) {
  state.outpaintDir = dir;
  document.querySelectorAll(".outpaint-dir-btn").forEach(b => {
    b.classList.toggle("is-active", b.dataset.dir === dir);
  });
}

async function urlToBase64(url) {
  const r = await fetch(url);
  const blob = await r.blob();
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function handleI2IFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    state.stageImageB64 = e.target.result;
    const img = document.getElementById("stage-img");
    img.src = e.target.result;
    img.classList.remove("hidden");
    document.getElementById("stage-empty")?.classList.add("hidden");
  };
  reader.readAsDataURL(file);
}

// Inpaint Canvas Setup (Continuous Brush + Eraser + Ctrl+Z Undo Stack)
function setInpaintMode(mode) {
  state.inpaintMode = mode === "eraser" ? "eraser" : "brush";
  document.getElementById("inpaint-brush-btn")?.classList.toggle("is-active", state.inpaintMode === "brush");
  document.getElementById("inpaint-eraser-btn")?.classList.toggle("is-active", state.inpaintMode === "eraser");
}

function pushInpaintUndo() {
  const canvas = document.getElementById("inpaint-canvas");
  if (!canvas) return;
  const snap = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  state.inpaintUndoStack.push(snap);
  if (state.inpaintUndoStack.length > 16) state.inpaintUndoStack.shift();
}

function undoInpaintStroke() {
  const canvas = document.getElementById("inpaint-canvas");
  if (!canvas || !state.inpaintUndoStack.length) {
    showToast("暂无可撤销的涂抹笔迹");
    return;
  }
  const snap = state.inpaintUndoStack.pop();
  canvas.getContext("2d").putImageData(snap, 0, 0);
}

function setupInpaintCanvas() {
  const canvas = document.getElementById("inpaint-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let drawing = false;
  let lastPt = null;

  const getPos = e => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const paintStroke = e => {
    if (!drawing) return;
    const pt = getPos(e);
    const radius = parseInt(document.getElementById("brush-size")?.value || "40", 10);
    ctx.save();
    ctx.globalCompositeOperation = state.inpaintMode === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = state.inpaintMode === "eraser" ? "rgba(0,0,0,1)" : "rgba(56, 189, 248, 0.58)";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = radius * 2;
    if (lastPt) {
      ctx.beginPath();
      ctx.moveTo(lastPt.x, lastPt.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    lastPt = pt;
  };

  const updateCursorRing = e => {
    const ring = document.getElementById("inpaint-cursor-ring");
    if (!ring || state.action !== "infill") return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const radius = parseInt(document.getElementById("brush-size")?.value || "40", 10);
    const pxDiameter = Math.max(8, (radius / canvas.width) * rect.width * 2);
    ring.style.width = `${pxDiameter}px`;
    ring.style.height = `${pxDiameter}px`;
    ring.style.left = `${e.clientX - rect.left + canvas.offsetLeft}px`;
    ring.style.top = `${e.clientY - rect.top + canvas.offsetTop}px`;
    ring.classList.toggle("eraser", state.inpaintMode === "eraser");
    ring.classList.remove("hidden");
  };

  canvas.addEventListener("pointerenter", updateCursorRing);
  canvas.addEventListener("pointerleave", () => {
    document.getElementById("inpaint-cursor-ring")?.classList.add("hidden");
  });
  canvas.addEventListener("pointerdown", e => {
    e.preventDefault();
    pushInpaintUndo();
    drawing = true;
    lastPt = null;
    updateCursorRing(e);
    paintStroke(e);
  });
  window.addEventListener("pointermove", e => {
    if (e.target === canvas) updateCursorRing(e);
    paintStroke(e);
  });
  window.addEventListener("pointerup", () => {
    drawing = false;
    lastPt = null;
  });
}

function clearInpaintMask() {
  const canvas = document.getElementById("inpaint-canvas");
  if (!canvas) return;
  pushInpaintUndo();
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
}

function exportBinaryInpaintMask() {
  const srcCanvas = document.getElementById("inpaint-canvas");
  const binCanvas = document.createElement("canvas");
  binCanvas.width = srcCanvas.width;
  binCanvas.height = srcCanvas.height;
  const bctx = binCanvas.getContext("2d");
  const sdata = srcCanvas.getContext("2d").getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const bdata = bctx.createImageData(srcCanvas.width, srcCanvas.height);
  for (let i = 0; i < sdata.data.length; i += 4) {
    const val = sdata.data[i + 3] > 20 ? 255 : 0;
    bdata.data[i] = val;
    bdata.data[i + 1] = val;
    bdata.data[i + 2] = val;
    bdata.data[i + 3] = 255;
  }
  bctx.putImageData(bdata, 0, 0);
  return binCanvas.toDataURL("image/png");
}

// ================= Real NovelAI Generation, Auto-Roll Queue & Director Tools =================
function buildGeneratePayload() {
  const promptVal = getActiveEffectivePrompt();
  const ucVal = document.getElementById("uc-input").value.trim();
  const seedVal = parseInt(document.getElementById("seed-input").value || "0", 10);
  const spec = state.models[state.currentModel];
  return {
    model: state.currentModel,
    action: state.action,
    prompt: promptVal,
    uc: ucVal,
    uc_preset: state.ucPreset,
    auto_quality_tags: state.autoQuality,
    alpha_transparency: state.alphaTransparency,
    width: state.width,
    height: state.height,
    steps: state.steps,
    scale: state.scale,
    cfg_rescale: state.cfg_rescale,
    sampler: state.sampler,
    scheduler: state.scheduler,
    seed: state.seedLocked ? seedVal : 0,
    lock_seed: state.seedLocked,
    variety_plus: state.varietyPlus,
    sm: state.sm,
    sm_dyn: state.smDyn,
    decrisper: state.decrisper,
    use_coords: state.useCoords,
    characters: state.characters,
    artist_mix: state.activeArtistMix,
    vibes: state.vibes,
    precise_refs: spec?.supports_precise_ref
      ? state.preciseRefs.map(({ image, mode, strength, fidelity }) => ({ image, mode, strength, fidelity }))
      : [],
    image: state.stageImageB64,
    strength: parseFloat(document.getElementById("i2i-strength")?.value || "0.65"),
    outpaint_direction: state.outpaintDir,
    focus_inpaint: state.focusInpaint,
  };
}

function setBatchCount(n) {
  state.batchCount = Number(n);
  document.querySelectorAll(".batch-btn").forEach(b => {
    const active = Number(b.dataset.batch) === state.batchCount;
    b.className = active
      ? "batch-btn px-2 py-1 rounded-[6px] font-mono bg-[var(--accent-tint)] text-[var(--text-primary)] font-semibold"
      : "batch-btn px-2 py-1 rounded-[6px] font-mono text-[var(--text-muted)]";
  });
}

async function triggerGenerate() {
  const btn = document.getElementById("generate-btn");
  const overlay = document.getElementById("generating-overlay");
  const statusText = document.getElementById("generating-status-text");

  if (state.action !== "generate" && !state.stageImageB64 && state.stageImageUrl) {
    state.stageImageB64 = await urlToBase64(state.stageImageUrl);
  }
  const payload = buildGeneratePayload();
  if (state.action === "infill") {
    payload.mask = exportBinaryInpaintMask();
  }

  // Batch / Infinite Auto-Roll Queue Path (when batchCount !== 1)
  if (state.batchCount !== 1 && state.action === "generate") {
    try {
      const res = await fetch("/api/queue/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, count: state.batchCount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "启动批量生成失败");
      startQueuePolling();
      showToast(state.batchCount === 0 ? "已开启持续自动生成" : `已开启 ${state.batchCount} 张连续自动生成`);
    } catch (err) {
      showToast(err.message || "队列启动失败");
    }
    return;
  }

  btn.disabled = true;
  overlay.classList.remove("hidden");
  statusText.textContent = `正在调用 ${state.models[state.currentModel]?.name || state.currentModel} 渲染图像...`;

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "生成失败");

    if (data.account) state.account = data.account;
    if (data.storage) state.storage = data.storage;
    if (data.item) {
      const newItems = Array.isArray(data.item.batch_items) ? data.item.batch_items : [data.item];
      state.gallery.unshift(...newItems);
      state.galleryTotal += newItems.length;
      state.galleryOffset += newItems.length;
      setStageFromGalleryItem(newItems[0], false);
      if (state.seedLocked) {
        document.getElementById("seed-input").value = String(newItems[0].seed);
      }
      savePromptSnapshot("自动保存");
    }

    renderAccountHeader();
    renderStorageBadges();
    renderWorkbenchHistory();
    renderFullGallery();
    showToast(`出图完成 (${data.item.generation_time}s) · 已保存至 D:\\NAI-Studio\\outputs`);
  } catch (err) {
    showToast(err.message || "生成失败", 4200);
  } finally {
    btn.disabled = false;
    overlay.classList.add("hidden");
  }
}

function startQueuePolling() {
  clearInterval(state.queuePollTimer);
  const stopBtn = document.getElementById("stop-queue-btn");
  const genBtn = document.getElementById("generate-btn");
  const artistStopBtn = document.getElementById("artist-backfill-stop-btn");
  const artistGenBtn = document.getElementById("artist-backfill-btn");
  stopBtn?.classList.remove("hidden");
  if (genBtn) genBtn.classList.add("hidden");

  const pollOnce = async () => {
    try {
      const res = await fetch("/api/queue/status");
      const data = await res.json();
      const q = data.queue || {};
      const isArtistQueue = q.queue_kind === "artist_backfill";
      const prog = document.getElementById("queue-progress-text");
      if (prog) {
        prog.textContent = q.total === 0 ? `${q.completed}/∞` : `${q.completed}/${q.total}`;
      }
      if (isArtistQueue) {
        artistStopBtn?.classList.toggle("hidden", !q.running);
        artistGenBtn?.classList.toggle("hidden", q.running);
        const aprog = document.getElementById("artist-backfill-progress");
        if (aprog) aprog.textContent = `${q.completed}/${q.total}`;
      }
      if (Array.isArray(data.artists)) {
        state.artists = data.artists;
        renderArtistsGrid();
      }
      if (Array.isArray(data.gallery) && data.gallery.length) {
        const prevTop = state.gallery[0]?.id;
        state.gallery = data.gallery;
        state.galleryTotal = Number(data.gallery_total ?? state.gallery.length);
        state.galleryOffset = state.gallery.length;
        state.galleryHasMore = state.galleryOffset < state.galleryTotal;
        if (state.storage && data.storage) state.storage = data.storage;
        renderStorageBadges();
        renderWorkbenchHistory();
        if (q.last_item && q.last_item.id !== prevTop && !isArtistQueue) {
          setStageFromGalleryItem(q.last_item, false);
        }
      }
      if (!q.running) {
        clearInterval(state.queuePollTimer);
        state.queuePollTimer = null;
        stopBtn?.classList.add("hidden");
        genBtn?.classList.remove("hidden");
        artistStopBtn?.classList.add("hidden");
        artistGenBtn?.classList.remove("hidden");
        if (q.last_item && q.queue_kind === "xyz_matrix") {
          setStageFromGalleryItem(q.last_item, false);
        }
        renderFullGallery();
        refreshAccountStatus(false);
        if (q.last_error) {
          showToast(`队列中止：${q.last_error}`, 4500);
        } else if (isArtistQueue) {
          showToast(`画师预览卡补齐完成，共更新 ${q.completed} 位画师`);
        } else if (q.queue_kind === "xyz_matrix") {
          showToast("X/Y 参数矩阵已完成并拼接大图");
        } else {
          showToast(`队列完成，共生成 ${q.completed} 张作品`);
        }
      }
    } catch (e) {}
  };
  pollOnce();
  state.queuePollTimer = setInterval(pollOnce, 1200);
}

async function stopAutoRollQueue() {
  await fetch("/api/queue/stop", { method: "POST" });
  showToast("正在等待当前这张出图完成后优雅停止...");
}

function toggleDirectorMenu() {
  document.getElementById("director-menu")?.classList.toggle("hidden");
}

async function runDirectorTool(reqType, extra = {}) {
  document.getElementById("director-menu")?.classList.add("hidden");
  if (!state.stageImageB64 && state.stageImageUrl) {
    state.stageImageB64 = await urlToBase64(state.stageImageUrl);
  }
  if (!state.stageImageB64) {
    showToast("请先生成或上传一张画布图像再执行 Director 工具");
    return;
  }

  const overlay = document.getElementById("generating-overlay");
  const statusText = document.getElementById("generating-status-text");
  overlay.classList.remove("hidden");
  statusText.textContent = `正在执行官方 Director 工具 (${reqType})...`;

  try {
    const res = await fetch("/api/augment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        req_type: reqType,
        image: state.stageImageB64,
        prompt: document.getElementById("prompt-input").value,
        emotion: extra.emotion || "happy",
        defry: extra.defry ?? 0,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Director 处理失败");
    if (data.item) {
      state.gallery.unshift(data.item);
      setStageFromGalleryItem(data.item, false);
    }
    if (data.account) state.account = data.account;
    if (data.storage) state.storage = data.storage;
    renderAccountHeader();
    renderStorageBadges();
    renderWorkbenchHistory();
    showToast(`Director (${reqType}) 处理完成 (0 Anlas)`);
  } catch (err) {
    showToast(err.message || "Director 工具执行失败", 4000);
  } finally {
    overlay.classList.add("hidden");
  }
}

// ================= Stage, History, Drag-Drop PNG Recipe Restore & Diff =================
function setStageFromGalleryItem(item, restoreRecipe = false) {
  if (!item) return;
  state.stageItemId = item.id ?? null;
  state.stageImageUrl = item.image_url;
  state.stageImageB64 = "";
  const img = document.getElementById("stage-img");
  const empty = document.getElementById("stage-empty");
  if (img) {
    img.src = item.image_url;
    img.classList.remove("hidden");
  }
  empty?.classList.add("hidden");

  const inpaintCanvas = document.getElementById("inpaint-canvas");
  if (inpaintCanvas) {
    inpaintCanvas.width = item.width || 832;
    inpaintCanvas.height = item.height || 1216;
  }

  document.querySelectorAll(".history-film-item").forEach(el => {
    el.classList.toggle("is-active-stage", Number(el.dataset.id) === Number(state.stageItemId));
  });

  if (restoreRecipe) {
    restoreRecipeToWorkbench(item);
  }
}

function restoreRecipeToWorkbench(item) {
  if (item.model && state.models[item.model]) {
    selectModel(item.model, false);
  }
  document.getElementById("prompt-input").value = item.prompt || "";
  document.getElementById("uc-input").value = item.uc || "";
  state.width = item.width || 832;
  state.height = item.height || 1216;
  state.steps = Math.min(28, item.steps || 28);
  state.scale = item.scale || 5.0;
  state.sampler = item.sampler || "k_euler_ancestral";
  state.scheduler = item.scheduler || "karras";
  state.characters = Array.isArray(item.characters) ? JSON.parse(JSON.stringify(item.characters)) : [];
  state.activeArtistMix = Array.isArray(item.artist_mix) ? JSON.parse(JSON.stringify(item.artist_mix)) : [];

  document.getElementById("steps-val").textContent = String(state.steps);
  document.getElementById("scale-val").textContent = Number(state.scale).toFixed(1);
  document.getElementById("seed-input").value = String(item.seed || 0);

  renderResolutionButtons();
  renderCharacterSlots();
  renderActiveArtistMixBar();
  runPromptLinter();
  updateStageInfoPill();
  updateCostEstimate();
  switchTab("workbench");
  showToast(`已载入生成参数 (Seed: ${item.seed || "随机"})`);
}

function renderWorkbenchHistory() {
  const wrap = document.getElementById("workbench-history-list");
  if (!wrap) return;
  if (!state.gallery.length) {
    wrap.innerHTML = `<div class="text-[12px] text-[var(--text-muted)] text-center py-8">暂无生成记录，点击「生成图片」开始创作</div>`;
    return;
  }
  wrap.innerHTML = state.gallery
    .slice(0, 24)
    .map(item => {
      const isActive = Number(state.stageItemId) === Number(item.id);
      return `
      <div data-id="${item.id}" class="history-film-item rounded-[8px] p-2 space-y-1.5 ${isActive ? "is-active-stage" : ""}">
        <div class="flex gap-2.5 cursor-pointer" onclick="setStageFromGalleryItem(state.gallery.find(x=>x.id===${item.id}), false)">
          <img src="${item.image_url}" alt="thumb" class="w-12 h-16 rounded-[5px] object-cover object-top shrink-0 border border-[var(--border-hairline)] bg-[var(--bg-canvas-well)]" />
          <div class="min-w-0 flex-1 flex flex-col justify-between py-0.5">
            <div class="flex items-center justify-between gap-1">
              <span class="text-[11px] px-1.5 py-0.5 rounded-[4px] ui-badge text-[var(--text-primary)] font-mono truncate">${escapeHtml(item.model_short)}</span>
              <span class="text-[11px] font-mono text-[var(--text-muted)]">#${item.seed}</span>
            </div>
            <p class="text-[11.5px] text-[var(--text-secondary)] line-clamp-2 font-mono leading-snug">${escapeHtml(item.prompt)}</p>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-1 text-[11.5px]">
          <button onclick="setStageFromGalleryItem(state.gallery.find(x=>x.id===${item.id}), true)" class="spring-btn py-0.5 rounded-[5px] ui-btn" title="加载此图的提示词与采样参数">载入参数</button>
          <button onclick="sendGalleryItemToI2I(${item.id})" class="spring-btn py-0.5 rounded-[5px] ui-btn" title="设为图生图底图">图生图</button>
          <button onclick="rerollGalleryItem(${item.id})" class="spring-btn py-0.5 rounded-[5px] ui-btn" title="保留参数并用新随机种子重新生成">重生成</button>
        </div>
      </div>
    `;
    })
    .join("");
}

function sendGalleryItemToI2I(id) {
  const item = state.gallery.find(x => x.id === id);
  if (!item) return;
  setStageFromGalleryItem(item, true);
  setWorkbenchAction("img2img");
  showToast("已将图片载入图生图画布");
}

function rerollGalleryItem(id) {
  const item = state.gallery.find(x => x.id === id);
  if (!item) return;
  restoreRecipeToWorkbench(item);
  randomizeSeed();
  triggerGenerate();
}

async function handleInspectPngUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await inspectPngFile(file);
  event.target.value = "";
}

async function handleStageDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) await inspectPngFile(file);
}

async function inspectPngFile(file) {
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/png/inspect", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "读取 PNG 失败");
    const meta = data.metadata;
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });

    if (meta.has_nai_metadata) {
      state.pendingInspectMeta = meta;
      state.pendingInspectB64 = dataUrl;
      openInspectPngModal(meta);
    } else {
      state.stageImageB64 = dataUrl;
      const img = document.getElementById("stage-img");
      img.src = dataUrl;
      img.classList.remove("hidden");
      document.getElementById("stage-empty")?.classList.add("hidden");
      showToast("已载入图片至画布（未检测到 NovelAI 内嵌参数，可直接用于图生图或 Director）");
    }
  } catch (err) {
    showToast(err.message || "解析图片失败");
  }
}

function openInspectPngModal(meta) {
  const sum = document.getElementById("inspect-png-summary");
  if (sum) {
    sum.innerHTML = `
      <div><span class="text-[var(--text-primary)] font-semibold">来源:</span> ${meta.metadata_source === "stealth_lsb" ? "Stealth Alpha 隐写层" : "PNG 原生元数据"} · 尺寸: ${meta.width || "?"}×${meta.height || "?"}</div>
      <div><span class="text-[var(--text-primary)] font-semibold">模型:</span> ${escapeHtml(meta.model || "未知")} · <span class="text-[var(--text-primary)] font-semibold">Seed:</span> #${meta.seed || 0} · Steps ${meta.steps || 28} · CFG ${meta.scale || 5.0}</div>
      <div class="pt-1 border-t border-[var(--border-hairline)]"><span class="text-[var(--status-success)] font-semibold">Prompt:</span> ${escapeHtml(meta.prompt || "(空)")}</div>
      ${meta.uc ? `<div><span class="text-[var(--status-danger)] font-semibold">UC:</span> ${escapeHtml(meta.uc)}</div>` : ""}
    `;
  }
  document.getElementById("inspect-png-modal")?.classList.remove("hidden");
}

function closeInspectPngModal() {
  document.getElementById("inspect-png-modal")?.classList.add("hidden");
  state.pendingInspectMeta = null;
  state.pendingInspectB64 = "";
}

function confirmInspectPngRestore() {
  const meta = state.pendingInspectMeta;
  const imgB64 = state.pendingInspectB64;
  if (!meta) return closeInspectPngModal();

  const usePrompt = document.getElementById("restore-chk-prompt")?.checked;
  const useUc = document.getElementById("restore-chk-uc")?.checked;
  const useParams = document.getElementById("restore-chk-params")?.checked;
  const useSeed = document.getElementById("restore-chk-seed")?.checked;
  const useI2I = document.getElementById("restore-chk-i2i")?.checked;

  const filtered = {};
  if (usePrompt) {
    filtered.prompt = meta.prompt || "";
    filtered.characters = meta.characters || [];
  }
  if (useUc) filtered.uc = meta.uc || "";
  if (useParams) {
    if (meta.model) filtered.model = meta.model;
    if (meta.width && meta.height) {
      filtered.width = meta.width;
      filtered.height = meta.height;
    }
    if (meta.steps) filtered.steps = meta.steps;
    if (meta.scale !== undefined) filtered.scale = meta.scale;
    if (meta.sampler) filtered.sampler = meta.sampler;
    if (meta.scheduler) filtered.scheduler = meta.scheduler;
  }
  if (useSeed && meta.seed) {
    filtered.seed = meta.seed;
  }

  restoreRecipeToWorkbench(filtered);
  if (useSeed && meta.seed) {
    state.seedLocked = true;
    updateSeedLockBtn();
  }

  if (imgB64) {
    state.stageImageB64 = imgB64;
    const img = document.getElementById("stage-img");
    if (img) {
      img.src = imgB64;
      img.classList.remove("hidden");
    }
    document.getElementById("stage-empty")?.classList.add("hidden");
    if (useI2I) setWorkbenchAction("img2img");
  }

  closeInspectPngModal();
  showToast("已按勾选项应用生成参数");
}

function downloadCurrentStageImage() {
  const url = state.stageImageUrl || document.getElementById("stage-img")?.src;
  if (!url) {
    showToast("当前画布暂无可保存图片");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = `nai_studio_${Date.now()}.png`;
  a.click();
}

function openDiffModal(idxA = 0, idxB = 1) {
  if (state.gallery.length < 2) {
    showToast("至少需要 2 条生成记录才能进行参数差异与卷帘对比");
    return;
  }
  const safeA = Math.min(Math.max(0, idxA), state.gallery.length - 1);
  const safeB = Math.min(Math.max(0, idxB), state.gallery.length - 1);
  const a = state.gallery[safeA];
  const b = state.gallery[safeB];
  const tagsA = new Set((a.prompt || "").split(",").map(s => s.trim()).filter(Boolean));
  const tagsB = new Set((b.prompt || "").split(",").map(s => s.trim()).filter(Boolean));
  const added = [...tagsA].filter(x => !tagsB.has(x));
  const removed = [...tagsB].filter(x => !tagsA.has(x));

  const optHtml = (selIdx) =>
    state.gallery
      .slice(0, 30)
      .map((it, i) => `<option value="${i}" ${i === selIdx ? "selected" : ""}>#${it.seed} · ${escapeHtml(it.model_short)} (${it.notes ? escapeHtml(it.notes) : escapeHtml(it.filename)})</option>`)
      .join("");

  document.getElementById("diff-content").innerHTML = `
    <div class="grid grid-cols-2 gap-3">
      <div class="p-3 rounded-[10px] ui-subgroup space-y-1">
        <div class="text-[var(--text-primary)] font-semibold">左侧图 A</div>
        <select onchange="openDiffModal(Number(this.value), ${safeB})" class="w-full ui-well rounded-[6px] px-2 py-1 text-[12px]">${optHtml(safeA)}</select>
        <div class="text-[12px] text-[var(--text-muted)] font-mono">${a.width}×${a.height} · Steps ${a.steps} · CFG ${a.scale} · ${escapeHtml(a.sampler)}</div>
      </div>
      <div class="p-3 rounded-[10px] ui-subgroup space-y-1">
        <div class="text-[var(--text-primary)] font-semibold">右侧图 B</div>
        <select onchange="openDiffModal(${safeA}, Number(this.value))" class="w-full ui-well rounded-[6px] px-2 py-1 text-[12px]">${optHtml(safeB)}</select>
        <div class="text-[12px] text-[var(--text-muted)] font-mono">${b.width}×${b.height} · Steps ${b.steps} · CFG ${b.scale} · ${escapeHtml(b.sampler)}</div>
      </div>
    </div>

    <div id="diff-swipe-box" class="diff-compare-wrap" onpointerdown="startDiffSwipe(event)" onpointermove="moveDiffSwipe(event)">
      <img src="${b.image_url}" alt="Image B" />
      <img id="diff-top-img" src="${a.image_url}" alt="Image A" style="clip-path: inset(0 50% 0 0);" />
      <div id="diff-divider" class="diff-compare-divider" style="left: 50%;"></div>
      <div id="diff-handle" class="diff-compare-handle" style="left: 50%;">⇆</div>
      <span class="absolute top-2 left-2 px-2 py-1 rounded-[6px] liquid-popover text-[12px] font-mono">A: #${a.seed}</span>
      <span class="absolute top-2 right-2 px-2 py-1 rounded-[6px] liquid-popover text-[12px] font-mono">B: #${b.seed}</span>
    </div>

    <div class="p-3 rounded-[10px] ui-subgroup space-y-1 font-mono">
      <div class="text-[var(--status-success)]">+ A 相比 B 新增 (${added.length})：${added.length ? escapeHtml(added.join(", ")) : "无变化"}</div>
      <div class="text-[var(--status-danger)]">− A 相比 B 移除 (${removed.length})：${removed.length ? escapeHtml(removed.join(", ")) : "无变化"}</div>
    </div>
  `;
  document.getElementById("diff-modal").classList.remove("hidden");
}

let _swipingDiff = false;
function startDiffSwipe(e) {
  _swipingDiff = true;
  moveDiffSwipe(e);
}
window.addEventListener("pointerup", () => {
  _swipingDiff = false;
});
function moveDiffSwipe(e) {
  if (!_swipingDiff) return;
  const box = document.getElementById("diff-swipe-box");
  if (!box) return;
  const r = box.getBoundingClientRect();
  const pct = Math.max(2, Math.min(98, ((e.clientX - r.left) / r.width) * 100));
  const topImg = document.getElementById("diff-top-img");
  const div = document.getElementById("diff-divider");
  const hdl = document.getElementById("diff-handle");
  if (topImg) topImg.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
  if (div) div.style.left = `${pct}%`;
  if (hdl) hdl.style.left = `${pct}%`;
}

// ================= Tab 2: Artist Catalog & Mixer =================
function filterArtistsByCat(cat) {
  state.artistCatFilter = cat;
  document.querySelectorAll(".artist-cat-btn").forEach(b => {
    b.classList.toggle("is-active", b.dataset.cat === cat);
  });
  renderArtistsGrid();
}

function renderArtistsGrid() {
  const grid = document.getElementById("artists-grid");
  if (!grid) return;
  const q = (document.getElementById("artist-search-input")?.value || "").trim().toLowerCase();

  const filtered = state.artists.filter(a => {
    if (state.artistCatFilter === "fav" && !a.favorite) return false;
    if (state.artistCatFilter !== "all" && state.artistCatFilter !== "fav" && a.category !== state.artistCatFilter) return false;
    if (q && !(a.name.toLowerCase().includes(q) || a.tag.toLowerCase().includes(q) || (a.desc || "").toLowerCase().includes(q))) {
      return false;
    }
    return true;
  });

  const renderKey = `${state.artistCatFilter}|${q}|${filtered.map(a => `${a.id}:${a.favorite ? 1 : 0}:${a.preview_url || ""}`).join(",")}`;
  if (grid.dataset.renderKey === renderKey) return;
  grid.dataset.renderKey = renderKey;

  grid.innerHTML = filtered
    .map(a => {
      const previewHtml = a.preview_url
        ? `<img src="${a.preview_url}" alt="${escapeHtml(a.name)}" class="w-full aspect-[4/5] object-cover object-top transition-opacity duration-150 group-hover:opacity-95" />`
        : `<div class="w-full aspect-[4/5] ui-stage-well flex flex-col items-center justify-center p-4 text-center border-b border-[var(--border-hairline)]">
             <div class="ui-title text-[var(--text-primary)]">${escapeHtml(a.name)}</div>
             <div class="text-[12px] font-mono text-[var(--text-secondary)] mt-1">${escapeHtml(a.tag)}</div>
             <div class="mt-3 text-[11.5px] px-2.5 py-1 rounded-[6px] ui-badge text-[var(--text-muted)]">点击「生成预览」制作示例图</div>
           </div>`;

      return `
        <div class="rounded-[10px] ui-card overflow-hidden flex flex-col group">
          <div class="relative shrink-0 aspect-[4/5] overflow-hidden bg-[var(--bg-canvas-well)]">
            ${previewHtml}
            <span class="absolute top-2 left-2 px-2 py-0.5 rounded-[5px] studio-hud text-[11.5px] font-medium">${escapeHtml(a.category)}</span>
            <button onclick="toggleArtistFav(${a.id})" aria-label="收藏画师" class="spring-btn absolute top-2 right-2 w-7 h-7 rounded-[6px] studio-hud flex items-center justify-center ${a.favorite ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}">
              ${uiIcon("star")}
            </button>
          </div>
          <div class="p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="ui-section truncate">${escapeHtml(a.name)}</span>
              <span class="selectable-text text-[11.5px] font-mono text-[var(--text-secondary)] truncate">${escapeHtml(a.tag)}</span>
            </div>
            <p class="text-[12px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">${escapeHtml(a.desc)}</p>
            <div class="grid grid-cols-3 gap-1.5 pt-1 text-[12px]">
              <button onclick="useSingleArtist('${escapeHtml(a.tag)}', '${escapeHtml(a.name)}')" class="spring-btn py-1 rounded-[6px] ui-btn">选用</button>
              <button onclick="addArtistToMixer('${escapeHtml(a.tag)}', '${escapeHtml(a.name)}')" class="spring-btn py-1 rounded-[6px] ui-btn">+ 混合</button>
              <button id="gen-card-btn-${a.id}" onclick="generateArtistCard(${a.id})" class="spring-btn py-1 rounded-[6px] ui-btn text-[var(--status-success)]" title="调用 NovelAI 接口 0点数生成该画师标准预览图">生成预览</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function toggleArtistFav(artistId) {
  const idx = state.artists.findIndex(x => x.id === artistId);
  if (idx === -1) return;
  const prevFav = Boolean(state.artists[idx].favorite);
  state.artists[idx].favorite = !prevFav;
  renderArtistsGrid();
  try {
    const res = await fetch(`/api/artists/${artistId}/favorite`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error("收藏同步失败");
    if (data.artist) {
      state.artists[idx] = data.artist;
      renderArtistsGrid();
    }
  } catch (e) {
    state.artists[idx].favorite = prevFav;
    renderArtistsGrid();
    showToast("收藏状态同步失败");
  }
}

async function generateArtistCard(artistId) {
  const btn = document.getElementById(`gen-card-btn-${artistId}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "生成中...";
  }
  showToast("正在调用 NovelAI (0 Anlas) 生成该画师标准预览图...");
  try {
    const res = await fetch(`/api/artists/${artistId}/generate-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nai-diffusion-4-5-full" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "生成预览图失败");
    if (data.artist) {
      const idx = state.artists.findIndex(x => x.id === artistId);
      if (idx !== -1) state.artists[idx] = data.artist;
      renderArtistsGrid();
      showToast(`已生成并保存 ${data.artist.name} 的画风预览图`);
    }
  } catch (err) {
    showToast(err.message || "生成预览图失败");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "生成预览";
    }
  }
}

function useSingleArtist(tag, name) {
  state.activeArtistMix = [{ tag, name, weight: 1.0 }];
  renderActiveArtistMixBar();
  switchTab("workbench");
  showToast(`已选用画师：${name} (${tag})`);
}

function addArtistToMixer(tag, name) {
  const existing = state.mixerItems.find(x => x.tag === tag);
  if (existing) {
    existing.weight = Math.min(2.0, Math.round((existing.weight + 0.1) * 10) / 10);
  } else {
    state.mixerItems.push({ tag, name, weight: 0.8 });
  }
  renderMixer();
  showToast(`已将 ${name} 加入右侧混合器`);
}

function formatMixString(items) {
  const spec = state.models[state.currentModel];
  const useNum = !spec || spec.supports_numeric_weight;
  return items
    .map(it => {
      const w = Number(it.weight || 1.0);
      if (useNum) {
        return Math.abs(w - 1.0) < 0.03 ? it.tag : `${w.toFixed(2).replace(/\.?0+$/, "")}::${it.tag}::`;
      } else {
        const steps = Math.max(-6, Math.min(6, Math.round(Math.log(w) / Math.log(1.05))));
        if (steps > 0) return "{".repeat(steps) + it.tag + "}".repeat(steps);
        if (steps < 0) return "[".repeat(Math.abs(steps)) + it.tag + "]".repeat(Math.abs(steps));
        return it.tag;
      }
    })
    .join(", ");
}

function updateMixerSlotWeight(idx, rawVal) {
  const it = state.mixerItems[idx];
  if (!it) return;
  const w = parseFloat(rawVal);
  it.weight = w;
  const weightEl = document.getElementById(`mixer-weight-${idx}`);
  if (weightEl) weightEl.textContent = Number(w).toFixed(2);
  const out = document.getElementById("mixer-preview-output");
  if (out) out.textContent = formatMixString(state.mixerItems);
  const wrap = document.getElementById("mixer-slots");
  if (wrap) {
    wrap.dataset.renderKey = state.mixerItems.map(x => `${x.tag}:${Number(x.weight).toFixed(2)}`).join("|") + `|${state.currentModel}`;
  }
}

function renderMixer() {
  const wrap = document.getElementById("mixer-slots");
  const out = document.getElementById("mixer-preview-output");
  if (!wrap || !out) return;

  const renderKey = state.mixerItems.map(x => `${x.tag}:${Number(x.weight).toFixed(2)}`).join("|") + `|${state.currentModel}`;
  if (wrap.dataset.renderKey === renderKey) return;
  wrap.dataset.renderKey = renderKey;

  if (!state.mixerItems.length) {
    wrap.innerHTML = `<div class="ui-body text-[var(--muted-foreground)] py-4 text-center">从左侧点击「+ 混合」添加多位画师调配比例</div>`;
    out.textContent = "尚未添加混合画师";
    return;
  }

  wrap.innerHTML = state.mixerItems
    .map(
      (it, idx) => `
      <div class="p-3 rounded-[10px] ui-card space-y-2">
        <div class="flex items-center justify-between ui-body">
          <span class="font-semibold">${escapeHtml(it.name)} <span class="text-[12px] font-mono text-[var(--text-muted)]">(${escapeHtml(it.tag)})</span></span>
          <button onclick="state.mixerItems.splice(${idx},1);renderMixer()" class="text-[12.5px] text-[var(--status-danger)]">移除</button>
        </div>
        <div class="flex items-center gap-3">
          <input type="range" min="0.1" max="2.0" step="0.05" value="${it.weight}" oninput="updateMixerSlotWeight(${idx}, this.value)" class="flex-1" />
          <span id="mixer-weight-${idx}" class="font-mono text-[13px] w-11 text-right text-[var(--text-primary)] tabular-nums">${Number(it.weight).toFixed(2)}</span>
        </div>
      </div>
    `
    )
    .join("");

  out.textContent = formatMixString(state.mixerItems);
}

function clearMixer() {
  state.mixerItems = [];
  renderMixer();
}

function applyMixerToWorkbench() {
  if (!state.mixerItems.length) {
    showToast("请先添加至少一位画师");
    return;
  }
  state.activeArtistMix = JSON.parse(JSON.stringify(state.mixerItems));
  renderActiveArtistMixBar();
  switchTab("workbench");
  showToast("已将多画师混合权重应用到工作台");
}

function renderActiveArtistMixBar() {
  const bar = document.getElementById("active-artist-mix-bar");
  const txt = document.getElementById("active-artist-mix-text");
  if (!bar || !txt) return;
  if (!state.activeArtistMix.length) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  txt.textContent = formatMixString(state.activeArtistMix);
}

function clearActiveArtistMix() {
  state.activeArtistMix = [];
  renderActiveArtistMixBar();
}

function renderMixPresets() {
  const wrap = document.getElementById("mix-presets-list");
  if (!wrap) return;
  wrap.innerHTML = state.mixPresets
    .map(
      p => `
      <div class="flex items-center justify-between gap-2 p-2 rounded-[10px] ui-card text-[13px]">
        <div class="truncate">
          <div class="font-medium truncate">${escapeHtml(p.name)}</div>
          <div class="text-[12px] font-mono text-[var(--text-muted)] truncate">${escapeHtml(formatMixString(p.items || []))}</div>
        </div>
        <button onclick='loadMixPreset(${JSON.stringify(p.items || [])})' class="spring-btn px-3 py-1 rounded-[6px] ui-btn text-[12px] shrink-0">载入</button>
      </div>
    `
    )
    .join("");
}

function loadMixPreset(items) {
  state.mixerItems = JSON.parse(JSON.stringify(items));
  renderMixer();
  showToast("已载入混合预设至画风混合器");
}

async function saveCurrentMixPreset() {
  if (!state.mixerItems.length) {
    showToast("混合器为空，无法保存");
    return;
  }
  const name = state.mixerItems.map(x => `${x.name}(${x.weight})`).join(" + ");
  const res = await fetch("/api/mix-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, items: state.mixerItems }),
  });
  const data = await res.json();
  if (data.preset) {
    state.mixPresets.unshift(data.preset);
    renderMixPresets();
    showToast(`已保存混合方案：${name}`);
  }
}

function toggleCustomArtistModal(show) {
  document.getElementById("custom-artist-modal")?.classList.toggle("hidden", !show);
}

async function submitNewArtist() {
  const name = document.getElementById("new-artist-name").value.trim();
  const tag = document.getElementById("new-artist-tag").value.trim();
  const desc = document.getElementById("new-artist-desc").value.trim();
  if (!tag) {
    showToast("请输入画师英文 Tag");
    return;
  }
  const btn = document.getElementById("create-artist-submit-btn");
  btn.disabled = true;
  btn.textContent = "正在生成预览...";
  try {
    const res = await fetch("/api/artists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tag, desc, category: "私人收藏", generate_preview: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "添加失败");
    if (data.artist) {
      const idx = state.artists.findIndex(x => x.id === data.artist.id);
      if (idx !== -1) state.artists[idx] = data.artist;
      else state.artists.unshift(data.artist);
      renderArtistsGrid();
      toggleCustomArtistModal(false);
      showToast(`已添加 ${data.artist.name} 并生成画风预览图`);
    }
  } catch (err) {
    showToast(err.message || "添加失败");
  } finally {
    btn.disabled = false;
    btn.textContent = "生成预览并添加 (0点数)";
  }
}

// ================= Tab 3: Full Local Gallery =================
let _gallerySearchTimer = null;
function debouncedGallerySearch() {
  clearTimeout(_gallerySearchTimer);
  _gallerySearchTimer = setTimeout(() => renderFullGallery(true), 140);
}

function toggleGalleryFavFilter() {
  state.galleryFavOnly = !state.galleryFavOnly;
  const btn = document.getElementById("gallery-fav-filter-btn");
  if (btn) {
    btn.innerHTML = `${uiIcon("star")}<span>${state.galleryFavOnly ? "已筛选收藏" : "仅看收藏"}</span>`;
    btn.classList.toggle("is-active", state.galleryFavOnly);
  }
  renderFullGallery(true);
}

async function fetchGalleryPage(offset = 0, append = false) {
  const q = (document.getElementById("gallery-search-input")?.value || "").trim();
  const model = document.getElementById("gallery-model-filter")?.value || "";
  const params = new URLSearchParams({
    limit: "24",
    offset: String(offset),
  });
  if (q) params.set("search", q);
  if (model) params.set("model", model);
  if (state.galleryFavOnly) params.set("favorite_only", "true");
  try {
    const res = await fetch(`/api/gallery?${params.toString()}`);
    const data = await res.json();
    const fetched = Array.isArray(data.items) ? data.items : [];
    state.galleryTotal = Number(data.total ?? fetched.length);
    state.galleryHasMore = Boolean(data.has_more);
    if (append) {
      const seen = new Set(state.gallery.map(x => x.id));
      state.gallery.push(...fetched.filter(x => !seen.has(x.id)));
      state.galleryOffset = offset + fetched.length;
    } else {
      state.gallery = fetched;
      state.galleryOffset = fetched.length;
    }
  } catch (e) {}
}

async function loadMoreGallery() {
  await fetchGalleryPage(state.galleryOffset, true);
  renderFullGallery(false);
}

async function renderFullGallery(reloadFromServer = false) {
  if (reloadFromServer) {
    await fetchGalleryPage(0, false);
  }
  const grid = document.getElementById("full-gallery-grid");
  if (!grid) return;
  const q = (document.getElementById("gallery-search-input")?.value || "").trim().toLowerCase();
  const modelFilter = document.getElementById("gallery-model-filter")?.value || "";

  const items = state.gallery.filter(it => {
    if (state.galleryFavOnly && !it.favorite) return false;
    if (modelFilter && it.model !== modelFilter) return false;
    if (
      q &&
      !(
        it.prompt.toLowerCase().includes(q) ||
        String(it.seed).includes(q) ||
        it.model_short.toLowerCase().includes(q) ||
        (it.notes || "").toLowerCase().includes(q)
      )
    ) {
      return false;
    }
    return true;
  });

  const countEl = document.getElementById("gallery-count-label");
  if (countEl) {
    countEl.textContent = `已加载 ${items.length} / 共 ${Math.max(state.galleryTotal, items.length)} 张作品`;
  }
  const loadMoreBtn = document.getElementById("gallery-load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle("hidden", !state.galleryHasMore && state.galleryOffset >= state.galleryTotal);
  }

  const renderKey = `${state.galleryFavOnly ? 1 : 0}|${modelFilter}|${q}|${state.galleryTotal}|${items.map(it => `${it.id}:${it.favorite ? 1 : 0}:${it.notes || ""}`).join(",")}`;
  if (grid.dataset.renderKey === renderKey) return;
  grid.dataset.renderKey = renderKey;

  if (!items.length) {
    grid.innerHTML = `<div class="col-span-full text-center py-12 ui-body text-[var(--muted-foreground)]">没有匹配的本地图库记录</div>`;
    return;
  }

  grid.innerHTML = items
    .map(
      it => `
      <div class="rounded-[10px] ui-card overflow-hidden flex flex-col group">
        <div class="relative shrink-0 overflow-hidden bg-[var(--bg-canvas-well)] aspect-[4/5] flex items-center justify-center">
          <img src="${it.image_url}" alt="artwork" class="w-full h-full object-contain transition-opacity duration-150 group-hover:opacity-95 cursor-pointer" onclick="setStageFromGalleryItem(state.gallery.find(x=>x.id===${it.id}), false);switchTab('workbench')" />
          <span class="absolute top-2 left-2 px-2 py-0.5 rounded-[5px] studio-hud text-[11.5px] font-mono text-[var(--text-primary)]">${escapeHtml(it.model_short)}</span>
          <button onclick="toggleGalleryFav(${it.id})" aria-label="收藏作品" class="spring-btn absolute top-2 right-2 w-7 h-7 rounded-[6px] studio-hud flex items-center justify-center ${it.favorite ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}">
            ${uiIcon("star")}
          </button>
        </div>
        <div class="p-3 space-y-2">
          <div class="flex items-center justify-between text-[12px] font-mono text-[var(--text-muted)]">
            <span>Seed #${it.seed}</span>
            <span>${it.width}×${it.height} · ${it.generation_time || 0}s</span>
          </div>
          ${it.notes ? `<div class="text-[11.5px] px-2 py-0.5 rounded-[5px] bg-[var(--accent-tint)] text-[var(--text-primary)] truncate inline-flex items-center gap-1 max-w-full">${uiIcon("edit", "ui-ic-sm")}<span>${escapeHtml(it.notes)}</span></div>` : ""}
          <p class="selectable-text text-[12px] font-mono text-[var(--text-secondary)] line-clamp-2 leading-snug">${escapeHtml(it.prompt)}</p>
          <div class="grid grid-cols-4 gap-1 pt-1 text-[12px]">
            <button onclick="setStageFromGalleryItem(state.gallery.find(x=>x.id===${it.id}), true)" class="spring-btn py-1 rounded-[6px] ui-btn" title="加载完整生成参数到工作台">载入</button>
            <button onclick="editGalleryNotes(${it.id})" class="spring-btn py-1 rounded-[6px] ui-btn">备注</button>
            <a href="${it.image_url}" download="${escapeHtml(it.filename)}" class="spring-btn py-1 rounded-[6px] ui-btn text-center">下载</a>
            <button onclick="deleteGalleryRecord(${it.id})" class="spring-btn py-1 rounded-[6px] ui-btn text-[var(--status-danger)]">删除</button>
          </div>
        </div>
      </div>
    `
    )
    .join("");
}

async function toggleGalleryFav(id) {
  const idx = state.gallery.findIndex(x => x.id === id);
  if (idx === -1) return;
  const prevFav = Boolean(state.gallery[idx].favorite);
  state.gallery[idx].favorite = !prevFav;
  renderFullGallery();
  try {
    const res = await fetch(`/api/gallery/${id}/favorite`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error("收藏同步失败");
    if (data.item) {
      state.gallery[idx] = data.item;
      renderFullGallery();
    }
  } catch (e) {
    state.gallery[idx].favorite = prevFav;
    renderFullGallery();
    showToast("收藏状态同步失败");
  }
}

async function deleteGalleryRecord(id) {
  const res = await fetch(`/api/gallery/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (data.storage) state.storage = data.storage;
  state.gallery = state.gallery.filter(x => x.id !== id);
  renderStorageBadges();
  renderWorkbenchHistory();
  renderFullGallery();
  showToast("已删除图库记录并释放 D 盘原图文件");
}

async function editGalleryNotes(id) {
  const item = state.gallery.find(x => x.id === id);
  if (!item) return;
  const next = window.prompt("请输入作品备注标签（方便搜索定位）：", item.notes || "");
  if (next === null) return;
  const res = await fetch(`/api/gallery/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: next }),
  });
  const data = await res.json();
  if (data.item) {
    const idx = state.gallery.findIndex(x => x.id === id);
    if (idx !== -1) state.gallery[idx] = data.item;
    renderFullGallery();
    showToast("已更新作品备注");
  }
}

async function syncGalleryFolder() {
  showToast("正在扫描 D:\\NAI-Studio\\outputs 同步磁盘原图...");
  const res = await fetch("/api/gallery/sync", { method: "POST" });
  const data = await res.json();
  if (Array.isArray(data.items)) state.gallery = data.items;
  if (data.storage) state.storage = data.storage;
  renderStorageBadges();
  renderWorkbenchHistory();
  renderFullGallery();
  showToast(`同步完成：新收录 ${data.imported || 0} 张，清理失效记录 ${data.pruned_missing || 0} 条`);
}

async function batchCleanGallery() {
  if (!window.confirm("确定要一键清理所有未收藏的图库记录与 D 盘对应原图文件吗？已收藏作品将完整保留。")) return;
  const res = await fetch("/api/gallery/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unfav_only: true, delete_file: true }),
  });
  const data = await res.json();
  if (data.storage) state.storage = data.storage;
  state.gallery = state.gallery.filter(x => x.favorite);
  renderStorageBadges();
  renderWorkbenchHistory();
  renderFullGallery();
  showToast(`已清理 ${data.removed || 0} 张未收藏图片`);
}

// ================= Tab 4: Settings & MCP Agent Playground =================
function populateSettingsForm() {
  const tokIn = document.getElementById("settings-token-input");
  const outIn = document.getElementById("settings-output-dir");
  if (tokIn) tokIn.value = state.config.api_token_masked || "";
  if (outIn) outIn.value = state.config.output_dir || "D:\\NAI-Studio\\outputs";
}

async function saveSettingsConfig() {
  const tok = document.getElementById("settings-token-input").value.trim();
  const outDir = document.getElementById("settings-output-dir").value.trim();
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_token: tok, output_dir: outDir }),
  });
  const data = await res.json();
  state.config = data.config || state.config;
  state.account = data.account || state.account;
  state.storage = data.storage || state.storage;
  renderAccountHeader();
  renderStorageBadges();
  populateSettingsForm();
  showToast("已保存配置并验证 NovelAI 官方连接");
}

async function runMcpTest(tool, args) {
  const out = document.getElementById("mcp-test-output");
  if (out) out.textContent = `正在调用 MCP 工具 ${tool}...`;
  try {
    const res = await fetch("/api/mcp/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, arguments: args }),
    });
    const data = await res.json();
    if (out) out.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    if (out) out.textContent = `调用失败: ${err.message}`;
  }
}

// ================= Custom Background Color & Water-Droplet Clarity =================
function hexToHsl(hex) {
  const clean = (hex || "#0b262c").replace("#", "");
  let r = parseInt(clean.slice(0, 2), 16) / 255;
  let g = parseInt(clean.slice(2, 4), 16) / 255;
  let b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function toggleBgMenu(force) {
  const m = document.getElementById("bg-menu");
  if (!m) return;
  m.classList.toggle("hidden", typeof force === "boolean" ? !force : !m.classList.contains("hidden"));
}

let _bgConfigTimer = null;
let _clarityConfigTimer = null;

function applyBgHex(hex, presetName = null, persist = true) {
  const lower = (hex || "").toLowerCase();
  const normalizedHex = !hex || lower === "#0b262c" || lower === "#0b0c0e" ? "#091319" : hex;
  state.config.bg_hex = normalizedHex;
  const picker = document.getElementById("bg-color-picker");
  const label = document.getElementById("bg-hex-label");
  if (picker) picker.value = normalizedHex;
  if (label) label.textContent = normalizedHex.toUpperCase();

  const [h, s, l] = hexToHsl(normalizedHex);
  const isLight = document.documentElement.classList.contains("light");
  const root = document.documentElement.style;
  const sat = Math.min(s, 36);

  if (normalizedHex === "#091319" && !presetName) {
    root.removeProperty("--bg-base");
    root.removeProperty("--bg-canvas-well");
  } else if (isLight) {
    root.setProperty("--bg-base", `hsl(${h}, ${Math.min(sat, 22)}%, 94%)`);
    root.setProperty("--bg-canvas-well", `hsl(${h}, ${Math.min(sat, 26)}%, 89%)`);
  } else {
    const baseL = Math.min(Math.max(l, 4), 12);
    root.setProperty("--bg-base", `hsl(${h}, ${sat}%, ${baseL}%)`);
    root.setProperty("--bg-canvas-well", `hsl(${h}, ${sat}%, ${Math.max(2, baseL - 3)}%)`);
  }

  setGlassClarity(state.config.glass_clarity || 88, false);
  if (presetName) showToast(`已切换背景色：${presetName}`);
  if (persist) {
    clearTimeout(_bgConfigTimer);
    _bgConfigTimer = setTimeout(() => {
      fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bg_hex: normalizedHex, bg_preset_name: presetName || "" }),
      });
    }, presetName ? 0 : 180);
  }
}

function setGlassClarity(val, persist = true) {
  const clarity = Number(val);
  state.config.glass_clarity = clarity;
  const valEl = document.getElementById("glass-clarity-val");
  const slider = document.getElementById("glass-clarity-slider");
  if (valEl) valEl.textContent = `${clarity}%`;
  if (slider) slider.value = String(clarity);

  const isLight = document.documentElement.classList.contains("light");
  const alpha = Math.max(0.56, Math.min(0.96, clarity / 100));
  const root = document.documentElement.style;
  const rgbaVal = isLight ? `rgba(255, 255, 255, ${alpha.toFixed(2)})` : `rgba(16, 20, 28, ${alpha.toFixed(2)})`;
  root.setProperty("--surface-glass", rgbaVal);
  root.setProperty("--surface-hud", rgbaVal);

  if (persist) {
    clearTimeout(_clarityConfigTimer);
    _clarityConfigTimer = setTimeout(() => {
      fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ glass_clarity: clarity }),
      });
    }, 180);
  }
}

function toggleTheme() {
  const rootEl = document.documentElement;
  rootEl.classList.add("theme-sync");
  const isLight = rootEl.classList.toggle("light");
  document.getElementById("theme-label").textContent = isLight ? "深色模式" : "浅色模式";
  document.getElementById("theme-icon-use")?.setAttribute("href", isLight ? "#ic-moon" : "#ic-sun");
  applyBgHex(state.config.bg_hex || "#091319", null, false);
  void rootEl.offsetHeight;
  requestAnimationFrame(() => rootEl.classList.remove("theme-sync"));
  fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme: isLight ? "light" : "dark" }),
  });
}

// ================= V2.1 Interactive Tag Pills & Dynamic Wildcard Preview =================
const QUICK_CN_HINTS = {
  "1girl": "单人女孩", "1boy": "单人男孩", "solo": "单人", "silver hair": "银发",
  "blue eyes": "蓝眼", "serafuku": "水手服", "sunset": "夕阳", "backlighting": "逆光",
  "wind": "微风", "detailed eyes": "精致瞳孔", "rooftop": "天台",
  "transparent background": "透明底", "masterpiece": "杰作", "best quality": "最佳画质"
};

function parsePromptSegments(text) {
  const parts = [];
  let buf = "";
  let depthCurly = 0;
  let depthSq = 0;
  for (const ch of String(text || "")) {
    if (ch === "{") depthCurly++;
    else if (ch === "}" && depthCurly > 0) depthCurly--;
    else if (ch === "[") depthSq++;
    else if (ch === "]" && depthSq > 0) depthSq--;

    if (ch === "," && depthCurly === 0 && depthSq === 0) {
      const t = buf.trim();
      if (t) parts.push(t);
      buf = "";
    } else {
      buf += ch;
    }
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function getActiveEffectivePrompt() {
  const raw = document.getElementById("prompt-input")?.value || "";
  if (!state.mutedTags || state.mutedTags.size === 0) return raw.trim();
  const kept = parsePromptSegments(raw).filter(seg => !state.mutedTags.has(seg.toLowerCase()));
  return kept.join(", ");
}

let _dragTagIdx = null;
function handleTagDragStart(idx, ev) {
  _dragTagIdx = idx;
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", String(idx));
  }
}
function handleTagDragOver(ev) {
  ev.preventDefault();
  ev.currentTarget?.classList.add("drag-over");
}
function handleTagDragLeave(ev) {
  ev.currentTarget?.classList.remove("drag-over");
}
function handleTagDrop(targetIdx, ev) {
  ev.preventDefault();
  ev.currentTarget?.classList.remove("drag-over");
  const fromIdx = _dragTagIdx;
  _dragTagIdx = null;
  if (fromIdx === null || fromIdx === targetIdx) return;
  const ta = document.getElementById("prompt-input");
  if (!ta) return;
  const segs = parsePromptSegments(ta.value);
  if (fromIdx < 0 || fromIdx >= segs.length || targetIdx < 0 || targetIdx >= segs.length) return;
  const [moved] = segs.splice(fromIdx, 1);
  segs.splice(targetIdx, 0, moved);
  ta.value = segs.join(", ");
  syncPromptImmediateVisuals();
  runPromptLinter();
}

function renderTagPillsBar() {
  const bar = document.getElementById("tag-pills-bar");
  const cnt = document.getElementById("prompt-token-count");
  const ta = document.getElementById("prompt-input");
  if (!bar || !ta) return;

  const segments = parsePromptSegments(ta.value);
  if (cnt) cnt.textContent = `${segments.length} tags` + (state.mutedTags.size ? ` (${state.mutedTags.size} 静音)` : "");
  if (!segments.length) {
    bar.innerHTML = `<span class="text-[12px] text-[var(--muted-foreground)]">输入提示词后自动生成可拖拽排序的 Tag 胶囊...</span>`;
    return;
  }

  bar.innerHTML = segments
    .map((seg, idx) => {
      const isMuted = state.mutedTags.has(seg.toLowerCase());
      const isWildcard = /\{[^}]*\|[^}]*\}|__[a-zA-Z0-9_\-]+__/.test(seg);
      const hasWeight = /^(\{+|\[+|-?\d+(?:\.\d+)?::)/.test(seg);
      const cleanKey = seg.replace(/^\{+|\[+|\}+|\]+$/g, "").replace(/^-?\d+(?:\.\d+)?::|::$/g, "").trim().toLowerCase();
      const cn = QUICK_CN_HINTS[cleanKey] || "";
      const cls = `tag-pill ${isMuted ? "muted" : ""} ${isWildcard ? "wildcard" : hasWeight ? "weighted" : ""}`;
      return `
        <span class="${cls}" draggable="true" ondragstart="handleTagDragStart(${idx}, event)" ondragover="handleTagDragOver(event)" ondragleave="handleTagDragLeave(event)" ondrop="handleTagDrop(${idx}, event)" onclick="toggleMuteTagPill('${escapeHtml(seg)}')" title="单击静音/恢复，拖拽调整词序，右侧 +/- 调权重">
          <span class="font-mono">${escapeHtml(seg)}</span>
          ${cn ? `<span class="tag-pill-cn">${escapeHtml(cn)}</span>` : ""}
          <button type="button" onclick="event.stopPropagation();adjustTagPillWeight(${idx}, 1)" class="px-1 rounded-[6px] hover:bg-[var(--accent-tint)] text-[12px] font-bold" title="增加权重">+</button>
          <button type="button" onclick="event.stopPropagation();adjustTagPillWeight(${idx}, -1)" class="px-1 rounded-[6px] hover:bg-[var(--accent-tint)] text-[12px] font-bold" title="降低权重">−</button>
        </span>
      `;
    })
    .join("");
}

function toggleMuteTagPill(seg) {
  const key = seg.toLowerCase();
  if (state.mutedTags.has(key)) state.mutedTags.delete(key);
  else state.mutedTags.add(key);
  renderTagPillsBar();
}

function clientAdjustTokenWeight(tok, delta) {
  const spec = state.models[state.currentModel];
  const useNum = state.weightMode === "numeric" && (!spec || spec.supports_numeric_weight);
  const clean = tok.replace(/^\{+|\[+|\}+|\]+$/g, "").replace(/^-?\d+(?:\.\d+)?::|::$/g, "").trim();
  if (!clean) return tok;

  if (useNum) {
    const m = tok.match(/^(-?\d+(?:\.\d+)?)::(.*?)::$/);
    let w = m ? parseFloat(m[1]) : 1.0;
    w = Math.max(0.2, Math.min(3.0, Math.round((w + delta * 0.1) * 100) / 100));
    return Math.abs(w - 1.0) < 0.02 ? clean : `${w}::${clean}::`;
  }
  let level = 0;
  if (tok.startsWith("{")) level = (tok.match(/^\{+/) || [""])[0].length;
  else if (tok.startsWith("[")) level = -((tok.match(/^\[+/) || [""])[0].length);
  level = Math.max(-6, Math.min(6, level + delta));
  if (level > 0) return "{".repeat(level) + clean + "}".repeat(level);
  if (level < 0) return "[".repeat(Math.abs(level)) + clean + "]".repeat(Math.abs(level));
  return clean;
}

function adjustTagPillWeight(idx, delta) {
  const ta = document.getElementById("prompt-input");
  if (!ta) return;
  const segs = parsePromptSegments(ta.value);
  if (idx < 0 || idx >= segs.length) return;
  segs[idx] = clientAdjustTokenWeight(segs[idx], delta);
  ta.value = segs.join(", ");
  syncPromptImmediateVisuals();
  runPromptLinter();
}

function updateDynamicPromptIndicator() {
  const ta = document.getElementById("prompt-input");
  const bar = document.getElementById("dynamic-prompt-bar");
  const prev = document.getElementById("dynamic-prompt-preview");
  if (!ta || !bar || !prev) return;
  const hasDyn = /\{[^}]*\|[^}]*\}|__[a-zA-Z0-9_\-]+__/.test(ta.value);
  bar.classList.toggle("hidden", !hasDyn);
  if (hasDyn) previewDynamicPrompt();
}

async function previewDynamicPrompt() {
  const ta = document.getElementById("prompt-input");
  const prev = document.getElementById("dynamic-prompt-preview");
  if (!ta || !prev) return;
  try {
    const res = await fetch("/api/prompt/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: ta.value }),
    });
    const data = await res.json();
    prev.textContent = data.expanded || ta.value;
  } catch (e) {}
}

// ================= V2.1 Inline Cursor Autocomplete =================
let _inlineTimer = null;
let _inlineController = null;

function getCursorTagFragment(el) {
  const pos = el.selectionStart || 0;
  const before = el.value.slice(0, pos);
  const lastSep = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n"));
  return {
    start: lastSep + 1,
    end: pos,
    frag: before.slice(lastSep + 1).trim(),
  };
}

function setupInlineAutocomplete() {
  const menu = document.getElementById("inline-autocomplete-menu");
  if (!menu) return;

  const handleInput = el => {
    state.inlineTarget = el;
    const { frag } = getCursorTagFragment(el);
    if (!frag || frag.length < 2) {
      clearTimeout(_inlineTimer);
      if (_inlineController) _inlineController.abort();
      menu.classList.add("hidden");
      state.inlineMatches = [];
      return;
    }
    if (frag.startsWith("__")) {
      clearTimeout(_inlineTimer);
      const wq = frag.replace(/_/g, "").toLowerCase();
      state.inlineMatches = (state.wildcards || [])
        .filter(w => !wq || w.name.toLowerCase().includes(wq))
        .map(w => ({ tag: w.token, cn: `词库通配符 (${w.count}项)`, cat: "Wildcard" }))
        .slice(0, 8);
      state.inlineSelIdx = 0;
      renderInlineMenu();
      return;
    }
    clearTimeout(_inlineTimer);
    _inlineTimer = setTimeout(async () => {
      if (_inlineController) _inlineController.abort();
      _inlineController = new AbortController();
      try {
        const res = await fetch(`/api/tags/suggest?q=${encodeURIComponent(frag)}&model=${encodeURIComponent(state.currentModel)}`, {
          signal: _inlineController.signal,
        });
        const data = await res.json();
        const matches = data.tags || [];
        state.inlineMatches = matches.slice(0, 8);
        state.inlineSelIdx = 0;
        renderInlineMenu();
      } catch (e) {}
    }, 55);
  };

  const handleKeyDown = (el, e) => {
    if (menu.classList.contains("hidden") || !state.inlineMatches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.inlineSelIdx = (state.inlineSelIdx + 1) % state.inlineMatches.length;
      renderInlineMenu();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.inlineSelIdx = (state.inlineSelIdx - 1 + state.inlineMatches.length) % state.inlineMatches.length;
      renderInlineMenu();
    } else if (e.key === "Tab" || (e.key === "Enter" && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      acceptInlineSuggestion(state.inlineSelIdx);
    } else if (e.key === "Escape") {
      menu.classList.add("hidden");
    }
  };

  ["prompt-input", "uc-input"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => handleInput(el));
    el.addEventListener("keydown", e => handleKeyDown(el, e));
  });

  document.getElementById("char-slots-list")?.addEventListener("input", e => {
    if (e.target.classList.contains("char-prompt-ta")) handleInput(e.target);
  });
}

function renderInlineMenu() {
  const menu = document.getElementById("inline-autocomplete-menu");
  if (!menu) return;
  if (state.inlineTarget?.parentElement?.classList.contains("relative") && menu.parentElement !== state.inlineTarget.parentElement) {
    state.inlineTarget.parentElement.appendChild(menu);
  }
  if (!state.inlineMatches.length) {
    menu.classList.add("hidden");
    return;
  }
  menu.innerHTML = state.inlineMatches
    .map(
      (m, i) => `
      <button type="button" onclick="acceptInlineSuggestion(${i})" class="ui-menu-item w-full flex items-center justify-between px-3 py-1 text-left text-[12.5px] ${
        i === state.inlineSelIdx ? "is-selected" : ""
      }">
        <div class="truncate">
          <span class="font-mono font-semibold text-[var(--text-primary)]">${escapeHtml(m.tag)}</span>
          <span class="ml-2 text-[var(--text-muted)]">${escapeHtml(m.cn || "")}</span>
        </div>
        <span class="text-[12px] font-mono text-[var(--text-muted)] shrink-0">${m.count ? (m.count / 1000).toFixed(0) + "k" : m.cat || ""}</span>
      </button>
    `
    )
    .join("");
  menu.classList.remove("hidden");
}

function acceptInlineSuggestion(idx) {
  const el = state.inlineTarget;
  const item = state.inlineMatches[idx];
  const menu = document.getElementById("inline-autocomplete-menu");
  if (!el || !item) return;
  const { start, end } = getCursorTagFragment(el);
  const leading = start > 0 && el.value[start - 1] === "," ? " " : "";
  const inserted = leading + item.tag;
  el.value = el.value.slice(0, start) + inserted + el.value.slice(end);
  const caret = start + inserted.length;
  el.focus();
  el.setSelectionRange(caret, caret);
  menu?.classList.add("hidden");
  state.inlineMatches = [];
  if (el.id === "prompt-input") runPromptLinter();
  else if (el.classList.contains("char-prompt-ta")) el.dispatchEvent(new Event("input"));
}

// ================= V2.1 Stage Zoom/Pan, Clipboard, Lightbox & Draggable Char Dots =================
function applyStageTransform() {
  const stage = document.getElementById("artwork-stage");
  const lbl = document.getElementById("stage-zoom-label");
  if (stage) {
    stage.style.transform = `translate(${state.stagePanX}px, ${state.stagePanY}px) scale(${state.stageZoom})`;
  }
  if (lbl) lbl.textContent = `${Math.round(state.stageZoom * 100)}%`;
}

function zoomStage(delta) {
  state.stageZoom = Math.max(0.5, Math.min(3.5, Math.round((state.stageZoom + delta) * 100) / 100));
  if (state.stageZoom <= 1.0) {
    state.stagePanX = 0;
    state.stagePanY = 0;
  }
  applyStageTransform();
}

function resetStageZoom() {
  state.stageZoom = 1;
  state.stagePanX = 0;
  state.stagePanY = 0;
  applyStageTransform();
}

function setupStageInteraction() {
  const wrap = document.getElementById("stage-pan-wrap");
  if (!wrap) return;
  let panning = false;
  let sx = 0,
    sy = 0,
    ox = 0,
    oy = 0;

  wrap.addEventListener(
    "wheel",
    e => {
      if (state.action === "infill") return;
      if (!document.getElementById("stage-img") || document.getElementById("stage-img").classList.contains("hidden")) return;
      e.preventDefault();
      zoomStage(e.deltaY < 0 ? 0.12 : -0.12);
    },
    { passive: false }
  );

  wrap.addEventListener("pointerdown", e => {
    if (state.stageZoom <= 1.0 || state.action === "infill" || e.target.closest(".char-stage-dot")) return;
    panning = true;
    sx = e.clientX;
    sy = e.clientY;
    ox = state.stagePanX;
    oy = state.stagePanY;
  });
  window.addEventListener("pointermove", e => {
    if (!panning) return;
    state.stagePanX = ox + (e.clientX - sx);
    state.stagePanY = oy + (e.clientY - sy);
    applyStageTransform();
  });
  window.addEventListener("pointerup", () => {
    panning = false;
  });
}

function toggleCheckerboard() {
  state.checkerboard = !state.checkerboard;
  document.getElementById("stage-dropzone")?.classList.toggle("checkerboard-bg", state.checkerboard);
  document.getElementById("lightbox-stage")?.classList.toggle("checkerboard-bg", state.checkerboard);
  document.getElementById("checkerboard-btn")?.classList.toggle("is-active", state.checkerboard);
}

async function copyStageImage() {
  const url = state.stageImageUrl || document.getElementById("stage-img")?.src;
  if (!url) {
    showToast("当前画布暂无可复制的图片");
    return;
  }
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      showToast("已将高清原图复制到剪贴板");
    } else {
      throw new Error("ClipboardItem 不可用");
    }
  } catch (err) {
    showToast("浏览器限制了直接写图片剪贴板，请右键图片复制或点击「保存」");
  }
}

function openLightbox(idx = null) {
  if (!state.gallery.length && !state.stageImageUrl) {
    showToast("当前暂无可全屏查看的图片");
    return;
  }
  if (idx === null) {
    const found = state.gallery.findIndex(g => g.image_url === state.stageImageUrl);
    state.lightboxIdx = found >= 0 ? found : 0;
  } else {
    state.lightboxIdx = Math.max(0, Math.min(idx, state.gallery.length - 1));
  }
  const item = state.gallery[state.lightboxIdx];
  const img = document.getElementById("lightbox-img");
  const cap = document.getElementById("lightbox-caption");
  if (img) img.src = item ? item.image_url : state.stageImageUrl;
  if (cap) {
    cap.textContent = item
      ? `[${state.lightboxIdx + 1}/${state.gallery.length}] ${item.model_short} · Seed #${item.seed} · ${item.width}×${item.height}`
      : "当前画布预览";
  }
  document.getElementById("lightbox-modal")?.classList.remove("hidden");
}

function navigateLightbox(step) {
  if (!state.gallery.length) return;
  const next = (state.lightboxIdx + step + state.gallery.length) % state.gallery.length;
  openLightbox(next);
}

function closeLightbox() {
  document.getElementById("lightbox-modal")?.classList.add("hidden");
}

function renderCharStageOverlay() {
  const overlay = document.getElementById("char-stage-overlay");
  if (!overlay) return;
  const spec = state.models[state.currentModel];
  const active = Boolean(spec?.supports_multi_char && state.useCoords && state.characters.length > 0 && state.action !== "infill");
  overlay.classList.toggle("hidden", !active);
  if (!active) {
    overlay.innerHTML = "";
    return;
  }
  const colors = [];
  overlay.innerHTML = state.characters
    .map(
      (ch, idx) => `
      <div class="char-stage-dot" data-cidx="${idx}" style="left:${(ch.x * 100).toFixed(1)}%;top:${(ch.y * 100).toFixed(1)}%;" title="拖拽调整角色 #${idx + 1} 在画布中的位置">
        ${idx + 1}
      </div>
    `
    )
    .join("");

  overlay.querySelectorAll(".char-stage-dot").forEach(dot => {
    dot.addEventListener("pointerdown", e => {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(dot.dataset.cidx);
      const rect = overlay.getBoundingClientRect();
      const onMove = mv => {
        const nx = Math.max(0.05, Math.min(0.95, (mv.clientX - rect.left) / rect.width));
        const ny = Math.max(0.05, Math.min(0.95, (mv.clientY - rect.top) / rect.height));
        state.characters[idx].x = Math.round(nx * 20) / 20;
        state.characters[idx].y = Math.round(ny * 20) / 20;
        dot.style.left = `${(state.characters[idx].x * 100).toFixed(1)}%`;
        dot.style.top = `${(state.characters[idx].y * 100).toFixed(1)}%`;
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        renderCharacterSlots();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  });
}

// ================= V2.1 Global Hotkeys & Clipboard PNG Paste =================
function setupGlobalHotkeys() {
  window.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      triggerGenerate();
      return;
    }
    if (e.key === "Escape") {
      closeLightbox();
      document.getElementById("diff-modal")?.classList.add("hidden");
      toggleOcModal(false);
      toggleSnippetModal(false);
      toggleCustomArtistModal(false);
      document.getElementById("inline-autocomplete-menu")?.classList.add("hidden");
      return;
    }
    const lbOpen = !document.getElementById("lightbox-modal")?.classList.contains("hidden");
    if (lbOpen) {
      if (e.key === "ArrowLeft") navigateLightbox(-1);
      if (e.key === "ArrowRight") navigateLightbox(1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && document.activeElement?.id === "prompt-input") {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        adjustSelectedWeight(1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        adjustSelectedWeight(-1);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && state.action === "infill") {
      const tag = document.activeElement?.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        undoInpaintStroke();
      }
    }
    const activeTag = document.activeElement?.tagName;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && activeTag !== "INPUT" && activeTag !== "TEXTAREA" && activeTag !== "SELECT") {
      if (e.key === "[") toggleLeftPanel();
      else if (e.key === "]") toggleRightPanel();
    }
  });

  window.addEventListener("paste", e => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = ev => {
          state.stageImageB64 = ev.target.result;
          const img = document.getElementById("stage-img");
          img.src = ev.target.result;
          img.classList.remove("hidden");
          document.getElementById("stage-empty")?.classList.add("hidden");
          setWorkbenchAction("img2img");
          showToast("已从剪贴板粘贴图像并切换至图生图模式");
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  });
}

// ================= V2.1 Director 24-Emotion Picker & Artist AB Test =================
function populateDirectorEmotions() {
  const sel = document.getElementById("director-emotion-select");
  if (!sel || !state.emotions.length) return;
  sel.innerHTML = state.emotions
    .map(em => `<option value="${escapeHtml(em.id)}">${escapeHtml(em.label)} (${escapeHtml(em.id)})</option>`)
    .join("");
}

function openDirectorEmotionBar() {
  document.getElementById("director-menu")?.classList.add("hidden");
  document.getElementById("director-emotion-bar")?.classList.toggle("hidden");
}

function executeSelectedEmotion() {
  const emotion = document.getElementById("director-emotion-select")?.value || "happy";
  const defry = parseInt(document.getElementById("director-defry-range")?.value || "0", 10);
  document.getElementById("director-emotion-bar")?.classList.add("hidden");
  runDirectorTool("emotion", { emotion, defry });
}

async function runArtistAbTest() {
  let candidates = state.mixerItems.length >= 2 ? state.mixerItems : state.artists.slice(0, 4).map(a => ({ tag: a.tag, name: a.name, weight: 1.0 }));
  if (!candidates.length) {
    showToast("请先至少添加 2 位画师到画风混合器后再执行对照测试");
    return;
  }
  const abList = candidates.slice(0, 8).map(c => ({ tag: c.tag, weight: c.weight || 1.0, label: c.name }));
  const fixedSeed = parseInt(document.getElementById("seed-input")?.value || "0", 10) || 39481022;
  document.getElementById("seed-input").value = String(fixedSeed);

  const payload = buildGeneratePayload();
  payload.seed = fixedSeed;
  payload.action = "generate";
  payload.ab_artists = abList;

  try {
    const res = await fetch("/api/queue/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "启动对照失败");
    switchTab("workbench");
    startQueuePolling();
    showToast(`已启动 ${abList.length} 位画师同 Seed (#${fixedSeed}) 对照跑图`);
  } catch (err) {
    showToast(err.message || "画师对照队列启动失败");
  }
}

// ================= V2.1 OC Character Cards & Snippets CRUD =================
function toggleOcModal(show) {
  document.getElementById("oc-modal")?.classList.toggle("hidden", !show);
  if (show) renderOcCardsList();
}

function fillOcFromCurrentPrompt() {
  const p = document.getElementById("prompt-input")?.value.trim() || "";
  const uc = document.getElementById("uc-input")?.value.trim() || "";
  document.getElementById("oc-prompt-input").value = p;
  document.getElementById("oc-uc-input").value = uc;
}

function renderOcCardsList() {
  const wrap = document.getElementById("oc-cards-list");
  if (!wrap) return;
  if (!state.ocCards.length) {
    wrap.innerHTML = `<div class="text-center py-6 text-[var(--muted-foreground)]">暂无 OC 角色卡，可在上方新建保存常用设定</div>`;
    return;
  }
  wrap.innerHTML = state.ocCards
    .map(
      c => `
      <div class="p-3 rounded-[10px] ui-card flex items-start gap-3">
        ${
          c.avatar_url
            ? `<img src="${escapeHtml(c.avatar_url)}" alt="" class="w-11 h-11 rounded-[6px] object-cover shrink-0 border border-[var(--border-control)]" />`
            : `<div class="w-11 h-11 rounded-[6px] ui-subgroup flex items-center justify-center text-[var(--text-muted)] shrink-0">${uiIcon("user")}</div>`
        }
        <div class="flex-1 min-w-0 space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-[var(--text-primary)] truncate">${escapeHtml(c.name)}</span>
            <div class="flex items-center gap-1 text-[12px] shrink-0">
              <button onclick="bindOcAvatarFromStage(${c.id})" class="spring-btn px-2 py-1 rounded-[6px] ui-btn" title="用当前画布图像作为该 OC 头像">设当前图为头像</button>
              <button onclick="injectOcAsCharSlot(${c.id})" class="spring-btn px-2 py-1 rounded-[6px] ui-btn">+ 添加至角色</button>
              <button onclick="injectOcIntoPrompt(${c.id})" class="spring-btn px-2 py-1 rounded-[6px] ui-btn">覆盖主提示词</button>
              <button onclick="deleteOcCardRecord(${c.id})" class="text-[var(--status-danger)] hover:underline px-1">删除</button>
            </div>
          </div>
          <div class="selectable-text font-mono text-[12px] text-[var(--text-muted)] line-clamp-2">${escapeHtml(c.prompt)}</div>
        </div>
      </div>
    `
    )
    .join("");
}

function handleOcAvatarFileSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    state.pendingOcAvatarB64 = ev.target.result;
    const prev = document.getElementById("oc-avatar-preview");
    if (prev) {
      prev.src = ev.target.result;
      prev.classList.remove("hidden");
    }
  };
  reader.readAsDataURL(file);
}

async function pickOcAvatarFromGallery() {
  if (!state.stageImageB64 && !state.stageImageUrl) {
    showToast("当前画布还没有图像哦");
    return;
  }
  const b64 = state.stageImageB64 || (await urlToBase64(state.stageImageUrl));
  state.pendingOcAvatarB64 = b64;
  const prev = document.getElementById("oc-avatar-preview");
  if (prev) {
    prev.src = b64;
    prev.classList.remove("hidden");
  }
  showToast("已选中当前画布作为新 OC 头像");
}

async function bindOcAvatarFromStage(cardId) {
  const body = state.stageImageUrl
    ? { image_url: state.stageImageUrl }
    : state.stageImageB64
    ? { image_b64: state.stageImageB64 }
    : null;
  if (!body) {
    showToast("当前画布没有可用图像");
    return;
  }
  const res = await fetch(`/api/oc-cards/${cardId}/avatar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (res.ok && data.card) {
    const idx = state.ocCards.findIndex(x => x.id === cardId);
    if (idx !== -1) state.ocCards[idx] = data.card;
    renderOcCardsList();
    showToast(`已更新「${data.card.name}」的头像`);
  } else {
    showToast(data.detail || "设置头像失败");
  }
}

async function submitNewOcCard() {
  const name = document.getElementById("oc-name-input").value.trim();
  const prompt = document.getElementById("oc-prompt-input").value.trim();
  const uc = document.getElementById("oc-uc-input").value.trim();
  if (!name || !prompt) {
    showToast("请填写 OC 名称与角色外貌 Prompt");
    return;
  }
  const res = await fetch("/api/oc-cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, prompt, uc }),
  });
  const data = await res.json();
  if (data.card) {
    let savedCard = data.card;
    if (state.pendingOcAvatarB64) {
      try {
        const avRes = await fetch(`/api/oc-cards/${savedCard.id}/avatar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_b64: state.pendingOcAvatarB64 }),
        });
        const avData = await avRes.json();
        if (avRes.ok && avData.card) savedCard = avData.card;
      } catch (e) {}
      state.pendingOcAvatarB64 = "";
      document.getElementById("oc-avatar-preview")?.classList.add("hidden");
    }
    const idx = state.ocCards.findIndex(x => x.id === savedCard.id);
    if (idx !== -1) state.ocCards[idx] = savedCard;
    else state.ocCards.unshift(savedCard);
    renderOcCardsList();
    document.getElementById("oc-name-input").value = "";
    showToast(`已保存 OC 角色卡：${savedCard.name}`);
  }
}

function injectOcAsCharSlot(id) {
  const card = state.ocCards.find(c => c.id === id);
  if (!card) return;
  if (state.characters.length >= 6) {
    showToast("多角色槽位已满 6 个");
    return;
  }
  const nextX = state.characters.length % 2 === 0 ? 0.3 : 0.7;
  state.characters.push({
    prompt: card.prompt,
    uc: card.uc || "",
    x: nextX,
    y: 0.5,
    avatar_url: card.avatar_url || "",
    oc_name: card.name || "",
  });
  renderCharacterSlots();
  toggleOcModal(false);
  showToast(`已将 OC「${card.name}」添加至角色 #${state.characters.length}`);
}

function injectOcIntoPrompt(id) {
  const card = state.ocCards.find(c => c.id === id);
  if (!card) return;
  document.getElementById("prompt-input").value = card.prompt;
  if (card.uc) document.getElementById("uc-input").value = card.uc;
  runPromptLinter();
  toggleOcModal(false);
  showToast(`已载入 OC「${card.name}」为主提示词`);
}

async function deleteOcCardRecord(id) {
  await fetch(`/api/oc-cards/${id}`, { method: "DELETE" });
  state.ocCards = state.ocCards.filter(c => c.id !== id);
  renderOcCardsList();
}

function toggleSnippetModal(show) {
  document.getElementById("snippet-modal")?.classList.toggle("hidden", !show);
}

async function submitNewSnippet() {
  const label = document.getElementById("snippet-label-input").value.trim();
  const tags = document.getElementById("snippet-tags-input").value.trim();
  if (!label || !tags) {
    showToast("请填写词条名称和对应 Tags");
    return;
  }
  const res = await fetch("/api/snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, tags, cat: "custom" }),
  });
  const data = await res.json();
  if (data.snippet) {
    state.snippets.push(data.snippet);
    renderSnippetsBar();
    toggleSnippetModal(false);
    document.getElementById("snippet-label-input").value = "";
    document.getElementById("snippet-tags-input").value = "";
    showToast(`已添加预设词条：${data.snippet.label}`);
  }
}

async function deleteSnippetRecord(id) {
  await fetch(`/api/snippets/${id}`, { method: "DELETE" });
  state.snippets = state.snippets.filter(s => s.id !== id);
  renderSnippetsBar();
}

// ================= V2.2 & V2.3: Immersion, Backfill, Wildcard Editor, XYZ Matrix & Snapshots =================
function toggleImmersionMode() {
  state.immersionMode = !state.immersionMode;
  const view = document.getElementById("view-workbench");
  const btn = document.getElementById("immersion-btn");
  if (view) view.classList.toggle("immersion-active", state.immersionMode);
  if (btn) {
    btn.innerHTML = `${uiIcon("maximize", "ui-ic-sm")}<span>${state.immersionMode ? "退出沉浸" : "沉浸"}</span>`;
    btn.classList.toggle("is-active", state.immersionMode);
  }
}

async function startArtistBackfillQueue() {
  const missing = state.artists.filter(a => !a.preview_url);
  if (!missing.length) {
    showToast("所有画师都已有预览图，无需补齐");
    return;
  }
  try {
    const res = await fetch("/api/queue/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist_backfill: true, model: "nai-diffusion-4-5-full" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "启动画师补齐队列失败");
    startQueuePolling();
    showToast(`已开启静默补齐队列：共 ${missing.length} 位缺失画师 (0 Anlas V4.5)`);
  } catch (err) {
    showToast(err.message || "启动失败");
  }
}

// --- Wildcard Online Editor ---
function toggleWildcardModal(show) {
  document.getElementById("wildcard-modal")?.classList.toggle("hidden", !show);
}

async function openWildcardModal() {
  toggleWildcardModal(true);
  try {
    const res = await fetch("/api/wildcards");
    const data = await res.json();
    state.wildcards = data.wildcards || [];
  } catch (e) {}
  renderWildcardFileList();
  if (state.wildcards.length && !state.currentWildcardName) {
    await selectWildcardFile(state.wildcards[0].name);
  } else if (state.currentWildcardName) {
    await selectWildcardFile(state.currentWildcardName);
  }
}

function renderWildcardFileList() {
  const wrap = document.getElementById("wildcard-file-list");
  if (!wrap) return;
  if (!state.wildcards.length) {
    wrap.innerHTML = `<div class="text-[12px] text-[var(--text-muted)] p-2">暂无词库文件，点击上方新建</div>`;
    return;
  }
  wrap.innerHTML = state.wildcards
    .map(
      w => `
      <button type="button" onclick="selectWildcardFile('${escapeHtml(w.name)}')" class="ui-menu-item w-full text-left px-3 py-2 text-[12px] flex items-center justify-between ${
        state.currentWildcardName === w.name ? "is-selected font-semibold" : ""
      }">
        <span class="font-mono truncate">${escapeHtml(w.token || `__${w.name}__`)}</span>
        <span class="text-[12px] text-[var(--text-muted)] font-mono shrink-0">${w.count || 0}行</span>
      </button>
    `
    )
    .join("");
}

async function selectWildcardFile(name) {
  state.currentWildcardName = name;
  renderWildcardFileList();
  try {
    const res = await fetch(`/api/wildcards/${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "读取失败");
    document.getElementById("wildcard-name-input").value = data.name || name;
    document.getElementById("wildcard-content-input").value = data.content || "";
    document.getElementById("wildcard-roll-preview")?.classList.add("hidden");
  } catch (err) {
    showToast(err.message || "读取词库失败");
  }
}

function newWildcardDraft() {
  state.currentWildcardName = "";
  document.getElementById("wildcard-name-input").value = "";
  document.getElementById("wildcard-content-input").value = "";
  document.getElementById("wildcard-roll-preview")?.classList.add("hidden");
  renderWildcardFileList();
  document.getElementById("wildcard-name-input").focus();
}

async function saveCurrentWildcard() {
  const name = document.getElementById("wildcard-name-input").value.trim();
  const content = document.getElementById("wildcard-content-input").value;
  if (!name) {
    showToast("请先输入词库英文文件名（如 hair_color）");
    return;
  }
  try {
    const res = await fetch("/api/wildcards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "保存失败");
    state.wildcards = data.wildcards || [];
    state.currentWildcardName = data.name;
    renderWildcardFileList();
    showToast(`已保存词库 ${data.token}（${data.count} 项）`);
  } catch (err) {
    showToast(err.message || "保存词库失败");
  }
}

async function deleteCurrentWildcard() {
  const name = document.getElementById("wildcard-name-input").value.trim() || state.currentWildcardName;
  if (!name) return;
  try {
    const res = await fetch(`/api/wildcards/${encodeURIComponent(name)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "删除失败");
    state.wildcards = data.wildcards || [];
    state.currentWildcardName = state.wildcards[0]?.name || "";
    renderWildcardFileList();
    if (state.currentWildcardName) await selectWildcardFile(state.currentWildcardName);
    else newWildcardDraft();
    showToast(`已删除词库 ${name}.txt`);
  } catch (err) {
    showToast(err.message || "删除失败");
  }
}

function testRollWildcard() {
  const raw = document.getElementById("wildcard-content-input").value || "";
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  const prev = document.getElementById("wildcard-roll-preview");
  if (!lines.length) {
    showToast("当前词库没有有效条目");
    return;
  }
  const picked = lines[Math.floor(Math.random() * lines.length)];
  if (prev) {
    prev.textContent = `试抽结果：${picked}`;
    prev.classList.remove("hidden");
  }
}

function insertCurrentWildcardToken() {
  const name = document.getElementById("wildcard-name-input").value.trim().replace(/\.txt$/i, "");
  if (!name) {
    showToast("请先选择或填写词库文件名");
    return;
  }
  const token = `__${name}__`;
  const ta = document.getElementById("prompt-input");
  if (ta) {
    const v = ta.value.trim();
    ta.value = v ? `${v}, ${token}` : token;
    runPromptLinter();
  }
  toggleWildcardModal(false);
  showToast(`已插入动态词库标签 ${token}`);
}

// --- X/Y Parameter Matrix ---
function toggleXyzModal(show) {
  document.getElementById("xyz-modal")?.classList.toggle("hidden", !show);
}

function openXyzModal() {
  toggleXyzModal(true);
  updateXyzCountPreview();
}

function applyXyzPreset(axis) {
  const typeEl = document.getElementById(`xyz-${axis}-type`);
  const valEl = document.getElementById(`xyz-${axis}-values`);
  if (!typeEl || !valEl) return;
  const presets = {
    none: "",
    scale: "4.0, 5.5, 7.0",
    steps: "16, 24, 28",
    sampler: "k_euler_ancestral, k_dpmpp_2m_sde, k_euler",
    prompt_prepend: "artist:rella, artist:ciloranko, artist:mika_pikazo",
  };
  valEl.value = presets[typeEl.value] ?? "";
  updateXyzCountPreview();
}

function parseXyzValues(axis) {
  const t = document.getElementById(`xyz-${axis}-type`)?.value || "none";
  if (t === "none") return [];
  const raw = document.getElementById(`xyz-${axis}-values`)?.value || "";
  return raw.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
}

function updateXyzCountPreview() {
  const xs = parseXyzValues("x");
  const ys = parseXyzValues("y");
  const cols = Math.max(1, xs.length || 1);
  const rows = Math.max(1, ys.length || 1);
  const el = document.getElementById("xyz-count-preview");
  if (el) el.textContent = `预计生成 ${cols * rows} 张并拼接 ${cols}×${rows} 矩阵大图`;
}

document.addEventListener("input", e => {
  if (e.target?.id === "xyz-x-values" || e.target?.id === "xyz-y-values") {
    updateXyzCountPreview();
  }
});

async function startXyzMatrixQueue() {
  const xType = document.getElementById("xyz-x-type").value;
  const yType = document.getElementById("xyz-y-type").value;
  const xVals = parseXyzValues("x");
  const yVals = yType === "none" ? [""] : parseXyzValues("y");
  if (!xVals.length || (yType !== "none" && !yVals.length)) {
    showToast("请至少填写 1 个有效的 X 轴参数值");
    return;
  }
  const basePayload = buildGeneratePayload();
  const basePrompt = basePayload.prompt || "";
  const applyAxisOverride = (overrides, axisType, val) => {
    if (!axisType || axisType === "none" || !val) return;
    if (axisType === "scale") overrides.scale = parseFloat(val);
    else if (axisType === "steps") overrides.steps = parseInt(val, 10);
    else if (axisType === "sampler") overrides.sampler = val;
    else if (axisType === "prompt_prepend") overrides.prompt = basePrompt ? `${val}, ${basePrompt}` : val;
  };

  const xyzJobs = [];
  const yLabels = yType === "none" ? ["Baseline"] : yVals.map(v => `${yType}:${v}`);
  const xLabels = xVals.map(v => `${xType}:${v}`);
  for (let r = 0; r < yVals.length; r++) {
    for (let c = 0; c < xVals.length; c++) {
      const overrides = {};
      applyAxisOverride(overrides, yType, yVals[r]);
      applyAxisOverride(overrides, xType, xVals[c]);
      xyzJobs.push({
        row_idx: r,
        col_idx: c,
        x_label: xLabels[c],
        y_label: yLabels[r],
        overrides,
      });
    }
  }
  if (xyzJobs.length > 16) {
    showToast("单次矩阵最多支持 16 个格位 (例如 4×4)");
    return;
  }
  toggleXyzModal(false);
  try {
    const fixedSeed = basePayload.seed || Math.floor(Math.random() * 2000000000) + 1;
    const res = await fetch("/api/queue/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...basePayload,
        seed: fixedSeed,
        xyz_jobs: xyzJobs,
        x_labels: xLabels,
        y_labels: yLabels,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "启动矩阵任务失败");
    startQueuePolling();
    showToast(`已启动 ${xLabels.length}×${yLabels.length} 参数矩阵 (Seed #${fixedSeed})`);
  } catch (err) {
    showToast(err.message || "启动矩阵失败");
  }
}

// --- Prompt Snapshots & Portable Recipe JSON ---
const SNAPSHOT_KEY = "nai_studio_prompt_snapshots_v1";

function loadPromptSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function savePromptSnapshot(label = "手动存档") {
  const prompt = (document.getElementById("prompt-input")?.value || "").trim();
  const uc = (document.getElementById("uc-input")?.value || "").trim();
  if (!prompt) return;
  const snaps = loadPromptSnapshots();
  if (snaps[0] && snaps[0].prompt === prompt && snaps[0].uc === uc) return;
  snaps.unshift({
    id: Date.now(),
    label,
    time: new Date().toLocaleString(),
    model: state.currentModel,
    width: state.width,
    height: state.height,
    steps: state.steps,
    scale: state.scale,
    sampler: state.sampler,
    scheduler: state.scheduler,
    prompt,
    uc,
  });
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snaps.slice(0, 30)));
  if (!document.getElementById("snapshot-modal")?.classList.contains("hidden")) {
    renderSnapshotList();
  }
}

function toggleSnapshotModal(show) {
  document.getElementById("snapshot-modal")?.classList.toggle("hidden", !show);
}

function openSnapshotModal() {
  toggleSnapshotModal(true);
  renderSnapshotList();
}

function renderSnapshotList() {
  const wrap = document.getElementById("snapshot-list");
  if (!wrap) return;
  const snaps = loadPromptSnapshots();
  if (!snaps.length) {
    wrap.innerHTML = `<div class="text-center py-6 text-[var(--muted-foreground)]">暂无草稿记录，每次生成或点击上方「+ 保存当前草稿」会自动存档</div>`;
    return;
  }
  wrap.innerHTML = snaps
    .map(
      (s, i) => `
      <div class="p-3 rounded-[10px] ui-card space-y-1">
        <div class="flex items-center justify-between text-[12px]">
          <span class="font-semibold text-[var(--text-primary)]">${escapeHtml(s.label)} · ${escapeHtml(s.time)}</span>
          <button onclick="restorePromptSnapshot(${i})" class="spring-btn px-2 py-1 rounded-[6px] ui-btn text-[12px]">加载此参数</button>
        </div>
        <div class="selectable-text font-mono text-[12px] text-[var(--text-muted)] line-clamp-2">${escapeHtml(s.prompt)}</div>
      </div>
    `
    )
    .join("");
}

function restorePromptSnapshot(idx) {
  const snaps = loadPromptSnapshots();
  const s = snaps[idx];
  if (!s) return;
  restoreRecipeToWorkbench(s);
  toggleSnapshotModal(false);
  showToast(`已恢复草稿：${s.time}`);
}

async function exportWorkbenchRecipeJson() {
  const payload = {
    model: state.currentModel,
    width: state.width,
    height: state.height,
    steps: state.steps,
    scale: state.scale,
    cfg_rescale: state.cfg_rescale,
    sampler: state.sampler,
    scheduler: state.scheduler,
    uc_preset: state.ucPreset,
    auto_quality_tags: state.autoQuality,
    prompt: document.getElementById("prompt-input")?.value || "",
    uc: document.getElementById("uc-input")?.value || "",
    characters: state.characters,
    artist_mix: state.activeArtistMix,
  };
  const jsonStr = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(jsonStr);
    showToast("完整参数 JSON 已复制到剪贴板");
  } catch (e) {
    window.prompt("复制下方参数 JSON：", jsonStr);
  }
}

function importWorkbenchRecipeJson() {
  const raw = window.prompt("请粘贴 NAI Studio 导出的参数 JSON 文本：");
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    restoreRecipeToWorkbench(obj);
    toggleSnapshotModal(false);
    showToast("已导入参数 JSON 至当前工作台");
  } catch (e) {
    showToast("JSON 格式解析失败，请检查粘贴内容是否完整");
  }
}

window.addEventListener("DOMContentLoaded", bootstrapApp);
