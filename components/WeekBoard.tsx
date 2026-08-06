import { dowShort, monthDay } from "@/lib/dates";
import type { ScheduleDay, ScheduleResult } from "@/lib/scheduler";
import { Reasons } from "./Reasons";
import { Card, Chip, Eyebrow, HEAT_TEXT, SectionHeading, TYPE_STYLE } from "./ui";

const STATUS_NOTE: Record<string, { text: string; className: string }> = {
  complete: { text: "Done", className: "text-green" },
  short: { text: "Short of plan", className: "text-amber" },
  missed: { text: "Missed", className: "text-red" },
  dropped: { text: "Skipped — let it go", className: "text-muted" },
  vacated: { text: "Moved off this day", className: "text-blue" },
  unknown: { text: "Strava unavailable — unverified", className: "text-muted" },
};

export function WeekBoard({ result, today }: { result: ScheduleResult; today: string }) {
  const pct = result.plannedMiles
    ? Math.min(100, (result.loggedMiles / result.plannedMiles) * 100)
    : 0;

  return (
    <section>
      <SectionHeading aside={result.adjusted ? "adjusted for conditions" : "running as written"}>
        This week — {result.weekLabel}
      </SectionHeading>

      <Card className="p-3.5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {result.days.map((day) => (
            <DayCell key={day.date} day={day} today={today} />
          ))}
        </div>

        {/* ── Weekly totals ── */}
        <div className="mt-3.5 grid grid-cols-[1fr_auto] items-end gap-4">
          <div>
            <div className="mb-1 flex justify-between font-mono text-[11px] text-muted">
              <span>WEEKLY MILES</span>
              <span>
                {result.loggedMiles.toFixed(1)} / {result.plannedMiles.toFixed(0)} mi
                {result.remainingMiles > 0 ? ` · ${result.remainingMiles.toFixed(0)} to go` : ""}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-sand">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue to-orange transition-[width] duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 font-mono text-[9.5px] text-muted/80">
              PLAN DOCUMENT TARGET: {result.weekTarget} MI
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[11px] text-muted">LIFTS</div>
            <div
              className={`display text-[22px] ${
                result.liftsDone >= result.liftsPlanned ? "text-green" : "text-ink"
              }`}
            >
              {result.liftsDone}
              <span className="text-sm font-normal text-muted"> / {result.liftsPlanned}</span>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function DayCell({ day, today }: { day: ScheduleDay; today: string }) {
  const session = day.actual;
  const style = TYPE_STYLE[session?.type ?? day.planned.type];
  const isToday = day.date === today;
  // The "→ Fri" chip already says the session left; repeating it as a status
  // note on a day that also received work reads as a contradiction.
  const note = day.status === "vacated" && session ? undefined : STATUS_NOTE[day.status];
  const runs = day.logged.filter((a) => a.sport === "Run");
  const lifts = day.logged.filter((a) => a.sport === "Strength");
  const cross = day.logged.filter((a) => a.sport !== "Run" && a.sport !== "Strength");

  const ring = isToday
    ? "border-orange"
    : day.movedFrom || day.makeupFrom
      ? "border-blue"
      : "border-line";

  return (
    <div className={`rounded-lg border ${ring} ${style.tint} p-2`}>
      <div className="flex items-baseline justify-between font-mono text-[9.5px] tracking-[0.1em] text-muted">
        <span>
          {dowShort(day.date).toUpperCase()} {monthDay(day.date).toUpperCase()}
        </span>
        {isToday ? <span className="font-bold text-orange">TODAY</span> : null}
      </div>

      <div className="mt-1 text-xs font-semibold leading-snug">
        {session?.text ?? <span className="text-muted line-through">{day.planned.text}</span>}
      </div>

      {session?.lift ? (
        <div className="mt-1 text-[11px] font-semibold text-green">+ Lift {session.lift}</div>
      ) : null}

      {day.movedFrom ? (
        <Chip className="mt-1.5 bg-blue text-white">⇄ FROM {dowShort(day.movedFrom).toUpperCase()}</Chip>
      ) : null}
      {day.makeupFrom ? (
        <Chip className="mt-1.5 bg-blue text-white">
          ⇄ MAKEUP · {dowShort(day.makeupFrom).toUpperCase()}
        </Chip>
      ) : null}
      {day.movedTo ? (
        <Chip className="mt-1.5 bg-sand text-blue">→ {dowShort(day.movedTo).toUpperCase()}</Chip>
      ) : null}
      {day.indoor ? <Chip className="mt-1.5 bg-butter text-amber">TREADMILL</Chip> : null}

      {day.window && session && day.date >= today ? (
        <div className="mt-1.5 font-mono text-[10px] text-muted">
          {day.window.hour}:00 · {day.window.tempF}° · DP {day.window.dewPointF}°
        </div>
      ) : null}

      {day.verdict && day.date >= today && day.verdict.level !== "green" ? (
        <div className={`mt-1 text-[10.5px] font-semibold leading-snug ${HEAT_TEXT[day.verdict.level]}`}>
          {day.verdict.headline}
        </div>
      ) : null}

      <div className="mt-1.5 space-y-0.5 text-[11.5px]">
        {runs.map((a) => (
          <div key={a.id} className="font-bold text-green">
            ✓ {a.miles} mi
            {a.paceSecPerMile
              ? ` @ ${Math.floor(a.paceSecPerMile / 60)}:${String(a.paceSecPerMile % 60).padStart(2, "0")}`
              : ""}
          </div>
        ))}
        {lifts.map((a) => (
          <div key={a.id} className="font-bold text-green">
            ✓ Lift · {a.minutes}′
          </div>
        ))}
        {cross.map((a) => (
          <div key={a.id} className="text-muted">
            + {a.sport} {a.minutes}′
          </div>
        ))}
        {note ? <div className={`font-semibold ${note.className}`}>{note.text}</div> : null}
      </div>

      {day.reasons.length ? <Reasons reasons={day.reasons} className="mt-2" /> : null}
    </div>
  );
}

export function Advisories({ result }: { result: ScheduleResult }) {
  if (!result.advisories.length) return null;
  const tone = {
    info: "border-l-blue bg-sky",
    warn: "border-l-amber bg-butter",
    alert: "border-l-red bg-peach",
  };
  return (
    <section>
      <SectionHeading>Standing decisions</SectionHeading>
      <div className="grid gap-2">
        {result.advisories.map((a, i) => (
          <div
            key={`${a.title}-${i}`}
            className={`rounded-[10px] border border-line border-l-[6px] p-3.5 ${tone[a.level]}`}
          >
            <Eyebrow>{a.level}</Eyebrow>
            <div className="mt-1 text-sm font-bold">{a.title}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{a.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
