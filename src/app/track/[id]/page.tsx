import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Disc3,
  ThumbsUp,
  Check,
  Sliders,
  MessageSquarePlus,
  Award,
  Users,
  Radio,
} from 'lucide-react';
import { collection, onSnapshot } from 'firebase/firestore';
import { i18n } from '../../../lib/i18n';
import {
  useLiveSession,
  PRESET_COVERS,
} from '../../../hooks/useLiveSession';
import {
  CRITERIA_KEYS,
  VALIDATION_CONSTRAINTS,
  calculateAverageScore,
  calculateFairTrackRating,
  getArtistIdFromName,
  type CriteriaKey,
  type CriteriaScores,
  type TrackReview,
  type UserRole,
} from '../../../types';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../../../lib/firebase';

export interface TrackPageProps {
  params?: { id: string };
  trackId?: string;
  onBackToCatalog?: () => void;
  onSelectArtist?: (artistId: string) => void;
  onOpenStudio?: () => void;
}

export default function TrackDetailPage({
  params,
  trackId: propTrackId,
  onBackToCatalog,
  onSelectArtist,
  onOpenStudio,
}: TrackPageProps) {
  const resolvedTrackId = propTrackId ?? params?.id ?? 'track_tbilisi_night';

  const {
    tracksQueue,
    session,
    userProfile,
    submitTrackReview,
    toggleReviewHelpful,
    selectActiveTrack,
  } = useLiveSession('current');

  const track =
    tracksQueue.find((t) => t.id === resolvedTrackId) ?? tracksQueue[0] ?? null;

  const currentTrackId = track?.id ?? resolvedTrackId;

  const [trackReviews, setTrackReviews] = useState<TrackReview[]>([]);
  const [imgError, setImgError] = useState(false);

  // მომხმარებლის შეფასების ფორმის მდგომარეობა
  const [authorName, setAuthorName] = useState<string>(
    () => userProfile?.displayName ?? auth.currentUser?.displayName ?? ''
  );
  const [userScores, setUserScores] = useState<CriteriaScores>({
    lyrics: 8.5,
    flow: 8.8,
    production: 9.0,
    identity: 8.7,
    vibe: 9.0,
  });
  const [reviewText, setReviewText] = useState<string>('');
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ხმის წონა და როლი მკაცრად მოდის მხოლოდ ავტორიზებული მომხმარებლის პროფილიდან (userProfile)
  const currentUserRole: UserRole = userProfile?.role ?? 'viewer';
  const currentVoteWeight: number = userProfile?.voteWeight ?? 1.0;

  useEffect(() => {
    if (userProfile?.displayName && !authorName) {
      setAuthorName(userProfile.displayName);
    }
  }, [userProfile?.displayName, authorName]);

  // რეალური რეცენზიების მოსმენა Firestore-ის ქვეკოლექციიდან: collection(db, 'tracks', trackId, 'reviews')
  useEffect(() => {
    if (!currentTrackId) return;

    const reviewsPath = `tracks/${currentTrackId}/reviews`;
    const reviewsColRef = collection(db, 'tracks', currentTrackId, 'reviews');

    const unsubscribeReviews = onSnapshot(
      reviewsColRef,
      (snapshot) => {
        const firestoreReviews: TrackReview[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          const createdMs =
            typeof data.createdAt === 'number'
              ? data.createdAt
              : data.createdAt &&
                  typeof (data.createdAt as { toMillis?: () => number })
                    .toMillis === 'function'
                ? (data.createdAt as { toMillis: () => number }).toMillis()
                : Date.now();

          return {
            id: docSnap.id,
            trackId: (data.trackId as string) || currentTrackId,
            trackTitle: track?.title,
            trackArtist: track?.artist,
            trackCoverUrl: track?.coverUrl,
            authorId: (data.authorId as string) || '',
            authorName: (data.authorName as string) || 'მსმენელი',
            authorRole: (data.authorRole as UserRole) || 'viewer',
            voteWeight:
              typeof data.voteWeight === 'number' ? data.voteWeight : 1.0,
            scores: (data.scores as CriteriaScores) || {
              lyrics: 8.0,
              flow: 8.0,
              production: 8.0,
              identity: 8.0,
              vibe: 8.0,
            },
            totalScore:
              typeof data.totalScore === 'number'
                ? data.totalScore
                : calculateAverageScore(
                    (data.scores as CriteriaScores) || {
                      lyrics: 8.0,
                      flow: 8.0,
                      production: 8.0,
                      identity: 8.0,
                      vibe: 8.0,
                    }
                  ),
            text: (data.text as string) || '',
            helpfulCount:
              typeof data.helpfulCount === 'number' ? data.helpfulCount : 0,
            helpfulVoterIds: Array.isArray(data.helpfulVoterIds)
              ? (data.helpfulVoterIds as string[])
              : [],
            createdAt: createdMs,
          };
        });

        firestoreReviews.sort((a, b) => b.createdAt - a.createdAt);
        setTrackReviews(firestoreReviews);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, reviewsPath);
        } catch {
          // logged by handleFirestoreError
        }
      }
    );

    return () => unsubscribeReviews();
  }, [currentTrackId, track?.title, track?.artist, track?.coverUrl]);

  if (!track) {
    return (
      <div className="max-w-[1280px] mx-auto px-6 py-12 text-zinc-400">
        {i18n.ui.noActiveTrack}
      </div>
    );
  }

  const trimmedLength = reviewText.trim().length;
  const minRequired = VALIDATION_CONSTRAINTS.REVIEW_TEXT_MIN_LENGTH;
  const isTextValid = trimmedLength >= minRequired;
  const charsRemaining = Math.max(0, minRequired - trimmedLength);
  const userAverage = calculateAverageScore(userScores);

  const expertTotal =
    track.expertTotalScore ??
    (track.expertScore ? calculateAverageScore(track.expertScore) : null);
  const communityTotal =
    track.communityTotalScore ??
    (track.communityScore ? calculateAverageScore(track.communityScore) : null);
  const fairScore = calculateFairTrackRating(track);

  const isCurrentlyInLiveStream =
    session?.isLive &&
    session?.streamStatus !== 'idle' &&
    session?.activeTrackId === track.id;

  const handleScoreSlider = (key: CriteriaKey, val: number) => {
    const rounded = Math.min(10, Math.max(1, Math.round(val * 10) / 10));
    setUserScores((prev) => ({
      ...prev,
      [key]: rounded,
    }));
    setSubmitSuccess(false);
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (trimmedLength < minRequired) {
      setFormError(
        `${i18n.portal.min100Chars} (${trimmedLength} / ${minRequired})`
      );
      return;
    }

    await submitTrackReview({
      trackId: track.id,
      authorName:
        authorName.trim() ||
        userProfile?.displayName ||
        auth.currentUser?.displayName ||
        'ქართველი მსმენელი',
      scores: userScores,
      text: reviewText.trim(),
    });

    setReviewText('');
    setSubmitSuccess(true);
  };

  const currentVoterId = auth.currentUser?.uid ?? 'local_visitor';

  return (
    <div className="w-full max-w-[1360px] mx-auto px-6 py-8 space-y-10">
      {/* უკან კატალოგში დაბრუნების ზოლი */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToCatalog}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{i18n.nav.backToCatalog}</span>
        </button>

        <div className="flex items-center gap-3">
          {isCurrentlyInLiveStream && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>{i18n.portal.liveStreamActiveBanner}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              void selectActiveTrack(track.id);
              if (onOpenStudio) onOpenStudio();
            }}
            className="px-3.5 py-2 text-xs font-medium text-zinc-300 bg-[#111723] border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            {i18n.ui.activateTrack} (Studio)
          </button>
        </div>
      </div>

      {/* 1. რელიზის ქუდი (Release Header): გარეკანი, არტისტი, სახელწოდება, ჟანრი, Expert Score, Community Score და რეცენზიების რაოდენობა */}
      <section className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6 md:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* გარეკანი და მეტამონაცემები */}
          <div className="lg:col-span-7 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="w-36 h-36 sm:w-44 sm:h-44 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center shadow-xl">
              {!imgError && track.coverUrl ? (
                <img
                  src={track.coverUrl || PRESET_COVERS.vinyl}
                  alt={track.title}
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc3 className="w-14 h-14 text-amber-400/80" />
              )}
            </div>

            <div className="space-y-3 min-w-0">
              {/* სუფთა ტექსტური მეტამონაცემები (Zero-Pill discipline) */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className="text-amber-400 font-medium">
                  {track.genre || 'ქართული სცენა'}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {i18n.portal.ratingsCount}:{' '}
                  <strong className="font-mono-tabular text-zinc-200">
                    {track.communityVotesCount}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  {trackReviews.length} {i18n.portal.reviewsCountLabel}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-zinc-100 tracking-tight balance">
                {track.title}
              </h1>

              <div className="flex flex-wrap items-center gap-3 text-base sm:text-lg text-zinc-300">
                <div>
                  <span className="text-zinc-500">{i18n.ui.artist}: </span>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectArtist &&
                      onSelectArtist(
                        track.artistId || getArtistIdFromName(track.artist)
                      )
                    }
                    className="font-semibold text-zinc-100 hover:text-amber-400 hover:underline transition-colors cursor-pointer"
                  >
                    {track.artist}
                  </button>
                </div>

                {onSelectArtist && (
                  <button
                    type="button"
                    onClick={() =>
                      onSelectArtist(
                        track.artistId || getArtistIdFromName(track.artist)
                      )
                    }
                    className="px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {i18n.phrases.artistProfile} →
                  </button>
                )}
              </div>

              <div className="pt-1 flex flex-wrap items-center gap-4 text-xs text-zinc-400">
                <span>
                  {i18n.portal.fairRatingLabel}:{' '}
                  <strong className="font-mono-tabular text-zinc-100">
                    {fairScore.toFixed(2)}
                  </strong>{' '}
                  / 10.0
                </span>
                {track.metaScore !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {i18n.ui.metaScore}:{' '}
                      <strong className="font-mono-tabular text-amber-400">
                        {track.metaScore}
                      </strong>{' '}
                      / 100
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* მარჯვენა მხარე: Expert Score, Community Score და შეფასებების რაოდენობა */}
          <div className="lg:col-span-5 grid grid-cols-3 gap-4 pt-6 lg:pt-0 border-t lg:border-t-0 lg:border-l border-zinc-800/80 lg:pl-8">
            {/* Expert Score */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{i18n.portal.expertScoreLabel}</span>
              </div>
              {expertTotal !== null ? (
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-extrabold font-mono-tabular text-amber-400">
                    {expertTotal.toFixed(1)}
                  </span>
                  <span className="text-xs font-mono-tabular text-zinc-500">
                    /10
                  </span>
                </div>
              ) : (
                <span className="block text-xs text-zinc-500 pt-2">
                  {i18n.portal.notEvaluatedYet}
                </span>
              )}
            </div>

            {/* Community Score (ხალხის რეიტინგი) */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{i18n.portal.communityScoreLabel}</span>
              </div>
              {communityTotal !== null ? (
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-extrabold font-mono-tabular text-emerald-400">
                    {communityTotal.toFixed(1)}
                  </span>
                  <span className="text-xs font-mono-tabular text-zinc-500">
                    /10
                  </span>
                </div>
              ) : (
                <span className="block text-xs text-zinc-500 pt-2">—</span>
              )}
            </div>

            {/* შეფასებების რაოდენობა */}
            <div className="space-y-1">
              <span className="block text-xs text-zinc-400">
                {i18n.portal.ratingsCount}
              </span>
              <span className="block text-3xl sm:text-4xl font-extrabold font-mono-tabular text-zinc-100">
                {track.communityVotesCount}
              </span>
              <span className="block text-xs text-zinc-500">
                {trackReviews.length} {i18n.portal.reviewsCountLabel}
              </span>
            </div>
          </div>
        </div>

        {/* 5 კრიტერიუმის შედარებითი ზოლი (ექსპერტი vs ხალხის რეიტინგი) */}
        <div className="mt-8 pt-6 border-t border-zinc-800/80">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-200">
              {i18n.portal.criteriaBreakdownTitle}
            </h2>
            <span className="text-xs text-zinc-400">
              {i18n.portal.expertVsCommunity}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            {CRITERIA_KEYS.map((key) => {
              const expVal = track.expertScore ? track.expertScore[key] : null;
              const comVal = track.communityScore
                ? track.communityScore[key]
                : null;

              return (
                <div
                  key={key}
                  className="bg-[#0B0F17] border border-zinc-800/80 rounded-xl p-3.5 space-y-2"
                >
                  <span className="block text-xs font-medium text-zinc-300 truncate">
                    {i18n.criteria[key]}
                  </span>
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <span className="block text-[11px] text-zinc-500">
                        ექსპერტი
                      </span>
                      <span className="font-mono-tabular text-base font-bold text-amber-400">
                        {expVal !== null ? expVal.toFixed(1) : '—'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[11px] text-zinc-500">
                        ხალხი
                      </span>
                      <span className="font-mono-tabular text-base font-bold text-emerald-400">
                        {comVal !== null ? comVal.toFixed(1) : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. ქვედა სექცია: მარცხნივ რეცენზიის დაწერის ფორმა (5 კრიტერიუმი + მინ. 100 სიმბოლო), მარჯვნივ რეცენზიების სია */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* მარცხენა სვეტი (5 სვეტი): დაწერე რეცენზია */}
        <section className="lg:col-span-5 border border-zinc-800/90 bg-[#111723] rounded-2xl p-6">
          <div className="flex items-center justify-between pb-4 mb-5 border-b border-zinc-800/80">
            <div>
              <h2 className="text-lg font-semibold text-zinc-100">
                {i18n.portal.writeReview}
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                {i18n.portal.min100Chars} · 5 კრიტერიუმით შეფასება
              </p>
            </div>
            <MessageSquarePlus className="w-5 h-5 text-amber-400 shrink-0" />
          </div>

          <form onSubmit={(e) => void handleReviewSubmit(e)} className="space-y-5">
            {/* ავტორის სახელი და ფიქსირებული ხმის წონა მომხმარებლის პროფილიდან */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label
                  htmlFor="review-author"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  {i18n.portal.authorNameLabel}
                </label>
                <input
                  id="review-author"
                  type="text"
                  maxLength={80}
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder={i18n.portal.authorNamePlaceholder}
                  className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-zinc-300 mb-1.5">
                  {i18n.portal.voteWeightBadge}
                </span>
                <div className="w-full px-3 py-2 text-sm bg-[#0B0F17] border border-zinc-800/80 rounded-lg text-zinc-200 flex items-center justify-between">
                  <span className="truncate">{i18n.roles[currentUserRole]}</span>
                  <span className="font-mono-tabular font-bold text-amber-400">
                    ×{currentVoteWeight.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>

            {/* 5 კრიტერიუმის სლაიდერი */}
            <div className="space-y-4 pt-2 border-t border-zinc-800/70">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>შეაფასეთ 5 პარამეტრი (1–10)</span>
                </span>
                <span className="text-sm font-bold font-mono-tabular text-amber-400">
                  {i18n.ui.averageScore}: {userAverage.toFixed(1)}
                </span>
              </div>

              {CRITERIA_KEYS.map((key) => {
                const val = userScores[key];
                const pct = ((val - 1) / 9) * 100;
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-200 font-medium">
                        {i18n.criteria[key]}
                      </span>
                      <span className="font-mono-tabular font-bold text-amber-400">
                        {val.toFixed(1)}
                      </span>
                    </div>
                    <div className="relative pt-0.5">
                      <div className="w-full h-1.5 bg-[#0B0F17] rounded-full overflow-hidden border border-zinc-800">
                        <div
                          className="h-full bg-amber-500 origin-left"
                          style={{
                            transform: `scaleX(${Math.max(0.02, pct / 100)})`,
                          }}
                        />
                      </div>
                      <input
                        type="range"
                        min={1.0}
                        max={10.0}
                        step={0.1}
                        value={val}
                        aria-label={i18n.criteria[key]}
                        onChange={(e) =>
                          handleScoreSlider(key, parseFloat(e.target.value))
                        }
                        className="studio-fader absolute inset-0 w-full h-full opacity-100"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* რეცენზიის ტექსტი (მინიმუმ 100 სიმბოლო) */}
            <div className="space-y-2 pt-2 border-t border-zinc-800/70">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="review-text"
                  className="font-medium text-zinc-200"
                >
                  {i18n.portal.writeReview} *
                </label>
                <span
                  className={`font-mono-tabular ${
                    isTextValid ? 'text-emerald-400' : 'text-zinc-400'
                  }`}
                >
                  {trimmedLength} / {minRequired} {i18n.portal.charCountSuffix}
                </span>
              </div>

              <textarea
                id="review-text"
                rows={5}
                required
                value={reviewText}
                onChange={(e) => {
                  setReviewText(e.target.value);
                  setFormError(null);
                  setSubmitSuccess(false);
                }}
                placeholder={i18n.portal.reviewPlaceholder}
                className="w-full px-3.5 py-3 text-sm bg-[#0B0F17] border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors leading-relaxed"
              />

              <div className="flex items-center justify-between text-xs">
                {isTextValid ? (
                  <span className="text-emerald-400">
                    ✓ {i18n.portal.charLimitReached}
                  </span>
                ) : (
                  <span className="text-zinc-400">
                    {i18n.portal.min100Chars} ({i18n.portal.charsRemaining}:{' '}
                    <strong className="font-mono-tabular text-zinc-200">
                      {charsRemaining}
                    </strong>
                    )
                  </span>
                )}
              </div>
            </div>

            {formError && (
              <p className="text-xs text-red-400 font-medium">{formError}</p>
            )}

            <button
              type="submit"
              disabled={!isTextValid}
              className={`w-full py-3.5 px-5 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${
                isTextValid
                  ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer'
                  : 'bg-zinc-800/70 text-zinc-500 cursor-not-allowed'
              }`}
            >
              <span>{i18n.portal.submitReview}</span>
              <span className="font-mono-tabular">
                ({userAverage.toFixed(1)} · ×{currentVoteWeight.toFixed(1)})
              </span>
            </button>

            {submitSuccess && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 pt-1">
                <Check className="w-4 h-4 shrink-0" />
                <span>{i18n.portal.reviewSubmittedSuccess}</span>
              </div>
            )}
          </form>
        </section>

        {/* მარჯვენა სვეტი (7 სვეტი): მომხმარებლების რეცენზიების სია */}
        <section className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between pb-2">
            <h2 className="text-lg font-semibold text-zinc-100">
              {i18n.portal.recentReviews} ({trackReviews.length})
            </h2>
            <span className="text-xs text-zinc-400">
              {i18n.portal.communityScoreLabel}:{' '}
              <strong className="font-mono-tabular text-emerald-400">
                {communityTotal !== null ? communityTotal.toFixed(1) : '—'}
              </strong>
            </span>
          </div>

          {trackReviews.length === 0 ? (
            <div className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-8 text-center text-sm text-zinc-400">
              პირველი რეცენზია ჯერ არ დაწერილა
            </div>
          ) : (
            <div className="space-y-4">
              {trackReviews.map((review) => {
                const isHelpfulVoted = (review.helpfulVoterIds ?? []).includes(
                  currentVoterId
                );

                return (
                  <article
                    key={review.id}
                    className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6 space-y-4"
                  >
                    {/* რეცენზიის ავტორი და საერთო ქულა */}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-zinc-100">
                          {review.authorName}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-0.5">
                          <span>{i18n.roles[review.authorRole]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular text-zinc-300">
                            {i18n.portal.voteWeightBadge} ×
                            {review.voteWeight.toFixed(1)}
                          </span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-2xl font-extrabold font-mono-tabular text-amber-400">
                          {review.totalScore.toFixed(1)}
                        </span>
                        <span className="text-xs font-mono-tabular text-zinc-500 ml-1">
                          /10
                        </span>
                      </div>
                    </div>

                    {/* 5 კრიტერიუმის ქულები ერთ ხაზზე */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-400 py-2.5 border-y border-zinc-800/70">
                      {CRITERIA_KEYS.map((key, idx) => (
                        <React.Fragment key={key}>
                          {idx > 0 && (
                            <span
                              aria-hidden="true"
                              className="text-zinc-700 hidden sm:inline"
                            >
                              ·
                            </span>
                          )}
                          <span>
                            {i18n.criteriaShort[key]}:{' '}
                            <strong className="font-mono-tabular text-zinc-200">
                              {review.scores[key].toFixed(1)}
                            </strong>
                          </span>
                        </React.Fragment>
                      ))}
                    </div>

                    {/* რეცენზიის ტექსტი */}
                    <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-line">
                      {review.text}
                    </p>

                    {/* ქვედა ზოლი: აპვოუთი "სასარგებლოა" */}
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-xs text-zinc-500">
                        {i18n.portal.helpfulReview}
                      </span>

                      <button
                        type="button"
                        onClick={() =>
                          void toggleReviewHelpful(review.id, track.id)
                        }
                        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                          isHelpfulVoted
                            ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                            : 'bg-[#0B0F17] border-zinc-800 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <ThumbsUp className="w-3.5 h-3.5" />
                        <span>{i18n.portal.helpfulLabel}</span>
                        <span className="font-mono-tabular font-bold">
                          ({review.helpfulCount})
                        </span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
