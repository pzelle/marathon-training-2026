/**
 * Calendar-day arithmetic for the training block.
 *
 * Everything in this app is keyed by a local calendar day in Brooklyn, not by
 * an instant. Vercel functions run in UTC, so "today" has to be asked for
 * explicitly in TZ or the board flips over five hours early every evening.
 *
 * ISO day strings are anchored at noon UTC when parsed. Noon is far enough from
 * both midnights that no offset or DST shift can push the date across a
 * boundary, which keeps addDays/diffDays exact without pulling in a date lib.
 */

export const TZ = "America/New_York";

/** Fort Greene, Brooklyn — the forecast point for every run in this plan. */
export const HOME = { latitude: 40.688, longitude: -73.981 } as const;

const ISO_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day `instant` falls on in Brooklyn, as YYYY-MM-DD. */
export function isoInTZ(instant: Date): string {
  return ISO_FMT.format(instant);
}

/** Today in Brooklyn. Pass `now` to make callers testable. */
export function todayISO(now: Date = new Date()): string {
  return isoInTZ(now);
}

/** The current hour (0–23) in Brooklyn — used to know if a window has passed. */
export function hourInTZ(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
}

export function parseISO(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `b` to `a` (positive when `a` is later). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86_400_000);
}

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Day of week in plan ordering: 0 = Monday … 6 = Sunday. */
export function planDow(iso: string): number {
  return (parseISO(iso).getUTCDay() + 6) % 7;
}

export function dowShort(iso: string): string {
  return DOW_SHORT[planDow(iso)];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 5" */
export function monthDay(iso: string): string {
  const d = parseISO(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Format an hour-of-day the way a runner reads a start time: "6:00 AM". */
export function clockHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}
