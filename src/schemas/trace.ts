import { z } from "zod";

export const AnalysisStatusSchema = z.enum([
  "pending",
  "analyzed",
  "skipped",
  "error",
]);

export const AnalysisSchema = z.object({
  status: AnalysisStatusSchema,
  analyzedAt: z.string().nullish(),
  notes: z.string().nullish(),
});

export const FeedbackSentimentSchema = z.enum(["positive", "negative"]);
export const FeedbackSourceSchema = z.enum(["user", "sme", "other"]);

export const FeedbackSchema = z.object({
  sentiment: FeedbackSentimentSchema,
  source: FeedbackSourceSchema,
  comment: z.string(),
});

export const TraceSchema = z.object({
  id: z.string(),
  input: z.string(),
  output: z.string(),
  feedback: z.array(FeedbackSchema).default([]),
  originalTrace: z.unknown(),
  failureModeIds: z.array(z.string()).default([]),
  analysis: AnalysisSchema,
});

export type Trace = z.infer<typeof TraceSchema>;
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;
export type FeedbackSentiment = z.infer<typeof FeedbackSentimentSchema>;
export type FeedbackSource = z.infer<typeof FeedbackSourceSchema>;
