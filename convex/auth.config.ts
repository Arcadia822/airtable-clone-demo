const clerkIssuer = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!clerkIssuer) {
  throw new Error(
    "CLERK_JWT_ISSUER_DOMAIN must be configured on every Convex deployment.",
  );
}

const authConfig = {
  providers: [
    {
      domain: clerkIssuer,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
