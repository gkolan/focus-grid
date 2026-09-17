"use client";

import type { DueWindowFilter } from "@/domain/focus";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import type { TaskView } from "@/application/service";
import {
  type PlotRect,
  type ViewTransform,
  boundPan,
  clampZoom,
  clearAxes,
  fitAll,
  invert,
  placementText,
  project,
  zoomAround,
} from "@/grid/transform";
import { freeLabel, type LabelAnchor, layoutLabels } from "@/grid/labels";
import { deadlineText, labelText, minutesText, remainingEffortText } from "./format";
import { Icon } from "./icons";

const INSET = 44;
const DRAG_THRESHOLD = 4;

interface DragState {
  id: string;
  revision: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  moved: boolean;
  // displayed dot minus the task's true point at grab time (axis clearance + solver nudges), so the
  // pill follows the pointer from where it was drawn, and the drop stores where the dot is shown
  offX: number;
  offY: number;
}

export function GridView({
  displayZone,
  onOpen,
  sidebarPinned,
  contextFilter,
  due,
  showCompleted,
  selectedId,
  onSelect,
}: {
  displayZone: string;
  onOpen: (v: TaskView) => void;
  sidebarPinned: boolean;
  contextFilter: string; // context id or "all"
  due: DueWindowFilter | null; // time-range bar window or null
  showCompleted: boolean;
  selectedId: string | null; // owned by the shell so it lives in the URL
  onSelect: (id: string | null) => void;
}) {
  const { app, version, refresh, announce } = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewTransform>(fitAll());
  // pills glide only when the *layout* moves them; zooming/panning moves the paper and must be instant.
  // The committed view is tracked in an effect (not during render) so Strict Mode's double render agrees.
  const committedView = useRef(view);
  const viewMoved = committedView.current !== view;
  useEffect(() => {
    committedView.current = view;
  }, [view]);
  const [allData, setData] = useState<{ shown: TaskView[]; total: number } | null>(null);
  const data = useMemo(() => {
    if (!allData || contextFilter === "all") return allData;
    const shown = allData.shown.filter((v) => v.record.task.contextId === contextFilter);
    return { shown, total: shown.length };
  }, [allData, contextFilter]);
  const setSelectedId = useCallback(
    (next: string | null | ((cur: string | null) => string | null)) => onSelect(typeof next === "function" ? next(selectedId) : next),
    [onSelect, selectedId],
  );
  // shift-click builds a group; dragging any member moves the whole group
  const [multi, setMulti] = useState<Set<string>>(() => new Set());
  const [reduceMotion, setReduceMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  const dragRef = useRef<DragState | null>(null);
  // where a just-dropped task sits until the saved position comes back — stops the pill snapping to its old spot
  const dropRef = useRef<{ id: string; urgency: number; importance: number } | null>(null);
  // each pill's offset from its home in the last layout — the solver tries it first so pills don't reshuffle
  const offsetsRef = useRef<Map<string, [number, number]>>(new Map());
  const panRef = useRef<{ x: number; y: number; startPan: ViewTransform } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize({ w: r.width, h: r.height });
      if (dragRef.current) cancelDrag(); // resize mid-drag cancels (RED-41)
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  useEffect(() => {
    let live = true;
    app
      .gridCandidates({ keepIds: selectedId ? [selectedId] : [], due, showCompleted })
      .then((d) => {
        if (!live) return;
        dropRef.current = null;
        setData(d);
      });
    return () => {
      live = false;
    };
  }, [app, version, selectedId, due, showCompleted]);

  const plot: PlotRect = {
    L: INSET,
    T: INSET,
    W: Math.max(0, size.w - INSET * 2),
    H: Math.max(0, size.h - INSET * 2),
  };
  const ready = plot.W > 0 && plot.H > 0 && data != null;
  const origin = project({ urgency: 0, importance: 0 }, plot, view);
  const selected = data?.shown.find((v) => v.record.task.id === selectedId) ?? null;

  function toLocal(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function cancelDrag() {
    dragRef.current = null;
    rerender();
  }
  // Escape cancels a drag wherever keyboard focus happens to be
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) cancelDrag();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── layout of markers + labels ─────────────────────────────────────────────
  const layout = useMemo(() => {
    if (!ready) return null;
    const drag = dragRef.current;
    const moving = drag?.moved ? drag.id : null;
    const markers = data!.shown.map((v) => {
      const drop = dropRef.current?.id === v.record.task.id ? dropRef.current : v.priority;
      let pt = project({ urgency: drop.urgency, importance: drop.importance }, plot, view);
      if (moving === v.record.task.id) {
        // follow the pointer exactly from where the dot was drawn, but never leave the field
        pt = {
          x: Math.max(plot.L, Math.min(pt.x + drag!.offX + (drag!.curX - drag!.startX), plot.L + plot.W)),
          y: Math.max(plot.T, Math.min(pt.y + drag!.offY + (drag!.curY - drag!.startY), plot.T + plot.H)),
        };
        return { v, pt };
      }
      if (moving && multi.has(moving) && multi.has(v.record.task.id)) {
        pt = {
          x: Math.max(plot.L, Math.min(pt.x + drag!.offX + (drag!.curX - drag!.startX), plot.L + plot.W)),
          y: Math.max(plot.T, Math.min(pt.y + drag!.offY + (drag!.curY - drag!.startY), plot.T + plot.H)),
        };
        return { v, pt };
      }
      return { v, pt: clearAxes(pt, origin) };
    });
    const anchors: LabelAnchor[] = markers.map((m) => ({
      id: m.v.record.task.id,
      x: m.pt.x,
      y: m.pt.y,
      title: m.v.record.task.title,
      selected: m.v.record.task.id === selectedId,
    }));
    const rankOf = new Map(
      [...data!.shown]
        .sort((a, b) => b.score - a.score || (a.record.task.id < b.record.task.id ? -1 : 1))
        .map((v, i) => [v.record.task.id, i] as const),
    );
    // pills may spill into the inset margin (the paper is full-bleed), just not off-canvas
    const bounds = { L: plot.L - 13, T: plot.T - 13, W: plot.W + 26, H: plot.H + 26 };
    // The pill being moved (or just dropped, until its saved position returns) floats free of the solver,
    // so it neither jumps nor shoves a neighbour. Everyone else lays out around it.
    const free = moving ?? dropRef.current?.id ?? null;
    const labelLayout = layoutLabels(
      anchors.filter((a) => a.id !== free),
      bounds,
      // pills already on the field are placed before a just-dropped one, so a drop never shoves the resident
      (a) => (rankOf.get(a.id) ?? 999) + (offsetsRef.current.has(a.id) ? 0 : 10_000),
      origin,
      (id) => offsetsRef.current.get(id),
    );
    offsetsRef.current = new Map(labelLayout.labels.map((lab) => [lab.id, lab.offset]));
    if (free) {
      const a = anchors.find((x) => x.id === free);
      if (a) {
        const lab = freeLabel(a);
        // same page bound the solver applies, so the pill lands exactly where it was shown
        const x = Math.max(bounds.L, Math.min(lab.x, bounds.L + bounds.W - lab.w));
        const y = Math.max(bounds.T, Math.min(lab.y, bounds.T + bounds.H - lab.h));
        labelLayout.labels.push({ ...lab, x, y });
      }
    }
    return { markers, labelLayout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, view, selectedId, multi, size, dragRef.current?.moved, dragRef.current?.curX, dragRef.current?.curY]);

  // ── pointer handling ───────────────────────────────────────────────────────
  function onPointerDownMarker(e: React.PointerEvent, v: TaskView) {
    e.stopPropagation();
    e.preventDefault(); // no text selection / native drag from the label
    if (e.shiftKey) {
      const id = v.record.task.id;
      setMulti((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    try {
      svgRef.current?.setPointerCapture(e.pointerId); // move/up are handled on the svg
    } catch {
      /* unknown pointer id (synthetic or odd driver) — the drag still works while the pointer stays over the svg */
    }
    const l = toLocal(e);
    const id = v.record.task.id;
    const lab = layout?.labelLayout.labels.find((x) => x.id === id);
    const truth = project({ urgency: v.priority.urgency, importance: v.priority.importance }, plot, view);
    dragRef.current = {
      id,
      revision: v.record.task.revision,
      startX: l.x,
      startY: l.y,
      curX: l.x,
      curY: l.y,
      moved: false,
      offX: lab ? lab.x + 13 - truth.x : 0,
      offY: lab ? lab.y + lab.h / 2 - truth.y : 0,
    };
  }

  function onPointerDownSurface(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, toLocal(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
      panRef.current = null;
      return;
    }
    const l = toLocal(e);
    panRef.current = { x: l.x, y: l.y, startPan: view };
  }

  function onPointerMove(e: React.PointerEvent) {
    const l = toLocal(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, l);

    if (pinchRef.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const focal = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nextZoom = clampZoom((pinchRef.current.zoom * dist) / pinchRef.current.dist);
      setView((cur) => boundPan(zoomAround(focal, nextZoom, plot, cur), plot));
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      drag.curX = l.x;
      drag.curY = l.y;
      if (!drag.moved && Math.hypot(l.x - drag.startX, l.y - drag.startY) > DRAG_THRESHOLD) {
        drag.moved = true;
      }
      if (drag.moved) rerender();
      return;
    }

    const pan = panRef.current;
    if (pan) {
      setView((cur) =>
        boundPan(
          { zoom: cur.zoom, panX: pan.startPan.panX + (l.x - pan.x), panY: pan.startPan.panY + (l.y - pan.y) },
          plot,
        ),
      );
    }
  }

  async function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;

    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      if (!drag.moved) {
        setSelectedId((cur) => (cur === drag.id ? null : drag.id)); // click again to close
        rerender();
        return;
      }
      // what you see is what is saved: the dot's drawn position at release, computed the same way the
      // frame does (not read back from a render that a fast flick may not have produced yet)
      const l = toLocal(e);
      const v = data!.shown.find((x) => x.record.task.id === drag.id)!;
      const truth = project({ urgency: v.priority.urgency, importance: v.priority.importance }, plot, view);
      const releasePixel = {
        x: Math.max(plot.L, Math.min(truth.x + drag.offX + (l.x - drag.startX), plot.L + plot.W)),
        y: Math.max(plot.T, Math.min(truth.y + drag.offY + (l.y - drag.startY), plot.T + plot.H)),
      };
      const coord = invert(releasePixel, plot, view);
      dropRef.current = { id: drag.id, ...coord };
      rerender();
      const res = await app.dragTo(drag.id, drag.revision, coord);
      if (!res.ok) {
        dropRef.current = null;
        announce(
          res.error.code === "CONFLICT"
            ? "This task changed elsewhere — your drag wasn’t saved."
            : "Placement wasn’t saved. The marker stayed where it was.",
        );
      } else if (multi.has(drag.id) && multi.size > 1) {
        // group drag: every other member moves by the same pixel delta
        let moved = 1;
        for (const other of data!.shown.filter((x) => multi.has(x.record.task.id) && x.record.task.id !== drag.id)) {
          const p0 = project({ urgency: other.priority.urgency, importance: other.priority.importance }, plot, view);
          const px = {
            x: Math.max(plot.L, Math.min(p0.x + drag.offX + (l.x - drag.startX), plot.L + plot.W)),
            y: Math.max(plot.T, Math.min(p0.y + drag.offY + (l.y - drag.startY), plot.T + plot.H)),
          };
          const r = await app.dragTo(other.record.task.id, other.record.task.revision, invert(px, plot, view));
          if (r.ok) moved++;
        }
        announce(`${moved} tasks pinned together.`);
      } else {
        announce("Urgency and importance pinned.");
      }
      refresh();
      return;
    }
    panRef.current = null;
  }

  function onKeyDownSvg(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (dragRef.current) cancelDrag();
      else if (selectedId) setSelectedId(null);
      else if (multi.size) setMulti(new Set());
    }
  }

  /** keyboard placement: arrows nudge a focused pill by 0.05 (shift: 0.2) and pin it. */
  async function nudge(v: TaskView, dx: number, dy: number) {
    const clamp = (n: number) => Math.max(-1, Math.min(1, Math.round(n * 1000) / 1000));
    const coord = { urgency: clamp(v.priority.urgency + dx), importance: clamp(v.priority.importance + dy) };
    const res = await app.dragTo(v.record.task.id, v.record.task.revision, coord);
    announce(res.ok ? `${v.record.task.title}: ${placementText({ ...v.priority, ...coord })}` : res.error.message);
    refresh();
  }

  function onWheel(e: React.WheelEvent) {
    if (!ready) return;
    e.preventDefault();
    const focal = toLocal(e);
    setView((cur) => boundPan(zoomAround(focal, cur.zoom * (e.deltaY < 0 ? 1.15 : 0.87), plot, cur), plot));
  }

  return (
    <div className="flex flex-1">
      {sidebarPinned && size.w >= 1024 && (
        <aside className="w-72 shrink-0 overflow-auto border-r" style={{ borderColor: "var(--line)" }}>
          <AccessibleList data={data} displayZone={displayZone} onOpen={onOpen} />
        </aside>
      )}
      <div className="flex flex-1 flex-col">
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div ref={wrapRef} className="grid-canvas relative min-h-0 flex-1 overflow-hidden">
            <span className="grid-status">
              {data && data.shown.length < data.total ? `Showing ${data.shown.length} of ${data.total}` : ""}
            </span>
            <svg
              ref={svgRef}
              className="absolute inset-0 h-full w-full touch-none select-none outline-none"
              role="group"
              onDragStart={(e) => e.preventDefault()} // a selected label must never become a native drag
              aria-label="Task field. Horizontal position is urgency, vertical position is importance. Drag a marker to pin its position, or focus one and use the arrow keys. Shift-click to select several and drag them together."
              tabIndex={0}
              onPointerDown={onPointerDownSurface}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={(e) => {
                pointers.current.delete(e.pointerId);
                if (dragRef.current) cancelDrag();
                panRef.current = null;
                pinchRef.current = null;
              }}
              onKeyDown={onKeyDownSvg}
              onWheel={onWheel}
            >
              {ready && layout && (
                <>
                  <GraphPaper plot={plot} view={view} origin={origin} size={size} />
                  <text x={20} y={plot.T - 10} className={corner}>Schedule</text>
                  <text x={size.w - 20} y={plot.T - 10} textAnchor="end" className={corner}>Do Now</text>
                  <text x={20} y={plot.T + plot.H + 20} className={corner}>Ignore</text>
                  <text x={size.w - 20} y={plot.T + plot.H + 20} textAnchor="end" className={corner}>
                    Delegate
                    <title>Urgent, lower-importance work. Consider asking someone else; assignment and messaging are not included.</title>
                  </text>

                  {/* label pills — the dot inside is the task's marker (progress pie) */}
                  {layout.labelLayout.labels.map((lab) => {
                    const m = layout.markers.find((mm) => mm.v.record.task.id === lab.id)!;
                    const t = m.v.record.task;
                    const sel = lab.id === selectedId;
                    const tint = m.v.contextColor ?? "var(--muted)";
                    const progress = t.status === "completed" ? 1 : t.progress;
                    const cx = 13;
                    const cy = lab.h / 2;
                    const grabbed = dragRef.current?.id === lab.id && dragRef.current.moved;
                    return (
                      <g key={`lab-${lab.id}`} role="button" tabIndex={0}
                        aria-label={`${t.title}. ${placementText(m.v.priority)}. ${labelText(m.v.priority)}. ${deadlineText(t.deadline, m.v.priority, displayZone)}. Context ${m.v.contextName}. ${Math.round(progress * 100)}% done.${t.userUrgencyOverride ? " Urgency pinned." : ""}`}
                        transform={`translate(${lab.x} ${lab.y})`}
                        style={{
                          opacity: t.status === "completed" ? 0.45 : 1,
                          cursor: grabbed ? "grabbing" : "grab",
                          touchAction: "none",
                          outline: "none",
                          // pills glide to new spots (after a drop, or when a neighbour makes room); the one in hand tracks the pointer raw
                          transition: grabbed || viewMoved || reduceMotion ? "none" : "transform 180ms ease",
                        }}
                        onPointerDown={(e) => onPointerDownMarker(e, m.v)}
                        onDoubleClick={() => onOpen(m.v)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedId((cur) => (cur === lab.id ? null : lab.id));
                            return;
                          }
                          const step = e.shiftKey ? 0.2 : 0.05;
                          const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
                          if (d[e.key]) {
                            e.preventDefault();
                            void nudge(m.v, ...d[e.key]);
                          }
                        }}>
                        <rect x={0} y={0} width={lab.w} height={lab.h} rx={lab.h / 2}
                          fill={`color-mix(in srgb, ${tint} 16%, var(--surface))`}
                          stroke={sel || multi.has(lab.id) ? tint : "none"} strokeWidth={1.5}
                          strokeDasharray={multi.has(lab.id) && !sel ? "4 3" : undefined} />
                        <circle cx={cx} cy={cy} r={6} fill={tint} opacity={0.3} />
                        <circle cx={cx} cy={cy} r={3} fill="none" stroke={tint} strokeWidth={6}
                          strokeDasharray={`${(progress * Math.PI * 6).toFixed(3)} ${Math.PI * 6}`}
                          transform={`rotate(-90 ${cx} ${cy})`} />
                        {t.userUrgencyOverride && <circle cx={4} cy={3} r={2} className="fill-amber-500" />}
                        <text x={23} y={cy + 4.5} className={`text-[13px] ${sel ? "font-semibold" : "font-medium"}`} textDecoration={t.status === "completed" ? "line-through" : undefined}
                          fill="var(--foreground)">
                          {lab.text}
                        </text>
                      </g>
                    );
                  })}

                </>
              )}
            </svg>

            {selected && layout && (
              <DetailCard
                view={selected}
                at={(() => {
                  const lab = layout.labelLayout.labels.find((l) => l.id === selectedId);
                  if (lab) return { x: lab.x, y: lab.y, h: lab.h };
                  const pt = layout.markers.find((m) => m.v.record.task.id === selectedId)?.pt ?? { x: 0, y: 0 };
                  return { x: pt.x - 13, y: pt.y - 13, h: 26 };
                })()}
                size={size}
                displayZone={displayZone}
                onOpen={onOpen}
                onClose={() => setSelectedId(null)}
              />
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

const corner = "fill-[var(--muted)] text-[11px] uppercase tracking-wide";

/** Graph paper in semantic units so it zooms and pans with the field: minor every 0.05, major every 0.2. */
function GraphPaper({ plot, view, origin, size }: { plot: PlotRect; view: ViewTransform; origin: { x: number; y: number }; size: { w: number; h: number } }) {
  const R = plot.L + plot.W;
  const B = plot.T + plot.H;
  const lines: React.ReactNode[] = [];
  // paper covers the whole canvas (past ±1, into the inset); tasks stay inside the plot
  for (let i = -40; i <= 40; i++) {
    const t = i / 20;
    const major = i % 4 === 0;
    const sw = major ? 0.75 : 0.5;
    const x = project({ urgency: t, importance: 0 }, plot, view).x;
    const y = project({ urgency: 0, importance: t }, plot, view).y;
    if (x >= 0 && x <= size.w) lines.push(<line key={`v${i}`} x1={x} y1={0} x2={x} y2={size.h} stroke="var(--grid-minor)" strokeWidth={sw} />);
    if (y >= 0 && y <= size.h) lines.push(<line key={`h${i}`} x1={0} y1={y} x2={size.w} y2={y} stroke="var(--grid-minor)" strokeWidth={sw} />);
  }
  const axisOn = { x: origin.x >= plot.L && origin.x <= R, y: origin.y >= plot.T && origin.y <= B };
  return (
    <g aria-hidden>
      {lines}
      <defs>
        <marker id="axis-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--axis)" />
        </marker>
      </defs>
      {axisOn.y && <line x1={2} y1={origin.y} x2={size.w - 2} y2={origin.y} stroke="var(--axis)" strokeWidth={1} markerStart="url(#axis-arrow)" markerEnd="url(#axis-arrow)" />}
      {axisOn.x && <line x1={origin.x} y1={2} x2={origin.x} y2={size.h - 2} stroke="var(--axis)" strokeWidth={1} markerStart="url(#axis-arrow)" markerEnd="url(#axis-arrow)" />}
      {axisOn.y && <text x={R + 4} y={origin.y - 8} textAnchor="end" className="fill-[var(--muted)] text-[12px] italic">urgency</text>}
      {axisOn.x && <text x={origin.x + 8} y={plot.T - 10} className="fill-[var(--muted)] text-[12px] italic">importance</text>}
    </g>
  );
}

function DetailCard({
  view,
  at,
  size,
  displayZone,
  onOpen,
  onClose,
}: {
  view: TaskView;
  at: { x: number; y: number; h: number }; // the pill's box: card aligns to its left edge
  size: { w: number; h: number };
  displayZone: string;
  onOpen: (v: TaskView) => void;
  onClose: () => void;
}) {
  const { app, refresh, announce, debug } = useApp();
  const t = view.record.task;
  const tint = view.contextColor ?? "var(--muted)";
  const reset = async (axis: "urgency" | "importance") => {
    const r = await app.resetAxis(t.id, t.revision, axis);
    announce(r.ok ? `${axis[0].toUpperCase()}${axis.slice(1)} back to automatic.` : r.error.message);
    refresh();
  };
  const pins = [t.userUrgencyOverride && "urgency", t.userImportanceOverride && "importance"].filter(Boolean) as ("urgency" | "importance")[];
  // Anchor below the pill; flip above when there is no room so the pill stays visible.
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => setH(ref.current?.offsetHeight ?? 0), [view, debug]);
  const GAP = 8;
  const below = at.y + at.h + GAP;
  const above = at.y - GAP - h;
  const top = below + h <= size.h - 8 || above < 8 ? below : above;
  return (
    <div
      ref={ref}
      className="absolute w-80 select-none overflow-hidden rounded-xl border text-sm shadow-lg"
      style={{
        left: Math.max(8, Math.min(at.x, size.w - 328)),
        top,
        background: "var(--surface)",
        borderColor: "var(--line)",
        color: "var(--foreground)",
        borderTop: `3px solid ${tint}`,
      }}
    >
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <p className="text-base font-medium leading-snug">{t.title}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: tint }} />
            {view.contextName}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close details" className="-mr-2 -mt-1 grid h-7 w-7 place-items-center rounded-full text-lg leading-none hover:bg-[var(--field)]" style={{ color: "var(--muted)" }}>×</button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 border-t px-4 py-4" style={{ borderColor: "var(--line)" }}>
        <dt className="pt-0.5" style={{ color: "var(--muted)" }}><Icon name="gauge" /></dt>
        <dd>
          {labelText(view.priority)}
          <span className="mt-0.5 block text-xs leading-relaxed" style={{ color: "var(--muted)" }}>{placementText(view.priority)}</span>
        </dd>
        <dt className="pt-0.5" style={{ color: "var(--muted)" }}><Icon name="clock" /></dt>
        <dd>{remainingEffortText(view.priority)}</dd>
        <dt className={`pt-0.5 ${view.priority.overdue ? "text-danger" : ""}`} style={view.priority.overdue ? undefined : { color: "var(--muted)" }}><Icon name={view.priority.overdue ? "alert" : "calendar"} /></dt>
        <dd className={view.priority.overdue ? "text-danger" : ""}>
          {deadlineText(t.deadline, view.priority, displayZone)}
          {view.priority.overdue && <span className="mt-0.5 block text-xs">This deadline has passed.</span>}
        </dd>
        {pins.map((axis) => (
          <Fragment key={axis}>
            <dt className="pt-0.5 text-[var(--warn)]"><Icon name="pin" /></dt>
            <dd className="flex items-center gap-1 text-xs text-[var(--warn)]">
              <span className="capitalize">{axis}</span> pinned ·
              <button className="underline" onClick={() => reset(axis)}>Reset to automatic</button>
            </dd>
          </Fragment>
        ))}
      </dl>

      {debug && (
        <pre className="mx-4 mb-3 whitespace-pre-wrap rounded p-1 text-[10px]" style={{ background: "var(--field)", color: "var(--muted)" }}>
          {`auto u=${view.priority.automaticUrgency.toFixed(4)} eff u=${view.priority.urgency.toFixed(4)} i=${view.priority.importance.toFixed(2)}
dp=${view.priority.deadlinePressure.toFixed(3)} ep=${view.priority.effortPressure.toFixed(3)} op=${view.priority.overduePressure.toFixed(3)}
trendΔ=${view.priority.timePressureDelta.toFixed(4)} rev=${t.revision} eng=${t.engineVersion} calc=${t.lastCalculatedAt}`}
        </pre>
      )}

      <div className="grid grid-cols-2 gap-2 border-t px-4 py-3" style={{ borderColor: "var(--line)" }}>
        {t.status === "completed" ? (
          <button className="btn" onClick={async () => { const r = await app.reopen(t.id, t.revision); announce(r.ok ? "Task reopened." : r.error.message); refresh(); }}>
            Reopen
          </button>
        ) : (
          <button className="btn btn-primary" onClick={async () => { const r = await app.complete(t.id, t.revision); announce(r.ok ? "Task completed." : r.error.message); refresh(); }}>
            <Icon name="check" /> Complete
          </button>
        )}
        <button onClick={() => onOpen(view)} className="btn">
          <Icon name="pencil" /> Edit task
        </button>
      </div>
    </div>
  );
}

export function AccessibleList({
  data,
  displayZone,
  onOpen,
}: {
  data: { shown: TaskView[]; total: number } | null;
  displayZone: string;
  onOpen: (v: TaskView) => void;
}) {
  if (!data) return <p className="p-4 text-sm text-neutral-500">Loading…</p>;
  if (data.shown.length === 0) return <p className="p-4 text-sm text-neutral-500">No tasks on the field.</p>;
  return (
    <ul className="flex flex-1 flex-col overflow-auto">
      {data.shown.map((v) => {
        const t = v.record.task;
        return (
          <li key={t.id} className="border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
            <button
              onClick={() => onOpen(v)}
              className="flex w-full flex-col gap-0.5 px-4 py-3 text-left text-sm hover:bg-[var(--field)]"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: v.contextColor ?? "var(--muted)" }} />
                <span className="font-medium">{t.title}</span>
              </span>
              <span className="pl-[18px] text-xs text-neutral-500">
                {v.contextName} · {labelText(v.priority)}
                <span className="sr-only">. {placementText(v.priority)}</span>
              </span>
              <span className="pl-[18px] text-xs text-neutral-500">
                {remainingEffortText(v.priority)} · {deadlineText(t.deadline, v.priority, displayZone)} · {minutesText(t.timeSpentMinutes ?? 0)} spent
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
