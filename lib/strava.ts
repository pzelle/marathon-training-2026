/**
 * Strava, single-athlete.
 *
 * There is no login flow here on purpose: one athlete owns this board, so the
 * credentials live in Vercel env vars and the server refreshes its own access
 * token. Nothing Strava-related ever reaches the browser.
 *
 * Required env:
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *   STRAVA_REFRESH_TOKEN
 */

import { isoInTZ, parseISO } from "./dates";
import { PLAN_START } from "./plan";

export type Sport = "Run" | "Ride" | "Walk" | "Strength" | "Other";

export interface Activity {
  id: number;
  /** Local calendar day in Brooklyn. */
  date: string;
  sport: Sport;
  name: string;
  miles: number;
  minutes: number;
  /** Seconds per mile — runs only. */
  paceSecPerMile: number | null;
  elevationFt: number;
  averageHeartRate: number | null;
}

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

/** Strava sport_type → the four categories this plan cares about. */
function categorize(sportType: string): Sport {
  if (/^(Run|TrailRun|VirtualRun|Treadmill)/i.test(sportType)) return "Run";
  if (/WeightTraining|Crossfit|HighIntensityIntervalTraining|HIIT|Workout|Elliptical/i.test(sportType))
    return "Strength";
  if (/Ride|Cycl|Handcycle|Velomobile/i.test(sportType)) return "Ride";
  if (/Walk|Hike|Snowshoe/i.test(sportType)) return "Walk";
  return "Other";
}

interface TokenState {
  accessToken: string;
  /** Epoch seconds. */
  expiresAt: number;
  /** Set when Strava handed back a different refresh token than we sent. */
  rotatedRefreshToken?: string;
}

// Warm invocations reuse the token rather than burning a refresh per request.
let cached: TokenState | null = null;

export class StravaError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "StravaError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new StravaError(
      `${name} is not set`,
      "Run `vercel env add` for the three STRAVA_* variables, or copy .env.example to .env.local for local dev.",
    );
  }
  return value;
}

async function accessToken(): Promise<TokenState> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 120) return cached;

  const refreshToken = requireEnv("STRAVA_REFRESH_TOKEN");
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: requireEnv("STRAVA_CLIENT_ID"),
      client_secret: requireEnv("STRAVA_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StravaError(
      `Token refresh failed (${res.status})`,
      res.status === 400
        ? "STRAVA_REFRESH_TOKEN is stale or the client credentials don't match. Re-run the one-time authorize step in README."
        : body.slice(0, 200),
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_at: number;
    refresh_token: string;
  };

  cached = {
    accessToken: json.access_token,
    expiresAt: json.expires_at,
    // Strava usually returns the same refresh token, but it reserves the right
    // to rotate. With no datastore we can't persist it, so surface it loudly
    // instead of failing silently on the next cold start.
    rotatedRefreshToken:
      json.refresh_token && json.refresh_token !== refreshToken ? json.refresh_token : undefined,
  };
  return cached;
}

export interface ActivitiesResult {
  activities: Activity[];
  /** Present when STRAVA_REFRESH_TOKEN needs to be updated in the environment. */
  refreshTokenRotatedTo?: string;
  fetchedAt: string;
}

/** Every activity from the start of the training block through now. */
export async function fetchActivities(since: string = PLAN_START): Promise<ActivitiesResult> {
  const token = await accessToken();
  // Strava's `after` is an exclusive epoch-seconds bound; back up a day so the
  // block's first morning is never clipped by the noon-UTC anchor.
  const after = Math.floor(parseISO(since).getTime() / 1000) - 86_400;

  const activities: Activity[] = [];
  // 200 is Strava's page ceiling; the whole block fits in one or two pages.
  for (let page = 1; page <= 3; page++) {
    const url = new URL("https://www.strava.com/api/v3/athlete/activities");
    url.search = new URLSearchParams({
      after: String(after),
      per_page: "200",
      page: String(page),
    }).toString();

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token.accessToken}` },
      next: { revalidate: 300, tags: ["strava"] },
    });

    if (res.status === 401) {
      cached = null;
      throw new StravaError("Strava rejected the access token", "Retry — the token cache was cleared.");
    }
    if (res.status === 429) {
      throw new StravaError(
        "Strava rate limit reached",
        "Strava allows 100 requests per 15 minutes. Wait a few minutes.",
      );
    }
    if (!res.ok) throw new StravaError(`Strava returned ${res.status}`);

    const page_ = (await res.json()) as RawActivity[];
    activities.push(...page_.map(normalize));
    if (page_.length < 200) break;
  }

  return {
    activities: activities.sort((a, b) => a.date.localeCompare(b.date)),
    refreshTokenRotatedTo: token.rotatedRefreshToken,
    fetchedAt: new Date().toISOString(),
  };
}

interface RawActivity {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  distance: number;
  moving_time: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  start_date_local: string;
  start_date: string;
}

function normalize(raw: RawActivity): Activity {
  const sport = categorize(raw.sport_type ?? raw.type ?? "");
  const miles = raw.distance / METERS_PER_MILE;
  const minutes = raw.moving_time / 60;
  return {
    id: raw.id,
    // start_date_local is already wall-clock in the athlete's zone, so slicing
    // the date off it is correct. Fall back to converting the UTC instant.
    date: raw.start_date_local?.slice(0, 10) ?? isoInTZ(new Date(raw.start_date)),
    sport,
    name: raw.name,
    miles: Math.round(miles * 10) / 10,
    minutes: Math.round(minutes),
    paceSecPerMile: sport === "Run" && miles > 0.3 ? Math.round(raw.moving_time / miles) : null,
    elevationFt: Math.round((raw.total_elevation_gain ?? 0) * FEET_PER_METER),
    averageHeartRate: raw.average_heartrate ? Math.round(raw.average_heartrate) : null,
  };
}
