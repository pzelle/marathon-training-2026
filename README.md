# Marathon HQ — NYC 2026

A race-day operations board for a 16-week marathon build (Mon Jul 13 → Sun Nov 1, 2026).
It reads what actually happened from Strava, reads the hourly forecast from Open-Meteo, and
decides where the rest of the week's sessions should go.

The scheduling is **deterministic**. Same inputs, same board, every time — and every change it
makes cites the rule that caused it.

## The scheduler

The interesting part is [`lib/scheduler.ts`](lib/scheduler.ts). It replaced a language-model
call that used to decide when to move runs. Same job, but the decisions are now testable and
the reasoning is a citation rather than a paragraph.

It runs in five passes:

1. **Settle the past.** Each elapsed day resolves to complete, short, missed, or dropped.
   Missed easy runs are *dropped* — the plan's rule is skip, don't cram. Missed quality and
   long runs become makeups looking for a home.
2. **Score.** Every remaining day is scored against every session still needing a day, using
   the heat protocol plus the plan's own scheduling constraints.
3. **Search.** Assignments of sessions to days are enumerated exhaustively (the space is at most
   a few thousand arrangements) and the cheapest wins. Greedy placement gets Sat/Sun long-run
   swaps wrong when the quality day also wants to move, so it isn't used.
4. **Hold still unless it's worth it.** The winner is only adopted if it beats leaving the plan
   alone by a real margin, so the board doesn't reshuffle when a dew point wobbles a degree.
5. **Place lifts** around the result, honoring 48-hour clearance before the long run.

### What it optimizes against

Costs are ordinal — what matters is the ranking. A protocol block outranks a treadmill, a
treadmill outranks moving a day, and moving a day outranks a couple of degrees of dew point.

| Constraint | Source |
|---|---|
| No outdoor quality or long runs at dew point 75+ | heat protocol |
| No outdoor speed work above an 85° heat index | heat protocol |
| Long runs cap at 14 miles in the 70–74 dew point band | heat protocol |
| Long run floats freely between Sat and Sun | plan — the move is *free*, not merely cheap |
| Lift A (heavy legs) stays 48h clear of the long run | plan |
| No two hard days back to back | plan |
| Rest and lift-only days are recovery, not spare capacity | plan |
| Treadmill substitution stops being honest past 12 miles | judgment; longer runs split or slide |

Start windows are chosen by a thermal-load score weighting dew point most heavily — it's what
limits evaporative cooling — plus a solar term, so a hot 8 AM never outranks a muggy 5:30.

## Setup

```bash
npm install
```

### Strava

Refresh tokens don't expire, so this is a one-time thing.

1. Create an application at <https://www.strava.com/settings/api>, or reuse the one you have —
   Strava allows only **one API application per account**.
2. Set **Authorization Callback Domain** to exactly `localhost` (no scheme, no port).
3. Put the client ID and secret in `.env.local` (see [`.env.example`](.env.example)).
4. Authorize:

   ```bash
   npm run strava-auth
   ```

   Open the URL it prints, click Authorize, and it writes `STRAVA_REFRESH_TOKEN` to `.env.local`.

The `activity:read_all` scope is requested deliberately — without it private activities are
invisible, and an invisible long run looks like a missed one. Ignore the access token and refresh
token shown on Strava's settings page; those carry `read` only and can't see your activities.

**Reusing an app that already powers something else.** The callback domain is checked only during
the authorize redirect, so you can switch it to `localhost`, run the script, and switch it back —
the refresh token survives. Scopes are the real hazard: re-authorizing *replaces* the scope set
granted to that app for your account, so include anything the other integration needs.

```bash
STRAVA_SCOPE=activity:read_all,profile:read_all,activity:write npm run strava-auth
STRAVA_AUTH_PORT=8722 npm run strava-auth   # if 8721 is taken
```

### Run it

```bash
npm run dev     # http://localhost:3000
npm test        # the scheduler and the heat protocol
npm run build
```

The forecast needs no key, so the board renders with weather alone if Strava isn't configured.

### Deploy

```bash
vercel
vercel env add STRAVA_CLIENT_ID production
vercel env add STRAVA_CLIENT_SECRET production
vercel env add STRAVA_REFRESH_TOKEN production
vercel --prod
```

## How it holds up when things break

- **Strava down** → elapsed days read `unknown`, not `missed`. An empty activity list from a
  failed request is absence of evidence, and the board says so rather than inventing a week of
  missed workouts and makeups to match.
- **Forecast down** → the plan renders as written; heat calls and day swaps are skipped rather
  than guessed.
- **Strava rotates the refresh token** → surfaced as a banner telling you to update the env var.
  There's no datastore here to persist a new one, so it can't be papered over silently.

## Notes on the plan data

The plan document's stated weekly targets run 4–6 miles *below* what its own day-by-day sessions
add up to, in 9 of 16 weeks (W3: sessions total 36, stated target 30). The board measures
progress against the session total — the honest denominator — and shows the document's target
underneath as a secondary label.

## Layout

```
lib/
  plan.ts        the 16 weeks, as structured sessions rather than display strings
  heat.ts        the rhabdo protocol — the only place medical guardrails live
  scheduler.ts   the engine
  strava.ts      single-athlete API client, server-side only
  weather.ts     Open-Meteo
  dates.ts       calendar-day arithmetic pinned to America/New_York
app/             one server-rendered page
components/      the board
```

Dates are the sharp edge here: Vercel runs UTC, the athlete runs in Brooklyn, and "today" has to
mean Brooklyn's today or the board flips over five hours early every evening. Every day key is a
local `YYYY-MM-DD`, parsed at noon UTC so no offset or DST shift can move it across a boundary.
