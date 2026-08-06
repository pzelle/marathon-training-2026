"use client";

import { useTransition } from "react";
import { refreshData } from "@/app/actions";
import { Eyebrow } from "./ui";

export interface SourceStatus {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

/**
 * One line telling you whether the board is looking at live data. A dashboard
 * that silently falls back to stale numbers is worse than one that admits it.
 */
export function DataStatus({ sources }: { sources: SourceStatus[] }) {
  const [pending, start] = useTransition();
  const failing = sources.filter((s) => !s.ok);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-surface px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {sources.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] uppercase">
              <span
                className={`inline-block h-2 w-2 rounded-full ${s.ok ? "bg-green" : "bg-red"}`}
                aria-hidden="true"
              />
              <span className={s.ok ? "text-muted" : "text-red"}>
                {s.name} · {s.detail}
              </span>
            </span>
          ))}
        </div>
        <button
          onClick={() => start(() => refreshData())}
          disabled={pending}
          className="rounded-md bg-ink px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-white transition-colors hover:bg-blue disabled:opacity-50"
        >
          {pending ? "SYNCING…" : "REFRESH"}
        </button>
      </div>

      {failing.map((s) => (
        <div
          key={s.name}
          className="rounded-[10px] border border-line border-l-[6px] border-l-red bg-peach p-3.5"
        >
          <Eyebrow>{s.name} unavailable</Eyebrow>
          <p className="mt-1 text-sm font-semibold">{s.detail}</p>
          {s.hint ? <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
