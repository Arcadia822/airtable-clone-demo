import { defineHook } from "eve/hooks";

import { registerEveSessionOwnership } from "../../src/lib/eve/session-ownership";
import { requireEveTenantCaller } from "../../src/lib/eve/tenant";

export default defineHook({
  events: {
    "session.started": async (_event, ctx) => {
      const caller = requireEveTenantCaller(ctx);
      await registerEveSessionOwnership(caller, ctx.channel.continuationToken);
    },
  },
});
