// Game layer: XP, levels, streaks, quests, badges, junk detection, cut coach.
// Everything is DERIVED from the log (entries + weigh-ins), so it stays consistent
// across devices and updates if you edit past days.

import { rankFor } from "./ranks.js?v=6";

export const MAIN_MEALS = ["breakfast", "lunch", "dinner"];

export const XP = {
  meal: 10,          // per main meal logged (max 3)
  protein: 30,       // hit protein target
  proteinClose: 15,  // >= 85% of protein target
  calOnTarget: 40,   // closed day within [target-300, target+5%]
  calUnder: 20,      // closed day 300–500 under target
  overSmall: -15,    // 5–15% over target
  overBig: -50,      // >15% over target
  junk: -30,         // each junk item (max 3 counted)
  junkFree: 10,      // closed day with 2+ meals and no junk
  weighIn: 5,
  perfect: 25,       // 3 meals + protein + calories + no junk
  missed: -30,       // past day with nothing logged
};

export const titleFor = (lvl) => rankFor(lvl).label;

// XP to go from level L to L+1.
// LP to climb one division. Iron→Bronze ≈ 5 good days, Gold ≈ 3–4 weeks, Diamond ≈ 10 weeks, Challenger ≈ 15 weeks.
export const xpForLevel = (L) => 150 + 25 * (L - 1);
export function levelFromXP(xp) {
  let L = 1, rest = xp;
  while (rest >= xpForLevel(L)) { rest -= xpForLevel(L); L++; }
  return { level: L, into: rest, need: xpForLevel(L) };
}

// ---------- junk detection ----------
const JUNK_WORDS = [
  "mcdonald", "big mac", "mcflurry", "kfc", "burger king", "whopper", "five guys", "wendy", "taco bell", "domino",
  "papa john", "pizza hut", "popeyes", "chick-fil", "greggs", "wingstop", "nando", "takeaway", "take away", "fast food",
  "pizza", "burger", "fries", "chips", "crisps", "doritos", "pringles", "cheetos", "walkers", "nachos", "fried chicken",
  "nuggets", "hot dog", "kebab", "donut", "doughnut", "cookie", "brownie", "cake", "cupcake", "muffin", "croissant",
  "pastry", "ice cream", "milkshake", "candy", "sweets", "gummy", "haribo", "chocolate bar", "snickers", "mars bar",
  "kitkat", "kit kat", "twix", "oreo", "cadbury", "dairy milk", "coca-cola", "coca cola", "coke", "pepsi", "fanta",
  "sprite", "7up", "energy drink", "red bull", "monster energy", "lucozade", "beer", "lager", "cider", "wine", "vodka",
  "whisky", "whiskey", "rum", "gin", "cocktail", "frappuccino", "waffle", "pancake", "churro",
];
const NOT_JUNK_WORDS = ["zero", "diet", "sugar free", "sugar-free", "no sugar", "protein", "max ", "light", "lite"];

export function isJunkName(text) {
  const t = ` ${String(text || "").toLowerCase()} `;
  if (NOT_JUNK_WORDS.some((w) => t.includes(w))) return false;
  return JUNK_WORDS.some((w) => t.includes(w));
}
// food.junk is a manual override (true/false) remembered per food.
export function autoJunk(food) {
  if (food?.junk === true || food?.junk === false) return food.junk;
  if (food?.nutriscore === "e") return true;
  return isJunkName(`${food?.name || ""} ${food?.brand || ""}`);
}

// ---------- dates ----------
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

// ---------- core computation ----------
export function computeGame(db, today) {
  const T = db.settings.targets;
  const entries = Object.values(db.entries).filter((e) => !e.deleted);
  const weights = Object.values(db.weights || {}).filter((w) => !w.deleted && w.kg > 0);
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const weighedOn = new Set(weights.map((w) => w.date));
  const allDates = [...byDate.keys(), ...weighedOn].filter((d) => d <= today).sort();
  const firstDay = allDates[0] || today;

  const days = new Map();
  let running = 0, streak = 0, bestStreak = 0, perfectRun = 0, bestPerfectRun = 0, cleanRun = 0, bestCleanRun = 0;
  let proteinDays = 0, perfectDays = 0, loggedDays = 0;

  for (let d = firstDay; d <= today; d = addDays(d, 1)) {
    const closed = d < today;
    const list = byDate.get(d) || [];
    const tot = { kcal: 0, p: 0, c: 0, f: 0, na: 0 };
    for (const e of list) for (const k in tot) tot[k] += e.n?.[k] || 0;
    const meals = MAIN_MEALS.filter((m) => list.some((e) => e.meal === m)).length;
    const junkList = list.filter((e) => e.junk);
    const items = []; // [xp, label]
    const warn = [];
    const proteinHit = tot.p >= T.p;
    const calLow = T.kcal - 300, calHigh = T.kcal * 1.05;
    let calOK = false;

    if (!list.length) {
      if (closed) items.push([XP.missed, "Missed day: nothing logged"]);
    } else {
      if (meals) items.push([XP.meal * meals, `${meals}/3 main meals logged`]);
      if (proteinHit) items.push([XP.protein, "Protein goal hit"]);
      else if (tot.p >= T.p * 0.85) items.push([XP.proteinClose, "Protein almost there"]);
      if (tot.kcal > T.kcal * 1.15) items.push([XP.overBig, `Blew the calorie target (+${Math.round(tot.kcal - T.kcal)} kcal)`]);
      else if (tot.kcal > calHigh) items.push([XP.overSmall, `Over calorie target (+${Math.round(tot.kcal - T.kcal)} kcal)`]);
      else if (closed && meals >= 2) {
        if (tot.kcal >= calLow) { items.push([XP.calOnTarget, "Calories on target"]); calOK = true; }
        else if (tot.kcal >= T.kcal - 500) items.push([XP.calUnder, "Under calorie target"]);
        else warn.push("Way under target: too aggressive, you'll lose muscle and burn out");
      }
      junkList.slice(0, 3).forEach((e) => items.push([XP.junk, `Junk: ${e.name}`]));
      if (closed && meals >= 2 && !junkList.length) items.push([XP.junkFree, "Junk-free day"]);
    }
    if (weighedOn.has(d)) items.push([XP.weighIn, "Weighed in"]);
    const perfect = closed && meals === 3 && proteinHit && calOK && !junkList.length;
    if (perfect) items.push([XP.perfect, "PERFECT DAY"]);

    // Streak = consecutive days with 2+ main meals logged. Today only extends it, never breaks it.
    if (meals >= 2) streak++;
    else if (closed) streak = 0;
    bestStreak = Math.max(bestStreak, streak);
    if (closed) {
      perfectRun = perfect ? perfectRun + 1 : 0;
      bestPerfectRun = Math.max(bestPerfectRun, perfectRun);
      const clean = meals >= 2 && !junkList.length;
      cleanRun = clean ? cleanRun + 1 : 0;
      bestCleanRun = Math.max(bestCleanRun, cleanRun);
    }
    if (proteinHit) proteinDays++;
    if (perfect) perfectDays++;
    if (list.length) loggedDays++;

    const positive = items.reduce((a, [x]) => a + (x > 0 ? x : 0), 0);
    const mult = Math.min(streak, 14) * 0.05;
    // No streak bonus on a day with junk or overeating.
    const dirty = junkList.length > 0 || tot.kcal > calHigh;
    const bonus = meals >= 2 && !dirty ? Math.round(positive * mult) : 0;
    if (bonus > 0) items.push([bonus, `Streak bonus · ${streak} days (+${Math.round(mult * 100)}%)`]);

    const xp = items.reduce((a, [x]) => a + x, 0);
    running = Math.max(0, running + xp);
    days.set(d, { date: d, closed, xp, items, warn, tot, meals, junk: junkList.length, proteinHit, calOK, perfect, logged: list.length > 0, streak });
  }

  const todayInfo = days.get(today);
  const yesterday = addDays(today, -1);
  const lv = levelFromXP(running);
  // Streak shown = streak including today if today already counts, else the one carried from yesterday.
  const curStreak = todayInfo?.meals >= 2 ? todayInfo.streak : (days.get(yesterday)?.streak ?? 0);

  // ---------- weight trend ----------
  const wsorted = weights.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const avgOver = (from, to) => {
    const w = wsorted.filter((x) => x.date > from && x.date <= to);
    return w.length ? w.reduce((a, x) => a + x.kg, 0) / w.length : null;
  };
  const avgNow = avgOver(addDays(today, -7), today);
  const avgPrev = avgOver(addDays(today, -14), addDays(today, -7));
  const firstAvg = wsorted.length ? wsorted.slice(0, 3).reduce((a, x) => a + x.kg, 0) / Math.min(3, wsorted.length) : null;
  const lost = avgNow != null && firstAvg != null ? firstAvg - avgNow : 0;
  const ratePerWeek = avgNow != null && avgPrev != null ? avgPrev - avgNow : null;

  // Average intake over closed logged days in the last 7 days.
  const recent = [];
  for (let i = 1; i <= 7; i++) { const x = days.get(addDays(today, -i)); if (x?.meals >= 2) recent.push(x); }
  const avgKcal = recent.length ? recent.reduce((a, x) => a + x.tot.kcal, 0) / recent.length : null;
  const avgProtein = recent.length ? recent.reduce((a, x) => a + x.tot.p, 0) / recent.length : null;
  const maint = db.settings.maintenance || 0;
  const expectedRate = avgKcal != null && maint ? ((maint - avgKcal) * 7) / 7700 : null;

  // ---------- badges ----------
  const scanned = Object.values(db.foods).some((f) => !f.deleted && f.barcode);
  const goal = db.settings.goalKg;
  const B = (id, icon, name, desc, earned, progress) => ({ id, icon, name, desc, earned: !!earned, progress });
  const badges = [
    B("first", "1st", "First Bite", "Log your first food", entries.length > 0),
    B("scan", "▥", "Scanner", "Scan a barcode", scanned),
    B("s3", "3d", "On Fire", "3-day logging streak", bestStreak >= 3, [Math.min(bestStreak, 3), 3]),
    B("s7", "7d", "Week Warrior", "7-day logging streak", bestStreak >= 7, [Math.min(bestStreak, 7), 7]),
    B("s14", "14d", "Habit Formed", "14-day logging streak", bestStreak >= 14, [Math.min(bestStreak, 14), 14]),
    B("s30", "30d", "Unbreakable", "30-day logging streak", bestStreak >= 30, [Math.min(bestStreak, 30), 30]),
    B("p7", "P7", "Protein Pro", "Hit protein on 7 days", proteinDays >= 7, [Math.min(proteinDays, 7), 7]),
    B("p30", "P30", "Protein Machine", "Hit protein on 30 days", proteinDays >= 30, [Math.min(proteinDays, 30), 30]),
    B("perfect", "★", "Perfect Day", "3 meals, protein, calories, no junk", perfectDays >= 1),
    B("perfect3", "★3", "Hat Trick", "3 perfect days in a row", bestPerfectRun >= 3, [Math.min(bestPerfectRun, 3), 3]),
    B("perfect7", "★7", "Perfect Week", "7 perfect days in a row", bestPerfectRun >= 7, [Math.min(bestPerfectRun, 7), 7]),
    B("clean7", "C7", "Clean Week", "7 junk-free days in a row", bestCleanRun >= 7, [Math.min(bestCleanRun, 7), 7]),
    B("clean30", "C30", "Clean Month", "30 junk-free days in a row", bestCleanRun >= 30, [Math.min(bestCleanRun, 30), 30]),
    B("kg1", "−1", "First Kilo", "Trend weight down 1 kg", lost >= 1, [Math.max(0, Math.min(lost, 1)).toFixed(1), 1]),
    B("kg3", "−3", "Three Down", "Trend weight down 3 kg", lost >= 3, [Math.max(0, Math.min(lost, 3)).toFixed(1), 3]),
    B("kg5", "−5", "Shredded Five", "Trend weight down 5 kg", lost >= 5, [Math.max(0, Math.min(lost, 5)).toFixed(1), 5]),
    B("goal", "◎", "Goal Weight", "Reach your goal weight", goal && avgNow != null && avgNow <= goal),
    B("rBronze", "Br", "Bronze", "Get promoted to Bronze", lv.level >= 5),
    B("rSilver", "Si", "Silver", "Get promoted to Silver", lv.level >= 9),
    B("rGold", "Au", "Gold", "Get promoted to Gold", lv.level >= 13),
    B("rPlat", "Pt", "Platinum", "Get promoted to Platinum", lv.level >= 17),
    B("rDiamond", "Di", "Diamond", "Get promoted to Diamond", lv.level >= 25),
    B("rChall", "Ch", "Challenger", "Reach Challenger", lv.level >= 31),
    B("e100", "100", "Centurion", "Log 100 items", entries.length >= 100, [Math.min(entries.length, 100), 100]),
  ];

  // ---------- coach ----------
  const coach = [];
  if (wsorted.length < 4) coach.push("Weigh in every morning (after the toilet, before food). Daily weight jumps around; the 7-day average is what matters.");
  if (avgProtein != null && avgProtein < T.p * 0.85) coach.push(`Protein is averaging ${Math.round(avgProtein)}g. Get it to ${T.p}g+ so you keep muscle while cutting.`);
  if (ratePerWeek != null && avgNow) {
    const pct = (ratePerWeek / avgNow) * 100;
    if (pct > 1.1) coach.push(`Losing ${ratePerWeek.toFixed(2)} kg/week. That's fast; add 100–200 kcal so you hold on to muscle.`);
    else if (ratePerWeek < 0.15 && recent.length >= 5) coach.push(`Trend is flat (${ratePerWeek.toFixed(2)} kg/week) despite logging. Drop the target by ~150 kcal or add ~3k steps/day.`);
    else if (ratePerWeek >= 0.15) coach.push(`On track: losing ${ratePerWeek.toFixed(2)} kg/week. Keep doing exactly this.`);
  }
  if (avgKcal != null && avgKcal < T.kcal - 500) coach.push(`You're averaging ${Math.round(avgKcal)} kcal, well under target. Undereating backfires (binges, muscle loss). Eat closer to ${T.kcal}.`);
  if (goal && avgNow != null && avgNow > goal) {
    const rate = ratePerWeek > 0.1 ? ratePerWeek : expectedRate > 0.1 ? expectedRate : null;
    if (rate) coach.push(`${(avgNow - goal).toFixed(1)} kg to go: about ${Math.ceil((avgNow - goal) / rate)} weeks at this pace.`);
  }

  return {
    days, today: todayInfo, totalXP: running, ...lv, title: titleFor(lv.level), rank: rankFor(lv.level), nextRank: rankFor(lv.level + 1), streak: curStreak, bestStreak,
    badges, firstDay, yesterday: days.get(yesterday),
    weight: { avgNow, avgPrev, ratePerWeek, lost, expectedRate, avgKcal, avgProtein, count: wsorted.length, latest: wsorted[wsorted.length - 1] },
    coach,
  };
}

// Points today's remaining quests can still earn, for "win it back" messages.
export function questsFor(g, T) {
  const t = g.today || { meals: 0, tot: { kcal: 0, p: 0 }, junk: 0 };
  const calHigh = Math.round(T.kcal * 1.05), calLow = Math.round(T.kcal - 300);
  const over = t.tot.kcal > calHigh;
  return [
    { icon: "🍽️", label: "Log breakfast, lunch & dinner", xp: 30, done: t.meals >= 3, progress: `${t.meals}/3` },
    { icon: "🥩", label: `Hit ${T.p}g protein`, xp: 30, done: t.tot.p >= T.p, progress: `${Math.round(t.tot.p)}/${T.p}g` },
    { icon: "🎯", label: `Finish between ${calLow}–${calHigh} kcal`, xp: 40, done: false, failed: over,
      progress: over ? `over by ${Math.round(t.tot.kcal - T.kcal)}` : `${Math.round(t.tot.kcal)} so far` },
    { icon: "🥦", label: "No junk food", xp: 10, done: false, failed: t.junk > 0, progress: t.junk ? `${t.junk} junk` : "clean so far" },
    { icon: "⚖️", label: "Weigh in", xp: 5, done: !!g.weighedToday, progress: "" },
  ];
}
