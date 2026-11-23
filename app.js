// Macro Log: a personal food/macro tracker. Static site, no server.
// Data lives in localStorage and (optionally) syncs to a private GitHub repo.

import { GENERIC_FOODS } from "./foods.js";

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
  return { foods: {}, entries: {}, settings: { targets: { kcal: 1872, p: 140, c: 164, f: 73, na: 2300 }, updatedAt: 0 } };
}
function loadDb() {
  try {
    const d = JSON.parse(localStorage.getItem(DATA_KEY));
    if (d && d.foods && d.entries) return { ...emptyDb(), ...d };
  } catch {}
  return emptyDb();
}
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
  const out = { foods: {}, entries: {}, settings: a.settings };
  for (const c of ["foods", "entries"]) {
    out[c] = { ...(a[c] || {}) };
    for (const [id, r] of Object.entries(b?.[c] || {})) {
      const cur = out[c][id];
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) out[c][id] = r;
    }
  }
  if ((b?.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0)) out.settings = b.settings;
  return out;
}
function pruneTombstones(d) {
  const cutoff = Date.now() - 90 * 864e5;
  for (const c of ["foods", "entries"]) for (const [id, r] of Object.entries(d[c])) if (r.deleted && r.updatedAt < cutoff) delete d[c][id];
}
function sameAsRemote(local, remote) {
  if (!remote) return false;
  for (const c of ["foods", "entries"]) {
    const L = local[c], R = remote[c] || {};
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
function render() {
  $("#dateLabel").textContent = prettyDate(curDate);
  const list = dayEntries(curDate);
  const tot = sum(list);
  const t = db.settings.targets;
  const left = (t.kcal || 0) - tot.kcal;
  const bar = (k) => {
    const pct = t[k] ? Math.min(100, (tot[k] / t[k]) * 100) : 0;
    const over = t[k] && tot[k] > t[k];
    return `<div class="bar-row"><span>${NLABEL[k]}</span><div class="bar${over ? " over" : ""}"><i style="width:${pct}%;background:var(--${k})"></i></div>
      <span class="num">${r0(tot[k])}${t[k] ? ` / ${r0(t[k])}` : ""}${NUNIT[k]}</span></div>`;
  };
  $("#summary").innerHTML = `
    <div class="big"><b>${r0(tot.kcal)}</b><span class="muted">of ${r0(t.kcal)} kcal · ${left >= 0 ? `${r0(left)} left` : `${r0(-left)} over`}</span></div>
    <div class="bars">${bar("kcal")}${bar("p")}${bar("c")}${bar("f")}${bar("na")}</div>`;

  $("#meals").innerHTML = MEALS.map(([key, label]) => {
    const es = list.filter((e) => e.meal === key);
    const st = sum(es);
    return `<section class="card">
      <div class="meal-head"><h2>${label}</h2>${es.length ? `<span class="muted">${r0(st.kcal)} kcal · P ${r0(st.p)} · C ${r0(st.c)} · F ${r0(st.f)}</span>` : ""}
        <button class="add-link" data-add="${key}">+ Add</button></div>
      ${es.length ? es.map((e) => `<div class="entry" data-entry="${e.id}">
          <div class="grow"><div class="name">${esc(e.name)}</div>
          <div class="sub">${r0(e.grams)} g · P ${r1(e.n.p)} · C ${r1(e.n.c)} · F ${r1(e.n.f)}${e.n.na ? ` · Na ${r0(e.n.na)}mg` : ""}${e.estimated ? " · est." : ""}</div></div>
          <div class="kcal">${r0(e.n.kcal)}</div></div>`).join("") : `<div class="empty">Nothing logged</div>`}
    </section>`;
  }).join("");
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
  const { food, entryId } = amt;
  if (entryId) {
    const e = db.entries[entryId];
    const per100 = e.per100 || food.per100;
    upsert("entries", { ...e, grams, meal, date: $("#amtDate").value || e.date, per100, n: scale(per100, grams) });
    toast("Updated");
  } else {
    const f = ensureInLibrary(food);
    upsert("entries", {
      id: uid(), date: curDate, meal, name: f.brand ? `${f.name} (${f.brand})` : f.name,
      foodId: f.id, grams, per100: { ...f.per100 }, n: scale(f.per100, grams), createdAt: Date.now(),
    });
    toast(`Added to ${MEALS.find((m) => m[0] === meal)[1]}`);
  }
  closeSheet("#amountSheet");
  closeSheet("#addSheet");
  render();
}

// ---------- food editor ----------
let foodEdit = null; // { food (existing or draft), then: 'amount' | null }
let basis = "100";
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
const OFF_FIELDS = "code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity";
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
Give values PER 100 g (or per 100 ml for drinks). If the label only shows per-serving values, convert using the serving size. If no label is visible, use your best knowledge of this exact product and say so in "note". Use 0 for anything genuinely unknown.

Reply with ONLY this JSON in a code block, filled in, nothing else:
\`\`\`json
{"type":"label","name":"","brand":"","serving_label":"","serving_grams":0,"kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"sodium_mg":0,"note":""}
\`\`\``;
  }
  return `Estimate the nutrition of my meal for my macro tracker (photo attached; if there's no photo, go by my description).
What I ate / weights I know: ${note || "(nothing extra, judge from the photo)"}

${RULES}
- List each component as its own item, including oils, sauces, seasonings and toppings. Don't drop small items.
- "basis" is "given" if I stated the amount, otherwise "estimated". Keep "note" short, e.g. "2 medium boneless thighs ≈ 220g".

Reply with ONLY this JSON in a code block, filled in, nothing else:
\`\`\`json
{"type":"meal","summary":"","items":[{"name":"","grams":0,"kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"sodium_mg":0,"basis":"estimated","note":""}]}
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
      name: out.name || "", brand: out.brand || "", per100,
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
      use: true, name: String(it.name), grams: g, basis: it.basis === "given" ? "given" : "estimated", note: it.note || "",
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
        <td><div class="nm">${esc(it.name)}</div><div class="nt">${r0(n.kcal)} kcal · P ${r1(n.p)} · C ${r1(n.c)} · F ${r1(n.f)}${it.basis === "estimated" ? " · est." : ""}${it.note ? " · " + esc(it.note) : ""}</div></td>
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
  chosen.forEach((it, k) => {
    const rec = {
      id: uid() + k, date: curDate, meal, name: it.name, grams: it.grams, per100: it.per100,
      n: scale(it.per100, it.grams), estimated: it.basis === "estimated", createdAt: now + k, updatedAt: now,
    };
    db.entries[rec.id] = rec;
  });
  save();
  closeSheet("#aiSheet");
  closeSheet("#addSheet");
  render();
  toast(`Added ${chosen.length} item${chosen.length > 1 ? "s" : ""}`);
}
function currentEditorDraft() {
  return { id: foodEdit?.food?.id, barcode: $("#fBarcode").value.trim(), name: $("#fName").value.trim(), brand: $("#fBrand").value.trim() };
}

// ---------- history ----------
function renderHistory() {
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(localDate(), -i);
    const t = sum(dayEntries(d));
    rows.push(`<tr class="click" data-day="${d}"><td>${prettyDate(d)}</td><td>${r0(t.kcal)}</td><td>${r0(t.p)}</td><td>${r0(t.c)}</td><td>${r0(t.f)}</td></tr>`);
  }
  const logged = [];
  for (let i = 1; i <= 7; i++) { const t = sum(dayEntries(addDays(localDate(), -i))); if (t.kcal > 0) logged.push(t); }
  const avg = (k) => (logged.length ? r0(logged.reduce((a, t) => a + t[k], 0) / logged.length) : "–");
  $("#historyBody").innerHTML = `
    <p class="muted small">Last 7 days average (days with food logged): <b>${avg("kcal")} kcal</b> · P ${avg("p")}g · C ${avg("c")}g · F ${avg("f")}g</p>
    <table class="hist"><tr><th>Day</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr>${rows.join("")}</table>`;
}

// ---------- settings ----------
function openSettings() {
  const t = db.settings.targets, s = secrets();
  $("#tKcal").value = t.kcal ?? ""; $("#tP").value = t.p ?? ""; $("#tC").value = t.c ?? ""; $("#tF").value = t.f ?? ""; $("#tNa").value = t.na ?? "";
  $("#sOwner").value = s.ghOwner || ""; $("#sRepo").value = s.ghRepo || ""; $("#sToken").value = s.ghToken || "";
  $("#syncInfo").textContent = syncConfigured() ? lastSyncMsg : "Not set up";
  openSheet("#settingsSheet");
}
function saveSettings() {
  db.settings = {
    targets: { kcal: num($("#tKcal").value) || 0, p: num($("#tP").value) || 0, c: num($("#tC").value) || 0, f: num($("#tF").value) || 0, na: num($("#tNa").value) || 0 },
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
$("#openHistory").onclick = () => { renderHistory(); openSheet("#historySheet"); };
$("#historyBody").onclick = (e) => {
  const tr = e.target.closest("[data-day]");
  if (tr) { curDate = tr.dataset.day; render(); closeSheet("#historySheet"); }
};
$("#meals").onclick = (e) => {
  const add = e.target.closest("[data-add]");
  if (add) return openAdd(add.dataset.add);
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
$("#aiResults").addEventListener("click", (e) => { if (e.target.id === "aiAdd") addAiItems(); });
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
if (syncConfigured()) syncNow(); else setSyncState("", "Sync not set up");
