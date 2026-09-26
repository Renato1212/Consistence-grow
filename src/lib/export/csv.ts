/** Rows → CSV (RFC 4180). Arrays and objects are written as JSON. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) lines.push(headers.map((h) => cell(r[h])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}
