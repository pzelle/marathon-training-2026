import { hourInTZ, todayISO } from "@/lib/dates";
import { PLAN_START, RACE_DAY, WEEKS, weekOf } from "@/lib/plan";
import { annotateForecast, buildSchedule, todayRow } from "@/lib/scheduler";
import { fetchActivities, StravaError, type Activity } from "@/lib/strava";
import { fetchForecast, type DayForecast } from "@/lib/weather";
import { formatPace } from "@/lib/heat";

import { ConditionsBoard } from "@/components/ConditionsBoard";
import { DataStatus, type SourceStatus } from "@/components/DataStatus";
import { FullPlan, type LoggedSummary } from "@/components/FullPlan";
import { Header } from "@/components/Header";
import { StandingOrders } from "@/components/StandingOrders";
import { TodayDispatch } from "@/components/TodayDispatch";
import { Advisories, WeekBoard } from "@/components/WeekBoard";

/**
 * The board regenerates at most every five minutes. Upstream fetches carry their
 * own cache windows (30 min for the forecast, 5 for Strava) which this does not
 * override, so a reload is cheap and `today` never drifts more than five minutes
 * past midnight.
 */
export const revalidate = 300;

export default async function Page() {
  const today = todayISO();
  const nowHour = hourInTZ();

  // Neither source should be able to take the whole page down with it.
  const [weatherResult, stravaResult] = await Promise.allSettled([
    fetchForecast(),
    fetchActivities(),
  ]);

  const forecast: DayForecast[] =
    weatherResult.status === "fulfilled" ? weatherResult.value.days : [];
  const activities: Activity[] =
    stravaResult.status === "fulfilled" ? stravaResult.value.activities : [];

  const sources: SourceStatus[] = [
    weatherResult.status === "fulfilled"
      ? { name: "Forecast", ok: true, detail: `${weatherResult.value.source}, ${forecast.length}d` }
      : {
          name: "Forecast",
          ok: false,
          detail: errorMessage(weatherResult.reason),
          hint: "The plan still renders, but heat calls and day swaps are unavailable until a forecast comes back.",
        },
    stravaResult.status === "fulfilled"
      ? { name: "Strava", ok: true, detail: `${activities.length} activities` }
      : {
          name: "Strava",
          ok: false,
          detail: errorMessage(stravaResult.reason),
          hint:
            stravaResult.reason instanceof StravaError
              ? stravaResult.reason.hint
              : "Check the STRAVA_* environment variables.",
        },
  ];

  if (stravaResult.status === "fulfilled" && stravaResult.value.refreshTokenRotatedTo) {
    sources.push({
      name: "Strava token",
      ok: false,
      detail: "Strava rotated your refresh token",
      hint: "Update STRAVA_REFRESH_TOKEN in Vercel, or the next cold start will fail to authenticate. The new value is in the server logs.",
    });
  }

  // Clamp to the block if the calendar has run off either end.
  const weekIndex = weekOf(today) ?? (today < PLAN_START ? 0 : WEEKS.length - 1);

  const schedule = buildSchedule({
    today,
    nowHour,
    weekIndex,
    activities,
    activitiesAvailable: stravaResult.status === "fulfilled",
    forecast,
  });
  const forecastDays = annotateForecast(forecast, today, nowHour);

  return (
    <div className="pb-12">
      <Header today={today} weekIndex={weekIndex} />

      <main className="mx-auto grid max-w-[1060px] gap-5 px-5 pt-5">
        <DataStatus sources={sources} />
        <TodayDispatch day={todayRow(schedule, today)} />
        <Advisories result={schedule} />
        <ConditionsBoard
          days={forecastDays}
          today={today}
          source={weatherResult.status === "fulfilled" ? weatherResult.value.source : null}
        />
        <WeekBoard result={schedule} today={today} />
        <FullPlan logged={summarize(activities)} currentWeek={weekIndex} today={today} />
        <StandingOrders />

        <footer className="eyebrow pt-2 text-center">
          Race day {RACE_DAY} · scheduling is deterministic — same inputs, same board
        </footer>
      </main>
    </div>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unavailable";
}

/** Per-day rollups for the full-plan view. */
function summarize(activities: Activity[]): LoggedSummary {
  const out: LoggedSummary = {};
  for (const a of activities) {
    const entry = (out[a.date] ??= { miles: 0, paces: [], lifts: 0 });
    if (a.sport === "Run") {
      entry.miles += a.miles;
      if (a.paceSecPerMile) entry.paces.push(`${formatPace(a.paceSecPerMile)}/mi`);
    } else if (a.sport === "Strength") {
      entry.lifts += 1;
    }
  }
  return out;
}
