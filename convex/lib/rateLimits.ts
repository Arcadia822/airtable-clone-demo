import {
  HOUR,
  MINUTE,
  RateLimiter,
} from "@convex-dev/rate-limiter";

import { components } from "../_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  publicFormSubmission: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 10,
    shards: 4,
  },
  publicFormAnalytics: {
    kind: "fixed window",
    rate: 300,
    period: MINUTE,
    shards: 8,
  },
  publicUpload: {
    kind: "fixed window",
    rate: 50,
    period: HOUR,
    shards: 4,
  },
  publicUploadByForm: {
    kind: "token bucket",
    rate: 250,
    period: HOUR,
    capacity: 50,
    shards: 8,
  },
});
