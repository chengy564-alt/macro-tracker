// Ranked ladder: Iron IV → Challenger. Original crest artwork (inspired by competitive ladders, not copied).

export const TIERS = [
  { id: "iron",        name: "Iron",        c1: "#3c3a39", c2: "#9a948f", gem: "#cfc8c1" },
  { id: "bronze",      name: "Bronze",      c1: "#5a311a", c2: "#c97c45", gem: "#ffb27a" },
  { id: "silver",      name: "Silver",      c1: "#46525d", c2: "#cdd7e0", gem: "#f4f8fb" },
  { id: "gold",        name: "Gold",        c1: "#6e4f12", c2: "#ecc45a", gem: "#fff2b8" },
  { id: "platinum",    name: "Platinum",    c1: "#164f4b", c2: "#5fd6c6", gem: "#d2fff8" },
  { id: "emerald",     name: "Emerald",     c1: "#0c4d2d", c2: "#30d57d", gem: "#c0ffdb" },
  { id: "diamond",     name: "Diamond",     c1: "#24357c", c2: "#93b8ff", gem: "#eef3ff" },
  { id: "master",      name: "Master",      c1: "#43196f", c2: "#b77fff", gem: "#f2e5ff" },
  { id: "grandmaster", name: "Grandmaster", c1: "#5f1419", c2: "#ff5d62", gem: "#ffdcdd" },
  { id: "challenger",  name: "Challenger",  c1: "#183f73", c2: "#ffd35a", gem: "#fffbe8" },
];
const DIVS = ["IV", "III", "II", "I"];
const DIVIDED = 7; // Iron..Diamond have 4 divisions each (levels 1–28)

// Level (1-based) → rank. Levels 29 = Master, 30 = Grandmaster, 31+ = Challenger.
export function rankFor(level) {
  if (level <= DIVIDED * 4) {
    const t = Math.floor((level - 1) / 4);
    const div = DIVS[(level - 1) % 4];
    return { tier: t, ...TIERS[t], div, label: `${TIERS[t].name} ${div}` };
  }
  const t = Math.min(TIERS.length - 1, DIVIDED + (level - DIVIDED * 4 - 1));
  return { tier: t, ...TIERS[t], div: "", label: TIERS[t].name };
}
export const firstLevelOfTier = (t) => (t < DIVIDED ? t * 4 + 1 : DIVIDED * 4 + 1 + (t - DIVIDED));

let uidN = 0;
export function emblemSVG(tier, size = 64) {
  const T = TIERS[tier];
  const id = `em${tier}_${++uidN}`;
  const wings = tier === 0 ? 0 : tier <= 2 ? 1 : tier <= 5 ? 2 : 3;
  const crown = tier >= 7;
  const glow = tier >= 4;
  const wingPaths = [
    "M27 30 Q10 30 4 44 Q16 41 25 47 Z",
    "M26 46 Q8 52 6 70 Q17 61 28 62 Z",
    "M28 62 Q14 72 16 88 Q24 77 33 75 Z",
  ].slice(0, wings);
  const wingSvg = wingPaths.map((d) => `<path d="${d}" fill="url(#${id}w)" stroke="${T.c2}" stroke-width="1" stroke-opacity=".6"/>`).join("");
  return `<svg class="emblem" width="${size}" height="${size}" viewBox="0 0 100 100" aria-label="${T.name} emblem">
  <defs>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.c2}"/><stop offset="1" stop-color="${T.c1}"/></linearGradient>
    <linearGradient id="${id}i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.c1}"/><stop offset="1" stop-color="#050505"/></linearGradient>
    <linearGradient id="${id}w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.c2}" stop-opacity=".95"/><stop offset="1" stop-color="${T.c1}"/></linearGradient>
    <radialGradient id="${id}g" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="${T.gem}"/><stop offset="1" stop-color="${T.c2}"/></radialGradient>
    ${glow ? `<filter id="${id}f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>` : ""}
  </defs>
  ${wingSvg}<g transform="translate(100 0) scale(-1 1)">${wingSvg}</g>
  ${crown ? `<path d="M34 16 L38 4 L44 13 L50 1 L56 13 L62 4 L66 16 Z" fill="url(#${id}s)" stroke="${T.c2}" stroke-width="1"/>` : ""}
  <path d="M50 10 L80 22 L77 60 Q72 80 50 93 Q28 80 23 60 L20 22 Z" fill="url(#${id}s)" stroke="${T.c2}" stroke-width="1.5"/>
  <path d="M50 19 L71 28 L69 58 Q65 73 50 83 Q35 73 31 58 L29 28 Z" fill="url(#${id}i)"/>
  ${glow ? `<path d="M50 33 L62 50 L50 67 L38 50 Z" fill="${T.gem}" opacity=".7" filter="url(#${id}f)"/>` : ""}
  <path d="M50 33 L62 50 L50 67 L38 50 Z" fill="url(#${id}g)" stroke="${T.c2}" stroke-width="1"/>
  <path d="M50 33 L56 50 L50 67 L44 50 Z" fill="#fff" opacity=".18"/>
</svg>`;
}
