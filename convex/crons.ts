import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "remove expired staged uploads",
  { minuteUTC: 17 },
  internal.attachments.cleanupExpired,
  {},
);

crons.hourly(
  "sweep orphaned file storage",
  { minuteUTC: 27 },
  internal.attachments.cleanupOrphanedStorage,
  {},
);

crons.hourly(
  "expire abandoned public submissions",
  { minuteUTC: 37 },
  internal.forms.cleanupExpiredSubmissionSessions,
  {},
);

crons.daily(
  "remove expired form analytics dedupe keys",
  { hourUTC: 3, minuteUTC: 27 },
  internal.analytics.cleanupDedupe,
  {},
);

crons.hourly(
  "remove expired EVE request nonces",
  { minuteUTC: 47 },
  internal.aiSessions.cleanupRequestNonces,
  {},
);

export default crons;
