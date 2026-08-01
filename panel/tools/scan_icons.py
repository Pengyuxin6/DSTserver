# -*- coding: utf-8 -*-
"""统一扫描：prefab 图标覆盖缺口 + minimap 提取完整性"""
import re, os, json, sys

GAME = r"D:\steam\steamapps\common\Don't Starve Together\data"
PANEL = r"F:\kimiwork\DSTserver\panel"

# 1. 游戏 minimap 全部元素 vs 已提取
game_els = set()
for f in ["minimap_data.xml", "minimap_data1.xml", "minimap_data2.xml"]:
    p = os.path.join(GAME, "minimap", f)
    if not os.path.exists(p):
        print("!! 游戏文件缺失:", p); continue
    c = open(p, encoding="utf-8", errors="ignore").read()
    game_els.update(re.findall(r'<Element name="([^"]+)"', c))
game_els = {e.rsplit(".", 1)[0] for e in game_els}

local_xml = open(os.path.join(PANEL, "data", "invicons", "minimap.xml"), encoding="utf-8").read()
local_els = {e.rsplit(".", 1)[0] for e in re.findall(r'<Element name="([^"]+)"', local_xml)}

missing_mini = sorted(game_els - local_els)
print("== minimap ==  游戏元素 %d | 已切 %d | 漏切 %d" % (len(game_els), len(local_els), len(missing_mini)))
print("漏切样例:", missing_mini[:30])

# 2. 全部 atlas 元素表（icon map 与 server.ts 同逻辑：先见先得）
icon_map = {}
inv = os.path.join(PANEL, "data", "invicons")
for f in sorted(os.listdir(inv)):
    m = re.match(r"^(inventoryimages\d+|minimap)\.xml$", f)
    if not m: continue
    c = open(os.path.join(inv, f), encoding="utf-8").read()
    for mm in re.finditer(r'<Element name="([^"]+)\.(?:tex|png)"', c):
        icon_map.setdefault(mm.group(1), m.group(1))

# 3. 磁盘 PNG 校验
disk_missing = []
for el, atlas in icon_map.items():
    png = os.path.join(PANEL, "public", "icons", atlas, el + ".png")
    if not os.path.exists(png):
        disk_missing.append((el, atlas))
print("== 索引有但PNG缺 ==", len(disk_missing), disk_missing[:10])

# 4. 3944 prefab 覆盖分类
prefabs = json.load(open(os.path.join(PANEL, "data", "vanilla_prefabs.json"), encoding="utf-8"))
en = json.load(open(os.path.join(PANEL, "data", "prefab_en_names.json"), encoding="utf-8"))
covered, wiki_only, internal = [], [], []
for p in prefabs:
    if p in icon_map:
        covered.append(p)
    elif p in en:
        wiki_only.append(p)
    else:
        internal.append(p)
print("== prefab 覆盖 ==  图集覆盖 %d | 仅wiki兜底 %d | 无英文名(内部实体) %d" % (len(covered), len(wiki_only), len(internal)))
print("仅wiki样例:", wiki_only[:25])

# 5. 用户点名验证
named = ["toadstool_dark", "toadstool_cap_dark", "merm_toolshed_upgraded", "tentacle_pillar",
         "tentacle_garden", "minotaurchest", "glommer", "spicepack", "telebase"]
print("== 点名清单 ==")
for p in named:
    print(" ", p, "->", icon_map.get(p) or ("wiki:" + en.get(p, "无英文名")))
