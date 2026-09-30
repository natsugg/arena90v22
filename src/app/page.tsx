import React, { useState, useMemo } from 'react';
import {
  Radio,
  Search,
  Award,
  Users,
  ThumbsUp,
  MessageSquare,
  ChevronUp,
  ChevronDown,
  ArrowUpRight,
  Plus,
  Lock,
  User as UserIcon,
} from 'lucide-react';
import { i18n } from '../lib/i18n';
import TopChart from '../components/TopChart';
import { useLiveSession, PRESET_COVERS } from '../hooks/useLiveSession';
import {
  calculateFairTrackRating,
  canUserPublishTrack,
  getArtistIdFromName,
  toTimestampMillis,
  CRITERIA_KEYS,
} from '../types';
import { auth } from '../lib/firebase';

export type LeaderboardTab = 'all_time' | 'monthly' | 'recent_reviews';

export interface HomePageProps {
  onSelectTrack?: (trackId: string) => void;
  onSelectArtist?: (artistId: string) => void;
  onOpenStudio?: () => void;
  onOpenSubmitModal?: () => void;
}

export default function HomePage({
  onSelectTrack,
  onSelectArtist,
  onOpenStudio,
  onOpenSubmitModal,
}: HomePageProps) {
  const {
    session,
    activeTrack,
    tracksQueue,
    artists,
    reviews,
    topCritics,
    userProfile,
    currentUserProfile,
    loading,
    toggleReviewHelpful,
  } = useLiveSession('current');

  const activeUserProfile = currentUserProfile ?? userProfile;
  const canPublishTrack = canUserPublishTrack(activeUserProfile?.role);

  const [activeTab, setActiveTab] = useState<LeaderboardTab>('all_time');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [streamBannerCollapsed, setStreamBannerCollapsed] =
    useState<boolean>(false);

  // ლაივ-სესია აქტიურია მხოლოდ მაშინ, როცა სტატუსი არ არის 'idle' და არსებობს აქტიური ტრეკი
  const isStreamActive = Boolean(
    session &&
      session.isLive &&
      session.streamStatus !== 'idle' &&
      activeTrack
  );

  // უნიკალური ჟანრების სია ფილტრისთვის
  const genres = useMemo(() => {
    const set = new Set<string>();
    tracksQueue.forEach((t) => {
      if (t.genre) set.add(t.genre);
    });
    return Array.from(set);
  }, [tracksQueue]);

  // ტოპ 24-ის სორტირება სამართლიანი შეწონილი რეიტინგით (Bayesian Fair Rating)
  const sortedTracks = useMemo(() => {
    const thirtyDaysAgo = Date.now() - 30 * 86_400_000;

    return tracksQueue
      .filter((track) => {
        if (activeTab === 'monthly') {
          const createdMs = toTimestampMillis(track.createdAt) || Date.now();
          if (createdMs < thirtyDaysAgo) return false;
        }
        if (selectedGenre !== 'all' && track.genre !== selectedGenre) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            track.title.toLowerCase().includes(q) ||
            track.artist.toLowerCase().includes(q) ||
            (track.genre ?? '').toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => calculateFairTrackRating(b) - calculateFairTrackRating(a))
      .slice(0, 24);
  }, [tracksQueue, activeTab, selectedGenre, searchQuery]);

  const currentVoterId = auth.currentUser?.uid ?? 'local_visitor';

  const handleOpenTrack = (trackId: string) => {
    if (onSelectTrack) {
      onSelectTrack(trackId);
    }
  };

  const handleOpenArtist = (artistIdOrName: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (onSelectArtist) {
      onSelectArtist(artistIdOrName);
    }
  };

  return (
    <div className="w-full max-w-[1360px] mx-auto px-6 py-8 space-y-8">
      {/* 1. ზედა Live-სტრიმის ბლოკი: თუ სესია არააქტიურია ('idle' ან ტრეკის გარეშე), იკეცება კომპაქტურ ზოლად */}
      {!isStreamActive ? (
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl border border-zinc-800/70 bg-[#111723]/60 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-zinc-500" />
            <span>{i18n.portal.liveStreamIdleCollapsed}</span>
          </div>
          {onOpenStudio && (
            <button
              type="button"
              onClick={onOpenStudio}
              className="text-zinc-300 hover:text-amber-400 font-medium transition-colors cursor-pointer whitespace-nowrap"
            >
              {i18n.portal.openStudio} →
            </button>
          )}
        </div>
      ) : streamBannerCollapsed ? (
        <div className="flex items-center justify-between gap-4 px-5 py-3 rounded-xl border border-amber-500/30 bg-[#111723] text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <Radio className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />
            <span className="font-semibold text-amber-400 whitespace-nowrap">
              {i18n.portal.liveStreamActiveBanner}
            </span>
            <span aria-hidden="true" className="text-zinc-600">
              ·
            </span>
            <span className="text-zinc-200 font-medium truncate">
              {activeTrack?.artist} — {activeTrack?.title}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setStreamBannerCollapsed(false)}
            className="inline-flex items-center gap-1 text-zinc-300 hover:text-zinc-100 cursor-pointer whitespace-nowrap shrink-0"
          >
            <span>{i18n.portal.showStreamBanner}</span>
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <section className="border border-amber-500/30 bg-[#111723] rounded-2xl p-5 md:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-center gap-4 min-w-0">
              <img
                src={activeTrack?.coverUrl || PRESET_COVERS.vinyl}
                alt={activeTrack?.title}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = PRESET_COVERS.vinyl;
                }}
                className="w-16 h-16 rounded-xl object-cover bg-zinc-900 border border-zinc-800 shrink-0"
              />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Radio className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span className="font-semibold text-amber-400">
                    {i18n.portal.liveStreamActiveBanner}
                  </span>
                  <span aria-hidden="true" className="text-zinc-600">
                    ·
                  </span>
                  <span className="text-zinc-300">
                    {session ? i18n.statuses[session.streamStatus] : ''}
                  </span>
                </div>

                <h2 className="text-lg md:text-xl font-bold text-zinc-100 truncate">
                  {activeTrack?.title}
                </h2>
                <p className="text-xs md:text-sm text-zinc-400 truncate">
                  {i18n.ui.artist}:{' '}
                  <button
                    type="button"
                    onClick={(e) =>
                      activeTrack &&
                      handleOpenArtist(
                        activeTrack.artistId ||
                          getArtistIdFromName(activeTrack.artist),
                        e
                      )
                    }
                    className="text-zinc-200 hover:text-amber-400 font-medium transition-colors cursor-pointer"
                  >
                    {activeTrack?.artist}
                  </button>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {activeTrack && (
                <button
                  type="button"
                  onClick={() => handleOpenTrack(activeTrack.id)}
                  className="px-4 py-2.5 text-xs font-semibold bg-amber-500 text-zinc-950 rounded-lg hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {i18n.portal.openTrackPage}
                </button>
              )}
              {onOpenStudio && (
                <button
                  type="button"
                  onClick={onOpenStudio}
                  className="px-3.5 py-2.5 text-xs font-medium bg-[#0B0F17] text-zinc-200 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {i18n.portal.openStudio}
                </button>
              )}
              <button
                type="button"
                onClick={() => setStreamBannerCollapsed(true)}
                className="inline-flex items-center gap-1 px-2.5 py-2 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer whitespace-nowrap"
              >
                <span>{i18n.portal.hideStreamBanner}</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 2. პორტალის სათაური, ლიდერბორდის ჩანართები და ძიება/ფილტრი */}
      <section className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-800/90 pb-5">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-zinc-100 tracking-tight">
              {i18n.portal.top24Tracks}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              {i18n.brand.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {onOpenSubmitModal && canPublishTrack ? (
              <button
                type="button"
                onClick={onOpenSubmitModal}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/40 rounded-xl hover:bg-amber-500/25 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{i18n.phrases.submitTrack}</span>
              </button>
            ) : (
              <span
                title={`${i18n.phrases.accessRestricted} — ${i18n.phrases.expertsOnly}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-500 bg-[#111723] border border-zinc-800/80 rounded-xl select-none whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                <span>{i18n.phrases.expertsOnly}</span>
              </span>
            )}

            {/* ლიდერბორდის 3 ჩანართი */}
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-[#111723] border border-zinc-800 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('all_time')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'all_time'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {i18n.portal.top24AllTime}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('monthly')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'monthly'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {i18n.portal.monthlyFeatured}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('recent_reviews')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'recent_reviews'
                    ? 'bg-amber-500 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {i18n.portal.recentReviews} ({reviews.length})
              </button>
            </div>
          </div>
        </div>

        {/* ძიებისა და ჟანრის ფილტრის ზოლი (როცა ჩართულია ტრეკების რეიტინგი) */}
        {activeTab !== 'recent_reviews' && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={i18n.portal.searchPlaceholder}
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-[#111723] border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedGenre('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  selectedGenre === 'all'
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-[#111723] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {i18n.portal.allGenres}
              </button>
              {genres.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  onClick={() => setSelectedGenre(genre)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                    selectedGenre === genre
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 bg-[#111723] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 3. მთავარი კონტენტის ბადე: მარცხნივ (8 სვეტი) ტოპ-24 ან ბოლო რეცენზიები, მარჯვნივ (4 სვეტი) არტისტები და ტოპ კრიტიკოსები */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* მარცხენა 8 სვეტი */}
        <div className="lg:col-span-8">
          {activeTab === 'recent_reviews' ? (
            reviews.length === 0 ? (
              <div className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-10 text-center text-sm text-zinc-400">
                რეცენზიები ჯერ არ დაწერილა
              </div>
            ) : (
              <div className="space-y-4">
                {reviews.map((rev) => {
                  const isHelpfulVoted = (rev.helpfulVoterIds ?? []).includes(
                    currentVoterId
                  );

                  return (
                    <article
                      key={rev.id}
                      className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6 space-y-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-zinc-800/80">
                        <button
                          type="button"
                          onClick={() => handleOpenTrack(rev.trackId)}
                          className="flex items-center gap-3 text-left group cursor-pointer min-w-0"
                        >
                          <img
                            src={rev.trackCoverUrl || PRESET_COVERS.vinyl}
                            alt={rev.trackTitle}
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = PRESET_COVERS.vinyl;
                            }}
                            className="w-12 h-12 rounded-lg object-cover bg-zinc-900 border border-zinc-800 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-zinc-100 group-hover:text-amber-400 transition-colors truncate">
                              {rev.trackTitle}
                            </p>
                            <p className="text-xs text-zinc-400 truncate">
                              {rev.trackArtist}
                            </p>
                          </div>
                        </button>

                        <div className="text-right shrink-0">
                          <span className="text-2xl font-extrabold font-mono-tabular text-amber-400">
                            {rev.totalScore.toFixed(1)}
                          </span>
                          <span className="text-xs font-mono-tabular text-zinc-500 ml-1">
                            /10
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                        <div>
                          <strong className="text-zinc-200 font-semibold">
                            {rev.authorName}
                          </strong>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span>{i18n.roles[rev.authorRole]}</span>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono-tabular">
                            {i18n.portal.voteWeightBadge} ×
                            {rev.voteWeight.toFixed(1)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 font-mono-tabular text-zinc-400">
                          {CRITERIA_KEYS.map((k) => (
                            <span key={k}>
                              {i18n.criteriaShort[k]} {rev.scores[k].toFixed(1)}
                            </span>
                          ))}
                        </div>
                      </div>

                      <p className="text-sm text-zinc-200 leading-relaxed break-words break-all [overflow-wrap:anywhere] whitespace-pre-wrap">
                        {rev.text}
                      </p>

                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() => handleOpenTrack(rev.trackId)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 cursor-pointer"
                        >
                          <span>{i18n.portal.openTrackPage}</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          disabled={rev.authorId === currentVoterId}
                          onClick={() =>
                            void toggleReviewHelpful(rev.id, rev.trackId)
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                            rev.authorId === currentVoterId
                              ? 'bg-[#0B0F17] border-zinc-800/60 text-zinc-500 cursor-not-allowed opacity-70'
                              : isHelpfulVoted
                                ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 cursor-pointer'
                                : 'bg-[#0B0F17] border-zinc-800 text-zinc-300 hover:border-zinc-700 cursor-pointer'
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>{i18n.portal.helpfulLabel}</span>
                          <span className="font-mono-tabular font-bold">
                            ({rev.helpfulCount})
                          </span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )
          ) : (
            <TopChart
              tracks={sortedTracks}
              reviews={reviews}
              loading={loading && tracksQueue.length === 0}
              canPublishTrack={canPublishTrack}
              onSelectTrack={handleOpenTrack}
              onSelectArtist={handleOpenArtist}
              onOpenSubmitModal={onOpenSubmitModal}
            />
          )}
        </div>

        {/* მარჯვენა 4 სვეტი: არტისტების პროფილები, "ტოპ კრიტიკოსები" და ბოლო რეცენზიების მოკლე ლენტა */}
        <aside className="lg:col-span-4 space-y-6">
          {/* არტისტები პლატფორმაზე */}
          <section className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-amber-400" />
                <h2 className="text-base font-bold text-zinc-100">
                  {i18n.phrases.artistProfile}
                </h2>
              </div>
              <span className="text-xs font-mono-tabular text-zinc-500">
                {artists.length}
              </span>
            </div>

            {artists.length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-400">
                არტისტები ჯერ არ მოიძებნა
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {artists.slice(0, 6).map((art) => (
                  <div
                    key={art.id}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenArtist(art.id)}
                      className="flex items-center gap-3 min-w-0 text-left group cursor-pointer"
                    >
                      <img
                        src={art.avatarUrl || PRESET_COVERS.vinyl}
                        alt={art.name}
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = PRESET_COVERS.vinyl;
                        }}
                        className="w-10 h-10 rounded-lg object-cover bg-zinc-900 border border-zinc-800 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-100 group-hover:text-amber-400 transition-colors truncate">
                          {art.name}
                        </p>
                        <p className="text-xs text-zinc-400 truncate">
                          {art.genres[0]}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenArtist(art.id)}
                      className="text-xs font-medium text-amber-400 hover:text-amber-300 shrink-0 cursor-pointer whitespace-nowrap"
                    >
                      {i18n.phrases.discography} →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ტოპ კრიტიკოსები */}
          <section className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                <h2 className="text-base font-bold text-zinc-100">
                  {i18n.portal.topCritics}
                </h2>
              </div>
              <Users className="w-4 h-4 text-zinc-500" />
            </div>

            {topCritics.length === 0 ? (
              <p className="py-4 text-center text-xs text-zinc-400">
                კრიტიკოსები ჯერ არ არიან
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/70">
                {topCritics.slice(0, 5).map((critic, idx) => (
                  <div
                    key={critic.uid}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono-tabular font-bold text-amber-400 w-5 shrink-0">
                        0{idx + 1}.
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-100 truncate">
                          {critic.displayName}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                          <span>{i18n.roles[critic.role]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">
                            ×{critic.voteWeight.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 text-xs">
                      <span className="block font-mono-tabular font-bold text-zinc-200">
                        {critic.helpfulVotesReceived}{' '}
                        <span className="font-normal text-zinc-400">
                          {i18n.portal.helpfulVotesTotal}
                        </span>
                      </span>
                      <span className="block font-mono-tabular text-zinc-500">
                        {critic.reviewsCount} {i18n.portal.reviewsCountLabel} ·{' '}
                        {critic.xp} XP
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ბოლო რეცენზიების სწრაფი ბლოკი */}
          {activeTab !== 'recent_reviews' && (
            <section className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-base font-bold text-zinc-100">
                    {i18n.portal.recentReviews}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('recent_reviews')}
                  className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
                >
                  ყველა →
                </button>
              </div>

              {reviews.length === 0 ? (
                <p className="py-4 text-center text-xs text-zinc-400">
                  რეცენზიები ჯერ არ დაწერილა
                </p>
              ) : (
                <div className="divide-y divide-zinc-800/70">
                  {reviews.slice(0, 3).map((rev) => (
                    <div
                      key={rev.id}
                      className="py-3.5 first:pt-0 last:pb-0 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpenTrack(rev.trackId)}
                          className="text-xs font-semibold text-amber-400 hover:underline truncate cursor-pointer text-left"
                        >
                          {rev.trackArtist} — {rev.trackTitle}
                        </button>
                        <span className="font-mono-tabular text-xs font-bold text-zinc-100 shrink-0">
                          {rev.totalScore.toFixed(1)}
                        </span>
                      </div>

                      <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">
                        {rev.text}
                      </p>

                      <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-0.5">
                        <span>{rev.authorName}</span>
                        <span className="font-mono-tabular">
                          {i18n.portal.helpfulLabel}: {rev.helpfulCount}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
