/** PDF bytes → positioned text runs (pdf.js via unpdf; runs on the server and in tests). */
import { getDocumentProxy } from "unpdf";

import type { PdfPage, TextItem } from "./types";

export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

export async function extractPages(bytes: Uint8Array): Promise<PdfPage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width });
      }
      pages.push({ items });
    }
    return pages;
  } finally {
    await pdf.cleanup?.();
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
