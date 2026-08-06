"use client";

import { useState } from "react";
import { dowShort, monthDay } from "@/lib/dates";
import { WEEKS, weekDays } from "@/lib/plan";
import { SectionHeading, TYPE_STYLE } from "./ui";

/** Per-day totals from Strava, precomputed on the server. */
export interface LoggedSummary {
  [date: string]: { miles: number; paces: string[]; lifts: number };
}

export function FullPlan({
  logged,
  currentWeek,
  today,
}: {
  logged: LoggedSummary;
  currentWeek: number;
  today: string;
}) {
  const [open, setOpen] = useState<number | null>(currentWeek);

  return (
    <section>
      <SectionHeading aside="jul 13 → nov 1">Full plan</SectionHeading>
      <div className="grid gap-1.5">
        {WEEKS.map((week, wi) => {
          const days = weekDays(wi);
          const plannedMiles = days.reduce((s, d) => s + (d.miles ?? 0), 0);
          const actual = days.reduce((s, d) => s + (logged[d.date]?.miles ?? 0), 0);
          const isOpen = open === wi;
          const isPast = wi < currentWeek;
          const isCurrent = wi === currentWeek;

          return (
            <div
              key={week.label}
              className={`overflow-hidden rounded-[10px] border border-line bg-surface ${
                isCurrent ? "border-l-4 border-l-orange" : ""
              }`}
            >
              <button
                onClick={() => setOpen(isOpen ? null : wi)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left"
              >
                <span className="display text-[15px] tracking-[0.03em]">
                  {week.label}
                  <span className="ml-1.5 text-xs font-normal normal-case tracking-normal text-muted">
                    · {monthDay(days[0].date)}
                  </span>
                </span>
                <span
                  className={`shrink-0 font-mono text-[11px] ${
                    isPast
                      ? actual >= plannedMiles * 0.85
                        ? "text-green"
                        : "text-amber"
                      : "text-muted"
                  }`}
                >
                  {isPast || isCurrent
                    ? `${actual.toFixed(0)} / ${plannedMiles.toFixed(0)} mi`
                    : `${plannedMiles.toFixed(0)} mi`}{" "}
                  {isOpen ? "▴" : "▾"}
                </span>
              </button>

              {isOpen ? (
                <div className="grid grid-cols-2 gap-1.5 px-3.5 pb-3 sm:grid-cols-4 xl:grid-cols-7">
                  {days.map((day) => {
                    const style = TYPE_STYLE[day.type];
                    const done = logged[day.date];
                    return (
                      <div
                        key={day.date}
                        className={`rounded-md border p-2 ${style.tint} ${
                          day.date === today ? "border-orange" : "border-line"
                        }`}
                      >
                        <div className="font-mono text-[9px] tracking-[0.1em] text-muted">
                          {dowShort(day.date).toUpperCase()} {monthDay(day.date).toUpperCase()}
                        </div>
                        <div className="mt-0.5 text-[11.5px] font-semibold leading-snug">
                          {day.text}
                        </div>
                        {done?.miles ? (
                          <div className="mt-1 text-[10.5px] font-bold text-green">
                            ✓ {done.miles.toFixed(1)} mi
                            {done.paces.length ? ` @ ${done.paces[0]}` : ""}
                          </div>
                        ) : null}
                        {done?.lifts ? (
                          <div className="mt-0.5 text-[10.5px] font-bold text-green">
                            ✓ {done.lifts} lift{done.lifts > 1 ? "s" : ""}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
