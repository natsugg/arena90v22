import type { Timestamp, FieldValue } from 'firebase/firestore';
import { i18n } from '../lib/i18n';

/**
 * უნივერსალური დროის ნიშნულის ტიპი Firestore-ისთვის.
 */
export type FirestoreTimestamp = Timestamp | FieldValue | string | number;

/**
 * პლატფორმის მომხმარებლის როლები.
 */
export type UserRole =
  | 'viewer'
  | 'vip'
  | 'moderator'
  | 'expert'
  | 'streamer'
  | 'admin';

/**
 * ხმის წონის საბაზისო კოეფიციენტები როლების მიხედვით.
 */
export const DEFAULT_ROLE_VOTE_WEIGHTS: Record<UserRole, number> = {
  viewer: 1.0,
  vip: 2.0,
  moderator: 2.5,
  expert: 5.0,
  streamer: 5.0,
  admin: 5.0,
};

export const TRACK_PUBLISHER_ROLES: UserRole[] = [
  'admin',
  'streamer',
  'expert',
  'moderator',
];

export function canUserPublishTrack(role?: UserRole | null): boolean {
  return Boolean(role && TRACK_PUBLISHER_ROLES.includes(role));
}

/**
 * გამოითვლის მომხმარებლის დონეს (Level 1–5) დაგროვილი XP-ის მიხედვით:
 * - 0–299 XP -> დონე 1 ("ახალბედა")
 * - 300–799 XP -> დონე 2 ("მსმენელი")
 * - 800–1799 XP -> დონე 3 ("მელომანი")
 * - 1800–3499 XP -> დონე 4 ("კრიტიკოსი")
 * - 3500+ XP -> დონე 5 ("ექსპერტი")
 */
export function calculateUserLevel(xp: number): number {
  const safeXp =
    typeof xp === 'number' && !Number.isNaN(xp) ? Math.max(0, xp) : 0;
  if (safeXp >= 3500) return 5;
  if (safeXp >= 1800) return 4;
  if (safeXp >= 800) return 3;
  if (safeXp >= 300) return 2;
  return 1;
}

export function getUserLevelLabel(level: number): string {
  if (level >= 5) return i18n.levels[5];
  if (level === 4) return i18n.levels[4];
  if (level === 3) return i18n.levels[3];
  if (level === 2) return i18n.levels[2];
  return i18n.levels[1];
}

/**
 * მომხმარებლის პროფილი (`/users/{userId}`).
 */
export interface User {
  uid: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  xp: number;
  level?: number;
  voteWeight: number;
  reviewsCount?: number;
  helpfulVotesReceived?: number;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

/**
 * ტოპ კრიტიკოსის ელემენტი ლიდერბორდისთვის ("ტოპ კრიტიკოსები").
 */
export interface TopCritic {
  uid: string;
  displayName: string;
  role: UserRole;
  voteWeight: number;
  xp: number;
  reviewsCount: number;
  helpfulVotesReceived: number;
}

/**
 * შეფასების 5 კრიტერიუმის გასაღები.
 */
export type CriteriaKey =
  | 'lyrics'
  | 'flow'
  | 'production'
  | 'identity'
  | 'vibe';

export const CRITERIA_KEYS: CriteriaKey[] = [
  'lyrics',
  'flow',
  'production',
  'identity',
  'vibe',
];

/**
 * ტრეკის შეფასების 5 პარამეტრი (1.0-დან 10.0-მდე, ბიჯი 0.1).
 */
export interface CriteriaScores {
  lyrics: number;
  flow: number;
  production: number;
  identity: number;
  vibe: number;
}

/**
 * კრიტერიუმების მეტამონაცემები ქართულ ენაზე.
 */
export const CRITERIA_METADATA: Record<
  CriteriaKey,
  { label: string; shortLabel: string; description: string; min: number; max: number }
> = {
  lyrics: {
    label: i18n.criteria.lyrics,
    shortLabel: i18n.criteriaShort.lyrics,
    description: i18n.criteriaDescriptions.lyrics,
    min: 1,
    max: 10,
  },
  flow: {
    label: i18n.criteria.flow,
    shortLabel: i18n.criteriaShort.flow,
    description: i18n.criteriaDescriptions.flow,
    min: 1,
    max: 10,
  },
  production: {
    label: i18n.criteria.production,
    shortLabel: i18n.criteriaShort.production,
    description: i18n.criteriaDescriptions.production,
    min: 1,
    max: 10,
  },
  identity: {
    label: i18n.criteria.identity,
    shortLabel: i18n.criteriaShort.identity,
    description: i18n.criteriaDescriptions.identity,
    min: 1,
    max: 10,
  },
  vibe: {
    label: i18n.criteria.vibe,
    shortLabel: i18n.criteriaShort.vibe,
    description: i18n.criteriaDescriptions.vibe,
    min: 1,
    max: 10,
  },
};

/**
 * ტრეკის სტატუსი რიგში, კატალოგში და განხილვის პროცესში.
 */
export type TrackStatus =
  | 'pending'
  | 'in_queue'
  | 'queued'
  | 'on_air'
  | 'playing'
  | 'reviewing'
  | 'reviewed'
  | 'community_catalog'
  | 'rejected';

/**
 * მუსიკალური ტრეკის სტრუქტურა (`/tracks/{trackId}`).
 */
export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  coverUrl: string;
  audioUrl: string;
  sourceUrl?: string;
  youtubeUrl?: string;
  youtubeId?: string;
  genre?: string;
  duration?: number;
  submittedBy: string;
  submittedByName: string;
  isPriority: boolean;
  donationAmount?: number;
  status: TrackStatus;
  expertScore: CriteriaScores | null;
  expertTotalScore?: number | null;
  communityScore: CriteriaScores | null;
  communityTotalScore?: number | null;
  peopleScore?: number | null;
  communityVotesCount: number;
  reviewsCount?: number;
  metaScore: number | null;
  currentRank?: number;
  previousRank?: number;
  lastRankUpdate?: Timestamp | FirestoreTimestamp;
  criteriaBreakdown?: {
    lyrics: number;
    flow: number;
    production: number;
    identity: number;
    vibe: number;
  };
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
}

/**
 * არტისტის სოციალური და სტრიმინგ-პლატფორმების ბმულები.
 */
export interface ArtistSocialLinks {
  spotify?: string;
  youtube?: string;
  soundcloud?: string;
  instagram?: string;
}

/**
 * არტისტის პროფილი (`/artist/[id]`).
 */
export interface ArtistProfile {
  id: string;
  name: string;
  bio: string;
  avatarUrl: string;
  genres: string[];
  city?: string;
  socialLinks: ArtistSocialLinks;
}

/**
 * რადარ-ანალიტიკის ერთეული Recharts RadarChart-ისთვის.
 */
export interface ArtistRadarPoint {
  key: CriteriaKey;
  criterion: string;
  fullLabel: string;
  average: number;
  expert: number;
  community: number;
  fullMark: number;
}

/**
 * არტისტის შეჯამებული რადარ-ანალიტიკა ყველა შეფასებულ ტრეკზე დაყრდნობით.
 */
export interface ArtistRadarSummary {
  points: ArtistRadarPoint[];
  averageScores: CriteriaScores;
  overallAverage: number;
  expertOverallAverage: number | null;
  communityOverallAverage: number | null;
  evaluatedTracksCount: number;
}

/**
 * მომხმარებლის რეცენზია ქვეკოლექციაში `/tracks/{trackId}/reviews/{reviewId}`.
 */
export interface TrackReview {
  id: string;
  trackId: string;
  trackTitle?: string;
  trackArtist?: string;
  trackCoverUrl?: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  voteWeight: number;
  scores: CriteriaScores;
  totalScore: number;
  text: string;
  helpfulCount: number;
  helpfulVoterIds: string[];
  createdAt: number;
}

export type Review = TrackReview;

/**
 * ეთერის სტატუსი (OBS და სტუდიის სინქრონიზაციისთვის).
 */
export type LiveStreamStatus =
  | 'idle'
  | 'listening'
  | 'locked'
  | 'revealed';

/**
 * OBS ოვერლეის თემა.
 */
export type ObsTheme = 'dark' | 'neon' | 'minimal' | 'compact';

/**
 * აქტიური ტრეკის სნაპშოტი OBS ოვერლეისა და სტუდიის სინქრონიზაციისთვის (`activeTrackSnapshot`).
 */
export interface TrackSnapshot {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  genre?: string;
  youtubeUrl?: string;
  youtubeId?: string;
  expertScore: CriteriaScores | null;
  expertTotalScore: number | null;
  communityTotalScore: number | null;
  communityVotesCount: number;
  metaScore: number | null;
}

/**
 * აქტიური სტრიმის სესია (`/live_sessions/{sessionId}`).
 */
export interface LiveSession {
  id: string;
  isLive: boolean;
  streamStatus: LiveStreamStatus;
  activeTrackId: string | null;
  activeTrackSnapshot?: TrackSnapshot | null;
  youtubeUrl?: string;
  youtubeId?: string;
  showVideoInOverlay?: boolean;
  streamKey?: string;
  hostId: string;
  title: string;
  votingOpen: boolean;
  isPlaying: boolean;
  isMuted?: boolean;
  playbackPosition: number;
  showObsOverlay: boolean;
  obsTheme: ObsTheme;
  liveExpertDraft?: CriteriaScores | null;
  viewersCount?: number;
  updatedAt: FirestoreTimestamp;
}

export const VALIDATION_CONSTRAINTS = {
  ID_MAX_LENGTH: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  DISPLAY_NAME_MAX_LENGTH: 80,
  TRACK_TITLE_MAX_LENGTH: 120,
  TRACK_ARTIST_MAX_LENGTH: 120,
  GENRE_MAX_LENGTH: 60,
  URL_MAX_LENGTH: 500,
  SESSION_TITLE_MAX_LENGTH: 140,
  REVIEW_TEXT_MIN_LENGTH: 100,
  REVIEW_TEXT_MAX_LENGTH: 3000,
  SCORE_MIN: 1,
  SCORE_MAX: 10,
  VOTE_WEIGHT_MIN: 0.1,
  VOTE_WEIGHT_MAX: 10.0,
} as const;

export function isValidCriteriaScores(
  scores: unknown
): scores is CriteriaScores {
  if (!scores || typeof scores !== 'object') return false;
  const candidate = scores as Record<string, unknown>;
  return CRITERIA_KEYS.every((key) => {
    const val = candidate[key];
    return (
      typeof val === 'number' &&
      !Number.isNaN(val) &&
      val >= VALIDATION_CONSTRAINTS.SCORE_MIN &&
      val <= VALIDATION_CONSTRAINTS.SCORE_MAX
    );
  });
}

/**
 * აგენერირებს უსაფრთხო, დეტერმინირებულ არტისტის ID-ს სახელიდან.
 */
export function getArtistIdFromName(artistName: string): string {
  const normalized = artistName.trim().toLowerCase();
  if (!normalized) return 'artist_unknown';

  const ascii = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

  if (ascii.length >= 2) {
    return `artist_${ascii}`;
  }

  // ქართული უნიკოდ სიმბოლოების დეტერმინირებული ჰეში
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `artist_ge_${hash.toString(36)}`;
}

/**
 * უსაფრთხოდ გარდაქმნის Firestore Timestamp-ს ან რიცხვს მილიწამებად.
 */
export function toTimestampMillis(val: unknown): number {
  if (typeof val === 'number' && !Number.isNaN(val)) {
    return val;
  }
  if (val && typeof val === 'object') {
    const maybeTs = val as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof maybeTs.toMillis === 'function') {
      return maybeTs.toMillis();
    }
    if (typeof maybeTs.seconds === 'number') {
      return maybeTs.seconds * 1000;
    }
  }
  return 0;
}

/**
 * ითვლის 5 კრიტერიუმის საშუალო არითმეტიკულ ქულას (1.0 - 10.0, მეათედებამდე დამრგვალებით).
 */
export function calculateAverageScore(scores: CriteriaScores): number {
  const sum =
    scores.lyrics +
    scores.flow +
    scores.production +
    scores.identity +
    scores.vibe;
  return Math.round((sum / 5) * 10) / 10;
}

/**
 * ითვლის 5 კრიტერიუმის შეჯამებულ სკალას (criteriaBreakdown) რეალური expertScore და communityScore-იდან.
 */
export function calculateCriteriaBreakdown(
  expertScore: CriteriaScores | null | undefined,
  communityScore: CriteriaScores | null | undefined
): CriteriaScores | undefined {
  if (!expertScore && !communityScore) return undefined;
  if (expertScore && !communityScore) {
    return { ...expertScore };
  }
  if (!expertScore && communityScore) {
    return { ...communityScore };
  }
  const e = expertScore!;
  const c = communityScore!;
  return {
    lyrics: Math.round((e.lyrics * 0.6 + c.lyrics * 0.4) * 10) / 10,
    flow: Math.round((e.flow * 0.6 + c.flow * 0.4) * 10) / 10,
    production: Math.round((e.production * 0.6 + c.production * 0.4) * 10) / 10,
    identity: Math.round((e.identity * 0.6 + c.identity * 0.4) * 10) / 10,
    vibe: Math.round((e.vibe * 0.6 + c.vibe * 0.4) * 10) / 10,
  };
}

/**
 * ითვლის საბოლოო MetaScore-ს (1.0–10.0 შკალაზე) expertScore-ის (60%) და communityScore-ის (40%) საფუძველზე.
 */
export function calculateMetaScore(
  expertScore: CriteriaScores | null,
  communityScore: CriteriaScores | null
): number | null {
  if (!expertScore && !communityScore) return null;
  if (expertScore && !communityScore) {
    return calculateAverageScore(expertScore);
  }
  if (!expertScore && communityScore) {
    return calculateAverageScore(communityScore);
  }
  const expertAvg = calculateAverageScore(expertScore!);
  const communityAvg = calculateAverageScore(communityScore!);
  return Math.round((expertAvg * 0.6 + communityAvg * 0.4) * 10) / 10;
}

/**
 * ნორმალიზებას უკეთებს metaScore-ს 0–10 შკალაზე (თუ ძველ ჩანაწერში 0–100 შკალით ინახებოდა).
 */
export function normalizeScoreToTen(score: number | null | undefined): number {
  if (typeof score !== 'number' || Number.isNaN(score) || score <= 0) return 0;
  if (score > 10) {
    return Math.round((score / 10) * 100) / 100;
  }
  return Math.round(score * 100) / 100;
}

/**
 * ითვლის ტრეკის რეალურ რეიტინგს (0.0–10.0) მხოლოდ Firestore-ის რეალური მონაცემებიდან.
 */
export function calculateFairTrackRating(track: Track): number {
  if (typeof track.metaScore === 'number' && track.metaScore > 0) {
    return normalizeScoreToTen(track.metaScore);
  }
  if (typeof track.peopleScore === 'number' && track.peopleScore > 0) {
    return normalizeScoreToTen(track.peopleScore);
  }

  const expertAvg =
    track.expertTotalScore ??
    (track.expertScore ? calculateAverageScore(track.expertScore) : null);

  const communityAvg =
    track.communityTotalScore ??
    (track.communityScore ? calculateAverageScore(track.communityScore) : null);

  if (expertAvg !== null && communityAvg !== null) {
    return Math.round((expertAvg * 0.6 + communityAvg * 0.4) * 100) / 100;
  }
  if (expertAvg !== null) {
    return Math.round(expertAvg * 100) / 100;
  }
  if (communityAvg !== null) {
    return Math.round(communityAvg * 100) / 100;
  }
  return 0;
}

/**
 * ალაგებს ტრეკებს Top-24 ჩარტის წესით (metaScore / peopleScore / fairRating კლებადობით, შემდეგ ხმების რაოდენობით).
 */
export function sortTracksForTopChart(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => {
    const scoreA = normalizeScoreToTen(
      a.metaScore || a.peopleScore || calculateFairTrackRating(a) || 0
    );
    const scoreB = normalizeScoreToTen(
      b.metaScore || b.peopleScore || calculateFairTrackRating(b) || 0
    );
    if (scoreB !== scoreA) return scoreB - scoreA;
    const votesB = b.reviewsCount ?? b.communityVotesCount ?? 0;
    const votesA = a.reviewsCount ?? a.communityVotesCount ?? 0;
    return votesB - votesA;
  });
}

/**
 * ითვლის არტისტის საშუალო რადარ-ანალიტიკას 5 კრიტერიუმის მიხედვით
 * (ტექსტი, ფლოუ, ბითი, ინდივიდუალიზმი, ვაიბი) ყველა შეფასებულ ტრეკზე დაყრდნობით.
 */
export function calculateArtistRadarAnalytics(
  artistTracks: Track[]
): ArtistRadarSummary {
  const evaluated = artistTracks.filter(
    (t) => t.expertScore !== null || t.communityScore !== null
  );

  if (evaluated.length === 0) {
    const emptyScores: CriteriaScores = {
      lyrics: 0,
      flow: 0,
      production: 0,
      identity: 0,
      vibe: 0,
    };
    return {
      points: CRITERIA_KEYS.map((key) => ({
        key,
        criterion: i18n.criteriaShort[key],
        fullLabel: i18n.criteria[key],
        average: 0,
        expert: 0,
        community: 0,
        fullMark: 10,
      })),
      averageScores: emptyScores,
      overallAverage: 0,
      expertOverallAverage: null,
      communityOverallAverage: null,
      evaluatedTracksCount: 0,
    };
  }

  const expertTracks = evaluated.filter((t) => t.expertScore !== null);
  const communityTracks = evaluated.filter((t) => t.communityScore !== null);

  const averageScores: CriteriaScores = {
    lyrics: 0,
    flow: 0,
    production: 0,
    identity: 0,
    vibe: 0,
  };

  const points: ArtistRadarPoint[] = CRITERIA_KEYS.map((key) => {
    const expertSum = expertTracks.reduce(
      (acc, t) => acc + (t.expertScore ? t.expertScore[key] : 0),
      0
    );
    const expertAvg =
      expertTracks.length > 0
        ? Math.round((expertSum / expertTracks.length) * 10) / 10
        : 0;

    const commSum = communityTracks.reduce(
      (acc, t) => acc + (t.communityScore ? t.communityScore[key] : 0),
      0
    );
    const commAvg =
      communityTracks.length > 0
        ? Math.round((commSum / communityTracks.length) * 10) / 10
        : 0;

    // თითოეული შეფასებული ტრეკის კომბინირებული ქულა კრიტერიუმის მიხედვით
    const combinedSum = evaluated.reduce((acc, t) => {
      const eVal = t.expertScore ? t.expertScore[key] : null;
      const cVal = t.communityScore ? t.communityScore[key] : null;
      if (eVal !== null && cVal !== null) {
        return acc + (eVal * 0.6 + cVal * 0.4);
      }
      return acc + (eVal ?? cVal ?? 0);
    }, 0);

    const combinedAvg =
      Math.round((combinedSum / evaluated.length) * 10) / 10;
    averageScores[key] = combinedAvg;

    return {
      key,
      criterion: i18n.criteriaShort[key],
      fullLabel: i18n.criteria[key],
      average: combinedAvg,
      expert: expertAvg || combinedAvg,
      community: commAvg || combinedAvg,
      fullMark: 10,
    };
  });

  const overallAverage = calculateAverageScore(averageScores);
  const expertOverallAverage =
    expertTracks.length > 0
      ? Math.round(
          (expertTracks.reduce(
            (acc, t) =>
              acc +
              (t.expertTotalScore ?? calculateAverageScore(t.expertScore!)),
            0
          ) /
            expertTracks.length) *
            10
        ) / 10
      : null;

  const communityOverallAverage =
    communityTracks.length > 0
      ? Math.round(
          (communityTracks.reduce(
            (acc, t) =>
              acc +
              (t.communityTotalScore ??
                calculateAverageScore(t.communityScore!)),
            0
          ) /
            communityTracks.length) *
            10
        ) / 10
      : null;

  return {
    points,
    averageScores,
    overallAverage,
    expertOverallAverage,
    communityOverallAverage,
    evaluatedTracksCount: evaluated.length,
  };
}

/**
 * ახალი რეცენზიის დამატებისას ხელახლა ითვლის ტრეკის შეწონილ communityScore-ს და communityTotalScore-ს.
 */
export function computeUpdatedCommunityScores(
  track: Track,
  newReviewScores: CriteriaScores,
  voteWeight: number
): {
  communityScore: CriteriaScores;
  communityTotalScore: number;
  communityVotesCount: number;
  metaScore: number;
} {
  const prevCount = Math.max(0, track.communityVotesCount || 0);
  const prevScores: CriteriaScores = track.communityScore ?? {
    lyrics: track.communityTotalScore ?? 8.0,
    flow: track.communityTotalScore ?? 8.0,
    production: track.communityTotalScore ?? 8.0,
    identity: track.communityTotalScore ?? 8.0,
    vibe: track.communityTotalScore ?? 8.0,
  };

  const effectiveWeight = Math.max(0.1, Math.min(10, voteWeight));
  const totalWeight = prevCount + effectiveWeight;

  const nextCommunityScore: CriteriaScores = {
    lyrics:
      Math.round(
        ((prevScores.lyrics * prevCount + newReviewScores.lyrics * effectiveWeight) /
          totalWeight) *
          10
      ) / 10,
    flow:
      Math.round(
        ((prevScores.flow * prevCount + newReviewScores.flow * effectiveWeight) /
          totalWeight) *
          10
      ) / 10,
    production:
      Math.round(
        ((prevScores.production * prevCount +
          newReviewScores.production * effectiveWeight) /
          totalWeight) *
          10
      ) / 10,
    identity:
      Math.round(
        ((prevScores.identity * prevCount +
          newReviewScores.identity * effectiveWeight) /
          totalWeight) *
          10
      ) / 10,
    vibe:
      Math.round(
        ((prevScores.vibe * prevCount + newReviewScores.vibe * effectiveWeight) /
          totalWeight) *
          10
      ) / 10,
  };

  const nextCommunityTotal = calculateAverageScore(nextCommunityScore);
  const nextVotesCount = prevCount + 1;
  const nextMeta =
    calculateMetaScore(track.expertScore, nextCommunityScore) ??
    nextCommunityTotal;

  return {
    communityScore: nextCommunityScore,
    communityTotalScore: nextCommunityTotal,
    communityVotesCount: nextVotesCount,
    metaScore: nextMeta,
  };
}

/**
 * რეცენზიის წაშლის შემდეგ ხელახლა ითვლის ტრეკის შეწონილ communityScore-ს დარჩენილი რეცენზიებიდან.
 */
export function recalculateCommunityScoresFromReviews(
  remainingReviews: Array<{
    scores: CriteriaScores;
    voteWeight?: number;
    totalScore?: number;
  }>,
  expertScore: CriteriaScores | null
): {
  communityScore: CriteriaScores | null;
  communityTotalScore: number | null;
  peopleScore: number | null;
  communityVotesCount: number;
  reviewsCount: number;
  metaScore: number | null;
} {
  if (remainingReviews.length === 0) {
    return {
      communityScore: null,
      communityTotalScore: null,
      peopleScore: null,
      communityVotesCount: 0,
      reviewsCount: 0,
      metaScore: calculateMetaScore(expertScore, null),
    };
  }

  let totalWeight = 0;
  let sumLyrics = 0;
  let sumFlow = 0;
  let sumProduction = 0;
  let sumIdentity = 0;
  let sumVibe = 0;

  for (const rev of remainingReviews) {
    const w = Math.max(0.1, Math.min(10, rev.voteWeight || 1.0));
    totalWeight += w;
    sumLyrics += rev.scores.lyrics * w;
    sumFlow += rev.scores.flow * w;
    sumProduction += rev.scores.production * w;
    sumIdentity += rev.scores.identity * w;
    sumVibe += rev.scores.vibe * w;
  }

  const safeWeight = totalWeight > 0 ? totalWeight : 1;
  const communityScore: CriteriaScores = {
    lyrics: Math.round((sumLyrics / safeWeight) * 10) / 10,
    flow: Math.round((sumFlow / safeWeight) * 10) / 10,
    production: Math.round((sumProduction / safeWeight) * 10) / 10,
    identity: Math.round((sumIdentity / safeWeight) * 10) / 10,
    vibe: Math.round((sumVibe / safeWeight) * 10) / 10,
  };

  const communityTotalScore = calculateAverageScore(communityScore);
  const communityVotesCount = remainingReviews.length;
  const metaScore =
    calculateMetaScore(expertScore, communityScore) ?? communityTotalScore;

  return {
    communityScore,
    communityTotalScore,
    peopleScore: communityTotalScore,
    communityVotesCount,
    reviewsCount: communityVotesCount,
    metaScore,
  };
}
