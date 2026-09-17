import { describe, expect, it } from "vitest";
import { type LabelAnchor, layoutLabels } from "./labels";
import { clearAxes } from "./transform";

const plot = { L: 40, T: 40, W: 1360, H: 820 }; // ~1440x900 minus inset

function grid(n: number, cols: number): LabelAnchor[] {
  const rows = Math.ceil(n / cols);
  const out: LabelAnchor[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push({
      id: `t${i}`,
      x: plot.L + 60 + (c / cols) * (plot.W - 200),
      y: plot.T + 40 + (r / rows) * (plot.H - 120),
      title: `Task number ${i}`,
      selected: false,
    });
  }
  return out;
}
const collide = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

describe("layoutLabels", () => {
  it("keeps every pill clear of the horizontal divider and its dot on the marker", () => {
    const axes = { x: 720, y: 450 };
    const coordinates = [
      { x: 720, y: 450 }, { x: 720, y: 450 },
      { x: 719, y: 300 }, { x: 721, y: 600 },
      { x: 400, y: 449 }, { x: 950, y: 451 },
    ];
    const anchors = coordinates.map((p, i) => ({ ...clearAxes(p, axes), id: String(i), title: "A task near a divider", selected: true }));
    const out = layoutLabels(anchors, plot, () => 0, axes);
    expect(out.labels).toHaveLength(6);
    for (const label of out.labels) {
      expect(label.y >= axes.y + 18 || label.y + label.h <= axes.y - 18).toBe(true);
      const a = anchors.find((x) => x.id === label.id)!;
      expect(label.x + 13).toBeCloseTo(a.x); // dot stays on the anchor, whichever side of the axis
    }
  });

  it("well-spaced tasks: dot sits on the anchor", () => {
    const anchors = grid(20, 5);
    const out = layoutLabels(anchors, plot, () => 0);
    for (const l of out.labels) {
      const a = anchors.find((x) => x.id === l.id)!;
      expect(l.x + 13).toBeCloseTo(a.x);
      expect(l.y + l.h / 2).toBeCloseTo(a.y);
    }
  });

  it("every task gets a pill, on the page, with no overlaps — even 20 at one point or at the edge", () => {
    const same: LabelAnchor[] = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, x: 500, y: 400, title: `Same spot ${i}`, selected: false }));
    const edge: LabelAnchor[] = Array.from({ length: 5 }, (_, i) => ({ id: `e${i}`, x: plot.L + plot.W, y: plot.T + plot.H, title: `Edge task ${i}`, selected: false }));
    for (const anchors of [same, edge, grid(60, 8)]) {
      const out = layoutLabels(anchors, plot, () => 0);
      expect(out.labels).toHaveLength(anchors.length);
      for (const l of out.labels) {
        expect(l.x).toBeGreaterThanOrEqual(plot.L);
        expect(l.x + l.w).toBeLessThanOrEqual(plot.L + plot.W);
        expect(l.y).toBeGreaterThanOrEqual(plot.T);
        expect(l.y + l.h).toBeLessThanOrEqual(plot.T + plot.H);
      }
      for (let i = 0; i < out.labels.length; i++)
        for (let j = i + 1; j < out.labels.length; j++) expect(collide(out.labels[i], out.labels[j])).toBe(false);
    }
  });

  it("coincident tasks stack one below the other", () => {
    const anchors: LabelAnchor[] = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, x: 500, y: 400, title: `Same ${i}`, selected: false }));
    const ys = layoutLabels(anchors, plot, () => 0).labels.map((l) => l.y);
    expect(ys[1] - ys[0]).toBe(29);
    expect(ys[2] - ys[1]).toBe(29);
  });

  it("holds its place: with `prefer` fed back, removing a neighbour never moves the rest", () => {
    const axes = { x: 720, y: 450 };
    const pt = clearAxes(axes, axes);
    const pile: LabelAnchor[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, ...pt, title: `Pile ${i}`, selected: false }));
    const first = layoutLabels(pile, plot, (a) => Number(a.id.slice(1)), axes);
    const offs = new Map(first.labels.map((l) => [l.id, l.offset]));
    const rest = layoutLabels(pile.filter((a) => a.id !== "p0"), plot, (a) => Number(a.id.slice(1)), axes, (id) => offs.get(id));
    for (const l of rest.labels) {
      const was = first.labels.find((x) => x.id === l.id)!;
      expect([l.x, l.y], l.id).toEqual([was.x, was.y]);
    }
  });

  it("deterministic: same input ⇒ identical layout", () => {
    const a = grid(50, 7);
    expect(JSON.stringify(layoutLabels(a, plot, () => 0))).toBe(JSON.stringify(layoutLabels(a, plot, () => 0)));
  });
});
