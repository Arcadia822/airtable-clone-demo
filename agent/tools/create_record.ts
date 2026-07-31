import { defineTool } from "eve/tools";

import { callEveWriteBridge } from "../../src/lib/eve/bridge-client";
import {
  createRecordInputSchema,
  mutationResultSchema,
} from "../../src/lib/eve/contracts";
import {
  requireEveryWriteApproval,
  requireEveTenantCaller,
} from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Propose creating exactly one record with an explicit list of mapped non-attachment field names, field IDs, and values. Attachment cells cannot be populated through this tool. Every call requires user approval.",
  inputSchema: createRecordInputSchema,
  outputSchema: mutationResultSchema,
  approval: (ctx) => requireEveryWriteApproval(ctx),
  async execute(input, ctx) {
    return callEveWriteBridge({
      caller: requireEveTenantCaller(ctx),
      callId: ctx.callId,
      input,
      operation: "create_record",
      outputSchema: mutationResultSchema,
      signal: ctx.abortSignal,
    });
  },
});
