import type { PdfPage, TextItem } from "./types";

export type Cell = { text: string; x: number; right: number };
export type Line = { page: number; y: number; cells: Cell[]; text: string };

/**
 * Rebuild visual lines from positioned text runs: runs on the same baseline
 * (±2pt) form a line, sorted left to right; touching runs are merged into
 * one cell. Lines come out in reading order (page, then top to bottom).
 */
export function toLines(pages: PdfPage[]): Line[] {
  const out: Line[] = [];
  pages.forEach((page, p) => {
    const items = page.items.filter((i) => i.str.trim()).toSorted((a, b) => b.y - a.y || a.x - b.x);
    const rows: TextItem[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= 2);
      if (row) row.push(it);
      else rows.push([it]);
    }
    for (const row of rows.toSorted((a, b) => b[0].y - a[0].y)) {
      const cells: Cell[] = [];
      for (const it of row.toSorted((a, b) => a.x - b.x)) {
        const last = cells.at(-1);
        if (last && it.x - last.right < 1) {
          last.text += it.str;
          last.right = it.x + it.w;
        } else {
          cells.push({ text: it.str.trim(), x: it.x, right: it.x + it.w });
        }
      }
      out.push({
        page: p + 1,
        y: row[0].y,
        cells,
        text: cells.map((c) => c.text).join(" "),
      });
    }
  });
  return out;
}
