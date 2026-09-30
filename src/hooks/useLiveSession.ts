import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  doc,
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { extractYouTubeId } from '../lib/youtube';
import {
  calculateAverageScore,
  calculateMetaScore,
  computeUpdatedCommunityScores,
  recalculateCommunityScoresFromReviews,
  getArtistIdFromName,
  DEFAULT_ROLE_VOTE_WEIGHTS,
  type ArtistProfile,
  type CriteriaScores,
  type LiveSession,
  type LiveStreamStatus,
  type TopCritic,
  type Track,
  type TrackReview,
  type TrackSnapshot,
  type TrackStatus,
  type User,
  type UserRole,
} from '../types';
import defaultCoverImg from '../assets/images/default_track_cover_1790747990267.jpg';
import studioEmblemImg from '../assets/images/studio_vinyl_emblem_1790748005639.jpg';
import caucasusSynthImg from '../assets/images/cover_caucasus_synth_1790748715826.jpg';
import rustaveliJazzImg from '../assets/images/cover_rustaveli_jazz_1790748728643.jpg';
import blackSeaPostpunkImg from '../assets/images/cover_black_sea_postpunk_1790748739650.jpg';

export const PRESET_COVERS = {
  vinyl: defaultCoverImg,
  console: studioEmblemImg,
  synth: caucasusSynthImg,
  jazz: rustaveliJazzImg,
  postpunk: blackSeaPostpunkImg,
};

const LEGACY_DEMO_STORAGE_KEYS = [
  'soundcheck_tracks_catalog_v3',
  'soundcheck_tracks_reviews_v3',
  'soundcheck_top_critics_v3',
  'soundcheck_live_session_v3',
] as const;

let legacyDemoCacheCleaned = false;

/**
 * ერთჯერადი გასუფთავება ძველი დემო-მონაცემების გასაღებებისგან localStorage-ში
 */
export function clearLegacyDemoCache(): void {
  if (legacyDemoCacheCleaned || typeof window === 'undefined') return;
  legacyDemoCacheCleaned = true;
  try {
    for (const key of LEGACY_DEMO_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore storage access errors
  }
}

clearLegacyDemoCache();

const SYNC_EVENT_NAME = 'soundcheck:live-sync';
const BROADCAST_CHANNEL_NAME = 'soundcheck_live_channel';

export const INITIAL_CRITERIA_SCORES: CriteriaScores = {
  lyrics: 8.0,
  flow: 8.0,
  production: 8.0,
  identity: 8.0,
  vibe: 8.0,
};

function isValidCriteriaScores(scores: unknown): scores is CriteriaScores {
  if (!scores || typeof scores !== 'object') return false;
  const s = scores as Record<string, unknown>;
  const keys = ['lyrics', 'flow', 'production', 'identity', 'vibe'];
  return keys.every(
    (k) => typeof s[k] === 'number' && !Number.isNaN(s[k]) && s[k] >= 1 && s[k] <= 10
  );
}

export function generateRandomStreamKey(): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randomValues = new Uint32Array(24);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(randomValues);
    return (
      'sk_' +
      Array.from(randomValues, (v) => chars[v % chars.length]).join('')
    );
  }
  let result = 'sk_';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const INITIAL_LIVE_SESSION: LiveSession = {
  id: 'current',
  isLive: false,
  streamStatus: 'idle',
  activeTrackId: null,
  activeTrackSnapshot: null,
  youtubeUrl: '',
  youtubeId: '',
  showVideoInOverlay: true,
  streamKey: '',
  hostId: 'streamer_host',
  title: 'ქართული რელიზების ლაივ-განხილვა',
  votingOpen: false,
  isPlaying: true,
  isMuted: false,
  playbackPosition: 0,
  showObsOverlay: true,
  obsTheme: 'dark',
  liveExpertDraft: INITIAL_CRITERIA_SCORES,
  viewersCount: 0,
  updatedAt: Date.now(),
};

/**
 * ავტომატურად იღებს youtubeUrl-სა და youtubeId-ს ტრეკის ველებიდან (youtubeUrl, sourceUrl, audioUrl).
 */
export function resolveTrackYouTubeFields(
  track:
    | {
        youtubeUrl?: string;
        youtubeId?: string;
        sourceUrl?: string;
        audioUrl?: string;
      }
    | null
    | undefined,
  fallbackSnapshot?: TrackSnapshot | null
): { youtubeUrl: string; youtubeId: string } {
  const primaryCandidate = (
    track?.youtubeUrl ||
    track?.sourceUrl ||
    track?.audioUrl ||
    fallbackSnapshot?.youtubeUrl ||
    ''
  ).trim();

  const extractedFromPrimary = extractYouTubeId(primaryCandidate);
  const extractedFromSource = track?.sourceUrl
    ? extractYouTubeId(track.sourceUrl)
    : null;
  const extractedFromAudio = track?.audioUrl
    ? extractYouTubeId(track.audioUrl)
    : null;

  const resolvedId = (
    extractedFromPrimary ||
    extractedFromSource ||
    extractedFromAudio ||
    track?.youtubeId ||
    fallbackSnapshot?.youtubeId ||
    ''
  ).trim();

  let resolvedUrl = '';
  if (resolvedId) {
    if (track?.youtubeUrl && extractYouTubeId(track.youtubeUrl)) {
      resolvedUrl = track.youtubeUrl.trim();
    } else if (extractedFromPrimary) {
      resolvedUrl = primaryCandidate;
    } else if (extractedFromSource && track?.sourceUrl) {
      resolvedUrl = track.sourceUrl.trim();
    } else if (extractedFromAudio && track?.audioUrl) {
      resolvedUrl = track.audioUrl.trim();
    } else if (fallbackSnapshot?.youtubeUrl) {
      resolvedUrl = fallbackSnapshot.youtubeUrl.trim();
    } else {
      resolvedUrl = `https://www.youtube.com/watch?v=${resolvedId}`;
    }
  } else if (track?.youtubeUrl) {
    resolvedUrl = track.youtubeUrl.trim();
  }

  return {
    youtubeUrl: resolvedUrl.slice(0, 500),
    youtubeId: resolvedId.slice(0, 64),
  };
}

interface BroadcastPayload {
  session?: LiveSession;
  tracks?: Track[];
  reviews?: TrackReview[];
  critics?: TopCritic[];
}

function broadcastStateUpdate(payload: BroadcastPayload) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(SYNC_EVENT_NAME, {
      detail: payload,
    })
  );

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    } catch {
      // ignore
    }
  }
}

export interface UseLiveSessionOptions {
  sessionId?: string;
  requireAuth?: boolean;
}

export interface SubmitReviewInput {
  trackId: string;
  authorName: string;
  scores: CriteriaScores;
  text: string;
}

export interface SubmitNewTrackInput {
  title: string;
  artist: string;
  genre: string;
  sourceUrl: string;
  coverUrl?: string;
  destinationStatus: 'community_catalog' | 'in_queue';
}

export interface UseLiveSessionResult {
  session: LiveSession | null;
  activeTrack: Track | null;
  tracksQueue: Track[];
  inQueueTracks: Track[];
  artists: ArtistProfile[];
  reviews: TrackReview[];
  topCritics: TopCritic[];
  userProfile: User | null;
  currentUserProfile: User | null;
  authLoading: boolean;
  loading: boolean;
  sessionLoading: boolean;
  trackLoading: boolean;
  error: Error | null;
  isLive: boolean;
  votingOpen: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  showVideoInOverlay: boolean;
  streamKey: string;
  isFirestoreSynced: boolean;
  updateDraftScores: (draft: CriteriaScores) => Promise<void>;
  updateStreamStatus: (status: LiveStreamStatus) => Promise<void>;
  lockInVerdict: (finalScores: CriteriaScores) => Promise<void>;
  addAndActivateTrack: (input: {
    title: string;
    artist: string;
    coverUrl: string;
    genre?: string;
    youtubeUrl?: string;
    audioUrl?: string;
    sourceUrl?: string;
  }) => Promise<Track>;
  submitNewTrack: (input: SubmitNewTrackInput) => Promise<Track>;
  launchTrackOnAir: (trackOrId: string | Track) => Promise<void>;
  selectActiveTrack: (trackOrId: string | Track) => Promise<void>;
  updateCommunityPrediction: (communityAvg: number) => Promise<void>;
  submitTrackReview: (input: SubmitReviewInput) => Promise<TrackReview>;
  toggleReviewHelpful: (reviewId: string, trackId?: string) => Promise<void>;
  deleteTrack: (trackId: string) => Promise<void>;
  deleteTrackReview: (trackId: string, reviewId: string) => Promise<void>;
  toggleShowVideoInOverlay: (nextValue?: boolean) => Promise<void>;
  togglePlayback: (nextPlaying?: boolean) => Promise<void>;
  toggleMute: (nextMuted?: boolean) => Promise<void>;
  regenerateStreamKey: () => Promise<string>;
  updateObsSettings: (settings: {
    showObsOverlay?: boolean;
    showVideoInOverlay?: boolean;
    isPlaying?: boolean;
    isMuted?: boolean;
    streamKey?: string;
    obsTheme?: 'dark' | 'neon' | 'minimal' | 'compact';
  }) => Promise<void>;
}

/**
 * უზრუნველყოფს ავტორიზებული მომხმარებლის პროფილის არსებობას `/users/{uid}` კოლექციაში
 * და ავტომატურად ანიჭებს ადმინისტრატორის როლს (`role: 'admin', voteWeight: 5.0, xp: 5000, level: 10`),
 * თუ `user.email === 'hardsize@mail.ru'` ან UID არსებობს `/admins/{uid}` კოლექციაში.
 */
async function ensureUserProfileInFirestore(
  uid: string,
  displayName: string | null,
  email?: string | null
) {
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);

    let isAdminUser = email === 'hardsize@mail.ru';
    if (!isAdminUser) {
      try {
        const adminDocSnap = await getDoc(doc(db, 'admins', uid));
        if (adminDocSnap.exists()) {
          isAdminUser = true;
        }
      } catch {
        // ignore if admins check fails
      }
    }

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        displayName: (
          displayName || (isAdminUser ? 'ადმინისტრატორი' : 'ქართველი მუსიკოსი')
        ).slice(0, 80),
        role: isAdminUser ? 'admin' : 'viewer',
        xp: isAdminUser ? 5000 : 0,
        level: isAdminUser ? 10 : 1,
        voteWeight: isAdminUser ? 5.0 : 1.0,
        reviewsCount: 0,
        helpfulVotesReceived: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (isAdminUser) {
      const existingData = snap.data() as Partial<User>;
      if (existingData.role === 'viewer' || !existingData.role) {
        await updateDoc(userRef, {
          role: 'admin',
          voteWeight: 5.0,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch {
    // ignore if offline or permissions pending
  }
}

export function useLiveSession(
  options: UseLiveSessionOptions | string = 'current'
): UseLiveSessionResult {
  const sessionId =
    typeof options === 'string' ? options : (options.sessionId ?? 'current');
  const requireAuth =
    typeof options === 'string' ? false : (options.requireAuth ?? false);

  const [authReady, setAuthReady] = useState<boolean>(!requireAuth);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => Boolean(auth.currentUser)
  );
  const [tracksQueue, setTracksQueue] = useState<Track[]>([]);
  const [reviews, setReviews] = useState<TrackReview[]>([]);
  const [topCritics, setTopCritics] = useState<TopCritic[]>([]);
  const [firestoreUsers, setFirestoreUsers] = useState<TopCritic[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<User | null>(null);
  const userProfile = currentUserProfile;
  const currentUserProfileRef = useRef<User | null>(null);
  useEffect(() => {
    currentUserProfileRef.current = currentUserProfile;
  }, [currentUserProfile]);
  const [session, setSession] = useState<LiveSession | null>(
    () => INITIAL_LIVE_SESSION
  );
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [tracksLoading, setTracksLoading] = useState<boolean>(true);
  const [trackLoading, setTrackLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFirestoreSynced, setIsFirestoreSynced] = useState<boolean>(false);

  // ერთჯერადი გასუფთავება მოძველებული დემო-ქეშისგან localStorage-ში
  useEffect(() => {
    clearLegacyDemoCache();
  }, []);

  // Ref აქტუალური ტრეკების სიაზე წვდომისთვის
  const tracksQueueRef = useRef<Track[]>(tracksQueue);
  useEffect(() => {
    tracksQueueRef.current = tracksQueue;
  }, [tracksQueue]);

  // Ref დებაუნსის ტაიმერისთვის (120 მს) სლაიდერის დრაფტის ჩასაწერად Firestore-ში
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
      }
    };
  }, []);

  // ავტორიზაცია და მომხმარებლის პროფილის მოსმენა `/users/{uid}`
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      setIsAuthenticated(Boolean(user));
      setAuthReady(true);

      if (user) {
        const isAdminEmail = user.email === 'hardsize@mail.ru';
        void ensureUserProfileInFirestore(
          user.uid,
          user.displayName,
          user.email
        );
        const userRef = doc(db, 'users', user.uid);
        unsubscribeProfile = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              const data = snap.data() as User;
              const shouldAutoPromoteAdmin =
                isAdminEmail && (data.role === 'viewer' || !data.role);
              const resolvedRole: UserRole = shouldAutoPromoteAdmin
                ? 'admin'
                : data.role || (isAdminEmail ? 'admin' : 'viewer');
              const resolvedVoteWeight: number = shouldAutoPromoteAdmin
                ? 5.0
                : typeof data.voteWeight === 'number'
                  ? data.voteWeight
                  : DEFAULT_ROLE_VOTE_WEIGHTS[resolvedRole] ?? 1.0;

              if (shouldAutoPromoteAdmin) {
                void updateDoc(userRef, {
                  role: 'admin',
                  voteWeight: 5.0,
                  updatedAt: serverTimestamp(),
                }).catch(() => {
                  // ignore
                });
              }

              setCurrentUserProfile({
                ...data,
                uid: snap.id,
                role: resolvedRole,
                voteWeight: resolvedVoteWeight,
              });
              setAuthLoading(false);
            } else {
              const fallbackRole: UserRole = isAdminEmail ? 'admin' : 'viewer';
              setCurrentUserProfile({
                uid: user.uid,
                displayName:
                  user.displayName ||
                  (isAdminEmail ? 'ადმინისტრატორი' : 'ქართველი მსმენელი'),
                role: fallbackRole,
                xp: isAdminEmail ? 5000 : 0,
                level: isAdminEmail ? 10 : 1,
                voteWeight: isAdminEmail ? 5.0 : DEFAULT_ROLE_VOTE_WEIGHTS[fallbackRole],
                reviewsCount: 0,
                helpfulVotesReceived: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
              setAuthLoading(false);
            }
          },
          () => {
            const fallbackRole: UserRole = isAdminEmail ? 'admin' : 'viewer';
            setCurrentUserProfile({
              uid: user.uid,
              displayName:
                user.displayName ||
                (isAdminEmail ? 'ადმინისტრატორი' : 'ქართველი მსმენელი'),
              role: fallbackRole,
              xp: isAdminEmail ? 5000 : 0,
              level: isAdminEmail ? 10 : 1,
              voteWeight: isAdminEmail ? 5.0 : DEFAULT_ROLE_VOTE_WEIGHTS[fallbackRole],
              reviewsCount: 0,
              helpfulVotesReceived: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
            setAuthLoading(false);
          }
        );
      } else {
        setCurrentUserProfile(null);
        setAuthLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  // Cross-tab & Same-tab მყისიერი სინქრონიზაცია (localStorage-ში დემო-ჩანაწერების გარეშე)
  useEffect(() => {
    const applyPayload = (data: Partial<BroadcastPayload>) => {
      if (data.session) setSession(data.session);
      if (data.reviews) setReviews(data.reviews);
      if (data.critics) setTopCritics(data.critics);
      if (data.tracks) {
        setTracksQueue(data.tracks);
        const currentActiveId =
          data.session?.activeTrackId ?? session?.activeTrackId;
        if (currentActiveId) {
          const found = data.tracks.find((t) => t.id === currentActiveId);
          setActiveTrack(found ?? null);
        }
      }
    };

    const handleSyncEvent = (event: Event) => {
      const custom = event as CustomEvent<BroadcastPayload>;
      if (custom.detail) applyPayload(custom.detail);
    };

    window.addEventListener(SYNC_EVENT_NAME, handleSyncEvent);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channel.onmessage = (msg) => {
          if (msg.data) applyPayload(msg.data as Partial<BroadcastPayload>);
        };
      } catch {
        // ignore
      }
    }

    return () => {
      window.removeEventListener(SYNC_EVENT_NAME, handleSyncEvent);
      if (channel) channel.close();
    };
  }, [session?.activeTrackId]);

  // 1. Firestore real-time `onSnapshot` მოსმენა `live_sessions/{sessionId}` დოკუმენტზე
  useEffect(() => {
    if (!sessionId) {
      setSessionLoading(false);
      return;
    }

    setSessionLoading(true);
    setError(null);

    const sessionPath = `live_sessions/${sessionId}`;
    const sessionRef = doc(db, 'live_sessions', sessionId);

    const unsubscribeSession = onSnapshot(
      sessionRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Omit<LiveSession, 'id'>;
          const snapYoutube = resolveTrackYouTubeFields(
            data.activeTrackSnapshot ?? undefined,
            data.activeTrackSnapshot ?? null
          );
          const sessionYoutubeUrl =
            data.youtubeUrl ??
            data.activeTrackSnapshot?.youtubeUrl ??
            snapYoutube.youtubeUrl;
          const sessionYoutubeId =
            data.youtubeId ??
            data.activeTrackSnapshot?.youtubeId ??
            snapYoutube.youtubeId;
          const nextSession: LiveSession = {
            ...INITIAL_LIVE_SESSION,
            ...data,
            id: snapshot.id,
            activeTrackId: data.activeTrackId || null,
            activeTrackSnapshot: data.activeTrackSnapshot
              ? {
                  ...data.activeTrackSnapshot,
                  youtubeUrl:
                    data.activeTrackSnapshot.youtubeUrl ?? sessionYoutubeUrl,
                  youtubeId:
                    data.activeTrackSnapshot.youtubeId ?? sessionYoutubeId,
                }
              : null,
            youtubeUrl: sessionYoutubeUrl,
            youtubeId: sessionYoutubeId,
            showVideoInOverlay: Boolean(data.showVideoInOverlay ?? true),
            streamKey: typeof data.streamKey === 'string' ? data.streamKey : '',
            isPlaying: Boolean(data.isPlaying ?? true),
            isMuted: Boolean(data.isMuted ?? false),
            liveExpertDraft: data.liveExpertDraft ?? null,
          };
          setSession(nextSession);
          setIsFirestoreSynced(true);
        } else {
          setSession(INITIAL_LIVE_SESSION);
          setIsFirestoreSynced(true);
        }
        setSessionLoading(false);
      },
      (err) => {
        setSessionLoading(false);
        const normalizedError =
          err instanceof Error ? err : new Error(String(err));
        setError(normalizedError);
        try {
          handleFirestoreError(err, OperationType.GET, sessionPath);
        } catch (handledErr) {
          setError(
            handledErr instanceof Error
              ? handledErr
              : new Error(String(handledErr))
          );
        }
      }
    );

    return () => {
      unsubscribeSession();
    };
  }, [sessionId]);

  // 1b. Firestore `tracks` კოლექციის რეალურ დროში მოსმენა (მხოლოდ რეალური ტრეკები Firestore-იდან)
  useEffect(() => {
    const tracksQuery = query(
      collection(db, 'tracks'),
      where('status', 'in', [
        'in_queue',
        'on_air',
        'reviewed',
        'community_catalog',
      ])
    );

    const unsubscribeTracks = onSnapshot(
      tracksQuery,
      (snapshot) => {
        const firestoreTracks: Track[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data() as Omit<Track, 'id'>;
          const createdMs =
            typeof d.createdAt === 'number'
              ? d.createdAt
              : d.createdAt &&
                  typeof (d.createdAt as { toMillis?: () => number }).toMillis ===
                    'function'
                ? (d.createdAt as { toMillis: () => number }).toMillis()
                : Date.now();
          return {
            ...d,
            id: docSnap.id,
            artistId: d.artistId || getArtistIdFromName(d.artist || ''),
            youtubeUrl:
              d.youtubeUrl ||
              resolveTrackYouTubeFields(d).youtubeUrl ||
              undefined,
            youtubeId:
              d.youtubeId ||
              resolveTrackYouTubeFields(d).youtubeId ||
              undefined,
            createdAt: createdMs,
          };
        });

        setTracksQueue(firestoreTracks);
        setTracksLoading(false);
      },
      (err) => {
        setTracksLoading(false);
        try {
          handleFirestoreError(err, OperationType.LIST, 'tracks');
        } catch {
          // logged by handleFirestoreError
        }
      }
    );

    return () => unsubscribeTracks();
  }, []);

  // 1c. რეალური რეცენზიების მოსმენა Firestore-ის ქვეკოლექციებიდან `tracks/{trackId}/reviews` (ქეშირებული გამოწერებით)
  const reviewUnsubsRef = useRef<Map<string, () => void>>(new Map());
  const reviewsByTrackRef = useRef<Map<string, TrackReview[]>>(new Map());

  useEffect(() => {
    const currentTrackIds = new Set(tracksQueue.map((t) => t.id));
    const unsubsMap = reviewUnsubsRef.current;
    const reviewsMap = reviewsByTrackRef.current;

    const recomputeAllReviews = () => {
      const trackLookup = new Map(
        tracksQueueRef.current.map((t) => [t.id, t])
      );
      const merged: TrackReview[] = [];
      reviewsMap.forEach((trackRevs, tId) => {
        const latestTrack = trackLookup.get(tId);
        trackRevs.forEach((rev) => {
          merged.push(
            latestTrack
              ? {
                  ...rev,
                  trackTitle: latestTrack.title,
                  trackArtist: latestTrack.artist,
                  trackCoverUrl: latestTrack.coverUrl,
                }
              : rev
          );
        });
      });
      merged.sort((a, b) => b.createdAt - a.createdAt);
      setReviews(merged);
    };

    // მოვაშოროთ წაშლილი ტრეკების მსმენელები
    Array.from(unsubsMap.keys()).forEach((existingId) => {
      if (!currentTrackIds.has(existingId)) {
        const unsub = unsubsMap.get(existingId);
        if (unsub) unsub();
        unsubsMap.delete(existingId);
        reviewsMap.delete(existingId);
      }
    });

    if (tracksQueue.length === 0) {
      setReviews([]);
      return;
    }

    // დავამატოთ მსმენელი მხოლოდ ახალი ტრეკებისთვის
    tracksQueue.forEach((track) => {
      if (unsubsMap.has(track.id)) return;

      const reviewsColRef = collection(db, 'tracks', track.id, 'reviews');
      const unsub = onSnapshot(
        reviewsColRef,
        (snapshot) => {
          const latestTrack =
            tracksQueueRef.current.find((t) => t.id === track.id) || track;
          const trackRevs: TrackReview[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            const createdMs =
              typeof data.createdAt === 'number'
                ? data.createdAt
                : data.createdAt &&
                    typeof (data.createdAt as { toMillis?: () => number })
                      .toMillis === 'function'
                  ? (data.createdAt as { toMillis: () => number }).toMillis()
                  : Date.now();

            const scores: CriteriaScores = (data.scores as CriteriaScores) || {
              lyrics: 8.0,
              flow: 8.0,
              production: 8.0,
              identity: 8.0,
              vibe: 8.0,
            };

            return {
              id: docSnap.id,
              trackId: (data.trackId as string) || latestTrack.id,
              trackTitle: latestTrack.title,
              trackArtist: latestTrack.artist,
              trackCoverUrl: latestTrack.coverUrl,
              authorId: (data.authorId as string) || '',
              authorName: (data.authorName as string) || 'მსმენელი',
              authorRole: (data.authorRole as UserRole) || 'viewer',
              voteWeight:
                typeof data.voteWeight === 'number' ? data.voteWeight : 1.0,
              scores,
              totalScore:
                typeof data.totalScore === 'number'
                  ? data.totalScore
                  : calculateAverageScore(scores),
              text: (data.text as string) || '',
              helpfulCount:
                typeof data.helpfulCount === 'number' ? data.helpfulCount : 0,
              helpfulVoterIds: Array.isArray(data.helpfulVoterIds)
                ? (data.helpfulVoterIds as string[])
                : [],
              createdAt: createdMs,
            };
          });

          reviewsMap.set(track.id, trackRevs);
          recomputeAllReviews();
        },
        (err) => {
          try {
            handleFirestoreError(
              err,
              OperationType.LIST,
              `tracks/${track.id}/reviews`
            );
          } catch {
            // logged by handleFirestoreError
          }
        }
      );

      unsubsMap.set(track.id, unsub);
    });

    recomputeAllReviews();
  }, [tracksQueue]);

  useEffect(() => {
    const unsubsMap = reviewUnsubsRef.current;
    return () => {
      unsubsMap.forEach((unsub) => unsub());
      unsubsMap.clear();
    };
  }, []);

  // 1d. ტოპ კრიტიკოსები: რეალური მომხმარებლების ჩატვირთვა `users` კოლექციიდან
  useEffect(() => {
    const usersQuery = query(collection(db, 'users'), where('xp', '>=', 0));

    const unsubscribeUsers = onSnapshot(
      usersQuery,
      (snapshot) => {
        const loadedUsers: TopCritic[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data() as Partial<User>;
          const role: UserRole = d.role || 'viewer';
          return {
            uid: docSnap.id,
            displayName: d.displayName || 'მსმენელი',
            role,
            voteWeight:
              typeof d.voteWeight === 'number'
                ? d.voteWeight
                : DEFAULT_ROLE_VOTE_WEIGHTS[role] ?? 1.0,
            xp: typeof d.xp === 'number' ? d.xp : 0,
            reviewsCount:
              typeof d.reviewsCount === 'number' ? d.reviewsCount : 0,
            helpfulVotesReceived:
              typeof d.helpfulVotesReceived === 'number'
                ? d.helpfulVotesReceived
                : 0,
          };
        });

        setFirestoreUsers(loadedUsers);
      },
      () => {
        // თუ წვდომა შეზღუდულია ან კოლექცია ცარიელია, დარჩება ცარიელი ან ავტორიზებული პროფილი
        setFirestoreUsers([]);
      }
    );

    return () => unsubscribeUsers();
  }, []);

  // ტოპ კრიტიკოსების დალაგება xp და reviewsCount კლებადობით (ან ავტორიზებული მომხმარებლის/ადმინის ჩვენება)
  useEffect(() => {
    const map = new Map<string, TopCritic>();

    firestoreUsers.forEach((u) => {
      map.set(u.uid, { ...u });
    });

    if (userProfile && !map.has(userProfile.uid)) {
      map.set(userProfile.uid, {
        uid: userProfile.uid,
        displayName: userProfile.displayName || 'ადმინისტრატორი',
        role: userProfile.role || 'viewer',
        voteWeight:
          typeof userProfile.voteWeight === 'number'
            ? userProfile.voteWeight
            : DEFAULT_ROLE_VOTE_WEIGHTS[userProfile.role || 'viewer'] ?? 1.0,
        xp: typeof userProfile.xp === 'number' ? userProfile.xp : 0,
        reviewsCount:
          typeof userProfile.reviewsCount === 'number'
            ? userProfile.reviewsCount
            : 0,
        helpfulVotesReceived:
          typeof userProfile.helpfulVotesReceived === 'number'
            ? userProfile.helpfulVotesReceived
            : 0,
      });
    }

    const reviewStatsByAuthor = new Map<
      string,
      { count: number; helpful: number }
    >();
    reviews.forEach((rev) => {
      if (!rev.authorId) return;
      const prev = reviewStatsByAuthor.get(rev.authorId) ?? {
        count: 0,
        helpful: 0,
      };
      reviewStatsByAuthor.set(rev.authorId, {
        count: prev.count + 1,
        helpful: prev.helpful + (rev.helpfulCount || 0),
      });
    });

    map.forEach((critic, uid) => {
      const stats = reviewStatsByAuthor.get(uid);
      if (stats) {
        critic.reviewsCount = Math.max(critic.reviewsCount, stats.count);
        critic.helpfulVotesReceived = Math.max(
          critic.helpfulVotesReceived,
          stats.helpful
        );
      }
    });

    const sorted = Array.from(map.values()).sort((a, b) => {
      if (b.xp !== a.xp) return b.xp - a.xp;
      if (b.reviewsCount !== a.reviewsCount) {
        return b.reviewsCount - a.reviewsCount;
      }
      return b.helpfulVotesReceived - a.helpfulVotesReceived;
    });

    setTopCritics(sorted);
  }, [firestoreUsers, userProfile, reviews]);

  // 2. Firestore real-time `onSnapshot` მოსმენა აქტიურ ტრეკზე (`tracks/{activeTrackId}`)
  const activeTrackId = session?.activeTrackId ?? null;

  useEffect(() => {
    if (!activeTrackId || activeTrackId.trim() === '') {
      setActiveTrack(null);
      setTrackLoading(false);
      return;
    }

    const localMatch = tracksQueueRef.current.find(
      (t) => t.id === activeTrackId
    );
    if (localMatch) {
      setActiveTrack(localMatch);
    }

    if (requireAuth && (!authReady || !isAuthenticated)) {
      setTrackLoading(false);
      return;
    }

    setTrackLoading(true);
    const trackPath = `tracks/${activeTrackId}`;
    const trackRef = doc(db, 'tracks', activeTrackId);

    const unsubscribeTrack = onSnapshot(
      trackRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Omit<Track, 'id'>;
          const ytFields = resolveTrackYouTubeFields(data);
          const firestoreTrack: Track = {
            ...data,
            id: snapshot.id,
            artistId: data.artistId || getArtistIdFromName(data.artist || ''),
            youtubeUrl: data.youtubeUrl || ytFields.youtubeUrl || undefined,
            youtubeId: data.youtubeId || ytFields.youtubeId || undefined,
          };
          setActiveTrack(firestoreTrack);
          setTracksQueue((prev) => {
            const exists = prev.some((item) => item.id === firestoreTrack.id);
            if (!exists) return [firestoreTrack, ...prev];
            return prev.map((item) =>
              item.id === firestoreTrack.id ? firestoreTrack : item
            );
          });
        } else {
          // თუ ტრეკი არ არსებობს Firestore-ში (მაგ. ძველი დემო ID), ვაუქმებთ აქტიურ ტრეკს
          setActiveTrack(null);
        }
        setTrackLoading(false);
      },
      (err) => {
        setTrackLoading(false);
        const normalizedError =
          err instanceof Error ? err : new Error(String(err));
        setError(normalizedError);
        try {
          handleFirestoreError(err, OperationType.GET, trackPath);
        } catch (handledErr) {
          setError(
            handledErr instanceof Error
              ? handledErr
              : new Error(String(handledErr))
          );
        }
      }
    );

    return () => {
      unsubscribeTrack();
    };
  }, [activeTrackId, requireAuth, authReady, isAuthenticated]);

  const buildTrackSnapshot = useCallback(
    (
      trackCandidate: Track | null,
      existingSnapshot?: LiveSession['activeTrackSnapshot']
    ): LiveSession['activeTrackSnapshot'] => {
      if (existingSnapshot && existingSnapshot.id) {
        const matchedFromQueue = tracksQueueRef.current.find(
          (t) => t.id === existingSnapshot.id
        );
        const yt = resolveTrackYouTubeFields(
          trackCandidate && trackCandidate.id === existingSnapshot.id
            ? trackCandidate
            : matchedFromQueue,
          existingSnapshot
        );
        return {
          id: existingSnapshot.id,
          title: (existingSnapshot.title || 'უსათაურო ტრეკი').slice(0, 120),
          artist: (existingSnapshot.artist || 'უცნობი არტისტი').slice(0, 120),
          coverUrl: (existingSnapshot.coverUrl || defaultCoverImg).slice(
            0,
            500
          ),
          genre: (existingSnapshot.genre || 'ქართული სცენა').slice(0, 60),
          youtubeUrl: yt.youtubeUrl,
          youtubeId: yt.youtubeId,
          expertScore: existingSnapshot.expertScore ?? null,
          expertTotalScore: existingSnapshot.expertTotalScore ?? null,
          communityTotalScore: existingSnapshot.communityTotalScore ?? null,
          communityVotesCount: existingSnapshot.communityVotesCount ?? 0,
          metaScore: existingSnapshot.metaScore ?? null,
        };
      }

      const resolvedTrack =
        trackCandidate ??
        tracksQueueRef.current.find(
          (t) => t.id === (session?.activeTrackId ?? '')
        ) ??
        null;

      if (resolvedTrack) {
        const yt = resolveTrackYouTubeFields(resolvedTrack, existingSnapshot);
        return {
          id: resolvedTrack.id,
          title: (resolvedTrack.title || 'უსათაურო ტრეკი').slice(0, 120),
          artist: (resolvedTrack.artist || 'უცნობი არტისტი').slice(0, 120),
          coverUrl: (resolvedTrack.coverUrl || defaultCoverImg).slice(0, 500),
          genre: (resolvedTrack.genre || 'ქართული სცენა').slice(0, 60),
          youtubeUrl: yt.youtubeUrl,
          youtubeId: yt.youtubeId,
          expertScore: resolvedTrack.expertScore ?? null,
          expertTotalScore: resolvedTrack.expertTotalScore ?? null,
          communityTotalScore: resolvedTrack.communityTotalScore ?? null,
          communityVotesCount: resolvedTrack.communityVotesCount ?? 0,
          metaScore: resolvedTrack.metaScore ?? null,
        };
      }

      return null;
    },
    [session?.activeTrackId]
  );

  const syncSessionToFirestore = useCallback(
    async (nextSession: LiveSession) => {
      if (!auth.currentUser) return;
      const activeRole = currentUserProfileRef.current?.role;
      const isAdminOrStreamer =
        auth.currentUser.email === 'hardsize@mail.ru' ||
        auth.currentUser.uid === '71d9n4gGrTUsC1Cy9Dc4Sb1RiZD2' ||
        activeRole === 'admin' ||
        activeRole === 'streamer';
      if (!isAdminOrStreamer) return;

      const sessionPath = `live_sessions/${sessionId}`;
      const candidateTrack =
        nextSession.activeTrackId === null
          ? null
          : activeTrack && activeTrack.id === nextSession.activeTrackId
            ? activeTrack
            : tracksQueueRef.current.find(
                (t) => t.id === nextSession.activeTrackId
              ) ?? null;
      const sanitizeSnapshot = (
        snap: LiveSession['activeTrackSnapshot']
      ): LiveSession['activeTrackSnapshot'] => {
        if (!snap || !snap.id) return null;
        const validExpertScore =
          snap.expertScore && isValidCriteriaScores(snap.expertScore)
            ? snap.expertScore
            : null;
        const validExpertTotal =
          typeof snap.expertTotalScore === 'number' &&
          snap.expertTotalScore >= 1 &&
          snap.expertTotalScore <= 10
            ? snap.expertTotalScore
            : null;
        const validCommunityTotal =
          typeof snap.communityTotalScore === 'number' &&
          snap.communityTotalScore >= 1 &&
          snap.communityTotalScore <= 10
            ? snap.communityTotalScore
            : null;
        const validMeta =
          typeof snap.metaScore === 'number' &&
          snap.metaScore >= 0 &&
          snap.metaScore <= 100
            ? snap.metaScore
            : null;
        return {
          id: String(snap.id)
            .replace(/[^a-zA-Z0-9_\-]/g, '_')
            .slice(0, 128),
          title: (snap.title || 'უსათაურო ტრეკი').slice(0, 120),
          artist: (snap.artist || 'უცნობი არტისტი').slice(0, 120),
          coverUrl: (snap.coverUrl || defaultCoverImg).slice(0, 500),
          genre: (snap.genre || 'ქართული სცენა').slice(0, 60),
          youtubeUrl: (snap.youtubeUrl || '').slice(0, 500),
          youtubeId: (snap.youtubeId || '').slice(0, 64),
          expertScore: validExpertScore,
          expertTotalScore: validExpertTotal,
          communityTotalScore: validCommunityTotal,
          communityVotesCount:
            typeof snap.communityVotesCount === 'number' &&
            snap.communityVotesCount >= 0
              ? snap.communityVotesCount
              : 0,
          metaScore: validMeta,
        };
      };

      const rawSnapshot =
        nextSession.activeTrackId === null && !nextSession.activeTrackSnapshot
          ? null
          : buildTrackSnapshot(candidateTrack, nextSession.activeTrackSnapshot);
      const resolvedSnapshot = sanitizeSnapshot(rawSnapshot);
      const sessionYoutubeUrl = (
        resolvedSnapshot?.youtubeUrl ??
        nextSession.youtubeUrl ??
        ''
      ).slice(0, 500);
      const sessionYoutubeId = (
        resolvedSnapshot?.youtubeId ??
        nextSession.youtubeId ??
        ''
      ).slice(0, 64);
      const resolvedStreamKey = (
        nextSession.streamKey ||
        session?.streamKey ||
        generateRandomStreamKey()
      )
        .trim()
        .slice(0, 128);
      const safeHostId =
        (auth.currentUser?.uid || nextSession.hostId || 'streamer_host')
          .replace(/[^a-zA-Z0-9_\-]/g, '_')
          .slice(0, 128) || 'streamer_host';
      const safeActiveTrackId =
        nextSession.activeTrackId ?? resolvedSnapshot?.id ?? null;

      try {
        await setDoc(doc(db, 'live_sessions', sessionId), {
          id: sessionId,
          isLive: Boolean(nextSession.isLive),
          streamStatus: nextSession.streamStatus || 'idle',
          activeTrackId: safeActiveTrackId
            ? String(safeActiveTrackId).slice(0, 128)
            : null,
          activeTrackSnapshot: resolvedSnapshot,
          youtubeUrl: sessionYoutubeUrl,
          youtubeId: sessionYoutubeId,
          showVideoInOverlay: Boolean(nextSession.showVideoInOverlay ?? true),
          streamKey: resolvedStreamKey,
          hostId: safeHostId,
          title: (
            nextSession.title || 'ქართული რელიზების ლაივ-განხილვა'
          ).slice(0, 140),
          votingOpen: Boolean(nextSession.votingOpen),
          isPlaying: Boolean(nextSession.isPlaying ?? true),
          isMuted: Boolean(nextSession.isMuted ?? false),
          playbackPosition:
            typeof nextSession.playbackPosition === 'number' &&
            nextSession.playbackPosition >= 0
              ? Math.min(86400, nextSession.playbackPosition)
              : 0,
          showObsOverlay: Boolean(nextSession.showObsOverlay ?? true),
          obsTheme:
            nextSession.obsTheme &&
            ['dark', 'neon', 'minimal', 'compact'].includes(nextSession.obsTheme)
              ? nextSession.obsTheme
              : 'dark',
          liveExpertDraft:
            nextSession.liveExpertDraft &&
            isValidCriteriaScores(nextSession.liveExpertDraft)
              ? nextSession.liveExpertDraft
              : null,
          viewersCount:
            typeof nextSession.viewersCount === 'number' &&
            nextSession.viewersCount >= 0
              ? nextSession.viewersCount
              : 1,
          updatedAt: serverTimestamp(),
        });
        setIsFirestoreSynced(true);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, sessionPath);
        } catch {
          // logged by handleFirestoreError
        }
      }
    },
    [sessionId, activeTrack, session?.streamKey, buildTrackSnapshot]
  );

  // თუ სესიაში streamKey არ არსებობს, პირველივე გაშვებისას (სტრიმერის/ადმინის მიერ) ავტომატურად დავაგენერიროთ
  const streamKeyInitRef = useRef<boolean>(false);
  useEffect(() => {
    if (sessionLoading || authLoading || !isFirestoreSynced) return;
    const role = currentUserProfile?.role;
    const isAdminOrStreamer =
      auth.currentUser?.email === 'hardsize@mail.ru' ||
      role === 'admin' ||
      role === 'streamer';
    if (!isAdminOrStreamer) return;

    if (!session?.streamKey || !session.streamKey.trim()) {
      if (streamKeyInitRef.current) return;
      streamKeyInitRef.current = true;
      const generatedKey = generateRandomStreamKey();
      const nextSession: LiveSession = {
        ...(session ?? INITIAL_LIVE_SESSION),
        streamKey: generatedKey,
        updatedAt: Date.now(),
      };
      setSession(nextSession);
      void syncSessionToFirestore(nextSession);
    } else {
      streamKeyInitRef.current = false;
    }
  }, [
    sessionLoading,
    authLoading,
    isFirestoreSynced,
    currentUserProfile?.role,
    session,
    syncSessionToFirestore,
  ]);

  const syncTrackToFirestore = useCallback(
    async (track: Track, isCreate: boolean = false) => {
      if (!auth.currentUser) return;
      const trackPath = `tracks/${track.id}`;
      try {
        await ensureUserProfileInFirestore(
          auth.currentUser.uid,
          auth.currentUser.displayName,
          auth.currentUser.email
        );
        const trackRef = doc(db, 'tracks', track.id);
        let shouldSetCreatedAt = isCreate;
        let existingSubmittedBy: string | null = null;
        if (!isCreate) {
          const existingSnap = await getDoc(trackRef);
          if (!existingSnap.exists()) {
            shouldSetCreatedAt = true;
          } else {
            const existingData = existingSnap.data();
            if (typeof existingData?.submittedBy === 'string') {
              existingSubmittedBy = existingData.submittedBy;
            }
          }
        }

        const ytFields = resolveTrackYouTubeFields(track);
        const payload: Record<string, unknown> = {
          id: track.id,
          title: track.title.slice(0, 120),
          artist: track.artist.slice(0, 120),
          artistId: track.artistId || getArtistIdFromName(track.artist),
          coverUrl: (track.coverUrl || defaultCoverImg).slice(0, 500),
          audioUrl: (
            track.audioUrl || 'https://soundcheck.live/audio/stream.mp3'
          ).slice(0, 500),
          sourceUrl: (track.sourceUrl || 'https://open.spotify.com').slice(
            0,
            500
          ),
          youtubeUrl: ytFields.youtubeUrl,
          youtubeId: ytFields.youtubeId,
          genre: (track.genre || 'ქართული სცენა').slice(0, 60),
          duration: track.duration ?? 210,
          submittedBy: existingSubmittedBy ?? auth.currentUser.uid,
          submittedByName: (
            auth.currentUser.displayName ||
            track.submittedByName ||
            'მუსიკოსი'
          ).slice(0, 80),
          isPriority: Boolean(track.isPriority),
          status: track.status,
          expertScore: track.expertScore ?? null,
          expertTotalScore: track.expertTotalScore ?? null,
          communityScore: track.communityScore ?? null,
          communityTotalScore: track.communityTotalScore ?? null,
          communityVotesCount: track.communityVotesCount ?? 0,
          metaScore: track.metaScore ?? null,
          updatedAt: serverTimestamp(),
        };
        if (shouldSetCreatedAt) {
          payload.createdAt = serverTimestamp();
        }
        await setDoc(trackRef, payload, {
          merge: !shouldSetCreatedAt,
        });
      } catch (err) {
        try {
          handleFirestoreError(
            err,
            isCreate ? OperationType.CREATE : OperationType.UPDATE,
            trackPath
          );
        } catch {
          // logged by handleFirestoreError
        }
      }
    },
    []
  );

  const updateDraftScores = useCallback(
    async (draft: CriteriaScores) => {
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const snapshot = buildTrackSnapshot(
        activeTrack,
        currentSession.activeTrackSnapshot
      );
      const nextSession: LiveSession = {
        ...currentSession,
        activeTrackSnapshot: snapshot,
        liveExpertDraft: draft,
        updatedAt: Date.now(),
      };
      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: tracksQueue,
        reviews,
        critics: topCritics,
      });

      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
      }
      draftDebounceRef.current = setTimeout(() => {
        draftDebounceRef.current = null;
        void syncSessionToFirestore(nextSession);
      }, 120);
    },
    [
      session,
      activeTrack,
      tracksQueue,
      reviews,
      topCritics,
      buildTrackSnapshot,
      syncSessionToFirestore,
    ]
  );

  const updateStreamStatus = useCallback(
    async (status: LiveStreamStatus) => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const snapshot = buildTrackSnapshot(
        activeTrack,
        currentSession.activeTrackSnapshot
      );
      const nextSession: LiveSession = {
        ...currentSession,
        streamStatus: status,
        isLive: status !== 'idle',
        votingOpen: status === 'listening',
        activeTrackSnapshot: snapshot,
        updatedAt: Date.now(),
      };
      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: tracksQueue,
        reviews,
        critics: topCritics,
      });
      await syncSessionToFirestore(nextSession);
    },
    [
      session,
      activeTrack,
      tracksQueue,
      reviews,
      topCritics,
      buildTrackSnapshot,
      syncSessionToFirestore,
    ]
  );

  const lockInVerdict = useCallback(
    async (finalScores: CriteriaScores) => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const expertAvg = calculateAverageScore(finalScores);
      const currentTrack =
        activeTrack ??
        tracksQueue.find((t) => t.id === currentSession.activeTrackId) ??
        null;

      const communityScores = currentTrack?.communityScore ?? null;
      const computedMeta =
        calculateMetaScore(finalScores, communityScores) ??
        Math.round(expertAvg * 10);

      let updatedTracks = tracksQueue;
      let updatedActiveTrack: Track | null = currentTrack;

      if (currentTrack) {
        updatedActiveTrack = {
          ...currentTrack,
          status: 'reviewed',
          expertScore: finalScores,
          expertTotalScore: expertAvg,
          metaScore: computedMeta,
          updatedAt: Date.now(),
        };
        updatedTracks = tracksQueue.map((t) =>
          t.id === currentTrack.id ? updatedActiveTrack! : t
        );
        setActiveTrack(updatedActiveTrack);
        setTracksQueue(updatedTracks);
        if (auth.currentUser) {
          try {
            await updateDoc(doc(db, 'tracks', currentTrack.id), {
              status: 'reviewed',
              expertScore: finalScores,
              expertTotalScore: expertAvg,
              metaScore: computedMeta,
              updatedAt: serverTimestamp(),
            });
          } catch {
            void syncTrackToFirestore(updatedActiveTrack, false);
          }
        }
      }

      const verdictYt = resolveTrackYouTubeFields(
        updatedActiveTrack,
        currentSession.activeTrackSnapshot
      );

      const nextSession: LiveSession = {
        ...currentSession,
        streamStatus: 'revealed',
        votingOpen: false,
        liveExpertDraft: finalScores,
        youtubeUrl: verdictYt.youtubeUrl,
        youtubeId: verdictYt.youtubeId,
        activeTrackSnapshot: updatedActiveTrack
          ? {
              id: updatedActiveTrack.id,
              title: updatedActiveTrack.title,
              artist: updatedActiveTrack.artist,
              coverUrl: updatedActiveTrack.coverUrl,
              genre: updatedActiveTrack.genre,
              youtubeUrl: verdictYt.youtubeUrl,
              youtubeId: verdictYt.youtubeId,
              expertScore: finalScores,
              expertTotalScore: expertAvg,
              communityTotalScore:
                updatedActiveTrack.communityTotalScore ?? null,
              communityVotesCount:
                updatedActiveTrack.communityVotesCount ?? 0,
              metaScore: computedMeta,
            }
          : currentSession.activeTrackSnapshot,
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });
      await syncSessionToFirestore(nextSession);
    },
    [
      session,
      activeTrack,
      tracksQueue,
      reviews,
      topCritics,
      syncSessionToFirestore,
      syncTrackToFirestore,
    ]
  );

  /**
   * ახალი ტრეკის წარდგენა მომხმარებლის / მუსიკოსის მიერ
   * (`community_catalog` — პირდაპირ კატალოგში ან `in_queue` — სტრიმის რიგში)
   */
  const submitNewTrack = useCallback(
    async (input: SubmitNewTrackInput): Promise<Track> => {
      const cleanId = `track_${Date.now()}`;
      const cleanArtist = input.artist.trim().slice(0, 120);
      const cleanTitle = input.title.trim().slice(0, 120);
      const cleanGenre = (input.genre || 'ქართული სცენა').trim().slice(0, 60);
      const cleanSourceUrl = input.sourceUrl.trim().slice(0, 500);
      const cleanCoverUrl =
        (input.coverUrl ?? '').trim().slice(0, 500) || defaultCoverImg;

      const status: TrackStatus = input.destinationStatus;
      const ytFields = resolveTrackYouTubeFields({
        sourceUrl: cleanSourceUrl,
        audioUrl: cleanSourceUrl,
      });

      const newTrack: Track = {
        id: cleanId,
        title: cleanTitle,
        artist: cleanArtist,
        artistId: getArtistIdFromName(cleanArtist),
        coverUrl: cleanCoverUrl,
        audioUrl: cleanSourceUrl || 'https://soundcheck.live/audio/stream.mp3',
        sourceUrl: cleanSourceUrl,
        youtubeUrl: ytFields.youtubeUrl || undefined,
        youtubeId: ytFields.youtubeId || undefined,
        genre: cleanGenre,
        duration: 210,
        submittedBy: auth.currentUser?.uid ?? 'musician_user',
        submittedByName:
          auth.currentUser?.displayName ?? 'ქართველი მუსიკოსი',
        isPriority: false,
        status,
        expertScore: null,
        expertTotalScore: null,
        communityScore: null,
        communityTotalScore: null,
        communityVotesCount: 0,
        metaScore: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const updatedTracks = [newTrack, ...tracksQueue];
      setTracksQueue(updatedTracks);

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      broadcastStateUpdate({
        session: currentSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });

      await syncTrackToFirestore(newTrack, true);
      return newTrack;
    },
    [tracksQueue, session, reviews, topCritics, syncTrackToFirestore]
  );

  const addAndActivateTrack = useCallback(
    async (input: {
      title: string;
      artist: string;
      coverUrl: string;
      genre?: string;
      youtubeUrl?: string;
      audioUrl?: string;
      sourceUrl?: string;
    }): Promise<Track> => {
      const cleanId = `track_${Date.now()}`;
      const defaultDraft: CriteriaScores = {
        lyrics: 8.0,
        flow: 8.0,
        production: 8.0,
        identity: 8.0,
        vibe: 8.0,
      };

      const cleanArtist = input.artist.trim().slice(0, 120);
      const rawCandidateUrl = (
        input.youtubeUrl ||
        input.sourceUrl ||
        input.audioUrl ||
        ''
      )
        .trim()
        .slice(0, 500);
      const extractedYoutubeId = extractYouTubeId(rawCandidateUrl) || '';
      const resolvedYoutubeUrl = extractedYoutubeId
        ? rawCandidateUrl
        : (input.youtubeUrl || '').trim().slice(0, 500);

      const cleanAudioUrl =
        (input.audioUrl || input.sourceUrl || input.youtubeUrl || '')
          .trim()
          .slice(0, 500) || 'https://soundcheck.live/audio/stream.mp3';
      const cleanSourceUrl = (
        input.sourceUrl ||
        input.youtubeUrl ||
        input.audioUrl ||
        ''
      )
        .trim()
        .slice(0, 500);
      const newTrack: Track = {
        id: cleanId,
        title: input.title.trim().slice(0, 120),
        artist: cleanArtist,
        artistId: getArtistIdFromName(cleanArtist),
        coverUrl: input.coverUrl.trim() || defaultCoverImg,
        audioUrl: cleanAudioUrl,
        sourceUrl: cleanSourceUrl || undefined,
        youtubeUrl: resolvedYoutubeUrl || undefined,
        youtubeId: extractedYoutubeId || undefined,
        genre: (input.genre || 'ქართული სცენა').trim().slice(0, 60),
        duration: 205,
        submittedBy: auth.currentUser?.uid ?? 'streamer_host',
        submittedByName: auth.currentUser?.displayName ?? 'სტუდია',
        isPriority: true,
        status: 'on_air',
        expertScore: null,
        expertTotalScore: null,
        communityScore: null,
        communityTotalScore: null,
        communityVotesCount: 0,
        metaScore: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const previousOnAirTracks = tracksQueue.filter(
        (t) => t.status === 'on_air'
      );

      const updatedTracks = [
        newTrack,
        ...tracksQueue.map((t) =>
          t.status === 'on_air'
            ? {
                ...t,
                status: (t.expertScore
                  ? 'reviewed'
                  : 'community_catalog') as TrackStatus,
              }
            : t
        ),
      ];
      setTracksQueue(updatedTracks);
      setActiveTrack(newTrack);

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const nextSession: LiveSession = {
        ...currentSession,
        isLive: true,
        streamStatus: 'listening',
        votingOpen: true,
        isPlaying: true,
        isMuted: Boolean(currentSession.isMuted ?? false),
        activeTrackId: newTrack.id,
        youtubeUrl: resolvedYoutubeUrl,
        youtubeId: extractedYoutubeId,
        showVideoInOverlay: currentSession.showVideoInOverlay ?? true,
        liveExpertDraft: defaultDraft,
        activeTrackSnapshot: {
          id: newTrack.id,
          title: newTrack.title,
          artist: newTrack.artist,
          coverUrl: newTrack.coverUrl,
          genre: newTrack.genre,
          youtubeUrl: resolvedYoutubeUrl,
          youtubeId: extractedYoutubeId,
          expertScore: null,
          expertTotalScore: null,
          communityTotalScore: null,
          communityVotesCount: 0,
          metaScore: null,
        },
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });

      if (auth.currentUser) {
        for (const prevTrack of previousOnAirTracks) {
          const nextStatus: TrackStatus = prevTrack.expertScore
            ? 'reviewed'
            : 'community_catalog';
          try {
            await updateDoc(doc(db, 'tracks', prevTrack.id), {
              status: nextStatus,
              updatedAt: serverTimestamp(),
            });
          } catch {
            // ignore if previous track no longer exists
          }
        }
      }
      await syncTrackToFirestore(newTrack, true);
      await syncSessionToFirestore(nextSession);
      return newTrack;
    },
    [
      session,
      tracksQueue,
      reviews,
      topCritics,
      syncSessionToFirestore,
      syncTrackToFirestore,
    ]
  );

  /**
   * ერთი კლიკით გადააქვს არჩეული ტრეკი მიმდინარე ლაივ-სესიის `activeTrackId`-ში,
   * ავტომატურად იღებს `youtubeId`-ს `track.youtubeUrl`-იდან (ან `sourceUrl`/`audioUrl`-იდან)
   * და ინახავს `youtubeUrl`-სა და `youtubeId`-ს `activeTrackSnapshot`-ში (`live_sessions/current`).
   */
  const launchTrackOnAir = useCallback(
    async (trackOrId: string | Track) => {
      const targetId =
        typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
      const fromQueue = tracksQueue.find((t) => t.id === targetId);
      const target: Track | undefined =
        typeof trackOrId === 'string'
          ? fromQueue
          : { ...(fromQueue ?? {}), ...trackOrId };
      if (!target) return;

      const ytFields = resolveTrackYouTubeFields(target);

      const updatedTarget: Track = {
        ...target,
        youtubeUrl: ytFields.youtubeUrl || target.youtubeUrl,
        youtubeId: ytFields.youtubeId || target.youtubeId,
        status: 'on_air',
        updatedAt: Date.now(),
      };

      const previousOnAirTracks = tracksQueue.filter(
        (t) => t.id !== targetId && t.status === 'on_air'
      );

      const existsInQueue = tracksQueue.some((t) => t.id === targetId);
      const updatedTracks: Track[] = existsInQueue
        ? tracksQueue.map((t) => {
            if (t.id === targetId) return updatedTarget;
            if (t.status === 'on_air') {
              return {
                ...t,
                status: t.expertScore ? 'reviewed' : 'community_catalog',
              };
            }
            return t;
          })
        : [
            updatedTarget,
            ...tracksQueue.map((t) =>
              t.status === 'on_air'
                ? {
                    ...t,
                    status: (t.expertScore
                      ? 'reviewed'
                      : 'community_catalog') as TrackStatus,
                  }
                : t
            ),
          ];

      setTracksQueue(updatedTracks);
      setActiveTrack(updatedTarget);

      const nextDraft: CriteriaScores =
        updatedTarget.expertScore ??
        session?.liveExpertDraft ??
        INITIAL_CRITERIA_SCORES;

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const nextSession: LiveSession = {
        ...currentSession,
        isLive: true,
        activeTrackId: updatedTarget.id,
        youtubeUrl: ytFields.youtubeUrl,
        youtubeId: ytFields.youtubeId,
        showVideoInOverlay: currentSession.showVideoInOverlay ?? true,
        isPlaying: true,
        isMuted: Boolean(currentSession.isMuted ?? false),
        streamStatus: updatedTarget.expertScore ? 'revealed' : 'listening',
        votingOpen: !updatedTarget.expertScore,
        liveExpertDraft: nextDraft,
        activeTrackSnapshot: {
          id: updatedTarget.id,
          title: updatedTarget.title,
          artist: updatedTarget.artist,
          coverUrl: updatedTarget.coverUrl,
          genre: updatedTarget.genre,
          youtubeUrl: ytFields.youtubeUrl,
          youtubeId: ytFields.youtubeId,
          expertScore: updatedTarget.expertScore,
          expertTotalScore: updatedTarget.expertTotalScore ?? null,
          communityTotalScore: updatedTarget.communityTotalScore ?? null,
          communityVotesCount: updatedTarget.communityVotesCount,
          metaScore: updatedTarget.metaScore,
        },
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });

      if (auth.currentUser) {
        for (const prevTrack of previousOnAirTracks) {
          const nextStatus: TrackStatus = prevTrack.expertScore
            ? 'reviewed'
            : 'community_catalog';
          try {
            await updateDoc(doc(db, 'tracks', prevTrack.id), {
              status: nextStatus,
              updatedAt: serverTimestamp(),
            });
          } catch {
            // ignore
          }
        }
        try {
          await updateDoc(doc(db, 'tracks', updatedTarget.id), {
            status: 'on_air',
            updatedAt: serverTimestamp(),
          });
        } catch {
          await syncTrackToFirestore(updatedTarget, false);
        }
      }
      await syncSessionToFirestore(nextSession);
    },
    [
      session,
      tracksQueue,
      reviews,
      topCritics,
      syncTrackToFirestore,
      syncSessionToFirestore,
    ]
  );

  const selectActiveTrack = useCallback(
    async (trackOrId: string | Track) => {
      await launchTrackOnAir(trackOrId);
    },
    [launchTrackOnAir]
  );

  const updateCommunityPrediction = useCallback(
    async (communityAvg: number) => {
      const rounded = Math.round(communityAvg * 10) / 10;
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const currentTrack = activeTrack;

      let updatedTracks = tracksQueue;
      if (currentTrack) {
        const updatedTrack: Track = {
          ...currentTrack,
          communityTotalScore: rounded,
          communityVotesCount: (currentTrack.communityVotesCount || 0) + 1,
          updatedAt: Date.now(),
        };
        setActiveTrack(updatedTrack);
        updatedTracks = tracksQueue.map((t) =>
          t.id === currentTrack.id ? updatedTrack : t
        );
        setTracksQueue(updatedTracks);
      }

      const nextSession: LiveSession = {
        ...currentSession,
        activeTrackSnapshot: currentSession.activeTrackSnapshot
          ? {
              ...currentSession.activeTrackSnapshot,
              communityTotalScore: rounded,
            }
          : null,
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });
      await syncSessionToFirestore(nextSession);
    },
    [
      session,
      activeTrack,
      tracksQueue,
      reviews,
      topCritics,
      syncSessionToFirestore,
    ]
  );

  const submitTrackReview = useCallback(
    async (input: SubmitReviewInput): Promise<TrackReview> => {
      const targetTrack = tracksQueue.find((t) => t.id === input.trackId);
      if (!targetTrack) {
        throw new Error('ტრეკი ვერ მოიძებნა');
      }

      const activeProfile = currentUserProfileRef.current ?? currentUserProfile;
      const role: UserRole = activeProfile?.role ?? 'viewer';
      const voteWeight: number =
        typeof activeProfile?.voteWeight === 'number'
          ? activeProfile.voteWeight
          : DEFAULT_ROLE_VOTE_WEIGHTS[role] ?? 1.0;
      const reviewAvg = calculateAverageScore(input.scores);
      const reviewId = `rev_${Date.now()}`;
      const authorId = auth.currentUser?.uid ?? `user_${Date.now()}`;
      const cleanAuthorName =
        input.authorName.trim().slice(0, 80) ||
        activeProfile?.displayName ||
        auth.currentUser?.displayName ||
        'მელომანი';

      const newReview: TrackReview = {
        id: reviewId,
        trackId: targetTrack.id,
        trackTitle: targetTrack.title,
        trackArtist: targetTrack.artist,
        trackCoverUrl: targetTrack.coverUrl,
        authorId,
        authorName: cleanAuthorName,
        authorRole: role,
        voteWeight,
        scores: input.scores,
        totalScore: reviewAvg,
        text: input.text.trim().slice(0, 3000),
        helpfulCount: 1,
        helpfulVoterIds: [authorId],
        createdAt: Date.now(),
      };

      const recalculated = computeUpdatedCommunityScores(
        targetTrack,
        input.scores,
        voteWeight
      );

      const updatedTrack: Track = {
        ...targetTrack,
        communityScore: recalculated.communityScore,
        communityTotalScore: recalculated.communityTotalScore,
        communityVotesCount: recalculated.communityVotesCount,
        metaScore: recalculated.metaScore,
        updatedAt: Date.now(),
      };

      const nextTracks = tracksQueue.map((t) =>
        t.id === updatedTrack.id ? updatedTrack : t
      );
      const nextReviews = [newReview, ...reviews];

      setTracksQueue(nextTracks);
      setReviews(nextReviews);
      if (activeTrack?.id === updatedTrack.id) {
        setActiveTrack(updatedTrack);
      }

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const reviewYt = resolveTrackYouTubeFields(
        updatedTrack,
        currentSession.activeTrackSnapshot
      );
      const nextSession: LiveSession =
        currentSession.activeTrackId === updatedTrack.id
          ? {
              ...currentSession,
              youtubeUrl: reviewYt.youtubeUrl,
              youtubeId: reviewYt.youtubeId,
              activeTrackSnapshot: {
                id: updatedTrack.id,
                title: updatedTrack.title,
                artist: updatedTrack.artist,
                coverUrl: updatedTrack.coverUrl,
                genre: updatedTrack.genre,
                youtubeUrl: reviewYt.youtubeUrl,
                youtubeId: reviewYt.youtubeId,
                expertScore: updatedTrack.expertScore,
                expertTotalScore: updatedTrack.expertTotalScore ?? null,
                communityTotalScore: updatedTrack.communityTotalScore ?? null,
                communityVotesCount: updatedTrack.communityVotesCount,
                metaScore: updatedTrack.metaScore,
              },
              updatedAt: Date.now(),
            }
          : currentSession;

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: nextTracks,
        reviews: nextReviews,
      });

      if (auth.currentUser) {
        await ensureUserProfileInFirestore(
          auth.currentUser.uid,
          auth.currentUser.displayName,
          auth.currentUser.email
        );
        const trackPath = `tracks/${targetTrack.id}`;
        const trackRef = doc(db, 'tracks', targetTrack.id);

        const reviewPath = `tracks/${targetTrack.id}/reviews/${reviewId}`;
        try {
          await setDoc(
            doc(collection(db, 'tracks', targetTrack.id, 'reviews'), reviewId),
            {
              id: reviewId,
              trackId: targetTrack.id,
              authorId: auth.currentUser.uid,
              authorName: cleanAuthorName,
              authorRole: role,
              voteWeight,
              scores: input.scores,
              totalScore: reviewAvg,
              text: newReview.text,
              helpfulCount: 1,
              createdAt: serverTimestamp(),
            }
          );
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.CREATE, reviewPath);
          } catch {
            // logged by handleFirestoreError
          }
        }

        // ხელახლა გადავითვალოთ შეწონილი რეიტინგი პირდაპირ `tracks/{id}/reviews` ქვეკოლექციის დოკუმენტებიდან
        try {
          const allReviewsSnap = await getDocs(
            collection(db, 'tracks', targetTrack.id, 'reviews')
          );
          const allReviewDocs = allReviewsSnap.docs.map((d) => {
            const data = d.data();
            return {
              scores: (data.scores as CriteriaScores) || input.scores,
              voteWeight:
                typeof data.voteWeight === 'number' ? data.voteWeight : 1.0,
              totalScore:
                typeof data.totalScore === 'number'
                  ? data.totalScore
                  : reviewAvg,
            };
          });

          const exactRecalculated =
            allReviewDocs.length > 0
              ? recalculateCommunityScoresFromReviews(
                  allReviewDocs,
                  targetTrack.expertScore
                )
              : {
                  ...recalculated,
                  peopleScore: recalculated.communityTotalScore,
                  reviewsCount: recalculated.communityVotesCount,
                };

          await updateDoc(trackRef, {
            communityScore: exactRecalculated.communityScore,
            communityTotalScore: exactRecalculated.communityTotalScore,
            peopleScore: exactRecalculated.peopleScore,
            communityVotesCount: exactRecalculated.communityVotesCount,
            reviewsCount: exactRecalculated.reviewsCount,
            metaScore: exactRecalculated.metaScore,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.UPDATE, trackPath);
          } catch {
            // logged by handleFirestoreError
          }
        }

        // განვაახლოთ კრიტიკოსის XP და რეცენზიების მრიცხველი `/users/{uid}` დოკუმენტში
        try {
          const userRef = doc(db, 'users', auth.currentUser.uid);
          await updateDoc(userRef, {
            xp: increment(120),
            reviewsCount: increment(1),
            helpfulVotesReceived: increment(1),
            updatedAt: serverTimestamp(),
          });
        } catch {
          // ignore if user profile update is restricted
        }
      }

      return newReview;
    },
    [tracksQueue, reviews, activeTrack?.id, session, currentUserProfile]
  );

  const deleteTrack = useCallback(
    async (trackId: string) => {
      if (!trackId) return;
      const trackPath = `tracks/${trackId}`;
      try {
        await deleteDoc(doc(db, 'tracks', trackId));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.DELETE, trackPath);
        } catch {
          // logged by handleFirestoreError
        }
        throw err;
      }

      const nextTracks = tracksQueue.filter((t) => t.id !== trackId);
      const nextReviews = reviews.filter((r) => r.trackId !== trackId);
      setTracksQueue(nextTracks);
      setReviews(nextReviews);

      if (activeTrack?.id === trackId) {
        setActiveTrack(null);
      }

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      if (currentSession.activeTrackId === trackId) {
        const nextSession: LiveSession = {
          ...currentSession,
          isLive: false,
          streamStatus: 'idle',
          votingOpen: false,
          activeTrackId: null,
          activeTrackSnapshot: null,
          youtubeUrl: '',
          youtubeId: '',
          updatedAt: Date.now(),
        };
        setSession(nextSession);
        broadcastStateUpdate({
          session: nextSession,
          tracks: nextTracks,
          reviews: nextReviews,
        });
        await syncSessionToFirestore(nextSession);
      } else {
        broadcastStateUpdate({
          session: currentSession,
          tracks: nextTracks,
          reviews: nextReviews,
        });
      }
    },
    [tracksQueue, reviews, activeTrack?.id, session, syncSessionToFirestore]
  );

  const deleteTrackReview = useCallback(
    async (trackId: string, reviewId: string) => {
      if (!trackId || !reviewId) return;
      const reviewPath = `tracks/${trackId}/reviews/${reviewId}`;
      try {
        await deleteDoc(doc(db, 'tracks', trackId, 'reviews', reviewId));
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.DELETE, reviewPath);
        } catch {
          // logged by handleFirestoreError
        }
        throw err;
      }

      const remainingSnap = await getDocs(
        collection(db, 'tracks', trackId, 'reviews')
      );
      const remainingFromFirestore = remainingSnap.docs
        .filter((d) => d.id !== reviewId)
        .map((d) => {
          const data = d.data();
          return {
            scores: (data.scores as CriteriaScores) || INITIAL_CRITERIA_SCORES,
            voteWeight:
              typeof data.voteWeight === 'number' ? data.voteWeight : 1.0,
            totalScore:
              typeof data.totalScore === 'number' ? data.totalScore : 8.0,
          };
        });

      const nextReviews = reviews.filter((r) => r.id !== reviewId);
      setReviews(nextReviews);

      const targetTrack = tracksQueue.find((t) => t.id === trackId);
      if (targetTrack) {
        const recalculated = recalculateCommunityScoresFromReviews(
          remainingFromFirestore,
          targetTrack.expertScore
        );
        const updatedTrack: Track = {
          ...targetTrack,
          communityScore: recalculated.communityScore,
          communityTotalScore: recalculated.communityTotalScore,
          peopleScore: recalculated.peopleScore,
          communityVotesCount: recalculated.communityVotesCount,
          reviewsCount: recalculated.reviewsCount,
          metaScore: recalculated.metaScore,
          updatedAt: Date.now(),
        };

        const nextTracks = tracksQueue.map((t) =>
          t.id === trackId ? updatedTrack : t
        );
        setTracksQueue(nextTracks);
        if (activeTrack?.id === trackId) {
          setActiveTrack(updatedTrack);
        }

        try {
          await updateDoc(doc(db, 'tracks', trackId), {
            communityScore: recalculated.communityScore,
            communityTotalScore: recalculated.communityTotalScore,
            peopleScore: recalculated.peopleScore,
            communityVotesCount: recalculated.communityVotesCount,
            reviewsCount: recalculated.reviewsCount,
            metaScore: recalculated.metaScore,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.UPDATE, `tracks/${trackId}`);
          } catch {
            // logged by handleFirestoreError
          }
        }
      }
    },
    [reviews, tracksQueue, activeTrack?.id]
  );

  const toggleReviewHelpful = useCallback(
    async (reviewId: string, explicitTrackId?: string) => {
      const voterId = auth.currentUser?.uid ?? 'local_visitor';
      let targetTrackId: string | null = explicitTrackId ?? null;
      let delta = 1;

      const nextReviews = reviews.map((rev) => {
        if (rev.id !== reviewId) return rev;
        targetTrackId = rev.trackId;
        const voters = rev.helpfulVoterIds ?? [];
        const alreadyVoted = voters.includes(voterId);
        delta = alreadyVoted ? -1 : 1;
        return {
          ...rev,
          helpfulCount: Math.max(0, rev.helpfulCount + delta),
          helpfulVoterIds: alreadyVoted
            ? voters.filter((id) => id !== voterId)
            : [...voters, voterId],
        };
      });

      setReviews(nextReviews);
      broadcastStateUpdate({
        session: session ?? INITIAL_LIVE_SESSION,
        tracks: tracksQueue,
        reviews: nextReviews,
      });

      if (auth.currentUser && targetTrackId && delta === 1) {
        const reviewPath = `tracks/${targetTrackId}/reviews/${reviewId}`;
        try {
          await updateDoc(
            doc(db, 'tracks', targetTrackId, 'reviews', reviewId),
            {
              helpfulCount: increment(1),
            }
          );
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.UPDATE, reviewPath);
          } catch {
            // logged by handleFirestoreError
          }
        }
      }
    },
    [reviews, session, tracksQueue]
  );

  const updateObsSettings = useCallback(
    async (settings: {
      showObsOverlay?: boolean;
      showVideoInOverlay?: boolean;
      isPlaying?: boolean;
      isMuted?: boolean;
      streamKey?: string;
      obsTheme?: 'dark' | 'neon' | 'minimal' | 'compact';
    }) => {
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const snapshot = buildTrackSnapshot(
        activeTrack,
        currentSession.activeTrackSnapshot
      );
      const nextSession: LiveSession = {
        ...currentSession,
        showObsOverlay:
          settings.showObsOverlay ?? currentSession.showObsOverlay ?? true,
        showVideoInOverlay:
          settings.showVideoInOverlay ??
          currentSession.showVideoInOverlay ??
          true,
        isPlaying:
          settings.isPlaying ?? currentSession.isPlaying ?? true,
        isMuted:
          settings.isMuted ?? currentSession.isMuted ?? false,
        streamKey:
          settings.streamKey ??
          currentSession.streamKey ??
          generateRandomStreamKey(),
        obsTheme: settings.obsTheme ?? currentSession.obsTheme ?? 'dark',
        activeTrackSnapshot: snapshot,
        updatedAt: Date.now(),
      };
      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: tracksQueue,
        reviews,
        critics: topCritics,
      });
      await syncSessionToFirestore(nextSession);
    },
    [
      session,
      activeTrack,
      tracksQueue,
      reviews,
      topCritics,
      buildTrackSnapshot,
      syncSessionToFirestore,
    ]
  );

  /**
   * გადამრთველი (Toggle): "ვიდეოს ჩვენება ოვერლეიზე" (`showVideoInOverlay: boolean`)
   */
  const toggleShowVideoInOverlay = useCallback(
    async (nextValue?: boolean) => {
      const currentVal = session?.showVideoInOverlay ?? true;
      const resolvedNext =
        typeof nextValue === 'boolean' ? nextValue : !currentVal;
      await updateObsSettings({ showVideoInOverlay: resolvedNext });
    },
    [session?.showVideoInOverlay, updateObsSettings]
  );

  /**
   * დაკვრა / დაპაუზება (`isPlaying: boolean` live_sessions/current დოკუმენტში)
   */
  const togglePlayback = useCallback(
    async (nextPlaying?: boolean) => {
      const currentVal = session?.isPlaying ?? true;
      const resolvedNext =
        typeof nextPlaying === 'boolean' ? nextPlaying : !currentVal;
      await updateObsSettings({ isPlaying: resolvedNext });
    },
    [session?.isPlaying, updateObsSettings]
  );

  /**
   * ხმის ჩართვა / გამორთვა (`isMuted: boolean` live_sessions/current დოკუმენტში)
   */
  const toggleMute = useCallback(
    async (nextMuted?: boolean) => {
      const currentVal = session?.isMuted ?? false;
      const resolvedNext =
        typeof nextMuted === 'boolean' ? nextMuted : !currentVal;
      await updateObsSettings({ isMuted: resolvedNext });
    },
    [session?.isMuted, updateObsSettings]
  );

  /**
   * სტრიმის გასაღების (streamKey) განახლება / რეგენერაცია გაჟონვის შემთხვევაში
   */
  const regenerateStreamKey = useCallback(async (): Promise<string> => {
    const nextKey = generateRandomStreamKey();
    await updateObsSettings({ streamKey: nextKey });
    return nextKey;
  }, [updateObsSettings]);

  // ტრეკები სტატუსით 'in_queue', დალაგებული დამატების დროის მიხედვით (ზრდადობით: პირველი დამატებული პირველია რიგში)
  const inQueueTracks = useMemo(() => {
    return tracksQueue
      .filter((t) => t.status === 'in_queue')
      .sort((a, b) => {
        const timeA = typeof a.createdAt === 'number' ? a.createdAt : 0;
        const timeB = typeof b.createdAt === 'number' ? b.createdAt : 0;
        return timeA - timeB;
      });
  }, [tracksQueue]);

  // არტისტების სია: ფორმირდება დინამიკურად მხოლოდ Firestore-იდან ჩატვირთული რეალური ტრეკების უნიკალური artistId/artist-ის საფუძველზე
  const artists = useMemo(() => {
    const map = new Map<string, ArtistProfile>();

    tracksQueue.forEach((t) => {
      const cleanName = (t.artist || '').trim();
      if (!cleanName) return;
      const id = t.artistId || getArtistIdFromName(cleanName);
      const existing = map.get(id);
      if (!existing) {
        map.set(id, {
          id,
          name: cleanName,
          bio: `${cleanName} — დამოუკიდებელი მუსიკალური პროექტი SoundCheck Live-ის პლატფორმაზე. ჟანრი: ${t.genre || 'ქართული სცენა'}.`,
          avatarUrl: t.coverUrl || defaultCoverImg,
          genres: t.genre ? [t.genre] : ['ქართული სცენა'],
          city: 'თბილისი',
          socialLinks: {
            ...(t.sourceUrl ? { spotify: t.sourceUrl } : {}),
          },
        });
      } else if (t.genre && !existing.genres.includes(t.genre)) {
        existing.genres.push(t.genre);
      }
    });

    return Array.from(map.values());
  }, [tracksQueue]);

  return {
    session,
    activeTrack,
    tracksQueue,
    inQueueTracks,
    artists,
    reviews,
    topCritics,
    userProfile: currentUserProfile,
    currentUserProfile,
    authLoading,
    loading: sessionLoading || tracksLoading || trackLoading,
    sessionLoading,
    trackLoading,
    error,
    isLive: Boolean(session?.isLive && session?.streamStatus !== 'idle'),
    votingOpen: Boolean(session?.votingOpen),
    isPlaying: Boolean(session?.isPlaying ?? true),
    isMuted: Boolean(session?.isMuted ?? false),
    showVideoInOverlay: Boolean(session?.showVideoInOverlay ?? true),
    streamKey: session?.streamKey || '',
    isFirestoreSynced,
    updateDraftScores,
    updateStreamStatus,
    lockInVerdict,
    addAndActivateTrack,
    submitNewTrack,
    launchTrackOnAir,
    selectActiveTrack,
    updateCommunityPrediction,
    submitTrackReview,
    toggleReviewHelpful,
    deleteTrack,
    deleteTrackReview,
    toggleShowVideoInOverlay,
    togglePlayback,
    toggleMute,
    regenerateStreamKey,
    updateObsSettings,
  };
}

export default useLiveSession;
