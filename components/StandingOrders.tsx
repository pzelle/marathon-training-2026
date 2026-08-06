import { DEW_POINT_HARD_LIMIT, HEAT_INDEX_SPEED_LIMIT, ZONES, formatPace } from "@/lib/heat";
import { Card, Eyebrow, SectionHeading } from "./ui";

/**
 * The protocol, restated for a human. The engine already enforces these; this
 * section exists so the rules stay visible rather than buried in the code that
 * applies them — including the parts no scheduler can check for you.
 */
export function StandingOrders() {
  return (
    <section>
      <SectionHeading>Standing orders</SectionHeading>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="border-[#f0d9c4] bg-[#fff9f3] p-4">
          <Eyebrow>Heat protocol · enforced by the scheduler</Eyebrow>
          <dl className="mt-2 space-y-1.5 text-[13px] leading-relaxed">
            <Rule term="Dew point 60–64">Slow 15–20 sec/mi.</Rule>
            <Rule term="Dew point 65–69">Slow 20–30 sec/mi, run by effort.</Rule>
            <Rule term="Dew point 70–74">
              Slow 30–45 sec/mi, cap long runs at 14 miles, walk breaks every mile.
            </Rule>
            <Rule term={`Dew point ${DEW_POINT_HARD_LIMIT}+`}>
              No quality work and no long runs outdoors. Treadmill, split, or slide the day.
            </Rule>
            <Rule term={`Heat index over ${HEAT_INDEX_SPEED_LIMIT}°`}>
              No outdoor speed work at all.
            </Rule>
            <Rule term="Past 75 minutes">
              16–24 oz/hour with electrolytes. No NSAIDs before or during.
            </Rule>
          </dl>
          <p className="mt-3 border-t border-[#f0d9c4] pt-2.5 text-[13px] font-semibold leading-relaxed text-red">
            Dark or cola-coloured urine, muscle pain out of proportion to the workout, or unusual
            weakness afterward — stop and seek care. Don&apos;t wait and see.
          </p>
        </Card>

        <div className="grid gap-3">
          <Card className="p-4">
            <Eyebrow>Pace zones · cool weather</Eyebrow>
            <dl className="mt-2 space-y-1">
              {Object.entries(ZONES).map(([key, zone]) => (
                <div key={key} className="flex justify-between gap-3 text-[13px]">
                  <dt className="text-muted">{zone.label}</dt>
                  <dd className="font-mono font-semibold">
                    {formatPace(zone.range[0])}–{formatPace(zone.range[1])}/mi
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2.5 border-t border-line pt-2 text-xs text-muted">
              In heat every one of these converts to effort. The dispatch card shows the adjusted
              range for the morning you&apos;re actually running in.
            </p>
          </Card>

          <Card className="p-4">
            <Eyebrow>Judgement calls the board can&apos;t make</Eyebrow>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted">
              <li>
                · Resting HR up 5 bpm over baseline, or HRV down two days running — take the easy
                day regardless of what this page says.
              </li>
              <li>· Sick, hungover, or badly slept: downgrade the day. Rhabdo loves a compromised body.</li>
              <li>· Walk breaks are a tool, not a failure.</li>
              <li>· Miss three or more days and the plan repeats the prior week rather than pushing on.</li>
              <li>· The mileage numbers serve you, not the reverse.</li>
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}

function Rule({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7.5rem,auto)_1fr] gap-x-3">
      <dt className="font-mono text-[11px] font-bold tracking-tight text-orange">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}
