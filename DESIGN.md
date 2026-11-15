# NAI Studio — Design System & Desktop Workbench Specification (`DESIGN.md`)

> Scope: `D:\NAI-Studio\frontend` (Workbench / Artists / Gallery / Settings)  
> Positioning: Precision Desktop AI Illustration Workstation  
> Approved Direction: **Studio Slate 专业工作台结构 + 克制的 Hydro-Mist 水滴玻璃细节** (Single unified dark-first system + complementary Daylight companion + configurable Compact Mode)

---

## 1. Visual Philosophy & Unification

NAI Studio combines the structural clarity and eye comfort of **Studio Slate** (InvokeAI / Figma / DaVinci Resolve workstation geometry) with the subtle tactile optics of **Hydro-Mist** (restrained 5-step Liquid Glass reserved strictly for floating chrome).

### Core Principles
1. **Canvas First, Chrome Second**: Generated artwork in the center stage is the sole high-contrast focal point. Docked left/right workstation rails remain calm, low-chroma slate (`rgba(11, 23, 30, 0.88)`) so prompt colors and artwork lighting never clash with noisy UI gradients.
2. **Scoped Liquid Glass (Floating Overlays Only)**:
   - **Floating Chrome** (top header bar, bottom canvas dock, dropdown popovers, drawers, modals): Uses crisp specular top-rim hairlines (`inset 0 1px 0 rgba(255,255,255,0.22)`), controlled saturation (`saturate(165%) blur(18px)`), and clean surface refraction.
   - **Docked Rails & Inner Parameter Groups**: Calm translucent matte slate + `1px` hairline horizontal dividers (`border-top`) and recessed wells (`--surface-well`) for editable fields only. Eliminates 3-level nested glass boxes (`.liquid-panel` -> `.glass-field` -> `.glass-field`).
3. **One Focal CTA Per Primary Flow**: Primary cyan solid-tint CTA (`.btn-primary`) is reserved for the main generation action (`Generate`) and the primary confirm action inside an active dialog. Decorative icons, brand emblem, and secondary helper actions use calm neutral or subtle tonal controls.
4. **Uniform 1.5px Monochrome SVG Iconography**: Progressively replace UI emojis with an inline SVG `<symbol>` sprite (`16px` in dock/nav, `14px` in dense controls, `1.5px` stroke width).

---

## 2. Typography & Density Modes (Revised Baseline)

Never sacrifice long-session legibility for artificial compactness.

### Font Stacks
- **UI Sans**: `"Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`
- **Monospace (Prompts / Seeds / Telemetry)**: `"JetBrains Mono", "Cascadia Mono", "Consolas", ui-monospace, monospace`
- **Tabular Figures Mandatory**: `font-variant-numeric: tabular-nums` enforced on `.num`, sliders, `Steps`, `CFG`, `Rescale`, `Seed`, dimensions (`832×1216`), elapsed seconds, and gallery pagination counters.

### Type Scale (Standard Comfortable Mode — Default)
| Role | Token | Size / Weight | Line Height | Usage |
|---|---|---|---|---|
| **Major Title** | `--fs-title` | `16px–18px` / `600` | `1.35` | View headings, Modal/Drawer headers, active section callouts |
| **Section Heading** | `--fs-section` | `14px` / `600` | `1.40` | Parameter accordion headers, sidebar titles, card headers |
| **Body & Controls** | `--fs-body` | **`14px`** / `400–500` | `1.50` | Prompt / UC editors, primary buttons, tabs, select triggers, card prose |
| **Secondary / Meta** | `--fs-meta` | **`12px–13px`** / `400–500` | `1.40` | Parameter labels (`Steps`, `CFG`), tag pills, timestamps, status hints, badges |

> **Hard Floor**: Text below `12px` is disallowed in Standard Mode.

### Configurable Compact Mode (`html.compact-ui`, Toggled via Appearance Menu & Persisted)
For power users on `1280px–1366px` displays wanting higher parameter density:
- `--fs-title`: `15px–16px`
- `--fs-section`: `13px`
- `--fs-body`: `13px`
- `--fs-meta`: `11.5px–12px` (absolute minimum `11.5px` in compact mode only)
- Control vertical padding shrinks by `-2px` (`8px -> 6px`) and section gap tightens (`12px -> 8px`).

---

## 3. Color Palette & Surface Tiers

### Dark Mode (Default Workstation)
| Token | Value | Role |
|---|---|---|
| `--bg-base` | `#081319` | Calm dark ocean-slate canvas backdrop (non-pure-black) |
| `--bg-canvas-well` | `#060f14` | Recessed central image stage well |
| `--surface-panel` | `rgba(11, 23, 30, 0.88)` | Left & right docked workstation rails |
| `--surface-group-hover` | `rgba(19, 38, 48, 0.72)` | Subtle accordion header & row hover tint |
| `--surface-well` | `rgba(5, 12, 17, 0.58)` | Editable inputs, Prompt/UC textareas, steppers |
| `--surface-chrome` | `rgba(13, 28, 36, 0.76)` | Floating Top Nav & Bottom Canvas Dock (Hydro-Mist glass) |
| `--surface-popover` | `rgba(10, 22, 29, 0.96)` | High-clarity dropdowns, drawers, modals (zero bleed-through) |
| `--border-hairline` | `rgba(186, 224, 242, 0.11)` | Subtle divider lines between accordion groups & rails |
| `--border-control` | `rgba(186, 224, 242, 0.20)` | Rest state borders on interactive inputs & buttons |
| `--border-hover` | `rgba(125, 211, 252, 0.42)` | Hover border |
| `--border-focus` | `#38bdf8` | Keyboard `:focus-visible` ring & active input outline |
| `--text-primary` | `#eef6fb` | Primary labels, prompts, values (`> 12:1` contrast) |
| `--text-secondary` | `#a4bfd0` | Captions, metadata, secondary actions (`> 6.2:1`) |
| `--text-muted` | `#698699` | Placeholders, disabled text (`>= 4.5:1` where legible text) |
| `--accent` | `#38bdf8` | Active Cyan-Blue focus & selection indicator (`S < 80%`) |
| `--accent-solid` | `#0284c7` | Primary solid CTA fill & switch ON track |
| `--accent-tint` | `rgba(56, 189, 248, 0.14)` | Tonal active selection fill (active aspect ratio, tab, preset) |
| `--status-success` | `#34d399` | Opus 0-Anlas free lock, lint valid |
| `--status-warning` | `#fbbf24` | Model capability constraints (e.g. V5 Vibe unsupported) |
| `--status-danger` | `#f87171` | Errors, destructive actions |

### Light Mode (`html.light` Daylight Companion)
- Background `#d3e3ec`, stage well `#c5d8e4`, docked panels `rgba(244, 249, 252, 0.88)`, floating chrome `rgba(248, 252, 254, 0.82)`, wells `rgba(218, 232, 241, 0.65)`, primary text `#0c1f2b`, secondary `#3a5768`, accent `#0284c7` / `#0369a1`.

---

## 4. Layout Geometry, Viewport Budget & Panel Resizing

**Core Rule: Center Canvas Must Always Receive Highest Spatial Priority.**  
Replace fixed `4:5:3` Tailwind percentage columns (`col-span-4/5/3`) with explicit pixel-bounded rails + flexible `1fr` stage (`grid-template-columns: var(--left-w) minmax(0, 1fr) var(--right-w)`).

### Breakpoint & Allocation Matrix (Exact Pixel Budget: `2×pad + 2×gap + left + center + right = viewport`)
| Viewport Width | Outer Pad (`L+R`) & 2 Gaps | Left Rail (`--left-w`) | Center Canvas Stage (`1fr`, Collapsed / Expanded Right) | Right History Rail (`--right-w`) | Ergonomic Strategy |
|---|---|---|---|---|---|
| **1280px** (`1280×720/800`) | `8px×2` + `8px×2` = `32px` | `336px` (`26.3%`) | **`868px` (`67.8%`)** / `664px` (`51.9%`) | **Auto-collapsed `44px`** (expands to `248px`) | Left + collapsed rail leave `868px` net canvas width; even with History open (`248px`), canvas retains >51% |
| **1366px** (`1366×768`) | `10px×2` + `10px×2` = `40px` | `348px` (`25.5%`) | **`934px` (`68.4%`)** / `738px` (`54.0%`) | **Auto-collapsed `44px`** (expands to `240px`) | Comfortable `14px` control text without line-wrap pressure while preserving `934px` / `738px` stage |
| **1440px** (`1440×900`) | `12px×2` + `12px×2` = `48px` | `376px` (`26.1%`, drag `330–440px`) | **`772px` (`53.6%`)** / `972px` (`67.5%`) | `244px` (`16.9%`, drag `210–320px`, strip `44px`) | Default 3-column studio open cleanly simultaneously |
| **1920px** (`1920×1080`) | `16px×2` + `14px×2` = `60px` | `420px` (`21.9%`, cap `480px`) | **`1152px` (`60.0%`)** / `1396px` (`72.7%`) | `288px` (`15.0%`, 3-col compact grid option) | Sidebars bounded via `clamp()` so controls stay scannable and centered stage dominates |
| **`< 1024px`** | `8px×2` = `16px` | Slide-over Drawer | `100%` Stage (`viewport - 16px`) | Slide-over Drawer | Single-column canvas + header drawer toggles |

### Resizable & Collapsible Rail Controls
- Add hairline **4px drag handles** between Left↔Center (`--left-w`) and Center↔Right (`--right-w`), persisting widths in `localStorage`.
- Add a sleek **Right Rail Collapse Toggle** (`[|>]` in stage header + auto-collapse threshold when `window.innerWidth <= 1366`, overridable manually anytime).

---

## 5. Spacing, Radii, Elevation & Interactive States

### Spacing (`4px` Grid)
- `--sp-1`: `4px` | `--sp-2`: `8px` | `--sp-3`: `12px` | `--sp-4`: `16px`

### Border Radius Tiers (Strictly 3 Tiers + Switch Pill)
- `--radius-panel`: `14px` (Workbench rails, Modals, Drawers)
- `--radius-group`: `10px` (Gallery/Artist cards, Popovers, Sub-boxes)
- `--radius-control`: `7px` (Buttons, Inputs, Steppers, Select triggers)
- `--radius-tag`: `5px` (Tag pills, compact status badges; `9999px` only for `.glass-switch` and status indicator dots)

### Universal Interaction States
1. **Hover**: Subtle border accentuation (`--border-hover`) + faint fill shift (`150ms ease-out`). **Strictly no `transform: scale()` on `<img>` artwork thumbnails.**
2. **Focus-Visible**: Every interactive element exhibits `outline: 2px solid var(--border-focus); outline-offset: 1px`.
3. **Active**: `transform: scale(0.985)` (`80ms`).
4. **Disabled**: `opacity: 0.42; pointer-events: none` + clear capability explanation badge when locked by selected model.
5. **Reduced Motion**: `@media (prefers-reduced-motion: reduce)` immediately halts ambient cloud/water SVG drift and pulse animations.

---

## 6. Modal / Drawer / Inline Decision Matrix (All 9 Existing Overlays)

Do **not** mechanically force every dialog into a side drawer. Categorize by spatial need, canvas reference dependency, and task interruption semantics:

| Existing Element | Task Nature & Spatial Need | Target Form | Rationale |
|---|---|---|---|
| `#lightbox-modal` | Immersive 1:1 full-screen artwork inspection + checkerboard alpha check + arrow browsing | **Keep Modal (Full Viewport)** | Requires 95%+ viewport area; purposefully isolates artwork |
| `#diff-modal` | Side-by-side Prompt Diff + horizontal wipe comparison slider between 2 images | **Keep Modal (Wide Focused)** | Two-image swipe slider needs wide horizontal stage |
| `#inspect-png-modal` | Review parsed Stealth/PNG metadata + choose 5 selective restore checkboxes before overwriting | **Keep Modal (Compact Decision Gate)** | Deliberate destructive overwrite checkpoint requiring user confirmation |
| `#custom-artist-modal` | Rare single-form entry + 1-shot NAI preview test generation | **Keep Modal (Compact Form)** | Infrequent setup form unrelated to active canvas composition |
| `#wildcard-modal` | Browse/edit `__name__.txt`, test roll, and **insert into Prompt** | **Docked Slide-Over Drawer (Right/Center-Overlay `440px`, non-scrim)** | Users need to read their main Prompt & stage while testing wildcards |
| `#snapshot-modal` | Browse prompt timeline, save snapshot, quick-restore, JSON export/import | **Docked Popover / Slide-Over Drawer** | Lightweight timeline recall shouldn't black out the stage |
| `#oc-modal` | Pick/save OC avatar + **1-click inject into Multi-Char slots or Prompt** | **Slide-Over Drawer / Inline OC Picker** | Injection works best when seeing multi-char canvas dots & slots live |
| `#xyz-modal` | Configure X/Y axes (CFG/Steps/Sampler/Artists) around **current canvas recipe & seed** | **Compact Non-Blocking Drawer** | Helpful to inspect current Seed/Scale/Prompt parameters while choosing X/Y values |
| `#snippet-modal` | Simple 2-field Name + Tags quick creation | **Inline Anchored Popover** (near `Snippets` bar) | 2 tiny fields do not justify a dimmed full-screen modal |
| `window.prompt / confirm` (4 places) | Notes edit, clean un-favorited confirm, JSON copy/paste fallback | **Inline Input / Confirm Popover** | Eliminate jarring native browser OS dialog interruptions |

---

## 7. Engineering Maturity, Control Classification & Verification Gates

1. **`.glass-field` Role Classification (No Blind Global Replacement)**:
   In Phase 1+, never mass-replace `.glass-field` globally; reclassify every instance strictly by semantic role:
   - **Editable Wells** (`.ui-well`): `textarea`, `input`, numeric steppers, prompt mirror wrapper — retain subtle recessed inset well background & focus outline.
   - **Section Sub-Groups** (`.ui-section`): Parameter groups (`Vibe`, `Sampler`, `Settings cards`) — replace boxed translucent glass with flat surface + `1px` `--border-hairline` divider (`border-top`) to stop triple-box nesting.
   - **Secondary Actions** (`.ui-btn`): Toolbar & footer controls — uniform flat/hairline hover button without recessed shadow.
   - **Status Badges** (`.ui-badge`): Read-only capability/cost pills — borderless faint tint or crisp hairline, non-clickable affordance.
2. **Tailwind Play CDN Limitation**: Currently loads `https://cdn.tailwindcss.com` synchronously in `<head>`, compiling utility classes on the main thread at startup and silently ignoring typos (verified defect: invalid class `w-76` on `#bg-menu` at `index.html:104`). Move critical layout/component rules progressively into semantic CSS classes backed by CSS custom properties inside `styles.css`.
3. **Inline Handler & Runtime Class Coupling**: `app.js` uses `el.className = "..."` across multiple runtime branches and mixes HTML strings into JS templates. Prefer semantic state classes (`.is-active`, `.btn-primary`) toggled via `classList` rather than overwriting full Tailwind class strings.
4. **Verification Gate Criteria**:
   - Browser E2E acceptance requires **0 unexpected HTTP errors** (intentional negative/validation paths excluded if explicitly tested), **no uncaught JS exceptions** (`pageerror` / console errors = 0), and visual screenshot inspection at `1280px`, `1366px`, `1440px`, and `1920px`.
