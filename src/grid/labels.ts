/**
 * Deterministic label placement — contract 45.2 / 45.3 (relaxed). Every task
 * always gets a pill, kept on the page and on its own side of the dividers.
 * The pill's dot sits on the anchor when it can; otherwise the pill is nudged
 * (down/up, then sideways) until it stops overlapping — coincident tasks stack
 * one below the other. Position is relative, not exact. Pure and deterministic.
 */
export interface LabelAnchor {
  id: string;
  x: number;
  y: number;
  title: string;
  selected: boolean;
}
export interface PlacedLabel {
  id: string;
  x: number; // top-left of the text box
  y: number;
  w: number;
  h: number;
  text: string;
  offset: [number, number]; // from the pill's home slot — feed back via `prefer` so it holds its place next frame
}
export interface LabelLayout {
  labels: PlacedLabel[];
}

const CHAR_W = 6.9; // 13px text
const LABEL_H = 26; // pill height
const GAP = 3;
const MAX_CHARS = 26;
const DOT_X = 13; // dot centre from the pill's left edge
const AXIS_GAP = 18;

function estWidth(text: string): number {
  return Math.min(text.length, MAX_CHARS) * CHAR_W + 32; // + pill padding and colour dot
}
function truncate(title: string): string {
  return title.length > MAX_CHARS ? title.slice(0, MAX_CHARS - 1) + "…" : title;
}
function overlaps(a: PlacedLabel, b: PlacedLabel): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/** Nudge offsets: stack downward, then upward, then the same in columns fanning out sideways. */
function* nudges(w: number): Generator<[number, number]> {
  const step = LABEL_H + GAP;
  for (let c = 0; c <= 12; c++) {
    for (const dx of c === 0 ? [0] : [(c * (w + GAP)) / 2, (-c * (w + GAP)) / 2]) {
      for (let k = 0; k < 40; k++) yield [dx, k * step];
      for (let k = 1; k < 40; k++) yield [dx, -k * step];
    }
  }
}

/** A pill drawn exactly on its anchor, outside the collision pass (used for the pill being dragged). */
export function freeLabel(a: LabelAnchor): PlacedLabel {
  const text = truncate(a.title);
  return { id: a.id, x: a.x - DOT_X, y: a.y - LABEL_H / 2, w: estWidth(text), h: LABEL_H, text, offset: [0, 0] };
}

export function layoutLabels(
  anchors: LabelAnchor[],
  plot: { L: number; T: number; W: number; H: number },
  order: (a: LabelAnchor) => number, // lower = placed first (already priority-sorted upstream)
  axes?: { x: number; y: number },
  prefer?: (id: string) => [number, number] | undefined, // last frame's offset from home — pills hold their place when they can
): LabelLayout {
  const placed: PlacedLabel[] = [];
  const sorted = [...anchors].sort((a, b) => order(a) - order(b) || (a.id < b.id ? -1 : 1));

  for (const a of sorted) {
    const text = truncate(a.title);
    const w = estWidth(text);
    // Stay on the page and (first pass) on the marker's side of each divider.
    const fit = (x: number, y: number, keepQuadrant: boolean) => {
      x = Math.max(plot.L, Math.min(x, plot.L + plot.W - w));
      y = Math.max(plot.T, Math.min(y, plot.T + plot.H - LABEL_H));
      // Keep the pill clear of the horizontal divider only; a 190px pill can't stay left of the
      // vertical one without drifting far from its dot, and the dot is what marks the side.
      if (axes && keepQuadrant) {
        y = a.y <= axes.y ? Math.min(y, axes.y - AXIS_GAP - LABEL_H) : Math.max(y, axes.y + AXIS_GAP);
      }
      return { x, y };
    };
    const home = fit(a.x - DOT_X, a.y - LABEL_H / 2, true);
    let box: PlacedLabel = { id: a.id, ...home, w, h: LABEL_H, text, offset: [0, 0] };
    const free = (dx: number, dy: number, keepQuadrant: boolean): PlacedLabel | null => {
      const at = fit(home.x + dx, home.y + dy, keepQuadrant);
      const candidate: PlacedLabel = { id: a.id, ...at, w, h: LABEL_H, text, offset: [at.x - home.x, at.y - home.y] };
      return placed.some((p) => overlaps(p, candidate)) ? null : candidate;
    };
    // Where it sat last frame wins outright (either pass) — so pills hold still while neighbours move.
    const was = prefer?.(a.id);
    const kept = was && (free(was[0], was[1], true) ?? free(was[0], was[1], false));
    if (kept) box = kept;
    else {
      // a crowded quadrant may run out of room; then spill across the divider rather than overlap
      search: for (const keepQuadrant of [true, false]) {
        for (const [dx, dy] of nudges(w)) {
          const candidate = free(dx, dy, keepQuadrant);
          if (candidate) {
            box = candidate;
            break search;
          }
        }
      }
    }
    // ponytail: if every slot on the page is taken the pill overlaps at home
    placed.push(box);
  }
  return { labels: placed };
}
