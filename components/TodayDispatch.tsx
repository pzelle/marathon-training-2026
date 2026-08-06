import { clockHour, dowShort, monthDay } from "@/lib/dates";
import { adjustedZone, ZONES, zonesFor } from "@/lib/heat";
import type { ScheduleDay } from "@/lib/scheduler";
import { Reasons } from "./Reasons";
import { Card, Chip, Eyebrow, HEAT_TEXT, TYPE_STYLE } from "./ui";

/** The one card that answers "what am I doing this morning, and how fast?" */
export function TodayDispatch({ day }: { day: ScheduleDay | undefined }) {
  if (!day) {
    return (
      <Card className="p-[18px]">
        <Eyebrow>Today&apos;s dispatch</Eyebrow>
        <p className="mt-2 text-muted">Outside the plan window.</p>
      </Card>
    );
  }

  const session = day.actual;
  const style = TYPE_STYLE[session?.type ?? "rest"];
  const zones = session ? zonesFor(session) : [];
  const runs = day.logged.filter((a) => a.sport === "Run");
  const others = day.logged.filter((a) => a.sport !== "Run");

  return (
    <Card accent="border-l-orange" className="p-[18px]">
      <Eyebrow>
        Today&apos;s dispatch · {dowShort(day.date)} {monthDay(day.date)}
      </Eyebrow>

      <div className="mt-2.5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* ── The assignment ── */}
        <div>
          <Chip className={style.chip}>{style.label}</Chip>
          {day.indoor ? <Chip className="ml-1.5 bg-butter text-amber">TREADMILL</Chip> : null}
          <div className="display mt-1.5 text-[24px] font-bold normal-case tracking-normal">
            {session ? session.text : "Nothing scheduled — the day is yours."}
          </div>
          <div className="mt-1 text-xs text-muted">
            {day.planned.weekLabel}
            {day.movedFrom ? ` · moved from ${dowShort(day.movedFrom)}` : ""}
            {day.makeupFrom ? ` · makeup from ${dowShort(day.makeupFrom)}` : ""}
            {day.movedTo ? ` · today's ${day.planned.type === "easy" ? "easy run" : "session"} moved to ${dowShort(day.movedTo)}` : ""}
          </div>
          {session?.lift ? (
            <div className="mt-2 text-[13px]">
              <span className="font-semibold text-green">+ Lift {session.lift}</span>{" "}
              <span className="text-muted">
                {session.lift === "A"
                  ? "lower body + core"
                  : session.lift === "B"
                    ? "upper body + core"
                    : "light full body"}
              </span>
            </div>
          ) : null}
        </div>

        {/* ── The weather call ── */}
        <div>
          <Eyebrow>Weather call</Eyebrow>
          {day.verdict ? (
            <div className="mt-2">
              <p className={`text-[15px] font-bold ${HEAT_TEXT[day.verdict.level]}`}>
                {day.verdict.headline}
              </p>
              {day.window ? (
                <p className="mt-1.5 font-mono text-xs text-muted">
                  Start {clockHour(day.window.hour)} · {day.window.tempF}°F · DP{" "}
                  {day.window.dewPointF}° · {day.verdict.humidity}% RH · rain{" "}
                  {day.window.precipProb}%
                </p>
              ) : null}
              {day.verdict.notes.length ? (
                <ul className="mt-2 space-y-1 text-[12.5px] leading-snug text-muted">
                  {day.verdict.notes.map((n) => (
                    <li key={n}>· {n}</li>
                  ))}
                </ul>
              ) : null}
              {day.verdict.fluids ? (
                <p className="mt-2 text-[12.5px] font-semibold text-amber">{day.verdict.fluids}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted">
              {day.reasons.some((r) => r.rule === "WINDOW_PASSED")
                ? "This morning's start window has already passed — no heat call to make."
                : "No forecast for this day yet."}
            </p>
          )}

          {zones.length ? (
            <div className="mt-3 border-t border-line pt-2">
              <Eyebrow>Target paces {day.verdict?.paceAdjustSec ? "(heat-adjusted)" : ""}</Eyebrow>
              <dl className="mt-1.5 space-y-0.5">
                {zones.map((z) => (
                  <div key={z} className="flex justify-between gap-2 text-[12.5px]">
                    <dt className="text-muted">{ZONES[z].label}</dt>
                    <dd className="font-mono font-semibold">{adjustedZone(z, day.verdict)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>

        {/* ── What Strava has ── */}
        <div>
          <Eyebrow>Logged on Strava today</Eyebrow>
          {day.logged.length ? (
            <div className="mt-1.5 space-y-1">
              {runs.map((a) => (
                <div key={a.id} className="text-sm">
                  <span className="font-bold text-green">✓</span> {a.miles} mi
                  {a.paceSecPerMile
                    ? ` @ ${Math.floor(a.paceSecPerMile / 60)}:${String(a.paceSecPerMile % 60).padStart(2, "0")}/mi`
                    : ""}
                  <span className="text-muted"> · {a.name}</span>
                </div>
              ))}
              {others.map((a) => (
                <div key={a.id} className="text-sm text-muted">
                  + {a.sport === "Strength" ? "Lift" : a.sport} · {a.minutes} min
                  <span className="text-muted/70"> · {a.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Nothing yet — the road is waiting.</p>
          )}
        </div>
      </div>

      {day.reasons.length ? (
        <div className="mt-4 border-t border-line pt-3">
          <Eyebrow>Why the board says this</Eyebrow>
          <Reasons reasons={day.reasons} className="mt-2" />
        </div>
      ) : null}
    </Card>
  );
}
