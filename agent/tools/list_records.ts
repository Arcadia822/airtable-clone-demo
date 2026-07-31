import { defineTool } from "eve/tools";

import { callEveReadBridge } from "../../src/lib/eve/bridge-client";
import {
  listRecordsInputSchema,
  listRecordsOutputSchema,
} from "../../src/lib/eve/contracts";
import { requireEveTenantCaller } from "../../src/lib/eve/tenant";

export default defineTool({
  description:
    "Read at most 50 records from one table using a bounded field projection and opaque cursor. Search and dynamic sorting are currently unsupported. Each record includes the version required for update or delete proposals. Attachment fields return counts only, never attachment or storage identifiers, metadata, URLs, or contents.",
  inputSchema: listRecordsInputSchema,
  outputSchema: listRecordsOutputSchema,
  async execute(input, ctx) {
    return callEveReadBridge({
      caller: requireEveTenantCaller(ctx),
      input,
      operation: "list_records",
      outputSchema: listRecordsOutputSchema,
      signal: ctx.abortSignal,
    });
  },
});
