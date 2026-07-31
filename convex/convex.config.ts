import aggregate from "@convex-dev/aggregate/convex.config.js";
import migrations from "@convex-dev/migrations/convex.config.js";
import presence from "@convex-dev/presence/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";

const app = defineApp();

app.use(aggregate, { name: "baseCount" });
app.use(aggregate, { name: "tableCount" });
app.use(aggregate, { name: "fieldCount" });
app.use(aggregate, { name: "recordCount" });
app.use(aggregate, { name: "tableRecordCount" });
app.use(aggregate, { name: "formCount" });
app.use(aggregate, { name: "submissionCount" });
app.use(aggregate, { name: "attachmentBytes" });
app.use(aggregate, { name: "aiTurnCount" });
app.use(migrations);
app.use(presence);
app.use(rateLimiter);

export default app;
