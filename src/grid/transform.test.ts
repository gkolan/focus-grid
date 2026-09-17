import { describe, expect, it } from "vitest";
import {
  boundPan,
  clampZoom,
  invert,
  type PlotRect,
  project,
  quadrantAt,
  type ViewTransform,
  zoomAround,
} from "./transform";

const rects: PlotRect[] = [
  { L: 20, T: 20, W: 1200, H: 800 },
  { L: 0, T: 0, W: 300, H: 1000 }, // tall/narrow
  { L: 50, T: 10, W: 1600, H: 240 }, // wide/short
];
const views: ViewTransform[] = [
  { zoom: 1, panX: 0, panY: 0 },
  { zoom: 4, panX: -120, panY: 60 },
  { zoom: 8, panX: 300, panY: -200 },
];

describe("project ∘ invert round-trips within 1e-6 (45.1)", () => {
  for (const p of rects) {
    for (const v of views) {
      it(`W${p.W}xH${p.H} zoom${v.zoom}`, () => {
        for (let u = -1; u <= 1; u += 0.25) {
          for (let i = -1; i <= 1; i += 0.25) {
            const back = invert(project({ urgency: u, importance: i }, p, v), p, v);
            expect(Math.abs(back.urgency - u)).toBeLessThan(1e-6);
            expect(Math.abs(back.importance - i)).toBeLessThan(1e-6);
          }
        }
      });
    }
  }
});

describe("edge cases", () => {
  it("importance increases upward (smaller y)", () => {
    const p = rects[0];
    const hi = project({ urgency: 0, importance: 1 }, p, views[0]);
    const lo = project({ urgency: 0, importance: -1 }, p, views[0]);
    expect(hi.y).toBeLessThan(lo.y);
  });

  it("independent X/Y scales on a wide/short plot", () => {
    const p = rects[2];
    const right = project({ urgency: 1, importance: 0 }, p, views[0]);
    const left = project({ urgency: -1, importance: 0 }, p, views[0]);
    expect(right.x - left.x).toBeCloseTo(p.W, 6);
    const top = project({ urgency: 0, importance: 1 }, p, views[0]);
    const bottom = project({ urgency: 0, importance: -1 }, p, views[0]);
    expect(bottom.y - top.y).toBeCloseTo(p.H, 6);
  });

  it("zero plot size produces no NaN (RED-14 mounting guard)", () => {
    const zero: PlotRect = { L: 0, T: 0, W: 0, H: 0 };
    const pr = project({ urgency: 0.5, importance: -0.5 }, zero, views[0]);
    expect(Number.isFinite(pr.x) && Number.isFinite(pr.y)).toBe(true);
    const inv = invert({ x: 10, y: 10 }, zero, views[0]);
    expect(inv).toEqual({ urgency: 0, importance: 0 });
  });

  it("invert clamps out-of-plot pixels to [-1,1]", () => {
    const c = invert({ x: 100000, y: -100000 }, rects[0], views[0]);
    expect(c.urgency).toBe(1);
    expect(c.importance).toBe(1);
  });

  it("clampZoom bounds to [1,8] and rejects NaN", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(99)).toBe(8);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("zoomAround keeps the focal point fixed", () => {
    const p = rects[0];
    const focal = { x: 400, y: 300 };
    const v2 = zoomAround(focal, 3, p, views[0]);
    const before = invert(focal, p, views[0]);
    const after = project(before, p, v2);
    expect(Math.abs(after.x - focal.x)).toBeLessThan(1e-6);
    expect(Math.abs(after.y - focal.y)).toBeLessThan(1e-6);
  });

  it("boundPan keeps pan finite and bounded", () => {
    const b = boundPan({ zoom: 2, panX: 1e9, panY: -1e9 }, rects[0]);
    expect(Number.isFinite(b.panX) && Number.isFinite(b.panY)).toBe(true);
    // field edges never move inside the plot: at zoom 1 no pan, at zoom 2 at most half the plot
    expect(boundPan({ zoom: 1, panX: 500, panY: 500 }, rects[0])).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(b.panX).toBe(rects[0].W / 2);
    expect(b.panY).toBe(-rects[0].H / 2);
  });

  it("quadrant boundary: (0,0) is do_now", () => {
    expect(quadrantAt({ urgency: 0, importance: 0 })).toBe("do_now");
    expect(quadrantAt({ urgency: -0.01, importance: 0 })).toBe("schedule");
  });
});
