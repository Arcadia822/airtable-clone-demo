import { defineTool } from "eve/tools";

import { callEveWriteBridge } from "../../src/lib/eve/bridge-client";
import {
  deleteFieldInputSchema,
  mutationResultSchema,
} from "../../src/lib/eve/contracts";
import {
  requireEveryWriteApproval,
  requireEveTenantCaller,
} from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Propose deleting exactly one field using the mandatory revision returned by describe_table, after matching its expected name and type and describing the data loss. Every call requires user approval.",
  inputSchema: deleteFieldInputSchema,
  outputSchema: mutationResultSchema,
  approval: (ctx) => requireEveryWriteApproval(ctx),
  async execute(input, ctx) {
    return callEveWriteBridge({
      caller: requireEveTenantCaller(ctx),
      callId: ctx.callId,
      input,
      operation: "delete_field",
      outputSchema: mutationResultSchema,
      signal: ctx.abortSignal,
    });
  },
});
