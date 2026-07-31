import { defineTool } from "eve/tools";

import { callEveReadBridge } from "../../src/lib/eve/bridge-client";
import {
  inspectFormInputSchema,
  inspectFormOutputSchema,
} from "../../src/lib/eve/contracts";
import { requireEveTenantCaller } from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Inspect one form’s current settings and which named table column receives each answer. Use this before proposing form edits.",
  inputSchema: inspectFormInputSchema,
  outputSchema: inspectFormOutputSchema,
  async execute(input, ctx) {
    return callEveReadBridge({
      caller: requireEveTenantCaller(ctx),
      input,
      operation: "inspect_form",
      outputSchema: inspectFormOutputSchema,
      signal: ctx.abortSignal,
    });
  },
});
