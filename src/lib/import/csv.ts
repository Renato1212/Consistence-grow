/**
 * Small RFC-4180 CSV parser: quoted fields (with "" escapes and newlines),
 * BOM, CRLF, and auto-detected delimiter (comma, semicolon, tab).
 */
export type Csv = { headers: string[]; rows: string[][]; delimiter: string };

export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => {
    let n = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n++;
    }
    return n;
  };
  const candidates = [",", ";", "\t"];
  return candidates.reduce((best, d) => (count(d) > count(best) ? d : best), ",");
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): Csv {
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [headerRow = [], ...rows] = nonEmpty;
  const headers = headerRow.map((h, i) => h.trim() || `Column ${i + 1}`);
  return { headers, rows, delimiter };
}
