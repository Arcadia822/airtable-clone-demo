import { defineTool } from "eve/tools";

import { callEveWriteBridge } from "../../src/lib/eve/bridge-client";
import {
  mutationResultSchema,
  updateRecordInputSchema,
} from "../../src/lib/eve/contracts";
import {
  requireEveryWriteApproval,
  requireEveTenantCaller,
} from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Propose updating exactly one record using the mandatory version returned by list_records. Every changed non-attachment field must include its exact before and after value. Attachment fields cannot be changed through this tool. Every call requires user approval.",
  inputSchema: updateRecordInputSchema,
  outputSchema: mutationResultSchema,
  approval: (ctx) => requireEveryWriteApproval(ctx),
  async execute(input, ctx) {
    return callEveWriteBridge({
      caller: requireEveTenantCaller(ctx),
      callId: ctx.callId,
      input,
      operation: "update_record",
      outputSchema: mutationResultSchema,
      signal: ctx.abortSignal,
    });
  },
});
