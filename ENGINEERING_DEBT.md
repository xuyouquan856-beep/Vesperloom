# NAI Studio 工程改进与技术债清单 (Phase 1C Audit)

> 本清单用于记录 Phase 1A–1C UI 改造期间识别出的**工程架构、构建与可维护性债务**。按 Phase 1C 范围约束，本阶段仅做盘点与归档，不在当前阶段直接修改构建链或依赖结构。

---

## 1. 前端静态资源缓存失效机制（硬编码版本参数）

- **现状**：[frontend/index.html](file:///D:/NAI-Studio/frontend/index.html) 中手动使用硬编码查询参数（当前为 `?v=p2-5`）加载 `/static/styles.css` 与 `/static/app.js`，FastAPI 仅通过默认 `StaticFiles` 挂载 `/static`，浏览器易命中强缓存或 `304 Not Modified`。
- **影响**：每次更新 `styles.css` 或 `app.js` 均需人工同步修改 `index.html` 的 `?v=...` 参数；遗漏时本地 Edge / Chrome 会静默加载旧前端资源。
- **建议方案**：后续由后端在渲染入口注入基于文件 mtime / SHA-256 短哈希的版本参数，或对 `/static/*.css`、`/static/*.js` 设置 `Cache-Control: no-cache`（协商缓存 / ETag 验证）。

---

## 2. Tailwind Play CDN 运行时依赖与离线可用性

- **现状**：[frontend/index.html](file:///D:/NAI-Studio/frontend/index.html) 第 8 行直接通过 `<script src="https://cdn.tailwindcss.com"></script>` 在浏览器端运行时扫描 DOM 并动态注入 `<style>` 规则。
- **影响**：
  - 强依赖外网 CDN 可达性；无网或代理受限环境下页面排版会完全退化。
  - 首屏存在运行时 CSS 编译开销，且动态模板字符串（[frontend/app.js](file:///D:/NAI-Studio/frontend/app.js)）中的类名需依赖 Play CDN `MutationObserver` 实时生成。
  - 与 `styles.css` 的原生语义类混用，部分间距、字号等布局工具类仍依赖 CDN 运行时扫描，离线环境下会失去网格/响应式布局能力。
- **建议方案**：在确认合适阶段时改为预编译产出的本地静态 `tailwind.generated.css`（无需引入重型前端框架），减少外网 CDN 强依赖。

---

## 3. 缺失 Python / 开发环境依赖清单

- **现状**：仓库根目录（`D:\NAI-Studio`）缺少 `requirements.txt`、`pyproject.toml` 或锁文件，[启动_NAI_Studio.bat](file:///D:/NAI-Studio/启动_NAI_Studio.bat) 直接调用本机绝对路径 `"C:\Users\21815\AppData\Local\Python\bin\python.exe"`。
- **观测到的实际第三方依赖**：
  - 运行时：`fastapi`、`uvicorn`、`httpx`、`pillow`（`PIL`）、`starlette`（FastAPI 传递依赖）
  - 测试：`pytest`（`tests/test_all.py`）
- **影响**：更换机器、重建 Python 环境或交由他人部署时，缺乏可复现的环境安装清单与版本约束。
- **建议方案**：补充 `requirements.txt`（区分运行依赖与测试依赖或提供 `requirements-dev.txt`），并在启动脚本中支持通过 `PATH` / 虚拟环境优先解析 Python 路径。

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
