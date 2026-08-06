import { describe, expect, it } from "vitest";
import {
  adjustedZone,
  heatIndexF,
  heatVerdict,
  relativeHumidity,
  thermalLoad,
  type Conditions,
} from "./heat";
import { PLAN } from "./plan";

const air = (tempF: number, dewPointF: number, precipProb = 0): Conditions => ({
  hour: 6,
  tempF,
  dewPointF,
  precipProb,
});

const easyRun = { type: "easy" as const, text: "5 easy", miles: 5, indoorOk: true };
const tempo = { type: "qual" as const, text: "8 mi: 4×1 mi tempo", miles: 8, indoorOk: true };
const longRun = { type: "long" as const, text: "LR 18", miles: 18 };
const shortLong = { type: "long" as const, text: "LR 12", miles: 12 };

describe("humidity and heat index", () => {
  it("reports saturation when temperature equals dew point", () => {
    expect(relativeHumidity(70, 70)).toBe(100);
  });

  it("falls as the spread between temperature and dew point widens", () => {
    expect(relativeHumidity(85, 65)).toBeLessThan(relativeHumidity(85, 75));
  });

  it("passes temperature through below the heat-index floor", () => {
    expect(heatIndexF(75, 90)).toBe(75);
  });

  it("amplifies temperature once humidity is in play", () => {
    // 88°F at 70% RH is a canonical ~100° heat index.
    expect(heatIndexF(88, 70)).toBeGreaterThan(98);
    expect(heatIndexF(88, 70)).toBeLessThan(104);
  });
});

describe("the rhabdo protocol", () => {
  it("gives a green light in cool, dry air", () => {
    const v = heatVerdict(longRun, air(55, 48))!;
    expect(v.level).toBe("green");
    expect(v.blocked).toBe(false);
    expect(v.paceAdjustSec).toBeNull();
  });

  it("blocks long runs outdoors at dew point 75", () => {
    const v = heatVerdict(longRun, air(82, 75))!;
    expect(v.blocked).toBe(true);
    expect(v.level).toBe("block");
  });

  it("blocks outdoor speed work above an 85° heat index even below dew point 75", () => {
    const v = heatVerdict(tempo, air(90, 72))!;
    expect(v.heatIndexF).toBeGreaterThan(85);
    expect(v.blocked).toBe(true);
  });

  it("lets easy runs proceed in the same air that blocks quality work", () => {
    const hot = air(90, 72);
    expect(heatVerdict(tempo, hot)!.blocked).toBe(true);
    expect(heatVerdict(easyRun, hot)!.blocked).toBe(false);
  });

  it("caps long-run distance at 14 miles in the 70–74 dew point band", () => {
    const v = heatVerdict(longRun, air(78, 72))!;
    expect(v.mileCap).toBe(14);
    expect(v.walkBreaks).toBe(true);
    expect(v.paceAdjustSec).toEqual([30, 45]);
  });

  it("does not cap a run already shorter than the cap", () => {
    expect(heatVerdict(shortLong, air(78, 72))!.mileCap).toBeNull();
  });

  it("offers the plan's own hot alternative when one is written down", () => {
    const session = PLAN["2026-08-04"]; // W3 Tue: 6×3′ @ 10K, hotAlt authored
    expect(session.hotAlt).toBeTruthy();
    const v = heatVerdict(session, air(92, 76))!;
    expect(v.notes.join(" ")).toContain(session.hotAlt!);
  });

  it("treats lift days as weather-independent", () => {
    const v = heatVerdict({ type: "lift", text: "Lift A", lift: "A" }, air(95, 78))!;
    expect(v.blocked).toBe(false);
    expect(v.headline).toMatch(/indoor/i);
  });

  it("asks for fluids on anything past roughly 75 minutes", () => {
    expect(heatVerdict(longRun, air(60, 55))!.fluids).toBeTruthy();
    expect(heatVerdict(easyRun, air(60, 55))!.fluids).toBeNull();
  });
});

describe("pace targets", () => {
  it("holds the written zone in cool air", () => {
    expect(adjustedZone("mp", heatVerdict(easyRun, air(50, 40)))).toBe("8:30–8:40/mi");
  });

  it("adds the band's seconds per mile as the dew point climbs", () => {
    const v = heatVerdict(easyRun, air(78, 72));
    // 8:30–8:40 plus 30–45 sec/mi.
    expect(adjustedZone("mp", v)).toBe("9:00–9:25/mi");
  });
});

describe("thermal load", () => {
  it("weights dew point above dry temperature", () => {
    // Same total degrees, very different physiological cost.
    expect(thermalLoad(air(95, 55))).toBeLessThan(thermalLoad(air(75, 75)));
  });
});
