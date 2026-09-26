/**
 * Structured output of an analysis (spec 6.9): findings Claude returns and the
 * app validates before storing. The same rules are sent to the routine as a
 * JSON schema so the model knows the contract.
 */
import { z } from "zod";

import { DOMAIN_CODES } from "@/lib/domains";

export const CONFIDENCE = ["low", "medium", "high"] as const;
export const FINDING_TYPES = ["strength", "leak", "process", "plan", "risk"] as const;

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "must be a trade/playbook id from the payload",
  );

export const findingSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    type: z.enum(FINDING_TYPES),
    observation: z.string().trim().min(10).max(1200),
    evidence_trade_ids: z.array(uuid).max(20),
    sample_size: z.number().int().min(0).max(100000),
    confidence: z.enum(CONFIDENCE),
    suggested_experiment: z.string().trim().min(10).max(600),
    related_playbook_id: uuid.nullable().default(null),
    domain: z.enum(DOMAIN_CODES).nullable().default(null),
  })
  .refine((f) => f.sample_size >= 20 || f.confidence === "low", {
    message: 'sample_size below 20 must have confidence "low"',
    path: ["confidence"],
  });

export const outputSchema = z.object({
  summary: z.string().trim().min(10).max(800),
  findings: z.array(findingSchema).min(1).max(8),
});

export type Finding = z.infer<typeof findingSchema>;
export type AnalysisOutput = z.infer<typeof outputSchema>;

/** Human-readable validation errors for the routine to correct and retry. */
export function validationErrors(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** JSON schema of the output, shipped inside every payload. */
export const OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string", minLength: 10, maxLength: 800 },
    findings: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "type",
          "observation",
          "evidence_trade_ids",
          "sample_size",
          "confidence",
          "suggested_experiment",
          "related_playbook_id",
          "domain",
        ],
        properties: {
          title: { type: "string", minLength: 3, maxLength: 120 },
          type: { enum: [...FINDING_TYPES] },
          observation: { type: "string", minLength: 10, maxLength: 1200 },
          evidence_trade_ids: {
            type: "array",
            maxItems: 20,
            items: { type: "string", description: "id from payload.trades" },
          },
          sample_size: { type: "integer", minimum: 0 },
          confidence: { enum: [...CONFIDENCE], description: "must be low when sample_size < 20" },
          suggested_experiment: { type: "string", minLength: 10, maxLength: 600 },
          related_playbook_id: {
            type: ["string", "null"],
            description: "id from payload.playbooks, or null",
          },
          domain: { enum: [...DOMAIN_CODES, null] },
        },
      },
    },
  },
} as const;
