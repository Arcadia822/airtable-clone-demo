import { defineTool } from "eve/tools";

import { callEveReadBridge } from "../../src/lib/eve/bridge-client";
import {
  describeTableInputSchema,
  describeTableOutputSchema,
} from "../../src/lib/eve/contracts";
import { requireEveTenantCaller } from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Describe one table in the current organization, including its bounded field schema, field revisions, and record count. Use this before proposing field or record changes. Copy baseId and tableId exactly from activeScope or a prior tool result; never use this tool for form-performance questions.",
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
