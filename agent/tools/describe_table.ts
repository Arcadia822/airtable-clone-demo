import { defineTool } from "eve/tools";

import { callEveReadBridge } from "../../src/lib/eve/bridge-client";
import {
  describeTableInputSchema,
  describeTableOutputSchema,
} from "../../src/lib/eve/contracts";
import { requireEveTenantCaller } from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Describe one table in the current organization, including its bounded field schema, field revisions, and record count. Use this before proposing field or record changes.",
  inputSchema: describeTableInputSchema,
  outputSchema: describeTableOutputSchema,
  async execute(input, ctx) {
    return callEveReadBridge({
      caller: requireEveTenantCaller(ctx),
      input,
      operation: "describe_table",
      outputSchema: describeTableOutputSchema,
      signal: ctx.abortSignal,
    });
  },
});
