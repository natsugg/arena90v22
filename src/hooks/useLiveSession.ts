import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  doc,
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  getDoc,
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

export const INITIAL_LIVE_SESSION: LiveSession = {
  id: 'current',
  isLive: false,
  streamStatus: 'idle',
  activeTrackId: null,
  activeTrackSnapshot: null,
  hostId: 'streamer_host',
  title: 'ქართული რელიზების ლაივ-განხილვა',
  votingOpen: false,
  isPlaying: false,
  playbackPosition: 0,
  showObsOverlay: true,
  obsTheme: 'dark',
  liveExpertDraft: INITIAL_CRITERIA_SCORES,
  viewersCount: 0,
  updatedAt: Date.now(),
};

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
  loading: boolean;
  sessionLoading: boolean;
  trackLoading: boolean;
  error: Error | null;
  isLive: boolean;
  votingOpen: boolean;
  isFirestoreSynced: boolean;
  updateDraftScores: (draft: CriteriaScores) => Promise<void>;
  updateStreamStatus: (status: LiveStreamStatus) => Promise<void>;
  lockInVerdict: (finalScores: CriteriaScores) => Promise<void>;
  addAndActivateTrack: (input: {
    title: string;
    artist: string;
    coverUrl: string;
    genre?: string;
    audioUrl?: string;
    sourceUrl?: string;
  }) => Promise<Track>;
  submitNewTrack: (input: SubmitNewTrackInput) => Promise<Track>;
  launchTrackOnAir: (trackId: string) => Promise<void>;
  selectActiveTrack: (trackId: string) => Promise<void>;
  updateCommunityPrediction: (communityAvg: number) => Promise<void>;
  submitTrackReview: (input: SubmitReviewInput) => Promise<TrackReview>;
  toggleReviewHelpful: (reviewId: string, trackId?: string) => Promise<void>;
  deleteTrack: (trackId: string) => Promise<void>;
  deleteTrackReview: (trackId: string, reviewId: string) => Promise<void>;
  updateObsSettings: (settings: {
    showObsOverlay?: boolean;
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
          }
        );
      } else {
        setCurrentUserProfile(null);
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
          const nextSession: LiveSession = {
            ...data,
            id: snapshot.id,
            activeTrackId: data.activeTrackId || null,
            activeTrackSnapshot: data.activeTrackSnapshot ?? null,
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
          const firestoreTrack: Track = {
            ...data,
            id: snapshot.id,
            artistId: data.artistId || getArtistIdFromName(data.artist || ''),
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
      const resolvedTrack =
        trackCandidate ??
        tracksQueueRef.current.find(
          (t) => t.id === (session?.activeTrackId ?? '')
        ) ??
        null;

      if (resolvedTrack) {
        return {
          id: resolvedTrack.id,
          title: (resolvedTrack.title || 'უსათაურო ტრეკი').slice(0, 120),
          artist: (resolvedTrack.artist || 'უცნობი არტისტი').slice(0, 120),
          coverUrl: (resolvedTrack.coverUrl || defaultCoverImg).slice(0, 500),
          genre: (resolvedTrack.genre || 'ქართული სცენა').slice(0, 60),
          expertScore: resolvedTrack.expertScore ?? null,
          expertTotalScore: resolvedTrack.expertTotalScore ?? null,
          communityTotalScore: resolvedTrack.communityTotalScore ?? null,
          communityVotesCount: resolvedTrack.communityVotesCount ?? 0,
          metaScore: resolvedTrack.metaScore ?? null,
        };
      }

      if (existingSnapshot && existingSnapshot.id) {
        return {
          id: existingSnapshot.id,
          title: (existingSnapshot.title || 'უსათაურო ტრეკი').slice(0, 120),
          artist: (existingSnapshot.artist || 'უცნობი არტისტი').slice(0, 120),
          coverUrl: (existingSnapshot.coverUrl || defaultCoverImg).slice(
            0,
            500
          ),
          genre: (existingSnapshot.genre || 'ქართული სცენა').slice(0, 60),
          expertScore: existingSnapshot.expertScore ?? null,
          expertTotalScore: existingSnapshot.expertTotalScore ?? null,
          communityTotalScore: existingSnapshot.communityTotalScore ?? null,
          communityVotesCount: existingSnapshot.communityVotesCount ?? 0,
          metaScore: existingSnapshot.metaScore ?? null,
        };
      }

      return null;
    },
    [session?.activeTrackId]
  );

  const syncSessionToFirestore = useCallback(
    async (nextSession: LiveSession) => {
      if (!auth.currentUser) return;
      const sessionPath = `live_sessions/${sessionId}`;
      const resolvedSnapshot = buildTrackSnapshot(
        activeTrack,
        nextSession.activeTrackSnapshot
      );
      const safeHostId =
        (auth.currentUser?.uid || nextSession.hostId || 'streamer_host')
          .replace(/[^a-zA-Z0-9_\-]/g, '_')
          .slice(0, 128) || 'streamer_host';

      try {
        await setDoc(
          doc(db, 'live_sessions', sessionId),
          {
            id: sessionId,
            isLive: Boolean(nextSession.isLive),
            streamStatus: nextSession.streamStatus,
            activeTrackId:
              nextSession.activeTrackId ?? resolvedSnapshot?.id ?? null,
            activeTrackSnapshot: resolvedSnapshot,
            hostId: safeHostId,
            title: (
              nextSession.title || 'ქართული რელიზების ლაივ-განხილვა'
            ).slice(0, 140),
            votingOpen: Boolean(nextSession.votingOpen),
            isPlaying: Boolean(nextSession.isPlaying),
            playbackPosition: nextSession.playbackPosition ?? 0,
            showObsOverlay: Boolean(nextSession.showObsOverlay ?? true),
            obsTheme: nextSession.obsTheme || 'dark',
            liveExpertDraft: nextSession.liveExpertDraft ?? null,
            viewersCount: nextSession.viewersCount ?? 1,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        setIsFirestoreSynced(true);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, sessionPath);
        } catch {
          // logged by handleFirestoreError
        }
      }
    },
    [sessionId, activeTrack, buildTrackSnapshot]
  );

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

      const nextSession: LiveSession = {
        ...currentSession,
        streamStatus: 'revealed',
        votingOpen: false,
        liveExpertDraft: finalScores,
        activeTrackSnapshot: updatedActiveTrack
          ? {
              id: updatedActiveTrack.id,
              title: updatedActiveTrack.title,
              artist: updatedActiveTrack.artist,
              coverUrl: updatedActiveTrack.coverUrl,
              genre: updatedActiveTrack.genre,
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

      const newTrack: Track = {
        id: cleanId,
        title: cleanTitle,
        artist: cleanArtist,
        artistId: getArtistIdFromName(cleanArtist),
        coverUrl: cleanCoverUrl,
        audioUrl: cleanSourceUrl || 'https://soundcheck.live/audio/stream.mp3',
        sourceUrl: cleanSourceUrl,
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
      const cleanAudioUrl =
        (input.audioUrl || input.sourceUrl || '').trim().slice(0, 500) ||
        'https://soundcheck.live/audio/stream.mp3';
      const cleanSourceUrl = (input.sourceUrl || input.audioUrl || '')
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
        activeTrackId: newTrack.id,
        liveExpertDraft: defaultDraft,
        activeTrackSnapshot: {
          id: newTrack.id,
          title: newTrack.title,
          artist: newTrack.artist,
          coverUrl: newTrack.coverUrl,
          genre: newTrack.genre,
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
   * ერთი კლიკით გადააქვს არჩეული ტრეკი მიმდინარე ლაივ-სესიის `activeTrackId`-ში
   * და მის სტატუსს ცვლის `'on_air'`-ზე ("ეთერში გაშვება").
   */
  const launchTrackOnAir = useCallback(
    async (trackId: string) => {
      const target = tracksQueue.find((t) => t.id === trackId);
      if (!target) return;

      const updatedTarget: Track = {
        ...target,
        status: 'on_air',
        updatedAt: Date.now(),
      };

      const previousOnAirTracks = tracksQueue.filter(
        (t) => t.id !== trackId && t.status === 'on_air'
      );

      const updatedTracks: Track[] = tracksQueue.map((t) => {
        if (t.id === trackId) return updatedTarget;
        if (t.status === 'on_air') {
          return {
            ...t,
            status: t.expertScore ? 'reviewed' : 'community_catalog',
          };
        }
        return t;
      });

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
        streamStatus: updatedTarget.expertScore ? 'revealed' : 'listening',
        votingOpen: !updatedTarget.expertScore,
        liveExpertDraft: nextDraft,
        activeTrackSnapshot: {
          id: updatedTarget.id,
          title: updatedTarget.title,
          artist: updatedTarget.artist,
          coverUrl: updatedTarget.coverUrl,
          genre: updatedTarget.genre,
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
    async (trackId: string) => {
      await launchTrackOnAir(trackId);
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
      const nextSession: LiveSession =
        currentSession.activeTrackId === updatedTrack.id
          ? {
              ...currentSession,
              activeTrackSnapshot: {
                id: updatedTrack.id,
                title: updatedTrack.title,
                artist: updatedTrack.artist,
                coverUrl: updatedTrack.coverUrl,
                genre: updatedTrack.genre,
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
        try {
          const trackSnap = await getDoc(trackRef);
          if (!trackSnap.exists()) {
            await setDoc(trackRef, {
              id: targetTrack.id,
              title: targetTrack.title.slice(0, 120),
              artist: targetTrack.artist.slice(0, 120),
              artistId:
                targetTrack.artistId || getArtistIdFromName(targetTrack.artist),
              coverUrl: (targetTrack.coverUrl || defaultCoverImg).slice(0, 500),
              audioUrl: (
                targetTrack.audioUrl || 'https://soundcheck.live/audio/stream.mp3'
              ).slice(0, 500),
              sourceUrl: (
                targetTrack.sourceUrl || 'https://open.spotify.com'
              ).slice(0, 500),
              genre: (targetTrack.genre || 'ქართული სცენა').slice(0, 60),
              duration: targetTrack.duration ?? 210,
              submittedBy: auth.currentUser.uid,
              submittedByName: (
                auth.currentUser.displayName || 'ქართველი მუსიკოსი'
              ).slice(0, 80),
              isPriority: false,
              status: 'community_catalog',
              expertScore: null,
              expertTotalScore: null,
              communityScore: null,
              communityTotalScore: null,
              communityVotesCount: 0,
              metaScore: null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          await updateDoc(trackRef, {
            communityScore: recalculated.communityScore,
            communityTotalScore: recalculated.communityTotalScore,
            communityVotesCount: recalculated.communityVotesCount,
            metaScore: recalculated.metaScore,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.UPDATE, trackPath);
          } catch {
            // logged by handleFirestoreError
          }
        }

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

      const remainingForTrack = reviews.filter(
        (r) => r.trackId === trackId && r.id !== reviewId
      );
      const nextReviews = reviews.filter((r) => r.id !== reviewId);
      setReviews(nextReviews);

      const targetTrack = tracksQueue.find((t) => t.id === trackId);
      if (targetTrack) {
        const recalculated = recalculateCommunityScoresFromReviews(
          remainingForTrack,
          targetTrack.expertScore
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
            communityVotesCount: recalculated.communityVotesCount,
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
    loading: sessionLoading || tracksLoading || trackLoading,
    sessionLoading,
    trackLoading,
    error,
    isLive: Boolean(session?.isLive && session?.streamStatus !== 'idle'),
    votingOpen: Boolean(session?.votingOpen),
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
    updateObsSettings,
  };
}

export default useLiveSession;
