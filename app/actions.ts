"use server";

import { updateTag } from "next/cache";

/**
 * Drop both upstream caches and re-render. Bound to the board's refresh button,
 * for when you've just finished a run and want it on the page now rather than at
 * the end of the cache window.
 *
 * `updateTag` rather than `revalidateTag`: this is a read-your-own-writes case,
 * so the next render should block on fresh data instead of serving the stale
 * copy the button was pressed to get rid of.
 */
export async function refreshData(): Promise<void> {
  updateTag("strava");
  updateTag("weather");
}
