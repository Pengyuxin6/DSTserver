// 饥荒服务器管理面板 前端 SPA（纯 vanilla JS，全部相对路径）
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const content = $("#content");


// 设置项图标：<img> 带备选链（srcs 依次尝试，全部失败则隐藏）
function optIcon(srcs) {
  const list = srcs.filter(Boolean);
  if (!list.length) return "";
  return `<img class="opt-icon" src="${list[0]}" data-fb="${list.slice(1).join(",")}" loading="lazy" onerror="optIconErr(this)">`;
}
function optIconErr(img) {
  const rest = (img.dataset.fb || "").split(",").filter(Boolean);
  if (rest.length) {
    img.src = rest[0];
    img.dataset.fb = rest.slice(1).join(",");
  } else {
    img.onerror = null;
    img.outerHTML = '<span class="opt-icon opt-icon-empty"></span>';
  }
}
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
    <div class="row"><label>语言</label>${sel("lang", [["simplified","简体中文"],["traditional","繁體中文"],["auto","跟随Steam客户端语言"]], d.lang || "simplified")} <span class="hint">中文语言包的语言（重启服务器生效）</span></div>
    <div class="row"><label>游戏模式</label>${sel("game_mode", [["survival","生存模式"],["relaxed","轻松"],["endless","无尽"],["wilderness","荒野"],["lightsout","暗无天日"]], ini.game_mode)}</div>
    <div class="row"><label>房间名</label><input type="text" id="cluster_name" value="${esc(ini.cluster_name)}" size="40"></div>
    <div class="row"><label>房间描述</label><input type="text" id="cluster_description" value="${esc(ini.cluster_description)}" size="60"></div>
    <div class="row"><label>房间密码</label><input type="text" id="cluster_password" size="30" placeholder="${d.has_cluster_password ? "已设置（不修改请留空）" : "未设置"}" autocomplete="off"> <span class="hint">留空保持不变</span><button class="btn" id="clearRoomPwd" ${d.has_cluster_password ? "" : "disabled"}>清除</button></div>
    <div class="row"><label>服务器令牌(SK)</label><input type="password" id="cluster_token" size="60" style="font-family:monospace" placeholder="${d.has_token ? "已设置（不修改请留空）" : "未设置（在线模式必须）"}" autocomplete="off"> <button class="btn" id="copyToken" type="button">复制</button> <button class="btn" id="clearToken" ${d.has_token ? "" : "disabled"}>清除</button></div>
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
      lang: $("#lang").value,
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
  // 令牌复制
  $("#copyToken").onclick = async () => {
    const inp = $("#cluster_token");
    const val = inp.value.trim();
    if (!val) return toast("令牌为空，无可复制", true);
    try { await navigator.clipboard.writeText(val); toast("已复制到剪贴板"); }
    catch { inp.select(); document.execCommand("copy"); toast("已复制"); }
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

// 世界设置项弹窗：点击设置项行弹出，展示图标、名称、可选值列表
function showWorldOptionPopup(option, currentVal, iconSrcs, onSelect) {
  const overlay = document.createElement("div");
  overlay.className = "mod-detail-overlay";
  const labelOf = (v) => (option.values.find((x) => x.v === v) || {}).label || v;
  const curLabel = labelOf(currentVal);
  // radio 列表（≤8 个）或 select（>8 个）
  const useRadio = option.values.length <= 8;
  const valList = useRadio
    ? option.values.map((v) => {
        const checked = v.v === currentVal ? "checked" : "";
        return `<label class="opt-radio-row"><input type="radio" name="optValRadio" value="${esc(v.v)}" ${checked}> ${esc(v.label)} <span class="hint">(${esc(v.v)})</span></label>`;
      }).join("")
    : null;
  overlay.innerHTML = `<div class="mod-detail-popup" style="max-width:520px">
    <button class="popup-close" id="optPopupX">×</button>
    <div class="md-head" style="align-items:center">
      ${iconSrcs && iconSrcs.length ? `<div style="width:64px;height:64px;flex-shrink:0;display:flex;align-items:center;justify-content:center">${optIcon(iconSrcs)}</div>` : ""}
      <div class="md-head-main">
        <div class="md-title">${esc(option.label)}</div>
        <div class="md-sub">分组: ${esc(option.group || "-")} ｜ key: <code>${esc(option.key)}</code></div>
        <div class="md-sub">当前值: <b>${esc(curLabel)}</b> <span class="hint">(${esc(currentVal)})</span></div>
      </div>
    </div>
    <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:10px">
      <h3 style="margin:0 0 8px">选择新值</h3>
      ${useRadio
        ? `<div id="optRadioList" style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto">${valList}</div>`
        : `<div class="row"><select id="optSelect" style="min-width:240px">${option.values.map((v) => `<option value="${esc(v.v)}" ${v.v === currentVal ? "selected" : ""}>${esc(v.label)} (${esc(v.v)})</option>`).join("")}</select></div>`}
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn" id="optPopupCancel">取消</button>
      <button class="btn primary" id="optPopupSave">保存</button>
    </div>
  </div>`;
  // 修正图标：把 optIcon 结果用大尺寸样式展示
  const iconBox = overlay.querySelector(".md-head > div:first-child");
  if (iconBox) {
    const img = iconBox.querySelector("img");
    if (img) { img.style.width = "64px"; img.style.height = "64px"; img.style.objectFit = "contain"; }
    iconBox.style.display = "flex";
    iconBox.style.alignItems = "center";
    iconBox.style.justifyContent = "center";
  }
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  const getSelected = () => {
    if (useRadio) {
      const r = overlay.querySelector('input[name="optValRadio"]:checked');
      return r ? r.value : currentVal;
    }
    return $("#optSelect", overlay).value;
  };
  $("#optPopupCancel", overlay).onclick = () => overlay.remove();
  $("#optPopupX", overlay).onclick = () => overlay.remove();
  $("#optPopupSave", overlay).onclick = () => {
    const val = getSelected();
    if (val !== currentVal) onSelect(val);
    overlay.remove();
  };
}

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
        <div style="max-height:560px;overflow-y:auto"><table class="grid" id="optTable">
          <thead><tr><th>设置项</th><th>设定值</th><th>分组</th></tr></thead><tbody></tbody>
        </table></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="saveOv">保存世界设置</button></div>
        <div class="hint">点击设置项查看详情并修改。每设置完一个世界后，点击保存。</div>
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
  const saveRow = $("#saveOv")?.closest(".btn-row");
  if (filterRow) filterRow.style.display = isModWorld ? "none" : "";
  if (tableWrap) tableWrap.style.display = isModWorld ? "none" : "";
  if (saveRow) saveRow.style.display = isModWorld ? "none" : "";
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
    const ico = optIcon([`icons/worldsettings_customization/${o.key}.png`, `icons/worldgen_customization/${o.key}.png`]);
    tr.innerHTML = `<td>${ico}${esc(o.label)}</td><td>${esc(labelOf(cur))} <span class="hint">(${esc(cur)})</span></td><td>${esc(o.group)}</td>`;
    if (worldState.selKey === o.key) tr.className = "sel";
    tr.onclick = () => {
      worldState.selKey = o.key;
      $$("tr", tbody).forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      const curVal = worldState.overrides[o.key] || "default";
      showWorldOptionPopup(o, curVal, [`icons/worldsettings_customization/${o.key}.png`, `icons/worldgen_customization/${o.key}.png`], (val) => {
        worldState.overrides[o.key] = val;
        loadWorldOverridesKeepSel();
      });
    };
    tbody.appendChild(tr);
  });
  if (!tbody.children.length) tbody.innerHTML = '<tr class="disabled"><td colspan="3">（无匹配的设置项）</td></tr>';
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
    <div style="max-height:520px;overflow-y:auto"><table class="grid"><thead><tr><th>设置项</th><th>设定值</th><th>分组</th></tr></thead><tbody id="mwTbody_${mi}"></tbody></table></div>
    <div class="btn-row" style="margin-top:8px"><button class="btn primary" id="saveModOv">保存模组世界设置</button>
    <span class="hint">点击设置项查看详情并修改</span></div>` : ""}
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
      const ico = o.img && o.atlas ? optIcon([`icons/${o.atlas}/${o.img.replace(/\.tex$/, ".png")}`]) : "";
      tr.innerHTML = `<td>${ico}${esc(o.label)}</td><td>${esc(labelOf(cur))} <span class="hint">(${esc(cur)})</span></td><td>${esc(o.group)}${o.world ? ` <span class="hint">${esc(o.world)}</span>` : ""}</td>`;
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
    // 行点击 → 弹窗（事件委托，兼容过滤重渲染）
    const tbody = $(`#mwTbody_${mi}`);
    if (tbody) tbody.onclick = (e) => {
      const tr = e.target.closest("tr[data-key]");
      if (!tr) return;
      $$("tr", tbody).forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      const o = worldState.mwMods[mi].options.find((x) => x.key === tr.dataset.key);
      if (!o) return;
      const curVal = worldState.overrides[o.key] || o.default || "default";
      const iconSrcs = o.img && o.atlas ? [`icons/${o.atlas}/${o.img.replace(/\.tex$/, ".png")}`] : [];
      showWorldOptionPopup(o, curVal, iconSrcs, (val) => {
        worldState.overrides[o.key] = val;
        loadWorldOverrides();
      });
    };
  });
  mods.forEach((m, mi) => {
    const svb = box.querySelector("#saveModOv");
    if (svb) svb.onclick = async () => {
      if (!worldState.shard) return toast("请先选择世界", true);
      const r = await api("world/overrides", { method: "POST", body: { shard: worldState.shard, overrides: worldState.overrides } });
      toast(r.msg);
    };
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
      <button class="btn" id="dlMissing">下载全部缺失</button>
      <button class="btn" id="fetchLuaAll">补全缺失信息</button>
      <button class="btn" id="refresh">刷新</button>
      <input type="text" id="modSearch" placeholder="搜索本地模组（名称/ID）" style="width:220px" value="${esc(modsState.search || "")}">
      <span class="hint">★收藏置顶 ｜ 勾选=启用 ｜ 红色行=已启用未下载</span>
    </div>
    <div style="overflow-x:auto"><table class="grid" id="modTable">
      <thead><tr><th>★</th><th></th><th>ID</th><th>预览</th><th>名称</th><th>更新日期</th><th>标签</th><th>状态</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>`;
  const renderRows = () => {
    const ft = (modsState.search || "").trim().toLowerCase();
    const list = modsState.mods.filter((m) => !ft || (m.title || "").toLowerCase().includes(ft) || (m.name || "").toLowerCase().includes(ft) || m.id.includes(ft));
    const tbody = $("#modTable tbody");
    tbody.innerHTML = "";
    if (!list.length) { tbody.innerHTML = '<tr class="disabled"><td colspan="8">（无匹配模组）</td></tr>'; return; }
    for (const m of list) {
      const tr = document.createElement("tr");
      tr.className = [modsState.selId === m.id ? "sel" : "", m.enabled && !m.downloaded ? "need-dl" : ""].join(" ").trim();
      const tags = [
        m.clientOnly ? '<span class="tag warn">仅客户端</span>' : "",
        m.allClientsRequire ? '<span class="tag on">全员需要</span>' : "",
        m.error ? '<span class="tag err">异常</span>' : "",
        m.updateAvailable ? '<span class="tag warn">可更新</span>' : "",
      ].join("");
      tr.innerHTML = `
        <td><button class="fav-star${m.favorite ? " on" : ""}" data-fav="${m.id}" title="${m.favorite ? "取消收藏" : "收藏（置顶）"}">${m.favorite ? "★" : "☆"}</button></td>
        <td><input type="checkbox" data-id="${m.id}" ${modsState.checked.has(m.id) ? "checked" : ""}></td>
        <td>${esc(m.id)}</td>
        <td>${m.preview_url ? `<img class="mod-img" loading="lazy" src="${esc(m.preview_url)}" onerror="this.outerHTML='<div class=mod-img></div>'">` : '<div class="mod-img"></div>'}</td>
        <td>${esc(m.title || m.name || "(未知)")}${m.name && m.title && m.name !== m.title ? `<div class="hint">${esc(m.name)}</div>` : ""}</td>
        <td>${esc(m.update_date || m.version || "-")}</td>
        <td>${tags}</td>
        <td>${m.downloaded ? '<span class="tag on">已下载</span>' : '<span class="tag">未下载</span>'}${m.enabled ? ' <span class="tag on">已启用</span>' : ""}</td>`;
      tr.onclick = (e) => {
        if (e.target.type === "checkbox" || e.target.closest(".fav-star")) return;
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
    $$(".fav-star", tbody).forEach((b) => (b.onclick = async () => {
      const nowFav = !b.classList.contains("on");
      const r = await api("mods/favorite", { method: "POST", body: { id: b.dataset.fav, fav: nowFav } });
      toast(r.msg);
      const m = modsState.mods.find((x) => x.id === b.dataset.fav);
      if (m) m.favorite = nowFav;
      modsState.mods.sort((a, z) => Number(z.favorite) - Number(a.favorite) || a.id.localeCompare(z.id));
      renderRows();
    }));
  };
  renderRows();
  $("#modSearch").oninput = (e) => { modsState.search = e.target.value; renderRows(); };
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
    // 下载全部缺失：已启用或已加入下载清单但未下载的模组
    const missing = modsState.mods.filter((m) => !m.downloaded && (m.enabled || m.inSetup)).map((m) => m.id);
    if (!missing.length) return toast("没有缺失的模组，全部已下载");
    const r = await api("mods/download", { method: "POST", body: { ids: missing } });
    toast(r.msg);
    modsState.sub = "download";
    pageMods();
  };
  $("#fetchLuaAll").onclick = async () => {
    // 补全缺失 modinfo.lua 的模组：已下载到本地但 modinfo 缺失/解析失败
    const need = modsState.mods.filter((m) => m.downloaded && (m.error || !m.hasConfig)).map((m) => m.id);
    if (!need.length) return toast("没有需要补全信息的模组");
    toast(`正在补全 ${need.length} 个模组的信息…`);
    let ok = 0;
    for (const id of need) {
      const r = await apiQuiet("mods/fetch-modinfo", { method: "POST", body: { id } });
      if (r?.data?.success) ok++;
    }
    toast(`补全完成：${ok}/${need.length} 个成功`);
    renderModsLocal();
  };
}

// 模组配置项弹窗（带说明文字）
function showModConfigPopup(option, currentVal, hover, enLabel, iconSrcs, onSelect) {
  const overlay = document.createElement("div");
  overlay.className = "mod-detail-overlay";
  const useRadio = option.values.length <= 8;
  const valList = useRadio
    ? option.values.map((v) => {
        const checked = v.v === currentVal ? "checked" : "";
        return `<label class="opt-radio-row"><input type="radio" name="modOptRadio" value="${esc(v.v)}" ${checked}> ${esc(v.label)} <span class="hint">(${esc(v.v)})</span></label>`;
      }).join("")
    : null;
  overlay.innerHTML = `<div class="mod-detail-popup" style="max-width:520px">
    <button class="popup-close" id="mcPopupX">×</button>
    <div class="md-head" style="align-items:center">
      ${iconSrcs && iconSrcs.length ? `<div style="width:48px;height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:center"><img src="${esc(iconSrcs[0])}" style="width:48px;height:48px;object-fit:contain;border-radius:6px;border:1px solid var(--border)" onerror="this.style.display='none'"></div>` : ""}
      <div class="md-head-main">
        <div class="md-title">${esc(option.label)}</div>
        ${enLabel ? `<div class="md-sub">${esc(enLabel)}</div>` : ""}
        <div class="md-sub">key: <code>${esc(option.key)}</code> ｜ 当前值: <b>${esc(currentVal)}</b></div>
      </div>
    </div>
    ${hover ? `<div style="margin:8px 0;padding:8px 12px;background:var(--hover-bg);border-radius:6px;font-size:13px;line-height:1.6;max-height:100px;overflow-y:auto">${esc(hover)}</div>` : ""}
    <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:10px">
      <h3 style="margin:0 0 8px">选择新值</h3>
      ${useRadio
        ? `<div style="display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto">${valList}</div>`
        : `<div class="row"><select id="mcOptSelect" style="min-width:240px">${option.values.map((v) => `<option value="${esc(v.v)}" ${v.v === currentVal ? "selected" : ""}>${esc(v.label)} (${esc(v.v)})</option>`).join("")}</select></div>`}
    </div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn" id="mcPopupCancel">取消</button>
      <button class="btn primary" id="mcPopupSave">保存</button>
    </div>
  </div>`;
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.body.appendChild(overlay);
  const getSelected = () => {
    if (useRadio) {
      const r = overlay.querySelector('input[name="modOptRadio"]:checked');
      return r ? r.value : currentVal;
    }
    return $("#mcOptSelect", overlay).value;
  };
  $("#mcPopupCancel", overlay).onclick = () => overlay.remove();
  $("#mcPopupX", overlay).onclick = () => overlay.remove();
  $("#mcPopupSave", overlay).onclick = () => {
    const val = getSelected();
    if (val !== currentVal) onSelect(val);
    overlay.remove();
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
  const inst = d.installed || {};
  const mObj = modsState.mods.find((m) => m.id === id);
  const m_downloaded = mObj?.downloaded || inst.downloaded;
  const m_inSetup = mObj?.inSetup;
  const stripTags = (s) => String(s || "").replace(/\[(\/?)(color|size|b|i|u|url|img)[^\]]*\]/gi, "").replace(/<[^>]+>/g, "");
  const fmt = (v) => (typeof v === "object" ? JSON.stringify(v) : String(v));
  const badges = [
    m_downloaded ? '<span class="tag on">已下载</span>' : '<span class="tag">未下载</span>',
    d.enabled ? '<span class="tag on">已启用</span>' : '<span class="tag">未启用</span>',
    mi.clientOnly ? '<span class="tag warn">仅客户端</span>' : "",
    mi.allClientsRequire ? '<span class="tag on">全员需要</span>' : "",
    ...(mObj?.tags || []).slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`),
  ].join("");

  // ---------- 安装详情 Tab 内容 ----------
  const anomaliesHtml = (inst.anomalies && inst.anomalies.length)
    ? inst.anomalies.map((a) => `<div style="color:var(--red);padding:2px 0">⚠ ${esc(a)}</div>`).join("")
    : '<div style="color:var(--green)">✓ 未检测到异常</div>';
  const localFilesHtml = inst.localFiles
    ? Object.entries(inst.localFiles).map(([f, exists]) =>
        `<tr><td><code>${esc(f)}</code></td><td>${exists ? '<span class="tag on">存在</span>' : '<span class="tag">缺失</span>'}</td></tr>`
      ).join("")
    : '<tr><td colspan="2" class="hint">（模组目录不存在）</td></tr>';
  const installDetailHtml = `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin-bottom:12px">
      <span class="hint">下载状态</span><span>${inst.downloaded ? '<span class="tag on">已下载</span>' : '<span class="tag">未下载</span>'}</span>
      <span class="hint">本地版本</span><span>${esc(inst.localVersion || "-")}</span>
      <span class="hint">下载时间</span><span>${esc(inst.downloadedAt || "-")}</span>
      <span class="hint">是否可更新</span><span>${inst.updateAvailable ? '<span class="tag warn">有新版本</span>' : '<span class="tag on">最新</span>'}</span>
      <span class="hint">DST 兼容</span><span>${mi.dstCompatible === false ? '<span class="tag err">不兼容</span>' : mi.dstCompatible === true ? '<span class="tag on">兼容</span>' : '<span class="hint">未知</span>'}</span>
      <span class="hint">仅客户端</span><span>${mi.clientOnly ? "是" : "否"}</span>
      <span class="hint">全员需要</span><span>${mi.allClientsRequire ? "是" : "否"}</span>
    </div>
    <h4 style="margin:12px 0 6px">本地文件检测</h4>
    <table class="grid" style="max-width:400px"><thead><tr><th>文件</th><th>状态</th></tr></thead><tbody>${localFilesHtml}</tbody></table>
    <h4 style="margin:12px 0 6px">异常检测</h4>
    <div style="background:var(--hover-bg);border-radius:6px;padding:8px 12px">${anomaliesHtml}</div>
    ${inst.modinfoAutoFetched ? '<div class="hint" style="margin-top:8px">（modinfo.lua 由面板自动补全下载）</div>' : ""}
    ${d.changelogs && d.changelogs.length ? `
    <h4 style="margin:12px 0 6px">更新历史</h4>
    <div style="max-height:180px;overflow-y:auto">
      ${d.changelogs.map((c) => `<div style="padding:4px 0;border-bottom:1px solid var(--border)"><span class="c-accent">${esc(c.date)}</span><div class="hint" style="white-space:pre-wrap">${esc(c.text).slice(0, 500)}</div></div>`).join("")}
    </div>` : ""}
  `;

  // ---------- 配置参数 Tab 内容 ----------
  // 配置项排序：有中文翻译的优先，其次按名称
  const sortedOptions = [...d.options].sort((a, b) => {
    const aZh = (a.label_zh && a.label_zh !== (a.label || a.name)) ? 0 : 1;
    const bZh = (b.label_zh && b.label_zh !== (b.label || b.name)) ? 0 : 1;
    if (aZh !== bZh) return aZh - bZh;
    return (a.label_zh || a.label || a.name).localeCompare(b.label_zh || b.label || b.name, "zh");
  });
  const configHtml = sortedOptions.length ? `
    <div class="hint" style="margin-bottom:8px">点击设置项弹出详情修改弹窗。带中文翻译的配置项已置顶。</div>
    <div style="max-height:500px;overflow-y:auto"><table class="grid" id="optT"><thead><tr><th>设置项</th><th>当前值</th><th>默认值</th></tr></thead><tbody></tbody></table></div>
    <div class="btn-row" style="margin-top:10px"><button class="btn primary" id="saveCfg">保存修改</button></div>` : `<div class="hint">该模组没有可配置项${inst.modinfoAutoFetched ? "" : "（或 modinfo.lua 尚未下载到本地，可尝试点击下方「补全信息」）"}</div>`;

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
    <div class="btn-row" style="margin:8px 0">
      ${!mi || inst.modinfoAutoFetched ? '<button class="btn" id="fetchLua">补全信息（下载 modinfo.lua）</button>' : ""}
      <button class="btn" id="dlMod">下载完整模组</button>
      ${m_downloaded || m_inSetup ? '<button class="btn danger" id="delMod">取消订阅</button>' : ""}
    </div>
    <div class="subtabs" style="margin-top:8px">
      <button data-tab="config" class="active">配置参数</button>
      <button data-tab="install">安装详情</button>
    </div>
    <div id="tabConfig">${configHtml}</div>
    <div id="tabInstall" style="display:none">${installDetailHtml}</div>
    <div class="btn-row" style="margin-top:12px"><button class="btn" id="closePopup">关闭</button></div>`;

  // ---------- Tab 切换 ----------
  const switchTab = (tab) => {
    $$(".subtabs button", popup).forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("#tabConfig", popup).style.display = tab === "config" ? "" : "none";
    $("#tabInstall", popup).style.display = tab === "install" ? "" : "none";
  };
  $$(".subtabs button", popup).forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

  $("#closePopup").onclick = () => overlay.remove();
  $("#popupX").onclick = () => overlay.remove();
  const dlBtn = $("#dlMod");
  if (dlBtn) dlBtn.onclick = async () => {
    const r = await api("mods/download", { method: "POST", body: { ids: [id] } });
    toast(r.msg);
    startTaskPoll();
  };
  const fetchBtn = $("#fetchLua");
  if (fetchBtn) fetchBtn.onclick = async () => {
    fetchBtn.disabled = true;
    fetchBtn.textContent = "下载中…";
    const r = await api("mods/fetch-modinfo", { method: "POST", body: { id } });
    toast(r.msg);
    if (r.ok) { overlay.remove(); loadModDetail(id); }
    else { fetchBtn.disabled = false; fetchBtn.textContent = "补全信息（下载 modinfo.lua）"; }
  };
  const delBtn = $("#delMod");
  if (delBtn) delBtn.onclick = async () => {
    if (!(await dlgConfirm(`确定取消订阅模组 ${id}？\n将删除本地文件并从配置中彻底移除，不可恢复。`, { danger: true }))) return;
    const r = await api("mods/delete", { method: "POST", body: { id } });
    toast(r.msg);
    if (r.ok) { overlay.remove(); modsState.selId = null; const j = await api("mods"); modsState.mods = j.data.mods; renderModsLocal(); }
  };
  // ---------- 配置项交互（点击行弹出弹窗）----------
  if (!sortedOptions.length) return;
  const tbody = $("#optT");
  sortedOptions.forEach((o) => {
    const tr = document.createElement("tr");
    const hasZh = o.label_zh && o.label_zh !== (o.label || o.name);
    const label = hasZh ? o.label_zh : (o.label || o.name);
    // 当前值/默认值显示中文描述而非原始数据
    const labelOf = (val) => {
      const found = o.options.find((op) => JSON.stringify(op.data) === JSON.stringify(val));
      return found ? (found.description_zh || found.description || fmt(val)) : fmt(val);
    };
    tr.innerHTML = `<td>${esc(label)}${hasZh ? ` <span class="hint">${esc(o.label || o.name)}</span>` : ""}</td><td>${esc(labelOf(o.current))} <span class="hint">(${esc(fmt(o.current))})</span></td><td class="hint">${esc(labelOf(o.default))}</td>`;
    tr.onclick = () => {
      $$("tr", tbody).forEach((r) => r.classList.remove("sel"));
      tr.classList.add("sel");
      // 构造弹窗用的 option 对象（复用 showWorldOptionPopup）
      const popupOpt = {
        key: o.name,
        label: label,
        group: "",
        values: o.options.length ? o.options.map((op) => ({ v: String(op.data), label: op.description_zh || op.description || fmt(op.data) })) : [{ v: fmt(o.current), label: fmt(o.current) }],
      };
      const hover = o.hover_zh || o.hover || "";
      const curVal = fmt(o.current);
      const iconSrcs = d.preview_url ? [d.preview_url] : [];
      showModConfigPopup(popupOpt, curVal, hover, hasZh ? o.label : "", iconSrcs, (val) => {
        // 将选中的值写回原始 option 对象
        const targetOp = o.options.find((op) => String(op.data) === val);
        if (targetOp && ["string", "number", "boolean"].includes(typeof targetOp.data)) {
          o.current = targetOp.data;
        } else if (!o.options.length) {
          // 无可选值的直接设置
          if (["string", "number", "boolean"].includes(typeof val)) o.current = val;
        }
        // 刷新表格行
        tr.children[1].textContent = fmt(o.current);
      });
    };
    tbody.appendChild(tr);
  });
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
      `<div class="item-row" data-p="${it.prefab}"><span class="item-name">${optIcon([it.icon ? `icons/${it.icon}/${it.prefab}.png` : ""])}${esc(it.name)}</span><span class="hint"><span class="tag">${esc(it.cat || "其他")}</span> ${it.prefab}</span></div>`).join(""));
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
    <button data-h="tech" class="${helpState.sub === "tech" ? "active" : ""}">🔧 技术解析</button>
    <button data-h="manual" class="${helpState.sub === "manual" ? "active" : ""}">⌨️ 手动操作</button>
    <button data-h="migrate" class="${helpState.sub === "migrate" ? "active" : ""}">📦 模组迁移</button>
  </div>
  <div id="helpBody"></div>`;
  $$(".subtabs button").forEach((b) => (b.onclick = () => { helpState.sub = b.dataset.h; pageHelp(); }));
  const body = $("#helpBody");
  const helpMap = { guide: HELP_GUIDE, panel: HELP_PANEL, faq: HELP_FAQ, tech: HELP_TECH, manual: HELP_MANUAL, migrate: HELP_MIGRATE };
  body.innerHTML = helpMap[helpState.sub] || HELP_GUIDE;
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

// ---- 章节四：技术解析 ----
const HELP_TECH = `
<div class="card help-doc">
  <h3>🔧 技术解析：DST 服务器内部是怎么运作的</h3>
  <p>这一章不讲"怎么操作"，而是讲<b>"为什么是这样"</b>——服务器程序是怎么启动的、游戏文件用了哪些压缩格式、<code>.tex</code> 图片是怎么存的、文字和汉化是怎么实现的、玩家和服务器之间是怎么对话的。目标读者：没有编程基础但好奇原理的服主。</p>

  <h4>一、服务器启动原理：从敲下回车到玩家能进</h4>
  <p>服务器跑的可执行文件叫 <code>dst_server/bin64/dontstarve_dedicated_server_nullrenderer_x64</code>。名字拆开看：</p>
  <table class="grid"><thead><tr><th>名称片段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>dedicated_server</code></td><td>专用服务器（不是客户端，没有游戏画面）</td></tr>
    <tr><td><code>nullrenderer</code></td><td><b>空渲染器</b>——不画任何画面，不依赖显卡，所有图形计算被替换成"空操作"。这就是它能在没有显示器的云服务器上跑的原因</td></tr>
    <tr><td><code>x64</code></td><td>64 位版本</td></tr>
  </tbody></table>
  <p>启动命令长这样：</p>
  <div class="doc-pre">dontstarve_dedicated_server_nullrenderer_x64 -cluster MyDediServer -shard Master</div>
  <table class="grid"><thead><tr><th>启动参数</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>-cluster 名字</code></td><td>用哪个集群（对应 <code>~/.klei/DoNotStarveTogether/名字/</code> 目录）</td></tr>
    <tr><td><code>-shard 名字</code></td><td>这个进程当哪个分片（Master 或 Caves）</td></tr>
    <tr><td><code>-console</code></td><td>在屏幕上加一个可以直接输命令的控制台</td></tr>
    <tr><td><code>-persistent_storage_root 路径</code></td><td>换存档根目录（默认 <code>~/.klei</code>）</td></tr>
    <tr><td><code>-offline</code></td><td>离线模式：不连 Klei（搜不到、模组/皮肤失效，仅局域网调试用）</td></tr>
    <tr><td><code>-tick 30</code></td><td>改服务器心跳为 30（默认 15；一般不要动）</td></tr>
  </tbody></table>

  <p>按下回车后，程序大致按以下 8 个步骤干活（括号里是日志里能看到的对应行）：</p>
  <ol>
    <li><b>读集群配置</b>：打开 <code>cluster.ini</code>，拿到房名、密码、人数、分片设置。（<code>Loading cluster.ini</code>）</li>
    <li><b>验明正身</b>：读 <code>cluster_token.txt</code>，连 Klei 服务器验证 token 是否合法。<b>token 错或缺失，到这里就停了</b>。</li>
    <li><b>解压游戏数据</b>：把 <code>data/databundles/</code> 里的几个大压缩包（下一节细讲）挂进内存，游戏的所有代码、图片、声音都在里面。</li>
    <li><b>启动 Lua 引擎</b>：饥荒的几乎全部游戏逻辑（生物 AI、合成表、战斗、季节）都是用 <b>Lua 语言</b>写的脚本，存在 <code>scripts.zip</code> 里。引擎把 <code>scripts/main.lua</code> 跑起来，游戏世界"活"了。</li>
    <li><b>处理模组</b>：读 <code>dedicated_server_mods_setup.lua</code>，逐个检查 <code>ServerModSetup("ID")</code> 声明的模组——本地没有或版本旧就连 Steam 创意工坊下载（<code>Downloading mod...</code>）。然后按 <code>modoverrides.lua</code> 决定哪些启用、什么参数，把启用模组的 <code>modmain.lua</code> 注入游戏。</li>
    <li><b>加载或生成世界</b>：看 <code>save/</code> 里有没有存档——有就读档（<code>Loading world...</code>）；没有就读 <code>leveldataoverride.lua</code> 现场生成一个（<code>Generating world...</code>，第一次开服要等几分钟就在这一步）。</li>
    <li><b>开门营业</b>：绑定 UDP 端口（Master 默认 11000），向 Steam 和 Klei 大厅注册（<code>Registering master server</code>），玩家就能搜到并连进来了。</li>
    <li><b>进入心跳循环</b>：服务器默认每秒"走"15 步（tick rate 15），每步推进一次世界：生物动一下、饥饿扣一点、植物长一点。没玩家且 <code>pause_when_empty=true</code> 时就原地待命。</li>
  </ol>
  <div class="doc-tip">💡 Master 和 Caves 是<b>两个独立进程</b>，各自跑一遍上面的流程，各开一个 UDP 端口。它们启动后通过 <code>master_port</code>（默认 10889，TCP，仅限本机 127.0.0.1）握手，用 <code>cluster_key</code> 这个"暗号"互相认亲。玩家下洞穴时，Master 把玩家数据从这条内部通道递给 Caves，客户端再改连 Caves 的端口。</div>

  <h4>二、压缩文件体系：databundles/ 游戏数据是怎么打包的</h4>
  <p>打开 <code>dst_server/data/databundles/</code>，核心就这几个文件：</p>
  <table class="grid"><thead><tr><th>文件</th><th>里面装什么</th><th>大小量级</th></tr></thead><tbody>
    <tr><td><code>scripts.zip</code></td><td><b>全部游戏逻辑</b>：几千个 .lua 脚本（生物、物品、合成、地图生成、文本）</td><td>游戏的大脑</td></tr>
    <tr><td><code>images.zip</code></td><td><b>全部界面/图标图集</b>：几千对 .xml + .tex</td><td>界面皮肤</td></tr>
    <tr><td><code>anim_dynamic.zip</code></td><td>动画数据（角色/生物动作）</td><td>动作库</td></tr>
    <tr><td><code>fonts.zip</code></td><td>字体文件</td><td>文字</td></tr>
    <tr><td><code>shaders.zip</code></td><td>着色器（光照/特效，服务器用不上但打包在一起）</td><td>画面</td></tr>
    <tr><td><code>klump.zip</code></td><td>其他杂项资源</td><td>—</td></tr>
    <tr><td><code>hashes.txt</code></td><td>每个文件的校验指纹</td><td>完整性检查</td></tr>
  </tbody></table>
  <p><b>为什么打包成 zip？</b> 上万个几 KB 的小文件直接放硬盘又慢又碎；打成 zip 后：下载快、校验方便（<code>hashes.txt</code> 一对就知道文件坏没坏）、<code>steamcmd app_update 343050 validate</code> 能自动修复。服务器启动时把这些 zip 挂载成"虚拟文件系统"，代码里写 <code>images/inventoryimages1.xml</code> 就能读，感觉和普通文件夹一样。</p>
  <p><b>加载优先级</b>：游戏引擎查找文件时，先查 <code>data/databundles/</code> 里的打包文件，再查 <code>data/</code> 目录下的散装文件，最后查模组提供的文件。模组文件会<b>覆盖</b>同名的原版文件——这就是模组能改游戏内容的基础。</p>
  <div class="doc-tip">💡 <b>怎么提取 databundles 里的文件？</b> <code>scripts.zip</code> 等本质是标准 ZIP 格式，直接用 <code>unzip scripts.zip -d scripts_extracted/</code> 即可解压查看。<code>images.zip</code> 同理，但里面的 <code>.tex</code> 文件需要专门的 KTEX 解码器才能查看（下一节详解）。</p></div>

  <h4>三、图片渲染：.tex 格式与 DXT 压缩算法详解（核心章节）</h4>
  <p>游戏里所有图片都是 <code>.tex</code> 后缀，<b>不是普通图片</b>（不是 PNG/JPG），而是 Klei 私有的 KTEX 格式。社区逆向得出的文件结构如下：</p>

  <h4>3.1 KTEX 文件头结构</h4>
  <p>每个 <code>.tex</code> 文件的二进制布局：</p>
  <div class="doc-pre">偏移    大小    字段名              说明
─────────────────────────────────────────────────────
0x00    4       magic               魔数：4B 54 45 58（ASCII "KTEX"，标识这是 KTEX 文件）
0x04    4       textureType         纹理类型标志（1D/2D/3D/CubeMap，DST 中绝大多数是 2D = 0）
0x08    4       pixelFormat         像素格式标志（包含压缩类型：DXT1/DXT5/RGBA + mipmap 标志）
0x0C    2       width               图片宽度（像素）
0x0E    2       height              图片高度（像素）
0x10    1       numMipMaps          mipmap 等级数（0=只有原图，>0=带多级缩小版）
...
之后是 per-mipmap-level 数据块：
  - pitchOrLinearSize（4 字节）：这一级数据的字节大小（DXT 格式用线性大小，RGBA 用 pitch=宽×4）
  - pixel data：实际的像素/压缩数据</div>
  <table class="grid"><thead><tr><th>字段</th><th>类型</th><th>说明</th></tr></thead><tbody>
    <tr><td><code>magic</code></td><td>4 字节</td><td>魔数 <code>4B 54 45 58</code>（ASCII "KTEX"），校验文件身份，不匹配则拒绝加载</td></tr>
    <tr><td><code>textureType</code></td><td>4 字节</td><td>纹理类型：0=2D 纹理（DST 中绝大多数），其他值表示 1D/3D/立方体贴图</td></tr>
    <tr><td><code>pixelFormat</code></td><td>4 字节</td><td>像素格式标志位，包含压缩类型（DXT1 / DXT5 / RGBA8888）和是否含 mipmap</td></tr>
    <tr><td><code>width / height</code></td><td>各 2 字节</td><td>原图的像素宽度和高度</td></tr>
    <tr><td><code>numMipMaps</code></td><td>1 字节</td><td>mipmap 等级数量（0 表示只有原始分辨率，不生成缩小版）</td></tr>
    <tr><td><code>pitchOrLinearSize</code></td><td>4 字节/级</td><td>每级 mipmap 的数据字节大小</td></tr>
  </tbody></table>

  <h4>3.2 DXT 块压缩原理：为什么 .tex 这么小</h4>
  <p>DXT（也叫 S3TC）是<b>显卡原生支持的块纹理压缩格式</b>。它的核心思想：不是逐像素存储颜色，而是把图像按 <b>4×4 像素块</b>分组，每个块只存 2 个参考颜色 + 索引表，通过插值还原出 16 个像素的颜色。</p>

  <p><b>DXT1（最小，8 字节/块）：</b></p>
  <ul>
    <li>每个 4×4 像素块占用 <b>8 字节</b> = 2 个 16 位 RGB565 参考颜色（各 2 字节）+ 4 字节索引表（16 个像素 × 2 位/像素 = 32 位 = 4 字节）</li>
    <li>只能表示 <b>4 种颜色</b>（2 个参考色 + 2 个插值色），适合没有透明通道的贴图</li>
    <li>压缩比：原图 RGBA = 4 字节/像素，DXT1 = 0.5 字节/像素，<b>压缩 8 倍</b></li>
    <li>如果启用 1-bit alpha 模式，第 4 种颜色变成透明，适合做栅栏、树叶等镂空贴图</li>
  </ul>

  <p><b>DXT5（带透明度，16 字节/块）：</b></p>
  <ul>
    <li>每个 4×4 像素块占用 <b>16 字节</b> = 2 个 8 位 alpha 参考值（各 1 字节）+ 16 个 3 位 alpha 索引（6 字节）+ 2 个 16 位 RGB565 参考颜色（4 字节）+ 4 字节颜色索引表</li>
    <li>颜色部分和 DXT1 一样（4 种颜色），但额外有 <b>8 级透明度</b>（2 个参考值插值出 6 级 + 2 个参考值本身 + 完全透明）</li>
    <li>适合有半透明效果的贴图（烟雾、光晕、渐变阴影）</li>
    <li>压缩比：RGBA 16 字节/4×4 块 → DXT5 16 字节/4×4 块 = 压缩 4 倍</li>
  </ul>

  <h4>3.3 DXT 解压算法（逐步拆解）</h4>
  <p>把一个 DXT1 4×4 块还原成 16 个像素，算法步骤如下：</p>
  <div class="doc-pre">对图像中每一个 4×4 像素块：
  ① 读取 color0（16 位 RGB565 参考颜色 0）→ 转成 RGB
  ② 读取 color1（16 位 RGB565 参考颜色 1）→ 转成 RGB
  ③ 根据 color0 和 color1 的大小关系，计算 2 个插值颜色：
     - 如果 color0 > color1（不透明模式）：
         color2 = (2×color0 + color1) / 3   （三分之二混色）
         color3 = (color0 + 2×color1) / 3   （三分之一混色）
     - 如果 color0 ≤ color1（1-bit alpha 模式）：
         color2 = (color0 + color1) / 2     （五五混色）
         color3 = 透明（RGB=0, alpha=0）
  ④ 读取 4 字节（32 位）索引表，每 2 位代表一个像素的查表值（0~3）
  ⑤ 按 2 位索引从 [color0, color1, color2, color3] 查出该像素的颜色
  ⑥ 16 个像素排成 4×4 矩阵 → 这一块就还原了</div>
  <table class="grid"><thead><tr><th>索引值</th><th>DXT1 不透明模式</th><th>DXT1 1-bit alpha 模式</th></tr></thead><tbody>
    <tr><td><code>0b00</code></td><td>color0（参考色 0）</td><td>color0</td></tr>
    <tr><td><code>0b01</code></td><td>color1（参考色 1）</td><td>color1</td></tr>
    <tr><td><code>0b10</code></td><td>color2 = 2/3 混色</td><td>color2 = 1/2 混色</td></tr>
    <tr><td><code>0b11</code></td><td>color3 = 1/3 混色</td><td>透明</td></tr>
  </tbody></table>
  <div class="doc-tip">💡 RGB565 是 16 位颜色格式：红色 5 位（32 级）、绿色 6 位（64 级，人眼对绿色最敏感所以多一位）、蓝色 5 位（32 级）。转成 24 位 RGB 时需要左移补齐：R = (r5 &lt;&lt; 3) | (r5 &gt;&gt; 2)。</div>

  <h4>3.4 KTEX 特有坑：像素行翻转</h4>
  <div class="doc-warn">⚠ 解码 KTEX 时发现一个关键坑：KTEX 的像素排列方向和常规图片<b>相反</b>——像素行是上下翻转的（bottom-up，而非标准图像的 top-down）。解码后必须<b>垂直翻转（沿水平中线翻转 180°）</b>才是正确的图像。如果不翻转，图片就是上下颠倒的。本面板的 KTEX 解码器就包含了这一步翻转逻辑。</div>

  <h4>3.5 为什么用 GPU 原生格式</h4>
  <p>DXT1/DXT5 是<b>显卡硬件直接支持的纹理格式</b>。这意味着游戏引擎把 <code>.tex</code> 数据读进内存后，<b>不需要 CPU 解压缩</b>，可以直接原样上传到 GPU 显存作为纹理使用。GPU 在渲染时实时按需解压。好处：</p>
  <ul>
    <li><b>省显存</b>：DXT5 比 RGBA8888 省 75% 显存，DXT1 省 87.5%</li>
    <li><b>省带宽</b>：纹理数据量小，从内存到显存传输快</li>
    <li><b>零 CPU 开销</b>：不需要软件解码，启动更快</li>
  </ul>
  <div class="doc-tip">💡 这就是为什么 <code>.tex</code> 文件不能直接用图片查看器打开——图片查看器不认识 DXT 格式，必须先解码成 PNG/RGBA 才能显示。本面板内置了 KTEX→PNG 解码器，才能在网页上显示模组图标。</div>

  <h4>3.6 RGBA 模式（无压缩）</h4>
  <p>少数 <code>.tex</code> 文件使用未压缩的 RGBA8888 格式（pixelFormat 标志位标识）。这种情况下每个像素直接存 4 字节（R, G, B, Alpha 各 1 字节），不需要 DXT 解压——读取后直接就是完整的像素数据。特点是画质无损但文件体积大（一张 256×256 图片 = 256×256×4 = 262144 字节 ≈ 256KB）。</p>

  <h4>四、图集系统：.xml Atlas 详解</h4>
  <h4>4.1 什么是图集（Atlas）</h4>
  <p>游戏里小图标成千上万（物品栏、合成栏、设置项……），如果每张一个文件，读取会非常慢。Klei 的解决办法是<b>图集</b>：把几百张小图拼进一张大贴图（比如 <code>inventoryimages1.tex</code>），再配一个同名 <code>.xml</code> 当"地图册目录"，记录每张小图在大图中的位置。</p>

  <h4>4.2 XML 结构</h4>
  <div class="doc-pre">&lt;Atlas&gt;
  &lt;Texture filename="inventoryimages1.tex" /&gt;
  &lt;Elements&gt;
    &lt;Element name="log.tex"    u1="0.001" v1="0.002" u2="0.050" v2="0.060" /&gt;
    &lt;Element name="rocks.tex"  u1="0.051" v1="0.002" u2="0.100" v2="0.060" /&gt;
    &lt;Element name="flint.tex"  u1="0.101" v1="0.002" u2="0.150" v2="0.060" /&gt;
    ...（几百个 Element）
  &lt;/Elements&gt;
&lt;/Atlas&gt;</div>
  <table class="grid"><thead><tr><th>参数</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>filename="xxx.tex"</code></td><td>这张图集对应的大贴图文件名（<code>&lt;Texture&gt;</code> 标签里）</td></tr>
    <tr><td><code>name="log.tex"</code></td><td>这块小图的<b>查找名字</b>（正好对应物品代码 <code>log</code> = 木头）。游戏代码要画"木头图标"时就拿这个名字去查</td></tr>
    <tr><td><code>u1 / v1</code></td><td>小图在大图上的<b>左上角 UV 坐标</b>，0.0~1.0 归一化比例（u=横向、v=纵向）。如 <code>u1=0.05</code> 表示从大图左边 5% 处开始</td></tr>
    <tr><td><code>u2 / v2</code></td><td>小图在大图上的<b>右下角 UV 坐标</b>，0.0~1.0 归一化比例</td></tr>
  </tbody></table>

  <h4>4.3 UV → 像素转换</h4>
  <p>UV 是归一化坐标（0.0~1.0），要转成像素只需乘以大图的尺寸：</p>
  <div class="doc-pre">假设大图 inventoryimages1.tex 宽度=2048 像素，高度=2048 像素
小图 log.tex 的 UV：u1=0.001 v1=0.002 u2=0.050 v2=0.060

像素坐标：
  左上角 x = u1 × 2048 = 0.001 × 2048 = 2    像素
  左上角 y = v1 × 2048 = 0.002 × 2048 = 4    像素
  右下角 x = u2 × 2048 = 0.050 × 2048 = 102  像素
  右下角 y = v2 × 2048 = 0.060 × 2048 = 123  像素

→ 从大图 (2,4) 到 (102,123) 的矩形区域就是木头图标
→ 宽度 = 100 像素，高度 ≈ 119 像素</div>

  <h4>4.4 真实图集文件</h4>
  <table class="grid"><thead><tr><th>图集文件</th><th>内容</th></tr></thead><tbody>
    <tr><td><code>images/inventoryimages1.xml</code> ~ <code>inventoryimages4.xml</code></td><td>四张巨型图集装下<b>全部原版物品图标</b>（3000+ 个 Element）</td></tr>
    <tr><td><code>images/worldgen_customization.xml</code></td><td>开房界面"世界生成"每个选项的图标</td></tr>
    <tr><td><code>images/worldsettings_customization.xml</code></td><td>开房界面"世界设置"每个选项的图标</td></tr>
    <tr><td><code>minimap/*.xml</code></td><td>小地图图标的图集</td></tr>
    <tr><td>模组 <code>images/inventoryimages.xml</code></td><td>模组自己物品的图标图集</td></tr>
    <tr><td>模组 <code>modicon.xml + modicon.tex</code></td><td>模组列表里显示的模组图标</td></tr>
  </tbody></table>
  <div class="doc-tip">💡 本面板"物品带图搜索"功能原理：启动时把 4 个物品图集 XML 读进内存，建成"物品代码 → 在哪张图集、什么坐标"的字典；网页上搜"木头"就按坐标把对应小图从解码好的 PNG 大图里裁出来显示。</div>

  <h4>五、声音系统：FMOD 引擎</h4>
  <p>DST 使用 <b>FMOD 音频引擎</b>，声音资源分两种文件：</p>
  <table class="grid"><thead><tr><th>文件类型</th><th>内容</th><th>作用</th></tr></thead><tbody>
    <tr><td><code>.fev</code></td><td>音频事件定义（FMOD Event）</td><td>定义"什么动作触发什么声音"的事件表，如 <code>dont_starve/characters/wilson/hit</code></td></tr>
    <tr><td><code>.fsb</code></td><td>音频数据包（FMOD Sound Bank）</td><td>实际的声音波形数据打包在一起</td></tr>
  </tbody></table>
  <p>客户端启动时加载 <code>.fev</code> 事件表和 <code>.fsb</code> 音频包，游戏逻辑触发某个事件名时 FMOD 就播放对应声音。<b>服务器端（nullrenderer）不加载也不播放任何声音</b>——声音只在客户端处理。所以服务端的 <code>sound/</code> 目录基本是闲置的。</p>

  <h4>六、动画系统：.anim / .bin 骨骼动画</h4>
  <p>DST 的角色和生物动画使用 Klei 自研的骨骼动画系统，资源文件如下：</p>
  <table class="grid"><thead><tr><th>文件</th><th>内容</th></tr></thead><tbody>
    <tr><td><code>anim.bin</code></td><td>动画帧数据：每一帧每个骨骼部件的位置、旋转、缩放，以及动画事件标记</td></tr>
    <tr><td><code>build.bin</code></td><td>构建数据：骨骼层级结构 + 每个部件绑定的贴图（来自 atlas 图集）</td></tr>
    <tr><td>atlas (.xml + .tex)</td><td>部件贴图图集，<code>build.bin</code> 里的部件通过 UV 从图集中取图</td></tr>
  </tbody></table>
  <p>三者配合的渲染流程：代码要播放动画"wilson/run"→ <code>anim.bin</code> 读取这一帧每个骨骼部件的变换矩阵 → <code>build.bin</code> 知道每个部件对应图集里的哪个区域 → 从 atlas 取出贴图 → 按变换矩阵画到屏幕上。服务端只关心碰撞体积等<b>逻辑数据</b>（用于判定攻击范围、可拾取区域），不关心视觉表现。</p>
  <div class="doc-tip">💡 模组内部的角色/物品动画资源（<code>anim/</code> 里）又是 zip 打包——<b>套娃式打包</b>：角色/物品的动画包 <code>.zip</code> 里有 <code>anim.bin</code>、<code>build.bin</code>、atlas 贴图。</div>

  <h4>七、翻译模块详解</h4>
  <h4>7.1 STRINGS 表结构</h4>
  <p>饥荒所有文本都集中在一个 Lua 大表 <code>STRINGS</code>（在 <code>scripts.zip</code> 的 <code>scripts/strings.lua</code>，约 839KB / 80 多万字节）里，按层级嵌套组织：</p>
  <div class="doc-pre">STRINGS.NAMES.LOG = "Log"                         -- 物品名：木头
STRINGS.RECIPE_DESC.AXE = "Chop down trees!"    -- 合成描述：斧头
STRINGS.CHARACTERS.WILSON.DESCRIBE.AXE = "..."  -- 威尔逊检查斧头的台词
STRINGS.UI.CUSTOMIZATIONSCREEN.SETTINGS.XXX      -- 世界设置项的名字
STRINGS.NAMES.SPIDIDER = "Spider"                -- 生物名：蜘蛛</div>
  <p>游戏界面要显示一句话时，就到这张表里按键查找。每一句游戏内可见的文字——物品名、描述、角色台词、UI 按钮、世界设置项——都能在这张表里找到对应条目。<b>改文字 = 改这张表</b>，这给汉化留了标准入口。</p>

  <h4>7.2 .po 文件格式详解</h4>
  <p>翻译存放在 <code>scripts/languages/*.po</code> 里。po 是 GNU gettext 标准（业界通用的翻译格式），每个条目由多个字段组成：</p>
  <div class="doc-pre"># STRINGS.NAMES.LOG                        ← #. 注释：注释行，记录对应的 STRINGS 键路径
msgctxt "STRINGS.NAMES.LOG"                 ← msgctxt：上下文，等于 STRINGS 键路径（用于精确匹配）
msgid "Log"                                 ← msgid：英文原文（翻译源）
msgstr "木头"                               ← msgstr：翻译后的文字（中文译文）

# STRINGS.RECIPE_DESC.AXE
msgctxt "STRINGS.RECIPE_DESC.AXE"
msgid "Chop down trees!"
msgstr "砍倒大树！"</div>
  <table class="grid"><thead><tr><th>.po 字段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>#.</code>（注释行）</td><td>注释，记录这一条翻译对应的 STRINGS 键路径，方便译者定位</td></tr>
    <tr><td><code>msgctxt</code></td><td>上下文标记，等于 STRINGS 键路径（如 <code>STRINGS.NAMES.LOG</code>），用于精确匹配同义词（英文 "Log" 既是物品名也是动词，靠 msgctxt 区分）</td></tr>
    <tr><td><code>msgid</code></td><td>英文原文（待翻译的源文本），在 STRINGS 表里查到的英文值</td></tr>
    <tr><td><code>msgstr</code></td><td>翻译后的目标语言文字，空字符串 <code>""</code> 表示尚未翻译</td></tr>
  </tbody></table>
  <p>启动时游戏按语言设置，遍历 <code>.po</code> 文件，用每条的 <code>msgctxt</code> 在 STRINGS 表里找到对应键，把英文 <code>msgid</code> 替换成 <code>msgstr</code> 译文。</p>

  <h4>7.3 语言加载流程</h4>
  <div class="doc-pre">玩家在客户端设置里选"简体中文"
→ locale 代码 = "zh"（或 "zhr" 繁体）
→ loc.lua（语言加载器）读取语言映射表
→ 执行 LoadPOFile("chinese_s.po", "zh")
→ 遍历 .po 中每一条：
    msgctxt = "STRINGS.NAMES.LOG"
    msgid  = "Log"
    msgstr = "木头"
  → 在 STRINGS 表中按 msgctxt 路径找到 STRINGS.NAMES.LOG
  → 把它的值从 "Log" 替换成 "木头"
→ 全部替换完成，游戏界面变成中文</div>

  <h4>7.4 官方内置的 15 个语言文件</h4>
  <table class="grid"><thead><tr><th>.po 文件</th><th>语言</th><th>备注</th></tr></thead><tbody>
    <tr><td><code>strings.pot</code></td><td>翻译模板</td><td>所有待译原文，给其他语言做底子（不是具体语言）</td></tr>
    <tr><td><code>chinese_s.po</code></td><td><b>简体中文</b></td><td>官方全量翻译，约 1700 万字节</td></tr>
    <tr><td><code>chinese_t.po</code></td><td>繁体中文</td><td>—</td></tr>
    <tr><td><code>japanese.po</code></td><td>日语</td><td>—</td></tr>
    <tr><td><code>korean.po</code></td><td>韩语</td><td>—</td></tr>
    <tr><td><code>french.po</code></td><td>法语</td><td>—</td></tr>
    <tr><td><code>german.po</code></td><td>德语</td><td>—</td></tr>
    <tr><td><code>spanish.po</code></td><td>西班牙语</td><td>—</td></tr>
    <tr><td><code>spanish_mex.po</code></td><td>墨西哥西班牙语</td><td>—</td></tr>
    <tr><td><code>portuguese_br.po</code></td><td>巴西葡萄牙语</td><td>—</td></tr>
    <tr><td><code>italian.po</code></td><td>意大利语</td><td>—</td></tr>
    <tr><td><code>polish.po</code></td><td>波兰语</td><td>—</td></tr>
    <tr><td><code>russian.po</code></td><td>俄语</td><td>—</td></tr>
  </tbody></table>
  <p>配套文件：<code>loc.lua</code>（语言加载器，负责读 po、替换 STRINGS）、<code>language.lua</code>（语言列表定义，定义每种语言的显示名和 locale 代码）。</p>

  <h4>7.5 字体缩放（每种语言不同）</h4>
  <p>不同语言的字符宽高比例差异很大，DST 为每种语言设置了不同的字体缩放系数，防止文字溢出 UI 边界：</p>
  <table class="grid"><thead><tr><th>语言</th><th>字体缩放</th><th>原因</th></tr></thead><tbody>
    <tr><td>英语</td><td>1.0（基准）</td><td>默认尺寸</td></tr>
    <tr><td>简体中文</td><td>0.85</td><td>汉字方块字比英文字母宽，缩小 15% 才不溢出 UI</td></tr>
    <tr><td>繁体中文</td><td>0.85</td><td>同上</td></tr>
    <tr><td>日语 / 韩语</td><td>0.85~0.90</td><td>同样使用宽字符</td></tr>
    <tr><td>俄语</td><td>0.90</td><td>西里尔字母略宽</td></tr>
  </tbody></table>

  <h4>7.6 两种模组汉化方法</h4>
  <p><b>方法 A：.po 文件 + LoadPOFile（推荐，和官方机制一致）</b></p>
  <div class="doc-pre">-- 在模组的 modmain.lua 中：
local lang = locale ~= nil and (locale == "zh" or locale == "zhr") and "zh" or "en"
if lang == "zh" then
    -- 读取模组自带的 .po 文件替换 STRINGS
    LoadPOFile("DST_chs.po", "zh")
end</div>
  <p><b>方法 B：直接 STRINGS 赋值（简单粗暴）</b></p>
  <div class="doc-pre">-- 在模组的 modmain.lua 中直接赋值：
if locale == "zh" then
    GLOBAL.STRINGS.NAMES.CUSTOM_ITEM = "自定义物品"
    GLOBAL.STRINGS.RECIPE_DESC.CUSTOM_ITEM = "这是一个自定义物品"
end</div>

  <h4>7.7 中文语言包模组实例（workshop-1301033176）</h4>
  <p>创意工坊的"中文语言包"类模组（如 workshop-1301033176）的实现方式：</p>
  <ul>
    <li>自带 <code>DST_chs.po</code> 文件，包含大量模组词条的中文翻译；</li>
    <li>在 <code>modmain.lua</code> 中调用 <code>LoadPOFile("DST_chs.po", "zh")</code> 载入翻译；</li>
    <li>还会<b>修补 Lua 的 string.match 函数</b>——因为 DST 原版代码中有一些用英文正则匹配字符串的逻辑，中文字符在某些 Lua 版本下会导致 string.match 报错（Unicode 编码问题），语言包通过 monkey-patch 修复这个 bug；</li>
    <li>这种模组不添加任何游戏内容，只做翻译覆盖。</li>
  </ul>

  <h4>7.8 为什么语言包必须最后加载</h4>
  <p>模组的文本覆盖遵循<b>"后来居上"</b>规则：模组按 <code>modoverrides.lua</code> 中的顺序逐个加载，后加载的 STRINGS 赋值会盖掉先加载的。所以：</p>
  <ul>
    <li>玩法模组先加载（它们往 STRINGS 里写英文或自带翻译）；</li>
    <li><b>汉化包最后加载</b>——它最后"盖章"，才能把前面所有模组的文本统一刷成中文。</li>
  </ul>
  <div class="doc-warn">⚠ 顺序反了，就会出现"一半中文一半英文"。本面板会自动识别语言包类模组（目录里含 <code>DST_chs.po</code> 这类文件的），启动排序时<b>强制排在最后</b>，就是这个原理。</div>

  <h4>八、网络通信：客户端与服务器全端口交互图</h4>
  <div class="doc-pre">┌─────────────────────────────────────────────────────────┐
│                     玩家客户端（游戏）                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Steam 层：身份认证 / 好友邀请 / 创意工坊下载          │  │
│  └───────────────────────────────────────────────────┘  │
└──────────┬──────────────────┬────────────────┬──────────┘
           │ UDP 11000         │ UDP 27018      │ UDP 8768
           │ (游戏数据)         │ (Steam查询)     │ (Steam认证)
           ▼                   ▼                ▼
┌──────────────────────────────────────────────────────────┐
│  Master 进程（地上世界）  端口 11000                        │
│  ├── 11000 UDP   游戏数据（玩家移动/聊天/世界同步）          │
│  ├── 27018 UDP   Steam 主服务器查询（服务器列表信息）        │
│  ├── 8768  UDP   Steam 身份认证（验证 Steam 票据）          │
│  └── 10889 TCP   分片内部通信（仅 127.0.0.1）              │
│         │                                                 │
│         │ TCP 10889（cluster_key 握手）                     │
│         ▼                                                 │
│  Caves 进程（地下世界）  端口 11001                        │
│  ├── 11001 UDP   游戏数据（玩家在洞穴中的同步）              │
│  ├── 27019 UDP   Steam 主服务器查询                        │
│  └── 8769  UDP   Steam 身份认证                            │
└──────────────────────────────────────────────────────────┘</div>
  <table class="grid"><thead><tr><th>端口</th><th>协议</th><th>用途</th><th>对外开放</th></tr></thead><tbody>
    <tr><td>11000</td><td>UDP</td><td>Master 游戏数据端口（玩家进出/移动/聊天/世界同步）</td><td>✅ 必须</td></tr>
    <tr><td>11001</td><td>UDP</td><td>Caves 游戏数据端口（同上，洞穴世界）</td><td>✅ 必须</td></tr>
    <tr><td>27018 / 27019</td><td>UDP</td><td>Steam 主服务器端口（服务器列表查询/Steam 浏览器信息）</td><td>✅ 必须</td></tr>
    <tr><td>8768 / 8769</td><td>UDP</td><td>Steam 认证端口（验证玩家 Steam 身份票据）</td><td>✅ 必须</td></tr>
    <tr><td>10889</td><td>TCP</td><td>分片内部通信（Master ↔ Caves 玩家数据传递）</td><td>❌ 仅 127.0.0.1</td></tr>
  </tbody></table>
  <p><b>玩家进服全过程</b>（6 步）：</p>
  <ol>
    <li><b>发现</b>：服务器启动时向 Steam/Klei 大厅注册（房名、人数、标签、要不要密码）。玩家"浏览游戏"时看到的就是这些注册信息。</li>
    <li><b>敲门</b>：客户端连服务器的 UDP 11000 端口，先发认证数据（Steam 身份 → 换成 KU_ID）。</li>
    <li><b>过闸</b>：服务器依次检查——token 有效吗？房间满了吗？<b>在 blocklist.txt 黑名单里吗？</b> 密码对吗？任何一关不过就拒连。</li>
    <li><b>对模组</b>：服务器告诉客户端"我用了这些模组、这些版本"。客户端缺的/版本旧的，当场从创意工坊自动下载（<code>all_clients_require_mod=true</code> 的强制，缺了就进不来）。</li>
    <li><b>进世界</b>：服务器把玩家出生点附近的世界状态发给客户端；之后客户端只收"你周围发生了什么"，远处的不传（省流量）。</li>
    <li><b>换世界</b>：下洞穴时客户端被转接到 Caves 的 11001 端口。</li>
  </ol>
  <div class="doc-tip">💡 本面板<b>不改游戏任何协议</b>，它只是把"本来要手动做的事"搬到网页上：改配置 → 替你写 <code>cluster.ini</code> / <code>server.ini</code> / <code>modoverrides.lua</code>；控制台 → 替你发远程命令（就是日志里那些 <code>print("DSTPANEL"...)</code> 的 RemoteCommandInput）；看日志/聊天 → 替你读 <code>server_log.txt</code> / <code>server_chat_log.txt</code>。面板会的一切，纯手工都能做——面板只是快和不容易错。</div>
</div>`;

// ---- 章节五：无面板手动操作完全指南 ----
const HELP_MANUAL = `
<div class="card help-doc">
  <h3>⌨️ 手动操作完全指南：不用面板也能管理服务器</h3>
  <p>这一章教你<b>完全不用面板</b>，纯用命令行管理 DST 服务器。适合理解底层原理、排查面板故障、或在没装面板的机器上开服。每个命令都标注了参数含义。</p>

  <h4>一、从零搭建：完整命令链</h4>
  <h4>1.1 装系统依赖（root 执行）</h4>
  <div class="doc-pre">apt-get update
apt-get install -y lib32gcc-s1 lib32stdc++6 screen wget tar</div>
  <table class="grid"><thead><tr><th>部分</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>apt-get update</code></td><td>刷新"软件商店目录"（不装东西，只更新清单）</td></tr>
    <tr><td><code>install -y</code></td><td>安装，<code>-y</code> 自动确认所有提示</td></tr>
    <tr><td><code>lib32gcc-s1</code></td><td>32 位 GCC 运行库——SteamCMD 是 32 位程序，64 位系统必须装</td></tr>
    <tr><td><code>lib32stdc++6</code></td><td>32 位 C++ 标准库，同上</td></tr>
    <tr><td><code>screen</code></td><td>虚拟终端工具：让服务器在后台跑，随时能接进去看</td></tr>
    <tr><td><code>wget</code></td><td>命令行下载工具</td></tr>
    <tr><td><code>tar</code></td><td>解压工具</td></tr>
  </tbody></table>

  <h4>1.2 创建运行用户（root 执行）</h4>
  <div class="doc-pre">useradd -m -s /bin/bash steam
su - steam</div>
  <table class="grid"><thead><tr><th>部分</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>useradd</code></td><td>创建新用户</td></tr>
    <tr><td><code>-m</code></td><td>顺便创建主目录 <code>/home/steam</code>（make home）</td></tr>
    <tr><td><code>-s /bin/bash</code></td><td>指定登录 shell 为 bash</td></tr>
    <tr><td><code>su - steam</code></td><td>切换成 steam 用户；<code>-</code> 表示连环境变量一起切，少了它路径会错</td></tr>
  </tbody></table>
  <div class="doc-tip">💡 为什么要单独用户：安全。游戏服被入侵时，攻击者只有 steam 权限，动不了系统。</div>

  <h4>1.3 下载 SteamCMD（steam 用户执行）</h4>
  <div class="doc-pre">mkdir -p ~/steamcmd && cd ~/steamcmd
wget https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
tar -xzf steamcmd_linux.tar.gz</div>
  <table class="grid"><thead><tr><th>部分</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>mkdir -p</code></td><td>创建目录；<code>-p</code> 父目录不存在也建且已存在不报错</td></tr>
    <tr><td><code>&amp;&amp;</code></td><td>前一条成功才执行后一条</td></tr>
    <tr><td><code>tar -xzf</code></td><td>解压：x=解压、z=gzip 格式、f=后面跟文件名</td></tr>
  </tbody></table>

  <h4>1.4 下载游戏服务端（最长的一步，几个 GB）</h4>
  <div class="doc-pre">cd ~/steamcmd
./steamcmd.sh +force_install_dir /home/steam/dst_server +login anonymous +app_update 343050 validate +quit</div>
  <table class="grid"><thead><tr><th>部分</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>./steamcmd.sh</code></td><td>运行当前目录下的 steamcmd 脚本</td></tr>
    <tr><td><code>+force_install_dir /home/steam/dst_server</code></td><td>指定安装目录，<b>必须在 login 之前</b>，否则装到默认位置</td></tr>
    <tr><td><code>+login anonymous</code></td><td>匿名登录 Steam（下载服务端不需要账号）</td></tr>
    <tr><td><code>+app_update 343050</code></td><td>下载 AppID <b>343050</b>（DST 专用服务端的编号）</td></tr>
    <tr><td><code>validate</code></td><td>校验文件完整性，坏了自动重下</td></tr>
    <tr><td><code>+quit</code></td><td>干完活退出</td></tr>
  </tbody></table>
  <div class="doc-warn">⚠ 以后<b>更新游戏版本</b>就是原样再跑一遍这条命令。</div>

  <h4>二、目录创建与配置文件</h4>
  <h4>2.1 创建集群目录</h4>
  <div class="doc-pre">mkdir -p ~/.klei/DoNotStarveTogether/MyDediServer/Master
mkdir -p ~/.klei/DoNotStarveTogether/MyDediServer/Caves</div>
  <table class="grid"><thead><tr><th>路径</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>~/.klei/DoNotStarveTogether/</code></td><td>DST 服务端写死的默认存档根目录</td></tr>
    <tr><td><code>MyDediServer</code></td><td>集群名=文件夹名，启动时 <code>-cluster</code> 参数要对上</td></tr>
    <tr><td><code>Master/</code></td><td>地面世界分片目录</td></tr>
    <tr><td><code>Caves/</code></td><td>洞穴世界分片目录</td></tr>
  </tbody></table>

  <h4>2.2 cluster.ini 全参数详解</h4>
  <p>创建 <code>~/.klei/DoNotStarveTogether/MyDediServer/cluster.ini</code>：</p>
  <div class="doc-pre">[GAMEPLAY]
game_mode = survival
max_players = 6
pvp = false
pause_when_empty = false
intention = cooperative
vote_kick_enabled = false

[NETWORK]
cluster_name = My DST Server
cluster_description = A dedicated server for friends
cluster_password =
lan_only_cluster = false
offline_cluster = false
whitelist_slots = 0
tick_rate = 15

[MISC]
console_enabled = true
max_snapshots = 6
autosaver_enabled = true

[SHARD]
shard_enabled = true
bind_ip = 127.0.0.1
master_ip = 127.0.0.1
master_port = 10889
cluster_key = supersecretkey</div>
  <p><b>[GAMEPLAY] 玩法段：</b></p>
  <table class="grid"><thead><tr><th>字段</th><th>可选值</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>game_mode</code></td><td><code>survival</code></td><td>生存模式：死变鬼魂，全员死亡开始世界重置倒计时</td></tr>
    <tr><td></td><td><code>endless</code></td><td>无尽模式：随时在出生门复活，世界永不重置</td></tr>
    <tr><td></td><td><code>relaxed</code></td><td>轻松模式：难度低，适合新手</td></tr>
    <tr><td></td><td><code>wilderness</code></td><td>荒野模式：无出生门，死了随机地点复活</td></tr>
    <tr><td><code>max_players</code></td><td>1~64</td><td>同时在线人数上限（推荐 ≤6，人多吃配置）</td></tr>
    <tr><td><code>pvp</code></td><td><code>true/false</code></td><td>玩家能否互相攻击</td></tr>
    <tr><td><code>pause_when_empty</code></td><td><code>true/false</code></td><td>没人时暂停世界（true 省 CPU）</td></tr>
    <tr><td><code>intention</code></td><td><code>cooperative</code> / <code>social</code> / <code>competitive</code> / <code>madness</code></td><td>服务器列表的风格标签</td></tr>
    <tr><td><code>vote_kick_enabled</code></td><td><code>true/false</code></td><td>允许玩家投票踢人（小服建议 false）</td></tr>
  </tbody></table>
  <p><b>[NETWORK] 网络段：</b></p>
  <table class="grid"><thead><tr><th>字段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>cluster_name</code></td><td>房间名（玩家列表里看到的）</td></tr>
    <tr><td><code>cluster_description</code></td><td>房间简介</td></tr>
    <tr><td><code>cluster_password</code></td><td>进房密码；留空=公开房</td></tr>
    <tr><td><code>lan_only_cluster</code></td><td>true=只在局域网可见</td></tr>
    <tr><td><code>offline_cluster</code></td><td>true=完全离线（模组和皮肤失效，别用）</td></tr>
    <tr><td><code>whitelist_slots</code></td><td>白名单预留位置数（0=不预留）</td></tr>
    <tr><td><code>tick_rate</code></td><td>服务器心跳频率，默认 15；调高更流畅更吃 CPU</td></tr>
  </tbody></table>
  <p><b>[MISC] 杂项段：</b></p>
  <table class="grid"><thead><tr><th>字段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>console_enabled</code></td><td>允许远程控制台（管理员 ~ 发命令的总开关）</td></tr>
    <tr><td><code>max_snapshots</code></td><td>存档快照保留份数（默认 6；改大能回更多天的档）</td></tr>
    <tr><td><code>autosaver_enabled</code></td><td>每天自动保存（保持 true）</td></tr>
  </tbody></table>
  <p><b>[SHARD] 分片段：</b></p>
  <table class="grid"><thead><tr><th>字段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>shard_enabled</code></td><td>启用分片机制（带洞穴必须 true）</td></tr>
    <tr><td><code>bind_ip</code></td><td>本分片监听内部通信的 IP，同机器 <code>127.0.0.1</code></td></tr>
    <tr><td><code>master_ip</code></td><td>主分片 IP，同机器 <code>127.0.0.1</code></td></tr>
    <tr><td><code>master_port</code></td><td>分片内部通信 TCP 端口，默认 10889，<b>不要对外开放</b></td></tr>
    <tr><td><code>cluster_key</code></td><td>分片间认亲暗号；同集群所有分片必须一致</td></tr>
  </tbody></table>

  <h4>2.3 server.ini 全参数详解</h4>
  <p><b>Master/server.ini：</b></p>
  <div class="doc-pre">[NETWORK]
server_port = 11000

[SHARD]
is_master = true
name = Master
id = 10000

[STEAM]
master_server_port = 27018
authentication_port = 8768

[ACCOUNT]
encode_user_path = true</div>
  <p><b>Caves/server.ini：</b></p>
  <div class="doc-pre">[NETWORK]
server_port = 11001

[SHARD]
is_master = false
name = Caves
id = 10001

[STEAM]
master_server_port = 27019
authentication_port = 8769

[ACCOUNT]
encode_user_path = true</div>
  <table class="grid"><thead><tr><th>字段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>server_port</code></td><td>这个分片对玩家开放的 UDP 端口；<b>每个分片必须不同</b></td></tr>
    <tr><td><code>is_master</code></td><td>true=主分片（整个集群<b>只能有一个</b>）</td></tr>
    <tr><td><code>name</code></td><td>分片名（Caves 就写 Caves）</td></tr>
    <tr><td><code>id</code></td><td>分片数字编号，集群内唯一</td></tr>
    <tr><td><code>master_server_port</code></td><td>Steam 服务器浏览器查询端口（UDP），每个分片不同</td></tr>
    <tr><td><code>authentication_port</code></td><td>Steam 认证端口（UDP），每个分片不同</td></tr>
    <tr><td><code>encode_user_path</code></td><td>玩家数据文件名做 URL 编码，保持 true</td></tr>
  </tbody></table>

  <h4>三、启动与停止</h4>
  <h4>3.1 screen 启动命令</h4>
  <div class="doc-pre">cd /home/steam/dst_server/bin64
screen -dmS dst_master ./dontstarve_dedicated_server_nullrenderer_x64 -cluster MyDediServer -shard Master
screen -dmS dst_caves  ./dontstarve_dedicated_server_nullrenderer_x64 -cluster MyDediServer -shard Caves</div>
  <table class="grid"><thead><tr><th>部分</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>screen</code></td><td>虚拟终端管理器</td></tr>
    <tr><td><code>-dm</code>（合写 <code>-d -m</code>）</td><td>新建会话但不接进去（后台创建）</td></tr>
    <tr><td><code>-S dst_master</code></td><td>给会话起名字，以后 <code>screen -r dst_master</code> 靠名字找</td></tr>
    <tr><td><code>-cluster MyDediServer</code></td><td>用哪个集群</td></tr>
    <tr><td><code>-shard Master</code></td><td>这个进程当哪个分片</td></tr>
  </tbody></table>

  <h4>3.2 查看控制台 / 接入 screen 会话</h4>
  <div class="doc-pre">screen -ls                     # 列出所有 screen 会话
screen -r dst_master           # 接入地面世界会话（看实时控制台输出）
                               # 退出 screen（不关服务器）：按 Ctrl+A 再按 D
screen -r dst_caves            # 接入洞穴会话</div>
  <div class="doc-warn">⚠ 按 <code>Ctrl+C</code> 或输入 <code>exit</code> 会<b>直接关闭服务器</b>。只是暂时退出查看要按 <code>Ctrl+A</code> 然后 <code>D</code>（detach 分离）。</div>

  <h4>3.3 向 screen 会话"隔空发命令"（不接入会话）</h4>
  <div class="doc-pre">screen -S dst_master -X stuff $'c_announce("服务器5分钟后重启")\n'</div>
  <table class="grid"><thead><tr><th>部分</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>-S dst_master</code></td><td>指定目标会话名</td></tr>
    <tr><td><code>-X</code></td><td>向会话发送控制指令（不进会话，隔空操作）</td></tr>
    <tr><td><code>stuff</code></td><td>具体指令=塞入一段"键盘输入"</td></tr>
    <tr><td><code>$'...\n'</code></td><td>bash 转义：<code>\n</code> 变成真正的回车。<b>少了它命令只打进去不执行</b></td></tr>
  </tbody></table>

  <h4>3.4 优雅停止（先存档再关）</h4>
  <div class="doc-pre"># 先发公告
screen -S dst_master -X stuff $'c_announce("服务器即将关闭")\n'

# 优雅关闭（c_shutdown 会先存档再退出）
screen -S dst_master -X stuff $'c_shutdown()\n'
screen -S dst_caves  -X stuff $'c_shutdown()\n'

# 30 秒还不退再强杀
ps aux | grep dontstarve | grep -v grep    # 查看进程号
kill 进程号                                 # 温和终止
kill -9 进程号                              # 强制终止（最后手段）</div>

  <h4>四、模组手动管理</h4>
  <h4>4.1 找模组 ID</h4>
  <p>创意工坊模组页面网址：<code>https://steamcommunity.com/sharedfiles/filedetails/?id=1965741394</code>。<b><code>id=</code> 后面那串数字就是模组 ID</b>（1965741394 = 海难）。</p>

  <h4>4.2 编辑 dedicated_server_mods_setup.lua（声明下载）</h4>
  <div class="doc-pre">nano /home/steam/dst_server/mods/dedicated_server_mods_setup.lua</div>
  <p>加入：</p>
  <div class="doc-pre">ServerModSetup("1965741394")
ServerModSetup("1185229307")
ServerModCollectionSetup("1234567890")   -- 下载整个合集</div>
  <p>这个文件是游戏官方预留的"开机购物清单"：服务器<b>每次启动</b>都读它，发现没下载或版本旧就自动从创意工坊拉取。</p>

  <h4>4.3 编辑 modoverrides.lua（启用与配置）</h4>
  <p><b>Master 和 Caves 两份都要改</b>：</p>
  <div class="doc-pre">nano ~/.klei/DoNotStarveTogether/MyDediServer/Master/modoverrides.lua
nano ~/.klei/DoNotStarveTogether/MyDediServer/Caves/modoverrides.lua</div>
  <p>内容：</p>
  <div class="doc-pre">return {
  ["workshop-1185229307"] = {
    enabled = true,
    configuration_options = {},
  },
  ["workshop-1965741394"] = {
    enabled = true,
    configuration_options = {
      ["coffee"] = 1,
    },
  },
  ["workshop-367546858"] = {       -- 语言包类：放在最后一项
    enabled = true,
    configuration_options = {},
  },
}</div>
  <table class="grid"><thead><tr><th>字段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>return { ... }</code></td><td>Lua 语法：这个文件"返回一张表"，游戏启动时读取它</td></tr>
    <tr><td><code>["workshop-1965741394"]</code></td><td>键名，固定格式 <code>workshop-模组ID</code>，<b>方括号引号都不能少</b></td></tr>
    <tr><td><code>enabled = true</code></td><td>开关：true 启用 / false 停用</td></tr>
    <tr><td><code>configuration_options = {}</code></td><td>模组自定义参数表；空 <code>{}</code> = 全部用默认值</td></tr>
    <tr><td><code>["coffee"] = 1</code></td><td>一个具体参数：键名和取值从模组 <code>modinfo.lua</code> 抄</td></tr>
    <tr><td>每行结尾的 <code>,</code></td><td>Lua 表分隔符，<b>漏逗号是最常见的崩服原因</b></td></tr>
  </tbody></table>
  <div class="doc-warn">⚠ 语言包类模组<b>必须放在 modoverrides.lua 的最后一项</b>——因为模组按顺序加载，后加载的覆盖先加载的，语言包最后加载才能把前面所有模组的文本统一翻译。</div>

  <h4>4.4 modinfo.lua 关键字段说明</h4>
  <p>每个模组根目录都有 <code>modinfo.lua</code>，它是模组的"名片"，关键字段：</p>
  <table class="grid"><thead><tr><th>字段</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>name</code></td><td>模组显示名</td></tr>
    <tr><td><code>author</code></td><td>作者</td></tr>
    <tr><td><code>version</code></td><td>版本号</td></tr>
    <tr><td><code>api_version</code></td><td>需要的游戏 API 版本（当前为 10）</td></tr>
    <tr><td><code>dst_compatible</code></td><td>是否兼容 DST 联机版</td></tr>
    <tr><td><code>all_clients_require_mod</code></td><td>true=所有玩家必须装这个模组才能进服</td></tr>
    <tr><td><code>client_only_mod</code></td><td>true=纯客户端模组（服务器不用装）</td></tr>
    <tr><td><code>server_filter_tags</code></td><td>服务器列表搜索标签</td></tr>
    <tr><td><code>configuration_options</code></td><td>模组设置项定义（面板/开房界面照它生成选项）</td></tr>
  </tbody></table>

  <h4>4.5 手动下载模组（不等重启）</h4>
  <div class="doc-pre">cd ~/steamcmd
./steamcmd.sh +login anonymous +workshop_download_item 322330 1965741394 +quit
# 322330 = DST 游戏本体 AppID（不是服务端的 343050！）
# 产物在 ~/Steam/steamapps/workshop/content/322330/1965741394/
cp -r ~/Steam/steamapps/workshop/content/322330/1965741394 /home/steam/dst_mods/</div>

  <h4>五、管理员与黑名单</h4>
  <h4>5.1 管理员名单 adminlist.txt</h4>
  <div class="doc-pre">nano ~/.klei/DoNotStarveTogether/MyDediServer/adminlist.txt</div>
  <p>每行一个 KU_ID：</p>
  <div class="doc-pre">KU_cZLtq95O
KU_abcdefgh</div>

  <h4>5.2 黑名单 blocklist.txt</h4>
  <div class="doc-pre">nano ~/.klei/DoNotStarveTogether/MyDediServer/blocklist.txt</div>
  <p>每行一个 KU_ID，后面可空格加备注：</p>
  <div class="doc-pre">KU_aaaaaaa 偷东西，2026-07-30 封
KU_bbbbbbb 骂人</div>

  <h4>5.3 白名单 whitelist.txt（预留位）</h4>
  <div class="doc-pre">nano ~/.klei/DoNotStarveTogether/MyDediServer/whitelist.txt</div>
  <p>每行一个 KU_ID。还要在 <code>cluster.ini</code> 设 <code>whitelist_slots = 2</code> 才生效。</p>

  <h4>5.4 生效时机（重要！）</h4>
  <table class="grid"><thead><tr><th>操作</th><th>改文件后什么时候生效</th></tr></thead><tbody>
    <tr><td>管理员（adminlist.txt）</td><td><b>下次玩家加入时</b>或重启服务器后生效。已经在玩的玩家需要重新登录才能获得管理员权限</td></tr>
    <tr><td>封禁（blocklist.txt）</td><td><b>新加入的玩家立即生效</b>（连进来就被拒）。已经在服上的在线玩家<b>不会被立即踢</b>——要用控制台 <code>TheNet:Ban("KU_xxx")</code> 才能立即赶走</td></tr>
    <tr><td>解封</td><td>从 blocklist.txt 删掉 KU_ID + 重启服务器；或控制台 <code>TheNet:Unban("KU_xxx")</code></td></tr>
    <tr><td>控制台 TheNet:Ban</td><td><b>立即生效</b>（在线玩家马上被踢），但只持续到下次重启</td></tr>
    <tr><td>控制台 TheNet:Kick</td><td><b>立即踢出</b>，但对方可以马上重连</td></tr>
  </tbody></table>
  <div class="doc-warn">⚠ <b>控制台命令管"现在"，文件管"以后"</b>。要永久封人：先 <code>TheNet:Ban("KU_xxx")</code> 立即赶走，同时写进 blocklist.txt 保证重启后依然封禁。</div>

  <h4>5.5 怎么找玩家的 KU_ID</h4>
  <div class="doc-pre">grep "玩家名" ~/.klei/DoNotStarveTogether/MyDediServer/Master/server_log.txt
# 输出里 Join Announcement 行有 KU_ 开头的 ID</div>
  <p>或者在控制台输入 <code>c_listallplayers()</code> 会列出在线玩家及其编号。</p>

  <h4>六、控制台命令大全</h4>
  <p>命令发送方式有两种：</p>
  <ul>
    <li><b>方式一</b>：<code>screen -r dst_master</code> 进去直接敲（服务器本地控制台）</li>
    <li><b>方式二</b>：管理员在游戏客户端里按 <code>~</code> 键，切到"远程"模式输入——命令发到服务器执行</li>
    <li><b>方式三</b>（隔空）：<code>screen -S dst_master -X stuff $'c_save()\n'</code></li>
  </ul>

  <p><b>服务器管理类命令：</b></p>
  <table class="grid"><thead><tr><th>命令</th><th>作用</th></tr></thead><tbody>
    <tr><td><code>c_save()</code></td><td>立刻保存存档</td></tr>
    <tr><td><code>c_shutdown()</code></td><td>保存并关闭这个分片</td></tr>
    <tr><td><code>c_rollback()</code></td><td>回档一天（回到上一份快照）</td></tr>
    <tr><td><code>c_rollback(3)</code></td><td>回档三天（括号里是天数）</td></tr>
    <tr><td><code>c_regenerateworld()</code></td><td><b>重新生成当前世界</b>（慎用！世界清空重新来）</td></tr>
    <tr><td><code>c_announce("文字")</code></td><td>全服滚动公告</td></tr>
    <tr><td><code>c_listallplayers()</code></td><td>列出在线玩家（名字+编号+KU_ID）</td></tr>
    <tr><td><code>TheNet:Ban("KU_xxxxx")</code></td><td>封人（立即生效，本次运行内进不来）</td></tr>
    <tr><td><code>TheNet:Unban("KU_xxxxx")</code></td><td>解封</td></tr>
    <tr><td><code>TheNet:Kick("KU_xxxxx")</code></td><td>踢人（立即生效，可重进）</td></tr>
    <tr><td><code>TheNet:SetAllowIncomingConnections(true/false)</code></td><td>临时关门/开门（true 允许进，false 拒绝所有人）</td></tr>
  </tbody></table>

  <p><b>游戏作弊/调试类命令（管理员用）：</b></p>
  <table class="grid"><thead><tr><th>命令</th><th>作用</th></tr></thead><tbody>
    <tr><td><code>c_spawn("物品代码", 数量)</code></td><td>在鼠标位置生成物品，如 <code>c_spawn("log", 40)</code></td></tr>
    <tr><td><code>c_give("物品代码", 数量)</code></td><td>直接进自己背包</td></tr>
    <tr><td><code>c_godmode()</code></td><td>无敌（再输一次取消）</td></tr>
    <tr><td><code>c_sethealth(1)</code> / <code>c_sethunger(1)</code> / <code>c_setsanity(1)</code></td><td>设血量/饥饿/精神（1=100%，0.5=一半）</td></tr>
    <tr><td><code>c_speedmult(2)</code></td><td>移速加倍</td></tr>
    <tr><td><code>c_goto(AllPlayers[编号])</code></td><td>传送到某个玩家身边</td></tr>
    <tr><td><code>c_teleportto(x, y, z)</code></td><td>传送到坐标</td></tr>
    <tr><td><code>UserToPlayer("玩家名")</code></td><td>按名字获取玩家对象，如 <code>UserToPlayer("Wilson"):SetHealth(1)</code></td></tr>
    <tr><td><code>TheWorld:PushEvent("ms_setseason", "winter")</code></td><td>直接改季节（spring/summer/autumn/winter）</td></tr>
    <tr><td><code>TheWorld:PushEvent("ms_nextphase")</code></td><td>跳过当前时间段（白天→黄昏→夜晚）</td></tr>
    <tr><td><code>TheWorld:PushEvent("ms_forceprecipitation", true)</code></td><td>强制开始下雨（false=停止下雨）</td></tr>
    <tr><td><code>LongUpdate(480)</code></td><td>快进一段时间（480 秒=一游戏天）</td></tr>
    <tr><td><code>c_countprefabs("spiderden")</code></td><td>数世界上有多少个蜘蛛巢</td></tr>
  </tbody></table>
  <div class="doc-tip">💡 物品代码就是英文物品名（log=木头、rocks=石头、cutgrass=草……），模组的物品代码在模组文件的 <code>scripts/prefabs/</code> 里找。</div>

  <h4>七、日志文件</h4>
  <h4>7.1 日志文件位置</h4>
  <table class="grid"><thead><tr><th>文件</th><th>位置</th><th>内容</th></tr></thead><tbody>
    <tr><td><code>server_log.txt</code></td><td><code>~/.klei/DoNotStarveTogether/MyDediServer/Master/server_log.txt</code></td><td>运行日志：玩家进出、死亡公告、远程命令、报错信息</td></tr>
    <tr><td><code>server_chat_log.txt</code></td><td>同目录</td><td>聊天记录：公聊、私聊、公告、加入/离开消息</td></tr>
    <tr><td>Caves 日志</td><td><code>~/.klei/DoNotStarveTogether/MyDediServer/Caves/server_log.txt</code></td><td>洞穴分片的运行/聊天日志（分开记录）</td></tr>
  </tbody></table>

  <h4>7.2 实时查看日志</h4>
  <div class="doc-pre"># 实时跟踪日志末尾（Ctrl+C 退出）
tail -f ~/.klei/DoNotStarveTogether/MyDediServer/Master/server_log.txt

# 只看最近 100 行
tail -100 ~/.klei/DoNotStarveTogether/MyDediServer/Master/server_log.txt

# 搜索某个玩家名的所有记录
grep "玩家名" ~/.klei/DoNotStarveTogether/MyDediServer/Master/server_log.txt

# 搜索报错信息
grep -i error ~/.klei/DoNotStarveTogether/MyDediServer/Master/server_log.txt

# 搜索模组相关日志
tail -f ~/.klei/DoNotStarveTogether/MyDediServer/Master/server_log.txt | grep -i mod</div>
  <table class="grid"><thead><tr><th>命令</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>tail -f</code></td><td>显示文件末尾并持续跟踪新内容（follow），按 Ctrl+C 退出</td></tr>
    <tr><td><code>tail -100</code></td><td>显示最后 100 行</td></tr>
    <tr><td><code>grep "关键词"</code></td><td>在文件中搜索包含关键词的行</td></tr>
    <tr><td><code>grep -i</code></td><td>忽略大小写搜索</td></tr>
    <tr><td><code>|</code>（管道）</td><td>前一条的输出当后一条的输入</td></tr>
  </tbody></table>
  <div class="doc-tip">💡 日志文件会一直追加，重启不清空。找 KU_ID 就去搜 Join Announcement 行；找谁用过控制台就搜 RemoteCommandInput 行。</div>

  <h4>八、备份与恢复</h4>
  <h4>8.1 手动备份</h4>
  <div class="doc-pre"># 方法 A：直接复制目录（最简单）
cp -r ~/.klei/DoNotStarveTogether/MyDediServer ~/dst_backup_$(date +%Y%m%d)

# 方法 B：打包压缩（省空间）
cd ~/.klei/DoNotStarveTogether
tar -czf /home/steam/backup_MyDediServer_$(date +%Y%m%d).tar.gz MyDediServer</div>
  <table class="grid"><thead><tr><th>部分</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>cp -r</code></td><td>递归复制目录（r=recursive）</td></tr>
    <tr><td><code>$(date +%Y%m%d)</code></td><td>命令替换：把当天日期（如 20260730）嵌进文件名</td></tr>
    <tr><td><code>tar -czf</code></td><td>c=创建压缩包、z=gzip 压缩、f=跟输出文件名</td></tr>
  </tbody></table>
  <div class="doc-tip">💡 只需备份 <code>.klei</code> 下的集群目录，<b>游戏程序不用备</b>（随时可以用 steamcmd 重下）。</div>

  <h4>8.2 恢复备份</h4>
  <div class="doc-pre">cd ~/.klei/DoNotStarveTogether
tar -xzf /home/steam/backup_MyDediServer_20260730.tar.gz
chown -R steam:steam MyDediServer    # 如果用 root 解压过才需要改属主</div>

  <h4>8.3 回档（rollback 存档机制）</h4>
  <p>DST 每天自动保存时会生成快照（存档副本），放在 <code>save/session/</code> 目录下，编号越大越新：</p>
  <div class="doc-pre">cd ~/.klei/DoNotStarveTogether/MyDediServer/Master/save/session/
ls -la
# 输出示例：
# 0000000023  0000000023.meta  0000000024  0000000024.meta  0000000025  0000000025.meta</div>
  <p><b>在线回档（推荐）</b>：</p>
  <div class="doc-pre">screen -S dst_master -X stuff $'c_rollback(2)\n'   # 回 2 天</div>
  <p><b>离线回档</b>（删掉最新的快照）：</p>
  <div class="doc-pre"># 要回 2 天就删掉最新 2 组：
rm -rf 0000000024 0000000024.meta 0000000025 0000000025.meta
# ⚠ 删错无法恢复！先确认编号！
# 然后启动服务器，它会加载 0000000023（两天前的状态）</div>
  <table class="grid"><thead><tr><th>概念</th><th>说明</th></tr></thead><tbody>
    <tr><td><code>0000000024</code>（目录）</td><td>一次完整存档快照（世界全部状态）</td></tr>
    <tr><td><code>0000000024.meta</code></td><td>该快照的"名片"（天数、时间等信息）</td></tr>
    <tr><td><code>max_snapshots</code></td><td>cluster.ini 里的快照保留份数（默认 6）；想回更久就调大</td></tr>
  </tbody></table>
  <div class="doc-warn">⚠ <b>Caves 也要同步回档！</b> 两个分片各自有 session 目录，回档天数要一致，否则地上地下时间错位。回档操作本身也生成了快照，<b>无法反向回到现在</b>——想后悔得提前备份。</div>

  <h4>8.4 定时自动备份（cron）</h4>
  <div class="doc-pre">crontab -e</div>
  <p>加一行（每天凌晨 3:30 自动备份）：</p>
  <div class="doc-pre">30 3 * * * cd /home/steam/.klei/DoNotStarveTogether && tar -czf /home/steam/backup_$(date +\%Y\%m\%d).tar.gz MyDediServer</div>
  <div class="doc-warn">⚠ crontab 里的 <code>%</code> 要写成 <code>\%</code>（% 在 cron 里是换行符的意思）。</div>
</div>`;

// ---- 模组迁移指南 ----
const HELP_MIGRATE = `
<div class="card help-doc">
  <h3>📦 饥荒联机版（DST）专用服务器模组迁移指南</h3>
  <div class="doc-info">本文档基于对实际文件结构的分析，并结合多方搭建教程整理。适用于将本地（客户端）已订阅/已启用的模组迁移到专用服务器上运行。</div>

  <h4>一、关键概念：本地模组 vs 服务器模组</h4>
  <table class="grid"><thead><tr><th>类型</th><th>说明</th><th>谁需要安装</th></tr></thead><tbody>
    <tr><td><b>服务器模组</b></td><td><code>modinfo.lua</code> 中 <code>client_only_mod = false</code>，运行在服务端，影响世界规则、生物、物品等。若 <code>all_clients_require_mod = true</code>，则所有进入服务器的玩家都必须订阅该模组。</td><td>服务器<b>必须</b>安装</td></tr>
    <tr><td><b>客户端模组</b></td><td><code>modinfo.lua</code> 中 <code>client_only_mod = true</code>，只影响使用它的玩家本地（如 UI 美化、小地图标记等），不影响世界。</td><td>服务器<b>不需要</b>安装，玩家自行订阅即可</td></tr>
  </tbody></table>
  <div class="doc-warn">⚠ 迁移时<b>只需要迁移服务器模组</b>；纯客户端模组无需放到服务器。</div>

  <h4>二、模组的两个存放位置</h4>
  <p>饥荒联机版的 Steam App ID 为 <b>322330</b>。模组在本机有两个相关目录：</p>

  <h5>1. 游戏安装目录下的 mods 文件夹（服务器实际读取的位置）</h5>
  <div class="doc-pre">D:\\steam\\steamapps\\common\\Don't Starve Together\\mods\\</div>
  <p>该目录下的模组文件夹以 <b><code>workshop-{模组ID}</code></b> 命名，例如：</p>
  <div class="doc-pre">mods/
├── dedicated_server_mods_setup.lua   ← 服务器启动时自动下载模组的配置文件
├── modsettings.lua                   ← 客户端强制启用/调试用配置
├── workshop-362175979/               ← 例：Wormhole Marks（虫洞标记）
│   ├── modinfo.lua
│   ├── modmain.lua
│   ├── modicon.xml / modicon.tex
│   └── scripts/
└── workshop-1216718131/</div>
  <div class="doc-info">专用服务器和客户端共享同一个 <code>mods</code> 文件夹。如果你在本机同时安装了客户端和 DST Dedicated Server 工具，它们读取的是同一个目录。</div>

  <h5>2. Steam 创意工坊缓存目录（Steam 自动下载的原始位置）</h5>
  <div class="doc-pre">D:\\steam\\steamapps\\workshop\\content\\322330\\</div>
  <p>Steam 订阅模组后，文件首先下载到这里，文件夹名<b>仅为纯数字 ID</b>（无 <code>workshop-</code> 前缀）。</p>
  <div class="doc-info">Steam 客户端在启动饥荒时会自动把这里的模组同步/解包到上面的 <code>mods\\workshop-{ID}</code> 目录中。<b>专用服务器不会自动做这个同步</b>，所以服务器迁移时需要手动处理。</div>

  <h5>模组 ID 从哪里获取？</h5>
  <ul>
    <li>创意工坊页面 URL 末尾的数字即为模组 ID，例如：<br><code>https://steamcommunity.com/sharedfiles/filedetails/?id=362175979</code> → ID 为 <code>362175979</code></li>
    <li>在游戏内模组列表中右键 → 复制网页链接，同样取末尾数字。</li>
  </ul>

  <h4>三、模组文件结构分析</h4>
  <p>每个模组文件夹的核心文件是 <b><code>modinfo.lua</code></b>，它决定了模组的元数据和加载行为。关键字段：</p>
  <div class="doc-pre">name = "Wormhole Marks"              -- 模组名称
version = "1.4.5"                    -- 版本号
api_version = 10                     -- API 版本（10 = DST）

-- ★ 以下三个字段决定了模组在服务器上的行为
all_clients_require_mod = true       -- true: 所有进服玩家都必须安装此模组
client_only_mod = false              -- true: 纯客户端模组，服务器无需安装
dst_compatible = true                -- 是否兼容联机版

configuration_options = { ... }      -- 模组的可配置选项</div>
  <table class="grid"><thead><tr><th>字段</th><th>值</th><th>含义</th></tr></thead><tbody>
    <tr><td><code>all_clients_require_mod</code></td><td><code>true</code></td><td>进服玩家必须订阅，否则无法加入</td></tr>
    <tr><td><code>all_clients_require_mod</code></td><td><code>false</code></td><td>仅服务器需要，玩家可选</td></tr>
    <tr><td><code>client_only_mod</code></td><td><code>true</code></td><td>纯客户端，<b>服务器不需要装</b></td></tr>
    <tr><td><code>client_only_mod</code></td><td><code>false</code></td><td>服务器模组，服务器必须装</td></tr>
  </tbody></table>

  <h4>四、服务器加载模组的三种方式（核心）</h4>
  <p>专用服务器加载模组涉及<b>两个层面</b>，缺一不可：</p>
  <div class="doc-pre">┌─────────────────────────────────────────────────────────┐
│  第一层：模组文件存在于服务器 mods 目录（下载/复制）       │
│         → 通过 dedicated_server_mods_setup.lua 或手动复制 │
├─────────────────────────────────────────────────────────┤
│  第二层：在存档中启用并配置模组                          │
│         → 通过 modoverrides.lua                          │
└─────────────────────────────────────────────────────────┘</div>
  <p>只有文件没有启用，模组不会生效；只有启用配置没有文件，服务器会报错。<b>两者必须同时满足。</b></p>

  <h5>方式一：自动下载（推荐，需服务器能联网 Steam）</h5>
  <p>编辑服务器 <code>mods</code> 目录下的 <b><code>dedicated_server_mods_setup.lua</code></b>：</p>
  <div class="doc-pre">-- 每行一个模组 ID，服务器启动时会自动从创意工坊下载
ServerModSetup("362175979")    -- Wormhole Marks
ServerModSetup("378160979")    -- Global Player Positions
ServerModSetup("1216718131")   -- 中文翻译

-- 也可以下载整个创意工坊合集
-- ServerModCollectionSetup("合集ID")</div>
  <div class="doc-info">此文件原始内容只有注释模板，需手动添加 <code>ServerModSetup("ID")</code> 行。服务器每次启动都会检查并更新这些模组。</div>

  <h5>方式二：手动复制模组文件夹（服务器无法联网时使用）</h5>
  <ol>
    <li>在本机找到模组文件夹（两个位置任选其一）：<br>
      来源 A：<code>D:\\steam\\steamapps\\common\\Don't Starve Together\\mods\\workshop-{ID}\\</code><br>
      来源 B：<code>D:\\steam\\steamapps\\workshop\\content\\322330\\{ID}\\</code></li>
    <li>将该文件夹整体复制到服务器的 mods 目录：<br>
      目标：<code>服务器安装目录\\mods\\workshop-{ID}\\</code></li>
    <li>复制完不需要修改 <code>dedicated_server_mods_setup.lua</code>（因为文件已存在，无需下载）。</li>
  </ol>
  <div class="doc-warn">⚠ 放到服务器 <code>mods</code> 目录时，文件夹名必须是 <b><code>workshop-{ID}</code></b> 格式（带 <code>workshop-</code> 前缀）。如果来源是创意工坊缓存目录（纯数字 ID），复制后需重命名加上 <code>workshop-</code> 前缀。</div>

  <h5>方式三：在存档中启用并配置模组（必须）</h5>
  <p>无论用方式一还是方式二把模组文件放好，都还必须通过 <b><code>modoverrides.lua</code></b> 告诉服务器"启用哪些模组、用什么配置"。</p>
  <p><b><code>modoverrides.lua</code> 的位置（每个世界分片各一份）：</b></p>
  <div class="doc-pre">存档根目录\\Cluster_1\\
├── cluster.ini              ← 集群配置（服务器名、密码、人数等）
├── Master\\                  ← 地表世界分片
│   ├── server.ini
│   ├── worldgenoverride.lua
│   ├── modoverrides.lua     ← ★ 地表模组启用配置
│   └── save\\
└── Caves\\                   ← 洞穴世界分片
    ├── server.ini
    ├── worldgenoverride.lua
    ├── modoverrides.lua     ← ★ 洞穴模组启用配置
    └── save\\</div>
  <p>存档根目录通常位于：</p>
  <div class="doc-pre">Windows:  %USERPROFILE%\\Documents\\Klei\\DoNotStarveTogether\\Cluster_1\\
Linux:    ~/.klei/DoNotStarveTogether/Cluster_1/</div>
  <p><b><code>modoverrides.lua</code> 格式：</b></p>
  <div class="doc-pre">return {
  ["workshop-362175979"] = {
    configuration_options = {
      ["Draw over FoW"] = "disabled"     -- 对应 modinfo.lua 中的配置项
    },
    enabled = true                        -- ★ true 表示启用
  },

  ["workshop-378160979"] = {
    configuration_options = {
      ENABLEPINGS = true,
      FIREOPTIONS = 2,
      SHOWPLAYERICONS = true
    },
    enabled = true
  },

  -- 最简写法（不配置选项，仅启用）：
  ["workshop-1216718131"] = { enabled = true },
}</div>
  <div class="doc-info">Master 和 Caves 两个 <code>modoverrides.lua</code> 的内容通常保持一致。如果模组只在某个分片生效，也可只写在对应分片里。</div>

  <h4>五、完整迁移流程（从本机到远程服务器）</h4>

  <h5>第一步：在本机确认模组列表和配置</h5>
  <p>最简单的方法是<b>本机新建一个世界 → 在游戏内勾选并配置好所有模组 → 生成世界进入选人界面后退出</b>。这样游戏会自动生成一份完整的 <code>modoverrides.lua</code>。</p>

  <h5>第二步：把模组文件放到服务器</h5>
  <p><b>如果服务器能联网（推荐方式一）：</b></p>
  <p>编辑服务器的 <code>mods\\dedicated_server_mods_setup.lua</code>，根据 <code>modoverrides.lua</code> 中所有 <code>workshop-{ID}</code> 的 ID 列表，逐个添加 <code>ServerModSetup("ID")</code>。</p>
  <p><b>如果服务器不能联网（方式二）：</b></p>
  <p>把本机 <code>mods\\workshop-{ID}\\</code> 文件夹逐个打包上传到服务器 <code>mods</code> 目录下。</p>

  <h5>第三步：把 modoverrides.lua 放到服务器存档</h5>
  <p>将第一步得到的 <code>modoverrides.lua</code> 复制到服务器存档的 <b>Master</b> 和 <b>Caves</b> 文件夹中。</p>

  <h5>第四步：启动服务器验证</h5>
  <p>启动专用服务器，观察日志（<code>master_server_log.txt</code> / <code>server_log.txt</code>）：</p>
  <ul>
    <li>出现 <code>Sim paused</code> 表示启动成功。</li>
    <li>如果模组加载失败，日志会显示缺失的模组 ID 或配置错误。</li>
  </ul>

  <h4>六、本机实际文件对照表</h4>
  <table class="grid"><thead><tr><th>文件</th><th>路径</th><th>作用</th></tr></thead><tbody>
    <tr><td>服务器模组下载配置</td><td><code>mods\\dedicated_server_mods_setup.lua</code></td><td>启动时自动从创意工坊下载模组</td></tr>
    <tr><td>客户端模组调试配置</td><td><code>mods\\modsettings.lua</code></td><td>开发调试用（ForceEnableMod 等）</td></tr>
    <tr><td>模组文件夹</td><td><code>mods\\workshop-{ID}\\</code></td><td>服务器实际加载的模组</td></tr>
    <tr><td>创意工坊缓存</td><td><code>steamapps\\workshop\\content\\322330\\{ID}\\</code></td><td>Steam 自动下载的原始文件</td></tr>
    <tr><td>模组缓存</td><td><code>cached_mods\\{ID}_0\\</code></td><td>游戏加载后的缓存</td></tr>
    <tr><td>存档模组启用配置</td><td><code>Documents\\Klei\\DoNotStarveTogether\\Cluster_1\\Master\\modoverrides.lua</code></td><td>启用哪些模组及其配置</td></tr>
  </tbody></table>

  <h4>七、常见问题</h4>

  <h5>Q1：服务器提示"正在运行旧版本模组"</h5>
  <p>原因：服务器上的模组版本与本机/创意工坊不一致。</p>
  <p>解决：</p>
  <ol>
    <li>停止服务器；</li>
    <li>删除服务器 <code>mods\\</code> 目录下所有 <code>workshop-</code> 文件夹；</li>
    <li>删除 <code>mods\\dedicated_server_mods_setup.lua</code>（或重新编辑）；</li>
    <li>重新配置 <code>dedicated_server_mods_setup.lua</code> 并启动服务器重新下载。</li>
  </ol>

  <h5>Q2：玩家进服提示缺少模组</h5>
  <p>原因：模组的 <code>modinfo.lua</code> 中 <code>all_clients_require_mod = true</code>，但玩家未订阅。</p>
  <p>解决：玩家需在创意工坊订阅对应模组；或在服务器端使用 <code>modoverrides.lua</code> 配置仅为服务端的模组。</p>

  <h5>Q3：模组文件已在 mods 目录但没生效</h5>
  <p>原因：忘记写 <code>modoverrides.lua</code>，或对应模组的 <code>enabled</code> 没有设为 <code>true</code>。</p>
  <p>解决：检查 Master 和 Caves 两个分片的 <code>modoverrides.lua</code>，确保目标模组 <code>enabled = true</code>。</p>

  <h5>Q4：文件夹名前缀问题</h5>
  <ul>
    <li><code>mods\\workshop-{ID}\\</code> —— 必须带 <code>workshop-</code> 前缀。</li>
    <li><code>steamapps\\workshop\\content\\322330\\{ID}\\</code> —— 纯数字，无前缀。</li>
  </ul>
  <p>手动复制时注意转换命名格式。</p>

  <h5>Q5：本地客户端模组是否需要迁移？</h5>
  <p>不需要。<code>client_only_mod = true</code> 的模组（如纯 UI 美化）只影响玩家自己，服务器不加载也不会报错。迁移时通过 <code>modinfo.lua</code> 判断即可。</p>

  <h4>八、参考来源</h4>
  <ul>
    <li><a href="https://www.bilibili.com/opus/1028887869946593282" target="_blank">饥荒专用服务器+mod配置 - 哔哩哔哩</a></li>
    <li><a href="https://blog.csdn.net/X123453ZW/article/details/131622759" target="_blank">饥荒联机版专用服务器搭建教程 - CSDN</a></li>
    <li><a href="https://cloud.tencent.com/developer/article/2510270" target="_blank">手把手教你搭饥荒专用服务器（三）—MOD及其他高级设置 - 腾讯云</a></li>
    <li><a href="https://harmonytou.github.io/2024/01/01/start-a-donotstarvetogether-server/" target="_blank">使用Linux搭建饥荒联机版服务器</a></li>
    <li><a href="https://www.frank9.com/solve-dst-old-mods-tips.html" target="_blank">如何解决：服务器正在运行旧版本模组</a></li>
    <li><a href="https://blog.csdn.net/violateer/article/details/108293805" target="_blank">搭建steam饥荒专用（本地）服务器 - CSDN</a></li>
    <li><a href="https://blog.51cto.com/u_13633/13805694" target="_blank">docker搭建饥荒服务器 - 51CTO</a></li>
  </ul>
</div>`;

// ============ 启动 ============
renderTabs();
startTopFx();
// 后台预加载物品数据，不阻塞界面切换
apiQuiet("items").then((j) => { if (j) consoleState.items = j.data; });
route();
