export const TURNSTILE_ALWAYS_PASS_TEST_SECRET =
  "1x0000000000000000000000000000000AA";

export type TurnstileValidationResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export function isAcceptedTurnstileResponse({
  expectedAction,
  expectedHostname,
  response,
  secret,
}: {
  expectedAction: string;
  expectedHostname?: string;
  response: TurnstileValidationResponse;
  secret: string;
}) {
  if (response.success !== true) return false;

  if (secret === TURNSTILE_ALWAYS_PASS_TEST_SECRET) return true;

  return (
    response.action === expectedAction &&
    (!expectedHostname || response.hostname === expectedHostname)
  );
}
