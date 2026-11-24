# NAI Studio 工程改进与技术债清单 (Phase 1C Audit)

> 本清单用于记录 Phase 1A–1C UI 改造期间识别出的**工程架构、构建与可维护性债务**。按 Phase 1C 范围约束，本阶段仅做盘点与归档，不在当前阶段直接修改构建链或依赖结构。

---

## 1. 前端静态资源缓存失效机制（已解决）

- **解决状态**：已通过 [backend/app.py](file:///D:/NAI-Studio/backend/app.py) 实现 `NoCacheStaticFiles`（对 `/static/*.css`、`/static/*.js` 返回 `Cache-Control: no-cache`）并在 `GET /` 响应时自动注入文件 `mtime` 短哈希（`?v=<hex>`），彻底消除手动维护 `?v=...` 版本号与旧缓存问题。

---

## 2. Tailwind Play CDN 运行时依赖与离线可用性（已解决）

- **解决状态**：已新增 [tailwind.config.js](file:///D:/NAI-Studio/tailwind.config.js) 与 [frontend/tailwind.input.css](file:///D:/NAI-Studio/frontend/tailwind.input.css)，预编译产出本地静态精简包 [frontend/tailwind.generated.css](file:///D:/NAI-Studio/frontend/tailwind.generated.css)（~27 KB），并在 [frontend/index.html](file:///D:/NAI-Studio/frontend/index.html) 中彻底移除 `https://cdn.tailwindcss.com`，实现 100% 离线秒开且无首屏布局抖动。

---

## 3. Python / 开发环境依赖清单与启动脚本健壮性（已解决）

- **解决状态**：已补充 [requirements.txt](file:///D:/NAI-Studio/requirements.txt) 与 [requirements-dev.txt](file:///D:/NAI-Studio/requirements-dev.txt)；[启动_NAI_Studio.bat](file:///D:/NAI-Studio/启动_NAI_Studio.bat) 已升级为基于 `%~dp0` 自动探测 `.venv` / `PATH` Python，并在端口 `8780` 已被监听时直接唤起浏览器而不重复启动冲突。

---

## 4. `frontend/app.js` 单文件体量与内联事件绑定

- **现状**：[frontend/app.js](file:///D:/NAI-Studio/frontend/app.js) 单文件约 `3780+` 行，混合状态管理、API 请求、Canvas Inpaint 交互与 HTML 模板拼接；大量交互通过 HTML `onclick="..."` 属性触发全局函数。
- **影响**：
  - 动态列表项中的文本转义依赖人工确保每处调用 `escapeHtml(...)`，稍有遗漏存在参数注入/断串风险。
  - 全局命名空间函数众多，局部重构和单元测试粒度受限。
- **建议方案**：在 Phase 2+ 稳步按功能域拆分为轻量原生 ES Module（无需迁移 React/Vue），并将高频动态列表逐步改为事件委托。

---

## 5. Phase 2 布局与响应性已解决项（留档）

以下在 Phase 1 登记的布局问题已于 Phase 2「Obsidian Atelier」改版中解决：

1. **窄桌面视口（`1280×800`）底部动作坞紧凑度**：动作坞改为画布底部居中悬浮药丸，并分离左/右折叠面板释放横向空间。
2. **图库与画师卡片比例（原 `h-60` / `h-52`）**：改为统一 `aspect-[4/5]` 画框搭配暗房底衬，避免竖图裁切与留白失衡。
3. **三栏宽度自适应与侧栏折叠/拖拽调宽**：已实现左参数检视器（`320–520px`）与右历史胶片栏（`210–360px`）拖拽分割条、按钮及 `[` / `]` 快捷键折叠，并持久化至 `localStorage`。
