import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { i18n } from '../../lib/i18n';
import { fetchYouTubeMetadata, extractYouTubeId } from '../../lib/youtube';
import {
  useLiveSession,
  PRESET_COVERS,
  INITIAL_CRITERIA_SCORES,
} from '../../hooks/useLiveSession';
import {
  CRITERIA_KEYS,
  calculateAverageScore,
  calculateMetaScore,
  getArtistIdFromName,
  type CriteriaKey,
  type CriteriaScores,
  type LiveStreamStatus,
} from '../../types';

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
    updateDraftScores,
    updateStreamStatus,
    lockInVerdict,
    addAndActivateTrack,
    launchTrackOnAir,
    updateCommunityPrediction,
  } = useLiveSession('current');

  // რიგის ჩანართი: 'in_queue' ("სტრიმის რიგი") vs 'all' ("სრული კატალოგი")
  const [queueTab, setQueueTab] = useState<'in_queue' | 'all'>('in_queue');

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
                  </div>
                </>
              ) : (
                <p className="text-base text-zinc-400">
                  {i18n.ui.noActiveTrack}
                </p>
              )}
            </div>
          </div>

          {/* მარჯვენა მხარე: ეთერის სტატუსის სეგმენტირებული მართვა */}
          <div className="flex flex-col items-start lg:items-end gap-2 shrink-0">
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
        </div>
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

              <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-zinc-800 rounded-lg">
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
              </div>
            </div>

            <p className="text-xs text-zinc-400">
              {i18n.studioQueue.queueSubtitle}
            </p>

            {displayedQueueTracks.length === 0 ? (
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
                        onClick={() => void launchTrackOnAir(track.id)}
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
    </div>
  );
}
