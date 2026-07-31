// DST 专用服务器管理面板 —— Bun 单文件后端
// 运行: bun run src/server.ts  (监听 127.0.0.1:5322)
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, renameSync, statSync, lstatSync, symlinkSync, readlinkSync, unlinkSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { ITEMS } from "./items";
import { FOREST_OPTIONS, CAVE_OPTIONS } from "./worldgen";

// ---------- 路径常量 ----------
const HOME = "/home/steam";
const PANEL_DIR = join(HOME, "dst_panel");
const PUBLIC_DIR = join(PANEL_DIR, "public");
const PASSWORD_FILE = join(PANEL_DIR, ".panel_password");
const PANEL_CONFIG_FILE = join(PANEL_DIR, "panel_config.json");
const MOD_CACHE_FILE = join(PANEL_DIR, "mod_cache.json");
function readServerDirFromConfig(): string {
  try { const c = JSON.parse(readText(PANEL_CONFIG_FILE)); if (c.serverDir && typeof c.serverDir === "string") return c.serverDir; } catch {}
  return join(HOME, "dst_server");
}
const SERVER_DIR = readServerDirFromConfig();
const BIN_DIR = join(SERVER_DIR, "bin64");
const BIN = join(BIN_DIR, "dontstarve_dedicated_server_nullrenderer_x64");
const MODS_DIR = join(SERVER_DIR, "mods");
const SETUP_LUA = join(MODS_DIR, "dedicated_server_mods_setup.lua");
const DEFAULT_CLUSTER_ROOT = join(HOME, ".klei", "DoNotStarveTogether");
const DEFAULT_MODS_DIR = join(HOME, "dst_mods");
// 原版预设白名单：这些预设使用原版世界设置项，不是模组世界
const VANILLA_PRESETS = new Set(["", "SURVIVAL_TOGETHER", "DST_CAVE", "LAVAARENA", "QUAGMIRE"]);
// 存档根目录 / 模组存放目录可在面板「基本设置」修改（存 panelConfig）
function clusterRoot(): string { return panelConfig.clusterRoot || DEFAULT_CLUSTER_ROOT; }
function modsStoreDir(): string { return panelConfig.modsDir || DEFAULT_MODS_DIR; }
const STEAMCMD = join(HOME, "steamcmd", "steamcmd.sh");
const STEAMCMD_WORKSHOP = join(HOME, "steamcmd", "steamapps", "workshop", "content", "322330");
const PORT = 5323;

// ---------- 小工具 ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 系统资源检测：启动服务器前检查剩余内存和 CPU
function checkResources(): { ok: boolean; msg: string } {
  try {
    // 读取 /proc/meminfo 获取可用内存（单位 KB）
    const memText = readText("/proc/meminfo");
    const memAvail = /MemAvailable:\s+(\d+)/.exec(memText);
    const availMB = memAvail ? Math.floor(Number(memAvail[1]) / 1024) : 0;
    // 读取 /proc/loadavg 获取 CPU 负载
    const loadText = readText("/proc/loadavg");
    const load1 = parseFloat(loadText.split(/\s+/)[0]) || 0;
    const cpuCount = (require("node:os") as any).cpus ? (require("node:os").cpus().length || 4) : 4;
    const cpuPct = Math.round((load1 / cpuCount) * 100);
    if (availMB > 0 && availMB < 1024) {
      return { ok: false, msg: `剩余内存不足（可用: ${availMB}MB），建议关闭其他服务或释放内存后再启动` };
    }
    if (cpuPct > 90) {
      return { ok: false, msg: `CPU 负载过高（${cpuPct}%），建议等待负载降低后再启动` };
    }
    return { ok: true, msg: "" };
  } catch {
    return { ok: true, msg: "" }; // 读取失败时不阻止启动
  }
}

// 获取 DST 服务进程的内存占用（RSS MB）
function getDstProcessMemory(): number {
  try {
    const r = Bun.spawnSync(["pgrep", "-f", "dontstarve_dedicated_server_nullrenderer"], { stdout: "pipe" });
    let totalRSS = 0;
    for (const pid of new Response(r.stdout).text().trim().split("\n").filter(Boolean)) {
      const smaps = readText(`/proc/${pid}/smaps_rollup`);
      const rss = /Rss:\s+(\d+)/.exec(smaps);
      if (rss) totalRSS += Number(rss[1]);
    }
    return Math.round(totalRSS / 1024); // KB → MB
  } catch {
    return 0;
  }
}
// 获取系统内存信息（MB）
function getSystemMemory(): { total: number; avail: number; used: number } {
  try {
    const text = readText("/proc/meminfo");
    const total = /MemTotal:\s+(\d+)/.exec(text);
    const avail = /MemAvailable:\s+(\d+)/.exec(text);
    return { total: total ? Math.round(Number(total[1]) / 1024) : 0, avail: avail ? Math.round(Number(avail[1]) / 1024) : 0, used: 0 };
  } catch {
    return { total: 0, avail: 0, used: 0 };
  }
}

function json(data: any, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
function ok(data?: any, msg?: string) {
  return json({ ok: true, data, msg });
}
function fail(msg: string, status = 200) {
  return json({ ok: false, msg }, status);
}

async function run(cmd: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): Promise<{ code: number; out: string }> {
  try {
    const p = Bun.spawn(cmd, { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : undefined, stdout: "pipe", stderr: "pipe" });
    const timer = opts.timeoutMs
      ? setTimeout(() => { try { p.kill(); } catch {} }, opts.timeoutMs)
      : null;
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    if (timer) clearTimeout(timer);
    return { code, out: out + err };
  } catch (e: any) {
    return { code: -1, out: String(e?.message || e) };
  }
}

function readText(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

// ---------- 登录 / 会话 ----------
const PANEL_PASSWORD = readText(PASSWORD_FILE).trim();
if (!PANEL_PASSWORD) {
  console.error("无法读取面板密码文件: " + PASSWORD_FILE);
  process.exit(1);
}
const SECRET = createHmac("sha256", "dst-panel-secret").update(PANEL_PASSWORD).digest("hex");
// ---------- 登录挑战-响应（密码永不上网传输，防重放） ----------
const SALT_FILE = join(PANEL_DIR, ".panel_salt");
function sha256hex(s: string): string { return createHash("sha256").update(s, "utf-8").digest("hex"); }
let PANEL_SALT = readText(SALT_FILE).trim();
if (!/^[0-9a-f]{32}$/.test(PANEL_SALT)) {
  PANEL_SALT = randomBytes(16).toString("hex");
  writeFileSync(SALT_FILE, PANEL_SALT, { mode: 0o600 });
}
// storedHash = sha256(salt + password)，等价于"加盐哈希存储"；校验时用 nonce 再哈希一次
const STORED_HASH = sha256hex(PANEL_SALT + PANEL_PASSWORD);
const loginNonces = new Map<string, number>();
function issueNonce(): string {
  const now = Date.now();
  for (const [n, exp] of loginNonces) if (exp < now) loginNonces.delete(n);
  const nonce = randomBytes(16).toString("hex");
  loginNonces.set(nonce, now + 60_000);
  return nonce;
}
function takeNonce(nonce: string): boolean {
  const exp = loginNonces.get(nonce);
  loginNonces.delete(nonce); // 一次性，无论成败都作废
  return exp !== undefined && exp >= Date.now();
}
// 登录防爆破：同一 IP 连续失败 5 次锁定 5 分钟
const loginFails = new Map<string, { count: number; until: number }>();
function loginLocked(ip: string): boolean {
  const f = loginFails.get(ip);
  return !!f && f.count >= 5 && f.until > Date.now();
}
function loginFail(ip: string): void {
  const now = Date.now();
  let f = loginFails.get(ip);
  if (f && f.until > 0 && now > f.until + 10 * 60 * 1000) f = undefined; // 锁定过期 10 分钟后重新计数
  if (!f) f = { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = now + 5 * 60 * 1000;
  loginFails.set(ip, f);
}
function loginSuccess(ip: string): void { loginFails.delete(ip); }
const SESSION_TTL = 7 * 24 * 3600 * 1000;

// ---------- 访问令牌（所有请求必须携带并通过验证） ----------
const tokens = new Map<string, number>(); // token -> 过期时间
function issueToken(): string {
  const t = randomBytes(24).toString("hex");
  tokens.set(t, Date.now() + SESSION_TTL);
  return t;
}
function revokeToken(t: string): void { tokens.delete(t); }
function tokenFromReq(req: Request): string {
  const h = req.headers.get("authorization");
  if (h && h.startsWith("Bearer ")) return h.slice(7).trim();
  const x = req.headers.get("x-dst-token");
  if (x) return x.trim();
  const c = req.headers.get("cookie") || "";
  const m = c.match(/dstp_session=([0-9a-f]{48})/);
  if (m) return m[1];
  return new URL(req.url).searchParams.get("token") || "";
}
function checkAuth(req: Request): boolean {
  const tok = tokenFromReq(req);
  if (!tok) return false;
  const exp = tokens.get(tok);
  if (!exp || exp < Date.now()) return false;
  tokens.set(tok, Date.now() + SESSION_TTL); // 滑动续期：每次请求都重新计期
  return true;
}
function makeCookie(token: string): string {
  return `dstp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`;
}

// ---------- INI 解析/写回（保留未知 section/键与注释） ----------
type IniLine =
  | { kind: "section"; name: string; raw: string }
  | { kind: "kv"; key: string; value: string; raw: string }
  | { kind: "other"; raw: string };

function parseIni(text: string): IniLine[] {
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (/^\[.*\]$/.test(t)) return { kind: "section", name: t.slice(1, -1).trim(), raw: line };
    const m = line.match(/^\s*([^=;\s][^=]*?)\s*=\s*(.*)$/);
    if (m && !t.startsWith(";") && !t.startsWith("#")) return { kind: "kv", key: m[1].trim(), value: m[2].trim(), raw: line };
    return { kind: "other", raw: line };
  });
}
function iniGet(lines: IniLine[], section: string, key: string): string | null {
  let cur = "";
  for (const l of lines) {
    if (l.kind === "section") cur = l.name;
    else if (l.kind === "kv" && cur.toUpperCase() === section.toUpperCase() && l.key.toLowerCase() === key.toLowerCase()) return l.value;
  }
  return null;
}
function iniSet(lines: IniLine[], section: string, key: string, value: string): IniLine[] {
  let cur = "";
  let inSection = false;
  let lastKvIdx = -1;
  let sectionEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "section") {
      if (inSection && sectionEnd === -1) sectionEnd = i;
      cur = l.name;
      inSection = cur.toUpperCase() === section.toUpperCase();
      if (inSection) lastKvIdx = i;
    } else if (inSection) {
      if (l.kind === "kv") {
        if (l.key.toLowerCase() === key.toLowerCase()) {
          lines[i] = { kind: "kv", key: l.key, value, raw: `${l.key} = ${value}` };
          return lines;
        }
        lastKvIdx = i;
      }
    }
  }
  if (lastKvIdx >= 0) {
    lines.splice(lastKvIdx + 1, 0, { kind: "kv", key, value, raw: `${key} = ${value}` });
    return lines;
  }
  // section 不存在 -> 追加
  lines.push({ kind: "section", name: section, raw: `[${section}]` });
  lines.push({ kind: "kv", key, value, raw: `${key} = ${value}` });
  return lines;
}
function iniToText(lines: IniLine[]): string {
  return lines.map((l) => (l.kind === "kv" ? l.raw : l.raw)).join("\n");
}

// ---------- Lua 解析/序列化 ----------
function braceMatch(src: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  let strCh = "";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function unquoteLua(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

// 解析 lua 值（从 src[i] 开始），返回 [值, 结束下标]。table 解析为对象（数组项忽略）。
function parseLuaValue(src: string, i: number): [any, number] {
  while (i < src.length && /[\s,]/.test(src[i])) i++;
  const c = src[i];
  if (c === "{") {
    const end = braceMatch(src, i);
    if (end === -1) return [{}, src.length];
    return [parseLuaTable(src.slice(i + 1, end)), end + 1];
  }
  if (c === '"' || c === "'") {
    let j = i + 1;
    let out = "";
    while (j < src.length) {
      if (src[j] === "\\") { out += src[j + 1] ?? ""; j += 2; continue; }
      if (src[j] === c) break;
      out += src[j]; j++;
    }
    return [out, j + 1];
  }
  const m = /^[A-Za-z0-9_.+-]+/.exec(src.slice(i));
  if (m) {
    const tok = m[0];
    let v: any = tok;
    if (tok === "true") v = true;
    else if (tok === "false") v = false;
    else if (tok === "nil") v = null;
    else if (/^-?[\d.]+$/.test(tok)) v = Number(tok);
    return [v, i + tok.length];
  }
  return [null, i + 1];
}

function parseLuaTable(src: string): Record<string, any> {
  const out: Record<string, any> = {};
  let i = 0;
  while (i < src.length) {
    const kre = /(?:\[\s*"((?:[^"\\]|\\.)*)"\s*\]|([A-Za-z_][A-Za-z0-9_]*))\s*=\s*/y;
    kre.lastIndex = i;
    const km = kre.exec(src);
    if (km) {
      const key = km[1] !== undefined ? unquoteLua(km[1]) : km[2];
      const [val, ni] = parseLuaValue(src, kre.lastIndex);
      out[key] = val;
      i = ni;
    } else {
      // 数组项或分隔符，跳过一个值/字符
      const c = src[i];
      if (c === "{" ) {
        const end = braceMatch(src, i);
        i = end === -1 ? src.length : end + 1;
      } else if (c === '"' || c === "'") {
        const [, ni] = parseLuaValue(src, i);
        i = ni;
      } else {
        i++;
      }
    }
  }
  return out;
}

function luaEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
function luaKey(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `["${luaEscape(k)}"]`;
}
function luaVal(v: any): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `"${luaEscape(v)}"`;
  if (v && typeof v === "object") {
    const parts = Object.entries(v).map(([k, val]) => `${luaKey(k)} = ${luaVal(val)}`);
    return `{ ${parts.join(", ")} }`;
  }
  return "nil";
}

// ---------- 面板配置 ----------
interface PanelConfig {
  cluster: string;
  beta: boolean;
  betaBranch: string;
  mode: "online" | "offline";
  autorestart: boolean;
  announcements: string[];
  announceAuto: { enabled: boolean; intervalSec: number; idx: number; lastSent: number };
  itemHistory: string[];
  favorites: string[];
  serverDir: string;
  clusterRoot: string;
  modsDir: string;
  langCheck: boolean;
}
function loadPanelConfig(): PanelConfig {
  try {
    const c = JSON.parse(readText(PANEL_CONFIG_FILE));
    return {
      cluster: c.cluster || "MyDediServer",
      beta: !!c.beta,
      betaBranch: /^[A-Za-z0-9_-]{0,64}$/.test(String(c.betaBranch || "")) ? String(c.betaBranch || "") : "",
      mode: c.mode === "offline" ? "offline" : "online",
      autorestart: !!c.autorestart,
      announcements: Array.isArray(c.announcements) ? c.announcements.map(String) : [],
      announceAuto: {
        enabled: !!c.announceAuto?.enabled,
        intervalSec: Number(c.announceAuto?.intervalSec) || 300,
        idx: Number(c.announceAuto?.idx) || 0,
        lastSent: Number(c.announceAuto?.lastSent) || 0,
      },
      itemHistory: Array.isArray(c.itemHistory) ? c.itemHistory.map(String) : [],
      favorites: Array.isArray(c.favorites) ? c.favorites.map(String) : [],
      serverDir: typeof c.serverDir === "string" && c.serverDir ? c.serverDir : join(HOME, "dst_server"),
      clusterRoot: typeof c.clusterRoot === "string" && c.clusterRoot.startsWith("/") ? c.clusterRoot : DEFAULT_CLUSTER_ROOT,
      modsDir: typeof c.modsDir === "string" && c.modsDir.startsWith("/") ? c.modsDir : DEFAULT_MODS_DIR,
      langCheck: c.langCheck !== false,
    };
  } catch {
    return { cluster: "MyDediServer", beta: false, betaBranch: "", mode: "online", autorestart: false, announcements: [], announceAuto: { enabled: false, intervalSec: 300, idx: 0, lastSent: 0 }, itemHistory: [], favorites: [], serverDir: join(HOME, "dst_server"), clusterRoot: DEFAULT_CLUSTER_ROOT, modsDir: DEFAULT_MODS_DIR, langCheck: true };
  }
}
let panelConfig = loadPanelConfig();
function savePanelConfig() {
  writeFileSync(PANEL_CONFIG_FILE, JSON.stringify(panelConfig, null, 2));
}
function clusterDir(): string {
  return join(clusterRoot(), panelConfig.cluster);
}
function shardDir(shard: string): string {
  return join(clusterDir(), shard);
}

// ---------- 分片 ----------
interface ShardInfo {
  name: string;
  isMaster: boolean;
  port: string;
  running: boolean;
}
// 缓存 shard 列表（避免每次调用都扫描目录）
let shardListCache: ShardInfo[] | null = null;
function listShards(): ShardInfo[] {
  if (shardListCache) return shardListCache;
  const out: ShardInfo[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(clusterDir()); } catch { return out; }
  for (const e of entries) {
    const ini = join(clusterDir(), e, "server.ini");
    if (!existsSync(ini)) continue;
    const lines = parseIni(readText(ini));
    out.push({
      name: e,
      isMaster: iniGet(lines, "SHARD", "is_master") === "true",
      port: iniGet(lines, "NETWORK", "server_port") || "",
      running: false,
    });
  }
  shardListCache = out;
  return out;
}

// ---------- screen 控制 ----------
async function screenList(): Promise<string> {
  const r = await run(["screen", "-ls"]);
  return r.out;
}
async function shardRunning(shard: string): Promise<boolean> {
  const sess = shard.toLowerCase() === "master" ? "dst_master" : shard.toLowerCase() === "caves" ? "dst_caves" : `dst_${shard.toLowerCase()}`;
  const ls = await screenList();
  if (new RegExp(`\\.${sess}\\b`).test(ls)) return true;
  const pg = await run(["pgrep", "-f", `dontstarve_dedicated_server_nullrenderer.*-shard ${shard}`]);
  return pg.code === 0 && pg.out.trim().length > 0;
}
function screenSession(shard: string): string {
  return shard.toLowerCase() === "caves" ? "dst_caves" : "dst_master";
}
async function startShard(shard: string): Promise<string> {
  // 计算内存上限：系统总内存 - 1GB 预留
  const sysMem = getSystemMemory();
  const memLimitMB = sysMem.total > 1024 ? sysMem.total - 1024 : sysMem.total;
  // 自定义存档根目录参数
  const extraArgs: string[] = [];
  if (clusterRoot() !== DEFAULT_CLUSTER_ROOT) {
    const parent = clusterRoot().replace(/\/[^/]+$/, "") || "/";
    const conf = clusterRoot().split("/").pop()!;
    extraArgs.push("-persistent_storage_root", parent, "-conf_dir", conf);
  }
  if (panelConfig.mode === "offline") extraArgs.push("-offline");
  // 使用 systemd-run --scope 在独立 cgroup 中启动，通过 MemoryMax 硬性限制实际内存使用
  const screenCmd = `screen -dmS ${screenSession(shard)} ${BIN} -cluster ${panelConfig.cluster} -shard ${shard} ${extraArgs.join(" ")}`.trim();
  const sdArgs = memLimitMB > 0
    ? ["systemd-run", "--scope", `-p`, `MemoryMax=${memLimitMB}M`, `--unit=dst-${shard.toLowerCase()}`, "sh", "-c", screenCmd]
    : ["screen", "-dmS", screenSession(shard), BIN, "-cluster", panelConfig.cluster, "-shard", shard, ...extraArgs];
  const r = await run(sdArgs, { cwd: BIN_DIR });
  return r.code === 0 ? "ok" : r.out;
}
async function stopShard(shard: string): Promise<void> {
  await run(["screen", "-S", screenSession(shard), "-X", "quit"]);
  await run(["pkill", "-f", `dontstarve_dedicated_server_nullrenderer.*-shard ${shard}`]);
}
async function sendLua(shard: string, lua: string): Promise<boolean> {
  if (!(await shardRunning(shard))) return false;
  // 注意：screen -X stuff 会把反斜杠当转义符（\ooo 八进制等），因此命令里不能含反斜杠转义序列；
  // UTF-8 中文可直接传输（hardcopy 显示为乱码只是屏幕渲染，服务器端实际接收正确）。
  const clean = lua.replace(/\r/g, "").replace(/\n+/g, " ").slice(0, 4000);
  const r = await run(["screen", "-S", screenSession(shard), "-X", "stuff", clean + "\n"]);
  return r.code === 0;
}
async function hardcopy(shard: string): Promise<string> {
  const file = `/tmp/dst_dump_${screenSession(shard)}.txt`;
  await run(["screen", "-S", screenSession(shard), "-X", "hardcopy", "-h", file]);
  await sleep(200);
  return readText(file);
}
// 发送标记 + 命令，然后读取 server_log.txt 中标记之后的输出（游戏直接写日志，UTF-8 无乱码无折行）。
// 注意：标记/数据前缀都用字符串拼接写出（"DSTPANEL".."_".."BEGIN:..."），
// 这样日志里 RemoteCommandInput 回显的命令文本不会出现完整字面量，只有 print 的真实输出会被匹配到。
async function execAndCapture(shard: string, lua: string): Promise<string> {
  const rand = Math.random().toString(36).slice(2, 10);
  if (!(await sendLua(shard, `print("DSTPANEL".."_".."BEGIN:${rand}")`))) return "";
  await sleep(500);
  await sendLua(shard, lua);
  await sleep(1500);
  const text = readText(join(shardDir(shard), "server_log.txt"));
  const idx = text.lastIndexOf(`DSTPANEL_BEGIN:${rand}`);
  return idx === -1 ? "" : text.slice(idx);
}

// ---------- worldgenoverride.lua ----------
// 注意：面板使用 worldgenoverride.lua（用户格式），不使用 leveldataoverride.lua（完整关卡定义格式）。
// leveldataoverride.lua 要求 id/name/desc/location 等字段，面板写入的 worldgenoverride 格式会导致
// "Level data override is invalid!" 断言失败。专用服务器通过 worldgenoverride.lua 即可正确应用预设。
function readLevelOverrides(shard: string): { overrides: Record<string, string>; presets: { worldgen: string; settings: string }; raw: string } {
  const file = join(shardDir(shard), "worldgenoverride.lua");
  const text = readText(file);
  const presets = {
    worldgen: (/worldgen_preset\s*=\s*"([^"]+)"/.exec(text) || [])[1] || "",
    settings: (/settings_preset\s*=\s*"([^"]+)"/.exec(text) || [])[1] || "",
  };
  if (!text) return { overrides: {}, presets, raw: "" };
  let overrides: Record<string, string> = {};
  const m = /overrides\s*=\s*\{/.exec(text);
  if (m) {
    const openIdx = m.index + m[0].length - 1;
    const end = braceMatch(text, openIdx);
    if (end !== -1) {
      const tbl = parseLuaTable(text.slice(openIdx + 1, end));
      for (const [k, v] of Object.entries(tbl)) overrides[k] = String(v);
    }
  }
  return { overrides, presets, raw: text };
}
function writeLevelOverrides(shard: string, isMaster: boolean, overrides: Record<string, string>, preset?: string | { worldgen?: string; settings?: string }): void {
  const existing = readLevelOverrides(shard).presets;
  let wg = existing.worldgen || (isMaster ? "SURVIVAL_TOGETHER" : "DST_CAVE");
  let st = existing.settings || wg;
  if (typeof preset === "string") { wg = preset; st = preset; }
  else if (preset) {
    if (preset.worldgen) wg = preset.worldgen;
    if (preset.settings) st = preset.settings;
  }
  const lines = Object.entries(overrides)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `    ${luaKey(k)} = ${luaVal(v)},`);
  const text = `return {\n  override_enabled = true,\n  worldgen_preset = "${wg}",\n  settings_preset = "${st}",\n  overrides = {\n${lines.join("\n")}\n  },\n}\n`;
  writeFileSync(join(shardDir(shard), "worldgenoverride.lua"), text);
  // 删除可能残留的旧格式 leveldataoverride.lua，避免游戏校验失败
  try { unlinkSync(join(shardDir(shard), "leveldataoverride.lua")); } catch {}
}

// ---------- modoverrides.lua ----------
interface ModOverrideEntry {
  enabled: boolean;
  options: Record<string, any>;
}
function parseModOverrides(text: string): Map<string, ModOverrideEntry> {
  const out = new Map<string, ModOverrideEntry>();
  const re = /\[\s*"(workshop-\d+)"\s*\]\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const openIdx = m.index + m[0].length - 1;
    const end = braceMatch(text, openIdx);
    if (end === -1) continue;
    const block = text.slice(openIdx + 1, end);
    const tbl = parseLuaTable(block);
    const opts = (tbl["configuration_options"] && typeof tbl["configuration_options"] === "object") ? tbl["configuration_options"] : {};
    out.set(m[1], { enabled: tbl["enabled"] === true, options: opts });
    re.lastIndex = end + 1;
  }
  return out;
}
// 缓存 modoverrides 解析结果（避免重复读文件）
const modOverridesCache = new Map<string, { time: number; data: Map<string, ModOverrideEntry> }>();
function readModOverrides(shard: string): Map<string, ModOverrideEntry> {
  const cached = modOverridesCache.get(shard);
  const file = join(shardDir(shard), "modoverrides.lua");
  const mtime = existsSync(file) ? statSync(file).mtimeMs : 0;
  if (cached && cached.time === mtime) return cached.data;
  const data = parseModOverrides(readText(file));
  modOverridesCache.set(shard, { time: mtime, data });
  return data;
}
function serializeModOverrides(map: Map<string, ModOverrideEntry>): string {
  const parts: string[] = [];
  // 语言包类模组（含 DST_chs.po 的）固定最后加载（覆盖其他模组的字符串）
  const isLangPack = (wsId: string) => existsSync(join(ugcSharedDir(), wsId.replace("workshop-", ""), "DST_chs.po"));
  const sorted = [...map.entries()].sort(([a], [b]) => {
    const la = isLangPack(a) ? 1 : 0, lb = isLangPack(b) ? 1 : 0;
    return la - lb || a.localeCompare(b);
  });
  for (const [id, e] of sorted) {
    const optLines = Object.entries(e.options).map(([k, v]) => `      ${luaKey(k)} = ${luaVal(v)},`);
    parts.push(
      `  ["${id}"] = {\n    configuration_options = {\n${optLines.join("\n")}\n    },\n    enabled = ${e.enabled},\n  },`
    );
  }
  return `return {\n${parts.join("\n")}\n}\n`;
}
function writeModOverridesBoth(map: Map<string, ModOverrideEntry>): void {
  const text = serializeModOverrides(map);
  for (const shard of listShards()) {
    const d = shardDir(shard.name);
    if (existsSync(d)) writeFileSync(join(d, "modoverrides.lua"), text);
  }
}

// ---------- dedicated_server_mods_setup.lua ----------
function readSetupIds(): string[] {
  const text = readText(SETUP_LUA);
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("--")) continue;
    const m = line.match(/ServerModSetup\("(\d+)"\)/);
    if (m) ids.push(m[1]);
  }
  return ids;
}
function writeSetupIds(ids: string[]): void {
  const text = readText(SETUP_LUA);
  const keep: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("--")) { keep.push(line); continue; }
    if (/ServerMod(Collection)?Setup\(/.test(line)) continue; // 由面板重新生成
    if (t === "") continue;
    keep.push(line);
  }
  // 语言包类模组（含 DST_chs.po 的）固定最后加载，使其能覆盖其他模组的字符串
  const isLangPack = (id: string) => existsSync(join(ugcSharedDir(), id, "DST_chs.po"));
  const body = [...ids].sort((a, b) => Number(isLangPack(a)) - Number(isLangPack(b))).map((id) => `ServerModSetup("${id}")`).join("\n");
  writeFileSync(SETUP_LUA, keep.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "") + "\n\n" + body + "\n");
}

// ---------- modinfo.lua 解析 ----------
interface ModConfigOption {
  name: string;
  label: string;
  hover: string;
  default: any;
  options: { description: string; data: any }[];
}
interface ModInfo {
  name: string;
  version: string;
  clientOnly: boolean;
  allClientsRequire: boolean;
  dstCompatible: boolean | null;
  configOptions: ModConfigOption[];
}
function luaStrField(src: string, key: string): string {
  const m = new RegExp(`${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(src);
  return m ? unquoteLua(m[1]) : "";
}
// 提取配置项的显示文本：支持 en_zh("en","zh") / en_zh_zht("en","zh","zht") / isCh and "zh" or "en" / L and "en" or "zh" / 普通字符串
function luaLabelField(src: string, key: string): string {
  // en_zh_zht("en","zh","zht") — 三参数版，取第二个参数（简中）
  const re3 = new RegExp(`${key}\\s*=\\s*en_zh_zht\\s*\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*,\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*(?:,\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*)?\\)`);
  const m3 = re3.exec(src);
  if (m3) return unquoteLua(m3[2]); // en_zh_zht 取简中部分
  // en_zh("en","zh") — 两参数版，取第二个参数（中文）
  const re = new RegExp(`${key}\\s*=\\s*en_zh\\s*\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*,\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)`);
  const m1 = re.exec(src);
  if (m1) return unquoteLua(m1[2]);
  // isCh and "中文" or "英文" — isCh 为 true 时是中文
  const m2 = new RegExp(`${key}\\s*=\\s*isCh\\s+and\\s*"((?:[^"\\\\]|\\\\.)*)"\\s+or\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(src);
  if (m2) return unquoteLua(m2[1]);
  // L and "英文" or "中文" — L 为 true 时是英文（locale ~= "zh"），取 or 后面的中文
  const m4 = new RegExp(`${key}\\s*=\\s*[\\w.]+\\s+and\\s*"((?:[^"\\\\]|\\\\.)*)"\\s+or\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(src);
  if (m4) return unquoteLua(m4[2]);
  return luaStrField(src, key);
}
function luaBoolField(src: string, key: string): boolean | null {
  const m = new RegExp(`${key}\\s*=\\s*(true|false)`).exec(src);
  return m ? m[1] === "true" : null;
}
// 模组统一存储：所有模组集中放在全局独立文件夹 /home/steam/dst_mods/<id>/（一模组一子文件夹，
// 不绑定任何存档）。各存档各分片的 ugc_mods/<存档>/<分片>/content/322330 用符号链接指向它。
// 启用/配置才按存档走（各存档 Master/Caves 的 modoverrides.lua）。下载也只下到全局目录一次。
// 旧版位置 mods/workshop-<id> 仍兼容读取（服务端启动时会自动迁移走）。
function ugcSharedDir(): string {
  return modsStoreDir();
}
// 建立统一布局：全局目录 + 所有存档各分片 content/322330 符号链接；
// 已存在的分片目录/旧的按存档 shared 目录，内容先搬进全局目录再替换为符号链接
function ensureUgcLayout(): void {
  try {
    const g = ugcSharedDir();
    mkdirSync(g, { recursive: true });
    const ugcRoot = join(SERVER_DIR, "ugc_mods");
    if (!existsSync(ugcRoot)) return;
    for (const cluster of readdirSync(ugcRoot)) {
      const croot = join(ugcRoot, cluster);
      if (!statSync(croot).isDirectory()) continue;
      const candidates: string[] = [];
      for (const entry of readdirSync(croot)) {
        if (entry === "shared") {
          // 旧布局：ugc_mods/<存档>/shared/322330（真实目录）
          const p = join(croot, entry, "322330");
          if (existsSync(p)) candidates.push(p);
        } else {
          candidates.push(join(croot, entry, "content", "322330"));
        }
      }
      for (const link of candidates) {
        const parent = dirname2(link);
        if (!existsSync(parent)) continue;
        if (!existsSync(link)) { try { symlinkSync(g, link, "dir"); } catch {} continue; }
        const st = lstatSync(link);
        if (st.isSymbolicLink()) {
          // 指向旧位置的符号链接 → 重新指向全局目录
          try { if (readlinkSync(link) !== g) { rmSync(link, { force: true }); symlinkSync(g, link, "dir"); } } catch {}
          continue;
        }
        if (st.isDirectory()) {
          for (const id of readdirSync(link)) {
            const from = join(link, id), to = join(g, id);
            if (!existsSync(to)) { try { renameSync(from, to); } catch {} }
          }
          rmSync(link, { recursive: true, force: true });
          try { symlinkSync(g, link, "dir"); } catch {}
        }
      }
      // 清理旧的 shared 空壳目录
      const oldShared = join(croot, "shared");
      try {
        if (existsSync(oldShared) && readdirSync(oldShared).length === 0) rmSync(oldShared, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}
function dirname2(p: string): string {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "/";
}
function ugcContentDirs(): string[] {
  const dirs: string[] = [];
  const shared = ugcSharedDir();
  if (existsSync(shared) && statSync(shared).isDirectory()) dirs.push(shared);
  return dirs;
}
function modInfoPath(id: string): string | null {
  for (const c of ugcContentDirs()) {
    const p = join(c, id, "modinfo.lua");
    if (existsSync(p)) return p;
  }
  const p = join(MODS_DIR, `workshop-${id}`, "modinfo.lua");
  return existsSync(p) ? p : null;
}
function parseModInfo(id: string): ModInfo | null {
  const file = modInfoPath(id);
  if (!file) return null;
  const text = readText(file);
  const info: ModInfo = {
    name: luaStrField(text, "name"),
    version: luaStrField(text, "version"),
    clientOnly: luaBoolField(text, "client_only_mod") === true,
    allClientsRequire: luaBoolField(text, "all_clients_require_mod") === true,
    dstCompatible: luaBoolField(text, "dst_compatible"),
    configOptions: [],
  };
  // 兼容 configuration_options = { / = X and { / =\n{ 等写法
  // 处理 X and {...} or {...} 模式：需要判断哪个块是中文
  let configBody = "";
  const ternaryHead = /configuration_options\s*=\s*([\w.]+)\s+and\s*\{/.exec(text);
  if (ternaryHead) {
    const varName = ternaryHead[1];
    const andOpen = ternaryHead.index + ternaryHead[0].length - 1;
    const andEnd = braceMatch(text, andOpen);
    if (andEnd !== -1) {
      // 检查后面是否跟着 or {
      const restAfterAnd = text.slice(andEnd + 1);
      const trimmedRest = restAfterAnd.trimStart();
      if (/^or\s*\{/.test(trimmedRest)) {
        const orKwIdx = text.indexOf("or", andEnd + 1);
        const orBraceIdx = text.indexOf("{", orKwIdx);
        const orEnd = braceMatch(text, orBraceIdx);
        if (orEnd !== -1) {
          const orBody = text.slice(orBraceIdx + 1, orEnd);
          const andBody = text.slice(andOpen + 1, andEnd);
          // 智能选择中文块：
          // isCh / locale == "zh" → 变量为 true 时是中文 → and 块是中文
          // L / locale ~= "zh" → 变量为 true 时是英文 → or 块是中文
          const varDefRe = new RegExp(`(?:local\\s+)?${varName}\\s*=\\s*([^\\n\\r]+)`);
          const varDef = varDefRe.exec(text);
          const isChVar = varDef ? /==\s*["']zh|isCh|isch/i.test(varDef[1]) : /isCh/i.test(varName);
          configBody = isChVar ? andBody : (orBody.trim() !== "" ? orBody : andBody);
        }
      } else {
        configBody = text.slice(andOpen + 1, andEnd);
      }
    }
  } else {
    const cm = /configuration_options\s*=\s*(?:[\w.]+\s+and\s+)?\{/.exec(text);
    if (cm) {
      const openIdx = cm.index + cm[0].length - 1;
      const end = braceMatch(text, openIdx);
      if (end !== -1) configBody = text.slice(openIdx + 1, end);
    }
  }
  if (configBody) {
    const body = configBody;
    // 逐项（顶层 {...} 块）解析
    let i = 0;
    while (i < body.length) {
        const ob = body.indexOf("{", i);
        if (ob === -1) break;
        const oe = braceMatch(body, ob);
        if (oe === -1) break;
        const item = body.slice(ob + 1, oe);
        const opt: ModConfigOption = {
          name: luaStrField(item, "name"),
          label: luaLabelField(item, "label") || luaStrField(item, "name"),
          hover: luaLabelField(item, "hover"),
          default: null,
          options: [],
        };
        const dm = /default\s*=\s*/.exec(item);
        if (dm) { const [v] = parseLuaValue(item, dm.index + dm[0].length); opt.default = v; }
        const om = /options\s*=\s*\{/.exec(item);
        if (om) {
          const oOpen = om.index + om[0].length - 1;
          const oEnd = braceMatch(item, oOpen);
          if (oEnd !== -1) {
            const oBody = item.slice(oOpen + 1, oEnd);
            let j = 0;
            while (j < oBody.length) {
              const p = oBody.indexOf("{", j);
              if (p === -1) break;
              const q = braceMatch(oBody, p);
              if (q === -1) break;
              const ob2 = oBody.slice(p + 1, q);
              const description = luaLabelField(ob2, "description");
              const dkm = /data\s*=\s*/.exec(ob2);
              let data: any = description;
              if (dkm) { const [v] = parseLuaValue(ob2, dkm.index + dkm[0].length); data = v; }
              opt.options.push({ description, data });
              j = q + 1;
            }
          }
        }
        if (opt.name) info.configOptions.push(opt);
      i = oe + 1;
    }
  }
  return info;
}

// 物品图标图集映射（inventoryimages1-4.xml → 元素名 → 图集目录名）
let itemIconMap: Map<string, string> | null = null;
function itemIconAtlas(): Map<string, string> {
  if (itemIconMap) return itemIconMap;
  const map = new Map<string, string>();
  const dir = join(PANEL_DIR, "data", "invicons");
  try {
    for (const f of readdirSync(dir)) {
      const m = /^inventoryimages(\d+)\.xml$/.exec(f);
      if (!m) continue;
      const atlas = "inventoryimages" + m[1];
      for (const mm of readText(join(dir, f)).matchAll(/<Element name="([^"]+)\.tex"/g)) {
        if (!map.has(mm[1])) map.set(mm[1], atlas);
      }
    }
  } catch {}
  itemIconMap = map;
  return map;
}
// ---------- KTEX → PNG 解码器（DXT1/DXT5） ----------
// 用于动态提取模组物品图标（.tex → PNG）
function decodeKTEX(buf: Buffer): { width: number; height: number; png: Buffer } | null {
  if (buf.length < 18) return null;
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x5845544B) return null; // "KTEX"
  const flags = buf.readUInt32LE(4);
  const fmt = (flags >> 4) & 0xF; // 0=DXT1, 2=DXT5, 4=RGBA
  // 解析 mip 级别描述符（stride=10 字节：w(2)+h(2)+pitch(2)+size(2)+pad(2)）
  const mip0W = buf.readUInt16LE(8);
  const mip0H = buf.readUInt16LE(10);
  let mip0Size = buf.readUInt16LE(14);
  if (mip0W === 0 || mip0H === 0 || mip0W > 4096 || mip0H > 4096) return null;
  // mip0Size 可能为 0（某些 KTEX 格式），按 DXT 块大小自动计算
  if (mip0Size === 0) {
    const blocks = Math.ceil(mip0W / 4) * Math.ceil(mip0H / 4);
    mip0Size = (fmt === 0 ? 8 : 16) * blocks; // DXT1=8 bytes/block, DXT5=16 bytes/block
  }
  // 数 mip 级别数来计算 data 偏移（验证每级尺寸合理：≤上级且为正）
  let dataOffset = 8;
  let prevW = mip0W;
  for (let off = 8; off + 10 <= buf.length; off += 10) {
    const w = buf.readUInt16LE(off);
    const h = buf.readUInt16LE(off + 2);
    if (w === 0 || h === 0) break;
    // 验证：宽度高度必须是合理的（≤前一级，>0）
    if (off > 8 && w > prevW) break; // 尺寸必须递减
    prevW = w;
    dataOffset = off + 10;
  }
  if (dataOffset + mip0Size > buf.length) return null;
  const pixelData = buf.subarray(dataOffset, dataOffset + mip0Size);
  let rgba: Buffer;
  if (fmt === 0) {
    rgba = decodeDXT1(pixelData, mip0W, mip0H);
  } else {
    rgba = decodeDXT5(pixelData, mip0W, mip0H);
  }
  if (!rgba) return null;
  const png = encodePNG(rgba, mip0W, mip0H);
  return { width: mip0W, height: mip0H, png };
}
function decodeDXT1(data: Buffer, width: number, height: number): Buffer {
  return decodeDXT(data, width, height, false);
}
function decodeDXT5(data: Buffer, width: number, height: number): Buffer {
  return decodeDXT(data, width, height, true);
}
function decodeDXT(data: Buffer, width: number, height: number, dxt5: boolean): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  const blockSize = dxt5 ? 16 : 8;
  const colorOffset = dxt5 ? 8 : 0;
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const bo = (by * blocksX + bx) * blockSize;
      if (bo + blockSize > data.length) continue;
      let alphas: number[] = [];
      if (dxt5) {
        const a0 = data[bo], a1 = data[bo + 1];
        const aBits = data.readUInt32LE(bo + 2);
        alphas = [a0, a1];
        if (a0 > a1) { for (let i = 0; i < 6; i++) alphas.push(Math.floor(((6 - i) * a0 + (i + 1) * a1) / 7)); }
        else { alphas.push(Math.floor((2 * a0 + a1) / 3), Math.floor((a0 + 2 * a1) / 3), 0, 255, 0, 0); }
        // 修正 alpha 索引
        alphas[6] = a0 > a1 ? Math.floor((1 * a0 + 6 * a1) / 7) : 0;
        alphas[7] = a0 > a1 ? Math.floor((0 * a0 + 7 * a1) / 7) : 255;
      }
      const c0 = data.readUInt16LE(bo + colorOffset);
      const c1 = data.readUInt16LE(bo + colorOffset + 2);
      const cBits = data.readUInt32LE(bo + colorOffset + 4);
      const c565 = (c: number) => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];
      const [r0, g0, b0] = c565(c0), [r1, g1, b1] = c565(c1);
      const colors: number[][] = [[r0, g0, b0], [r1, g1, b1]];
      if (c0 > c1) {
        colors.push([Math.floor((2 * r0 + r1) / 3), Math.floor((2 * g0 + g1) / 3), Math.floor((2 * b0 + b1) / 3)]);
        colors.push([Math.floor((r0 + 2 * r1) / 3), Math.floor((g0 + 2 * g1) / 3), Math.floor((b0 + 2 * b1) / 3)]);
      } else {
        colors.push([Math.floor((r0 + r1) / 2), Math.floor((g0 + g1) / 2), Math.floor((b0 + b1) / 2)]);
        colors.push([0, 0, 0]);
      }
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const yi = by * 4 + py, xi = bx * 4 + px;
          if (yi >= height || xi >= width) continue;
          const ci = (cBits >> ((py * 4 + px) * 4)) & 3;
          const [r, g, b] = colors[ci];
          const a = dxt5 ? alphas[(data.readUInt32LE(bo + 2) >> ((py * 4 + px) * 3)) & 7] : 255;
          const o = (yi * width + xi) * 4;
          rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
        }
      }
    }
  }
  return rgba;
}
function encodePNG(rgba: Buffer, width: number, height: number): Buffer {
  const { deflateSync } = require("node:zlib");
  const crc32Table: number[] = [];
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc32Table.push(c); }
  const crc32 = (buf: Buffer) => { let c = 0xFFFFFFFF; for (const b of buf) c = crc32Table[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
    return Buffer.concat([len, td, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
// 根据 UV 坐标裁剪已解码的 KTEX 图像并输出 PNG
// DXT 解码器输出自上而下的 RGBA（与 PNG 一致），UV 坐标直接使用
function cropPNG(decoded: { width: number; height: number; png: Buffer }, u1: number, u2: number, v1: number, v2: number): Buffer {
  const cropX = Math.round(u1 * decoded.width);
  const cropW = Math.round((u2 - u1) * decoded.width);
  const cropY = Math.round(v1 * decoded.height);
  const cropH = Math.round((v2 - v1) * decoded.height);
  if (cropW <= 0 || cropH <= 0 || cropX < 0 || cropY < 0) return decoded.png;
  // 从 PNG 解码回 RGBA（简单方式：直接重新解码 KTEX→RGBA 再裁剪）
  // 更高效：直接从 decodeKTEX 返回 rgba，但当前结构返回 png
  // 这里重新解码太浪费，改为：让 decodeKTEX 也返回 rgba
  // 临时方案：解码 PNG
  try {
    const { inflateSync } = require("node:zlib");
    const png = decoded.png;
    // 解析 PNG 获取 IHDR 和 IDAT
    let offset = 8; // skip signature
    let imgW = 0, imgH = 0, colorType = 0;
    const idatChunks: Buffer[] = [];
    while (offset < png.length) {
      const len = png.readUInt32BE(offset);
      const type = png.subarray(offset + 4, offset + 8).toString("ascii");
      const data = png.subarray(offset + 8, offset + 8 + len);
      if (type === "IHDR") {
        imgW = data.readUInt32BE(0);
        imgH = data.readUInt32BE(4);
        colorType = data[9];
      } else if (type === "IDAT") {
        idatChunks.push(data);
      } else if (type === "IEND") break;
      offset += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idatChunks));
    const bpp = 4; // RGBA
    const stride = imgW * bpp + 1;
    const cropped = Buffer.alloc(cropW * cropH * bpp);
    for (let y = 0; y < cropH; y++) {
      const srcRow = (cropY + y) * stride + 1; // +1 skip filter byte
      const dstRow = y * cropW * bpp;
      for (let x = 0; x < cropW; x++) {
        raw.copy(cropped, dstRow + x * bpp, srcRow + (cropX + x) * bpp, srcRow + (cropX + x) * bpp + bpp);
      }
    }
    return encodePNG(cropped, cropW, cropH);
  } catch {
    return decoded.png;
  }
}
// PNG 缓存（避免重复解码同一个 .tex 文件）
const modIconPngCache = new Map<string, Buffer>();
// 查找模组物品图标：返回 .tex 路径 + UV 坐标（支持图集切片）
// 使用每个模组的缓存索引，避免每次请求都递归搜索文件
const modAtlasCache = new Map<string, Map<string, { texPath: string; u1: number; u2: number; v1: number; v2: number }>>();
function buildModAtlasIndex(id: string): Map<string, { texPath: string; u1: number; u2: number; v1: number; v2: number }> {
  if (modAtlasCache.has(id)) return modAtlasCache.get(id)!;
  const index = new Map<string, { texPath: string; u1: number; u2: number; v1: number; v2: number; elementCount: number }>();
  const modDir = join(ugcSharedDir(), id);
  const imgDir = join(modDir, "images");
  try {
    if (existsSync(imgDir)) {
      // 一次性扫描所有 .tex 和 .xml 文件
      const scan = (dir: string, depth: number) => {
        if (depth > 3) return;
        let entries: string[];
        try { entries = readdirSync(dir); } catch { return; }
        // 独立 .tex 文件
        for (const f of entries) {
          if (f.endsWith(".tex")) {
            const prefabName = f.slice(0, -4);
            const texPath = join(dir, f);
            const xmlPath = join(dir, f.replace(/\.tex$/, ".xml"));
            let uv = { u1: 0, u2: 1, v1: 0, v2: 1 };
            let elementCount = 1;
            if (existsSync(xmlPath)) {
              const parsed = parseAtlasUV(readText(xmlPath), f);
              if (parsed) uv = parsed;
            }
            // 独立图标优先级最高（elementCount=1）
            if (!index.has(prefabName) || index.get(prefabName)!.elementCount > 1) {
              index.set(prefabName, { texPath, ...uv, elementCount });
            }
          }
        }
        // 图集 .xml 文件
        for (const f of entries) {
          if (!f.endsWith(".xml")) continue;
          const xmlPath = join(dir, f);
          const xmlText = readText(xmlPath);
          const texMatch = xmlText.match(/<Texture\s+filename="([^"]+)"/);
          if (!texMatch) continue;
          const texPath = join(dir, texMatch[1]);
          if (!existsSync(texPath)) continue;
          const elementCount = (xmlText.match(/<Element/g) || []).length;
          // 解析所有 Element
          for (const em of xmlText.matchAll(/<Element\s+name="([^"]+)"\s+u1="([\d.]+)"\s+u2="([\d.]+)"\s+v1="([\d.]+)"\s+v2="([\d.]+)"/g)) {
            const elemName = em[1].replace(/\.tex$/, "");
            const existing = index.get(elemName);
            // 优先选择元素数少的图集（专用 > 通用）
            if (!existing || existing.elementCount > elementCount) {
              index.set(elemName, { texPath, u1: parseFloat(em[2]), u2: parseFloat(em[3]), v1: parseFloat(em[4]), v2: parseFloat(em[5]), elementCount });
            }
          }
        }
        // 递归子目录
        for (const f of entries) {
          const fp = join(dir, f);
          try { if (statSync(fp).isDirectory()) scan(fp, depth + 1); } catch {}
        }
      };
      scan(imgDir, 0);
    }
  } catch {}
  // 清理 elementCount（只用于排序）
  const clean = new Map<string, { texPath: string; u1: number; u2: number; v1: number; v2: number }>();
  for (const [k, v] of index) clean.set(k, { texPath: v.texPath, u1: v.u1, u2: v.u2, v1: v.v1, v2: v.v2 });
  modAtlasCache.set(id, clean);
  return clean;
}
function findModIcon(id: string, prefab: string): { texPath: string; u1: number; u2: number; v1: number; v2: number } | null {
  return buildModAtlasIndex(id).get(prefab) || null;
}

// 从图集 XML 中解析指定元素的 UV 坐标
function parseAtlasUV(xml: string, elementName: string): { u1: number; u2: number; v1: number; v2: number } | null {
  // Element name 可以是 "xxx.tex" 或 "xxx"
  const patterns = [
    new RegExp(`<Element\\s+name="${elementName.replace(/\./g, "\\.")}"\\s+u1="([\\d.]+)"\\s+u2="([\\d.]+)"\\s+v1="([\\d.]+)"\\s+v2="([\\d.]+)"`),
    new RegExp(`<Element\\s+name="${elementName.replace(/\\.tex$/, "").replace(/\./g, "\\.")}"\\s+u1="([\\d.]+)"\\s+u2="([\\d.]+)"\\s+v1="([\\d.]+)"\\s+v2="([\\d.]+)"`),
  ];
  for (const re of patterns) {
    const m = re.exec(xml);
    if (m) return { u1: parseFloat(m[1]), u2: parseFloat(m[2]), v1: parseFloat(m[3]), v2: parseFloat(m[4]) };
  }
  return null;
}

// ---------- 模组新增物品扫描 ----------
let vanillaPrefabSet: Set<string> | null = null;
function vanillaPrefabs(): Set<string> {
  if (!vanillaPrefabSet) {
    try { vanillaPrefabSet = new Set(JSON.parse(readText(join(PANEL_DIR, "data", "vanilla_prefabs.json"))) as string[]); }
    catch { vanillaPrefabSet = new Set(); }
  }
  return vanillaPrefabSet;
}
const modItemsCache = new Map<string, { name: string; prefab: string; cat: string }[]>();
function modItems(id: string): { name: string; prefab: string; cat: string }[] {
  if (modItemsCache.has(id)) return modItemsCache.get(id)!;
  const out: { name: string; prefab: string; cat: string }[] = [];
  const seen = new Set<string>();
  const dir = join(ugcSharedDir(), id, "scripts", "prefabs");
  const resolveName = (prefab: string): string => {
    const upper = prefab.toUpperCase();
    let name = chsNames().get("STRINGS.NAMES." + upper) || "";
    if (!name) {
      const en = modStringLookup(id, upper, "NAMES");
      name = en ? (chinesePo().get(en) || en) : "";
    }
    return name;
  };
  try {
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".lua")) continue;
        const lua = readText(join(dir, f));
        // 从 lua 内容中提取所有 Prefab("xxx", ...) 定义的实际 prefab 名
        // 支持：Prefab("name"), Prefab("path/to/name"), Prefab("common/inventory/alloy")
        const prefabNames = new Set<string>();
        for (const m of lua.matchAll(/Prefab\s*\(\s*"([^"]+)"/g)) {
          // 路径式名称只取最后一段：common/inventory/alloy → alloy
          const fullName = m[1];
          const parts = fullName.split("/");
          const name = parts[parts.length - 1];
          if (/^[a-z0-9_]+$/.test(name)) prefabNames.add(name);
        }
        // 如果没有找到 Prefab() 调用，回退到文件名
        if (prefabNames.size === 0) {
          const fn = f.slice(0, -4);
          if (!vanillaPrefabs().has(fn)) prefabNames.add(fn);
        }
        for (const prefab of prefabNames) {
          if (seen.has(prefab) || vanillaPrefabs().has(prefab)) continue;
          // 只保留有 inventoryitem 的物品（过滤掉特效/建筑等纯实体）
          // 检查：lua 文件引用了 inventoryitem，或有对应的 .tex 图标文件
          const hasInvItem = lua.includes('"inventoryitem"') || lua.includes("components.inventoryitem") || lua.includes("InventoryItem");
          const hasIcon = findModIcon(id, prefab) !== null;
          if (!hasInvItem && !hasIcon) continue;
          const name = resolveName(prefab) || prefab;
          seen.add(prefab);
          out.push({ name, prefab, cat: "模组物品" });
        }
      }
    }
  } catch {}
  modItemsCache.set(id, out);
  return out;
}

interface ModWorldgenOption { key: string; label: string; group: string; world: string; default: string; values: { v: string; label: string }[]; img?: string; atlas?: string; modConfig?: boolean }
interface ModWorldgenPreset { id: string; name: string; location: string; overrides: Record<string, string> }

let vanillaStringsMap: Map<string, string> | null = null;
function vanillaStrings(): Map<string, string> {
  if (vanillaStringsMap) return vanillaStringsMap;
  const map = new Map<string, string>();
  const text = readText(join(PANEL_DIR, "data", "strings.lua"));
  const re = /([A-Z][A-Z0-9_]{2,})\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { if (!map.has(m[1])) map.set(m[1], m[2]); }
  vanillaStringsMap = map;
  return map;
}
let poMap: Map<string, string> | null = null;
function chinesePo(): Map<string, string> {
  if (poMap) return poMap;
  const map = new Map<string, string>();
  const text = readText(join(PANEL_DIR, "data", "chinese_s.po"));
  const unq = (s: string) => s.split("\n").map((l) => { const m = /^\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(l); return m ? m[1] : ""; }).join("").replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const re = /msgid\s+((?:"(?:[^"\\]|\\.)*"\s*\n?\s*)+)\nmsgstr\s+((?:"(?:[^"\\]|\\.)*"\s*\n?\s*)+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = unq(m[1]), str = unq(m[2]);
    if (id && str && !map.has(id)) map.set(id, str);
  }
  poMap = map;
  return map;
}
// 中文名映射：中文语言包模组(DST_chs.po) + 各模组自带中文语言文件(languages/chinese_s*.po / strings_cn*.lua)
let chsNamesMap: Map<string, string> | null = null;
let chsTextMap: Map<string, string> | null = null;
let chsMsgMap: Map<string, string> | null = null; // 全 msgctxt 路径 → 中文
function chsNames(): Map<string, string> {
  if (chsNamesMap) return chsNamesMap;
  const map = new Map<string, string>();
  const textMap = new Map<string, string>();
  const msgMap = new Map<string, string>();
  try {
    for (const id of readdirSync(ugcSharedDir())) {
      const dir = join(ugcSharedDir(), id);
      const files: string[] = [join(dir, "DST_chs.po")];
      try {
        for (const f of readdirSync(join(dir, "languages"))) {
          if (/chinese_s|_chs|_cn|zh_/i.test(f) && f.endsWith(".po")) files.push(join(dir, "languages", f));
        }
      } catch {}
      try {
        for (const f of readdirSync(dir)) {
          if (/^strings_cn.*\.lua$|chinese.*\.lua$/i.test(f)) files.push(join(dir, f));
        }
      } catch {}
      for (const po of files) {
        const text = readText(po);
        if (!text) continue;
        // po 格式：msgctxt "STRINGS.X" + msgid 英文 + msgstr 中文（索引全部 STRINGS 路径）
        const re = /msgctxt\s+"(STRINGS\.[A-Z0-9_.]+)"\s*\nmsgid\s+"((?:[^"\\]|\\.)*)"\s*\nmsgstr\s+"((?:[^"\\]|\\.)*)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) {
          if (!m[3]) continue;
          if (!msgMap.has(m[1])) msgMap.set(m[1], m[3]);
          if (m[1].startsWith("STRINGS.NAMES.")) {
            if (!map.has(m[1])) map.set(m[1], m[3]);
            if (!textMap.has(m[2])) textMap.set(m[2], m[3]);
          }
        }
        // 无 msgctxt 的通用条目
        const re2 = /msgid\s+"((?:[^"\\]|\\.){2,60})"\s*\nmsgstr\s+"((?:[^"\\]|\\.)+)"/g;
        while ((m = re2.exec(text))) { if (m[2] && !textMap.has(m[1])) textMap.set(m[1], m[2]); }
        // strings_cn.lua 形式：STRINGS.NAMES.X = "中文"
        const re3 = /NAMES\.([A-Z0-9_]+)\s*=\s*"([^"]+)"/g;
        while ((m = re3.exec(text))) { if (m[2] && !map.has("STRINGS.NAMES." + m[1])) map.set("STRINGS.NAMES." + m[1], m[2]); }
      }
    }
  } catch {}
  chsNamesMap = map;
  chsTextMap = textMap;
  chsMsgMap = msgMap;
  return map;
}
// 按完整 STRINGS 路径查中文（如 STRINGS.UI.CUSTOMIZATIONSCREEN.PALMTREE_REGROWTH）
function chsMsg(path: string): string {
  chsNames();
  return chsMsgMap?.get(path) || "";
}
// 任意英文文本 → 中文（内置常用词表 → 中文语言包 msgid 映射 → 官方 po）
const ZH_GLOSSARY: Record<string, string> = {
  Enabled: "启用", Disabled: "禁用", Enable: "启用", Disable: "禁用",
  On: "开", Off: "关", True: "是", False: "否", Yes: "是", No: "否",
  Language: "语言", "Language/语言": "语言",
  Speed: "速度", Size: "大小", Amount: "数量", Count: "数量", Number: "数量",
  Damage: "伤害", Health: "血量", Hunger: "饥饿", Sanity: "理智",
  Mode: "模式", Difficulty: "难度", Time: "时间", Duration: "持续时间",
  Range: "范围", Radius: "半径", Distance: "距离", Chance: "概率", Rate: "比率",
  Cooldown: "冷却时间", Interval: "间隔", Default: "默认", None: "无",
  Show: "显示", Hide: "隐藏", Display: "显示", Visible: "可见",
  Always: "总是", Never: "从不", Random: "随机", Auto: "自动", Manual: "手动",
  Quality: "品质", Volume: "音量", Sound: "声音", Music: "音乐",
  Debug: "调试", Version: "版本", Author: "作者", Unknown: "未知",
};
function zhText(en: string, modId?: string): string {
  if (!en) return "";
  const t = en.trim();
  if (ZH_GLOSSARY[t]) return ZH_GLOSSARY[t];
  // 后缀规则：Xxx Enabled/Disabled → 启用/禁用 Xxx
  let m = /^(.+?)\s+(Enabled|Disabled|On|Off)$/i.exec(t);
  if (m) return m[2] + "（" + m[1] + "）";
  chsNames();
  if (chsTextMap?.get(t)) return chsTextMap.get(t)!;
  if (chinesePo().get(t)) return chinesePo().get(t)!;
  // 查模组翻译
  if (modId) {
    const mt = modTrans(modId);
    if (mt.po.get(t)) return mt.po.get(t)!;
  }
  return t;
}
// 模组世界设置项/物品的中文名：原版设置项表 → 中文语言包（含单复数变体）→ 原版物品表
// 模组翻译缓存：modId → { po: Map<en, zh>, strings: Map<STRINGS.key.lastpart, en> }
const modTransCache = new Map<string, { po: Map<string, string>; strings: Map<string, string> }>();
function modTrans(id: string): { po: Map<string, string>; strings: Map<string, string> } {
  if (modTransCache.has(id)) return modTransCache.get(id)!;
  const dir = ugcSharedDir();
  const po = new Map<string, string>();
  const strings = new Map<string, string>();
  // 加载模组 .po 文件
  const poFiles = [
    join(dir, id, "scripts", "languages", "pl_chinese_s.po"),
    join(dir, id, "DST_chs.po"),
    join(dir, id, "chinese_s.po"),
  ];
  for (const pf of poFiles) {
    if (!existsSync(pf)) continue;
    const text = readText(pf);
    const unq = (s: string) => s.split("\n").map((l) => { const m = /^\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(l); return m ? m[1] : ""; }).join("").replace(/\\n/g, " ").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    const re = /msgid\s+((?:"(?:[^"\\]|\\.)*"\s*\n?\s*)+)\nmsgstr\s+((?:"(?:[^"\\]|\\.)*"\s*\n?\s*)+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const msgid = unq(m[1]), msgstr = unq(m[2]);
      if (msgid && msgstr && !po.has(msgid)) po.set(msgid, msgstr);
    }
    break;
  }
  // 加载模组 strings/common.lua（英文 STRINGS 值）
  const strFile = join(dir, id, "strings", "common.lua");
  if (existsSync(strFile)) {
    const text = readText(strFile);
    // 提取 KEY = "VALUE" 对（只取叶子节点的字符串值）
    const re = /([A-Z][A-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (!strings.has(m[1])) strings.set(m[1], m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }
  const result = { po, strings };
  modTransCache.set(id, result);
  return result;
}
function zhNameForKey(key: string, modId?: string): string {
  const noSet = key.replace(/_setting$/, "");
  // 原版世界设置项（start_location/world_size/touchstone/boons/season_start 等）
  for (const o of FOREST_OPTIONS) if (o.key === key || o.key === noSet) return o.label;
  for (const o of CAVE_OPTIONS) if (o.key === key || o.key === noSet) return o.label;
  const cands = [key, noSet, key.replace(/s$/, ""), noSet.replace(/s$/, "")];
  // 查模组翻译
  if (modId) {
    const mt = modTrans(modId);
    for (const c of cands) {
      const en = mt.strings.get(c.toUpperCase());
      if (en) { const zh = mt.po.get(en); if (zh) return zh; }
      // 也查 NAMES
      const enName = mt.strings.get(c.toUpperCase());
      if (enName) { const zh = mt.po.get(enName); if (zh) return zh; }
    }
  }
  for (const c of cands) {
    const cn = chsNames().get("STRINGS.NAMES." + c.toUpperCase()) || chsMsg("STRINGS.UI.CUSTOMIZATIONSCREEN." + c.toUpperCase());
    if (cn) return cn;
  }
  for (const c of cands) {
    const found = ITEMS.find((x) => x.prefab === c);
    if (found) return found.name;
  }
  return "";
}
function resolveStringsRef(expr: string, modId?: string): string {
  const m = /STRINGS(?:\.[A-Za-z_]\w*)+\.([A-Z][A-Z0-9_]*)$/.exec((expr || "").trim());
  if (!m) return "";
  const lastKey = m[1];
  // 先查模组自己的翻译
  if (modId) {
    const mt = modTrans(modId);
    const modEn = mt.strings.get(lastKey);
    if (modEn) {
      const zh = mt.po.get(modEn);
      if (zh) return zh;
    }
  }
  // 再查原版
  const en = vanillaStrings().get(lastKey);
  if (!en) return "";
  return chinesePo().get(en) || en;
}
// 常见预设 ID → 中文名（兜底映射）
const PRESET_CN: [RegExp, string][] = [
  [/SURVIVAL_TOGETHER$/, "生存"],
  [/RELAXED$/, "轻松"],
  [/ENDLESS$/, "无尽"],
  [/WILDERNESS$/, "荒野"],
  [/LIGHTS_?OUT$/, "暗无天日"],
  [/LAVAARENA$/, "熔炉竞技场"],
  [/QUAGMIRE$/, "暴食"],
  [/VOLCANO(_LEVEL)?$/, "火山"],
  [/^DST_CAVE$/, "洞穴"],
  [/CAVES?$/, "洞穴"],
  [/HAMLET$/, "哈姆雷特"],
  [/PORKLAND/, "哈姆雷特(猪镇)"],
  [/SHIPWRECKED/, "海难"],
  [/TROPICAL/, "热带"],
];
// 从模组自身文件中查找字符串定义（模组自定义的 STRINGS，如火山的 PRESETLEVELS.VOLCANO）
const modStrCache = new Map<string, Map<string, string>>();
function modStringLookup(id: string, key: string, prefix = ""): string {
  let cache = modStrCache.get(id);
  if (!cache) { cache = new Map(); modStrCache.set(id, cache); }
  const cacheKey = prefix + "." + key;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const dir = join(ugcSharedDir(), id);
  const reDotted = new RegExp(`${prefix ? prefix + "\\." : ""}\\b${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.){1,100})"`);
  const reBare = new RegExp(`\\b${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.){1,100})"`, "g");
  // 收集 lua 文件：字符串/语言类文件优先（大模组文件多，避免被上限截断）
  const luaFiles: string[] = [];
  const collect = (d: string, depth: number): void => {
    if (depth > 5 || luaFiles.length > 1200) return;
    let ents: string[] = [];
    try { ents = readdirSync(d); } catch { return; }
    for (const f of ents) {
      const p = join(d, f);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) collect(p, depth + 1);
      else if (f.endsWith(".lua") && st.size < 1024 * 1024) luaFiles.push(p);
    }
  };
  collect(dir, 0);
  luaFiles.sort((a, b) => Number(!/string|lang|chs|cn_|names|zh/i.test(a)) - Number(!/string|lang|chs|cn_|names|zh/i.test(b)));
  const hits: string[] = [];
  for (const p of luaFiles.slice(0, 800)) {
    const text = readText(p);
    const dm = reDotted.exec(text);
    if (dm) {
      const v = unquoteLua(dm[1]);
      cache.set(cacheKey, v);
      return v;
    }
    let bm: RegExpExecArray | null;
    while ((bm = reBare.exec(text))) hits.push(unquoteLua(bm[1]));
    if (hits.length >= 20) break;
  }
  // 优先含中文的，其次最短的（名字通常比描述短）
  const cjk = hits.find((h) => /[^\x00-\x7f]/.test(h));
  const found = cjk || hits.sort((a, b) => a.length - b.length)[0] || "";
  cache.set(cacheKey, found);
  return found;
}
// 预设名三级解析：原版字库 → 模组自带字符串 → 内置中文映射
function resolvePresetName(modId: string, id: string, nameExpr: string): string {
  const byVanilla = resolveStringsRef(nameExpr);
  if (byVanilla) return byVanilla;
  const keyM = /([A-Z][A-Z0-9_]*)$/.exec((nameExpr || "").trim());
  if (keyM) {
    const v = modStringLookup(modId, keyM[1], "PRESETLEVELS");
    if (v) {
      if (/[^\x00-\x7f]/.test(v)) return v; // 模组自带中文名
      const zh = chinesePo().get(v);
      if (zh) return zh;
      // 无中文翻译时落到内置映射，不直接返回英文
    }
  }
  for (const [re, cn] of PRESET_CN) if (re.test(id)) return cn;
  return id;
}
function stripLuaComments(text: string): string {
  text = text.replace(/--\[\[[\s\S]*?\]\]/g, "");
  return text.split("\n").map((l) => {
    let out = "", inS: string | null = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inS) { out += c; if (c === inS && l[i - 1] !== "\\") inS = null; continue; }
      if (c === '"' || c === "'") { inS = c; out += c; continue; }
      if (c === "-" && l[i + 1] === "-") break;
      out += c;
    }
    return out;
  }).join("\n");
}
// 标准描述表（中文标签与原版世界设置一致）
const STD_DESC: Record<string, { v: string; label: string }[]> = {
  frequency_descriptions: [["never", "无"], ["rare", "很少"], ["default", "默认"], ["often", "较多"], ["always", "大量"]].map(([v, label]) => ({ v, label })),
  worldgen_frequency_descriptions: [["never", "无"], ["rare", "很少"], ["uncommon", "较少"], ["default", "默认"], ["often", "较多"], ["mostly", "很多"], ["always", "大量"], ["insane", "疯狂"]].map(([v, label]) => ({ v, label })),
  speed_descriptions: [["never", "从不"], ["veryslow", "很慢"], ["slow", "慢"], ["default", "默认"], ["fast", "快"], ["veryfast", "很快"]].map(([v, label]) => ({ v, label })),
  size_descriptions: [["small", "小"], ["medium", "中（默认）"], ["large", "大"], ["huge", "巨大"]].map(([v, label]) => ({ v, label })),
  season_length_descriptions: [["noseason", "无"], ["veryshortseason", "极短"], ["shortseason", "短"], ["default", "默认"], ["longseason", "长"], ["verylongseason", "极长"], ["random", "随机"]].map(([v, label]) => ({ v, label })),
  day_descriptions: [["onlyday", "仅白天"], ["onlydusk", "仅黄昏"], ["onlynight", "仅黑夜"], ["default", "默认"], ["longday", "长白天"], ["longdusk", "长黄昏"], ["longnight", "长黑夜"], ["noday", "无白天"], ["nodusk", "无黄昏"], ["nonight", "无黑夜"]].map(([v, label]) => ({ v, label })),
  yesno_descriptions: [["no", "否"], ["yes", "是"]].map(([v, label]) => ({ v, label })),
  enableddisabled_descriptions: [["disabled", "禁用"], ["enabled", "启用"]].map(([v, label]) => ({ v, label })),
};
// atlas 名称归一化到 icons/<目录名>
function normalizeAtlas(ref: string): string {
  if (!ref) return "";
  if (/ATLAS_SW2/i.test(ref)) return "customization_shipwrecked2";
  if (/ATLAS_SW/i.test(ref)) return "customization_shipwrecked";
  const m = /images\/([^"/]+)\.xml/.exec(ref);
  if (m) return m[1];
  return "";
}
function parseModCustomizeFile(text: string, modId = ""): ModWorldgenOption[] {
  text = stripLuaComments(text);
  const descMaps: Record<string, { v: string; label: string }[]> = { ...STD_DESC };
  // 模组内联 desc 表：local xxx_descriptions = { { text = ..., data = "..." }, ... }
  const descRe = /local\s+([A-Za-z_]\w*[Dd]escriptions)\s*=\s*\{/g;
  let dm: RegExpExecArray | null;
  while ((dm = descRe.exec(text))) {
    const end = braceMatch(text, descRe.lastIndex - 1);
    if (end === -1) continue;
    const body = text.slice(descRe.lastIndex, end);
    const vals: { v: string; label: string }[] = [];
    const vre = /\{\s*text\s*=\s*([^,]+),\s*data\s*=\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
    let vm: RegExpExecArray | null;
    while ((vm = vre.exec(body))) {
      const t = vm[1].trim();
      const label = t.startsWith('"') ? unquoteLua(t) : (resolveStringsRef(t, modId) || vm[2]);
      vals.push({ v: vm[2], label });
    }
    if (vals.length) descMaps[dm[1]] = vals;
    descRe.lastIndex = end;
  }
  const options: ModWorldgenOption[] = [];
  for (const gname of ["WORLDGEN_GROUP", "WORLDSETTINGS_GROUP"]) {
    const gm = new RegExp(gname + "\\s*=\\s*\\{").exec(text);
    if (!gm) continue;
    const gEnd = braceMatch(text, gm.index + gm[0].length - 1);
    if (gEnd === -1) continue;
    const gBody = text.slice(gm.index + gm[0].length, gEnd);
    const grpRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{/g;
    let gr: RegExpExecArray | null;
    while ((gr = grpRe.exec(gBody))) {
      const ge = braceMatch(gBody, grpRe.lastIndex - 1);
      if (ge === -1) continue;
      const gblk = gBody.slice(grpRe.lastIndex, ge);
      grpRe.lastIndex = ge;
      const groupDesc = (/\bdesc\s*=\s*([A-Za-z_]\w*)/.exec(gblk) || [])[1] || "";
      const groupTextExpr = (/\btext\s*=\s*([^,\n]+)/.exec(gblk) || [])[1] || "";
      const groupLabel = resolveStringsRef(groupTextExpr, modId) || gr[1];
      const gaM = /\batlas\s*=\s*(?:([A-Z_][A-Za-z0-9_]*)|"([^"]+)")/.exec(gblk);
      const groupAtlas = normalizeAtlas((gaM && (gaM[1] || gaM[2])) || "");
      const im = /items\s*=\s*\{/.exec(gblk);
      if (!im) continue;
      const iEnd = braceMatch(gblk, im.index + im[0].length - 1);
      if (iEnd === -1) continue;
      const iBody = gblk.slice(im.index + im[0].length, iEnd);
      const itRe = /\[\s*"([^"]+)"\s*\]\s*=\s*\{/g;
      let it: RegExpExecArray | null;
      while ((it = itRe.exec(iBody))) {
        const ie = braceMatch(iBody, itRe.lastIndex - 1);
        if (ie === -1) continue;
        const iblk = iBody.slice(itRe.lastIndex, ie);
        itRe.lastIndex = ie;
        const key = it[1];
        const def = (/\bvalue\s*=\s*"([^"]*)"/.exec(iblk) || [])[1] || "default";
        const itemDesc = (/\bdesc\s*=\s*([A-Za-z_]\w*)/.exec(iblk) || [])[1] || groupDesc;
        const world = (/\bworld\s*=\s*\{\s*"([^"]+)"/.exec(iblk) || [])[1] || "";
        // 图标：image 字段 + atlas 归属（item 级优先，其次分组级）
        const img = (/\bimage\s*=\s*"([^"]+)"/.exec(iblk) || [])[1] || "";
        const rawAtlas = (/\batlas\s*=\s*(?:([A-Z_][A-Za-z0-9_]*)|"([^"]+)")/.exec(iblk) || []);
        const atlasRef = rawAtlas[1] || rawAtlas[2] || "";
        const values = descMaps[itemDesc] || descMaps["frequency_descriptions"];
        let label = zhNameForKey(key, modId);
        if (!label && modId) {
          const en = modStringLookup(modId, key.toUpperCase(), "NAMES") || modStringLookup(modId, key.replace(/_setting$/, "").toUpperCase(), "NAMES");
          if (en) label = chinesePo().get(en) || en;
        }
        options.push({ key, label: label || key, group: groupLabel, world, default: def, values, img, atlas: normalizeAtlas(atlasRef) || groupAtlas });
      }
    }
  }
  // --- Porkland / Hamlet 风格：modcustomizeitems.lua ---
  // 辅助：从分组体内提取所有条目（字符串条目 "name" 和表条目 key = { ... }）
  const extractItemsFromGroup = (body: string): { key: string; block: string }[] => {
    const items: { key: string; block: string }[] = [];
    let pos = 0;
    while (pos < body.length) {
      while (pos < body.length && /[\s,]/.test(body[pos])) pos++;
      if (pos >= body.length) break;
      // 字符串条目："item_name"
      if (body[pos] === '"') {
        const sm = /^"([A-Za-z_]\w*)"/.exec(body.slice(pos));
        if (sm) { items.push({ key: sm[1], block: "" }); pos += sm[0].length; continue; }
      }
      // 表条目：key = { ... }
      const tm = /^([A-Za-z_]\w*)\s*=\s*\{/.exec(body.slice(pos));
      if (tm) {
        const bs = pos + tm[0].length - 1;
        const be = braceMatch(body, bs);
        if (be !== -1) { items.push({ key: tm[1], block: body.slice(bs + 1, be) }); pos = be + 1; continue; }
      }
      pos++;
    }
    return items;
  };
  // 通用：解析单个 item block 并 push 到 options
  const pushItem = (key: string, block: string, groupLabel: string, world: string, atlas: string) => {
    const def = (/\bvalue\s*=\s*"([^"]*)"/.exec(block) || [])[1] || "default";
    const itemDesc = (/\bdesc\s*=\s*([A-Za-z_]\w*)/.exec(block) || [])[1] || "frequency_descriptions";
    const img = (/\bimage\s*=\s*"([^"]+)"/.exec(block) || [])[1] || key + ".tex";
    const values = descMaps[itemDesc] || descMaps["frequency_descriptions"];
    let label = zhNameForKey(key, modId);
    if (!label && modId) {
      const en = modStringLookup(modId, key.toUpperCase(), "NAMES") || modStringLookup(modId, key.replace(/_setting$/, "").toUpperCase(), "NAMES");
      if (en) label = chinesePo().get(en) || en;
    }
    options.push({ key, label: label || key, group: groupLabel, world, default: def, values, img, atlas });
  };
  // pl_customize_table：每个顶层 key = 分组，含 category/text/items
  const plRe = /\bpl_customize_table\s*=\s*\{/g;
  let plM: RegExpExecArray | null;
  while ((plM = plRe.exec(text))) {
    const plEnd = braceMatch(text, plM.index + plM[0].length - 1);
    if (plEnd === -1) { plRe.lastIndex = text.length; break; }
    const plBody = text.slice(plM.index + plM[0].length, plEnd);
    plRe.lastIndex = plEnd;
    const grpRe = /([A-Za-z_]\w*)\s*=\s*\{/g;
    let gr: RegExpExecArray | null;
    while ((gr = grpRe.exec(plBody))) {
      const ge = braceMatch(plBody, grpRe.lastIndex - 1);
      if (ge === -1) continue;
      const gblk = plBody.slice(grpRe.lastIndex, ge);
      grpRe.lastIndex = ge;
      const groupTextExpr = (/\btext\s*=\s*([^,\n]+)/.exec(gblk) || [])[1] || "";
      const groupLabel = resolveStringsRef(groupTextExpr, modId) || gr[1];
      const gaM = /\batlas\s*=\s*(?:([A-Z_][A-Za-z0-9_]*)|"([^"]+)")/.exec(gblk);
      const groupAtlas = normalizeAtlas((gaM && (gaM[1] || gaM[2])) || "") || "customization_porkland";
      const im = /items\s*=\s*\{/.exec(gblk);
      if (!im) continue;
      const iEnd = braceMatch(gblk, im.index + im[0].length - 1);
      if (iEnd === -1) continue;
      const iBody = gblk.slice(im.index + im[0].length, iEnd);
      for (const it of extractItemsFromGroup(iBody)) {
        pushItem(it.key, it.block, groupLabel, "porkland", groupAtlas);
      }
    }
  }
  // customize_items：[LEVELCATEGORY.WORLDGEN/SETTINGS] → 分组 → 条目
  const SUBGROUP_CN: Record<string, string> = { global: "全局", monsters: "怪物", animals: "动物", resources: "资源", misc: "杂项", survivors: "生存者", events: "事件" };
  const ciRe = /\bcustomize_items\s*=\s*\{/g;
  let ciM: RegExpExecArray | null;
  while ((ciM = ciRe.exec(text))) {
    const ciEnd = braceMatch(text, ciM.index + ciM[0].length - 1);
    if (ciEnd === -1) { ciRe.lastIndex = text.length; break; }
    const ciBody = text.slice(ciM.index + ciM[0].length, ciEnd);
    ciRe.lastIndex = ciEnd;
    const catRe = /\[LEVELCATEGORY\.(\w+)\]\s*=\s*\{/g;
    let catM: RegExpExecArray | null;
    while ((catM = catRe.exec(ciBody))) {
      const catEnd = braceMatch(ciBody, catRe.lastIndex - 1);
      if (catEnd === -1) continue;
      const catBody = ciBody.slice(catRe.lastIndex, catEnd);
      catRe.lastIndex = catEnd;
      const catLabel = catM[1] === "WORLDGEN" ? "世界生成" : "世界设置";
      // 分组：["global"] 或 monsters = { ... }
      const grpRe = /\[?"?([A-Za-z_]\w*)"?\]?\s*=\s*\{/g;
      let gr: RegExpExecArray | null;
      while ((gr = grpRe.exec(catBody))) {
        const ge = braceMatch(catBody, grpRe.lastIndex - 1);
        if (ge === -1) continue;
        const gblk = catBody.slice(grpRe.lastIndex, ge);
        grpRe.lastIndex = ge;
        const subGroupName = gr[1];
        const groupLabel = catLabel + "·" + (SUBGROUP_CN[subGroupName] || subGroupName);
        for (const it of extractItemsFromGroup(gblk)) {
          pushItem(it.key, it.block, groupLabel, "porkland", "customization_porkland");
        }
      }
    }
  }
  return options;
}
function parseModLevelPresets(text: string, modId = ""): ModWorldgenPreset[] {
  text = stripLuaComments(text);
  const out: ModWorldgenPreset[] = [];
  const re = /Add(?:WorldGenLevel|SettingsPreset|Level|Preset)\s*\(\s*LEVELTYPE\.\w+\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = braceMatch(text, m.index + m[0].length - 1);
    if (end === -1) continue;
    const body = text.slice(m.index + m[0].length, end);
    m.lastIndex = end;
    const id = (/\bid\s*=\s*"([^"]+)"/.exec(body) || [])[1];
    if (!id) continue;
    const loc = (/\blocation\s*=\s*"([^"]+)"/.exec(body) || [])[1] || "";
    const nameExpr = (/\bname\s*=\s*([^,\n]+)/.exec(body) || [])[1] || "";
    const name = resolvePresetName(modId, id, nameExpr);
    let overrides: Record<string, string> = {};
    const om = /overrides\s*=\s*\{/.exec(body);
    if (om) {
      const oe = braceMatch(body, om.index + om[0].length - 1);
      if (oe !== -1) {
        const tbl = parseLuaTable(body.slice(om.index + om[0].length, oe));
        for (const [k, v] of Object.entries(tbl)) overrides[k] = String(v);
      }
    }
    out.push({ id, name, location: loc, overrides });
  }
  // 形式二：先定义局部表再传入：local xxx = { id = "...", location = "...", overrides = {...} }
  const byVar = new Map<string, ModWorldgenPreset>();
  const varRe = /local\s+([A-Za-z_]\w*)\s*=\s*\{/g;
  while ((m = varRe.exec(text))) {
    const end = braceMatch(text, varRe.lastIndex - 1);
    if (end === -1) continue;
    const body = text.slice(varRe.lastIndex, end);
    const id = (/\bid\s*=\s*"([^"]+)"/.exec(body) || [])[1];
    if (!id) continue;
    const loc = (/\blocation\s*=\s*"([^"]+)"/.exec(body) || [])[1] || "";
    const nameExpr = (/\bname\s*=\s*([^,\n]+)/.exec(body) || [])[1] || "";
    let overrides: Record<string, string> = {};
    const om = /overrides\s*=\s*\{/.exec(body);
    if (om) {
      const oe = braceMatch(body, om.index + om[0].length - 1);
      if (oe !== -1) {
        const tbl = parseLuaTable(body.slice(om.index + om[0].length, oe));
        for (const [k, v] of Object.entries(tbl)) overrides[k] = String(v);
      }
    }
    const p = { id, name: resolvePresetName(modId, id, nameExpr), location: loc, overrides };
    byVar.set(m[1], p);
    out.push(p);
    varRe.lastIndex = end;
  }
  // 形式三：deepcopy 变体：xxx = deepcopy(base) xxx.id = "NEW_ID"
  const dcRe = /(?:local\s+)?([A-Za-z_]\w*)\s*=\s*deepcopy\(([A-Za-z_]\w*)\)/g;
  let dc: RegExpExecArray | null;
  const clones: [string, string][] = [];
  while ((dc = dcRe.exec(text))) clones.push([dc[1], dc[2]]);
  for (const [v, base] of clones) {
    const bp = byVar.get(base);
    if (!bp) continue;
    const idm = new RegExp(`${v}\\.id\\s*=\\s*"([^"]+)"`).exec(text);
    if (!idm) continue;
    const nm = new RegExp(`${v}\\.name\\s*=\\s*([^,\\n]+)`).exec(text);
    out.push({ id: idm[1], name: (nm && resolvePresetName(modId, idm[1], nm[1])) || idm[1], location: bp.location, overrides: { ...bp.overrides } });
  }
  return out;
}
// 缓存 modWorldgenData 结果（每个模组只计算一次）
const modWorldgenDataCache = new Map<string, ReturnType<typeof modWorldgenDataRaw>>();
function modWorldgenData(id: string): { name: string; options: ModWorldgenOption[]; presets: ModWorldgenPreset[]; worldgenFiles: string[] } | null {
  if (modWorldgenDataCache.has(id)) return modWorldgenDataCache.get(id)!;
  const result = modWorldgenDataRaw(id);
  modWorldgenDataCache.set(id, result);
  return result;
}
function modWorldgenDataRaw(id: string): { name: string; options: ModWorldgenOption[]; presets: ModWorldgenPreset[]; worldgenFiles: string[] } | null {
  const dir = join(ugcSharedDir(), id);
  if (!existsSync(dir)) return null;
  const files: string[] = [];
  const mw = join(dir, "modworldgenmain.lua");
  if (existsSync(mw)) files.push(mw);
  const cust = join(dir, "scripts", "map", "customize_patch.lua");
  if (existsSync(cust)) files.push(cust);
  const custItems = join(dir, "modcustomizeitems.lua");
  if (existsSync(custItems)) files.push(custItems);
  const lvDir = join(dir, "scripts", "map", "levels");
  try { if (existsSync(lvDir)) for (const f of readdirSync(lvDir)) if (f.endsWith(".lua")) files.push(join(lvDir, f)); } catch {}
  if (!files.length) return null;
  let options: ModWorldgenOption[] = [], presets: ModWorldgenPreset[] = [];
  for (const f of files) {
    const text = readText(f);
    if (!text) continue;
    options = options.concat(parseModCustomizeFile(text, id));
    presets = presets.concat(parseModLevelPresets(text, id));
  }
  const seenO = new Set<string>();
  options = options.filter((o) => !seenO.has(o.key + o.group) && seenO.add(o.key + o.group));
  const seenP = new Set<string>();
  presets = presets.filter((p) => !seenP.has(p.id) && seenP.add(p.id));
  // 模组通过 modworldgenmain.lua 修改/替换的世界生成相关文件清单
  const worldgenFiles: string[] = [];
  const mwText = existsSync(mw) ? readText(mw) : "";
  for (const m of mwText.matchAll(/modimport\s+"([^"]*(?:map|worldgen|level)[^"]*)"/g)) {
    if (!worldgenFiles.includes(m[1])) worldgenFiles.push(m[1]);
  }
  if (!options.length && !presets.length) {
    // 配置驱动型世界模组（如三合一 Tropical Experience / 欧皇模拟器）：
    // 没有标准的 WORLDGEN_GROUP/LEVELTYPE 定义，世界设置通过 configuration_options 控制
    // 检测条件：有 modworldgenmain.lua + 有 AddLevelPreInitAny（修改世界生成）
    if (existsSync(mw)) {
      const mwText = readText(mw);
      const modifiesWorldgen = /AddLevelPreInit|GetModConfigData.*world|AddRoom|AddTask|GROUND\./.test(mwText);
      if (modifiesWorldgen) {
        const mi = parseModInfo(id);
        if (mi?.configOptions?.length) {
          // 筛选与世界/地图生成相关的配置项
          // 精确匹配：名称包含明确的世界生成关键词
          const worldKeywords = /^kindofworld|world|biome|island|continent|ocean|volcano|hamlet|shipwreck|tropical|frost_island|moon.*ship|coralbiome|greenworld|gorgeisland|monkeyisland|howmany|continentsize|fillingthe|terrain|islandsize|islandshape|numberofmain|extraisland|islandspac|islandposit|hasocean|worldsize/i;
          for (const opt of mi.configOptions) {
            const isWorldRelated = worldKeywords.test(opt.name) || worldKeywords.test(opt.label);
            if (isWorldRelated) {
              options.push({
                key: opt.name,
                label: opt.label || opt.name,
                group: "世界类型",
                world: "",
                default: String(opt.default ?? ""),
                values: opt.options.length ? opt.options.map((op) => ({ v: String(op.data), label: op.description || String(op.data) })) : [{ v: String(opt.default ?? "default"), label: String(opt.default ?? "default") }],
                img: "",
                atlas: "",
                modConfig: true,
              });
            }
          }
        }
      }
    }
  }
  if (!options.length && !presets.length) return null;
  const mi = parseModInfo(id);
  const st = modCache.items[id];
  return { name: st?.title || mi?.name || id, options, presets, worldgenFiles };
}
function enabledModWorldgenOptions(shard: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [key, e] of readModOverrides(shard)) {
    if (!e.enabled) continue;
    const d = modWorldgenData(key.replace("workshop-", ""));
    if (d) for (const o of d.options) map.set(o.key, new Set(o.values.map((v) => v.v)));
  }
  return map;
}
// 获取已启用模组的 modConfig 选项（写入 modoverrides.lua 的配置驱动型选项）
function enabledModConfigOptions(shard: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [key, e] of readModOverrides(shard)) {
    if (!e.enabled) continue;
    const d = modWorldgenData(key.replace("workshop-", ""));
    if (d) for (const o of d.options) {
      if (o.modConfig) map.set(o.key, new Set(o.values.map((v) => v.v)));
    }
  }
  return map;
}

interface SteamItem {
  publishedfileid: string;
  title: string;
  description: string;
  preview_url: string;
  file_url: string;
  file_size: number;
  tags: string[];
  subscriptions: number;
  lifetime_subscriptions: number;
  favorited: number;
  views: number;
  time_updated: number;
  downloadedAt?: number;
}
interface ModCache { time: number; items: Record<string, SteamItem> }
// 模组本地下载时间：优先用记录值，缺失时用目录修改时间估算
function modDownloadedAt(id: string): number {
  const rec = modCache.items[id]?.downloadedAt;
  if (rec) return rec;
  for (const c of ugcContentDirs()) {
    const p = join(c, id);
    try { if (existsSync(p)) return statSync(p).mtimeMs; } catch {}
  }
  return 0;
}
function loadModCache(): ModCache {
  try {
    const c = JSON.parse(readText(MOD_CACHE_FILE));
    return { time: Number(c.time) || 0, items: c.items || {} };
  } catch { return { time: 0, items: {} }; }
}
let modCache = loadModCache();
function saveModCache() {
  try { writeFileSync(MOD_CACHE_FILE, JSON.stringify(modCache)); } catch {}
}
async function querySteam(ids: string[]): Promise<{ ok: boolean; items: Record<string, SteamItem>; msg?: string }> {
  if (!ids.length) return { ok: true, items: {} };
  try {
    const body = `itemcount=${ids.length}` + ids.map((id, i) => `&publishedfileids[${i}]=${encodeURIComponent(id)}`).join("");
    const res = await fetch("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(12000),
    });
    const j: any = await res.json();
    const details = j?.response?.publishedfiledetails || [];
    const items: Record<string, SteamItem> = {};
    for (const d of details) {
      if (String(d.result) !== "1") continue;
      items[String(d.publishedfileid)] = {
        publishedfileid: String(d.publishedfileid),
        title: d.title || "",
        description: d.description || "",
        preview_url: d.preview_url || "",
        file_url: d.file_url || "",
        file_size: Number(d.file_size) || 0,
        tags: Array.isArray(d.tags) ? d.tags.map((t: any) => String(t.tag)) : [],
        subscriptions: Number(d.subscriptions) || 0,
        lifetime_subscriptions: Number(d.lifetime_subscriptions) || 0,
        favorited: Number(d.favorited) || 0,
        views: Number(d.views) || 0,
        time_updated: Number(d.time_updated) || 0,
      };
    }
    return { ok: true, items };
  } catch (e: any) {
    return { ok: false, items: {}, msg: String(e?.message || e) };
  }
}
const CACHE_TTL = 6 * 3600 * 1000;
// 补全缓存：仅在过期或缺失时请求外网
async function ensureSteamCache(ids: string[], force = false): Promise<boolean> {
  const stale = force || Date.now() - modCache.time > CACHE_TTL;
  const need = ids.filter((id) => stale || !(id in modCache.items) || modCache.items[id].file_url === undefined || modCache.items[id].favorited === undefined);
  if (!need.length) return true;
  const r = await querySteam(need);
  if (r.ok) {
    Object.assign(modCache.items, r.items);
    modCache.time = Date.now();
    saveModCache();
    return true;
  }
  return false;
}

// ---------- 模组列表合并 ----------
function localModDirs(): string[] {
  ensureUgcLayout();
  const set = new Set<string>();
  try {
    for (const d of readdirSync(MODS_DIR)) {
      if (/^workshop-\d+$/.test(d) && statSync(join(MODS_DIR, d)).isDirectory()) set.add(d.slice(9));
    }
  } catch {}
  for (const c of ugcContentDirs()) {
    try {
      for (const d of readdirSync(c)) {
        if (/^\d+$/.test(d) && statSync(join(c, d)).isDirectory()) set.add(d);
      }
    } catch {}
  }
  return [...set].sort();
}
function allModIds(): string[] {
  const set = new Set<string>();
  for (const id of localModDirs()) set.add(id);
  for (const id of readSetupIds()) set.add(id);
  for (const shard of listShards()) {
    for (const key of readModOverrides(shard.name).keys()) set.add(key.replace("workshop-", ""));
  }
  return [...set].sort();
}
async function buildModList(forceRefresh = false) {
  const ids = allModIds();
  let steamOk = true;
  if (ids.length) steamOk = await ensureSteamCache(ids, forceRefresh);
  const overrides = new Map<string, ModOverrideEntry>();
  // 以 Master 的 modoverrides 为准决定 enabled
  const master = listShards().find((s) => s.isMaster) || listShards()[0];
  const masterOv = master ? readModOverrides(master.name) : new Map<string, ModOverrideEntry>();
  const setupIds = new Set(readSetupIds());
  const localIds = new Set(localModDirs());
  const list = ids.map((id) => {
    const mi = parseModInfo(id);
    const st = modCache.items[id];
    const ov = masterOv.get(`workshop-${id}`);
    return {
      id,
      title: st?.title || "",
      preview_url: st?.preview_url || "",
      name: mi?.name || "",
      version: mi?.version || "",
      update_date: st?.time_updated ? formatDate(st.time_updated) : "",
      clientOnly: mi?.clientOnly || false,
      allClientsRequire: mi?.allClientsRequire || false,
      tags: st?.tags || [],
      subscriptions: st?.subscriptions || 0,
      downloaded: localIds.has(id),
      downloadedAt: modDownloadedAt(id),
      error: localIds.has(id) && !mi,
      updateAvailable: !!st && st.time_updated > 0 && modDownloadedAt(id) > 0 && st.time_updated * 1000 > modDownloadedAt(id),
      favorite: panelConfig.favorites.includes(id),
      inSetup: setupIds.has(id),
      enabled: ov?.enabled === true,
      hasConfig: (mi?.configOptions.length || 0) > 0,
    };
  });
  // 收藏模组默认前置
  list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.id.localeCompare(b.id));
  return { list, steamOk };
}

// ---------- 模组下载任务（并行队列：CDN 直链优先，steamcmd 兜底串行） ----------
interface Task {
  id: string;
  modId: string;
  label: string;
  status: "queued" | "running" | "success" | "failed";
  log: string;
  totalBytes: number;
  downloadedBytes: number;
  startedAt: number;
  finishedAt?: number;
}
const tasks = new Map<string, Task>();
let taskSeq = 0;
const MAX_PARALLEL = 3;
const downloadQueue: string[] = [];
// 每个并行槽位一个独立 HOME，steamcmd 实例互不干扰，可真正并行
const slotBusy: boolean[] = new Array(MAX_PARALLEL).fill(false);
const slotHome = (s: number) => `/tmp/dst_dl_home_${s}`;

async function downloadOneMod(id: string, task: Task, slot: number): Promise<boolean> {
  const home = slotHome(slot);
  mkdirSync(home, { recursive: true });
  task.log += `\n===== steamcmd 下载模组 ${id}（并行槽位 ${slot + 1}）=====\n`;
  const r = await run([STEAMCMD, "+login", "anonymous", "+workshop_download_item", "322330", id, "+quit"], {
    cwd: join(HOME, "steamcmd"),
    env: { HOME: home },
    timeoutMs: 10 * 60 * 1000,
  });
  task.log += r.out.slice(-4000) + `\n(exit=${r.code})\n`;
  // steamcmd 检测到 ~/Steam 已存在时会用它作数据目录，而非 steamcmd 安装目录
  const candidates = [
    join(home, "Steam", "steamapps", "workshop", "content", "322330", id),
    join(home, "steamcmd", "steamapps", "workshop", "content", "322330", id),
    join(STEAMCMD_WORKSHOP, id),
    join(HOME, "Steam", "steamapps", "workshop", "content", "322330", id),
  ];
  const src = candidates.find((p) => existsSync(p));
  if (!src) {
    task.log += `[失败] 下载目录不存在: ${candidates.join(" 或 ")}\n`;
    return false;
  }
  ensureUgcLayout();
  const dst = join(ugcSharedDir(), id);
  try {
    rmSync(dst, { recursive: true, force: true });
    // 老模组可能下载为 *_legacy.bin（实为 zip 包），需解压而非直接复制
    const legacyBins = readdirSync(src).filter((f) => f.endsWith("_legacy.bin"));
    if (legacyBins.length > 0) {
      mkdirSync(dst, { recursive: true });
      for (const bin of legacyBins) {
        const uz = await run(["unzip", "-o", "-q", join(src, bin), "-d", dst]);
        if (uz.code > 1) {
          task.log += `[失败] 解压 ${bin} 失败: ${uz.out.slice(-2000)}\n`;
          return false;
        }
      }
    } else {
      const cp = await run(["cp", "-r", src, dst]);
      if (cp.code !== 0) {
        task.log += `[失败] 复制失败: ${cp.out}\n`;
        return false;
      }
    }
    if (modCache.items[id]) { modCache.items[id].downloadedAt = Date.now(); saveModCache(); }
    task.log += `[完成] 已安装到 ${dst}\n`;
    return true;
  } catch (e: any) {
    task.log += `[失败] ${e?.message || e}\n`;
    return false;
  }
}
// CDN 直链下载（创意工坊 zip），返回 false 表示需要回退 steamcmd
async function downloadViaCdn(id: string, task: Task): Promise<boolean> {
  const st = modCache.items[id];
  if (!st?.file_url) { task.log += "[提示] 无 CDN 直链，转 steamcmd 下载\n"; return false; }
  const zipPath = `/tmp/dst_mod_${id}.zip`;
  const tmpDir = `/tmp/dst_mod_${id}_x`;
  try {
    task.totalBytes = st.file_size || 0;
    task.log += `[CDN] ${st.title || id}（${(st.file_size / 1048576).toFixed(1)} MB）\n${st.file_url}\n`;
    const proc = Bun.spawn(["curl", "-fSL", "--connect-timeout", "15", "--retry", "2", "-o", zipPath, st.file_url], { stdout: "ignore", stderr: "ignore" });
    const timer = setInterval(() => { try { task.downloadedBytes = statSync(zipPath).size; } catch {} }, 500);
    const code = await proc.exited;
    clearInterval(timer);
    if (code !== 0 || !existsSync(zipPath) || statSync(zipPath).size < 100) {
      task.log += `[失败] CDN 下载失败 (exit=${code})\n`;
      return false;
    }
    task.downloadedBytes = statSync(zipPath).size;
    task.log += `[CDN] 下载完成，解压中…\n`;
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const uz = await run(["unzip", "-o", "-q", zipPath, "-d", tmpDir]);
    if (uz.code > 1) { task.log += `[失败] 解压失败: ${uz.out.slice(-2000)}\n`; return false; }
    let root = tmpDir;
    if (!existsSync(join(root, "modinfo.lua"))) {
      const entries = readdirSync(root);
      if (entries.length === 1 && statSync(join(root, entries[0])).isDirectory() && existsSync(join(root, entries[0], "modinfo.lua"))) {
        root = join(root, entries[0]);
      }
    }
    if (!existsSync(join(root, "modinfo.lua"))) { task.log += "[失败] 压缩包内未找到 modinfo.lua，转 steamcmd\n"; return false; }
    ensureUgcLayout();
  const dst = join(ugcSharedDir(), id);
    rmSync(dst, { recursive: true, force: true });
    const cp = await run(["cp", "-r", root, dst]);
    if (cp.code !== 0) { task.log += `[失败] 复制失败: ${cp.out}\n`; return false; }
    if (modCache.items[id]) { modCache.items[id].downloadedAt = Date.now(); saveModCache(); }
    task.log += `[完成] 已安装到 ${dst}\n`;
    return true;
  } catch (e: any) {
    task.log += `[失败] ${e?.message || e}\n`;
    return false;
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 仅下载 modinfo.lua（轻量）：通过 CDN 下载 zip → 解压出 modinfo.lua → 放入模组目录
// 用于本地缺少 modinfo.lua 时自动补全，不下载完整模组
async function fetchModInfoLua(id: string): Promise<boolean> {
  const st = modCache.items[id];
  if (!st?.file_url) return false;
  const zipPath = `/tmp/dst_modinfo_${id}.zip`;
  const tmpDir = `/tmp/dst_modinfo_${id}_x`;
  try {
    const res = await fetch(st.file_url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 100) return false;
    writeFileSync(zipPath, new Uint8Array(buf));
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const uz = await run(["unzip", "-o", "-q", zipPath, "-d", tmpDir]);
    if (uz.code > 1) return false;
    // 查找 modinfo.lua（可能在子目录）
    let infoFile = join(tmpDir, "modinfo.lua");
    if (!existsSync(infoFile)) {
      const entries = readdirSync(tmpDir);
      if (entries.length === 1 && statSync(join(tmpDir, entries[0])).isDirectory()) {
        infoFile = join(tmpDir, entries[0], "modinfo.lua");
      }
    }
    if (!existsSync(infoFile)) return false;
    ensureUgcLayout();
    const dst = join(ugcSharedDir(), id);
    mkdirSync(dst, { recursive: true });
    // 复制 modinfo.lua 及相关描述文件（modicon 等）
    for (const f of ["modinfo.lua"]) {
      const src = join(tmpDir, f);
      if (existsSync(src)) { try { writeFileSync(join(dst, f), readFileSync(src)); } catch {} }
    }
    // 也尝试从子目录复制
    const entries = readdirSync(tmpDir);
    if (entries.length === 1 && statSync(join(tmpDir, entries[0])).isDirectory()) {
      const sub = join(tmpDir, entries[0]);
      for (const f of readdirSync(sub)) {
        if (f === "modinfo.lua" || f.startsWith("modicon") || f === "modworldgenmain.lua") {
          const src = join(sub, f);
          if (!existsSync(join(dst, f))) { try { writeFileSync(join(dst, f), readFileSync(src)); } catch {} }
        }
      }
    }
    if (modCache.items[id]) { modCache.items[id].downloadedAt = modCache.items[id].downloadedAt || Date.now(); saveModCache(); }
    return true;
  } catch {
    return false;
  } finally {
    rmSync(zipPath, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runDownloadTask(task: Task, slot: number) {
  task.status = "running";
  task.log += `开始处理模组 ${task.modId}\n`;
  try {
    await ensureSteamCache([task.modId]);
    const st = modCache.items[task.modId];
    if (st?.title) task.label = st.title;
    if (st?.file_size) task.totalBytes = st.file_size;
    let good = await downloadViaCdn(task.modId, task);
    if (!good) good = await downloadOneMod(task.modId, task, slot);
    task.status = good ? "success" : "failed";
    task.log += good ? "\n任务成功。\n" : "\n任务失败，请检查日志。\n";
  } catch (e: any) {
    task.status = "failed";
    task.log += `\n异常: ${e?.message || e}\n`;
  }
  task.finishedAt = Date.now();
}

function pumpQueue() {
  while (downloadQueue.length) {
    const s = slotBusy.findIndex((b) => !b);
    if (s === -1) return;
    const tid = downloadQueue.shift()!;
    const t = tasks.get(tid);
    if (!t || t.status !== "queued") continue;
    slotBusy[s] = true;
    runDownloadTask(t, s).finally(() => { slotBusy[s] = false; pumpQueue(); });
  }
}

function enqueueDownloads(ids: string[]): Task[] {
  const out: Task[] = [];
  for (const id of ids) {
    const dup = [...tasks.values()].find((t) => t.modId === id && (t.status === "queued" || t.status === "running"));
    if (dup) { out.push(dup); continue; }
    const task: Task = {
      id: `t${Date.now()}_${++taskSeq}`,
      modId: id,
      label: modCache.items[id]?.title || `模组 ${id}`,
      status: "queued",
      log: `已加入下载队列: ${id}\n`,
      totalBytes: 0,
      downloadedBytes: 0,
      startedAt: Date.now(),
    };
    tasks.set(task.id, task);
    downloadQueue.push(task.id);
    out.push(task);
  }
  pumpQueue();
  return out;
}

// ---------- 创意工坊名称搜索（抓取 workshop browse 页） ----------
function htmlUnescape(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function formatDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
interface ChangeLogEntry { timestamp: number; date: string; text: string; }
async function fetchChangeLogs(id: string): Promise<ChangeLogEntry[]> {
  try {
    const res = await fetch(`https://steamcommunity.com/sharedfiles/filedetails/changelog/${id}?l=schinese`, {
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" },
      signal: AbortSignal.timeout(12000),
    });
    const html = await res.text();
    const entries: ChangeLogEntry[] = [];
    const re = /class="changelog headline">\s*((?:Update|更新[于：:]).+?)\s*<\/div>[\s\S]*?<p id="(\d+)">(.*?)<\/p>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const ts = Number(m[2]);
      const text = htmlUnescape(m[3].replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, ""));
      entries.push({ timestamp: ts, date: formatDate(ts) || htmlUnescape(m[1].trim()), text });
    }
    return entries.slice(0, 10);
  } catch { return []; }
}
async function workshopSearch(q: string): Promise<{ id: string; title: string; preview_url: string }[]> {
  const res = await fetch(`https://steamcommunity.com/workshop/browse/?appid=322330&searchtext=${encodeURIComponent(q)}&browsesort=textsearch&section=readytouseitems&l=schinese`, {
    headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const map = new Map<string, { id: string; title: string; preview_url: string }>();
  let m: RegExpExecArray | null;
  const imgRe = /<a href="https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=(\d+)"[^>]*><img src="([^"]+)"[^>]*alt="([^"]*)"/g;
  while ((m = imgRe.exec(html))) map.set(m[1], { id: m[1], title: htmlUnescape(m[3]), preview_url: htmlUnescape(m[2]) });
  const titleRe = /<a href="https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=(\d+)">([^<]+)<\/a>/g;
  while ((m = titleRe.exec(html))) {
    const title = htmlUnescape(m[2]).trim();
    const cur = map.get(m[1]);
    if (cur) { if (!cur.title) cur.title = title; }
    else map.set(m[1], { id: m[1], title, preview_url: "" });
  }
  return [...map.values()].filter((r) => r.title).slice(0, 30);
}

// ---------- 日志解析 ----------
function chatLogPath(): string | null {
  for (const shard of ["Master", "Caves"]) {
    const p = join(clusterDir(), shard, "server_chat_log.txt");
    if (existsSync(p)) return p;
  }
  for (const s of listShards()) {
    const p = join(shardDir(s.name), "server_chat_log.txt");
    if (existsSync(p)) return p;
  }
  return null;
}
function serverLogPaths(): string[] {
  const out: string[] = [];
  for (const s of listShards()) {
    const p = join(shardDir(s.name), "server_log.txt");
    if (existsSync(p)) out.push(p);
  }
  return out;
}
function tailLines(path: string, n: number): string[] {
  const text = readText(path);
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n));
}

interface PlayerRec { id: string; name: string }
function parsePlayers(): PlayerRec[] {
  const byId = new Map<string, string>();
  const nameOnly = new Set<string>();
  const chat = chatLogPath();
  const chatLines = chat ? tailLines(chat, 5000) : [];
  for (const line of chatLines) {
    const m = line.match(/\((KU_[^)]+)\)\s*([^:]+):/);
    if (m) byId.set(m[1], m[2].trim());
  }
  for (const p of serverLogPaths()) {
    for (const line of tailLines(p, 20000)) {
      const jm = line.match(/\[(?:Join|Leave|Death|Resurrect) Announcement\]\s*(.+)$/);
      if (jm) {
        const name = jm[1].trim();
        if (![...byId.values()].includes(name)) nameOnly.add(name);
      }
      for (const km of line.matchAll(/KU_[A-Za-z0-9_-]+/g)) {
        if (!byId.has(km[0])) byId.set(km[0], "");
      }
    }
  }
  const out: PlayerRec[] = [];
  for (const [id, name] of byId) out.push({ id, name: name || "(未知)" });
  for (const name of nameOnly) {
    if (!out.some((p) => p.name === name)) out.push({ id: "", name });
  }
  return out;
}

// ---------- 路由 ----------
async function bodyJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}
const validId = (s: any) => typeof s === "string" && /^\d{1,12}$/.test(s);
const validKeyVal = (s: any) => typeof s === "string" && /^[A-Za-z0-9_]{1,40}$/.test(s);
// 世界设置的值允许 "|"（如 season_start 的 autumn|spring 组合档）
const validWorldVal = (s: any) => typeof s === "string" && /^[A-Za-z0-9_|]{1,60}$/.test(s);

function worldOptionTable(isMaster: boolean) {
  return isMaster ? FOREST_OPTIONS : CAVE_OPTIONS;
}

async function api(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\/?/, "");
  const method = req.method;

  // ===== 基本设置 =====
  if (path === "basic" && method === "GET") {
    const iniPath = join(clusterDir(), "cluster.ini");
    const lines = parseIni(readText(iniPath));
    let clusters: string[] = [];
    const clusterList: { name: string; mtime: number }[] = [];
    try {
      clusters = readdirSync(clusterRoot()).filter((d) => {
        try { return statSync(join(clusterRoot(), d)).isDirectory(); } catch { return false; }
      });
      for (const name of clusters) {
        try { clusterList.push({ name, mtime: statSync(join(clusterRoot(), name)).mtimeMs }); } catch { clusterList.push({ name, mtime: 0 }); }
      }
      clusterList.sort((a, b) => b.mtime - a.mtime);
    } catch {}
    const g = (s: string, k: string) => iniGet(lines, s, k) ?? "";
    const tokenFile = join(clusterDir(), "cluster_token.txt");
    const token = readText(tokenFile).replace(/^#\s.*\n/, "").trim();
    const roomPwd = g("NETWORK", "cluster_password");
    // 中文语言包的语言设置（workshop-367546858 的 LANG 配置项）
    const master0 = listShards().find((s) => s.isMaster) || listShards()[0];
    const langOv = master0 ? readModOverrides(master0.name).get("workshop-367546858") : undefined;
    const langSetting = String(langOv?.options?.LANG || "simplified");
    return ok({
      clusterRoot: clusterRoot(),
      modsDir: modsStoreDir(),
      serverDir: panelConfig.serverDir,
      clusters,
      clusterList,
      cluster: panelConfig.cluster,
      beta: panelConfig.beta,
      betaBranch: panelConfig.betaBranch,
      lang: langSetting,
      // 凭证永不下发：只返回是否已设置，不返回内容
      has_token: !!token,
      has_cluster_password: !!roomPwd,
      ini: {
        intention: g("GAMEPLAY", "intention") || "cooperative",
        game_mode: g("GAMEPLAY", "game_mode") || "survival",
        max_players: g("GAMEPLAY", "max_players") || "6",
        pvp: g("GAMEPLAY", "pvp") || "false",
        vote_kick_enabled: g("GAMEPLAY", "vote_kick_enabled") || "false",
        pause_when_empty: g("GAMEPLAY", "pause_when_empty") || "false",
        cluster_name: g("NETWORK", "cluster_name"),
        cluster_description: g("NETWORK", "cluster_description"),
        cluster_password: "",
      },
    });
  }
  if (path === "basic" && method === "POST") {
    const b = await bodyJson(req);
    const iniPath = join(clusterDir(), "cluster.ini");
    let lines = parseIni(readText(iniPath));
    const setStr = (sec: string, key: string, val: any, max = 200) => {
      if (typeof val === "string") lines = iniSet(lines, sec, key, val.slice(0, max).replace(/[\r\n]/g, " "));
    };
    if (["cooperative", "social", "competitive", "madness"].includes(b.intention)) lines = iniSet(lines, "GAMEPLAY", "intention", b.intention);
    if (["survival", "relaxed", "endless", "wilderness", "lightsout"].includes(b.game_mode)) lines = iniSet(lines, "GAMEPLAY", "game_mode", b.game_mode);
    setStr("NETWORK", "cluster_name", b.cluster_name, 80);
    setStr("NETWORK", "cluster_description", b.cluster_description, 300);
    // 凭证：空值=保持不变，非空=覆盖，显式 clear 标志=清除
    if (typeof b.cluster_password === "string" && b.cluster_password) lines = iniSet(lines, "NETWORK", "cluster_password", b.cluster_password.slice(0, 80).replace(/[\r\n]/g, " "));
    if (b.clear_cluster_password === true) lines = iniSet(lines, "NETWORK", "cluster_password", "");
    if (typeof b.pvp === "boolean") lines = iniSet(lines, "GAMEPLAY", "pvp", String(b.pvp));
    if (typeof b.vote_kick_enabled === "boolean") lines = iniSet(lines, "GAMEPLAY", "vote_kick_enabled", String(b.vote_kick_enabled));
    if (typeof b.pause_when_empty === "boolean") lines = iniSet(lines, "GAMEPLAY", "pause_when_empty", String(b.pause_when_empty));
    const mp = parseInt(b.max_players);
    if (!isNaN(mp) && mp >= 1 && mp <= 64) lines = iniSet(lines, "GAMEPLAY", "max_players", String(mp));
    // 存档根目录被改到新位置时，当前存档目录可能不存在，先创建再写
    try { mkdirSync(dirname(iniPath), { recursive: true }); } catch {}
    writeFileSync(iniPath, iniToText(lines) + "\n");
    // 保存 cluster_token.txt（非空才覆盖；clear_token 可清除）
    if (typeof b.cluster_token === "string") {
      const token = b.cluster_token.trim();
      if (token) writeFileSync(join(clusterDir(), "cluster_token.txt"), token + "\n");
    }
    if (b.clear_token === true) writeFileSync(join(clusterDir(), "cluster_token.txt"), "# 在此粘贴 Klei 服务器令牌\n");
    panelConfig.beta = !!b.beta;
    if (typeof b.betaBranch === "string" && /^[A-Za-z0-9_-]{0,64}$/.test(b.betaBranch)) panelConfig.betaBranch = b.betaBranch;
    // 语言设置：写入中文语言包在两个分片的 modoverrides（保持启用状态）
    if (["simplified", "traditional", "auto"].includes(String(b.lang))) {
      for (const shard of listShards()) {
        const map = readModOverrides(shard.name);
        const entry = map.get("workshop-367546858") || { enabled: true, options: {} };
        entry.enabled = true;
        entry.options.LANG = String(b.lang);
        map.set("workshop-367546858", entry);
        writeFileSync(join(shardDir(shard.name), "modoverrides.lua"), serializeModOverrides(map) + "\n");
      }
    }
    // 保存服务器目录
    if (typeof b.serverDir === "string" && b.serverDir.trim()) {
      const dir = b.serverDir.trim();
      if (existsSync(dir)) { panelConfig.serverDir = dir; } else return fail("服务器目录不存在: " + dir);
    }
    if (typeof b.clusterRoot === "string" && b.clusterRoot.trim()) {
      const dir = b.clusterRoot.trim();
      if (!dir.startsWith("/")) return fail("存档根目录必须是绝对路径");
      try { mkdirSync(dir, { recursive: true }); panelConfig.clusterRoot = dir; } catch { return fail("无法创建存档根目录: " + dir); }
    }
    if (typeof b.modsDir === "string" && b.modsDir.trim()) {
      const dir = b.modsDir.trim();
      if (!dir.startsWith("/")) return fail("模组存放目录必须是绝对路径");
      try { mkdirSync(dir, { recursive: true }); panelConfig.modsDir = dir; } catch { return fail("无法创建模组存放目录: " + dir); }
    }
    savePanelConfig();
    return ok(null, "已保存，重启面板后路径修改生效（其他设置重启服务器后生效）");
  }
  if (path === "cluster" && method === "POST") {
    const b = await bodyJson(req);
    if (typeof b.cluster === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.cluster) && existsSync(join(clusterRoot(), b.cluster))) {
      panelConfig.cluster = b.cluster;
      savePanelConfig();
      return ok(null, "已切换存档: " + b.cluster);
    }
    return fail("存档不存在或名称非法");
  }
  // 获取服务器令牌内容（用于复制到剪贴板）
  if (path === "basic/token" && method === "GET") {
    const tokenFile = join(clusterDir(), "cluster_token.txt");
    const token = readText(tokenFile).replace(/^#\s.*\n/, "").trim();
    return ok({ token });
  }
  if (path === "cluster/rename" && method === "POST") {
    const b = await bodyJson(req);
    const name = String(b.name || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return fail("存档名只能包含字母、数字、下划线、连字符（不要中文）");
    const from = typeof b.from === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.from) ? b.from : panelConfig.cluster;
    if (name === from) return fail("新名称与原存档名相同");
    const oldDir = join(clusterRoot(), from);
    if (!existsSync(oldDir)) return fail("存档不存在: " + from);
    const newDir = join(clusterRoot(), name);
    if (existsSync(newDir)) return fail("已存在同名存档: " + name);
    if (from === panelConfig.cluster) {
      for (const s of listShards()) {
        if (await shardRunning(s.name)) return fail("服务器正在运行，请先关闭服务器再重命名存档");
      }
    }
    renameSync(oldDir, newDir);
    if (from === panelConfig.cluster) {
      panelConfig.cluster = name;
      savePanelConfig();
    }
    return ok(null, `存档已重命名: ${from} → ${name}`);
  }
  if (path === "cluster/create" && method === "POST") {
    const b = await bodyJson(req);
    const name = String(b.name || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return fail("存档名只能包含字母、数字、下划线、连字符（不要中文）");
    const dir = join(clusterRoot(), name);
    if (existsSync(dir)) return fail("已存在同名存档: " + name);
    mkdirSync(join(dir, "Master"), { recursive: true });
    mkdirSync(join(dir, "Caves"), { recursive: true });
    writeFileSync(join(dir, "cluster.ini"), `[GAMEPLAY]\ngame_mode = survival\nmax_players = 6\npvp = false\npause_when_empty = true\nvote_kick_enabled = true\n\n[NETWORK]\ncluster_name = ${name}\ncluster_description = A dedicated server\ncluster_password =\n\n[MISC]\nconsole_enabled = true\n\n[SHARD]\nshard_enabled = true\nbind_ip = 127.0.0.1\nmaster_ip = 127.0.0.1\nmaster_port = 10889\ncluster_key = supersecretkey\n`);
    writeFileSync(join(dir, "cluster_token.txt"), "# 在此粘贴 Klei 服务器令牌（必须填写才能开服）\n");
    writeFileSync(join(dir, "Master", "server.ini"), `[NETWORK]\nserver_port = 11000\n\n[SHARD]\nis_master = true\n\n[STEAM]\nmaster_server_port = 27018\nauthentication_port = 8768\n\n[ACCOUNT]\nencode_user_path = true\n`);
    writeFileSync(join(dir, "Caves", "server.ini"), `[NETWORK]\nserver_port = 11001\n\n[SHARD]\nis_master = false\nname = Caves\n\n[STEAM]\nmaster_server_port = 27019\nauthentication_port = 8769\n\n[ACCOUNT]\nencode_user_path = true\n`);
    panelConfig.cluster = name;
    savePanelConfig();
    return ok(null, "已创建并切换到新存档: " + name + "，记得填写 cluster_token.txt");
  }
  if (path === "cluster/delete" && method === "POST") {
    const b = await bodyJson(req);
    const name = String(b.name || "").trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return fail("非法存档名");
    const dir = join(clusterRoot(), name);
    if (!existsSync(dir)) return fail("存档不存在: " + name);
    if (name === panelConfig.cluster) {
      for (const s of listShards()) {
        if (await shardRunning(s.name)) return fail("该存档的服务器正在运行，请先关闭服务器再删除");
      }
    }
    rmSync(dir, { recursive: true, force: true });
    if (name === panelConfig.cluster) {
      const rest = readdirSync(clusterRoot()).filter((d) => {
        try { return statSync(join(clusterRoot(), d)).isDirectory(); } catch { return false; }
      });
      if (rest.length) {
        panelConfig.cluster = rest[0];
        savePanelConfig();
        return ok(null, `已删除存档 ${name}，已切换到 ${rest[0]}`);
      }
      return ok(null, `已删除存档 ${name}（当前没有可用存档，请新建）`);
    }
    return ok(null, `已删除存档 ${name}`);
  }

  // ===== 编辑世界 =====
  if (path === "worlds" && method === "GET") {
    const shards = listShards();
    for (const s of shards) s.running = await shardRunning(s.name);
    return ok(shards);
  }
  if (path === "worlds/add" && method === "POST") {
    const b = await bodyJson(req);
    const shards = listShards();
    const wantMaster = b.type === "forest";
    const exists = shards.some((s) => s.isMaster === wantMaster);
    if (exists) return fail(wantMaster ? "地上世界已存在，仅支持各一个" : "地下世界已存在，仅支持各一个");
    // 检查是否有不兼容洞穴的地图模组已启用
    if (!wantMaster) {
      const master = shards.find((s) => s.isMaster);
      if (master) {
        for (const [key, e] of readModOverrides(master.name)) {
          if (!e.enabled) continue;
          const id = key.replace("workshop-", "");
          const d = modWorldgenData(id);
          if (!d) continue;
          const hasCavePreset = d.presets.some((p) => /volcano|cave|under/i.test(p.location || ""));
          const hasOverworldPreset = d.presets.some((p) => !/volcano|cave|under/i.test(p.location || ""));
          if (hasOverworldPreset && !hasCavePreset) {
            const name = modCache.items[id]?.title || parseModInfo(id)?.name || id;
            return fail(`已启用地图模组「${name}」不支持地下世界，无法添加洞穴分片。该模组的世界（如猪镇）不需要地下世界。`);
          }
        }
      }
    }
    const name = wantMaster ? "Master" : "Caves";
    const dir = shardDir(name);
    if (existsSync(dir)) return fail("目录已存在: " + name);
    mkdirSync(dir, { recursive: true });
    const ini = wantMaster
      ? `[NETWORK]\nserver_port = 11000\n\n[SHARD]\nis_master = true\n\n[STEAM]\nmaster_server_port = 27018\nauthentication_port = 8768\n\n[ACCOUNT]\nencode_user_path = true\n`
      : `[NETWORK]\nserver_port = 11001\n\n[SHARD]\nis_master = false\nname = Caves\n\n[STEAM]\nmaster_server_port = 27019\nauthentication_port = 8769\n\n[ACCOUNT]\nencode_user_path = true\n`;
    writeFileSync(join(dir, "server.ini"), ini);
    return ok(null, `已创建${wantMaster ? "地上" : "地下"}世界 ${name}，请记得保存世界设置`);
  }
  if (path === "worlds/delete" && method === "POST") {
    const b = await bodyJson(req);
    const shard = String(b.shard || "");
    const target = listShards().find((s) => s.name === shard);
    if (!target) return fail("世界不存在");
    if (await shardRunning(shard)) return fail("该世界正在运行，禁止删除，请先关闭服务器");
    rmSync(shardDir(shard), { recursive: true, force: true });
    return ok(null, `已删除世界 ${shard}`);
  }
  if (path === "world/overrides" && method === "GET") {
    const shard = url.searchParams.get("shard") || "";
    const target = listShards().find((s) => s.name === shard);
    if (!target) return fail("世界不存在");
    const { overrides, presets } = readLevelOverrides(shard);
    // 检测是否有启用的世界生成模组，区分替换型和兼容型
    const worldgenModInfo = listShards().length > 0 && (() => {
      for (const s of listShards()) {
        for (const [key, e] of readModOverrides(s.name)) {
          if (!e.enabled) continue;
          const modId = key.replace("workshop-", "");
          const d = modWorldgenData(modId);
          if (d && (d.options.length || d.presets.length)) {
            // 判断是否替换型（完全替换世界生成，原版设置不适用）
            // 替换型：有 AddLevel/AddPreset/LEVELTYPE 定义，或有明确的非原版预设
            // 兼容型：仅有 AddLevelPreInitAny（在原版基础上扩展），原版设置仍适用
            const mwPath = join(ugcSharedDir(), modId, "modworldgenmain.lua");
            const mwText = existsSync(mwPath) ? readText(mwPath) : "";
            const isReplace = /AddLevel\s*\(\s*LEVELTYPE\.|AddWorldGenLevel\s*\(\s*LEVELTYPE\.|AddPreset\s*\(/.test(mwText)
              || d.presets.some((p) => !VANILLA_PRESETS.has(p.id));
            if (isReplace) return { replace: true };
            return { replace: false, extend: true };
          }
        }
      }
      return null;
    })();
    const hasWorldgenMod = !!worldgenModInfo;
    const hasReplaceWorldgenMod = worldgenModInfo?.replace === true;
    return ok({ shard, isMaster: target.isMaster, overrides, presets, options: worldOptionTable(target.isMaster), hasWorldgenMod, hasReplaceWorldgenMod });
  }
  if (path === "world/modworldgen" && method === "GET") {
    const shard = url.searchParams.get("shard") || "";
    const target = listShards().find((s) => s.name === shard);
    if (!target) return fail("世界不存在");
    const mods: any[] = [];
    for (const [key, e] of readModOverrides(shard)) {
      if (!e.enabled) continue;
      const id = key.replace("workshop-", "");
      const d = modWorldgenData(id);
      if (!d) continue;
      // 为 modConfig 选项附加当前配置值（从 modoverrides.lua 读取）
      const enriched = d.options.map((o) => {
        if (o.modConfig) {
          const current = e.options[o.key] !== undefined ? e.options[o.key] : o.default;
          return { ...o, current: String(current) };
        }
        return o;
      });
      mods.push({ id, ...d, options: enriched });
    }
    return ok({ mods });
  }
  if (path === "world/overrides" && method === "POST") {
    const b = await bodyJson(req);
    const shard = String(b.shard || "");
    const target = listShards().find((s) => s.name === shard);
    if (!target) return fail("世界不存在");
    const table = worldOptionTable(target.isMaster);
    const allowed = new Map(table.map((o) => [o.key, new Set(o.values.map((v) => v.v))]));
    // 已启用大型地图模组提供的世界设置项
    const modAllowed = enabledModWorldgenOptions(shard);
    // 已启用模组的 modConfig 配置驱动型选项（写入 modoverrides.lua）
    const modConfigAllowed = enabledModConfigOptions(shard);
    const current = readLevelOverrides(shard).overrides;
    const incoming = b.overrides && typeof b.overrides === "object" ? b.overrides : {};
    // 需要写入 modoverrides.lua 的 modConfig 选项
    const modConfigUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!validKeyVal(k)) continue;
      // 优先：modConfig 选项（配置驱动型模组，写入 modoverrides.lua）
      if (modConfigAllowed.has(k)) {
        // modConfig 值可以是数字/布尔/字符串
        const val = typeof v === "boolean" || typeof v === "number" ? v : (validWorldVal(String(v)) ? v : null);
        if (val !== null) modConfigUpdates[k] = val;
        continue;
      }
      // 原版世界设置项
      if (allowed.has(k)) {
        if (!validWorldVal(String(v))) continue;
        if (allowed.get(k)!.has(String(v))) current[k] = String(v);
        continue;
      }
      // 模组世界生成选项（写入 worldgenoverride.lua）
      if (modAllowed.has(k)) {
        if (!validWorldVal(String(v))) continue;
        if (modAllowed.get(k)!.has(String(v))) current[k] = String(v);
        continue;
      }
    }
    // 写入 modConfig 选项到 modoverrides.lua（对应模组）
    if (Object.keys(modConfigUpdates).length > 0) {
      for (const [key, e] of readModOverrides(shard)) {
        if (!e.enabled) continue;
        const d = modWorldgenData(key.replace("workshop-", ""));
        if (!d) continue;
        const hasTarget = d.options.some((o) => o.modConfig && o.key in modConfigUpdates);
        if (!hasTarget) continue;
        const map = readModOverrides(shard);
        const entry = map.get(key) || { enabled: true, options: {} };
        for (const opt of d.options) {
          if (opt.modConfig && opt.key in modConfigUpdates) entry.options[opt.key] = modConfigUpdates[opt.key];
        }
        map.set(key, entry);
        writeFileSync(join(shardDir(shard), "modoverrides.lua"), serializeModOverrides(map) + "\n");
      }
    }
    // 应用模组关卡预设（海难/哈姆雷特等）：worldgen_preset=世界类型，settings_preset=模式难度，可分别设置并合并预设自带 overrides
    const presetOwner = (pid: string): string | null => {
      for (const [key] of readModOverrides(shard)) {
        const d = modWorldgenData(key.replace("workshop-", ""));
        if (d?.presets.some((p) => p.id === pid)) return key;
      }
      for (const id of allModIds()) {
        const d = modWorldgenData(id);
        if (d?.presets.some((p) => p.id === pid)) return `workshop-${id}`;
      }
      return null;
    };
    const ensureModEnabled = (wsKey: string): boolean => {
      const id = wsKey.replace("workshop-", "");
      let changed = false;
      for (const sh of listShards()) {
        const map = readModOverrides(sh.name);
        const entry = map.get(wsKey);
        if (!entry?.enabled) {
          map.set(wsKey, { enabled: true, options: entry?.options || {} });
          writeFileSync(join(shardDir(sh.name), "modoverrides.lua"), serializeModOverrides(map) + "\n");
          changed = true;
        }
      }
      if (changed) {
        const ids = readSetupIds();
        if (!ids.includes(id)) { ids.push(id); writeSetupIds(ids); }
      }
      return changed;
    };
    const mergePresetOverrides = (pid: string) => {
      for (const [key, e] of readModOverrides(shard)) {
        if (!e.enabled) continue;
        const d = modWorldgenData(key.replace("workshop-", ""));
        const p = d?.presets.find((x) => x.id === pid);
        if (p) {
          for (const [k, v] of Object.entries(p.overrides)) {
            if (validKeyVal(k) && validWorldVal(v)) current[k] = String(v);
          }
        }
      }
    };
    const autoLoaded: string[] = [];
    let presetArg: string | { worldgen?: string; settings?: string } | undefined;
    if (typeof b.preset === "string" && /^[A-Za-z0-9_]{1,64}$/.test(b.preset)) {
      presetArg = b.preset;
      mergePresetOverrides(b.preset);
      const owner = presetOwner(b.preset);
      if (owner && ensureModEnabled(owner)) autoLoaded.push(modCache.items[owner.replace("workshop-", "")]?.title || owner);
    } else {
      const wg = typeof b.worldgen_preset === "string" && /^[A-Za-z0-9_]{1,64}$/.test(b.worldgen_preset) ? b.worldgen_preset : "";
      const st = typeof b.settings_preset === "string" && /^[A-Za-z0-9_]{1,64}$/.test(b.settings_preset) ? b.settings_preset : "";
      if (wg) mergePresetOverrides(wg);
      if (st) mergePresetOverrides(st);
      if (wg || st) presetArg = { worldgen: wg || undefined, settings: st || undefined };
      for (const pid of [wg, st]) {
        if (pid) {
          const owner = presetOwner(pid);
          if (owner && ensureModEnabled(owner) && !autoLoaded.length) autoLoaded.push(modCache.items[owner.replace("workshop-", "")]?.title || owner);
        }
      }
      // 模式难度统一同步到 cluster.ini 的 game_mode（轻松/无尽/荒野/暗无天日/生存）
      if (st) {
        const modeMap: [RegExp, string][] = [
          [/SURVIVAL_TOGETHER$/, "survival"],
          [/RELAXED$/, "relaxed"],
          [/ENDLESS$/, "endless"],
          [/WILDERNESS$/, "wilderness"],
          [/LIGHTS_?OUT$/, "lightsout"],
          [/LAVAARENA$/, "lavaarena"],
          [/QUAGMIRE$/, "quagmire"],
        ];
        const hit = modeMap.find(([re]) => re.test(st));
        if (hit) {
          const iniPath = join(clusterDir(), "cluster.ini");
          const lines = iniSet(parseIni(readText(iniPath)), "GAMEPLAY", "game_mode", hit[1]);
          writeFileSync(iniPath, iniToText(lines) + "\n");
        }
      }
    }
    // 模组世界：保存时只保留对应模组的世界设置项与预设自带参数（不混入原版残留项）
    const finalWg = (typeof presetArg === "object" && presetArg?.worldgen) || (typeof presetArg === "string" ? presetArg : "") || readLevelOverrides(shard).presets.worldgen;
    if (finalWg && !VANILLA_PRESETS.has(finalWg)) {
      const keep = new Set<string>();
      const owner = presetOwner(finalWg);
      if (owner) {
        const d = modWorldgenData(owner.replace("workshop-", ""));
        if (d) {
          for (const o of d.options) keep.add(o.key);
          const p = d.presets.find((x) => x.id === finalWg);
          if (p) for (const k of Object.keys(p.overrides)) keep.add(k);
        }
      }
      if (keep.size) {
        for (const k of Object.keys(current)) if (!keep.has(k)) delete current[k];
      }
    }
    writeLevelOverrides(shard, target.isMaster, current, presetArg);
    return ok(null, `已保存 ${shard} 的世界设置（每设置完一个世界之后，都需要点击保存）` + (autoLoaded.length ? `；已自动加载模组: ${autoLoaded.join("、")}` : ""));
  }

  // ===== mod 设置 =====
  if (path === "mods" && method === "GET") {
    const force = url.searchParams.get("refresh") === "1";
    const { list, steamOk } = await buildModList(force);
    return ok({ mods: list, steamOk, cacheTime: modCache.time });
  }
  if (path === "mods/query" && method === "POST") {
    const b = await bodyJson(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids.filter(validId).slice(0, 20) : [];
    if (!ids.length) return fail("请提供合法的模组 ID");
    const r = await querySteam(ids);
    if (!r.ok) return fail("Steam API 请求失败: " + (r.msg || ""));
    Object.assign(modCache.items, r.items);
    modCache.time = Date.now();
    saveModCache();
    const found = ids.filter((id) => modCache.items[id]);
    const missing = ids.filter((id) => !modCache.items[id]);
    return ok({ items: found.map((id) => modCache.items[id]), missing });
  }
  if (path === "mods/detail" && method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!validId(id)) return fail("非法 ID");
    await ensureSteamCache([id]);
    const st = modCache.items[id];
    let mi = parseModInfo(id);
    // modinfo.lua 不在本地 → 静默尝试仅下载 modinfo.lua（不通知用户）
    let modinfoAutoFetched = false;
    if (!mi) {
      modinfoAutoFetched = await fetchModInfoLua(id);
      if (modinfoAutoFetched) mi = parseModInfo(id);
    }
    // 当前值（以 Master modoverrides 为准）
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    const ov = master ? readModOverrides(master.name).get(`workshop-${id}`) : undefined;
    const options = (mi?.configOptions || []).map((o) => ({
      ...o,
      // 配置项前端中文翻译（中文语言包/官方 po 查不到时保留英文）
      label_zh: zhText(o.label),
      hover_zh: zhText(o.hover),
      options: o.options.map((op) => ({ ...op, description_zh: zhText(typeof op.description === "string" ? op.description : String(op.description)) })),
      current: ov && o.name in ov.options ? ov.options[o.name] : o.default,
    }));
    const changelogs = await fetchChangeLogs(id);
    // ---------- 安装详情 ----------
    const localIds = new Set(localModDirs());
    const isDownloaded = localIds.has(id);
    const localVersion = mi?.version || "";
    const dlAt = modDownloadedAt(id);
    const updateAvail = !!st && st.time_updated > 0 && dlAt > 0 && st.time_updated * 1000 > dlAt;
    // 检测本地关键文件
    const localFiles: Record<string, boolean> = {};
    const modDir = join(ugcSharedDir(), id);
    if (existsSync(modDir) && statSync(modDir).isDirectory()) {
      for (const f of ["modinfo.lua", "modmain.lua", "modworldgenmain.lua"]) {
        localFiles[f] = existsSync(join(modDir, f));
      }
    }
    // 异常检测
    const anomalies: string[] = [];
    if (!isDownloaded) anomalies.push("模组未下载到本地");
    if (isDownloaded && !mi) anomalies.push("已下载但 modinfo.lua 缺失或解析失败");
    if (mi && mi.dstCompatible === false) anomalies.push("模组标记为不兼容 DST");
    if (updateAvail) anomalies.push("有新版本可更新");
    if (isDownloaded && mi && !localFiles["modmain.lua"] && !localFiles["modworldgenmain.lua"]) anomalies.push("缺少 modmain.lua / modworldgenmain.lua（可能仅客户端模组）");
    return ok({
      id,
      title: st?.title || "",
      description: st?.description || "",
      preview_url: st?.preview_url || "",
      subscriptions: st?.subscriptions || 0,
      lifetime_subscriptions: st?.lifetime_subscriptions || 0,
      favorited: st?.favorited || 0,
      views: st?.views || 0,
      update_date: st?.time_updated ? formatDate(st.time_updated) : "",
      changelogs,
      modinfo: mi ? { name: mi.name, version: mi.version, clientOnly: mi.clientOnly, allClientsRequire: mi.allClientsRequire, dstCompatible: mi.dstCompatible } : null,
      enabled: ov?.enabled === true,
      options,
      // 安装详情
      installed: {
        downloaded: isDownloaded,
        modinfoAutoFetched,
        localVersion,
        downloadedAt: dlAt ? new Date(dlAt).toISOString().slice(0, 19).replace("T", " ") : "",
        updateAvailable: updateAvail,
        localFiles,
        anomalies,
      },
    });
  }
  if (path === "mods/save-enabled" && method === "POST") {
    const b = await bodyJson(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids.filter(validId) : [];
    const enabledSet = new Set(ids);
    // 冲突检测：替换世界生成的模组（AddLevel/PRESETLEVELS）同时只能启用一个
    // 注意：仅用 AddLevelPreInitAny 修改现有关卡的模组（如三合一）不算冲突
    const worldModIds = ids.filter((id) => {
      const mw = join(ugcSharedDir(), id, "modworldgenmain.lua");
      if (!existsSync(mw)) return false;
      const text = readText(mw);
      // 有 AddLevel/AddPreset/LEVELTYPE 调用 = 替换型世界生成
      // 仅有 AddLevelPreInitAny = 兼容型修改，不冲突
      return /AddLevel\s*\(|AddPreset\s*\(|LEVELTYPE\.\w+\s*,\s*\{/.test(text) && !text.includes("AddLevelPreInitAny");
    });
    if (worldModIds.length > 1) {
      const names = worldModIds.map((id) => modCache.items[id]?.title || parseModInfo(id)?.name || id).join("、");
      return fail(`检测到大型地图模组冲突，不能一起开启：${names}。这些模组都会替换世界生成，请只保留一个（"三合一"类模组本身包含多生态，算一个）。`);
    }
    // 保留已有配置，未勾选的省略
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    const old = master ? readModOverrides(master.name) : new Map<string, ModOverrideEntry>();
    const map = new Map<string, ModOverrideEntry>();
    for (const id of ids) {
      const key = `workshop-${id}`;
      map.set(key, { enabled: true, options: old.get(key)?.options || {} });
    }
    writeSetupIds(ids);
    writeModOverridesBoth(map);
    const omitted = [...old.keys()].filter((k) => !enabledSet.has(k.replace("workshop-", "")));
    // 检测启用的地图模组是否有洞穴预设
    const activeWorldMods = ids.filter((id) => {
      const d = modWorldgenData(id);
      if (!d) return false;
      const hasCavePreset = d.presets.some((p) => /volcano|cave|under/i.test(p.location || ""));
      const hasOverworldPreset = d.presets.some((p) => !/volcano|cave|under/i.test(p.location || ""));
      // 只有地上预设、没有洞穴预设 = 纯地上地图模组（如猪镇）
      return hasOverworldPreset && !hasCavePreset;
    });
    // 自动删除不支持的 Caves 分片
    let cavesRemoved = false;
    if (activeWorldMods.length) {
      const shards = listShards();
      const cavesShard = shards.find((s) => !s.isMaster);
      if (cavesShard) {
        if (await shardRunning(cavesShard.name)) return fail(`正在启用的地图模组不支持地下世界，请先关闭服务器再保存`);
        try { rmSync(shardDir(cavesShard.name), { recursive: true, force: true }); cavesRemoved = true; } catch {}
      }
    }
    // 大型地图模组（海难/哈姆雷特/三合一等）：新启用时自动应用对应世界预设
    const autoApplied: string[] = [];
    // VANILLA_PRESETS 已在文件顶部定义为全局常量
    const pickPreset = (presets: ModWorldgenPreset[], isMaster: boolean): ModWorldgenPreset | null => {
      const isCaveLoc = (l: string) => /volcano|cave|under/i.test(l || "");
      if (isMaster) {
        return presets.find((p) => /SURVIVAL_TOGETHER/i.test(p.id) && !isCaveLoc(p.location))
          || presets.find((p) => !isCaveLoc(p.location))
          || null;
      }
      return presets.find((p) => isCaveLoc(p.location)) || null;
    };
    for (const id of ids) {
      const key = `workshop-${id}`;
      if (old.get(key)?.enabled) continue; // 只处理新启用的
      const d = modWorldgenData(id);
      if (!d || !d.presets.length) continue;
      for (const shard of listShards()) {
        const cur = readLevelOverrides(shard.name).presets.worldgen;
        if (!VANILLA_PRESETS.has(cur)) continue; // 已是模组预设则不覆盖
        const pick = pickPreset(d.presets, shard.isMaster);
        if (!pick) continue;
        const ov = readLevelOverrides(shard.name).overrides;
        for (const [k, v] of Object.entries(pick.overrides)) {
          if (validKeyVal(k) && validWorldVal(v)) ov[k] = String(v);
        }
        writeLevelOverrides(shard.name, shard.isMaster, ov, pick.id);
        autoApplied.push(`${shard.name}→${pick.id}`);
      }
    }
    return ok(null, `已保存所选（启用 ${ids.length} 个模组）` + (omitted.length ? `；未勾选的 ${omitted.length} 个模组配置已省略` : "") + (autoApplied.length ? `；已自动应用大型模组预设: ${autoApplied.join("、")}` : ""));
  }
  if (path === "mods/config" && method === "POST") {
    const b = await bodyJson(req);
    if (!validId(b.id)) return fail("非法 ID");
    const key = `workshop-${b.id}`;
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    const map = master ? readModOverrides(master.name) : new Map<string, ModOverrideEntry>();
    const entry = map.get(key) || { enabled: true, options: {} };
    const opts = b.options && typeof b.options === "object" ? b.options : {};
    for (const [k, v] of Object.entries(opts)) {
      if (!validKeyVal(k)) continue;
      if (["string", "number", "boolean"].includes(typeof v)) entry.options[k] = v;
    }
    map.set(key, entry);
    writeModOverridesBoth(map);
    return ok(null, "已保存修改（两个分片的 modoverrides.lua 均已更新）");
  }
  if (path === "mods/add" && method === "POST") {
    const b = await bodyJson(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String) : [String(b.id || "")];
    const valid = [...new Set(ids)].filter((x) => /^\d{4,15}$/.test(x));
    if (!valid.length) return fail("非法模组 ID");
    await ensureSteamCache(valid, true);
    const missing = valid.filter((id) => !modCache.items[id]);
    const cur = readSetupIds();
    const added: string[] = [];
    for (const id of valid) {
      if (!modCache.items[id]) continue;
      if (!cur.includes(id)) { cur.push(id); added.push(id); }
    }
    writeSetupIds(cur);
    const names = added.map((id) => modCache.items[id]?.title || id).join("、");
    return ok({ added, missing }, missing.length
      ? `已添加 ${added.length} 个（${names}）；未找到 ${missing.length} 个: ${missing.join(", ")}`
      : added.length ? `已添加 ${added.length} 个模组（${names}），重启服务器自动下载，也可点"批量下载"` : "这些模组已在下载列表中");
  }
  if (path === "mods/delete" && method === "POST") {
    const b = await bodyJson(req);
    if (!validId(b.id)) return fail("非法模组 ID");
    // 1. 删除本地文件（mods/workshop-xxx）
    const dir = join(MODS_DIR, `workshop-${b.id}`);
    if (existsSync(dir)) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
    // 1b. 删除 ugc_mods 目录
    for (const c of ugcContentDirs()) {
      const u = join(c, String(b.id));
      if (existsSync(u)) { try { rmSync(u, { recursive: true, force: true }); } catch {} }
    }
    // 2. 从 dedicated_server_mods_setup.lua 移除
    const cur = readSetupIds().filter((x) => x !== String(b.id));
    writeSetupIds(cur);
    // 3. 从所有分片的 modoverrides.lua 移除
    for (const shard of listShards()) {
      const map = readModOverrides(shard.name);
      const key = `workshop-${b.id}`;
      if (map.has(key)) { map.delete(key); writeFileSync(join(shardDir(shard.name), "modoverrides.lua"), serializeModOverrides(map)); }
    }
    return ok(null, `已取消订阅模组 ${b.id}（已删除本地文件并从配置中移除）`);
  }
  if (path === "mods/favorite" && method === "POST") {
    const b = await bodyJson(req);
    if (!validId(b.id)) return fail("非法模组 ID");
    const fav = b.fav !== false;
    const set = new Set(panelConfig.favorites);
    if (fav) set.add(String(b.id)); else set.delete(String(b.id));
    panelConfig.favorites = [...set];
    savePanelConfig();
    return ok({ favorites: panelConfig.favorites }, fav ? "已收藏，将置顶显示" : "已取消收藏");
  }
  if (path === "mods/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return fail("请输入搜索关键词");
    try {
      const results = await workshopSearch(q);
      // 批量补全订阅数/更新时间（走 GetPublishedFileDetails + 6 小时缓存，网络失败不影响基础结果）
      try { await ensureSteamCache(results.map((r) => r.id)); } catch {}
      const enriched = results.map((r) => {
        const st = modCache.items[r.id];
        return { ...r, subscriptions: st?.subscriptions || 0, time_updated: st?.time_updated || 0 };
      });
      return ok({ results: enriched });
    } catch (e: any) {
      return fail("搜索失败（网络问题？）: " + String(e?.message || e));
    }
  }
  if (path === "mods/fetch-modinfo" && method === "POST") {
    const b = await bodyJson(req);
    if (!validId(b.id)) return fail("非法模组 ID");
    await ensureSteamCache([String(b.id)]);
    const success = await fetchModInfoLua(String(b.id));
    return ok({ success }, success ? "modinfo.lua 已下载" : "下载失败（无 CDN 直链或网络问题）");
  }
  if (path === "mods/download" && method === "POST") {
    const b = await bodyJson(req);
    const ids: string[] = Array.isArray(b.ids) ? b.ids.map(String) : (validId(b.id) ? [String(b.id)] : []);
    const valid = [...new Set(ids)].filter((x) => /^\d{4,15}$/.test(x));
    if (!valid.length) return fail("非法模组 ID");
    await ensureSteamCache(valid);
    const ts = enqueueDownloads(valid);
    return ok({ taskIds: ts.map((t) => t.id) }, `已加入下载队列 ${ts.length} 个模组（并行 ${MAX_PARALLEL} 个）`);
  }
  if (path === "mods/update-all" && method === "POST") {
    const ids = readSetupIds();
    if (!ids.length) return fail("没有已启用/已添加的模组");
    await ensureSteamCache(ids);
    const ts = enqueueDownloads(ids);
    return ok({ taskIds: ts.map((t) => t.id) }, `已加入更新队列 ${ts.length} 个模组`);
  }
  if (path === "tasks" && method === "GET") {
    const list = [...tasks.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 50)
      .map((t) => ({ id: t.id, modId: t.modId, label: t.label, status: t.status, totalBytes: t.totalBytes, downloadedBytes: t.downloadedBytes, startedAt: t.startedAt, finishedAt: t.finishedAt }));
    return ok({ tasks: list });
  }
  if (path === "task" && method === "GET") {
    const t = tasks.get(url.searchParams.get("id") || "");
    if (!t) return fail("任务不存在");
    return ok({ id: t.id, modId: t.modId, label: t.label, status: t.status, log: t.log.slice(-6000), totalBytes: t.totalBytes, downloadedBytes: t.downloadedBytes, startedAt: t.startedAt, finishedAt: t.finishedAt });
  }

  if (path === "task/delete" && method === "POST") {
    const b = await bodyJson(req);
    const tid = String(b.id || "");
    const t = tasks.get(tid);
    if (!t) return fail("任务不存在");
    if (t.status === "queued" || t.status === "running") return fail("任务进行中，无法删除");
    tasks.delete(tid);
    return ok(null, "已删除任务记录");
  }
  if (path === "task/clear" && method === "POST") {
    let n = 0;
    for (const [k, t] of tasks) {
      if (t.status !== "queued" && t.status !== "running") { tasks.delete(k); n++; }
    }
    return ok(null, `已清空 ${n} 条任务记录`);
  }

  // ===== 皮肤设置：上传自定义登录背景图 =====
  if (path === "skin/bg" && method === "POST") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength < 1024) return fail("文件太小，不是有效图片");
    if (buf.byteLength > 8 * 1024 * 1024) return fail("图片不能超过 8MB");
    const head = new Uint8Array(buf.slice(0, 4));
    const isJpeg = head[0] === 0xff && head[1] === 0xd8;
    const isPng = head[0] === 0x89 && head[1] === 0x50;
    if (!isJpeg && !isPng) return fail("只支持 JPG/PNG 图片");
    writeFileSync(join(PUBLIC_DIR, "bg", "custom.jpg"), Buffer.from(buf));
    return ok(null, "自定义背景图已上传（登录页背景选「自定义」即可使用）");
  }

  // ===== 身份看门狗（dst-steam-guard）开关 =====
  if (path === "guard" && method === "GET") {
    const active = await run(["sudo", "-n", "systemctl", "is-active", "dst-steam-guard.timer"]);
    const enabled = await run(["sudo", "-n", "systemctl", "is-enabled", "dst-steam-guard.timer"]);
    return ok({ running: active.out.trim() === "active", enabled: enabled.out.trim() === "enabled" });
  }
  if (path === "guard" && method === "POST") {
    const b = await bodyJson(req);
    const on = !!b.on;
    const r = await run(["sudo", "-n", "systemctl", on ? "start" : "stop", "dst-steam-guard.timer"]);
    if (r.code !== 0) return fail("操作失败: " + r.out.slice(-300));
    return ok(null, on ? "看门狗已开启（每分钟巡检，非 steam 进程会被清理）" : "看门狗已关闭");
  }

  // ===== 服务器管理 =====
  if (path === "server/status" && method === "GET") {
    const shards = listShards();
    for (const s of shards) s.running = await shardRunning(s.name);
    // 获取 DST 进程内存
    const dstMem = getDstProcessMemory();
    // 系统内存
    const sysMem = getSystemMemory();
    const memLimit = sysMem.total > 1024 ? sysMem.total - 1024 : 0;
    return ok({ shards, autorestart: panelConfig.autorestart, mode: panelConfig.mode, langCheck: panelConfig.langCheck, dstMem, sysMem, memLimit });
  }
  if (path === "server/start" && method === "POST") {
    const shards = listShards();
    if (!shards.length) return fail("当前存档没有任何世界分片");
    // 资源检查
    const res = checkResources();
    if (!res.ok) return fail(res.msg, 200);
    const msgs: string[] = [];
    for (const s of shards) {
      if (await shardRunning(s.name)) { msgs.push(`${s.name}: 已在运行`); continue; }
      const r = await startShard(s.name);
      msgs.push(`${s.name}: ${r === "ok" ? "已启动" : "启动失败 " + r}`);
    }
    return ok(null, msgs.join("；"));
  }
  if (path === "server/stop" && method === "POST") {
    for (const s of listShards()) await stopShard(s.name);
    return ok(null, "已发送关闭指令");
  }
  if (path === "server/restart" && method === "POST") {
    const shards = listShards();
    for (const s of shards) await stopShard(s.name);
    await sleep(3000);
    const res = checkResources();
    if (!res.ok) return fail(res.msg, 200);
    const msgs: string[] = [];
    for (const s of shards) {
      const r = await startShard(s.name);
      msgs.push(`${s.name}: ${r === "ok" ? "已启动" : "启动失败 " + r}`);
    }
    return ok(null, "重启完成：" + msgs.join("；"));
  }
  if (path === "server/autorestart" && method === "POST") {
    const b = await bodyJson(req);
    if (typeof b.on === "boolean") panelConfig.autorestart = !!b.on;
    savePanelConfig();
    return ok(null, panelConfig.autorestart ? "已开启自动重启（每 30 秒检查）" : "已关闭自动重启");
  }
  if (path === "server/mode" && method === "POST") {
    const b = await bodyJson(req);
    panelConfig.mode = b.mode === "offline" ? "offline" : "online";
    savePanelConfig();
    return ok(null, `已切换为${panelConfig.mode === "offline" ? "离线" : "在线"}模式，重启服务器后生效`);
  }
  // ===== 汉化模组检测与配置 =====
  const LANG_MODS = ["1301033176", "367546858"]; // 服务器汉化 / 客户端汉化（任一启用即可）
  const LANG_SERVER_MOD = "1301033176";          // 专用服务器汉化（推荐）
  const LANG_CNPLUS_MOD = "1418746242";          // Chinese++ 模组信息翻译
  if (path === "server/lang-check" && method === "GET") {
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    if (!master) return ok({ needSetup: false, msg: "没有世界分片" });
    const ov = readModOverrides(master.name);
    const enabled: string[] = [];
    for (const id of LANG_MODS) {
      const e = ov.get(`workshop-${id}`);
      if (e?.enabled) enabled.push(id);
    }
    const localIds = new Set(localModDirs());
    const downloaded = [LANG_SERVER_MOD, LANG_CNPLUS_MOD, ...LANG_MODS].filter((id) => localIds.has(id));
    const langSetting = String(ov.get(`workshop-${LANG_MODS[1]}`)?.options?.LANG || ov.get(`workshop-${LANG_SERVER_MOD}`)?.options?.LANG || "simplified");
    const needSetup = enabled.length === 0;
    return ok({ enabled, downloaded, langSetting, needSetup, langCheck: panelConfig.langCheck });
  }
  if (path === "server/lang-setup" && method === "POST") {
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    if (!master) return fail("没有世界分片");
    const localIds = new Set(localModDirs());
    const msgs: string[] = [];
    // 1. 下载缺失的模组
    const toDownload = [LANG_SERVER_MOD, LANG_CNPLUS_MOD].filter((id) => !localIds.has(id));
    if (toDownload.length) {
      await ensureSteamCache(toDownload);
      enqueueDownloads(toDownload);
      msgs.push(`已加入下载队列：${toDownload.join(", ")}`);
    }
    // 2. 启用模组 + 设置 LANG=simplified（所有分片）
    for (const shard of listShards()) {
      const map = readModOverrides(shard.name);
      // 启用服务器汉化
      const srvEntry = map.get(`workshop-${LANG_SERVER_MOD}`) || { enabled: false, options: {} };
      srvEntry.enabled = true;
      srvEntry.options.LANG = "simplified";
      map.set(`workshop-${LANG_SERVER_MOD}`, srvEntry);
      // 启用 Chinese++
      const cppEntry = map.get(`workshop-${LANG_CNPLUS_MOD}`) || { enabled: false, options: {} };
      cppEntry.enabled = true;
      map.set(`workshop-${LANG_CNPLUS_MOD}`, cppEntry);
      writeFileSync(join(shardDir(shard.name), "modoverrides.lua"), serializeModOverrides(map) + "\n");
    }
    // 3. 添加到 dedicated_server_mods_setup.lua
    const setupIds = new Set(readSetupIds());
    setupIds.add(LANG_SERVER_MOD);
    setupIds.add(LANG_CNPLUS_MOD);
    writeSetupIds([...setupIds]);
    msgs.push("已启用服务器汉化（1301033176）+ Chinese++（1418746242），语言设为简体中文");
    return ok(null, msgs.join("；"));
  }
  if (path === "server/lang-check-toggle" && method === "POST") {
    panelConfig.langCheck = !panelConfig.langCheck;
    savePanelConfig();
    return ok({ on: panelConfig.langCheck }, panelConfig.langCheck ? "已开启汉化检测" : "已关闭汉化检测");
  }
  // 暂停/继续服务器（世界时间冻结/恢复），通过 Master 的 ms_serverpause 事件实现
  if (path === "server/pause" && method === "POST") {
    const b = await bodyJson(req);
    const pause = !!b.pause;
    const shards = listShards();
    const master = shards.find((s) => s.isMaster) || shards[0];
    if (!master) return fail("当前存档没有任何世界分片");
    if (!(await shardRunning(master.name))) return fail("服务器未运行");
    const sent = await sendLua(master.name, `pcall(function() TheWorld:PushEvent("ms_serverpause", {paused=${pause}}) end)`);
    if (!sent) return fail("发送失败（服务器可能还在启动中）");
    return ok({ paused: pause }, pause
      ? "已发送暂停指令：世界时间冻结（玩家仍在游戏内，作物/生物/昼夜停止）"
      : "已发送继续指令：世界时间恢复流动");
  }
  // 暂停状态查询（best-effort：读 TheWorld.ispaused，读不到就返回 null 不显示）
  if (path === "server/pausestate" && method === "GET") {
    const shards = listShards();
    const master = shards.find((s) => s.isMaster) || shards[0];
    if (!master || !(await shardRunning(master.name))) return ok({ paused: null });
    const tail = await execAndCapture(master.name, `print("DSTPANEL".."_".."PS:"..tostring(TheWorld.ispaused))`);
    const m = tail.match(/DSTPANEL_PS:(\w+)/);
    if (!m || (m[1] !== "true" && m[1] !== "false")) return ok({ paused: null });
    return ok({ paused: m[1] === "true" });
  }
  if ((path === "server/adminlist" || path === "server/blocklist")) {
    const file = join(clusterDir(), path.endsWith("adminlist") ? "adminlist.txt" : "blocklist.txt");
    if (method === "GET") {
      const content = readText(file);
      const nameMap = new Map<string, string>();
      try { for (const p of parsePlayers()) if (p.id) nameMap.set(p.id, p.name); } catch {}
      const entries = content.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        .map((line) => {
          const m = line.match(/^([A-Za-z0-9_-]+)(?:\s*#\s*(.*))?$/);
          if (!m) return null;
          return { id: m[1], name: nameMap.get(m[1]) || "(未知)", note: m[2] || "" };
        })
        .filter(Boolean);
      return ok({ content, entries });
    }
    const b = await bodyJson(req);
    // entries 模式：带备注的对象数组
    if (Array.isArray(b.entries)) {
      const lines = b.entries.filter((e: any) => e && e.id).map((e: any) => {
        const id = String(e.id).trim();
        const note = String(e.note || "").trim().replace(/[\r\n#]/g, " ");
        return note ? `${id} # ${note}` : id;
      });
      for (const l of lines) {
        const id = l.split("#")[0].trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail(`非法 ID: ${id}`);
      }
      writeFileSync(file, lines.join("\n") + (lines.length ? "\n" : ""));
      return ok(null, "已保存");
    }
    // 兼容旧模式：纯 ID 文本
    const content = String(b.content ?? "");
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const l of lines) if (!/^[A-Za-z0-9_-]{1,64}$/.test(l)) return fail(`非法行: ${l}`);
    writeFileSync(file, lines.join("\n") + (lines.length ? "\n" : ""));
    return ok(null, "已保存");
  }

  // ===== 控制台 =====
  if (path === "items" && method === "GET") {
    // 原版物品 + 当前存档已启用模组新增的物品（分类：模组物品），附带物品图集位置
    const all: any[] = [...ITEMS];
    const iconMap = itemIconAtlas();
    for (const it of all) (it as any).icon = iconMap.get(it.prefab) || "";
    const seen = new Set(ITEMS.map((i) => i.prefab));
    const enabled = new Set<string>();
    for (const shard of listShards()) {
      for (const [key, e] of readModOverrides(shard.name)) if (e.enabled) enabled.add(key.replace("workshop-", ""));
    }
    for (const id of enabled) {
      for (const it of modItems(id)) {
        if (!seen.has(it.prefab)) {
          seen.add(it.prefab);
          // 模组物品：标记 modId，前端用 /mod-icon?id=<modId>&prefab=<prefab> 获取图标
          all.push({ ...it, icon: "", modId: id });
        }
      }
    }
    return ok(all);
  }
  // ===== 物品使用历史 =====
  if (path === "item-history" && method === "GET") return ok({ history: panelConfig.itemHistory });
  if (path === "item-history/add" && method === "POST") {
    const b = await bodyJson(req);
    const prefab = String(b.prefab || "").trim();
    if (!prefab) return fail("缺少 prefab");
    const h = panelConfig.itemHistory.filter((x) => x !== prefab);
    h.unshift(prefab);
    panelConfig.itemHistory = h.slice(0, 30);
    savePanelConfig();
    return ok({ history: panelConfig.itemHistory });
  }
  if (path === "item-history/delete" && method === "POST") {
    const b = await bodyJson(req);
    const prefab = String(b.prefab || "").trim();
    panelConfig.itemHistory = panelConfig.itemHistory.filter((x) => x !== prefab);
    savePanelConfig();
    return ok({ history: panelConfig.itemHistory });
  }
  if (path === "item-history/clear" && method === "POST") {
    panelConfig.itemHistory = [];
    savePanelConfig();
    return ok({ history: [] });
  }
  if (path === "console/players" && method === "POST") {
    const shards = listShards();
    const master = shards.find((s) => s.isMaster) || shards[0];
    if (!master || !(await shardRunning(master.name))) return fail("服务器未运行");
    // 直接输出玩家名（日志通道 UTF-8 无损），不再需要转义
    const tail = await execAndCapture(master.name, `for _,p in ipairs(AllPlayers) do print("DSTPANEL".."_".."PL:"..tostring(p.userid)..":"..tostring(p.name)) end`);
    const players: { userid: string; name: string }[] = [];
    for (const m of tail.matchAll(/DSTPANEL_PL:([^:\s]+):([^\n\r]+)/g)) {
      players.push({ userid: m[1].trim(), name: m[2].trim() });
    }
    return ok({ players });
  }
  if (path === "console/worldinfo" && method === "POST") {
    const shards = listShards();
    const master = shards.find((s) => s.isMaster) || shards[0];
    if (!master || !(await shardRunning(master.name))) return fail("服务器未运行");
    const tail = await execAndCapture(master.name, `print("DSTPANEL".."_".."WI:"..tostring(TheWorld.state.cycles)..":"..tostring(TheWorld.state.season)..":"..tostring(TheWorld.state.phase)..":"..tostring(TheWorld.state.israining))`);
    const m = tail.match(/DSTPANEL_WI:([^:]*):([^:]*):([^:]*):([^\n\r]*)/);
    if (!m) return fail("未获取到世界信息（服务器可能还在启动中）");
    return ok({ cycles: m[1].trim(), season: m[2].trim(), phase: m[3].trim(), israining: m[4].trim() });
  }
  if (path === "console/exec" && method === "POST") {
    const b = await bodyJson(req);
    const lua = String(b.lua || "").trim();
    if (!lua || lua.length > 3500) return fail("命令为空或过长");
    const shard = String(b.shard || "Master");
    const target = listShards().find((s) => s.name === shard) || listShards()[0];
    if (!target) return fail("没有可用的分片");
    if (!(await shardRunning(target.name))) return fail("服务器未运行");
    const sent = await sendLua(target.name, lua);
    return sent ? ok(null, "命令已发送") : fail("发送失败");
  }

  // ===== 玩家记录 =====
  // ===== 存档管理 =====
  if (path === "saves/list" && method === "GET") {
    // 扫描 Master 分片的 session 目录，从 .meta 文件提取真实游戏天数（cycles）
    // 存档文件名是 snapshot ID（递增序号），不是游戏天数
    const snaps: { snap: number; day: number; mtime: number }[] = [];
    for (const shard of listShards()) {
      const sessRoot = join(shardDir(shard.name), "save", "session");
      if (!existsSync(sessRoot)) continue;
      for (const sess of readdirSync(sessRoot)) {
        const sessDir = join(sessRoot, sess);
        if (!statSync(sessDir).isDirectory()) continue;
        for (const f of readdirSync(sessDir)) {
          if (!/^\d+$/.test(f)) continue;
          const snap = parseInt(f);
          const metaFile = join(sessDir, f + ".meta");
          let day = -1;
          try {
            if (existsSync(metaFile)) {
              const metaText = readFileSync(metaFile, "utf-8").replace(/\0/g, "");
              const m = /cycles\s*=\s*(\d+)/.exec(metaText);
              if (m) day = parseInt(m[1]);
            }
          } catch {}
          if (day < 0) continue; // 跳过没有有效 cycles 的 meta（如初始空 meta）
          try {
            const st = statSync(join(sessDir, f));
            snaps.push({ snap, day, mtime: st.mtimeMs });
          } catch {}
        }
      }
    }
    // 去重：同一个 snapshot ID 可能出现在多个分片中，保留 mtime 最新的
    const snapMap = new Map<number, { day: number; mtime: number }>();
    for (const s of snaps) {
      const ex = snapMap.get(s.snap);
      if (!ex || s.mtime > ex.mtime) snapMap.set(s.snap, { day: s.day, mtime: s.mtime });
    }
    const sorted = [...snapMap.entries()].sort((a, b) => a[0] - b[0]);
    const fmtMtime = (ms: number) => {
      const d = new Date(ms);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const result = sorted.map(([snap, v]) => ({ snap, day: v.day, date: fmtMtime(v.mtime) }));
    const latestSnap = result.length ? result[result.length - 1].snap : 0;
    const latestDay = result.length ? result[result.length - 1].day : 0;
    return ok({ saves: result, latestSnap, latestDay });
  }
  if (path === "saves/rollback" && method === "POST") {
    const b = await bodyJson(req);
    const targetSnap = parseInt(b.snap);
    if (isNaN(targetSnap) || targetSnap < 1) return fail("无效的快照 ID");
    const shards = listShards();
    const master = shards.find((s) => s.isMaster) || shards[0];
    if (!master || !(await shardRunning(master.name))) return fail("服务器未运行");
    // 从存档列表中找到最新快照 ID，计算回档差值
    const snapSet = new Set<number>();
    for (const shard of listShards()) {
      const sessRoot = join(shardDir(shard.name), "save", "session");
      if (!existsSync(sessRoot)) continue;
      for (const sess of readdirSync(sessRoot)) {
        const sessDir = join(sessRoot, sess);
        try { if (!statSync(sessDir).isDirectory()) continue; } catch { continue; }
        for (const f of readdirSync(sessDir)) {
          if (/^\d+$/.test(f) && existsSync(join(sessDir, f + ".meta"))) snapSet.add(parseInt(f));
        }
      }
    }
    const allSnaps = [...snapSet].sort((a, b) => a - b);
    const latestSnap = allSnaps.length ? allSnaps[allSnaps.length - 1] : 0;
    const rollbackCount = latestSnap - targetSnap;
    if (rollbackCount <= 0) return fail("已在或早于该快照");
    const sent = await sendLua(master.name, `c_rollback(${rollbackCount})`);
    return sent ? ok(null, `已回档到快照 ${targetSnap}（回退 ${rollbackCount} 个存档）`) : fail("发送失败");
  }

  if (path === "playerlog" && method === "GET") {
    const players = parsePlayers();
    return ok({ players, count: players.length });
  }
  if (path === "playerlog/detail" && method === "GET") {
    const key = (url.searchParams.get("key") || "").slice(0, 80);
    if (!key) return fail("缺少参数");
    const lines: string[] = [];
    const files = [...serverLogPaths(), chatLogPath()].filter(Boolean) as string[];
    for (const f of files) {
      for (const line of tailLines(f, 20000)) {
        if (line.includes(key)) lines.push(`[${basename(f)}] ${line}`);
        if (lines.length >= 300) break;
      }
    }
    return ok({ lines });
  }

  // ===== 服务器日志 =====
  if (path === "serverlog" && method === "GET") {
    const lines: string[] = [];
    for (const f of serverLogPaths()) {
      for (const line of tailLines(f, 300)) lines.push(`[${basename(dirname(f))}] ${line}`);
    }
    return ok({ lines, count: lines.length });
  }

  // ===== 聊天记录 =====
  if (path === "chatlog" && method === "GET") {
    const p = chatLogPath();
    if (!p) return ok({ lines: [], msg: "暂无记录" });
    return ok({ lines: tailLines(p, 500), file: basename(p) });
  }

  // ===== 日志历史记录（每次开服自动归档到 backup/ 下） =====
  if (path === "logs/list" && method === "GET") {
    const type = url.searchParams.get("type") === "server" ? "server_log" : "server_chat_log";
    const out: any[] = [];
    for (const shard of listShards()) {
      const dir = shardDir(shard.name);
      const cur = join(dir, type + ".txt");
      if (existsSync(cur)) out.push({ shard: shard.name, file: "current", label: "当前（本次启动）", mtime: statSync(cur).mtimeMs });
      const bdir = join(dir, "backup", type);
      if (existsSync(bdir)) {
        for (const f of readdirSync(bdir).filter((x) => x.endsWith(".txt")).sort().reverse()) {
          const label = f.replace(type + "_", "").replace(/\.txt$/, "").replace(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})/, "$1 $2:$3:$4");
          out.push({ shard: shard.name, file: f, label, mtime: statSync(join(bdir, f)).mtimeMs });
        }
      }
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return ok({ logs: out.slice(0, 100) });
  }
  if (path === "logs/content" && method === "GET") {
    const type = url.searchParams.get("type") === "server" ? "server_log" : "server_chat_log";
    const shard = String(url.searchParams.get("shard") || "");
    const file = String(url.searchParams.get("file") || "");
    if (!listShards().some((s) => s.name === shard)) return fail("分片不存在");
    let p: string;
    if (file === "current") p = join(shardDir(shard), type + ".txt");
    else if (/^[\w.-]+\.txt$/.test(file) && !file.includes("..")) p = join(shardDir(shard), "backup", type, file);
    else return fail("非法日志文件");
    if (!existsSync(p)) return fail("日志文件不存在");
    return ok({ lines: tailLines(p, 2000), file: basename(p), shard });
  }

  // ===== 公告 =====
  if (path === "announce" && method === "GET") {
    return ok({ announcements: panelConfig.announcements, auto: panelConfig.announceAuto });
  }
  if (path === "announce/list" && method === "POST") {
    const b = await bodyJson(req);
    const list: string[] = Array.isArray(b.list) ? b.list.map((s: any) => String(s).slice(0, 200)).filter(Boolean).slice(0, 50) : [];
    panelConfig.announcements = list;
    savePanelConfig();
    return ok(null, "公告列表已保存");
  }
  if (path === "announce/auto" && method === "POST") {
    const b = await bodyJson(req);
    panelConfig.announceAuto.enabled = !!b.enabled;
    const sec = parseInt(b.intervalSec);
    if (!isNaN(sec) && sec >= 10 && sec <= 86400) panelConfig.announceAuto.intervalSec = sec;
    savePanelConfig();
    return ok(null, panelConfig.announceAuto.enabled ? `已开启自动公告（每 ${panelConfig.announceAuto.intervalSec} 秒）` : "已关闭自动公告");
  }

  return fail("未知接口: " + path, 404);
}

// ---------- 静态资源 / 页面 ----------
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};
function serveFile(path: string): Response {
  try {
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(Bun.file(path), { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/login/challenge" && req.method === "GET") {
      // 登录挑战：返回盐与一次性 nonce（60 秒有效）
      return ok({ salt: PANEL_SALT, nonce: issueNonce() });
    }
    if (path === "/api/login" && req.method === "POST") {
      const ip = (req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "direct").split(",")[0].trim();
      if (loginLocked(ip)) return fail("失败次数过多，已锁定 5 分钟", 429);
      const b = await bodyJson(req);
      // 期望 hash = sha256( sha256(salt+password) + nonce )
      if (typeof b.hash === "string" && typeof b.nonce === "string" && takeNonce(b.nonce)) {
        const expect = sha256hex(STORED_HASH + b.nonce);
        const a = Buffer.from(expect, "utf-8"), c = Buffer.from(b.hash, "utf-8");
        if (a.length === c.length && timingSafeEqual(a, c)) {
          loginSuccess(ip);
          const token = issueToken();
          return json({ ok: true, msg: "登录成功", token }, 200, { "Set-Cookie": makeCookie(token) });
        }
        loginFail(ip);
        return fail("密码错误", 401);
      }
      if (typeof b.password === "string") return fail("登录方式已升级，请强制刷新页面（Ctrl+Shift+R）后重试", 400);
      return fail("登录挑战无效或已过期，请重试", 401);
    }
    if (path === "/api/logout") {
      revokeToken(tokenFromReq(req));
      return json({ ok: true }, 200, { "Set-Cookie": "dstp_session=; Path=/; Max-Age=0" });
    }
    if (path.startsWith("/api/")) {
      if (!checkAuth(req)) return fail("未登录", 401);
      try {
        return await api(req, url);
      } catch (e: any) {
        console.error(e);
        return fail("服务器内部错误: " + (e?.message || e), 500);
      }
    }
    if (path === "/" || path === "/index.html") {
      return serveFile(join(PUBLIC_DIR, checkAuth(req) ? "index.html" : "login.html"));
    }
    // 动态模组物品图标：/mod-icon?id=<modId>&prefab=<prefab> → PNG（支持图集 UV 切片）
    if (path === "/mod-icon" && req.method === "GET") {
      const modId = url.searchParams.get("id") || "";
      const prefab = url.searchParams.get("prefab") || "";
      if (!/^\d{4,15}$/.test(modId) || !/^[a-z0-9_]+$/.test(prefab)) return new Response("Bad request", { status: 400 });
      const icon = findModIcon(modId, prefab);
      if (!icon) return new Response("Not found", { status: 404 });
      // 缓存 key = modId:prefab，避免重复解码
      const cacheKey = `${modId}:${prefab}`;
      const cached = modIconPngCache.get(cacheKey);
      if (cached) return new Response(cached, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
      try {
        const buf = readFileSync(icon.texPath);
        const result = decodeKTEX(buf);
        if (!result) return new Response("Decode failed", { status: 500 });
        let png = result.png;
        const isFullUV = icon.u1 === 0 && icon.u2 === 1 && icon.v1 === 0 && icon.v2 === 1;
        if (!isFullUV) png = cropPNG(result, icon.u1, icon.u2, icon.v1, icon.v2);
        // 缓存（限制总数 + 总量防止内存溢出，200 个约 2MB）
        if (modIconPngCache.size > 200) {
          const keys = [...modIconPngCache.keys()].slice(0, 50);
          for (const k of keys) modIconPngCache.delete(k);
        }
        // 限制单个缓存不超过 100KB
        if (png.length < 100_000) modIconPngCache.set(cacheKey, png);
        return new Response(png, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" } });
      } catch {
        return new Response("Error", { status: 500 });
      }
    }
    // 静态资源（相对路径引用，无敏感数据；允许 bg/ 等一层子目录，禁止 .. 穿越）
    if (/^\/[\w.\-/]+$/.test(path) && !path.includes("..")) {
      const fp = join(PUBLIC_DIR, path);
      try { if (existsSync(fp) && statSync(fp).isFile()) return serveFile(fp); } catch {}
    }
    // Steam CDN 图片代理（解决国内无法直连 steamusercontent.com 的问题）
    if (path === "/img-proxy" && req.method === "GET") {
      const target = url.searchParams.get("url") || "";
      if (!target.startsWith("https://images.steamusercontent.com/") && !target.startsWith("https://cdn.steamusercontent.com/")) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const res = await fetch(target, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return new Response("Fetch failed", { status: 502 });
        const buf = await res.arrayBuffer();
        return new Response(buf, { status: 200, headers: { "Content-Type": res.headers.get("Content-Type") || "image/png", "Cache-Control": "public, max-age=86400" } });
      } catch {
        return new Response("Fetch error", { status: 502 });
      }
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`DST 管理面板已启动: http://127.0.0.1:${PORT}/  (当前存档: ${panelConfig.cluster})`);

// ---------- 定时任务 ----------
// 自动重启：每 30 秒检查分片 + 内存保护
setInterval(async () => {
  if (!panelConfig.autorestart) return;
  try {
    // 内存保护：留 1GB 给系统，DST 进程超过剩余内存则终止
    const reserveMem = 1024; // 硬性预留 1GB 给系统
    const maxMem = sysMem.total - reserveMem;
    if (maxMem > 0) {
      const mem = getDstProcessMemory();
      if (mem > maxMem) {
        console.log(`[内存保护] DST 进程内存 ${mem}MB 触及上限 ${maxMem}MB（预留 ${reserveMem}MB），正在终止...`);
        for (const s of listShards()) await stopShard(s.name);
        try { Bun.spawnSync(["sh", "-c", "echo 1 > /proc/sys/vm/drop_caches 2>/dev/null || true"]); } catch {}
        console.log("[内存保护] DST 服务器已终止，可手动重新启动");
        return;
      }
    }
    // 掉线检测
    for (const s of listShards()) {
      if (!(await shardRunning(s.name))) {
        console.log(`[自动重启] 分片 ${s.name} 未运行，正在启动...`);
        await startShard(s.name);
      }
    }
  } catch (e) { console.error("[自动重启] 检查失败", e); }
}, 30_000);

// 自动公告：每 15 秒检查是否到期
setInterval(async () => {
  const cfg = panelConfig.announceAuto;
  if (!cfg.enabled || !panelConfig.announcements.length) return;
  if (Date.now() - cfg.lastSent < cfg.intervalSec * 1000) return;
  try {
    const shards = listShards();
    const master = shards.find((s) => s.isMaster) || shards[0];
    if (!master || !(await shardRunning(master.name))) return;
    const text = panelConfig.announcements[cfg.idx % panelConfig.announcements.length];
    await sendLua(master.name, `c_announce("${luaEscape(text)}")`);
    cfg.idx = (cfg.idx + 1) % panelConfig.announcements.length;
    cfg.lastSent = Date.now();
    savePanelConfig();
  } catch (e) { console.error("[自动公告] 发送失败", e); }
}, 15_000);
