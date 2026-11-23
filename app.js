// Macro Log: a personal food/macro tracker. Static site, no server.
// Data lives in localStorage and (optionally) syncs to a private GitHub repo.

import { GENERIC_FOODS } from "./foods.js?v=8";
import { computeGame, questsFor, autoJunk, isJunkName, XP, lpForLevel, levelFromXP, weekRecap, mondayOf } from "./game.js?v=8";
import { emblemSVG, rankFor, TIERS, firstLevelOfTier } from "./ranks.js?v=8";

const BARCODE_PONYFILL_URL = "https://cdn.jsdelivr.net/npm/barcode-detector@3.2.3/ponyfill/+esm";

const DATA_KEY = "mt-data-v1";
const SECRET_KEY = "mt-secrets-v1";
const MEALS = [
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
  ["snacks", "Snacks"],
];
const NK = ["kcal", "p", "c", "f", "na"];
const NLABEL = { kcal: "kcal", p: "Protein", c: "Carbs", f: "Fat", na: "Sodium" };
const NUNIT = { kcal: "", p: "g", c: "g", f: "g", na: "mg" };

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const r0 = (n) => Math.round(n || 0);
const r1 = (n) => Math.round((n || 0) * 10) / 10;
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return localDate(new Date(y, m - 1, d + n));
}
function prettyDate(dateStr) {
  const today = localDate();
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  if (dateStr === addDays(today, 1)) return "Tomorrow";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function scale(per100, grams) {
  const o = {};
  for (const k of NK) o[k] = ((per100?.[k] || 0) * (grams || 0)) / 100;
  return o;
}
function sum(list) {
  const o = { kcal: 0, p: 0, c: 0, f: 0, na: 0 };
  for (const e of list) for (const k of NK) o[k] += e.n?.[k] || 0;
  return o;
}
function guessMeal() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  if (h < 10.5) return "breakfast";
  if (h < 15) return "lunch";
  if (h >= 17 && h < 21.5) return "dinner";
  return "snacks";
}
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
function mealOptions(sel) {
  sel.innerHTML = MEALS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
}

// ---------- storage ----------
function emptyDb() {
  return {
    foods: {}, entries: {}, weights: {}, templates: {},
    settings: { targets: { kcal: 1872, p: 140, c: 164, f: 73, na: 2300 }, maintenance: 2372, goalKg: null, fasting: { on: false, hours: 16 }, updatedAt: 0 },
  };
}
function normalizeDb(d) {
  const e = emptyDb();
  const out = { ...e, ...d };
  out.weights = out.weights || {};
  out.templates = out.templates || {};
  out.settings = { ...e.settings, ...(d.settings || {}) };
  return out;
}
function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(DATA_KEY));
    if (d && d.foods && d.entries) return normalizeDb(d);
  } catch {}
  return emptyDb();
}
const COLLS = ["foods", "entries", "weights", "templates"];
let db = loadDb();
function persist() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(db)); } catch { toast("Couldn't save on this device"); }
}
function save() { persist(); scheduleSync(); }
function upsert(coll, rec) {
  rec.updatedAt = Date.now();
  db[coll][rec.id] = rec;
  save();
}
function remove(coll, id) {
  const rec = db[coll][id];
  if (!rec) return;
  db[coll][id] = { id, deleted: true, updatedAt: Date.now(), date: rec.date };
  save();
}
const live = (coll) => Object.values(db[coll]).filter((r) => !r.deleted);

function secrets() {
  try { return JSON.parse(localStorage.getItem(SECRET_KEY)) || {}; } catch { return {}; }
}
function setSecrets(s) {
  try { localStorage.setItem(SECRET_KEY, JSON.stringify(s)); } catch {}
}

// ---------- GitHub sync ----------
const syncConfigured = () => { const s = secrets(); return !!(s.ghOwner && s.ghRepo && s.ghToken); };
let syncing = false, syncAgain = false, syncTimer = null, lastSyncMsg = "";

function setSyncState(state, msg = "") {
  const dot = $("#syncDot");
  dot.className = "sync-dot " + ({ ok: "ok", busy: "busy", err: "err" }[state] || "");
  dot.title = msg || state;
  lastSyncMsg = msg;
  const info = $("#syncInfo");
  if (info) info.textContent = msg;
}
function scheduleSync(delay = 1500) {
  if (!syncConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
async function gh(path, opts = {}) {
  const s = secrets();
  return fetch(`https://api.github.com/repos/${encodeURIComponent(s.ghOwner)}/${encodeURIComponent(s.ghRepo)}/contents/${path}`, {
    ...opts,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${s.ghToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
}
async function pullRemote() {
  const r = await gh("data.json");
  if (r.status === 404) {
    // Either the file doesn't exist yet (fine) or the repo/token is wrong.
    const repo = await fetch(`https://api.github.com/repos/${encodeURIComponent(secrets().ghOwner)}/${encodeURIComponent(secrets().ghRepo)}`, {
      headers: { Authorization: `Bearer ${secrets().ghToken}` }, cache: "no-store",
    });
    if (!repo.ok) throw new Error(`Can't see repo (${repo.status}). Check username, repo name and token access.`);
    return { data: null, sha: null };
  }
  if (r.status === 401) throw new Error("GitHub token rejected (401). It may be expired.");
  if (!r.ok) throw new Error(`GitHub error ${r.status}`);
  const j = await r.json();
  let text;
  if (j.content && j.encoding === "base64") text = b64decode(j.content);
  else text = await (await gh("data.json", { headers: { Accept: "application/vnd.github.raw+json" } })).text();
  return { data: JSON.parse(text), sha: j.sha };
}
function mergeDb(a, b) {
  const out = { foods: {}, entries: {}, weights: {}, templates: {}, settings: a.settings };
  for (const c of COLLS) {
    out[c] = { ...(a[c] || {}) };
    for (const [id, r] of Object.entries(b?.[c] || {})) {
      const cur = out[c][id];
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) out[c][id] = r;
    }
  }
  if ((b?.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0)) out.settings = b.settings;
  return normalizeDb(out);
}
function pruneTombstones(d) {
  const cutoff = Date.now() - 90 * 864e5;
  for (const c of COLLS) for (const [id, r] of Object.entries(d[c] || {})) if (r.deleted && r.updatedAt < cutoff) delete d[c][id];
}
function sameAsRemote(local, remote) {
  if (!remote) return false;
  for (const c of COLLS) {
    const L = local[c] || {}, R = remote[c] || {};
    if (Object.keys(L).length !== Object.keys(R).length) return false;
    for (const id in L) if (!R[id] || R[id].updatedAt !== L[id].updatedAt) return false;
  }
  return (local.settings?.updatedAt || 0) === (remote.settings?.updatedAt || 0);
}
async function syncNow() {
  if (!syncConfigured()) { setSyncState("", "Sync not set up"); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSyncState("busy", "Syncing…");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, sha } = await pullRemote();
      db = data ? mergeDb(db, data) : db;
      pruneTombstones(db);
      persist();
      render();
      if (sameAsRemote(db, data)) break;
      const body = JSON.stringify(db);
      const put = await gh("data.json", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `log ${new Date().toISOString()}`, content: b64encode(body), ...(sha ? { sha } : {}) }),
      });
      if (put.ok) break;
      if (put.status === 409 || put.status === 422) continue; // someone else wrote first; re-pull & merge
      if (put.status === 403 || put.status === 404) throw new Error("Token can't write to the repo. Give it Contents: Read and write.");
      throw new Error(`GitHub save failed (${put.status})`);
    }
    setSyncState("ok", `Synced ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  } catch (e) {
    setSyncState("err", e.message || "Sync failed");
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

// ---------- state ----------
let curDate = localDate();

// ---------- render day ----------
function dayEntries(date) {
  return live("entries").filter((e) => e.date === date).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
// ---------- fasting timer (counts from your last logged food) ----------
function fastingInfo() {
  const f = db.settings.fasting;
  if (!f?.on) return null;
  const now = Date.now(), since = now - 36 * 3600e3;
  const last = live("entries").reduce((m, e) => (e.createdAt > m && e.createdAt > since && e.createdAt <= now ? e.createdAt : m), 0);
  if (!last) return { none: true };
  const el = now - last, goal = (f.hours || 16) * 3600e3;
  return { el, goal, done: el >= goal, opens: new Date(last + goal) };
}
function fastingHtml() {
  const fi = fastingInfo();
  if (!fi) return "";
  if (fi.none) return `<div class="fast" id="fastRow"><span class="muted small">Fasting timer starts from the next food you log.</span></div>`;
  const h = Math.floor(fi.el / 3600e3), m = Math.floor((fi.el % 3600e3) / 60e3);
  const pct = Math.min(100, (fi.el / fi.goal) * 100);
  const opens = fi.opens.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `<div class="fast${fi.done ? " done" : ""}" id="fastRow">
    <div class="mtop"><span>${fi.done ? "Fast complete" : "Fasting"}</span><span class="num"><b>${h}h ${String(m).padStart(2, "0")}m</b><span class="muted"> / ${db.settings.fasting.hours}h</span></span></div>
    <div class="mbar"><i style="width:${pct}%;background:${fi.done ? "var(--lime)" : "var(--f)"}"></i></div>
    <div class="muted small" style="margin-top:4px">${fi.done ? "Eating window is open." : `Eating window opens at ${opens}.`} Counted from your last logged food.</div></div>`;
}
setInterval(() => { const r = $("#fastRow"); if (r) r.outerHTML = fastingHtml(); }, 60000);

// Logged after noon the next day → shown, but earns no LP (see game.js).
function isLate(e) { const [y, m, d] = e.date.split("-").map(Number); return e.createdAt > new Date(y, m - 1, d + 1, 12).getTime(); }

// How the day's calories are split across meals (for per-meal budgets).
const MEAL_SPLIT = { breakfast: 0.25, lunch: 0.35, dinner: 0.3, snacks: 0.1 };
const MEAL_ICON = {
  breakfast: '<path d="M3 18h18M6 18a6 6 0 0 1 12 0M12 6V3M4.9 10.9 3.5 9.5M19.1 10.9l1.4-1.4M7 21h10"/>',
  lunch: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dinner: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  snacks: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
};
function render() {
  $("#dateLabel").textContent = prettyDate(curDate);
  const list = dayEntries(curDate);
  const tot = sum(list);
  const t = db.settings.targets;
  const left = (t.kcal || 0) - tot.kcal;
  const over = left < 0;

  // Hero: calorie ring + macro bars
  const R = 52, C = 2 * Math.PI * R;
  const frac = t.kcal ? Math.min(1, tot.kcal / t.kcal) : 0;
  const macro = (k, label) => {
    const pct = t[k] ? Math.min(100, (tot[k] / t[k]) * 100) : 0;
    return `<div class="mrow"><div class="mtop"><span>${label}</span><span class="num"><b>${r0(tot[k])}</b><span class="muted">/${r0(t[k])}${NUNIT[k]}</span></span></div>
      <div class="mbar"><i style="width:${pct}%;background:var(--${k})"></i></div></div>`;
  };
  $("#summary").innerHTML = `
    <div class="hero">
      <div class="kring${over ? " over" : ""}">
        <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="${R}" class="kr-bg"/>
          <circle cx="60" cy="60" r="${R}" class="kr-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>
        <div class="kr-center"><b class="num">${r0(Math.abs(left)).toLocaleString()}</b><span>${over ? "kcal over" : "kcal left"}</span></div>
      </div>
      <div class="hero-side">
        <div class="eaten"><span class="num"><b>${r0(tot.kcal).toLocaleString()}</b> eaten</span><span class="muted num">${r0(t.kcal).toLocaleString()} goal</span></div>
        ${macro("p", "Protein")}${macro("c", "Carbs")}${macro("f", "Fat")}
      </div>
    </div>
    <div class="hero-foot muted small num">Sodium ${r0(tot.na).toLocaleString()} / ${r0(t.na).toLocaleString()} mg</div>
    ${curDate === localDate() ? fastingHtml() : ""}`;

  // Meals timeline
  const isToday = curDate === localDate();
  const nowMeal = isToday ? guessMeal() : null;
  const yList = dayEntries(addDays(curDate, -1));
  const mains = ["breakfast", "lunch", "dinner"];
  const emptyMains = mains.filter((m) => !list.some((e) => e.meal === m));
  const aim = emptyMains.length ? Math.round(Math.max(0, t.p - tot.p) / emptyMains.length) : 0;
  $("#meals").innerHTML = `<section class="card timeline">${MEALS.map(([key, label]) => {
    const es = list.filter((e) => e.meal === key);
    const st = sum(es);
    const budget = Math.round(t.kcal * MEAL_SPLIT[key]);
    const kc = (g) => (budget ? Math.min(100, (g / budget) * 100) : 0);
    const segs = [["p", st.p * 4], ["c", st.c * 4], ["f", st.f * 9]];
    const mealOver = st.kcal > budget * 1.15;
    const lp = key === "snacks" ? "" : `<span class="cta-lp">+${XP.meal} LP</span>`;
    return `<div class="meal${es.length ? " has" : ""}${key === nowMeal ? " now" : ""}">
      <div class="meal-rail"><div class="meal-icon"><svg viewBox="0 0 24 24">${MEAL_ICON[key]}</svg></div></div>
      <div class="meal-body">
        <div class="meal-top">
          <span class="meal-name">${label}</span>${key === nowMeal ? '<span class="now-pill">Now</span>' : ""}
          <span class="meal-kcal num${mealOver ? " danger-text" : ""}"><b>${r0(st.kcal)}</b><span class="muted"> / ${budget}</span></span>
        </div>
        <div class="meal-bar">${segs.map(([k, v]) => `<i style="width:${kc(v)}%;background:var(--${k})"></i>`).join("")}</div>
        ${!es.length && key !== "snacks" && aim > 0 && key === (emptyMains.includes(nowMeal) ? nowMeal : emptyMains[0]) ? `<div class="aim">Aim for <b>~${aim}g protein</b> here to hit ${t.p}g</div>` : ""}
        ${es.map((e) => `<div class="food${e.junk ? " junk" : ""}" data-entry="${e.id}">
            <span class="avatar">${esc((e.name.match(/[A-Za-z0-9]/) || ["•"])[0].toUpperCase())}</span>
            <div class="grow"><div class="name">${esc(e.name)}${e.junk ? ' <span class="pill bad">junk</span>' : ""}</div>
            <div class="sub num">${r0(e.grams)}g · <span style="color:var(--p)">P ${r0(e.n.p)}</span> · C ${r0(e.n.c)} · F ${r0(e.n.f)}${e.estimated ? " · est." : ""}${isLate(e) ? " · <span class=\"late\">late · no LP</span>" : ""}</div></div>
            <div class="kcal num">${r0(e.n.kcal)}</div></div>`).join("")}
        ${es.length
          ? `<div class="meal-actions"><button class="add-more" data-add="${key}">+ Add to ${label.toLowerCase()}</button><button class="link-btn" data-save-meal="${key}">Save as meal</button></div>`
          : `<button class="log-cta" data-add="${key}"><span>+ Log ${label.toLowerCase()}</span>${lp}</button>${(() => { const y = yList.filter((e) => e.meal === key); return y.length ? `<button class="repeat" data-repeat="${key}"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5"/></svg>Same as yesterday · ${r0(sum(y).kcal)} kcal</button>` : ""; })()}`}
      </div>
    </div>`;
  }).join("")}</section>`;
  renderGame();
}

// ---------- game UI ----------
let game = null;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const xpStr = (x) => (x > 0 ? `+${x}` : `${x}`);
function renderGame() {
  const today = localDate();
  game = computeGame(db, today);
  game.weighedToday = live("weights").some((w) => w.date === today);
  const T = db.settings.targets;
  const pct = Math.min(100, (game.into / game.need) * 100);
  const atRisk = game.level > 1 && game.into < 30;
  const nextIsTier = game.nextRank.tier !== game.rank.tier;
  $("#gameCard").innerHTML = `
    <div class="lvl-row">
      <div class="emblem-wrap tier-${game.rank.id}">${emblemSVG(game.rank.tier, 64)}</div>
      <div class="grow">
        <div class="rank-name" style="--tier:${game.rank.c2}">${esc(game.rank.label)}</div>
        <div class="lpbar${atRisk ? " risk" : ""}"><i style="width:${pct}%;background:${atRisk ? "var(--danger)" : game.rank.c2}"></i></div>
        <div class="muted small lp-text">${game.into} / ${game.need} LP ·
          ${atRisk ? `<span class="danger-text">${game.into} LP from demotion</span>` : `${game.need - game.into} LP to ${nextIsTier ? `<b style="color:${game.nextRank.c2}">${esc(game.nextRank.label)}</b>` : esc(game.nextRank.label)}`}</div>
      </div>
      <div class="streak${game.streak ? " on" : ""}">
        <svg viewBox="0 0 24 24" class="flame"><path d="M12 2c1 3.5 4.5 5.6 4.5 10a4.5 4.5 0 0 1-9 0c0-2 .8-3.3 1.8-4.5.2 1.7 1 2.7 2.2 3.2C11 8 11 5 12 2z"/></svg>
        <b>${game.streak}</b><span class="muted small">streak</span>
        <span class="freeze${game.freezes ? "" : " none"}" title="Streak freezes: a missed day uses one instead of breaking your streak">❄ ${game.freezes}</span>
      </div>
    </div>
    ${weekStrip(today)}`;

  // Banners (only on today's view)
  const banners = [];
  const h = new Date().getHours();
  const td = game.today || { meals: 0, tot: { kcal: 0, p: 0 }, junk: 0, logged: false, xp: 0 };
  if (curDate === today) {
    const y = game.yesterday;
    if (y && !y.logged && y.date >= game.firstDay && h < 12)
      banners.push(["warn", `Yesterday is empty. Log it before <b>12:00</b> to repair it${y.frozen ? " and keep your streak freeze" : " and save your streak"}. <button class=\"banner-btn\" data-action=\"yesterday\">Log yesterday</button>`]);
    else if (y && y.frozen && !td.logged)
      banners.push(["info", `❄ A streak freeze saved your ${game.streak}-day streak yesterday. ${game.freezes} left. Earn more with every 7-day streak.`]);
    else if (y && !y.logged && y.date >= game.firstDay && !td.logged)
      banners.push(["bad", `Nothing logged yesterday: <b>${XP.missed} LP</b> and your streak reset. Log breakfast to start a new one.`]);
    else if (y && y.closed && y.xp < 0 && !td.logged)
      banners.push(["bad", `Yesterday cost you <b>${y.xp} LP</b>. Today's the comeback: ${XP.protein + XP.calOnTarget + XP.meal * 3}+ LP on the table.`]);
    if (h >= 18 && td.meals < 2 && game.streak > 0)
      banners.push(["warn", `Your ${game.streak}-day streak ends at midnight. Log at least 2 main meals to keep it.`]);
    if (td.tot.kcal > T.kcal * 1.05)
      banners.push(["bad", `${r0(td.tot.kcal - T.kcal)} kcal over today's target (${td.tot.kcal > T.kcal * 1.15 ? XP.overBig : XP.overSmall} LP). Stop here: anything else today makes it worse.`]);
    else if (h >= 20 && td.logged && td.tot.p < T.p * 0.85)
      banners.push(["warn", `${r0(T.p - td.tot.p)}g protein to go. A shake or some chicken gets you the +${XP.protein} LP.`]);
  }
  banners.unshift(...safetyBanners());
  $("#banners").innerHTML = banners.map(([k, t]) => `<div class="banner ${k}">${t}</div>`).join("");
  celebrateIfNeeded(T);

  renderQuestMenu(td, T);

  // Past days get a score card; today's to-dos live in the header menu.
  if (curDate === today) {
    $("#quests").hidden = true;
  } else {
    const d = game.days.get(curDate);
    $("#quests").hidden = false;
    $("#quests").innerHTML = d
      ? `<div class="meal-head"><h2>Day score</h2><span class="${d.xp >= 0 ? "good-text" : "danger-text"}" style="margin-left:auto"><b>${xpStr(d.xp)} LP</b></span></div>
         ${d.items.map(([x, l]) => `<div class="quest"><span class="grow">${esc(l)}</span><span class="${x >= 0 ? "good-text" : "danger-text"}">${xpStr(x)}</span></div>`).join("")}
         ${d.warn.map((w) => `<div class="banner warn" style="margin-top:8px">${esc(w)}</div>`).join("")}`
      : `<div class="muted small">Before you started logging, so no score.</div>`;
  }
  checkProgressEvents();
}

// ---------- instant rewards: +LP pop and quest celebrations ----------
let celebrate = false; // set right before a render that follows something you did
let lastSnap = null;
function celebrateIfNeeded(T) {
  const qs = questsFor(game, T);
  const done = new Set(qs.filter((q) => q.done).map((q) => q.label));
  const snap = { total: game.totalXP, todayXp: game.today?.xp || 0, done };
  if (celebrate && lastSnap) {
    const delta = snap.todayXp - lastSnap.todayXp;
    const fresh = qs.filter((q) => q.done && !lastSnap.done.has(q.label));
    if (fresh.length) fresh.forEach((q, i) => setTimeout(() => lpPop(`+${q.xp} LP`, `Quest complete · ${q.label}`, true), i * 900));
    else if (delta > 0) lpPop(`+${delta} LP`, "Logged");
    if (delta > 0) {
      const bar = $(".lpbar");
      bar?.classList.remove("pulse"); void bar?.offsetWidth; bar?.classList.add("pulse");
    }
  }
  celebrate = false;
  lastSnap = snap;
}
function lpPop(big, small, quest = false) {
  // Wait for any badge/rank pop-up to be dismissed so they never overlap.
  setTimeout(() => {
    const a = $("#alertSheet");
    if (a.open) a.addEventListener("close", () => setTimeout(() => showLpPop(big, small, quest), 350), { once: true });
    else showLpPop(big, small, quest);
  }, 60);
}
function showLpPop(big, small, quest) {
  const el = document.createElement("div");
  el.className = `lp-pop${quest ? " quest" : ""}`;
  el.innerHTML = `<b>${esc(big)}</b><span>${esc(small)}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("out"), quest ? 2200 : 1400);
  setTimeout(() => el.remove(), quest ? 2700 : 1900);
}

// ---------- safety banners: sync + Home Screen ----------
const isStandalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const HS_DISMISS_KEY = "mt-hs-dismissed";
function safetyBanners() {
  const out = [];
  if (!syncConfigured()) {
    out.push(["warn", `Your progress only lives on this device. If the browser clears it, your rank and streak are gone. <button class="banner-btn" data-action="settings">Turn on sync</button>`]);
  } else if ($("#syncDot").classList.contains("err")) {
    out.push(["bad", `Sync is failing: ${esc(lastSyncMsg)} <button class="banner-btn" data-action="settings">Fix</button>`]);
  }
  let dismissed = 0;
  try { dismissed = +localStorage.getItem(HS_DISMISS_KEY) || 0; } catch {}
  if (isIOS() && !isStandalone() && Date.now() - dismissed > 7 * 864e5) {
    out.push(["info", `Add this to your Home Screen: it opens like an app and Safari won't wipe your data. <button class="banner-btn" data-action="howto">How</button><button class="banner-x" data-action="hs-dismiss" aria-label="Dismiss">✕</button>`]);
  }
  return out;
}
$("#banners").addEventListener("click", (e) => {
  const a = e.target.closest("[data-action]")?.dataset.action;
  if (!a) return;
  if (a === "settings") openSettings();
  if (a === "yesterday") { curDate = addDays(localDate(), -1); render(); window.scrollTo({ top: 0, behavior: "smooth" }); toast("Viewing yesterday: log what you ate"); }
  if (a === "howto") openOnboarding(2);
  if (a === "hs-dismiss") { try { localStorage.setItem(HS_DISMISS_KEY, String(Date.now())); } catch {} render(); }
});

// ---------- onboarding (first open) ----------
const ONBOARD_KEY = "mt-onboarded-v1";
let obStep = 0;
function obSlides() {
  const T = db.settings.targets;
  return [
    `<div class="ob-hero">${[0, 3, 6, 9].map((t) => emblemSVG(t, 64)).join("")}</div>
     <div class="ob-kicker">Welcome</div>
     <h2 class="ob-title">Your cut is now a ranked ladder</h2>
     <p class="ob-text">Log what you eat, earn <b>LP</b>, and climb from <b>Iron IV</b> to <b>Challenger</b>. Slack off and you get <b>demoted</b>.</p>
     <p class="ob-text muted">Target: ${T.kcal.toLocaleString()} kcal · ${T.p}g protein a day. Change it any time in Settings.</p>`,
    `<div class="ob-kicker">How LP works</div>
     <h2 class="ob-title">Earn it. Lose it.</h2>
     <div class="ob-rules">
       <div><span>Log a main meal</span><b class="good-text">+${XP.meal}</b></div>
       <div><span>Hit ${T.p}g protein</span><b class="good-text">+${XP.protein}</b></div>
       <div><span>Land your calories</span><b class="good-text">+${XP.calOnTarget}</b></div>
       <div><span>Perfect day</span><b class="good-text">+${XP.perfect}</b></div>
       <div><span>Streak bonus</span><b class="good-text">up to +70%</b></div>
       <div><span>Junk food</span><b class="danger-text">${XP.junk}</b></div>
       <div><span>Blow your calories</span><b class="danger-text">${XP.overBig}</b></div>
       <div><span>Skip a day</span><b class="danger-text">${XP.missed}</b></div>
     </div>
     <p class="ob-text muted">❄ Streak freezes protect you from one missed day. You start with 1 and earn one per 7-day streak. Food logged after noon the next day earns no LP.</p>`,
    `<div class="ob-kicker">Don't lose your progress</div>
     <h2 class="ob-title">Two quick things</h2>
     <div class="ob-steps">
       <div class="ob-step${isStandalone() ? " done" : ""}"><span class="ob-num">${isStandalone() ? "✓" : "1"}</span><div><b>Add to Home Screen</b><p class="muted small">In Safari tap <b>Share</b> (square with ↑) → <b>Add to Home Screen</b>. It opens like an app and Safari won't clear your data.</p></div></div>
       <div class="ob-step${syncConfigured() ? " done" : ""}"><span class="ob-num">${syncConfigured() ? "✓" : "2"}</span><div><b>Turn on sync</b><p class="muted small">Backs your log up to your private GitHub repo and syncs phone ↔ computer.</p>${syncConfigured() ? "" : `<button class="btn" data-ob="sync">Set up sync</button>`}</div></div>
     </div>
     <div class="ob-bonus"><b>First-day bonus</b><span>Log breakfast, lunch and dinner today: <b class="good-text">+${XP.firstDay} LP</b> on top.</span></div>`,
  ];
}
function renderOnboarding() {
  const slides = obSlides();
  $("#obBody").innerHTML = slides[obStep];
  $("#obDots").innerHTML = slides.map((_, i) => `<i class="${i === obStep ? "on" : ""}"></i>`).join("");
  $("#obBack").style.visibility = obStep ? "visible" : "hidden";
  $("#obNext").textContent = obStep === slides.length - 1 ? `Start: log ${MEALS.find((m) => m[0] === guessMeal())[1].toLowerCase()}` : "Next";
}
function openOnboarding(step = 0) {
  obStep = step;
  renderOnboarding();
  if (!$("#onboardSheet").open) $("#onboardSheet").showModal();
}
function finishOnboarding(then) {
  try { localStorage.setItem(ONBOARD_KEY, "1"); } catch {}
  $("#onboardSheet").close();
  then?.();
}
$("#obNext").onclick = () => {
  if (obStep < obSlides().length - 1) { obStep++; renderOnboarding(); }
  else finishOnboarding(() => openAdd(guessMeal()));
};
$("#obBack").onclick = () => { if (obStep > 0) { obStep--; renderOnboarding(); } };
$("#obSkip").onclick = () => finishOnboarding();
$("#obBody").addEventListener("click", (e) => { if (e.target.closest("[data-ob='sync']")) finishOnboarding(openSettings); });
function maybeOnboard() {
  let seen = null;
  try { seen = localStorage.getItem(ONBOARD_KEY); } catch {}
  if (!seen) setTimeout(() => openOnboarding(0), 300);
  return !seen;
}

// Mon–Sun dots: perfect / good / bad / missed / upcoming.
function weekStrip(today) {
  const [y, m, d] = today.split("-").map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // 0 = Monday
  const monday = addDays(today, -dow);
  const letters = ["M", "T", "W", "T", "F", "S", "S"];
  const cells = letters.map((l, i) => {
    const date = addDays(monday, i);
    const info = game.days.get(date);
    let cls = "future", mark = "";
    if (date === today) {
      cls = "today" + (info?.junk ? " bad" : info?.meals >= 2 ? " good" : "");
      mark = info?.meals ? `${info.meals}/3` : "";
    } else if (date < today) {
      if (!info) cls = "none";
      else if (info.perfect) { cls = "perfect"; mark = "★"; }
      else if (info.frozen) { cls = "frozen"; mark = "❄"; }
      else if (!info.logged) { cls = "missed"; mark = "✕"; }
      else if (info.xp < 0) { cls = "bad"; mark = "✕"; }
      else { cls = "good"; mark = "✓"; }
    }
    return `<div class="wd ${cls}" title="${date}${info ? ` · ${xpStr(info.xp)} LP` : ""}"><span class="wd-l">${l}</span><span class="wd-dot">${mark}</span></div>`;
  }).join("");
  return `<div class="week">${cells}</div>`;
}

// Header dropdown: what's left to do today.
const QICON = {
  meals: '<path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-3 4-3 7h3v11"/>',
  protein: '<path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
  clean: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7"/>',
  weigh: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9.5a4 4 0 0 1 6 0M12 12l1.5-2.5"/>',
};
const QKEYS = ["meals", "protein", "target", "clean", "weigh"];
function renderQuestMenu(td, T) {
  const qs = questsFor(game, T).map((q, i) => ({ ...q, key: QKEYS[i] }));
  const todo = qs.filter((q) => !q.done && !q.failed);
  const finished = qs.filter((q) => q.done || q.failed);
  const allPossible = qs.every((q) => !q.failed);
  const icon = (k) => `<svg viewBox="0 0 24 24" class="m-icon">${QICON[k]}</svg>`;
  const row = (q) => `<div class="m-item${q.done ? " done" : ""}${q.failed ? " failed" : ""}">
      ${icon(q.key)}<span class="grow">${esc(q.label)}${q.progress ? `<span class="m-sub">${esc(q.progress)}</span>` : ""}</span>
      <span class="m-lp">${q.failed ? "✕" : q.done ? "✓" : `+${q.xp}`}</span></div>`;
  $("#questMenu").innerHTML = `
    <div class="m-head"><span>Still to do</span><span class="num">${xpStr(td.xp || 0)} LP today</span></div>
    ${todo.length ? todo.map(row).join("") : `<div class="m-item done"><span class="grow">Nothing left. Clean day.</span></div>`}
    ${finished.length ? `<div class="m-sep"></div>${finished.map(row).join("")}` : ""}
    <div class="m-sep"></div>
    <div class="m-foot">${allPossible ? `Clear everything: <b>+${XP.perfect} LP</b> Perfect Day bonus. Calorie and junk-free LP land at midnight.` : "Perfect Day is gone, but every other task still pays."}</div>`;
  const n = todo.length;
  $("#questCount").textContent = n || "✓";
  $("#questCount").classList.toggle("clear", n === 0);
  $("#questCount").classList.toggle("calm", n > 0 && new Date().getHours() < 18);
  $("#questBtn").hidden = curDate !== localDate();
}

// Promotion / demotion / new badge pop-ups. Remembers what this device has already shown.
const SEEN_KEY = "mt-game-seen-v1";
function checkProgressEvents() {
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)); } catch {}
  const earned = game.badges.filter((b) => b.earned).map((b) => b.id);
  const store = () => { try { localStorage.setItem(SEEN_KEY, JSON.stringify({ level: game.level, badges: earned })); } catch {} };
  if (!seen) { store(); return; }
  const prev = rankFor(seen.level);
  if (game.level > seen.level) {
    const tierUp = game.rank.tier > prev.tier;
    showAlert({ kind: "up", heroHtml: emblemSVG(game.rank.tier, 120), title: tierUp ? "Tier promotion" : "Promoted", sub: game.rank.label,
      body: `${game.need - game.into} LP to ${game.nextRank.label}. Stack clean days; the streak bonus grows every day (up to +70%).` });
  } else if (game.level < seen.level) {
    const tierDown = game.rank.tier < prev.tier;
    showAlert({ kind: "down", heroHtml: emblemSVG(game.rank.tier, 120), title: tierDown ? `Demoted out of ${prev.name}` : "Demoted", sub: game.rank.label,
      body: `Junk, overeating and skipped days cost LP. Win it back today: hit protein (+${XP.protein}) and land your calories (+${XP.calOnTarget}).` });
  }
  for (const id of earned.filter((x) => !seen.badges.includes(x))) {
    const b = game.badges.find((x) => x.id === id);
    showAlert({ kind: "badge", hero: b.icon, title: "Badge unlocked", sub: b.name, body: b.desc });
  }
  store();
}

// Simple queue so pop-ups show one after another.
const alertQueue = [];
function showAlert(a) {
  alertQueue.push(a);
  if (!$("#alertSheet").open) nextAlert();
}
function nextAlert() {
  const a = alertQueue.shift();
  if (!a) return;
  $("#alertSheet").className = `sheet alert ${a.kind || ""}`;
  $("#alertBody").innerHTML = `
    ${a.heroHtml ? `<div class="alert-emblem">${a.heroHtml}</div>` : `<div class="alert-hero">${esc(a.hero)}</div>`}
    <div class="alert-title">${esc(a.title)}</div>
    ${a.sub ? `<div class="alert-sub">${esc(a.sub)}</div>` : ""}
    ${a.body ? `<div class="alert-text">${a.html ? a.body : esc(a.body)}</div>` : ""}`;
  const btns = a.buttons || [{ label: a.kind === "down" ? "Win it back" : "Let's go", primary: true }];
  $("#alertButtons").innerHTML = btns.map((b, i) => `<button class="btn ${b.primary ? "primary" : ""}" data-alert-btn="${i}">${esc(b.label)}</button>`).join("");
  $("#alertButtons").onclick = (e) => {
    const i = e.target.closest("[data-alert-btn]")?.dataset.alertBtn;
    if (i == null) return;
    $("#alertSheet").close();
    btns[+i].onClick?.();
  };
  $("#alertSheet").showModal();
  if (a.kind === "junk" || a.kind === "down") navigator.vibrate?.([80, 60, 80]);
}

// Shown right after junk is logged for today.
function junkAlert(addedIds) {
  const today = localDate();
  const added = addedIds.map((id) => db.entries[id]).filter(Boolean);
  const junk = added.filter((e) => e.junk);
  if (!junk.length || added[0].date !== today) return;
  const T = db.settings.targets;
  const tot = sum(dayEntries(today));
  const kcal = junk.reduce((a, e) => a + e.n.kcal, 0);
  const left = T.kcal - tot.kcal;
  const lines = [
    `Junk-free (+${XP.junkFree}) and Perfect Day (+${XP.perfect}) bonuses are gone for today.`,
    `That's <b>${r0(kcal)} kcal</b>, ${r0((kcal / T.kcal) * 100)}% of your whole day.`,
    left >= 0 ? `You have <b>${r0(left)} kcal</b> left today. Make it lean protein + veg.` : `You're now <b>${r0(-left)} kcal over</b> target.`,
  ];
  showAlert({
    kind: "junk", hero: `${XP.junk * Math.min(junk.length, 3)} LP`, title: "Junk food logged", sub: junk.map((e) => e.name).join(", "), html: true,
    body: lines.map((l) => `<p>${l}</p>`).join(""),
    buttons: [
      { label: "Undo, I won't eat it", onClick: () => { for (const e of junk) remove("entries", e.id); render(); toast("Removed. Good call."); } },
      { label: "Own it", primary: true },
    ],
  });
}

// ---------- dialogs ----------
function openSheet(id) {
  const d = $(id);
  if (!d.open) d.showModal();
  return d;
}
function closeSheet(id) { const d = $(id); if (d.open) d.close(); }
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) c.closest("dialog").close();
});
// Tap on backdrop closes
for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
}

// ---------- add sheet ----------
let addMeal = "breakfast";
function openAdd(meal) {
  addMeal = meal || guessMeal();
  $("#addMeal").value = addMeal;
  $("#foodSearch").value = "";
  renderSearch();
  openSheet("#addSheet");
}
function foodSub(f) {
  const p = f.per100;
  return `${r0(p.kcal)} kcal · P ${r1(p.p)} · C ${r1(p.c)} · F ${r1(p.f)} per 100g`;
}
function renderSearch() {
  const q = $("#foodSearch").value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const match = (f) => words.every((w) => `${f.name} ${f.brand || ""} ${f.barcode || ""}`.toLowerCase().includes(w));
  const mine = live("foods").filter(match).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  const mineIds = new Set(mine.map((f) => f.id));
  const generic = q ? GENERIC_FOODS.filter((g) => !mineIds.has(g.id) && match(g)) : [];
  const row = (f, tag) => `<button class="item" data-food="${esc(f.id)}">
      <div class="grow"><div class="name">${esc(f.name)}${tag ? `<span class="tag">${tag}</span>` : ""}</div>
      <div class="sub">${esc(f.brand ? f.brand + " · " : "")}${foodSub(f)}</div></div></button>`;
  let html = "";
  const tpls = live("templates").filter((tp) => !q || words.every((w) => tp.name.toLowerCase().includes(w)));
  if (tpls.length) html += `<div class="section-label">Saved meals</div>` + tpls.map((tp) => {
    const n = sum(tp.items.map((i) => ({ n: scale(i.per100, i.grams) })));
    return `<div class="item tpl" data-template="${tp.id}"><span class="avatar">★</span><div class="grow"><div class="name">${esc(tp.name)}</div>
      <div class="sub">${tp.items.length} items · ${r0(n.kcal)} kcal · P ${r0(n.p)}g</div></div><button class="icon-btn small-x" data-del-template="${tp.id}" aria-label="Delete saved meal">✕</button></div>`;
  }).join("");
  if (mine.length) html += `<div class="section-label">${q ? "My foods" : "Recent"}</div>` + mine.slice(0, q ? 30 : 15).map((f) => row(f)).join("");
  if (generic.length) html += `<div class="section-label">Basics (approx.)</div>` + generic.slice(0, 20).map((f) => row(f, "basic")).join("");
  if (!html) html = `<div class="empty">${q ? "No match. Try “Search packaged foods online”, or New food." : "Your foods will show up here. Search for basics like “rice” or “chicken”."}</div>`;
  $("#searchResults").innerHTML = html;
}
function findFood(id) {
  return db.foods[id] && !db.foods[id].deleted ? db.foods[id] : GENERIC_FOODS.find((g) => g.id === id);
}

// ---------- amount sheet ----------
let amt = null; // { food, entryId? }
function openAmount(food, opts = {}) {
  amt = { food, entryId: opts.entryId || null };
  const entry = opts.entryId ? db.entries[opts.entryId] : null;
  $("#amtName").textContent = food.name;
  $("#amtSub").textContent = (food.brand ? food.brand + " · " : "") + foodSub(food);
  const grams = entry ? entry.grams : food.serving?.grams || 100;
  $("#amtGrams").value = r1(grams);
  const chips = [];
  if (food.serving?.grams) {
    for (const n of [1, 2]) chips.push([food.serving.grams * n, `${n} × ${food.serving.label || "serving"} (${r1(food.serving.grams * n)}g)`]);
  }
  for (const g of [50, 100, 150, 200]) chips.push([g, `${g}g`]);
  $("#amtChips").innerHTML = chips.map(([g, l]) => `<button class="chip" data-g="${g}">${esc(l)}</button>`).join("");
  $("#amtMeal").value = entry ? entry.meal : addMeal;
  $("#amtDate").value = entry ? entry.date : curDate;
  $("#amtDateWrap").hidden = !entry;
  $("#amtDelete").hidden = !entry;
  $("#amtEditFood").hidden = !!food.generic || (entry && !entry.foodId);
  $("#amtSave").textContent = entry ? "Save" : "Add";
  $("#amtJunk").checked = entry ? !!entry.junk : autoJunk(food);
  updateAmtPreview();
  openSheet("#amountSheet");
  setTimeout(() => { const g = $("#amtGrams"); g.focus(); g.select(); }, 50);
}
function previewHtml(n) {
  return NK.map((k) => `<div><b>${k === "kcal" || k === "na" ? r0(n[k]) : r1(n[k])}</b><span>${k === "kcal" ? "kcal" : NLABEL[k] + (k === "na" ? " mg" : " g")}</span></div>`).join("");
}
function updateAmtPreview() {
  const g = num($("#amtGrams").value) || 0;
  $("#amtPreview").innerHTML = previewHtml(scale(amt.food.per100, g));
}
function ensureInLibrary(food) {
  // Generic foods get copied into "my foods" so they show in Recent.
  let f = db.foods[food.id];
  if (!f || f.deleted) {
    f = { ...food, generic: undefined, id: food.id, createdAt: Date.now() };
    delete f.generic;
  }
  f.lastUsed = Date.now();
  upsert("foods", f);
  return f;
}
function saveAmount() {
  const grams = num($("#amtGrams").value);
  if (!grams || grams <= 0) { toast("Enter an amount"); return; }
  const meal = $("#amtMeal").value;
  const junk = $("#amtJunk").checked;
  const { food, entryId } = amt;
  const before = sum(dayEntries(localDate())).kcal;
  let newId = null;
  if (entryId) {
    const e = db.entries[entryId];
    const per100 = e.per100 || food.per100;
    upsert("entries", { ...e, grams, meal, junk, date: $("#amtDate").value || e.date, per100, n: scale(per100, grams) });
    toast("Updated");
  } else {
    let f = ensureInLibrary(food);
    if (junk !== autoJunk(f)) { f = { ...f, junk }; upsert("foods", f); } // remember your call for this food
    newId = uid();
    upsert("entries", {
      id: newId, date: curDate, meal, junk, name: f.brand ? `${f.name} (${f.brand})` : f.name,
      foodId: f.id, grams, per100: { ...f.per100 }, n: scale(f.per100, grams), createdAt: Date.now(),
    });
  }
  closeSheet("#amountSheet");
  closeSheet("#addSheet");
  if (newId) afterAdd([newId], before);
  celebrate = true;
  render();
}
// Junk alert, or "you just went over" alert, after logging something for today.
function afterAdd(ids, beforeKcal) {
  const today = localDate();
  const added = ids.map((id) => db.entries[id]).filter((e) => e && e.date === today);
  if (!added.length) return;
  if (added.some((e) => e.junk)) return junkAlert(ids);
  const T = db.settings.targets, high = T.kcal * 1.05;
  const now = sum(dayEntries(today)).kcal;
  if (beforeKcal <= high && now > high) {
    showAlert({
      kind: "junk", hero: `+${r0(now - T.kcal)}`, title: "Over today's target", sub: `${r0(now)} of ${T.kcal} kcal`,
      body: `That's ${now > T.kcal * 1.15 ? XP.overBig : XP.overSmall} LP. Close the kitchen for today: every extra bite makes it worse.`,
      buttons: [
        { label: "Undo", onClick: () => { for (const e of added) remove("entries", e.id); render(); } },
        { label: "Got it", primary: true },
      ],
    });
  }
}

// ---------- quick re-log: copy items (yesterday's meal or a saved meal) ----------
function logItems(items, meal, label) {
  if (!items.length) return;
  const before = sum(dayEntries(localDate())).kcal;
  const now = Date.now();
  const ids = items.map((it, k) => {
    const id = uid() + k;
    db.entries[id] = {
      id, date: curDate, meal, name: it.name, grams: it.grams, per100: { ...it.per100 }, n: scale(it.per100, it.grams),
      foodId: it.foodId, junk: !!it.junk, estimated: !!it.estimated, createdAt: now + k, updatedAt: now,
    };
    return id;
  });
  save();
  closeSheet("#addSheet");
  afterAdd(ids, before);
  celebrate = true;
  render();
  if (!items.some((i) => i.junk)) toast(`${label}: ${items.length} item${items.length > 1 ? "s" : ""} added`);
}
function saveTemplate(meal) {
  const items = dayEntries(curDate).filter((e) => e.meal === meal);
  if (!items.length) return;
  const label = MEALS.find((m) => m[0] === meal)[1];
  const name = prompt("Name this meal", `My usual ${label.toLowerCase()}`);
  if (!name) return;
  upsert("templates", {
    id: uid(), name: name.trim(), meal,
    items: items.map((e) => ({ name: e.name, grams: e.grams, per100: e.per100, foodId: e.foodId, junk: !!e.junk, estimated: !!e.estimated })),
    createdAt: Date.now(),
  });
  toast(`Saved “${name.trim()}”. Find it under ＋.`);
}

// ---------- food editor ----------
let foodEdit = null; // { food (existing or draft), then: 'amount' | null }
let basis = "100";
let fJunkTouched = false;
function syncEditorJunk() {
  if (!fJunkTouched) $("#fJunk").checked = isJunkName(`${$("#fName").value} ${$("#fBrand").value}`) || foodEdit?.food?.nutriscore === "e";
}
function setBasis(b) {
  basis = b;
  for (const btn of $("#fBasis").children) btn.classList.toggle("on", btn.dataset.basis === b);
}
function openFoodEditor(draft = {}, opts = {}) {
  foodEdit = { food: draft, then: opts.then ?? "amount" };
  $("#foodTitle").textContent = draft.id && db.foods[draft.id] ? "Edit food" : "New food";
  $("#fName").value = draft.name || "";
  $("#fBrand").value = draft.brand || "";
  $("#fBarcode").value = draft.barcode || "";
  $("#fServLabel").value = draft.serving?.label || "";
  $("#fServGrams").value = draft.serving?.grams ? r1(draft.serving.grams) : "";
  setBasis("100");
  const p = draft.per100 || {};
  $("#fKcal").value = p.kcal != null ? r1(p.kcal) : "";
  $("#fP").value = p.p != null ? r1(p.p) : "";
  $("#fC").value = p.c != null ? r1(p.c) : "";
  $("#fF").value = p.f != null ? r1(p.f) : "";
  $("#fNa").value = p.na != null ? r0(p.na) : "";
  $("#fJunk").checked = autoJunk(draft);
  fJunkTouched = draft.junk === true || draft.junk === false;
  $("#foodDelete").hidden = !(draft.id && db.foods[draft.id]);
  openSheet("#foodSheet");
}
function saveFood() {
  const name = $("#fName").value.trim();
  if (!name) { toast("Give it a name"); return; }
  const vals = { kcal: num($("#fKcal").value), p: num($("#fP").value), c: num($("#fC").value), f: num($("#fF").value), na: num($("#fNa").value) };
  if (vals.kcal == null) { toast("Enter calories"); return; }
  const servG = num($("#fServGrams").value);
  let per100 = {};
  if (basis === "serving") {
    if (!servG) { toast("Enter the serving size in grams"); return; }
    for (const k of NK) per100[k] = ((vals[k] || 0) * 100) / servG;
  } else {
    for (const k of NK) per100[k] = vals[k] || 0;
  }
  const prev = foodEdit.food.id ? db.foods[foodEdit.food.id] : null;
  const food = {
    ...(prev || {}),
    id: prev?.id || uid(),
    name,
    brand: $("#fBrand").value.trim(),
    barcode: $("#fBarcode").value.trim(),
    per100,
    serving: servG ? { label: $("#fServLabel").value.trim() || "serving", grams: servG } : null,
    junk: fJunkTouched ? $("#fJunk").checked : undefined, // undefined = decide automatically
    createdAt: prev?.createdAt || Date.now(),
    lastUsed: Date.now(),
  };
  upsert("foods", food);
  closeSheet("#foodSheet");
  if (amt && amt.food.id === food.id) amt.food = food;
  if (foodEdit.then === "amount") openAmount(food);
  else toast("Food saved");
  renderSearch();
}

// ---------- Open Food Facts ----------
const OFF_FIELDS = "code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,nutriscore_grade";
function offToFood(p, code) {
  const n = p.nutriments || {};
  const get = (k) => num(n[k]);
  const per100 = {};
  let kcal = get("energy-kcal_100g");
  if (kcal == null && get("energy_100g") != null) kcal = get("energy_100g") / 4.184;
  per100.kcal = kcal;
  per100.p = get("proteins_100g");
  per100.c = get("carbohydrates_100g");
  per100.f = get("fat_100g");
  per100.na = get("sodium_100g") != null ? get("sodium_100g") * 1000 : get("salt_100g") != null ? get("salt_100g") * 400 : null;
  const sq = num(p.serving_quantity);
  // Fall back to per-serving values when per-100g is missing.
  if (per100.kcal == null && sq) {
    const s = (k) => (get(k) != null ? (get(k) * 100) / sq : null);
    per100.kcal = s("energy-kcal_serving");
    per100.p ??= s("proteins_serving");
    per100.c ??= s("carbohydrates_serving");
    per100.f ??= s("fat_serving");
    if (per100.na == null && get("sodium_serving") != null) per100.na = (get("sodium_serving") * 1000 * 100) / sq;
  }
  const incomplete = per100.kcal == null;
  for (const k of NK) per100[k] = per100[k] ?? 0;
  return {
    name: p.product_name || p.product_name_en || "Unnamed product",
    brand: (p.brands || "").split(",")[0].trim(),
    barcode: code || p.code || "",
    per100,
    serving: sq ? { label: p.serving_size || "serving", grams: sq } : null,
    source: "openfoodfacts",
    incomplete,
    nutriscore: p.nutriscore_grade || null,
  };
}
async function offProduct(code) {
  const tryCode = async (c) => {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(c)}.json?fields=${OFF_FIELDS}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Food database error ${r.status}`);
    const j = await r.json();
    return j.status === 1 && j.product ? offToFood(j.product, code) : null;
  };
  let f = await tryCode(code);
  if (!f && code.length === 12) f = await tryCode("0" + code);
  if (!f && code.length === 13 && code.startsWith("0")) f = await tryCode(code.slice(1));
  return f;
}
async function offSearch(q) {
  const u = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  const j = await r.json();
  return (j.products || []).map((p) => offToFood(p, p.code)).filter((f) => !f.incomplete);
}
let offList = [];
async function runOffSearch() {
  const q = $("#offQuery").value.trim();
  if (!q) return;
  $("#offResults").innerHTML = `<div class="empty"><span class="spinner"></span>Searching…</div>`;
  try {
    offList = await offSearch(q);
    $("#offResults").innerHTML = offList.length
      ? offList.map((f, i) => `<button class="item" data-off="${i}"><div class="grow"><div class="name">${esc(f.name)}</div>
          <div class="sub">${esc(f.brand ? f.brand + " · " : "")}${foodSub(f)}</div></div></button>`).join("")
      : `<div class="empty">Nothing found. Try fewer words, or scan the barcode.</div>`;
  } catch (e) {
    $("#offResults").innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}
function pickOffFood(f) {
  // Reuse an existing library food with the same barcode.
  const existing = f.barcode && live("foods").find((x) => x.barcode === f.barcode);
  const food = existing || { ...f, id: uid() };
  closeSheet("#offSheet");
  openAmount(food);
}

// ---------- barcode scanning ----------
let scanStream = null, scanning = false, detector = null, lastBarcode = "";
async function getDetector() {
  if (detector) return detector;
  const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];
  if ("BarcodeDetector" in window) {
    try {
      const sup = await window.BarcodeDetector.getSupportedFormats();
      if (sup.includes("ean_13")) return (detector = new window.BarcodeDetector({ formats: formats.filter((f) => sup.includes(f)) }));
    } catch {}
  }
  const mod = await import(BARCODE_PONYFILL_URL); // iPhone Safari needs this (ZXing WebAssembly)
  return (detector = new mod.BarcodeDetector({ formats }));
}
async function openScan() {
  $("#scanNotFound").hidden = true;
  $("#scanManual").value = "";
  openSheet("#scanSheet");
  const status = $("#scanStatus");
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Camera not available here (the site must be opened over https). Type the number instead.";
    return;
  }
  status.textContent = "Starting camera…";
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    const v = $("#scanVideo");
    v.srcObject = scanStream;
    await v.play();
    status.textContent = "Loading scanner…";
    const det = await getDetector();
    if (!$("#scanSheet").open) return stopScan();
    status.textContent = "Point at the barcode";
    scanning = true;
    const tick = async () => {
      if (!scanning) return;
      try {
        if (v.readyState >= 2) {
          const codes = await det.detect(v);
          const code = codes.find((c) => /^\d{6,14}$/.test(c.rawValue))?.rawValue;
          if (code) { navigator.vibrate?.(60); stopScan(); handleBarcode(code); return; }
        }
      } catch {}
      setTimeout(tick, 180);
    };
    tick();
  } catch (e) {
    status.textContent = e.name === "NotAllowedError"
      ? "Camera permission was denied. Allow it in your browser settings, or type the number."
      : `Couldn't start camera (${e.message}). Type the number instead.`;
  }
}
function stopScan() {
  scanning = false;
  if (scanStream) { for (const t of scanStream.getTracks()) t.stop(); scanStream = null; }
  const v = $("#scanVideo");
  if (v) v.srcObject = null;
}
async function handleBarcode(code) {
  code = code.trim();
  lastBarcode = code;
  const status = $("#scanStatus");
  const mine = live("foods").find((f) => f.barcode === code);
  if (mine) { closeSheet("#scanSheet"); openAmount(mine); return; }
  status.innerHTML = `<span class="spinner"></span>Looking up ${esc(code)}…`;
  try {
    const f = await offProduct(code);
    if (f && !f.incomplete) {
      closeSheet("#scanSheet");
      openAmount({ ...f, id: uid() });
      return;
    }
    if (f && f.incomplete) {
      // Found the product but it has no nutrition data: prefill the editor with what we have.
      status.textContent = `Found “${f.name}” but it has no nutrition info.`;
      $("#scanNotFound").hidden = false;
      lastNotFoundDraft = { name: f.name, brand: f.brand, barcode: code, serving: f.serving };
      return;
    }
    status.textContent = `Barcode ${code} not found.`;
    lastNotFoundDraft = { barcode: code };
    $("#scanNotFound").hidden = false;
  } catch (e) {
    status.textContent = `${e.message}. Check your connection.`;
  }
}
let lastNotFoundDraft = {};

// ---------- Photo → Claude app (copy prompt, paste reply back). Free: uses your Claude plan, no API key. ----------
let aiMode = "meal", aiTarget = null; // aiTarget: 'food-editor' | 'barcode' when filling a label

const RULES = `Rules:
- Use standard nutrition references (USDA-style values). Be realistic, not conservative.
- If I gave a weight or count for something, use it exactly. Otherwise estimate the portion from the photo (plate size, utensils, hands, packaging).
- Weights are as eaten: cooked weight for cooked food, edible part only (no bones).`;

function buildPrompt(mode, note) {
  if (mode === "label") {
    return `Read the nutrition label / packaging in the attached photo for my macro tracker.
${note ? `Extra info: ${note}\n` : ""}
Give values PER 100 g (or per 100 ml for drinks). If the label only shows per-serving values, convert using the serving size. Set "junk" true if this is junk food (sweets, crisps, sugary drink, pastry, fast food, alcohol). If no label is visible, use your best knowledge of this exact product and say so in "note". Use 0 for anything genuinely unknown.

Reply with ONLY this JSON in a code block, filled in, nothing else:
\`\`\`json
{"type":"label","name":"","brand":"","serving_label":"","serving_grams":0,"kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"sodium_mg":0,"junk":false,"note":""}
\`\`\``;
  }
  return `Estimate the nutrition of my meal for my macro tracker (photo attached; if there's no photo, go by my description).
What I ate / weights I know: ${note || "(nothing extra, judge from the photo)"}

${RULES}
- List each component as its own item, including oils, sauces, seasonings and toppings. Don't drop small items.
- "junk" is true for fast food/takeaway, deep-fried food, sweets, pastries, crisps, sugary drinks and alcohol; false for normal home-cooked or whole foods. Be honest: I am cutting.
- "basis" is "given" if I stated the amount, otherwise "estimated". Keep "note" short, e.g. "2 medium boneless thighs ≈ 220g".

Reply with ONLY this JSON in a code block, filled in, nothing else:
\`\`\`json
{"type":"meal","summary":"","items":[{"name":"","grams":0,"kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"sodium_mg":0,"basis":"estimated","junk":false,"note":""}]}
\`\`\``;
}

// Pull the first complete JSON object out of Claude's reply (it may be wrapped in ``` fences or text).
function extractJson(text) {
  const t = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  for (let start = t.indexOf("{"); start !== -1; start = t.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, escp = false;
    for (let i = start; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (escp) escp = false;
        else if (ch === "\\") escp = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  return null;
}
const nn = (v) => { const x = num(v); return x != null && x >= 0 ? x : 0; };

function setAiMode(m) {
  aiMode = m;
  for (const b of $("#aiMode").children) b.classList.toggle("on", b.dataset.mode === m);
  $("#aiNote").placeholder = m === "label"
    ? "Optional: product name, or anything the photo doesn't show"
    : "e.g. 180g cooked rice, 2 chicken thighs, 3 tenderstem broccoli, some furikake";
  $("#aiStep1Text").textContent = m === "label"
    ? "Optional note, then copy the prompt."
    : "Say what's in it (weights you know help), then copy the prompt.";
  $("#aiResults").innerHTML = "";
  $("#aiStatus").textContent = "";
  $("#aiPromptFallback").hidden = true;
}
function openAi(mode = "meal", target = null) {
  aiTarget = target;
  $("#aiNote").value = "";
  $("#aiReply").value = "";
  setAiMode(mode);
  $("#aiMode").hidden = !!target;
  openSheet("#aiSheet");
}
async function copyPrompt() {
  const prompt = buildPrompt(aiMode, $("#aiNote").value.trim());
  try {
    await navigator.clipboard.writeText(prompt);
    $("#aiPromptFallback").hidden = true;
    toast("Prompt copied. Now open Claude, attach the photo and paste.");
  } catch {
    const fb = $("#aiPromptFallback");
    fb.value = prompt;
    fb.hidden = false;
    fb.focus();
    fb.select();
    toast("Copy the prompt from the box below");
  }
}
async function pasteReply() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) { $("#aiReply").value = text; readReply(); }
  } catch {
    toast("Long-press the box and choose Paste");
    $("#aiReply").focus();
  }
}
let aiItems = [];
function readReply() {
  const raw = $("#aiReply").value.trim();
  if (!raw) { toast("Paste Claude's reply first"); return; }
  const out = extractJson(raw);
  if (!out) {
    $("#aiStatus").textContent = "Couldn't find the data in that reply. Make sure you copied Claude's whole answer (the part with { … }).";
    return;
  }
  $("#aiStatus").textContent = "";
  const isMeal = Array.isArray(out.items);
  if (!isMeal && aiMode === "meal" && out.kcal == null) {
    $("#aiStatus").textContent = "That reply doesn't look like meal data. Try again.";
    return;
  }
  if (!isMeal) {
    const per100 = { kcal: nn(out.kcal), p: nn(out.protein_g), c: nn(out.carbs_g), f: nn(out.fat_g), na: nn(out.sodium_mg) };
    const sg = nn(out.serving_grams);
    const draft = {
      ...(aiTarget === "food-editor" ? currentEditorDraft() : {}),
      name: out.name || "", brand: out.brand || "", per100, junk: out.junk === true || isJunkName(out.name) || undefined,
      serving: sg > 0 ? { label: out.serving_label || "serving", grams: sg } : null,
    };
    if (!draft.barcode && lastBarcode && aiTarget === "barcode") draft.barcode = lastBarcode;
    closeSheet("#aiSheet");
    openFoodEditor(draft, { then: "amount" });
    toast(out.note ? `Check the numbers, then save. ${out.note}` : "Check the numbers, then save", 4000);
    return;
  }
  aiItems = out.items.filter((it) => it && it.name).map((it) => {
    const g = nn(it.grams) || 100;
    return {
      use: true, junk: it.junk === true || isJunkName(it.name), name: String(it.name), grams: g, basis: it.basis === "given" ? "given" : "estimated", note: it.note || "",
      per100: { kcal: (nn(it.kcal) * 100) / g, p: (nn(it.protein_g) * 100) / g, c: (nn(it.carbs_g) * 100) / g, f: (nn(it.fat_g) * 100) / g, na: (nn(it.sodium_mg) * 100) / g },
    };
  });
  if (!aiItems.length) { $("#aiStatus").textContent = "No food items in that reply."; return; }
  renderAiItems(out.summary);
}
function renderAiItems(summary) {
  const tot = sum(aiItems.filter((i) => i.use).map((i) => ({ n: scale(i.per100, i.grams) })));
  $("#aiResults").innerHTML = `
    ${summary ? `<p class="muted small">${esc(summary)}</p>` : ""}
    <table class="ai-table">${aiItems.map((it, i) => {
      const n = scale(it.per100, it.grams);
      return `<tr><td><input type="checkbox" data-ai-use="${i}" ${it.use ? "checked" : ""}></td>
        <td><div class="nm">${esc(it.name)} <button class="junk-tag${it.junk ? " on" : ""}" data-ai-junk="${i}">${it.junk ? "junk" : "mark junk"}</button></div><div class="nt">${r0(n.kcal)} kcal · P ${r1(n.p)} · C ${r1(n.c)} · F ${r1(n.f)}${it.basis === "estimated" ? " · est." : ""}${it.note ? " · " + esc(it.note) : ""}</div></td>
        <td><input type="number" inputmode="decimal" step="any" data-ai-g="${i}" value="${r1(it.grams)}"> g</td></tr>`;
    }).join("")}</table>
    <div class="macro-preview" style="margin-top:12px">${previewHtml(tot)}</div>
    <div class="row"><select id="aiMeal" class="grow"></select><button class="btn primary" id="aiAdd">Add to log</button></div>`;
  mealOptions($("#aiMeal"));
  $("#aiMeal").value = addMeal;
  $("#aiResults").scrollIntoView({ behavior: "smooth", block: "start" });
}
function addAiItems() {
  const meal = $("#aiMeal").value;
  const chosen = aiItems.filter((i) => i.use && i.grams > 0);
  if (!chosen.length) { toast("Nothing selected"); return; }
  const now = Date.now();
  const before = sum(dayEntries(localDate())).kcal;
  const ids = [];
  chosen.forEach((it, k) => {
    const rec = {
      id: uid() + k, date: curDate, meal, junk: !!it.junk, name: it.name, grams: it.grams, per100: it.per100,
      n: scale(it.per100, it.grams), estimated: it.basis === "estimated", createdAt: now + k, updatedAt: now,
    };
    db.entries[rec.id] = rec;
    ids.push(rec.id);
  });
  save();
  closeSheet("#aiSheet");
  closeSheet("#addSheet");
  afterAdd(ids, before);
  celebrate = true;
  render();
  toast(`Added ${chosen.length} item${chosen.length > 1 ? "s" : ""}`);
}
function currentEditorDraft() {
  return { id: foodEdit?.food?.id, barcode: $("#fBarcode").value.trim(), name: $("#fName").value.trim(), brand: $("#fBrand").value.trim() };
}

// ---------- charts (single y-axis, 2px lines, hover crosshair + tooltip) ----------
const chartData = new Map();
function niceTicks(lo, hi, n = 3) {
  const span = hi - lo || 1;
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
const shortDate = (d) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd).toLocaleDateString(undefined, { month: "short", day: "numeric" }); };
// dates: x domain; line: values aligned to dates (null = gap); dots: optional raw points; refs: [{y, label}]
function lineChart(id, { dates, line, dots = null, refs = [], fmt = (v) => String(v), tip }) {
  const W = 340, H = 150, L = 38, R = 10, T = 12, B = 22;
  const vals = [...line, ...(dots || [])].filter((v) => v != null).concat(refs.map((r) => r.y));
  if (!vals.length) return `<div class="chart-empty muted small">Not enough data yet.</div>`;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.12;
  lo -= pad; hi += pad;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, dates.length - 1);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = niceTicks(lo, hi);
  let path = "", pen = false;
  line.forEach((v, i) => { if (v == null) { pen = false; return; } path += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; pen = true; });
  const lastI = line.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
  chartData.set(id, { dates, line, dots, tip, W, L, R, x, y });
  return `<div class="chart" data-chart="${id}">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3.5}" class="tick" text-anchor="end">${fmt(v)}</text>`).join("")}
      ${refs.map((r) => `<line x1="${L}" x2="${W - R}" y1="${y(r.y)}" y2="${y(r.y)}" class="ref"/><text x="${W - R}" y="${y(r.y) - 4}" class="ref-label" text-anchor="end">${esc(r.label)}</text>`).join("")}
      <text x="${L}" y="${H - 6}" class="tick">${shortDate(dates[0])}</text><text x="${W - R}" y="${H - 6}" class="tick" text-anchor="end">${shortDate(dates[dates.length - 1])}</text>
      ${dots ? dots.map((v, i) => (v == null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="2.5" class="dot"/>`)).join("") : ""}
      <path d="${path}" class="line"/>
      ${lastI != null ? `<circle cx="${x(lastI)}" cy="${y(line[lastI])}" r="4" class="end"/>` : ""}
      <line class="cross" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/><circle class="hover-dot" r="5" cx="-10" cy="-10"/>
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}
document.addEventListener("pointermove", (e) => {
  const el = e.target.closest?.("[data-chart]");
  document.querySelectorAll(".chart.active").forEach((c) => { if (c !== el) { c.classList.remove("active"); c.querySelector(".chart-tip").hidden = true; } });
  if (!el) return;
  const d = chartData.get(el.dataset.chart);
  if (!d) return;
  const svg = el.querySelector("svg"), rect = svg.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * d.W;
  let i = Math.round(((sx - d.L) / (d.W - d.L - d.R)) * (d.dates.length - 1));
  i = Math.max(0, Math.min(d.dates.length - 1, i));
  // snap to nearest index that has data
  let best = -1;
  for (let k = 0; k < d.dates.length; k++) if ((d.line[k] != null || d.dots?.[k] != null) && (best < 0 || Math.abs(k - i) < Math.abs(best - i))) best = k;
  if (best < 0) return;
  const v = d.line[best] ?? d.dots?.[best];
  const cx = d.x(best), cy = d.y(v);
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".hover-dot");
  cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
  dot.setAttribute("cx", cx); dot.setAttribute("cy", cy);
  el.classList.add("active");
  const tipEl = el.querySelector(".chart-tip");
  tipEl.innerHTML = d.tip(best);
  tipEl.hidden = false;
  const px = (cx / d.W) * rect.width;
  tipEl.style.left = `${Math.max(4, Math.min(rect.width - tipEl.offsetWidth - 4, px - tipEl.offsetWidth / 2))}px`;
});

function lpChartHtml(g) {
  const today = localDate();
  const dates = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const line = dates.map((d) => g.days.get(d)?.total ?? null);
  const nextTier = Math.min(TIERS.length - 1, g.rank.tier + 1);
  const refs = nextTier > g.rank.tier ? [{ y: lpForLevel(firstLevelOfTier(nextTier)), label: TIERS[nextTier].name }] : [];
  return lineChart("lp", {
    dates, line, refs, fmt: (v) => Math.round(v),
    tip: (i) => { const info = g.days.get(dates[i]); return `<b>${shortDate(dates[i])}</b> · ${info.total} LP<br><span class="${info.xp >= 0 ? "good-text" : "danger-text"}">${xpStr(info.xp)} that day</span> · ${esc(rankFor(levelFromXP(info.total).level).label)}`; },
  });
}
function weightChartHtml() {
  const today = localDate();
  const dates = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const ws = live("weights").filter((w) => w.kg > 0);
  const byDate = new Map(ws.map((w) => [w.date, w.kg]));
  const dots = dates.map((d) => byDate.get(d) ?? null);
  const line = dates.map((d) => {
    const l = ws.filter((w) => w.date > addDays(d, -7) && w.date <= d);
    return l.length ? l.reduce((a, w) => a + w.kg, 0) / l.length : null;
  });
  const goal = db.settings.goalKg;
  const vals = [...dots, ...line].filter((v) => v != null);
  const refs = goal && vals.length && goal >= Math.min(...vals) - 3 ? [{ y: goal, label: `Goal ${goal}` }] : [];
  return lineChart("weight", {
    dates, line, dots, refs, fmt: (v) => v.toFixed(1),
    tip: (i) => `<b>${shortDate(dates[i])}</b>${dots[i] != null ? ` · ${dots[i].toFixed(1)} kg` : ""}${line[i] != null ? `<br>7-day avg ${line[i].toFixed(1)} kg` : ""}`,
  });
}

// ---------- weekly recap ----------
const RECAP_KEY = "mt-recap-seen-v1";
function recapHtml(r) {
  const s = rankFor(r.startLevel), e = rankFor(r.endLevel);
  const moved = r.endLevel - r.startLevel;
  const verdict = r.perfect >= 5 && !r.junk && r.loggedDays === 7 ? "Elite week. This is what a cut looks like."
    : r.junk >= 2 ? `${r.junk} junk items cost you. Cut those and this is a big week.`
    : r.lp >= 600 ? "Strong week. Stack another one."
    : r.lp > 0 ? "Progress, but there's LP left on the table."
    : "Rough week. The ladder doesn't care; next week does.";
  const range = `${shortDate(r.monday)} – ${shortDate(r.sunday)}`;
  const day = (x) => (x ? `${new Date(...x.date.split("-").map((n, i) => (i === 1 ? n - 1 : +n))).toLocaleDateString(undefined, { weekday: "long" })} (${xpStr(x.xp)} LP)` : "–");
  return `
    <div class="recap-kicker">Weekly recap · ${range}</div>
    <div class="recap-hero ${r.lp >= 0 ? "good-text" : "danger-text"}">${xpStr(r.lp)} <span>LP</span></div>
    <div class="recap-ranks">
      <div>${emblemSVG(s.tier, 56)}<span>${esc(s.label)}</span></div>
      <div class="recap-arrow ${moved > 0 ? "good-text" : moved < 0 ? "danger-text" : "muted"}">${moved > 0 ? "▲" : moved < 0 ? "▼" : "→"}</div>
      <div>${emblemSVG(e.tier, 56)}<span>${esc(e.label)}</span></div>
    </div>
    <p class="recap-verdict">${verdict}</p>
    <div class="stat-grid">
      <div class="stat"><b>${r.perfect}</b><span>perfect days</span></div>
      <div class="stat"><b>${r.loggedDays}/7</b><span>days logged</span></div>
      <div class="stat"><b class="${r.junk ? "danger-text" : "good-text"}">${r.junk}</b><span>junk items</span></div>
      <div class="stat"><b>${r.avgKcal}</b><span>avg kcal</span></div>
      <div class="stat"><b>${r.avgProtein}g</b><span>avg protein</span></div>
      <div class="stat"><b class="${r.weightChange != null && r.weightChange < 0 ? "good-text" : ""}">${r.weightChange == null ? "–" : (r.weightChange <= 0 ? "−" : "+") + Math.abs(r.weightChange).toFixed(1)}</b><span>kg vs last week</span></div>
    </div>
    <div class="recap-days">
      <div><span class="muted small">Best day</span><b>${day(r.best)}</b></div>
      <div><span class="muted small">Worst day</span><b>${day(r.worst)}</b></div>
    </div>`;
}
function showRecap(monday) {
  const r = weekRecap(game, db, monday);
  if (!r) { toast("No logs that week"); return false; }
  $("#recapBody").innerHTML = recapHtml(r);
  $("#recapSheet").showModal();
  return true;
}
function maybeShowRecap() {
  const lastMonday = addDays(mondayOf(localDate()), -7);
  let seen = null;
  try { seen = localStorage.getItem(RECAP_KEY); } catch {}
  if (seen && seen >= lastMonday) return;
  if (!weekRecap(game, db, lastMonday)) return;
  try { localStorage.setItem(RECAP_KEY, lastMonday); } catch {}
  const open = () => ($("#alertSheet").open ? setTimeout(open, 800) : showRecap(lastMonday));
  setTimeout(open, 600);
}

// ---------- progress (level, weight, coach, badges, XP history) ----------
function renderProgress() {
  const g = game || computeGame(db, localDate());
  const w = g.weight;
  const today = localDate();
  const todayW = live("weights").find((x) => x.date === today);
  const goal = db.settings.goalKg;
  const f1 = (x) => (x == null ? "–" : x.toFixed(1));

  const rows = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, -i);
    const info = g.days.get(d);
    const t = info?.tot || { kcal: 0, p: 0 };
    const x = info ? info.xp : null;
    rows.push(`<tr class="click" data-day="${d}"><td>${prettyDate(d)}${info?.perfect ? ' <span class="pill gold">perfect</span>' : ""}${info?.junk ? ' <span class="pill bad">junk</span>' : ""}</td>
      <td>${info?.logged ? r0(t.kcal) : "–"}</td><td>${info?.logged ? r0(t.p) : "–"}</td>
      <td class="${x == null ? "" : x >= 0 ? "good-text" : "danger-text"}">${x == null ? "" : xpStr(x)}</td></tr>`);
  }

  $("#progressBody").innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="stat-emblem">${emblemSVG(g.rank.tier, 34)}</div><span>${esc(g.rank.label)}</span></div>
      <div class="stat"><b>${g.totalXP}</b><span>Total LP</span></div>
      <div class="stat"><b>${g.streak}</b><span>Streak · best ${g.bestStreak}</span></div>
    </div>

    <button class="btn full" id="openRecap">Last week's recap</button>

    <h3>LP <span class="muted small">last 30 days</span></h3>
    ${lpChartHtml(g)}

    <h3>Ranked ladder</h3>
    <div class="ladder">${TIERS.map((t, i) => {
      const reached = g.rank.tier >= i, cur = g.rank.tier === i;
      return `<div class="rung${reached ? " reached" : ""}${cur ? " current" : ""}">${emblemSVG(i, 44)}<span>${esc(t.name)}</span></div>`;
    }).join("")}</div>

    <h3>Weight</h3>
    <div class="row tight">
      <input id="wInput" type="number" inputmode="decimal" step="0.1" placeholder="Today's weight (kg)" value="${todayW ? todayW.kg : ""}" class="grow">
      <button class="btn primary" id="wSave">${todayW ? "Update" : `Weigh in +${XP.weighIn} LP`}</button>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${f1(w.avgNow)}</b><span>7-day avg kg</span></div>
      <div class="stat"><b class="${w.ratePerWeek > 0 ? "good-text" : ""}">${w.ratePerWeek == null ? "–" : (w.ratePerWeek >= 0 ? "−" : "+") + Math.abs(w.ratePerWeek).toFixed(2)}</b><span>kg / week</span></div>
      <div class="stat"><b>${w.count ? (w.lost >= 0 ? "−" : "+") + Math.abs(w.lost).toFixed(1) : "–"}</b><span>${goal ? `kg total · goal ${goal}` : "kg total"}</span></div>
    </div>
    <div class="chart-head"><span class="muted small">Last 30 days</span><span class="legend"><i class="lg-dot"></i>daily <i class="lg-line"></i>7-day avg</span></div>
    ${weightChartHtml()}
    ${g.coach.length ? `<div class="coach">${g.coach.map((c) => `<p>${esc(c)}</p>`).join("")}</div>` : ""}

    <h3>Badges <span class="muted small">${g.badges.filter((b) => b.earned).length}/${g.badges.length}</span></h3>
    <div class="badges">${g.badges.map((b) => `<div class="badge${b.earned ? " earned" : ""}" title="${esc(b.desc)}">
      <div class="badge-mark">${esc(b.icon)}</div><div class="badge-name">${esc(b.name)}</div>
      <div class="badge-desc">${b.earned ? "Unlocked" : b.progress ? `${b.progress[0]}/${b.progress[1]}` : esc(b.desc)}</div></div>`).join("")}</div>

    <h3>Last 14 days</h3>
    <table class="hist"><tr><th>Day</th><th>kcal</th><th>P</th><th>LP</th></tr>${rows.join("")}</table>

    <h3>How LP works</h3>
    <div class="muted small rules">
      <p>+${XP.meal} per main meal logged · +${XP.protein} protein hit · +${XP.calOnTarget} calories on target · +${XP.junkFree} junk-free · +${XP.weighIn} weigh-in · +${XP.perfect} perfect day</p>
      <p>Streak bonus: +5% per day in a row, up to +70%.</p>
      <p class="danger-text">${XP.junk} per junk item · ${XP.overSmall} / ${XP.overBig} for going over · ${XP.missed} for a day with nothing logged. LP can fall, and you can get demoted.</p>
    </div>`;
}
function saveWeight() {
  const kg = num($("#wInput").value);
  if (!kg || kg < 25 || kg > 400) { toast("Enter your weight in kg"); return; }
  const today = localDate();
  upsert("weights", { id: today, date: today, kg });
  celebrate = true;
  render();
  renderProgress();
  toast("Weighed in");
}

// ---------- settings ----------
function openSettings() {
  const t = db.settings.targets, s = secrets();
  $("#tKcal").value = t.kcal ?? ""; $("#tP").value = t.p ?? ""; $("#tC").value = t.c ?? ""; $("#tF").value = t.f ?? ""; $("#tNa").value = t.na ?? "";
  $("#sOwner").value = s.ghOwner || ""; $("#sRepo").value = s.ghRepo || ""; $("#sToken").value = s.ghToken || "";
  $("#syncInfo").textContent = syncConfigured() ? lastSyncMsg : "Not set up";
  $("#tMaint").value = db.settings.maintenance ?? ""; $("#tGoal").value = db.settings.goalKg ?? "";
  $("#fastOn").checked = !!db.settings.fasting?.on; $("#fastHours").value = db.settings.fasting?.hours ?? 16;
  openSheet("#settingsSheet");
}
function saveSettings() {
  db.settings = {
    targets: { kcal: num($("#tKcal").value) || 0, p: num($("#tP").value) || 0, c: num($("#tC").value) || 0, f: num($("#tF").value) || 0, na: num($("#tNa").value) || 0 },
    maintenance: num($("#tMaint").value) || null, goalKg: num($("#tGoal").value) || null,
    fasting: { on: $("#fastOn").checked, hours: Math.min(23, Math.max(8, num($("#fastHours").value) || 16)) },
    updatedAt: Date.now(),
  };
  const before = JSON.stringify(secrets());
  setSecrets({
    ...secrets(),
    ghOwner: $("#sOwner").value.trim(), ghRepo: $("#sRepo").value.trim(), ghToken: $("#sToken").value.trim(),
  });
  save();
  render();
  closeSheet("#settingsSheet");
  toast("Saved");
  if (syncConfigured() && JSON.stringify(secrets()) !== before) syncNow();
}
function exportJson() {
  const blob = new Blob([JSON.stringify(db, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `macro-log-${localDate()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importJson(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!d.foods || !d.entries) throw new Error();
    db = mergeDb(db, d);
    save();
    render();
    toast("Imported");
  } catch { toast("That file isn't a Macro Log backup"); }
}

// ---------- wire up ----------
mealOptions($("#addMeal"));
mealOptions($("#amtMeal"));
$("#prevDay").onclick = () => { curDate = addDays(curDate, -1); render(); };
$("#nextDay").onclick = () => { curDate = addDays(curDate, 1); render(); };
$("#dateLabel").onclick = () => { curDate = localDate(); render(); };
$("#fab").onclick = () => openAdd(curDate === localDate() ? guessMeal() : "snacks");
$("#openSettings").onclick = openSettings;
const openProgress = () => { renderProgress(); openSheet("#progressSheet"); };
$("#openHistory").onclick = openProgress;
$("#gameCard").onclick = openProgress;
$("#progressBody").onclick = (e) => {
  if (e.target.id === "wSave") return saveWeight();
  if (e.target.id === "openRecap") return showRecap(addDays(mondayOf(localDate()), -7));
  const tr = e.target.closest("[data-day]");
  if (tr) { curDate = tr.dataset.day; render(); closeSheet("#progressSheet"); }
};
$("#progressBody").addEventListener("keydown", (e) => { if (e.target.id === "wInput" && e.key === "Enter") saveWeight(); });
$("#alertSheet").addEventListener("close", () => setTimeout(nextAlert, 150));
$("#meals").onclick = (e) => {
  const add = e.target.closest("[data-add]");
  if (add) return openAdd(add.dataset.add);
  const rep = e.target.closest("[data-repeat]");
  if (rep) {
    const meal = rep.dataset.repeat;
    return logItems(dayEntries(addDays(curDate, -1)).filter((x) => x.meal === meal), meal, "Same as yesterday");
  }
  const sv = e.target.closest("[data-save-meal]");
  if (sv) return saveTemplate(sv.dataset.saveMeal);
  const en = e.target.closest("[data-entry]");
  if (en) {
    const entry = db.entries[en.dataset.entry];
    const food = (entry.foodId && db.foods[entry.foodId] && !db.foods[entry.foodId].deleted)
      ? db.foods[entry.foodId]
      : { id: null, name: entry.name, per100: entry.per100, generic: true };
    addMeal = entry.meal;
    openAmount(food, { entryId: entry.id });
  }
};
$("#addMeal").onchange = (e) => { addMeal = e.target.value; };
$("#foodSearch").oninput = renderSearch;
$("#searchResults").onclick = (e) => {
  const del = e.target.closest("[data-del-template]");
  if (del) { if (confirm("Delete this saved meal?")) { remove("templates", del.dataset.delTemplate); renderSearch(); } return; }
  const tp = e.target.closest("[data-template]");
  if (tp) { const t = db.templates[tp.dataset.template]; return logItems(t.items, addMeal, t.name); }
  const b = e.target.closest("[data-food]");
  if (b) openAmount(findFood(b.dataset.food));
};
$("#qaScan").onclick = openScan;
$("#qaPhoto").onclick = () => openAi("meal");
$("#qaManual").onclick = () => openFoodEditor({ name: $("#foodSearch").value.trim() });
$("#offSearchBtn").onclick = () => {
  $("#offQuery").value = $("#foodSearch").value.trim();
  $("#offResults").innerHTML = "";
  openSheet("#offSheet");
  if ($("#offQuery").value) runOffSearch();
};
$("#offGo").onclick = runOffSearch;
$("#offQuery").onkeydown = (e) => { if (e.key === "Enter") runOffSearch(); };
$("#offResults").onclick = (e) => { const b = e.target.closest("[data-off]"); if (b) pickOffFood(offList[+b.dataset.off]); };

$("#amtGrams").oninput = updateAmtPreview;
$("#amtGrams").onkeydown = (e) => { if (e.key === "Enter") saveAmount(); };
$("#amtChips").onclick = (e) => { const c = e.target.closest("[data-g]"); if (c) { $("#amtGrams").value = r1(+c.dataset.g); updateAmtPreview(); } };
$("#amtSave").onclick = saveAmount;
$("#amtDelete").onclick = () => { remove("entries", amt.entryId); closeSheet("#amountSheet"); render(); toast("Deleted"); };
$("#amtEditFood").onclick = () => openFoodEditor(amt.food, { then: amt.entryId ? null : "amount" });

$("#fBasis").onclick = (e) => { const b = e.target.closest("[data-basis]"); if (b) setBasis(b.dataset.basis); };
$("#foodSave").onclick = saveFood;
$("#fName").addEventListener("input", syncEditorJunk);
$("#fBrand").addEventListener("input", syncEditorJunk);
$("#fJunk").addEventListener("change", () => { fJunkTouched = true; });
$("#foodDelete").onclick = () => {
  if (!confirm("Delete this food from your library? Logged entries stay.")) return;
  remove("foods", foodEdit.food.id); closeSheet("#foodSheet"); closeSheet("#amountSheet"); renderSearch(); toast("Food deleted");
};
$("#foodFromPhoto").onclick = () => openAi("label", "food-editor");

$("#scanSheet").addEventListener("close", stopScan);
$("#scanLookup").onclick = () => { const c = $("#scanManual").value.replace(/\D/g, ""); if (c) { stopScan(); handleBarcode(c); } };
$("#scanManual").onkeydown = (e) => { if (e.key === "Enter") $("#scanLookup").click(); };
$("#nfPhoto").onclick = () => { closeSheet("#scanSheet"); openAi("label", "barcode"); };
$("#nfManual").onclick = () => { closeSheet("#scanSheet"); openFoodEditor({ ...lastNotFoundDraft }); };

$("#aiMode").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b) setAiMode(b.dataset.mode); };
$("#aiCopy").onclick = copyPrompt;
$("#aiPasteBtn").onclick = pasteReply;
$("#aiGo").onclick = readReply;
$("#aiReply").addEventListener("paste", () => setTimeout(readReply, 50));
$("#aiResults").addEventListener("input", (e) => {
  const g = e.target.dataset.aiG;
  if (g != null) { aiItems[+g].grams = num(e.target.value) || 0; refreshAiRow(); }
});
$("#aiResults").addEventListener("change", (e) => {
  const u = e.target.dataset.aiUse;
  if (u != null) { aiItems[+u].use = e.target.checked; refreshAiRow(); }
});
$("#aiResults").addEventListener("click", (e) => {
  if (e.target.id === "aiAdd") return addAiItems();
  const j = e.target.closest("[data-ai-junk]");
  if (j) {
    const it = aiItems[+j.dataset.aiJunk];
    it.junk = !it.junk;
    j.classList.toggle("on", it.junk);
    j.textContent = it.junk ? "junk" : "mark junk";
  }
});
function refreshAiRow() {
  // Update the per-row text + totals without rebuilding inputs (keeps focus while typing).
  const rows = $("#aiResults").querySelectorAll(".ai-table tr");
  aiItems.forEach((it, i) => {
    const n = scale(it.per100, it.grams);
    const nt = rows[i]?.querySelector(".nt");
    if (nt) nt.textContent = `${r0(n.kcal)} kcal · P ${r1(n.p)} · C ${r1(n.c)} · F ${r1(n.f)}${it.basis === "estimated" ? " · est." : ""}${it.note ? " · " + it.note : ""}`;
  });
  const tot = sum(aiItems.filter((i) => i.use).map((i) => ({ n: scale(i.per100, i.grams) })));
  const p = $("#aiResults .macro-preview");
  if (p) p.innerHTML = previewHtml(tot);
}

$("#settingsSave").onclick = saveSettings;
$("#syncNowBtn").onclick = () => { saveSettings(); syncNow(); };
$("#exportBtn").onclick = exportJson;
$("#importFile").onchange = (e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; };

let todayAtLoad = localDate();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // If the app was left open overnight, jump to the new day.
    if (localDate() !== todayAtLoad) { todayAtLoad = localDate(); if (!document.querySelector("dialog[open]")) curDate = todayAtLoad; }
    render();
    scheduleSync(200);
  }
});

render();
if (!maybeOnboard()) maybeShowRecap();
if (syncConfigured()) syncNow(); else setSyncState("", "Sync not set up");

// To-do dropdown in the header
function toggleQuestMenu(force) {
  const m = $("#questMenu");
  const open = force ?? m.hidden;
  m.hidden = !open;
  $("#questBtn").setAttribute("aria-expanded", String(open));
}
$("#questBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleQuestMenu(); });
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-anchor")) toggleQuestMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleQuestMenu(false); });
