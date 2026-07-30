-- 模组汉化包模板 modmain.lua
-- 原理：与游戏官方/中文语言包模组相同的 LoadPOFile + TranslateStringTable 机制
_G = GLOBAL

-- 读取配置选择语言（支持 简体/繁體/自动）
local LANG = GetModConfigData("LANG") or "simplified"
local choose = {
    ["simplified"] = "chs",
    ["traditional"] = "cht",
}
local code = choose[LANG]
if not code then
    -- 自动：按玩家 Steam 客户端语言
    local sl = _G.TheNet and _G.TheNet.GetLanguageCode and _G.TheNet:GetLanguageCode()
    code = (sl == "schinese") and "chs" or (sl == "tchinese") and "cht" or "chs"
end

-- 加载本模组自带的翻译文件 DST_<code>.po（与 modmain.lua 同目录）
local pofile = "DST_" .. code .. ".po"
LoadPOFile(pofile, code)
print(string.format("[汉化包] 已加载翻译文件 %s", pofile))

-- 将翻译应用到全局字符串表（包括其他模组的字符串！）
_G.TranslateStringTable(_G.STRINGS)

-- =============================================================
-- 翻译文件写法（DST_chs.po）：
--   msgctxt "STRINGS.NAMES.TWISTER"
--   msgid "Twister"
--   msgstr "龙卷风"
--
-- 键名规则（msgctxt）与游戏一致：
--   STRINGS.NAMES.<物品/生物代码>            → 物品/生物名
--   STRINGS.RECIPE_DESC.<配方代码>           → 配方描述
--   STRINGS.CHARACTERS.GENERIC.DESCRIBE.X   → 检查物品台词
--   STRINGS.UI.XXX                          → 界面文本
-- 找键名方法：面板「mod设置」点模组看 modinfo，或直接搜模组 lua 里的 STRINGS. 引用
-- =============================================================
