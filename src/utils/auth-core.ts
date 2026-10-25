import { createHash, timingSafeEqual } from "crypto";

export type AuthFailureReason = "missing" | "malformed" | "invalid";

export interface BearerAuthResult {
  authorized: boolean;
  reason?: AuthFailureReason;
  matched?: "primary" | "previous";
}

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

const constantTimeEqual = (left: string, right: string): boolean =>
  timingSafeEqual(digest(left), digest(right));

export const extractBearerToken = (
  authorizationHeader: string | undefined,
): { token?: string; reason?: AuthFailureReason } => {
  if (!authorizationHeader) return { reason: "missing" };

  const match = /^Bearer[\t ]+([^\s]+)$/i.exec(authorizationHeader.trim());
  if (!match) return { reason: "malformed" };

  return { token: match[1] };
};

export const verifyBearerAuthorization = (
  authorizationHeader: string | undefined,
  primaryToken: string,
  previousToken?: string,
): BearerAuthResult => {
  const parsed = extractBearerToken(authorizationHeader);
  if (!parsed.token) {
    return { authorized: false, reason: parsed.reason ?? "malformed" };
  }

  if (constantTimeEqual(parsed.token, primaryToken)) {
    return { authorized: true, matched: "primary" };
  }

  if (previousToken && constantTimeEqual(parsed.token, previousToken)) {
    return { authorized: true, matched: "previous" };
  }

  return { authorized: false, reason: "invalid" };
};
