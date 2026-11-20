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
  artistEditingId: null,
  // Gallery pagination & view state (decoupled from Tab 1 workbench history)
  galleryFavOnly: false,
  galleryTotal: 0,
  galleryHasMore: false,
  galleryOffset: 0,
  galleryView: [],
  galleryViewTotal: 0,
  galleryViewOffset: 0,
  galleryViewHasMore: false,
  galleryViewDirty: false,
  galleryDensity: "comfortable",
  selectedGalleryIds: new Set(),
  lastSelectedGalleryId: null,
  galleryDetailId: null,
  // Toolbar Glass Select states + Dual Prompt Mode + LLM Agent
  artistSort: "fav_first",
  artistModalCategory: "私人收藏",
  galleryModelFilter: "",
  gallerySort: "newest",
  promptWorkspaceMode: "classic",
  llmModels: ["qwen4-max", "qwen3.8-max", "deepseek-v4-pro", "kimi-k3.1-pro", "glm-5.3-prime"],
  llmAgentBusy: false,

  // Linter & V2.1/V2.2/V2.3 Interactive State
  promptSide: "pos",
  lastLintResult: null,
  lastUcLintResult: null,
  promptUndoStack: [],
  ucUndoStack: [],
  mutedTags: new Set(),
  mutedUcTags: new Set(),
  canvasTexture: "dots",
  glassBlur: 18,
  activeGenController: null,
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
    menu.classList.remove("hidden", "drop-up", "glass-select-menu-end");
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom + 270 > window.innerHeight && rect.top > 240) {
      menu.classList.add("drop-up");
    }
    if (menu.classList.contains("glass-select-menu-auto")) {
      const mRect = menu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 12) {
        menu.classList.add("glass-select-menu-end");
      }
    }
    trigger.classList.add("open");
  }
}

function renderSimpleGlassSelect(id, options, selectedVal, handlerName) {
  const labelEl = document.getElementById(`${id}-label`);
  const menuEl = document.getElementById(`${id}-menu`);
  const current = options.find(o => String(o.value) === String(selectedVal)) || options[0];
  if (labelEl && current) labelEl.textContent = current.label;
  if (!menuEl) return;
  menuEl.innerHTML = options
    .map(opt => {
      const act = String(opt.value) === String(current?.value) ? "active" : "";
      const safeVal = escapeHtml(String(opt.value));
      return `
        <button type="button" onclick="${handlerName}('${safeVal}')" class="glass-select-option ${act}">
          <span class="truncate">${escapeHtml(opt.label)}</span>
          ${act ? '<span class="text-[11px] font-mono opacity-85 shrink-0">✓</span>' : ""}
        </button>
      `;
    })
    .join("");
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
  [
    ["tag-suggestions-menu", "tag-search-input"],
    ["uc-tag-suggestions-menu", "uc-tag-search-input"],
  ].forEach(([menuId, inputId]) => {
    const tagMenu = document.getElementById(menuId);
    if (tagMenu && !tagMenu.classList.contains("hidden")) {
      if (!e.target.closest(`#${menuId}`) && !e.target.closest(`#${inputId}`)) {
        tagMenu.classList.add("hidden");
      }
    }
  });
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
    state.galleryView = [...state.gallery];
    state.galleryViewOffset = state.galleryView.length;
    state.galleryViewTotal = state.galleryTotal;
    state.galleryViewHasMore = state.galleryOffset < state.galleryTotal;
    state.galleryViewDirty = false;
    state.artists = data.artists || [];
    state.mixPresets = data.mix_presets || [];
    state.snippets = data.snippets || [];
    state.emotions = data.emotions || [];
    state.ocCards = data.oc_cards || [];
    state.wildcards = data.wildcards || [];

    state.currentModel = state.config.default_model || "nai-diffusion-5-full";
    state.autoQuality = state.config.auto_quality_tags !== false;

    // Apply saved appearance (theme, presets, texture, glass clarity & blur)
    initAppearanceSettings(state.config);

    renderAccountHeader();
    renderStorageBadges();
    renderResolutionButtons();
    renderSnippetsBar();
    populateDirectorEmotions();
    selectModel(state.currentModel, false);

    renderWorkbenchHistory();
    initToolbarGlassSelects();
    renderArtistCatPills();
    renderArtistsGrid();
    renderMixer();
    renderMixPresets();
    renderFullGallery(false);
    populateSettingsForm();
    renderOcCardsList();
    setPromptWorkspaceMode(state.config.prompt_workspace_mode || "classic", false);

    // Load latest gallery image onto stage if available
    if (state.gallery.length > 0) {
      setStageFromGalleryItem(state.gallery[0], false);
    } else {
      updateStageActionButtons();
    }

    setupPromptListeners();
    setupInpaintCanvas();
    setupStageInteraction();
    setupInlineAutocomplete();
    setupGlobalHotkeys();
    setupFastTooltips();
    setupModalBackdropClose();
    initWorkspacePanels();
    switchInspectorTab("prompts");
    updateLeftRefsBadge();
    renderTagPillsBar("pos");
    renderTagPillsBar("uc");
    window.initStudioAgentWindow?.(data);
    if (data.queue?.running) {
      startQueuePolling();
    }
    switchTab("workbench");
    document.fonts?.ready?.then(() => updateActiveTabIndicator());
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

function setElementTooltip(el, text) {
  if (!el) return;
  if (el.hasAttribute("data-tip") || !el.hasAttribute("title")) {
    el.dataset.tip = text || "";
    el.removeAttribute("title");
  } else {
    el.title = text || "";
  }
}

function updatePanelToggleBtn(btn, collapsed, label) {
  if (!btn) return;
  btn.classList.toggle("is-panel-collapsed", collapsed);
  btn.setAttribute("aria-pressed", String(!collapsed));
  const shortcut = btn.id === "toggle-left-panel-btn" ? "[" : "]";
  setElementTooltip(btn, `${collapsed ? "展开" : "收起"}${label} (快捷键 ${shortcut})`);
}

function syncCollapsedGenerateVisibility() {
  const leftCollapsed = document.getElementById("left-panel")?.classList.contains("is-collapsed");
  const showQuickGen = Boolean(leftCollapsed || state.immersionMode);
  document.getElementById("collapsed-generate-btn")?.classList.toggle("hidden", !showQuickGen);
}

function toggleLeftPanel(force) {
  const panel = document.getElementById("left-panel");
  const resizer = document.getElementById("left-resizer");
  const btn = document.getElementById("toggle-left-panel-btn");
  if (!panel) return;
  if (state.immersionMode && force !== false) {
    toggleImmersionMode(false);
    panel.classList.remove("is-collapsed");
    resizer?.classList.remove("is-resizer-hidden");
    updatePanelToggleBtn(btn, false, "左侧参数栏");
    saveWorkspaceLayout({ leftCollapsed: false });
    syncCollapsedGenerateVisibility();
    return;
  }
  const nextCollapsed = typeof force === "boolean" ? !force : !panel.classList.contains("is-collapsed");
  panel.classList.toggle("is-collapsed", nextCollapsed);
  resizer?.classList.toggle("is-resizer-hidden", nextCollapsed);
  updatePanelToggleBtn(btn, nextCollapsed, "左侧参数栏");
  saveWorkspaceLayout({ leftCollapsed: nextCollapsed });
  syncCollapsedGenerateVisibility();
}

function toggleRightPanel(force) {
  const panel = document.getElementById("right-panel");
  const resizer = document.getElementById("right-resizer");
  const btn = document.getElementById("toggle-right-panel-btn");
  if (!panel) return;
  if (state.immersionMode && force !== false) {
    toggleImmersionMode(false);
    panel.classList.remove("is-collapsed");
    resizer?.classList.remove("is-resizer-hidden");
    updatePanelToggleBtn(btn, false, "右侧历史栏");
    saveWorkspaceLayout({ rightCollapsed: false });
    return;
  }
  const nextCollapsed = typeof force === "boolean" ? !force : !panel.classList.contains("is-collapsed");
  panel.classList.toggle("is-collapsed", nextCollapsed);
  resizer?.classList.toggle("is-resizer-hidden", nextCollapsed);
  updatePanelToggleBtn(btn, nextCollapsed, "右侧历史栏");
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
  state.promptSide = side === "uc" ? "uc" : "pos";
  ["pos", "uc"].forEach(id => {
    document.getElementById(`prompt-side-${id}`)?.classList.toggle("hidden", id !== state.promptSide);
  });
  document.querySelectorAll(".prompt-side-btn").forEach(btn => {
    const act = btn.dataset.promptSide === state.promptSide;
    btn.className = act
      ? "prompt-side-btn px-2 py-1 rounded-[5px] font-medium bg-[var(--cta-bg)] text-[var(--cta-fg)] transition-colors inline-flex items-center gap-1 whitespace-nowrap"
      : "prompt-side-btn px-2 py-1 rounded-[5px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors inline-flex items-center gap-1 whitespace-nowrap";
  });
  document.getElementById("inline-autocomplete-menu")?.classList.add("hidden");
  document.getElementById("lint-drawer")?.classList.add("hidden");
  updateLintDrawerForSide(state.promptSide);
  if (state.promptSide === "pos") {
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
function updateActiveTabIndicator(tabOverride = null) {
  const tab =
    tabOverride ||
    ["workbench", "artists", "gallery", "settings"].find(
      id => !document.getElementById(`view-${id}`)?.classList.contains("hidden")
    ) ||
    "workbench";
  const indicator = document.getElementById("tab-indicator");
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  document.querySelectorAll(".tab-btn").forEach(btn => {
    const isAct = btn.dataset.tab === tab;
    btn.style.color = isAct ? "var(--cta-fg)" : "var(--text-muted)";
  });
  if (activeBtn && indicator) {
    indicator.style.width = `${activeBtn.offsetWidth}px`;
    indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
  }
}

function switchTab(tab) {
  ["workbench", "artists", "gallery", "settings"].forEach(id => {
    const el = document.getElementById(`view-${id}`);
    if (el) el.classList.toggle("hidden", id !== tab);
  });
  const isWorkbench = tab === "workbench";
  document.getElementById("topbar-left-toggle-wrap")?.classList.toggle("hidden", !isWorkbench);
  document.getElementById("topbar-right-toggle-wrap")?.classList.toggle("hidden", !isWorkbench);

  updateActiveTabIndicator(tab);
  if (tab === "gallery") renderFullGallery(state.galleryViewDirty || state.galleryView.length === 0);
  if (tab === "artists") {
    renderArtistCatPills();
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
  if (navCnt) navCnt.textContent = String(state.galleryTotal || state.gallery.length);
  updateActiveTabIndicator();
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

  // 8. Re-lint Prompt & UC for the selected model & update stage info + cost estimate
  runPromptLinter("pos");
  runPromptLinter("uc");
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
  syncPromptImmediateVisuals("uc");
  runPromptLinter("uc");
  if (state.promptWorkspaceMode === "structured") syncClassicToStructured();
}

function clearUcPrompt() {
  const ta = document.getElementById("uc-input");
  if (!ta) return;
  state.ucUndoStack.push(ta.value);
  ta.value = "";
  syncPromptImmediateVisuals("uc");
  runPromptLinter("uc");
  if (state.promptWorkspaceMode === "structured") syncClassicToStructured();
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

// ================= Prompt Linter, Weight Adjuster & Hybrid Tag Search (Pos + UC Unified) =================
let _lintTimer = null;
let _ucLintTimer = null;
let _lintController = null;
let _ucLintController = null;
let _tagTimer = null;
let _tagController = null;

function getSideElements(side = state.promptSide) {
  const s = side === "uc" ? "uc" : "pos";
  return {
    side: s,
    ta: document.getElementById(s === "uc" ? "uc-input" : "prompt-input"),
    bd: document.getElementById(s === "uc" ? "uc-backdrop" : "prompt-backdrop"),
    pillsBar: document.getElementById(s === "uc" ? "uc-tag-pills-bar" : "tag-pills-bar"),
    countEl: document.getElementById(s === "uc" ? "uc-token-count" : "prompt-token-count"),
    mutedSet: s === "uc" ? state.mutedUcTags : state.mutedTags,
    searchInput: document.getElementById(s === "uc" ? "uc-tag-search-input" : "tag-search-input"),
    searchMenu: document.getElementById(s === "uc" ? "uc-tag-suggestions-menu" : "tag-suggestions-menu"),
    undoStack: s === "uc" ? state.ucUndoStack : state.promptUndoStack,
  };
}

function getSideLintResult(side = state.promptSide) {
  return side === "uc" ? state.lastUcLintResult : state.lastLintResult;
}

function parsePromptSegmentSpans(text) {
  const spans = [];
  const str = String(text || "");
  let segStart = 0;
  let depthCurly = 0;
  let depthSq = 0;
  const pushSpan = (rawStart, rawEnd) => {
    const rawSlice = str.slice(rawStart, rawEnd);
    const trimmed = rawSlice.trim();
    if (!trimmed) return;
    const leadWs = rawSlice.length - rawSlice.trimStart().length;
    const trailWs = rawSlice.length - rawSlice.trimEnd().length;
    spans.push({ start: rawStart + leadWs, end: rawEnd - trailWs, text: trimmed });
  };
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "{") depthCurly++;
    else if (ch === "}" && depthCurly > 0) depthCurly--;
    else if (ch === "[") depthSq++;
    else if (ch === "]" && depthSq > 0) depthSq--;
    else if (ch === "," && depthCurly === 0 && depthSq === 0) {
      pushSpan(segStart, i);
      segStart = i + 1;
    }
  }
  pushSpan(segStart, str.length);
  return spans;
}

function buildDecoratedMirrorHtml(rawText, lintData, mutedSet) {
  const str = String(rawText || "");
  const spans = [];
  if (lintData && lintData._raw === str && Array.isArray(lintData.issues)) {
    lintData.issues.forEach(iss => {
      if (typeof iss.start === "number" && typeof iss.end === "number" && iss.end > iss.start) {
        spans.push({
          start: Math.max(0, iss.start),
          end: Math.min(str.length, iss.end),
          cls: iss.severity === "error" ? "lint-mark-error" : "lint-mark-warn",
        });
      }
    });
  }
  if (mutedSet && mutedSet.size > 0) {
    parsePromptSegmentSpans(str).forEach(seg => {
      if (mutedSet.has(seg.text.toLowerCase())) {
        spans.push({ start: seg.start, end: seg.end, cls: "prompt-muted-mark" });
      }
    });
  }
  if (!spans.length) {
    const esc = escapeHtml(str);
    return str.endsWith("\n") ? `${esc}\u200b` : esc;
  }
  const cuts = new Set([0, str.length]);
  spans.forEach(sp => {
    cuts.add(sp.start);
    cuts.add(sp.end);
  });
  const pts = Array.from(cuts).sort((a, b) => a - b);
  let out = "";
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b <= a) continue;
    const classes = [];
    for (const sp of spans) {
      if (sp.start <= a && sp.end >= b && !classes.includes(sp.cls)) {
        classes.push(sp.cls);
      }
    }
    const frag = escapeHtml(str.slice(a, b));
    out += classes.length ? `<span class="${classes.join(" ")}">${frag}</span>` : frag;
  }
  return str.endsWith("\n") ? `${out}\u200b` : out;
}

function syncPromptImmediateVisuals(side = "pos") {
  const { ta, bd, mutedSet } = getSideElements(side);
  const lastLint = getSideLintResult(side);
  if (ta && bd) {
    bd.innerHTML = buildDecoratedMirrorHtml(ta.value, lastLint, mutedSet);
    bd.scrollTop = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
  }
  renderTagPillsBar(side);
  if (side === "pos") updateDynamicPromptIndicator();
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
  ["pos", "uc"].forEach(side => {
    const { ta, bd, searchInput } = getSideElements(side);
    if (ta && bd) {
      ta.addEventListener("input", () => {
        syncPromptImmediateVisuals(side);
        if (side === "uc") {
          clearTimeout(_ucLintTimer);
          _ucLintTimer = setTimeout(() => runPromptLinter("uc"), 80);
        } else {
          clearTimeout(_lintTimer);
          _lintTimer = setTimeout(() => runPromptLinter("pos"), 80);
        }
      });
      ta.addEventListener("scroll", () => {
        bd.scrollTop = ta.scrollTop;
        bd.scrollLeft = ta.scrollLeft;
      });
    }
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        clearTimeout(_tagTimer);
        _tagTimer = setTimeout(() => queryTagSuggestions(searchInput.value, side), 60);
      });
      searchInput.addEventListener("focus", () => {
        if (searchInput.value.trim()) queryTagSuggestions(searchInput.value, side);
      });
    }
  });
}

function updateLintDrawerForSide(side = state.promptSide) {
  const btn = document.getElementById("lint-status-btn");
  const listEl = document.getElementById("lint-issues-list");
  const undoBtn = document.getElementById("undo-lint-btn");
  const data = getSideLintResult(side);
  const { undoStack } = getSideElements(side);
  if (undoBtn) undoBtn.classList.toggle("hidden", undoStack.length === 0);
  if (!btn || !listEl || !data) return;

  if (data.issue_count > 0) {
    btn.innerHTML = `${uiIcon("alert", "ui-ic-sm")}<span>发现 ${data.issue_count} 处可规范</span>`;
    btn.className = "spring-btn inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-[6px] ui-btn text-[var(--status-warning)] border-[var(--status-warning)] shrink-0";
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
    btn.className = "spring-btn inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-[6px] ui-btn text-[var(--status-success)] shrink-0";
    document.getElementById("lint-drawer")?.classList.add("hidden");
  }
  const structPill = document.getElementById("structured-lint-pill");
  const structLbl = document.getElementById("structured-lint-label");
  const posLint = state.lastLintResult;
  if (structPill && structLbl && posLint) {
    if (posLint.issue_count > 0) {
      structPill.className = "spring-btn inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[5px] ui-btn text-[var(--status-warning)] border-[var(--status-warning)]";
      structLbl.textContent = `${posLint.issue_count} 处提醒`;
    } else {
      structPill.className = "spring-btn inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-[5px] ui-btn text-[var(--status-success)]";
      structLbl.textContent = "规范";
    }
  }
  window.refreshAgentLiveStrip?.();
}

async function runPromptLinter(side = "pos") {
  const { ta, bd } = getSideElements(side);
  if (!ta || !bd) return;

  const promptSnapshot = ta.value;
  if (side === "uc") {
    if (_ucLintController) _ucLintController.abort();
    _ucLintController = new AbortController();
  } else {
    if (_lintController) _lintController.abort();
    _lintController = new AbortController();
  }
  const signal = side === "uc" ? _ucLintController.signal : _lintController.signal;

  try {
    const res = await fetch("/api/prompt/lint", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: promptSnapshot, model: state.currentModel }),
    });
    const data = await res.json();
    if (ta.value !== promptSnapshot) return;
    data._raw = promptSnapshot;
    if (side === "uc") state.lastUcLintResult = data;
    else state.lastLintResult = data;

    const { mutedSet } = getSideElements(side);
    bd.innerHTML = buildDecoratedMirrorHtml(ta.value, data, mutedSet);
    bd.scrollTop = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
    renderTagPillsBar(side);
    if (side === "pos") updateDynamicPromptIndicator();
    if (side === state.promptSide) updateLintDrawerForSide(side);
  } catch (e) {}
}

function toggleLintDrawer() {
  const dr = document.getElementById("lint-drawer");
  if (!dr) return;
  const data = getSideLintResult(state.promptSide);
  if (data && data.issue_count > 0) {
    dr.classList.toggle("hidden");
  } else {
    showToast("当前提示词完全符合 NovelAI 官方语法规范");
  }
}

function applyAllPromptFixes() {
  const side = state.promptSide;
  const data = getSideLintResult(side);
  if (!data) return;
  const { ta, undoStack } = getSideElements(side);
  if (!ta) return;
  undoStack.push(ta.value);
  ta.value = data.fixed_prompt;
  document.getElementById("undo-lint-btn")?.classList.remove("hidden");
  runPromptLinter(side);
  showToast("已一键规范所有提示词语法");
}

function applySingleLintFix(idx) {
  const side = state.promptSide;
  const issues = getSideLintResult(side)?.issues || [];
  const iss = issues[idx];
  if (!iss) return;
  const { ta, undoStack } = getSideElements(side);
  if (!ta) return;
  undoStack.push(ta.value);
  ta.value = ta.value.slice(0, iss.start) + iss.replacement + ta.value.slice(iss.end);
  document.getElementById("undo-lint-btn")?.classList.remove("hidden");
  runPromptLinter(side);
}

function undoPromptFix() {
  const side = state.promptSide;
  const { ta, undoStack } = getSideElements(side);
  if (!ta || !undoStack.length) return;
  ta.value = undoStack.pop();
  if (!undoStack.length) {
    document.getElementById("undo-lint-btn")?.classList.add("hidden");
  }
  runPromptLinter(side);
}

function toggleWeightMode() {
  const spec = state.models[state.currentModel];
  if (spec && !spec.supports_numeric_weight) {
    showToast("当前 V3 模型仅支持 {} 与 [] 括号权重语法");
    return;
  }
  state.weightMode = state.weightMode === "brackets" ? "numeric" : "brackets";
  const label = state.weightMode === "numeric" ? "语法: 1.1::" : "语法: {}";
  document.querySelectorAll(".weight-mode-label").forEach(btn => {
    btn.textContent = label;
  });
}

async function adjustSelectedWeight(delta, side = state.promptSide) {
  const { ta } = getSideElements(side);
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
    runPromptLinter(side);
  } catch (e) {}
}

async function queryTagSuggestions(query, side = "pos") {
  const { searchMenu } = getSideElements(side);
  if (!searchMenu) return;
  const q = (query || "").trim();
  if (!q) {
    if (_tagController) _tagController.abort();
    searchMenu.classList.add("hidden");
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
      searchMenu.classList.add("hidden");
      return;
    }
    searchMenu.innerHTML = tags
      .map(
        t => `
        <button type="button" onclick="insertTagFromSearch('${escapeHtml(t.tag)}', '${side}')" class="ui-menu-item w-full flex items-center justify-between px-3 py-2 text-left text-[12.5px]">
          <div>
            <span class="font-mono font-semibold text-[var(--text-primary)]">${escapeHtml(t.tag)}</span>
            <span class="ml-2 text-[12px] text-[var(--text-muted)]">${escapeHtml(t.cn || "")}</span>
          </div>
          <span class="text-[12px] font-mono text-[var(--text-muted)]">${t.count ? (t.count / 1000).toFixed(0) + "k" : t.cat || ""}</span>
        </button>
      `
      )
      .join("");
    searchMenu.classList.remove("hidden");
  } catch (e) {}
}

function insertTagFromSearch(tag, side = "pos") {
  const { ta, searchMenu, searchInput } = getSideElements(side);
  if (!ta) return;
  const cur = ta.value.trim();
  ta.value = cur ? (cur.endsWith(",") ? `${cur} ${tag}` : `${cur}, ${tag}`) : tag;
  searchMenu?.classList.add("hidden");
  if (searchInput) searchInput.value = "";
  syncPromptImmediateVisuals(side);
  runPromptLinter(side);
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
  const genActionLabels = {
    generate: "生成图片",
    img2img: "执行图生图",
    infill: "生成局部重绘",
    outpaint: "执行智能扩图",
  };
  const genLbl = document.getElementById("generate-btn-label");
  if (genLbl) genLbl.textContent = genActionLabels[act] || "生成图片";

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
    setStageLocalImage(e.target.result);
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
  const ucVal = getActiveEffectiveUc();
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

let _genElapsedTimer = null;
let _genStartMs = 0;

function startGeneratingOverlay(statusLabel, metaLabel, subLabel) {
  const overlay = document.getElementById("generating-overlay");
  const statusEl = document.getElementById("generating-status-text");
  const metaEl = document.getElementById("generating-meta-text");
  const subEl = document.getElementById("generating-sub-text");
  const elapsedEl = document.getElementById("generating-elapsed");
  const cancelBtn = document.getElementById("cancel-generate-btn");

  if (statusEl) statusEl.textContent = statusLabel || "正在渲染画面…";
  if (metaEl) metaEl.textContent = metaLabel || `${state.models[state.currentModel]?.short_name || state.currentModel} · ${state.width}×${state.height} · ${state.steps} 步`;
  if (subEl) subEl.textContent = subLabel || `${computeInstantCostBadge().badge} · 自动落盘至 D:\\NAI-Studio\\outputs`;
  if (elapsedEl) elapsedEl.textContent = "0.0s";
  if (cancelBtn) cancelBtn.disabled = false;

  _genStartMs = performance.now();
  clearInterval(_genElapsedTimer);
  _genElapsedTimer = setInterval(() => {
    const el = document.getElementById("generating-elapsed");
    if (el) el.textContent = `${((performance.now() - _genStartMs) / 1000).toFixed(1)}s`;
  }, 100);

  overlay?.classList.remove("hidden");
}

function stopGeneratingOverlay() {
  clearInterval(_genElapsedTimer);
  _genElapsedTimer = null;
  state.activeGenController = null;
  document.getElementById("generating-overlay")?.classList.add("hidden");
}

function cancelActiveGeneration() {
  if (state.activeGenController) {
    state.activeGenController.abort();
    const cancelBtn = document.getElementById("cancel-generate-btn");
    if (cancelBtn) cancelBtn.disabled = true;
    showToast("已取消当前生成请求");
  }
}

async function triggerGenerate() {
  const btn = document.getElementById("generate-btn");

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

  const quickBtn = document.getElementById("collapsed-generate-btn");
  btn.disabled = true;
  if (quickBtn) quickBtn.disabled = true;
  if (state.activeGenController) state.activeGenController.abort();
  state.activeGenController = new AbortController();

  const spec = state.models[state.currentModel];
  const cost = computeInstantCostBadge();
  startGeneratingOverlay(
    `正在渲染画面…`,
    `${spec?.name || state.currentModel} · ${state.width}×${state.height} · Steps ${state.steps}`,
    `${cost.badge} · 自动落盘至 D:\\NAI-Studio\\outputs`
  );

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      signal: state.activeGenController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `生成失败 (${res.status})`);

    if (data.account) state.account = data.account;
    if (data.storage) state.storage = data.storage;
    if (data.item) {
      const newItems = Array.isArray(data.item.batch_items) ? data.item.batch_items : [data.item];
      state.gallery.unshift(...newItems);
      state.galleryTotal += newItems.length;
      state.galleryOffset += newItems.length;
      state.galleryView.unshift(...newItems);
      state.galleryViewTotal += newItems.length;
      state.galleryViewDirty = true;
      setStageFromGalleryItem(newItems[0], false);
      if (state.seedLocked) {
        document.getElementById("seed-input").value = String(newItems[0].seed);
      }
      savePromptSnapshot("自动保存");
    }

    renderAccountHeader();
    renderStorageBadges();
    renderWorkbenchHistory();
    renderFullGallery(false);
    showToast(`出图完成 (${data.item.generation_time}s) · 已保存至 D:\\NAI-Studio\\outputs`);
  } catch (err) {
    if (err?.name !== "AbortError") {
      showToast(err.message || "生成失败", 6000);
    }
  } finally {
    btn.disabled = false;
    if (quickBtn) quickBtn.disabled = false;
    stopGeneratingOverlay();
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
        renderArtistCatPills();
        renderArtistsGrid();
      }
      if (Array.isArray(data.gallery) && data.gallery.length) {
        const prevTop = state.gallery[0]?.id;
        state.gallery = data.gallery;
        state.galleryTotal = Number(data.gallery_total ?? state.gallery.length);
        state.galleryOffset = state.gallery.length;
        state.galleryHasMore = state.galleryOffset < state.galleryTotal;
        state.galleryViewDirty = true;
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

  if (state.activeGenController) state.activeGenController.abort();
  state.activeGenController = new AbortController();
  startGeneratingOverlay(
    `正在执行 Director 处理…`,
    `工具类型: ${reqType} · 保持原画布分辨率`,
    `0 Anlas · Opus 免费处理通道`
  );

  try {
    const res = await fetch("/api/augment", {
      method: "POST",
      signal: state.activeGenController.signal,
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
      state.galleryTotal += 1;
      state.galleryOffset += 1;
      state.galleryView.unshift(data.item);
      state.galleryViewTotal += 1;
      state.galleryViewDirty = true;
      setStageFromGalleryItem(data.item, false);
    }
    if (data.account) state.account = data.account;
    if (data.storage) state.storage = data.storage;
    renderAccountHeader();
    renderStorageBadges();
    renderWorkbenchHistory();
    showToast(`Director (${reqType}) 处理完成 (0 Anlas)`);
  } catch (err) {
    if (err?.name !== "AbortError") {
      showToast(err.message || "Director 工具执行失败", 4000);
    }
  } finally {
    stopGeneratingOverlay();
  }
}

// ================= Stage, History, Drag-Drop PNG Recipe Restore & Diff =================
function hasStageImage() {
  const img = document.getElementById("stage-img");
  const rawSrc = img?.getAttribute("src") || "";
  return Boolean(img && !img.classList.contains("hidden") && rawSrc && (state.stageImageUrl || state.stageImageB64));
}

function getActiveStageImageSource() {
  if (!hasStageImage()) return "";
  return state.stageImageB64 || state.stageImageUrl || "";
}

function updateStageActionButtons() {
  const active = hasStageImage();
  const zoomOutBtn = document.getElementById("stage-zoom-out-btn");
  const zoomResetBtn = document.getElementById("stage-zoom-label");
  const zoomInBtn = document.getElementById("stage-zoom-in-btn");
  const copyBtn = document.getElementById("stage-copy-btn");
  const downloadBtn = document.getElementById("stage-download-btn");
  const lightboxBtn = document.getElementById("stage-lightbox-btn");
  const panWrap = document.getElementById("stage-pan-wrap");

  if (zoomOutBtn) zoomOutBtn.disabled = !active || state.stageZoom <= 0.5;
  if (zoomInBtn) zoomInBtn.disabled = !active || state.stageZoom >= 3.5;
  if (zoomResetBtn) {
    zoomResetBtn.disabled = !active;
    const zoomed = active && Math.abs(state.stageZoom - 1) > 0.01;
    zoomResetBtn.classList.toggle("text-[var(--text-primary)]", zoomed);
    zoomResetBtn.classList.toggle("font-semibold", zoomed);
  }
  if (copyBtn) copyBtn.disabled = !active;
  if (downloadBtn) downloadBtn.disabled = !active;
  if (lightboxBtn) lightboxBtn.disabled = !active && state.gallery.length === 0;
  if (panWrap) panWrap.classList.toggle("can-pan", active && state.stageZoom > 1.0);
}

function handleStageImageError() {
  const img = document.getElementById("stage-img");
  if (img) {
    img.removeAttribute("src");
    img.classList.add("hidden");
  }
  state.stageImageUrl = "";
  state.stageImageB64 = "";
  state.stageItemId = null;
  document.getElementById("stage-empty")?.classList.remove("hidden");
  updateStageActionButtons();
}

function setStageLocalImage(dataUrl) {
  if (!dataUrl) return;
  state.stageItemId = null;
  state.stageImageUrl = "";
  state.stageImageB64 = dataUrl;
  const img = document.getElementById("stage-img");
  if (img) {
    img.src = dataUrl;
    img.classList.remove("hidden");
  }
  document.getElementById("stage-empty")?.classList.add("hidden");
  document.querySelectorAll(".history-film-item.is-active-stage").forEach(el => {
    el.classList.remove("is-active-stage");
  });
  resetStageZoom();
  updateStageActionButtons();
}

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
  updateStageActionButtons();

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
  if (state.promptWorkspaceMode === "structured") syncClassicToStructured();

  renderResolutionButtons();
  renderCharacterSlots();
  renderActiveArtistMixBar();
  syncPromptImmediateVisuals("pos");
  syncPromptImmediateVisuals("uc");
  runPromptLinter("pos");
  runPromptLinter("uc");
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
          <img src="${item.image_url}" alt="" onerror="this.onerror=null;this.style.opacity='0.28';" class="w-12 h-16 rounded-[5px] object-cover object-top shrink-0 border border-[var(--border-hairline)] bg-[var(--bg-canvas-well)]" />
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

function findGalleryItemById(id) {
  return state.gallery.find(x => x.id === id) || state.galleryView.find(x => x.id === id) || null;
}

function sendGalleryItemToI2I(id) {
  const item = findGalleryItemById(id);
  if (!item) return;
  setStageFromGalleryItem(item, true);
  setWorkbenchAction("img2img");
  showToast("已将图片载入图生图画布");
}

function rerollGalleryItem(id) {
  const item = findGalleryItemById(id);
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
      setStageLocalImage(dataUrl);
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
    setStageLocalImage(imgB64);
    if (useI2I) setWorkbenchAction("img2img");
  }

  closeInspectPngModal();
  showToast("已按勾选项应用生成参数");
}

function downloadCurrentStageImage() {
  const url = getActiveStageImageSource();
  if (!url) {
    showToast("当前画布暂无可保存图片");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = `nai_studio_${Date.now()}.png`;
  a.click();
}

function openDiffModal(idxA = 0, idxB = 1, customList = null) {
  if (arguments.length === 0) {
    state._diffSourceList = state.gallery;
  } else if (Array.isArray(customList) && customList.length >= 2) {
    state._diffSourceList = customList;
  }
  const source = Array.isArray(state._diffSourceList) && state._diffSourceList.length >= 2
    ? state._diffSourceList
    : state.gallery;
  if (source.length < 2) {
    showToast("至少需要 2 条生成记录才能进行参数差异与卷帘对比");
    return;
  }
  state._diffSourceList = source;
  const safeA = Math.min(Math.max(0, idxA), source.length - 1);
  const safeB = Math.min(Math.max(0, idxB), source.length - 1);
  const a = source[safeA];
  const b = source[safeB];
  const tagsA = new Set((a.prompt || "").split(",").map(s => s.trim()).filter(Boolean));
  const tagsB = new Set((b.prompt || "").split(",").map(s => s.trim()).filter(Boolean));
  const added = [...tagsA].filter(x => !tagsB.has(x));
  const removed = [...tagsB].filter(x => !tagsA.has(x));

  const optHtml = (selIdx) =>
    source
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
  e.preventDefault();
  try {
    e.currentTarget?.setPointerCapture?.(e.pointerId);
  } catch (err) {}
  moveDiffSwipe(e);
}
window.addEventListener("pointerup", () => {
  _swipingDiff = false;
});
window.addEventListener("pointercancel", () => {
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
function getArtistCategories() {
  const preferred = ["厚涂光影", "清透水彩", "幻彩插画", "日系轻小说", "赛博冷调", "私人收藏"];
  const present = new Set((state.artists || []).map(a => a.category).filter(Boolean));
  const ordered = preferred.filter(c => present.has(c));
  [...present].sort().forEach(c => {
    if (!ordered.includes(c)) ordered.push(c);
  });
  return ordered;
}

function renderArtistCatPills() {
  const wrap = document.getElementById("artist-cat-pills");
  if (!wrap) return;
  const total = state.artists.length;
  const favCount = state.artists.filter(a => a.favorite).length;
  const cats = getArtistCategories();
  const catBtn = (cat, label, count) => {
    const active = state.artistCatFilter === cat ? "is-active" : "";
    return `<button onclick="filterArtistsByCat('${escapeHtml(cat)}')" data-cat="${escapeHtml(cat)}" class="artist-cat-btn spring-btn px-2.5 py-1 rounded-[6px] ui-btn text-[12px] ${active}">${escapeHtml(label)} <span class="font-mono text-[11px] opacity-70">${count}</span></button>`;
  };
  wrap.innerHTML = [
    catBtn("all", "全部", total),
    catBtn("fav", "我的收藏", favCount),
    ...cats.map(c => catBtn(c, c, state.artists.filter(a => a.category === c).length)),
  ].join("");
}

function filterArtistsByCat(cat) {
  state.artistCatFilter = cat;
  renderArtistCatPills();
  renderArtistsGrid();
}

function clearArtistSearch() {
  const inp = document.getElementById("artist-search-input");
  if (inp) inp.value = "";
  renderArtistsGrid();
}

function selectArtistSort(val) {
  state.artistSort = val || "fav_first";
  toggleGlassSelect("artist-sort-select", false);
  renderArtistSortSelect();
  renderArtistsGrid();
}

function renderArtistSortSelect() {
  renderSimpleGlassSelect(
    "artist-sort-select",
    [
      { value: "fav_first", label: "收藏置顶" },
      { value: "name_asc", label: "名称 A–Z" },
      { value: "newest", label: "最新添加" },
      { value: "missing_preview", label: "仅看缺失预览" },
    ],
    state.artistSort,
    "selectArtistSort"
  );
}

function resetArtistFilters() {
  state.artistCatFilter = "all";
  const inp = document.getElementById("artist-search-input");
  if (inp) inp.value = "";
  state.artistSort = "fav_first";
  renderArtistSortSelect();
  renderArtistCatPills();
  renderArtistsGrid();
}

function renderArtistsGrid() {
  const grid = document.getElementById("artists-grid");
  if (!grid) return;
  const qRaw = (document.getElementById("artist-search-input")?.value || "").trim();
  const q = qRaw.toLowerCase();
  const sortMode = state.artistSort || "fav_first";
  const clearBtn = document.getElementById("artist-search-clear");
  if (clearBtn) clearBtn.classList.toggle("hidden", !qRaw);

  let filtered = state.artists.filter(a => {
    if (state.artistCatFilter === "fav" && !a.favorite) return false;
    if (state.artistCatFilter !== "all" && state.artistCatFilter !== "fav" && a.category !== state.artistCatFilter) return false;
    if (sortMode === "missing_preview" && a.preview_url) return false;
    if (
      q &&
      !(
        (a.name || "").toLowerCase().includes(q) ||
        (a.tag || "").toLowerCase().includes(q) ||
        (a.category || "").toLowerCase().includes(q) ||
        (a.desc || "").toLowerCase().includes(q)
      )
    ) {
      return false;
    }
    return true;
  });

  if (sortMode === "name_asc") {
    filtered = [...filtered].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"));
  } else if (sortMode === "newest") {
    filtered = [...filtered].sort((a, b) => (b.id || 0) - (a.id || 0));
  } else {
    filtered = [...filtered].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (a.id || 0) - (b.id || 0));
  }

  const renderKey = `${state.artistCatFilter}|${sortMode}|${q}|${filtered.map(a => `${a.id}:${a.favorite ? 1 : 0}:${a.preview_url || ""}:${a.name}:${a.tag}:${a.category}`).join(",")}`;
  if (grid.dataset.renderKey === renderKey) return;
  grid.dataset.renderKey = renderKey;

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="col-span-full py-14 flex flex-col items-center justify-center gap-3 text-center">
        <div class="ui-body text-[var(--text-muted)]">没有匹配的画师记录</div>
        <button type="button" onclick="resetArtistFilters()" class="spring-btn px-3 py-1 rounded-[6px] ui-btn text-[12px]">重置筛选条件</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map(a => {
      const hasPreview = Boolean(a.preview_url);
      const previewHtml = hasPreview
        ? `<img src="${a.preview_url}" alt="${escapeHtml(a.name)}" onclick="openArtistPreviewLightbox(${a.id})" onerror="this.onerror=null;this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden');" class="w-full h-full object-cover object-top transition-opacity duration-150 group-hover:opacity-95 cursor-zoom-in" />
           <div class="hidden w-full h-full ui-stage-well flex flex-col items-center justify-center p-4 text-center">
             <div class="ui-title text-[var(--text-primary)]">${escapeHtml(a.name)}</div>
             <div class="text-[12px] font-mono text-[var(--text-secondary)] mt-1">${escapeHtml(a.tag)}</div>
             <div class="mt-3 text-[11.5px] px-2.5 py-1 rounded-[6px] ui-badge text-[var(--status-warning)]">预览图文件丢失，请重新生成</div>
           </div>`
        : `<div class="w-full h-full ui-stage-well flex flex-col items-center justify-center p-4 text-center border-b border-[var(--border-hairline)]">
             <div class="ui-title text-[var(--text-primary)]">${escapeHtml(a.name)}</div>
             <div class="text-[12px] font-mono text-[var(--text-secondary)] mt-1">${escapeHtml(a.tag)}</div>
             <div class="mt-3 text-[11.5px] px-2.5 py-1 rounded-[6px] ui-badge text-[var(--text-muted)]">点击「生成预览」制作示例图</div>
           </div>`;

      return `
        <div class="rounded-[10px] ui-card overflow-hidden flex flex-col group">
          <div class="relative shrink-0 aspect-[4/5] overflow-hidden bg-[var(--bg-canvas-well)]">
            ${previewHtml}
            <span class="absolute top-2 left-2 px-2 py-0.5 rounded-[5px] studio-hud text-[11.5px] font-medium pointer-events-none">${escapeHtml(a.category)}</span>
            <div class="absolute top-2 right-2 flex items-center gap-1">
              <button onclick="openArtistModal(${a.id})" aria-label="编辑画师" title="编辑或删除画师" class="spring-btn w-7 h-7 rounded-[6px] studio-hud flex items-center justify-center text-[var(--text-secondary)] opacity-75 group-hover:opacity-100 transition-opacity">
                ${uiIcon("edit", "ui-ic-sm")}
              </button>
              <button onclick="toggleArtistFav(${a.id})" aria-label="收藏画师" title="${a.favorite ? "取消收藏" : "收藏画师"}" class="spring-btn w-7 h-7 rounded-[6px] studio-hud flex items-center justify-center ${a.favorite ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}">
                ${uiIcon("star")}
              </button>
            </div>
          </div>
          <div class="p-3 space-y-2">
            <div class="flex items-center justify-between gap-2">
              <span class="ui-section truncate">${escapeHtml(a.name)}</span>
              <button type="button" onclick="copyArtistTag(${a.id})" title="点击复制画师 Tag" class="selectable-text text-[11.5px] font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] truncate max-w-[55%] text-right">${escapeHtml(a.tag)}</button>
            </div>
            <p class="text-[12px] text-[var(--text-muted)] line-clamp-2 leading-relaxed min-h-[34px]">${escapeHtml(a.desc || "暂无描述")}</p>
            <div class="grid grid-cols-3 gap-1.5 pt-1 text-[12px]">
              <button onclick="useArtistById(${a.id})" class="spring-btn py-1 rounded-[6px] ui-btn font-medium">选用</button>
              <button onclick="addArtistByIdToMixer(${a.id})" class="spring-btn py-1 rounded-[6px] ui-btn">+ 混合</button>
              <button id="gen-card-btn-${a.id}" onclick="generateArtistCard(${a.id})" class="spring-btn py-1 rounded-[6px] ui-btn text-[var(--status-success)]" title="调用 NovelAI 接口 0点数生成该画师标准预览图">${hasPreview ? "重绘预览" : "生成预览"}</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function openArtistPreviewLightbox(artistId) {
  const a = state.artists.find(x => x.id === artistId);
  if (!a || !a.preview_url) return;
  const img = document.getElementById("lightbox-img");
  const cap = document.getElementById("lightbox-caption");
  state.lightboxIdx = -1;
  document.querySelectorAll('#lightbox-modal [onclick*="navigateLightbox"]').forEach(btn => {
    btn.disabled = true;
  });
  if (img) img.src = a.preview_url;
  if (cap) cap.textContent = `${a.name} · ${a.tag} (${a.category})`;
  document.getElementById("lightbox-modal")?.classList.remove("hidden");
}

async function copyArtistTag(artistId) {
  const a = state.artists.find(x => x.id === artistId);
  if (!a) return;
  try {
    await navigator.clipboard.writeText(a.tag);
    showToast(`已复制画师 Tag：${a.tag}`);
  } catch (e) {
    showToast(`画师 Tag：${a.tag}`);
  }
}

async function toggleArtistFav(artistId) {
  const idx = state.artists.findIndex(x => x.id === artistId);
  if (idx === -1) return;
  const prevFav = Boolean(state.artists[idx].favorite);
  state.artists[idx].favorite = !prevFav;
  renderArtistCatPills();
  renderArtistsGrid();
  try {
    const res = await fetch(`/api/artists/${artistId}/favorite`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error("收藏同步失败");
    if (data.artist) {
      state.artists[idx] = data.artist;
      renderArtistCatPills();
      renderArtistsGrid();
    }
  } catch (e) {
    state.artists[idx].favorite = prevFav;
    renderArtistCatPills();
    renderArtistsGrid();
    showToast("收藏状态同步失败");
  }
}

async function generateArtistCard(artistId, modelId = "nai-diffusion-4-5-full") {
  const btn = document.getElementById(`gen-card-btn-${artistId}`);
  const hadPreview = Boolean(state.artists.find(x => x.id === artistId)?.preview_url);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "生成中...";
  }
  showToast(`正在调用 NovelAI (${modelId === "nai-diffusion-5-full" ? "V5" : "V4.5"} · 0 Anlas) 生成该画师标准预览图...`);
  try {
    const res = await fetch(`/api/artists/${artistId}/generate-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId || "nai-diffusion-4-5-full" }),
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
      btn.textContent = hadPreview ? "重绘预览" : "生成预览";
    }
  }
}

function injectArtistsIntoPrompt(items, toastLabel) {
  const ta = document.getElementById("prompt-input");
  const mixStr = formatMixString(items);
  if (ta && mixStr) {
    const knownTags = new Set((state.artists || []).map(a => String(a.tag || "").trim().toLowerCase()));
    const kept = parsePromptSegments(ta.value).filter(seg => {
      const clean = seg.replace(/^\{+|\[+|\}+|\]+$/g, "").replace(/^-?\d+(?:\.\d+)?::|::$/g, "").trim().toLowerCase();
      return !(clean.startsWith("artist:") || knownTags.has(clean));
    });
    kept.push(mixStr);
    ta.value = kept.join(", ");
  }
  state.activeArtistMix = [];
  renderActiveArtistMixBar();
  switchTab("workbench");
  switchInspectorTab("prompts");
  switchPromptSide("pos");
  syncPromptImmediateVisuals("pos");
  runPromptLinter("pos");
  if (state.promptWorkspaceMode === "structured") syncClassicToStructured();
  const wrap = document.getElementById("prompt-editor-wrap");
  if (wrap) {
    wrap.style.borderColor = "var(--border-focus)";
    setTimeout(() => { wrap.style.borderColor = ""; }, 900);
  }
  showToast(toastLabel || `已将画师风格写入提示词框：${mixStr}`);
}

function useArtistById(artistId) {
  const a = state.artists.find(x => x.id === artistId);
  if (!a) return;
  useSingleArtist(a.tag, a.name);
}

function addArtistByIdToMixer(artistId) {
  const a = state.artists.find(x => x.id === artistId);
  if (!a) return;
  addArtistToMixer(a.tag, a.name);
}

function useSingleArtist(tag, name) {
  injectArtistsIntoPrompt([{ tag, name, weight: 1.0 }], `已将画师「${name}」加入提示词框`);
}

function addArtistToMixer(tag, name) {
  const existing = state.mixerItems.find(x => x.tag === tag);
  if (existing) {
    existing.weight = Math.min(2.0, Math.round((existing.weight + 0.1) * 100) / 100);
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
  const w = Math.max(0.1, Math.min(2.0, Math.round(parseFloat(rawVal) * 20) / 20));
  it.weight = w;
  const slider = document.getElementById(`mixer-slider-${idx}`);
  if (slider) slider.value = String(w);
  const weightEl = document.getElementById(`mixer-weight-${idx}`);
  if (weightEl) weightEl.textContent = Number(w).toFixed(2);
  const out = document.getElementById("mixer-preview-output");
  if (out) out.textContent = formatMixString(state.mixerItems);
  const wrap = document.getElementById("mixer-slots");
  if (wrap) {
    wrap.dataset.renderKey = state.mixerItems.map(x => `${x.tag}:${Number(x.weight).toFixed(2)}`).join("|") + `|${state.currentModel}`;
  }
}

function stepMixerWeight(idx, delta) {
  const it = state.mixerItems[idx];
  if (!it) return;
  updateMixerSlotWeight(idx, Number(it.weight || 1.0) + delta);
}

function moveMixerSlot(idx, dir) {
  const target = idx + dir;
  if (target < 0 || target >= state.mixerItems.length) return;
  const arr = state.mixerItems;
  [arr[idx], arr[target]] = [arr[target], arr[idx]];
  renderMixer();
}

function removeMixerSlot(idx) {
  state.mixerItems.splice(idx, 1);
  renderMixer();
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
        <div class="flex items-center justify-between gap-2 ui-body">
          <span class="font-semibold truncate">${escapeHtml(it.name)} <span class="text-[11.5px] font-mono text-[var(--text-muted)]">(${escapeHtml(it.tag)})</span></span>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" onclick="moveMixerSlot(${idx}, -1)" ${idx === 0 ? "disabled" : ""} class="spring-btn px-1.5 py-0.5 rounded-[4px] ui-btn text-[11px]" title="前移顺序">↑</button>
            <button type="button" onclick="moveMixerSlot(${idx}, 1)" ${idx === state.mixerItems.length - 1 ? "disabled" : ""} class="spring-btn px-1.5 py-0.5 rounded-[4px] ui-btn text-[11px]" title="后移顺序">↓</button>
            <button type="button" onclick="removeMixerSlot(${idx})" class="text-[12px] text-[var(--status-danger)] px-1">移除</button>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <button type="button" onclick="stepMixerWeight(${idx}, -0.05)" class="spring-btn w-6 h-6 rounded-[5px] ui-btn text-[12px] font-mono">−</button>
          <input id="mixer-slider-${idx}" type="range" min="0.1" max="2.0" step="0.05" value="${it.weight}" oninput="updateMixerSlotWeight(${idx}, this.value)" class="flex-1" />
          <button type="button" onclick="stepMixerWeight(${idx}, 0.05)" class="spring-btn w-6 h-6 rounded-[5px] ui-btn text-[12px] font-mono">+</button>
          <span id="mixer-weight-${idx}" class="font-mono text-[12.5px] w-10 text-right text-[var(--text-primary)] tabular-nums">${Number(it.weight).toFixed(2)}</span>
        </div>
      </div>
    `
    )
    .join("");

  out.textContent = formatMixString(state.mixerItems);
}

async function copyMixerOutput() {
  if (!state.mixerItems.length) {
    showToast("当前未添加混合画师");
    return;
  }
  const txt = formatMixString(state.mixerItems);
  try {
    await navigator.clipboard.writeText(txt);
    showToast("已复制实时画师权重语法");
  } catch (e) {
    showToast(txt);
  }
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
  injectArtistsIntoPrompt(state.mixerItems, "已将混合画师权重写入提示词框");
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
  if (!state.mixPresets.length) {
    wrap.innerHTML = `<div class="text-[12px] text-[var(--text-muted)] py-2 text-center">暂无已保存方案</div>`;
    return;
  }
  wrap.innerHTML = state.mixPresets
    .map(
      p => `
      <div class="flex items-center justify-between gap-2 p-2 rounded-[10px] ui-card text-[12.5px]">
        <div class="min-w-0 flex-1">
          <div class="font-medium truncate">${escapeHtml(p.name)}</div>
          <div class="text-[11.5px] font-mono text-[var(--text-muted)] truncate">${escapeHtml(formatMixString(p.items || []))}</div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="loadMixPresetById(${p.id})" class="spring-btn px-2 py-1 rounded-[5px] ui-btn text-[11.5px]">载入</button>
          <button onclick="applyMixPresetById(${p.id})" class="spring-btn px-2 py-1 rounded-[5px] ui-btn text-[11.5px]" title="直接写入工作台提示词">应用</button>
          <button onclick="deleteMixPresetById(${p.id})" class="spring-btn px-1.5 py-1 rounded-[5px] ui-btn text-[11.5px] text-[var(--status-danger)]" title="删除该方案">×</button>
        </div>
      </div>
    `
    )
    .join("");
}

function loadMixPresetById(id) {
  const p = state.mixPresets.find(x => x.id === id);
  if (!p) return;
  state.mixerItems = JSON.parse(JSON.stringify(p.items || []));
  renderMixer();
  showToast(`已载入方案「${p.name}」至画风混合器`);
}

function applyMixPresetById(id) {
  const p = state.mixPresets.find(x => x.id === id);
  if (!p || !(p.items || []).length) return;
  injectArtistsIntoPrompt(p.items, `已将混合方案「${p.name}」写入提示词框`);
}

async function deleteMixPresetById(id) {
  const p = state.mixPresets.find(x => x.id === id);
  try {
    const res = await fetch(`/api/mix-presets/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("删除失败");
    state.mixPresets = state.mixPresets.filter(x => x.id !== id);
    renderMixPresets();
    showToast(`已删除方案${p ? `「${p.name}」` : ""}`);
  } catch (e) {
    showToast("删除混合方案失败");
  }
}

async function saveCurrentMixPreset() {
  if (!state.mixerItems.length) {
    showToast("混合器为空，无法保存");
    return;
  }
  const nameInput = document.getElementById("mix-preset-name-input");
  const customName = nameInput ? nameInput.value.trim() : "";
  const name = customName || state.mixerItems.map(x => `${x.name}(${x.weight})`).join(" + ");
  const res = await fetch("/api/mix-presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, items: state.mixerItems }),
  });
  const data = await res.json();
  if (data.preset) {
    state.mixPresets.unshift(data.preset);
    if (nameInput) nameInput.value = "";
    renderMixPresets();
    showToast(`已保存混合方案：${name}`);
  }
}

function toggleCustomArtistModal(show) {
  if (!show) state.artistEditingId = null;
  document.getElementById("custom-artist-modal")?.classList.toggle("hidden", !show);
}

function selectArtistModalCat(val) {
  state.artistModalCategory = val || "私人收藏";
  toggleGlassSelect("artist-cat-select", false);
  renderArtistModalCatSelect();
}

function renderArtistModalCatSelect() {
  const baseCats = ["私人收藏", "厚涂光影", "清透水彩", "幻彩插画", "日系轻小说", "赛博冷调"];
  if (state.artistModalCategory && !baseCats.includes(state.artistModalCategory)) {
    baseCats.unshift(state.artistModalCategory);
  }
  renderSimpleGlassSelect(
    "artist-cat-select",
    baseCats.map(c => ({ value: c, label: c })),
    state.artistModalCategory || "私人收藏",
    "selectArtistModalCat"
  );
}

function openArtistModal(artistId = null) {
  const isEdit = artistId !== null && artistId !== undefined;
  state.artistEditingId = isEdit ? artistId : null;
  const artist = isEdit ? state.artists.find(x => x.id === artistId) : null;

  const titleEl = document.getElementById("artist-modal-title");
  const hintEl = document.getElementById("artist-modal-hint");
  const delBtn = document.getElementById("delete-artist-modal-btn");
  const subBtn = document.getElementById("create-artist-submit-btn");

  const nameIn = document.getElementById("new-artist-name");
  const tagIn = document.getElementById("new-artist-tag");
  const descIn = document.getElementById("new-artist-desc");
  const sampleIn = document.getElementById("new-artist-sample");

  if (artist) {
    if (titleEl) titleEl.textContent = `编辑画师：${artist.name}`;
    if (hintEl) hintEl.textContent = "修改画师显示名称、分类、Tag 或基准预览词；如需刷新封面图，可在保存后点击卡片「重绘预览」。";
    if (delBtn) delBtn.classList.remove("hidden");
    if (subBtn) subBtn.textContent = "保存修改";
    if (nameIn) nameIn.value = artist.name || "";
    state.artistModalCategory = artist.category || "私人收藏";
    if (tagIn) tagIn.value = artist.tag || "";
    if (descIn) descIn.value = artist.desc || "";
    if (sampleIn) sampleIn.value = artist.sample_tags || "";
  } else {
    if (titleEl) titleEl.textContent = "新增画师并生成预览图 (0 Anlas)";
    if (hintEl) hintEl.textContent = "使用统一基准提示词与固定 Seed (39481022) 调用 NovelAI V4.5 Full 免费生成标准画风预览图，存入 D:\\NAI-Studio\\artists。";
    if (delBtn) delBtn.classList.add("hidden");
    if (subBtn) subBtn.textContent = "生成预览并添加 (0点数)";
    if (nameIn) nameIn.value = "";
    state.artistModalCategory = "私人收藏";
    if (tagIn) tagIn.value = "";
    if (descIn) descIn.value = "";
    if (sampleIn) sampleIn.value = "";
  }
  renderArtistModalCatSelect();
  toggleCustomArtistModal(true);
}

async function submitArtistModal() {
  const name = document.getElementById("new-artist-name").value.trim();
  const category = state.artistModalCategory || "私人收藏";
  const tag = document.getElementById("new-artist-tag").value.trim();
  const desc = document.getElementById("new-artist-desc").value.trim();
  const sample_tags = document.getElementById("new-artist-sample")?.value.trim() || "";
  if (!tag) {
    showToast("请输入画师英文 Tag");
    return;
  }
  const btn = document.getElementById("create-artist-submit-btn");
  const isEdit = Boolean(state.artistEditingId);
  btn.disabled = true;
  btn.textContent = isEdit ? "正在保存..." : "正在生成预览...";
  try {
    const url = isEdit ? `/api/artists/${state.artistEditingId}` : "/api/artists";
    const method = isEdit ? "PATCH" : "POST";
    const payload = isEdit
      ? { name: name || tag, tag, desc, category, sample_tags }
      : { name, tag, desc, category, sample_tags, generate_preview: true };
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "操作失败");
    if (data.artist) {
      const idx = state.artists.findIndex(x => x.id === data.artist.id);
      if (idx !== -1) state.artists[idx] = data.artist;
      else state.artists.unshift(data.artist);
      renderArtistCatPills();
      renderArtistsGrid();
      toggleCustomArtistModal(false);
      showToast(isEdit ? `已更新画师「${data.artist.name}」` : `已添加 ${data.artist.name} 并生成画风预览图`);
    }
  } catch (err) {
    showToast(err.message || "操作失败");
  } finally {
    btn.disabled = false;
    btn.textContent = isEdit ? "保存修改" : "生成预览并添加 (0点数)";
  }
}

async function deleteEditingArtist() {
  if (!state.artistEditingId) return;
  const artist = state.artists.find(x => x.id === state.artistEditingId);
  const ok = await openStudioConfirm(
    "删除画师记录",
    `确定从画师库中移除「${artist?.name || "该画师"}」吗？工作台已写入的提示词不受影响。`,
    "确认删除"
  );
  if (!ok) return;
  try {
    const res = await fetch(`/api/artists/${state.artistEditingId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "删除失败");
    state.artists = state.artists.filter(x => x.id !== state.artistEditingId);
    toggleCustomArtistModal(false);
    renderArtistCatPills();
    renderArtistsGrid();
    showToast(`已移除画师「${artist?.name || ""}」`);
  } catch (err) {
    showToast(err.message || "删除画师失败");
  }
}

// ================= Tab 3: Full Local Gallery & Asset Inspector =================
let _confirmResolver = null;
function openStudioConfirm(title, msg, okLabel = "确认") {
  const modal = document.getElementById("studio-confirm-modal");
  if (!modal) return Promise.resolve(true);
  if (_confirmResolver) {
    _confirmResolver(false);
    _confirmResolver = null;
  }
  const titleEl = document.getElementById("confirm-modal-title");
  const msgEl = document.getElementById("confirm-modal-msg");
  const okEl = document.getElementById("confirm-modal-ok-btn");
  if (titleEl) titleEl.textContent = title || "确认操作";
  if (msgEl) msgEl.textContent = msg || "";
  if (okEl) okEl.textContent = okLabel || "确认";
  modal.classList.remove("hidden");
  return new Promise(resolve => {
    _confirmResolver = resolve;
  });
}

function resolveStudioConfirm(accepted) {
  const modal = document.getElementById("studio-confirm-modal");
  modal?.classList.add("hidden");
  if (_confirmResolver) {
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(Boolean(accepted));
  }
}

let _gallerySearchTimer = null;
function debouncedGallerySearch() {
  const qRaw = (document.getElementById("gallery-search-input")?.value || "").trim();
  const clearBtn = document.getElementById("gallery-search-clear");
  if (clearBtn) clearBtn.classList.toggle("hidden", !qRaw);
  clearTimeout(_gallerySearchTimer);
  _gallerySearchTimer = setTimeout(() => renderFullGallery(true), 160);
}

function clearGallerySearch() {
  const inp = document.getElementById("gallery-search-input");
  if (inp) inp.value = "";
  const clearBtn = document.getElementById("gallery-search-clear");
  if (clearBtn) clearBtn.classList.add("hidden");
  renderFullGallery(true);
}

function selectGalleryModelFilter(val) {
  state.galleryModelFilter = val || "";
  toggleGlassSelect("gallery-model-select", false);
  renderGalleryModelSelect();
  renderFullGallery(true);
}

function renderGalleryModelSelect() {
  renderSimpleGlassSelect(
    "gallery-model-select",
    [
      { value: "", label: "全部模型" },
      { value: "nai-diffusion-5-full", label: "V5 Full" },
      { value: "nai-diffusion-4-5-full", label: "V4.5 Full" },
      { value: "nai-diffusion-4-5-curated", label: "V4.5 Curated" },
      { value: "nai-diffusion-4-full", label: "V4 Full" },
      { value: "nai-diffusion-3", label: "V3" },
    ],
    state.galleryModelFilter,
    "selectGalleryModelFilter"
  );
}

function selectGallerySort(val) {
  state.gallerySort = val || "newest";
  toggleGlassSelect("gallery-sort-select", false);
  renderGallerySortSelect();
  renderFullGallery(true);
}

function renderGallerySortSelect() {
  renderSimpleGlassSelect(
    "gallery-sort-select",
    [
      { value: "newest", label: "最新出图" },
      { value: "oldest", label: "最早出图" },
      { value: "fav_first", label: "收藏优先" },
      { value: "fastest", label: "生成最快" },
      { value: "slowest", label: "生成最慢" },
    ],
    state.gallerySort,
    "selectGallerySort"
  );
}

function resetGalleryFilters() {
  const inp = document.getElementById("gallery-search-input");
  if (inp) inp.value = "";
  const clearBtn = document.getElementById("gallery-search-clear");
  if (clearBtn) clearBtn.classList.add("hidden");
  state.galleryModelFilter = "";
  state.gallerySort = "newest";
  renderGalleryModelSelect();
  renderGallerySortSelect();
  state.galleryFavOnly = false;
  const favBtn = document.getElementById("gallery-fav-filter-btn");
  if (favBtn) {
    favBtn.innerHTML = `${uiIcon("star")}<span>仅看收藏</span>`;
    favBtn.classList.remove("is-active");
  }
  renderFullGallery(true);
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

function toggleGalleryDensity() {
  state.galleryDensity = state.galleryDensity === "compact" ? "comfortable" : "compact";
  const isCompact = state.galleryDensity === "compact";
  const btn = document.getElementById("gallery-density-btn");
  if (btn) {
    btn.textContent = isCompact ? "卡片详情" : "紧凑网格";
    btn.classList.toggle("is-active", isCompact);
  }
  renderFullGallery(false);
}

async function fetchGalleryPage(offset = 0, append = false) {
  const q = (document.getElementById("gallery-search-input")?.value || "").trim();
  const model = state.galleryModelFilter || "";
  const sort = state.gallerySort || "newest";
  const params = new URLSearchParams({
    limit: "24",
    offset: String(offset),
    sort,
  });
  if (q) params.set("search", q);
  if (model) params.set("model", model);
  if (state.galleryFavOnly) params.set("favorite_only", "true");
  try {
    const res = await fetch(`/api/gallery?${params.toString()}`);
    const data = await res.json();
    const fetched = Array.isArray(data.items) ? data.items : [];
    state.galleryViewTotal = Number(data.total ?? fetched.length);
    state.galleryViewHasMore = Boolean(data.has_more);
    if (!q && !model && !state.galleryFavOnly && sort === "newest") {
      state.galleryTotal = state.galleryViewTotal;
    }
    if (append) {
      const seen = new Set(state.galleryView.map(x => x.id));
      state.galleryView.push(...fetched.filter(x => !seen.has(x.id)));
      state.galleryViewOffset = offset + fetched.length;
    } else {
      state.galleryView = fetched;
      state.galleryViewOffset = fetched.length;
    }
    state.galleryViewDirty = false;
  } catch (e) {
    showToast("加载图库列表失败");
  }
}

async function loadMoreGallery() {
  await fetchGalleryPage(state.galleryViewOffset, true);
  renderFullGallery(false);
}

function syncGalleryItemAcrossLists(updated) {
  if (!updated || !updated.id) return;
  [state.gallery, state.galleryView].forEach(list => {
    const idx = list.findIndex(x => x.id === updated.id);
    if (idx !== -1) list[idx] = updated;
  });
  if (state.galleryDetailId === updated.id && !document.getElementById("gallery-detail-modal")?.classList.contains("hidden")) {
    populateGalleryDetailModal(updated);
  }
}

function removeGalleryIdsAcrossLists(idsSet) {
  state.gallery = state.gallery.filter(x => !idsSet.has(x.id));
  state.galleryView = state.galleryView.filter(x => !idsSet.has(x.id));
  idsSet.forEach(id => state.selectedGalleryIds.delete(id));
  if (idsSet.has(state.galleryDetailId)) closeGalleryDetailModal();
}

function updateGalleryBatchBar() {
  const selCount = state.selectedGalleryIds.size;
  const bar = document.getElementById("gallery-batch-bar");
  const cntEl = document.getElementById("gallery-selected-count");
  const diffBtn = document.getElementById("gallery-batch-diff-btn");
  const pageBtn = document.getElementById("gallery-select-page-btn");
  if (bar) bar.classList.toggle("hidden", selCount === 0);
  if (cntEl) cntEl.textContent = `已选 ${selCount} 项`;
  if (diffBtn) diffBtn.disabled = selCount !== 2;
  if (pageBtn) {
    const visible = state.galleryView;
    const allSelected = visible.length > 0 && visible.every(it => state.selectedGalleryIds.has(it.id));
    pageBtn.textContent = allSelected ? "取消全选" : "全选本页";
    pageBtn.classList.toggle("is-active", allSelected);
  }
}

function toggleSelectGalleryItem(id, event) {
  if (event) event.stopPropagation();
  const visible = state.galleryView;
  if (event?.shiftKey && state.lastSelectedGalleryId !== null) {
    const idxA = visible.findIndex(x => x.id === state.lastSelectedGalleryId);
    const idxB = visible.findIndex(x => x.id === id);
    if (idxA !== -1 && idxB !== -1) {
      const [lo, hi] = [Math.min(idxA, idxB), Math.max(idxA, idxB)];
      const addMode = !state.selectedGalleryIds.has(id);
      for (let i = lo; i <= hi; i++) {
        if (addMode) state.selectedGalleryIds.add(visible[i].id);
        else state.selectedGalleryIds.delete(visible[i].id);
      }
      state.lastSelectedGalleryId = id;
      updateGalleryBatchBar();
      renderFullGallery(false);
      return;
    }
  }
  if (state.selectedGalleryIds.has(id)) state.selectedGalleryIds.delete(id);
  else state.selectedGalleryIds.add(id);
  state.lastSelectedGalleryId = id;
  updateGalleryBatchBar();
  renderFullGallery(false);
}

function toggleSelectAllGalleryPage() {
  const visible = state.galleryView;
  if (!visible.length) return;
  const allSelected = visible.every(it => state.selectedGalleryIds.has(it.id));
  if (allSelected) {
    visible.forEach(it => state.selectedGalleryIds.delete(it.id));
  } else {
    visible.forEach(it => state.selectedGalleryIds.add(it.id));
  }
  updateGalleryBatchBar();
  renderFullGallery(false);
}

function clearGallerySelection() {
  state.selectedGalleryIds.clear();
  state.lastSelectedGalleryId = null;
  updateGalleryBatchBar();
  renderFullGallery(false);
}

async function renderFullGallery(reloadFromServer = false) {
  if (reloadFromServer) {
    await fetchGalleryPage(0, false);
  }
  const grid = document.getElementById("full-gallery-grid");
  if (!grid) return;

  const qRaw = (document.getElementById("gallery-search-input")?.value || "").trim();
  const clearBtn = document.getElementById("gallery-search-clear");
  if (clearBtn) clearBtn.classList.toggle("hidden", !qRaw);

  const items = state.galleryFavOnly ? state.galleryView.filter(it => it.favorite) : state.galleryView;
  const totalCount = Math.max(state.galleryViewTotal, items.length);

  const countEl = document.getElementById("gallery-count-label");
  if (countEl) {
    countEl.textContent = `已加载 ${items.length} / 共 ${totalCount} 张匹配作品`;
  }
  const loadMoreBtn = document.getElementById("gallery-load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.classList.toggle("hidden", !state.galleryViewHasMore && state.galleryViewOffset >= state.galleryViewTotal);
  }

  const isCompact = state.galleryDensity === "compact";
  grid.className = isCompact
    ? "grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-9 gap-2 auto-rows-max items-start"
    : "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 auto-rows-max items-start";

  updateGalleryBatchBar();

  const selKey = [...state.selectedGalleryIds].sort((a, b) => a - b).join(",");
  const renderKey = `${state.galleryDensity}|${selKey}|${totalCount}|${items.map(it => `${it.id}:${it.favorite ? 1 : 0}:${it.notes || ""}`).join(",")}`;
  if (grid.dataset.renderKey === renderKey) return;
  grid.dataset.renderKey = renderKey;

  if (!items.length) {
    grid.innerHTML = `
      <div class="col-span-full py-14 flex flex-col items-center justify-center gap-3 text-center">
        <div class="ui-body text-[var(--muted-foreground)]">没有匹配的本地图库记录</div>
        <button type="button" onclick="resetGalleryFilters()" class="spring-btn px-3 py-1 rounded-[6px] ui-btn text-[12px]">清空筛选条件</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = items
    .map(it => {
      const selected = state.selectedGalleryIds.has(it.id);
      const ringCls = selected ? "ring-2 ring-[var(--text-primary)]" : "";
      if (isCompact) {
        return `
          <div class="rounded-[7px] ui-card overflow-hidden flex flex-col group ${ringCls}">
            <div class="relative shrink-0 overflow-hidden bg-[var(--bg-canvas-well)] aspect-square flex items-center justify-center">
              <img src="${it.image_url}" alt="" loading="lazy" onerror="this.onerror=null;this.style.opacity='0.22';" class="w-full h-full object-cover object-top transition-opacity duration-150 group-hover:opacity-90 cursor-pointer" onclick="openGalleryDetailModal(${it.id})" />
              <button type="button" onclick="toggleSelectGalleryItem(${it.id}, event)" aria-label="选择作品" class="spring-btn absolute top-1.5 left-1.5 w-5 h-5 rounded-[4px] studio-hud flex items-center justify-center text-[10px] font-bold ${selected ? "bg-[var(--text-primary)] text-[var(--cta-fg)] opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity">
                ${selected ? "✓" : ""}
              </button>
              <button onclick="toggleGalleryFav(${it.id})" aria-label="收藏作品" class="spring-btn absolute top-1.5 right-1.5 w-5 h-5 rounded-[4px] studio-hud flex items-center justify-center ${it.favorite ? "text-[var(--status-warning)] opacity-100" : "text-[var(--text-muted)] opacity-0 group-hover:opacity-100"} transition-opacity">
                ${uiIcon("star", "ui-ic-sm")}
              </button>
              <span class="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-[4px] studio-hud text-[10px] font-mono text-[var(--text-primary)] pointer-events-none">#${it.seed}</span>
            </div>
          </div>
        `;
      }
      const footerHtml = `<div class="p-3 space-y-2">
             <div class="flex items-center justify-between text-[12px] font-mono text-[var(--text-muted)]">
               <span>Seed #${it.seed}</span>
               <span>${it.width}×${it.height} · ${it.generation_time || 0}s</span>
             </div>
             ${it.notes ? `<div class="text-[11.5px] px-2 py-0.5 rounded-[5px] bg-[var(--accent-tint)] text-[var(--text-primary)] truncate inline-flex items-center gap-1 max-w-full">${uiIcon("edit", "ui-ic-sm")}<span>${escapeHtml(it.notes)}</span></div>` : ""}
             <p class="selectable-text text-[12px] font-mono text-[var(--text-secondary)] line-clamp-2 leading-snug min-h-[32px]">${escapeHtml(it.prompt)}</p>
             <div class="grid grid-cols-4 gap-1 pt-1 text-[12px]">
               <button onclick="loadGalleryItemToWorkbench(${it.id})" class="spring-btn py-1 rounded-[6px] ui-btn" title="加载完整生成参数到工作台">载入</button>
               <button onclick="openGalleryDetailModal(${it.id})" class="spring-btn py-1 rounded-[6px] ui-btn">详情</button>
               <a href="${it.image_url}" download="${escapeHtml(it.filename)}" class="spring-btn py-1 rounded-[6px] ui-btn text-center">下载</a>
               <button onclick="deleteGalleryRecord(${it.id})" class="spring-btn py-1 rounded-[6px] ui-btn text-[var(--status-danger)]">删除</button>
             </div>
           </div>`;

      return `
        <div class="rounded-[10px] ui-card overflow-hidden flex flex-col group ${ringCls}">
          <div class="relative shrink-0 overflow-hidden bg-[var(--bg-canvas-well)] aspect-[4/5] flex items-center justify-center">
            <img src="${it.image_url}" alt="" loading="lazy" onerror="this.onerror=null;this.style.opacity='0.22';" class="w-full h-full object-contain transition-opacity duration-150 group-hover:opacity-95 cursor-pointer" onclick="openGalleryDetailModal(${it.id})" />
            <div class="absolute top-2 left-2 flex items-center gap-1.5">
              <button type="button" onclick="toggleSelectGalleryItem(${it.id}, event)" aria-label="选择作品" title="选择（支持 Shift 连选）" class="spring-btn w-6 h-6 rounded-[5px] studio-hud flex items-center justify-center text-[11px] font-bold ${selected ? "bg-[var(--text-primary)] text-[var(--cta-fg)] opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity">
                ${selected ? "✓" : ""}
              </button>
              <span class="px-2 py-0.5 rounded-[5px] studio-hud text-[11.5px] font-mono text-[var(--text-primary)] pointer-events-none">${escapeHtml(it.model_short)}</span>
            </div>
            <button onclick="toggleGalleryFav(${it.id})" aria-label="收藏作品" class="spring-btn absolute top-2 right-2 w-7 h-7 rounded-[6px] studio-hud flex items-center justify-center ${it.favorite ? "text-[var(--status-warning)]" : "text-[var(--text-muted)]"}">
              ${uiIcon("star")}
            </button>
          </div>
          ${footerHtml}
        </div>
      `;
    })
    .join("");
}

function loadGalleryItemToWorkbench(id) {
  const item = findGalleryItemById(id);
  if (!item) return;
  setStageFromGalleryItem(item, true);
}

function populateGalleryDetailModal(item) {
  if (!item) return;
  const img = document.getElementById("gd-img");
  if (img) img.src = item.image_url;
  const titleEl = document.getElementById("gd-title");
  if (titleEl) titleEl.textContent = `${item.model_short || item.model} · Seed #${item.seed}`;
  const metaEl = document.getElementById("gd-meta");
  if (metaEl) metaEl.textContent = `${item.width}×${item.height} · ${item.filename || ""}`;
  const notesIn = document.getElementById("gd-notes-input");
  if (notesIn) notesIn.value = item.notes || "";
  const pEl = document.getElementById("gd-prompt");
  if (pEl) pEl.textContent = item.prompt || "(空)";
  const ucEl = document.getElementById("gd-uc");
  if (ucEl) ucEl.textContent = item.uc || "(空)";
  const dlLink = document.getElementById("gd-download-link");
  if (dlLink) {
    dlLink.href = item.image_url;
    dlLink.setAttribute("download", item.filename || `nai_${item.seed}.png`);
  }
  const favBtn = document.getElementById("gd-fav-btn");
  const favLabel = document.getElementById("gd-fav-label");
  if (favBtn) favBtn.classList.toggle("text-[var(--status-warning)]", Boolean(item.favorite));
  if (favLabel) favLabel.textContent = item.favorite ? "已收藏" : "收藏";

  const specs = document.getElementById("gd-specs");
  if (specs) {
    specs.innerHTML = `
      <div>采样器: <span class="text-[var(--text-primary)]">${escapeHtml(item.sampler || "-")}</span></div>
      <div>步数 / CFG: <span class="text-[var(--text-primary)]">${item.steps || 28} / ${item.scale ?? 5.0}</span></div>
      <div>噪声调度: <span class="text-[var(--text-primary)]">${escapeHtml(item.noise_schedule || "-")}</span></div>
      <div>耗时 / 类型: <span class="text-[var(--text-primary)]">${item.generation_time || 0}s · ${escapeHtml(item.action || "generate")}</span></div>
    `;
  }

  const list = state.galleryView.length ? state.galleryView : state.gallery;
  const idx = list.findIndex(x => x.id === item.id);
  const prevBtn = document.getElementById("gd-prev-btn");
  const nextBtn = document.getElementById("gd-next-btn");
  if (prevBtn) prevBtn.disabled = list.length <= 1 || idx === -1;
  if (nextBtn) nextBtn.disabled = list.length <= 1 || idx === -1;
}

function openGalleryDetailModal(id) {
  const item = findGalleryItemById(id);
  if (!item) return;
  state.galleryDetailId = item.id;
  populateGalleryDetailModal(item);
  document.getElementById("gallery-detail-modal")?.classList.remove("hidden");
}

function closeGalleryDetailModal() {
  state.galleryDetailId = null;
  document.getElementById("gallery-detail-modal")?.classList.add("hidden");
}

function navigateGalleryDetail(step) {
  const list = state.galleryView.length ? state.galleryView : state.gallery;
  if (!list.length || !state.galleryDetailId) return;
  const idx = list.findIndex(x => x.id === state.galleryDetailId);
  if (idx === -1) return;
  const next = (idx + step + list.length) % list.length;
  openGalleryDetailModal(list[next].id);
}

async function saveGalleryDetailNotes() {
  if (!state.galleryDetailId) return;
  const notes = document.getElementById("gd-notes-input")?.value.trim() || "";
  try {
    const res = await fetch(`/api/gallery/${state.galleryDetailId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "保存失败");
    if (data.item) {
      syncGalleryItemAcrossLists(data.item);
      renderFullGallery(false);
      showToast("已保存作品备注");
    }
  } catch (err) {
    showToast(err.message || "更新备注失败");
  }
}

async function copyDetailField(field) {
  const item = findGalleryItemById(state.galleryDetailId);
  if (!item) return;
  const val = field === "uc" ? (item.uc || "") : (item.prompt || "");
  if (!val) {
    showToast("当前字段为空");
    return;
  }
  try {
    await navigator.clipboard.writeText(val);
    showToast(field === "uc" ? "已复制负面提示词 (UC)" : "已复制正向提示词");
  } catch (e) {
    showToast("复制失败，请手动选中复制");
  }
}

async function toggleDetailGalleryFav() {
  if (!state.galleryDetailId) return;
  await toggleGalleryFav(state.galleryDetailId);
}

function applyGalleryDetail(mode) {
  const item = findGalleryItemById(state.galleryDetailId);
  if (!item) return;
  closeGalleryDetailModal();
  if (mode === "prompt") {
    const ta = document.getElementById("prompt-input");
    const uc = document.getElementById("uc-input");
    if (ta) ta.value = item.prompt || "";
    if (uc) uc.value = item.uc || "";
    syncPromptImmediateVisuals("pos");
    syncPromptImmediateVisuals("uc");
    runPromptLinter("pos");
    runPromptLinter("uc");
    if (state.promptWorkspaceMode === "structured") syncClassicToStructured();
    switchTab("workbench");
    switchInspectorTab("prompts");
    showToast("已载入正负面提示词至工作台");
    return;
  }
  if (mode === "i2i") {
    setStageFromGalleryItem(item, true);
    setWorkbenchAction("img2img");
    showToast("已载入参数并切换至图生图模式");
    return;
  }
  setStageFromGalleryItem(item, true);
}

async function deleteDetailGalleryItem() {
  if (!state.galleryDetailId) return;
  const id = state.galleryDetailId;
  const ok = await openStudioConfirm("删除作品", "确定删除这张作品及对应的 D 盘 PNG 原图文件吗？此操作不可撤销。", "删除原图");
  if (!ok) return;
  await deleteGalleryRecord(id, true);
}

function openSelectedGalleryDiff() {
  const selectedItems = state.galleryView.filter(it => state.selectedGalleryIds.has(it.id));
  if (selectedItems.length !== 2) {
    showToast("请精确勾选 2 张作品进行对比");
    return;
  }
  openDiffModal(0, 1, selectedItems);
}

async function batchFavSelectedGallery(fav) {
  const ids = [...state.selectedGalleryIds];
  if (!ids.length) return;
  try {
    const res = await fetch("/api/gallery/batch-favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, favorite: Boolean(fav) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "批量操作失败");
    const idSet = new Set(ids);
    [state.gallery, state.galleryView].forEach(list => {
      list.forEach(it => {
        if (idSet.has(it.id)) it.favorite = Boolean(fav);
      });
    });
    renderFullGallery(state.galleryFavOnly);
    showToast(fav ? `已收藏选中的 ${data.updated || ids.length} 张作品` : `已取消收藏 ${data.updated || ids.length} 张作品`);
  } catch (err) {
    showToast(err.message || "批量收藏失败");
  }
}

async function copySelectedGalleryPrompts() {
  const selectedItems = state.galleryView.filter(it => state.selectedGalleryIds.has(it.id));
  if (!selectedItems.length) return;
  const text = selectedItems.map(it => `# Seed ${it.seed} (${it.model_short})\n${it.prompt}`).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制 ${selectedItems.length} 条作品的提示词`);
  } catch (e) {
    showToast("复制失败，请检查剪贴板权限");
  }
}

async function confirmDeleteSelectedGallery() {
  const ids = [...state.selectedGalleryIds];
  if (!ids.length) return;
  const ok = await openStudioConfirm(
    `删除所选 ${ids.length} 张作品`,
    `确定删除选中的 ${ids.length} 条图库记录及对应的 D 盘 PNG 原图吗？已收藏作品也会在本次所选中一并删除。`,
    "确认删除"
  );
  if (!ok) return;
  try {
    const res = await fetch("/api/gallery/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, delete_file: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "删除失败");
    if (data.storage) state.storage = data.storage;
    if (typeof data.total === "number") state.galleryTotal = data.total;
    const idSet = new Set(ids);
    removeGalleryIdsAcrossLists(idSet);
    state.galleryViewTotal = Math.max(0, state.galleryViewTotal - (data.removed || ids.length));
    renderStorageBadges();
    renderWorkbenchHistory();
    await renderFullGallery(true);
    showToast(`已删除所选 ${data.removed || ids.length} 张作品并释放空间`);
  } catch (err) {
    showToast(err.message || "批量删除失败");
  }
}

async function confirmBatchCleanUnfav() {
  const ok = await openStudioConfirm(
    "清理未收藏作品",
    "确定一键清理所有未收藏的图库记录与 D 盘对应原图文件吗？已收藏作品将完整保留。",
    "清理未收藏"
  );
  if (!ok) return;
  const res = await fetch("/api/gallery/batch-delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unfav_only: true, delete_file: true }),
  });
  const data = await res.json();
  if (data.storage) state.storage = data.storage;
  if (typeof data.total === "number") state.galleryTotal = data.total;
  state.gallery = state.gallery.filter(x => x.favorite);
  state.galleryView = state.galleryView.filter(x => x.favorite);
  state.selectedGalleryIds.clear();
  renderStorageBadges();
  renderWorkbenchHistory();
  await renderFullGallery(true);
  showToast(`已清理 ${data.removed || 0} 张未收藏图片`);
}

async function toggleGalleryFav(id) {
  const item = findGalleryItemById(id);
  if (!item) return;
  const prevFav = Boolean(item.favorite);
  syncGalleryItemAcrossLists({ ...item, favorite: !prevFav });
  renderFullGallery(false);
  try {
    const res = await fetch(`/api/gallery/${id}/favorite`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error("收藏同步失败");
    if (data.item) {
      syncGalleryItemAcrossLists(data.item);
      renderFullGallery(false);
    }
  } catch (e) {
    syncGalleryItemAcrossLists({ ...item, favorite: prevFav });
    renderFullGallery(false);
    showToast("收藏状态同步失败");
  }
}

async function deleteGalleryRecord(id, skipConfirm = false) {
  if (!skipConfirm) {
    const item = findGalleryItemById(id);
    const ok = await openStudioConfirm(
      "删除图库作品",
      `确定删除「${item?.filename || `#${id}`}」及 D 盘原图文件吗？`,
      "删除"
    );
    if (!ok) return;
  }
  const res = await fetch(`/api/gallery/${id}`, { method: "DELETE" });
  const data = await res.json();
  if (data.storage) state.storage = data.storage;
  if (typeof data.total === "number") state.galleryTotal = data.total;
  removeGalleryIdsAcrossLists(new Set([id]));
  state.galleryViewTotal = Math.max(0, state.galleryViewTotal - 1);
  renderStorageBadges();
  renderWorkbenchHistory();
  renderFullGallery(false);
  showToast("已删除图库记录并释放 D 盘原图文件");
}

function editGalleryNotes(id) {
  openGalleryDetailModal(id);
  setTimeout(() => document.getElementById("gd-notes-input")?.focus(), 40);
}

async function syncGalleryFolder() {
  showToast("正在扫描 D:\\NAI-Studio\\outputs 同步磁盘原图...");
  const res = await fetch("/api/gallery/sync", { method: "POST" });
  const data = await res.json();
  if (Array.isArray(data.items)) state.gallery = data.items;
  if (typeof data.total === "number") state.galleryTotal = data.total;
  if (data.storage) state.storage = data.storage;
  const imported = data.imported ?? data.added_count ?? 0;
  const pruned = data.pruned_missing ?? 0;
  renderStorageBadges();
  renderWorkbenchHistory();
  await renderFullGallery(true);
  showToast(`同步完成：新收录 ${imported} 张，清理失效记录 ${pruned} 条`);
}

// ================= Tab 4: Settings, Dual Prompt Mode & LLM Agent =================
function initToolbarGlassSelects() {
  renderArtistSortSelect();
  renderArtistModalCatSelect();
  renderGalleryModelSelect();
  renderGallerySortSelect();
  renderLlmModelSelect();
}

function populateSettingsForm() {
  const tokIn = document.getElementById("settings-token-input");
  const outIn = document.getElementById("settings-output-dir");
  if (tokIn) tokIn.value = state.config.api_token_masked || "";
  if (outIn) outIn.value = state.config.output_dir || "D:\\NAI-Studio\\outputs";

  const llmUrl = document.getElementById("settings-llm-url");
  const llmKey = document.getElementById("settings-llm-key");
  const llmCustom = document.getElementById("settings-llm-model-custom");
  const llmAgentSw = document.getElementById("settings-llm-agent-switch");
  const llmCtx = document.getElementById("settings-llm-context");
  const llmMaxOut = document.getElementById("settings-llm-max-output");
  if (llmUrl) llmUrl.value = state.config.llm_base_url || "https://maas.qianwenaiapi.com/compatible-mode/v1";
  if (llmKey) llmKey.value = state.config.llm_api_key_masked || "";
  if (llmCustom) llmCustom.value = state.config.llm_model || "qwen4-max";
  if (llmCtx) llmCtx.value = String(state.config.llm_context_tokens || 100000);
  if (llmMaxOut) llmMaxOut.value = String(state.config.llm_max_output_tokens || 100000);
  if (llmAgentSw) {
    const on = state.config.llm_use_knowledge_agent !== false;
    llmAgentSw.classList.toggle("on", on);
    llmAgentSw.setAttribute("aria-checked", String(on));
  }
  const badge = document.getElementById("structured-agent-model-badge");
  if (badge) badge.textContent = state.config.llm_model || "qwen4-max";
  const statusPill = document.getElementById("settings-llm-status-pill");
  if (statusPill) {
    statusPill.textContent = state.config.llm_api_key_masked ? `已配置 · ${state.config.llm_model || "qwen4-max"}` : "未配置 Key";
  }
  renderLlmModelSelect();
  updatePromptWorkspaceModeButtons();
}

function selectLlmModel(val) {
  state.config.llm_model = val || "qwen4-max";
  const customIn = document.getElementById("settings-llm-model-custom");
  if (customIn) customIn.value = state.config.llm_model;
  const badge = document.getElementById("structured-agent-model-badge");
  if (badge) badge.textContent = state.config.llm_model;
  toggleGlassSelect("llm-model-select", false);
  renderLlmModelSelect();
}

function renderLlmModelSelect() {
  const cur = state.config.llm_model || "qwen4-max";
  const list = [...new Set([cur, ...(state.llmModels || [])].filter(Boolean))];
  renderSimpleGlassSelect(
    "llm-model-select",
    list.map(m => ({ value: m, label: m })),
    cur,
    "selectLlmModel"
  );
}

function toggleLlmKnowledgeAgent() {
  const next = state.config.llm_use_knowledge_agent === false;
  state.config.llm_use_knowledge_agent = next;
  const sw = document.getElementById("settings-llm-agent-switch");
  if (sw) {
    sw.classList.toggle("on", next);
    sw.setAttribute("aria-checked", String(next));
  }
}

async function refreshLlmModels() {
  const url = document.getElementById("settings-llm-url")?.value.trim() || "";
  const key = document.getElementById("settings-llm-key")?.value.trim() || "";
  const pill = document.getElementById("settings-llm-status-pill");
  if (pill) pill.textContent = "拉取模型列表中...";
  try {
    const res = await fetch("/api/llm/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_base_url: url, llm_api_key: key }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "拉取模型失败");
    state.llmModels = data.all_models?.length ? data.all_models : state.llmModels;
    renderLlmModelSelect();
    if (pill) pill.textContent = `可用 ${data.all_models?.length || 0} 个对话模型`;
    showToast(`已拉取 ${(data.all_models || []).length} 个可用大模型`);
  } catch (err) {
    if (pill) pill.textContent = "拉取失败";
    showToast(err.message || "拉取模型列表失败");
  }
}

function applyLlmContextPreset(tokens) {
  const ctxEl = document.getElementById("settings-llm-context");
  if (ctxEl) ctxEl.value = String(tokens);
}

async function saveLlmSettings() {
  const llm_base_url = document.getElementById("settings-llm-url")?.value.trim() || "";
  const llm_api_key = document.getElementById("settings-llm-key")?.value.trim() || "";
  const customModel = document.getElementById("settings-llm-model-custom")?.value.trim() || "";
  const llm_model = customModel || state.config.llm_model || "qwen4-max";
  const llm_use_knowledge_agent = state.config.llm_use_knowledge_agent !== false;
  const llm_context_tokens = Math.max(8000, Math.min(1000000, Number(document.getElementById("settings-llm-context")?.value || 100000)));
  const llm_max_output_tokens = Math.max(2048, Math.min(128000, Number(document.getElementById("settings-llm-max-output")?.value || 100000)));
  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        llm_base_url,
        llm_api_key,
        llm_model,
        llm_use_knowledge_agent,
        llm_context_tokens,
        llm_max_output_tokens,
        prompt_workspace_mode: state.promptWorkspaceMode,
        skip_account_check: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "保存失败");
    state.config = data.config || state.config;
    populateSettingsForm();
    showToast(`已保存 AI 配置 (${llm_model} · ${Math.round(llm_context_tokens / 1000)}K 上下文)`);
  } catch (err) {
    showToast(err.message || "保存 AI 配置失败");
  }
}

async function testLlmConnection() {
  const url = document.getElementById("settings-llm-url")?.value.trim() || "";
  const key = document.getElementById("settings-llm-key")?.value.trim() || "";
  const model = document.getElementById("settings-llm-model-custom")?.value.trim() || state.config.llm_model || "qwen4-max";
  const pill = document.getElementById("settings-llm-status-pill");
  if (pill) pill.textContent = `正在测试 ${model}...`;
  try {
    const res = await fetch("/api/llm/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm_base_url: url, llm_api_key: key, llm_model: model }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "连接失败");
    if (pill) pill.textContent = `连通正常 · ${data.model} (${data.latency_ms}ms)`;
    showToast(`LLM 连通成功：${data.model} (${data.latency_ms}ms)`);
  } catch (err) {
    if (pill) pill.textContent = "连通失败";
    showToast(err.message || "LLM 测试失败");
  }
}

function updatePromptWorkspaceModeButtons() {
  const mode = state.promptWorkspaceMode === "structured" ? "structured" : "classic";
  document.getElementById("mode-btn-classic")?.classList.toggle("is-active", mode === "classic");
  document.getElementById("mode-btn-structured")?.classList.toggle("is-active", mode === "structured");
}

async function setPromptWorkspaceMode(mode, persist = true) {
  const next = mode === "structured" ? "structured" : "classic";
  state.promptWorkspaceMode = next;
  state.config.prompt_workspace_mode = next;
  document.getElementById("prompt-mode-classic")?.classList.toggle("hidden", next !== "classic");
  document.getElementById("prompt-mode-structured")?.classList.toggle("hidden", next !== "structured");
  updatePromptWorkspaceModeButtons();

  if (next === "structured") {
    syncClassicToStructured();
  } else {
    syncPromptImmediateVisuals("pos");
    syncPromptImmediateVisuals("uc");
  }
  if (persist) {
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_workspace_mode: next, skip_account_check: true }),
      });
      showToast(next === "structured" ? "已切换至四区块 + AI 导演提示词窗口" : "已切换至经典官网提示词窗口");
    } catch (e) {}
  }
}

function _isLightingOrSceneSeg(cleanLower) {
  return /\b(lighting|backlighting|rim lighting|cinematic|sunlight|sunset|sunrise|twilight|golden hour|moonlight|starry sky|cloudy sky|tyndall|sunbeam|lens flare|bokeh|depth of field|chromatic aberration|sparkles|floating petals|wind|water drop|rain|snow|rooftop|classroom|ocean|beach|underwater|cityscape|ruins|stained glass|background|cowboy shot|upper body|full body|portrait|close-up|from above|from below|from side|from behind|dynamic angle|dutch angle|atmosphere|masterpiece|best quality|very aesthetic|absurdres|high complexity|ultra complexity|low complexity)\b/.test(cleanLower);
}

function syncClassicToStructured() {
  const rawPos = document.getElementById("prompt-input")?.value || "";
  const rawUc = document.getElementById("uc-input")?.value || "";
  const knownArtists = new Set((state.artists || []).map(a => String(a.tag || "").trim().toLowerCase()));
  const artistSegs = [];
  const charSegs = [];
  const lightSegs = [];

  parsePromptSegments(rawPos).forEach(seg => {
    const clean = seg.replace(/^\{+|\[+|\}+|\]+$/g, "").replace(/^-?\d+(?:\.\d+)?::|::$/g, "").trim().toLowerCase();
    if (clean.startsWith("artist:") || knownArtists.has(clean) || clean === "watercolor (medium)" || clean === "impasto") {
      artistSegs.push(seg);
    } else if (_isLightingOrSceneSeg(clean)) {
      lightSegs.push(seg);
    } else {
      charSegs.push(seg);
    }
  });

  const aEl = document.getElementById("block-artist-input");
  const cEl = document.getElementById("block-character-input");
  const lEl = document.getElementById("block-lighting-input");
  const nEl = document.getElementById("block-negative-input");
  if (aEl) aEl.value = artistSegs.join(", ");
  if (cEl) cEl.value = charSegs.join(", ");
  if (lEl) lEl.value = lightSegs.join(", ");
  if (nEl) nEl.value = rawUc;
  updateStructuredBlockCounts();
}

function updateStructuredBlockCounts() {
  const map = [
    ["block-artist-input", "block-artist-count"],
    ["block-character-input", "block-character-count"],
    ["block-lighting-input", "block-lighting-count"],
    ["block-negative-input", "block-negative-count"],
  ];
  let posTotal = 0;
  map.forEach(([inId, cntId], idx) => {
    const val = document.getElementById(inId)?.value || "";
    const count = parsePromptSegments(val).length;
    if (idx < 3) posTotal += count;
    const el = document.getElementById(cntId);
    if (el) el.textContent = String(count);
  });
  const totEl = document.getElementById("structured-total-count");
  if (totEl) totEl.textContent = `${posTotal} tags`;
  window.refreshAgentLiveStrip?.();
}

function clearStructuredBlock(blockKey) {
  const el = document.getElementById(`block-${blockKey}-input`);
  if (!el) return;
  el.value = "";
  syncStructuredToClassic();
}

function openAgentForPromptReview() {
  window.toggleAgentWindow?.(true);
  const issues = state.lastLintResult?.issues || [];
  if (issues.length > 0) {
    window.quickSendAgent?.("请检查我当前四区块提示词里的语法或冲突问题，并直接帮我修复规范化。");
  } else {
    window.quickSendAgent?.("请审阅我当前的四区块提示词，看看画面表现力或权重配比有哪些可以进一步提升的地方。");
  }
}

function syncStructuredToClassic() {
  const aVal = (document.getElementById("block-artist-input")?.value || "").trim();
  const cVal = (document.getElementById("block-character-input")?.value || "").trim();
  const lVal = (document.getElementById("block-lighting-input")?.value || "").trim();
  const nVal = (document.getElementById("block-negative-input")?.value || "").trim();
  const combinedPos = [aVal, cVal, lVal].filter(Boolean).join(", ");

  const ta = document.getElementById("prompt-input");
  const uc = document.getElementById("uc-input");
  if (ta) ta.value = combinedPos;
  if (uc) uc.value = nVal;
  updateStructuredBlockCounts();
  syncPromptImmediateVisuals("pos");
  syncPromptImmediateVisuals("uc");
  clearTimeout(state.lintTimer);
  state.lintTimer = setTimeout(() => runPromptLinter("pos"), 320);
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

// ================= Studio Appearance Studio (Coordinated Dark/Light Presets, Texture & Blur) =================
const APPEARANCE_LOCAL_KEY = "nai_studio_appearance_v1";

const APPEARANCE_PRESETS = {
  dark: [
    { id: "obsidian", name: "曜石暗房", base: "#0a0c10", well: "#06080b", panel: "#0e1117", alt: "#131720", dot: "rgba(255,255,255,0.055)", hex: "#080a0f" },
    { id: "slate", name: "深海石板", base: "#091016", well: "#060b10", panel: "#0d151c", alt: "#121c25", dot: "rgba(226,236,245,0.06)", hex: "#091319" },
    { id: "graphite", name: "中性石墨", base: "#101113", well: "#0b0c0e", panel: "#141619", alt: "#1a1c20", dot: "rgba(255,255,255,0.05)", hex: "#121417" },
    { id: "midnight", name: "午夜靛蓝", base: "#0a0e18", well: "#060912", panel: "#0e1320", alt: "#141a2b", dot: "rgba(220,232,255,0.055)", hex: "#0c1724" },
    { id: "jade", name: "墨玉青灰", base: "#091311", well: "#050d0b", panel: "#0d1815", alt: "#12201c", dot: "rgba(220,245,235,0.055)", hex: "#0e1d19" },
    { id: "espresso", name: "暖岩炭棕", base: "#120f0d", well: "#0c0a08", panel: "#161311", alt: "#1e1a17", dot: "rgba(255,244,232,0.05)", hex: "#161311" },
  ],
  light: [
    { id: "paper", name: "中性制图灰", base: "#eaedf2", well: "#e3e7ee", panel: "#f6f7f9", alt: "#edf0f5", dot: "rgba(15,23,42,0.085)", hex: "#e3e7ee" },
    { id: "gallery", name: "纯白画廊", base: "#f0f2f5", well: "#eaedf2", panel: "#ffffff", alt: "#f4f6f8", dot: "rgba(15,23,42,0.075)", hex: "#eaedf2" },
    { id: "cotton", name: "暖调棉纸", base: "#f2efe9", well: "#eae5dc", panel: "#faf8f4", alt: "#f0ece4", dot: "rgba(45,35,20,0.075)", hex: "#eae5dc" },
    { id: "mist", name: "雾青灰调", base: "#eaf0f2", well: "#e1e9ec", panel: "#f5f8f9", alt: "#eaf0f3", dot: "rgba(15,40,50,0.08)", hex: "#e1e9ec" },
    { id: "sand", name: "砂岩浅灰", base: "#eeece8", well: "#e5e2dc", panel: "#f7f6f3", alt: "#edeae4", dot: "rgba(35,32,26,0.08)", hex: "#e5e2dc" },
    { id: "ice", name: "冷调冰蓝", base: "#eaf0f8", well: "#dfe7f2", panel: "#f5f8fc", alt: "#eaf0f7", dot: "rgba(15,35,65,0.08)", hex: "#dfe7f2" },
  ],
};

function loadAppearanceLocal() {
  try {
    return JSON.parse(localStorage.getItem(APPEARANCE_LOCAL_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function saveAppearanceLocal(patch) {
  try {
    const cur = loadAppearanceLocal();
    localStorage.setItem(APPEARANCE_LOCAL_KEY, JSON.stringify({ ...cur, ...patch }));
  } catch (e) {}
}

function hexToHsl(hex) {
  const clean = (hex || "#091319").replace("#", "");
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
  const nextHidden = typeof force === "boolean" ? !force : !m.classList.contains("hidden");
  m.classList.toggle("hidden", nextHidden);
  if (!nextHidden) renderAppearanceMenu();
}

let _bgConfigTimer = null;
let _clarityConfigTimer = null;

function clearCustomSurfaceVars() {
  const root = document.documentElement.style;
  ["--bg-base", "--bg-canvas-well", "--surface-panel", "--surface-panel-alt", "--canvas-dot-color"].forEach(v =>
    root.removeProperty(v)
  );
}

function renderAppearanceMenu() {
  const isLight = document.documentElement.classList.contains("light");
  const modeKey = isLight ? "light" : "dark";
  const darkBtn = document.getElementById("appearance-mode-dark");
  const lightBtn = document.getElementById("appearance-mode-light");
  if (darkBtn) {
    darkBtn.className = !isLight
      ? "appearance-mode-btn spring-btn px-2.5 py-1 rounded-[5px] font-medium bg-[var(--cta-bg)] text-[var(--cta-fg)]"
      : "appearance-mode-btn spring-btn px-2.5 py-1 rounded-[5px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]";
  }
  if (lightBtn) {
    lightBtn.className = isLight
      ? "appearance-mode-btn spring-btn px-2.5 py-1 rounded-[5px] font-medium bg-[var(--cta-bg)] text-[var(--cta-fg)]"
      : "appearance-mode-btn spring-btn px-2.5 py-1 rounded-[5px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]";
  }

  const local = loadAppearanceLocal();
  const activePresetId = isLight ? local.lightPresetId || "paper" : local.darkPresetId || "obsidian";
  const presets = APPEARANCE_PRESETS[modeKey];
  const activePreset = presets.find(p => p.id === activePresetId);
  const labelEl = document.getElementById("appearance-preset-label");
  if (labelEl) {
    labelEl.textContent = activePreset ? activePreset.name : state.config.bg_preset_name || "自定义色";
  }

  const grid = document.getElementById("appearance-presets-grid");
  if (grid) {
    grid.innerHTML = presets
      .map(p => {
        const isAct = p.id === activePresetId && !local[`customHex_${modeKey}`];
        return `
        <button type="button" onclick="applyAppearancePreset('${p.id}')" class="spring-btn text-left rounded-[8px] p-1.5 border transition-colors ${
          isAct
            ? "border-[var(--cta-bg)] bg-[var(--accent-tint)]"
            : "border-[var(--border-hairline)] hover:border-[var(--border-hover)] bg-[var(--surface-panel-alt)]"
        }">
          <div class="h-5 rounded-[5px] overflow-hidden flex border border-[var(--border-hairline)] mb-1">
            <span class="w-1/2 h-full block" style="background:${p.panel}"></span>
            <span class="w-1/2 h-full block" style="background:${p.well}"></span>
          </div>
          <div class="text-[11px] font-medium truncate text-[var(--text-primary)]">${escapeHtml(p.name)}</div>
        </button>
      `;
      })
      .join("");
  }

  document.querySelectorAll(".canvas-tex-btn").forEach(btn => {
    const act = btn.dataset.tex === state.canvasTexture;
    btn.className = act
      ? "canvas-tex-btn spring-btn py-1 rounded-[5px] font-medium bg-[var(--cta-bg)] text-[var(--cta-fg)]"
      : "canvas-tex-btn spring-btn py-1 rounded-[5px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)]";
  });
}

function applyAppearancePreset(presetId, persist = true) {
  const isLight = document.documentElement.classList.contains("light");
  const modeKey = isLight ? "light" : "dark";
  const presets = APPEARANCE_PRESETS[modeKey];
  const preset = presets.find(p => p.id === presetId) || presets[0];

  const root = document.documentElement.style;
  root.setProperty("--bg-base", preset.base);
  root.setProperty("--bg-canvas-well", preset.well);
  root.setProperty("--surface-panel", preset.panel);
  root.setProperty("--surface-panel-alt", preset.alt);
  root.setProperty("--canvas-dot-color", preset.dot);

  state.config.bg_hex = preset.hex;
  state.config.bg_preset_name = preset.name;
  const picker = document.getElementById("bg-color-picker");
  const hexLbl = document.getElementById("bg-hex-label");
  if (picker) picker.value = preset.well;
  if (hexLbl) hexLbl.textContent = preset.well.toUpperCase();

  saveAppearanceLocal({
    [`${modeKey}PresetId`]: preset.id,
    [`customHex_${modeKey}`]: "",
  });

  setGlassClarity(state.config.glass_clarity || 88, false);
  renderAppearanceMenu();

  if (persist) {
    showToast(`已应用外观：${preset.name}`);
    clearTimeout(_bgConfigTimer);
    _bgConfigTimer = setTimeout(() => {
      fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bg_hex: preset.hex, bg_preset_name: preset.name }),
      });
    }, 0);
  }
}

function applyBgHex(hex, presetName = null, persist = true) {
  const normalizedHex = /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#091319";
  const isLight = document.documentElement.classList.contains("light");
  const modeKey = isLight ? "light" : "dark";
  state.config.bg_hex = normalizedHex;
  const picker = document.getElementById("bg-color-picker");
  const label = document.getElementById("bg-hex-label");
  if (picker) picker.value = normalizedHex;
  if (label) label.textContent = normalizedHex.toUpperCase();

  const [h, s, l] = hexToHsl(normalizedHex);
  const root = document.documentElement.style;

  if (isLight) {
    const sat = Math.min(s, 14);
    root.setProperty("--bg-base", `hsl(${h}, ${sat}%, 92%)`);
    root.setProperty("--bg-canvas-well", `hsl(${h}, ${Math.min(s, 18)}%, 88%)`);
    root.setProperty("--surface-panel", `hsl(${h}, ${Math.min(sat, 10)}%, 97%)`);
    root.setProperty("--surface-panel-alt", `hsl(${h}, ${Math.min(sat, 12)}%, 94%)`);
  } else {
    const sat = Math.min(s, 22);
    const baseL = Math.min(Math.max(l, 4), 11);
    root.setProperty("--bg-base", `hsl(${h}, ${sat}%, ${baseL}%)`);
    root.setProperty("--bg-canvas-well", `hsl(${h}, ${sat}%, ${Math.max(2, baseL - 3)}%)`);
    root.setProperty("--surface-panel", `hsl(${h}, ${sat}%, ${baseL + 2}%)`);
    root.setProperty("--surface-panel-alt", `hsl(${h}, ${sat}%, ${baseL + 5}%)`);
  }

  saveAppearanceLocal({ [`customHex_${modeKey}`]: normalizedHex });
  setGlassClarity(state.config.glass_clarity || 88, false);
  renderAppearanceMenu();

  if (persist) {
    clearTimeout(_bgConfigTimer);
    _bgConfigTimer = setTimeout(() => {
      fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bg_hex: normalizedHex, bg_preset_name: presetName || "自定义色" }),
      });
    }, 180);
  }
}

function setCanvasTexture(tex = "dots", persist = true) {
  const valid = ["dots", "grid", "frame", "solid"].includes(tex) ? tex : "dots";
  state.canvasTexture = valid;
  document.querySelectorAll(".studio-canvas-grid").forEach(el => {
    el.classList.remove("tex-grid", "tex-frame", "tex-solid");
    if (valid !== "dots") el.classList.add(`tex-${valid}`);
  });
  if (persist) saveAppearanceLocal({ canvasTexture: valid });
  renderAppearanceMenu();
}

function setGlassClarity(val, persist = true) {
  const clarity = Math.max(50, Math.min(96, Number(val) || 88));
  state.config.glass_clarity = clarity;
  const valEl = document.getElementById("glass-clarity-val");
  const slider = document.getElementById("glass-clarity-slider");
  if (valEl) valEl.textContent = `${clarity}%`;
  if (slider) slider.value = String(clarity);

  const isLight = document.documentElement.classList.contains("light");
  const alpha = Math.max(0.5, Math.min(0.96, clarity / 100));
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

function setGlassBlur(val, persist = true) {
  const px = Math.max(0, Math.min(24, Number(val)));
  state.glassBlur = px;
  document.documentElement.style.setProperty("--hud-blur", `${px}px`);
  const valEl = document.getElementById("glass-blur-val");
  const slider = document.getElementById("glass-blur-slider");
  if (valEl) valEl.textContent = `${px}px`;
  if (slider) slider.value = String(px);
  if (persist) saveAppearanceLocal({ glassBlur: px });
}

function applySavedThemeSurface(isLight) {
  const local = loadAppearanceLocal();
  const modeKey = isLight ? "light" : "dark";
  const customHex = local[`customHex_${modeKey}`];
  if (customHex) {
    applyBgHex(customHex, "自定义微调", false);
  } else {
    const presetId = local[`${modeKey}PresetId`] || (isLight ? "paper" : "obsidian");
    applyAppearancePreset(presetId, false);
  }
}

function initAppearanceSettings(cfg = {}) {
  const rootEl = document.documentElement;
  const isLight = cfg.theme === "light";
  rootEl.classList.toggle("light", isLight);
  document.getElementById("theme-label").textContent = isLight ? "深色模式" : "浅色模式";
  document.getElementById("theme-icon-use")?.setAttribute("href", isLight ? "#ic-moon" : "#ic-sun");

  const local = loadAppearanceLocal();
  // Map legacy saved dark preset hex if user hasn't picked a per-theme preset yet
  if (cfg.bg_hex && !local.darkPresetId) {
    const matchDark = APPEARANCE_PRESETS.dark.find(p => p.hex.toLowerCase() === cfg.bg_hex.toLowerCase());
    if (matchDark) saveAppearanceLocal({ darkPresetId: matchDark.id });
  }
  applySavedThemeSurface(isLight);
  setCanvasTexture(local.canvasTexture || "dots", false);
  setGlassClarity(cfg.glass_clarity || 88, false);
  setGlassBlur(local.glassBlur !== undefined ? local.glassBlur : 18, false);
}

function setThemeMode(mode) {
  const wantLight = mode === "light";
  const isCurrentlyLight = document.documentElement.classList.contains("light");
  if (wantLight === isCurrentlyLight) return;
  toggleTheme();
}

function resetAppearanceDefaults() {
  const isLight = document.documentElement.classList.contains("light");
  const modeKey = isLight ? "light" : "dark";
  const defaultId = isLight ? "paper" : "obsidian";
  saveAppearanceLocal({
    [`${modeKey}PresetId`]: defaultId,
    [`customHex_${modeKey}`]: "",
    canvasTexture: "dots",
    glassBlur: 18,
  });
  clearCustomSurfaceVars();
  applyAppearancePreset(defaultId, true);
  setCanvasTexture("dots", true);
  setGlassClarity(88, true);
  setGlassBlur(18, true);
  showToast("已恢复当前主题默认外观");
}

function toggleTheme() {
  const rootEl = document.documentElement;
  rootEl.classList.add("theme-sync");
  const isLight = rootEl.classList.toggle("light");
  document.getElementById("theme-label").textContent = isLight ? "深色模式" : "浅色模式";
  document.getElementById("theme-icon-use")?.setAttribute("href", isLight ? "#ic-moon" : "#ic-sun");
  applySavedThemeSurface(isLight);
  void rootEl.offsetHeight;
  requestAnimationFrame(() => rootEl.classList.remove("theme-sync"));
  fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme: isLight ? "light" : "dark" }),
  });
}

// ================= V2.1 Interactive Tag Pills (Pos + UC Unified) & Dynamic Wildcard Preview =================
const QUICK_CN_HINTS = {
  "1girl": "单人女孩", "1boy": "单人男孩", "solo": "单人", "silver hair": "银发",
  "blue eyes": "蓝眼", "serafuku": "水手服", "sunset": "夕阳", "backlighting": "逆光",
  "wind": "微风", "detailed eyes": "精致瞳孔", "rooftop": "天台",
  "transparent background": "透明底", "masterpiece": "杰作", "best quality": "最佳画质",
  "lowres": "低分辨率", "bad anatomy": "人体崩坏", "bad hands": "手部崩坏",
  "missing fingers": "缺指", "extra digit": "多指", "fewer digits": "少指",
  "blurry": "模糊", "watermark": "水印", "worst quality": "最差画质",
  "bad quality": "低质量", "jpeg artifacts": "压缩噪点", "extra arms": "多余手臂", "extra legs": "多余腿部"
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

function getActiveEffectiveSidePrompt(side = "pos") {
  const { ta, mutedSet } = getSideElements(side);
  const raw = ta?.value || "";
  if (!mutedSet || mutedSet.size === 0) return raw.trim();
  const kept = parsePromptSegments(raw).filter(seg => !mutedSet.has(seg.toLowerCase()));
  return kept.join(", ");
}

function getActiveEffectivePrompt() {
  return getActiveEffectiveSidePrompt("pos");
}

function getActiveEffectiveUc() {
  return getActiveEffectiveSidePrompt("uc");
}

let _dragTagIdx = null;
let _dragTagSide = "pos";
function handleTagDragStart(idx, ev, side = "pos") {
  _dragTagIdx = idx;
  _dragTagSide = side;
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
function handleTagDrop(targetIdx, ev, side = "pos") {
  ev.preventDefault();
  ev.currentTarget?.classList.remove("drag-over");
  const fromIdx = _dragTagIdx;
  const fromSide = _dragTagSide;
  _dragTagIdx = null;
  if (fromIdx === null || fromIdx === targetIdx || fromSide !== side) return;
  const { ta } = getSideElements(side);
  if (!ta) return;
  const segs = parsePromptSegments(ta.value);
  if (fromIdx < 0 || fromIdx >= segs.length || targetIdx < 0 || targetIdx >= segs.length) return;
  const [moved] = segs.splice(fromIdx, 1);
  segs.splice(targetIdx, 0, moved);
  ta.value = segs.join(", ");
  syncPromptImmediateVisuals(side);
  runPromptLinter(side);
}

function renderTagPillsBar(side = "pos") {
  const { ta, pillsBar: bar, countEl: cnt, mutedSet } = getSideElements(side);
  if (!bar || !ta) return;

  const segments = parsePromptSegments(ta.value);
  if (cnt) cnt.textContent = `${segments.length}` + (mutedSet.size ? `·${mutedSet.size}静音` : "");
  if (!segments.length) {
    bar.innerHTML = `<span class="text-[12px] text-[var(--muted-foreground)]">${
      side === "uc" ? "输入负面词后自动生成可调权重的 Tag 胶囊..." : "输入提示词后自动生成可拖拽排序的 Tag 胶囊..."
    }</span>`;
    return;
  }

  bar.innerHTML = segments
    .map((seg, idx) => {
      const isMuted = mutedSet.has(seg.toLowerCase());
      const isWildcard = /\{[^}]*\|[^}]*\}|__[a-zA-Z0-9_\-]+__/.test(seg);
      const hasWeight = /^(\{+|\[+|-?\d+(?:\.\d+)?::)/.test(seg);
      const cleanKey = seg.replace(/^\{+|\[+|\}+|\]+$/g, "").replace(/^-?\d+(?:\.\d+)?::|::$/g, "").trim().toLowerCase();
      const cn = QUICK_CN_HINTS[cleanKey] || "";
      const cls = `tag-pill ${isMuted ? "muted" : ""} ${isWildcard ? "wildcard" : hasWeight ? "weighted" : ""}`;
      return `
        <span class="${cls}" draggable="true" ondragstart="handleTagDragStart(${idx}, event, '${side}')" ondragover="handleTagDragOver(event)" ondragleave="handleTagDragLeave(event)" ondrop="handleTagDrop(${idx}, event, '${side}')" onclick="toggleMuteTagPill(${idx}, '${side}')" title="单击静音/恢复，拖拽调整词序，右侧 +/- 调权重">
          <span class="font-mono">${escapeHtml(seg)}</span>
          ${cn ? `<span class="tag-pill-cn">${escapeHtml(cn)}</span>` : ""}
          <button type="button" onclick="event.stopPropagation();adjustTagPillWeight(${idx}, 1, '${side}')" class="px-1 rounded-[6px] hover:bg-[var(--accent-tint)] text-[12px] font-bold" title="增加权重">+</button>
          <button type="button" onclick="event.stopPropagation();adjustTagPillWeight(${idx}, -1, '${side}')" class="px-1 rounded-[6px] hover:bg-[var(--accent-tint)] text-[12px] font-bold" title="降低权重">−</button>
        </span>
      `;
    })
    .join("");
}

function toggleMuteTagPill(idx, side = "pos") {
  const { ta, mutedSet } = getSideElements(side);
  if (!ta) return;
  const segs = parsePromptSegments(ta.value);
  const seg = segs[idx];
  if (!seg) return;
  const key = seg.toLowerCase();
  if (mutedSet.has(key)) mutedSet.delete(key);
  else mutedSet.add(key);
  syncPromptImmediateVisuals(side);
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

function adjustTagPillWeight(idx, delta, side = "pos") {
  const { ta } = getSideElements(side);
  if (!ta) return;
  const segs = parsePromptSegments(ta.value);
  if (idx < 0 || idx >= segs.length) return;
  segs[idx] = clientAdjustTokenWeight(segs[idx], delta);
  ta.value = segs.join(", ");
  syncPromptImmediateVisuals(side);
  runPromptLinter(side);
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
  if (el.id === "prompt-input") {
    syncPromptImmediateVisuals("pos");
    runPromptLinter("pos");
  } else if (el.id === "uc-input") {
    syncPromptImmediateVisuals("uc");
    runPromptLinter("uc");
  } else if (el.classList.contains("char-prompt-ta")) el.dispatchEvent(new Event("input"));
}

// ================= V2.1 Stage Zoom/Pan, Clipboard, Lightbox & Draggable Char Dots =================
function applyStageTransform() {
  const stage = document.getElementById("artwork-stage");
  const lbl = document.getElementById("stage-zoom-label");
  if (stage) {
    stage.style.transform = `translate(${state.stagePanX}px, ${state.stagePanY}px) scale(${state.stageZoom})`;
  }
  if (lbl) lbl.textContent = `${Math.round(state.stageZoom * 100)}%`;
  updateStageActionButtons();
}

function zoomStage(delta) {
  if (!hasStageImage()) return;
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
      if (state.action === "infill" || !hasStageImage()) return;
      e.preventDefault();
      zoomStage(e.deltaY < 0 ? 0.12 : -0.12);
    },
    { passive: false }
  );

  wrap.addEventListener("pointerdown", e => {
    if (!hasStageImage() || state.stageZoom <= 1.0 || state.action === "infill" || e.target.closest(".char-stage-dot")) return;
    panning = true;
    sx = e.clientX;
    sy = e.clientY;
    ox = state.stagePanX;
    oy = state.stagePanY;
    wrap.classList.add("is-panning");
  });
  window.addEventListener("pointermove", e => {
    if (!panning) return;
    state.stagePanX = ox + (e.clientX - sx);
    state.stagePanY = oy + (e.clientY - sy);
    applyStageTransform();
  });
  const endPan = () => {
    if (!panning) return;
    panning = false;
    wrap.classList.remove("is-panning");
  };
  window.addEventListener("pointerup", endPan);
  window.addEventListener("pointercancel", endPan);
}

function toggleCheckerboard() {
  state.checkerboard = !state.checkerboard;
  document.getElementById("stage-dropzone")?.classList.toggle("checkerboard-bg", state.checkerboard);
  document.getElementById("lightbox-stage")?.classList.toggle("checkerboard-bg", state.checkerboard);
  [document.getElementById("checkerboard-btn"), document.getElementById("lightbox-checkerboard-btn")].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle("is-active", state.checkerboard);
    btn.setAttribute("aria-pressed", String(state.checkerboard));
  });
}

async function copyImageSource(url) {
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

async function copyStageImage() {
  await copyImageSource(getActiveStageImageSource());
}

async function copyLightboxImage() {
  const img = document.getElementById("lightbox-img");
  const rawSrc = img?.getAttribute("src") || "";
  await copyImageSource(rawSrc);
}

function openLightbox(idx = null) {
  const activeStageSrc = getActiveStageImageSource();
  if (!state.gallery.length && !activeStageSrc) {
    showToast("当前暂无可全屏查看的图片");
    return;
  }
  const img = document.getElementById("lightbox-img");
  const cap = document.getElementById("lightbox-caption");
  const canNavigate = state.gallery.length > 1;
  document.querySelectorAll('#lightbox-modal [onclick*="navigateLightbox"]').forEach(btn => {
    btn.disabled = !canNavigate;
  });

  if (idx === null && state.stageImageB64) {
    state.lightboxIdx = -1;
    if (img) img.src = state.stageImageB64;
    if (cap) cap.textContent = "当前画布预览（本地载入）";
    document.getElementById("lightbox-modal")?.classList.remove("hidden");
    return;
  }

  if (idx === null) {
    const found = state.gallery.findIndex(g => g.image_url === state.stageImageUrl);
    state.lightboxIdx = found >= 0 ? found : 0;
  } else {
    state.lightboxIdx = Math.max(0, Math.min(idx, state.gallery.length - 1));
  }
  const item = state.gallery[state.lightboxIdx];
  if (img) img.src = item ? item.image_url : activeStageSrc;
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
      const overlayIds = [
        "studio-confirm-modal",
        "gallery-detail-modal",
        "lightbox-modal",
        "diff-modal",
        "oc-modal",
        "wildcard-modal",
        "inspect-png-modal",
        "xyz-modal",
        "snapshot-modal",
        "snippet-modal",
        "custom-artist-modal",
        "bg-menu",
        "director-menu",
        "inline-autocomplete-menu",
      ];
      const anyOverlayOpen = overlayIds.some(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains("hidden");
      });
      resolveStudioConfirm(false);
      closeGalleryDetailModal();
      closeLightbox();
      closeInspectPngModal();
      toggleOcModal(false);
      toggleWildcardModal(false);
      toggleXyzModal(false);
      toggleSnapshotModal(false);
      toggleSnippetModal(false);
      toggleCustomArtistModal(false);
      toggleBgMenu(false);
      document.getElementById("diff-modal")?.classList.add("hidden");
      document.getElementById("director-menu")?.classList.add("hidden");
      document.getElementById("inline-autocomplete-menu")?.classList.add("hidden");
      hideFastTooltip(true);
      if (!anyOverlayOpen && state.selectedGalleryIds?.size > 0) {
        clearGallerySelection();
      } else if (!anyOverlayOpen && state.immersionMode) {
        toggleImmersionMode(false);
      }
      return;
    }
    const detailOpen = !document.getElementById("gallery-detail-modal")?.classList.contains("hidden");
    if (detailOpen) {
      if (e.key === "ArrowLeft") navigateGalleryDetail(-1);
      if (e.key === "ArrowRight") navigateGalleryDetail(1);
      return;
    }
    const lbOpen = !document.getElementById("lightbox-modal")?.classList.contains("hidden");
    if (lbOpen) {
      if (e.key === "ArrowLeft") navigateLightbox(-1);
      if (e.key === "ArrowRight") navigateLightbox(1);
      return;
    }
    const activePromptId = document.activeElement?.id;
    if ((e.ctrlKey || e.metaKey) && (activePromptId === "prompt-input" || activePromptId === "uc-input")) {
      const targetSide = activePromptId === "uc-input" ? "uc" : "pos";
      if (e.key === "ArrowUp") {
        e.preventDefault();
        adjustSelectedWeight(1, targetSide);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        adjustSelectedWeight(-1, targetSide);
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
          setStageLocalImage(ev.target.result);
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
  syncPromptImmediateVisuals("pos");
  syncPromptImmediateVisuals("uc");
  runPromptLinter("pos");
  runPromptLinter("uc");
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
function toggleImmersionMode(force) {
  state.immersionMode = typeof force === "boolean" ? force : !state.immersionMode;
  const view = document.getElementById("view-workbench");
  const btn = document.getElementById("immersion-btn");
  const lbl = document.getElementById("immersion-btn-label");
  if (view) view.classList.toggle("immersion-active", state.immersionMode);
  if (lbl) lbl.textContent = state.immersionMode ? "退出" : "沉浸";
  if (btn) {
    btn.classList.toggle("is-active", state.immersionMode);
    btn.setAttribute("aria-pressed", String(state.immersionMode));
    setElementTooltip(btn, state.immersionMode ? "退出沉浸模式 (快捷键 Esc)" : "隐藏左右面板专注看图 (Esc 退出)");
  }
  syncCollapsedGenerateVisibility();
}

// ================= Fast Custom Tooltip & Modal Backdrop UX =================
let _tooltipTimer = null;
let _tooltipTarget = null;
let _tooltipLastHideAt = 0;

function hideFastTooltip(immediate = false) {
  clearTimeout(_tooltipTimer);
  _tooltipTimer = null;
  _tooltipTarget = null;
  const tipEl = document.getElementById("studio-tooltip");
  if (tipEl && tipEl.classList.contains("is-visible")) {
    tipEl.classList.remove("is-visible");
    tipEl.setAttribute("aria-hidden", "true");
    if (!immediate) _tooltipLastHideAt = performance.now();
  }
}

function renderTooltipText(tipEl, raw) {
  const m = raw.match(/^(.*?)\s*\(([^()]{1,22})\)\s*$/);
  if (m && /(快捷键|Esc|Ctrl|\[|\])/i.test(m[2])) {
    tipEl.innerHTML = `${escapeHtml(m[1])}<kbd>${escapeHtml(m[2])}</kbd>`;
  } else {
    tipEl.textContent = raw;
  }
}

function showFastTooltipFor(el) {
  const text = el?.dataset?.tip;
  const tipEl = document.getElementById("studio-tooltip");
  if (!el || !text || !tipEl) return;
  renderTooltipText(tipEl, text);
  tipEl.classList.add("is-visible");
  tipEl.setAttribute("aria-hidden", "false");

  const r = el.getBoundingClientRect();
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  const pad = 8;
  const topSpace = r.top - pad;
  const bottomSpace = window.innerHeight - r.bottom - pad;
  const placeBelow = bottomSpace >= th + 8 || bottomSpace >= topSpace;
  const top = placeBelow ? Math.min(window.innerHeight - th - pad, r.bottom + 7) : Math.max(pad, r.top - th - 7);
  const left = Math.max(pad, Math.min(window.innerWidth - tw - pad, r.left + r.width / 2 - tw / 2));
  tipEl.style.top = `${Math.round(top)}px`;
  tipEl.style.left = `${Math.round(left)}px`;
}

function setupFastTooltips() {
  const migrateTitles = root => {
    root?.querySelectorAll?.("[title]").forEach(el => {
      const t = el.getAttribute("title");
      if (t) el.dataset.tip = t;
      el.removeAttribute("title");
    });
  };
  migrateTitles(document);

  const resolveTipHost = node => {
    const el = node?.nodeType === 1 ? node.closest("[title], [data-tip]") : null;
    if (!el) return null;
    if (el.hasAttribute("title")) {
      const t = el.getAttribute("title");
      if (t) el.dataset.tip = t;
      el.removeAttribute("title");
    }
    return el.dataset.tip ? el : null;
  };

  document.addEventListener("pointerover", e => {
    if (e.pointerType === "touch") return;
    const host = resolveTipHost(e.target);
    if (!host) return;
    if (_tooltipTarget === host) return;
    clearTimeout(_tooltipTimer);
    _tooltipTarget = host;
    const warm = performance.now() - _tooltipLastHideAt < 260;
    _tooltipTimer = setTimeout(() => showFastTooltipFor(host), warm ? 24 : 90);
  });

  document.addEventListener("pointerout", e => {
    if (!_tooltipTarget) return;
    if (!_tooltipTarget.contains(e.relatedTarget)) {
      hideFastTooltip(false);
    }
  });

  document.addEventListener("pointerdown", () => hideFastTooltip(true), true);
  window.addEventListener("scroll", () => hideFastTooltip(true), true);
  document.addEventListener("focusin", e => {
    const host = resolveTipHost(e.target);
    if (host && host.matches(":focus-visible")) {
      clearTimeout(_tooltipTimer);
      _tooltipTarget = host;
      showFastTooltipFor(host);
    }
  });
  document.addEventListener("focusout", () => hideFastTooltip(true));
}

function setupModalBackdropClose() {
  const closers = {
    "studio-confirm-modal": () => resolveStudioConfirm(false),
    "gallery-detail-modal": () => closeGalleryDetailModal(),
    "custom-artist-modal": () => toggleCustomArtistModal(false),
    "diff-modal": () => document.getElementById("diff-modal")?.classList.add("hidden"),
    "oc-modal": () => toggleOcModal(false),
    "wildcard-modal": () => toggleWildcardModal(false),
    "inspect-png-modal": () => closeInspectPngModal(),
    "xyz-modal": () => toggleXyzModal(false),
    "snapshot-modal": () => toggleSnapshotModal(false),
    "snippet-modal": () => toggleSnippetModal(false),
    "lightbox-modal": () => closeLightbox(),
  };
  Object.entries(closers).forEach(([id, closeFn]) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.addEventListener("pointerdown", e => {
      if (e.target === modal || (id === "lightbox-modal" && e.target.id === "lightbox-stage")) {
        closeFn();
      }
    });
  });
}

async function startArtistBackfillQueue(modelId = "nai-diffusion-4-5-full") {
  const missing = state.artists.filter(a => !a.preview_url);
  if (!missing.length) {
    showToast("所有画师都已有预览图，无需补齐");
    return;
  }
  const targetModel = modelId || "nai-diffusion-4-5-full";
  try {
    const res = await fetch("/api/queue/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist_backfill: true, model: targetModel }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "启动画师补齐队列失败");
    startQueuePolling();
    showToast(`已开启静默补齐队列：共 ${missing.length} 位缺失画师 (0 Anlas ${targetModel.includes("5") ? "V5" : "V4.5"})`);
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
