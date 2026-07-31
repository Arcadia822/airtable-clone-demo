import { defineTool } from "eve/tools";

import { callEveWriteBridge } from "../../src/lib/eve/bridge-client";
import {
  deleteRecordInputSchema,
  mutationResultSchema,
} from "../../src/lib/eve/contracts";
import {
  requireEveryWriteApproval,
  requireEveTenantCaller,
} from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Propose deleting exactly one record using the mandatory version returned by list_records, its expected primary value, and a concise data-loss summary. Every call requires user approval.",
  inputSchema: deleteRecordInputSchema,
  outputSchema: mutationResultSchema,
  approval: (ctx) => requireEveryWriteApproval(ctx),
  async execute(input, ctx) {
    return callEveWriteBridge({
      caller: requireEveTenantCaller(ctx),
      callId: ctx.callId,
      input,
      operation: "delete_record",
      outputSchema: mutationResultSchema,
      signal: ctx.abortSignal,
    });
  },
});
