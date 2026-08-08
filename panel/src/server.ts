// DST 专用服务器管理面板 —— Bun 单文件后端
// Linux: bun run src/server.ts  (监听 127.0.0.1:5323)
// Windows: bun run src/server.ts 或打包后的 DSTserver.exe（进程直连模式，无需 screen）
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync, renameSync, statSync, lstatSync, symlinkSync, readlinkSync, unlinkSync, rmdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { gzipSync } from "node:zlib";
import os from "node:os";
import { ITEMS } from "./items";
import { FOREST_OPTIONS, CAVE_OPTIONS } from "./worldgen";

// ---------- 平台适配（Linux / Windows） ----------
const IS_WIN = process.platform === "win32";
// Windows 打包为 exe 时，面板目录 = exe 所在目录；开发运行时 = src/ 的上一级（panel/）
const IS_COMPILED = IS_WIN && /\.exe$/i.test(process.execPath) && !/bun(\\.x)?\.exe$/i.test(process.execPath);
const HOME = IS_WIN ? (process.env.USERPROFILE || os.homedir()) : "/home/steam";
const PANEL_DIR = IS_WIN ? (IS_COMPILED ? dirname(process.execPath) : join(import.meta.dir, "..")) : join(HOME, "dst_panel");
const PUBLIC_DIR = join(PANEL_DIR, "public");
const PASSWORD_FILE = join(PANEL_DIR, ".panel_password");
const PANEL_CONFIG_FILE = join(PANEL_DIR, "panel_config.json");
const MOD_CACHE_FILE = join(PANEL_DIR, "mod_cache.json");
// 面板版本号：显示在登录页/主界面顶栏（html 注入），软著/发布材料与此保持一致
const PANEL_VERSION = "1.0.0";
const isAbsPath = (p: string) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
function readServerDirFromConfig(): string {
  try { const c = JSON.parse(readText(PANEL_CONFIG_FILE)); if (c.serverDir && typeof c.serverDir === "string" && existsSync(join(c.serverDir, "bin"))) return c.serverDir; } catch {}
  // Windows 自动检测 Steam 库中的 DST 专用服务器
  if (IS_WIN) {
    for (const lib of steamLibs()) {
      const d = join(lib, "steamapps", "common", "Don't Starve Together Dedicated Server");
      if (existsSync(d)) return d;
    }
    // 回退到 PANEL_DIR 下的 dst_server（用户手动部署）
    return join(PANEL_DIR, "dst_server");
  }
  return join(HOME, "dst_server");
}
const SERVER_DIR = readServerDirFromConfig();
// Windows 版 Dedicated Server 可执行文件在 bin/ 下；Linux 在 bin64/ 下
function detectBin(): { binDir: string; bin: string } {
  const names = IS_WIN
    ? ["dontstarve_dedicated_server_nullrenderer_x64.exe", "dontstarve_dedicated_server_nullrenderer.exe"]
    : ["dontstarve_dedicated_server_nullrenderer_x64"];
  for (const d of [join(SERVER_DIR, "bin64"), join(SERVER_DIR, "bin")]) {
    for (const n of names) { const p = join(d, n); if (existsSync(p)) return { binDir: d, bin: p }; }
  }
  const bd = IS_WIN && existsSync(join(SERVER_DIR, "bin")) ? join(SERVER_DIR, "bin") : join(SERVER_DIR, "bin64");
  return { binDir: bd, bin: join(bd, names[0]) };
}
const { binDir: BIN_DIR, bin: BIN } = detectBin();
const MODS_DIR = join(SERVER_DIR, "mods");
const SETUP_LUA = join(MODS_DIR, "dedicated_server_mods_setup.lua");
const DEFAULT_CLUSTER_ROOT = IS_WIN ? join(HOME, "Documents", "Klei", "DoNotStarveTogether") : join(HOME, ".klei", "DoNotStarveTogether");
const DEFAULT_MODS_DIR = IS_WIN ? join(PANEL_DIR, "dst_mods") : join(HOME, "dst_mods");
// 原版预设白名单：这些预设使用原版世界设置项，不是模组世界
const VANILLA_PRESETS = new Set(["", "SURVIVAL_TOGETHER", "DST_CAVE", "LAVAARENA", "QUAGMIRE"]);
// 存档根目录 / 模组存放目录可在面板「基本设置」修改（存 panelConfig）
function clusterRoot(): string { return panelConfig.clusterRoot || DEFAULT_CLUSTER_ROOT; }
function modsStoreDir(): string { return panelConfig.modsDir || DEFAULT_MODS_DIR; }
const STEAMCMD = IS_WIN ? join(PANEL_DIR, "steamcmd", "steamcmd.exe") : join(HOME, "steamcmd", "steamcmd.sh");
const STEAMCMD_WORKSHOP = IS_WIN ? join(PANEL_DIR, "steamcmd", "steamapps", "workshop", "content", "322330") : join(HOME, "steamcmd", "steamapps", "workshop", "content", "322330");
const PORT = 5323;
// 多开内存门槛：已有服务器在跑时，空余内存低于该值禁止再开（MB）
const MULTI_OPEN_MIN_MEM = 4096;

// ---------- 小工具 ----------
const enc = new TextEncoder();
const dec = new TextDecoder();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 系统资源检测：启动服务器前检查剩余内存和 CPU
function checkResources(): { ok: boolean; msg: string } {
  try {
    const sysMem = getSystemMemory();
    if (sysMem.avail > 0 && sysMem.avail < 512) {
      return { ok: false, msg: `系统可用内存仅 ${sysMem.avail}MB，请关闭其他服务后再启动` };
    }
    const cpuPct = getCpuUsage();
    if (cpuPct > 90) {
      return { ok: false, msg: `CPU 负载过高（${cpuPct}%），建议等待负载降低后再启动` };
    }
    return { ok: true, msg: "" };
  } catch {
    return { ok: true, msg: "" };
  }
}

// CPU 使用率（%）：Linux 读 loadavg；Windows 采样 os.cpus() 时间片
let cpuSample: { idle: number; total: number; usage: number; time: number } | null = null;
function getCpuUsage(): number {
  if (!IS_WIN) {
    try {
      const loadText = readText("/proc/loadavg");
      const load1 = parseFloat(loadText.split(/\s+/)[0]) || 0;
      const cpuCount = os.cpus()?.length || 4;
      return Math.round((load1 / cpuCount) * 100);
    } catch { return 0; }
  }
  try {
    let idle = 0, total = 0;
    for (const c of os.cpus()) { idle += c.times.idle; total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq; }
    const now = Date.now();
    if (cpuSample) {
      const dTotal = total - cpuSample.total, dIdle = idle - cpuSample.idle;
      const usage = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : cpuSample.usage;
      cpuSample = { idle, total, usage, time: now };
      return usage;
    }
    cpuSample = { idle, total, usage: 0, time: now };
    return 0;
  } catch { return 0; }
}

// 获取 DST 服务进程的内存占用（RSS MB）
function getDstProcessMemory(): number {
  if (IS_WIN) {
    // Windows：汇总本面板启动的 DST 进程内存（PowerShell 查询）
    try {
      const pids = [...winProcs.values()].map((p) => p.pid).filter(Boolean);
      if (!pids.length) return 0;
      const r = Bun.spawnSync(["powershell", "-NoProfile", "-Command", `(Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum`], { stdout: "pipe" });
      const bytes = Number(new Response(r.stdout).text().trim()) || 0;
      return Math.round(bytes / 1048576);
    } catch { return 0; }
  }
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
  if (IS_WIN) {
    try {
      const total = Math.round(os.totalmem() / 1048576);
      const avail = Math.round(os.freemem() / 1048576);
      return { total, avail, used: total - avail };
    } catch { return { total: 0, avail: 0, used: 0 }; }
  }
  try {
    const text = readText("/proc/meminfo");
    const total = /MemTotal:\s+(\d+)/.exec(text);
    const avail = /MemAvailable:\s+(\d+)/.exec(text);
    return { total: total ? Math.round(Number(total[1]) / 1024) : 0, avail: avail ? Math.round(Number(avail[1]) / 1024) : 0, used: 0 };
  } catch {
    return { total: 0, avail: 0, used: 0 };
  }
}
// 正在运行的全部 DST 进程（所有存档）：[{cluster, shard}]
async function runningDstAll(): Promise<{ cluster: string; shard: string }[]> {
  if (IS_WIN) {
    // 只认本面板启动的进程（面板重启后无法追踪外部进程，符合 Windows 单机使用场景）
    const out: { cluster: string; shard: string }[] = [];
    for (const [key, p] of winProcs) {
      if (p.exitCode === null) { const [cluster, shard] = key.split("::"); out.push({ cluster, shard }); }
    }
    return out;
  }
  try {
    const r = await run(["pgrep", "-af", "dontstarve_dedicated_server_nullrenderer"]);
    const out: { cluster: string; shard: string }[] = [];
    for (const line of r.out.split("\n")) {
      const c = /-cluster\s+(\S+)/.exec(line);
      const s = /-shard\s+(\S+)/.exec(line);
      if (c && s) out.push({ cluster: c[1], shard: s[1] });
    }
    return out;
  } catch { return []; }
}

// ---------- Windows 本地模组复用 ----------
function copyDirSync(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src)) {
    const s = join(src, e), d = join(dst, e);
    const st = statSync(s);
    if (st.isDirectory()) copyDirSync(s, d);
    else writeFileSync(d, readFileSync(s));
  }
}
// 删除路径：目录联接/符号链接只移除链接本身、绝不动目标内容。
// （Bun 在 Windows 上 rmSync 删 junction 会报 EFAULT，需走 unlink/rmdir）
function removePathOrLink(p: string): void {
  try {
    if (lstatSync(p).isSymbolicLink()) {
      try { unlinkSync(p); return; } catch {}
      try { rmdirSync(p); return; } catch {}
    }
  } catch {}
  rmSync(p, { recursive: true, force: true });
}
// 定位本机 Steam 安装/库根目录（含 steamapps 子目录的目录）：
// 1. 注册表 SteamPath（最可靠） 2. 默认位置 3. 各盘符常见目录（D:\steam、E:\SteamLibrary 等）
function steamRoots(): string[] {
  const roots: string[] = [];
  const push = (p: string) => { try { if (p && existsSync(join(p, "steamapps")) && !roots.includes(p)) roots.push(p); } catch {} };
  if (!IS_WIN) {
    // Linux：常见 Steam 安装位置
    const home = process.env.HOME || "";
    for (const cand of [join(home, ".steam", "steam"), join(home, ".local", "share", "Steam"), join(home, "Steam"), "/usr/lib/steam", "/opt/steam"]) push(cand);
    return roots;
  }
  for (const key of ["HKCU\\Software\\Valve\\Steam", "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "HKLM\\SOFTWARE\\Valve\\Steam"]) {
    try {
      const r = Bun.spawnSync(["reg", "query", key, "/v", "SteamPath"], { stdout: "pipe", stderr: "ignore" } as any);
      const m = /SteamPath\s+REG_SZ\s+(\S[^\r\n]*)/.exec(r.stdout.toString());
      if (m) push(m[1].trim());
    } catch {}
  }
  push("C:\\Program Files (x86)\\Steam");
  for (const L of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    for (const cand of ["steam", "Steam", "SteamLibrary", "steamlibrary", "Games\\steam", "Games\\Steam", "Games\\SteamLibrary", "Program Files\\Steam", "Program Files (x86)\\Steam"]) {
      push(`${L}:\\${cand}`);
    }
  }
  return roots;
}
// 解析本机 Steam 库目录：各 Steam 根 + 各自 libraryfolders.vdf 里的附加库
function steamLibs(): string[] {
  const libs: string[] = [];
  for (const root of steamRoots()) {
    if (!libs.includes(root)) libs.push(root);
    try {
      const vdf = readText(join(root, "steamapps", "libraryfolders.vdf"));
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
        const p = m[1].replace(/\\\\/g, "\\");
        try { if (existsSync(join(p, "steamapps")) && !libs.includes(p)) libs.push(p); } catch {}
      }
    } catch {}
  }
  return libs;
}
// 检测 DST 客户端安装位置（用于直接读取客户端模组文件夹）。
// 返回：客户端根目录 / bin / 客户端mods / 创意工坊缓存（322330）；用户手动设置的优先
// detectDstClient 30 秒缓存（避免 basic 等接口每次请求都扫 Steam 库）
let clientDetectCache: { dir: string; binDir: string; modsDir: string; workshopDir: string } | null = null;
let clientDetectAt = 0;
function detectDstClient(): { dir: string; binDir: string; modsDir: string; workshopDir: string } | null {
  if (clientDetectCache && Date.now() - clientDetectAt < 30000) return clientDetectCache;
  let r: { dir: string; binDir: string; modsDir: string; workshopDir: string } | null = null;
  if (panelConfig.clientDir && existsSync(panelConfig.clientDir)) {
    const dir = panelConfig.clientDir;
    // 客户端根目录上两级即 steamapps（.../steamapps/common/Don't Starve Together）
    const steamapps = dirname2(dirname2(dir));
    r = { dir, binDir: join(dir, "bin"), modsDir: join(dir, "mods"), workshopDir: join(steamapps, "workshop", "content", "322330") };
  } else {
    for (const lib of steamLibs()) {
      const dir = join(lib, "steamapps", "common", "Don't Starve Together");
      if (existsSync(dir)) {
        r = { dir, binDir: join(dir, "bin"), modsDir: join(dir, "mods"), workshopDir: join(lib, "steamapps", "workshop", "content", "322330") };
        break;
      }
    }
  }
  clientDetectCache = r;
  clientDetectAt = Date.now();
  return r;
}
// 扫描本机 Steam 库中的 DST 模组（创意工坊缓存 + 游戏/专用服务器的 mods 目录），可直接复用开房间
function scanLocalSteamMods(): { id: string; source: string; path: string; hasInfo: boolean }[] {
  const out: { id: string; source: string; path: string; hasInfo: boolean }[] = [];
  const seen = new Set<string>();
  const libs = steamLibs();
  const push = (id: string, source: string, p: string) => {
    if (!/^\d{4,15}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    out.push({ id, source, path: p, hasInfo: existsSync(join(p, "modinfo.lua")) });
  };
  for (const lib of libs) {
    // 创意工坊下载缓存: steamapps/workshop/content/322330/<id>
    const ws = join(lib, "steamapps", "workshop", "content", "322330");
    try { for (const d of readdirSync(ws)) { const p = join(ws, d); if (statSync(p).isDirectory()) push(d, "Steam创意工坊缓存", p); } } catch {}
    // 游戏本体/专用服务器的 mods: steamapps/common/<game>/mods/workshop-<id>
    for (const game of ["Don't Starve Together", "Don't Starve Together Dedicated Server"]) {
      const md = join(lib, "steamapps", "common", game, "mods");
      try { for (const d of readdirSync(md)) { const m = /^workshop-(\d+)$/.exec(d); if (m) push(m[1], game + "\\mods", join(md, d)); } } catch {}
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
// 直接构造候选路径查找本地模组目录（不遍历全部 Steam 库，图标/详情等单点查询用）
function findLocalModPath(id: string): string | null {
  const shared = ugcSharedDir();
  if (existsSync(join(shared, id))) return join(shared, id);
  for (const lib of steamLibs()) {
    const ws = join(lib, "steamapps", "workshop", "content", "322330", id);
    if (existsSync(ws)) return ws;
    for (const game of ["Don't Starve Together", "Don't Starve Together Dedicated Server"]) {
      const md = join(lib, "steamapps", "common", game, "mods", `workshop-${id}`);
      if (existsSync(md)) return md;
    }
  }
  return null;
}
// Windows 版启动时：在模组存放目录写说明文件（标明地址，方便用户维护与程序调用）
function writeModsDirReadme(): void {
  if (!IS_WIN) return;
  try {
    mkdirSync(modsStoreDir(), { recursive: true });
    writeFileSync(join(modsStoreDir(), "_模组存放目录说明.txt"),
      `这是 DST 服务器面板的模组统一存放目录。\r\n\r\n地址: ${modsStoreDir()}\r\n\r\n规则:\r\n- 每个子文件夹名 = 创意工坊模组 ID（纯数字）\r\n- 可直接把本地 Steam 的模组复制到这里开房间（面板「mod设置」页有「本地模组库」一键复用）\r\n- 从本地复用的模组内含 SOURCE.txt，标明来源地址\r\n- 以「链接加载」方式接入的模组是目录联接(Junction)，指向客户端文件夹，清单见 _链接模组来源.txt\r\n- 不要手动修改子文件夹名，否则服务器无法识别\r\n`);
  } catch {}
}
// 重建 _链接模组来源.txt：列出模组存放目录里所有目录联接(Junction)及其指向的客户端地址
function refreshLinkManifest(): void {
  if (!IS_WIN) return;
  try {
    const g = modsStoreDir();
    const lines: string[] = [];
    for (const d of readdirSync(g)) {
      const p = join(g, d);
      try { if (lstatSync(p).isSymbolicLink()) lines.push(`${d}  ->  ${readlinkSync(p)}`); } catch {}
    }
    const f = join(g, "_链接模组来源.txt");
    if (lines.length) {
      writeFileSync(f, `以下模组以「链接加载」方式直接读取本机客户端文件夹（目录联接 Junction，不占用额外磁盘，随 Steam 客户端自动更新）：\r\n\r\n${lines.join("\r\n")}\r\n\r\n删除链接只会移除联接本身，不会删除客户端里的模组文件。\r\n`);
    } else {
      try { rmSync(f, { force: true }); } catch {}
    }
  } catch {}
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

// Lua 顶层参数分割（按顶层逗号切分，忽略字符串/表/括号内的逗号）
function splitTopLevelArgs(expr: string): string[] {
  const out: string[] = [];
  let depth = 0, i = 0, start = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < expr.length && expr[i] !== q) { if (expr[i] === "\\") i++; i++; }
    } else if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(expr.slice(start, i).trim()); start = i + 1; }
    i++;
  }
  out.push(expr.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

// 匹配成对圆括号（openIdx 指向 "("），返回匹配的 ")" 下标
function matchParen(src: string, openIdx: number): number {
  let depth = 0, inStr = false, strCh = "";
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
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
  clusterRoots: string[]; // 存档位置历史记录（可随时切换回用过的位置）
  modsDir: string;
  clientDir: string; // Windows：DST 客户端安装目录（留空=自动检测），用于直接读取客户端模组
  langCheck: boolean;
  steamProxy: string; // Steam Community 代理（国内访问 steamcommunity 会被墙，可填另一台能直连的面板地址）
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
      serverDir: typeof c.serverDir === "string" && c.serverDir ? c.serverDir : readServerDirFromConfig(),
      clusterRoot: typeof c.clusterRoot === "string" && isAbsPath(c.clusterRoot) ? c.clusterRoot : DEFAULT_CLUSTER_ROOT,
      clusterRoots: Array.isArray(c.clusterRoots) ? c.clusterRoots.filter((x: any) => typeof x === "string" && isAbsPath(x)).slice(0, 12) : [],
      modsDir: typeof c.modsDir === "string" && isAbsPath(c.modsDir) ? c.modsDir : DEFAULT_MODS_DIR,
      clientDir: typeof c.clientDir === "string" ? c.clientDir : "",
      langCheck: c.langCheck !== false,
      steamProxy: typeof c.steamProxy === "string" && /^https?:\/\/[^\s]+$/.test(c.steamProxy) ? c.steamProxy : "",
    };
  } catch {
    return { cluster: "MyDediServer", beta: false, betaBranch: "", mode: "online", autorestart: false, announcements: [], announceAuto: { enabled: false, intervalSec: 300, idx: 0, lastSent: 0 }, itemHistory: [], favorites: [], serverDir: readServerDirFromConfig(), clusterRoot: DEFAULT_CLUSTER_ROOT, clusterRoots: [], modsDir: DEFAULT_MODS_DIR, clientDir: "", langCheck: true, steamProxy: "" };
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
  // 是否有 server.ini：客户端游戏生成的存档（如 Cluster_1）只有世界文件夹，没有 server.ini，
  // 这类分片也要识别展示（hasIni=false），启动/添加世界时由 ensureServerIni 自动补全
  hasIni: boolean;
}
// 缓存 shard 列表（避免每次调用都扫描目录）
let shardListCache: ShardInfo[] | null = null;
function listShards(): ShardInfo[] {
  if (shardListCache) return shardListCache;
  const out: ShardInfo[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(clusterDir()); } catch { return out; }
  for (const e of entries) {
    const dir = join(clusterDir(), e);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    const ini = join(dir, "server.ini");
    if (existsSync(ini)) {
      const lines = parseIni(readText(ini));
      const isMaster = iniGet(lines, "SHARD", "is_master") === "true";
      out.push({
        name: e,
        isMaster,
        // 未显式配置 server_port 时回退面板默认端口（地上 11000 / 地下 11001），保证世界列表/分片表始终可点改
        port: iniGet(lines, "NETWORK", "server_port") || (isMaster ? "11000" : "11001"),
        running: false,
        hasIni: true,
      });
    } else if (existsSync(join(dir, "worldgenoverride.lua")) || existsSync(join(dir, "save"))) {
      // 既有世界文件夹（客户端存档）：按名字推断主/副世界，端口用面板默认
      const isMaster = /^master$/i.test(e);
      out.push({
        name: e,
        isMaster,
        port: isMaster ? "11000" : "11001",
        running: false,
        hasIni: false,
      });
    }
  }
  shardListCache = out;
  return out;
}
// 启动/删除分片后清除缓存
function clearShardListCache() { shardListCache = null; }
// 切换 cluster 时清除所有与 cluster 相关的缓存
function clearAllClusterCache() {
  shardListCache = null;
  modOverridesCache.clear();
  modAtlasCache.clear();
  modItemsCache.clear();
}
// 为缺少 server.ini 的既有世界文件夹补全配置（端口只在本存档内避让——同存档多世界必须不同端口；
// 不看其他存档：新建/导入的世界固定拿默认端口，跨存档冲突仅黄色警告）
function ensureServerIni(shard: string): void {
  const f = join(shardDir(shard), "server.ini");
  if (existsSync(f)) return;
  const used = new Set<number>();
  try { for (const p of clusterPorts(panelConfig.cluster, true)) used.add(p.port); } catch {}
  const alloc = (start: number) => { let p = start; while (used.has(p) && p < 65535) p++; used.add(p); return p; };
  const info = listShards().find((s) => s.name === shard);
  const isMaster = info ? info.isMaster : /^master$/i.test(shard);
  const ini = `[NETWORK]\nserver_port = ${alloc(isMaster ? 11000 : 11001)}\n\n[SHARD]\nis_master = ${isMaster}\n${isMaster ? "" : `name = ${shard}\n`}\n[STEAM]\nmaster_server_port = ${alloc(isMaster ? 27018 : 27019)}\nauthentication_port = ${alloc(isMaster ? 8768 : 8769)}\n\n[ACCOUNT]\nencode_user_path = true\n`;
  writeFileSync(f, ini);
  clearShardListCache();
}
// 模组文件变动（下载/删除/导入）后清除模组相关缓存
function clearModCaches() {
  modAtlasCache.clear();
  modItemsCache.clear();
  modStrCache.clear();
  modLuaFilesCache.clear();
  modTransCache.clear();
  modWorldgenDataCache.clear();
  modWgDirCache.clear();
  modIconPngCache.clear();
  iconIndexCache = null;
  itemsApiCache = { key: "", data: [] };
  // 模组图标磁盘缓存一并清除（模组更新后图标可能变化）
  try { rmSync(join(PUBLIC_DIR, "modicons"), { recursive: true, force: true }); } catch {}
}

// ---------- 进程控制（Linux: screen/systemd；Windows: 直连进程） ----------
// Windows 下由本面板直接启动的 DST 进程表："cluster::shard" -> Subprocess
const winProcs = new Map<string, any>();
async function screenList(): Promise<string> {
  if (IS_WIN) return "";
  const r = await run(["screen", "-ls"]);
  return r.out;
}
// 分片的 screen 会话名：Master/Caves 沿用旧名（兼容历史），其余分片 dst_<名>；
// 多开（其他存档在运行）时统一加存档前缀，避免会话冲突
function screenSessionCandidates(shard: string, otherRunning: boolean): string[] {
  const s = shard.toLowerCase();
  const legacy = s === "master" ? "dst_master" : s === "caves" ? "dst_caves" : `dst_${s}`;
  const multi = `dst_${panelConfig.cluster.toLowerCase()}_${s}`;
  return otherRunning ? [multi, legacy] : [legacy, multi];
}
async function shardRunning(shard: string): Promise<boolean> {
  if (IS_WIN) {
    const p = winProcs.get(`${panelConfig.cluster}::${shard}`);
    return !!p && p.exitCode === null;
  }
  // 优先检查 systemd transient service（cgroup 启动方式）
  const unit = `dst-${shard.toLowerCase()}`;
  const svc = await run(["systemctl", "is-active", "--quiet", unit]);
  if (svc.code === 0) return true;
  // 检查 screen 会话（兼容旧名与多开名）
  const others = (await runningDstAll()).filter((x) => x.cluster !== panelConfig.cluster);
  const ls = await screenList();
  for (const sess of screenSessionCandidates(shard, others.length > 0)) {
    if (new RegExp(`\\.${sess}\\b`).test(ls)) return true;
  }
  // pgrep 跨用户检测（带存档名，避免其他存档的同名分片误判）
  const pg = await run(["pgrep", "-f", `dontstarve_dedicated_server_nullrenderer.*-cluster ${panelConfig.cluster}.*-shard ${shard}\\b`]);
  if (pg.code === 0 && pg.out.trim().length > 0) return true;
  // 兼容旧格式（无 -cluster 参数顺序差异）
  const pg2 = await run(["pgrep", "-f", `dontstarve_dedicated_server_nullrenderer.*-shard ${shard}\\b`]);
  return pg2.code === 0 && pg2.out.trim().length > 0;
}
async function startShard(shard: string): Promise<string> {
  // 既有世界文件夹（客户端存档）可能缺 server.ini，启动前自动补全
  ensureServerIni(shard);
  // 确保已启用模组在服务器 mods/ 目录中有符号链接（避免 Workshop 下载超时导致缺模组）
  ensureServerModSymlinks();
  const extraArgs: string[] = [];
  if (IS_WIN) {
    // Windows 上 DST 默认 APP: 存储根解析有缺陷：不带参数时读不到 cluster_token.txt/server.ini
    // （导致 token 验证失败、端口用默认值、不写日志）。必须始终显式指定存储根。
    const parent = clusterRoot().replace(/[\\/][^\\/]+$/, "") || "C:\\";
    const conf = clusterRoot().split(/[\\/]/).pop()!;
    extraArgs.push("-persistent_storage_root", parent, "-conf_dir", conf);
  } else if (clusterRoot() !== DEFAULT_CLUSTER_ROOT) {
    const parent = clusterRoot().replace(/[\\/][^\\/]+$/, "") || (IS_WIN ? "C:\\" : "/");
    const conf = clusterRoot().split(/[\\/]/).pop()!;
    extraArgs.push("-persistent_storage_root", parent, "-conf_dir", conf);
  }
  if (panelConfig.mode === "offline") extraArgs.push("-offline");
  if (IS_WIN) {
    // Windows：直接拉起进程，stdin 管道用于控制台命令注入
    const key = `${panelConfig.cluster}::${shard}`;
    const old = winProcs.get(key);
    if (old && old.exitCode === null) return "ok";
    try {
      const proc = Bun.spawn([BIN, "-cluster", panelConfig.cluster, "-shard", shard, ...extraArgs, "-console"], {
        cwd: BIN_DIR, stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      // 捕获 stdout/stderr 到环形缓冲：server_log.txt 尚未生成（启动早期/令牌验证失败等）时，
      // 日志页可展示这些启动输出，避免"暂无日志"干等
      const outBuf: string[] = [];
      const cap = 500;
      const pump = async (stream: ReadableStream | null) => {
        if (!stream) return;
        const reader = stream.getReader();
        const dec = new TextDecoder();
        let rem = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rem += dec.decode(value, { stream: true });
          let idx: number;
          while ((idx = rem.indexOf("\n")) >= 0) {
            const line = rem.slice(0, idx).replace(/\r$/, "");
            rem = rem.slice(idx + 1);
            if (line) outBuf.push(line);
          }
          if (outBuf.length > cap) outBuf.splice(0, outBuf.length - cap);
        }
      };
      pump(proc.stdout).catch(() => {});
      pump(proc.stderr).catch(() => {});
      (proc as any).outBuf = outBuf;
      winProcs.set(key, proc);
      // 进程退出后自动清理
      proc.exited.finally(() => { try { const p = winProcs.get(key); if (p === proc) winProcs.delete(key); } catch {} });
      await sleep(4000);
      return (await shardRunning(shard)) ? "ok" : "启动失败（进程已退出，请检查端口冲突/令牌/模组）";
    } catch (e: any) {
      return "启动失败: " + (e?.message || e);
    }
  }
  const others = (await runningDstAll()).filter((x) => x.cluster !== panelConfig.cluster);
  const sess = screenSessionCandidates(shard, others.length > 0)[0];
  const args = [
    "sudo", "/usr/local/bin/dst-shard-launch.sh",
    shard, sess, BIN, BIN_DIR, panelConfig.cluster, ...extraArgs,
  ];
  const r = await run(args, { cwd: BIN_DIR });
  await sleep(2000);
  return (await shardRunning(shard)) ? "ok" : (r.out || "启动失败");
}
async function stopShard(shard: string): Promise<void> {
  if (IS_WIN) {
    const key = `${panelConfig.cluster}::${shard}`;
    const p = winProcs.get(key);
    if (p && p.exitCode === null) {
      try { p.stdin.write('c_shutdown()\n'); p.stdin.flush?.(); } catch {}
      // 最多等 12 秒优雅退出，超时强杀
      const deadline = Date.now() + 12000;
      while (p.exitCode === null && Date.now() < deadline) await sleep(500);
      if (p.exitCode === null) { try { p.kill(); } catch {} }
    }
    winProcs.delete(key);
    return;
  }
  // 先停 systemd transient service（清理 cgroup）；面板以 steam 运行，需 sudo 免密（/etc/sudoers.d/dst-panel）
  const unit = `dst-${shard.toLowerCase()}`;
  await run(["sudo", "-n", "systemctl", "stop", unit]);
  await run(["sudo", "-n", "systemctl", "reset-failed", unit]);
  // 再清理 screen（两种命名都尝试）和残留进程（限定本存档）
  const others = (await runningDstAll()).filter((x) => x.cluster !== panelConfig.cluster);
  for (const sess of screenSessionCandidates(shard, others.length > 0)) {
    await run(["screen", "-S", sess, "-X", "quit"]);
  }
  await run(["pkill", "-f", `dontstarve_dedicated_server_nullrenderer.*-cluster ${panelConfig.cluster}.*-shard ${shard}\\b`]);
  await run(["pkill", "-f", `dontstarve_dedicated_server_nullrenderer.*-shard ${shard}\\b`]);
}
async function sendLua(shard: string, lua: string): Promise<boolean> {
  if (!(await shardRunning(shard))) return false;
  // 注意：screen -X stuff 会把反斜杠当转义符（\ooo 八进制等），因此命令里不能含反斜杠转义序列；
  // UTF-8 中文可直接传输（hardcopy 显示为乱码只是屏幕渲染，服务器端实际接收正确）。
  const clean = lua.replace(/\r/g, "").replace(/\n+/g, " ").slice(0, 4000);
  if (IS_WIN) {
    const p = winProcs.get(`${panelConfig.cluster}::${shard}`);
    if (!p || p.exitCode !== null) return false;
    try { p.stdin.write(clean + "\n"); p.stdin.flush?.(); return true; } catch { return false; }
  }
  const others = (await runningDstAll()).filter((x) => x.cluster !== panelConfig.cluster);
  const sess = screenSessionCandidates(shard, others.length > 0)[0];
  const r = await run(["screen", "-S", sess, "-X", "stuff", clean + "\n"]);
  return r.code === 0;
}
async function hardcopy(shard: string): Promise<string> {
  if (IS_WIN) return "";
  const others = (await runningDstAll()).filter((x) => x.cluster !== panelConfig.cluster);
  const sess = screenSessionCandidates(shard, others.length > 0)[0];
  const file = `/tmp/dst_dump_${sess}.txt`;
  await run(["screen", "-S", sess, "-X", "hardcopy", "-h", file]);
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
  // 目录可能不存在（新装面板/新服务器目录）：先补全再写
  try { mkdirSync(dirname2(SETUP_LUA), { recursive: true }); } catch {}
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
  // 已在 mods/ 目录中存在的模组（符号链接或真实目录）不再调用 ServerModSetup，
  // 避免 Workshop 下载阶段删除已有链接/文件后超时失败导致模组丢失
  const serverModsDir = join(SERVER_DIR, "mods");
  const alreadyInMods = (id: string) => {
    try { return existsSync(join(serverModsDir, `workshop-${id}`, "modinfo.lua")); } catch { return false; }
  };
  const body = [...ids]
    .filter((id) => !alreadyInMods(id))
    .sort((a, b) => Number(isLangPack(a)) - Number(isLangPack(b)))
    .map((id) => `ServerModSetup("${id}")`)
    .join("\n");
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
        // Windows 普通用户无法创建目录符号链接（需管理员），目录联接(Junction)不需要权限且对程序透明
        const linkType = IS_WIN ? "junction" : "dir";
        if (!existsSync(link)) { try { symlinkSync(g, link, linkType); } catch {} continue; }
        const st = lstatSync(link);
        if (st.isSymbolicLink()) {
          // 指向旧位置的符号链接 → 重新指向全局目录
          try { if (readlinkSync(link) !== g) { removePathOrLink(link); symlinkSync(g, link, linkType); } } catch {}
          continue;
        }
        if (st.isDirectory()) {
          for (const id of readdirSync(link)) {
            const from = join(link, id), to = join(g, id);
            if (!existsSync(to)) { try { renameSync(from, to); } catch {} }
          }
          rmSync(link, { recursive: true, force: true });
          try { symlinkSync(g, link, linkType); } catch {}
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
// 确保 dst_mods/ 中的模组在服务器的 mods/ 目录中有对应的符号链接，
// 避免 Steam Workshop 下载超时导致服务器找不到模组
function ensureServerModSymlinks(): void {
  try {
    const shared = ugcSharedDir();
    if (!existsSync(shared)) return;
    const serverModsDir = join(SERVER_DIR, "mods");
    if (!existsSync(serverModsDir)) return;
    const linkType = IS_WIN ? "junction" : "dir";
    for (const id of readdirSync(shared)) {
      if (!/^\d+$/.test(id)) continue;
      const src = join(shared, id);
      try { if (!statSync(src).isDirectory()) continue; } catch { continue; }
      if (!existsSync(join(src, "modinfo.lua"))) continue;
      const link = join(serverModsDir, `workshop-${id}`);
      // 已存在且有效 → 跳过
      try {
        if (existsSync(join(link, "modinfo.lua"))) continue;
      } catch {}
      // 创建符号链接（不覆盖已有真实目录）
      try { symlinkSync(src, link, linkType); } catch {}
    }
  } catch {}
}
function dirname2(p: string): string {
  // 同时兼容 / 与 \（Windows 的 join 产出反斜杠，旧版只认 / 会错误返回 "/"）
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : IS_WIN ? "." : "/";
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
// 解析模组 configs = { key = "Label" } 表（多语言块并存时中文值优先），
// 用于 CherryForest 等「label = configs.xxx 变量引用」模组的配置项 label 补全
function parseModConfigsLabels(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(?:local\s+)?configs\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const open = m.index + m[0].length - 1;
    const end = braceMatch(text, open);
    if (end === -1) continue;
    const body = text.slice(open + 1, end);
    const fRe = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
    let fm: RegExpExecArray | null;
    while ((fm = fRe.exec(body))) {
      const key = fm[1], val = unquoteLua(fm[2]);
      const isZh = /[\u4e00-\u9fff]/.test(val);
      const cur = map.get(key);
      if (!cur || (isZh && !/[\u4e00-\u9fff]/.test(cur))) map.set(key, val);
    }
  }
  return map;
}
// Re-Gorge-itated 等模组用 local function 构造 configuration_options：
//   local function Config(name, label, hover, options, default) return { name=name, label=label, ... } end
//   local opt_def = { Option("Enabled", true), ... }
//   configuration_options = { Title("Vote"), Config("kick", "...", "...", opt_def, true), ... }
// 轻量求值：收集 local function 定义（参数名 + return 表字段映射）与 local 变量定义，
// 对配置体顶层条目按「函数调用 / 变量引用」重建为 {name,label,hover,options,default} 结构。
function parseFunctionBuiltConfigs(text: string, body: string, info: ModInfo): void {
  // 1) local function FN(params) ... return { field = param | field = param or X } end
  const fnBuilders = new Map<string, { params: string[]; fields: [string, string][] }>();
  const fnRe = /local\s+function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g;
  let fnM: RegExpExecArray | null;
  while ((fnM = fnRe.exec(text))) {
    const fname = fnM[1];
    if (fnBuilders.has(fname)) continue;
    const params = fnM[2].split(",").map((s) => s.trim()).filter(Boolean);
    const retIdx = text.indexOf("return", fnM.index + fnM[0].length);
    if (retIdx === -1) continue;
    const braceIdx = text.indexOf("{", retIdx);
    if (braceIdx === -1) continue;
    const retEnd = braceMatch(text, braceIdx);
    if (retEnd === -1) continue;
    const fields: [string, string][] = [];
    const fRe = /([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)(?:\s+or\s+[^,}]+)?/g;
    let fm: RegExpExecArray | null;
    while ((fm = fRe.exec(text.slice(braceIdx + 1, retEnd)))) if (params.includes(fm[2])) fields.push([fm[1], fm[2]]);
    if (fields.length) fnBuilders.set(fname, { params, fields });
  }
  if (!fnBuilders.size) return;
  // 2) local VAR = 值（可能是表/调用，供 opt_def 等引用）
  const varDefs = new Map<string, string>();
  const lvRe = /local\s+([A-Za-z_]\w*)\s*=/g;
  let lvM: RegExpExecArray | null;
  while ((lvM = lvRe.exec(text))) {
    if (varDefs.has(lvM[1])) continue;
    let k = lvRe.lastIndex;
    while (k < text.length && /\s/.test(text[k])) k++;
    let expr: string;
    if (text[k] === "{") {
      const e2 = braceMatch(text, k);
      expr = e2 !== -1 ? text.slice(k, e2 + 1) : text.slice(k).split("\n")[0];
    } else {
      const nl = text.indexOf("\n", k);
      expr = text.slice(k, nl === -1 ? text.length : nl).trim();
    }
    if (expr) varDefs.set(lvM[1], expr);
  }
  // 3) 实参求值：字符串/数字/布尔/表/函数调用/变量引用
  const evalArg = (raw: string): any => {
    const t = raw.trim();
    if (!t) return null;
    const c0 = t[0];
    if (c0 === '"' || c0 === "'") {
      const m = new RegExp(`^${c0}((?:[^\\\\${c0}]|\\\\.)*)${c0}$`).exec(t);
      if (m) return unquoteLua(m[1]);
      return null; // 含 .. 拼接等复杂表达式，跳过
    }
    if (c0 === "{") return { __table: t };
    if (/^[A-Za-z_]\w*\(/.test(t)) {
      const fm2 = /^([A-Za-z_]\w*)\(/.exec(t)!;
      const b = fnBuilders.get(fm2[1]);
      if (b) {
        const close = matchParen(t, t.indexOf("("));
        if (close !== -1) return bindBuilder(b, splitTopLevelArgs(t.slice(t.indexOf("(") + 1, close)));
      }
      return null;
    }
    if (/^true$/.test(t)) return true;
    if (/^false$/.test(t)) return false;
    if (/^-?\d+\.?\d*$/.test(t)) return Number(t);
    if (/^nil$/.test(t)) return null;
    const vd = varDefs.get(t);
    if (vd !== undefined) return evalArg(vd);
    return null;
  };
  const bindBuilder = (b: { params: string[]; fields: [string, string][] }, args: string[]): Record<string, any> => {
    const r: Record<string, any> = {};
    for (const [field, param] of b.fields) {
      const idx = b.params.indexOf(param);
      if (idx === -1 || idx >= args.length) continue;
      r[field] = evalArg(args[idx]);
    }
    return r;
  };
  // 4) 选项表求值：{ Option("Enabled", true), {description=.., data=..}, "裸值", ... }
  const evalOpts = (expr: string): { description: string; data: any }[] => {
    let e = expr.trim();
    if (!/^\{/.test(e)) {
      const vd = varDefs.get(e);
      if (vd !== undefined) e = vd; else return [];
    }
    const end = braceMatch(e, 0);
    if (end === -1) return [];
    const out: { description: string; data: any }[] = [];
    for (const it of splitTopLevelArgs(e.slice(1, end))) {
      const t = it.trim();
      if (!t) continue;
      if (/^\{/.test(t)) {
        const e2 = braceMatch(t, 0);
        if (e2 === -1) continue;
        const b2 = t.slice(1, e2);
        const description = luaLabelField(b2, "description");
        const dkm = /data\s*=\s*/.exec(b2);
        let data: any = description;
        if (dkm) { const [v] = parseLuaValue(b2, dkm.index + dkm[0].length); data = v; }
        out.push({ description, data });
      } else {
        const v = evalArg(t);
        if (v && typeof v === "object" && (v as any).__table) { out.push(...evalOpts((v as any).__table)); continue; }
        if (v && typeof v === "object") {
          const r = v as Record<string, any>;
          const description = String(r.description ?? r.data ?? "");
          out.push({ description, data: r.data ?? description });
          continue;
        }
        out.push({ description: String(v ?? ""), data: v ?? "" });
      }
    }
    return out;
  };
  // 5) 配置条目求值 → ModConfigOption | null（Title/SEPARATOR 等分组标题跳过）
  const evalEntry = (expr: string): ModConfigOption | null => {
    const t = expr.trim();
    if (!t || /^\{/.test(t)) return null; // 字面量表由标准解析器处理
    if (/^[A-Za-z_]\w*\(/.test(t)) {
      const fm2 = /^([A-Za-z_]\w*)\(/.exec(t)!;
      const b = fnBuilders.get(fm2[1]);
      if (!b) return null;
      const close = matchParen(t, t.indexOf("("));
      if (close === -1) return null;
      const r = bindBuilder(b, splitTopLevelArgs(t.slice(t.indexOf("(") + 1, close)));
      if (!r.label && !r.options && r.default === undefined) return null; // 分组标题
      const opt: ModConfigOption = {
        name: String(r.name ?? ""),
        label: String(r.label ?? r.name ?? ""),
        hover: String(r.hover ?? ""),
        default: r.default ?? null,
        options: [],
      };
      if (!opt.name) return null;
      const ov = r.options;
      if (ov && typeof ov === "object" && (ov as any).__table) opt.options = evalOpts((ov as any).__table);
      if (!opt.options.length) opt.options.push({ description: String(opt.default ?? ""), data: opt.default ?? "" });
      return opt;
    }
    const vd = varDefs.get(t);
    if (vd !== undefined) return evalEntry(vd);
    return null;
  };
  // 6) 逐条解析配置体
  for (const entry of splitTopLevelArgs(body)) {
    if (!entry.trim()) continue;
    const opt = evalEntry(entry);
    if (opt && !info.configOptions.some((x) => x.name === opt.name)) info.configOptions.push(opt);
  }
}

function parseModInfo(id: string, fileOverride?: string): ModInfo | null {
  const file = fileOverride || modInfoPath(id);
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
    // CherryForest 等模组 label/hover 用 configs/descs 表变量引用（label = configs.music）→ 预收集表
    const cfgLabels = parseModConfigsLabels(text);
    // 逐项（顶层 {...} 块）解析
    let i = 0;
    while (i < body.length) {
        const ob = body.indexOf("{", i);
        if (ob === -1) break;
        const oe = braceMatch(body, ob);
        if (oe === -1) break;
        const item = body.slice(ob + 1, oe);
        let optLabel = luaLabelField(item, "label") || luaStrField(item, "label") || luaStrField(item, "name");
        if (!optLabel) {
          // label = configs.xxx 变量引用 → 查 configs 表（多语言块取中文优先）
          const ref = /label\s*=\s*([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/.exec(item);
          if (ref) { const lv = cfgLabels.get(ref[2]); if (lv) optLabel = lv; }
        }
        const opt: ModConfigOption = {
          name: luaStrField(item, "name"),
          label: optLabel,
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
    // Re-Gorge-itated 等模组用 local function 构造配置条目（Config(...)/Title(...) 调用形式）
    parseFunctionBuiltConfigs(text, body, info);
    // ReForged 等模组用 AddCustomConfig API 定义配置（非标准 {name=..} 结构）：
    // AddCustomConfig("KEY", "Label", "Hover", 选项数据, 默认值)
    const addCustomRe = /AddCustomConfig\s*\(/g;
    let ac: RegExpExecArray | null;
    while ((ac = addCustomRe.exec(body))) {
      const close = matchParen(body, addCustomRe.lastIndex - 1);
      if (close === -1) { addCustomRe.lastIndex = body.length; break; }
      const callBody = body.slice(addCustomRe.lastIndex, close);
      addCustomRe.lastIndex = close + 1;
      const parts = splitTopLevelArgs(callBody);
      if (parts.length < 2) continue;
      const nm = /^"((?:[^"\\]|\\.)*)"/.exec(parts[0].trim());
      if (!nm) continue;
      const opt: ModConfigOption = { name: unquoteLua(nm[1]), label: unquoteLua(nm[1]), hover: "", default: null, options: [] };
      const lbm = /^"((?:[^"\\]|\\.)*)"/.exec((parts[1] || "").trim());
      if (lbm) opt.label = unquoteLua(lbm[1]);
      const hm = /^"((?:[^"\\]|\\.)*)"/.exec((parts[2] || "").trim());
      if (hm) opt.hover = unquoteLua(hm[1]);
      // 默认值：最后一个参数（去除 default= 前缀）
      const defPart = (parts[parts.length - 1] || "").trim();
      try {
        const eq = defPart.indexOf("=");
        const valExpr = eq >= 0 ? defPart.slice(eq + 1).trim() : defPart;
        const [v] = parseLuaValue(valExpr, 0);
        opt.default = v;
      } catch {}
      // 选项表：倒数第二个参数，若是 {...} 表则解析
      const optPart = (parts[parts.length - 2] || "").trim();
      if (optPart.startsWith("{")) {
        const inner = optPart.slice(1, -1);
        let j = 0;
        while (j < inner.length) {
          const p = inner.indexOf("{", j);
          if (p === -1) break;
          const q = braceMatch(inner, p);
          if (q === -1) break;
          const ob2 = inner.slice(p + 1, q);
          const description = luaLabelField(ob2, "description");
          const dkm = /data\s*=\s*/.exec(ob2);
          let data: any = description;
          if (dkm) { const [v] = parseLuaValue(ob2, dkm.index + dkm[0].length); data = v; }
          opt.options.push({ description, data });
          j = q + 1;
        }
      }
      // 布尔/数字等函数式选项：至少保留默认值条目
      if (!opt.options.length) opt.options.push({ description: String(opt.default ?? ""), data: opt.default ?? "" });
      if (!info.configOptions.some((x) => x.name === opt.name)) info.configOptions.push(opt);
    }
  }
  // CherryForest 等模组 label 是 configs 表变量引用（label = configs.music）→ 从 configs 表补全空 label
  if (info.configOptions.length) {
    const cfgLabels = parseModConfigsLabels(text);
    if (cfgLabels.size) {
      for (const opt of info.configOptions) {
        if (!opt.label) { const l = cfgLabels.get(opt.name); if (l) opt.label = l; }
      }
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
      // 支持原版物品图集 inventoryimages1-4.xml 和 minimap.xml（世界实体小地图图标索引，补无图物品）
      const m = /^(inventoryimages\d+|minimap)\.xml$/.exec(f);
      if (!m) continue;
      const atlas = m[1];
      for (const mm of readText(join(dir, f)).matchAll(/<Element name="([^"]+)\.(?:tex|png)"/g)) {
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
  // mip0Size 可能为 0（某些 KTEX 格式），按格式自动计算
  if (mip0Size === 0) {
    const blocks = Math.ceil(mip0W / 4) * Math.ceil(mip0H / 4);
    mip0Size = fmt === 4 ? mip0W * mip0H * 4 : (fmt === 0 ? 8 : 16) * blocks; // DXT1=8, DXT5=16 bytes/block
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
  let rgba: Buffer | null;
  if (fmt === 4) {
    // 未压缩 RGBA8：直接拷贝（与 PNG 行序一致）
    rgba = Buffer.alloc(mip0W * mip0H * 4);
    pixelData.copy(rgba, 0, 0, Math.min(pixelData.length, rgba.length));
  } else if (fmt === 0) {
    rgba = decodeDXT1(pixelData, mip0W, mip0H);
  } else {
    rgba = decodeDXT5(pixelData, mip0W, mip0H);
  }
  if (!rgba) return null;
  // KTEX 纹理按 D3D 惯例自下而上存储，需垂直翻转以匹配 PNG 自上而下的行序
  const flipped = flipVerticalRGBA(rgba, mip0W, mip0H);
  const png = encodePNG(flipped, mip0W, mip0H);
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
      let aLo = 0, aHi = 0;
      if (dxt5) {
        const a0 = data[bo], a1 = data[bo + 1];
        // 48 位 alpha 索引（每像素 3 位）：bytes2-5 低 32 位 + bytes6-7 高 16 位
        aLo = data.readUInt32LE(bo + 2);
        aHi = data.readUInt16LE(bo + 6);
        alphas = [a0, a1];
        if (a0 > a1) { for (let i = 0; i < 6; i++) alphas.push(Math.floor(((6 - i) * a0 + (i + 1) * a1) / 7)); }
        else {
          // a0 <= a1: 4 个插值 + 0 + 255
          for (let i = 0; i < 4; i++) alphas.push(Math.floor(((4 - i) * a0 + (i + 1) * a1) / 5));
          alphas.push(0, 255);
        }
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
          // 颜色索引：每像素 2 位（cBits 为 32 位，16 像素 × 2 位）
          const ci = (cBits >>> ((py * 4 + px) * 2)) & 3;
          const [r, g, b] = colors[ci];
          // alpha 索引：每像素 3 位，48 位 = aLo(低32) + aHi(高16)
          let a = 255;
          if (dxt5) {
            const shift = (py * 4 + px) * 3;
            const aBits = aLo + aHi * 0x100000000;
            a = alphas[Math.floor(aBits / Math.pow(2, shift)) & 7];
          }
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
// KTEX 中纹理行自下而上存储（D3D 惯例），翻转后自上而下以匹配 PNG/UV 坐标
function flipVerticalRGBA(rgba: Buffer, width: number, height: number): Buffer {
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * stride;
    rgba.copy(out, y * stride, srcRow, srcRow + stride);
  }
  return out;
}
// 根据 UV 坐标裁剪已解码的 KTEX 图像并输出 PNG
// 经 flipVertical 后 RGBA 自上而下，UV v 坐标原点在上方
// Klei 的 UV 坐标指向像素中心：u = (pixel_index + 0.5) / texture_width
// 因此 pixel_index = floor(u * width)，像素范围 [floor(u1*W), floor(u2*W)] 闭区间
function cropPNG(decoded: { width: number; height: number; png: Buffer }, u1: number, u2: number, v1: number, v2: number): Buffer {
  const cropX = Math.floor(u1 * decoded.width);
  const cropW = Math.floor(u2 * decoded.width) - cropX + 1;
  // 纹理已通过 flipVerticalRGBA 翻转为自上而下，但 Klei 图集 UV v 是自下而上原点
  // 需反转 v: v=0(底)→row H, v=1(顶)→row 0; v1<v2 所以 (1-v2) < (1-v1)
  const cropY = Math.floor((1 - v2) * decoded.height);
  const cropH = Math.floor((1 - v1) * decoded.height) - cropY + 1;
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
        if (depth > 5) return;
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
          // 解析所有 Element（属性顺序无关，兼容不同工具生成的图集）
          const attrOf = (tag: string, name: string): string => {
            const m = new RegExp(`${name}="([^"]+)"`).exec(tag);
            return m ? m[1] : "";
          };
          for (const em of xmlText.matchAll(/<Element\s+([^>]*?)\/>/g)) {
            const attrs = em[1];
            const elemName = attrOf(attrs, "name").replace(/\.tex$/, "");
            const u1 = parseFloat(attrOf(attrs, "u1")), u2 = parseFloat(attrOf(attrs, "u2"));
            const v1 = parseFloat(attrOf(attrs, "v1")), v2 = parseFloat(attrOf(attrs, "v2"));
            if (!elemName || [u1, u2, v1, v2].some((v) => !Number.isFinite(v))) continue;
            const existing = index.get(elemName);
            // 优先选择元素数少的图集（专用 > 通用）
            if (!existing || existing.elementCount > elementCount) {
              index.set(elemName, { texPath, u1, u2, v1, v2, elementCount });
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

// 从图集 XML 中解析指定元素的 UV 坐标（属性顺序无关）
function parseAtlasUV(xml: string, elementName: string): { u1: number; u2: number; v1: number; v2: number } | null {
  // Element name 可以是 "xxx.tex" 或 "xxx"
  const names = [elementName, elementName.replace(/\.tex$/, "")];
  for (const em of xml.matchAll(/<Element\s+([^>]*?)\/>/g)) {
    const attrs = em[1];
    const nm = (/name="([^"]+)"/.exec(attrs) || [])[1] || "";
    if (!names.includes(nm)) continue;
    const num = (k: string) => parseFloat((new RegExp(`${k}="([\\d.]+)"`).exec(attrs) || [])[1] || "NaN");
    const u1 = num("u1"), u2 = num("u2"), v1 = num("v1"), v2 = num("v2");
    if ([u1, u2, v1, v2].some((v) => !Number.isFinite(v))) continue;
    return { u1, u2, v1, v2 };
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
// 世界设置项权威图标映射（key → 图集/元素名，由游戏 scripts/map/customize.lua 生成，见 docs/一脸懵逼.md）
let worldoptionIcons: Record<string, { atlas: string; img: string }> | null = null;
function worldoptionIconMap(): Record<string, { atlas: string; img: string }> {
  if (!worldoptionIcons) {
    try { worldoptionIcons = JSON.parse(readText(join(PANEL_DIR, "data", "worldoption_icons.json"))); }
    catch { worldoptionIcons = {}; }
  }
  return worldoptionIcons!;
}
// prefab → 英文显示名（由游戏 strings.lua 的 STRINGS.NAMES 提取，用于社区图床补全无图实体的图标）
let prefabEnNameMap: Record<string, string> | null = null;
function prefabEnNames(): Record<string, string> {
  if (!prefabEnNameMap) {
    try { prefabEnNameMap = JSON.parse(readText(join(PANEL_DIR, "data", "prefab_en_names.json"))); }
    catch { prefabEnNameMap = {}; }
  }
  return prefabEnNameMap!;
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
  // 加载模组 translations/ 目录的中文翻译文件（STRINGS.X.Y 覆盖，如 scripts/translations/zh.lua）
  // 俄语等其他语言的翻译文件不加载（避免把非中文文本带进翻译链）
  for (const trDir of [join(dir, id, "scripts", "translations"), join(dir, id, "translations")]) {
    try {
      if (!existsSync(trDir)) continue;
      for (const f of readdirSync(trDir)) {
        if (!f.endsWith(".lua") || !/zh|chs|schinese|simplified/i.test(f)) continue;
        const text = readText(join(trDir, f));
        if (!text) continue;
        const re2 = /([A-Z][A-Z0-9_]+(?:\.[A-Z][A-Z0-9_]*)*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
        let m2: RegExpExecArray | null;
        while ((m2 = re2.exec(text))) {
          const full = m2[1];
          const last = full.split(".").pop()!;
          const val = m2[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
          if (!strings.has(last)) strings.set(last, val);
          if (!strings.has(full)) strings.set(full, val);
        }
      }
    } catch {}
  }
  const result = { po, strings };
  modTransCache.set(id, result);
  return result;
}
// 通用配置词汇英→中词典（模组世界选项 label / 取值描述查不到翻译时的兜底翻译）
const WG_TERM_CN: Record<string, string> = {
  enable: "启用", enabled: "启用", enable_: "启用", disable: "禁用", disabled: "禁用", on: "开启", off: "关闭",
  true: "开启", false: "关闭", yes: "是", no: "否", none: "无", default: "默认", random: "随机",
  always: "总是", never: "从不", small: "小", medium: "中", large: "大", normal: "普通", big: "大",
  high: "高", low: "低", moderate: "中等", max: "最大", min: "最小", new: "新", old: "旧",
  top: "顶部", bottom: "底部", left: "左", right: "右", center: "中央", mini: "迷你", full: "完整",
  game: "游戏", mode: "模式", gamemode: "游戏模式", vote: "投票", votes: "投票", kick: "踢人",
  player: "玩家", players: "玩家", lobby: "大厅", character: "角色", characters: "角色", ability: "能力",
  changeable: "可变", change: "更改", fixed: "固定", server: "服务器", team: "队伍", teams: "队伍",
  show: "显示", hide: "隐藏", display: "显示", toggle: "切换", force: "强制", finish: "结束",
  start: "开始", delay: "延迟", command: "命令", sign: "标牌", info: "信息", music: "音乐",
  special: "特殊", event: "活动", events: "活动", winter: "冬季", feast: "盛宴", halloween: "万圣节",
  nights: "夜晚", night: "夜晚", soil: "土壤", edge: "边缘", texture: "纹理", avatar: "头像",
  icon: "图标", icons: "图标", indicator: "指示器", indicators: "指示器", badge: "徽章",
  message: "消息", messages: "消息", chat: "聊天", transparency: "透明度", target: "目标", targets: "目标",
  achievement: "成就", achievements: "成就", level: "等级", gear: "装备", lobby_gear: "大厅装备",
  debuff: "减益", debuffs: "减益", spectator: "观战", death: "死亡", gift: "礼物", location: "位置",
  world: "世界", map: "地图", biome: "生态群系", biomes: "生态群系", island: "岛屿", islands: "岛屿",
  ocean: "海洋", forest: "森林", terrain: "地形", generation: "生成", season: "季节", seasons: "季节",
  weather: "天气", density: "密度", difficulty: "难度", preset: "预设", size: "大小", type: "类型",
  count: "数量", number: "数量", amount: "数量", frequency: "频率", rate: "速度", speed: "速度",
  regrowth: "再生", spawn: "出生", chest: "宝箱", task: "任务", dungeon: "地牢",
  hunger: "饥饿", sanity: "理智", health: "生命", damage: "伤害", temperature: "温度",
  colour: "颜色", color: "颜色", cube: "方块", ball: "球", crop: "作物", crops: "作物",
  food: "食物", meat: "肉", fish: "鱼", monster: "怪物", monsters: "怪物", boss: "首领",
  structure: "建筑", structures: "建筑", item: "物品", items: "物品", resource: "资源", resources: "资源",
  tree: "树", trees: "树", grass: "草", berry: "浆果", berries: "浆果", flower: "花", flowers: "花",
  mushroom: "蘑菇", mushroom_: "蘑菇", rock: "岩石", rocks: "岩石", gold: "金", gem: "宝石",
  friendly: "友好", aggressive: "攻击性", passive: "被动", active: "主动", auto: "自动", manual: "手动",
  daily: "每日", weekly: "每周", monthly: "每月", permanent: "永久", temporary: "临时",
  single: "单个", multi: "多个", all: "全部", any: "任意", some: "部分", extra: "额外", additional: "额外",
  choose: "选择", tab: "标签", ping: "标记", match: "比赛", size: "大小", forestsize: "森林大小",
  wormhole: "虫洞", starter: "初始", starting: "初始", animal: "动物", animals: "动物",
  deforestation: "砍伐", autumn: "秋季", spring: "春季", summer: "夏季", desert: "沙漠",
  swamp: "沼泽", savanna: "稀树草原", rocky: "岩石", moon: "月亮", ruins: "遗迹", cave: "洞穴",
  // ReForged/Forge 竞技场及战斗类模组常用词
  effectiveness: "效果", efficiency: "效率", command: "命令", spam: "刷屏", ban: "封禁",
  time: "时间", nonzero: "非零", stat: "统计", stats: "统计", attack: "攻击", fx: "特效",
  environment: "环境", enemy: "敌人", enemies: "敌人", sleep: "睡觉", joinable: "可加入",
  midmatch: "中途", mob: "怪物", multiplier: "倍率", duplicator: "复制器", duplicate: "复制",
  custom: "自定义", rotation: "旋转", spectators: "观战者", reserve: "预留", slot: "槽位",
  slots: "槽位", shield: "护盾", shields: "护盾", broken: "破坏", break: "破坏",
  total: "总", wave: "波次", set: "设置", gametype: "游戏类型", battle: "战斗",
  standard: "标准", battlestandard: "战斗标准", mvp: "MVP", badge: "徽章",
  only: "仅", cant: "不可", cannot: "不可", dont: "不", doesnt: "不", wont: "不会", not: "不",
  without: "无", other: "其他", others: "其他", option: "选项", options: "选项", setting: "设置",
  group: "分组", main: "主", secondary: "次要", primary: "主要", bonus: "加成", chance: "几率",
  join: "加入", join_team: "加入队伍", rate: "速率", fx: "特效",
  audio: "音频", cherry: "樱花", cherrymusic: "樱花音乐", mute: "静音", mutelevel: "静音音量",
  sound: "声音", reduction: "降低", level_setting: "等级", comp: "组件", compat: "兼容",
  forge: "熔炉", gorge: "熔炉", skin: "皮肤", skins: "皮肤", uncomp: "不妥协", uncompromising: "不妥协",
  misc: "杂项", bloomprint: "樱花蓝图", fancy: "华丽", name: "名称", half: "一半", quiter: "更安静",
  language: "语言", events: "活动", worldgen: "世界生成", retrofit: "改造", characters: "角色",
  spawnpoint: "出生点", wirlywings: "樱桃子", ost: "背景音乐", main_difficulty: "主要难度",
  minigame: "小游戏", minigames: "小游戏", mods: "模组", difficulties: "难度",
  // 世界/生态
  tropical: "热带", humidity: "湿度", archipelago: "群岛", sea: "海洋", beach: "海滩", coast: "海岸",
  river: "河流", mountain: "山", hill: "丘陵", plateau: "高原", meadow: "草甸", jungle: "丛林",
  marsh: "沼泽", savanna_biome: "稀树草原", arctic: "极地", tundra: "苔原", wasteland: "废土",
  ruins_biome: "遗迹", lunar: "月亮", moon_island: "月岛", mainland: "大陆", grove: "树丛",
  shard: "分片", shards: "分片", world_size: "世界大小", land: "陆地", landmass: "陆地",
  // 季节/天气
  spring: "春季", summer: "夏季", autumn: "秋季", winter_season: "冬季", rainy: "雨季", dry: "旱季",
  monsoon: "季风", storm: "风暴", hurricane: "飓风", flood: "洪水", drought: "干旱", frost: "霜冻",
  fog: "雾", rain: "雨", snow: "雪", wind: "风", thunder: "雷", lightning: "闪电", length: "长度",
  duration: "持续时间", cycle: "周期", interval: "间隔", start_season: "起始季节",
  "rainy season": "雨季", "dry season": "旱季", "monsoon season": "季风季", "wet season": "雨季",
  "summer season": "夏季", "winter season": "冬季", "spring season": "春季", "autumn season": "秋季",
  "hurricane season": "飓风季", "spawn rate": "出生率", "drop rate": "掉落率",
  // 生物
  wolf: "狼", spider: "蜘蛛", bee: "蜜蜂", butterfly: "蝴蝶", bird: "鸟", turkey: "火鸡",
  pig: "猪", bunny: "兔", frog: "青蛙", mole: "鼹鼠", worm: "蠕虫", crab: "螃蟹", lobster: "龙虾",
  shark: "鲨鱼", whale: "鲸", octopus: "章鱼", jellyfish: "水母", penguin: "企鹅", turtle: "海龟",
  bear: "熊", deer: "鹿", rabbit: "兔子", rat: "老鼠", bat: "蝙蝠", snake: "蛇", dragonfly: "蜻蜓",
  mosquito: "蚊子", ant: "蚂蚁", locust: "蝗虫", critter: "小动物", critters: "小动物", mobs: "怪物",
  herd: "兽群", flock: "鸟群", population: "种群", spawn_rate: "出生率",
  // 资源/物品
  wood: "木材", stone: "石头", flint: "燧石", crystal: "水晶", bone: "骨头", feather: "羽毛",
  silk: "蛛丝", leather: "皮革", fur: "毛皮", vegetable: "蔬菜", fruit: "水果", seed: "种子",
  nut: "坚果", herb: "草药", ore: "矿石", iron: "铁", copper: "铜", silver: "银", coal: "煤",
  charcoal: "木炭", ash: "灰", clay: "黏土", sand: "沙", salt: "盐", rope: "绳", cloth: "布",
  paper: "纸", lantern: "灯笼", torch: "火把", weapon: "武器", armor: "护甲", helmet: "头盔",
  sword: "剑", axe: "斧", pickaxe: "镐", hammer: "锤", spear: "矛", bow: "弓", arrow: "箭",
  knife: "刀", tool: "工具", pot: "锅", bottle: "瓶", barrel: "桶", sack: "麻袋", basket: "篮子",
  trap: "陷阱", crate_box: "板条箱", ingredient: "食材", ingredients: "食材", recipe: "配方",
  // 游戏机制
  exp: "经验", experience: "经验", skill: "技能", talent: "天赋", perk: "特长", buff: "增益",
  heal: "治疗", revive: "复活", respawn: "重生", defense: "防御", agility: "敏捷", strength: "力量",
  intelligence: "智力", luck: "幸运", crit: "暴击", cooldown: "冷却", mana: "法力", stamina: "体力",
  thirst: "口渴", resistance: "抗性", immunity: "免疫", poison: "中毒", bleed: "流血", burn: "燃烧",
  freeze: "冰冻", stun: "眩晕", knockback: "击退", loot: "掉落物", drop: "掉落", limit: "上限",
  range: "范围", radius: "半径", distance: "距离", timer: "计时器", countdown: "倒计时",
  quality: "品质", rarity: "稀有度", tier: "阶级", rank: "等级", bonus: "加成", modifier: "修正",
  penalty: "惩罚", reward: "奖励", price: "价格", cost: "花费", weight: "重量", value: "价值",
  regen: "回复", health_regen: "生命回复", mana_regen: "法力回复", respawn_time: "重生时间",
  sometimes: "有时", often: "经常", rare: "稀有", common: "常见", epic: "史诗", legendary: "传说",
  mythic: "神话", hard: "困难", easy: "简单", insane: "疯狂", brutal: "残酷", starter: "初始",
  effect: "效果", effects: "效果",
  // 常见停用词（翻译时忽略）
  in: "", on: "", of: "", for: "", the: "", a: "", an: "", to: "", your: "", and: "", or: "",
  with: "", at: "", by: "", from: "", into: "", about: "", be: "", is: "", are: "", was: "",
  were: "", will: "", can: "", could: "", should: "", would: "", has: "", have: "", had: "",
};
const WG_TERM_STOP = new Set(["in", "on", "of", "for", "the", "a", "an", "to", "your", "and", "or", "with", "at", "by", "from", "into", "about", "be", "is", "are", "was", "were", "will", "can", "could", "should", "would", "has", "have", "had", "do", "does", "did"]);
// 俄语→中文小词典（俄语模组配置/游戏常见词，含常见词形变化；用于西里尔文本的兜底翻译）
const RU_TERM_CN: Record<string, string> = {
  выгнать: "驱逐", выгнать_игрока: "驱逐玩家", выгнан: "已驱逐", выгнано: "已驱逐",
  кикнуть: "踢出", кик: "踢出", включить: "启用", включено: "已启用", включён: "启用",
  отключить: "禁用", отключено: "已禁用", отключён: "禁用", вкл: "开", выкл: "关",
  игрок: "玩家", игрока: "玩家", игроки: "玩家", игроков: "玩家", игра: "游戏",
  режим: "模式", голосование: "投票", голосовать: "投票", сервер: "服务器", мир: "世界",
  карта: "地图", остров: "岛屿", острова: "岛屿", островов: "岛屿", лес: "森林", леса: "森林",
  сезон: "季节", погода: "天气", сложность: "难度", размер: "大小", тип: "类型",
  количество: "数量", скорость: "速度", частота: "频率", плотность: "密度", возрождение: "再生",
  здоровье: "生命", голод: "饥饿", рассудок: "理智", урон: "伤害", температура: "温度",
  спавн: "出生", появление: "生成", генерация: "生成", сложный: "困难", лёгкий: "简单",
  легкий: "简单", средний: "中等", обычный: "普通", новый: "新", большой: "大", маленький: "小",
  все: "全部", весь: "全部", случайный: "随机", да: "是", нет: "否", ничего: "无",
  настройки: "设置", параметр: "参数", значение: "值", функция: "功能", функция_включена: "功能已启用",
  изменить: "更改", показать: "显示", скрыть: "隐藏", убить: "击杀", убийца: "杀手",
  невинный: "无辜者", жертва: "受害者", предмет: "物品", ресурс: "资源", ресурсы: "资源",
  дерево: "树", деревья: "树", трава: "草", цветок: "花", цветы: "花", гриб: "蘑菇",
  камень: "岩石", камни: "岩石", золото: "金", еда: "食物", мясо: "肉", рыба: "鱼",
  босс: "首领", монстр: "怪物", монстры: "怪物", зима: "冬季", лето: "夏季", весна: "春季",
  осень: "秋季", ночь: "夜晚", день: "白天", волк: "狼", паук: "蜘蛛", пчела: "蜜蜂",
  краб: "螃蟹", акула: "鲨鱼", кит: "鲸", остров_вулкан: "火山岛", вулкан: "火山",
  дождь: "雨", молния: "闪电", туман: "雾", ветер: "风", землетрясение: "地震",
};
// 官方 po 单词兜底：从原版饥荒中文翻译（chinese_s.po，8.7 万条）查该单词的官方翻译
function poWord(w: string): string {
  if (!w || w.length < 2) return "";
  const po = chinesePo();
  return po.get(w) || po.get(w.charAt(0).toUpperCase() + w.slice(1)) || po.get(w.toUpperCase()) || "";
}
// 英文词组/驼峰 key → 中文（词典逐词翻译，未知词过多则放弃；"X in Y" 位置词前置更符合中文语序）
function zhPhrase(s: string): string {
  const q = (s || "").trim();
  if (!q) return "";
  const low = q.toLowerCase().replace(/\s+/g, " ").trim();
  if (WG_TERM_CN[low] !== undefined) return WG_TERM_CN[low];
  // 俄语（西里尔字母）文本：查俄语词典，整句直查 + 逐词查
  if (/[\u0400-\u04FF]/.test(low)) {
    if (RU_TERM_CN[low] !== undefined) return RU_TERM_CN[low];
    const parts = low.split(/[\s_\-]+/).map((w) => RU_TERM_CN[w]).filter(Boolean);
    if (parts.length) return parts.join("");
    return "";
  }
  const words = q.split(/[\s_\-\/]+/).flatMap((w) => w.split(/(?<=[a-z0-9])(?=[A-Z])/)).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((w) => w.length > 0);
  if (!words.length) return "";
  const plural = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const trans = (ws: string[]): string => {
    const parts: string[] = [];
    let unknown = 0;
    let hasOnly = false;
    let i = 0;
    while (i < ws.length) {
      const w = ws[i];
      if (WG_TERM_STOP.has(w)) { i++; continue; }
      if (w === "only") { hasOnly = true; i++; continue; }
      // 相邻两词组合查词典（"rainy season" → 雨季）
      if (i < ws.length - 1 && !WG_TERM_STOP.has(ws[i + 1])) {
        const pair = w + " " + ws[i + 1];
        if (WG_TERM_CN[pair] !== undefined) { parts.push(WG_TERM_CN[pair]); i += 2; continue; }
      }
      if (WG_TERM_CN[w] === "") { i++; continue; } // 词典空值停用词（in/on/of 等）
      // 原词 → 复数还原 → 词干还原（ing/ed/er/est）→ 官方 po 兜底（原版饥荒翻译）
      const stem = (x: string) => (x.endsWith("ing") && x.length > 5 ? x.slice(0, -3) : x.endsWith("ed") && x.length > 4 ? x.slice(0, -2) : x.endsWith("er") && x.length > 4 ? x.slice(0, -2) : x.endsWith("est") && x.length > 5 ? x.slice(0, -3) : x);
      const t = WG_TERM_CN[w] ?? WG_TERM_CN[plural(w)] ?? WG_TERM_CN[stem(w)] ?? WG_TERM_CN[plural(stem(w))] ?? poWord(w) ?? poWord(plural(w)) ?? poWord(stem(w));
      if (t) parts.push(t);
      else { unknown++; parts.push(w); } // 未知词保留原文，不整条放弃
      i++;
    }
    if (!parts.length || unknown >= Math.max(2, ws.length)) return "";
    // 仅完全包含去重（「战斗标准」含「标准」）
    const merged: string[] = [];
    for (const p of parts) {
      const last = merged[merged.length - 1];
      if (last && last !== p && (last.includes(p) || p.includes(last))) {
        merged[merged.length - 1] = p.length > last.length ? p : last;
      } else merged.push(p);
    }
    return (hasOnly ? "仅" : "") + merged.join("");
  };
  // "X in Y" / "X on Y" 位置短语：Y 前置（更符合中文习惯）
  const locIdx = words.findIndex((w) => ["in", "on", "at"].includes(w));
  if (locIdx > 0 && locIdx < words.length - 1) {
    const tA = trans(words.slice(locIdx + 1));
    const tB = trans(words.slice(0, locIdx));
    if (tA && tB) return tA + tB;
  }
  return trans(words);
}
// 模组世界选项中文翻译补充表（海难 Shipwrecked Together 等无自带中文语言包的模组）
// zhNameForKey 查不到时使用；覆盖模组专属词条（原版已有的由 FOREST_OPTIONS/CAVE_OPTIONS/原版字符串表翻译）
function worldConfigLabel(modId: string, opt: ModConfigOption): string {
  const key = opt.name.trim();
  const direct = MOD_WG_CN[key] || MOD_WG_CN[key.toLowerCase()] || MOD_WG_CN[opt.label.trim()];
  if (direct) return direct;
  const byKey = zhNameForKey(key, modId);
  if (byKey && byKey !== key) return byKey;
  const byMod = modStringLookup(modId, key.toUpperCase(), "NAMES");
  if (byMod) return zhText(byMod, modId);
  const orig = opt.label || key;
  const t = zhText(orig, modId);
  if (t !== orig) return t;
  const p = zhPhrase(orig);
  return p || t;
}

// 轻量启用模组（追加启用，不触发 applyEnabledMods 的冲突检测/预设应用/分片删除等副作用）
// 用于「添加层级」时自动启用对应的世界模组（如 IA 海难/火山层 → IA Shipwrecked + IA Core）
function enableLayerMods(ids: string[]): void {
  const master = listShards().find((s) => s.isMaster) || listShards()[0];
  const map = master ? readModOverrides(master.name) : new Map<string, ModOverrideEntry>();
  for (const id of ids) {
    const key = `workshop-${id}`;
    if (!map.has(key)) map.set(key, { enabled: true, options: {} });
  }
  ensureServerModSymlinks();
  const setupIds = new Set(readSetupIds());
  ids.forEach((id) => setupIds.add(id));
  writeSetupIds([...setupIds]);
  writeModOverridesBoth(map);
}

// 图标索引缓存：进程级一次性构建（key 归一化 → 相对路径），避免每个配置项都全量扫盘
let iconIndexCache: Map<string, { atlas: string; img: string; base: string }> | null = null;
function worldConfigIcon(key: string): { atlas: string; img: string } {
  if (!iconIndexCache) {
    iconIndexCache = new Map();
    const norm = (s: string) => s.toLowerCase().replace(/\.(tex|png)$/i, "").replace(/[^a-z0-9]/g, "");
    const root = join(PUBLIC_DIR, "icons");
    const walk = (dir: string, atlas: string, depth: number): void => {
      if (depth > 3) return;
      let files: string[] = [];
      try { files = readdirSync(dir); } catch { return; }
      for (const f of files) {
        const p = join(dir, f);
        let st; try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p, atlas || f, depth + 1);
        else if (/\.png$/i.test(f)) {
          const base = norm(f);
          if (!iconIndexCache.has(base)) iconIndexCache.set(base, { atlas, img: f.replace(/\.png$/i, ""), base });
        }
      }
    };
    walk(root, "", 0);
  }
  const target = (key || "").toLowerCase().replace(/\.(tex|png)$/i, "").replace(/[^a-z0-9]/g, "");
  if (!target) return { atlas: "", img: "" };
  const exact = iconIndexCache.get(target);
  if (exact) return { atlas: exact.atlas, img: exact.img };
  // 近似：包含匹配，取归一化名最短者（最可能是图标名本身）
  let best: { atlas: string; img: string; base: string } | null = null;
  for (const v of iconIndexCache.values()) {
    if (v.base.includes(target) || target.includes(v.base)) {
      if (!best || v.base.length < best.base.length) best = v;
    }
  }
  return best ? { atlas: best.atlas, img: best.img } : { atlas: "", img: "" };
}

function configValueLabel(modId: string, value: { description: string; data: any }): string {
  const orig = value.description || String(value.data);
  const t = zhText(orig, modId);
  if (t !== orig) return t;
  const p = zhPhrase(orig);
  return p || t;
}

const MOD_WG_CN: Record<string, string> = {
  angrybees: "怒蜂", ballphin: "球鼻海豚", ballphin_setting: "球鼻海豚", bamboo: "竹子",
  bioluminescence: "生物发光", bush_vine: "灌木藤", coral: "珊瑚", coral_brain_rock: "脑珊瑚岩",
  crabhole: "蟹洞", crate: "板条箱", crocodog: "鳄鱼狗", doydoy: "多多鸟", dragoonegg: "火鸡蛋",
  dropeverythingondespawn: "退出时掉落物品", erupt: "火山喷发", extrastartingitems: "额外初始物品",
  fishinhole: "渔洞", floods: "洪水", flup: "荧光水母", ghostenabled: "幽灵",
  ghostsanitydrain: "幽灵理智流失", jellyfish: "水母", jungletree_regrowth: "丛林树再生",
  kraken: "海怪", lessdamagetaken: "减少所受伤害", limpets: "帽贝", lobster: "龙虾",
  magmarock: "岩浆岩", mangrovetree_regrowth: "红树林再生", mermfisher: "鱼人渔夫",
  mosquitos: "蚊子", primeape: "猿猴", primeape_setting: "猿猴", sandhill: "沙丘", seagull: "海鸥",
  seashell: "贝壳", seaweed: "海藻", seasonalstartingitems: "季节初始物品", solofish: "独居鱼",
  spider_warriors: "蜘蛛战士", stungray: "黄貂鱼", sweet_potato: "红薯", swordfish: "剑鱼",
  tallbirds: "高脚鸟", temperaturedamage: "温度伤害", tidalpool: "潮汐池", tides: "潮汐",
  tigershark: "虎鲨", twister: "龙卷风", wasps: "黄蜂", whalehunt: "捕鲸",
  wildbores: "野猪", wildbores_setting: "野猪", spawnmode: "出生模式", spawnprotection: "出生保护",
  survivors: "幸存者", basicresource_regrowth: "基础资源再生", flowers_regrowth: "花朵再生",
  sweet_potato_regrowth: "红薯再生", fishinhole_regrowth: "渔洞再生", coral_regrowth: "珊瑚再生",
  monsoon: "季风季节", dryseason: "旱季", wetseason: "雨季", ocean: "海洋",
  volcanolevel: "火山", volcano: "火山", dragoon: "火鸡猎手", poison: "中毒",
  // 三合一/Tropical Experience 常见选项（modConfig 型）
  kindofworld: "世界类型", howmanyislands: "岛屿数量", islandsize: "岛屿大小",
  islandshape: "岛屿形状", numberofmainislands: "主岛数量", extraislands: "额外岛屿",
  islandspacing: "岛屿间距", islandposition: "岛屿位置", hasocean: "存在海洋",
  worldsize: "世界大小", continentsize: "大陆大小", fillingtheocean: "海洋填充",
  // Island Adventures - Shipwrecked 实测补充
  shipwrecked_season_start: "海难起始季节", volcanoisland: "火山岛", magma_rocks: "岩浆岩",
  shipwrecked_trees: "海难树木", shipwreck: "沉船", hurricane: "飓风季",
  alternatewhalehunt: "替代捕鲸", yellowcrocodog: "旱季鳄狗", fishermerm: "鱼人渔夫",
  bluecrocodog: "蓝鳄狗", waterencounters: "海上遭遇", chessnavy_setting: "海军棋",
  coral_brain_rock_regrowth: "脑珊瑚岩再生", seashell_regrowth: "贝壳再生",
  sandhill_regrowth: "沙堆再生", rock_obsidian_regrowth: "黑曜岩再生",
  rock_charcoal_regrowth: "木炭岩再生", volcano_shrub_regrowth: "灰烬树再生",
  magmarock_regrowth: "岩浆岩再生", bioluminescence_regrowth: "荧光生物再生",
  // Shipwrecked Together（1965741394）补充
  ballphin_setting: "球鼻海豚", crabbits_setting: "蟹兔", dry: "旱季", green: "绿季",
  mild: "温和季", mussel_farm: "贻贝", obsidian: "黑曜石", oceanwaves: "海浪",
  ox: "水牛", palmtree_regrowth: "棕榈树再生", poisonhole: "毒穴",
  portalresurection: "传送门复活", reeds_regrowth: "芦苇再生", resettime: "重置时间",
};
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
// 模组 lua 文件清单缓存（避免每次字符串查找都重新递归遍历模组目录，大模组 1000+ 文件时差距明显）
const modLuaFilesCache = new Map<string, string[]>();
function modLuaFiles(id: string): string[] {
  const cached = modLuaFilesCache.get(id);
  if (cached) return cached;
  const dir = join(ugcSharedDir(), id);
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
  // 字符串/语言类文件优先
  luaFiles.sort((a, b) => Number(!/string|lang|chs|cn_|names|zh/i.test(a)) - Number(!/string|lang|chs|cn_|names|zh/i.test(b)));
  modLuaFilesCache.set(id, luaFiles);
  return luaFiles;
}
function modStringLookup(id: string, key: string, prefix = ""): string {
  let cache = modStrCache.get(id);
  if (!cache) { cache = new Map(); modStrCache.set(id, cache); }
  const cacheKey = prefix + "." + key;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  const reDotted = new RegExp(`${prefix ? prefix + "\\." : ""}\\b${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.){1,100})"`);
  const reBare = new RegExp(`\\b${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.){1,100})"`, "g");
  const luaFiles = modLuaFiles(id);
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
  // 解析 local 变量定义（如 local sw_atlas = "images/hud/customization_shipwrecked.xml"）
  const luaLocals: Record<string, string> = {};
  for (const lm of text.matchAll(/local\s+([A-Za-z_]\w*)\s*=\s*"([^"]+)"/g)) {
    luaLocals[lm[1]] = lm[2];
  }
  // normalizeAtlas 的增强版：支持变量引用解析
  const resolveAtlas = (ref: string): string => {
    if (!ref) return "";
    // 直接是路径字符串
    const na = normalizeAtlas(ref);
    if (na) return na;
    // 变量引用 → 从 luaLocals 查找
    if (luaLocals[ref]) return normalizeAtlas(luaLocals[ref]);
    return "";
  };
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
        let label = zhNameForKey(key, modId) || MOD_WG_CN[key] || MOD_WG_CN[key.replace(/_setting$/, "")] || "";
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
    let label = zhNameForKey(key, modId) || MOD_WG_CN[key] || MOD_WG_CN[key.replace(/_setting$/, "")] || "";
    if (!label && modId) {
      const en = modStringLookup(modId, key.toUpperCase(), "NAMES") || modStringLookup(modId, key.replace(/_setting$/, "").toUpperCase(), "NAMES");
      if (en) label = chinesePo().get(en) || en;
    }
    options.push({ key, label: label || key, group: groupLabel, world, default: def, values, img, atlas });
  };
  // --- 通用补丁式解析：兼容任意模组的 modworldgenmain.lua 定义方式 ---
  // 收集表变量别名：local wg = DebugUtil.GetValue(Customize.GetWorldGenOptions, "WORLDGEN_GROUP")
  //               local wg = WORLDGEN_GROUP（或 local wg = WORLDGEN_GROUP or {}）
  const tableAlias: Record<string, string> = {};
  for (const m of text.matchAll(/local\s+([A-Za-z_]\w*)\s*=\s*DebugUtil\.GetValue\([^,]+,\s*"(WORLDGEN_GROUP|WORLDSETTINGS_GROUP)"\)/g)) tableAlias[m[1]] = m[2];
  for (const m of text.matchAll(/local\s+([A-Za-z_]\w*)\s*=\s*(WORLDGEN_GROUP|WORLDSETTINGS_GROUP)(?:\s+or\s+\{)?/g)) tableAlias[m[1]] = m[2];
  const escRe = (n: string) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 解析一个分组块（含 items 子层则取其 items，否则整块即条目容器）并 push 选项
  const parseGroupBlock = (gblk: string, fallbackGroup: string): void => {
    const groupDesc = (/\bdesc\s*=\s*([A-Za-z_]\w*)/.exec(gblk) || [])[1] || "";
    const groupTextExpr = (/\btext\s*=\s*([^,\n]+)/.exec(gblk) || [])[1] || "";
    const groupLabel = resolveStringsRef(groupTextExpr, modId) || fallbackGroup;
    const gaM = /\batlas\s*=\s*(?:([A-Z_][A-Za-z0-9_]*)|"([^"]+)")/.exec(gblk);
    const groupAtlas = normalizeAtlas((gaM && (gaM[1] || gaM[2])) || "");
    const im = /items\s*=\s*\{/.exec(gblk);
    const iBody = im ? (() => { const ie = braceMatch(gblk, im.index + im[0].length - 1); return ie === -1 ? gblk : gblk.slice(im.index + im[0].length, ie); })() : gblk;
    for (const it of extractItemsFromGroup(iBody)) {
      const itemAtlasM = /\batlas\s*=\s*(?:([A-Z_][A-Za-z0-9_]*)|"([^"]+)")/.exec(it.block);
      pushItem(it.key, it.block, groupLabel, "", (itemAtlasM && normalizeAtlas(itemAtlasM[1] || itemAtlasM[2])) || groupAtlas);
    }
  };
  for (const gname of ["WORLDGEN_GROUP", "WORLDSETTINGS_GROUP"]) {
    const names = [...new Set([gname, ...Object.keys(tableAlias).filter((k) => tableAlias[k] === gname)])].map(escRe);
    // 组级补丁：alias["组"] = { ... } / alias["组"] = alias["组"] or { ... }
    const grpPatchRe = new RegExp(`(?:${names.join("|")})\\s*\\[\\s*"([^"]+)"\\s*\\]\\s*=\\s*(?:(?:${names.join("|")})\\s*\\[\\s*"[^"]+"\\s*\\]\\s*or\\s*)?\\{`, "g");
    let pm: RegExpExecArray | null;
    while ((pm = grpPatchRe.exec(text))) {
      const ge = braceMatch(text, grpPatchRe.lastIndex - 1);
      if (ge === -1) continue;
      const gblk = text.slice(grpPatchRe.lastIndex, ge);
      grpPatchRe.lastIndex = ge;
      parseGroupBlock(gblk, pm[1]);
    }
    // 条目级补丁：alias["组"].items["条目"] = { ... }
    const itemPatchRe = new RegExp(`(?:${names.join("|")})\\s*\\[\\s*"([^"]+)"\\s*\\]\\s*\\.items\\s*\\[\\s*"([^"]+)"\\s*\\]\\s*=\\s*\\{`, "g");
    let im2: RegExpExecArray | null;
    while ((im2 = itemPatchRe.exec(text))) {
      const ie = braceMatch(text, itemPatchRe.lastIndex - 1);
      if (ie === -1) continue;
      const iblk = text.slice(itemPatchRe.lastIndex, ie);
      itemPatchRe.lastIndex = ie;
      pushItem(im2[2], iblk, im2[1], "", "");
    }
  }
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
  // --- Island Adventures / Shipwrecked 风格：ia_worldgen_customize_table + ia_settings_customize_table ---
  // 结构：local ia_xxx_customize_table = { global = { key = { value=, image=, atlas=, desc= }, ... } }
  // 注意：IA 没有 items 子层，条目直接在分组块中
  // atlas 字段通常是变量引用（如 sw_atlas = "images/hud/customization_shipwrecked.xml"）
  for (const iaTableName of ["ia_worldgen_customize_table", "ia_settings_customize_table"]) {
    const iaRe = new RegExp("\\b" + iaTableName + "\\s*=\\s*\\{", "g");
    let iaM: RegExpExecArray | null;
    while ((iaM = iaRe.exec(text))) {
      const iaEnd = braceMatch(text, iaM.index + iaM[0].length - 1);
      if (iaEnd === -1) { iaRe.lastIndex = text.length; break; }
      const iaBody = text.slice(iaM.index + iaM[0].length, iaEnd);
      iaRe.lastIndex = iaEnd;
      const grpRe = /([A-Za-z_]\w*)\s*=\s*\{/g;
      let gr: RegExpExecArray | null;
      while ((gr = grpRe.exec(iaBody))) {
        const ge = braceMatch(iaBody, grpRe.lastIndex - 1);
        if (ge === -1) continue;
        const gblk = iaBody.slice(grpRe.lastIndex, ge);
        grpRe.lastIndex = ge;
        const groupTextExpr = (/\btext\s*=\s*([^,\n]+)/.exec(gblk) || [])[1] || "";
        const groupLabel = resolveStringsRef(groupTextExpr, modId) || gr[1];
        const gaM = /\batlas\s*=\s*(?:"([^"]+)"|([A-Za-z_]\w*))/.exec(gblk);
        let groupAtlas = resolveAtlas((gaM && (gaM[1] || gaM[2])) || "") || "customization_shipwrecked";
        // IA 无 items 子层：整个分组块即为条目容器
        // 但如果有 items 子表则用之（兼容变体）
        const im = /items\s*=\s*\{/.exec(gblk);
        const iBody = im ? (() => { const ie = braceMatch(gblk, im.index + im[0].length - 1); return ie === -1 ? gblk : gblk.slice(im.index + im[0].length, ie); })() : gblk;
        for (const it of extractItemsFromGroup(iBody)) {
          const itemAtlasM = /\batlas\s*=\s*(?:"([^"]+)"|([A-Za-z_]\w*))/.exec(it.block);
          if (itemAtlasM) groupAtlas = resolveAtlas(itemAtlasM[1] || itemAtlasM[2]) || groupAtlas;
          pushItem(it.key, it.block, groupLabel, "shipwrecked", groupAtlas);
        }
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
  return modWorldgenDataFromDir(id, join(ugcSharedDir(), id));
}
// 按目录分析模组的世界生成内容（本地模组库直接传客户端路径，无需先入库）
// 配置驱动型世界选项补充：把模组 configuration_options（configOptions）转为世界选项
function buildModConfigWorldOptions(id: string, mi: ModInfo | null, existing: ModWorldgenOption[]): ModWorldgenOption[] {
  const out = [...existing];
  for (const opt of mi?.configOptions || []) {
    if (out.some((o) => o.key === opt.name)) continue;
    const icon = worldConfigIcon(opt.name);
    out.push({
      key: opt.name,
      label: worldConfigLabel(id, opt),
      group: "世界设置",
      world: "",
      default: String(opt.default ?? ""),
      values: opt.options.length ? opt.options.map((op) => ({ v: String(op.data), label: configValueLabel(id, op) })) : [{ v: String(opt.default ?? "default"), label: configValueLabel(id, { description: opt.label, data: opt.default }) }],
      img: icon.img,
      atlas: icon.atlas,
      modConfig: true,
    });
  }
  return out;
}
// 目录级世界生成分析缓存（key: id|dir）——local-steam 列表对每个模组分析时避免重复解析
const modWgDirCache = new Map<string, ReturnType<typeof modWorldgenDataFromDirRaw>>();
function modWorldgenDataFromDir(id: string, dir: string): { name: string; options: ModWorldgenOption[]; presets: ModWorldgenPreset[]; worldgenFiles: string[] } | null {
  const k = `${id}|${dir}`;
  if (modWgDirCache.has(k)) return modWgDirCache.get(k)!;
  const r = modWorldgenDataFromDirRaw(id, dir);
  modWgDirCache.set(k, r);
  return r;
}
function modWorldgenDataFromDirRaw(id: string, dir: string): { name: string; options: ModWorldgenOption[]; presets: ModWorldgenPreset[]; worldgenFiles: string[] } | null {
  if (!existsSync(dir)) return null;
  const files: string[] = [];
  const mw = join(dir, "modworldgenmain.lua");
  const mwState = modFileState(id, dir);
  if (mwState.worldgen) files.push(mw);
  const msc = join(dir, "modservercreationmain.lua");
  if (existsSync(msc)) files.push(msc);
  const cust = join(dir, "scripts", "map", "customize_patch.lua");
  if (existsSync(cust)) files.push(cust);
  const custItems = join(dir, "modcustomizeitems.lua");
  if (existsSync(custItems)) files.push(custItems);
  const lvDir = join(dir, "scripts", "map", "levels");
  try { if (existsSync(lvDir)) for (const f of readdirSync(lvDir)) if (f.endsWith(".lua")) files.push(join(lvDir, f)); } catch {}
  // 递归解析 modimport 引用的文件：世界选项/预设可能定义在 modimport 的其他 lua 里
  const imported: string[] = [];
  const queue = files.filter((f) => /mod(?:worldgen|servercreation)main\.lua$/.test(f));
  while (queue.length) {
    const cur = queue.shift()!;
    let t = "";
    try { t = readText(cur); } catch {}
    for (const m of t.matchAll(/modimport\s+"([^"]+)"/g)) {
      const rel = m[1].replace(/\.lua$/i, "") + ".lua";
      const p = join(dir, rel);
      if (existsSync(p) && !files.includes(p) && !imported.includes(p)) { imported.push(p); queue.push(p); }
    }
  }
  files.push(...imported);
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
  if (!options.length) {
    // 配置驱动型世界模组（三合一 Tropical Experience、海难等普通带 modworldgenmain.lua 的模组）：
    // 没有标准的 WORLDGEN_GROUP/LEVELTYPE 定义，世界设置通过 configuration_options 控制
    // 仅当存在 modworldgenmain.lua 时才补充 configOptions 为世界选项（无世界生成文件的
    // 功能/角色/语言类模组不进入世界选项页）
    if (mwState.worldgen) {
      const mi = parseModInfo(id, join(dir, "modinfo.lua"));
      options = buildModConfigWorldOptions(id, mi, options);
    }
  }
  if (!options.length && !presets.length) return null;
  const mi = parseModInfo(id, join(dir, "modinfo.lua"));
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
const MODS_STATE_FILE = join(PANEL_DIR, "mods_state.json");
// ---------- 模组关键文件状态缓存（modinfo.lua / modmain.lua / modworldgenmain.lua 是否存在） ----------
// 记录到 JSON 文件：读取优先走内存/JSON 缓存，避免每次请求都查磁盘；
// 下载/导入/链接/删除后调用 refreshModFileState 刷新对应条目，保持新鲜。
type ModsFileState = { info: boolean; main: boolean; worldgen: boolean; at: number };
let modsStateCache: Record<string, ModsFileState> | null = null;
function loadModsState(): Record<string, ModsFileState> {
  if (modsStateCache) return modsStateCache;
  try { modsStateCache = JSON.parse(readText(MODS_STATE_FILE)); } catch {}
  modsStateCache = modsStateCache || {};
  return modsStateCache;
}
function saveModsState() {
  try { writeFileSync(MODS_STATE_FILE, JSON.stringify(modsStateCache || {})); } catch {}
}
// 读取模组关键文件状态：命中缓存（60 分钟内）直接返回，不碰磁盘；miss/过期才检查并回写
function modFileState(id: string, dir?: string): { info: boolean; main: boolean; worldgen: boolean } {
  const st = loadModsState();
  const rec = st[id];
  if (rec && Date.now() - rec.at < 60 * 60 * 1000) return rec;
  const d = dir || join(ugcSharedDir(), id);
  const r: ModsFileState = {
    info: existsSync(join(d, "modinfo.lua")),
    main: existsSync(join(d, "modmain.lua")),
    worldgen: existsSync(join(d, "modworldgenmain.lua")),
    at: Date.now(),
  };
  st[id] = r;
  saveModsState();
  return r;
}
// 强制刷新某模组文件状态（下载/导入/链接/删除后调用，避免读到过期状态）
function refreshModFileState(id: string, dir?: string): void {
  const st = loadModsState();
  delete st[id];
  if (dir) modFileState(id, dir);
  else saveModsState();
}
// 把地址当作「通用 HTTP 代理」（Clash/V2Ray 等）使用；代理不通时回退直连。
// 面板实例地址（http://IP:5323）本身不是 HTTP 代理，会走失败分支回退直连，不影响原逻辑。
async function steamFetch(url: string, init: RequestInit, proxyTimeoutMs = 5000): Promise<Response> {
  const p = panelConfig.steamProxy;
  if (!p) return fetch(url, init);
  try {
    return await fetch(url, { ...init, proxy: p, signal: AbortSignal.timeout(proxyTimeoutMs) } as any);
  } catch {
    return fetch(url, init);
  }
}
async function querySteam(ids: string[]): Promise<{ ok: boolean; items: Record<string, SteamItem>; msg?: string }> {
  if (!ids.length) return { ok: true, items: {} };
  try {
    const body = `itemcount=${ids.length}` + ids.map((id, i) => `&publishedfileids[${i}]=${encodeURIComponent(id)}`).join("");
    const res = await steamFetch("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/", {
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
  ensureServerModSymlinks();
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
const TMP_DIR = os.tmpdir();
// 跨平台解压 zip（Linux 用系统 unzip；Windows 用 PowerShell Expand-Archive）
async function unzipTo(zip: string, dest: string): Promise<boolean> {
  if (IS_WIN) {
    const z = zip.replace(/'/g, "''"), d = dest.replace(/'/g, "''");
    const r = await run(["powershell", "-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${z}' -DestinationPath '${d}'`], { timeoutMs: 180000 });
    return r.code === 0;
  }
  const r = await run(["unzip", "-o", "-q", zip, "-d", dest]);
  return r.code <= 1;
}
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
const slotHome = (s: number) => join(TMP_DIR, `dst_dl_home_${s}`);

// Windows steamcmd 首次运行需自更新（~30MB），提前跑一次 +quit 完成初始化
// 若 steamcmd 不存在则自动下载（steamcmd.zip → 解压到面板 steamcmd 目录，可走面板代理）
let steamcmdBootstrapped = false;
// steamcmd.zip 多源（官方 CDN 国内经常不通，逐个尝试，配合代理）
const STEAMCMD_SOURCES = [
  "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip",
  "https://cdn.cloudflare.steamstatic.com/client/installer/steamcmd.zip",
  "https://media.steampowered.com/client/installer/steamcmd.zip",
];
// 在常见位置查找已存在的 steamcmd.exe（面板目录 / DST 服务器目录 / 用户目录）
function findExistingSteamcmd(): string | null {
  const cands: string[] = [STEAMCMD];
  if (panelConfig.serverDir) {
    cands.push(join(panelConfig.serverDir, "steamcmd.exe"), join(panelConfig.serverDir, "bin", "steamcmd.exe"));
  }
  const up = process.env.USERPROFILE || "";
  if (up) cands.push(join(up, "steamcmd", "steamcmd.exe"), join(up, "Downloads", "steamcmd", "steamcmd.exe"));
  const lap = process.env.LOCALAPPDATA || "";
  if (lap) cands.push(join(lap, "steamcmd", "steamcmd.exe"));
  return cands.find((p) => existsSync(p)) || null;
}
async function ensureSteamcmdReady(): Promise<void> {
  if (steamcmdBootstrapped || !IS_WIN) return;
  const found = findExistingSteamcmd();
  if (found && found !== STEAMCMD) {
    // 发现其他位置的 steamcmd，复制到面板目录统一管理
    try {
      mkdirSync(dirname(STEAMCMD), { recursive: true });
      copyFileSync(found, STEAMCMD);
    } catch {}
  }
  if (!existsSync(STEAMCMD)) {
    const exeDir = dirname(STEAMCMD);
    try {
      mkdirSync(exeDir, { recursive: true });
      let ok = false;
      const sp = panelConfig.steamProxy;
      for (const url of STEAMCMD_SOURCES) {
        const zip = join(exeDir, "steamcmd.zip");
        const curlArgs = ["curl", "-fSL", "--connect-timeout", "20", "--retry", "1", "-o", zip, url];
        if (sp) curlArgs.splice(1, 0, "-x", sp);
        const dl = await run(curlArgs, { timeoutMs: 180000 });
        if (dl.code === 0 && existsSync(zip) && statSync(zip).size > 1000) {
          const r = await run(["powershell", "-NoProfile", "-Command", `Expand-Archive -Force -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${exeDir.replace(/'/g, "''")}'`], { timeoutMs: 60000 });
          try { rmSync(zip, { force: true }); } catch {}
          if (r.code === 0 && existsSync(STEAMCMD)) { ok = true; break; }
        } else {
          try { rmSync(zip, { force: true }); } catch {}
        }
      }
      if (!ok) return; // 全部源下载失败，保持未安装状态
    } catch (e: any) { return; }
  }
  // 首次运行 bootstrap（自更新），超时 3 分钟
  const r = await run([STEAMCMD, "+quit"], { cwd: dirname(STEAMCMD), timeoutMs: 180000 });
  steamcmdBootstrapped = true;
}

async function downloadOneMod(id: string, task: Task, slot: number): Promise<boolean> {
  // Windows 下若 steamcmd 不存在，先尝试自动下载（多源 steamcmd.zip + 代理 + 常见位置查找）
  await ensureSteamcmdReady();
  if (!existsSync(STEAMCMD)) {
    task.log += `[失败] steamcmd 未安装（已尝试从多个镜像自动下载仍失败，可能网络不通）。\n`;
    task.log += `  请任选其一：\n  1) 手动下载 steamcmd.zip 解压后把 steamcmd.exe 放到 ${dirname(STEAMCMD)}\\ \n  2) 在「基本设置」配置 Steam搜索代理后再试\n`;
    return false;
  }
  const home = slotHome(slot);
  mkdirSync(home, { recursive: true });
  task.log += `\n===== steamcmd 下载模组 ${id}（并行槽位 ${slot + 1}）=====\n`;
  const r = await run([STEAMCMD, "+login", "anonymous", "+workshop_download_item", "322330", id, "+quit"], {
    cwd: dirname(STEAMCMD),
    env: { HOME: home },
    timeoutMs: 10 * 60 * 1000,
  });
  task.log += r.out.slice(-4000) + `\n(exit=${r.code})\n`;
  // HOME 覆盖后 steamcmd 统一下载到临时目录
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
        const good = await unzipTo(join(src, bin), dst);
        if (!good) {
          task.log += `[失败] 解压 ${bin} 失败\n`;
          return false;
        }
      }
    } else {
      try { copyDirSync(src, dst); } catch (e: any) {
        task.log += `[失败] 复制失败: ${e?.message || e}\n`;
        return false;
      }
    }
    if (modCache.items[id]) { modCache.items[id].downloadedAt = Date.now(); saveModCache(); }
    task.log += `[完成] 已安装到 ${dst}\n`;
    clearModCaches(); // 模组内容变了，图标/物品/字符串缓存重建
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
  const zipPath = join(TMP_DIR, `dst_mod_${id}.zip`);
  const tmpDir = join(TMP_DIR, `dst_mod_${id}_x`);
  try {
    task.totalBytes = st.file_size || 0;
    task.log += `[CDN] ${st.title || id}（${(st.file_size / 1048576).toFixed(1)} MB）\n${st.file_url}\n`;
    // 配置了 steamProxy 时优先走代理下载（Clash 等），失败回退 steamcmd
    const curlArgs = ["curl", "-fSL", "--connect-timeout", "15", "--retry", "2"];
    const sp = panelConfig.steamProxy;
    if (sp) curlArgs.push("-x", sp);
    curlArgs.push("-o", zipPath, st.file_url);
    const proc = Bun.spawn(curlArgs, { stdout: "ignore", stderr: "ignore" });
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
    const uzOk = await unzipTo(zipPath, tmpDir);
    if (!uzOk) { task.log += `[失败] 解压失败\n`; return false; }
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
    try { copyDirSync(root, dst); } catch (e: any) { task.log += `[失败] 复制失败: ${e?.message || e}\n`; return false; }
    if (modCache.items[id]) { modCache.items[id].downloadedAt = Date.now(); saveModCache(); }
    task.log += `[完成] 已安装到 ${dst}\n`;
    clearModCaches(); // 模组内容变了，图标/物品/字符串缓存重建
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
  const zipPath = join(TMP_DIR, `dst_modinfo_${id}.zip`);
  const tmpDir = join(TMP_DIR, `dst_modinfo_${id}_x`);
  try {
    const res = await steamFetch(st.file_url, { signal: AbortSignal.timeout(20000) }, 8000);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 100) return false;
    writeFileSync(zipPath, new Uint8Array(buf));
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    if (!(await unzipTo(zipPath, tmpDir))) return false;
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

// 本地源复制：优先从客户端创意工坊缓存 / 服务器端 mods 复制模组（Windows 无需 steamcmd）
async function downloadFromLocalSources(id: string, task: Task): Promise<boolean> {
  const candidates: { path: string; desc: string }[] = [];
  // 客户端创意工坊缓存：<客户端>\steamapps\workshop\content\322330\<id>（Steam 已下载的模组）
  if (IS_WIN) {
    const cli = detectDstClient();
    if (cli) {
      candidates.push({ path: join(cli.workshopDir, id), desc: "客户端创意工坊缓存" });
      candidates.push({ path: join(cli.modsDir, `workshop-${id}`), desc: "客户端 mods 目录" });
    }
  }
  // 服务器端：<服务器目录>\mods\workshop-<id>
  if (panelConfig.serverDir) {
    candidates.push({ path: join(panelConfig.serverDir, "mods", `workshop-${id}`), desc: "服务器端 mods" });
  }
  for (const c of candidates) {
    if (!existsSync(c.path) || !existsSync(join(c.path, "modinfo.lua"))) continue;
    task.log += `[本地源] 从${c.desc}复制: ${c.path}\n`;
    ensureUgcLayout();
    const dst = join(ugcSharedDir(), id);
    try {
      rmSync(dst, { recursive: true, force: true });
      copyDirSync(c.path, dst);
      if (modCache.items[id]) { modCache.items[id].downloadedAt = Date.now(); saveModCache(); }
      task.log += `[完成] 已从${c.desc}安装到 ${dst}\n`;
      clearModCaches();
      return true;
    } catch (e: any) {
      task.log += `[失败] 复制失败: ${e?.message || e}\n`;
    }
  }
  task.log += "[提示] 客户端/服务器端无此模组，转 steamcmd 下载\n";
  return false;
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
    if (!good) good = await downloadFromLocalSources(task.modId, task);
    if (!good) good = await downloadOneMod(task.modId, task, slot);
    if (good) refreshModFileState(task.modId); // 下载成功：刷新关键文件状态缓存
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
    const res = await steamFetch(`https://steamcommunity.com/sharedfiles/filedetails/changelog/${id}?l=schinese`, {
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
async function workshopSearch(q: string, proxy?: string): Promise<{ id: string; title: string; preview_url: string }[]> {
  let html: string;
  const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" };
  const target = `https://steamcommunity.com/workshop/browse/?appid=322330&searchtext=${encodeURIComponent(q)}&browsesort=textsearch&section=readytouseitems&l=schinese`;
  if (proxy) {
    // 兼容两种填法：
    // 1) 另一台「面板实例」地址 → 先试其 /proxy/steam-workshop-browse 接口（6 秒内失败则降级）
    // 2) 本地「通用 HTTP 代理」（Clash/V2Ray 等）→ steamFetch 会把它当代理用，不通自动回退直连
    try {
      const panelUrl = `${proxy.replace(/\/$/, "")}/proxy/steam-workshop-browse?q=${encodeURIComponent(q)}`;
      const res = await fetch(panelUrl, { headers: UA, signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(`面板代理返回 HTTP ${res.status}`);
      html = await res.text();
    } catch {
      const res = await steamFetch(target, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Steam 返回 HTTP ${res.status}`);
      html = await res.text();
    }
  } else {
    const res = await fetch(target, { headers: UA, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Steam 返回 HTTP ${res.status}`);
    html = await res.text();
  }
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
function chatLogPaths(): string[] {
  const out: string[] = [];
  for (const s of listShards()) {
    const p = join(shardDir(s.name), "server_chat_log.txt");
    if (existsSync(p)) out.push(p);
  }
  return out;
}
function chatLogPath(): string | null {
  const paths = chatLogPaths();
  return paths.length ? paths[0] : null;
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
  // 附带权威图标映射（前端不再按 key 名猜图，避免 crow_carnival→crowcarnival 这类对不上）
  const icons = worldoptionIconMap();
  return (isMaster ? FOREST_OPTIONS : CAVE_OPTIONS).map((o: any) => ({ ...o, icon: icons[o.key] || null }));
}

// ---------- 物品分类修正 ----------
// 数据表由游戏脚本自动生成，部分分类明显错分（舞台剧/代币/生物/世界实体被归为"建筑"等），在此统一纠正
let itemsApiCache: { key: string; data: any[] } = { key: "", data: [] };
const ITEM_CATEGORY_FIX_EXACT: Record<string, string> = {
  stafflight: "其他", staffcoldlight: "其他", // 矮星/极光是召唤光实体，不是建筑
  shadowhand: "生物", shadowhand_arm: "生物",
  quagmire_goatkid: "生物", quagmire_goatmum: "生物",
  lavaarena_bernie: "生物", boarrior: "生物", beetletaur: "生物",
  waveyjones: "生物", charlie_npc: "生物", charlie_heckler: "生物",
  waxwell_shadowstriker: "生物", waxwell_shadowminer: "生物", waxwell_shadowlumber: "生物", waxwell_shadowdigger: "生物",
  alterguardian_phase3dead: "生物",
  lavaarena_lucy: "工具", // 熔炉版露西斧
  quagmire_hoe: "工具", pocket_scale: "工具",
  blowdart_lava: "武器", fireballstaff: "武器",
  gemsocket: "其他", telebase: "其他", animal_track: "其他", dirtpile: "其他",
  pond: "其他", pond_mos: "其他", pond_cave: "其他", wormhole: "其他",
  cave_entrance: "其他", cave_entrance_ruins: "其他", cave_entrance_open: "其他", cave_exit: "其他",
  grotto_pool_big: "其他", grotto_pool_small: "其他", watertree_pillar: "其他", watertree_root: "其他",
  marbletree: "植物", marblebean: "植物", marblebean_sapling: "植物", marbleshrub: "植物",
  pinecone_sapling: "植物", mushroomsprout: "植物",
  quagmire_pot: "其他", quagmire_grill: "其他", quagmire_casseroledish: "其他", quagmire_crate_grill: "其他",
  quagmire_safe: "其他", quagmire_altar_ivy: "其他",
};
const ITEM_CATEGORY_FIX_RULES: [RegExp, string][] = [
  [/^playbill(_|$)/, "其他"],       // 舞台剧剧本/道具
  [/^carnival_gametoken/, "资源"],  // 鸦年华代币
  [/^carnival_prize/, "资源"],      // 鸦年华奖票
  [/_sketch$/, "资源"],             // 雕塑草图
  [/^turf_/, "资源"],               // 地皮
  [/^quagmire_rubble_/, "其他"],    // 暴食废墟（世界实体）
  [/^quagmire_spotspice_/, "植物"], // 斑点香料灌木/枝
  [/^boatfragment/, "其他"],        // 船碎片（漂浮残骸）
];
function fixItemCategory(prefab: string, cat: string): string {
  const exact = ITEM_CATEGORY_FIX_EXACT[prefab];
  if (exact) return exact;
  for (const [re, c] of ITEM_CATEGORY_FIX_RULES) if (re.test(prefab)) return c;
  return cat || "其他";
}

// ---------- 多开端口工具 ----------
// 收集指定存档占用的全部端口（分片 server_port / steam 端口 / cluster.ini 的 master_port）
function clusterPorts(name: string, effective = true): { port: number; file: string; key: string }[] {
  const out: { port: number; file: string; key: string }[] = [];
  const cdir = join(clusterRoot(), name);
  const ciPath = join(cdir, "cluster.ini");
  // effective=true：按有效值计算（缺失配置按面板默认端口 10889/11000/11001/27018/27019/8768/8769），用于冲突检测
  // effective=false：只算显式配置的端口，用于新建存档/世界时的端口分配（首个存档应拿到经典默认端口）
  if (existsSync(ciPath)) {
    const ci = parseIni(readText(ciPath));
    const v = iniGet(ci, "SHARD", "master_port");
    if (v || effective) out.push({ port: Number(v || 10889), file: ciPath, key: "[SHARD] master_port" });
  }
  let shardNames: string[] = [];
  try { shardNames = readdirSync(cdir).filter((d) => existsSync(join(cdir, d, "server.ini"))); } catch {}
  for (const sn of shardNames) {
    const f = join(cdir, sn, "server.ini");
    const lines = parseIni(readText(f));
    const isM = /^true$/i.test(iniGet(lines, "SHARD", "is_master") || "");
    const sp = iniGet(lines, "NETWORK", "server_port");
    if (sp || effective) out.push({ port: Number(sp || (isM ? 11000 : 11001)), file: f, key: "[NETWORK] server_port" });
    const msp = iniGet(lines, "STEAM", "master_server_port");
    if (msp || effective) out.push({ port: Number(msp || (isM ? 27018 : 27019)), file: f, key: "[STEAM] master_server_port" });
    const ap = iniGet(lines, "STEAM", "authentication_port");
    if (ap || effective) out.push({ port: Number(ap || (isM ? 8768 : 8769)), file: f, key: "[STEAM] authentication_port" });
  }
  return out;
}
// 当前存档与运行中的其他存档之间的端口冲突清单（列出需要修改的端口、文件与键名）
function findPortConflicts(others: Map<string, string[]>): { port: number; file: string; key: string; other: string }[] {
  const mine = clusterPorts(panelConfig.cluster);
  const conflicts: { port: number; file: string; key: string; other: string }[] = [];
  for (const [other] of others) {
    const theirs = new Set(clusterPorts(other).map((p) => p.port));
    for (const m of mine) {
      if (theirs.has(m.port) && !conflicts.some((c) => c.port === m.port && c.file === m.file)) conflicts.push({ ...m, other });
    }
  }
  return conflicts;
}
// 其他存档（非当前控制存档）的运行进程分组
function groupOtherRunning(all: { cluster: string; shard: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of all) {
    if (r.cluster === panelConfig.cluster) continue;
    if (!map.has(r.cluster)) map.set(r.cluster, []);
    map.get(r.cluster)!.push(r.shard);
  }
  return map;
}

// 启用模组统一逻辑（mod设置页保存所选 / 本地模组库一键启用 共用）：
// 冲突检测 → 写 modoverrides+setup ids → 不支持洞穴的地图模组自动删 Caves 分片 → 新启用的大型地图模组自动应用世界预设
async function applyEnabledMods(ids: string[]): Promise<Response> {
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
  // 先确保符号链接就位，再写 setup（writeSetupIds 会跳过已通过链接存在的模组，避免 Workshop 下载删除链接）
  ensureServerModSymlinks();
  writeSetupIds(ids);
  writeModOverridesBoth(map);
  const omitted = [...old.keys()].filter((k) => !enabledSet.has(k.replace("workshop-", "")));
  // 检测启用的地图模组是否有地下/独立世界预设（洞穴、火山等）
  // 猪镇等纯地上模组没有地下预设 → 自动删除 Caves 分片
  // 海难模组有火山预设（volcanoworld） → 保留 Caves 分片，预设设为火山
  const activeWorldMods = ids.filter((id) => {
    const d = modWorldgenData(id);
    if (!d) return false;
    const hasCavePreset = d.presets.some((p) => /volcano|cave|under/i.test(p.location || ""));
    const hasOverworldPreset = d.presets.some((p) => !/volcano|cave|under/i.test(p.location || ""));
    // 只有地上预设、没有地下预设 = 纯地上地图模组（如猪镇）
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
    // 非主分片：匹配地下/独立世界预设（洞穴、火山等）
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
      // 预设自带的 overrides 由 DST 引擎加载预设时自动应用（在 level_data.overrides 中），
      // 不需要面板重复写入 worldgenoverride.lua。
      // IA 模组的 water.lua 会把 yesno 类型值（如 volcano="yes"）当作 MULTIPLY 频率值处理，
      // 重复写入会导致 nil 算术错误。
      writeLevelOverrides(shard.name, shard.isMaster, {}, pick.id);
      autoApplied.push(`${shard.name}→${pick.id}`);
    }
  }
  return ok(null, `已保存所选（启用 ${ids.length} 个模组）` + (omitted.length ? `；未勾选的 ${omitted.length} 个模组配置已省略` : "") + (autoApplied.length ? `；已自动应用大型模组预设: ${autoApplied.join("、")}` : ""));
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
    // 运行中的存档清单（用于存档列表标记"运行中"）
    const runningClusters = [...new Set((await runningDstAll()).map((r) => r.cluster))];
    // Windows：客户端位置（手动设置优先，否则自动检测 Steam 库）
    const clientAuto = detectDstClient();
    // Windows：服务器目录（手动设置优先，否则自动检测 Steam 库中的 DST 专用服务器）
    const serverAuto = { dir: readServerDirFromConfig() };
    return ok({
      clusterRoot: clusterRoot(),
      clusterRoots: panelConfig.clusterRoots,
      defaultClusterRoot: DEFAULT_CLUSTER_ROOT,
      modsDir: modsStoreDir(),
      serverDir: panelConfig.serverDir || serverAuto.dir,
      serverAuto,
      clientDir: panelConfig.clientDir || clientAuto?.dir || "",
      clientAuto,
      clusters,
      clusterList,
      cluster: panelConfig.cluster,
      beta: panelConfig.beta,
      betaBranch: panelConfig.betaBranch,
      lang: langSetting,
      runningClusters,
      isWin: IS_WIN,
      multiOpenMinMem: MULTI_OPEN_MIN_MEM,
      steamProxy: panelConfig.steamProxy || "",
      version: PANEL_VERSION,
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
    // 存档根目录优先处理：先把 clusterRoot 切过去并清缓存，后续 cluster.ini / modoverrides 都写到新位置，
    // 否则分片列表缓存可能还是旧根目录的，写 modoverrides.lua 会因目录不存在而 ENOENT 崩溃
    if (typeof b.clusterRoot === "string" && b.clusterRoot.trim() && b.clusterRoot.trim() !== clusterRoot()) {
      const dir = b.clusterRoot.trim();
      if (!isAbsPath(dir)) return fail("存档根目录必须是绝对路径");
      try { mkdirSync(dir, { recursive: true }); panelConfig.clusterRoot = dir; } catch { return fail("无法创建存档根目录: " + dir); }
      // 记录存档位置历史，方便随时切换
      panelConfig.clusterRoots = [dir, ...panelConfig.clusterRoots.filter((x) => x !== dir)].slice(0, 12);
      clearAllClusterCache();
    }
    const iniPath = join(clusterDir(), "cluster.ini");
    // 当前存档目录不存在时（刚切换根目录/外部删除）不创建"空骨架存档"——
    // 否则会留下只有 1 字节 cluster.ini 的幽灵目录，挡住后续新建同名存档
    const clusterDirExists = existsSync(dirname(iniPath));
    let skippedIni = false;
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
    // 存档目录已存在才写 cluster.ini；不存在则跳过并在返回消息中提示
    if (clusterDirExists) {
      writeFileSync(iniPath, iniToText(lines) + "\n");
    } else {
      skippedIni = true;
    }
    // 保存 cluster_token.txt（非空才覆盖；clear_token 可清除）
    if (typeof b.cluster_token === "string") {
      const token = b.cluster_token.trim();
      if (token) writeFileSync(join(clusterDir(), "cluster_token.txt"), token + "\n");
    }
    if (b.clear_token === true) writeFileSync(join(clusterDir(), "cluster_token.txt"), "# 在此粘贴 Klei 服务器令牌\n");
    panelConfig.beta = !!b.beta;
    if (typeof b.betaBranch === "string" && /^[A-Za-z0-9_-]{0,64}$/.test(b.betaBranch)) panelConfig.betaBranch = b.betaBranch;
    // 语言设置：写入中文语言包在两个分片的 modoverrides（保持启用状态）。
    // 分片目录可能不存在（刚切换根目录/外部删除），单个失败不影响整体保存
    if (["simplified", "traditional", "auto"].includes(String(b.lang))) {
      for (const shard of listShards()) {
        try {
          mkdirSync(shardDir(shard.name), { recursive: true });
          const map = readModOverrides(shard.name);
          const entry = map.get("workshop-367546858") || { enabled: true, options: {} };
          entry.enabled = true;
          entry.options.LANG = String(b.lang);
          map.set("workshop-367546858", entry);
          writeFileSync(join(shardDir(shard.name), "modoverrides.lua"), serializeModOverrides(map) + "\n");
        } catch {}
      }
    }
    // 保存服务器目录
    if (typeof b.serverDir === "string" && b.serverDir.trim()) {
      const dir = b.serverDir.trim();
      if (existsSync(dir)) { panelConfig.serverDir = dir; } else return fail("服务器目录不存在: " + dir);
    }
    if (typeof b.clusterRoot === "string" && b.clusterRoot.trim() && b.clusterRoot.trim() === clusterRoot()) {
      // 根目录未变化（已在开头处理过变更），仅补记历史
      panelConfig.clusterRoots = [clusterRoot(), ...panelConfig.clusterRoots.filter((x) => x !== clusterRoot())].slice(0, 12);
    }
    // Windows：客户端位置（空 = 清除手动设置回到自动检测）
    if (typeof b.clientDir === "string") {
      const dir = b.clientDir.trim();
      if (!dir) panelConfig.clientDir = "";
      else if (!isAbsPath(dir)) return fail("客户端位置必须是绝对路径");
      else if (!existsSync(dir)) return fail("客户端位置不存在: " + dir);
      else panelConfig.clientDir = dir;
    }
    if (typeof b.modsDir === "string" && b.modsDir.trim()) {
      const dir = b.modsDir.trim();
      if (!isAbsPath(dir)) return fail("模组存放目录必须是绝对路径");
      try { mkdirSync(dir, { recursive: true }); panelConfig.modsDir = dir; } catch { return fail("无法创建模组存放目录: " + dir); }
    }
    // Steam Community 代理（供内网/墙内面板中转搜索请求）
    if (typeof b.steamProxy === "string") {
      const url = b.steamProxy.trim();
      if (!url) { panelConfig.steamProxy = ""; }
      else if (!/^https?:\/\/[^\s]+$/.test(url)) return fail("Steam搜索代理格式不正确，需为 http(s)://开头");
      else panelConfig.steamProxy = url;
    }
    clearAllClusterCache();
    savePanelConfig();
    return ok(null, "已保存，重启面板后路径修改生效（其他设置重启服务器后生效）"
      + (skippedIni ? "。⚠ 当前存档目录不存在，基本设置未写入——请先在「存档」中新建或选择存档" : ""));
  }
  if (path === "cluster" && method === "POST") {
    const b = await bodyJson(req);
    if (typeof b.cluster === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b.cluster) && existsSync(join(clusterRoot(), b.cluster))) {
      panelConfig.cluster = b.cluster;
      clearAllClusterCache();
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
      clearAllClusterCache();
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
    // 新建存档固定使用默认端口（与43服务器MyDediServer一致：防火墙按此放行，不做端口区分/避让；
    // 多开冲突由端口设置中的黄色警告提示，用户自行决定是否修改）
    const masterPort = 10889;
    const mServer = 11000, mSteam = 27018, mAuth = 8768;
    const cServer = 11001, cSteam = 27019, cAuth = 8769;
    writeFileSync(join(dir, "cluster.ini"), `[GAMEPLAY]\ngame_mode = survival\nmax_players = 6\npvp = false\npause_when_empty = true\nvote_kick_enabled = true\n\n[NETWORK]\ncluster_name = ${name}\ncluster_description = A dedicated server\ncluster_password =\n\n[MISC]\nconsole_enabled = true\n\n[SHARD]\nshard_enabled = true\nbind_ip = 127.0.0.1\nmaster_ip = 127.0.0.1\nmaster_port = ${masterPort}\ncluster_key = supersecretkey\n`);
    writeFileSync(join(dir, "cluster_token.txt"), "# 在此粘贴 Klei 服务器令牌（必须填写才能开服）\n");
    writeFileSync(join(dir, "Master", "server.ini"), `[NETWORK]\nserver_port = ${mServer}\n\n[SHARD]\nis_master = true\n\n[STEAM]\nmaster_server_port = ${mSteam}\nauthentication_port = ${mAuth}\n\n[ACCOUNT]\nencode_user_path = true\n`);
    writeFileSync(join(dir, "Caves", "server.ini"), `[NETWORK]\nserver_port = ${cServer}\n\n[SHARD]\nis_master = false\nname = Caves\n\n[STEAM]\nmaster_server_port = ${cSteam}\nauthentication_port = ${cAuth}\n\n[ACCOUNT]\nencode_user_path = true\n`);
    panelConfig.cluster = name;
    clearAllClusterCache();
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
        clearAllClusterCache();
        savePanelConfig();
        return ok(null, `已删除存档 ${name}，已切换到 ${rest[0]}`);
      }
      return ok(null, `已删除存档 ${name}（当前没有可用存档，请新建）`);
    }
    return ok(null, `已删除存档 ${name}`);
  }

  // ===== 编辑世界 =====
  // 层级类型基础配置：类型 → 中文名 / 地上或地下 / 需要自动启用的模组
  // IA(Island Adventures) 海难/火山层级由 IA 模组生成；猪镇需另行安装对应模组
  const LAYER_TYPES: Record<string, { label: string; surface: boolean; mods: string[]; note?: string }> = {
    forest: { label: "原版地表", surface: true, mods: [] },
    cave: { label: "原版洞穴", surface: false, mods: [] },
    shipwrecked: { label: "海难", surface: true, mods: ["1467214795", "3435352667"] },
    volcanoworld: { label: "火山", surface: false, mods: ["1467214795", "3435352667"] },
    porkland: { label: "猪镇", surface: true, mods: [], note: "猪镇世界需自行安装对应的猪镇/哈姆雷特模组" },
  };
  const LAYER_LOC_CN: Record<string, string> = {
    shipwrecked: "海难", volcanoworld: "火山", porkland: "猪镇", hamlet: "哈姆雷特",
    tropical: "热带", cave: "洞穴", under: "地下", volcano: "火山", forest: "地表",
  };
  // 可用「世界生成类型」：原版地表/洞穴 + 已启用模组提供的世界类型（海难/火山/猪镇/三合一等）
  function availableLayerTypes(): { type: string; label: string; surface: boolean; mods: string[]; modTitle: string }[] {
    const out: { type: string; label: string; surface: boolean; mods: string[]; modTitle: string }[] = [
      { type: "forest", label: "原版地表", surface: true, mods: [], modTitle: "" },
      { type: "cave", label: "原版洞穴", surface: false, mods: [], modTitle: "" },
    ];
    const seen = new Set<string>(["forest", "cave"]);
    // IA 系列固定类型（已下载才列出）
    for (const [t, base] of [["shipwrecked", "海难"], ["volcanoworld", "火山"], ["porkland", "猪镇"]] as const) {
      if (seen.has(t)) continue;
      const modIds = t === "porkland" ? [] : ["1467214795", "3435352667"];
      if (modIds.length && !modIds.some((id) => localModDirs().includes(id))) continue;
      seen.add(t);
      out.push({ type: t, label: base, surface: t !== "volcanoworld", mods: modIds, modTitle: modIds.length ? modCache.items[modIds[0]]?.title || "Island Adventures" : "需自行安装猪镇模组" });
    }
    // 已启用模组提供的额外世界类型（三合一/其他地图模组）
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    if (master) {
      for (const [key, e] of readModOverrides(master.name)) {
        if (!e.enabled) continue;
        const id = key.replace("workshop-", "");
        const d = modWorldgenData(id);
        if (!d || !d.presets.length) continue;
        for (const p of d.presets) {
          const loc = p.location;
          if (!loc || seen.has(loc) || /SURVIVAL_TOGETHER|DST_CAVE/.test(p.id)) continue;
          seen.add(loc);
          const isUnder = /volcano|cave|under|ruins/i.test(loc);
          out.push({ type: loc, label: LAYER_LOC_CN[loc] || loc, surface: !isUnder, mods: [id], modTitle: modCache.items[id]?.title || parseModInfo(id)?.name || id });
        }
      }
    }
    return out;
  }
  if (path === "worlds" && method === "GET") {
    const shards = listShards();
    for (const s of shards) s.running = await shardRunning(s.name);
    return ok(shards);
  }
  if (path === "worlds/layer-types" && method === "GET") {
    return ok({ types: availableLayerTypes() });
  }
  if (path === "worlds/add" && method === "POST") {
    const b = await bodyJson(req);
    const layerType = String(b.type || "cave");
    const lt = LAYER_TYPES[layerType] || availableLayerTypes().find((t) => t.type === layerType);
    if (!lt) return fail(`不支持的层级类型: ${layerType}`);
    const shards = listShards();
    // 首个「地上」层级成为主世界（海难/原版地表都可做主世界）
    const wantMaster = lt.surface && !shards.some((s) => s.isMaster);
    // 需要模组的层级：检查下载情况，已下载则自动启用（对应「模组设计」）
    if (lt.mods.length) {
      const localIds = new Set(localModDirs());
      const needDownload = lt.mods.filter((id) => !localIds.has(id));
      if (needDownload.length) {
        const names = needDownload.map((id) => modCache.items[id]?.title || `workshop-${id}`).join("、");
        return fail(`添加「${lt.label}」层级需要对应模组，请先在 mod设置 页下载: ${names}（ID: ${needDownload.join(", ")}）后重试。`);
      }
      enableLayerMods(lt.mods);
    }
    // 检查是否有不兼容洞穴的地图模组已启用（仅地下类层级需要）
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
            return fail(`已启用地图模组「${name}」不支持地下世界，无法添加该层级。`);
          }
        }
      }
    }
    // 优先识别既有世界文件夹（客户端存档只有文件夹没有 server.ini）：直接导入并补全配置
    if (layerType === "forest" || layerType === "cave") {
      const firstChoice = wantMaster ? "Master" : "Caves";
      const existingNoIni = shards.find((s) => s.name === firstChoice && !s.hasIni);
      if (existingNoIni) {
        ensureServerIni(firstChoice);
        return ok(null, `已识别并导入既有世界文件夹 ${firstChoice}（客户端存档缺少 server.ini，已自动补全并分配端口），世界数据原样保留，可直接启动`);
      }
    }
    // 命名：按类型命名，首个该类型不加序号，之后 Forest2/Caves2/Shipwrecked2…
    const baseNames: Record<string, string> = { forest: "Master", cave: "Caves", shipwrecked: "Shipwrecked", volcanoworld: "Volcano", porkland: "Porkland" };
    let name = baseNames[layerType] || "Shard";
    if (shards.some((s) => s.name === name)) {
      let n = 2;
      while (shards.some((s) => s.name === `${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    // 主世界标记：一个存档只有一个主世界（第一个地上世界），其余都是附加层
    const hasMaster = shards.some((s) => s.isMaster);
    const isMaster = wantMaster && !hasMaster;
    // 附加层 = 超出经典「地上+地下」组合的多开层，面板不维护其设置
    const isExtraLayer = !isMaster && (shards.length >= 2 || (wantMaster && hasMaster));
    // 自动分配端口：地上类 11000 起 / 地下类 11001 起；同存档多世界必须不同端口
    const usedPorts = new Set<number>();
    try { for (const p of clusterPorts(panelConfig.cluster, true)) usedPorts.add(p.port); } catch {}
    const alloc = (start: number) => { let p = start; while (usedPorts.has(p)) p++; usedPorts.add(p); return p; };
    const isSurfaceLayer = lt.surface;
    const serverPort = alloc(isSurfaceLayer ? 11000 : 11001);
    const steamPort = alloc(isMaster ? 27018 : 27019);
    const authPort = alloc(isMaster ? 8768 : 8769);
    const dir = shardDir(name);
    if (existsSync(dir)) return fail("目录已存在: " + name);
    mkdirSync(dir, { recursive: true });
    const ini = `[NETWORK]\nserver_port = ${serverPort}\n\n[SHARD]\nis_master = ${isMaster}\n${isMaster ? "" : `name = ${name}\n`}\n[STEAM]\nmaster_server_port = ${steamPort}\nauthentication_port = ${authPort}\n\n[ACCOUNT]\nencode_user_path = true\n`;
    writeFileSync(join(dir, "server.ini"), ini);
    // 新分片继承当前启用模组配置（modoverrides 与主世界一致），保证层级对应的模组（如 IA）在该分片生效
    try {
      const masterShard = listShards().find((s) => s.isMaster) || listShards()[0];
      if (masterShard && existsSync(shardDir(masterShard.name))) {
        const ovText = serializeModOverrides(readModOverrides(masterShard.name));
        if (ovText) writeFileSync(join(dir, "modoverrides.lua"), ovText);
      }
    } catch {}
    clearShardListCache();
    return ok({ name, isMaster, ports: { server: serverPort, steam: steamPort, auth: authPort } },
      `已创建${lt.label}世界 ${name}${isMaster ? "（主世界）" : ""}，端口 ${serverPort}/${steamPort}/${authPort} 已自动分配，请记得保存世界设置`
      + (lt.mods.length ? `（已自动启用对应模组: ${lt.mods.map((id) => modCache.items[id]?.title || id).join("、")}）` : "")
      + (lt.note ? `。${lt.note}` : "")
      + (isExtraLayer ? `。注意：一个存档只有一个主世界（已标记），${name} 属于附加层，面板不维护附加层的世界设置` : ""));
  }
  if (path === "worlds/delete" && method === "POST") {
    const b = await bodyJson(req);
    const shard = String(b.shard || "");
    const target = listShards().find((s) => s.name === shard);
    if (!target) return fail("世界不存在");
    if (await shardRunning(shard)) return fail("该世界正在运行，禁止删除，请先关闭服务器");
    // 主世界在其他世界仍存在时禁止删除（从属世界需要主世界才能连接）
    if (target.isMaster && listShards().length > 1) return fail("这是主世界，其他世界还依赖它。请先删除其他世界，最后才能删除主世界");
    rmSync(shardDir(shard), { recursive: true, force: true });
    clearShardListCache();
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
    // 原版选项按层级类型：地表类（Master/Forest*/Shipwrecked*/Porkland*）用地表选项，地下类（Caves*/Volcano*）用洞穴选项
    const isSurfaceShard = target.isMaster || /^(Master|Forest|Shipwrecked|Porkland)/i.test(shard);
    return ok({ shard, isMaster: target.isMaster, overrides, presets, options: worldOptionTable(isSurfaceShard), hasWorldgenMod, hasReplaceWorldgenMod });
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
      mods.push({ id, ...d, options: enriched, enabledOnShard: e.enabled !== false });
    }
    // 原版世界选项（模组世界时原版 optTable 被隐藏，这里附带原版选项供前端合并显示）
    const isSurfaceShard = target.isMaster || /^(Master|Forest|Shipwrecked|Porkland)/i.test(shard);
    return ok({ mods, vanilla: worldOptionTable(isSurfaceShard) });
  }
  // 切换某层级「模组世界生成」开关：修改该分片 modoverrides.lua 的 enabled，
  // 关闭后该层级生成世界时不再加载该模组的 modworldgenmain.lua 影响（仅影响当前层级）
  if (path === "world/mod-enabled" && method === "POST") {
    const b = await bodyJson(req);
    const shard = String(b.shard || "");
    const modId = String(b.modId || "");
    const on = b.on !== false;
    if (!validId(modId)) return fail("非法模组 ID");
    const target = listShards().find((s) => s.name === shard);
    if (!target) return fail("世界不存在");
    const map = readModOverrides(shard);
    const key = `workshop-${modId}`;
    const title = modCache.items[modId]?.title || parseModInfo(modId)?.name || modId;
    if (!map.has(key)) {
      if (!on) return ok(null, `层级 ${shard} 未启用模组「${title}」，无需关闭`);
      map.set(key, { enabled: true, options: {} });
    }
    map.get(key)!.enabled = on;
    writeFileSync(join(shardDir(shard), "modoverrides.lua"), serializeModOverrides(map));
    clearModCaches();
    return ok(null, on ? `已在层级 ${shard} 启用「${title}」的世界生成（重新生成世界生效）` : `已在层级 ${shard} 停用「${title}」的世界生成（该层级不再受其 modworldgenmain.lua 影响，重新生成世界生效）`);
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
        // yesno 类选项（值 yes/no）的特殊处理：
        // IA 的 water.lua 用 MULTIPLY 表查频率值控制水域实体散布。
        // volcano=yes/no 会进入 MULTIPLY 查询，需要映射为 default/never 避免 nil 算术错误。
        const vals = modAllowed.get(k)!;
        const isYesNo = vals.has("yes") && vals.has("no") && vals.size <= 3;
        if (isYesNo) {
          current[k] = String(v) === "no" ? "never" : "default";
          continue;
        }
        // volcanoisland=disabled 时，IA 的 level postinit 检查 overrides.volcanoisland ~= "none"
        // 来决定是否添加 VolcanoIsland 任务。设为 "none" 才能阻止火山岛生成。
        // volcano 保持 default（yes）以保留火山水域实体。
        if (k === "volcanoisland" && (String(v) === "disabled" || String(v) === "none")) {
          current[k] = "none";
          continue;
        }
        if (vals.has(String(v))) current[k] = String(v);
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
        if (!ids.includes(id)) { ids.push(id); ensureServerModSymlinks(); writeSetupIds(ids); }
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
  if (path === "world/regenerate" && method === "POST") {
    for (const s of listShards()) {
      if (await shardRunning(s.name)) {
        await stopShard(s.name);
        await sleep(1000);
      }
    }
    await sleep(3000);
    for (const s of listShards()) {
      const saveDir = join(shardDir(s.name), "save");
      try { rmSync(saveDir, { recursive: true, force: true }); } catch {}
      const sessDir = join(shardDir(s.name), "save", "session");
      try { rmSync(sessDir, { recursive: true, force: true }); } catch {}
    }
    try { rmSync(join(SERVER_DIR, "mods", "modindex"), { force: true }); } catch {}
    await sleep(1000);
    for (const s of listShards()) {
      await startShard(s.name);
      await sleep(2000);
    }
    return ok(null, "世界正在重新生成…（已使用最新的世界设置，请等待1-2分钟）");
  }

  // ===== mod 设置 =====
  if (path === "mods" && method === "GET") {
    const force = url.searchParams.get("refresh") === "1";
    const { list, steamOk } = await buildModList(force);
    return ok({ mods: list, steamOk, cacheTime: modCache.time, isWin: IS_WIN, modsDir: modsStoreDir() });
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
    const options = (mi?.configOptions || []).map((o) => {
      // 中文翻译：真实翻译链（语言包/po）查不到时，用通用词汇词典词组翻译兜底
      const zhOf = (s: string) => { const t = zhText(s, id); return t !== s ? t : (zhPhrase(s) || t); };
      return {
        ...o,
        label_zh: zhOf(o.label),
        hover_zh: zhOf(o.hover),
        options: o.options.map((op) => ({ ...op, description_zh: zhOf(typeof op.description === "string" ? op.description : String(op.description)) })),
        current: ov && o.name in ov.options ? ov.options[o.name] : o.default,
      };
    });
    const changelogs = await fetchChangeLogs(id);
    // ---------- 安装详情 ----------
    const localIds = new Set(localModDirs());
    const isDownloaded = localIds.has(id);
    const localVersion = mi?.version || "";
    const dlAt = modDownloadedAt(id);
    const updateAvail = !!st && st.time_updated > 0 && dlAt > 0 && st.time_updated * 1000 > dlAt;
    // 检测本地关键文件（读 JSON 状态缓存，不实时查磁盘）
    const lf = modFileState(id);
    const localFiles: Record<string, boolean> = { "modinfo.lua": lf.info, "modmain.lua": lf.main, "modworldgenmain.lua": lf.worldgen };
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
    return applyEnabledMods(ids);
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
    ensureServerModSymlinks();
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
    if (existsSync(dir)) { try { removePathOrLink(dir); } catch {} }
    // 1b. 删除 ugc_mods 目录（链接加载的模组只移除联接本身，不动客户端文件）
    for (const c of ugcContentDirs()) {
      const u = join(c, String(b.id));
      if (existsSync(u)) { try { removePathOrLink(u); } catch {} }
    }
    refreshLinkManifest();
    // 2. 从 dedicated_server_mods_setup.lua 移除
    const cur = readSetupIds().filter((x) => x !== String(b.id));
    ensureServerModSymlinks();
    writeSetupIds(cur);
    // 3. 从所有分片的 modoverrides.lua 移除
    for (const shard of listShards()) {
      const map = readModOverrides(shard.name);
      const key = `workshop-${b.id}`;
      if (map.has(key)) { map.delete(key); writeFileSync(join(shardDir(shard.name), "modoverrides.lua"), serializeModOverrides(map)); }
    }
    refreshModFileState(String(b.id));
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
      const results = await workshopSearch(q, panelConfig.steamProxy || undefined);
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
  // ===== Windows 本地模组复用（本地模组直接开房间） =====
  if (path === "mods/local-steam" && method === "GET") {
    // 标注每个本地模组：存放目录状态 / 名称说明 / 图标 / 世界生成分析(覆盖or叠加) / 启用状态 / 收藏
    const store = modsStoreDir();
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    const enabledIds = new Set<string>();
    if (master) for (const [k, e] of readModOverrides(master.name)) if (e.enabled) enabledIds.add(k.replace("workshop-", ""));
    const scanned = scanLocalSteamMods();
    // 异步补全创意工坊元数据（不阻塞列表加载，超时1秒快失败）
    ensureSteamCache(scanned.map((m) => m.id)).catch(() => {});
    const mods = scanned.map((m) => {
      const p = join(store, m.id);
      let linked = false, inStore = false;
      try { if (lstatSync(p).isSymbolicLink()) linked = true; else if (existsSync(p)) inStore = true; } catch {}
      // 名称与说明（直接从客户端 modinfo.lua 解析）
      let name = "", desc = "";
      const infoFile = join(m.path, "modinfo.lua");
      if (existsSync(infoFile)) {
        const text = readText(infoFile);
        name = luaStrField(text, "name");
        desc = luaStrField(text, "description").replace(/\s+/g, " ").slice(0, 300);
      }
      // 世界生成分析：modworldgenmain.lua 等 → 覆盖世界(替换型) or 加入设置(兼容叠加型)
      let worldMode = "";
      const wg = modWorldgenDataFromDir(m.id, m.path);
      if (wg && (wg.options.length || wg.presets.length)) {
        const mwText = existsSync(join(m.path, "modworldgenmain.lua")) ? readText(join(m.path, "modworldgenmain.lua")) : "";
        const isReplace = /AddLevel\s*\(\s*LEVELTYPE\.|AddWorldGenLevel\s*\(\s*LEVELTYPE\.|AddPreset\s*\(/.test(mwText)
          || wg.presets.some((pr) => !VANILLA_PRESETS.has(pr.id));
        worldMode = isReplace ? "replace" : "extend";
      }
      return {
        ...m, linked, inStore, name, desc,
        hasIcon: existsSync(join(m.path, "modicon.tex")),
        // 官网预览图（无本地 modicon.tex 时前端回退用，走 /img-proxy 防直连失败）
        preview: modCache.items[m.id]?.preview_url || "",
        worldMode, wgPresetCount: wg?.presets.length || 0,
        enabled: enabledIds.has(m.id),
        favorite: panelConfig.favorites.includes(m.id),
      };
    });
    // 收藏置顶，已启用其次
    mods.sort((a, b) => Number(b.favorite) - Number(a.favorite) || Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id));
    return ok({ mods, modsDir: store, client: detectDstClient() });
  }
  // 本地模组库一键启用/停用：未入库的自动链接加载后启用；停用只改启用状态不动文件
  if (path === "mods/local-enable" && method === "POST") {
    const b = await bodyJson(req);
    const id = String(b.id || "");
    const src = String(b.path || "");
    if (!validId(id)) return fail("非法模组 ID");
    const on = b.on !== false;
    const master = listShards().find((s) => s.isMaster) || listShards()[0];
    if (!master) return fail("当前存档没有任何世界分片");
    const cur = [...readModOverrides(master.name).entries()].filter(([, e]) => e.enabled).map(([k]) => k.replace("workshop-", ""));
    if (on) {
      // 确保模组在存放目录（未链接/未复用则自动链接加载，链接失败退回复制）
      const dst = join(modsStoreDir(), id);
      if (!existsSync(dst)) {
        if (!src || src.includes("..") || !existsSync(src) || !existsSync(join(src, "modinfo.lua")))
          return fail("模组不在存放目录且来源路径无效，请先「链接加载」或「复用(复制)」");
        mkdirSync(modsStoreDir(), { recursive: true });
        try { symlinkSync(src, dst, IS_WIN ? "junction" : "dir"); }
        catch { try { copyDirSync(src, dst); } catch (e: any) { return fail("模组入库失败: " + (e?.message || e)); } }
        refreshLinkManifest();
        clearModCaches();
      }
      if (cur.includes(id)) return ok(null, `模组 ${id} 已处于启用状态`);
      return applyEnabledMods([...cur, id]);
    }
    if (!cur.includes(id)) return ok(null, `模组 ${id} 未启用`);
    return applyEnabledMods(cur.filter((x) => x !== id));
  }
  // 链接加载：在模组存放目录建立目录联接(Junction)/符号链接直接指向客户端模组文件夹，不复制、不占磁盘、随 Steam 自动更新
  if (path === "mods/link-local" && method === "POST") {
    const b = await bodyJson(req);
    const id = String(b.id || "");
    const src = String(b.path || "");
    if (!validId(id)) return fail("非法模组 ID");
    if (!src || src.includes("..") || !existsSync(src)) return fail("来源路径不存在");
    if (!existsSync(join(src, "modinfo.lua"))) return fail("来源目录缺少 modinfo.lua，不是有效的模组目录");
    const dst = join(modsStoreDir(), id);
    mkdirSync(modsStoreDir(), { recursive: true });
    try {
      if (lstatSync(dst).isSymbolicLink()) {
        if (readlinkSync(dst) === src) return ok(null, `模组 ${id} 已是链接加载状态 → ${src}`);
        removePathOrLink(dst);
      } else if (existsSync(dst)) {
        return fail(`模组 ${id} 在存放目录已有复用副本，请先在模组列表中删除该副本，或改用「复用(复制)」覆盖`);
      }
    } catch {}
    try {
      symlinkSync(src, dst, IS_WIN ? "junction" : "dir");
    } catch (e: any) {
      return fail("创建链接失败: " + (e?.message || e));
    }
    refreshLinkManifest();
    clearModCaches();
    refreshModFileState(id);
    return ok(null, `已链接加载模组 ${id} → 直接读取 ${src}（不占用额外磁盘）`);
  }
  // 取消链接：只移除链接本身，不删客户端文件
  if (path === "mods/unlink-local" && method === "POST") {
    const b = await bodyJson(req);
    const id = String(b.id || "");
    if (!validId(id)) return fail("非法模组 ID");
    const dst = join(modsStoreDir(), id);
    let wasLink = false;
    try { wasLink = lstatSync(dst).isSymbolicLink(); } catch {}
    if (!wasLink) return fail(`模组 ${id} 不是链接加载状态`);
    try { removePathOrLink(dst); } catch (e: any) { return fail("移除链接失败: " + (e?.message || e)); }
    refreshLinkManifest();
    clearModCaches();
    refreshModFileState(id);
    return ok(null, `已取消模组 ${id} 的链接（客户端文件未受影响）`);
  }
  if (path === "mods/import-local" && method === "POST") {
    const b = await bodyJson(req);
    const id = String(b.id || "");
    const src = String(b.path || "");
    if (!validId(id)) return fail("非法模组 ID");
    if (!src || src.includes("..") || !existsSync(src)) return fail("来源路径不存在");
    if (!existsSync(join(src, "modinfo.lua"))) return fail("来源目录缺少 modinfo.lua，不是有效的模组目录");
    const dst = join(modsStoreDir(), id);
    mkdirSync(modsStoreDir(), { recursive: true });
    removePathOrLink(dst);
    copyDirSync(src, dst);
    // 标明来源地址，方便程序调用和用户维护
    writeFileSync(join(dst, "SOURCE.txt"), `该模组从本地复用\r\n模组ID: ${id}\r\n来源: ${src}\r\n时间: ${new Date().toLocaleString("zh-CN")}\r\n`);
    if (modCache.items[id]) { modCache.items[id].downloadedAt = Date.now(); saveModCache(); }
    clearModCaches();
    refreshModFileState(id);
    return ok(null, `已复用本地模组 ${id} → ${dst}`);
  }
  if (path === "util/open-folder" && method === "POST") {
    if (!IS_WIN) return fail("该功能仅 Windows 版可用");
    const b = await bodyJson(req);
    const target = b.which === "saves" ? clusterRoot() : modsStoreDir();
    try { mkdirSync(target, { recursive: true }); } catch {}
    try { Bun.spawn(["explorer", target]); } catch {}
    return ok(null, "已打开文件夹: " + target);
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

  // ===== 服务器管理 =====
  if (path === "server/status" && method === "GET") {
    const shards = listShards();
    for (const s of shards) s.running = await shardRunning(s.name);
    const sysMem = getSystemMemory();
    const dstMem = getDstProcessMemory();
    const cpuPct = getCpuUsage();
    // 多开信息：其他存档运行状态、内存门禁（空余 ≥4G 才允许多开）、端口冲突清单
    const otherMap = groupOtherRunning(await runningDstAll());
    const otherRunning = [...otherMap.entries()].map(([cluster, shards]) => ({ cluster, shards }));
    const portConflicts = otherRunning.length ? findPortConflicts(otherMap) : [];
    return ok({
      shards, autorestart: panelConfig.autorestart, mode: panelConfig.mode, langCheck: panelConfig.langCheck,
      sys: { avail: sysMem.avail, total: sysMem.total, dstMem, cpu: cpuPct },
      currentRunning: shards.some((s) => s.running),
      otherRunning,
      canMultiOpen: sysMem.avail <= 0 || sysMem.avail >= MULTI_OPEN_MIN_MEM,
      multiOpenMinMem: MULTI_OPEN_MIN_MEM,
      portConflicts,
      isWin: IS_WIN,
    });
  }
  // ===== 端口设置（多开时每个存档端口必须唯一；支持查看 / 手动修改 / 一键自动分配） =====
  if (path === "server/ports" && method === "GET") {
    const shards = listShards();
    let running = false;
    for (const s of shards) if (await shardRunning(s.name)) { running = true; break; }
    const ci = parseIni(readText(join(clusterDir(), "cluster.ini")));
    const mpRaw = iniGet(ci, "SHARD", "master_port");
    const shardPorts = shards.map((s) => {
      const lines = parseIni(readText(join(clusterDir(), s.name, "server.ini")));
      const spRaw = iniGet(lines, "NETWORK", "server_port");
      const mspRaw = iniGet(lines, "STEAM", "master_server_port");
      const apRaw = iniGet(lines, "STEAM", "authentication_port");
      return {
        name: s.name, isMaster: s.isMaster,
        serverPort: Number(spRaw || (s.isMaster ? 11000 : 11001)), serverPortSet: spRaw !== null,
        masterServerPort: Number(mspRaw || (s.isMaster ? 27018 : 27019)), masterServerPortSet: mspRaw !== null,
        authPort: Number(apRaw || (s.isMaster ? 8768 : 8769)), authPortSet: apRaw !== null,
      };
    });
    // 其他存档已占用的端口（含 Klei 默认值；标注是否在运行——只有运行中的才算硬冲突）
    const runningSet = new Set((await runningDstAll()).map((r) => r.cluster));
    const others: { cluster: string; ports: number[]; running: boolean }[] = [];
    try {
      for (const c of readdirSync(clusterRoot())) {
        if (c === panelConfig.cluster) continue;
        try {
          if (!statSync(join(clusterRoot(), c)).isDirectory()) continue;
          const ps = [...new Set(clusterPorts(c).map((p) => p.port))];
          if (ps.length) others.push({ cluster: c, ports: ps, running: runningSet.has(c) });
        } catch {}
      }
    } catch {}
    return ok({ cluster: panelConfig.cluster, running, masterPort: Number(mpRaw || 10889), masterPortSet: mpRaw !== null, shards: shardPorts, others });
  }
  if ((path === "server/ports" || path === "server/ports/auto") && method === "POST") {
    // 端口只在进程启动时读取，运行中禁止修改
    for (const s of listShards()) if (await shardRunning(s.name)) return fail(`分片 ${s.name} 正在运行，请先关闭服务器再修改端口`);
    const cur = listShards();
    if (!cur.length) return fail("当前存档没有任何世界分片");
    interface PortEntry { label: string; port: number | null; explicit: boolean; }
    let masterPort: number | null = null;
    let masterExplicit = false;
    const shardCfg = new Map<string, { serverPort: number | null; masterServerPort: number | null; authPort: number | null; explicit: boolean }>();
    if (path === "server/ports/auto") {
      // 一键自动分配：从 Klei 默认端口起，跳过其他存档（含默认值）已占用的端口
      const used = new Set<number>();
      try {
        for (const c of readdirSync(clusterRoot())) {
          if (c === panelConfig.cluster) continue;
          try { if (statSync(join(clusterRoot(), c)).isDirectory()) for (const p of clusterPorts(c)) used.add(p.port); } catch {}
        }
      } catch {}
      const alloc = (start: number) => { let p = start; while (used.has(p) && p < 65535) p++; used.add(p); return p; };
      masterPort = alloc(10889); masterExplicit = true;
      for (const s of cur) shardCfg.set(s.name, { serverPort: alloc(s.isMaster ? 11000 : 11001), masterServerPort: alloc(s.isMaster ? 27018 : 27019), authPort: alloc(s.isMaster ? 8768 : 8769), explicit: true });
    } else {
      const b = await bodyJson(req);
      const num = (v: any): number | null => (v === undefined || v === null || v === "" ? null : Number(v));
      masterPort = num(b.masterPort); masterExplicit = masterPort !== null;
      for (const s of cur) {
        const inb = ((b.shards || {}) as any)[s.name] || {};
        const cfg = { serverPort: num(inb.serverPort), masterServerPort: num(inb.masterServerPort), authPort: num(inb.authPort), explicit: false };
        cfg.explicit = cfg.serverPort !== null || cfg.masterServerPort !== null || cfg.authPort !== null;
        shardCfg.set(s.name, cfg);
      }
    }
    // 组装有效值清单：显式提供的新值 > 磁盘现有配置 > Klei 默认值
    const ciCur = parseIni(readText(join(clusterDir(), "cluster.ini")));
    const mpCurRaw = iniGet(ciCur, "SHARD", "master_port");
    const entries: PortEntry[] = [{ label: "cluster.ini [SHARD] master_port", port: masterPort ?? Number(mpCurRaw || 10889), explicit: masterExplicit }];
    for (const [sn, cfg] of shardCfg) {
      const isM = !!cur.find((x) => x.name === sn)?.isMaster;
      const curLines = parseIni(readText(join(clusterDir(), sn, "server.ini")));
      const spCur = iniGet(curLines, "NETWORK", "server_port");
      const mspCur = iniGet(curLines, "STEAM", "master_server_port");
      const apCur = iniGet(curLines, "STEAM", "authentication_port");
      entries.push({ label: `${sn} [NETWORK] server_port`, port: cfg.serverPort ?? Number(spCur || (isM ? 11000 : 11001)), explicit: cfg.serverPort !== null });
      entries.push({ label: `${sn} [STEAM] master_server_port`, port: cfg.masterServerPort ?? Number(mspCur || (isM ? 27018 : 27019)), explicit: cfg.masterServerPort !== null });
      entries.push({ label: `${sn} [STEAM] authentication_port`, port: cfg.authPort ?? Number(apCur || (isM ? 8768 : 8769)), explicit: cfg.authPort !== null });
    }
    for (const e of entries) {
      if (!Number.isInteger(e.port) || (e.port as number) < 1024 || (e.port as number) > 65535) return fail(`端口无效：${e.label} = ${e.port}（要求 1024-65535 的整数）`);
    }
    // 存档内唯一性：两个都是隐式默认值的既有冲突不拦（未改动），其余必须唯一
    for (let i = 0; i < entries.length; i++) {
      for (let j2 = i + 1; j2 < entries.length; j2++) {
        if (entries[i].port !== entries[j2].port) continue;
        if (!entries[i].explicit && !entries[j2].explicit) continue;
        return fail(`端口 ${entries[i].port} 重复：${entries[i].label} 与 ${entries[j2].label} 相同，每个端口必须唯一（可用「自动分配空闲端口」一键解决）`);
      }
    }
    // 与其他存档端口相同不拦截，只黄色警告：同时启动才会冲突，用户可自行决定是否错开
    const runningSet2 = new Set((await runningDstAll()).map((r) => r.cluster));
    const warnings: string[] = [];
    try {
      for (const c of readdirSync(clusterRoot())) {
        if (c === panelConfig.cluster) continue;
        try {
          if (!statSync(join(clusterRoot(), c)).isDirectory()) continue;
          for (const p of clusterPorts(c)) {
            const hit = entries.find((e) => e.port === p.port);
            if (!hit) continue;
            if (!warnings.some((w) => w.includes(`「${c}」`)))
              warnings.push(runningSet2.has(c)
                ? `端口 ${p.port} 与正在运行的存档「${c}」相同（两个服务器不能同时启动，如需多开请先错开端口）`
                : `端口 ${p.port} 与存档「${c}」相同（对方未运行，同时启动前需错开）`);
          }
        } catch {}
      }
    } catch {}
    // 写入（只写显式提供的值，未提供的保持原配置/默认）
    if (masterExplicit && masterPort !== null) {
      const f = join(clusterDir(), "cluster.ini");
      writeFileSync(f, iniToText(iniSet(parseIni(readText(f)), "SHARD", "master_port", String(masterPort))));
    }
    for (const [sn, cfg] of shardCfg) {
      if (!cfg.explicit) continue;
      // 客户端世界可能没有 server.ini，先补全再写端口（保证 is_master 等关键配置齐全）
      ensureServerIni(sn);
      const f = join(clusterDir(), sn, "server.ini");
      let lines = parseIni(readText(f));
      if (cfg.serverPort !== null) lines = iniSet(lines, "NETWORK", "server_port", String(cfg.serverPort));
      if (cfg.masterServerPort !== null) lines = iniSet(lines, "STEAM", "master_server_port", String(cfg.masterServerPort));
      if (cfg.authPort !== null) lines = iniSet(lines, "STEAM", "authentication_port", String(cfg.authPort));
      writeFileSync(f, iniToText(lines));
    }
    clearShardListCache();
    const summary = entries.filter((e) => e.explicit).map((e) => `${e.port}`).join(" / ");
    return ok(null, (path === "server/ports/auto" ? "已自动分配空闲端口：" : "端口已保存：") + summary + "。启动/重启服务器后生效。"
      + (warnings.length ? " ⚠ " + warnings.join("；") : ""));
  }
  if (path === "server/start" && method === "POST") {
    const shards = listShards();
    if (!shards.length) return fail("当前存档没有任何世界分片");
    // 多开检测：已有其他存档的服务器在运行时，需要过内存门禁；端口冲突只警告不拦截
    const otherMap = groupOtherRunning(await runningDstAll());
    const startWarnings: string[] = [];
    if (otherMap.size) {
      const names = [...otherMap.keys()].map((n) => `「${n}」`).join("、");
      // 内存门禁：空余不足 4G 不准多开
      const sysMem = getSystemMemory();
      if (sysMem.avail > 0 && sysMem.avail < MULTI_OPEN_MIN_MEM) {
        return fail(`存档 ${names} 的服务器正在运行，当前空余内存仅 ${sysMem.avail}MB，不足 4G，不允许再开新服务器。请先在对应存档关闭服务器或释放内存后再试。`);
      }
      // 端口冲突只黄色警告：同时启动会抢端口导致后启动的分片绑定失败，由用户自行决定
      const conflicts = findPortConflicts(otherMap);
      if (conflicts.length) {
        const detail = conflicts.map((c) => `端口 ${c.port}（${c.key}）`).join("、");
        startWarnings.push(`⚠ 与运行中存档 ${names} 端口相同：${detail}。两个服务器同时运行会冲突，如需多开请在「端口设置」中错开端口`);
      }
    }
    // 资源检查
    const res = checkResources();
    if (!res.ok) return fail(res.msg, 200);
    const msgs: string[] = [];
    let hasFailure = false;
    for (const s of shards) {
      if (await shardRunning(s.name)) { msgs.push(`${s.name}: 已在运行`); continue; }
      const r = await startShard(s.name);
      const ok = r === "ok";
      if (!ok) hasFailure = true;
      msgs.push(`${s.name}: ${ok ? "已启动" : "启动失败 " + r}`);
    }
    let msg = msgs.join("；");
    if (hasFailure) {
      msg += "。💡 如果反复启动失败，很可能是内存不足。可尝试：1) 关闭其他服务释放内存 2) 减少启用的模组数量 3) 检查 dst.slice 内存限制";
    }
    if (startWarnings.length) msg += "。" + startWarnings.join("；");
    return ok(null, msg);
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
    ensureServerModSymlinks();
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
    // 结果缓存：键 = 存档 + 启用模组集合 + 模组缓存版本，切存档/启停模组/下载模组后自动失效
    const enabledIds: string[] = [];
    for (const shard of listShards()) {
      for (const [key, e] of readModOverrides(shard.name)) if (e.enabled) enabledIds.push(key.replace("workshop-", ""));
    }
    enabledIds.sort();
    const itemsCacheKey = panelConfig.cluster + "|" + enabledIds.join(",") + "|" + modCache.time;
    if (itemsApiCache.key === itemsCacheKey) return ok(itemsApiCache.data);
    const all: any[] = ITEMS.map((it) => ({ ...it }));
    const iconMap = itemIconAtlas();
    for (const it of all) {
      it.icon = iconMap.get(it.prefab) || "";
      it.cat = fixItemCategory(it.prefab, it.cat);
    }
    const seen = new Set(ITEMS.map((i) => i.prefab));
    for (const id of enabledIds) {
      for (const it of modItems(id)) {
        if (!seen.has(it.prefab)) {
          seen.add(it.prefab);
          // 模组物品：标记 modId，前端用 /mod-icon?id=<modId>&prefab=<prefab> 获取图标
          all.push({ ...it, icon: "", modId: id });
        }
      }
    }
    itemsApiCache = { key: itemsCacheKey, data: all };
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
    const players: { userid: string; name: string }[] = [];
    const seen = new Set<string>();
    for (const shard of shards) {
      if (!(await shardRunning(shard.name))) continue;
      const tail = await execAndCapture(shard.name, `for _,p in ipairs(AllPlayers) do print("DSTPANEL".."_".."PL:"..tostring(p.userid)..":"..tostring(p.name)) end`);
      for (const m of tail.matchAll(/DSTPANEL_PL:([^:\s]+):([^\n\r]+)/g)) {
        const uid = m[1].trim();
        if (!seen.has(uid)) { seen.add(uid); players.push({ userid: uid, name: m[2].trim() }); }
      }
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
              const m = /cycles"?\]?\s*=\s*(\d+)/.exec(metaText);
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
      for (const line of tailLines(f, 2000)) lines.push(`[${basename(dirname(f))}] ${line}`);
    }
    // server_log.txt 尚未生成（启动早期 / 令牌验证失败等）时，展示捕获的进程启动输出
    if (!lines.length && IS_WIN) {
      for (const [key, p] of winProcs) {
        const buf = (p as any)?.outBuf;
        if (buf?.length) {
          const shard = String(key).split("::")[1] || "?";
          for (const line of buf.slice(-500)) lines.push(`[${shard}] ${line}`);
        }
      }
    }
    return ok({ lines: lines.slice(-1000), count: lines.length });
  }

  // ===== 聊天记录 =====
  if (path === "chatlog" && method === "GET") {
    // 合并所有分片的聊天记录（Master + Caves/火山），按行排序返回
    const paths = chatLogPaths();
    if (!paths.length) return ok({ lines: [], msg: "暂无记录" });
    const allLines: string[] = [];
    for (const p of paths) {
      const shardName = basename(dirname2(p));
      for (const line of tailLines(p, 500)) {
        allLines.push(`[${shardName}] ${line}`);
      }
    }
    return ok({ lines: allLines.slice(-500), file: paths.map((p) => basename(p)).join(" + ") });
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


  // ===== Steam Community 代理（供内网/墙内面板中转搜索请求） =====
  if (path === "proxy/steam-workshop-browse" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return fail("缺少搜索关键词");
    try {
      const r = await fetch(`https://steamcommunity.com/workshop/browse/?appid=322330&searchtext=${encodeURIComponent(q)}&browsesort=textsearch&section=readytouseitems&l=schinese`, {
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36" },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) return fail(`Steam 请求失败 (${r.status})`, 502);
      return new Response(await r.text(), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" } });
    } catch (e: any) {
      return fail("代理请求失败: " + String(e?.message || e), 502);
    }
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
// 带版本注入的 HTML 服务：替换 __PANEL_VERSION__ 占位符（版本单一来源 PANEL_VERSION）
function serveHtml(name: string, noStore = false): Response {
  try {
    const html = readText(join(PUBLIC_DIR, name)).replace(/__PANEL_VERSION__/g, PANEL_VERSION);
    const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": noStore ? "no-store" : "no-cache" };
    return new Response(html, { status: 200, headers });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
function serveFile(path: string, req?: Request, opts?: { noNegotiate?: boolean }): Response {
  try {
    const ext = path.slice(path.lastIndexOf("."));
    const mime = MIME[ext] || "application/octet-stream";
    const headers: Record<string, string> = { "Content-Type": mime };
    // 图标/图片内容稳定，长缓存减少重复请求（模组图标与世界设置图标量大）
    if (/\.(png|jpg|jpeg|webp|gif|ico)$/.test(ext)) headers["Cache-Control"] = "public, max-age=604800, immutable";
    // html/js/css 不缓存：面板更新频繁，每次加载都向服务器校验，避免部署后用户看到旧页面
    else headers["Cache-Control"] = "no-cache";
    // Last-Modified 协商缓存：no-cache 下未修改的资源返回 304，不重复传输
    // noNegotiate：表示随登录态等条件变化的页面（/ 根路径），禁用 304 且 no-store，
    // 否则登录后浏览器拿 If-Modified-Since 命中 304，会继续展示缓存的登录页
    if (opts?.noNegotiate) headers["Cache-Control"] = "no-store";
    try {
      const mtime = statSync(path).mtime;
      headers["Last-Modified"] = mtime.toUTCString();
      const ims = req?.headers.get("if-modified-since");
      if (!opts?.noNegotiate && ims && new Date(ims).getTime() >= Math.floor(mtime.getTime() / 1000) * 1000) return new Response(null, { status: 304, headers });
    } catch {}
    // 文本类资源 gzip（app.js 体积大，压缩后传输约 1/4，加快已加载页面的二次打开速度）
    if (req && /\.(html|css|js|svg)$/.test(ext) && (req.headers.get("accept-encoding") || "").includes("gzip")) {
      const buf = readFileSync(path);
      if (buf.length > 1024) {
        headers["Content-Encoding"] = "gzip";
        headers["Vary"] = "Accept-Encoding";
        return new Response(gzipSync(buf), { headers });
      }
    }
    return new Response(Bun.file(path), { headers });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// 预热原版翻译（chinese_s.po 17.6MB 解析 + 中文语言包扫描），避免首次翻译查询卡顿
setTimeout(() => { try { chinesePo(); } catch {} try { chsNames(); } catch {} }, 1500);

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
    if (path === "/api/proxy/steam-workshop-browse") {
      try {
        return await api(req, url);
      } catch (e: any) {
        console.error(e);
        return fail("服务器内部错误: " + (e?.message || e), 500);
      }
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
      // 该 URL 按登录态返回不同页面（表示随 Cookie 变化）：禁用协商缓存，
      // 否则登录后 If-Modified-Since 命中 304，浏览器会继续展示缓存的登录页
      return serveHtml(checkAuth(req) ? "index.html" : "login.html", true);
    }
    // 物品图标补全：/wiki-icon?prefab=<prefab> → PNG
    // 针对既无物品栏图标也无小地图图标的实体（如阿比盖尔），按 MediaWiki 存储规则
    // （文件名首字母大写、空格转下划线，md5(文件名) 前1/前2位作目录）直接取社区图床；
    // 磁盘缓存 + 404 负缓存（24h）。注意：取图渠道不出现在任何日志里
    if (path === "/wiki-icon" && req.method === "GET") {
      const prefab = (url.searchParams.get("prefab") || "").trim();
      if (!/^[a-z0-9_]{2,64}$/.test(prefab)) return new Response("Bad request", { status: 400 });
      const pngHeaders = { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, immutable" };
      const diskDir = join(PUBLIC_DIR, "icons", "wiki");
      const diskFile = join(diskDir, prefab + ".png");
      if (existsSync(diskFile)) return new Response(Bun.file(diskFile), { status: 200, headers: pngHeaders });
      const negFile = diskFile + ".404";
      try { if (existsSync(negFile) && Date.now() - statSync(negFile).mtimeMs < 86400_000) return new Response("Not found", { status: 404 }); } catch {}
      const enName = prefabEnNames()[prefab];
      if (!enName) return new Response("Not found", { status: 404 });
      // 候选文件名：原始英文名 / 去撇号变体（MediaWiki 规则：空格→下划线）
      const cands = [...new Set([enName, enName.replace(/['’]/g, "")])].map((n) => n.replace(/\s+/g, "_") + ".png");
      // CDN 有人机校验：①无 UA 或版本号虚假（如不存在的 Chrome/150）会被 403；
      // ②Bun fetch 的 TLS 指纹与浏览器不同，机房 IP 下必被拦——必须借系统 curl 的
      // TLS 栈（Linux 与 Win10+ 均自带 curl.exe），UA 用真实存在过的浏览器版本
      const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
      try { mkdirSync(diskDir, { recursive: true }); } catch {}
      for (const fn of cands) {
        const tmp = join(diskDir, ".dl_" + prefab + "_" + Date.now() + ".tmp");
        try {
          const md5 = createHash("md5").update(fn).digest("hex");
          const cdn = `https://huiji-public.huijistatic.com/dontstarve/uploads/${md5[0]}/${md5.slice(0, 2)}/${encodeURIComponent(fn)}`;
          const p = Bun.spawn(["curl", "-sS", "-f", "-L", "--max-time", "8", "-A", UA, "-e", "https://dontstarve.huijiwiki.com/", "-o", tmp, cdn], { stdout: "ignore", stderr: "ignore" });
          await p.exited;
          if (p.exitCode !== 0 || !existsSync(tmp)) continue;
          const buf = Buffer.from(readFileSync(tmp));
          if (buf.length < 100 || buf[0] !== 0x89 || buf[1] !== 0x50) continue; // 非 PNG
          try { renameSync(tmp, diskFile); } catch { try { writeFileSync(diskFile, buf); } catch {} }
          return new Response(buf, { status: 200, headers: pngHeaders });
        } catch { continue; }
        finally { try { if (existsSync(tmp)) unlinkSync(tmp); } catch {} }
      }
      try { writeFileSync(negFile, ""); } catch {}
      return new Response("Not found", { status: 404 });
    }
    // 本地模组库图标：/local-icon?id=<modId> → PNG（直接解码客户端目录里的 modicon.tex，磁盘缓存）
    if (path === "/local-icon" && req.method === "GET") {
      const modId = url.searchParams.get("id") || "";
      if (!/^\d{4,15}$/.test(modId)) return new Response("Bad request", { status: 400 });
      const pngHeaders = { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" };
      const diskDir = join(PUBLIC_DIR, "modicons", modId);
      const diskFile = join(diskDir, "local.png");
      if (existsSync(diskFile)) return new Response(Bun.file(diskFile), { status: 200, headers: pngHeaders });
      const mPath = findLocalModPath(modId);
      const texPath = mPath ? join(mPath, "modicon.tex") : "";
      if (!mPath || !existsSync(texPath)) return new Response("Not found", { status: 404 });
      try {
        const result = decodeKTEX(readFileSync(texPath));
        if (!result) return new Response("Decode failed", { status: 500 });
        try { mkdirSync(diskDir, { recursive: true }); writeFileSync(diskFile, result.png); } catch {}
        return new Response(result.png, { status: 200, headers: pngHeaders });
      } catch {
        return new Response("Error", { status: 500 });
      }
    }
    // 动态模组物品图标：/mod-icon?id=<modId>&prefab=<prefab> → PNG（支持图集 UV 切片）
    if (path === "/mod-icon" && req.method === "GET") {
      const modId = url.searchParams.get("id") || "";
      const prefab = url.searchParams.get("prefab") || "";
      if (!/^\d{4,15}$/.test(modId) || !/^[a-z0-9_]+$/.test(prefab)) return new Response("Bad request", { status: 400 });
      const pngHeaders = { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800, immutable" };
      // 磁盘缓存：首次解码后写入 public/modicons/<modId>/，之后按静态文件直接返回（改变加载方式，秒开）
      const diskDir = join(PUBLIC_DIR, "modicons", modId);
      const diskFile = join(diskDir, prefab + ".png");
      if (existsSync(diskFile)) return new Response(Bun.file(diskFile), { status: 200, headers: pngHeaders });
      const icon = findModIcon(modId, prefab);
      if (!icon) return new Response("Not found", { status: 404 });
      // 内存缓存 key = modId:prefab，避免重复解码
      const cacheKey = `${modId}:${prefab}`;
      const cached = modIconPngCache.get(cacheKey);
      if (cached) return new Response(cached, { status: 200, headers: pngHeaders });
      try {
        const buf = readFileSync(icon.texPath);
        const result = decodeKTEX(buf);
        if (!result) return new Response("Decode failed", { status: 500 });
        let png = result.png;
        const isFullUV = icon.u1 === 0 && icon.u2 === 1 && icon.v1 === 0 && icon.v2 === 1;
        if (!isFullUV) png = cropPNG(result, icon.u1, icon.u2, icon.v1, icon.v2);
        // 内存缓存（限制总数 + 总量防止内存溢出，200 个约 2MB）
        if (modIconPngCache.size > 200) {
          const keys = [...modIconPngCache.keys()].slice(0, 50);
          for (const k of keys) modIconPngCache.delete(k);
        }
        if (png.length < 100_000) modIconPngCache.set(cacheKey, png);
        // 写磁盘缓存
        try { mkdirSync(diskDir, { recursive: true }); writeFileSync(diskFile, png); } catch {}
        return new Response(png, { status: 200, headers: pngHeaders });
      } catch {
        return new Response("Error", { status: 500 });
      }
    }
    // HTML 页面：注入面板版本号（登录页/主界面显示，版本单一来源 PANEL_VERSION）
    if (/^\/[\w.\-]+\.html$/.test(path) && !path.includes("..")) return serveHtml(path.slice(1));
    // 静态资源（相对路径引用，无敏感数据；允许 bg/ 等一层子目录，禁止 .. 穿越）
    if (/^\/[\w.\-/]+$/.test(path) && !path.includes("..")) {
      const fp = join(PUBLIC_DIR, path);
      try { if (existsSync(fp) && statSync(fp).isFile()) return serveFile(fp, req); } catch {}
    }
    // Steam CDN 图片代理（解决国内无法直连 steamusercontent.com 的问题）
    if (path === "/img-proxy" && req.method === "GET") {
      const target = url.searchParams.get("url") || "";
      if (!target.startsWith("https://images.steamusercontent.com/") && !target.startsWith("https://cdn.steamusercontent.com/")) {
        return new Response("Forbidden", { status: 403 });
      }
      try {
        const res = await steamFetch(target, { signal: AbortSignal.timeout(8000) });
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
console.log(`面板登录密码文件: ${join(PANEL_DIR, ".panel_password")}（忘记密码可查看此文件；在「基本设置」页面可修改）`);
writeModsDirReadme(); // Windows 版：模组存放目录写地址说明文件

// ---------- 定时任务 ----------
// 内存保护：每 10 秒检查（独立于自动重启，始终运行）
setInterval(async () => {
  try {
    // 内存保护：系统可用内存低于 512MB 时终止 DST
    const sysMem = getSystemMemory();
    if (sysMem.avail > 0 && sysMem.avail < 512) {
      console.log(`[内存保护] 系统可用内存仅 ${sysMem.avail}MB，正在终止 DST...`);
      for (const s of listShards()) await stopShard(s.name);
      try { Bun.spawnSync(["sh", "-c", "echo 1 > /proc/sys/vm/drop_caches 2>/dev/null || true"]); } catch {}
      console.log("[内存保护] DST 服务器已终止，可手动重新启动");
      return;
    }
    // 掉线自动拉起（仅在开启自动重启时）
    if (!panelConfig.autorestart) return;
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
