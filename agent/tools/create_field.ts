import { defineTool } from "eve/tools";

import { callEveWriteBridge } from "../../src/lib/eve/bridge-client";
import {
  createFieldInputSchema,
  mutationResultSchema,
} from "../../src/lib/eve/contracts";
import {
  requireEveryWriteApproval,
  requireEveTenantCaller,
} from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Propose adding exactly one field using a schema-supported type and complete configuration. Use type date with dateStyle and includeTime for timestamps; derived createdTime and createdBy fields are read-only. Every call requires user approval.",
  inputSchema: createFieldInputSchema,
  outputSchema: mutationResultSchema,
  approval: (ctx) => requireEveryWriteApproval(ctx),
  async execute(input, ctx) {
    return callEveWriteBridge({
      caller: requireEveTenantCaller(ctx),
      callId: ctx.callId,
      input,
      operation: "create_field",
      outputSchema: mutationResultSchema,
      signal: ctx.abortSignal,
    });
  },
});
