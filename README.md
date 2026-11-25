# Vesperloom — Obsidian Atelier

**Vesperloom** 是一款面向 **NovelAI V5 / V4.5 / V4 / V3** 的本地化原生桌面创作工作台与 AI Agent 协同中枢（Electron + FastAPI + SQLite），支持原生无边框桌面客户端、星环光圈自适应开屏、内置 Studio Agent 创作导演，以及面向外部智能体的 **Streamable HTTP MCP** 与标准 **A2A (Agent-to-Agent)** 协议。

---

## 核心特性

### 1. Obsidian Atelier 桌面创作工作台
- **原生 Electron 桌面端**：单窗口双层 `WebContentsView` 架构，支持全屏无边框自定义标题栏、系统托盘驻留（保活 MCP / A2A）、多显示器窗口记忆与「星环光圈」GPU 硬件加速开屏（支持自定义插画与收藏作品随机轮播，自动提取主色适配亮/暗色调）。
- **完整 NovelAI 引擎支持**：全面适配 `NAI Diffusion V5 / V4.5 / V4 / V3`，内置 **Opus 0 点数免费保护锁**、经典/四区块双提示词模式、多角色坐标定位、Vibe / Precise Reference、局部重绘 / 扩图、Director 表情/线稿增强、画师串混搭器、OC 角色卡、通配符与本地高速图库。
- **首次启动快速配置向导**：首次打开自动弹出 NAI Token 与 LLM API 配置向导，内置 DeepSeek / 阿里云百炼 / 硅基流动 / OpenRouter / Kimi / 智谱 GLM / OpenAI / Ollama 8 家常用供应商一键预设。

### 2. 内置 Studio Agent 创作助手
- **双模式协同**：支持 **Ask（咨询）** 与 **Agent（执行）** 模式，支持 `@` 引用图库作品 / OC 角色 / 画师串 / 技能，支持上传参考图进行多模态视觉分析。
- **可扩展 Skills 与长期审美记忆**：内置 9 套专业创作 Skill（含二次元角色考据、画师风格融合、多角色构图、局部修手/修脸等），支持跨会话个人审美记忆本（`data/agent_memory.md`）与长对话自动压缩。
- **快捷模型切换**：Agent 窗口顶部模型胶囊支持一键拉取/切换模型、实时查看供应商状态。

### 3. 外部 Agent 协议中枢（MCP + A2A）
- **Streamable HTTP MCP**（`http://127.0.0.1:8780/mcp`）与标准 **stdio MCP**（`mcp_server.py`），供 Claude Desktop、Cursor、Codex、OpenClaw 等外部 Agent 直接调用生图、画师/图库检索、角色考据、PNG 元数据读取与 Director 工具。
- **标准 A2A Server**（`/.well-known/agent-card.json` + `/a2a` JSON-RPC 2.0 / SSE），支持多轮视觉连续性创作（`img2img` / Director `emotion`）、可选视觉质检自动重试，以及将外部任务一键接管回本地画布继续精修。

---

## 快速开始

### 方式一：下载 Windows 桌面便携版（推荐）
1. 前往 [Releases](https://github.com/xuyouquan856-beep/Vesperloom/releases) 下载 `Vesperloom-v3.0.0-win-x64.zip` 并解压到任意目录（建议非 C 盘，如 `D:\Vesperloom`）。
2. 确保本机已安装 **Python 3.10+**，在解压目录下安装后端依赖：
   ```bash
   pip install -r requirements.txt
   ```
3. 双击运行 **`Vesperloom.exe`**，首次启动会自动弹出 API 配置向导，填入 NovelAI Persistent API Token (`pst-...`) 与大模型 API Key 即可开始创作。

### 方式二：从源码运行
```bash
git clone https://github.com/xuyouquan856-beep/Vesperloom.git
cd Vesperloom
pip install -r requirements.txt
```

- **启动本地 Web 服务**：
  ```bash
  python -m uvicorn backend.app:app --host 127.0.0.1 --port 8780
  ```
  然后在浏览器访问 `http://127.0.0.1:8780`。

- **启动 / 打包 Electron 桌面端**：
  ```bash
  cd desktop-electron
  npm install
  npm start      # 开发模式运行
  npm run pack   # 打包 Windows 便携版至 ../dist-desktop/win-unpacked/Vesperloom.exe
  ```

---

## 外部 Agent 接入示例

### Streamable HTTP MCP
```json
{
  "mcpServers": {
    "vesperloom": {
      "url": "http://127.0.0.1:8780/mcp"
    }
  }
}
```

### 标准 A2A Discovery
- Agent Card: `GET http://127.0.0.1:8780/.well-known/agent-card.json`
- JSON-RPC / SSE: `POST http://127.0.0.1:8780/a2a`

---

## 目录结构

```text
Vesperloom/
├── backend/              # FastAPI 后端、NAI 客户端、Studio Agent、MCP & A2A 服务
├── frontend/             # Obsidian Atelier 前端工作台、Agent 悬浮窗与星环开屏页
├── desktop-electron/     # Electron 35 原生桌面壳与打包配置
├── data/                 # 本地配置、SQLite 图库、Skills、记忆本与通配符（密钥不入库）
├── tests/                # pytest 回归测试套件
├── mcp_server.py         # stdio 模式 MCP 入口
└── requirements.txt      # Python 依赖
```

## 隐私与安全
- 所有 API Token、图库数据库、作品图片与缓存均严格保存在项目本地目录（`data/`、`outputs/`、`tmp/`），**不向任何第三方收集数据**。
- 后端 CORS 严格限制为本机环回地址，MCP 文件读取严格限制在 `outputs/` 与 `artists/` 目录内。

## License
[MIT License](LICENSE)
