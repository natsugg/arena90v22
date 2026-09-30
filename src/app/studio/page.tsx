import React, { useState, useEffect, useRef } from 'react';
import {
  Disc3,
  Plus,
  Check,
  RotateCcw,
  Radio,
  Music2,
  Sliders,
  Award,
  Users,
  ExternalLink,
  ListMusic,
  Link2,
  Shield,
  Trash2,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { i18n } from '../../lib/i18n';
import { fetchYouTubeMetadata, extractYouTubeId } from '../../lib/youtube';
import {
  useLiveSession,
  PRESET_COVERS,
  INITIAL_CRITERIA_SCORES,
} from '../../hooks/useLiveSession';
import {
  CRITERIA_KEYS,
  DEFAULT_ROLE_VOTE_WEIGHTS,
  calculateAverageScore,
  calculateMetaScore,
  getArtistIdFromName,
  type CriteriaKey,
  type CriteriaScores,
  type LiveStreamStatus,
  type User,
  type UserRole,
} from '../../types';
import {
  db,
  handleFirestoreError,
  OperationType,
} from '../../lib/firebase';

const ADMIN_ROLE_OPTIONS: { role: UserRole; label: string; voteWeight: number }[] = [
  { role: 'viewer', label: i18n.roleOptions.viewer, voteWeight: DEFAULT_ROLE_VOTE_WEIGHTS.viewer },
  { role: 'vip', label: i18n.roleOptions.vip, voteWeight: DEFAULT_ROLE_VOTE_WEIGHTS.vip },
  { role: 'moderator', label: i18n.roleOptions.moderator, voteWeight: DEFAULT_ROLE_VOTE_WEIGHTS.moderator },
  { role: 'expert', label: i18n.roleOptions.expert, voteWeight: DEFAULT_ROLE_VOTE_WEIGHTS.expert },
  { role: 'streamer', label: i18n.roleOptions.streamer, voteWeight: DEFAULT_ROLE_VOTE_WEIGHTS.streamer },
  { role: 'admin', label: i18n.roleOptions.admin, voteWeight: DEFAULT_ROLE_VOTE_WEIGHTS.admin },
];

const STREAM_STATUS_OPTIONS: LiveStreamStatus[] = [
  'idle',
  'listening',
  'locked',
  'revealed',
];

export interface StudioPageProps {
  onSelectArtist?: (artistId: string) => void;
  onSelectTrack?: (trackId: string) => void;
  onOpenSubmitModal?: () => void;
}

export default function StudioPage({
  onSelectArtist,
  onSelectTrack,
  onOpenSubmitModal,
}: StudioPageProps = {}) {
  const {
    session,
    activeTrack,
    tracksQueue,
    inQueueTracks,
    userProfile,
    currentUserProfile,
    isPlaying,
    isMuted,
    showVideoInOverlay,
    updateDraftScores,
    updateStreamStatus,
    lockInVerdict,
    addAndActivateTrack,
    launchTrackOnAir,
    updateCommunityPrediction,
    toggleShowVideoInOverlay,
    togglePlayback,
    toggleMute,
    updateObsSettings,
  } = useLiveSession('current');

  const studioIframeRef = useRef<HTMLIFrameElement | null>(null);

  const sendStudioPlayerCommand = (func: string, args: unknown[] = []) => {
    if (!studioIframeRef.current?.contentWindow) return;
    try {
      studioIframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        '*'
      );
    } catch {
      // ignore cross-origin postMessage errors
    }
  };

  useEffect(() => {
    sendStudioPlayerCommand(isPlaying ? 'playVideo' : 'pauseVideo');
  }, [isPlaying, activeTrack?.id]);

  useEffect(() => {
    sendStudioPlayerCommand(isMuted ? 'mute' : 'unmute');
  }, [isMuted, activeTrack?.id]);

  const activeUserProfile = currentUserProfile ?? userProfile;
  const isAdmin = activeUserProfile?.role === 'admin';

  // რიგის ჩანართი: 'in_queue' ("სტრიმის რიგი") vs 'all' ("სრული კატალოგი") vs 'users' ("მომხმარებლების მართვა")
  const [queueTab, setQueueTab] = useState<'in_queue' | 'all' | 'users'>('in_queue');

  // მომხმარებლების მართვა (მხოლოდ role === 'admin'-ისთვის)
  const [managedUsers, setManagedUsers] = useState<User[]>([]);
  const [updatingUserUid, setUpdatingUserUid] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setManagedUsers([]);
      return;
    }

    const usersQuery = query(
      collection(db, 'users'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );

    const unsubscribeUsers = onSnapshot(
      usersQuery,
      (snapshot) => {
        const list: User[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Partial<User>;
          const role: UserRole = data.role || 'viewer';
          return {
            uid: docSnap.id,
            displayName: data.displayName || 'მსმენელი',
            avatarUrl: data.avatarUrl,
            role,
            xp: typeof data.xp === 'number' ? data.xp : 0,
            level: typeof data.level === 'number' ? data.level : 1,
            voteWeight:
              typeof data.voteWeight === 'number'
                ? data.voteWeight
                : DEFAULT_ROLE_VOTE_WEIGHTS[role] ?? 1.0,
            reviewsCount:
              typeof data.reviewsCount === 'number' ? data.reviewsCount : 0,
            helpfulVotesReceived:
              typeof data.helpfulVotesReceived === 'number'
                ? data.helpfulVotesReceived
                : 0,
            createdAt: data.createdAt ?? Date.now(),
            updatedAt: data.updatedAt ?? Date.now(),
          };
        });
        setManagedUsers(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'users');
        } catch {
          // logged by handleFirestoreError
        }
      }
    );

    return () => unsubscribeUsers();
  }, [isAdmin]);

  const handleUserRoleChange = async (targetUser: User, nextRole: UserRole) => {
    if (!isAdmin) return;
    const voteWeight = DEFAULT_ROLE_VOTE_WEIGHTS[nextRole] ?? 1.0;
    setUpdatingUserUid(targetUser.uid);
    try {
      await updateDoc(doc(db, 'users', targetUser.uid), {
        role: nextRole,
        voteWeight,
      });
    } catch (err) {
      try {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `users/${targetUser.uid}`
        );
      } catch {
        // logged by handleFirestoreError
      }
    } finally {
      setUpdatingUserUid(null);
    }
  };

  const handleDeleteUser = async (targetUser: User) => {
    if (!isAdmin) return;
    const confirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(i18n.phrases.areYouSure)
        : true;
    if (!confirmed) return;

    setUpdatingUserUid(targetUser.uid);
    try {
      await deleteDoc(doc(db, 'users', targetUser.uid));
    } catch (err) {
      try {
        handleFirestoreError(
          err,
          OperationType.DELETE,
          `users/${targetUser.uid}`
        );
      } catch {
        // logged by handleFirestoreError
      }
    } finally {
      setUpdatingUserUid(null);
    }
  };

  // ფორმის მდგომარეობა ახალი ტრეკის დასამატებლად
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [youtubeFetching, setYoutubeFetching] = useState(false);
  const [youtubeFetched, setYoutubeFetched] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [artistInput, setArtistInput] = useState('');
  const [coverUrlInput, setCoverUrlInput] = useState<string>(
    PRESET_COVERS.vinyl
  );
  const [genreInput, setGenreInput] = useState('ალტერნატიული ჰიპ-ჰოპი');
  const [coverLoadError, setCoverLoadError] = useState(false);
  const [previewCoverError, setPreviewCoverError] = useState(false);

  // 5 კრიტერიუმის სლაიდერის მდგომარეობა (ბიჯი 0.1)
  const [scores, setScores] = useState<CriteriaScores>(() => {
    return (
      session?.liveExpertDraft ??
      activeTrack?.expertScore ??
      INITIAL_CRITERIA_SCORES
    );
  });

  const [verdictSavedToast, setVerdictSavedToast] = useState(false);

  // სინქრონიზაცია აქტიური ტრეკის შეცვლისას
  useEffect(() => {
    if (session?.liveExpertDraft) {
      setScores(session.liveExpertDraft);
    } else if (activeTrack?.expertScore) {
      setScores(activeTrack.expertScore);
    }
  }, [activeTrack?.id]);

  const handleSliderChange = (key: CriteriaKey, rawValue: number) => {
    const clamped = Math.min(10, Math.max(1, Math.round(rawValue * 10) / 10));
    const nextScores: CriteriaScores = {
      ...scores,
      [key]: clamped,
    };
    setScores(nextScores);
    setVerdictSavedToast(false);
    void updateDraftScores(nextScores);
  };

  const handleResetScores = () => {
    const neutral: CriteriaScores = {
      lyrics: 5.0,
      flow: 5.0,
      production: 5.0,
      identity: 5.0,
      vibe: 5.0,
    };
    setScores(neutral);
    setVerdictSavedToast(false);
    void updateDraftScores(neutral);
  };

  const handleLockVerdict = async () => {
    await lockInVerdict(scores);
    setVerdictSavedToast(true);
  };

  const handleYouTubeUrlChange = async (value: string) => {
    setYoutubeUrlInput(value);
    setYoutubeFetched(false);

    const videoId = extractYouTubeId(value);
    if (!videoId) return;

    setYoutubeFetching(true);
    try {
      const meta = await fetchYouTubeMetadata(value);
      if (meta) {
        if (meta.title) setTitleInput(meta.title);
        if (meta.artist) setArtistInput(meta.artist);
        if (meta.coverUrl) {
          setPreviewCoverError(false);
          setCoverUrlInput(meta.coverUrl);
        }
        setYoutubeFetched(true);
      }
    } finally {
      setYoutubeFetching(false);
    }
  };

  const handleAddTrackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleInput.trim() || !artistInput.trim()) return;

    await addAndActivateTrack({
      title: titleInput,
      artist: artistInput,
      coverUrl: coverUrlInput || PRESET_COVERS.vinyl,
      genre: genreInput,
      youtubeUrl: youtubeUrlInput.trim() || undefined,
      audioUrl: youtubeUrlInput.trim() || undefined,
      sourceUrl: youtubeUrlInput.trim() || undefined,
    });

    setYoutubeUrlInput('');
    setYoutubeFetched(false);
    setTitleInput('');
    setArtistInput('');
    setVerdictSavedToast(false);
  };

  const currentAverage = calculateAverageScore(scores);
  const communityAverage =
    activeTrack?.communityTotalScore ??
    session?.activeTrackSnapshot?.communityTotalScore ??
    8.6;
  const currentMetaScore =
    calculateMetaScore(
      scores,
      activeTrack?.communityScore ?? {
        lyrics: communityAverage,
        flow: communityAverage,
        production: communityAverage,
        identity: communityAverage,
        vibe: communityAverage,
      }
    ) ?? Math.round(currentAverage * 10);

  const currentStatus: LiveStreamStatus = session?.streamStatus ?? 'listening';

  const displayedQueueTracks =
    queueTab === 'in_queue' ? inQueueTracks : tracksQueue;

  return (
    <div className="w-full max-w-[1360px] mx-auto px-6 py-8">
      {/* ზედა სამუშაო ზოლი: აქტიური ტრეკის მიმოხილვა და ეთერის სტატუსის გადამრთველი */}
      <section className="border border-zinc-800/90 bg-[#111723] rounded-xl p-6 mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          {/* მარცხენა მხარე: აქტიური ტრეკი */}
          <div className="flex items-center gap-5 min-w-0">
            <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center">
              {activeTrack?.coverUrl && !coverLoadError ? (
                <img
                  src={activeTrack.coverUrl}
                  alt={activeTrack.title}
                  referrerPolicy="no-referrer"
                  onError={() => setCoverLoadError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc3 className="w-9 h-9 text-amber-400/80 animate-spin" />
              )}
            </div>

            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <Radio className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{i18n.ui.activeTrack}</span>
                <span aria-hidden="true">·</span>
                <span className="text-amber-400 font-medium">
                  {i18n.statuses[currentStatus]}
                </span>
                {activeTrack?.status === 'on_air' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-400 font-semibold">
                      {i18n.studioQueue.onAirNow}
                    </span>
                  </>
                )}
              </div>

              {activeTrack ? (
                <>
                  <h1
                    onClick={() =>
                      onSelectTrack && onSelectTrack(activeTrack.id)
                    }
                    className={`text-xl md:text-2xl font-bold text-zinc-100 truncate ${
                      onSelectTrack ? 'hover:text-amber-400 cursor-pointer' : ''
                    }`}
                  >
                    {activeTrack.title}
                  </h1>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400 truncate">
                    <span>{i18n.ui.artist}:</span>
                    <button
                      type="button"
                      onClick={() =>
                        onSelectArtist &&
                        onSelectArtist(
                          activeTrack.artistId ||
                            getArtistIdFromName(activeTrack.artist)
                        )
                      }
                      className="text-zinc-200 font-medium hover:text-amber-400 transition-colors cursor-pointer"
                    >
                      {activeTrack.artist}
                    </button>
                    {activeTrack.genre && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{activeTrack.genre}</span>
                      </>
                    )}
                    {(activeTrack.sourceUrl || activeTrack.audioUrl) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <a
                          href={activeTrack.sourceUrl || activeTrack.audioUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-amber-400 hover:underline font-medium"
                        >
                          <span>{i18n.portal.openOriginalSource}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-base text-zinc-400">
                  {i18n.ui.noActiveTrack}
                </p>
              )}
            </div>
          </div>

          {/* მარჯვენა მხარე: ეთერის სტატუსის სეგმენტირებული მართვა და OBS პარამეტრები */}
          <div className="flex flex-col items-start lg:items-end gap-3 shrink-0">
            <div className="flex flex-col items-start lg:items-end gap-1.5">
              <span className="text-xs text-zinc-400">
                {i18n.ui.streamStatusControl}
              </span>
              <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#0B0F17] border border-zinc-800 rounded-lg">
                {STREAM_STATUS_OPTIONS.map((statusKey) => {
                  const active = currentStatus === statusKey;
                  return (
                    <button
                      key={statusKey}
                      type="button"
                      onClick={() => void updateStreamStatus(statusKey)}
                      className={`px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? statusKey === 'revealed'
                            ? 'bg-amber-500 text-zinc-950 font-semibold'
                            : 'bg-zinc-800 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                      }`}
                    >
                      {i18n.statuses[statusKey]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* დაკვრის პულტი (Play/Pause, Mute/Unmute), OBS ხილვადობა, ვიდეოს ჩვენება ოვერლეიზე და თემის გადამრთველი */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* ღილაკი Play/Pause (დაპაუზება / დაკვრა) */}
              <button
                type="button"
                onClick={() => void togglePlayback(!isPlaying)}
                title={i18n.ui.playPauseToggle}
                aria-label={i18n.ui.playPauseToggle}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isPlaying
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                }`}
              >
                {isPlaying ? (
                  <Pause className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Play className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{i18n.ui.playPauseToggle}:</span>
                <span className="font-semibold">
                  {isPlaying ? i18n.ui.pauseTrack : i18n.ui.playTrack}
                </span>
              </button>

              {/* ტუმბლერი Mute/Unmute (ხმის ჩართვა / გამორთვა) */}
              <button
                type="button"
                role="switch"
                aria-checked={!isMuted}
                onClick={() => void toggleMute(!isMuted)}
                title={i18n.ui.muteUnmuteToggle}
                aria-label={i18n.ui.muteUnmuteToggle}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  !isMuted
                    ? 'border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25'
                    : 'border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25'
                }`}
              >
                {isMuted ? (
                  <VolumeX className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{i18n.ui.muteUnmuteToggle}:</span>
                <span className="font-semibold">
                  {isMuted ? i18n.ui.unmuteAudio : i18n.ui.muteAudio}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  void updateObsSettings({
                    showObsOverlay: !(session?.showObsOverlay ?? true),
                  })
                }
                className={`px-2.5 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  (session?.showObsOverlay ?? true)
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {i18n.ui.obsOverlayVisibility}:{' '}
                {(session?.showObsOverlay ?? true) ? 'ჩართულია' : 'დამალულია'}
              </button>

              {/* გადამრთველი (Toggle): "ვიდეოს ჩვენება ოვერლეიზე" */}
              <button
                type="button"
                role="switch"
                aria-checked={showVideoInOverlay}
                onClick={() =>
                  void toggleShowVideoInOverlay(!showVideoInOverlay)
                }
                className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  showVideoInOverlay
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span>{i18n.ui.showVideoInOverlay}:</span>
                <span className="font-semibold">
                  {showVideoInOverlay ? 'ჩართულია' : 'გამორთულია'}
                </span>
              </button>

              <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-zinc-800 rounded-lg">
                {(
                  ['dark', 'neon', 'minimal', 'compact'] as const
                ).map((themeKey) => {
                  const activeTheme = (session?.obsTheme ?? 'dark') === themeKey;
                  return (
                    <button
                      key={themeKey}
                      type="button"
                      onClick={() =>
                        void updateObsSettings({ obsTheme: themeKey })
                      }
                      className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                        activeTheme
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {i18n.ui.obsThemes[themeKey]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* ჩაშენებული YouTube პლეერი აქტიური ტრეკისთვის სტუდიაში */}
        {activeTrack &&
          (() => {
            const ytId =
              activeTrack.youtubeId ||
              session?.activeTrackSnapshot?.youtubeId ||
              session?.youtubeId ||
              extractYouTubeId(
                activeTrack.youtubeUrl ||
                  activeTrack.sourceUrl ||
                  activeTrack.audioUrl ||
                  ''
              );
            if (!ytId) return null;
            return (
              <div
                key={`studio_player_${activeTrack.id}_${ytId}`}
                className="mt-5 pt-5 border-t border-zinc-800/80"
              >
                <div className="relative w-full overflow-hidden rounded-xl border border-zinc-800 bg-black aspect-video max-h-[300px]">
                  <iframe
                    ref={studioIframeRef}
                    key={`studio_iframe_${activeTrack.id}_${ytId}`}
                    src={`https://www.youtube.com/embed/${ytId}?rel=0&enablejsapi=1&controls=1`}
                    title={activeTrack.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full border-0 pointer-events-auto"
                  />
                </div>
              </div>
            );
          })()}
      </section>

      {/* მთავარი სამუშაო ბადე: მარცხნივ სტრიმის რიგი + ტრეკის დამატება, მარჯვნივ 5 სლაიდერის პულტი */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* მარცხენა სვეტი (5 სვეტი): სტრიმის რიგი (in_queue) და ტრეკის დამატება */}
        <div className="lg:col-span-5 space-y-8">
          {/* სტრიმის რიგი (Stream Queue) — ტრეკები სტატუსით 'in_queue' დალაგებული დამატების დროით */}
          <section className="border border-zinc-800/90 bg-[#111723] rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <ListMusic className="w-4 h-4 text-amber-400" />
                <h2 className="text-lg font-semibold text-zinc-100">
                  {i18n.phrases.streamQueue}
                </h2>
                <span className="text-xs font-mono-tabular text-amber-400 font-bold">
                  ({inQueueTracks.length})
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-zinc-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setQueueTab('in_queue')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    queueTab === 'in_queue'
                      ? 'bg-amber-500 text-zinc-950 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {i18n.studioQueue.tabStreamQueue} ({inQueueTracks.length})
                </button>
                <button
                  type="button"
                  onClick={() => setQueueTab('all')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    queueTab === 'all'
                      ? 'bg-zinc-800 text-zinc-100 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {i18n.studioQueue.tabAllCatalog} ({tracksQueue.length})
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setQueueTab('users')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      queueTab === 'users'
                        ? 'bg-amber-500 text-zinc-950 font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {i18n.phrases.userManagement} ({managedUsers.length})
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-zinc-400">
              {queueTab === 'users'
                ? i18n.admin.userManagementSubtitle
                : i18n.studioQueue.queueSubtitle}
            </p>

            {queueTab === 'users' && isAdmin ? (
              managedUsers.length === 0 ? (
                <div className="py-8 px-4 text-center border border-dashed border-zinc-800 rounded-xl">
                  <p className="text-xs text-zinc-400">
                    {i18n.admin.emptyUsers}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {managedUsers.map((u) => (
                    <div
                      key={u.uid}
                      className="py-3 first:pt-0 last:pb-0 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center text-xs font-bold text-amber-400">
                          {u.avatarUrl ? (
                            <img
                              src={u.avatarUrl}
                              alt={u.displayName}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>
                              {(u.displayName || 'U').slice(0, 1).toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-zinc-100 truncate">
                            {u.displayName}
                          </p>
                          <p className="text-xs text-zinc-400 font-mono-tabular">
                            ×{u.voteWeight.toFixed(1)} · {u.xp} XP
                          </p>
                        </div>
                      </div>

                      <select
                        aria-label={`${i18n.admin.colActions}: ${u.displayName}`}
                        value={u.role}
                        disabled={updatingUserUid === u.uid}
                        onChange={(e) =>
                          void handleUserRoleChange(
                            u,
                            e.target.value as UserRole
                          )
                        }
                        className="px-2.5 py-1.5 text-xs font-medium bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                      >
                        {ADMIN_ROLE_OPTIONS.map((opt) => (
                          <option key={opt.role} value={opt.role}>
                            {opt.label} (×{opt.voteWeight.toFixed(1)})
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )
            ) : displayedQueueTracks.length === 0 ? (
              <div className="py-8 px-4 text-center border border-dashed border-zinc-800 rounded-xl space-y-3">
                <p className="text-xs text-zinc-400">
                  {i18n.studioQueue.emptyQueue}
                </p>
                {onOpenSubmitModal && (
                  <button
                    type="button"
                    onClick={onOpenSubmitModal}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{i18n.phrases.submitTrack}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {displayedQueueTracks.map((track, idx) => {
                  const isCurrentOnAir =
                    activeTrack?.id === track.id || track.status === 'on_air';

                  return (
                    <div
                      key={track.id}
                      className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono-tabular text-zinc-500 w-5 shrink-0">
                          0{idx + 1}.
                        </span>
                        <img
                          src={track.coverUrl || PRESET_COVERS.vinyl}
                          alt={track.title}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = PRESET_COVERS.vinyl;
                          }}
                          className="w-11 h-11 rounded-md object-cover bg-zinc-900 border border-zinc-800 shrink-0"
                        />
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-semibold text-zinc-100 truncate">
                            {track.title}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 truncate">
                            <span className="truncate text-zinc-300">
                              {track.artist}
                            </span>
                            {track.genre && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="truncate">{track.genre}</span>
                              </>
                            )}
                            {track.sourceUrl && (
                              <>
                                <span aria-hidden="true">·</span>
                                <a
                                  href={track.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-0.5 text-amber-400 hover:underline"
                                >
                                  <span>{i18n.submitModal.fields.sourceUrl}</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => void launchTrackOnAir(track)}
                        className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isCurrentOnAir && queueTab === 'all'
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                        }`}
                      >
                        {isCurrentOnAir && queueTab === 'all'
                          ? i18n.ui.currentlyActive
                          : i18n.phrases.launchOnAir}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ახალი ტრეკის სწრაფი დამატების ფორმა სტრიმერისთვის */}
          <section className="border border-zinc-800/90 bg-[#111723] rounded-xl p-6">
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-zinc-800/80">
              <h2 className="text-lg font-semibold text-zinc-100">
                {i18n.ui.addTrackTitle}
              </h2>
              <Music2 className="w-4 h-4 text-zinc-400" />
            </div>

            <form onSubmit={(e) => void handleAddTrackSubmit(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="track-youtube-url"
                  className="block text-xs font-medium text-amber-300 mb-1.5"
                >
                  {i18n.ui.youtubeUrl}
                </label>
                <div className="relative">
                  <Link2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="track-youtube-url"
                    type="url"
                    maxLength={500}
                    value={youtubeUrlInput}
                    onChange={(e) => void handleYouTubeUrlChange(e.target.value)}
                    placeholder={i18n.ui.youtubeUrlPlaceholder}
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>
                {youtubeFetching && (
                  <p className="text-[11px] text-amber-400 mt-1.5">
                    {i18n.ui.youtubeFetching}
                  </p>
                )}
                {youtubeFetched && !youtubeFetching && (
                  <p className="text-[11px] text-emerald-400 mt-1.5 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>{i18n.ui.youtubeFetched}</span>
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="track-title"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  {i18n.ui.trackTitle} *
                </label>
                <input
                  id="track-title"
                  type="text"
                  required
                  maxLength={120}
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  placeholder={i18n.ui.titlePlaceholder}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="track-artist"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  {i18n.ui.artist} *
                </label>
                <input
                  id="track-artist"
                  type="text"
                  required
                  maxLength={120}
                  value={artistInput}
                  onChange={(e) => setArtistInput(e.target.value)}
                  placeholder={i18n.ui.artistPlaceholder}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="track-cover"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  {i18n.ui.coverUrl}
                </label>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center">
                    {coverUrlInput && !previewCoverError ? (
                      <img
                        src={coverUrlInput}
                        alt={i18n.ui.coverPreview}
                        referrerPolicy="no-referrer"
                        onError={() => setPreviewCoverError(true)}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Disc3 className="w-5 h-5 text-amber-400/80" />
                    )}
                  </div>
                  <input
                    id="track-cover"
                    type="text"
                    maxLength={500}
                    value={coverUrlInput}
                    onChange={(e) => {
                      setCoverLoadError(false);
                      setPreviewCoverError(false);
                      setCoverUrlInput(e.target.value);
                    }}
                    placeholder={i18n.ui.coverPlaceholder}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                </div>

                {/* სწრაფი სტუდიური გარეკანების არჩევა */}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCoverLoadError(false);
                      setPreviewCoverError(false);
                      setCoverUrlInput(PRESET_COVERS.vinyl);
                    }}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer whitespace-nowrap ${
                      coverUrlInput === PRESET_COVERS.vinyl
                        ? 'border-amber-500/70 bg-amber-500/10 text-amber-300'
                        : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {i18n.ui.presetCover1}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCoverLoadError(false);
                      setPreviewCoverError(false);
                      setCoverUrlInput(PRESET_COVERS.console);
                    }}
                    className={`px-2.5 py-1 text-xs rounded border transition-colors cursor-pointer whitespace-nowrap ${
                      coverUrlInput === PRESET_COVERS.console
                        ? 'border-amber-500/70 bg-amber-500/10 text-amber-300'
                        : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {i18n.ui.presetCover2}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="track-genre"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  {i18n.ui.genre}
                </label>
                <input
                  id="track-genre"
                  type="text"
                  maxLength={60}
                  value={genreInput}
                  onChange={(e) => setGenreInput(e.target.value)}
                  placeholder={i18n.ui.genrePlaceholder}
                  className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold bg-zinc-100 text-zinc-950 rounded-lg hover:bg-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>{i18n.ui.addTrackButton}</span>
              </button>
            </form>
          </section>
        </div>

        {/* მარჯვენა სვეტი (7 სვეტი): 5 სლაიდერი (0.1 ბიჯით) და ვერდიქტის დაფიქსირება */}
        <div className="lg:col-span-7 space-y-6">
          <section className="border border-zinc-800/90 bg-[#111723] rounded-xl p-6">
            {/* სათაური და ქულების განულება */}
            <div className="flex flex-wrap items-center justify-between gap-4 pb-5 mb-6 border-b border-zinc-800/80">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  <h2 className="text-lg font-semibold text-zinc-100">
                    {i18n.ui.expertEvaluation}
                  </h2>
                </div>
                <p className="text-xs text-zinc-400">
                  {i18n.ui.draftUpdatingNotice}
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetScores}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-300 bg-[#0B0F17] border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{i18n.ui.resetScores}</span>
              </button>
            </div>

            {/* 5 სლაიდერი ბიჯით 0.1 */}
            <div className="space-y-6">
              {CRITERIA_KEYS.map((key, index) => {
                const value = scores[key];
                const percentage = ((value - 1) / 9) * 100;

                return (
                  <div
                    key={key}
                    className="space-y-2 pb-5 border-b border-zinc-800/50 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <div>
                        <span className="text-sm font-semibold text-zinc-100">
                          0{index + 1}. {i18n.criteria[key]}
                        </span>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          {i18n.criteriaDescriptions[key]}
                        </p>
                      </div>

                      <div className="flex items-baseline gap-1 shrink-0">
                        <span className="text-2xl font-bold font-mono-tabular text-amber-400">
                          {value.toFixed(1)}
                        </span>
                        <span className="text-xs font-mono-tabular text-zinc-500">
                          / 10.0
                        </span>
                      </div>
                    </div>

                    {/* სლაიდერის ველი */}
                    <div className="relative pt-1">
                      <div className="w-full h-2 bg-[#0B0F17] rounded-full overflow-hidden border border-zinc-800/80">
                        <div
                          className="h-full bg-amber-500 origin-left transition-transform duration-75"
                          style={{
                            transform: `scaleX(${Math.max(0.02, percentage / 100)})`,
                          }}
                        />
                      </div>
                      <input
                        type="range"
                        min={1.0}
                        max={10.0}
                        step={0.1}
                        value={value}
                        aria-label={i18n.criteria[key]}
                        onChange={(e) =>
                          handleSliderChange(key, parseFloat(e.target.value))
                        }
                        className="studio-fader absolute inset-0 w-full h-full opacity-100"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ხალხის პროგნოზის (communityScore) სწრაფი კალიბრაცია */}
            <div className="mt-6 pt-5 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Users className="w-4 h-4 text-zinc-400 shrink-0" />
                <span>{i18n.ui.audienceSimulatorLabel}:</span>
                <span className="font-mono-tabular font-semibold text-zinc-200">
                  {communityAverage.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={1.0}
                max={10.0}
                step={0.1}
                value={communityAverage}
                aria-label={i18n.ui.communityPrediction}
                onChange={(e) =>
                  void updateCommunityPrediction(parseFloat(e.target.value))
                }
                className="w-full sm:w-48 accent-zinc-400 cursor-pointer"
              />
            </div>

            {/* შემაჯამებელი მეტრიკების ზოლი (საშუალო ქულა, ხალხის პროგნოზი, მეტა-ქულა) */}
            <div className="mt-6 pt-6 border-t border-zinc-800 grid grid-cols-3 gap-4">
              <div>
                <span className="block text-xs text-zinc-400">
                  {i18n.ui.averageScore}
                </span>
                <span className="text-2xl md:text-3xl font-bold font-mono-tabular text-zinc-100 mt-1 block">
                  {currentAverage.toFixed(1)}
                </span>
              </div>

              <div>
                <span className="block text-xs text-zinc-400">
                  {i18n.ui.communityPrediction}
                </span>
                <span className="text-2xl md:text-3xl font-bold font-mono-tabular text-zinc-300 mt-1 block">
                  {communityAverage.toFixed(1)}
                </span>
              </div>

              <div>
                <span className="block text-xs text-zinc-400">
                  {i18n.ui.metaScore}
                </span>
                <span className="text-2xl md:text-3xl font-bold font-mono-tabular text-amber-400 mt-1 block">
                  {currentMetaScore}
                  <span className="text-xs text-zinc-500 font-normal ml-1">
                    / 100
                  </span>
                </span>
              </div>
            </div>

            {/* მთავარი CTA: ვერდიქტის დაფიქსირება */}
            <div className="mt-6 pt-4">
              <button
                type="button"
                onClick={() => void handleLockVerdict()}
                className="w-full py-4 px-6 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-base tracking-wide transition-colors flex items-center justify-center gap-2.5 cursor-pointer whitespace-nowrap shadow-lg shadow-amber-500/10"
              >
                <Award className="w-5 h-5 shrink-0" />
                <span>{i18n.ui.lockVerdict}</span>
                <span className="font-mono-tabular font-extrabold ml-1">
                  ({currentAverage.toFixed(1)})
                </span>
              </button>

              {verdictSavedToast && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-emerald-400">
                  <Check className="w-4 h-4" />
                  <span>{i18n.ui.verdictSavedNotice}</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* ადმინისტრატორის სრული პანელი: "მომხმარებლების მართვა" (მხოლოდ role === 'admin'-ისთვის) */}
      {isAdmin && (
        <section className="mt-8 border border-zinc-800/90 bg-[#111723] rounded-xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                <h2 className="text-lg font-semibold text-zinc-100">
                  {i18n.phrases.userManagement}
                </h2>
                <span className="text-xs font-mono-tabular font-bold text-amber-400">
                  ({managedUsers.length})
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {i18n.admin.userManagementSubtitle}
              </p>
            </div>
          </div>

          {managedUsers.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-400">
              {i18n.admin.emptyUsers}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="py-3 pr-4 font-semibold">
                      {i18n.admin.colUser}
                    </th>
                    <th className="py-3 px-4 font-semibold">
                      {i18n.admin.colRole}
                    </th>
                    <th className="py-3 px-4 font-semibold">
                      {i18n.admin.colVoteWeight}
                    </th>
                    <th className="py-3 px-4 font-semibold">
                      {i18n.admin.colXp}
                    </th>
                    <th className="py-3 pl-4 font-semibold text-right">
                      {i18n.admin.colActions}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/70">
                  {managedUsers.map((u) => (
                    <tr key={u.uid} className="hover:bg-zinc-900/40">
                      <td className="py-3.5 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center text-xs font-bold text-amber-400">
                            {u.avatarUrl ? (
                              <img
                                src={u.avatarUrl}
                                alt={u.displayName}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span>
                                {(u.displayName || 'U')
                                  .slice(0, 1)
                                  .toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-zinc-100 truncate">
                              {u.displayName}
                            </p>
                            <p className="text-[11px] font-mono-tabular text-zinc-500 truncate">
                              {u.uid}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-zinc-200 font-medium">
                        {i18n.roles[u.role]}
                      </td>

                      <td className="py-3.5 px-4 font-mono-tabular font-bold text-amber-400">
                        ×{u.voteWeight.toFixed(1)}
                      </td>

                      <td className="py-3.5 px-4 font-mono-tabular text-zinc-300">
                        {u.xp} XP
                      </td>

                      <td className="py-3.5 pl-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <select
                            aria-label={`${i18n.admin.colActions}: ${u.displayName}`}
                            value={u.role}
                            disabled={updatingUserUid === u.uid}
                            onChange={(e) =>
                              void handleUserRoleChange(
                                u,
                                e.target.value as UserRole
                              )
                            }
                            className="px-3 py-1.5 text-xs font-medium bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                          >
                            {ADMIN_ROLE_OPTIONS.map((opt) => (
                              <option key={opt.role} value={opt.role}>
                                {opt.label}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            disabled={updatingUserUid === u.uid}
                            title={i18n.phrases.deleteShort}
                            onClick={() => void handleDeleteUser(u)}
                            className="p-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
