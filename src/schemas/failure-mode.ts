import { z } from "zod";

const LIFECYCLE_STATES = [
  "discovered",
  "triaged",
  "investigating",
  "spec_drafted",
  "fix_approved",
  "fix_in_progress",
  "verifying",
  "verified",
  "regressed",
  "hardening",
  "hardened",
  "wont_fix",
  "closed",
] as const;

export const FailureModeStatusSchema = z.union([
  z.enum(LIFECYCLE_STATES),
  z.string().regex(/^duplicate_of:fm_.+$/, {
    message: "duplicate_of status must take the form 'duplicate_of:fm_<id>'",
  }),
]);

export const AffectedTraceSchema = z.object({
  filename: z.string(),
  traceId: z.string(),
});

export const FailureModeSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),

  status: FailureModeStatusSchema,
  severity: z.string().nullish(),
  tags: z.array(z.string()).default([]),

  discoveredAt: z.string().nullish(),
  lastUpdated: z.string().nullish(),

  affectedTraces: z.array(AffectedTraceSchema).default([]),
});

export const FailureModesFileSchema = z.object({
  failureModes: z.array(FailureModeSchema).default([]),
});

export type AffectedTrace = z.infer<typeof AffectedTraceSchema>;
export type FailureMode = z.infer<typeof FailureModeSchema>;
export type FailureModesFile = z.infer<typeof FailureModesFileSchema>;
export type FailureModeStatus = z.infer<typeof FailureModeStatusSchema>;
