import { defineHook } from "eve/hooks";

import { requireEveTenantCaller } from "../../src/lib/eve/tenant";
import { consumeEveTurn } from "../../src/lib/eve/usage";

export default defineHook({
  events: {
    "turn.started": async (event, ctx) => {
      const caller = requireEveTenantCaller(ctx);
      if (caller.turnId !== event.data.turnId) {
        throw new Error("The EVE turn identity could not be verified.");
      }
      await consumeEveTurn(caller);
    },
  },
});
