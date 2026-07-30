// 饥荒服务器管理面板 前端 SPA（纯 vanilla JS，全部相对路径）
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const content = $("#content");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), 3200);
}
async function api(path, opts = {}) {
  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  }
  const r = await fetch("api/" + path, opts);
  if (r.status === 401) { location.reload(); throw new Error("未登录"); }
  const j = await r.json();
  if (!j.ok) { toast(j.msg || "操作失败", true); const e = new Error(j.msg); e.handled = true; throw e; }
  return j;
}
async function apiQuiet(path, opts = {}) {
  try { return await api(path, opts); } catch (e) { return null; }
}
// 订阅数缩写：1.2M / 3.4W / 原始数
function fmtNum(n) {
  n = Number(n) || 0;
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e4).toFixed(1) + "W" : String(n);
}
// unix 秒 → YYYY-MM-DD
function fmtDay(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ============ 主题皮肤系统 ============
const THEMES = [
  ["amber", "暗夜琥珀", "linear-gradient(180deg,#232340 0%,#12121f 68%,#e8a33d 68%,#c77f1f 100%)"],
  ["paper", "白昼纸张", "linear-gradient(180deg,#ffffff 0%,#f4f1ea 68%,#d9a441 68%,#b97a17 100%)"],
  ["tech", "科技蓝", "linear-gradient(180deg,#122240 0%,#081020 68%,#6ff2ff 68%,#1fa8bf 100%)"],
];
const LOGIN_BGS = [["hero", "背景登录页1"], ["header", "背景登录页2"], ["capsule", "背景登录页3"], ["custom", "自定义"], ["none", "无图纯色"]];
// 全页面背景图（铺满整个面板背景，所有界面生效）
function applyPageBg() {
  const bg = localStorage.getItem("dstp_login_bg") || "hero";
  let el = document.getElementById("pageBg");
  if (bg === "none") { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "pageBg";
    document.body.prepend(el);
  }
  el.style.backgroundImage = `url("bg/${bg}.jpg")`;
}
applyPageBg();
function curTheme() { return document.body.dataset.theme || "amber"; }
function setTheme(t) {
  document.body.dataset.theme = t;
  localStorage.setItem("dstp_theme", t);
  window.refreshFxColors?.();
}
// 自定义颜色：主强调色 / 页面背景色（inline 变量覆盖主题，localStorage 持久化）
function applyCustomColors() {
  try {
    const c = JSON.parse(localStorage.getItem("dstp_colors") || "{}");
    const st = document.body.style;
    if (c.accent) {
      st.setProperty("--amber", c.accent);
      st.setProperty("--amber-d", c.accent);
      st.setProperty("--ember1", c.accent);
    }
    if (c.bg) st.setProperty("--bg", c.bg);
    window.refreshFxColors?.();
  } catch {}
}
applyCustomColors();
function setCustomColor(key, val) {
  const c = JSON.parse(localStorage.getItem("dstp_colors") || "{}");
  if (val) c[key] = val; else delete c[key];
  localStorage.setItem("dstp_colors", JSON.stringify(c));
  applyCustomColors();
}
function openSkinPanel() {
  const overlay = document.createElement("div");
  overlay.className = "skin-overlay";
  const curBg = localStorage.getItem("dstp_login_bg") || "hero";
  const colors = JSON.parse(localStorage.getItem("dstp_colors") || "{}");
  overlay.innerHTML = `
  <div class="skin-panel">
    <h3>🎨 皮肤设置</h3>
    <div class="skin-group">
      <div class="sg-title">主题皮肤（立即生效，刷新保持）</div>
      <div class="theme-swatches">
        ${THEMES.map(([k, name, bg]) => `<div class="swatch${k === curTheme() ? " sel" : ""}" data-theme="${k}"><div class="sw-preview" style="background:${bg}"></div>${name}</div>`).join("")}
      </div>
    </div>
    <div class="skin-group">
      <div class="sg-title">自定义颜色（覆盖主题色）</div>
      <div class="row"><label>主强调色</label><input type="color" id="ccAccent" value="${colors.accent || "#e8a33d"}"> <label>页面背景色</label><input type="color" id="ccBg" value="${colors.bg || "#12121f"}"> <button class="btn" id="ccReset">恢复默认</button></div>
    </div>
    <div class="skin-group">
      <div class="sg-title">登录页背景图（点击预览图选择）</div>
      <div class="bg-opts bg-thumbs">
        ${LOGIN_BGS.map(([k, name]) => k === "none"
          ? `<div class="bg-thumb none${k === curBg ? " sel" : ""}" data-bg="none"><div class="thumb-empty">纯色</div><span>${name}</span></div>`
          : `<div class="bg-thumb${k === curBg ? " sel" : ""}" data-bg="${k}"><img src="bg/${k}.jpg${k === "custom" ? "?v=" + Date.now() : ""}" onerror="this.parentNode.style.display='none'"><span>${name}</span></div>`).join("")}
      </div>
      <div class="row" style="margin-top:8px">
        <input type="file" id="bgUpload" accept="image/jpeg,image/png" style="display:none">
        <button class="btn" id="bgUploadBtn">上传自定义背景图</button>
        <span class="hint">JPG/PNG ≤ 8MB，上传后自动选中「自定义」</span>
      </div>
      <div class="hint">背景图在下次打开登录页时生效</div>
    </div>
    <div class="btn-row" style="margin-bottom:0"><button class="btn primary" id="skinClose">完成</button></div>
  </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.querySelector("#skinClose").onclick = () => overlay.remove();
  $$(".swatch", overlay).forEach((s) => (s.onclick = () => {
    setTheme(s.dataset.theme);
    $$(".swatch", overlay).forEach((x) => x.classList.toggle("sel", x === s));
  }));
  overlay.querySelector("#ccAccent").oninput = (e) => setCustomColor("accent", e.target.value);
  overlay.querySelector("#ccBg").oninput = (e) => setCustomColor("bg", e.target.value);
  overlay.querySelector("#ccReset").onclick = () => {
    localStorage.removeItem("dstp_colors");
    document.body.style.removeProperty("--amber");
    document.body.style.removeProperty("--amber-d");
    document.body.style.removeProperty("--ember1");
    document.body.style.removeProperty("--bg");
    window.refreshFxColors?.();
    overlay.remove();
    openSkinPanel();
  };
  $$(".bg-thumb[data-bg]", overlay).forEach((b) => (b.onclick = () => {
    localStorage.setItem("dstp_login_bg", b.dataset.bg);
    applyPageBg();
    $$(".bg-thumb", overlay).forEach((x) => x.classList.toggle("sel", x === b));
  }));
  overlay.querySelector("#bgUploadBtn").onclick = () => overlay.querySelector("#bgUpload").click();
  overlay.querySelector("#bgUpload").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) return toast("图片不能超过 8MB", true);
    const r = await fetch("api/skin/bg", { method: "POST", body: f, credentials: "same-origin" });
    const j = await r.json();
    if (!j.ok) return toast(j.msg || "上传失败", true);
    localStorage.setItem("dstp_login_bg", "custom");
    toast(j.msg || "已上传");
    overlay.remove();
    openSkinPanel();
  };
  document.body.appendChild(overlay);
}

// ============ 顶栏余烬粒子（纯 canvas，颜色跟随主题变量） ============
function startTopFx() {
  const cv = $("#topFx");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  let W = 0, H = 0, parts = [];
  const css = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
  window.refreshFxColors = () => {
    const c1 = css("--ember1") || "#f5c86e", c2 = css("--ember2") || "#e87f3d";
    parts.forEach((p, i) => (p.c = i % 2 ? c1 : c2));
  };
  function resize() {
    W = cv.width = cv.clientWidth || 1;
    H = cv.height = cv.clientHeight || 1;
  }
  function spawn() {
    parts = [];
    const n = Math.min(26, Math.max(10, Math.floor(W / 60)));
    for (let i = 0; i < n; i++) parts.push({
      x: Math.random() * W, y: Math.random() * H,
      r: .7 + Math.random() * 1.4,
      vy: -(.08 + Math.random() * .22), vx: (Math.random() - .5) * .12,
      ph: Math.random() * Math.PI * 2, sp: .01 + Math.random() * .025,
    });
    window.refreshFxColors();
  }
  resize(); spawn();
  addEventListener("resize", () => { resize(); spawn(); });
  (function tick() {
    if (!document.hidden && W > 1) {
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y += p.vy; p.x += p.vx + Math.sin(p.ph) * .08; p.ph += p.sp;
        if (p.y < -6) { p.y = H + 6; p.x = Math.random() * W; }
        if (p.x < -6) p.x = W + 6; else if (p.x > W + 6) p.x = -6;
        ctx.globalAlpha = .18 + .4 * (0.5 + 0.5 * Math.sin(p.ph * 2));
        ctx.fillStyle = p.c;
        ctx.shadowColor = p.c; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }
    requestAnimationFrame(tick);
  })();
}

// ============ 日志渲染（时间戳着色 + 新行流入动画） ============
function renderLogLines(el, text, animateNew = true) {
  const lines = String(text ?? "").split("\n");
  const prev = el._lastCount ?? -1;
  el._lastCount = lines.length;
  el.innerHTML = lines.map((l, i) => {
    const html = esc(l).replace(/(\[\d{2}:\d{2}:\d{2}\]:?)/g, '<span class="ts">$1</span>');
    const isNew = animateNew && prev >= 0 && lines.length > prev && i >= prev;
    return `<div class="logline${isNew ? " new" : ""}">${html || " "}</div>`;
  }).join("");
}
// 「刷新」扫光：给所在卡片加一次 shimmer 动画
function shimmerCard(card) {
  if (!card) return;
  card.classList.remove("shimmering");
  void card.offsetWidth;
  card.classList.add("shimmering");
  setTimeout(() => card.classList.remove("shimmering"), 900);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && /刷新|过滤/.test(b.textContent || "")) shimmerCard(b.closest(".card"));
});

// ============ 自绘确认模态框（替代原生 confirm，返回 Promise<boolean>） ============
function dlgConfirm(msg, { danger = false, okText = "确定", cancelText = "取消" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.innerHTML = `
      <div class="dlg-card">
        <div class="dlg-msg">${esc(msg).replace(/\n/g, "<br>")}</div>
        <div class="btn-row" style="justify-content:flex-end;margin-bottom:0">
          <button class="btn" data-x="0">${esc(cancelText)}</button>
          <button class="btn ${danger ? "danger" : "primary"}" data-x="1">${esc(okText)}</button>
        </div>
      </div>`;
    const onKey = (e) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter") done(true);
    };
    const done = (v) => { overlay.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
    $$("[data-x]", overlay).forEach((b) => (b.onclick = () => done(b.dataset.x === "1")));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  });
}

// ============ 标签导航 ============
const TABS = [
  ["basic", "基本设置"],
  ["world", "编辑世界"],
  ["mods", "mod设置"],
  ["server", "服务器管理"],
  ["console", "控制台"],
  ["chat", "聊天记录"],
  ["help", "一脸懵逼"],
];
let currentTab = "basic";
function renderTabs() {
  $("#tabs").innerHTML = TABS.map(([k, label]) =>
    `<button data-tab="${k}" class="${k === currentTab ? "active" : ""}">${label}</button>`).join("");
  $$("#tabs button").forEach((b) => (b.onclick = () => {
    currentTab = b.dataset.tab;
    renderTabs();
    $("#tabsMore").classList.remove("open");
    route();
  }));
  layoutTabs();
}
// 溢出收纳：放得下的标签原样显示，放不下的进 ☰ 下拉
function layoutTabs() {
  const tabs = $("#tabs"), btn = $("#menuBtn");
  let more = $("#tabsMore");
  if (!more) {
    more = document.createElement("div");
    more.id = "tabsMore";
    $("#topbar").appendChild(more);
    document.addEventListener("click", (e) => {
      if (more.classList.contains("open") && !more.contains(e.target) && e.target.id !== "menuBtn") more.classList.remove("open");
    });
  }
  // 先全部放回主栏测量
  $$("button", more).forEach((b) => tabs.appendChild(b));
  const all = $$("button", tabs);
  if (!all.length) return;
  btn.style.display = "none";
  const bar = $("#topbar");
  const reserved = bar.querySelector(".title").offsetWidth + $("#skinBtn").offsetWidth + $("#logout").offsetWidth + btn.offsetWidth + 50;
  const avail = bar.clientWidth - reserved;
  let used = 0, fit = all.length;
  for (let i = 0; i < all.length; i++) {
    used += all[i].offsetWidth;
    if (used > avail) { fit = i; break; }
  }
  if (fit >= all.length) { more.classList.remove("open"); return; }
  // 放不下的移入 ☰ 下拉
  for (let i = fit; i < all.length; i++) more.appendChild(all[i]);
  btn.style.display = "block";
}
window.addEventListener("resize", layoutTabs);
// ☰ 展开/收起
$("#menuBtn").onclick = (e) => {
  e.stopPropagation();
  $("#tabsMore").classList.toggle("open");
};
$("#logout").onclick = async () => { await fetch("api/logout", { method: "POST" }); location.reload(); };
$("#skinBtn").onclick = openSkinPanel;

function renderCrumbs() {
  const cur = TABS.find(([k]) => k === currentTab);
  const el = $("#crumbs");
  if (el) el.innerHTML = `<span>🏠 首页</span><span class="crumb-sep">/</span><span class="cur">${esc(cur ? cur[1] : "")}</span>`;
}
function route() {
  if (window._serverLogTimer) { clearInterval(window._serverLogTimer); window._serverLogTimer = null; }
  const fn = {
    basic: pageBasic, world: pageWorld, mods: pageMods, server: pageServer,
    console: pageConsole, chat: pageChat, help: pageHelp,
  }[currentTab];
  renderCrumbs();
  content.innerHTML = '<div class="skeleton sk-lg"></div><div class="skeleton sk-sm"></div><div class="skeleton sk-sm"></div>';
  fn().catch((e) => { if (!e.handled) content.innerHTML = `<div class="card">加载失败: ${esc(e.message)}</div>`; });
}

// ============ 1. 基本设置 ============
async function pageBasic() {
  const j = await api("basic");
  const d = j.data;
  const ini = d.ini;
  const sel = (id, opts, cur) =>
    `<select id="${id}">` + opts.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("") + "</select>";
  const fmtTime = (t) => (t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "-");
  content.innerHTML = `
  <div class="card">
    <h3>路径</h3>
    <div class="row"><label>存档根目录</label><input type="text" id="clusterRootInput" value="${esc(d.clusterRoot)}" size="46"> <span class="hint">绝对路径，请不要包含中文；改动后新存档将建到新目录</span></div>
    <div class="row"><label>模组存放目录</label><input type="text" id="modsDirInput" value="${esc(d.modsDir || "")}" size="46"> <span class="hint">模组统一存放目录（绝对路径），改动后需迁移或重新下载模组</span></div>
    <div class="row"><label>服务器目录</label><input type="text" id="serverDir" value="${esc(d.serverDir)}" size="46"> <span class="hint">修改后保存并重启面板生效</span></div>
  </div>
  <div class="card">
    <h3>存档列表 <span class="hint">点击「选择」切换到对应存档进行控制，所有操作在当前界面完成</span></h3>
    <div class="row"><label>新建存档</label><input type="text" id="newClusterName" size="24" maxlength="64" placeholder="英文/数字/下划线，最长64字符"> <button class="btn primary" id="createCluster">新建存档</button></div>
    <div class="cluster-table"><table class="grid" id="clusterTable">
      <thead><tr><th>存档名</th><th>修改时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
      ${(d.clusterList || d.clusters.map((c) => ({ name: c, mtime: 0 }))).map((c) => `<tr class="${c.name === d.cluster ? "sel" : ""}">
        <td>${esc(c.name)}</td>
        <td>${fmtTime(c.mtime)}</td>
        <td>${c.name === d.cluster ? '<span class="tag on">当前</span>' : ""}</td>
        <td>
          <button class="btn" data-sel="${esc(c.name)}" ${c.name === d.cluster ? "disabled" : ""}>选择</button>
          <button class="btn" data-ren="${esc(c.name)}">重命名</button>
          <button class="btn danger" data-del="${esc(c.name)}">删除</button>
        </td>
      </tr>`).join("")}
      </tbody>
    </table></div>
  </div>
  <div class="card">
    <h3>当前存档设置：${esc(d.cluster)}</h3>
    <div class="row"><label>游戏风格</label>${sel("intention", [["cooperative","合作模式"],["social","社交"],["competitive","竞争"],["madness","疯狂"]], ini.intention)}</div>
    <div class="row"><label>游戏模式</label>${sel("game_mode", [["survival","生存模式"],["relaxed","轻松"],["endless","无尽"],["wilderness","荒野"],["lightsout","暗无天日"]], ini.game_mode)}</div>
    <div class="row"><label>房间名</label><input type="text" id="cluster_name" value="${esc(ini.cluster_name)}" size="40"></div>
    <div class="row"><label>房间描述</label><input type="text" id="cluster_description" value="${esc(ini.cluster_description)}" size="60"></div>
    <div class="row"><label>房间密码</label><input type="text" id="cluster_password" size="30" placeholder="${d.has_cluster_password ? "已设置（不修改请留空）" : "未设置"}" autocomplete="off"> <span class="hint">留空保持不变</span><button class="btn" id="clearRoomPwd" ${d.has_cluster_password ? "" : "disabled"}>清除</button></div>
    <div class="row"><label>服务器令牌(SK)</label><input type="password" id="cluster_token" size="60" style="font-family:monospace" placeholder="${d.has_token ? "已设置（不修改请留空）" : "未设置（在线模式必须）"}" autocomplete="off"> <button class="btn" id="toggleToken" type="button">显示</button> <button class="btn" id="clearToken" ${d.has_token ? "" : "disabled"}>清除</button></div>
    <div class="row"><label>PVP</label>${sel("pvp", [["false","否"],["true","是"]], ini.pvp)}</div>
    <div class="row"><label>玩家人数</label><input type="number" id="max_players" min="1" max="64" value="${esc(ini.max_players)}"></div>
    <div class="row"><label>开启投票</label><input type="checkbox" id="vote_kick_enabled" ${ini.vote_kick_enabled === "true" ? "checked" : ""}></div>
    <div class="row"><label>无人自动暂停</label><input type="checkbox" id="pause_when_empty" ${ini.pause_when_empty === "true" ? "checked" : ""}> <span class="hint">没有玩家在线时暂停世界时间流逝（省资源，但作物/生物也停止）</span></div>
    <div class="row"><label>是否为内测</label><input type="checkbox" id="beta" ${d.beta ? "checked" : ""}> <label>内测分支</label><input type="text" id="betaBranch" value="${esc(d.betaBranch || "")}" size="16" maxlength="64" placeholder="留空=默认分支"> <span class="hint">开启后 update_dst.sh 将用 -beta 分支更新服务端</span></div>
    <div class="row"><label>身份看门狗</label><span id="guardStatus" class="hint">查询中…</span> <button class="btn" id="guardToggle">…</button> <span class="hint">每分钟清理非 steam 身份的面板/服务端进程并修复文件属主</span></div>
    <div class="btn-row"><button class="btn primary" id="save">保存</button></div>
  </div>`;
  $$("#clusterTable [data-sel]").forEach((b) => (b.onclick = async () => {
    const r = await api("cluster", { method: "POST", body: { cluster: b.dataset.sel } });
    toast(r.msg); route();
  }));
  $$("#clusterTable [data-ren]").forEach((b) => (b.onclick = async () => {
    const from = b.dataset.ren;
    const name = prompt(`把存档「${from}」重命名为（英文/数字/下划线，最长64字符）：`, from);
    if (!name || name.trim() === "" || name.trim() === from) return;
    const r = await api("cluster/rename", { method: "POST", body: { from, name: name.trim() } });
    toast(r.msg); route();
  }));
  $$("#clusterTable [data-del]").forEach((b) => (b.onclick = async () => {
    const name = b.dataset.del;
    if (!(await dlgConfirm(`确定删除存档「${name}」？该存档的全部世界与进度将被永久删除，不可恢复！`, { danger: true }))) return;
    const r = await api("cluster/delete", { method: "POST", body: { name } });
    toast(r.msg); route();
  }));
  $("#createCluster").onclick = async () => {
    const name = $("#newClusterName").value.trim();
    if (!name) return toast("请输入新存档名", true);
    const r = await api("cluster/create", { method: "POST", body: { name } });
    toast(r.msg); route();
  };
  $("#save").onclick = async () => {
    const body = {
      intention: $("#intention").value,
      game_mode: $("#game_mode").value,
      cluster_name: $("#cluster_name").value,
      cluster_description: $("#cluster_description").value,
      pvp: $("#pvp").value === "true",
      max_players: $("#max_players").value,
      vote_kick_enabled: $("#vote_kick_enabled").checked,
      pause_when_empty: $("#pause_when_empty").checked,
      beta: $("#beta").checked,
      serverDir: $("#serverDir").value,
      clusterRoot: $("#clusterRootInput").value,
      modsDir: $("#modsDirInput").value,
      betaBranch: $("#betaBranch").value.trim(),
    };
    // 凭证留空=保持不变，填了=覆盖
    const pwd = $("#cluster_password").value;
    if (pwd) body.cluster_password = pwd;
    const tk = $("#cluster_token").value.trim();
    if (tk) body.cluster_token = tk;
    const r = await api("basic", { method: "POST", body });
    toast(r.msg);
  };
  // 清除房间密码 / 令牌
  $("#clearRoomPwd").onclick = async () => {
    if (!confirm("确定清除房间密码？清除后玩家进服不再需要密码。")) return;
    const r = await api("basic", { method: "POST", body: { clear_cluster_password: true } });
    toast(r.msg); route();
  };
  $("#clearToken").onclick = async () => {
    if (!confirm("确定清除服务器令牌？清除后服务器将无法注册上线。")) return;
    const r = await api("basic", { method: "POST", body: { clear_token: true } });
    toast(r.msg); route();
  };
  // 令牌显示/隐藏
  $("#toggleToken").onclick = () => {
    const inp = $("#cluster_token");
    if (inp.type === "password") { inp.type = "text"; $("#toggleToken").textContent = "隐藏"; }
    else { inp.type = "password"; $("#toggleToken").textContent = "显示"; }
  };
  // 看门狗开关
  const loadGuard = async () => {
    const g = await apiQuiet("guard");
    if (!g) { $("#guardStatus").textContent = "状态未知"; return; }
    $("#guardStatus").innerHTML = g.data.running ? '<span class="tag on">运行中</span>' : '<span class="tag">已关闭</span>';
    $("#guardToggle").textContent = g.data.running ? "关闭看门狗" : "开启看门狗";
    $("#guardToggle").onclick = async () => {
      if (g.data.running && !(await dlgConfirm("确定关闭看门狗？关闭后非 steam 身份的面板/服务端进程不再被自动清理。"))) return;
      const r = await api("guard", { method: "POST", body: { on: !g.data.running } });
      toast(r.msg);
      loadGuard();
    };
  };
  loadGuard();
}

// ============ 2. 编辑世界 ============
const worldState = { shard: null, overrides: {}, options: [], selKey: null, filterText: "", filterGroup: "" };
async function pageWorld() {
  const j = await api("worlds");
  const shards = j.data;
  content.innerHTML = `
  <div class="cols">
    <div class="left">
      <div class="card">
        <h3>世界列表</h3>
        <div class="listbox" id="wlist"></div>
        <div class="btn-row">
          <button class="btn" id="addForest">添加地上世界</button>
          <button class="btn" id="addCave">添加地下世界</button>
          <button class="btn danger" id="delWorld">删除所选世界</button>
        </div>
      </div>
      <div class="card">
        <h3>存档管理 <span class="hint">（需服务器运行中）</span></h3>
        <div class="btn-row">
          <button class="btn" id="wSave">保存进度</button>
          <button class="btn danger" id="wRollback">回档一天</button>
          <button class="btn" id="wRefreshSaves">刷新存档列表</button>
        </div>
        <div id="wSaveList"></div>
      </div>
    </div>
    <div class="right">
      <div class="card">
        <h3>设置项 <span class="hint" id="curShard"></span></h3>
        <div class="row" style="margin-bottom:8px">
          <input type="text" id="optFilter" placeholder="按设置项名称 / key 过滤" value="${esc(worldState.filterText)}">
          <select id="optGroup"><option value="">全部分组</option></select>
        </div>
        <div style="max-height:420px;overflow-y:auto"><table class="grid" id="optTable">
          <thead><tr><th>设置项</th><th>设定值</th><th>分组</th></tr></thead><tbody></tbody>
        </table></div>
        <div class="row" style="margin-top:12px"><label>设置项</label><select id="newVal"></select>
        <button class="btn primary" id="saveOv">保存</button></div>
        <div class="hint">每设置完一个世界之后，都需要点击保存。点击表格行选中设置项，再在下方选择新值。</div>
      </div>
      <div id="modWorldBox"></div>
    </div>
  </div>`;
  const wlist = $("#wlist");
  if (!shards.length) wlist.innerHTML = '<div class="item">（当前存档还没有世界）</div>';
  shards.forEach((s, i) => {
    const div = document.createElement("div");
    div.className = "item" + (worldState.shard === s.name ? " sel" : "");
    div.innerHTML = `<span class="status-dot ${s.running ? "on" : "off"}"></span>#${i + 1} ${esc(s.name)}（${s.isMaster ? "地上" : "地下"}，端口 ${esc(s.port)}）`;
    div.onclick = () => { worldState.shard = s.name; worldState.selKey = null; loadWorldOverrides(); pageWorldHighlight(); };
    wlist.appendChild(div);
  });
  function pageWorldHighlight() {
    $$(".item", wlist).forEach((el, i) => el.classList.toggle("sel", shards[i] && shards[i].name === worldState.shard));
  }
  if (!worldState.shard && shards.length) worldState.shard = shards[0].name;
  if (worldState.shard) { pageWorldHighlight(); loadWorldOverrides(); }

  $("#optFilter").oninput = (e) => { worldState.filterText = e.target.value; loadWorldOverrides(); };
  $("#optGroup").onchange = (e) => { worldState.filterGroup = e.target.value; loadWorldOverrides(); };

  $("#addForest").onclick = async () => { const r = await api("worlds/add", { method: "POST", body: { type: "forest" } }); toast(r.msg); pageWorld(); };
  $("#addCave").onclick = async () => { const r = await api("worlds/add", { method: "POST", body: { type: "cave" } }); toast(r.msg); pageWorld(); };
  $("#delWorld").onclick = async () => {
    if (!worldState.shard) return toast("请先选择世界", true);
    if (!(await dlgConfirm(`确定删除世界 ${worldState.shard}？该操作会删除整个分片目录（含存档），不可恢复！`, { danger: true }))) return;
    const r = await api("worlds/delete", { method: "POST", body: { shard: worldState.shard } });
    toast(r.msg); worldState.shard = null; pageWorld();
  };
  $("#saveOv").onclick = async () => {
    if (!worldState.shard) return toast("请先选择世界", true);
    const r = await api("world/overrides", { method: "POST", body: { shard: worldState.shard, overrides: worldState.overrides } });
    toast(r.msg);
  };

  // 存档管理
  const wExec = async (lua) => { const r = await api("console/exec", { method: "POST", body: { lua } }); toast(r.msg); };
  $("#wSave").onclick = () => wExec("c_save()");
  $("#wRollback").onclick = async () => { if (await dlgConfirm("确定回档一天？")) wExec("c_rollback(1)"); };
  const renderWSaves = async () => {
    const box = $("#wSaveList");
    box.innerHTML = '<div class="hint">加载中…</div>';
    const j = await apiQuiet("saves/list");
    if (!j) return;
    const saves = j.data.saves || [];
    if (!saves.length) { box.innerHTML = '<div class="hint">暂无存档数据</div>'; return; }
    const latestDay = j.data.latestDay;
    box.innerHTML = `<div class="hint" style="margin-bottom:6px">当前最新存档：第 ${latestDay} 天</div>` +
      saves.map((s) => {
        const isLatest = s.snap === (j.data.latestSnap || 0);
        return `<button class="btn${isLatest ? "" : " danger"}" data-snap="${s.snap}" style="margin:2px;font-size:13px">${isLatest ? `第${s.day}天（当前）` : `回档到第${s.day}天`}${s.date ? `<span class="save-date">${esc(s.date)}</span>` : ""}</button>`;
      }).join("");
    $$("#wSaveList [data-snap]").forEach((b) => b.onclick = async () => {
      const snap = parseInt(b.dataset.snap);
      if (snap === (j.data.latestSnap || 0)) return toast("已在当前天数");
      const sv = saves.find((x) => x.snap === snap);
      if (!(await dlgConfirm(`确定回档到第${sv ? sv.day : "?"}天？`))) return;
      const r = await api("saves/rollback", { method: "POST", body: { snap } });
      toast(r.msg); renderWSaves();
    });
  };
  $("#wRefreshSaves").onclick = renderWSaves;
  renderWSaves(); // 进入编辑世界页自动刷新存档列表
}
async function loadWorldOverrides() {
  const j = await api("world/overrides?shard=" + encodeURIComponent(worldState.shard));
  worldState.overrides = j.data.overrides;
  worldState.options = j.data.options;
  worldState.isMaster = j.data.isMaster;
  worldState.presets = j.data.presets || { worldgen: "", settings: "" };
  const preset = j.data.presets?.worldgen || "";
  $("#curShard").textContent = `— ${j.data.shard}（${j.data.isMaster ? "地上" : "地下"}）${preset ? `｜预设: ${preset}` : ""}`;
  // 启用模组世界（海难/哈姆雷特/火山等）时，原版设置项不适用，直接隐藏（含设置项选择与保存按钮）
  const isModWorld = !!preset && preset !== "SURVIVAL_TOGETHER" && preset !== "DST_CAVE";
  const filterRow = $("#optFilter")?.closest(".row");
  const tableWrap = $("#optTable")?.parentElement;
  const newValRow = $("#newVal")?.closest(".row");
  if (filterRow) filterRow.style.display = isModWorld ? "none" : "";
  if (tableWrap) tableWrap.style.display = isModWorld ? "none" : "";
  if (newValRow) newValRow.style.display = isModWorld ? "none" : "";
  let hint = $("#vanillaHiddenHint");
  if (!hint && tableWrap) {
    hint = document.createElement("div");
    hint.id = "vanillaHiddenHint";
    hint.className = "err-text";
    tableWrap.after(hint);
  }
  if (hint) {
    hint.style.display = isModWorld ? "" : "none";
    hint.textContent = "⚠ 当前为模组世界，原版设置项不适用已隐藏，请使用下方「模组世界设置」。";
  }
  if (isModWorld) { loadModWorldgen(); return; }
  // 分组下拉（保留当前选择）
  const groups = [...new Set(worldState.options.map((o) => o.group))];
  const gs = $("#optGroup");
  if (gs) {
    const cur = worldState.filterGroup || "";
    if (cur && !groups.includes(cur)) worldState.filterGroup = "";
    gs.innerHTML = '<option value="">全部分组</option>' + groups.map((g) => `<option value="${esc(g)}" ${g === worldState.filterGroup ? "selected" : ""}>${esc(g)}</option>`).join("");
  }
  const ft = (worldState.filterText || "").trim().toLowerCase();
  const fg = worldState.filterGroup || "";
  const tbody = $("#optTable tbody");
  tbody.innerHTML = "";
  worldState.options.forEach((o) => {
    if (fg && o.group !== fg) return;
    if (ft && !o.label.toLowerCase().includes(ft) && !o.key.toLowerCase().includes(ft)) return;
    const cur = worldState.overrides[o.key] || "default";
    const tr = document.createElement("tr");
    tr.dataset.key = o.key;
    const labelOf = (v) => (o.values.find((x) => x.v === v) || {}).label || v;
    tr.innerHTML = `<td>${esc(o.label)}</td><td>${esc(labelOf(cur))} <span class="hint">(${esc(cur)})</span></td><td>${esc(o.group)}</td>`;
    if (worldState.selKey === o.key) tr.className = "sel";
    tr.onclick = () => {
      worldState.selKey = o.key;
      $$("tr", tbody).forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      const selEl = $("#newVal");
      selEl.innerHTML = o.values.map((v) => `<option value="${v.v}">${esc(v.label)} (${v.v})</option>`).join("");
      selEl.value = worldState.overrides[o.key] || "default";
    };
    tbody.appendChild(tr);
  });
  if (!tbody.children.length) tbody.innerHTML = '<tr class="disabled"><td colspan="3">（无匹配的设置项）</td></tr>';
  $("#newVal").innerHTML = '<option value="">（先在表格中选择一行）</option>';
  $("#newVal").onchange = (e) => {
    if (!worldState.selKey || !e.target.value) return;
    worldState.overrides[worldState.selKey] = e.target.value;
    loadWorldOverridesKeepSel();
  };
  loadModWorldgen();
}
// 大型地图模组（海难/哈姆雷特等）的世界设置与关卡预设
async function loadModWorldgen() {
  const box = $("#modWorldBox");
  if (!box) return;
  const j = await apiQuiet("world/modworldgen?shard=" + encodeURIComponent(worldState.shard));
  const mods = j?.data?.mods || [];
  worldState.mwMods = mods;
  if (!mods.length) { box.innerHTML = ""; return; }
  box.innerHTML = mods.map((m, mi) => {
    // 世界类型：模组提供的预设（海难/火山/哈姆雷特等）；模式难度：生存/轻松/无尽等
    const isCaveLoc = (l) => /volcano|cave|under/i.test(l || "");
    const isModeId = (id) => /(RELAXED|ENDLESS|WILDERNESS|LIGHTS_?OUT|DEFAULT)$/.test(id);
    const locCn = (l) => ({ shipwrecked: "海难", volcanolevel: "火山", hamlet: "哈姆雷特", porkland: "哈姆雷特", forest: "森林", caves: "洞穴", cave: "洞穴" }[l] || l);
    const locReps = new Map();
    for (const p of m.presets) {
      if (!p.location) continue;
      if (worldState.isMaster === isCaveLoc(p.location)) continue;
      const has = locReps.get(p.location);
      if (!has || /SURVIVAL_TOGETHER$/.test(p.id)) locReps.set(p.location, p);
    }
    const curWg = worldState.presets?.worldgen || "";
    const curSt = worldState.presets?.settings || "";
    const wgOpts = [...locReps.values()].map((p) => `<option value="${p.id}" ${curWg === p.id || (!curWg && [...locReps.values()][0]?.id === p.id) ? "selected" : ""}>${locCn(p.location)}（${p.id}）</option>`);
    const modePresets = m.presets.filter((p) => isModeId(p.id) && p.id !== curWg);
    return `
  <div class="card">
    <h3>模组世界设置：${esc(m.name)} <span class="hint">${esc(m.id)}</span></h3>
    ${m.presets.length ? `
    <div class="row"><label>世界类型</label><select id="mwWg_${mi}">${wgOpts.join("")}</select>
    <button class="btn primary" data-wg="${mi}">应用世界类型</button> <span class="hint">切换世界类型需重新生成世界生效</span></div>
    ${modePresets.length ? `<div class="row"><label>模式难度</label><select id="mwMode_${mi}">${modePresets.map((p) => `<option value="${p.id}" ${curSt === p.id ? "selected" : ""}>${esc(p.name)}（${p.id}）</option>`).join("")}</select>
    <button class="btn" data-mode="${mi}">应用模式</button> <span class="hint">游戏模式/难度（生存、轻松、无尽等）</span></div>` : ""}` : ""}
    ${m.worldgenFiles?.length ? `<div class="hint" style="margin:4px 0 8px">该模组修改的世界生成文件：${m.worldgenFiles.map((f) => esc(f)).join("、")}</div>` : ""}
    ${m.options.length ? `
    <div class="row" style="margin-bottom:6px">
      <input type="text" class="mwFilter" data-mi="${mi}" placeholder="搜索设置项（中文/key）" value="${esc(worldState.mwFilter || "")}" style="width:220px">
      <select class="mwGroup" data-mi="${mi}"><option value="">全部分组</option>${[...new Set(m.options.map((o) => o.group))].map((g) => `<option value="${g}" ${g === worldState.mwGroup ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
    </div>
    <div style="max-height:280px;overflow-y:auto"><table class="grid"><thead><tr><th>设置项</th><th>设定值</th><th>分组</th></tr></thead><tbody id="mwTbody_${mi}"></tbody></table></div>
    <div class="row" style="margin-top:8px"><label>设置项</label><select id="mwNewVal_${mi}"><option value="">（先在表格中选择一行）</option></select>
    <span class="hint">修改后点上方「保存」统一写入</span></div>` : ""}
  </div>`;
  }).join("");
  // 模组设置项行渲染（支持搜索/分组过滤）
  const renderMwRows = (mi) => {
    const m = worldState.mwMods[mi];
    const tbody = $(`#mwTbody_${mi}`);
    if (!tbody || !m) return;
    const ft = (worldState.mwFilter || "").trim().toLowerCase();
    const fg = worldState.mwGroup || "";
    tbody.innerHTML = "";
    m.options.forEach((o) => {
      if (fg && o.group !== fg) return;
      if (ft && !o.label.toLowerCase().includes(ft) && !o.key.toLowerCase().includes(ft)) return;
      const cur = worldState.overrides[o.key] || o.default || "default";
      const labelOf = (v) => (o.values.find((x) => x.v === v) || {}).label || v;
      const tr = document.createElement("tr");
      tr.dataset.key = o.key;
      tr.dataset.mi = mi;
      tr.innerHTML = `<td>${esc(o.label)}</td><td>${esc(labelOf(cur))} <span class="hint">(${esc(cur)})</span></td><td>${esc(o.group)}${o.world ? ` <span class="hint">${esc(o.world)}</span>` : ""}</td>`;
      tbody.appendChild(tr);
    });
    if (!tbody.children.length) tbody.innerHTML = '<tr class="disabled"><td colspan="3">（无匹配的设置项）</td></tr>';
  };
  mods.forEach((m, mi) => {
    renderMwRows(mi);
    const fi = box.querySelector(`.mwFilter[data-mi="${mi}"]`);
    if (fi) fi.oninput = () => { worldState.mwFilter = fi.value; renderMwRows(mi); };
    const fgs = box.querySelector(`.mwGroup[data-mi="${mi}"]`);
    if (fgs) fgs.onchange = () => { worldState.mwGroup = fgs.value; renderMwRows(mi); }
    // 行选择（事件委托，兼容过滤重渲染）
    const tbody = $(`#mwTbody_${mi}`);
    if (tbody) tbody.onclick = (e) => {
      const tr = e.target.closest("tr[data-key]");
      if (!tr) return;
      $$("tr", tbody).forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      const o = worldState.mwMods[mi].options.find((x) => x.key === tr.dataset.key);
      const sel = $(`#mwNewVal_${mi}`);
      sel.innerHTML = o.values.map((v) => `<option value="${v.v}">${esc(v.label)} (${v.v})</option>`).join("");
      sel.value = worldState.overrides[o.key] || o.default || "default";
      sel.onchange = () => {
        worldState.overrides[o.key] = sel.value;
        loadWorldOverrides();
      };
    };
  });
  mods.forEach((m, mi) => {
    const wgb = box.querySelector(`[data-wg="${mi}"]`);
    if (wgb) wgb.onclick = async () => {
      const v = $(`#mwWg_${mi}`).value;
      if (!(await dlgConfirm(`确定把 ${worldState.shard} 的世界类型设为「${v}」？需重新生成世界后生效。`))) return;
      const r = await api("world/overrides", { method: "POST", body: { shard: worldState.shard, worldgen_preset: v, overrides: {} } });
      toast(r.msg);
      loadWorldOverrides();
    };
    const mb = box.querySelector(`[data-mode="${mi}"]`);
    if (mb) mb.onclick = async () => {
      const v = $(`#mwMode_${mi}`).value;
      const r = await api("world/overrides", { method: "POST", body: { shard: worldState.shard, settings_preset: v, overrides: {} } });
      toast(r.msg);
      loadWorldOverrides();
    };
  });
}
function loadWorldOverridesKeepSel() {
  const sel = worldState.selKey;
  loadWorldOverrides().then(() => { worldState.selKey = sel;
    $$("#optTable tbody tr").forEach((tr) => {
      if (tr.dataset.key === sel) tr.classList.add("sel");
    });
  });
}

// ============ 3. mod 设置 ============
const modsState = { sub: "local", mods: [], checked: new Set(), selId: null, detail: null, selOpt: null, pollTimer: null };
async function pageMods() {
  content.innerHTML = `
  <div class="subtabs">
    <button data-sub="local" class="${modsState.sub === "local" ? "active" : ""}">本地Mod</button>
    <button data-sub="download" class="${modsState.sub === "download" ? "active" : ""}">mod下载与更新</button>
  </div>
  <div id="modsBody"></div>`;
  $$(".subtabs button").forEach((b) => (b.onclick = () => { modsState.sub = b.dataset.sub; stopPoll(); pageMods(); }));
  if (modsState.sub === "local") renderModsLocal();
  else renderModsDownload();
}
function stopPoll() { if (modsState.pollTimer) { clearInterval(modsState.pollTimer); modsState.pollTimer = null; } }

async function renderModsLocal() {
  const body = $("#modsBody");
  body.innerHTML = '<div class="loading">加载模组列表…</div>';
  const j = await api("mods");
  modsState.mods = j.data.mods;
  modsState.checked = new Set(modsState.mods.filter((m) => m.enabled).map((m) => m.id));
  body.innerHTML = `
  <div class="card">
    <h3>本地Mod ${j.data.steamOk ? "" : '<span class="hint">（Steam API 不可用，仅显示本地信息）</span>'}</h3>
    <div class="btn-row">
      <button class="btn primary" id="saveSel">保存所选</button>
      <button class="btn" id="dlMissing">下载缺失模组</button>
      <button class="btn" id="refresh">刷新</button>
      <span class="hint">勾选 = 启用；点击模组行查看详情与配置；红色行 = 已启用但未下载</span>
    </div>
    <div style="overflow-x:auto"><table class="grid" id="modTable">
      <thead><tr><th></th><th>ID</th><th>预览</th><th>名称</th><th>更新日期</th><th>标签</th><th>状态</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>`;
  const tbody = $("#modTable tbody");
  if (!modsState.mods.length) tbody.innerHTML = '<tr class="disabled"><td colspan="7">暂无模组。可到「mod下载与更新」添加。</td></tr>';
  for (const m of modsState.mods) {
    const tr = document.createElement("tr");
    tr.className = [modsState.selId === m.id ? "sel" : "", m.enabled && !m.downloaded ? "need-dl" : ""].join(" ").trim();
    const tags = [
      m.clientOnly ? '<span class="tag warn">仅客户端</span>' : "",
      m.allClientsRequire ? '<span class="tag on">全员需要</span>' : "",
    ].join("");
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${m.id}" ${modsState.checked.has(m.id) ? "checked" : ""}></td>
      <td>${esc(m.id)}</td>
      <td>${m.preview_url ? `<img class="mod-img" loading="lazy" src="${esc(m.preview_url)}" onerror="this.outerHTML='<div class=mod-img></div>'">` : '<div class="mod-img"></div>'}</td>
      <td>${esc(m.title || m.name || "(未知)")}${m.name && m.title && m.name !== m.title ? `<div class="hint">${esc(m.name)}</div>` : ""}</td>
      <td>${esc(m.update_date || m.version || "-")}</td>
      <td>${tags}</td>
      <td>${m.downloaded ? '<span class="tag on">已下载</span>' : '<span class="tag">未下载</span>'}${m.enabled ? ' <span class="tag on">已启用</span>' : ""}</td>`;
    tr.onclick = (e) => {
      if (e.target.type === "checkbox") return;
      modsState.selId = m.id;
      $$("tr", tbody).forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      loadModDetail(m.id);
    };
    tbody.appendChild(tr);
  }
  $$('input[type=checkbox]', tbody).forEach((cb) => (cb.onchange = () => {
    cb.checked ? modsState.checked.add(cb.dataset.id) : modsState.checked.delete(cb.dataset.id);
  }));
  $("#saveSel").onclick = async () => {
    const r = await api("mods/save-enabled", { method: "POST", body: { ids: [...modsState.checked] } });
    toast(r.msg); renderModsLocal();
  };
  $("#refresh").onclick = async () => {
    toast("正在刷新（请求 Steam API）…");
    await api("mods?refresh=1");
    renderModsLocal();
  };
  $("#dlMissing").onclick = async () => {
    const missing = modsState.mods.filter((m) => modsState.checked.has(m.id) && !m.downloaded).map((m) => m.id);
    if (!missing.length) return toast("勾选的模组都已下载，没有缺失");
    const r = await api("mods/download", { method: "POST", body: { ids: missing } });
    toast(r.msg);
    modsState.sub = "download";
    pageMods();
  };
}

async function loadModDetail(id) {
  const overlay = document.createElement("div");
  overlay.className = "mod-detail-overlay";
  overlay.innerHTML = '<div class="mod-detail-popup"><div class="loading">加载中…</div></div>';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  const j = await apiQuiet("mods/detail?id=" + encodeURIComponent(id));
  if (!j) { overlay.querySelector(".mod-detail-popup").innerHTML = '<div class="hint">加载失败</div>'; return; }
  const d = j.data;
  modsState.detail = d;
  modsState.selOpt = null;
  const mi = d.modinfo || {};
  const mObj = modsState.mods.find((m) => m.id === id);
  const m_downloaded = mObj?.downloaded;
  const m_inSetup = mObj?.inSetup;
  const stripTags = (s) => String(s || "").replace(/\[(\/?)(color|size|b|i|u|url|img)[^\]]*\]/gi, "").replace(/<[^>]+>/g, "");
  const badges = [
    m_downloaded ? '<span class="tag on">已下载</span>' : '<span class="tag">未下载</span>',
    d.enabled ? '<span class="tag on">已启用</span>' : '<span class="tag">未启用</span>',
    mi.clientOnly ? '<span class="tag warn">仅客户端</span>' : "",
    mi.allClientsRequire ? '<span class="tag on">全员需要</span>' : "",
    ...(mObj?.tags || []).slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`),
  ].join("");
  const popup = overlay.querySelector(".mod-detail-popup");
  popup.innerHTML = `
    <button class="popup-close" id="popupX">×</button>
    <div class="md-head">
      ${d.preview_url ? `<img class="md-img" src="${esc(d.preview_url)}" onerror="this.outerHTML='<div class=md-img></div>'">` : '<div class="md-img"></div>'}
      <div class="md-head-main">
        <div class="md-title">${esc(d.title || mi.name || id)}</div>
        <div class="md-sub">ID: ${esc(id)} ｜ 更新: ${esc(d.update_date || mi.version || "-")} ｜ 订阅 ${esc(fmtNum(d.subscriptions))}</div>
        <div>${badges}</div>
      </div>
    </div>
    <details class="md-desc"><summary>模组描述（点击展开/收起）</summary><div class="md-desc-body">${esc(stripTags(d.description)).slice(0, 2000) || "（无描述）"}</div></details>
    <div class="row hint" style="margin-top:10px;margin-bottom:0">
      本地名称: ${esc(mi.name || "-")} ｜ 仅客户端: ${mi.clientOnly ? "是" : "否"} ｜ 全员需要: ${mi.allClientsRequire ? "是" : "否"}
    </div>
    ${m_downloaded || m_inSetup ? `<div class="btn-row" style="margin-bottom:0"><button class="btn danger" id="delMod">取消订阅（删除文件+移除配置）</button></div>` : ""}
    <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
      <h3 style="margin:0 0 8px">配置项</h3>
      ${d.options.length ? `
      <div class="cols">
        <div class="right" style="flex:1.4">
          <table class="grid" id="optT"><thead><tr><th>设置项</th><th>设定值</th><th>默认值</th></tr></thead><tbody></tbody></table>
        </div>
        <div class="right" style="flex:1">
          <label class="hint">设置项说明</label>
          <textarea id="optHover" readonly style="min-height:70px"></textarea>
          <div class="row"><label>选项</label><select id="optVal"></select></div>
          <div class="row"><label>值</label><input type="text" id="optValRaw" readonly size="12"></div>
          <div class="btn-row"><button class="btn primary" id="saveCfg">保存修改</button></div>
        </div>
      </div>` : '<div class="hint">该模组没有可配置项（或 modinfo.lua 尚未下载到本地）。</div>'}
    </div>
    <div class="btn-row" style="margin-top:12px"><button class="btn" id="closePopup">关闭</button></div>`;
  $("#closePopup").onclick = () => overlay.remove();
  $("#popupX").onclick = () => overlay.remove();
  const delBtn = $("#delMod");
  if (delBtn) delBtn.onclick = async () => {
    if (!(await dlgConfirm(`确定取消订阅模组 ${id}？\n将删除本地文件并从配置中彻底移除，不可恢复。`, { danger: true }))) return;
    const r = await api("mods/delete", { method: "POST", body: { id } });
    toast(r.msg);
    if (r.ok) { overlay.remove(); modsState.selId = null; const j = await api("mods"); modsState.mods = j.data.mods; renderModsLocal(); }
  };
  if (!d.options.length) return;
  const tbody = $("#optT");
  const fmt = (v) => (typeof v === "object" ? JSON.stringify(v) : String(v));
  d.options.forEach((o, idx) => {
    const tr = document.createElement("tr");
    const label = o.label_zh || o.label || o.name;
    tr.innerHTML = `<td>${esc(label)}${o.label_zh && o.label_zh !== (o.label || o.name) ? ` <span class="hint">${esc(o.label || o.name)}</span>` : ""}</td><td>${esc(fmt(o.current))}</td><td class="hint">${esc(fmt(o.default))}</td>`;
    tr.onclick = () => {
      modsState.selOpt = idx;
      $$("tr", tbody).forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      $("#optHover").value = o.hover_zh || o.hover || "（无说明）";
      const sel = $("#optVal");
      sel.innerHTML = o.options.length
        ? o.options.map((op, i) => `<option value="${i}">${esc(op.description_zh || op.description || fmt(op.data))} (${esc(fmt(op.data))})</option>`).join("")
        : '<option value="">（无可选值，直接编辑默认值）</option>';
      const curIdx = o.options.findIndex((op) => JSON.stringify(op.data) === JSON.stringify(o.current));
      if (curIdx >= 0) sel.value = String(curIdx);
      $("#optValRaw").value = fmt(curIdx >= 0 ? o.options[curIdx].data : o.current);
    };
    tbody.appendChild(tr);
  });
  $("#optVal").onchange = (e) => {
    const o = d.options[modsState.selOpt];
    if (!o || e.target.value === "") return;
    const data = o.options[Number(e.target.value)].data;
    if (["string", "number", "boolean"].includes(typeof data)) {
      o.current = data;
      $("#optValRaw").value = fmt(data);
      $$("tr", tbody)[modsState.selOpt].children[1].textContent = fmt(data);
    } else toast("该选项的值是复杂表，暂不支持面板修改", true);
  };
  $("#saveCfg").onclick = async () => {
    const options = {};
    for (const o of d.options) if (["string", "number", "boolean"].includes(typeof o.current)) options[o.name] = o.current;
    const r = await api("mods/config", { method: "POST", body: { id, options } });
    toast(r.msg);
  };
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return n.toFixed(1) + " " + u[i];
}
function renderTaskList(tasks) {
  const el = $("#taskList");
  if (!el) return;
  if (!tasks.length) { el.innerHTML = '<div class="hint">暂无下载任务</div>'; const ta = $("#taskActions"); if (ta) ta.style.display = "none"; return; }
  const statusTxt = { queued: "排队中", running: "下载中", success: "成功", failed: "失败" };
  el.innerHTML = tasks.map((t) => {
    const pct = t.totalBytes ? Math.min(100, Math.round((t.downloadedBytes / t.totalBytes) * 100)) : 0;
    const cls = t.status === "success" ? "on" : t.status === "failed" ? "err" : "off";
    const active = t.status === "queued" || t.status === "running";
    return `<div class="task-row">
      <span class="status-dot ${cls}"></span>
      <div class="task-main">
        <div><b>${esc(t.label)}</b> <span class="hint">${esc(t.modId)} ｜ ${statusTxt[t.status]}${t.status === "running" && t.totalBytes ? ` ｜ ${fmtBytes(t.downloadedBytes)} / ${fmtBytes(t.totalBytes)}` : ""}</span></div>
        ${active ? `<div class="pbar"><i style="width:${t.status === "queued" ? 0 : pct}%"></i></div>` : ""}
      </div>
      <button class="btn" data-log="${t.id}">日志</button>
      ${!active ? `<button class="btn danger" data-del="${t.id}">删除</button>` : ""}
    </div>`;
  }).join("");
  $$("#taskList [data-log]").forEach((b) => (b.onclick = async () => {
    const j = await apiQuiet("task?id=" + encodeURIComponent(b.dataset.log));
    if (!j) return;
    $("#taskLog").style.display = "";
    renderLogLines($("#taskLog"), j.data.log || "（无日志）", false);
    $("#taskLog").scrollTop = $("#taskLog").scrollHeight;
  }));
  $$("#taskList [data-del]").forEach((b) => (b.onclick = async () => {
    const r = await api("task/delete", { method: "POST", body: { id: b.dataset.del } });
    toast(r.msg);
    if (r.ok) { const j = await apiQuiet("tasks"); if (j) renderTaskList(j.data.tasks); }
  }));
  const ta = $("#taskActions");
  if (ta) {
    const hasDone = tasks.some((t) => t.status !== "queued" && t.status !== "running");
    ta.style.display = hasDone ? "" : "none";
  }
}
function startTaskPoll() {
  stopPoll();
  const tick = async () => {
    const j = await apiQuiet("tasks");
    if (!j) return;
    renderTaskList(j.data.tasks);
    if (!j.data.tasks.some((t) => t.status === "queued" || t.status === "running")) stopPoll();
  };
  tick();
  modsState.pollTimer = setInterval(tick, 1500);
}
function showModDetailPopup(id) {
  const overlay = document.createElement("div");
  overlay.className = "mod-detail-overlay";
  overlay.innerHTML = '<div class="mod-detail-popup"><div class="loading">加载中…</div></div>';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  apiQuiet("mods/detail?id=" + encodeURIComponent(id)).then((j) => {
    if (!j) { overlay.querySelector(".mod-detail-popup").innerHTML = '<div class="hint">加载失败</div>'; return; }
    const d = j.data;
    const mi = d.modinfo || {};
    const stripTags = (s) => String(s || "").replace(/\[(\/?)(color|size|b|i|u|url|img)[^\]]*\]/gi, "").replace(/<[^>]+>/g, "");
    const fmtNum = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e4).toFixed(1) + "W" : String(n || 0);
    const popStars = (() => {
      const subs = d.subscriptions || 0;
      if (subs >= 1000000) return 5;
      if (subs >= 500000) return 4;
      if (subs >= 100000) return 3;
      if (subs >= 10000) return 2;
      if (subs >= 1000) return 1;
      return 0;
    })();
    const stars = "★".repeat(popStars) + "☆".repeat(5 - popStars);
    const popup = overlay.querySelector(".mod-detail-popup");
    const clHtml = (d.changelogs && d.changelogs.length) ? `
      <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
        <b>更新历史</b>
        <div style="max-height:200px;overflow-y:auto;margin-top:6px">
          ${d.changelogs.map((c) => `<div style="padding:4px 0;border-bottom:1px solid var(--border)"><span class="c-accent">${esc(c.date)}</span><div class="hint" style="white-space:pre-wrap">${esc(c.text).slice(0, 500)}</div></div>`).join("")}
        </div>
      </div>` : "";
    popup.innerHTML = `
      <button class="popup-close" id="popupX">×</button>
      <div class="row" style="align-items:flex-start">
        ${d.preview_url ? `<img class="mod-img" style="width:80px;height:80px" src="${esc(d.preview_url)}" onerror="this.style.display='none'">` : ""}
        <div style="flex:1">
          <h3 style="margin:0">${esc(d.title || mi.name || id)}</h3>
          <div class="hint">ID: ${esc(id)}${d.update_date ? ` ｜ 更新: ${esc(d.update_date)}` : ""}${mi.clientOnly ? " ｜ 仅客户端" : ""}${mi.allClientsRequire ? " ｜ 全员需要" : ""}</div>
          <div style="margin-top:4px"><span class="stars" style="font-size:16px">${stars}</span> <span class="hint">订阅 ${esc(fmtNum(d.subscriptions))} ｜ 收藏 ${esc(fmtNum(d.favorited))} ｜ 浏览 ${esc(fmtNum(d.views))}</span></div>
        </div>
      </div>
      <div class="hint" style="margin-top:12px;max-height:200px;overflow-y:auto;white-space:pre-wrap;line-height:1.6">${esc(stripTags(d.description)).slice(0, 3000) || "（无描述）"}</div>
      ${clHtml}
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" data-add="${esc(id)}">添加</button>
        <button class="btn primary" data-dl="${esc(id)}">下载</button>
        <button class="btn" id="closePopup">关闭</button>
      </div>`;
    popup.querySelector("#closePopup").onclick = () => overlay.remove();
    popup.querySelector("#popupX").onclick = () => overlay.remove();
    popup.querySelector("[data-add]").onclick = async () => { const r = await api("mods/add", { method: "POST", body: { id } }); toast(r.msg); };
    popup.querySelector("[data-dl]").onclick = async () => { const r = await api("mods/download", { method: "POST", body: { ids: [id] } }); toast(r.msg); startTaskPoll(); overlay.remove(); };
  });
}
function renderModsDownload() {
  const body = $("#modsBody");
  body.innerHTML = `
  <div class="card">
    <h3>按名称搜索模组</h3>
    <div class="row"><label>关键词</label><input type="text" id="searchQ" placeholder="模组名称，如 Global Positions / 血量显示">
    <button class="btn primary" id="searchBtn">搜索</button></div>
    <div id="searchResults"></div>
  </div>
  <div class="card">
    <h3>按 ID 批量添加 / 下载</h3>
    <div class="row"><label>模组 ID</label><textarea id="modIds" rows="3" style="width:420px" placeholder="每行一个或用逗号分隔，如：&#10;362175979&#10;378160973"></textarea></div>
    <div class="btn-row"><button class="btn" id="addBatch">批量添加(启用)</button>
    <button class="btn primary" id="dlBatch">批量下载</button>
    <button class="btn" id="updateAll">更新全部模组</button></div>
    <div class="hint">添加 = 写入 dedicated_server_mods_setup.lua（重启服务器时自动下载）；下载 = 立即并行下载（最多同时 3 个，CDN 直链优先，失败自动回退 steamcmd）</div>
  </div>
  <div class="card" id="taskCard">
    <h3>下载任务</h3>
    <div id="taskList"></div>
    <div class="logbox" id="taskLog" style="display:none"></div>
    <div class="btn-row" id="taskActions" style="display:none"><button class="btn" id="clearTasks">清空已完成任务</button></div>
  </div>`;
  const doSearch = async () => {
    const q = $("#searchQ").value.trim();
    if (!q) return toast("请输入搜索关键词", true);
    $("#searchResults").innerHTML = '<div class="loading">搜索中…</div>';
    const j = await apiQuiet("mods/search?q=" + encodeURIComponent(q));
    if (!j) { $("#searchResults").innerHTML = '<div class="hint">搜索失败，请稍后重试。</div>'; return; }
    const rs = j.data.results;
    if (!rs.length) { $("#searchResults").innerHTML = '<div class="hint">没有找到相关模组。</div>'; return; }
    // 星级：>100万=5星，>10万=4星，>1万=3星，>1千=2星，否则1星
    const starCount = (s) => (s > 1e6 ? 5 : s > 1e5 ? 4 : s > 1e4 ? 3 : s > 1e3 ? 2 : 1);
    const starStr = (s) => "★".repeat(starCount(s)) + "☆".repeat(5 - starCount(s));
    $("#searchResults").innerHTML = '<div class="search-results"><div class="mod-grid">' + rs.map((r) => `
      <div class="mod-cell" data-detail="${r.id}">
        ${r.preview_url ? `<img class="mod-img" loading="lazy" src="${esc(r.preview_url)}" onerror="this.outerHTML='<div class=mod-img></div>'">` : '<div class="mod-img"></div>'}
        <div class="mod-cell-body"><b>${esc(r.title)}</b><div class="hint">ID ${esc(r.id)}</div>
        <div class="mod-cell-meta"><span class="stars">${starStr(r.subscriptions || 0)}</span><span class="hint">${esc(fmtNum(r.subscriptions))} 订阅${r.time_updated ? ` ｜ 更新 ${esc(fmtDay(r.time_updated))}` : ""}</span></div>
        <div class="btn-row"><button class="btn" data-add="${r.id}">添加</button><button class="btn primary" data-dl="${r.id}">下载</button></div></div>
      </div>`).join("") + "</div></div>";
    $$("#searchResults [data-detail]").forEach((cell) => (cell.onclick = (e) => {
      if (e.target.closest("button")) return;
      showModDetailPopup(cell.dataset.detail);
    }));
    $$("#searchResults [data-add]").forEach((b) => (b.onclick = async () => {
      const r = await api("mods/add", { method: "POST", body: { id: b.dataset.add } });
      toast(r.msg);
    }));
    $$("#searchResults [data-dl]").forEach((b) => (b.onclick = async () => {
      const r = await api("mods/download", { method: "POST", body: { ids: [b.dataset.dl] } });
      toast(r.msg); startTaskPoll();
    }));
  };
  $("#searchBtn").onclick = doSearch;
  $("#searchQ").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
  const parseIds = () => [...new Set($("#modIds").value.match(/\d{4,15}/g) || [])];
  $("#addBatch").onclick = async () => {
    const ids = parseIds();
    if (!ids.length) return toast("请输入至少一个模组 ID", true);
    const r = await api("mods/add", { method: "POST", body: { ids } });
    toast(r.msg);
  };
  $("#dlBatch").onclick = async () => {
    const ids = parseIds();
    if (!ids.length) return toast("请输入至少一个模组 ID", true);
    const r = await api("mods/download", { method: "POST", body: { ids } });
    toast(r.msg); startTaskPoll();
  };
  $("#updateAll").onclick = async () => {
    if (!(await dlgConfirm("将对所有已添加模组重新下载更新，继续？"))) return;
    const r = await api("mods/update-all", { method: "POST", body: {} });
    toast(r.msg); startTaskPoll();
  };
  const clearBtn = $("#clearTasks");
  if (clearBtn) clearBtn.onclick = async () => {
    const r = await api("task/clear", { method: "POST", body: {} });
    toast(r.msg);
    const j = await apiQuiet("tasks"); if (j) renderTaskList(j.data.tasks);
  };
  startTaskPoll();
}

// ============ 4. 服务器管理 ============
async function pageServer() {
  const j = await api("server/status");
  const d = j.data;
  const shardRows = d.shards.map((s) =>
    `<tr><td><span class="status-dot ${s.running ? "on" : "off"}"></span>${esc(s.name)}（${s.isMaster ? "地上" : "地下"}）</td>
     <td>${s.running ? "运行中" : "未运行"}</td><td>${esc(s.port)}</td></tr>`).join("");
  content.innerHTML = `
  <div class="card">
    <h3>服务器控制</h3>
    <div class="btn-row">
      <button class="btn primary" id="start">▶ 启动服务器</button>
      <button class="btn danger" id="stop">⏹ 关闭服务器</button>
      <button class="btn" id="restart">🔁 重启服务器</button>
      <button class="btn" id="pauseBtn">⏸ 暂停服务器</button>
      <button class="btn" id="reStatus">🔄 刷新状态</button>
    </div>
    <table class="grid"><thead><tr><th>分片</th><th>状态</th><th>端口</th></tr></thead><tbody>${shardRows}</tbody></table>
    <div class="row" style="margin-top:10px"><label>自动重启</label>
      <label class="switch" title="每 30 秒检查分片，掉线自动拉起"><input type="checkbox" id="arSwitch" ${d.autorestart ? "checked" : ""}><span class="slider"></span></label>
      <span class="hint">每 30 秒检查一次，分片掉线自动拉起</span></div>
    <div class="row"><label>世界暂停</label><span id="pauseState" class="hint">查询中…</span> <span class="hint">暂停 = 冻结世界时间（昼夜/作物/生物停止），玩家不被踢出</span></div>
  </div>
  <div class="card">
    <h3>服务器连接模式</h3>
    <div class="row">
      <label><input type="radio" name="mode" value="online" ${d.mode === "online" ? "checked" : ""}> 在线模式</label>
      <label><input type="radio" name="mode" value="offline" ${d.mode === "offline" ? "checked" : ""}> 离线模式</label>
      <span class="hint">切换后需重启服务器生效</span>
    </div>
  </div>
  <div class="cols">
    <div class="right card"><h3>管理员列表（adminlist.txt）</h3>
      <div class="row"><input type="text" id="adminNew" placeholder="KU_ id" style="flex:1;min-width:120px"> <input type="text" id="adminNewNote" placeholder="备注（可选）" style="flex:1;min-width:100px"> <button class="btn primary" id="adminAdd">添加</button></div>
      <div class="adm-table"><table class="grid"><thead><tr><th style="width:30px"></th><th>KU id</th><th>名称</th><th>备注</th></tr></thead><tbody id="adminTbody"></tbody></table></div>
      <div class="btn-row"><button class="btn danger" id="adminDel">删除所选</button> <button class="btn" id="adminSaveNotes">保存备注</button></div>
    </div>
    <div class="right card"><h3>黑名单（blocklist.txt）</h3>
      <div class="row"><input type="text" id="blockNew" placeholder="KU_ id" style="flex:1;min-width:120px"> <input type="text" id="blockNewNote" placeholder="备注（可选）" style="flex:1;min-width:100px"> <button class="btn primary" id="blockAdd">添加</button></div>
      <div class="adm-table"><table class="grid"><thead><tr><th style="width:30px"></th><th>KU id</th><th>名称</th><th>备注</th></tr></thead><tbody id="blockTbody"></tbody></table></div>
      <div class="btn-row"><button class="btn danger" id="blockDel">删除所选</button> <button class="btn" id="blockSaveNotes">保存备注</button></div>
    </div>
  </div>
  <div class="card">
    <h3>服务器日志 <span class="hint" id="logHint">（实时刷新）</span></h3>
    <div class="btn-row"><button class="btn" id="logToggle">暂停刷新</button><span class="hint" id="logCount"></span></div>
    <div class="logbox" id="serverLog" style="min-height:200px;max-height:400px"></div>
  </div>`;
  const act = async (path, body = {}) => { const r = await api(path, { method: "POST", body }); toast(r.msg); setTimeout(pageServer, 1500); };
  $("#start").onclick = () => act("server/start");
  $("#stop").onclick = async () => { if (await dlgConfirm("确定关闭服务器？在线玩家将被踢出。", { danger: true })) act("server/stop"); };
  $("#restart").onclick = async () => { if (await dlgConfirm("确定重启服务器？")) act("server/restart"); };
  // 暂停/继续合一按钮：按当前状态切换文案与行为
  let worldPaused = false;
  const pauseBtn = $("#pauseBtn");
  const refreshPauseBtn = () => {
    pauseBtn.textContent = worldPaused ? "▶ 继续服务器" : "⏸ 暂停服务器";
    pauseBtn.onclick = async () => {
      if (worldPaused) return act("server/pause", { pause: false });
      if (await dlgConfirm("确定暂停服务器？世界时间将冻结（玩家不会被踢出），再次点击恢复。")) act("server/pause", { pause: true });
    };
  };
  refreshPauseBtn();
  $("#reStatus").onclick = pageServer;
  // 暂停状态（best-effort 查询，查不到就显示未知）
  apiQuiet("server/pausestate").then((ps) => {
    const el = $("#pauseState");
    if (!el) return;
    if (!ps || ps.data.paused === null || ps.data.paused === undefined) el.textContent = "未知（服务器未运行或不支持查询）";
    else {
      worldPaused = ps.data.paused === true;
      el.innerHTML = worldPaused ? '<span class="tag warn">已暂停</span>' : '<span class="tag on">运行中</span>';
      refreshPauseBtn();
    }
  });
  // 自动重启滑动开关
  $("#arSwitch").onchange = async (e) => {
    const on = e.target.checked;
    const r = await api("server/autorestart", { method: "POST", body: { on } });
    toast(r.msg);
  };
  $$('input[name=mode]').forEach((r) => (r.onchange = () => act("server/mode", { mode: r.value })));
  // 管理员/黑名单：表格展示（ID + 名称 + 备注），勾选删除，按 KU_id 新增
  const [al, bl] = await Promise.all([api("server/adminlist"), api("server/blocklist")]);
  const renderIdTable = (tbody, entries) => {
    if (!entries.length) { tbody.innerHTML = '<tr class="disabled"><td colspan="4" style="text-align:center">（空）</td></tr>'; return; }
    tbody.innerHTML = entries.map((e) => `<tr>
      <td><input type="checkbox" data-id="${esc(e.id)}"></td>
      <td style="font-family:monospace">${esc(e.id)}</td>
      <td>${e.name === "(未知)" ? (e.note ? esc(e.note) : '<span class="hint">(未知)</span>') : esc(e.name)}</td>
      <td><input type="text" class="id-note" data-id="${esc(e.id)}" value="${esc(e.note || "")}" placeholder="无" style="width:100%;font-size:13px"></td>
    </tr>`).join("");
  };
  renderIdTable($("#adminTbody"), al.data.entries || []);
  renderIdTable($("#blockTbody"), bl.data.entries || []);
  const collectEntries = (tbodyId) =>
    $$(`${tbodyId} .id-note`).map((inp) => ({ id: inp.dataset.id, note: inp.value.trim() }));
  const addId = async (inputId, noteId, path) => {
    const v = $(inputId).value.trim();
    if (!v) return toast("请输入 KU_ id", true);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) return toast("ID 只能包含字母、数字、下划线、连字符", true);
    const cur = (await api(path)).data.entries.map((e) => e.id);
    if (cur.includes(v)) return toast("该 ID 已在列表中", true);
    cur.push(v);
    const note = $(noteId).value.trim();
    const entries = cur.map((id) => ({ id, note: id === v ? note : "" }));
    toast((await api(path, { method: "POST", body: { entries } })).msg);
    pageServer();
  };
  const delIds = async (tbodyId, path) => {
    const checked = $$(`${tbodyId} input[type=checkbox]:checked`).map((c) => c.dataset.id);
    if (!checked.length) return toast("请先勾选要删除的行", true);
    if (!(await dlgConfirm(`确定从列表中删除 ${checked.length} 个 ID？\n${checked.join("、")}`, { danger: true }))) return;
    const entries = collectEntries(tbodyId).filter((e) => !checked.includes(e.id));
    toast((await api(path, { method: "POST", body: { entries } })).msg);
    pageServer();
  };
  const saveNotes = async (tbodyId, path) => {
    const entries = collectEntries(tbodyId);
    toast((await api(path, { method: "POST", body: { entries } })).msg);
  };
  $("#adminAdd").onclick = () => addId("#adminNew", "#adminNewNote", "server/adminlist");
  $("#blockAdd").onclick = () => addId("#blockNew", "#blockNewNote", "server/blocklist");
  $("#adminDel").onclick = () => delIds("#adminTbody", "server/adminlist");
  $("#blockDel").onclick = () => delIds("#blockTbody", "server/blocklist");
  $("#adminSaveNotes").onclick = () => saveNotes("#adminTbody", "server/adminlist");
  $("#blockSaveNotes").onclick = () => saveNotes("#blockTbody", "server/blocklist");
  // 日志实时刷新
  let logPolling = true;
  let logTimer = null;
  const fetchLog = async () => {
    const j = await apiQuiet("serverlog");
    if (!j) return;
    const el = $("#serverLog");
    const wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    renderLogLines(el, j.data.lines.join("\n") || "（暂无日志，启动服务器后显示）");
    const lc = $("#logCount");
    if (lc) lc.textContent = `${j.data.count} 行`;
    if (wasAtBottom) el.scrollTop = el.scrollHeight;
  };
  fetchLog();
  logTimer = setInterval(() => { if (logPolling) fetchLog(); }, 2000);
  $("#logToggle").onclick = () => {
    logPolling = !logPolling;
    $("#logToggle").textContent = logPolling ? "暂停刷新" : "恢复刷新";
    $("#logHint").textContent = logPolling ? "（实时刷新）" : "（已暂停）";
    if (logPolling) fetchLog();
  };
  // 页面切换时清除定时器
  if (window._serverLogTimer) clearInterval(window._serverLogTimer);
  window._serverLogTimer = logTimer;
}

// ============ 5. 控制台 ============
const consoleState = { players: [], sel: null, items: [], world: null, cachedPlayers: null, cachedWorld: null, itemHistory: [] };
function luaEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
async function execLua(lua) {
  const r = await api("console/exec", { method: "POST", body: { lua } });
  toast(r.msg);
}
async function pageConsole() {
  const histJ = await apiQuiet("item-history");
  if (histJ) consoleState.itemHistory = histJ.data.history;
  content.innerHTML = `
  <div class="cols">
    <div class="left">
      <div class="card">
        <h3>坐标传送</h3>
        <div class="row"><label>X</label><input type="number" id="coordX" size="8"><label>Y</label><input type="number" id="coordY" size="8"></div>
        <div class="btn-row">
          <button class="btn" data-tp="水球大战">水球大战</button>
          <button class="btn" data-tp="蜻蜓猎场">蜻蜓猎场</button>
          <button class="btn" data-tp="开会">开会</button>
          <button class="btn" id="tpPlayer">转移玩家</button>
        </div>
        <div class="hint">坐标为空时，集体活动将传送到选中玩家位置。</div>
      </div>
    </div>
    <div class="right">
      <div class="card">
        <h3>玩家操作 <span class="hint" id="selPlayerHint">（未选择玩家）</span></h3>
        <div class="listbox" id="plist" style="max-height:180px"></div>
        <div class="btn-row"><button class="btn" id="refreshPlayers">刷新玩家列表</button></div>
        <div class="btn-row">
          <button class="btn" id="mkAdmin">设置为管理员</button>
          <button class="btn" id="allRecipes">全物品制造</button>
          <button class="btn danger" id="banPlayer">禁止玩家</button>
          <button class="btn danger" id="killPlayer">杀死玩家</button>
          <button class="btn" id="despawn">重选人物</button>
          <button class="btn" id="dropAll">掉落所有物品</button>
          <button class="btn" id="warReady">战备</button>
        </div>
        <div class="btn-row">
          <button class="btn" data-tech="sci1">解锁科一</button>
          <button class="btn" data-tech="sci2">解锁科二</button>
          <button class="btn" data-tech="mag1">解锁魔一</button>
          <button class="btn" data-tech="mag2">解锁魔二</button>
          <button class="btn" data-tech="ancient">解锁远古</button>
        </div>
        <div class="row">
          <label>物品</label><input type="text" id="itemFilter" placeholder="输入中文名或 prefab 搜索" autocomplete="off" style="width:200px">
          <select id="catFilter"><option value="">全部分类</option>${consoleState.items.length ? [...new Set(consoleState.items.map((it) => it.cat || "其他"))].sort().map((c) => `<option value="${c}">${c}</option>`).join("") : ""}</select>
          <label>数量</label><input type="number" id="itemCount" value="1" min="1" max="999" style="width:70px">
          <button class="btn" id="giveSel">给选中玩家</button>
          <button class="btn" id="giveAll">给所有玩家</button>
          <button class="btn" id="spawnFeet">放到玩家脚下</button>
          <span class="hint" id="itemSelHint">未选择物品（在下方列表中点击选择）</span>
        </div>
        <div id="itemHistoryBox" class="item-history"></div>
        <div id="itemTable" class="item-table">${consoleState.items.length ? "" : '<div class="hint" style="padding:10px;text-align:center">正在加载物品数据…</div>'}</div>
      </div>
      <div class="card">
        <h3>存档管理</h3>
        <div class="row" style="margin-bottom:4px"><label style="min-width:70px">房间状态</label><span id="worldInfo" class="hint">尚未获取</span>
          <button class="btn" id="refreshWorld">刷新世界信息</button></div>
        <div class="btn-row">
          <button class="btn" id="cSave">保存进度</button>
          <button class="btn danger" id="cRegen">重新生成世界</button>
          <button class="btn danger" id="cRollback">回档一天</button>
          <button class="btn" id="refreshSaves">刷新存档列表</button>
        </div>
        <div id="saveList"></div>
      </div>
      <div class="card">
        <h3>全局操作</h3>
        <div class="btn-row">
          <button class="btn danger" id="killAll">杀死所有玩家</button>
          <button class="btn" id="reviveAll">复活已死玩家</button>
          <button class="btn" id="rainOn">开始下雨</button>
          <button class="btn" id="rainOff">停止下雨</button>
          <button class="btn" id="nextPhase">跳过当前阶段</button>
          <button class="btn" id="nextCycle">跳过当天</button>
        </div>
        <div class="row">
          <label>设置季节</label>
          <select id="seasonSel"><option value="spring">春</option><option value="summer">夏</option><option value="autumn">秋</option><option value="winter">冬</option></select>
          <button class="btn" id="setSeason">设置</button>
          <label>跳过</label><input type="number" id="skipDays" value="1" min="1" max="365" style="width:70px"><label>天</label>
          <button class="btn" id="skipBtn">跳过X天</button>
        </div>
      </div>
      <div class="card">
        <h3>公告</h3>
        <div class="row"><input type="text" id="announceText" size="40" placeholder="公告内容">
          <button class="btn primary" id="sendAnnounce">发送公告</button>
          <button class="btn" id="addAnnounce">添加公告</button></div>
        <div class="listbox" id="announceList" style="max-height:140px"></div>
        <div class="btn-row">
          <button class="btn danger" id="delAnnounce">删除所选</button>
          <label><input type="checkbox" id="autoAnnounce"> 开启自动公告</label>
          <label>间隔(秒)</label><input type="number" id="announceInterval" value="300" min="10" style="width:80px">
          <button class="btn" id="saveAuto">保存设置</button>
        </div>
      </div>
    </div>
  </div>`;

  const needPlayer = () => {
    if (!consoleState.sel) { toast("请先在左侧选择玩家", true); return null; }
    return consoleState.sel;
  };
  const forPlayer = (tpl) => { const p = needPlayer(); if (p) return execLua(tpl.replace(/<ID>/g, luaEsc(p.userid))); };

  // 渲染玩家列表（复用于缓存和刷新）
  const renderPlayers = (players) => {
    const box = $("#plist");
    box.innerHTML = players.length ? "" : '<div class="item">（没有在线玩家）</div>';
    players.forEach((p) => {
      const div = document.createElement("div");
      div.className = "item" + (consoleState.sel?.userid === p.userid ? " sel" : "");
      div.textContent = `${p.name} (${p.userid})`;
      div.onclick = () => {
        consoleState.sel = p;
        $$(".item", box).forEach((el) => el.classList.remove("sel"));
        div.classList.add("sel");
        $("#selPlayerHint").textContent = `（已选：${p.name}）`;
      };
      box.appendChild(div);
    });
  };

  // 渲染世界信息（复用于缓存和刷新）
  const renderWorld = (w) => {
    const seasonCN = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" }[w.season] || w.season;
    const phaseCN = { day: "白天", dusk: "黄昏", night: "夜晚" }[w.phase] || w.phase;
    $("#worldInfo").innerHTML = `天数: <b>${esc(w.cycles)}</b> ｜ 季节: <b>${esc(seasonCN)}</b> ｜ 阶段: <b>${esc(phaseCN)}</b> ｜ 下雨: <b>${w.israining === "true" ? "是" : "否"}</b>`;
  };
  if (consoleState.cachedWorld) renderWorld(consoleState.cachedWorld);

  // 进入控制台即检查状态：未启动→红色提示；已启动→房间状态自动获取（获取中），玩家列表提示手动刷新
  (async () => {
    const st = await apiQuiet("server/status");
    const running = !!st && st.data.shards.some((s) => s.running);
    if (!running) {
      $("#plist").innerHTML = '<div class="item err-text">服务器未启动</div>';
      $("#worldInfo").innerHTML = '<span class="err-text">服务器未启动</span>';
      return;
    }
    // 玩家列表进入控制台也自动刷新
    $("#plist").innerHTML = '<div class="item">获取中…</div>';
    const pj = await apiQuiet("console/players", { method: "POST", body: {} });
    if (pj) {
      consoleState.players = pj.data.players;
      consoleState.cachedPlayers = pj.data.players;
      renderPlayers(pj.data.players);
    } else {
      $("#plist").innerHTML = '<div class="item">获取失败，请点击「刷新玩家列表」重试</div>';
    }
    if (!consoleState.cachedWorld) {
      $("#worldInfo").textContent = "获取中…";
      const j = await apiQuiet("console/worldinfo", { method: "POST", body: {} });
      if (j) {
        consoleState.cachedWorld = j.data;
        renderWorld(j.data);
      } else {
        $("#worldInfo").textContent = "获取失败，请点击「刷新世界信息」重试";
      }
    }
  })();

  // 物品历史渲染
  const renderItemHistory = () => {
    const box = $("#itemHistoryBox");
    if (!consoleState.itemHistory.length) { box.innerHTML = ""; return; }
    box.innerHTML = '<span class="hint">最近使用：</span>' + consoleState.itemHistory.map((prefab) => {
      const it = consoleState.items.find((x) => x.prefab === prefab);
      const name = it ? it.name : prefab;
      return `<span class="hist-tag" data-p="${esc(prefab)}">${esc(name)}<i data-del="${esc(prefab)}" style="margin-left:4px;cursor:pointer">×</i></span>`;
    }).join("");
    $$("#itemHistoryBox [data-p]").forEach((tag) => tag.onclick = () => {
      selItem = tag.dataset.p;
      const it = consoleState.items.find((x) => x.prefab === selItem);
      if (it) {
        $("#itemSelHint").textContent = `已选择: ${it.name} (${it.prefab})`;
        $$("#itemTable .item-row").forEach((x) => x.classList.toggle("sel", x.dataset.p === selItem));
      }
    });
    $$("#itemHistoryBox [data-del]").forEach((d) => d.onclick = async (e) => {
      e.stopPropagation();
      const j = await apiQuiet("item-history/delete", { method: "POST", body: { prefab: d.dataset.del } });
      if (j) { consoleState.itemHistory = j.data.history; renderItemHistory(); }
    });
  };
  renderItemHistory();

  $("#refreshPlayers").onclick = async () => {
    const j = await apiQuiet("console/players", { method: "POST", body: {} });
    if (!j) return;
    consoleState.players = j.data.players;
    consoleState.cachedPlayers = j.data.players;
    renderPlayers(j.data.players);
  };
  $("#refreshWorld").onclick = async () => {
    const j = await apiQuiet("console/worldinfo", { method: "POST", body: {} });
    if (!j) return;
    consoleState.cachedWorld = j.data;
    renderWorld(j.data);
  };

  $("#mkAdmin").onclick = async () => {
    const p = needPlayer(); if (!p) return;
    const cur = (await api("server/adminlist")).data.content;
    const lines = cur.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.includes(p.userid)) lines.push(p.userid);
    await api("server/adminlist", { method: "POST", body: { content: lines.join("\n") } });
    toast(`已将 ${p.name} 加入管理员列表`);
  };
  $("#allRecipes").onclick = () => forPlayer(`local p=UserToPlayer("<ID>") if p and p.components.builder then p.components.builder:GiveAllRecipes() end`);
  $("#banPlayer").onclick = async () => {
    const p = needPlayer(); if (!p) return;
    if (!(await dlgConfirm(`确定封禁 ${p.name} (${p.userid})？`, { danger: true }))) return;
    await execLua(`TheNet:Ban("${luaEsc(p.userid)}")`);
    const cur = (await api("server/blocklist")).data.content;
    const lines = cur.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.includes(p.userid)) lines.push(p.userid);
    await api("server/blocklist", { method: "POST", body: { content: lines.join("\n") } });
    toast(`已封禁 ${p.name}`);
  };
  $("#killPlayer").onclick = () => forPlayer(`local p=UserToPlayer("<ID>") if p then p:PushEvent("death") end`);
  $("#despawn").onclick = async () => { if (await dlgConfirm("确定让该玩家重选人物？")) forPlayer(`local p=UserToPlayer("<ID>") if p then c_despawn(p) end`); };
  $("#dropAll").onclick = () => forPlayer(`local p=UserToPlayer("<ID>") if p and p.components.inventory then pcall(function() p.components.inventory:DropEverything() end) end`);
  $("#warReady").onclick = () => {
    const items = ["spear", "armorwood", "footballhat", "hambat", "healingsalve", "healingsalve", "healingsalve"];
    forPlayer(`local p=UserToPlayer("<ID>") if p and p.components.inventory then for _,v in ipairs({${items.map((i) => `"${i}"`).join(",")}}) do pcall(function() p.components.inventory:GiveItem(SpawnPrefab(v)) end) end end`);
  };
  const techLua = {
    sci1: `local p=UserToPlayer("<ID>") if p then pcall(function() p.components.builder.science_bonus=1 p:PushEvent("techtreechange") end) end`,
    sci2: `local p=UserToPlayer("<ID>") if p then pcall(function() p.components.builder.science_bonus=2 p:PushEvent("techtreechange") end) end`,
    mag1: `local p=UserToPlayer("<ID>") if p then pcall(function() p.components.builder.magic_bonus=1 p:PushEvent("techtreechange") end) end`,
    mag2: `local p=UserToPlayer("<ID>") if p then pcall(function() p.components.builder.magic_bonus=2 p:PushEvent("techtreechange") end) end`,
    ancient: `local p=UserToPlayer("<ID>") if p then pcall(function() p.components.builder.ancient_bonus=2 p:PushEvent("techtreechange") end) end`,
  };
  $$("[data-tech]").forEach((b) => (b.onclick = () => forPlayer(techLua[b.dataset.tech])));

  const giveLua = (prefab, count, all) => {
    const give = `for i=1,${count} do pcall(function() p.components.inventory:GiveItem(SpawnPrefab("${prefab}")) end) end`;
    return all
      ? `for _,p in ipairs(AllPlayers) do if p.components.inventory then ${give} end end`
      : `local p=UserToPlayer("<ID>") if p and p.components.inventory then ${give} end`;
  };
  // 物品表：分批渲染（首屏 200 条，滚到底部追加下一批），搜索/分类过滤在完整数据上进行
  let selItem = null;
  let itemView = consoleState.items;
  let itemShown = 0;
  const ITEM_BATCH = 100;
  const itemTable = $("#itemTable");
  const renderItemBatch = (reset = false) => {
    if (reset) { itemTable.innerHTML = ""; itemShown = 0; }
    itemTable.querySelector(".item-more")?.remove();
    const batch = itemView.slice(itemShown, itemShown + ITEM_BATCH);
    itemTable.insertAdjacentHTML("beforeend", batch.map((it) =>
      `<div class="item-row" data-p="${it.prefab}"><span>${esc(it.name)}</span><span class="hint"><span class="tag">${esc(it.cat || "其他")}</span> ${it.prefab}</span></div>`).join(""));
    itemShown += batch.length;
    if (itemShown < itemView.length) {
      itemTable.insertAdjacentHTML("beforeend", `<div class="item-more hint" style="padding:6px;text-align:center">滚动加载更多（已显示 ${itemShown}/${itemView.length}）</div>`);
    }
  };
  // 点击选中（事件委托，兼容分批追加的行）
  itemTable.onclick = (e) => {
    const r = e.target.closest(".item-row");
    if (!r) return;
    selItem = r.dataset.p;
    const it = consoleState.items.find((x) => x.prefab === selItem);
    if (it) $("#itemSelHint").textContent = `已选择: ${it.name} (${it.prefab})`;
    $$("#itemTable .item-row").forEach((x) => x.classList.toggle("sel", x.dataset.p === selItem));
  };
  // 滚动到底部附近时追加渲染下一批
  itemTable.onscroll = () => {
    if (itemShown >= itemView.length) return;
    if (itemTable.scrollTop + itemTable.clientHeight >= itemTable.scrollHeight - 60) renderItemBatch();
  };
  const applyItemFilter = () => {
    const q = $("#itemFilter").value.trim().toLowerCase();
    const cat = $("#catFilter").value;
    itemView = consoleState.items.filter((it) =>
      (!cat || (it.cat || "其他") === cat) &&
      (!q || it.name.toLowerCase().includes(q) || it.prefab.toLowerCase().includes(q)));
    renderItemBatch(true);
  };
  $("#itemFilter").oninput = applyItemFilter;
  $("#catFilter").onchange = applyItemFilter;
  // 物品数据可能还在后台加载中
  if (consoleState.items.length) {
    renderItemBatch(true);
  } else {
    apiQuiet("items").then((j) => {
      if (!j) { itemTable.innerHTML = '<div class="hint" style="padding:10px;text-align:center">物品数据加载失败</div>'; return; }
      consoleState.items = j.data;
      itemView = consoleState.items;
      // 刷新分类下拉
      const sel = $("#catFilter");
      sel.innerHTML = '<option value="">全部分类</option>' + [...new Set(consoleState.items.map((it) => it.cat || "其他"))].sort().map((c) => `<option value="${c}">${c}</option>`).join("");
      renderItemBatch(true);
    });
  }
  // 取当前物品：优先点击选中的，其次输入框精确匹配
  const resolveItem = () => {
    if (selItem) return selItem;
    const v = $("#itemFilter").value.trim();
    if (!v) { toast("请在物品列表中点击选择一个物品", true); return null; }
    const items = consoleState.items;
    if (items.some((it) => it.prefab === v)) return v;
    const byName = items.find((it) => it.name === v);
    if (byName) return byName.prefab;
    toast(`没有匹配的物品「${v}」，请在列表中点击选择`, true);
    return null;
  };
  const addHistory = async (prefab) => {
    const j = await apiQuiet("item-history/add", { method: "POST", body: { prefab } });
    if (j) { consoleState.itemHistory = j.data.history; renderItemHistory(); }
  };
  $("#giveSel").onclick = () => { const p = resolveItem(); if (p) { forPlayer(giveLua(p, Math.max(1, +$("#itemCount").value || 1), false)); addHistory(p); } };
  $("#giveAll").onclick = () => { const p = resolveItem(); if (p) { execLua(giveLua(p, Math.max(1, +$("#itemCount").value || 1), true)); addHistory(p); } };
  $("#spawnFeet").onclick = () => { const p = resolveItem(); if (p) { const n = Math.min(100, Math.max(1, +$("#itemCount").value || 1)); forPlayer(`local p=UserToPlayer("<ID>") if p then local x,_,z=p.Transform:GetWorldPosition() for i=1,${n} do pcall(function() local it=SpawnPrefab("${p}") if it and it.Transform then it.Transform:SetPosition(x+math.random(-2,2)+0.5,0,z+math.random(-2,2)+0.5) end end) end end`); addHistory(p); } };

  $("#cSave").onclick = () => execLua("c_save()");
  $("#cRegen").onclick = async () => { if (await dlgConfirm("确定重新生成世界？当前世界存档将被清除，不可恢复！", { danger: true })) execLua("c_regenerateworld()"); };
  $("#cRollback").onclick = async () => { if (await dlgConfirm("确定回档一天？")) execLua("c_rollback(1)"); };

  // 存档列表
  const renderSaves = async () => {
    const box = $("#saveList");
    box.innerHTML = '<div class="hint">加载中…</div>';
    const j = await apiQuiet("saves/list");
    if (!j) return;
    const saves = j.data.saves || [];
    if (!saves.length) { box.innerHTML = '<div class="hint">暂无存档数据</div>'; return; }
    const latestDay = j.data.latestDay;
    box.innerHTML = `<div class="hint" style="margin-bottom:6px">当前最新存档：第 ${latestDay} 天</div>` +
      saves.map((s) => {
        const isLatest = s.snap === (j.data.latestSnap || 0);
        return `<button class="btn${isLatest ? "" : " danger"}" data-snap="${s.snap}" style="margin:2px;font-size:13px">${isLatest ? `第${s.day}天（当前）` : `回档到第${s.day}天`}${s.date ? `<span class="save-date">${esc(s.date)}</span>` : ""}</button>`;
      }).join("");
    $$("#saveList [data-snap]").forEach((b) => b.onclick = async () => {
      const snap = parseInt(b.dataset.snap);
      if (snap === (j.data.latestSnap || 0)) return toast("已在当前天数");
      const sv = saves.find((x) => x.snap === snap);
      if (!(await dlgConfirm(`确定回档到第${sv ? sv.day : "?"}天？`))) return;
      const r = await api("saves/rollback", { method: "POST", body: { snap } });
      toast(r.msg); renderSaves();
    });
  };
  $("#refreshSaves").onclick = renderSaves;
  renderSaves(); // 进入控制台自动加载存档列表

  $("#killAll").onclick = async () => { if (await dlgConfirm("确定杀死所有玩家？", { danger: true })) execLua(`for _,p in ipairs(AllPlayers) do p:PushEvent("death") end`); };
  $("#reviveAll").onclick = () => execLua(`for _,p in ipairs(AllPlayers) do if p:HasTag("playerghost") then p:PushEvent("respawnfromghost") end end`);
  $("#rainOn").onclick = () => execLua(`TheWorld:PushEvent("ms_forceprecipitation", true)`);
  $("#rainOff").onclick = () => execLua(`TheWorld:PushEvent("ms_forceprecipitation", false)`);
  $("#nextPhase").onclick = () => execLua(`TheWorld:PushEvent("ms_nextphase")`);
  $("#nextCycle").onclick = () => execLua(`TheWorld:PushEvent("ms_nextcycle")`);
  $("#setSeason").onclick = () => execLua(`TheWorld:PushEvent("ms_setseason", "${$("#seasonSel").value}")`);
  $("#skipBtn").onclick = () => {
    const n = Math.min(365, Math.max(1, +$("#skipDays").value || 1));
    execLua(`for i=1,${n} do TheWorld:PushEvent("ms_nextcycle") end`);
  };

  // 传送
  const tpAll = (label) => {
    const x = $("#coordX").value, y = $("#coordY").value;
    if (x !== "" && y !== "") {
      execLua(`for _,p in ipairs(AllPlayers) do p.Transform:SetPosition(${+x},0,${+y}) end`);
    } else {
      const p = needPlayer(); if (!p) return;
      execLua(`local t=UserToPlayer("${luaEsc(p.userid)}") if t then local x,_,z=t.Transform:GetWorldPosition() for _,p in ipairs(AllPlayers) do p.Transform:SetPosition(x,0,z) end end`);
    }
  };
  $$("[data-tp]").forEach((b) => (b.onclick = () => tpAll(b.dataset.tp)));
  $("#tpPlayer").onclick = () => {
    const p = needPlayer(); if (!p) return;
    const x = $("#coordX").value, y = $("#coordY").value;
    if (x === "" || y === "") return toast("请先填写 X/Y 坐标", true);
    execLua(`local p=UserToPlayer("${luaEsc(p.userid)}") if p then p.Transform:SetPosition(${+x},0,${+y}) end`);
  };

  // 公告
  const annState = { list: [], sel: null };
  const renderAnn = () => {
    const box = $("#announceList");
    box.innerHTML = annState.list.length ? "" : '<div class="item">（暂无公告）</div>';
    annState.list.forEach((a, i) => {
      const div = document.createElement("div");
      div.className = "item" + (annState.sel === i ? " sel" : "");
      div.textContent = a;
      div.onclick = () => { annState.sel = i; $$(".item", box).forEach((el) => el.classList.remove("sel")); div.classList.add("sel"); };
      box.appendChild(div);
    });
  };
  const saveAnnList = async () => api("announce/list", { method: "POST", body: { list: annState.list } });
  $("#sendAnnounce").onclick = async () => {
    const t = $("#announceText").value.trim();
    if (!t) return toast("请输入公告内容", true);
    await execLua(`c_announce("${luaEsc(t)}")`);
  };
  $("#addAnnounce").onclick = async () => {
    const t = $("#announceText").value.trim();
    if (!t) return toast("请输入公告内容", true);
    annState.list.push(t); renderAnn(); await saveAnnList(); toast("已添加公告");
  };
  $("#delAnnounce").onclick = async () => {
    if (annState.sel === null) return toast("请先选择公告", true);
    annState.list.splice(annState.sel, 1); annState.sel = null; renderAnn(); await saveAnnList(); toast("已删除");
  };
  $("#saveAuto").onclick = async () => {
    const r = await api("announce/auto", { method: "POST", body: { enabled: $("#autoAnnounce").checked, intervalSec: $("#announceInterval").value } });
    toast(r.msg);
  };
  const ann = await api("announce");
  annState.list = ann.data.announcements;
  $("#autoAnnounce").checked = ann.data.auto.enabled;
  $("#announceInterval").value = ann.data.auto.intervalSec;
  renderAnn();
}

// ============ 6. 聊天记录（含玩家记录分区） ============
async function pageChat() {
  const [j, pl] = await Promise.all([api("chatlog"), apiQuiet("playerlog")]);
  const lines = j.data.lines;
  const players = pl?.data?.players || [];
  content.innerHTML = `
  <div class="cols">
    <div class="right" style="flex:2">
      <div class="card">
        <h3>聊天记录 ${lines.length ? "" : '<span class="hint">（暂无记录）</span>'}</h3>
        <div class="row" style="font-size:13px">
          ${[["Join","加入"],["Leave","离开"],["Death","死亡"],["Resurrect","复活"],["Announcement","公告"],["Say","公聊"],["Whisper","私聊"],["Host","房主"]]
            .map(([k, l]) => `<label><input type="checkbox" class="chatFilter" value="${k}" checked> ${l}</label>`).join("")}
          <button class="btn" id="doFilter">过滤</button>
          <button class="btn" id="reload">刷新</button>
          <button class="btn" id="histBtn">历史记录</button>
          <select id="histSel" style="display:none;max-width:280px"></select>
        </div>
        <div class="logbox" id="chatbox" style="max-height:520px"></div>
      </div>
    </div>
    <div class="left">
      <div class="card">
        <h3>发送公告</h3>
        <textarea id="chatSend" placeholder="以公告形式发送到游戏内"></textarea>
        <div class="btn-row"><button class="btn primary" id="sendChat">发送</button></div>
      </div>
      <div class="card">
        <h3>玩家记录 <span class="hint">共 ${players.length} 人</span></h3>
        <div class="listbox" id="plist" style="max-height:220px"></div>
      </div>
      <div class="card">
        <h3>玩家信息</h3>
        <div class="btn-row"><button class="btn" id="histBtn2">历史记录</button><select id="histSel2" style="display:none;max-width:280px"></select></div>
        <div class="logbox" id="plog" style="max-height:300px">（选择上方玩家查看其加入/离开/死亡/复活等记录）</div>
      </div>
    </div>
  </div>`;
  // ---- 聊天记录 ----
  const chatbox = $("#chatbox");
  const applyFilter = () => {
    const keep = $$(".chatFilter").filter((c) => c.checked).map((c) => c.value);
    const filtered = lines.filter((l) => keep.some((k) => l.includes(k)));
    renderLogLines(chatbox, filtered.join("\n") || "（过滤后无内容）", false);
    chatbox.scrollTop = chatbox.scrollHeight;
  };
  renderLogLines(chatbox, lines.join("\n") || "暂无记录");
  chatbox.scrollTop = chatbox.scrollHeight;
  $("#doFilter").onclick = applyFilter;
  $("#reload").onclick = pageChat;
  $("#histBtn").onclick = async () => {
    const sel = $("#histSel");
    if (sel.style.display !== "none") { sel.style.display = "none"; return; }
    const hj = await api("logs/list?type=chat");
    if (!hj.data.logs.length) return toast("暂无历史记录（每次开服自动归档）", true);
    sel.innerHTML = '<option value="">选择历史记录…</option>' + hj.data.logs.map((l) => `<option value="${esc(l.shard)}|${esc(l.file)}">${esc(l.shard)} ｜ ${esc(l.label)}</option>`).join("");
    sel.style.display = "";
  };
  $("#histSel").onchange = async () => {
    const v = $("#histSel").value;
    if (!v) return;
    const [shard, file] = v.split("|");
    const hj = await api(`logs/content?type=chat&shard=${encodeURIComponent(shard)}&file=${encodeURIComponent(file)}`);
    renderLogLines(chatbox, hj.data.lines.join("\n") || "（空）", false);
    chatbox.scrollTop = chatbox.scrollHeight;
    toast(`已加载历史记录 ${hj.data.file}，点「刷新」回到当前`);
  };
  $("#sendChat").onclick = async () => {
    const t = $("#chatSend").value.trim();
    if (!t) return toast("请输入内容", true);
    await execLua(`c_announce("${luaEsc(t)}")`);
    $("#chatSend").value = "";
  };
  // ---- 玩家记录 ----
  const box = $("#plist");
  box.innerHTML = players.length ? "" : '<div class="item">（暂无记录，服务器运行后自动生成）</div>';
  for (const p of players) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = p.id ? `${p.name} (${p.id})` : p.name;
    div.onclick = async () => {
      $$(".item", box).forEach((el) => el.classList.remove("sel"));
      div.classList.add("sel");
      $("#plog").textContent = "加载中…";
      const key = p.id || p.name;
      const dj = await api("playerlog/detail?key=" + encodeURIComponent(key));
      const plines = dj.data.lines;
      let extra = "";
      if (p.id && p.name && p.name !== "(未知)") {
        const dj2 = await api("playerlog/detail?key=" + encodeURIComponent(p.name));
        extra = dj2.data.lines.filter((l) => !plines.includes(l)).join("\n");
      }
      renderLogLines($("#plog"), (plines.join("\n") + (extra ? "\n" + extra : "")) || "（没有找到相关日志行）", false);
    };
    box.appendChild(div);
  }
  $("#histBtn2").onclick = async () => {
    const sel = $("#histSel2");
    if (sel.style.display !== "none") { sel.style.display = "none"; return; }
    const hj = await api("logs/list?type=server");
    if (!hj.data.logs.length) return toast("暂无历史记录（每次开服自动归档）", true);
    sel.innerHTML = '<option value="">选择历史日志…</option>' + hj.data.logs.map((l) => `<option value="${esc(l.shard)}|${esc(l.file)}">${esc(l.shard)} ｜ ${esc(l.label)}</option>`).join("");
    sel.style.display = "";
  };
  $("#histSel2").onchange = async () => {
    const v = $("#histSel2").value;
    if (!v) return;
    const [shard, file] = v.split("|");
    const hj = await api(`logs/content?type=server&shard=${encodeURIComponent(shard)}&file=${encodeURIComponent(file)}`);
    renderLogLines($("#plog"), hj.data.lines.join("\n") || "（空）", false);
    toast(`已加载历史日志 ${hj.data.file}`);
  };
}

// ============ 8. 一脸懵逼（帮助中心） ============
const helpState = { sub: "guide" };
async function pageHelp() {
  content.innerHTML = `
  <div class="help-hero">
    <div class="hh-inner">
      <h2>🤪 一脸懵逼？别慌，看这里</h2>
      <div class="hh-sub">这里是帮助中心：完整开服文档、面板各功能详细说明、常见问题。第一次用面板一脸懵逼是很正常的。</div>
    </div>
  </div>
  <div class="subtabs">
    <button data-h="guide" class="${helpState.sub === "guide" ? "active" : ""}">📖 开服文档</button>
    <button data-h="panel" class="${helpState.sub === "panel" ? "active" : ""}">🎛 面板功能</button>
    <button data-h="faq" class="${helpState.sub === "faq" ? "active" : ""}">❓ 常见问题</button>
  </div>
  <div id="helpBody"></div>`;
  $$(".subtabs button").forEach((b) => (b.onclick = () => { helpState.sub = b.dataset.h; pageHelp(); }));
  const body = $("#helpBody");
  body.innerHTML = helpState.sub === "guide" ? HELP_GUIDE : helpState.sub === "panel" ? HELP_PANEL : HELP_FAQ;
}

// ---- 章节一：完整开服文档 ----
const HELP_GUIDE = `
<div class="card help-doc">
  <h3>📖 饥荒联机版（DST）专用服务器：从零开服到日常运维</h3>
  <h4>一、环境与目录</h4>
  <table class="grid"><thead><tr><th>项目</th><th>路径 / 说明</th></tr></thead><tbody>
    <tr><td>运行用户</td><td><code>steam</code>（所有服务进程都应以 steam 身份运行，root 启动会被看门狗清理）</td></tr>
    <tr><td>DST 服务端</td><td><code>/home/steam/dst_server</code>（可执行文件在 <code>bin64/</code> 下）</td></tr>
    <tr><td>存档根目录</td><td><code>/home/steam/.klei/DoNotStarveTogether</code>，每个存档（cluster）一个文件夹</td></tr>
    <tr><td>模组统一目录</td><td><code>/home/steam/dst_mods/&lt;模组ID&gt;/</code>（全机共用一份，不按存档区分）</td></tr>
    <tr><td>面板目录</td><td><code>/home/steam/dst_panel</code>（Bun 单文件后端，systemd 服务 <code>dst-panel.service</code>）</td></tr>
    <tr><td>面板访问</td><td>浏览器打开 <code>http://&lt;服务器IP或域名&gt;/dst/</code>（nginx 反代到 127.0.0.1，面板本身不直接对外）</td></tr>
  </tbody></table>

  <h4>二、第一步：申请服务器令牌 Token（必须，不填无法开服）</h4>
  <p>Token 是服务器注册到 Klei 官方服务器列表的唯一凭证：</p>
  <ol>
    <li>在你本地电脑打开 Steam 版《饥荒联机版》，进入游戏首页点 <b>「账户」</b>（个人资料按钮）；</li>
    <li>浏览器会打开 Klei 账号页面，找到 <b>"Generate Server Token"</b>（生成服务器令牌）；</li>
    <li>复制生成的 token 字符串（形如 <code>pds-g^KU_xxxxx^...</code>）；</li>
    <li>粘贴到本面板「基本设置」页的 <b>服务器令牌(SK)</b> 输入框并保存（等价于写入存档目录下的 <code>cluster_token.txt</code>）。</li>
  </ol>
  <div class="doc-warn">⚠ Token 等同于服务器身份凭证，不要泄露给他人；泄露后请到 Klei 页面重新生成。</div>

  <h4>三、第二步：配置房间（cluster.ini）</h4>
  <p>在面板「基本设置」页可视化修改，保存后<b>重启服务器生效</b>。关键配置项：</p>
  <table class="grid"><thead><tr><th>配置项</th><th>说明</th></tr></thead><tbody>
    <tr><td><code>cluster_name</code></td><td>房间名，显示在游戏服务器列表中</td></tr>
    <tr><td><code>cluster_password</code></td><td>房间密码，留空 = 无密码</td></tr>
    <tr><td><code>game_mode</code></td><td>游戏模式：survival 生存 / relaxed 轻松 / endless 无尽 / wilderness 荒野 / lightsout 暗无天日</td></tr>
    <tr><td><code>max_players</code></td><td>最大玩家人数（1-64）</td></tr>
    <tr><td><code>pvp</code></td><td>是否开启 PVP</td></tr>
    <tr><td><code>pause_when_empty</code></td><td>无人在线时自动暂停世界（省资源，但作物/生物也停止）</td></tr>
    <tr><td><code>vote_kick_enabled</code></td><td>是否允许玩家投票踢人</td></tr>
  </tbody></table>

  <h4>四、第三步：端口放行（防火墙 + 云安全组）</h4>
  <table class="grid"><thead><tr><th>端口</th><th>协议</th><th>用途</th><th>对外开放</th></tr></thead><tbody>
    <tr><td>11000</td><td>TCP+UDP</td><td>地面世界（Master）游戏端口</td><td>✅</td></tr>
    <tr><td>11001</td><td>TCP+UDP</td><td>洞穴世界（Caves）游戏端口</td><td>✅</td></tr>
    <tr><td>27018 / 27019</td><td>UDP</td><td>Steam 主服务器端口</td><td>✅</td></tr>
    <tr><td>8768 / 8769</td><td>UDP</td><td>Steam 认证端口</td><td>✅</td></tr>
    <tr><td>10889</td><td>TCP</td><td>地面与洞穴分片内部通信</td><td>❌ 仅 127.0.0.1</td></tr>
  </tbody></table>
  <p>系统启用 UFW 防火墙时：</p>
  <div class="doc-pre">ufw allow 11000:11001/udp
ufw allow 11000:11001/tcp
ufw allow 27018:27019/udp
ufw allow 8768:8769/udp
ufw reload</div>
  <div class="doc-warn">☁ 云服务器用户：除系统防火墙外，还必须在云厂商控制台（阿里云/腾讯云/AWS）的<b>安全组 / 入站规则</b>中放行以上端口，TCP+UDP 都放最省心。面板本身只需要 80 端口（nginx）。</div>

  <h4>五、第四步：启动与验证</h4>
  <ol>
    <li>面板「服务器管理」页点 <b>▶ 启动服务器</b>（等价于执行 <code>~/start_dst.sh</code>，在 screen 会话中分别启动地面和洞穴）；</li>
    <li>查看地面控制台：<code>screen -r dst_master</code>，看到 <code>Online Server Started on port: 11000</code> 即注册成功；</li>
    <li>查看洞穴：<code>screen -r dst_caves</code>，看到 <code>secondary shard is now ready</code> 即就绪；</li>
    <li>退出 screen（不关服务器）：按 <code>Ctrl+A</code> 再按 <code>D</code>；</li>
    <li>游戏内 Play → Browse Games，搜索房间名加入。</li>
  </ol>

  <h4>六、日常运维</h4>
  <ul>
    <li><b>启动 / 停止 / 重启</b>：面板「服务器管理」页按钮，或命令行 <code>~/start_dst.sh</code>、<code>~/stop_dst.sh</code>；</li>
    <li><b>更新服务端</b>（游戏版本更新后）：<code>su - steam</code> 然后 <code>~/update_dst.sh</code>，更新完重启生效；</li>
    <li><b>备份存档</b>：</li>
  </ul>
  <div class="doc-pre">cp -r ~/.klei/DoNotStarveTogether/MyDediServer ~/dst_backup_$(date +%Y%m%d)</div>
  <ul>
    <li><b>回档</b>：不用手动拷文件，面板「控制台」页存档管理里按天数一键回档（每天一个快照，带日期）；</li>
    <li><b>查看面板状态</b>：<code>systemctl status dst-panel</code>；日志 <code>journalctl -u dst-panel -f</code>。</li>
  </ul>

  <h4>七、模组机制（两层缺一不可）</h4>
  <p>模组文件统一存放在全局目录 <code>/home/steam/dst_mods/&lt;ID&gt;/</code>（一模组一子文件夹，全机共用，只下载一次）；各存档分片通过符号链接使用。<b>启用与配置</b>才按存档区分，写在各存档 <code>Master/</code>、<code>Caves/</code> 的 <code>modoverrides.lua</code>。</p>
  <div class="doc-pre">第一层：模组文件存在   →  /home/steam/dst_mods/&lt;ID&gt;/        （下载）
第二层：存档中启用配置 →  &lt;存档&gt;/Master/modoverrides.lua
                        +  &lt;存档&gt;/Caves/modoverrides.lua</div>
  <table class="grid"><thead><tr><th>操作</th><th>面板入口</th><th>实际写入</th></tr></thead><tbody>
    <tr><td>添加模组（登记）</td><td>mod下载与更新 → 搜索 / 批量添加</td><td><code>dedicated_server_mods_setup.lua</code> 增加 <code>ServerModSetup("ID")</code></td></tr>
    <tr><td>下载模组</td><td>批量下载 / 更新全部</td><td>下载到全局目录（CDN 直链优先，失败回退 steamcmd，最多 3 个并行）</td></tr>
    <tr><td>启用模组</td><td>本地Mod → 勾选 → 保存所选</td><td>两个分片 <code>modoverrides.lua</code> 写入 <code>["workshop-ID"] enabled=true</code></td></tr>
    <tr><td>配置模组</td><td>本地Mod → 点模组行 → 右侧配置项</td><td>两个分片 <code>modoverrides.lua</code> 的 <code>configuration_options</code></td></tr>
    <tr><td>删除模组</td><td>模组详情 → 取消订阅</td><td>删除本地文件 + setup 清单 + 两个分片配置</td></tr>
  </tbody></table>
  <div class="doc-tip">💡 所有模组改动都需<b>重启服务器</b>后生效。红色行 = 已启用但未下载，点「下载缺失模组」一键补齐。</div>

  <h4>八、大型地图模组（海难 / 哈姆雷特 / 三合一）</h4>
  <p>这类模组会<b>替换整个世界的生成规则</b>。面板「编辑世界」页会自动检测并显示「模组世界设置」卡片：</p>
  <ul>
    <li><b>世界类型</b>（worldgen_preset）：海难替换主世界、火山替换洞穴，与原版世界互斥，一键切换；</li>
    <li><b>模式难度</b>（settings_preset）：生存/轻松/无尽/荒野/暗无天日，与世界类型互不干扰；</li>
    <li><b>模组设置项</b>：从模组脚本解析出的专属世界选项（虎鲨、海妖、剑鱼等），操作方式与原版一致；</li>
    <li>启用地图类模组并「保存所选」时，面板会<b>自动应用对应世界预设</b>（不覆盖你已有的手动选择）；</li>
    <li>切换世界类型需<b>重新生成世界</b>才完整体现（控制台 → 重新生成世界）。</li>
  </ul>
  <table class="grid"><thead><tr><th>模组</th><th>ID</th><th>类型</th></tr></thead><tbody>
    <tr><td>海难联机 Shipwrecked Together</td><td>1965741394</td><td>地图（预设替换世界）</td></tr>
    <tr><td>岛屿冒险 Island Adventures</td><td>1467214795</td><td>地图（预设替换世界）</td></tr>
    <tr><td>云霄国度（猪镇联机 / 哈姆雷特）</td><td>3322803908</td><td>地图（预设替换世界）</td></tr>
    <tr><td>热带体验（海难哈姆雷特生态 / 三合一）</td><td>1505270912</td><td>生态叠加（不替换世界，用 mod设置 页配置）</td></tr>
    <tr><td>忒修斯之船（轻量版三合一）</td><td>2986194136</td><td>生态叠加（同上）</td></tr>
  </tbody></table>

  <h4>九、身份看门狗（dst-steam-guard）</h4>
  <p>为防止面板/服务端被 root 身份误启动（会造成文件属主混乱、EACCES 报错），系统装有看门狗：每 60 秒杀掉<b>非 steam 用户</b>运行的面板 / DST 服务端 / screen 进程，并把相关目录下 root 属主的文件改回 steam。可在「基本设置」页开关。</p>
</div>`;

// ---- 章节二：面板各功能详细说明 ----
const HELP_PANEL = `
<div class="card help-doc">
  <h3>🎛 面板各功能详细说明</h3>
  <h4>基本设置</h4>
  <ul>
    <li><b>路径</b>：存档根目录 / 模组存放目录 / 服务器目录，改动后按提示重启生效；</li>
    <li><b>存档列表</b>：一台服务器可建多个存档（cluster），点「选择」切换当前控制的存档，支持新建 / 重命名 / 删除（删除不可恢复）；</li>
    <li><b>当前存档设置</b>：房间名、描述、密码、游戏模式、人数、PVP、投票、无人暂停、服务器令牌（可显示/复制）、内测分支、身份看门狗开关。保存后重启服务器生效。</li>
  </ul>
  <h4>编辑世界</h4>
  <ul>
    <li>左侧世界列表可添加 / 删除地上（Master）、地下（Caves）世界，圆点表示运行状态；</li>
    <li>右侧设置项表格：点行选中 → 下方选新值 → 点「保存」。支持按名称/key 过滤和分组筛选，<b>每设置完一个世界都要点一次保存</b>；</li>
    <li>启用大型地图模组时，原版设置项自动隐藏，改由「模组世界设置」卡片提供世界类型 / 模式难度 / 模组设置项；</li>
    <li>左侧存档管理：保存进度、回档一天、按天数快照回档（每项带存档日期）。</li>
  </ul>
  <h4>mod设置</h4>
  <ul>
    <li><b>本地Mod</b>：勾选 = 启用，点「保存所选」写入两个分片；红色行 = 已启用但未下载；点模组行看右侧详情（大图、标签徽章、折叠描述、配置项表格，改完点「保存修改」）；</li>
    <li><b>mod下载与更新</b>：按名称搜索创意工坊（结果带星级 ★ 与最近更新日期，点卡片看简介/更新历史），按 ID 批量添加/下载，下载任务最多 3 个并行、实时进度条、可查看日志；</li>
    <li>「添加」只登记（重启服务器时自动下载），「下载」立即下载到本地。</li>
  </ul>
  <h4>服务器管理</h4>
  <ul>
    <li><b>▶ 启动 / ⏹ 关闭 / 🔁 重启</b>：控制所有分片；</li>
    <li><b>⏸ 暂停 / ▶ 继续服务器</b>：状态感知单按钮，冻结/恢复世界时间（玩家不被踢出）；</li>
    <li><b>自动重启</b>：滑动开关，每 30 秒检查分片，掉线自动拉起；</li>
    <li><b>在线 / 离线模式</b>：离线模式只能局域网联机，切换后需重启；</li>
    <li><b>管理员列表 / 黑名单</b>：表格展示 KU_id + 玩家名（自动从日志识别），按 KU_id 添加、勾选删除；</li>
    <li><b>服务器日志</b>：两个分片日志合并实时刷新（2 秒），可暂停。</li>
  </ul>
  <h4>控制台</h4>
  <ul>
    <li><b>玩家操作</b>：选中在线玩家后可设管理员、全物品制造、封禁、杀死、重选人物、掉落所有物品、战备（长矛+木甲+头盔+火腿棒+治疗膏药）、解锁科一/科二/魔一/魔二/远古；</li>
    <li><b>给予物品</b>：支持中文名 / prefab 搜索与分类过滤（物品列表分批加载，滚动到底自动追加），可给选中玩家 / 所有玩家 / 放到玩家脚下，最近使用的物品会显示在上方；</li>
    <li><b>坐标传送</b>：集体活动（水球大战/蜻蜓猎场/开会）把所有人传到指定坐标或选中玩家位置，也可单独转移某个玩家；</li>
    <li><b>存档管理</b>：上半为房间状态（天数/季节/阶段/下雨），下半为按天数的回档快照（带存档日期），另有保存进度、重新生成世界（慎用！）；</li>
    <li><b>全局操作</b>：杀死/复活玩家、下雨开关、跳过阶段、跳过当天、设置季节、跳过 X 天；</li>
    <li><b>公告</b>：立即发送或加入轮播列表，可开启自动公告（按间隔轮播）。</li>
  </ul>
  <h4>聊天记录（含玩家记录）</h4>
  <ul>
    <li>左侧聊天记录：按类型（加入/离开/死亡/复活/公告/公聊/私聊/房主）过滤，支持历史记录归档查看，可直接发送公告到游戏内；</li>
    <li>右侧玩家记录：所有来过服务器的玩家列表（自动从日志识别 KU_id 与名字），点玩家查看其相关日志行，「历史记录」可查看历次开服归档的服务器日志。</li>
  </ul>
  <h4>皮肤设置（顶栏 🎨）</h4>
  <ul>
    <li>三套主题：暗夜琥珀（默认深色）/ 白昼纸张（白底深色字）/ 科技蓝（深色+青色辉光），点击立即生效、刷新保持；</li>
    <li>登录页背景图可换：英雄横幅 / 经典头图 / 胶囊海报 / 无图纯色，同样即时保存。</li>
  </ul>
</div>`;

// ---- 章节三：常见问题 ----
const HELP_FAQ = (() => {
  const faqs = [
    ["这个面板是干嘛的？", `这是饥荒联机版（DST）专用服务器的网页管理面板。你可以在浏览器里完成：改房间设置、编辑世界、装模组、开/关服务器、进控制台发命令、看玩家和聊天记录——不用每次都 SSH 上服务器敲命令。`],
    ["怎么开服 / 关服？", `到「服务器管理」页点 <code>▶ 启动服务器</code> / <code>⏹ 关闭服务器</code>。服务器通过 screen 会话运行（地面 dst_master、洞穴 dst_caves）。启动后也可以在服务器上用 <code>screen -r dst_master</code> 查看控制台，按 Ctrl+A 再按 D 退出。`],
    ["改了基本设置没生效？", `cluster.ini 的修改（房间名、密码、人数等）需要<b>重启服务器</b>后才会生效。保存成功后会提示"已保存，重启服务器后生效"。`],
    ["模组不生效？按这个顺序排查", `1) 模组要<b>勾选</b>并点「保存所选」；2) 检查 <code>mods/dedicated_server_mods_setup.lua</code> 里有 <code>ServerModSetup("ID")</code>；3) 检查 Master 和 Caves 下的 <code>modoverrides.lua</code> 里有对应 <code>["workshop-ID"] enabled=true</code>；4) 模组文件要存在于全局目录 <code>dst_mods/ID/</code>（用「立即下载」或重启服务器自动下载）；5) 改完模组配置需要重启服务器。`],
    ["搜不到自己的服务器？", `1) 确认 <code>cluster_token.txt</code> 填了有效的 Klei 令牌（在游戏内 Klei 账号页面生成）；2) 确认防火墙/云安全组放行了 11000-11001 (TCP+UDP)、27018-27019 (UDP)、8768-8769 (UDP)；3) 地面控制台出现 <code>Online Server Started on port: 11000</code> 才算注册成功；4) 实在不通可以试「离线模式」（但只能局域网联机）。`],
    ["玩家进不来 / 被踢？", `检查是否设置了房间密码；检查黑名单 <code>blocklist.txt</code>；玩家人数是否满员（基本设置里调 max_players）。`],
    ["控制台的命令没反应？", `控制台命令通过 screen 发送到<b>地面世界（Master）</b>。先确认服务器在运行（服务器管理页看状态），刚启动的服务器要等出现 "Sim paused" 之后控制台才可用。「刷新玩家列表」大概需要 2 秒。`],
    ["「暂停服务器」和「无人自动暂停」有什么区别？", `「暂停服务器」是手动按钮，立即冻结世界时间（昼夜/作物/生物停止），玩家仍在游戏内，再点一次恢复；「无人自动暂停」是 cluster.ini 设置（pause_when_empty），只在服务器没有任何玩家在线时自动暂停。`],
    ["「重选人物」「战备」这些是什么？", `都是向服务器发送 Lua 控制台命令：重选人物 = c_despawn（玩家回到选人界面）；战备 = 给玩家一套长矛+木甲+头盔+火腿棒+3个治疗膏药；解锁科一/科二/魔一/魔二/远古 = 直接修改玩家的科技等级（用 pcall 容错，不同游戏版本字段可能略有差异）。`],
    ["回档 / 重新生成世界是什么区别？", `回档 = c_rollback，回到之前某天的快照存档（控制台的存档列表按天数+日期选择）；重新生成世界 = c_regenerateworld()，<b>清空当前世界重新生成地图</b>，不可恢复，慎用！`],
    ["自动重启和自动公告", `自动重启：面板每 30 秒检查一次 screen 会话，发现分片掉了就按当前在线/离线模式拉起来。自动公告：按设定间隔把公告列表轮播发送到游戏内（c_announce）。两者配置都存在面板的 panel_config.json 里。`],
    ["模组下载失败？", `「立即下载」走 CDN 直链优先、steamcmd 匿名登录兜底（app 322330）。常见失败原因：外网不通、steamcmd 需要更新、该模组设置了下载权限。失败时点任务卡片看尾部日志。也可以重启服务器让 DST 自己按 dedicated_server_mods_setup.lua 下载。`],
    ["mods 目录下的 workshop- 文件夹消失了？", `新版服务端（UGC 系统）启动时会把 <code>mods/workshop-ID/</code> 迁移到 ugc_mods 目录，本面板已把它们统一链接到全局目录 <code>/home/steam/dst_mods/</code>。<b>这是正常迁移，不是丢失。</b>`],
    ["端口清单（防火墙/安全组要放行）", `11000 TCP+UDP 地面世界；11001 TCP+UDP 洞穴世界；27018/27019 UDP Steam 主服务器；8768/8769 UDP Steam 认证；10889 TCP 分片内部通信（仅 127.0.0.1，不用对外开放）。面板本身只监听 127.0.0.1:5323，通过 nginx 的 /dst/ 前缀访问。`],
  ];
  return faqs.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><div class="faq-body">${a}</div></details>`).join("");
})();

// ============ 启动 ============
renderTabs();
startTopFx();
// 后台预加载物品数据，不阻塞界面切换
apiQuiet("items").then((j) => { if (j) consoleState.items = j.data; });
route();
