import type { Reason } from "@/lib/scheduler";
import { Chip, RULE_LABEL } from "./ui";

/**
 * Every schedule change carries the rule that caused it. This is the part that
 * used to be a paragraph of model-written prose; now each line is a named rule
 * plus the numbers that tripped it, so a decision can be checked rather than
 * trusted.
 */
export function Reasons({ reasons, className = "" }: { reasons: Reason[]; className?: string }) {
  if (!reasons.length) return null;
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {reasons.map((r, i) => (
        <li key={`${r.rule}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Chip className="bg-sand text-muted">{RULE_LABEL[r.rule] ?? r.rule}</Chip>
          <span className="text-[12.5px] leading-snug text-muted">{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}
