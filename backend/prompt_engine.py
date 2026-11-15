import html
import math
import random
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .config import DATA_DIR
from .models_spec import get_model_spec

WILDCARDS_DIR = DATA_DIR / "wildcards"
WILDCARDS_DIR.mkdir(parents=True, exist_ok=True)

_DEFAULT_WILDCARDS = {
    "hair_color.txt": "silver hair\nwhite hair\nblonde hair\npink hair\nblue hair\nlavender hair\nblack hair",
    "expression.txt": "light smile\nshy blush\nconfident smirk\nsoft expression\nsparkling eyes, excited\nmelancholic gaze",
    "outfit.txt": "serafuku\nwhite sundress\ngothic lolita dress\nschool uniform, cardigan\ncyberpunk jacket\nelegant kimono",
    "lighting.txt": "sunset, lens flare\nbacklighting, rim lighting\ndappled sunlight, bokeh\nmoonlight, starry sky\ntyndall effect, golden hour",
}

for _fname, _content in _DEFAULT_WILDCARDS.items():
    _fpath = WILDCARDS_DIR / _fname
    if not _fpath.exists():
        _fpath.write_text(_content, encoding="utf-8")

# 常用高质量中英 Tag 词典（支持中文、拼音首字母或英文模糊搜索，并与官方 suggest-tags 实时结果合并）
BUILTIN_TAGS: List[Dict[str, Any]] = [
    # 主体与人数
    {"tag": "1girl", "cn": "单人少女 / 一个女孩", "cat": "主体", "count": 9800000},
    {"tag": "solo", "cn": "单人独照 / 聚焦单人", "cat": "主体", "count": 8500000},
    {"tag": "2girls", "cn": "双人少女 / 两个女孩", "cat": "主体", "count": 2100000},
    {"tag": "1boy", "cn": "单人少年 / 一个男孩", "cat": "主体", "count": 1900000},
    {"tag": "multiple girls", "cn": "多人少女群像", "cat": "主体", "count": 950000},
    {"tag": "chibi", "cn": "Q版 / 二头身可爱风", "cat": "主体", "count": 620000},
    # 发色与发型
    {"tag": "silver hair", "cn": "银发 / 白银发色", "cat": "发型发色", "count": 1450000},
    {"tag": "white hair", "cn": "白发 / 纯白发色", "cat": "发型发色", "count": 1820000},
    {"tag": "black hair", "cn": "黑发 / 乌黑长发", "cat": "发型发色", "count": 3900000},
    {"tag": "blonde hair", "cn": "金发 / 浅金发色", "cat": "发型发色", "count": 2800000},
    {"tag": "pink hair", "cn": "粉发 / 樱花粉发色", "cat": "发型发色", "count": 1500000},
    {"tag": "blue hair", "cn": "蓝发 / 冰蓝发色", "cat": "发型发色", "count": 1650000},
    {"tag": "purple hair", "cn": "紫发 / 堇紫发色", "cat": "发型发色", "count": 1320000},
    {"tag": "red hair", "cn": "红发 / 绯红发色", "cat": "发型发色", "count": 1100000},
    {"tag": "multicolored hair", "cn": "挑染 / 双色渐变发", "cat": "发型发色", "count": 890000},
    {"tag": "streaked hair", "cn": "挂耳染 / 发丝挑染", "cat": "发型发色", "count": 410000},
    {"tag": "long hair", "cn": "长发", "cat": "发型发色", "count": 6200000},
    {"tag": "very long hair", "cn": "及腰超长发", "cat": "发型发色", "count": 1750000},
    {"tag": "short hair", "cn": "短发 / 清爽短发", "cat": "发型发色", "count": 3100000},
    {"tag": "twintails", "cn": "双马尾", "cat": "发型发色", "count": 1680000},
    {"tag": "ponytail", "cn": "单马尾 / 高马尾", "cat": "发型发色", "count": 1540000},
    {"tag": "braid", "cn": "麻花辫 / 编发", "cat": "发型发色", "count": 1220000},
    {"tag": "floating hair", "cn": "飘逸发丝 / 风吹发丝", "cat": "发型发色", "count": 780000},
    {"tag": "ahoge", "cn": "呆毛", "cat": "发型发色", "count": 1430000},
    {"tag": "blunt bangs", "cn": "齐刘海", "cat": "发型发色", "count": 1350000},
    {"tag": "parted bangs", "cn": "八字刘海 / 中分刘海", "cat": "发型发色", "count": 1180000},
    # 眼睛与表情
    {"tag": "blue eyes", "cn": "蓝瞳 / 蔚蓝眼眸", "cat": "眼部表情", "count": 2650000},
    {"tag": "red eyes", "cn": "红瞳 / 猩红眼眸", "cat": "眼部表情", "count": 2150000},
    {"tag": "golden eyes", "cn": "金瞳 / 琥珀金眼眸", "cat": "眼部表情", "count": 1480000},
    {"tag": "purple eyes", "cn": "紫瞳 / 紫罗兰眼眸", "cat": "眼部表情", "count": 1360000},
    {"tag": "green eyes", "cn": "绿瞳 / 翡翠绿眼眸", "cat": "眼部表情", "count": 1420000},
    {"tag": "heterochromia", "cn": "异色瞳 / 鸳鸯眼", "cat": "眼部表情", "count": 460000},
    {"tag": "detailed eyes", "cn": "精致眼部高光细节", "cat": "眼部表情", "count": 920000},
    {"tag": "sparkling eyes", "cn": "星星眼 / 晶亮眼神", "cat": "眼部表情", "count": 540000},
    {"tag": "half-closed eyes", "cn": "半睁眼 / 慵懒眼神", "cat": "眼部表情", "count": 680000},
    {"tag": "smile", "cn": "微笑 / 浅笑", "cat": "眼部表情", "count": 4800000},
    {"tag": "light smile", "cn": "淡淡微笑 / 温柔笑意", "cat": "眼部表情", "count": 960000},
    {"tag": "expressionless", "cn": "无表情 / 三无冷淡", "cat": "眼部表情", "count": 1120000},
    {"tag": "blush", "cn": "脸红 / 羞涩红晕", "cat": "眼部表情", "count": 3600000},
    {"tag": "tears", "cn": "泪水 / 眼角含泪", "cat": "眼部表情", "count": 790000},
    {"tag": "looking at viewer", "cn": "看向观众 / 对视镜头", "cat": "眼部表情", "count": 5600000},
    {"tag": "looking back", "cn": "回眸 / 回头看", "cat": "眼部表情", "count": 880000},
    # 服饰与配饰
    {"tag": "serafuku", "cn": "水手服 / 日式校服", "cat": "服饰", "count": 1420000},
    {"tag": "school uniform", "cn": "学生制服 / 校服", "cat": "服饰", "count": 2750000},
    {"tag": "white dress", "cn": "白色连衣裙 / 白裙", "cat": "服饰", "count": 1150000},
    {"tag": "sundress", "cn": "夏日吊带长裙", "cat": "服饰", "count": 430000},
    {"tag": "gothic lolita", "cn": "哥特洛丽塔洋装", "cat": "服饰", "count": 520000},
    {"tag": "frills", "cn": "荷叶边 / 蕾丝褶边", "cat": "服饰", "count": 1850000},
    {"tag": "maid", "cn": "女仆装", "cat": "服饰", "count": 1100000},
    {"tag": "kimono", "cn": "日式和服 / 振袖", "cat": "服饰", "count": 1340000},
    {"tag": "chinese clothes", "cn": "中华风服饰 / 旗袍汉服", "cat": "服饰", "count": 890000},
    {"tag": "cyberpunk", "cn": "赛博朋克机能风", "cat": "服饰", "count": 480000},
    {"tag": "hoodie", "cn": "连帽卫衣 / 外套", "cat": "服饰", "count": 920000},
    {"tag": "cardigan", "cn": "针织开衫", "cat": "服饰", "count": 640000},
    {"tag": "thighhighs", "cn": "过膝袜 / 绝对领域", "cat": "服饰", "count": 2950000},
    {"tag": "black pantyhose", "cn": "黑丝连裤袜", "cat": "服饰", "count": 1240000},
    {"tag": "white thighhighs", "cn": "白丝过膝袜", "cat": "服饰", "count": 980000},
    {"tag": "hair ribbon", "cn": "发带 / 蝴蝶结发饰", "cat": "服饰", "count": 1620000},
    {"tag": "halo", "cn": "头顶光环 / 天使光环", "cat": "服饰", "count": 580000},
    {"tag": "wings", "cn": "羽翼 / 翅膀", "cat": "服饰", "count": 1150000},
    {"tag": "glasses", "cn": "眼镜 / 细框眼镜", "cat": "服饰", "count": 1460000},
    {"tag": "choker", "cn": "颈环 / 项圈", "cat": "服饰", "count": 1380000},
    # 光影与氛围
    {"tag": "cinematic lighting", "cn": "电影级光影 / 戏剧光感", "cat": "光影氛围", "count": 820000},
    {"tag": "backlighting", "cn": "逆光 / 轮廓发光", "cat": "光影氛围", "count": 1150000},
    {"tag": "rim lighting", "cn": "边缘高光 / 勾边光", "cat": "光影氛围", "count": 640000},
    {"tag": "sunlight", "cn": "自然阳光 / 日光倾泻", "cat": "光影氛围", "count": 1380000},
    {"tag": "dappled sunlight", "cn": "树影斑驳阳光 / 木漏日", "cat": "光影氛围", "count": 490000},
    {"tag": "sunset", "cn": "夕阳 / 黄昏落日", "cat": "光影氛围", "count": 960000},
    {"tag": "golden hour", "cn": "黄金时刻暖光", "cat": "光影氛围", "count": 420000},
    {"tag": "twilight", "cn": "暮色 / 逢魔时刻蓝调", "cat": "光影氛围", "count": 510000},
    {"tag": "moonlight", "cn": "月光 / 清冷夜色", "cat": "光影氛围", "count": 680000},
    {"tag": "tyndall effect", "cn": "丁达尔体积光 / 圣光束", "cat": "光影氛围", "count": 380000},
    {"tag": "lens flare", "cn": "镜头光晕 / 眩光", "cat": "光影氛围", "count": 740000},
    {"tag": "depth of field", "cn": "浅景深 / 背景柔化虚化", "cat": "光影氛围", "count": 1650000},
    {"tag": "bokeh", "cn": "梦幻光斑虚化", "cat": "光影氛围", "count": 620000},
    {"tag": "chromatic aberration", "cn": "微色散光学质感", "cat": "光影氛围", "count": 540000},
    {"tag": "water drop", "cn": "水滴 / 晶透露珠", "cat": "光影氛围", "count": 450000},
    {"tag": "sparkles", "cn": "星光微粒 / 闪耀光尘", "cat": "光影氛围", "count": 1280000},
    {"tag": "floating petals", "cn": "飘落花瓣 / 樱吹雪", "cat": "光影氛围", "count": 840000},
    {"tag": "wind", "cn": "微风吹拂动态感", "cat": "光影氛围", "count": 1120000},
    # 构图与镜头
    {"tag": "portrait", "cn": "肖像特写 / 半身头肩像", "cat": "镜头构图", "count": 1950000},
    {"tag": "upper body", "cn": "上半身构图", "cat": "镜头构图", "count": 3800000},
    {"tag": "cowboy shot", "cn": "七分身构图（大腿以上）", "cat": "镜头构图", "count": 2400000},
    {"tag": "full body", "cn": "全身构图", "cat": "镜头构图", "count": 3100000},
    {"tag": "close-up", "cn": "面部大特写", "cat": "镜头构图", "count": 1250000},
    {"tag": "from above", "cn": "俯视角度 / 高机位", "cat": "镜头构图", "count": 1420000},
    {"tag": "from below", "cn": "仰视角度 / 低机位气势", "cat": "镜头构图", "count": 1180000},
    {"tag": "from side", "cn": "侧面视角", "cat": "镜头构图", "count": 1350000},
    {"tag": "from behind", "cn": "背影视角", "cat": "镜头构图", "count": 1120000},
    {"tag": "dynamic angle", "cn": "大透视动感张力镜头", "cat": "镜头构图", "count": 760000},
    {"tag": "dutch angle", "cn": "倾斜构图 / 电影感斜角", "cat": "镜头构图", "count": 520000},
    # 场景与背景
    {"tag": "rooftop", "cn": "学校天台 / 屋顶", "cat": "场景背景", "count": 380000},
    {"tag": "classroom", "cn": "教室 / 课桌窗边", "cat": "场景背景", "count": 620000},
    {"tag": "ocean", "cn": "大海 / 蔚蓝海面", "cat": "场景背景", "count": 890000},
    {"tag": "beach", "cn": "海滩 / 夏日海岸", "cat": "场景背景", "count": 1150000},
    {"tag": "underwater", "cn": "水下 / 深海气泡折射", "cat": "场景背景", "count": 460000},
    {"tag": "starry sky", "cn": "璀璨星空 / 银河夜空", "cat": "场景背景", "count": 920000},
    {"tag": "cloudy sky", "cn": "云海天空 / 积雨云", "cat": "场景背景", "count": 1240000},
    {"tag": "rain", "cn": "雨景 / 细雨绵绵", "cat": "场景背景", "count": 710000},
    {"tag": "snow", "cn": "雪景 / 飘雪冬日", "cat": "场景背景", "count": 880000},
    {"tag": "cherry blossoms", "cn": "樱花盛开", "cat": "场景背景", "count": 960000},
    {"tag": "flower field", "cn": "花海 / 繁花草原", "cat": "场景背景", "count": 540000},
    {"tag": "cityscape", "cn": "城市街景 / 繁华都市", "cat": "场景背景", "count": 680000},
    {"tag": "ruins", "cn": "废墟 / 幻想遗迹", "cat": "场景背景", "count": 410000},
    {"tag": "stained glass", "cn": "教堂彩绘玻璃光影", "cat": "场景背景", "count": 350000},
    {"tag": "simple background", "cn": "极简纯色背景", "cat": "场景背景", "count": 4200000},
    {"tag": "transparent background", "cn": "V5 原生透明背景 (Alpha)", "cat": "V5 专属", "count": 950000},
    # 质量与画风词
    {"tag": "masterpiece", "cn": "杰作级画质", "cat": "质量美学", "count": 9900000},
    {"tag": "best quality", "cn": "最高画质", "cat": "质量美学", "count": 9900000},
    {"tag": "very aesthetic", "cn": "官方最高美学度加成", "cat": "质量美学", "count": 8500000},
    {"tag": "absurdres", "cn": "超高精细分辨率细节", "cat": "质量美学", "count": 7200000},
    {"tag": "watercolor (medium)", "cn": "清透水彩手绘质感", "cat": "质量美学", "count": 640000},
    {"tag": "impasto", "cn": "厚涂油画笔触感", "cat": "质量美学", "count": 320000},
    {"tag": "pastel colors", "cn": "柔和马卡龙粉彩配色", "cat": "质量美学", "count": 480000},
    # 多角色互动前缀 (V4 / V4.5 / V5)
    {"tag": "source#hugging", "cn": "多角色：主动拥抱对方 (source#)", "cat": "多角色互动", "count": 120000},
    {"tag": "target#hugging", "cn": "多角色：被对方拥抱 (target#)", "cat": "多角色互动", "count": 120000},
    {"tag": "mutual#holding hands", "cn": "多角色：双方互相牵手 (mutual#)", "cat": "多角色互动", "count": 180000},
    {"tag": "mutual#looking at another", "cn": "多角色：双方深情对视 (mutual#)", "cat": "多角色互动", "count": 210000},
]

EMOTICON_SET = {"^_^", ">_<", "o_o", "0_0", "@_@", "T_T", "-_-", ";_;", "=_=", "^o^", ">o<"}


def search_builtin_tags(query: str, limit: int = 12) -> List[Dict[str, Any]]:
    q = (query or "").strip().lower()
    if not q:
        return BUILTIN_TAGS[:limit]
    scored: List[Tuple[int, Dict[str, Any]]] = []
    for item in BUILTIN_TAGS:
        tag_l = item["tag"].lower()
        cn_l = item["cn"].lower()
        cat_l = item["cat"].lower()
        if q == tag_l or q in cn_l:
            score = 100 if q == tag_l else 90
            scored.append((score, item))
        elif tag_l.startswith(q):
            scored.append((80, item))
        elif q in tag_l or q in cat_l:
            scored.append((65, item))
    scored.sort(key=lambda x: (-x[0], -x[1]["count"]))
    return [x[1] for x in scored[:limit]]


def _weight_to_brackets(weight: float, inner: str) -> str:
    """Converts a numeric multiplier (e.g. 1.21) to NovelAI {} or [] brackets (1.05^n)."""
    if weight <= 0:
        return inner
    steps = int(round(math.log(weight) / math.log(1.05)))
    steps = max(-8, min(8, steps))
    if steps > 0:
        return ("{" * steps) + inner + ("}" * steps)
    elif steps < 0:
        n = abs(steps)
        return ("[" * n) + inner + ("]" * n)
    return inner


def simplify_nested_brackets(token: str) -> str:
    """Simplifies mixed outer brackets like {[{rooftop}]} -> {rooftop}."""
    s = token.strip()
    if not s or "::" in s:
        return s
    left_chars = []
    i = 0
    while i < len(s) and s[i] in "{}[]":
        left_chars.append(s[i])
        i += 1
    j = len(s) - 1
    right_chars = []
    while j >= i and s[j] in "{}[]":
        right_chars.append(s[j])
        j -= 1
    core = s[i : j + 1].strip()
    if not left_chars and not right_chars:
        return s
    # Only simplify when outer brackets wrap the core symmetrically in count
    if len(left_chars) == len(right_chars) and core and not any(c in core for c in "{}[]"):
        # Check if mixed { and [ exist or if each left pairs with right
        valid_pairs = True
        net = 0
        for lc, rc in zip(left_chars, right_chars):
            if lc == "{" and rc == "}":
                net += 1
            elif lc == "[" and rc == "]":
                net -= 1
            else:
                valid_pairs = False
                break
        if valid_pairs:
            if net > 0:
                return ("{" * net) + core + ("}" * net)
            elif net < 0:
                return ("[" * abs(net)) + core + ("]" * abs(net))
            else:
                return core
    return s


def adjust_tag_weight(token: str, delta: int, mode: str = "brackets", model_id: str = "nai-diffusion-5-full") -> str:
    """
    Smart non-stacking weight adjuster for a single tag or selection.
    delta: +1 or -1
    mode: 'brackets' ({} / []) or 'numeric' (1.1::tag::)
    """
    spec = get_model_spec(model_id)
    if not spec["supports_numeric_weight"]:
        mode = "brackets"

    raw = token.strip().strip(",")
    if not raw:
        return token

    # Check if already numeric weight: w::inner::
    m_num = re.match(r"^(-?\d+(?:\.\d+)?)::(.*?)::$", raw)
    # Check if wrapped in brackets
    simplified = simplify_nested_brackets(raw)
    m_brk = re.match(r"^(\{+|-?\[+)([^{}\[\]]+)(\}+|\]+)$", simplified)

    core = raw
    current_weight = 1.0
    bracket_level = 0

    if m_num:
        current_weight = float(m_num.group(1))
        core = m_num.group(2).strip()
        bracket_level = int(round(math.log(max(0.2, abs(current_weight))) / math.log(1.05)))
    elif m_brk and len(m_brk.group(1)) == len(m_brk.group(3)):
        open_b = m_brk.group(1)
        core = m_brk.group(2).strip()
        bracket_level = len(open_b) if open_b[0] == "{" else -len(open_b)
        current_weight = round(1.05 ** bracket_level, 2)

    if mode == "numeric":
        new_w = round(current_weight + (0.1 * delta), 2)
        if not spec["supports_negative_weight"] and new_w <= 0:
            new_w = 0.1
        if abs(new_w - 1.0) < 0.01:
            return core
        return f"{new_w:g}::{core}::"
    else:
        new_level = max(-8, min(8, bracket_level + delta))
        if new_level > 0:
            return ("{" * new_level) + core + ("}" * new_level)
        elif new_level < 0:
            return ("[" * abs(new_level)) + core + ("]" * abs(new_level))
        return core


def lint_prompt(prompt: str, model_id: str = "nai-diffusion-5-full") -> Dict[str, Any]:
    """
    Non-destructive NovelAI prompt syntax & model-compatibility linter.
    Detects issues with character offsets, provides per-issue explanations and one-click fixes.
    """
    spec = get_model_spec(model_id)
    text = prompt or ""
    issues: List[Dict[str, Any]] = []

    # 1. Detect full-width Chinese punctuation
    for m in re.finditer(r"[，。；：（）｛｝［］]+", text):
        bad = m.group(0)
        trans_map = str.maketrans({"，": ", ", "。": ", ", "；": ", ", "：": ":", "（": "(", "）": ")", "｛": "{", "｝": "}", "［": "[", "］": "]"})
        rep = bad.translate(trans_map)
        issues.append({
            "id": f"punct_{m.start()}",
            "type": "fullwidth_punct",
            "severity": "warn",
            "start": m.start(),
            "end": m.end(),
            "token": bad,
            "replacement": rep,
            "message": f"全角中文标点「{bad}」在 NAI 中会被当成普通字符，建议转为英文半角「{rep.strip()}」",
        })

    # 2. Detect SD <lora:...> syntax
    for m in re.finditer(r"<lora:[^>]+>", text, flags=re.IGNORECASE):
        issues.append({
            "id": f"lora_{m.start()}",
            "type": "sd_lora",
            "severity": "error",
            "start": m.start(),
            "end": m.end(),
            "token": m.group(0),
            "replacement": "",
            "message": f"NovelAI 不支持 SD 的 LoRA 语法「{m.group(0)}」，建议移除并改用 artist: 画师标签或 Vibe 参考",
        })

    # 3. Detect SD weight syntax (tag:1.2) or (tag:0.8)
    for m in re.finditer(r"\(([^():,]+):(-?\d+(?:\.\d+)?)\)", text):
        inner = m.group(1).strip().replace("_", " ")
        w = float(m.group(2))
        if spec["supports_numeric_weight"]:
            if w < 0 and not spec["supports_negative_weight"]:
                rep = _weight_to_brackets(0.7, inner)
            else:
                rep = f"{w:g}::{inner}::"
        else:
            rep = _weight_to_brackets(w, inner)
        issues.append({
            "id": f"sdweight_{m.start()}",
            "type": "sd_weight",
            "severity": "error",
            "start": m.start(),
            "end": m.end(),
            "token": m.group(0),
            "replacement": rep,
            "message": f"SD 权重语法「{m.group(0)}」在 NAI 中无效，建议转为 NAI {spec['short_name']} 标准格式「{rep}」",
        })

    # 4. Detect numeric weights w::tag:: when V3 is selected OR negative weight when V4.0 is selected
    for m in re.finditer(r"(-?\d+(?:\.\d+)?)::([^:]+)::", text):
        w = float(m.group(1))
        inner = m.group(2).strip()
        if not spec["supports_numeric_weight"]:
            rep = _weight_to_brackets(w, inner)
            issues.append({
                "id": f"v3num_{m.start()}",
                "type": "v3_numeric_unsupported",
                "severity": "error",
                "start": m.start(),
                "end": m.end(),
                "token": m.group(0),
                "replacement": rep,
                "message": f"当前模型 {spec['short_name']} 不支持 :: 数字权重，建议转为括号权重「{rep}」",
            })
        elif w < 0 and not spec["supports_negative_weight"]:
            rep = f"[{inner}]"
            issues.append({
                "id": f"negnum_{m.start()}",
                "type": "negative_weight_unsupported",
                "severity": "error",
                "start": m.start(),
                "end": m.end(),
                "token": m.group(0),
                "replacement": rep,
                "message": f"当前模型 {spec['short_name']} 不支持负数权重「{m.group(0)}」（仅 V4.5/V5 支持），建议移入负向词或改为「{rep}」",
            })

    # 5. Detect cancelled nested brackets like {[{rooftop}]} or [{tag}]
    for m in re.finditer(r"[\{\[]{2,}[^{}\[\],]+[\}\]]{2,}", text):
        raw_tok = m.group(0)
        if ("{" in raw_tok and "[" in raw_tok) or ("}" in raw_tok and "]" in raw_tok):
            simp = simplify_nested_brackets(raw_tok)
            if simp != raw_tok:
                issues.append({
                    "id": f"mixbrk_{m.start()}",
                    "type": "mixed_brackets",
                    "severity": "warn",
                    "start": m.start(),
                    "end": m.end(),
                    "token": raw_tok,
                    "replacement": simp,
                    "message": f"正负括号互相嵌套「{raw_tok}」会互相抵消，建议精简为「{simp}」",
                })

    # 6. Detect underscores in non-artist general tags (e.g. silver_hair, school_uniform)
    # Skip ranges already covered by earlier issues
    covered = [(iss["start"], iss["end"]) for iss in issues]

    def _is_covered(s: int, e: int) -> bool:
        return any( not (e <= cs or s >= ce) for cs, ce in covered )

    for m in re.finditer(r"(?<![a-zA-Z0-9_:])([a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)+)(?![a-zA-Z0-9_])", text):
        s, e = m.start(), m.end()
        if _is_covered(s, e):
            continue
        tok = m.group(1)
        if tok in EMOTICON_SET:
            continue
        # Check prefix before token to see if it's artist: or by_
        prefix = text[max(0, s - 16) : s].lower()
        if "artist:" in prefix or "artist_" in prefix:
            continue
        rep = tok.replace("_", " ")
        issues.append({
            "id": f"under_{s}",
            "type": "underscore_tag",
            "severity": "warn",
            "start": s,
            "end": e,
            "token": tok,
            "replacement": rep,
            "message": f"NAI 官方词库对普通标签推荐使用空格「{rep}」代替下划线「{tok}」（画师名除外）",
        })

    # Sort issues by start offset
    issues.sort(key=lambda x: x["start"])

    # Build fixed_prompt and highlighted_html
    fixed_parts: List[str] = []
    html_parts: List[str] = []
    cursor = 0
    for iss in issues:
        s, e = iss["start"], iss["end"]
        if s < cursor:
            continue
        before = text[cursor:s]
        fixed_parts.append(before)
        html_parts.append(html.escape(before))

        fixed_parts.append(iss["replacement"])
        cls = "lint-mark-error" if iss["severity"] == "error" else "lint-mark-warn"
        html_parts.append(f'<span class="{cls}" title="{html.escape(iss["message"])}">{html.escape(text[s:e])}</span>')
        cursor = e

    tail = text[cursor:]
    fixed_parts.append(tail)
    html_parts.append(html.escape(tail))

    fixed_prompt = "".join(fixed_parts)
    # Clean up redundant commas after removals
    fixed_prompt = re.sub(r",\s*,+", ", ", fixed_prompt)
    fixed_prompt = re.sub(r"^\s*,\s*|\s*,\s*$", "", fixed_prompt).strip()

    return {
        "model_id": model_id,
        "model_short": spec["short_name"],
        "issue_count": len(issues),
        "issues": issues,
        "fixed_prompt": fixed_prompt,
        "highlighted_html": "".join(html_parts),
    }


def _safe_wildcard_path(name: str) -> Path:
    clean = re.sub(r"[^a-zA-Z0-9_\-\u4e00-\u9fff]", "_", (name or "").strip()).strip("_")
    if not clean:
        raise ValueError("通配符词库名称不能为空")
    target = (WILDCARDS_DIR / f"{clean}.txt").resolve()
    if not target.is_relative_to(WILDCARDS_DIR.resolve()):
        raise ValueError("非法的词库路径")
    return target


def list_wildcards() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for f in sorted(WILDCARDS_DIR.glob("*.txt")):
        lines = [ln.strip() for ln in f.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip() and not ln.strip().startswith("#")]
        items.append({"name": f.stem, "token": f"__{f.stem}__", "count": len(lines), "samples": lines[:6]})
    return items


def get_wildcard_detail(name: str) -> Dict[str, Any]:
    target = _safe_wildcard_path(name)
    if not target.exists():
        raise FileNotFoundError(f"词库 {target.stem} 不存在")
    raw = target.read_text(encoding="utf-8", errors="replace")
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    return {"name": target.stem, "token": f"__{target.stem}__", "content": raw, "count": len(lines)}


def save_wildcard_file(name: str, content: str) -> Dict[str, Any]:
    target = _safe_wildcard_path(name)
    WILDCARDS_DIR.mkdir(parents=True, exist_ok=True)
    normalized = "\n".join(ln.strip() for ln in (content or "").splitlines() if ln.strip())
    target.write_text(normalized + ("\n" if normalized else ""), encoding="utf-8")
    return get_wildcard_detail(target.stem)


def delete_wildcard_file(name: str) -> bool:
    target = _safe_wildcard_path(name)
    if target.exists():
        target.unlink()
        return True
    return False


def _pick_weighted_choices(options_raw: List[str], rng: random.Random, pick_count: int = 1) -> str:
    parsed: List[Tuple[float, str]] = []
    for opt in options_raw:
        opt_s = opt.strip()
        m_w = re.match(r"^(\d+(?:\.\d+)?)::(.+)$", opt_s)
        if m_w:
            parsed.append((max(0.01, float(m_w.group(1))), m_w.group(2).strip()))
        else:
            parsed.append((1.0, opt_s))

    chosen: List[str] = []
    pool = list(parsed)
    for _ in range(min(pick_count, len(pool))):
        weights = [p[0] for p in pool]
        picked = rng.choices(pool, weights=weights, k=1)[0]
        if picked[1]:
            chosen.append(picked[1])
        pool.remove(picked)
    return ", ".join(chosen)


def expand_dynamic_prompt(prompt: str, seed: Optional[int] = None) -> Dict[str, Any]:
    """
    Expands dynamic lottery syntax '{opt1|opt2|opt3}', multi-pick '{2$$a|b|c}',
    weighted odds '{0.7::a|0.3::b}', and file wildcards '__hair_color__'.
    Preserves single-item NovelAI weight braces '{tag}' (only processes braces containing '|').
    """
    text = prompt or ""
    rng = random.Random(seed if seed and int(seed) > 0 else None)
    had_dynamic = False

    # 1. Expand __wildcard__ references
    def _rep_wildcard(m: re.Match) -> str:
        nonlocal had_dynamic
        name = m.group(1).strip()
        f = WILDCARDS_DIR / f"{name}.txt"
        if f.exists():
            lines = [ln.strip() for ln in f.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip() and not ln.strip().startswith("#")]
            if lines:
                had_dynamic = True
                return rng.choice(lines)
        return m.group(0)

    text = re.sub(r"__([a-zA-Z0-9_\-\u4e00-\u9fff]+)__", _rep_wildcard, text)

    # 2. Iteratively expand innermost {opt1|opt2} (containing '|')
    for _ in range(6):
        def _rep_brace(m: re.Match) -> str:
            nonlocal had_dynamic
            inner = m.group(1)
            if "|" not in inner:
                return m.group(0)
            had_dynamic = True
            pick_count = 1
            m_multi = re.match(r"^(\d+)\$\$(.+)$", inner)
            if m_multi:
                pick_count = max(1, int(m_multi.group(1)))
                inner = m_multi.group(2)
            opts = inner.split("|")
            return _pick_weighted_choices(opts, rng, pick_count)

        new_text = re.sub(r"\{([^{}]*\|[^{}]*)\}", _rep_brace, text)
        if new_text == text:
            break
        text = new_text

    text = re.sub(r",\s*,+", ", ", text).strip(" ,")
    return {
        "original": prompt,
        "expanded": text,
        "had_dynamic": had_dynamic,
    }
