export type EveBearerAuthState = {
  isAuthenticated: boolean;
  getToken: () => Promise<string | null>;
};

export async function resolveEveBearerToken(
  authState: EveBearerAuthState,
): Promise<string> {
  if (!authState.isAuthenticated) {
    throw new Error("Workspace authentication is not ready.");
  }

  const token = await authState.getToken();
  if (!token) {
    throw new Error("Workspace authentication expired. Refresh and try again.");
  }

  return token;
}
