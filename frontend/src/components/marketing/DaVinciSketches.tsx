/**
 * Codex-style studies for the Echo Vue evolution story, drawn in the manner of Leonardo's notebooks:
 * parchment, iron-gall ink, red chalk, hatched shading, mirror-written notes.
 *
 * Every sheet is a 3840x2160 (4K) SVG, so it stays sharp at any size, up to and including 4K displays.
 * They are illustrations: figures and positions are drawn for effect, not plotted from data.
 */

const INK = "#3b2a1a";
const RED = "#9a3b26";
const SCRIPT = "'Segoe Script','Bradley Hand','Lucida Handwriting','Apple Chancery','Snell Roundhand',cursive";

export const SHEET_W = 3840;
export const SHEET_H = 2160;

/* ───────────────────────── primitives ───────────────────────── */

function Defs({ p }: { p: string }) {
  return (
    <defs>
      <radialGradient id={`${p}-paper`} cx="50%" cy="45%" r="75%">
        <stop offset="0" stopColor="#efe0b8" /><stop offset="0.65" stopColor="#e2cd98" /><stop offset="1" stopColor="#c7a96d" />
      </radialGradient>
      <filter id={`${p}-grain`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="11" />
        <feColorMatrix type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.26  0 0 0 0 0.12  1.1 0 0 0 -0.42" />
      </filter>
      <filter id={`${p}-stain`} x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.0035" numOctaves="4" seed="5" />
        <feColorMatrix type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.34  0 0 0 0 0.14  0.9 0 0 0 -0.32" />
      </filter>
      <filter id={`${p}-rough`} x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="turbulence" baseFrequency="0.011" numOctaves="2" seed="4" result="t" />
        <feDisplacementMap in="SourceGraphic" in2="t" scale="9" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <radialGradient id={`${p}-vig`} cx="50%" cy="50%" r="72%">
        <stop offset="0.62" stopColor="#5a3a14" stopOpacity="0" /><stop offset="1" stopColor="#4a2e0f" stopOpacity="0.5" />
      </radialGradient>
      <pattern id={`${p}-h1`} width="20" height="20" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <line x1="0" y1="0" x2="0" y2="20" stroke={INK} strokeWidth="2.4" opacity="0.5" />
      </pattern>
      <pattern id={`${p}-h2`} width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
        <line x1="0" y1="0" x2="0" y2="11" stroke={INK} strokeWidth="2.2" opacity="0.62" />
      </pattern>
      <pattern id={`${p}-hr`} width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
        <line x1="0" y1="0" x2="0" y2="16" stroke={RED} strokeWidth="2.2" opacity="0.5" />
      </pattern>
    </defs>
  );
}

function Sheet({ p, label, children }: { p: string; label: string; children: React.ReactNode }) {
  return (
    <svg viewBox={`0 0 ${SHEET_W} ${SHEET_H}`} className="w-full h-auto" role="img" aria-label={label}>
      <Defs p={p} />
      <rect width={SHEET_W} height={SHEET_H} fill={`url(#${p}-paper)`} />
      <rect width={SHEET_W} height={SHEET_H} filter={`url(#${p}-stain)`} opacity={0.5} />
      <rect width={SHEET_W} height={SHEET_H} filter={`url(#${p}-grain)`} opacity={0.55} />
      <g filter={`url(#${p}-rough)`}>{children}</g>
      <rect width={SHEET_W} height={SHEET_H} fill={`url(#${p}-vig)`} />
      <rect x={34} y={34} width={SHEET_W - 68} height={SHEET_H - 68} fill="none" stroke={INK} strokeWidth={3} opacity={0.45} />
    </svg>
  );
}

type PathProps = { d: string; w?: number; c?: string; o?: number; fill?: string; dash?: string; cap?: "round" | "butt" };

/** A path drawn twice with a slight offset, the way a hand redraws a line. */
function Ink({ d, w = 4, c = INK, o = 0.92, fill = "none", dash, cap = "round" }: PathProps) {
  return (
    <>
      <path d={d} fill={fill} stroke={c} strokeWidth={w} strokeOpacity={o} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={dash} />
      <path d={d} fill="none" stroke={c} strokeWidth={w * 0.45} strokeOpacity={o * 0.55} strokeLinecap={cap} strokeLinejoin="round" strokeDasharray={dash} transform="translate(2.4 -1.8)" />
    </>
  );
}

function Line({ x1, y1, x2, y2, ...r }: { x1: number; y1: number; x2: number; y2: number } & Omit<PathProps, "d">) {
  return <Ink d={`M${x1} ${y1} L${x2} ${y2}`} {...r} />;
}

function Note({ x, y, s, size = 46, c = INK, anchor = "start", mirror = false, rot = 0, o = 0.95 }: {
  x: number; y: number; s: string; size?: number; c?: string; anchor?: "start" | "middle" | "end"; mirror?: boolean; rot?: number; o?: number;
}) {
  const t = `translate(${x} ${y}) rotate(${rot})${mirror ? " scale(-1 1)" : ""}`;
  const a = mirror ? (anchor === "start" ? "end" : anchor === "end" ? "start" : "middle") : anchor;
  return <text transform={t} fill={c} fontFamily={SCRIPT} fontSize={size} textAnchor={a} fontStyle="italic" opacity={o} style={{ whiteSpace: "pre" }}>{s}</text>;
}

/** A limb or bone: a rounded capsule between two points, hatched for shading. */
function Capsule({ p, a, b, wa, wb, hatch = "h1" }: { p: string; a: [number, number]; b: [number, number]; wa: number; wb: number; hatch?: string }) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const pts = [
    [a[0] + nx * wa, a[1] + ny * wa], [b[0] + nx * wb, b[1] + ny * wb],
    [b[0] - nx * wb, b[1] - ny * wb], [a[0] - nx * wa, a[1] - ny * wa],
  ];
  const d = `M${pts[0][0]} ${pts[0][1]} L${pts[1][0]} ${pts[1][1]} A${wb} ${wb} 0 0 1 ${pts[2][0]} ${pts[2][1]} L${pts[3][0]} ${pts[3][1]} A${wa} ${wa} 0 0 1 ${pts[0][0]} ${pts[0][1]} Z`;
  return (
    <>
      <path d={d} fill={`url(#${p}-${hatch})`} opacity={0.55} />
      <Ink d={d} w={4} fill="rgba(239,224,184,0.25)" />
    </>
  );
}

function Cartouche({ x, y, w, title, sub }: { x: number; y: number; w: number; title: string; sub?: string }) {
  return (
    <g>
      <Ink d={`M${x} ${y} Q${x + w / 2} ${y - 26} ${x + w} ${y} L${x + w - 26} ${y + 70} L${x + w} ${y + 140} Q${x + w / 2} ${y + 166} ${x} ${y + 140} L${x + 26} ${y + 70} Z`} w={4} fill="rgba(239,224,184,0.45)" />
      <Note x={x + w / 2} y={y + 82} s={title} size={58} anchor="middle" />
      {sub && <Note x={x + w / 2} y={y + 124} s={sub} size={34} anchor="middle" c={RED} />}
    </g>
  );
}

function Compass({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const pts = [0, 90, 180, 270].map((a) => {
    const rad = (a * Math.PI) / 180;
    return [cx + Math.sin(rad) * r, cy - Math.cos(rad) * r] as [number, number];
  });
  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 0.78} fill="none" stroke={INK} strokeWidth={3} opacity={0.7} />
      <circle cx={cx} cy={cy} r={r * 0.6} fill="none" stroke={INK} strokeWidth={2} opacity={0.5} />
      {pts.map(([x, y], i) => <Ink key={i} d={`M${cx} ${cy} L${x} ${y}`} w={3} />)}
      <Ink d={`M${cx} ${cy - r} L${cx + r * 0.16} ${cy} L${cx} ${cy + r * 0.25} L${cx - r * 0.16} ${cy} Z`} w={3} fill={RED} o={0.8} />
      <Note x={cx} y={cy - r - 14} s="N" size={44} anchor="middle" />
    </g>
  );
}

/* ───────────────────────── Sheet 1: the skeleton ───────────────────────── */

const KP: [number, number][] = [
  [1100, 395], [1062, 352], [1138, 352], [1008, 378], [1192, 378],
  [940, 590], [1260, 590], [800, 840], [1400, 840], [700, 1080], [1500, 1080],
  [1020, 1130], [1180, 1130], [985, 1520], [1215, 1520], [960, 1880], [1240, 1880],
];
const EXTRA: [number, number][] = [
  [665, 1185], [1535, 1185], [690, 1150], [1510, 1150], [900, 1928], [1300, 1928], [945, 1908], [1255, 1908],
  [1070, 448], [1130, 448], [1086, 350], [1114, 350], [1040, 352], [1160, 352],
];

export function SkeletonSketch() {
  const p = "sk";
  const sine = Array.from({ length: 90 }, (_, i) => {
    const x = 2380 + i * 14.5;
    const y = 1330 + Math.sin(i * 0.42) * 80;
    return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
  return (
    <Sheet p={p} label="Codex-style study of the three-dimensional skeleton Echo Vue once rendered from a camera, with a Vitruvian circle and square">
      {/* construction: Vitruvian circle and square */}
      <circle cx={1100} cy={1130} r={880} fill="none" stroke={INK} strokeWidth={3} opacity={0.7} />
      <rect x={280} y={260} width={1640} height={1640} fill="none" stroke={INK} strokeWidth={3} opacity={0.6} />
      <Line x1={200} y1={1130} x2={2000} y2={1130} w={2} o={0.45} dash="14 12" />
      <Line x1={1100} y1={190} x2={1100} y2={2070} w={2} o={0.45} dash="14 12" />
      <Line x1={280} y1={260} x2={1920} y2={1900} w={2} o={0.3} dash="8 14" />
      <Line x1={1920} y1={260} x2={280} y2={1900} w={2} o={0.3} dash="8 14" />

      {/* skull, jaw, neck, collar */}
      <ellipse cx={1100} cy={380} rx={92} ry={114} fill={`url(#${p}-h1)`} opacity={0.4} />
      <ellipse cx={1100} cy={380} rx={92} ry={114} fill="rgba(239,224,184,0.22)" stroke={INK} strokeWidth={4} />
      <Ink d="M1026 430 Q1100 540 1174 430" w={4} />
      <Ink d="M1062 372 Q1074 360 1086 372 M1114 372 Q1126 360 1138 372" w={3} />
      <Ink d="M1100 380 L1092 420 L1108 420" w={3} />
      <Line x1={1100} y1={495} x2={1100} y2={560} w={4} />
      <Ink d="M940 590 Q1020 548 1100 566 Q1180 548 1260 590" w={5} />

      {/* ribcage and spine */}
      <ellipse cx={1100} cy={770} rx={150} ry={192} fill={`url(#${p}-h1)`} opacity={0.35} />
      {[650, 700, 750, 800, 850].flatMap((y) => [
        <Ink key={`l${y}`} d={`M1100 ${y} Q930 ${y + 8} 962 ${y + 70}`} w={3} />,
        <Ink key={`r${y}`} d={`M1100 ${y} Q1270 ${y + 8} 1238 ${y + 70}`} w={3} />,
      ])}
      <Ink d="M1100 566 C1082 700 1118 880 1100 1130" w={6} />
      <Ink d="M1010 1092 Q1100 1190 1190 1092 Q1236 1134 1190 1196 Q1100 1236 1010 1196 Q964 1134 1010 1092 Z" w={4} fill={`url(#${p}-h2)`} />

      {/* limbs */}
      <Capsule p={p} a={[940, 590]} b={[800, 840]} wa={22} wb={17} />
      <Capsule p={p} a={[800, 840]} b={[700, 1080]} wa={17} wb={13} />
      <Capsule p={p} a={[1260, 590]} b={[1400, 840]} wa={22} wb={17} />
      <Capsule p={p} a={[1400, 840]} b={[1500, 1080]} wa={17} wb={13} />
      <Capsule p={p} a={[1020, 1130]} b={[985, 1520]} wa={34} wb={24} hatch="h2" />
      <Capsule p={p} a={[985, 1520]} b={[960, 1880]} wa={24} wb={17} hatch="h2" />
      <Capsule p={p} a={[1180, 1130]} b={[1215, 1520]} wa={34} wb={24} hatch="h2" />
      <Capsule p={p} a={[1215, 1520]} b={[1240, 1880]} wa={24} wb={17} hatch="h2" />
      {[[700, 1080, 665, 1185], [700, 1080, 690, 1190], [700, 1080, 715, 1185], [1500, 1080, 1535, 1185], [1500, 1080, 1510, 1190], [1500, 1080, 1485, 1185]].map(([x1, y1, x2, y2], i) => (
        <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} w={3} />
      ))}
      <Ink d="M960 1880 L890 1925 L1000 1930 Z M1240 1880 L1310 1925 L1200 1930 Z" w={4} fill={`url(#${p}-h2)`} />
      <circle cx={985} cy={1520} r={26} fill="none" stroke={INK} strokeWidth={3} />
      <circle cx={1215} cy={1520} r={26} fill="none" stroke={INK} strokeWidth={3} />

      {/* the keypoints: 17 seen by the camera (red chalk), the rest inferred (hollow) */}
      {EXTRA.map(([x, y], i) => <circle key={`e${i}`} cx={x} cy={y} r={11} fill="none" stroke={INK} strokeWidth={2.4} opacity={0.75} />)}
      {KP.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={22} fill="none" stroke={RED} strokeWidth={4} />
          <circle cx={x} cy={y} r={5.5} fill={RED} />
          <Note x={x + (x < 1100 ? -34 : 34)} y={y - 18} s={`${i + 1}`} size={30} c={RED} anchor={x < 1100 ? "end" : "start"} />
        </g>
      ))}

      {/* notes */}
      <Note x={1100} y={150} s="Studio of the Digital Body" size={84} anchor="middle" />
      <Note x={1100} y={2118} s="Echo Vue · April MMXXVI" size={34} anchor="middle" c={RED} />
      <Note x={2300} y={170} s="la macchina vede diciassette punti" size={46} mirror c={INK} anchor="start" o={0.8} />
      <Note x={250} y={420} s="Seventeen points are seen by the camera;" size={38} rot={-6} />
      <Note x={232} y={472} s="the machine draws sixteen more." size={38} rot={-6} />

      {/* the camera that did the seeing */}
      <Ink d="M2380 330 L3000 330 L3030 640 L2350 640 Z" w={5} fill="rgba(239,224,184,0.3)" />
      <Ink d="M2300 660 L3080 660 L3120 700 L2260 700 Z" w={5} fill={`url(#${p}-h1)`} />
      <circle cx={2690} cy={362} r={13} fill={INK} /><circle cx={2690} cy={362} r={26} fill="none" stroke={INK} strokeWidth={3} />
      <Ink d="M2664 340 L1560 560 M2664 384 L1500 1060" w={3} dash="16 14" o={0.7} />
      <Note x={2690} y={520} s="webcam" size={50} anchor="middle" />
      <Note x={2690} y={590} s="TF.js · MoveNet" size={38} anchor="middle" c={RED} />
      <Note x={2330} y={790} s="a laptop camera drew the skeleton;" size={40} />
      <Note x={2330} y={844} s="the 3D viewer only gave it a room." size={40} />

      {/* the honest study: breathing was a formula */}
      <Ink d="M2350 1090 L3700 1090 L3700 1580 L2350 1580 Z" w={4} fill="rgba(239,224,184,0.22)" />
      <Line x1={2350} y1={1330} x2={3700} y2={1330} w={2} o={0.5} dash="10 12" />
      <Ink d={sine} w={5} c={RED} />
      <Note x={2380} y={1050} s="respirazione" size={48} mirror anchor="start" o={0.8} />
      <Note x={2350} y={1650} s="breath ≈ 15.5 / min ± 1.5, drawn by a formula:" size={38} c={RED} />
      <Note x={2350} y={1704} s="a placeholder for a signal not yet measured." size={38} c={RED} />
      <Note x={2350} y={1860} s="Honest field note: the pretty curve above was a" size={36} />
      <Note x={2350} y={1914} s="stand-in for the real signal, drawn by a formula." size={36} />
    </Sheet>
  );
}

/* ───────────────────────── Sheet 2: the map with dots ───────────────────────── */

export function MapSketch() {
  const p = "mp";
  const dots: [number, number][] = [[900, 1080], [1560, 1040], [2330, 1110], [3040, 990], [1900, 650]];
  const trails = [
    "M480 1060 C 640 980 760 1140 900 1080",
    "M1180 1160 C 1300 1000 1440 1100 1560 1040",
    "M1950 990 C 2100 1160 2220 1040 2330 1110",
    "M2640 1180 C 2780 1020 2900 1090 3040 990",
    "M1900 900 C 1860 800 1930 740 1900 650",
  ];
  return (
    <Sheet p={p} label="Codex-style study of the live floor plan map, showing presence as dots and movement as dashed trails along a hallway">
      <Cartouche x={420} y={150} w={1200} title="Pianta · The Live Floor Plan" sub="April MMXXVI" />

      {/* building shell and corridor */}
      <Ink d="M360 420 L3480 420 L3480 1740 L360 1740 Z" w={6} fill="rgba(239,224,184,0.18)" />
      <rect x={360} y={900} width={3120} height={360} fill={`url(#${p}-h1)`} opacity={0.28} />
      <Ink d="M360 900 L3480 900 M360 1260 L3480 1260" w={5} />
      {Array.from({ length: 12 }).flatMap((_, i) => {
        const x = 360 + i * 260;
        return [
          <Ink key={`t${i}`} d={`M${x} 420 L${x} 900`} w={4} />,
          <Ink key={`b${i}`} d={`M${x} 1260 L${x} 1740`} w={4} />,
          <Ink key={`ta${i}`} d={`M${x + 70} 900 A60 60 0 0 1 ${x + 130} 840`} w={2.5} o={0.6} />,
          <Ink key={`ba${i}`} d={`M${x + 70} 1260 A60 60 0 0 0 ${x + 130} 1320`} w={2.5} o={0.6} />,
          <rect key={`th${i}`} x={x + 14} y={436} width={232} height={150} fill={`url(#${p}-h1)`} opacity={0.18} />,
        ];
      })}
      <Note x={1920} y={1090} s="Floor 2 Hallway" size={62} anchor="middle" o={0.75} />
      <Note x={500} y={700} s="Lobby" size={52} anchor="start" o={0.7} />
      <Note x={3200} y={1560} s="Pool" size={52} anchor="start" o={0.7} />

      {/* trails, then presence dots with ripples */}
      {trails.map((d, i) => <Ink key={i} d={d} w={5} c={RED} dash="4 22" o={0.9} />)}
      {trails.map((d, i) => {
        const end = d.trim().split(" ").slice(-2).map(Number) as [number, number];
        return <Ink key={`a${i}`} d={`M${end[0] - 44} ${end[1] - 26} L${end[0] - 8} ${end[1]} L${end[0] - 44} ${end[1] + 26}`} w={5} c={RED} />;
      })}
      {dots.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={96} fill="none" stroke={RED} strokeWidth={3} strokeDasharray="10 12" opacity={0.55} />
          <circle cx={x} cy={y} r={60} fill="none" stroke={RED} strokeWidth={3.5} opacity={0.7} />
          <circle cx={x} cy={y} r={26} fill={RED} opacity={0.9} />
          <circle cx={x} cy={y} r={26} fill={`url(#${p}-h2)`} opacity={0.4} />
        </g>
      ))}

      {/* furniture of a map */}
      <Compass cx={3600} cy={310} r={150} />
      <Ink d="M360 1860 L1160 1860 M360 1840 L360 1880 M760 1850 L760 1870 M1160 1840 L1160 1880" w={4} />
      <Note x={360} y={1930} s="10 m" size={38} />
      <circle cx={1500} cy={1850} r={24} fill={RED} opacity={0.9} />
      <Note x={1545} y={1862} s="presence" size={40} />
      <Ink d="M1840 1850 L2080 1850 M2040 1824 L2080 1850 L2040 1876" w={5} c={RED} dash="4 20" />
      <Note x={2110} y={1862} s="movement" size={40} />
      <Note x={2640} y={1862} s="positions drawn from demonstration data," size={36} c={RED} />
      <Note x={2640} y={1912} s="not from a sensor in the building." size={36} c={RED} />
      <Note x={3480} y={160} s="la pianta vivente" size={46} mirror anchor="start" o={0.75} />
    </Sheet>
  );
}

/* ───────────────────────── Sheet 3: the journey (timeline map) ───────────────────────── */

function Flag({ x, y, date, title, side = "right" }: { x: number; y: number; date: string; title: string; side?: "left" | "right" }) {
  const dir = side === "right" ? 1 : -1;
  return (
    <g>
      <Ink d={`M${x} ${y} L${x} ${y - 150}`} w={5} />
      <Ink d={`M${x} ${y - 150} L${x + dir * 96} ${y - 126} L${x} ${y - 100} Z`} w={4} fill={RED} o={0.85} />
      <circle cx={x} cy={y} r={14} fill={INK} />
      <Note x={x + dir * 22} y={y + 52} s={date} size={46} c={RED} anchor={side === "right" ? "start" : "end"} />
      <Note x={x + dir * 22} y={y + 100} s={title} size={40} anchor={side === "right" ? "start" : "end"} />
    </g>
  );
}

function Mountains({ x, y, n = 4, s = 1 }: { x: number; y: number; n?: number; s?: number }) {
  return (
    <g>
      {Array.from({ length: n }).map((_, i) => {
        const bx = x + i * 90 * s, h = (110 + ((i * 53) % 70)) * s;
        return (
          <g key={i}>
            <Ink d={`M${bx} ${y} L${bx + 55 * s} ${y - h} L${bx + 110 * s} ${y}`} w={3.5} />
            <path d={`M${bx + 55 * s} ${y - h} L${bx + 110 * s} ${y} L${bx + 62 * s} ${y} Z`} fill={`url(#mt-h2)`} opacity={0.5} />
          </g>
        );
      })}
    </g>
  );
}

export function JourneyMapSketch() {
  const p = "mt";
  const waves = Array.from({ length: 16 }).map((_, i) => {
    const x = 1560 + (i % 4) * 190 + ((i * 37) % 60);
    const y = 560 + Math.floor(i / 4) * 340 + ((i * 53) % 90);
    return `M${x} ${y} q 24 -26 48 0 t 48 0 t 48 0`;
  });
  return (
    <Sheet p={p} label="Codex-style map of the Echo Vue journey: a spring island of camera-based prototypes, a six-month sea, and an October island of real sensing">
      <Cartouche x={1180} y={120} w={1480} title="Carta del Progetto · The Journey of Echo Vue" sub="MMXXVI" />

      {/* spring island */}
      <Ink d="M220 1180 C 160 820 380 560 700 540 C 1000 500 1320 640 1450 900 C 1560 1160 1420 1520 1130 1650 C 820 1790 420 1700 300 1480 C 250 1390 230 1290 220 1180 Z" w={6} fill="rgba(222,200,150,0.35)" />
      <Mountains x={300} y={900} n={4} />
      <Mountains x={980} y={1500} n={3} s={0.8} />
      {/* october island */}
      <Ink d="M2280 1000 C 2250 700 2520 480 2900 470 C 3280 450 3640 640 3700 980 C 3760 1320 3560 1700 3200 1760 C 2820 1830 2380 1700 2300 1420 C 2290 1300 2285 1150 2280 1000 Z" w={6} fill="rgba(222,200,150,0.35)" />
      <Mountains x={2400} y={880} n={3} s={0.9} />
      <Mountains x={3280} y={1620} n={3} s={0.8} />

      {/* the sea between */}
      {waves.map((d, i) => <Ink key={i} d={d} w={3} o={0.55} />)}
      <Ink d="M1700 1180 C 1780 1090 1860 1250 1950 1160 C 2030 1080 2090 1220 2160 1150" w={7} />
      <Ink d="M2160 1150 c 24 -30 60 -28 70 -2 c -20 8 -44 6 -70 2 Z" w={4} fill={RED} o={0.6} />
      <Note x={1930} y={1330} s="~ six months in the field" size={52} anchor="middle" c={RED} rot={-4} />
      <Note x={1930} y={1388} s="testing at home · data · research talks" size={38} anchor="middle" rot={-4} />
      <Note x={1930} y={760} s="hic sunt dracones" size={44} anchor="middle" mirror o={0.7} />

      {/* the route */}
      <Ink d="M470 1520 C 560 1240 560 1180 760 1040 C 960 900 1020 860 1130 780 C 1230 720 1300 860 1370 960 C 1620 1100 1980 1010 2380 1080 C 2540 1000 2660 860 2820 780 C 3000 880 3030 1100 3170 1170 C 3260 1060 3340 960 3440 900" w={6} c={RED} dash="3 26" o={0.95} />

      <Flag x={470} y={1520} date="31 Mar" title="first commit" />
      <Flag x={760} y={1040} date="2 Apr" title="the skeleton" />
      <Flag x={1130} y={780} date="7 Apr" title="the map" />
      <Flag x={1370} y={960} date="12 Apr" title="last spring commit" side="left" />
      <Flag x={2380} y={1080} date="6 Oct" title="Motel 6" />
      <Flag x={2820} y={780} date="7 Oct" title="the camera comes out" />
      <Flag x={3170} y={1170} date="9 Oct" title="breathing, measured" />
      <Flag x={3440} y={900} date="11 Oct" title="the wall plate" side="left" />

      <Note x={470} y={1760} s="Spring: prove the idea" size={50} c={RED} />
      <Note x={2540} y={1860} s="October: make it true" size={50} c={RED} />
      <Compass cx={3560} cy={1930} r={120} />
      <Ink d="M300 1960 L900 1960 M300 1940 L300 1980 M600 1950 L600 1970 M900 1940 L900 1980" w={4} />
      <Note x={300} y={2028} s="one league = one week" size={36} />
    </Sheet>
  );
}

/* ───────────────────────── Sheet 4: the prototypes ───────────────────────── */

function Dim({ x1, y1, x2, y2, label, off = 0 }: { x1: number; y1: number; x2: number; y2: number; label: string; off?: number }) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return (
    <g>
      <Ink d={`M${x1} ${y1} L${x2} ${y2}`} w={2.5} o={0.7} />
      <Ink d={`M${x1} ${y1 - 14} L${x1} ${y1 + 14} M${x2} ${y2 - 14} L${x2} ${y2 + 14}`} w={2.5} o={0.7} />
      <Note x={mx} y={my + off} s={label} size={36} anchor="middle" c={RED} />
    </g>
  );
}

export function PrototypeSketch() {
  const p = "pt";
  const slots = Array.from({ length: 11 }).map((_, i) => 2210 + i * 36);
  return (
    <Sheet p={p} label="Codex-style study of the two Illy Bridge prototypes: a wall plate with a 4-inch screen, and a premium bridge with speaker, microphone, biometric pad and camera">
      <Cartouche x={1180} y={110} w={1480} title="Prototipi · Illy Bridge" sub="October MMXXVI" />

      {/* Illy Bridge 2: wall plate, front */}
      <Ink d="M360 440 Q360 410 390 410 L1090 410 Q1120 410 1120 440 L1120 1210 Q1120 1240 1090 1240 L390 1240 Q360 1240 360 1210 Z" w={6} fill="rgba(239,224,184,0.4)" />
      <Ink d="M384 464 Q384 438 410 438 L1070 438 Q1096 438 1096 464 L1096 1186 Q1096 1212 1070 1212 L410 1212 Q384 1212 384 1186 Z" w={2.5} o={0.5} />
      <Ink d="M470 600 L1010 600 L1010 940 L470 940 Z" w={6} fill={`url(#${p}-h2)`} />
      <Ink d="M492 622 L988 622 L988 918 L492 918 Z" w={3} fill="rgba(59,42,26,0.55)" />
      {[650, 690, 730, 770, 810, 850, 890].map((y, i) => <Line key={y} x1={520} y1={y} x2={520 + [300, 220, 360, 180, 330, 250, 200][i]} y2={y} w={5} c="#e9d9ad" o={0.8} />)}
      <circle cx={740} cy={1060} r={14} fill={RED} opacity={0.85} />
      <Note x={740} y={1150} s="ILLY BRIDGE" size={36} anchor="middle" o={0.6} />
      <Dim x1={360} y1={1320} x2={1120} y2={1320} label="two-gang plate (concept)" off={56} />
      <Dim x1={470} y1={540} x2={1010} y2={540} label="4.0 in · 480 × 320" off={-30} />
      {/* section view */}
      <Ink d="M1330 410 L1390 410 L1390 1240 L1330 1240 Z" w={5} fill={`url(#${p}-h1)`} />
      <Ink d="M1300 640 L1330 640 L1330 940 L1300 940 Z" w={4} fill={`url(#${p}-h2)`} />
      <Note x={1360} y={1320} s="section" size={36} anchor="middle" c={RED} />
      <Note x={1420} y={760} s="flush with the wall" size={34} rot={-90} />
      {/* ESP32-32E */}
      <Ink d="M440 1520 L1040 1520 L1040 1800 L440 1800 Z" w={5} fill={`url(#${p}-h1)`} />
      {Array.from({ length: 14 }).map((_, i) => <Line key={i} x1={470 + i * 42} y1={1520} x2={470 + i * 42} y2={1490} w={3} />)}
      {Array.from({ length: 14 }).map((_, i) => <Line key={`b${i}`} x1={470 + i * 42} y1={1800} x2={470 + i * 42} y2={1830} w={3} />)}
      <Ink d="M600 1590 L880 1590 L880 1730 L600 1730 Z" w={4} fill="rgba(239,224,184,0.5)" />
      <Note x={740} y={1675} s="ESP32-32E" size={42} anchor="middle" />
      <Note x={740} y={1930} s="Illy Bridge 2 · the wall plate" size={48} anchor="middle" c={RED} />
      <Note x={740} y={1986} s="radio + processor + screen. no camera, no microphone." size={34} anchor="middle" />

      {/* Illy Bridge Pro */}
      <Ink d="M2060 430 Q2060 380 2110 380 L2750 380 Q2800 380 2800 430 L2800 1330 Q2800 1380 2750 1380 L2110 1380 Q2060 1380 2060 1330 Z" w={6} fill="rgba(239,224,184,0.4)" />
      <circle cx={2430} cy={470} r={44} fill="none" stroke={INK} strokeWidth={5} /><circle cx={2430} cy={470} r={24} fill={`url(#${p}-h2)`} stroke={INK} strokeWidth={4} />
      <circle cx={2300} cy={470} r={9} fill={INK} /><circle cx={2330} cy={470} r={9} fill={INK} /><circle cx={2560} cy={470} r={9} fill={INK} />
      <Ink d="M2150 580 L2710 580 L2710 1040 L2150 1040 Z" w={6} fill={`url(#${p}-h2)`} />
      <Ink d="M2170 600 L2690 600 L2690 1020 L2170 1020 Z" w={3} fill="rgba(59,42,26,0.55)" />
      {[640, 700, 760, 820, 880, 940].map((y, i) => <Line key={y} x1={2200} y1={y} x2={2200 + [300, 220, 360, 200, 320, 240][i]} y2={y} w={5} c="#e9d9ad" o={0.8} />)}
      <circle cx={2430} cy={1150} r={64} fill="none" stroke={INK} strokeWidth={5} />
      {[14, 30, 46].map((r) => <ellipse key={r} cx={2430} cy={1156} rx={r} ry={r * 1.12} fill="none" stroke={INK} strokeWidth={4} strokeDasharray={`${r * 1.4} 8`} />)}
      {slots.map((x) => <Ink key={x} d={`M${x} 1262 L${x} 1316`} w={9} />)}
      <Ink d="M2230 1380 L2630 1380 L2690 1500 Q2430 1540 2170 1500 Z" w={5} fill={`url(#${p}-h1)`} />
      <Dim x1={2060} y1={1630} x2={2800} y2={1630} label="colour display · 240 × 320" off={56} />
      {/* leaders */}
      <Ink d="M2474 470 L2900 330 L3300 330" w={3} /><Note x={3320} y={344} s="camera*" size={44} />
      <Ink d="M2560 470 L2940 420 L3300 420" w={3} /><Note x={3320} y={434} s="microphones" size={44} />
      <Ink d="M2430 1156 L2960 1160 L3300 1160" w={3} /><Note x={3320} y={1174} s="biometric pad*" size={44} />
      <Ink d="M2590 1290 L2980 1290 L3300 1290" w={3} /><Note x={3320} y={1304} s="speaker" size={44} />
      <Ink d="M2710 800 L3000 800 L3300 800" w={3} /><Note x={3320} y={814} s="the screen shows the truth" size={44} c={RED} />
      <Note x={2430} y={1830} s="Illy Bridge Pro · the one with a voice" size={48} anchor="middle" c={RED} />
      <Note x={2430} y={1886} s="FNK0086 · ESP32-S3 · WiFi CSI + BLE" size={34} anchor="middle" />
      <Note x={3300} y={1560} s="* planned modules. identity-capable," size={34} c={RED} />
      <Note x={3300} y={1608} s="so opt-in, consented and legally" size={34} c={RED} />
      <Note x={3300} y={1656} s="reviewed before they ever ship." size={34} c={RED} />
      <Note x={3500} y={1990} s="i due ponti" size={44} mirror anchor="start" o={0.7} />
    </Sheet>
  );
}


/* ───────────────────────── Sheet 5: the measuring instruments ───────────────────────── */

export function InstrumentsSketch() {
  const p = "in";
  return (
    <Sheet p={p} label="Codex-style study of the handheld laser and voltage tools used to measure walls, find outlets in them, and turn a room into square footage for Echo Vue">
      <Cartouche x={1180} y={110} w={1480} title="Strumenti · The Instruments" sub="measure first, then sense" />

      {/* the laser tool, side on, aiming at a wall */}
      <Ink d="M380 880 Q380 840 420 840 L1000 840 L1090 900 L1090 1060 L1000 1120 L420 1120 Q380 1120 380 1080 Z" w={6} fill="rgba(239,224,184,0.4)" />
      <Ink d="M470 880 L860 880 L860 960 L470 960 Z" w={4} fill={`url(#${p}-h2)`} />
      <Note x={665} y={940} s="4.20 m" size={46} anchor="middle" c="#e9d9ad" />
      {[520, 610, 700].map((x) => <circle key={x} cx={x} cy={1050} r={22} fill="none" stroke={INK} strokeWidth={4} />)}
      {Array.from({ length: 8 }).map((_, i) => <Line key={i} x1={880 + i * 14} y1={990} x2={880 + i * 14} y2={1090} w={2.5} o={0.6} />)}
      <circle cx={1090} cy={980} r={14} fill={RED} />
      <Ink d="M1104 980 L2090 980" w={4} c={RED} dash="4 16" />
      <circle cx={2100} cy={980} r={20} fill={RED} opacity={0.85} /><circle cx={2100} cy={980} r={44} fill="none" stroke={RED} strokeWidth={3} opacity={0.6} />
      <Dim x1={1120} y1={800} x2={2090} y2={800} label="distance to the wall" off={-26} />

      {/* the wall in section, with an outlet inside it */}
      <Ink d="M2100 560 L2210 560 L2210 1740 L2100 1740 Z" w={6} fill={`url(#${p}-h1)`} />
      <Ink d="M2112 1290 L2198 1290 L2198 1400 L2112 1400 Z" w={5} fill="rgba(239,224,184,0.55)" />
      <Line x1={2140} y1={1320} x2={2140} y2={1360} w={6} /><Line x1={2170} y1={1320} x2={2170} y2={1360} w={6} />
      <Note x={2155} y={1450} s="outlet" size={40} anchor="middle" />

      {/* the voltage detector, tip to the wall */}
      <Ink d="M1480 1590 L1980 1370 Q2010 1356 2024 1386 L2036 1412 Q2046 1442 2016 1456 L1516 1676 Q1480 1690 1468 1654 Z" w={6} fill="rgba(239,224,184,0.4)" />
      <circle cx={1500} cy={1630} r={16} fill={RED} opacity={0.85} />
      {[60, 110, 160].map((r) => <path key={r} d={`M${2040 - r * 0.2} ${1390 - r * 0.9} A${r} ${r} 0 0 1 ${2040 - r * 0.2} ${1390 + r * 0.9}`} fill="none" stroke={RED} strokeWidth={4} opacity={0.75} transform="translate(100 0)" />)}
      <Note x={1620} y={1760} s="voltage in the wall" size={46} c={RED} />
      <Note x={1620} y={1814} s="power found without a drill" size={36} />

      {/* the room, in plan, with outlets and the number it yields */}
      <Ink d="M2520 640 L3600 640 L3600 1340 L2520 1340 Z" w={8} fill="rgba(239,224,184,0.25)" />
      <Ink d="M2540 660 L3580 660 L3580 1320 L2540 1320 Z" w={3} o={0.5} />
      {[[2520, 800], [2520, 1180], [3000, 640], [3600, 900], [3300, 1340]].map(([x, y], i) => (
        <g key={i}><circle cx={x} cy={y} r={18} fill={RED} opacity={0.85} /><circle cx={x} cy={y} r={34} fill="none" stroke={RED} strokeWidth={3} /></g>
      ))}
      <Dim x1={2520} y1={560} x2={3600} y2={560} label="L" off={-26} />
      <Dim x1={3700} y1={640} x2={3700} y2={1340} label="W" off={0} />
      <Note x={3060} y={1010} s="L × W = square feet" size={52} anchor="middle" />
      <Note x={3060} y={1080} s="(illustrative figures)" size={34} anchor="middle" c={RED} />

      {/* into Echo Vue */}
      <Ink d="M2400 1100 L2330 1100 M2362 1074 L2330 1100 L2362 1126" w={4} c={RED} o={0} />
      <Ink d="M2540 1520 L3600 1520 L3600 1900 L2540 1900 Z" w={5} fill="rgba(239,224,184,0.3)" />
      <Ink d="M2640 1610 L3300 1610 L3300 1800 L2640 1800 Z" w={3} />
      <Ink d="M2640 1700 L3300 1700 M2970 1610 L2970 1800" w={2} o={0.5} />
      <circle cx={2760} cy={1650} r={9} fill={RED} /><circle cx={3180} cy={1760} r={9} fill={RED} />
      <Note x={3070} y={1960} s="Echo Vue · floor plan from real measurements" size={40} anchor="middle" c={RED} />
      <Ink d="M3070 1350 L3070 1500 M3040 1470 L3070 1500 L3100 1470" w={5} c={RED} />

      <Note x={380} y={1560} s="Klein Tools laser" size={52} c={RED} />
      <Note x={380} y={1620} s="to the wall, and the number appears." size={38} />
      <Note x={380} y={1690} s="Measure the walls, find the outlets," size={38} />
      <Note x={380} y={1744} s="and a room becomes a floor plan." size={38} />
      <Note x={3500} y={1990} s="misura prima" size={44} mirror anchor="start" o={0.7} />
    </Sheet>
  );
}
