import { diffDays, monthDay } from "@/lib/dates";
import { RACE_DAY, WEEKS } from "@/lib/plan";

/**
 * The mile-marker strip: one segment per week of the block, filled for weeks
 * banked, white for the week in progress. It's the whole build in one glance.
 */
export function Header({ today, weekIndex }: { today: string; weekIndex: number }) {
  const daysToRace = Math.max(0, diffDays(RACE_DAY, today));

  return (
    <header className="bg-blue px-5 pt-5 text-white">
      <div className="mx-auto max-w-[1060px]">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] tracking-[0.2em] text-white/75">
              PETE · BROOKLYN, NY · GOAL 3:45
            </div>
            <h1 className="display mt-1 text-[clamp(30px,5vw,44px)] leading-none">Marathon HQ</h1>
          </div>
          <div className="pb-1 text-right">
            <div className="display text-[clamp(36px,6vw,56px)] leading-none text-bib">
              {daysToRace}
            </div>
            <div className="font-mono text-[10px] tracking-[0.2em] text-white/75">
              {daysToRace === 0 ? "RACE DAY" : "DAYS TO THE VERRAZZANO"}
            </div>
          </div>
        </div>

        <div className="mt-3.5 flex h-2 gap-0" aria-hidden="true">
          {WEEKS.map((w, i) => (
            <div
              key={w.label}
              title={w.label}
              className={`flex-1 border-r-2 border-blue ${
                i < weekIndex ? "bg-bib" : i === weekIndex ? "bg-white" : "bg-white/20"
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between px-0 pt-1 pb-2.5 font-mono text-[9px] tracking-[0.12em] text-white/70">
          <span>JUL 13</span>
          <span>
            WEEK {weekIndex} OF {WEEKS.length - 1}
          </span>
          <span>{monthDay(RACE_DAY).toUpperCase()} · 26.2</span>
        </div>
      </div>
    </header>
  );
}
