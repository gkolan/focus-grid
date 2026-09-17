/**
 * Rectangular viewport projection — contract 45.1. Pure UI geometry; no task
 * mutation, no React. Projection then inverse round-trips within 1e-6.
 */
export interface PlotRect {
  L: number;
  T: number;
  W: number;
  H: number;
}
export interface ViewTransform {
  zoom: number; // 1..8
  panX: number;
  panY: number;
}
export interface SemanticCoord {
  urgency: number; // [-1, 1]
  importance: number; // [-1, 1]
}
export interface PixelPoint {
  x: number;
  y: number;
}

export const IDENTITY_VIEW: ViewTransform = { zoom: 1, panX: 0, panY: 0 };
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

/** Visual clearance only. Zero belongs to the high-importance/high-urgency side. */
export function clearAxes(point: PixelPoint, origin: PixelPoint): PixelPoint {
  const gap = 28;
  return {
    x: point.x >= origin.x ? Math.max(point.x, origin.x + gap) : Math.min(point.x, origin.x - gap),
    y: point.y <= origin.y ? Math.min(point.y, origin.y - gap) : Math.max(point.y, origin.y + gap),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const safe = (n: number, fallback = 0) => (Number.isFinite(n) ? n : fallback);

function plotCenter(p: PlotRect): PixelPoint {
  return { x: p.L + p.W / 2, y: p.T + p.H / 2 };
}

/** Semantic coord → screen pixels (45.1). Importance increases *upward*. */
export function project(c: SemanticCoord, p: PlotRect, v: ViewTransform): PixelPoint {
  if (p.W <= 0 || p.H <= 0) return plotCenter(p);
  const baseX = p.L + ((c.urgency + 1) / 2) * p.W;
  const baseY = p.T + ((1 - c.importance) / 2) * p.H;
  const ctr = plotCenter(p);
  return {
    x: safe(ctr.x + v.zoom * (baseX - ctr.x) + v.panX, ctr.x),
    y: safe(ctr.y + v.zoom * (baseY - ctr.y) + v.panY, ctr.y),
  };
}

/** Screen pixels → semantic coord, removing pan+zoom, clamped to [-1, 1] (45.1). */
export function invert(px: PixelPoint, p: PlotRect, v: ViewTransform): SemanticCoord {
  if (p.W <= 0 || p.H <= 0 || v.zoom <= 0) return { urgency: 0, importance: 0 };
  const ctr = plotCenter(p);
  const baseX = (px.x - v.panX - ctr.x) / v.zoom + ctr.x;
  const baseY = (px.y - v.panY - ctr.y) / v.zoom + ctr.y;
  return {
    urgency: clamp(safe(((baseX - p.L) / p.W) * 2 - 1), -1, 1),
    importance: clamp(safe(1 - ((baseY - p.T) / p.H) * 2), -1, 1),
  };
}

export function fitAll(): ViewTransform {
  return { ...IDENTITY_VIEW };
}

export function clampZoom(z: number): number {
  return clamp(safe(z, 1), ZOOM_MIN, ZOOM_MAX);
}

/** Zoom around a focal pixel so that point stays put (45.1). */
export function zoomAround(
  focal: PixelPoint,
  nextZoom: number,
  p: PlotRect,
  v: ViewTransform,
): ViewTransform {
  const z = clampZoom(nextZoom);
  const before = invert(focal, p, v);
  const candidate = { zoom: z, panX: v.panX, panY: v.panY };
  const after = project(before, p, candidate);
  return {
    zoom: z,
    panX: v.panX + (focal.x - after.x),
    panY: v.panY + (focal.y - after.y),
  };
}

/** Bound pan so the ±1 field always covers the plot — no scrolling into empty space past the edges. */
export function boundPan(v: ViewTransform, p: PlotRect): ViewTransform {
  const zoom = clampZoom(v.zoom);
  const maxX = (p.W * (zoom - 1)) / 2;
  const maxY = (p.H * (zoom - 1)) / 2;
  return {
    zoom,
    panX: clamp(safe(v.panX), -maxX, maxX),
    panY: clamp(safe(v.panY), -maxY, maxY),
  };
}

export type Quadrant = "schedule" | "do_now" | "ignore" | "delegate";
export function quadrantAt(c: SemanticCoord): Quadrant {
  const impHigh = c.importance >= 0;
  const urgHigh = c.urgency >= 0;
  if (impHigh && urgHigh) return "do_now";
  if (impHigh) return "schedule";
  if (urgHigh) return "delegate";
  return "ignore";
}

/** Human placement text for the accessible list (RED-35). */
export function placementText(c: SemanticCoord): string {
  const urg =
    c.urgency >= 0.34 ? "well right of centre (higher urgency)"
    : c.urgency <= -0.34 ? "left of centre (lower urgency)"
    : "near the centre line (urgency)";
  const imp =
    c.importance >= 0.34 ? "high importance"
    : c.importance <= -0.34 ? "low importance"
    : "medium importance";
  const names: Record<Quadrant, string> = {
    schedule: "Schedule",
    do_now: "Do Now",
    ignore: "Ignore",
    delegate: "Delegate",
  };
  return `${names[quadrantAt(c)]} region — ${imp}, ${urg}`;
}
