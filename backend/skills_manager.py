import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import DATA_DIR

SKILLS_DIR = DATA_DIR / "skills"
SKILLS_DIR.mkdir(parents=True, exist_ok=True)

CURRENT_SKILL_VERSION = 2

BUILTIN_SKILLS: List[Dict[str, str]] = [
    {
        "name": "nai-v5-prompt-craft",
        "title": "NAI V4.5 / V5 核心提示词工艺",
        "description": "权威 NovelAI V4.5/V5/V3 语法、正负数值权重 (::)、复杂度锚点、四区块职责隔离与防过曝调优手册。",
        "triggers": "提示词, 优化, 语法, 权重, 报错, 规范, prompt, lint, 负权重",
        "content": """# NAI V4.5 / V5 Prompt Craft Doctrine

## 1. 四区块严格职责边界（杜绝词条串味）
- **artist（画师串）**：仅放 `artist:...` 及画风媒介词（如 `watercolor (medium)`, `impasto`, `cel shading`），禁止混入人物或质量词。
- **character（人物相关）**：主体人数（`1girl, solo`）→ 角色/OC → 发型发色 → 瞳色眼神 → 表情情绪 → 动作互动（V4.5/V5 支持简短自然英语动作短语）→ 服饰配饰。
- **lighting（光影与场景）**：景别机位（`cowboy shot`, `from below`, `dutch angle`）→ 地点背景 → 时段天气 → 光源与空气粒子（`1.15::backlighting::`, `rim lighting`, `tyndall effect`, `bokeh`）→ 复杂度与美学锚点（`high complexity`, `very aesthetic`, `masterpiece`, `absurdres`）。
- **negative（负面提示词 / UC）**：模型对应标准排错集 + 针对当前构图的定向排除（单人排除 `multiple views`，夜景排除 `daylight, sunny`，防文字水印 `text, watermark, signature`）。

## 2. 权重语法与 V4.5/V5 进阶负数值权重
- **正向强调与弱化（V4 / V4.5 / V5）**：使用 `w::tag::` 必须成对闭合 `::`！常见安全区间 `0.6`–`1.4`；支持组权重 `1.2::warm sunlight, floating petals::`。
- **负数值权重（V4.5 / V5 专属利器）**：在正向提示词中用负值精准剔除局部干扰或反转质感，比堆叠 UC 更干净：
  - 精准去物件：`-1::hat::`、`-1::glasses::`
  - 纠偏质感：`-1.2::flat color::`（拯救平涂乏味）、`-1::monochrome::`（恢复色彩）、`-1.2::oversaturated::`（防色彩过曝发焦）、`-1::simple background::`（增强背景细节）
- **复杂度控制（V5 专属）**：`high complexity`（精致默认）、`ultra complexity`（华丽繁复细节）、`low complexity`（极简干净）。
- **V3 兼容红线**：V3 **严禁** `::` 数值权重，仅允许 `{tag}` (+5%) 与 `[tag]` (-5%)。
- **全局禁令**：绝不输出 SD WebUI `(tag:1.2)`、`BREAK`、`AND` 或夹杂中文标签。

## 3. 质量体检与防“炸图”检查
1. 排查互相冲突的时间/天气/光影词（如 `sunset` 与 `midnight`、`simple background` 与 `detailed cityscape`）。
2. 检查画师权重是否过高导致五官或手部崩坏（强风格画师建议 `0.7`–`0.95`）。
3. 每次写入后务必检查 lint 结果，确保 0 语法错误。
""",
    },
    {
        "name": "colloquial-to-danbooru",
        "title": "大白话 → Danbooru / V5 精准转译",
        "description": "将口语化中文情绪、氛围、动作、服饰与质感描述直接转译为高命中率 Danbooru 标签与 V5 自然语言短语。",
        "triggers": "翻译, 大白话, 加上, 改成, 换成, 氛围, 感觉, 动作, 表情, 质感",
        "content": """# Colloquial Chinese to NovelAI Tag Translation Playbook

## 核心执行策略
1. 收到口语化增量需求时，**优先 `patch_prompt_blocks(mode="merge")`**，保留用户已有好词条，仅精准追加或微调对应区块。
2. 先调用 `search_danbooru_tags` 验证词库；对 V4.5/V5 复杂姿势和物体交互，采用「核心 Danbooru 标签 + 1 句简短英语动作短语」组合效果最佳。

## 高频审美口语 → 高命中标签库
- **清冷破碎感 / 易碎美**：`melancholic expression, glistening eyes, pale skin, parted lips, soft cold lighting, subtle tears, ethereal atmosphere, delicate collarbone`
- **慵懒 / 刚睡醒氛围**：`half-closed eyes, messy hair, sleepy expression, oversized shirt, slipping off shoulder, morning sunlight, warm indoor haze`
- **电影感逆光 / 氛围拉满**：`cinematic lighting, 1.15::backlighting::, rim lighting, tyndall effect, lens flare, floating dust particles, depth of field, bokeh`
- **微风吹动发丝与裙摆**：`wind, 1.15::floating hair::, windswept, billowing skirt, dynamic movement`
- **绝美通透眼眸**：`detailed eyes, sparkling eyes, luminous pupils, light reflections in eyes, delicate eyelashes`
- **回眸浅笑**：`looking back, looking at viewer, light smile, over-the-shoulder gaze, gentle blush`
- **厚涂油画质感 / 戏剧张力**：`impasto, painterly brushwork, rich textures, chiaroscuro, dramatic shadows`
- **日系透明水彩 / 轻小说封面**：`watercolor (medium), translucent coloring, airy atmosphere, pastel highlights, delicate lineart`
- **赛博雨夜街头**：`cyberpunk cityscape, night, rain, wet pavement reflections, neon lights, cyan and magenta glow, moody mist`
""",
    },
    {
        "name": "creative-interview",
        "title": "没灵感导演访谈（互动构思）",
        "description": "当用户说没想法、随便画点、懒得想或想要创意建议时，通过简短有趣的导演提案快速共创画面。",
        "triggers": "没灵感, 随便, 懒得想, 帮我想, 构思, 推荐, 想法, 聊聊",
        "content": """# Creative Director Interview Workflow

当用户表达「没想法 / 随便画点 / 帮我构思」时，扮演审美敏锐、不啰嗦的插画艺术总监：

## 互动法则
1. 给出 **3 个反差鲜明的具体视觉提案**（例如：清透日系青春 / 戏剧暗黑奇幻 / 霓虹雨夜都市），每个提案用 1–2 句话点出「人物反差 + 场景光影 + 预期画风」。
2. 末尾务必附带 `[QUICK_REPLIES: 选方案A | 选方案B | 选方案C]` 让用户一键拍板，或引导用户一句补充偏好（如“选 B，发色改银白”）。
3. 一旦用户拍板，立即检索本地画师库（`search_artist_catalog`）并调用 `patch_prompt_blocks` 一次性落地完整四区块，最后提供「直接生成图片」快捷选项。
""",
    },
    {
        "name": "artist-style-blending",
        "title": "画师库检索与风格混搭调音",
        "description": "从本地画师库挑选契合氛围的画师并科学配比权重，诊断画风不满意原因并精准换药。",
        "triggers": "画师, 画风, 混搭, 风格, 水彩, 厚涂, 赛博, 轻小说, artist, 不喜欢",
        "content": """# Artist Style Blending & Diagnostic Guide

## 1. 先查本地库再配比
- 选画师前**必须调用 `search_artist_catalog`**，优先结合用户本地画师库和收藏画师（`favorite=true`）。
- 若用户想引入库里还没有的知名画师，可主动提出调用 `manage_artist_catalog(action="add", ...)` 帮他收入画师库并免费生成标准预览图！

## 2. 黄金稀释与混搭公式
- **单画师主控**：`0.85::artist:primary::` ~ `0.95::artist:primary::`（比 1.0 更稳，减少人脸同质化或手部崩坏）。
- **双画师互补（推荐）**：主结构画师 `0.85–0.9` + 氛围/色彩辅画师 `0.55–0.7`。
- **三画师调色盘**：主 `0.85` + 辅 `0.6` + 点缀 `0.4`（切忌超过 4 位同权重画师互相抵消）。

## 3. 画风不满意精准调参
- 嫌厚重/偏写实：降厚涂画师权重或换清透/轻小说系，并可加 `-0.8::oil painting::`。
- 嫌平淡/色脏：叠加光影氛围画师（如 Rella / Ciloranko / Mika Pikazo）并精简多余环境词。
- 仅换画风时只改 `artist` 区块（`patch_prompt_blocks(artist=..., mode="replace")`），绝不误改人物与光影。
""",
    },
    {
        "name": "director-and-inpaint-workflow",
        "title": "工作台操作：Director / 图生图 / 重绘 / 参数",
        "description": "通过工具操控模型、分辨率、CFG/步数、Director 后处理（线稿/草图/上色/24种表情/去杂物）、图生图、局部重绘与扩图。",
        "triggers": "director, 线稿, 草图, 上色, 表情, 去杂物, 图生图, 重绘, 局部重绘, 扩图, 参数, 步数, 生成, 出图, 分辨率",
        "content": """# Workbench Operations & Director Playbook

## 1. 参数调校与 Opus 免费保护
- Opus 免费上限：`steps <= 28`、像素面积 `<= 1048576`（推荐标准分辨率：`832x1216` 竖图、`1216x832` 横图、`1024x1024` 方图、`704x1408` 轻快竖图、`1408x704` 轻快横图）。
- V4.5/V5 推荐 CFG `scale = 4.5–6.0`（太高易过曝发焦），`cfg_rescale = 0.0–0.2`，采样器首选 `k_euler_ancestral` 或 `k_dpmpp_2s_ancestral`。

## 2. Director 后处理（基于当前画布图，0 点数）
- 提线稿：`run_director_tool(req_type="lineart")`
- 转草图：`run_director_tool(req_type="sketch")`
- 线稿上色：`run_director_tool(req_type="colorize", defry=0, prompt="...")`
- 24 种表情微调：`run_director_tool(req_type="emotion", emotion="happy|shy|smug|sad|angry|surprised|...", defry=0..5)`（`defry` 越小保原图越多，越大改表情越明显）
- 去杂物：`run_director_tool(req_type="declutter")`

## 3. 图生图 / 局部重绘 / 扩图
- 轻度精修光影/细节：`set_workbench_mode(action="img2img", i2i_strength=0.38)`
- 中度重绘换服饰/氛围：`set_workbench_mode(action="img2img", i2i_strength=0.62)`
- 局部重绘（修手/换表情/改配饰）：`set_workbench_mode(action="infill")` 并提示用户在画布上涂抹蒙版后点击生成。
- 扩图延展构图：`set_workbench_mode(action="outpaint", outpaint_direction="right|left|top|bottom|center")`。
""",
    },
    {
        "name": "multi-character-staging",
        "title": "多角色互动与防串色编排 (V4.5 / V5)",
        "description": "掌握 NovelAI V4.5/V5 多角色 source# / target# / mutual# 动作路由、防发色瞳色串味与空间站位技巧。",
        "triggers": "双人, 多人, 互动, 牵手, 拥抱, 对视, 2girls, 1boy, 串色, OC",
        "content": """# Multi-Character Staging & Interaction Mastery (V4.5 / V5)

## 1. 动作指向前缀（杜绝肢体混乱）
- `source#<action>`：动作发起方（如 `source#hugging`, `source#patting head`, `source#holding hand`）。
- `target#<action>`：动作承受方（如 `target#hugging`, `target#blushing`）。
- `mutual#<action>`：双方对称动作（如 `mutual#holding hands`, `mutual#looking at another`）。

## 2. 防属性串色法则
- 明确人数与性别组合在最前：`1girl, 1boy` 或 `2girls, multiple girls`。
- 用明确空间锚定分开人物：`on the left`, `on the right`, `standing side by side`, `facing each other`, `foreground and background`。
- 在 V4.5/V5 中，可在 `character` 区块用简洁英文短句绑定各自特征（如 `the silver-haired girl on the left in white dress, leaning toward the dark-haired boy on the right in black coat`），显著降低发色/服饰互相染色。
- 若用户提到本地 OC 角色，先调用 `list_oc_and_snippets` 确认并用 `load_oc_character` 精准载入。
""",
    },
    {
        "name": "cinematography-and-lighting",
        "title": "电影摄影构图与光影物理手册",
        "description": "提供专业二次元插画镜头语言、透视张力、光影物理分层（轮廓光/散射/冷暖对比）与景深控制方案。",
        "triggers": "构图, 镜头, 视角, 透视, 光影, 逆光, 氛围, 夜景, 景深, 电影感",
        "content": """# Cinematography, Framing & Lighting Physics

## 1. 景别与机位语言
- **头肩特写**：`close-up, portrait, shallow depth of field`（突出情绪与眼神高光）。
- **七分身电影感**：`cowboy shot, dynamic composition`（最均衡展示人物动作与环境叙事）。
- **张力广角/仰俯视**：`from below, low-angle shot, foreshortening, wide-angle lens`（气势感）；`from above, high-angle shot, looking up at viewer`（脆弱/亲近感）；`dutch angle`（不安或动态张力）。

## 2. 三层光影物理结构
1. **主光方向**：`key light`, `golden hour sunlight`, `moonlight`, `window light`, `stained glass light`。
2. **轮廓分离光**：`1.15::rim lighting::`, `backlighting`, `contre-jour`（将发丝与肩线从暗背景中清晰剥离）。
3. **空气介质与反光**：`volumetric lighting`, `tyndall effect`, `atmospheric perspective`, `bounce light`, `subsurface scattering`, `floating dust particles`, `bokeh`。

## 3. 冷暖对比与防脏防过曝
- 经典高级配色：`warm golden rim light` 搭配 `cool twilight blue shadows`，或 `cyan neon reflection` 搭配 `magenta accent glow`。
- 避免同时堆砌 5 个以上强发光词导致画面发白发焦；必要时用 `-1::oversaturated::` 保住高光层次。
""",
    },
    {
        "name": "library-curator",
        "title": "画师库与作品图库智能管家",
        "description": "协助用户通过对话直接管理本地画师库（增删改、收藏、生成预览、保存混搭方案）与作品图库（检索、批量收藏、写备注、载入参数、同步磁盘）。",
        "triggers": "图库, 画师库, 新增画师, 删除画师, 收藏, 备注, 同步磁盘, 混搭方案, 预览图, 归档",
        "content": """# Gallery & Artist Library Curator Playbook

## 1. 画师库管理（`manage_artist_catalog` & `manage_mix_presets`）
- **新增画师**：用户报出画师名/Danbooru Tag 时，补全合理的分类（`厚涂光影` / `清透水彩` / `幻彩插画` / `日系轻小说` / `赛博冷调` / `私人收藏`）和一句中文画风描述，调用 `manage_artist_catalog(action="add", ...)`；如用户想要预览图，可设 `generate_preview=true`（Opus 0 点数免费生成）。
- **编辑/收藏/补预览**：先用 `search_artist_catalog` 确认 `id`，再执行 `update` / `favorite` / `generate_preview`。
- **保存画风混搭**：用户对当前画师权重满意时，调用 `manage_mix_presets(action="save", name=..., items=...)` 归档。

## 2. 作品图库管理（`manage_gallery_items`）
- **检索与复用**：先调用 `query_gallery` 找到目标作品 `id`，再用 `load_to_workbench` 一键把那张图和完整参数载回工作台。
- **整理归档**：支持批量收藏/取消收藏（`favorite` / `unfavorite`）、打搜索备注（`set_notes`）以及扫描同步 `D:\\NAI-Studio\\outputs` 磁盘目录（`sync_folder`）。
- **删除红线**：仅在用户明确指定删除某张/某批作品时才调用 `delete` 并精确传入 `ids`，严禁未确认就批量删除。
""",
    },
]


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_\-\u4e00-\u9fff]+", "-", str(name or "").strip().lower()).strip("-")
    if not slug:
        raise ValueError("Skill 名称不能为空")
    return slug[:64]


def _format_skill_md(
    name: str,
    title: str,
    description: str,
    triggers: str,
    content: str,
    builtin: bool = False,
    version: int = CURRENT_SKILL_VERSION,
) -> str:
    return (
        "---\n"
        f"name: {name}\n"
        f"title: {title}\n"
        f"description: {description}\n"
        f"triggers: {triggers}\n"
        f"builtin: {'true' if builtin else 'false'}\n"
        f"version: {version}\n"
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
    try:
        ver = int(meta.get("version") or 1)
    except Exception:
        ver = 1
    return {
        "name": name,
        "title": meta.get("title") or name,
        "description": meta.get("description") or "自定义工作台 Skill",
        "triggers": meta.get("triggers") or "",
        "builtin": meta.get("builtin", "false").lower() == "true",
        "version": ver,
        "content": body,
    }


def ensure_builtin_skills() -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    for sk in BUILTIN_SKILLS:
        folder = SKILLS_DIR / sk["name"]
        fpath = folder / "SKILL.md"
        should_write = not fpath.exists()
        if not should_write:
            try:
                existing = _parse_skill_md(fpath.read_text(encoding="utf-8", errors="replace"), sk["name"])
                # Auto-upgrade untouched older built-in skills to the latest doctrine version
                if existing.get("builtin") and int(existing.get("version") or 1) < CURRENT_SKILL_VERSION:
                    should_write = True
            except Exception:
                should_write = True
        if should_write:
            folder.mkdir(parents=True, exist_ok=True)
            fpath.write_text(
                _format_skill_md(
                    name=sk["name"],
                    title=sk["title"],
                    description=sk["description"],
                    triggers=sk["triggers"],
                    content=sk["content"],
                    builtin=True,
                    version=CURRENT_SKILL_VERSION,
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
            version=max(CURRENT_SKILL_VERSION, int((existing or {}).get("version") or CURRENT_SKILL_VERSION)),
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
