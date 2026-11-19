import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DATA_DIR

SKILLS_DIR = DATA_DIR / "skills"
SKILLS_DIR.mkdir(parents=True, exist_ok=True)

BUILTIN_SKILLS: List[Dict[str, str]] = [
    {
        "name": "nai-v5-prompt-craft",
        "title": "NAI V4.5 / V5 提示词工艺规范",
        "description": "权威 NovelAI V4.5/V5/V3 语法、数值权重、四区块拆分与负面词构建准则，修改或诊断提示词前必读。",
        "triggers": "提示词, 优化, 语法, 权重, 报错, 规范, prompt, lint",
        "content": """# NAI V4.5 / V5 Prompt Craft Doctrine

## 1. 四区块严格边界（避免标签串味）
- **artist（画师串）**：只放 `artist:...` 与画风媒介词（如 `watercolor (medium)`, `impasto`）。不要混入人物特征或质量词。
- **character（人物相关）**：主体数量（`1girl, solo`）→ 发色发型 → 瞳色与眼神细节 → 表情情绪 → 动作姿态（V4.5/V5 可用简短自然英语短语描述交互动作）→ 服饰配饰。
- **lighting（光影与场景）**：景别与机位（`cowboy shot`, `from below`, `dutch angle`）→ 环境地点 → 时段天气 → 光影与空气粒子（`cinematic backlighting`, `rim lighting`, `tyndall effect`, `bokeh`）→ 美学复杂度锚点（`very aesthetic`, `high complexity`, `masterpiece`, `absurdres`）。
- **negative（负面提示词）**：匹配当前模型的标准缺陷拦截 + 针对当前构图的定向排错（如单人特写排 `multiple views`, 雨夜排 `daylight, sunny`）。

## 2. 模型权重语法红线
- **V4 / V4.5 / V5**：支持 `w::tag::` 数值权重（推荐范围 `0.6`–`1.4`，画师权重常用 `0.65`–`1.0`）以及 `{}`/`[]`。
- **V3**：严禁使用 `::` 数值权重，只能用 `{tag}` (+5%) 与 `[tag]` (-5%)。
- **全局禁用**：严禁输出 SD WebUI 括号权重 `(tag:1.2)`、`BREAK`、`AND` 或夹杂中文标签。

## 3. 实时诊断清单
1. 检查是否存在 SD 语法、重复词条、中文标点、互相冲突的光照/时间词（例如 `sunset` 与 `midnight` 同框）。
2. 检查主体缺失（忘了 `1girl` / `solo` 或景别词导致随机切头）。
3. 改完后务必调用 `validate_and_lint_prompt` 确认零错误。
""",
    },
    {
        "name": "colloquial-to-danbooru",
        "title": "大白话 → Danbooru / V5 精准转译",
        "description": "将用户的口语化中文描述、氛围词、情绪词直接转化为高命中率 Danbooru 标签与 V5 自然语言短语。",
        "triggers": "翻译, 大白话, 加上, 改成, 换成, 氛围, 感觉, 动作, 表情",
        "content": """# Colloquial Chinese to NovelAI Tag Mapping

## 核心原则
1. 用户说大白话时，**直接转译为精准标签并增量写入对应区块（`mode="merge"`）**，不要覆盖用户没要求改的区块。
2. 优先调用 `search_danbooru_tags` 验证词库；对 V4.5/V5 的复杂互动动作，采用「核心 Danbooru 标签 + 简短自然英语短语」双保险。

## 高频口语 → 高命中标签速查
- **清冷破碎感 / 易碎美**：`melancholic expression, glistening eyes, pale skin, parted lips, soft cold lighting, subtle tears, ethereal atmosphere`
- **慵懒 / 刚睡醒**：`half-closed eyes, messy hair, sleepy expression, oversized shirt, morning sunlight, warm indoor haze`
- **电影感逆光 / 氛围拉满**：`cinematic lighting, 1.15::backlighting::, rim lighting, tyndall effect, lens flare, floating dust particles, depth of field, bokeh`
- **微风吹动发丝与裙摆**：`wind, 1.15::floating hair::, billowing skirt, dynamic movement`
- **绝美精致眼神**：`detailed eyes, sparkling eyes, luminous pupils, light reflections in eyes`
- **回眸浅笑**：`looking back, looking at viewer, light smile, over-the-shoulder gaze`
- **赛博雨夜街头**：`cyberpunk cityscape, night, rain, wet pavement reflections, neon lights, cyan and magenta glow, moody mist`
- **纯白干净构图 / 角色立绘**：`clean composition, simple background, soft studio lighting`（V5 透明底可配合 `alpha_transparency: true`）
""",
    },
    {
        "name": "creative-interview",
        "title": "没灵感导演访谈（互动构思）",
        "description": "当用户说没想法、随便画点、懒得想或想要创意建议时，通过简短有趣的导演问答或三选一提案快速共创画面。",
        "triggers": "没灵感, 随便, 懒得想, 帮我想, 构思, 推荐, 想法, 聊聊",
        "content": """# Creative Director Interview Workflow

当用户表达「没想法 / 随便画点 / 帮我构思」时，**不要直接闷头瞎填一堆平庸标签**，而是扮演审美敏锐的插画导演：

## 对话策略
1. 先用极简短的语言提出 **3 个风格反差鲜明的灵感方向**（每个方向一句话说清「人物 + 场景 + 情绪光影」），或者只问 **2 个最关键的轻量问题**（如：偏好清透日系还是戏剧厚涂？想要日常温馨还是幻想张力？）。
2. 在回复末尾给出简短可直接点选的选项建议（引导用户一句话拍板，例如“选 2，头发改银色”）。
3. 一旦用户选定方向或给出任何模糊偏好，立即结合画师库检索结果，调用 `patch_prompt_blocks` 一次性把四区块落地填好，并简短询问是否直接出图。
""",
    },
    {
        "name": "artist-style-blending",
        "title": "画师库检索与风格混搭调音",
        "description": "从本地画师库挑选最契合氛围的画师并科学配比权重，避免画风打架或污染角色结构。",
        "triggers": "画师, 画风, 混搭, 风格, 水彩, 厚涂, 赛博, 轻小说, artist",
        "content": """# Artist Style Blending Guide

## 标准步骤
1. **必须先调用 `search_artist_catalog`** 查看用户本地画师库（尊重 `favorite=true` 的常用画师）。
2. **主辅黄金配比**：
   - 单画师强风格：`0.9::artist:primary::`（略微稀释防止手部/面部过拟合）。
   - 双画师混搭（推荐）：主画师 `0.85–0.95` + 氛围辅画师 `0.55–0.75`。
   - 三画师调色盘：主 `0.85` + 辅 `0.6` + 质感点缀 `0.45`。
3. 写入画师串时只更新 `artist` 区块（`patch_prompt_blocks(artist=..., mode="replace")`），绝不误删用户的人物与光影区块。
""",
    },
    {
        "name": "director-and-inpaint-workflow",
        "title": "工作台操作：Director / 图生图 / 重绘 / 参数",
        "description": "指导 Agent 通过工具精准操控工作台：切换模型与分辨率、调节 CFG/步数、执行 Director 后处理（线稿/草图/上色/24种表情/去杂物）、图生图、局部重绘与扩图。",
        "triggers": "director, 线稿, 草图, 上色, 表情, 去杂物, 图生图, 重绘, 局部重绘, 扩图, 参数, 步数, 生成, 出图, 分辨率",
        "content": """# Workbench Operations & Director Playbook

## 1. 参数与 Opus 0 点数守则
- 开启 Opus 保护锁时，单张免费上限为 `steps <= 28`、像素面积 `<= 1048576`（如 `832x1216`, `1216x832`, `1024x1024`, `704x1408`, `1408x704`）。
- 调整分辨率、采样器、CFG、步数、Seed 或透明底时，直接调用 `set_workbench_params`。

## 2. Director 后处理（基于当前画布图，0 点数）
- 提取线稿：`run_director_tool(req_type="lineart")`
- 转铅笔草图：`run_director_tool(req_type="sketch")`
- 线稿智能上色：`run_director_tool(req_type="colorize", defry=0, prompt="...")`
- 表情微调（24种）：`run_director_tool(req_type="emotion", emotion="happy|shy|smug|sad|angry|surprised|...", defry=0..5)`
- 去杂物背景清理：`run_director_tool(req_type="declutter")`
- **前提检查**：先看 `get_workbench_state()` 确认画布已有图片；若画布为空，先提示用户选图或先文生图。

## 3. 图生图 / 局部重绘 / 扩图
- 微调光影/精修：`set_workbench_mode(action="img2img", i2i_strength=0.45)`
- 大幅重构画面：`set_workbench_mode(action="img2img", i2i_strength=0.70)`
- 局部重绘修手/换表情：`set_workbench_mode(action="infill")` 并提醒用户在画布涂抹蒙版后点击生成。
- 扩图：`set_workbench_mode(action="outpaint", outpaint_direction="right|left|top|bottom|center")`。

## 4. 直接出图
- 仅在用户明确要求「直接生成 / 帮我画出来 / 出图」时调用 `trigger_generate_image`。
""",
    },
]


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_\-\u4e00-\u9fff]+", "-", str(name or "").strip().lower()).strip("-")
    if not slug:
        raise ValueError("Skill 名称不能为空")
    return slug[:64]


def _format_skill_md(name: str, title: str, description: str, triggers: str, content: str, builtin: bool = False) -> str:
    return (
        "---\n"
        f"name: {name}\n"
        f"title: {title}\n"
        f"description: {description}\n"
        f"triggers: {triggers}\n"
        f"builtin: {'true' if builtin else 'false'}\n"
        "---\n\n"
        f"{content.strip()}\n"
    )


def _parse_skill_md(raw: str, fallback_name: str) -> Dict[str, Any]:
    text = str(raw or "")
    meta: Dict[str, str] = {}
    body = text.strip()
    m = re.match(r"^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$", text)
    if m:
        fm, rest = m.group(1), m.group(2)
        for line in fm.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip()
        body = rest.strip()
    name = meta.get("name") or fallback_name
    return {
        "name": name,
        "title": meta.get("title") or name,
        "description": meta.get("description") or "自定义工作台 Skill",
        "triggers": meta.get("triggers") or "",
        "builtin": meta.get("builtin", "false").lower() == "true",
        "content": body,
    }


def ensure_builtin_skills() -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    for sk in BUILTIN_SKILLS:
        folder = SKILLS_DIR / sk["name"]
        fpath = folder / "SKILL.md"
        if not fpath.exists():
            folder.mkdir(parents=True, exist_ok=True)
            fpath.write_text(
                _format_skill_md(
                    name=sk["name"],
                    title=sk["title"],
                    description=sk["description"],
                    triggers=sk["triggers"],
                    content=sk["content"],
                    builtin=True,
                ),
                encoding="utf-8",
            )


def list_skills(include_content: bool = False) -> List[Dict[str, Any]]:
    ensure_builtin_skills()
    items: List[Dict[str, Any]] = []
    for sub in sorted(SKILLS_DIR.iterdir()):
        if not sub.is_dir():
            continue
        fpath = sub / "SKILL.md"
        if not fpath.is_file():
            continue
        parsed = _parse_skill_md(fpath.read_text(encoding="utf-8", errors="replace"), sub.name)
        parsed["path"] = str(fpath)
        if not include_content:
            parsed.pop("content", None)
        items.append(parsed)
    # Built-in skills first in stable order, then custom skills alphabetically
    order = {s["name"]: i for i, s in enumerate(BUILTIN_SKILLS)}
    items.sort(key=lambda x: (0 if x["builtin"] else 1, order.get(x["name"], 999), x["name"]))
    return items


def get_skill(name: str) -> Optional[Dict[str, Any]]:
    ensure_builtin_skills()
    slug = _slugify(name)
    fpath = (SKILLS_DIR / slug / "SKILL.md").resolve()
    if not fpath.is_relative_to(SKILLS_DIR.resolve()) or not fpath.is_file():
        return None
    parsed = _parse_skill_md(fpath.read_text(encoding="utf-8", errors="replace"), slug)
    parsed["path"] = str(fpath)
    return parsed


def save_skill(
    name: str,
    title: str,
    description: str,
    content: str,
    triggers: str = "",
) -> Dict[str, Any]:
    ensure_builtin_skills()
    slug = _slugify(name)
    folder = (SKILLS_DIR / slug).resolve()
    if not folder.is_relative_to(SKILLS_DIR.resolve()):
        raise ValueError("非法的 Skill 路径")
    existing = get_skill(slug)
    is_builtin = bool(existing and existing.get("builtin"))
    folder.mkdir(parents=True, exist_ok=True)
    fpath = folder / "SKILL.md"
    fpath.write_text(
        _format_skill_md(
            name=slug,
            title=(title or slug).strip(),
            description=(description or "自定义工作台 Skill").strip(),
            triggers=(triggers or "").strip(),
            content=(content or "").strip(),
            builtin=is_builtin,
        ),
        encoding="utf-8",
    )
    saved = get_skill(slug)
    assert saved is not None
    return saved


def delete_skill(name: str) -> bool:
    ensure_builtin_skills()
    slug = _slugify(name)
    existing = get_skill(slug)
    if not existing:
        return False
    if existing.get("builtin"):
        raise ValueError("内置核心 Skill 不可删除（可直接编辑自定义内容）")
    folder = (SKILLS_DIR / slug).resolve()
    if not folder.is_relative_to(SKILLS_DIR.resolve()):
        return False
    import shutil
    shutil.rmtree(folder, ignore_errors=True)
    return True
