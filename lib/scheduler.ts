/**
 * The rescheduling engine.
 *
 * This replaces what used to be a language-model call. Given the week's plan,
 * what Strava says actually happened, and the hourly forecast, it decides where
 * each remaining session should land and why — deterministically, with a cited
 * rule behind every change.
 *
 * How it decides:
 *
 *   1. Settle the past. Each elapsed day is complete, short, missed, or (for
 *      easy days) deliberately dropped — the plan's rule is skip, don't cram.
 *   2. Score every remaining day against every session still needing a home,
 *      using the heat protocol in `heat.ts` plus the plan's scheduling rules.
 *   3. Search assignments of sessions to days and keep the cheapest. The space
 *      is tiny — at most a few thousand arrangements — so this is exhaustive
 *      rather than greedy. Greedy gets Sat/Sun long-run swaps wrong whenever the
 *      quality day also wants to move.
 *   4. Only adopt the winner if it beats leaving the plan alone by a real margin,
 *      so the board doesn't churn every time a dew point wobbles a degree.
 *   5. Place lifts around the result, honoring 48-hour clearance before the long run.
 */

import type { Activity } from "./strava";
import {
  DEW_POINT_HARD_LIMIT,
  HEAT_INDEX_SPEED_LIMIT,
  heatVerdict,
  thermalLoad,
  treadmillIsViable,
  type Conditions,
  type HeatVerdict,
} from "./heat";
import { isHard, isHeavyLift, isRun, PLAN, weekDays, type PlanDay, type Session } from "./plan";
import { diffDays, dowShort, planDow } from "./dates";
import type { DayForecast } from "./weather";

/* ── Output shapes ─────────────────────────────────────────────────────────── */

/** Why the engine did something. `rule` is a stable code; `detail` is prose. */
export interface Reason {
  rule: RuleCode;
  detail: string;
}

export type RuleCode =
  | "DEW_POINT_LIMIT"
  | "HEAT_INDEX_LIMIT"
  | "COOLER_WINDOW"
  | "LONG_RUN_FLOAT"
  | "HARD_DAY_SPACING"
  | "LIFT_CLEARANCE"
  | "MAKEUP_PLACED"
  | "SKIP_DONT_CRAM"
  | "MILEAGE_CAP"
  | "TREADMILL"
  | "SPLIT_RUN"
  | "WINDOW_PASSED"
  | "SHORT_OF_PLAN";

export type DayStatus =
  | "complete"
  | "short"
  | "missed"
  | "dropped"
  | "vacated"
  | "today"
  | "upcoming"
  | "rest"
  | "travel"
  /** The day has elapsed but Strava couldn't be reached, so nothing is known. */
  | "unknown";

export interface ScheduleDay {
  date: string;
  /** 0 = Monday. */
  dow: number;
  /** What the plan originally called for. */
  planned: PlanDay;
  /** What to actually do, after swaps and makeups. Null when nothing is scheduled. */
  actual: Session | null;
  /** Set when `actual` came from a different calendar day. */
  movedFrom: string | null;
  /** Set when this day's planned session was relocated elsewhere. */
  movedTo: string | null;
  /** Set when `actual` is a makeup for something missed earlier in the week. */
  makeupFrom: string | null;
  /** Do it on a treadmill. */
  indoor: boolean;
  /** Recommended start window and its conditions. */
  window: Conditions | null;
  verdict: HeatVerdict | null;
  logged: Activity[];
  runMiles: number;
  liftDone: boolean;
  status: DayStatus;
  reasons: Reason[];
}

export interface Advisory {
  level: "info" | "warn" | "alert";
  title: string;
  detail: string;
}

export interface ScheduleResult {
  weekIndex: number;
  weekLabel: string;
  /** The weekly total the plan document states. */
  weekTarget: number;
  /**
   * Miles the week's individual sessions actually add up to. This runs 4–6 above
   * `weekTarget` in most weeks — an inconsistency inherited from the written
   * plan — so progress is measured against this, the honest denominator.
   */
  plannedMiles: number;
  days: ScheduleDay[];
  loggedMiles: number;
  /** Miles still on the board for the rest of the week. */
  remainingMiles: number;
  liftsPlanned: number;
  liftsDone: number;
  advisories: Advisory[];
  /** True when the engine changed anything from the written plan. */
  adjusted: boolean;
}

export interface ScheduleInput {
  today: string;
  /** Current hour in Brooklyn — earlier windows have already passed. */
  nowHour: number;
  weekIndex: number;
  activities: Activity[];
  /**
   * False when Strava could not be reached. An empty activity list then means
   * "unknown", not "nothing happened" — without this the board accuses you of
   * missing every session in the week every time the API has a bad minute.
   */
  activitiesAvailable?: boolean;
  forecast: DayForecast[];
}

/* ── Activity matching ─────────────────────────────────────────────────────── */

const isRunActivity = (a: Activity) => a.sport === "Run";
const isLiftActivity = (a: Activity) => a.sport === "Strength";

/** A run counts as completing its session at 85% of planned distance or better. */
const COMPLETION_RATIO = 0.85;

/* ── Start-window selection ────────────────────────────────────────────────── */

/**
 * Hours the plan is willing to start a session. Weekday sessions happen at
 * 6/6:30 AM before work; weekends open up. 5 AM exists because the plan names
 * pre-dawn starts as a hot-weather alternative.
 */
function candidateHours(session: Session, dow: number): number[] {
  if (session.type === "race") return [8]; // NYC wave start
  const weekend = dow >= 5;
  if (session.type === "long") return weekend ? [5, 6, 7, 8] : [5, 6];
  return weekend ? [5, 6, 7, 8, 9] : [5, 6, 7];
}

/** The coolest usable start window on `date`, or null if the forecast can't say. */
export function bestWindow(
  session: Session,
  date: string,
  forecast: DayForecast | undefined,
  today: string,
  nowHour: number,
): Conditions | null {
  if (!forecast?.hours.length) return null;
  let hours = candidateHours(session, planDow(date));
  if (date === today) hours = hours.filter((h) => h >= nowHour);
  const options = hours
    .map((h) => forecast.hours.find((p) => p.hour === h))
    .filter((p): p is Conditions => !!p);
  if (!options.length) return null;
  return options.reduce((best, p) => (thermalLoad(p) < thermalLoad(best) ? p : best));
}

/* ── Cost model ────────────────────────────────────────────────────────────── */

/**
 * Penalty weights. These are ordinal, not physical. What matters is the ranking:
 * a protocol block outranks a treadmill, a treadmill outranks moving a day, and
 * moving a day outranks a couple of degrees of dew point.
 */
const COST = {
  /** Protocol says no, and no honest indoor substitute exists. */
  forbidden: 400,
  /** Protocol says no, but a treadmill preserves the session. */
  treadmill: 45,
  /** Long run stranded on a weekday. */
  longRunOffWeekend: 130,
  /** Two hard days back to back. */
  hardBackToBack: 85,
  /** Heavy lower-body lift inside 48h before the long run. */
  liftClearance: 70,
  /** Stacking a hard run onto the heavy lift day. */
  hardOnHeavyLiftDay: 60,
  /** Spending a day the plan kept free of running — a rest or lift-only day. */
  restDayEncroachment: 18,
  moveBase: 12,
  movePerDay: 3,
  /** Easy days absorb whatever the weather is; shuffling them is nearly free. */
  easyMoveBase: 4,
  easyMovePerDay: 1,
  /** Key sessions resist relocation. */
  keyMove: 18,
  /** A makeup is already a compromise; don't also drag it far. */
  makeupBase: 6,
  /** How much better a rearrangement must be before it's worth showing. */
  adoptionMargin: 18,
} as const;

/** Dew point below which the air is simply not a factor. */
const NEUTRAL_DEW = 58;

function thermalPenalty(session: Session, c: Conditions | null): number {
  if (!c) return 0;
  const sensitivity =
    session.type === "long" || session.type === "race"
      ? 3.0
      : session.type === "qual"
        ? 2.4
        : 0.5;
  let p = Math.max(0, c.dewPointF - NEUTRAL_DEW) * sensitivity;
  if (c.precipProb >= 60) p += session.type === "qual" ? 10 : 4;
  if ((c.windMph ?? 0) >= 20 && session.type === "qual") p += 6;
  return p;
}

/**
 * Moves the plan itself authorizes, which therefore cost nothing:
 * "Long run floats between Sat and Sun — pick the cooler morning" and
 * "Mon or Fri fully off" for the lift/rest pair.
 */
function floatsFreely(session: Session, origin: string, target: string): boolean {
  const a = planDow(origin);
  const b = planDow(target);
  if (session.type === "long" && a >= 5 && b >= 5) return true;
  if (session.type === "lift" && [0, 4].includes(a) && [0, 4].includes(b)) return true;
  return false;
}

function moveCost(session: Session, origin: string, target: string): number {
  if (origin === target) return 0;
  if (floatsFreely(session, origin, target)) return 0;
  const dist = Math.abs(diffDays(target, origin));
  const isEasy = session.type === "easy";
  return (
    (isEasy ? COST.easyMoveBase : COST.moveBase) +
    (isEasy ? COST.easyMovePerDay : COST.movePerDay) * dist +
    (session.key ? COST.keyMove : 0)
  );
}

/** A session still needing a day, and the day it came from. */
interface Pending {
  session: Session;
  origin: string;
  /** True when its original day has elapsed without it happening. */
  makeup: boolean;
  /** Higher wins when there are more sessions than days. */
  priority: number;
}

function priorityOf(s: Session): number {
  if (s.type === "race") return 100;
  if (s.type === "long") return s.key ? 90 : 80;
  if (s.type === "qual") return s.key ? 70 : 60;
  if (s.type === "easy") return s.optional ? 10 : 20;
  return 5;
}

interface Slot {
  date: string;
  dow: number;
  planned: PlanDay;
  forecast: DayForecast | undefined;
}

interface Placement {
  pending: Pending;
  slot: Slot;
  window: Conditions | null;
  verdict: HeatVerdict | null;
  indoor: boolean;
  cost: number;
  reasons: Reason[];
}

function evaluate(pending: Pending, slot: Slot, input: ScheduleInput): Placement {
  const { session } = pending;
  const window = bestWindow(session, slot.date, slot.forecast, input.today, input.nowHour);
  const verdict = heatVerdict(session, window);
  const reasons: Reason[] = [];
  let cost = thermalPenalty(session, window);
  let indoor = false;

  if (verdict?.blocked) {
    const viable = treadmillIsViable(session);
    const byDewPoint = !!window && window.dewPointF >= DEW_POINT_HARD_LIMIT;
    if (viable) {
      indoor = true;
      cost += COST.treadmill;
      reasons.push({
        rule: byDewPoint ? "DEW_POINT_LIMIT" : "HEAT_INDEX_LIMIT",
        detail: byDewPoint
          ? `Dew point ${window!.dewPointF}° at ${window!.hour}:00 — at or past the ${DEW_POINT_HARD_LIMIT}° outdoor limit, so this goes on the treadmill.`
          : `Heat index ${verdict.heatIndexF}° — above the ${HEAT_INDEX_SPEED_LIMIT}° ceiling for outdoor speed work.`,
      });
    } else {
      cost += COST.forbidden;
    }
  }

  if (session.type === "long" && slot.dow < 5) cost += COST.longRunOffWeekend;
  // Days the plan deliberately keeps free of running — rest days and the
  // standalone lift day — are recovery, not spare capacity.
  if (isRun(session) && !isRun(slot.planned) && slot.date !== pending.origin) {
    cost += COST.restDayEncroachment;
  }
  if (isHard(session) && isHeavyLift(slot.planned)) cost += COST.hardOnHeavyLiftDay;

  cost += moveCost(session, pending.origin, slot.date);
  if (pending.makeup && slot.date !== pending.origin) cost += COST.makeupBase;

  return { pending, slot, window, verdict, indoor, cost, reasons };
}

/** All injective maps of `nItems` items into `nSlots` slots, in lexicographic order. */
function injections(nItems: number, nSlots: number): number[][] {
  const out: number[][] = [];
  if (nItems > nSlots) return out;
  const cur: number[] = [];
  const used = new Array(nSlots).fill(false);
  const walk = (i: number) => {
    if (i === nItems) {
      out.push([...cur]);
      return;
    }
    for (let s = 0; s < nSlots; s++) {
      if (used[s]) continue;
      used[s] = true;
      cur.push(s);
      walk(i + 1);
      cur.pop();
      used[s] = false;
    }
  };
  walk(0);
  return out;
}

/**
 * Costs that depend on the arrangement as a whole rather than any one placement:
 * hard days need a day between them, and Lift A needs clearance before the long run.
 */
function arrangementCost(
  placements: Placement[],
  hardAlready: Set<string>,
  liftDates: Map<string, Session>,
): { cost: number; reasons: Reason[] } {
  const reasons: Reason[] = [];
  let cost = 0;

  const hard = new Set(hardAlready);
  for (const p of placements) if (isHard(p.pending.session)) hard.add(p.slot.date);

  const sorted = [...hard].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (diffDays(sorted[i], sorted[i - 1]) === 1) {
      cost += COST.hardBackToBack;
      reasons.push({
        rule: "HARD_DAY_SPACING",
        detail: `${dowShort(sorted[i - 1])} and ${dowShort(sorted[i])} would be hard days back to back.`,
      });
    }
  }

  const longRun = placements.find((p) => p.pending.session.type === "long");
  if (longRun) {
    for (const [date, session] of liftDates) {
      if (!isHeavyLift(session)) continue;
      const gap = diffDays(longRun.slot.date, date);
      if (gap >= 0 && gap < 2) {
        cost += COST.liftClearance;
        reasons.push({
          rule: "LIFT_CLEARANCE",
          detail: `Lift A on ${dowShort(date)} sits inside 48 hours of the long run.`,
        });
      }
    }
  }

  return { cost, reasons };
}

/* ── Main entry ────────────────────────────────────────────────────────────── */

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const { today, weekIndex, activities, forecast } = input;
  const activitiesKnown = input.activitiesAvailable ?? true;
  const planned = weekDays(weekIndex);
  const week = planned[0];
  const byDate = new Map(forecast.map((f) => [f.date, f]));

  const actsByDate = new Map<string, Activity[]>();
  for (const a of activities) {
    const list = actsByDate.get(a.date) ?? [];
    list.push(a);
    actsByDate.set(a.date, list);
  }

  // ── 1. Base rows, and settle the past ────────────────────────────────────
  const days: ScheduleDay[] = planned.map((p) => {
    const logged = actsByDate.get(p.date) ?? [];
    const runMiles = logged.filter(isRunActivity).reduce((sum, r) => sum + r.miles, 0);
    return {
      date: p.date,
      dow: p.dow,
      planned: p,
      actual: p,
      movedFrom: null,
      movedTo: null,
      makeupFrom: null,
      indoor: false,
      window: null,
      verdict: null,
      logged,
      runMiles,
      liftDone: logged.some(isLiftActivity),
      status: "upcoming",
      reasons: [],
    };
  });

  const row = (date: string) => days.find((d) => d.date === date);
  const pending: Pending[] = [];
  const advisories: Advisory[] = [];
  let missedHard = 0;

  for (const d of days) {
    const p = d.planned;

    if (d.date >= today) {
      d.status =
        d.date === today
          ? "today"
          : p.type === "rest"
            ? "rest"
            : p.type === "travel"
              ? "travel"
              : "upcoming";
      continue;
    }

    // Elapsed days are history — nothing left to schedule on them.
    if (p.type === "rest" || p.type === "travel") {
      d.status = p.type;
      continue;
    }

    // Without Strava we can't tell a missed session from a logged one, and
    // guessing in either direction produces a worse board than admitting it.
    if (!activitiesKnown) {
      d.status = "unknown";
      continue;
    }

    const ranEnough = isRun(p) && d.runMiles >= (p.miles ?? 0) * COMPLETION_RATIO;
    const liftNeeded = !!p.lift && !p.liftOptional;

    if (isRun(p) && !ranEnough && d.runMiles > 0) {
      d.status = "short";
      d.reasons.push({
        rule: "SHORT_OF_PLAN",
        detail: `Logged ${d.runMiles.toFixed(1)} of ${p.miles} planned miles.`,
      });
    } else if (isRun(p) && !ranEnough) {
      if (p.type === "easy" || p.optional) {
        // The plan is explicit: miss a day, skip it — don't cram it.
        d.status = "dropped";
        d.actual = null;
        d.reasons.push({
          rule: "SKIP_DONT_CRAM",
          detail: "Missed easy run. The plan says let it go rather than pile it onto another day.",
        });
      } else {
        d.status = "missed";
        d.actual = null;
        missedHard++;
        pending.push({ session: p, origin: p.date, makeup: true, priority: priorityOf(p) });
      }
    } else {
      d.status = liftNeeded && !d.liftDone ? "short" : "complete";
    }

    if (liftNeeded && !d.liftDone) {
      pending.push({
        session: { type: "lift", text: `Lift ${p.lift}`, lift: p.lift },
        origin: p.date,
        makeup: true,
        priority: 5,
      });
    }
  }

  // ── 2. Sessions still ahead of us ────────────────────────────────────────
  for (const d of days) {
    if (d.date >= today && isRun(d.planned) && !d.planned.fixed) {
      pending.push({
        session: d.planned,
        origin: d.date,
        makeup: false,
        priority: priorityOf(d.planned),
      });
    }
  }

  // Days that can host a run: not travel, not the expo, not race day.
  const slots: Slot[] = days
    .filter((d) => d.date >= today && !d.planned.fixed)
    .map((d) => ({ date: d.date, dow: d.dow, planned: d.planned, forecast: byDate.get(d.date) }));

  // Hard days already banked this week constrain what we can stack beside.
  const hardAlready = new Set(
    days
      .filter((d) => d.date < today && isHard(d.planned) && (d.status === "complete" || d.status === "short"))
      .map((d) => d.date),
  );

  // Lifts staying put, for the 48-hour clearance check.
  const liftDates = new Map<string, Session>();
  for (const d of days) if (d.planned.lift && d.date >= today) liftDates.set(d.date, d.planned);

  // ── 3. Search ────────────────────────────────────────────────────────────
  const runPending = pending
    .filter((p) => p.session.type !== "lift")
    .sort((a, b) => b.priority - a.priority || a.origin.localeCompare(b.origin));

  // More sessions than days means the lowest-priority ones don't happen.
  const overflow = runPending.slice(slots.length);
  const toPlace = runPending.slice(0, slots.length);

  const grid = toPlace.map((p) => slots.map((s) => evaluate(p, s, input)));

  interface Scored {
    placements: Placement[];
    cost: number;
    reasons: Reason[];
    map: number[];
  }

  const scored: Scored[] = injections(toPlace.length, slots.length).map((map) => {
    const placements = map.map((slotIdx, itemIdx) => grid[itemIdx][slotIdx]);
    const extra = arrangementCost(placements, hardAlready, liftDates);
    return {
      placements,
      cost: placements.reduce((sum, p) => sum + p.cost, 0) + extra.cost,
      reasons: extra.reasons,
      map,
    };
  });

  // Sort by cost, then lexicographically by assignment, so equal-cost weeks
  // always resolve to the same board rather than flickering between refreshes.
  scored.sort((a, b) => a.cost - b.cost || compareMaps(a.map, b.map));

  const best = scored[0];
  // The cheapest arrangement in which nothing already on the calendar moves.
  // Makeups are free to float — they have no day of their own to keep.
  const pinned = scored.find((s) =>
    s.placements.every((p) => p.pending.makeup || p.slot.date === p.pending.origin),
  );

  const chosen =
    pinned && best && pinned.cost - best.cost < COST.adoptionMargin ? pinned : best;

  // ── 4. Write the chosen arrangement onto the board ───────────────────────
  for (const d of days) {
    if (d.date >= today && isRun(d.planned) && !d.planned.fixed) d.actual = null;
  }

  for (const placement of chosen?.placements ?? []) {
    const target = row(placement.slot.date);
    if (!target) continue;
    const pnd = placement.pending;
    const session = pnd.session;

    target.actual = session;
    target.window = placement.window;
    target.verdict = placement.verdict;
    target.indoor = placement.indoor;
    target.reasons.push(...placement.reasons);

    if (placement.slot.date !== pnd.origin) {
      if (pnd.makeup) {
        target.makeupFrom = pnd.origin;
        target.reasons.push({
          rule: "MAKEUP_PLACED",
          detail: `Makeup for the ${dowShort(pnd.origin)} ${describe(session)}.`,
        });
      } else {
        target.movedFrom = pnd.origin;
        const source = row(pnd.origin);
        if (source && (source.status === "upcoming" || source.status === "today")) {
          source.movedTo = placement.slot.date;
          source.status = "vacated";
        }
        target.reasons.push(explainMove(placement, grid, toPlace, slots));
      }
    }

    if (placement.indoor && session.hotAlt) {
      target.reasons.push({ rule: "TREADMILL", detail: `Plan's hot alternative: ${session.hotAlt}` });
    }
  }

  // Days nothing landed on keep whatever the plan said, if it wasn't a run.
  for (const d of days) {
    if (d.date < today) continue;
    if (!d.actual && !d.movedTo && d.status !== "dropped") {
      if (d.planned.type === "rest" || d.planned.type === "travel" || d.planned.fixed) {
        d.actual = d.planned;
      }
    }
    // Fixed days never move but still deserve their forecast.
    if (d.planned.fixed && d.actual && !d.window) {
      d.window = bestWindow(d.actual, d.date, byDate.get(d.date), today, input.nowHour);
      d.verdict = heatVerdict(d.actual, d.window);
    }
    if (d.date === today && isRun(d.actual ?? undefined) && !d.window && byDate.has(d.date)) {
      d.reasons.push({
        rule: "WINDOW_PASSED",
        detail: "The morning window has passed — go by feel, or take it tomorrow.",
      });
    }
  }

  // ── 5. Lifts ─────────────────────────────────────────────────────────────
  placeLifts(days, pending, today);

  // ── 6. Week-level advisories ─────────────────────────────────────────────
  for (const p of overflow) {
    advisories.push({
      level: "warn",
      title: `No room left for the ${dowShort(p.origin)} ${describe(p.session)}`,
      detail:
        p.session.type === "long"
          ? "Repeat this week's structure next week rather than cramming the long run in."
          : "Let it go — the plan's rule is skip, don't cram.",
    });
  }

  if (missedHard >= 3) {
    advisories.push({
      level: "alert",
      title: "Three or more key sessions missed",
      detail:
        "The plan's rule for this is to repeat the prior week rather than push on into the next block.",
    });
  }

  const strandedLong = days.find(
    (d) => d.date >= today && d.actual?.type === "long" && d.verdict?.blocked && !d.indoor,
  );
  if (strandedLong) {
    advisories.push({
      level: "alert",
      title: "No safe outdoor window for the long run",
      detail: `Every candidate morning sits at or above the ${DEW_POINT_HARD_LIMIT}° dew point limit. Split the run across two sessions, or move it and repeat the week.`,
    });
    strandedLong.reasons.push({
      rule: "SPLIT_RUN",
      detail: "Split it — early morning and late afternoon — rather than running the whole thing in this air.",
    });
  }

  for (const d of days) {
    if (d.date >= today && d.verdict?.mileCap) {
      advisories.push({
        level: "warn",
        title: `${dowShort(d.date)} long run caps at ${d.verdict.mileCap} miles`,
        detail: `Dew point ${d.window?.dewPointF}° at the ${d.window?.hour}:00 start. The protocol caps distance before it caps effort.`,
      });
    }
  }

  // ── 7. Totals ────────────────────────────────────────────────────────────
  const loggedMiles = days.reduce((sum, d) => sum + d.runMiles, 0);
  const remainingMiles = days
    .filter((d) => d.date >= today)
    .reduce((sum, d) => sum + Math.min(d.actual?.miles ?? 0, d.verdict?.mileCap ?? Infinity), 0);

  return {
    weekIndex,
    weekLabel: week?.weekLabel ?? `W${weekIndex}`,
    weekTarget: week?.weekTarget ?? 0,
    plannedMiles: Math.round(planned.reduce((sum, p) => sum + (p.miles ?? 0), 0) * 10) / 10,
    days,
    loggedMiles: Math.round(loggedMiles * 10) / 10,
    remainingMiles: Math.round(remainingMiles * 10) / 10,
    liftsPlanned: planned.filter((p) => p.lift && !p.liftOptional).length,
    liftsDone: days.filter((d) => d.liftDone).length,
    advisories,
    adjusted: days.some(
      (d) => d.movedFrom || d.movedTo || d.makeupFrom || d.indoor || d.status === "dropped",
    ),
  };
}

function compareMaps(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function describe(s: Session): string {
  switch (s.type) {
    case "long":
      return "long run";
    case "qual":
      return "quality session";
    case "easy":
      return "easy run";
    case "lift":
      return `Lift ${s.lift}`;
    default:
      return s.type;
  }
}

/** Attribute a move to the rule that actually forced it. */
function explainMove(
  placement: Placement,
  grid: Placement[][],
  items: Pending[],
  slots: Slot[],
): Reason {
  const pnd = placement.pending;
  const itemIdx = items.indexOf(pnd);
  const originIdx = slots.findIndex((s) => s.date === pnd.origin);
  const to = dowShort(placement.slot.date);
  const from = dowShort(pnd.origin);

  if (itemIdx < 0 || originIdx < 0) {
    return { rule: "COOLER_WINDOW", detail: `Moved from ${from} to ${to}.` };
  }

  const atOrigin = grid[itemIdx][originIdx];
  const a = atOrigin.window;
  const b = placement.window;

  if (atOrigin.verdict?.blocked) {
    const byDewPoint = !!a && a.dewPointF >= DEW_POINT_HARD_LIMIT;
    return {
      rule: byDewPoint ? "DEW_POINT_LIMIT" : "HEAT_INDEX_LIMIT",
      detail: byDewPoint
        ? `${from} is dew point ${a!.dewPointF}° — past the ${DEW_POINT_HARD_LIMIT}° limit. ${to} is ${b ? `${b.dewPointF}°` : "clear"}.`
        : `${from} would be a ${atOrigin.verdict.heatIndexF}° heat index, above the ${HEAT_INDEX_SPEED_LIMIT}° ceiling for speed work. Moved to ${to}.`,
    };
  }

  if (a && b) {
    const cooler = a.dewPointF - b.dewPointF;
    if (cooler > 0) {
      const rule = placement.pending.session.type === "long" ? "LONG_RUN_FLOAT" : "COOLER_WINDOW";
      return {
        rule,
        detail: `${to} morning runs ${cooler}° lower on dew point than ${from} — ${b.dewPointF}° at ${b.hour}:00 against ${a.dewPointF}° at ${a.hour}:00.`,
      };
    }
    if (a.precipProb - b.precipProb >= 30) {
      return {
        rule: "COOLER_WINDOW",
        detail: `${from} carries a ${a.precipProb}% chance of rain in the window; ${to} is ${b.precipProb}%.`,
      };
    }
  }

  return {
    rule: "HARD_DAY_SPACING",
    detail: `Moved ${from} → ${to} to keep hard days spaced and the long run on the weekend.`,
  };
}

/**
 * Lifts are placed after runs because their only real constraint is relative to
 * the long run: Lift A is the heavy lower-body day and needs 48 hours of
 * clearance. Everything else can ride along with an easy day.
 */
function placeLifts(days: ScheduleDay[], pending: Pending[], today: string): void {
  const longRun = days.find((d) => d.date >= today && d.actual?.type === "long");

  // A lift whose day now sits too close to a relocated long run has to move too.
  if (longRun) {
    for (const d of days) {
      if (d.date < today || !d.actual?.lift || !isHeavyLift(d.actual)) continue;
      const gap = diffDays(longRun.date, d.date);
      if (gap < 0 || gap >= 2) continue;
      const alt = days.find(
        (c) =>
          c.date >= today &&
          c !== d &&
          !c.actual?.lift &&
          c.actual?.type !== "long" &&
          !c.planned.fixed &&
          diffDays(longRun.date, c.date) >= 2,
      );
      if (!alt) continue;
      alt.actual = { ...(alt.actual ?? { type: "rest", text: "Rest" }), lift: d.actual.lift };
      alt.reasons.push({
        rule: "LIFT_CLEARANCE",
        detail: `Lift ${d.actual.lift} moved off ${dowShort(d.date)} — heavy legs need 48 hours before the long run.`,
      });
      d.actual = { ...d.actual, lift: undefined };
    }
  }

  // Makeup lifts land on a rest day first, then alongside an easy run.
  for (const p of pending.filter((x) => x.session.type === "lift")) {
    const clears = (d: ScheduleDay) =>
      !longRun || p.session.lift !== "A" || diffDays(longRun.date, d.date) >= 2;
    const target =
      days.find(
        (d) =>
          d.date >= today && d.actual?.type === "rest" && !d.actual.lift && !d.planned.fixed && clears(d),
      ) ??
      days.find((d) => d.date >= today && d.actual?.type === "easy" && !d.actual.lift && clears(d));
    if (!target?.actual) continue;
    target.actual = { ...target.actual, lift: p.session.lift };
    target.reasons.push({
      rule: "MAKEUP_PLACED",
      detail: `Lift ${p.session.lift} picked up from ${dowShort(p.origin)}.`,
    });
  }
}

/** The day the board leads with. */
export function todayRow(result: ScheduleResult, today: string): ScheduleDay | undefined {
  return result.days.find((d) => d.date === today);
}

/** Forecast days annotated with whatever the plan says for them — the 7-day board. */
export interface ForecastDay {
  forecast: DayForecast;
  planned: PlanDay | undefined;
  window: Conditions | null;
  verdict: HeatVerdict | null;
}

export function annotateForecast(
  forecast: DayForecast[],
  today: string,
  nowHour: number,
  days = 7,
): ForecastDay[] {
  return forecast.slice(0, days).map((f) => {
    const planned = PLAN[f.date];
    const window = planned ? bestWindow(planned, f.date, f, today, nowHour) : null;
    return { forecast: f, planned, window, verdict: planned ? heatVerdict(planned, window) : null };
  });
}
