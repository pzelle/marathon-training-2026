import { dowShort, monthDay } from "@/lib/dates";
import type { ForecastDay } from "@/lib/scheduler";
import { Card, Chip, HEAT_BORDER, HEAT_TEXT, SectionHeading, TYPE_STYLE } from "./ui";

/** Seven days of air, each stamped with what the plan wants that morning. */
export function ConditionsBoard({
  days,
  today,
  source,
}: {
  days: ForecastDay[];
  today: string;
  source: string | null;
}) {
  return (
    <section>
      <SectionHeading aside={source ? `via ${source}` : undefined}>
        7-day conditions board
      </SectionHeading>

      {days.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No forecast available right now.</Card>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {days.map(({ forecast, planned, window, verdict }) => {
            const isToday = forecast.date === today;
            const style = planned ? TYPE_STYLE[planned.type] : null;
            return (
              <Card
                key={forecast.date}
                className={`border-t-4 p-2.5 ${verdict ? HEAT_BORDER[verdict.level] : "border-t-line"} ${
                  isToday ? "bg-[#fffdf7]" : ""
                }`}
              >
                <div className="font-mono text-[10px] tracking-[0.1em] text-muted">
                  {dowShort(forecast.date).toUpperCase()} {monthDay(forecast.date).toUpperCase()}
                  {isToday ? " · TODAY" : ""}
                </div>
                <div className="display my-0.5 text-[22px] normal-case">
                  {forecast.highF}°
                  <span className="text-sm font-normal text-muted"> / {forecast.lowF}°</span>
                </div>
                <div className="font-mono text-[11px] text-muted">
                  {window ? `DP ${window.dewPointF}° @ ${window.hour}AM` : "—"} · ☂{" "}
                  {forecast.precipProbMax}%
                </div>

                {planned && style ? (
                  <>
                    <div className="mt-1.5">
                      <Chip className={style.chip}>{style.label}</Chip>
                    </div>
                    <div className="mt-1 text-[11.5px] leading-snug">{planned.text}</div>
                  </>
                ) : (
                  <div className="mt-1.5 text-[11.5px] text-muted">Outside the plan window</div>
                )}

                {verdict ? (
                  <div className={`mt-1.5 text-[11px] font-semibold leading-snug ${HEAT_TEXT[verdict.level]}`}>
                    {verdict.headline}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
