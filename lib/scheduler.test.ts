import { describe, expect, it } from "vitest";
import { buildSchedule, type ScheduleInput, type ScheduleResult } from "./scheduler";
import { addDays, dowShort } from "./dates";
import { weekDays } from "./plan";
import type { DayForecast } from "./weather";
import type { Activity } from "./strava";

/*
 * All scenarios run against W3 — Mon Aug 3 → Sun Aug 9, 2026:
 *   Mon  Lift A
 *   Tue  quality, 7 mi (6×3′ @ 10K)
 *   Wed  easy 5 · Lift B
 *   Thu  easy 7 steady
 *   Fri  rest
 *   Sat  easy 3
 *   Sun  long run 14
 */
const WEEK = 3;
const MON = "2026-08-03";
const dates = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
const [, TUE, WED, THU, FRI, SAT, SUN] = dates;

/** Flat forecast: every candidate hour on a day shares the same air. */
function forecast(spec: Record<string, { temp: number; dew: number; precip?: number }>): DayForecast[] {
  return dates.map((date) => {
    const s = spec[date] ?? { temp: 68, dew: 55 };
    return {
      date,
      highF: s.temp + 10,
      lowF: s.temp - 6,
      precipProbMax: s.precip ?? 0,
      hours: Array.from({ length: 12 }, (_, h) => ({
        hour: h + 3,
        tempF: s.temp,
        dewPointF: s.dew,
        precipProb: s.precip ?? 0,
        windMph: 5,
      })),
    };
  });
}

const COOL = { temp: 64, dew: 52 };
const MILD = { temp: 72, dew: 62 };
const MUGGY = { temp: 82, dew: 72 };
const OPPRESSIVE = { temp: 88, dew: 77 };
const SCORCHING = { temp: 94, dew: 73 }; // heat index well past 85

const allDays = (c: { temp: number; dew: number }) =>
  Object.fromEntries(dates.map((d) => [d, c])) as Record<string, { temp: number; dew: number }>;

let nextId = 1;
function run(date: string, miles: number, paceSec = 540): Activity {
  return {
    id: nextId++,
    date,
    sport: "Run",
    name: `${miles} mi`,
    miles,
    minutes: Math.round((miles * paceSec) / 60),
    paceSecPerMile: paceSec,
    elevationFt: 120,
    averageHeartRate: 148,
  };
}
function lift(date: string): Activity {
  return {
    id: nextId++,
    date,
    sport: "Strength",
    name: "Lift",
    miles: 0,
    minutes: 35,
    paceSecPerMile: null,
    elevationFt: 0,
    averageHeartRate: null,
  };
}

function schedule(over: Partial<ScheduleInput> = {}): ScheduleResult {
  return buildSchedule({
    today: MON,
    nowHour: 4,
    weekIndex: WEEK,
    activities: [],
    forecast: forecast(allDays(COOL)),
    ...over,
  });
}

/** Where each session type actually landed, as weekday short names. */
function placement(result: ScheduleResult) {
  const map: Record<string, string> = {};
  for (const d of result.days) {
    if (d.actual && d.actual.type !== "rest" && d.actual.type !== "travel") {
      map[dowShort(d.date)] = d.actual.type + (d.indoor ? "/indoor" : "");
    }
  }
  return map;
}

const dayOf = (r: ScheduleResult, date: string) => r.days.find((d) => d.date === date)!;
const findType = (r: ScheduleResult, type: string) => r.days.find((d) => d.actual?.type === type);
const rules = (r: ScheduleResult) => r.days.flatMap((d) => d.reasons.map((x) => x.rule));

describe("a cool week with nothing missed", () => {
  const result = schedule();

  it("leaves the written plan alone", () => {
    expect(result.adjusted).toBe(false);
    expect(placement(result)).toEqual({
      Mon: "lift",
      Tue: "qual",
      Wed: "easy",
      Thu: "easy",
      Sat: "easy",
      Sun: "long",
    });
  });

  it("still recommends a start window for each run", () => {
    expect(dayOf(result, SUN).window).not.toBeNull();
    expect(dayOf(result, TUE).verdict?.level).toBe("green");
  });

  it("reports the week's mileage target and what's left", () => {
    expect(result.weekTarget).toBe(30);
    expect(result.remainingMiles).toBeCloseTo(7 + 5 + 7 + 3 + 14, 1);
    expect(result.loggedMiles).toBe(0);
  });
});

describe("the long run floats to the cooler weekend morning", () => {
  const result = schedule({
    forecast: forecast({ ...allDays(COOL), [SUN]: MUGGY, [SAT]: COOL }),
  });

  it("moves the long run from Sunday to Saturday", () => {
    expect(findType(result, "long")?.date).toBe(SAT);
    expect(dayOf(result, SAT).movedFrom).toBe(SUN);
    expect(dayOf(result, SUN).movedTo).toBe(SAT);
  });

  it("cites the dew-point difference, not a vague preference", () => {
    const reason = dayOf(result, SAT).reasons.find((r) => r.rule === "LONG_RUN_FLOAT");
    expect(reason).toBeDefined();
    expect(reason!.detail).toMatch(/dew point/i);
    expect(reason!.detail).toMatch(/52°/);
  });

  it("puts Saturday's easy run on Sunday rather than dropping it", () => {
    expect(dayOf(result, SUN).actual?.type).toBe("easy");
  });

  it("does not treat a free Sat/Sun float as churn", () => {
    expect(result.adjusted).toBe(true);
  });
});

describe("heat index blocks outdoor speed work", () => {
  const result = schedule({
    forecast: forecast({ ...allDays(COOL), [TUE]: SCORCHING }),
  });

  it("gets the quality session off Tuesday", () => {
    expect(findType(result, "qual")?.date).not.toBe(TUE);
  });

  it("blames the heat-index ceiling", () => {
    expect(rules(result)).toContain("HEAT_INDEX_LIMIT");
  });

  it("keeps the long run on Sunday", () => {
    expect(findType(result, "long")?.date).toBe(SUN);
  });

  it("never stacks the relocated quality day against the long run", () => {
    const qual = findType(result, "qual")!;
    expect(Math.abs(dates.indexOf(qual.date) - dates.indexOf(SUN))).toBeGreaterThan(1);
  });
});

describe("a week that is hot everywhere", () => {
  const result = schedule({ forecast: forecast(allDays(OPPRESSIVE)) });

  it("sends the quality session indoors rather than pretending a day is fine", () => {
    const qual = findType(result, "qual")!;
    expect(qual.indoor).toBe(true);
    expect(qual.reasons.some((r) => r.rule === "DEW_POINT_LIMIT")).toBe(true);
  });

  it("will not put a 14-mile long run on a treadmill", () => {
    expect(findType(result, "long")!.indoor).toBe(false);
  });

  it("escalates the long run to a split-run advisory instead", () => {
    expect(result.advisories.some((a) => a.level === "alert" && /long run/i.test(a.title))).toBe(true);
    expect(rules(result)).toContain("SPLIT_RUN");
  });

  it("surfaces the plan's own hot alternative for the quality day", () => {
    const detail = findType(result, "qual")!.reasons.map((r) => r.detail).join(" ");
    expect(detail).toMatch(/pre-dawn|treadmill/i);
  });
});

describe("settling the past", () => {
  it("marks a completed session complete", () => {
    const result = schedule({
      today: WED,
      activities: [lift(MON), run(TUE, 7, 480)],
    });
    expect(dayOf(result, MON).status).toBe("complete");
    expect(dayOf(result, TUE).status).toBe("complete");
  });

  it("counts a run at 85% of plan as complete, and below that as short", () => {
    const ok = schedule({ today: WED, activities: [lift(MON), run(TUE, 6.1)] });
    expect(dayOf(ok, TUE).status).toBe("complete");

    const shortfall = schedule({ today: WED, activities: [lift(MON), run(TUE, 4)] });
    expect(dayOf(shortfall, TUE).status).toBe("short");
    expect(dayOf(shortfall, TUE).reasons[0].rule).toBe("SHORT_OF_PLAN");
  });

  it("drops a missed easy run instead of cramming it", () => {
    const result = schedule({ today: THU, activities: [lift(MON), run(TUE, 7), lift(WED)] });
    expect(dayOf(result, WED).status).toBe("dropped");
    expect(dayOf(result, WED).reasons[0].rule).toBe("SKIP_DONT_CRAM");
    // Nothing downstream inherited those 5 miles.
    expect(dayOf(result, THU).actual?.miles).toBe(7);
  });

  it("marks a lift-only miss as short, not missed", () => {
    const result = schedule({ today: THU, activities: [lift(MON), run(TUE, 7), run(WED, 5)] });
    expect(dayOf(result, WED).status).toBe("short");
  });
});

describe("when Strava can't be reached", () => {
  const outage = schedule({ today: THU, activities: [], activitiesAvailable: false });

  it("does not accuse you of missing sessions it cannot see", () => {
    for (const date of [MON, TUE, WED]) {
      expect(dayOf(outage, date).status).toBe("unknown");
    }
    expect(outage.days.some((d) => d.status === "missed" || d.status === "dropped")).toBe(false);
  });

  it("schedules no makeups off an absence of evidence", () => {
    expect(outage.days.some((d) => d.makeupFrom)).toBe(false);
    expect(rules(outage)).not.toContain("MAKEUP_PLACED");
  });

  it("still lays out the rest of the week", () => {
    expect(dayOf(outage, THU).actual?.type).toBe("easy");
    expect(findType(outage, "long")?.date).toBe(SUN);
  });

  it("differs from a genuinely empty week, which does report misses", () => {
    const empty = schedule({ today: THU, activities: [] });
    expect(empty.days.some((d) => d.status === "missed")).toBe(true);
  });
});

describe("makeups for missed hard sessions", () => {
  const result = schedule({
    today: WED,
    activities: [lift(MON)], // Tuesday's quality never happened
  });

  it("finds the missed quality session a new day", () => {
    expect(dayOf(result, TUE).status).toBe("missed");
    const makeup = result.days.find((d) => d.makeupFrom === TUE);
    expect(makeup).toBeDefined();
    expect(makeup!.actual?.type).toBe("qual");
  });

  it("says plainly that it is a makeup and where it came from", () => {
    const makeup = result.days.find((d) => d.makeupFrom === TUE)!;
    const reason = makeup.reasons.find((r) => r.rule === "MAKEUP_PLACED")!;
    expect(reason.detail).toContain("Tue");
    expect(reason.detail).toMatch(/quality/i);
  });

  it("does not displace the long run to make room", () => {
    expect(findType(result, "long")?.date).toBe(SUN);
  });

  it("picks up a missed lift on the rest day", () => {
    const missedLift = schedule({ today: WED, activities: [run(TUE, 7)] });
    const friday = dayOf(missedLift, FRI);
    expect(friday.actual?.lift).toBe("A");
    expect(friday.reasons.some((r) => r.rule === "MAKEUP_PLACED")).toBe(true);
  });

  it("reports the week as adjusted when only a lift moved", () => {
    // No run changes place — but Monday's Lift A did, so the board must not
    // claim the week is running as written.
    const missedLift = schedule({ today: WED, activities: [run(TUE, 7)] });
    expect(missedLift.days.every((d) => !d.movedFrom && !d.movedTo)).toBe(true);
    expect(missedLift.adjusted).toBe(true);
  });
});

describe("the plan's own guardrails hold under rearrangement", () => {
  it("never schedules two hard days back to back", () => {
    // Force pressure: Tue and Thu both unusable, so quality must go somewhere.
    const result = schedule({
      forecast: forecast({ ...allDays(COOL), [TUE]: SCORCHING, [WED]: SCORCHING }),
    });
    const hard = result.days
      .filter((d) => ["qual", "long"].includes(d.actual?.type ?? ""))
      .map((d) => dates.indexOf(d.date))
      .sort((a, b) => a - b);
    for (let i = 1; i < hard.length; i++) {
      expect(hard[i] - hard[i - 1]).toBeGreaterThan(1);
    }
  });

  it("keeps the long run on a weekend even when the weekend is the hot part", () => {
    const result = schedule({
      forecast: forecast({ ...allDays(COOL), [SAT]: MUGGY, [SUN]: MUGGY }),
    });
    const longRun = findType(result, "long")!;
    expect([SAT, SUN]).toContain(longRun.date);
  });

  it("keeps Lift A clear of the 48 hours before the long run", () => {
    const result = schedule({
      forecast: forecast({ ...allDays(COOL), [SUN]: MUGGY }), // pulls the long run to Sat
    });
    const longRun = findType(result, "long")!;
    const liftA = result.days.find((d) => d.actual?.lift === "A");
    if (liftA) {
      const gap = dates.indexOf(longRun.date) - dates.indexOf(liftA.date);
      expect(gap < 0 || gap >= 2).toBe(true);
    }
  });
});

describe("advisories", () => {
  it("caps a long run over 14 miles when the dew point is 70–74", () => {
    // W9's long run is 18 miles, so the protocol's 14-mile ceiling actually bites.
    const w9 = weekDays(9).map((d) => d.date);
    const muggyWeek = w9.map((date) => ({
      date,
      highF: MUGGY.temp + 10,
      lowF: MUGGY.temp - 6,
      precipProbMax: 0,
      hours: Array.from({ length: 12 }, (_, h) => ({
        hour: h + 3,
        tempF: MUGGY.temp,
        dewPointF: MUGGY.dew,
        precipProb: 0,
        windMph: 5,
      })),
    }));
    const result = buildSchedule({
      today: w9[0],
      nowHour: 4,
      weekIndex: 9,
      activities: [],
      forecast: muggyWeek,
    });
    const longRun = findType(result, "long")!;
    expect(longRun.verdict?.mileCap).toBe(14);
    expect(result.advisories.some((a) => /caps at 14 miles/.test(a.title))).toBe(true);

    // Remaining mileage counts the capped 14, not the planned 18.
    const plannedMiles = weekDays(9).reduce((sum, d) => sum + (d.miles ?? 0), 0);
    expect(result.remainingMiles).toBe(plannedMiles - (18 - 14));
  });

  it("leaves a 14-mile long run uncapped — it is already at the ceiling", () => {
    const result = schedule({ forecast: forecast(allDays(MUGGY)) });
    expect(findType(result, "long")!.verdict?.mileCap).toBeNull();
  });

  it("tells you to repeat the week after three missed key sessions", () => {
    // W12 has three: Tue quality, Thu quality, Sun long. Stand a day past the
    // week's end so all three have elapsed.
    const w12Mon = weekDays(12)[0].date;
    const result = buildSchedule({
      today: addDays(w12Mon, 7),
      nowHour: 6,
      weekIndex: 12,
      activities: [],
      forecast: [],
    });
    expect(result.advisories.some((a) => a.level === "alert" && /repeat/i.test(a.detail))).toBe(true);
  });

  it("says nothing alarming about a normal week", () => {
    expect(schedule().advisories).toHaveLength(0);
  });
});

describe("determinism", () => {
  it("returns an identical board for identical inputs", () => {
    const input = {
      today: WED,
      nowHour: 5,
      weekIndex: WEEK,
      activities: [lift(MON), run(TUE, 7)],
      forecast: forecast({ ...allDays(MILD), [SUN]: MUGGY, [THU]: SCORCHING }),
    };
    const a = JSON.stringify(buildSchedule(input));
    const b = JSON.stringify(buildSchedule(input));
    expect(a).toBe(b);
  });

  it("survives a missing forecast without inventing decisions", () => {
    const result = schedule({ forecast: [] });
    expect(result.adjusted).toBe(false);
    expect(result.days.every((d) => d.verdict === null)).toBe(true);
    expect(placement(result).Sun).toBe("long");
  });

  it("treats an elapsed morning window as gone", () => {
    const result = schedule({ today: TUE, nowHour: 14, activities: [lift(MON)] });
    const tue = dayOf(result, TUE);
    // Every candidate hour for a weekday quality session is 5–7 AM.
    expect(tue.window).toBeNull();
  });
});
