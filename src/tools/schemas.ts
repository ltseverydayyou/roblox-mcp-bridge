import { z } from "zod";

export const threadContextSchema = z
  .number()
  .describe(
    "The thread identity to execute the code in (default: 8, normal game scripts run on 2)"
  )
  .optional()
  .default(8);

export const maxOutputCharsSchema = z
  .number()
  .describe(
    "Maximum characters to return to the model (default: 6000, max: 32000). Raise only when a single result genuinely needs more; large outputs degrade model performance."
  )
  .optional()
  .default(6000);

export const userConfirmedRiskSchema = z
  .literal(true)
  .describe(
    "Set true only after the user explicitly confirms this potentially detectable executor-introspection/hooking step. If the user already approved the same risky methods for the current workflow, that approval may be reused for follow-up calls in that workflow."
  );
