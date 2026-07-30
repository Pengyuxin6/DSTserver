-- 模组汉化包模板 modinfo.lua
-- 复制本文件夹改名为 workshop-你的模组名 即可开工
name = "模组汉化包模板"
description = "为其他模组提供中文翻译的语言包模板（LoadPOFile 机制）"
author = "pengyuxin"
version = "1.0"
api_version = 10
dst_compatible = true

-- 汉化包只需要在客户端和服务器各自加载即可，不要求其他玩家必须安装
client_only_mod = false
all_clients_require_mod = false
server_only_mod = false

icon_atlas = ""
icon = ""

-- 可选配置：语言（简/繁）
configuration_options =
{
    {
        name = "LANG",
        label = "语言 Language",
        hover = "选择加载的翻译语言",
        options =
        {
            { description = "简体", data = "simplified" },
            { description = "繁體", data = "traditional" },
            { description = "自动(按Steam语言)", data = "auto" },
        },
        default = "simplified",
    },
}
