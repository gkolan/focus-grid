/**
 * Isolated demo persona dataset — contract UI-02 / UI-04. Seeded ONLY into the
 * separate `focusgrid-demo` database, never the live store (RED-85).
 */
import type { FocusGridApp } from "./service";

interface DemoTask {
  title: string;
  context?: string;
  /** natural importance on [-1, 1] — varied so the field reads as a scatter, not three rows */
  importance: number;
  /** deadline as days from today (local) + hour of day; Work tasks are pushed off weekends */
  day?: number;
  hour?: number;
  estimate?: number | null;
  progress?: number;
  block?: boolean;
  /** already finished — past deadlines mostly read as done, not overdue */
  done?: boolean;
  /** shown in Focus and the day view; markdown */
  notes?: string;
}

// Urgency comes from the engine: deadline pressure fades out past ~14 days,
// effort pressure pushes right when the remaining work barely fits.
// Deadlines: 2 yesterday, 8 today, 3 tomorrow, the rest spread over ~3 months.
const TASKS: DemoTask[] = [
  // Do Now: meaningful consequences and deadlines within the day.
  { title: "Send client proposal", context: "Work", importance: 0.88, day: 0, hour: 17, estimate: 180, progress: 0.3, notes: "Scope, timeline and pricing for the Q4 engagement.\n\n- [x] Draft scope section\n- [ ] Pricing table from finance\n- [ ] Legal review of terms\n\nSend as PDF to **priya@client.example** before 5 PM." },
  { title: "Fix checkout outage", context: "Work", importance: 0.68, day: 0, hour: 11, estimate: 90, notes: "Payment webhook returns 500 since the 02:10 deploy.\n\n1. Roll back `checkout-api` to v3.14.2\n2. Compare the Stripe signature header handling\n3. Post an update in #incidents" },
  { title: "Pay electricity bill", context: "Finance", importance: 0.42, day: -1, hour: 18, estimate: 10, notes: "$142.60 due. Account ending 4471 — pay from the joint checking account." },
  { title: "Confirm school pickup", context: "Family", importance: 0.6, day: -2, hour: 15, estimate: 60, done: true, notes: "Confirm with Sam's mum that she can do Thursday pickup at 3:15." },
  { title: "Submit expense report", context: "Work", importance: 0.34, day: -4, hour: 12, estimate: 40, done: true, notes: "Conference travel: flights, two hotel nights, taxis. Receipts are in the *Expenses* folder." },
  { title: "Call the plumber back", context: "Home", importance: 0.56, day: -3, hour: 10, estimate: 15, done: true, notes: "He left a voicemail about the kitchen tap.\n\n- Ask for the quote in writing\n- Check if the part is under warranty\n- Earliest slot next week?" },
  { title: "Refill prescription", context: "Health", importance: 0.76, day: -1, hour: 9, estimate: 20, notes: "Ask the pharmacy for a 90-day supply this time. Prescription number is on the old box." },
  { title: "Reply to the auditor", context: "Finance", importance: 0.62, day: 0, hour: 16, estimate: 150, progress: 0.5, notes: "Questions 3 and 7 need the signed bank statements. Q5 can reference last year's answer.\n\n- [x] Q1–Q2\n- [ ] Q3 statements\n- [ ] Q5 reference\n- [ ] Q7 statements" },
  // Schedule: valuable work with enough time to plan properly.
  { title: "Study for certification", context: "Career", importance: 0.78, day: 9, hour: 18, estimate: 600, progress: 0.25, notes: "Chapters 6–9 left. Practice exam on Sunday morning; aim for 80%+ before booking the real one." },
  { title: "Plan next product release", context: "Work", importance: 0.56, day: 5, hour: 14, estimate: 120, notes: "Cut the release branch Friday.\n\n**Must-haves:** bulk import, dark mode fixes.\n**Nice-to-haves:** move to the following sprint." },
  { title: "Book annual health check", context: "Health", importance: 0.36, day: 12, hour: 9, estimate: 15, notes: "Dr. Okafor's clinic — mornings are easier. Mention the recurring headaches." },
  { title: "Build emergency fund plan", context: "Finance", importance: 0.92, day: 3, hour: 20, estimate: 60, notes: "Target: 6 months of expenses (~$18k).\n\n- Set up an automatic transfer on payday\n- Pick a high-yield savings account\n- Review in three months" },
  { title: "Draft quarterly roadmap", context: "Work", importance: 0.7, day: 7, hour: 16, estimate: 240, progress: 0.1, notes: "Themes: reliability, onboarding, integrations. One page per theme with a measurable outcome each." },
  { title: "Renew passport", context: "Personal", importance: 0.48, day: 14, hour: 10, estimate: 60, notes: "Expires in 4 months. Need a new photo and the DS-82 form; allow 6–8 weeks processing." },
  { title: "Plan parents' visit", context: "Family", importance: 0.28, day: 1, hour: 19, estimate: 40, notes: "Arriving the 26th for a week.\n\n- Air the spare room\n- Plan two day trips\n- Check dietary needs" },
  { title: "Update résumé", context: "Career", importance: 0.62, day: 8, hour: 21, estimate: 90, notes: "Add the platform migration project and the mentoring work. Trim the older roles to one line each." },
  // No deadline: important but not pressing, so Schedule is never empty in the Today view.
  { title: "Set up pension match", context: "Finance", importance: 0.72, estimate: 45, notes: "Employer matches up to 6%. Raise the contribution on the benefits portal." },
  { title: "Write mentoring goals", context: "Career", importance: 0.58, estimate: 40, notes: "Three goals for the next six months; share with Dana before the first session." },
  // The coming week: everyday examples anyone recognises.
  { title: "Gym session", context: "Health", importance: 0.5, day: 2, hour: 7, estimate: 60, notes: "Legs day — squats, lunges, hamstring curls. Bring the resistance band." },
  { title: "1:1 with manager", context: "Work", importance: 0.45, day: 3, hour: 14, estimate: 30, notes: "Topics: promotion timeline, conference budget, on-call rotation feedback." },
  { title: "Call grandma", context: "Family", importance: 0.55, day: 4, hour: 18, estimate: 30, notes: "She wants to hear about the trip. Ask about her physio appointment." },
  { title: "Pay credit card", context: "Finance", importance: 0.6, day: 6, hour: 10, estimate: 10, notes: "Pay the full statement balance to avoid interest. Statement closes on the 20th." },
  // Delegate: time-sensitive coordination that someone else could help with.
  { title: "Arrange team lunch", context: "Work", importance: -0.24, day: 0, hour: 12, estimate: 15, notes: "8 people, Friday. Ask the Thai place about the group booking — two vegetarians." },
  { title: "Collect parcel", context: "Home", importance: -0.46, day: 1, hour: 17, estimate: 100, notes: "Held at the post office until the 18th. Bring ID and the pickup slip." },
  { title: "Format meeting slides", context: "Work", importance: -0.66, day: -3, hour: 9, estimate: 90, done: true, notes: "Use the new template. Replace the old logo on the title and closing slides." },
  { title: "RSVP to team dinner", context: "Work", importance: -0.84, day: 0, hour: 9, estimate: 5, notes: "Reply in the thread — yes, and mention no shellfish." },
  { title: "Order printer toner", context: "Work", importance: -0.34, day: -2, hour: 15, estimate: 10, done: true, notes: "Model TN-2420, black. Two cartridges." },
  { title: "Return library books", context: "Personal", importance: -0.54, day: -6, hour: 18, estimate: 20, done: true, notes: "Three books due. The novel can be renewed online if not finished." },
  { title: "Book car wash", context: "Home", importance: -0.74, day: -5, hour: 10, estimate: 45, done: true, notes: "Full valet before the family visit." },
  { title: "Forward vendor invoice", context: "Finance", importance: -0.28, day: 0, hour: 10, estimate: 12, notes: "Invoice #4811 to accounts payable, cc the project lead." },
  { title: "Book meeting room", context: "Work", importance: -0.5, day: 0, hour: 13, estimate: 20, notes: "Tomorrow 10–11, the one with the whiteboard. Six people." },
  { title: "Chase the courier", context: "Home", importance: -0.4, day: 0, hour: 13, estimate: 30, notes: "Tracking says delivered, nothing at the door. Ask the neighbours first." },
  // Ignore: optional, low-impact tasks that can safely wait.
  { title: "Organize old screenshots", context: "Personal", importance: -0.82, day: 21, hour: 15, estimate: 30, notes: "Delete duplicates, move the useful ones into the *Reference* album." },
  { title: "Browse desk accessories", context: "Personal", importance: -0.62, day: -8, hour: 19, estimate: 20, done: true, notes: "Monitor arm and a cable tray. Nothing over $150." },
  { title: "Sort spare cables", context: "Home", importance: -0.42, day: 20, hour: 11, estimate: 30, notes: "Label what's kept, recycle the rest at the electronics drop-off." },
  { title: "Try a new playlist", context: "Personal", importance: -0.22, estimate: 15, notes: "Something instrumental for deep work." },
  { title: "Reorganize bookshelf", context: "Home", importance: -0.5, day: 34, hour: 14, estimate: 60, notes: "By subject, then author. Donate anything not opened in two years." },
  { title: "Research standing desks", context: "Work", importance: -0.3, day: 27, hour: 10, estimate: 30, notes: "Compare the two-motor models; need 120cm width to fit the alcove." },
  { title: "Archive old photos", context: "Family", importance: -0.72, day: 58, hour: 16, estimate: 45, notes: "2015–2018 albums to the external drive, then verify the backup." },
  { title: "Rename cloud folders", context: "Personal", importance: -0.36, estimate: 20, notes: "Consistent `YYYY-MM project` naming." },
  { title: "Watch that documentary", context: "Personal", importance: -0.7, estimate: 90, notes: "The one about deep-sea cables that Alex recommended." },
  { title: "Pick up dry cleaning", context: "Home", importance: -0.44, day: 3, hour: 17, estimate: 20, notes: "Two shirts and the grey coat. Ticket is on the fridge." },
  { title: "Tidy downloads folder", context: "Personal", importance: -0.58, day: 5, hour: 16, estimate: 20, notes: "Delete installers, file the PDFs." },
  // Previous / next months, so the calendar has something to scroll to.
  { title: "File insurance claim", context: "Finance", importance: 0.66, day: -38, hour: 17, estimate: 45, done: true, notes: "Water damage in the hallway. Photos and the plumber's report attached." },
  { title: "Dentist follow-up", context: "Health", importance: 0.44, day: -24, hour: 10, estimate: 60, done: true, notes: "Check the filling on the lower left." },
  { title: "Onboard new hire", context: "Work", importance: 0.58, day: -16, hour: 9, estimate: 120, progress: 0.6, done: true, notes: "Accounts, laptop, buddy assignment, first-week reading list." },
  { title: "Return rental gear", context: "Personal", importance: -0.4, day: -33, hour: 14, estimate: 30, done: true, notes: "Tent and two sleeping bags to the outdoor shop." },
  { title: "Cancel unused trial", context: "Finance", importance: -0.58, day: -20, hour: 12, estimate: 5, done: true, notes: "Streaming trial ends the 20th — cancel before it bills." },
  { title: "Send birthday card", context: "Family", importance: -0.3, day: -12, hour: 11, estimate: 10, done: true, notes: "Aunt Mei's 70th. Handwritten." },
  { title: "Renew car registration", context: "Finance", importance: 0.54, day: 31, hour: 10, estimate: 20, notes: "Needs the emissions certificate first." },
  { title: "Prepare annual review", context: "Work", importance: 0.8, day: 44, hour: 15, estimate: 180, notes: "Collect metrics for each objective; draft self-assessment; gather peer feedback." },
  { title: "Book flights home", context: "Family", importance: 0.5, day: 66, hour: 20, estimate: 40, notes: "Two adults, one child. Aim for the afternoon direct flight." },
  { title: "Pick a new phone plan", context: "Personal", importance: -0.44, day: 38, hour: 18, estimate: 30, notes: "Current plan renews next month; need more data, fewer minutes." },
  { title: "Clean out the garage", context: "Home", importance: -0.56, day: 52, hour: 9, estimate: 120, notes: "Sort into keep / sell / dump. Book the skip for the weekend." },
  { title: "Try that new café", context: "Personal", importance: -0.68, day: 73, hour: 13, estimate: 60, notes: "The one on Elm Street with the good reviews." },
];

// Background filler: spread across the next month with the bulk inside the next
// two weeks (where deadline pressure actually varies), plus a few overdue — so
// Today / Week / Month views all read as a scatter rather than a clump.
const FILLER: Array<[string, string, number, number]> = [
  ["Water the plants", "Home", -0.3, 20], ["Review pull requests", "Work", 0.4, 60], ["Sync with design team", "Work", 0.3, 45], ["Read industry newsletter", "Career", -0.25, 30], ["Take out recycling", "Home", -0.5, 5], ["Team standup notes", "Work", -0.2, 15],
  ["Meal prep", "Health", 0.25, 90], ["Buy birthday gift", "Family", 0.3, 40], ["Backup laptop", "Personal", 0.45, 20],
  ["Update project board", "Work", -0.35, 30], ["Check tire pressure", "Home", -0.4, 15], ["Transfer to savings", "Finance", 0.55, 5],
  ["Practice presentation", "Career", 0.5, 60], ["Order groceries", "Home", 0.2, 25], ["Reply to recruiter", "Career", -0.3, 15],
  ["Vet appointment", "Family", 0.4, 60], ["Write sprint retro", "Work", 0.3, 45], ["Yoga class", "Health", 0.2, 60],
  ["Sort mail pile", "Home", -0.45, 20], ["Review budget", "Finance", 0.5, 45], ["Return online order", "Personal", -0.35, 20], ["Plan weekend hike", "Personal", -0.2, 30], ["Schedule oil change", "Home", 0.25, 10],
  ["Refresh portfolio site", "Career", -0.3, 120], ["Clean coffee machine", "Home", -0.55, 15], ["Prep client demo", "Work", 0.7, 90],
  ["Book eye exam", "Health", 0.3, 10], ["Renew library card", "Personal", -0.4, 10], ["Quarterly tax estimate", "Finance", 0.65, 60],
  ["Interview candidate", "Work", 0.4, 60], ["Family movie night", "Family", 0.2, 120], ["Declutter desk", "Home", -0.3, 30],
  ["Update dependencies", "Work", -0.25, 45], ["Blood donation", "Health", 0.35, 60], ["Write thank-you notes", "Personal", -0.35, 30],
  ["Deploy release notes", "Work", 0.35, 30], ["Bike tune-up", "Personal", -0.3, 45], ["Compare insurance quotes", "Finance", 0.4, 60],
  ["Mentor session", "Career", 0.45, 45], ["Fix leaky faucet", "Home", 0.3, 60], ["Plan Q4 goals", "Work", 0.6, 90],
  ["Donate old clothes", "Personal", -0.4, 40], ["Flu shot", "Health", 0.5, 20], ["Organize photo albums", "Family", -0.45, 60],
  ["Audit subscriptions", "Finance", -0.2, 30], ["Learn a new shortcut set", "Career", -0.3, 30], ["Host game night", "Personal", -0.25, 120],
  ["Rotate passwords", "Personal", 0.4, 30], ["Print boarding passes", "Family", 0.2, 5], ["Refactor login flow", "Work", 0.3, 180],
  ["Stretch routine", "Health", -0.2, 15], ["Buy printer paper", "Home", -0.5, 10], ["Draft blog post", "Career", 0.25, 120],
];
const FILLER_DAYS = [9, 14, 33, 21, -2, 11, 30, 8, 17, 18, 24, 12, -5, 19, 35, 10, 27, 15, -3, 22, 40, 13, 7, 29, 16]; // at most a handful inside the coming week (≤ 20 per week with the curated set)
const FILLER_TASKS: DemoTask[] = FILLER.map(([title, context, importance, estimate], i) => ({
  title, context, importance, day: FILLER_DAYS[i % FILLER_DAYS.length], hour: 8 + ((i * 5) % 11), estimate,
  // every overdue filler plus every third upcoming one is finished, so "Show completed" changes every quadrant, not just the overdue edge
  done: FILLER_DAYS[i % FILLER_DAYS.length] < 0 || i % 3 === 1,
}));

/** Local wall-clock deadline `day` days from `now` at `hour`; Work never lands on a weekend. */
function deadlineAt(now: Date, t: DemoTask): string {
  const d = new Date(now);
  d.setDate(d.getDate() + t.day!);
  d.setHours(t.hour ?? 12, 0, 0, 0);
  while (t.context === "Work" && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

/**
 * `travel` lets the seed complete tasks "back then" (1.5–7.5 days before their
 * deadline) so done markers keep varied urgency instead of stacking in a column.
 */
export async function seedDemo(app: FocusGridApp, now: Date, travel?: (at: Date | null) => void): Promise<void> {
  const contexts = await app.contexts();
  const byName = new Map(contexts.map((c) => [c.name, c.id]));
  for (const t of [...TASKS, ...FILLER_TASKS]) {
    const deadline = t.day != null ? { kind: "instant" as const, at: deadlineAt(now, t), timeZone: "UTC" } : null;
    const res = await app.createManualTask({
      title: t.title,
      importance: t.importance,
      contextId: t.context ? (byName.get(t.context) ?? null) : null,
      deadline,
      estimatedMinutes: t.estimate ?? null,
      notes: t.notes,
    });
    if (!res.ok) continue;
    if (t.done) {
      if (deadline) travel?.(new Date(Date.parse(deadline.at) - ((t.hour ?? 12) % 5 + 1) * 36 * 3_600_000));
      await app.complete(res.value.id, res.value.revision);
      travel?.(null);
      continue;
    }
    if (t.progress) await app.setProgress(res.value.id, res.value.revision, Math.round(t.progress * 100));
    if (t.block) await app.block(res.value.id, res.value.revision);
  }
}
