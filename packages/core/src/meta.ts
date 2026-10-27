import type { ReviewMeta } from "./types.ts";

/**
 * Server-side review metadata. `generatedBy` is passed in (not read from env)
 * so core stays runtime-neutral: each entry point decides where the model name
 * comes from.
 */
export function buildMeta({ generatedBy }: { generatedBy: string }): ReviewMeta {
  return {
    aiGenerated: true,
    generatedBy,
    generatedAt: new Date().toISOString(),
    promptVersion: "1",
  };
}
