/** The five Axia Futures edge domains — the backbone of the data model. */
export const DOMAINS = [
  {
    code: "TECHNICAL",
    label: "Technical Analysis",
    short: "Technical",
    className: "text-domain-technical",
    bgClassName: "bg-domain-technical",
  },
  {
    code: "DATA",
    label: "Scheduled Data",
    short: "Data",
    className: "text-domain-data",
    bgClassName: "bg-domain-data",
  },
  {
    code: "NEWS",
    label: "Unscheduled News & Narrative",
    short: "News",
    className: "text-domain-news",
    bgClassName: "bg-domain-news",
  },
  {
    code: "CENTRAL_BANKS",
    label: "Central Banks",
    short: "Central Banks",
    className: "text-domain-central-banks",
    bgClassName: "bg-domain-central-banks",
  },
  {
    code: "FLOW",
    label: "Flow",
    short: "Flow",
    className: "text-domain-flow",
    bgClassName: "bg-domain-flow",
  },
] as const;

export type DomainCode = (typeof DOMAINS)[number]["code"];

export const DOMAIN_CODES = DOMAINS.map((d) => d.code) as [DomainCode, ...DomainCode[]];

export function domainMeta(code: DomainCode) {
  const meta = DOMAINS.find((d) => d.code === code);
  if (!meta) throw new Error(`Unknown domain ${code}`);
  return meta;
}

/** Short label of a domain code; unknown codes pass through unchanged. */
export function domainLabel(code: string): string {
  return DOMAINS.find((d) => d.code === code)?.short ?? code;
}
