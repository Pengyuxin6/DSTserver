# 模组汉化包制作指南（LoadPOFile 机制）

> 本模板演示饥荒联机版**官方同款**的汉化加载方式：模组自带 `.po` 翻译文件 + `LoadPOFile` + `TranslateStringTable`，与游戏内置简中（`scripts/languages/loc.lua` 加载 `chinese_s.po`）和中文语言包模组（367546858）是同一套机制。

## 快速开始

1. 复制本文件夹，重命名为 `workshop-任意名字`，放到服务器全局模组目录（本面板为 `/home/steam/dst_mods/`）
2. 编辑 `DST_chs.po`：按 `msgctxt / msgid / msgstr` 格式写翻译（见下方键名规则）
3. 面板「mod设置」勾选启用（玩家客户端也装一份效果更好）
4. 重启服务器/重进游戏生效

## 原理（来自游戏官方代码）

```lua
-- 游戏官方 loc.lua：语言切换时做的事
LanguageTranslator:LoadPOFile("scripts/languages/chinese_s.po", "zh")
TranslateStringTable(STRINGS)

-- 模组环境等价写法（本模板 modmain.lua）：
LoadPOFile("DST_chs.po", "chs")
GLOBAL.TranslateStringTable(GLOBAL.STRINGS)
```

`.po` 文件本质是 **英文原文(msgid) → 译文(msgstr)** 的映射表，`msgctxt` 是字符串在 STRINGS 表里的路径。

## 键名（msgctxt）规则

| 键 | 内容 | 示例 |
|----|------|------|
| `STRINGS.NAMES.<代码>` | 物品/生物/建筑名 | `STRINGS.NAMES.TWISTER` → 龙卷风 |
| `STRINGS.RECIPE_DESC.<代码>` | 配方描述 | `STRINGS.RECIPE_DESC.LANTERN` → 提灯 |
| `STRINGS.CHARACTERS.GENERIC.DESCRIBE.<代码>` | 威尔逊检查台词 | |
| `STRINGS.UI.SANDBOXMENU.<代码>` | 世界生成界面文本 | |
| `STRINGS.UI.CUSTOMIZATIONSCREEN.<代码>` | 世界自定义界面文本 | |

**找键名的方法**：直接 grep 模组源码里的 `STRINGS.` 引用；或者在面板「编辑世界 → 模组世界设置」看选项 key。

## 常见问题

- **为什么不生效？** 检查：模组已启用且**已重启**；po 文件 UTF-8 编码无 BOM；msgctxt 与 msgid 拼写完全一致（大小写敏感）
- **翻译别的模组？** 直接写目标模组的键即可——只要目标模组已加载（本汉化包放在它后面加载更佳）
- **繁体？** 复制 `DST_chs.po` 为 `DST_cht.po` 写繁体译文，mod 配置里选"繁體"
- **客户端也要装**：服务器加载影响服务器侧字符串，玩家各自安装则人人界面都是中文（不装也不影响进服）

## 参考实现

- 官方：`scripts/languages/loc.lua`（游戏内建语言系统）
- 中文语言包模组：创意工坊 367546858（本服务器已装，它就是最大的现成翻译库——很多模组不用自己翻）
