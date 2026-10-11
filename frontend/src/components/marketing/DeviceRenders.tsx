/**
 * Concept renders of the two Illy Bridge devices, and faithful redraws of their screens.
 *
 * The screen layouts follow the firmware (firmware-e32/src/lcd_e32.c for the 4.0" 480x320
 * Illy Bridge 2, firmware/src/lcd_ui.c for the 240x320 Pro): same text, positions and
 * RGB565 colours. The values shown are illustrative. Everything is SVG, so it stays sharp
 * at any size. These are renders of planned plastic housings, not photographs.
 */

const MONO = "ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** RGB565 constants from the firmware, as CSS colours. */
const C = {
  black: "#000", white: "#fff", red: "#f00", green: "#0f0", cyan: "#0ff", yellow: "#ff0", orange: "#ffa500",
  grey: "#848284", mid: "#424142", dark: "#181c18", panel: "#101410", accent: "#009eff", sel: "#292c29",
};

/** Text positioned like the firmware: (x, y) is the top-left of a 5x7 glyph block drawn at integer scale `sc`. */
function T({ x, y, s, c, sc = 1, anchor = "start" }: { x: number; y: number; s: string; c: string; sc?: number; anchor?: "start" | "middle" }) {
  return (
    <text x={x} y={y} fill={c} fontFamily={MONO} fontSize={10 * sc} fontWeight={600} textAnchor={anchor} dominantBaseline="text-before-edge" style={{ whiteSpace: "pre" }}>
      {s}
    </text>
  );
}

export type ScreenKind = "dashboard" | "boot" | "setup" | "networks";

/* ───────────────────────── Illy Bridge 2: 4.0" 480x320 landscape ───────────────────────── */

function E32Header({ right }: { right: string }) {
  return (
    <>
      <rect x={0} y={0} width={480} height={40} fill={C.panel} />
      <T x={12} y={10} s="ILLY BRIDGE" c={C.accent} sc={3} />
      <T x={480 - right.length * 12 - 12} y={14} s={right} c={C.grey} sc={2} />
    </>
  );
}

export function E32Screen({ kind }: { kind: Exclude<ScreenKind, "networks"> }) {
  if (kind === "boot") {
    return (
      <g>
        <rect width={480} height={320} fill={C.black} />
        <T x={240} y={60} s="ILLY BRIDGE" c={C.accent} sc={5} anchor="middle" />
        <T x={240} y={110} s="Echo Maps presence sensing" c={C.white} sc={2} anchor="middle" />
        <T x={240} y={140} s="v2.0.0  ESP32-32E 4.0in" c={C.grey} sc={2} anchor="middle" />
        <T x={240} y={166} s="B8:1E:A4:31:0E:47" c={C.grey} sc={2} anchor="middle" />
        <T x={240} y={264} s="Starting..." c={C.yellow} sc={2} anchor="middle" />
      </g>
    );
  }
  if (kind === "setup") {
    return (
      <g>
        <rect width={480} height={320} fill={C.black} />
        <E32Header right="WiFi setup" />
        <T x={240} y={70} s="Could not join WiFi" c={C.orange} sc={3} anchor="middle" />
        <T x={30} y={130} s="1. Join WiFi:  IllyBridge-Setup" c={C.white} sc={2} />
        <T x={30} y={160} s="2. Open:       http://192.168.4.1" c={C.white} sc={2} />
        <T x={30} y={190} s="3. Pick your network and save" c={C.white} sc={2} />
        <T x={240} y={260} s="B8:1E:A4:31:0E:47" c={C.grey} sc={2} anchor="middle" />
      </g>
    );
  }
  const rows: [string, string, string][] = [
    ["AREA", "Floor 3 Hallway", C.white],
    ["BRIDGE", "Illy Bridge 1", C.white],
    ["WIFI", "Lobby-WiFi", C.green],
    ["IP", "10.0.4.21", C.white],
    ["BACKEND", "OK", C.green],
    ["CSI FRAMES", "193279", C.white],
    ["WINDOWS SENT", "7741 (fail 0)", C.white],
    ["MOTION / RSSI", "0.07 / -47 dBm", C.white],
    ["UPTIME", "6h 24m 18s", C.white],
    ["FREE HEAP", "187 KB", C.white],
  ];
  return (
    <g>
      <rect width={480} height={320} fill={C.black} />
      <E32Header right="v2.0.0" />
      {rows.map(([label, val, color], i) => (
        <g key={label}>
          <T x={12} y={48 + i * 24} s={label} c={C.grey} sc={2} />
          <T x={190} y={48 + i * 24} s={val} c={color} sc={2} />
        </g>
      ))}
      <T x={240} y={310} s="B8:1E:A4:31:0E:47" c={C.grey} sc={1} anchor="middle" />
    </g>
  );
}

/* ───────────────────────── Illy Bridge Pro: 240x320 portrait ───────────────────────── */

function Item({ x, y, label, val, color = C.white }: { x: number; y: number; label: string; val: string; color?: string }) {
  return (
    <>
      <T x={x} y={y} s={label} c={C.grey} />
      <T x={x} y={y + 10} s={val} c={color} sc={2} />
    </>
  );
}

export function ProScreen({ kind }: { kind: ScreenKind }) {
  if (kind === "boot") {
    return (
      <g>
        <rect width={240} height={320} fill={C.black} />
        <rect x={80} y={20} width={80} height={30} fill={C.accent} />
        <rect x={85} y={25} width={70} height={20} fill={C.dark} />
        <T x={120} y={28} s="ILLY" c={C.white} sc={2} anchor="middle" />
        <T x={120} y={70} s="ILLY BRIDGE" c={C.white} sc={2} anchor="middle" />
        <T x={120} y={94} s="Echo Vue" c={C.cyan} sc={2} anchor="middle" />
        <T x={120} y={130} s="v2.0.0" c={C.green} anchor="middle" />
        <T x={120} y={145} s="80:B5:4E:F8:5A:98" c={C.white} anchor="middle" />
        <rect x={20} y={165} width={200} height={1} fill={C.mid} />
        <T x={120} y={180} s="Initializing..." c={C.yellow} anchor="middle" />
        <T x={120} y={200} s="Freenove FNK0086" c={C.mid} anchor="middle" />
      </g>
    );
  }
  if (kind === "networks") {
    const nets = ["Lobby-WiFi", "Guest-5G", "Staff", "Pool-AP"];
    return (
      <g>
        <rect width={240} height={320} fill={C.black} />
        <T x={8} y={4} s="WiFi Networks" c={C.cyan} sc={2} />
        <rect x={8} y={22} width={224} height={1} fill={C.accent} />
        {nets.map((n, i) => (
          <g key={n}>
            {i === 0 && <rect x={4} y={34 + i * 26} width={232} height={24} fill={C.sel} />}
            {i === 0 && <T x={6} y={38} s=">" c={C.cyan} sc={2} />}
            <T x={24} y={42 + i * 26} s={n} c={i === 0 ? C.white : C.green} />
          </g>
        ))}
        <rect x={8} y={216} width={224} height={1} fill={C.mid} />
        <T x={8} y={222} s="BTN:Next" c={C.mid} />
        <T x={100} y={222} s="HOLD:Connect" c={C.mid} />
      </g>
    );
  }
  if (kind === "setup") {
    return (
      <g>
        <rect width={240} height={320} fill={C.black} />
        <T x={8} y={4} s="WiFi Networks" c={C.cyan} sc={2} />
        <rect x={8} y={22} width={224} height={1} fill={C.accent} />
        <T x={120} y={120} s="Scanning..." c={C.yellow} sc={2} anchor="middle" />
      </g>
    );
  }
  return (
    <g>
      <rect width={240} height={320} fill={C.black} />
      <rect width={240} height={46} fill={C.panel} />
      <T x={8} y={5} s="ILLY BRIDGE" c={C.accent} sc={2} />
      <T x={8} y={30} s="v2.0.0  Freenove FNK0086" c={C.grey} />
      <Item x={8} y={52} label="AREA" val="Floor 3 Hallway" />
      <Item x={8} y={84} label="BRIDGE" val="Illy Bridge 1" />
      <Item x={8} y={116} label="WIFI" val="Lobby-WiFi" color={C.green} />
      <Item x={8} y={148} label="IP" val="10.0.4.21" />
      <Item x={8} y={180} label="BACKEND" val="OK" color={C.green} />
      <Item x={8} y={212} label="CSI FRAMES" val="193279" />
      <Item x={124} y={212} label="SENT / FAIL" val="7741/0" />
      <Item x={8} y={248} label="MOTION" val="0.07" />
      <Item x={124} y={248} label="SIGNAL" val="-47 dBm" />
      <Item x={8} y={284} label="UPTIME" val="6h 24m" />
      <Item x={124} y={284} label="FREE HEAP" val="187 KB" />
    </g>
  );
}

/** A screen on its own, as a crisp stand-alone image (for the gallery). */
export function ScreenImage({ device, kind, className }: { device: "e32" | "pro"; kind: ScreenKind; className?: string }) {
  const w = device === "e32" ? 480 : 240;
  return (
    <svg viewBox={`0 0 ${w} 320`} className={className} role="img" aria-label={`Illy Bridge ${device === "e32" ? "2" : "Pro"} ${kind} screen`} shapeRendering="crispEdges">
      <rect width={w} height={320} fill="#000" />
      {device === "e32" ? <E32Screen kind={kind as Exclude<ScreenKind, "networks">} /> : <ProScreen kind={kind} />}
    </svg>
  );
}

/* ───────────────────────── Device renders ───────────────────────── */

function Glow({ id, color }: { id: string; color: string }) {
  return (
    <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="9" result="b" />
      <feFlood floodColor={color} floodOpacity="0.55" />
      <feComposite in2="b" operator="in" />
      <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
    </filter>
  );
}

/** Wall plate of one light switch, to show scale and blend-in. */
function SwitchPlate({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} filter="url(#wb-shadow)">
      <rect width={182} height={300} rx={14} fill="url(#wb-plate)" stroke="#cfd1d6" />
      <rect x={4} y={4} width={174} height={292} rx={11} fill="none" stroke="#fff" strokeOpacity={0.8} />
      <rect x={31} y={52} width={120} height={196} rx={9} fill="url(#wb-rocker)" stroke="#d3d5da" />
      <rect x={31} y={150} width={120} height={1.5} fill="#bfc2c9" opacity={0.7} />
    </g>
  );
}

/**
 * Illy Bridge 2: a wall-plate bridge. A 4.0" touchscreen set into a two-gang plate that sits
 * beside an ordinary light switch and reads as part of the wall.
 */
export function WallScene({ kind = "dashboard", className }: { kind?: Exclude<ScreenKind, "networks">; className?: string }) {
  const sx = 190 / 480;
  return (
    <svg viewBox="0 0 700 400" className={className} role="img" aria-label="Illy Bridge 2 mounted on a wall beside a light switch">
      <defs>
        <linearGradient id="wb-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#efece7" /><stop offset="1" stopColor="#dedad3" />
        </linearGradient>
        <linearGradient id="wb-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#e6e7eb" />
        </linearGradient>
        <linearGradient id="wb-rocker" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" /><stop offset="0.5" stopColor="#f1f2f4" /><stop offset="1" stopColor="#dcdee3" />
        </linearGradient>
        <linearGradient id="wb-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.20" /><stop offset="0.45" stopColor="#fff" stopOpacity="0.04" /><stop offset="0.46" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id="wb-shadow" x="-20%" y="-10%" width="140%" height="140%">
          <feDropShadow dx="0" dy="9" stdDeviation="8" floodColor="#000" floodOpacity="0.26" />
        </filter>
        <Glow id="wb-glow" color="#2aa8ff" />
        <clipPath id="wb-screen"><rect x={0} y={0} width={190} height={126.67} rx={3} /></clipPath>
      </defs>

      <rect width={700} height={400} fill="url(#wb-wall)" />
      <rect y={372} width={700} height={28} fill="#d3cfc8" /><rect y={370} width={700} height={2} fill="#c6c2bb" />

      <SwitchPlate x={70} y={42} />

      <g transform="translate(330 42)" filter="url(#wb-shadow)">
        <rect width={300} height={300} rx={14} fill="url(#wb-plate)" stroke="#cfd1d6" />
        <rect x={4} y={4} width={292} height={292} rx={11} fill="none" stroke="#fff" strokeOpacity={0.8} />
        <g filter="url(#wb-glow)">
          <rect x={43} y={72} width={214} height={147} rx={7} fill="#0b0c0e" />
        </g>
        <rect x={43} y={72} width={214} height={147} rx={7} fill="none" stroke="#2a2d33" />
        <g transform="translate(55 81.2)">
          <g clipPath="url(#wb-screen)"><g transform={`scale(${sx})`}><E32Screen kind={kind} /></g></g>
          <rect width={190} height={126.67} rx={3} fill="url(#wb-glass)" />
        </g>
        <circle cx={150} cy={58} r={2} fill="#1b1d22" />
        <circle cx={150} cy={252} r={3.2} fill="#34e07a" /><circle cx={150} cy={252} r={7} fill="#34e07a" opacity={0.18} />
        <text x={150} y={282} textAnchor="middle" fontSize={9} letterSpacing={3} fill="#a3a8b1" fontFamily="system-ui, sans-serif">ILLY BRIDGE</text>
      </g>
    </svg>
  );
}

/**
 * Illy Bridge Pro: the premium bridge. A graphite housing around the 240x320 colour screen,
 * with camera*, microphones, a biometric pad* and a speaker grille. (*planned modules)
 */
export function ProBridge({ kind = "dashboard", className }: { kind?: ScreenKind; className?: string }) {
  return (
    <svg viewBox="0 0 320 470" className={className} role="img" aria-label="Illy Bridge Pro premium bridge, concept render">
      <defs>
        <linearGradient id="pb-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a3f48" /><stop offset="0.5" stopColor="#262a31" /><stop offset="1" stopColor="#16181d" />
        </linearGradient>
        <linearGradient id="pb-edge" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" /><stop offset="0.12" stopColor="#fff" stopOpacity="0.04" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="pb-lens" cx="0.38" cy="0.35" r="0.8">
          <stop offset="0" stopColor="#5b7fb3" /><stop offset="0.35" stopColor="#14213a" /><stop offset="1" stopColor="#05070c" />
        </radialGradient>
        <linearGradient id="pb-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" /><stop offset="0.42" stopColor="#fff" stopOpacity="0.05" /><stop offset="0.43" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pb-stand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#21242a" /><stop offset="1" stopColor="#0f1114" />
        </linearGradient>
        <filter id="pb-shadow" x="-30%" y="-10%" width="160%" height="140%">
          <feDropShadow dx="0" dy="14" stdDeviation="12" floodColor="#000" floodOpacity="0.45" />
        </filter>
        <Glow id="pb-glow" color="#2aa8ff" />
        <clipPath id="pb-screen"><rect width={136} height={181.3} rx={3} /></clipPath>
      </defs>

      <ellipse cx={160} cy={452} rx={104} ry={9} fill="#000" opacity={0.28} />
      {/* stand */}
      <path d="M118 388 L202 388 L222 440 Q160 452 98 440 Z" fill="url(#pb-stand)" />
      <rect x={104} y={437} width={112} height={7} rx={3.5} fill="#0b0c0f" />

      {/* body */}
      <g filter="url(#pb-shadow)">
        <rect x={60} y={24} width={200} height={372} rx={30} fill="url(#pb-body)" />
      </g>
      <rect x={60} y={24} width={200} height={372} rx={30} fill="url(#pb-edge)" />
      <rect x={63} y={27} width={194} height={366} rx={27} fill="none" stroke="#fff" strokeOpacity={0.09} />

      {/* camera*, microphones, ambient sensor */}
      <circle cx={160} cy={58} r={16} fill="#0a0b0e" stroke="#3b4048" />
      <circle cx={160} cy={58} r={10.5} fill="url(#pb-lens)" />
      <circle cx={156} cy={54} r={2.6} fill="#fff" opacity={0.55} />
      <circle cx={196} cy={58} r={2.4} fill="#ff4d4d" opacity={0.0} />
      <circle cx={116} cy={58} r={2.3} fill="#07080a" /><circle cx={124} cy={58} r={2.3} fill="#07080a" />
      <circle cx={204} cy={58} r={2.3} fill="#07080a" />

      {/* screen */}
      <g filter="url(#pb-glow)"><rect x={82} y={86} width={156} height={193} rx={8} fill="#050607" /></g>
      <rect x={82} y={86} width={156} height={193} rx={8} fill="none" stroke="#3a3e46" />
      <g transform="translate(92 92.7)">
        <g clipPath="url(#pb-screen)"><g transform="scale(0.5667)"><ProScreen kind={kind} /></g></g>
        <rect width={136} height={181.3} rx={3} fill="url(#pb-glass)" />
      </g>

      {/* biometric pad* */}
      <circle cx={160} cy={322} r={27} fill="#101216" stroke="#2f343c" />
      <circle cx={160} cy={322} r={25} fill="none" stroke="#2aa8ff" strokeOpacity={0.55} strokeWidth={1.2} />
      {[5, 9, 13, 17].map((r) => (
        <ellipse key={r} cx={160} cy={324} rx={r} ry={r * 1.12} fill="none" stroke="#6e7685" strokeWidth={1.6} strokeDasharray={`${r * 1.3} 2.4`} />
      ))}

      {/* speaker grille */}
      {Array.from({ length: 13 }).map((_, i) => (
        <rect key={i} x={100 + i * 9.2} y={362} width={3.2} height={14} rx={1.6} fill="#07080a" />
      ))}
      <circle cx={160} cy={386} r={1.8} fill="#34e07a" />
    </svg>
  );
}

/** Both devices, side by side, for the hero. */
export function HeroPair({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-1 md:grid-cols-[1.55fr_1fr] gap-4 items-end">
        <WallScene className="w-full h-auto rounded-2xl" />
        <ProBridge className="w-full h-auto max-w-[320px] mx-auto" />
      </div>
    </div>
  );
}
