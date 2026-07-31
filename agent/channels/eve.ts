import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { eveChannel } from "eve/channels/eve";
import {
  ForbiddenError,
  UnauthenticatedError,
  type AuthFn,
} from "eve/channels/auth";

import {
  assertEveContinuationOwnership,
  assertEveSessionOwnership,
  extractEveResetContinuationTokenHash,
  extractEveSessionId,
  isEveResetRequest,
} from "../../src/lib/eve/session-ownership";

let clerkClient: ClerkClient | undefined;

const clerkOrganizationAuth: AuthFn<Request> = async (request) => {
  const client = getClerkClient();
  const authorizedParties = getAuthorizedParties();
  const requestState = await client.authenticateRequest(request, {
    acceptsToken: "session_token",
    ...(authorizedParties.length > 0 ? { authorizedParties } : {}),
  });

  if (!requestState.isAuthenticated) {
    throw new UnauthenticatedError({
      code: "clerk_session_required",
      message: "Sign in to use the AI assistant.",
    });
  }

  const auth = requestState.toAuth();
  if (!auth.orgId) {
    throw new ForbiddenError({
      code: "active_organization_required",
      message: "Select an organization to use the AI assistant.",
    });
  }

  const feature = process.env.CLERK_AI_FEATURE?.trim() || "ai_assistant";
  if (!auth.has({ feature })) {
    throw new ForbiddenError({
      code: "ai_assistant_upgrade_required",
      message: "The AI assistant is available on the Pro organization plan.",
    });
  }

  if (isEveResetRequest(request)) {
    const continuationTokenHash =
      await extractEveResetContinuationTokenHash(request);
    if (!continuationTokenHash) {
      throw new ForbiddenError({
        code: "assistant_session_forbidden",
        message: "The assistant session could not be verified.",
      });
    }

    try {
      await assertEveContinuationOwnership({
        continuationTokenHash,
        organizationId: auth.orgId,
        userId: auth.userId,
      });
    } catch {
      throw new ForbiddenError({
        code: "assistant_session_forbidden",
        message: "This assistant session does not belong to the active user and organization.",
      });
    }
  } else {
    const existingSessionId = extractEveSessionId(request);
    if (existingSessionId) {
      try {
        await assertEveSessionOwnership({
          sessionId: existingSessionId,
          organizationId: auth.orgId,
          userId: auth.userId,
        });
      } catch {
        throw new ForbiddenError({
          code: "assistant_session_forbidden",
          message:
            "This assistant session does not belong to the active user and organization.",
        });
      }
    }
  }

  const issuer =
    typeof auth.sessionClaims.iss === "string" ? auth.sessionClaims.iss : undefined;
  return {
    authenticator: "clerk",
    principalId: auth.userId,
    principalType: "user",
    subject: auth.userId,
    ...(issuer ? { issuer } : {}),
    attributes: {
      organizationId: auth.orgId,
      aiAccess: "granted",
      ...(auth.orgRole ? { organizationRole: auth.orgRole } : {}),
    },
  };
};

export default eveChannel({
  auth: clerkOrganizationAuth,
  cors: {
    origin: getAllowedAppOrigins(),
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type"],
    exposedHeaders: [
      "x-eve-session-id",
      "x-eve-stream-format",
      "x-eve-stream-tail-index",
      "x-eve-stream-version",
    ],
    credentials: false,
    maxAge: 600,
  },
  uploadPolicy: "disabled",
});

function getClerkClient(): ClerkClient {
  if (clerkClient) {
    return clerkClient;
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) {
    throw new UnauthenticatedError({
      code: "clerk_not_configured",
      message: "Assistant authentication is not configured.",
    });
  }

  clerkClient = createClerkClient({
    secretKey,
    publishableKey,
  });
  return clerkClient;
}

function getAuthorizedParties(): string[] {
  const origins = getAllowedAppOrigins();
  if (origins.length > 0) {
    return origins;
  }

  throw new ForbiddenError({
    code: "authorized_parties_not_configured",
    message: "Assistant origin allowlisting is not configured.",
  });
}

function getAllowedAppOrigins(): string[] {
  const configured = [
    ...(process.env.EVE_ALLOWED_ORIGINS?.split(",") ?? []),
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  const origins = configured
    .flatMap((value) => (value ? [normalizeOrigin(value)] : []))
    .filter((value): value is string => value !== undefined);

  if (origins.length > 0) {
    return [...new Set(origins)];
  }

  if (process.env.NODE_ENV !== "production") {
    return ["http://localhost:3000", "http://127.0.0.1:3000"];
  }

  return [];
}

function normalizeOrigin(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return undefined;
  }
}
