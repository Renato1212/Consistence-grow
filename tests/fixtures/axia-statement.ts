/**
 * Generates an anonymised Axia "Daily Detail Statement" PDF with the same
 * layout as the real report (positions copied from it), from a small spec.
 * Amounts, totals, realized P/L, cash roll and NLV are computed so every
 * self-check passes, unless `tamper` asks otherwise. Used by unit and E2E
 * tests; real statements never go into the repository.
 */
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export type FixtureFill = { side: "buy" | "sell"; qty: number; price: string; date?: string };
export type FixtureProduct = {
  code: string;
  contract: string;
  exchange: string;
  description: string;
  /** Cash per 1.0 of printed price per contract. */
  multiplier: number;
  fills: FixtureFill[];
};
export type FixtureSpec = {
  tradeDate: string; // YYYY-MM-DD
  client?: string;
  account?: string;
  simulated?: boolean;
  openCash?: number;
  mtdPrior?: number;
  nlvPrior?: number[]; // T-4 … T-1
  products: FixtureProduct[];
  tamper?: {
    summaryRealized?: number;
    dropTotalFor?: string;
    extraLine?: string;
    report?: string;
    splitProductText?: boolean;
  };
};

export const DEFAULT_PRODUCTS: FixtureProduct[] = [
  {
    code: "21",
    contract: "DEC-26",
    exchange: "CBT",
    description: "10Y T-NOTE",
    multiplier: 1000,
    fills: [
      { side: "buy", qty: 3, price: "104'115" },
      { side: "buy", qty: 1, price: "104'130" },
      { side: "sell", qty: 4, price: "104'170" },
    ],
  },
  {
    code: "MS",
    contract: "DEC-26",
    exchange: "CME",
    description: "MICRO S&P",
    multiplier: 5,
    fills: [
      { side: "buy", qty: 10, price: "7760.25" },
      { side: "sell", qty: 5, price: "7757.5" },
      { side: "sell", qty: 5, price: "7755" },
    ],
  },
  {
    code: "EF",
    contract: "NOV-26",
    exchange: "NYM",
    description: "MICR CRUDE",
    multiplier: 100,
    fills: [
      { side: "buy", qty: 2, price: "94.1" },
      { side: "sell", qty: 2, price: "94.47" },
    ],
  },
  {
    code: "J1",
    contract: "DEC-26",
    exchange: "IMM",
    description: "JPY",
    multiplier: 1250,
    fills: [
      { side: "buy", qty: 2, price: "63.925" },
      { side: "sell", qty: 2, price: "64.13" },
    ],
  },
];

const FRACTION: Record<string, number> = {
  "0": 0,
  "1": 0.125,
  "2": 0.25,
  "3": 0.375,
  "5": 0.5,
  "6": 0.625,
  "7": 0.75,
  "8": 0.875,
};

function priceValue(p: string): number {
  const m = /^(\d+)'(\d{2})(\d)$/.exec(p);
  if (m) return Math.round((Number(m[1]) + (Number(m[2]) + FRACTION[m[3]]) / 32) * 1e5) / 1e5;
  return Number(p);
}

const cents = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number, grouped = true) =>
  grouped
    ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toFixed(2);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dmy(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTHS[m - 1]}-${y}`;
}
function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${day}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export function fixtureAmounts(spec: FixtureSpec) {
  const products = spec.products.map((p) => {
    const lines = p.fills.map((f) => {
      const amount = cents(
        (f.side === "buy" ? -1 : 1) * f.qty * priceValue(f.price) * p.multiplier,
      );
      return { ...f, amount };
    });
    const realized = cents(lines.reduce((s, l) => s + l.amount, 0));
    return { ...p, lines, realized };
  });
  const realized = cents(products.reduce((s, p) => s + p.realized, 0));
  const openCash = spec.openCash ?? 25_000;
  const close = cents(openCash + realized);
  return { products, realized, openCash, close };
}

export async function buildAxiaStatementPdf(spec: FixtureSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 7.5;
  const { products, realized, openCash, close } = fixtureAmounts(spec);
  const summaryRealized = spec.tamper?.summaryRealized ?? realized;
  let page!: PDFPage;
  let pageNo = 0;
  let y = 0;

  const text = (s: string, x: number, yy: number, f: PDFFont = font) =>
    page.drawText(s, { x, y: yy, size, font: f });
  const right = (s: string, r: number, yy: number) =>
    text(s, r - font.widthOfTextAtSize(s, size), yy);

  const newPage = (title: string, columns: boolean) => {
    if (pageNo > 0) footer();
    page = doc.addPage([595.28, 841.89]);
    pageNo++;
    const rows: [string, string][] = [
      ["Report", spec.tamper?.report ?? "Daily Detail Statement"],
      ["Trade Date", longDate(spec.tradeDate)],
      ["Client", spec.client ?? "APT0000"],
      ["Account", spec.account ?? "OBS_TEST"],
    ];
    rows.forEach(([k, v], i) => {
      text(k, 17, 811.1 - i * 11.35);
      text(":", 73.7, 811.1 - i * 11.35);
      text(v, 87.9, 811.1 - i * 11.35);
    });
    text("Test Trader", 22.7, 757.3);
    text("Axia Pro Trial", 348.7, 757.3);
    if (spec.simulated ?? true) {
      text("This is a simulated trading statement", 348.7, 746);
      text("and does not reflect real money", 348.7, 734.6);
    }
    text(title, 297.6 - font.widthOfTextAtSize(title, size) / 2, 656.7);
    if (columns) {
      const heads: [string, number][] = [
        ["Trade Date", 14.2],
        ["Long", 75.9],
        ["Short", 99.9],
        ["Delivery/Product", 136.1],
        ["C/P", 292],
        ["Strike", 319.4],
        ["Trade Price", 362.6],
        ["Currency", 481.9],
        ["Amount", 549],
      ];
      for (const [h, x] of heads) text(h, x, 641.1);
    }
    y = 626.9;
  };
  let footer = () => {
    text(
      "PLEASE CHECK ACCURACY IMMEDIATELY AND REPORT ANY QUERIES TO TRIALS@AXIATRADINGGROUP.COM WITHIN 24 HOURS.",
      126,
      20.9,
    );
    right(`Page ${pageNo}`, 578.5, 9.5);
  };
  const next = (title: string) => {
    y -= 11.35;
    if (y < 60) newPage(title, true);
  };

  // Page 1: financial summary.
  newPage("FINANCIAL SUMMARY", false);
  right("USD", 235.4, 641.1);
  right("BASE USD", 320.5, 641.1);
  const mtd = cents((spec.mtdPrior ?? 0) + summaryRealized);
  const summary: ([string, number] | null)[] = [
    ["FX Spot Rate USD", 1],
    ["Open Cash Balance", openCash],
    ["Cash Entries", 0],
    ["FX Trades", 0],
    ["Option Premium", 0],
    ["Net Equity Trade", 0],
    ["Realized P/L", summaryRealized],
    ["FX Realized P/L", 0],
    null,
    ["CLR Commission", 0],
    ["Market Fees", 0],
    ["NFA Fees", 0],
    ["Misc Fees", 0],
    ["Total Fees", 0],
    null,
    ["Total Charge", 0],
    null,
    ["Close Cash Balance", close],
    null,
    ["Open Trade Equity", 0],
    ["FX Open Trade Equity", 0],
    ["Total Equity", close],
    ["Equity Portfolio Value", 0],
    ["Net Option Market Value", 0],
    ["Net Liquid Value", close],
    null,
    ["Initial Margin", 0],
    ["Maintenance Margin", 0],
    ["Excess/(Shortage)", close],
    null,
    ["MTD Cash Entries", 0],
    ["MTD Realized P/L", mtd],
    null,
    ["MTD TTL COMM/FEES", 0],
  ];
  for (const row of summary) {
    if (row) {
      const [label, v] = row;
      text(label, 14.2, y);
      const s = label === "FX Spot Rate USD" ? "1" : fmt(v);
      right(s, 235.4, y);
      right(s, 320.5, y);
    }
    y -= 11.35;
  }
  const prior = spec.nlvPrior ?? [openCash - 300, openCash - 200, openCash - 100, openCash];
  y -= 11.35;
  text("Last 5 NLV Values:(USD)", 172.9, y);
  text("CHG NLV", 377.4, y - 2.9);
  y -= 11.35;
  const nlv = [...prior, close];
  nlv.forEach((v, i) => {
    const off = nlv.length - 1 - i;
    right(off ? `T- ${off}` : "T", 243.1, y);
    right(fmt(v), 337.3, y);
    if (i > 0) right(fmt(cents(v - nlv[i - 1])), 408.6, y);
    if (!off) text("(today)", 413.9, y);
    y -= 11.35;
  });

  const fillRow = (p: FixtureProduct, f: FixtureFill, amount: number | null, title: string) => {
    text(dmy(f.date ?? spec.tradeDate), 14.2, y);
    right(String(f.qty), f.side === "buy" ? 93.5 : 121.9, y);
    if (spec.tamper?.splitProductText) {
      text(`${p.code} : ${p.contract}`, 136.1, y);
      text(`${p.exchange} ${p.description}`, 190, y);
    } else {
      text(`${p.code} : ${p.contract} ${p.exchange} ${p.description}`, 136.1, y);
    }
    right(f.price, 411.5, y);
    text("FUT-T-T", 419.5, y);
    text("USD", 492.3, y);
    if (amount !== null) right(fmt(amount, false), 575.8, y);
    next(title);
  };
  const totalRow = (
    p: (typeof products)[number],
    fills: FixtureFill[],
    title: string,
    withPnl: boolean,
  ) => {
    if (spec.tamper?.dropTotalFor === p.code) return;
    const long = fills.filter((f) => f.side === "buy").reduce((s, f) => s + f.qty, 0);
    const short = fills.filter((f) => f.side === "sell").reduce((s, f) => s + f.qty, 0);
    text("Total", 31.2, y);
    if (long) right(String(long), 93.5, y);
    if (short) right(String(short), 121.9, y);
    if (withPnl) {
      text("Realized P/L", 423.4, y);
      text("USD", 492.3, y);
      right(fmt(p.realized, false), 575.8, y);
    }
    next(title);
    y -= 11.35;
  };

  // Confirmations, then purchase & sale.
  newPage("FUTURE CONFIRMATIONS", true);
  for (const p of products) {
    const today = p.fills.filter((x) => (x.date ?? spec.tradeDate) === spec.tradeDate);
    for (const f of today) fillRow(p, f, null, "FUTURE CONFIRMATIONS");
    totalRow(p, today, "FUTURE CONFIRMATIONS", false);
  }
  if (spec.tamper?.extraLine) {
    text(spec.tamper.extraLine, 31.2, y);
    next("FUTURE CONFIRMATIONS");
  }
  text("NO RECAP OF CONFIRMATION ACTIVITY", 31.2, y);

  newPage("PURCHASE & SALE", true);
  for (const p of products) {
    for (const l of p.lines) fillRow(p, l, l.amount, "PURCHASE & SALE");
    totalRow(p, p.fills, "PURCHASE & SALE", true);
  }
  text("Total", 454.2, y);
  text("USD", 492.3, y);
  right(fmt(realized, false), 575.8, y);
  footer();
  footer = () => {};
  return doc.save();
}
