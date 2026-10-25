import { createHash, createHmac, timingSafeEqual } from "crypto";
import { isStoredUserId } from "./user-id";

export interface NearbyCursorV1 {
  version: 1;
  score: number;
  userId: string;
  queryHash: string;
}

export interface NearbyCursorV2 {
  version: 2;
  score: number;
  userId: string;
  queryHash: string;
  rankedAtMs: number;
  rankingProfileId: string;
}

/**
 * v3 is the current cursor payload. In addition to the stable sort tuple it
 * carries the first-page total count, so subsequent keyset pages do not need
 * to recount the full candidate set. Decay ranking also pins its snapshot.
 */
export interface NearbyCursorV3 {
  version: 3;
  score: number;
  userId: string;
  queryHash: string;
  totalCount: number;
  issuedAtMs: number;
  rankedAtMs?: number;
  rankingProfileId?: string;
}

export type NearbyCursor = NearbyCursorV1 | NearbyCursorV2 | NearbyCursorV3;

export interface NearbyQueryContext {
  lat: number;
  lng: number;
  maxDistance: number;
  excludeUserId?: string;
}

export interface CursorRankingContext {
  rankedAtMs: number;
  rankingProfileId: string;
}

export interface CursorSecurityOptions {
  /** Primary HMAC-SHA256 secret used for newly-issued cursors. */
  signingSecret?: string;
  /** Previous secret accepted during zero-downtime key rotation. */
  previousSigningSecret?: string;
  /** Reject old unsigned cursors when true. */
  requireSignature?: boolean;
}

export interface CursorEncodeOptions {
  rankingContext?: CursorRankingContext;
  totalCount?: number;
  /** Preserve the original v3 session issuance time across pages. */
  issuedAtMs?: number;
  security?: CursorSecurityOptions;
}

/**
 * Upper bound for every cursor the service can emit, so a continuation is
 * never rejected by its own length check. Worst case is a signed v3 decay
 * cursor for a 255-unit stored identifier of control characters: JSON writes
 * U+0001 as "\u0001", six bytes per UTF-16 unit and more than any other
 * accepted unit. With a 25-character score, three 16-digit safe integers, the
 * query/profile hashes, base64url, the "s1." prefix and a 43-character HMAC
 * this is 2,389 characters. tests/cursor.test.js derives and asserts it.
 */
export const MAX_CURSOR_LENGTH = 2400;
const queryHashPattern = /^[a-f0-9]{24}$/;
const rankingProfilePattern = /^[a-f0-9]{16}$/;
const SIGNED_CURSOR_PREFIX = "s1";

export const isSignedNearbyCursor = (cursor: string): boolean =>
  cursor.startsWith(`${SIGNED_CURSOR_PREFIX}.`);

export type NearbyCursorAgeStatus = "valid" | "expired" | "future";

export const getNearbyCursorAgeStatus = (
  timestampMs: number,
  maxAgeMinutes: number,
  nowMs = Date.now(),
  clockSkewAllowanceMs = 5 * 60_000,
): NearbyCursorAgeStatus => {
  if (timestampMs > nowMs + clockSkewAllowanceMs) return "future";
  if (nowMs - timestampMs > maxAgeMinutes * 60_000) return "expired";
  return "valid";
};

/**
 * Supplying rankingProfileId opts into the ranking-aware query hash. Omitting
 * it preserves the exact v2.1 legacy hash so already-issued legacy cursors
 * remain valid while unsigned compatibility is enabled.
 */
export const buildNearbyQueryHash = (
  context: NearbyQueryContext,
  rankingProfileId?: string,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        rankingProfileId
          ? {
              lat: context.lat,
              lng: context.lng,
              maxDistance: context.maxDistance,
              excludeUserId: context.excludeUserId ?? null,
              rankingProfileId,
            }
          : {
              lat: context.lat,
              lng: context.lng,
              maxDistance: context.maxDistance,
              excludeUserId: context.excludeUserId ?? null,
            },
      ),
    )
    .digest("hex")
    .slice(0, 24);

const isValidRankingContext = (context: CursorRankingContext): boolean =>
  Number.isSafeInteger(context.rankedAtMs) &&
  context.rankedAtMs > 0 &&
  rankingProfilePattern.test(context.rankingProfileId);

const isValidTotalCount = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const signPayload = (payload: string, secret: string): string =>
  createHmac("sha256", secret).update(payload).digest("base64url");

const secureEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};

const encodePayload = (payload: NearbyCursor): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

const wrapSignedPayload = (
  encodedPayload: string,
  security?: CursorSecurityOptions,
): string => {
  const secret = security?.signingSecret;
  if (!secret) {
    if (security?.requireSignature) {
      throw new Error("Cursor signing is required but no signing secret is configured");
    }
    return encodedPayload;
  }

  const signature = signPayload(encodedPayload, secret);
  return `${SIGNED_CURSOR_PREFIX}.${encodedPayload}.${signature}`;
};

/**
 * Encode an opaque nearby cursor. New callers should supply totalCount, which
 * emits v3. Without it, v1/v2 is retained for compatibility with older tests
 * and integrations.
 */
export const encodeNearbyCursor = (
  score: number,
  userId: string,
  queryHash: string,
  options?: CursorEncodeOptions | CursorRankingContext,
): string => {
  if (!Number.isFinite(score) || !isStoredUserId(userId) || !queryHashPattern.test(queryHash)) {
    throw new Error("Cannot encode invalid nearby cursor state");
  }

  // Backward-compatible argument normalization: v2.2 callers passed the
  // ranking context directly as the fourth argument.
  const normalizedOptions: CursorEncodeOptions =
    options && "rankedAtMs" in options
      ? { rankingContext: options as CursorRankingContext }
      : (options as CursorEncodeOptions | undefined) ?? {};

  const { rankingContext, totalCount, security } = normalizedOptions;
  let payload: NearbyCursor;

  if (totalCount !== undefined) {
    if (!isValidTotalCount(totalCount)) {
      throw new Error("Cannot encode invalid total count");
    }
    if (rankingContext && !isValidRankingContext(rankingContext)) {
      throw new Error("Cannot encode invalid ranking cursor state");
    }

    const issuedAtMs = normalizedOptions.issuedAtMs ?? Date.now();
    if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
      throw new Error("Cannot encode invalid cursor issuance time");
    }

    payload = {
      version: 3,
      score,
      userId,
      queryHash,
      totalCount,
      issuedAtMs: Math.trunc(issuedAtMs),
      ...(rankingContext
        ? {
            rankedAtMs: Math.trunc(rankingContext.rankedAtMs),
            rankingProfileId: rankingContext.rankingProfileId,
          }
        : {}),
    };
  } else if (rankingContext) {
    if (!isValidRankingContext(rankingContext)) {
      throw new Error("Cannot encode invalid ranking cursor state");
    }
    payload = {
      version: 2,
      score,
      userId,
      queryHash,
      rankedAtMs: Math.trunc(rankingContext.rankedAtMs),
      rankingProfileId: rankingContext.rankingProfileId,
    };
  } else {
    payload = { version: 1, score, userId, queryHash };
  }

  return wrapSignedPayload(encodePayload(payload), security);
};

const unwrapCursor = (
  cursor: string,
  security?: CursorSecurityOptions,
): string => {
  if (isSignedNearbyCursor(cursor)) {
    const parts = cursor.split(".");
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
      throw new Error("Invalid cursor");
    }

    const [, encodedPayload, signature] = parts;
    const secrets = [
      security?.signingSecret,
      security?.previousSigningSecret,
    ].filter((value): value is string => Boolean(value));

    if (secrets.length === 0) {
      throw new Error("Invalid cursor");
    }

    const verified = secrets.some((secret) =>
      secureEqual(signPayload(encodedPayload, secret), signature),
    );
    if (!verified) throw new Error("Invalid cursor");
    return encodedPayload;
  }

  if (security?.requireSignature) {
    throw new Error("Invalid cursor");
  }

  return cursor;
};

const parsePayload = (encodedPayload: string): NearbyCursor => {
  const decoded = Buffer.from(encodedPayload, "base64url").toString("utf8");
  const value = JSON.parse(decoded) as {
    version?: unknown;
    score?: unknown;
    userId?: unknown;
    queryHash?: unknown;
    rankedAtMs?: unknown;
    rankingProfileId?: unknown;
    totalCount?: unknown;
    issuedAtMs?: unknown;
  };

  if (
    (value.version !== 1 && value.version !== 2 && value.version !== 3) ||
    typeof value.score !== "number" ||
    !Number.isFinite(value.score) ||
    !isStoredUserId(value.userId) ||
    typeof value.queryHash !== "string" ||
    !queryHashPattern.test(value.queryHash)
  ) {
    throw new Error("Invalid cursor payload");
  }

  if (value.version === 2) {
    if (
      typeof value.rankedAtMs !== "number" ||
      !Number.isSafeInteger(value.rankedAtMs) ||
      value.rankedAtMs <= 0 ||
      typeof value.rankingProfileId !== "string" ||
      !rankingProfilePattern.test(value.rankingProfileId)
    ) {
      throw new Error("Invalid ranking cursor payload");
    }

    return {
      version: 2,
      score: value.score,
      userId: value.userId,
      queryHash: value.queryHash,
      rankedAtMs: Math.trunc(value.rankedAtMs),
      rankingProfileId: value.rankingProfileId,
    };
  }

  if (value.version === 3) {
    if (typeof value.totalCount !== "number" || !isValidTotalCount(value.totalCount)) {
      throw new Error("Invalid total count cursor payload");
    }
    if (
      typeof value.issuedAtMs !== "number" ||
      !Number.isSafeInteger(value.issuedAtMs) ||
      value.issuedAtMs <= 0
    ) {
      throw new Error("Invalid cursor issuance time");
    }

    const hasRankedAt = value.rankedAtMs !== undefined;
    const hasProfile = value.rankingProfileId !== undefined;
    if (hasRankedAt !== hasProfile) {
      throw new Error("Invalid ranking cursor payload");
    }

    if (
      hasRankedAt &&
      (typeof value.rankedAtMs !== "number" ||
        !Number.isSafeInteger(value.rankedAtMs) ||
        value.rankedAtMs <= 0 ||
        typeof value.rankingProfileId !== "string" ||
        !rankingProfilePattern.test(value.rankingProfileId))
    ) {
      throw new Error("Invalid ranking cursor payload");
    }

    return {
      version: 3,
      score: value.score,
      userId: value.userId,
      queryHash: value.queryHash,
      totalCount: value.totalCount,
      issuedAtMs: Math.trunc(value.issuedAtMs),
      ...(hasRankedAt
        ? {
            rankedAtMs: Math.trunc(value.rankedAtMs as number),
            rankingProfileId: value.rankingProfileId as string,
          }
        : {}),
    };
  }

  return {
    version: 1,
    score: value.score,
    userId: value.userId,
    queryHash: value.queryHash,
  };
};

export const decodeNearbyCursor = (
  cursor: string,
  security?: CursorSecurityOptions,
): NearbyCursor => {
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH) {
    throw new Error("Invalid cursor");
  }

  try {
    const signed = isSignedNearbyCursor(cursor);
    const payload = parsePayload(unwrapCursor(cursor, security));

    // Once signing is configured, v3 only exists in signed form. This keeps
    // rolling-upgrade support for old unsigned v1/v2 tokens without allowing
    // a client to forge trusted v3 metadata such as totalCount or issuedAtMs.
    if (!signed && security?.signingSecret && payload.version === 3) {
      throw new Error("Invalid cursor");
    }

    return payload;
  } catch {
    throw new Error("Invalid cursor");
  }
};
