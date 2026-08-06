import type { ReactNode } from "react";
import type { HeatLevel } from "@/lib/heat";
import type { RuleCode } from "@/lib/scheduler";
import type { SessionType } from "@/lib/plan";

/** Session type → the chip colours used across every view of the board. */
export const TYPE_STYLE: Record<SessionType, { label: string; chip: string; tint: string }> = {
  rest: { label: "REST", chip: "bg-sand text-muted", tint: "bg-sand" },
  easy: { label: "EASY RUN", chip: "bg-surface text-ink ring-1 ring-line", tint: "bg-surface" },
  qual: { label: "QUALITY", chip: "bg-sky text-blue", tint: "bg-sky" },
  long: { label: "LONG RUN", chip: "bg-peach text-orange", tint: "bg-peach" },
  lift: { label: "LIFT", chip: "bg-mint text-green", tint: "bg-mint" },
  travel: { label: "TRAVEL", chip: "bg-butter text-amber", tint: "bg-butter" },
  race: { label: "RACE DAY", chip: "bg-[#dceedc] text-green", tint: "bg-[#dceedc]" },
};

export const HEAT_TEXT: Record<HeatLevel, string> = {
  green: "text-green",
  mild: "text-amber",
  caution: "text-orange",
  block: "text-red",
};

export const HEAT_BORDER: Record<HeatLevel, string> = {
  green: "border-t-green",
  mild: "border-t-amber",
  caution: "border-t-orange",
  block: "border-t-red",
};

/** Human labels for the scheduler's rule codes — shown as the tag on a reason. */
export const RULE_LABEL: Record<RuleCode, string> = {
  DEW_POINT_LIMIT: "Dew point limit",
  HEAT_INDEX_LIMIT: "Heat index limit",
  COOLER_WINDOW: "Cooler window",
  LONG_RUN_FLOAT: "Long run float",
  HARD_DAY_SPACING: "Hard-day spacing",
  LIFT_CLEARANCE: "Lift clearance",
  MAKEUP_PLACED: "Makeup",
  SKIP_DONT_CRAM: "Skip, don't cram",
  MILEAGE_CAP: "Mileage cap",
  TREADMILL: "Treadmill",
  SPLIT_RUN: "Split the run",
  WINDOW_PASSED: "Window passed",
  SHORT_OF_PLAN: "Short of plan",
};

export function Card({
  children,
  className = "",
  accent,
}: {
  children: ReactNode;
  className?: string;
  accent?: string;
}) {
  return (
    <div
      className={`rounded-[10px] border border-line bg-surface ${accent ? `border-l-[6px] ${accent}` : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-block rounded px-2 py-[2px] font-mono text-[10px] font-bold tracking-[0.08em] ${className}`}
    >
      {children}
    </span>
  );
}

export function SectionHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-[10px] flex items-baseline justify-between gap-3">
      <h2 className="display text-[18px] tracking-[0.04em]">{children}</h2>
      {aside ? <span className="eyebrow shrink-0">{aside}</span> : null}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
