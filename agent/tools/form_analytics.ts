import { defineTool } from "eve/tools";

import { callEveReadBridge } from "../../src/lib/eve/bridge-client";
import {
  formAnalyticsInputSchema,
  formAnalyticsOutputSchema,
} from "../../src/lib/eve/contracts";
import { requireEveTenantCaller } from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Read aggregate views, starts, submissions, completion rate, and a daily series for one form over at most 90 days. Referrer URLs, respondent identities, and response contents are not collected or returned.",
  inputSchema: formAnalyticsInputSchema,
  outputSchema: formAnalyticsOutputSchema,
  async execute(input, ctx) {
    return callEveReadBridge({
      caller: requireEveTenantCaller(ctx),
      input,
      operation: "form_analytics",
      outputSchema: formAnalyticsOutputSchema,
      signal: ctx.abortSignal,
    });
  },
});
