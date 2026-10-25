import { createHash } from "crypto";

export type RankingMode = "legacy" | "decay";

export interface DecayRankingProfile {
  mode: "decay";
  distanceScaleMeters: number;
  freshnessHalfLifeMinutes: number;
  distanceWeight: number;
  freshnessWeight: number;
}

export interface RankingProfile {
  mode: RankingMode;
  profileId: string;
  distanceScaleMeters: number;
  freshnessHalfLifeMinutes: number;
  distanceWeight: number;
  freshnessWeight: number;
}

export const buildRankingProfileId = (
  profile: Omit<RankingProfile, "profileId">,
): string =>
  createHash("sha256")
    .update(JSON.stringify(profile))
    .digest("hex")
    .slice(0, 16);

export const calculateLegacyScore = (
  distanceMeters: number,
  updatedAt: Date,
): number =>
  1 / (distanceMeters + 1) + updatedAt.getTime() / 1e10;

/**
 * Normalized product score in the range (0, 1].
 *
 * Distance decays exponentially with a configurable spatial scale. Freshness
 * decays by half every configured half-life. The two components are combined
 * by normalized weights so tuning a weight does not change the score range.
 */
export const calculateDecayScore = (
  distanceMeters: number,
  updatedAt: Date,
  referenceTime: Date,
  profile: DecayRankingProfile,
): number => {
  const safeDistance = Math.max(0, distanceMeters);
  const ageSeconds = Math.max(
    0,
    (referenceTime.getTime() - updatedAt.getTime()) / 1000,
  );
  const distanceScore = Math.exp(
    -safeDistance / profile.distanceScaleMeters,
  );
  const freshnessScore = Math.exp(
    -Math.LN2 * ageSeconds / (profile.freshnessHalfLifeMinutes * 60),
  );
  const totalWeight = profile.distanceWeight + profile.freshnessWeight;

  if (totalWeight <= 0) {
    throw new Error("At least one ranking weight must be greater than zero");
  }

  return (
    (profile.distanceWeight * distanceScore +
      profile.freshnessWeight * freshnessScore) /
    totalWeight
  );
};
