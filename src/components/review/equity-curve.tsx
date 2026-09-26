"use client";

import { useId, useState } from "react";

import { fmtR } from "@/lib/format";
import { DISPLAY_TZ, formatInTz } from "@/lib/time";

export type CurvePoint = { id: string; at: string; r: number; cum: number; label: string };

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 22, left: 40 };

/**
 * Cumulative R, one point per trade (single series: the title names it, no
 * legend). 2px line, hairline zero baseline, crosshair + tooltip that snaps to
 * the nearest trade; arrow keys move it too. The table below is the non-hover
 * path to every value.
 */
export function EquityCurve({ points }: { points: CurvePoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  if (points.length === 0) {
    return <p className="text-muted-foreground text-sm">No trades with a stop (R) this week.</p>;
  }

  const values = [0, ...points.map((p) => p.cum)];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  // Point 0 is the week's start (0R) so the first trade has a segment.
  const x = (i: number) => PAD.left + (points.length === 0 ? 0 : (i / points.length) * iw);
  const y = (v: number) => PAD.top + ((max - v) / (max - min)) * ih;
  const path = [`M${x(0)},${y(0)}`, ...points.map((p, i) => `L${x(i + 1)},${y(p.cum)}`)].join(" ");
  const ticks = [max - span * 0.08, 0, min + span * 0.08].filter(
    (v, i, a) => a.findIndex((w) => Math.abs(w - v) < span * 0.15) === i,
  );

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / iw) * points.length) - 1;
    setActive(Math.min(points.length - 1, Math.max(0, i)));
  }

  const a = active === null ? null : points[active];
  const ax = active === null ? 0 : x(active + 1);

  return (
    <figure className="space-y-2" data-testid="equity-curve">
      <figcaption id={titleId} className="text-muted-foreground text-xs">
        Cumulative R by trade (n={points.length})
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const d = e.key === "ArrowRight" ? 1 : -1;
              setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? -1) + d)));
            }
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={PAD.left - 6}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground num"
                fontSize={10}
              >
                {v === 0 ? "0R" : fmtR(Math.round(v * 10) / 10)}
              </text>
            </g>
          ))}
          <path
            d={path}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {a && (
            <>
              <line
                x1={ax}
                x2={ax}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={ax}
                cy={y(a.cum)}
                r={4.5}
                fill="var(--primary)"
                stroke="var(--card)"
                strokeWidth={2}
              />
            </>
          )}
        </svg>
        {a && (
          <div
            role="status"
            className="bg-popover pointer-events-none absolute top-1 rounded-md border px-2 py-1 text-xs shadow-md"
            style={{
              left: `${(ax / W) * 100}%`,
              transform: ax > W * 0.6 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
            }}
          >
            <div className="num text-sm font-semibold">{fmtR(a.cum)}</div>
            <div className="text-muted-foreground">
              {a.label} · {fmtR(a.r)} · {formatInTz(a.at, DISPLAY_TZ, "EEE HH:mm")}
            </div>
          </div>
        )}
      </div>
      <details className="text-xs">
        <summary className="text-muted-foreground cursor-pointer">Table</summary>
        <table className="num mt-2 w-full">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-normal">When</th>
              <th className="text-left font-normal">Trade</th>
              <th className="text-right font-normal">R</th>
              <th className="text-right font-normal">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{formatInTz(p.at, DISPLAY_TZ, "EEE HH:mm")}</td>
                <td>{p.label}</td>
                <td className="text-right">{fmtR(p.r)}</td>
                <td className="text-right">{fmtR(p.cum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
