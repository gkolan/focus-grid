/**
 * SPAT-01 realistic manual fixture (SPATIAL_VALIDATION.md). Exactly 100 tasks
 * created through the ordinary manual command path, deliberately default-heavy
 * so many coordinates coincide. No synthetic spread, no completed/archived.
 */
import type { FocusGridApp, ImportanceChoice, ManualTaskInput } from "@/application/service";
import type { Context } from "@/domain/task";

const NAMES = [
  "Clean the garage", "Sort winter clothes", "Fix the fence gate", "Water the garden",
  "Reply to Aunt María", "Plan weekend hike", "Read new design doc", "Renew library books",
  "Back up laptop", "Update password manager", "Call the dentist", "Schedule car service",
  "Draft project proposal", "Review teammate PR", "Prepare sprint demo", "Write retro notes",
  "Book flights for conference", "Submit expense report", "Renew passport", "File quarterly taxes",
  "Buy birthday gift", "Organize photo album", "Meal-prep for the week", "Descale the kettle",
  "Practice piano", "Study Japanese vocabulary — 日本語の語彙を復習する", "Finish online course module",
  "Update résumé", "Research pension options", "Set up 529 plan",
];

function makeInput(
  i: number,
  title: string,
  now: Date,
  opts: Partial<ManualTaskInput> & { importance: ImportanceChoice },
): ManualTaskInput {
  return { title, ...opts };
}

export interface SpatBuildResult {
  created: string[];
  blockedIds: string[];
}

export async function buildSpatFixture(app: FocusGridApp, now: Date): Promise<SpatBuildResult> {
  const contexts: Context[] = await app.contexts();
  const ctxCycle = [...contexts.map((c) => c.id), null]; // includes Uncategorized
  const ctx = (i: number) => ctxCycle[i % ctxCycle.length];
  const name = (i: number) => `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` (${Math.floor(i / NAMES.length) + 1})` : ""}`;
  const inst = (mins: number) => ({
    kind: "instant" as const,
    at: new Date(now.getTime() + mins * 60_000).toISOString(),
    timeZone: "America/Chicago",
  });

  const created: string[] = [];
  const blockedIds: string[] = [];
  let i = 0;
  const add = async (o: Partial<ManualTaskInput> & { importance: ImportanceChoice }) => {
    const res = await app.createManualTask(makeInput(i, name(i), now, { ...o, contextId: ctx(i) }));
    if (res.ok) created.push(res.value.id);
    i++;
    return res.ok ? res.value : null;
  };

  // 30 undated someday items, untouched Medium
  for (let k = 0; k < 30; k++) await add({ importance: "untouched" });
  // 10 explicit important responsibilities: null deadline, estimate 60, High
  for (let k = 0; k < 10; k++) await add({ importance: "high", estimatedMinutes: 60 });
  // 20 long-horizon: 10 at +14d, 10 at +30d, estimate null, untouched Medium
  for (let k = 0; k < 10; k++) await add({ importance: "untouched", deadline: inst(20_160) });
  for (let k = 0; k < 10; k++) await add({ importance: "untouched", deadline: inst(43_200) });
  // 20 near-term varied: cycle +24h/+3d/+7d/+10d, alt estimate 5/600; half M, quarter L, quarter H
  const horizons = [1_440, 4_320, 10_080, 14_400];
  for (let k = 0; k < 20; k++) {
    const imp: ImportanceChoice = k % 4 === 2 ? "low" : k % 4 === 3 ? "high" : "untouched";
    await add({ importance: imp, deadline: inst(horizons[k % 4]), estimatedMinutes: k % 2 ? 600 : 5 });
  }
  // 10 waiting/deferred/review: 4 blocked +24h; 3 startAt +2h due +3d; 3 cutoff -8d
  for (let k = 0; k < 4; k++) {
    const r = await add({ importance: "untouched", deadline: inst(1_440) });
    if (r) {
      const b = await app.block(r.id, r.revision);
      if (b.ok) blockedIds.push(r.id);
    }
  }
  for (let k = 0; k < 3; k++)
    await add({
      importance: "untouched",
      deadline: inst(4_320),
      startAt: new Date(now.getTime() + 120 * 60_000).toISOString(),
    });
  for (let k = 0; k < 3; k++) await add({ importance: "untouched", deadline: inst(-11_520) });
  // 10 partially completed: +24h, estimate 240, manual progress 0.5; 5 High, 5 Medium
  for (let k = 0; k < 10; k++) {
    const r = await add({ importance: k < 5 ? "high" : "untouched", deadline: inst(1_440), estimatedMinutes: 240 });
    if (r) await app.setProgress(r.id, r.revision, 50);
  }

  return { created, blockedIds };
}
