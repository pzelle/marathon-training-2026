/**
 * The 16-week block, Mon Jul 13 → Sun Nov 1 2026 (TCS NYC Marathon).
 *
 * Sessions carry structured fields — not just display text — because the
 * scheduler reasons over them: `hotAlt` is the pre-authored fallback the plan
 * itself specifies, `indoorOk` says whether a treadmill preserves the training
 * value, `fixed` pins days that cannot move (travel, expo, race day).
 */

import { addDays, planDow } from "./dates";

export type SessionType = "rest" | "easy" | "qual" | "long" | "lift" | "travel" | "race";

export interface Session {
  type: SessionType;
  /** Display text, as written in the plan. */
  text: string;
  /** Planned distance. Absent for rest/lift/travel days. */
  miles?: number;
  /** Which lift template accompanies the day, if any. */
  lift?: "A" | "B" | "C";
  /** Third-lift days are nice-to-have; a miss here is not a miss. */
  liftOptional?: boolean;
  /** True when a treadmill substitution keeps the session's purpose intact. */
  indoorOk?: boolean;
  /** The plan's own hot-weather alternative for this session. */
  hotAlt?: string;
  /** Locked to the calendar — travel, expo, race. The scheduler won't touch it. */
  fixed?: boolean;
  /** Optional session — skipping it costs nothing. */
  optional?: boolean;
  /** The block's make-or-break workouts. Protected from downgrades. */
  key?: boolean;
}

export interface Week {
  /** "W3", "W4 · cutback", "W11 · PEAK" */
  label: string;
  /** Target running mileage for the week. */
  target: number;
  /** Mon → Sun. */
  days: Session[];
}

// Terse builders keep 16 weeks scannable. `o` carries the optional fields.
const rest = (text = "Rest", o: Partial<Session> = {}): Session => ({ type: "rest", text, ...o });
const easy = (miles: number, text: string, o: Partial<Session> = {}): Session => ({
  type: "easy",
  text,
  miles,
  indoorOk: true,
  ...o,
});
const qual = (miles: number, text: string, o: Partial<Session> = {}): Session => ({
  type: "qual",
  text,
  miles,
  indoorOk: true,
  ...o,
});
const long = (miles: number, text: string, o: Partial<Session> = {}): Session => ({
  type: "long",
  text,
  miles,
  ...o,
});
const lift = (l: "A" | "B" | "C", text: string, o: Partial<Session> = {}): Session => ({
  type: "lift",
  text,
  lift: l,
  ...o,
});
const travel = (text: string, o: Partial<Session> = {}): Session => ({
  type: "travel",
  text,
  fixed: true,
  ...o,
});

export const WEEKS: Week[] = [
  {
    label: "W0 · transition",
    target: 18,
    days: [
      rest(),
      easy(5, "5 easy + 4 strides"),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      qual(7.5, "7–8 easy (mini long run) · Lift A pm", { lift: "A" }),
      travel("Travel"),
      travel("Travel — optional 3–4 easy", { optional: true }),
      travel("Travel"),
    ],
  },
  {
    label: "W1 · build",
    target: 26,
    days: [
      lift("A", "Lift A"),
      qual(6, "6 mi: 8×1′ hard / 2′ jog", { hotAlt: "Same 8×1′ on the treadmill" }),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      easy(6, "6 easy, last mile steady"),
      rest(),
      easy(3, "3 easy", { optional: true }),
      long(12, "LR 12 easy", { hotAlt: "10 mi with walk breaks, or split 8 AM / 4 PM" }),
    ],
  },
  {
    label: "W2",
    target: 28,
    days: [
      lift("A", "Lift A"),
      qual(7, "7 mi: 3×8′ tempo / 3′ jog", { hotAlt: "3×8′ on the treadmill" }),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      easy(6, "6 easy + 4 strides"),
      rest(),
      easy(3, "3 easy"),
      long(13, "LR 13 easy", { hotAlt: "Cap at 11–12 mi, effort only" }),
    ],
  },
  {
    label: "W3",
    target: 30,
    days: [
      lift("A", "Lift A"),
      qual(7, "7 mi: 6×3′ @ 10K / 2′ jog", { hotAlt: "Treadmill, or 6×2:30 pre-dawn" }),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      easy(7, "7 steady (middle 3 @ ~9:00)"),
      rest(),
      easy(3, "3 easy"),
      long(14, "LR 14 easy", { hotAlt: "12 mi max, loops, fluids every 3 mi" }),
    ],
  },
  {
    label: "W4 · cutback",
    target: 24,
    days: [
      lift("A", "Lift A"),
      qual(6, "6 mi: 5×2′ tempo effort"),
      easy(4, "4 easy · Lift B", { lift: "B" }),
      easy(5, "5 easy"),
      rest(),
      lift("C", "Optional Lift C / off", { liftOptional: true, optional: true }),
      long(10, "LR 10 relaxed · check shoe mileage"),
    ],
  },
  {
    label: "W5",
    target: 32,
    days: [
      lift("A", "Lift A"),
      qual(8, "8 mi: 4×1 mi tempo / 2:30 jog", { hotAlt: "4×8′ on the treadmill" }),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      easy(7, "7 easy, hilly route (bridge prep)"),
      rest(),
      easy(3, "3 easy"),
      long(15, "LR 15", { hotAlt: "13 mi max + walk breaks" }),
    ],
  },
  {
    label: "W6",
    target: 34,
    days: [
      lift("A", "Lift A"),
      qual(8, "8 mi: 8×2′ @ 5K–10K / 2′ jog"),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      qual(8, "8 mi, last 3 @ MP", { hotAlt: "Drop the MP miles, run all easy" }),
      rest(),
      easy(3, "3 easy"),
      long(16, "LR 16 easy", { hotAlt: "14 mi, pre-dawn start, split if needed" }),
    ],
  },
  {
    label: "W7",
    target: 36,
    days: [
      lift("A", "Lift A"),
      qual(8, "8 mi: 3×10′ tempo / 3′ jog"),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      easy(8, "8 steady"),
      rest(),
      easy(3, "3 easy"),
      long(17, "LR 17, last 2 @ MP if cool", { hotAlt: "All easy — drop the MP finish" }),
    ],
  },
  {
    label: "W8 · cutback",
    target: 26,
    days: [
      lift("A", "Lift A"),
      qual(7, "7 mi: 6 strides + 2 @ MP"),
      easy(5, "5 easy · Lift B", { lift: "B" }),
      easy(6, "6 easy"),
      travel("Travel — full rest"),
      travel("Travel — full rest"),
      long(12, "LR 12 easy (or Mon AM if travel runs late)"),
    ],
  },
  {
    label: "W9",
    target: 38,
    days: [
      lift("A", "Lift A"),
      qual(8, "8 mi: 5×1 mi tempo / 2′ jog"),
      easy(6, "6 easy · Lift B", { lift: "B" }),
      qual(8, "8 mi, middle 4 @ MP"),
      rest(),
      easy(3, "3 easy"),
      long(18, "LR 18 · full fueling rehearsal", { key: true }),
    ],
  },
  {
    label: "W10",
    target: 40,
    days: [
      lift("A", "Lift A"),
      qual(8, "8 mi: 6×3′ @ 10K, rolling terrain"),
      easy(6, "6 easy · Lift B", { lift: "B" }),
      qual(8, "8 mi, 4 @ MP"),
      rest(),
      easy(3, "3 easy"),
      long(19, "LR 19, last 4 @ MP · goal-pace referendum", { key: true }),
    ],
  },
  {
    label: "W11 · PEAK",
    target: 42,
    days: [
      lift("A", "Lift A"),
      qual(9, "9 mi: 3×2 mi tempo / 3′ jog"),
      easy(6, "6 easy · Lift B", { lift: "B" }),
      easy(8, "8 steady, hilly"),
      rest(),
      easy(3, "3 easy"),
      long(20, "LR 20 all easy · full dress rehearsal", { key: true }),
    ],
  },
  {
    label: "W12",
    target: 38,
    days: [
      lift("A", "Lift A"),
      qual(8, "8 mi: 4×1 mi tempo"),
      easy(6, "6 easy · Lift B", { lift: "B" }),
      qual(7, "7 mi, 3 @ MP"),
      rest(),
      easy(3, "3 easy"),
      long(18, "LR 18, miles 12–17 @ MP · the block's key run", { key: true }),
    ],
  },
  {
    label: "W13 · taper",
    target: 32,
    days: [
      lift("A", "Lift A (60% loads)"),
      qual(7, "7 mi: 3×8′ tempo"),
      easy(5, "5 easy · Lift B light", { lift: "B" }),
      qual(6, "6 mi, 3 @ MP"),
      rest(),
      easy(3, "3 easy"),
      long(14, "LR 14, last 3 @ MP"),
    ],
  },
  {
    label: "W14 · taper",
    target: 24,
    days: [
      lift("A", "Lift A (light)"),
      qual(6, "6 mi: 4×3′ tempo effort"),
      easy(4, "4 easy · Lift B light", { lift: "B" }),
      qual(5, "5 mi, 2 @ MP"),
      rest(),
      easy(3, "3 easy + 4 strides"),
      long(10, "LR 10 relaxed · logistics + carb planning"),
    ],
  },
  {
    label: "W15 · RACE WEEK",
    target: 40,
    days: [
      rest(),
      qual(5, "5 mi: 4×90″ @ MP · last light lift", { lift: "C" }),
      easy(4, "4 easy"),
      rest("Rest · Expo — bib pickup", { fixed: true }),
      easy(3, "3 easy + 4 strides"),
      rest("Rest or 15–20′ shakeout", { fixed: true }),
      {
        type: "race",
        text: "TCS NYC MARATHON — 26.2",
        miles: 26.2,
        fixed: true,
        key: true,
      },
    ],
  },
];

export const PLAN_START = "2026-07-13";
export const RACE_DAY = "2026-11-01";

export interface PlanDay extends Session {
  date: string;
  /** Index into WEEKS. */
  week: number;
  weekLabel: string;
  weekTarget: number;
  /** 0 = Monday. */
  dow: number;
}

/** Every day of the block, keyed by ISO date. */
export const PLAN: Record<string, PlanDay> = (() => {
  const days: Record<string, PlanDay> = {};
  WEEKS.forEach((week, wi) => {
    week.days.forEach((session, di) => {
      const date = addDays(PLAN_START, wi * 7 + di);
      days[date] = {
        ...session,
        date,
        week: wi,
        weekLabel: week.label,
        weekTarget: week.target,
        dow: di,
      };
    });
  });
  return days;
})();

/** The seven days of week `wi`, Mon → Sun. */
export function weekDays(wi: number): PlanDay[] {
  return Array.from({ length: 7 }, (_, di) => PLAN[addDays(PLAN_START, wi * 7 + di)]).filter(
    Boolean,
  );
}

/** Which week `date` falls in, or null if outside the block. */
export function weekOf(date: string): number | null {
  return PLAN[date]?.week ?? null;
}

/** Sessions that put running load on the legs. */
export function isRun(s: Session | undefined): boolean {
  return !!s && ["easy", "qual", "long", "race"].includes(s.type);
}

/** Hard days — these need spacing between them. */
export function isHard(s: Session | undefined): boolean {
  return !!s && ["qual", "long", "race"].includes(s.type);
}

export function hasLift(s: Session | undefined): boolean {
  return !!s?.lift;
}

/** Lift A is the heavy lower-body day; it needs clearance before a long run. */
export function isHeavyLift(s: Session | undefined): boolean {
  return s?.lift === "A";
}

export const TYPE_LABEL: Record<SessionType, string> = {
  rest: "REST",
  easy: "EASY RUN",
  qual: "QUALITY",
  long: "LONG RUN",
  lift: "LIFT",
  travel: "TRAVEL",
  race: "RACE DAY",
};

/** Sanity guard: the plan must end on race day. */
export const PLAN_END = addDays(PLAN_START, WEEKS.length * 7 - 1);
if (process.env.NODE_ENV !== "production" && PLAN_END !== RACE_DAY) {
  throw new Error(`Plan ends ${PLAN_END} but race day is ${RACE_DAY}`);
}
if (process.env.NODE_ENV !== "production" && planDow(PLAN_START) !== 0) {
  throw new Error(`PLAN_START ${PLAN_START} is not a Monday`);
}
