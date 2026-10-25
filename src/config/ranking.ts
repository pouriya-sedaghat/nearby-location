import { config } from "./env";
import {
  buildRankingProfileId,
  RankingProfile,
} from "../utils/ranking";

const profileWithoutId: Omit<RankingProfile, "profileId"> = {
  mode: config.RANKING_MODE,
  distanceScaleMeters: config.RANKING_DISTANCE_SCALE_METERS,
  freshnessHalfLifeMinutes: config.RANKING_FRESHNESS_HALF_LIFE_MINUTES,
  distanceWeight: config.RANKING_DISTANCE_WEIGHT,
  freshnessWeight: config.RANKING_FRESHNESS_WEIGHT,
};

export const rankingProfile: RankingProfile = {
  ...profileWithoutId,
  profileId: buildRankingProfileId(profileWithoutId),
};
