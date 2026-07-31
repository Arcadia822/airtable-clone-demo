import { defineTool } from "eve/tools";

import { callEveReadBridge } from "../../src/lib/eve/bridge-client";
import {
  summarizeTableInputSchema,
  summarizeTableOutputSchema,
} from "../../src/lib/eve/contracts";
import { requireEveTenantCaller } from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Compute bounded server-side summaries for up to 10 fields, optionally grouped by one field. Prefer this over loading many records for counts, completeness, ranges, averages, and top values.",
  inputSchema: summarizeTableInputSchema,
  outputSchema: summarizeTableOutputSchema,
  async execute(input, ctx) {
    return callEveReadBridge({
      caller: requireEveTenantCaller(ctx),
      input,
      operation: "summarize_table",
      outputSchema: summarizeTableOutputSchema,
      signal: ctx.abortSignal,
    });
  },
});
