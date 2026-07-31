import { defineTool } from "eve/tools";

import { callEveWriteBridge } from "../../src/lib/eve/bridge-client";
import {
  createFormInputSchema,
  mutationResultSchema,
} from "../../src/lib/eve/contracts";
import {
  requireEveryWriteApproval,
  requireEveTenantCaller,
} from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Propose creating one public form whose named questions save answers to named table columns, with clear labels, required choices, order, appearance, and thank-you copy. Every call requires user approval.",
  inputSchema: createFormInputSchema,
  outputSchema: mutationResultSchema,
  approval: (ctx) => requireEveryWriteApproval(ctx),
  async execute(input, ctx) {
    return callEveWriteBridge({
      caller: requireEveTenantCaller(ctx),
      callId: ctx.callId,
      input,
      operation: "create_form",
      outputSchema: mutationResultSchema,
      signal: ctx.abortSignal,
    });
  },
});
