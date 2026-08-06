#!/usr/bin/env node
/**
 * One-time Strava authorization.
 *
 * Strava's refresh tokens don't expire, so this runs once ever. It opens a
 * loopback server to catch the OAuth redirect, trades the code for tokens, and
 * prints the refresh token you put in Vercel.
 *
 *   node scripts/strava-auth.mjs
 *
 * Prerequisites, from https://www.strava.com/settings/api :
 *   - an API application (any name/website is fine)
 *   - "Authorization Callback Domain" set to exactly:  localhost
 *   - STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in your environment or .env.local
 *
 * Scope note: `activity:read_all` is requested because the board needs to see
 * activities marked private — otherwise a private long run reads as a missed one.
 *
 * Strava allows only one API application per account, so you may be reusing an
 * app that already powers something else. Two knobs for that case:
 *
 *   STRAVA_SCOPE=activity:read_all,profile:read_all,activity:write
 *       Re-authorizing REPLACES the scope set granted to this app for your
 *       account. If the other integration needs a scope, include it here or it
 *       loses access.
 *
 *   STRAVA_AUTH_PORT=8721
 *       The loopback port. Only matters if 8721 is taken.
 *
 * The callback domain is checked only during the authorize redirect, never
 * again — so if your app is registered to another domain you can switch it to
 * `localhost`, run this, and switch it back. The refresh token survives.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, appendFileSync } from "node:fs";

const DEFAULT_SCOPE = "activity:read_all,profile:read_all";

/* Pull credentials from the environment, falling back to .env.local. */
function loadEnv() {
  const env = { ...process.env };
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();
const clientId = env.STRAVA_CLIENT_ID;
const clientSecret = env.STRAVA_CLIENT_SECRET;
const SCOPE = env.STRAVA_SCOPE || DEFAULT_SCOPE;
const PORT = Number(env.STRAVA_AUTH_PORT) || 8721;
const REDIRECT = `http://localhost:${PORT}/callback`;

if (!clientId || !clientSecret) {
  console.error(`
Missing credentials.

  1. Go to https://www.strava.com/settings/api — create an application, or reuse
     the one you have (Strava allows only one per account).
  2. Set "Authorization Callback Domain" to exactly:  localhost
     You can set it back afterward; it's only checked during the redirect.
  3. Put the client ID and secret in .env.local:

       STRAVA_CLIENT_ID=12345
       STRAVA_CLIENT_SECRET=abc...

  4. Run this again.
`);
  process.exit(1);
}

const authUrl =
  "https://www.strava.com/oauth/authorize?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    approval_prompt: "force",
    scope: SCOPE,
  });

console.log(`
Open this in your browser and click Authorize:

${authUrl}

Waiting for the redirect on ${REDIRECT} …
`);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const granted = url.searchParams.get("scope") ?? "";

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h1>Authorization failed</h1><p>${error ?? "no code returned"}</p>`);
    console.error(`\nAuthorization failed: ${error ?? "no code returned"}`);
    server.close();
    process.exit(1);
  }

  if (!granted.includes("activity:read_all")) {
    console.warn(
      `\nWarning: activity:read_all was not granted (got "${granted}").\n` +
        "Private activities will be invisible to the board, which makes them look missed.\n",
    );
  }

  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end("<h1>Token exchange failed</h1><p>Check the terminal.</p>");
    console.error(`\nToken exchange failed (${tokenRes.status}): ${body}`);
    server.close();
    process.exit(1);
  }

  const token = await tokenRes.json();
  const athlete = token.athlete ? `${token.athlete.firstname} ${token.athlete.lastname}` : "unknown";

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    `<body style="font:16px system-ui;padding:3rem;max-width:34rem">
       <h1>Connected</h1>
       <p>Authorized as <strong>${athlete}</strong>. Your refresh token is in the terminal.</p>
       <p>You can close this tab.</p>
     </body>`,
  );

  console.log(`
Authorized as ${athlete}.

  STRAVA_REFRESH_TOKEN=${token.refresh_token}

Next:
  · Local dev — appended to .env.local (below) if it wasn't already there.
  · Production — add all three STRAVA_* vars in the Vercel dashboard, or:

      vercel env add STRAVA_REFRESH_TOKEN production
`);

  // Convenience for local dev only. Never commit .env.local.
  const current = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
  if (!current.includes("STRAVA_REFRESH_TOKEN=")) {
    appendFileSync(".env.local", `\nSTRAVA_REFRESH_TOKEN=${token.refresh_token}\n`);
    console.log("Appended STRAVA_REFRESH_TOKEN to .env.local\n");
  } else {
    console.log("`.env.local` already has a STRAVA_REFRESH_TOKEN — update it by hand.\n");
  }

  server.close();
  process.exit(0);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\nPort ${PORT} is already in use. Pick another:\n\n  STRAVA_AUTH_PORT=8722 npm run strava-auth\n`,
    );
  } else {
    console.error(`\n${err.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT);
