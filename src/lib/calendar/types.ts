import type { DomainCode } from "@/lib/domains";

export type EventSource = "manual" | "preset" | "generated" | "headline" | "import";

/** A calendar event ready to be written (shape of the `sync_generated_events` payload). */
export type EventDraft = {
  starts_at: string; // UTC ISO
  native_tz: string;
  primary_domain: DomainCode;
  category: string;
  title: string;
  importance: 1 | 2 | 3;
  instruments: string[];
  notes: string | null;
  source: EventSource;
};

export type GeneratedEvent = EventDraft & { generator_key: string };

/** Calendar event as the UI reads it. */
export type CalendarEvent = {
  id: string;
  startsAt: string;
  nativeTz: string;
  primaryDomain: DomainCode;
  category: string;
  title: string;
  importance: 1 | 2 | 3;
  instruments: string[];
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  notes: string | null;
  source: EventSource;
  generated: boolean;
};

/** Computed, never stored: exchange session markers for a day. */
export type SessionMarker = {
  key: string;
  label: string;
  at: string; // UTC ISO
  tz: string;
};
