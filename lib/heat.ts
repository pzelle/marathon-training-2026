/**
 * The heat protocol, as code.
 *
 * These thresholds are not tuning knobs — they come from the plan's rhabdo
 * protocol, which exists because of a prior episode. `blocked: true` means the
 * session does not happen outdoors, full stop. Everything downstream (window
 * selection, day swapping, pace targets) reads its rules from here so there is
 * exactly one place where the medical guardrails live.
 */

import type { Session } from "./plan";

export interface Conditions {
  /** Hour of day (0–23) the numbers describe. */
  hour: number;
  tempF: number;
  dewPointF: number;
  /** Percent chance of precipitation. */
  precipProb: number;
  /** Sustained wind, mph — a real factor on the bridges. */
  windMph?: number;
}

export type HeatLevel = "green" | "mild" | "caution" | "block";

export interface HeatVerdict {
  level: HeatLevel;
  /** Outdoor version of this session must not happen. */
  blocked: boolean;
  /** Relative humidity implied by temp + dew point. */
  humidity: number;
  heatIndexF: number;
  /** Seconds per mile to add, as a [min, max] range. */
  paceAdjustSec: [number, number] | null;
  /** Hard ceiling on distance for this session, if the protocol imposes one. */
  mileCap: number | null;
  walkBreaks: boolean;
  /** Fluid guidance, when the session is long enough to need it. */
  fluids: string | null;
  /** One-line call, written the way the plan writes it. */
  headline: string;
  /** Supporting directives. */
  notes: string[];
}

/** Dew-point bands from the protocol table. Ordered high → low. */
const DEW_BANDS = [
  {
    min: 75,
    level: "block" as HeatLevel,
    paceAdjustSec: null,
    mileCap: null,
    walkBreaks: true,
    label: "DP 75+",
  },
  {
    min: 70,
    level: "caution" as HeatLevel,
    paceAdjustSec: [30, 45] as [number, number],
    mileCap: 14,
    walkBreaks: true,
    label: "DP 70–74",
  },
  {
    min: 65,
    level: "caution" as HeatLevel,
    paceAdjustSec: [20, 30] as [number, number],
    mileCap: null,
    walkBreaks: false,
    label: "DP 65–69",
  },
  {
    min: 60,
    level: "mild" as HeatLevel,
    paceAdjustSec: [15, 20] as [number, number],
    mileCap: null,
    walkBreaks: false,
    label: "DP 60–64",
  },
  {
    min: -Infinity,
    level: "green" as HeatLevel,
    paceAdjustSec: null,
    mileCap: null,
    walkBreaks: false,
    label: "DP under 60",
  },
];

/** Heat index above this bars outdoor speed work outright. */
export const HEAT_INDEX_SPEED_LIMIT = 85;
/** Dew point at or above this bars outdoor quality and long runs. */
export const DEW_POINT_HARD_LIMIT = 75;

const fToC = (f: number) => ((f - 32) * 5) / 9;

/** Magnus-formula relative humidity from temperature and dew point (both °F). */
export function relativeHumidity(tempF: number, dewPointF: number): number {
  const t = fToC(tempF);
  const td = fToC(dewPointF);
  const gamma = (x: number) => (17.625 * x) / (243.04 + x);
  const rh = 100 * Math.exp(gamma(td) - gamma(t));
  return Math.max(0, Math.min(100, Math.round(rh)));
}

/** NWS Rothfusz heat index (°F). Below 80°F the air temperature is the honest number. */
export function heatIndexF(tempF: number, humidity: number): number {
  if (tempF < 80) return Math.round(tempF);
  const t = tempF;
  const r = humidity;
  const hi =
    -42.379 +
    2.04901523 * t +
    10.14333127 * r -
    0.22475541 * t * r -
    6.83783e-3 * t * t -
    5.481717e-2 * r * r +
    1.22874e-3 * t * t * r +
    8.5282e-4 * t * r * r -
    1.99e-6 * t * t * r * r;
  return Math.round(hi);
}

/**
 * A single scalar for "how much this air will cost you", used to rank candidate
 * start windows and candidate days against each other.
 *
 * Dew point dominates because it is what limits evaporative cooling; dry heat is
 * survivable in a way humid heat is not. The hour term stands in for solar load,
 * which no dew point captures — without it an 8 AM start can score better than
 * 5:30 on raw numbers while being plainly worse to run in, and the plan is
 * explicit that summer long runs start by 6:30.
 */
export function thermalLoad(c: Conditions): number {
  const solar = Math.max(0, c.hour - 6) * 1.5;
  return c.dewPointF * 1.6 + c.tempF * 0.5 + solar;
}

/**
 * Longest run worth calling a treadmill substitute. Past this the plan's other
 * options — split it, or slide the day — are the honest ones.
 */
export const TREADMILL_LONG_RUN_LIMIT = 12;

/** Does this session keep its purpose if moved indoors? */
export function treadmillIsViable(session: Session): boolean {
  if (session.type === "race") return false;
  // A treadmill holds intervals and tempo honestly; a three-hour long run does not.
  if (session.type === "long") return (session.miles ?? 0) <= TREADMILL_LONG_RUN_LIMIT;
  return session.indoorOk ?? true;
}

/**
 * Apply the protocol to one session under one set of conditions.
 * Pure — the same inputs always produce the same verdict.
 */
export function heatVerdict(session: Session, c: Conditions | null): HeatVerdict | null {
  if (!c) return null;

  const humidity = relativeHumidity(c.tempF, c.dewPointF);
  const hi = heatIndexF(c.tempF, humidity);
  const band = DEW_BANDS.find((b) => c.dewPointF >= b.min)!;
  const notes: string[] = [];

  // Non-running days are indifferent to the weather.
  if (session.type === "lift") {
    return {
      level: "green",
      blocked: false,
      humidity,
      heatIndexF: hi,
      paceAdjustSec: null,
      mileCap: null,
      walkBreaks: false,
      fluids: null,
      headline: "Indoor session — heat is irrelevant",
      notes: [],
    };
  }
  if (session.type === "rest" || session.type === "travel") {
    return {
      level: "green",
      blocked: false,
      humidity,
      heatIndexF: hi,
      paceAdjustSec: null,
      mileCap: null,
      walkBreaks: false,
      fluids: null,
      headline: session.type === "rest" ? "No run scheduled" : "Travel day",
      notes: [],
    };
  }

  const isQuality = session.type === "qual";
  const isLong = session.type === "long" || session.type === "race";
  const miles = session.miles ?? 0;

  let level = band.level;
  let blocked = false;
  let headline: string;

  if (c.dewPointF >= DEW_POINT_HARD_LIMIT && (isQuality || isLong)) {
    blocked = true;
    level = "block";
    headline = isLong
      ? `${band.label} — this long run does not happen outdoors. Treadmill, split it, or slide a day.`
      : `${band.label} — intensity moves indoors or swaps with an easy day.`;
  } else if (c.dewPointF >= DEW_POINT_HARD_LIMIT) {
    // Easy running at DP 75+ is allowed but heavily throttled.
    level = "caution";
    headline = `${band.label} — easy only, effort not pace, and cut it short if it turns.`;
    notes.push("Loop a route with water and bailouts. No pushing the pace.");
  } else if (isQuality && hi > HEAT_INDEX_SPEED_LIMIT) {
    blocked = true;
    level = "block";
    headline = `Heat index ~${hi}° — no outdoor speed work above ${HEAT_INDEX_SPEED_LIMIT}°.`;
  } else if (band.level === "green") {
    headline = "Green light — run to pace";
  } else {
    const [lo, hi2] = band.paceAdjustSec!;
    headline = `${band.label} — slow ${lo}–${hi2} sec/mi and run by effort`;
  }

  if (blocked && treadmillIsViable(session)) {
    notes.push(
      session.hotAlt ? `Plan's hot alternative: ${session.hotAlt}` : "Move it to the treadmill.",
    );
  } else if (blocked) {
    notes.push(
      session.hotAlt
        ? `Plan's hot alternative: ${session.hotAlt}`
        : "Too long for a treadmill substitute — split the run or move the day.",
    );
  }

  const mileCap = band.mileCap !== null && isLong && miles > band.mileCap ? band.mileCap : null;
  if (mileCap) notes.push(`Cap the run at ${mileCap} miles — distance is not worth the risk today.`);
  if (band.walkBreaks && isLong && !blocked) {
    notes.push("Walk 30–60 sec every mile to keep core temperature down.");
  }
  if (c.precipProb >= 70) notes.push(`${c.precipProb}% chance of rain in the window.`);

  // Fluids guidance kicks in once the session runs past ~75 minutes.
  const estMinutes = miles * 9.5;
  const fluids =
    estMinutes > 75 || c.dewPointF >= 70
      ? "16–24 oz/hour with electrolytes. No NSAIDs before or during."
      : null;

  return {
    level,
    blocked,
    humidity,
    heatIndexF: hi,
    paceAdjustSec: band.paceAdjustSec,
    mileCap,
    walkBreaks: band.walkBreaks && isLong,
    fluids,
    headline,
    notes,
  };
}

/* ── Pace targets ───────────────────────────────────────────────────────────
   Cool-weather zones from the plan, expressed in seconds per mile so heat
   adjustments are plain arithmetic instead of string surgery.               */

export type Zone = "easy" | "long" | "mp" | "tempo" | "interval";

export const ZONES: Record<Zone, { label: string; range: [number, number] }> = {
  easy: { label: "Easy", range: [555, 600] }, //  9:15–10:00
  long: { label: "Long run", range: [540, 585] }, //  9:00– 9:45
  mp: { label: "Marathon pace", range: [510, 520] }, //  8:30– 8:40
  tempo: { label: "Tempo / threshold", range: [470, 485] }, //  7:50– 8:05
  interval: { label: "Intervals (5K–10K)", range: [430, 450] }, //  7:10– 7:30
};

export function formatPace(secondsPerMile: number): string {
  const s = Math.round(secondsPerMile);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** A zone's target range for today's air, as a display string. */
export function adjustedZone(zone: Zone, verdict: HeatVerdict | null): string {
  const [lo, hi] = ZONES[zone].range;
  const add = verdict?.paceAdjustSec;
  if (!add) return `${formatPace(lo)}–${formatPace(hi)}/mi`;
  return `${formatPace(lo + add[0])}–${formatPace(hi + add[1])}/mi`;
}

/** Which zones a session actually uses, for the day's pace card. */
export function zonesFor(session: Session): Zone[] {
  switch (session.type) {
    case "easy":
      return ["easy"];
    case "long":
      return /MP/.test(session.text) ? ["long", "mp"] : ["long"];
    case "qual":
      if (/@ ?MP/.test(session.text)) return ["mp", "easy"];
      if (/10K|5K/.test(session.text)) return ["interval", "easy"];
      return ["tempo", "easy"];
    case "race":
      return ["mp"];
    default:
      return [];
  }
}
