import { defineTool } from "eve/tools";

import { callEveWriteBridge } from "../../src/lib/eve/bridge-client";
import {
  mutationResultSchema,
  updateFormSettingsInputSchema,
} from "../../src/lib/eve/contracts";
import {
  requireEveryWriteApproval,
  requireEveTenantCaller,
} from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Propose changing one form's settings using the mandatory draft version returned by inspect_form. Every property must include its exact before and after value, and every call requires user approval.",
  inputSchema: updateFormSettingsInputSchema,
  outputSchema: mutationResultSchema,
  approval: (ctx) => requireEveryWriteApproval(ctx),
  async execute(input, ctx) {
    return callEveWriteBridge({
      caller: requireEveTenantCaller(ctx),
      callId: ctx.callId,
      input,
      operation: "update_form_settings",
      outputSchema: mutationResultSchema,
      signal: ctx.abortSignal,
    });
  },
});
