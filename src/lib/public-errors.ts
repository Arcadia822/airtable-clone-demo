const ERROR_CODE_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "Your session has expired. Sign in again and retry.",
  FORBIDDEN: "You do not have permission to make this change.",
  QUOTA_EXCEEDED:
    "This workspace has reached its current plan limit. Review your plan to continue.",
  FORM_UPDATED:
    "This form changed while you were editing it. Refresh to see the latest version.",
  FORM_CLOSED: "This form is no longer accepting responses.",
  RATE_LIMITED: "Too many requests were sent at once. Wait a moment and retry.",
  REVISION_CONFLICT:
    "Someone else updated this item. Refresh to see their changes, then try again.",
  VALIDATION_ERROR: "Check the highlighted information and try again.",
  BILLING_UNAVAILABLE:
    "Plan information is temporarily unavailable. Try again shortly.",
  FIELD_CONVERSION_PREVIEW_STALE:
    "The column changed while you were reviewing it. Open the preview again before applying this change.",
  INVALID_FIELD_CONVERSION_PREVIEW:
    "Open the column preview again before applying this change.",
  FIELD_CONVERSION_BLOCKED:
    "This column cannot be changed yet. Review the guidance in the preview.",
  FIELD_CONVERSION_REQUIRES_ACKNOWLEDGEMENT:
    "Confirm that you understand which saved values will change or be cleared.",
  FIELD_CONVERSION_REQUIRES_EXACT_ACKNOWLEDGEMENT:
    "Review the final row counts and confirm the values that will change or be cleared.",
  FIELD_NAME_ALREADY_USED:
    "A column with this name already exists. Choose a different name.",
  INVALID_FIELD_NAME:
    "Enter a column name between 1 and 120 characters.",
  VIEW_RESULTS_UPDATING:
    "This saved view is updating. It will be ready in a moment.",
}

const ERROR_TEXT_MESSAGES: Array<[RegExp, string]> = [
  [
    /unauthenticated|not authenticated|session (?:has )?expired|sign(?:ed)? out/i,
    ERROR_CODE_MESSAGES.UNAUTHENTICATED,
  ],
  [
    /forbidden|permission|not (?:an )?(?:organization )?admin|access denied/i,
    ERROR_CODE_MESSAGES.FORBIDDEN,
  ],
  [
    /quota|plan limit|limit (?:has been )?(?:reached|exceeded)|too many records/i,
    ERROR_CODE_MESSAGES.QUOTA_EXCEEDED,
  ],
  [
    /revision|conflict|changed in another|stale/i,
    ERROR_CODE_MESSAGES.REVISION_CONFLICT,
  ],
  [
    /rate.?limit|too many requests/i,
    ERROR_CODE_MESSAGES.RATE_LIMITED,
  ],
  [
    /network|failed to fetch|fetch failed|connection|offline/i,
    "We could not reach the service. Check your connection and try again.",
  ],
]

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  if ("code" in error && typeof error.code === "string") return error.code
  if (
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "code" in error.data &&
    typeof error.data.code === "string"
  ) {
    return error.data.code
  }
  return undefined
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return typeof error === "string" ? error : ""
}

/**
 * Converts internal service and database errors into copy that is safe to show
 * to customers. Raw exception messages may contain function names, IDs, or
 * configuration keys, so they must never be rendered directly.
 */
export function publicErrorMessage(
  error: unknown,
  fallback = "We could not complete that action. Your other changes are safe—please try again.",
) {
  const code = errorCode(error)
  if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code]

  const text = errorText(error)
  for (const [pattern, message] of ERROR_TEXT_MESSAGES) {
    if (pattern.test(text)) return message
  }

  return fallback
}
