export const ORGANIZATION_AUTH_REFRESH_EVENT =
  "basecraft:organization-auth-refresh"

export function requestOrganizationAuthRefresh() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(ORGANIZATION_AUTH_REFRESH_EVENT))
}
