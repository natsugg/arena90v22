import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Disc3,
  Award,
  Users,
  ExternalLink,
  Music2,
  ArrowUpRight,
  Plus,
  Radio,
  Lock,
} from 'lucide-react';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  Legend,
} from 'recharts';
import { i18n } from '../../../lib/i18n';
import {
  useLiveSession,
  PRESET_COVERS,
} from '../../../hooks/useLiveSession';
import {
  calculateAverageScore,
  calculateFairTrackRating,
  calculateArtistRadarAnalytics,
  canUserPublishTrack,
  getArtistIdFromName,
  type Track,
} from '../../../types';

export interface ArtistPageProps {
  params?: { id: string };
  artistId?: string;
  onBackToCatalog?: () => void;
  onSelectTrack?: (trackId: string) => void;
  onSelectArtist?: (artistId: string) => void;
  onOpenSubmitModal?: (defaultArtist?: string) => void;
}

export default function ArtistProfilePage({
  params,
  artistId: propArtistId,
  onBackToCatalog,
  onSelectTrack,
  onSelectArtist,
  onOpenSubmitModal,
}: ArtistPageProps) {
  const rawArtistId = propArtistId ?? params?.id ?? '';
  const decodedId = decodeURIComponent(rawArtistId);

  const {
    tracksQueue,
    artists,
    reviews,
    currentUserProfile,
    loading,
    launchTrackOnAir,
  } = useLiveSession('current');
  const canPublishTrack = canUserPublishTrack(currentUserProfile?.role);
  const [avatarError, setAvatarError] = useState(false);

  // არტისტის მოძებნა ID-ით ან სახელით
  const artist = useMemo(() => {
    if (!decodedId) return artists[0] ?? null;

    const byId = artists.find((a) => a.id === decodedId);
    if (byId) return byId;

    const slugId = getArtistIdFromName(decodedId);
    const bySlug = artists.find((a) => a.id === slugId);
    if (bySlug) return bySlug;

    const byName = artists.find(
      (a) => a.name.toLowerCase() === decodedId.toLowerCase()
    );
    if (byName) return byName;

    return artists[0] ?? null;
  }, [artists, decodedId]);

  // არტისტის ყველა ტრეკი პლატფორმაზე
  const artistTracks = useMemo(() => {
    if (!artist) return [];
    return tracksQueue.filter((t) => {
      const trackArtistId = t.artistId || getArtistIdFromName(t.artist);
      return (
        trackArtistId === artist.id ||
        t.artist.toLowerCase() === artist.name.toLowerCase()
      );
    });
  }, [tracksQueue, artist]);

  // 5 კრიტერიუმის საშუალო რადარ-ანალიტიკა (ტექსტი, ფლოუ, ბითი, ინდივიდუალიზმი, ვაიბი)
  const radarAnalytics = useMemo(
    () => calculateArtistRadarAnalytics(artistTracks),
    [artistTracks]
  );

  if (loading && !artist) {
    return (
      <div className="max-w-[1360px] mx-auto px-6 py-12 space-y-6 animate-pulse">
        <div className="h-5 w-40 bg-zinc-800/80 rounded" />
        <div className="h-48 w-full bg-[#111723] border border-zinc-800/90 rounded-2xl p-8 flex items-center gap-6">
          <div className="w-32 h-32 rounded-2xl bg-zinc-800/80 shrink-0" />
          <div className="space-y-4 flex-1">
            <div className="h-4 w-32 bg-zinc-800/80 rounded" />
            <div className="h-8 w-56 bg-zinc-800/80 rounded" />
            <div className="h-4 w-72 bg-zinc-800/80 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!artist) {
    return (
      <div className="max-w-[1360px] mx-auto px-6 py-12 space-y-6">
        <button
          type="button"
          onClick={onBackToCatalog}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{i18n.nav.backToCatalog}</span>
        </button>

        <div className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-10 text-center space-y-4">
          <p className="text-sm md:text-base font-medium text-zinc-300">
            არტისტები ჯერ არ მოიძებნა
          </p>
          {onOpenSubmitModal && canPublishTrack ? (
            <div>
              <button
                type="button"
                onClick={() => onOpenSubmitModal()}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{i18n.phrases.submitTrack}</span>
              </button>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              {i18n.phrases.accessRestricted} · {i18n.phrases.expertsOnly}
            </p>
          )}
        </div>
      </div>
    );
  }

  const handleTrackClick = (trackId: string, e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (onSelectTrack) {
      onSelectTrack(trackId);
    } else {
      window.location.href = `/track/${trackId}`;
    }
  };

  return (
    <div className="w-full max-w-[1360px] mx-auto px-6 py-8 space-y-8">
      {/* ზედა ნავიგაციის ზოლი და არტისტების გადამრთველი */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackToCatalog}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{i18n.nav.backToCatalog}</span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {artists.map((item) => {
            const isActive = item.id === artist.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setAvatarError(false);
                  if (onSelectArtist) onSelectArtist(item.id);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                    : 'border-zinc-800 bg-[#111723] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {item.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* 1. არტისტის პროფილის ქუდი (სახელი, ფოტო, ჟანრები, სოციალური/სტრიმინგ ბმულები) */}
      <section className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6 md:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center shadow-xl">
              {!avatarError && artist.avatarUrl ? (
                <img
                  src={artist.avatarUrl || PRESET_COVERS.vinyl}
                  alt={artist.name}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc3 className="w-12 h-12 text-amber-400/80" />
              )}
            </div>

            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className="text-amber-400 font-semibold">
                  {i18n.artist.profileTitle}
                </span>
                {artist.city && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{artist.city}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span>
                  {artist.genres.join(' / ')}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-zinc-100 tracking-tight">
                {artist.name}
              </h1>

              <p className="text-sm text-zinc-300 leading-relaxed max-w-2xl">
                {artist.bio}
              </p>

              {/* სოციალური ქსელებისა და სტრიმინგ-პლატფორმების ბმულები */}
              <div className="pt-1 flex flex-wrap items-center gap-4 text-xs">
                {artist.socialLinks.spotify && (
                  <a
                    href={artist.socialLinks.spotify}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-emerald-400 transition-colors font-medium"
                  >
                    <span>Spotify</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {artist.socialLinks.youtube && (
                  <a
                    href={artist.socialLinks.youtube}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-amber-400 transition-colors font-medium"
                  >
                    <span>YouTube</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {artist.socialLinks.soundcloud && (
                  <a
                    href={artist.socialLinks.soundcloud}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-amber-400 transition-colors font-medium"
                  >
                    <span>SoundCloud</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {artist.socialLinks.instagram && (
                  <a
                    href={artist.socialLinks.instagram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-amber-400 transition-colors font-medium"
                  >
                    <span>Instagram</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                {onOpenSubmitModal && canPublishTrack && (
                  <button
                    type="button"
                    onClick={() => onOpenSubmitModal(artist.name)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 transition-colors font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{i18n.submitModal.title}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* მარჯვენა შემაჯამებელი მეტრიკები */}
          <div className="lg:col-span-4 grid grid-cols-3 gap-4 pt-6 lg:pt-0 border-t lg:border-t-0 lg:border-l border-zinc-800/80 lg:pl-8">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>{i18n.artist.expertBadge}</span>
              </div>
              <span className="block text-2xl sm:text-3xl font-extrabold font-mono-tabular text-amber-400">
                {radarAnalytics.expertOverallAverage !== null
                  ? radarAnalytics.expertOverallAverage.toFixed(1)
                  : '—'}
              </span>
              <span className="block text-[11px] text-zinc-500">
                {i18n.ui.outOfTen}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Users className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{i18n.artist.communityBadge}</span>
              </div>
              <span className="block text-2xl sm:text-3xl font-extrabold font-mono-tabular text-emerald-400">
                {radarAnalytics.communityOverallAverage !== null
                  ? radarAnalytics.communityOverallAverage.toFixed(1)
                  : '—'}
              </span>
              <span className="block text-[11px] text-zinc-500">
                {i18n.ui.outOfTen}
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Music2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span>{i18n.artist.discography}</span>
              </div>
              <span className="block text-2xl sm:text-3xl font-extrabold font-mono-tabular text-zinc-100">
                {artistTracks.length}
              </span>
              <span className="block text-[11px] text-zinc-500">
                {radarAnalytics.evaluatedTracksCount}{' '}
                {i18n.artist.evaluatedTracksCount}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. ვიზუალური რადარ-ანალიტიკა (Recharts RadarChart) + 5 კრიტერიუმის დეტალური სკალა */}
      <section className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 mb-6 border-b border-zinc-800/80">
          <div>
            <h2 className="text-xl font-bold text-zinc-100">
              {i18n.artist.skillsRadar}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {i18n.artist.skillsRadarSubtitle} ({radarAnalytics.evaluatedTracksCount}{' '}
              {i18n.artist.evaluatedTracksCount})
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <span className="text-zinc-400">
              {i18n.artist.overallRadarScore}:{' '}
              <strong className="font-mono-tabular text-base text-amber-400">
                {radarAnalytics.overallAverage > 0
                  ? radarAnalytics.overallAverage.toFixed(1)
                  : '—'}
              </strong>{' '}
              / 10.0
            </span>
          </div>
        </div>

        {radarAnalytics.evaluatedTracksCount === 0 ? (
          <div className="py-12 text-center text-sm text-zinc-400">
            {i18n.artist.noEvaluatedTracks}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Recharts RadarChart */}
            <div className="lg:col-span-7 w-full h-[360px] bg-[#0B0F17] border border-zinc-800/80 rounded-xl p-4">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart
                  cx="50%"
                  cy="50%"
                  outerRadius="74%"
                  data={radarAnalytics.points}
                >
                  <PolarGrid stroke="#27272a" />
                  <PolarAngleAxis
                    dataKey="criterion"
                    tick={{
                      fill: '#e4e4e7',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                  <PolarRadiusAxis
                    angle={90}
                    domain={[0, 10]}
                    tickCount={6}
                    tick={{ fill: '#71717a', fontSize: 10 }}
                    axisLine={false}
                  />
                  <Radar
                    name={i18n.artist.expertBadge}
                    dataKey="expert"
                    stroke="#f59e0b"
                    strokeWidth={2.5}
                    fill="#f59e0b"
                    fillOpacity={0.28}
                  />
                  <Radar
                    name={i18n.artist.communityBadge}
                    dataKey="community"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="#10b981"
                    fillOpacity={0.2}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111723',
                      borderColor: '#27272a',
                      borderRadius: '12px',
                      color: '#f4f4f5',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    wrapperStyle={{
                      fontSize: '12px',
                      paddingTop: '8px',
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* 5 კრიტერიუმის რიცხობრივი მაჩვენებლები (ტექსტი, ფლოუ, ბითი, ინდივიდუალიზმი, ვაიბი) */}
            <div className="lg:col-span-5 space-y-4">
              {radarAnalytics.points.map((pt, idx) => {
                const pct = Math.min(100, Math.max(5, (pt.average / 10) * 100));
                return (
                  <div
                    key={pt.key}
                    className="p-3.5 rounded-xl bg-[#0B0F17] border border-zinc-800/80 space-y-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-zinc-100">
                          0{idx + 1}. {pt.criterion}
                        </span>
                        <span className="text-[11px] text-zinc-500 ml-2">
                          ({pt.fullLabel})
                        </span>
                      </div>

                      <span className="text-base font-extrabold font-mono-tabular text-amber-400">
                        {pt.average.toFixed(1)}
                      </span>
                    </div>

                    <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 origin-left"
                        style={{
                          transform: `scaleX(${pct / 100})`,
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono-tabular">
                      <span>
                        {i18n.artist.expertBadge}:{' '}
                        <strong className="text-amber-300">
                          {pt.expert.toFixed(1)}
                        </strong>
                      </span>
                      <span>
                        {i18n.artist.communityBadge}:{' '}
                        <strong className="text-emerald-400">
                          {pt.community.toFixed(1)}
                        </strong>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 3. დისკოგრაფიის სექცია: არტისტის ტრეკები პლატფორმაზე შეფასებებით და ბმულებით */}
      <section className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-6 md:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
          <div>
            <h2 className="text-xl font-bold text-zinc-100">
              {i18n.artist.discography} ({artistTracks.length})
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {artist.name} — რელიზები პლატფორმაზე და შეფასებები ({i18n.artist.expertBadge} / {i18n.artist.communityBadge})
            </p>
          </div>

          {onOpenSubmitModal && canPublishTrack ? (
            <button
              type="button"
              onClick={() => onOpenSubmitModal(artist.name)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{i18n.submitModal.title}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-500 bg-[#0B0F17] border border-zinc-800 rounded-lg select-none whitespace-nowrap">
              <Lock className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span>{i18n.phrases.expertsOnly}</span>
            </span>
          )}
        </div>

        <div className="divide-y divide-zinc-800/80">
          {artistTracks.map((track: Track, index: number) => {
            const expertScoreVal =
              track.expertTotalScore ??
              (track.expertScore
                ? calculateAverageScore(track.expertScore)
                : null);
            const communityScoreVal =
              track.communityTotalScore ??
              (track.communityScore
                ? calculateAverageScore(track.communityScore)
                : null);
            const fairRating = calculateFairTrackRating(track);
            const trackRevCount = reviews.filter(
              (r) => r.trackId === track.id
            ).length;

            return (
              <div
                key={track.id}
                className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* მარცხენა მხარე: ნომერი, გარეკანი, სათაური, ჟანრი */}
                <div className="flex items-center gap-4 min-w-0">
                  <span className="text-xs font-mono-tabular font-bold text-zinc-500 w-6 shrink-0">
                    0{index + 1}.
                  </span>

                  <img
                    src={track.coverUrl || PRESET_COVERS.vinyl}
                    alt={track.title}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = PRESET_COVERS.vinyl;
                    }}
                    className="w-14 h-14 rounded-xl object-cover bg-zinc-900 border border-zinc-800 shrink-0"
                  />

                  <div className="min-w-0 space-y-1">
                    <a
                      href={`/track/${track.id}`}
                      onClick={(e) => handleTrackClick(track.id, e)}
                      className="text-base font-bold text-zinc-100 hover:text-amber-400 transition-colors truncate block"
                    >
                      {track.title}
                    </a>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                      <span>{track.genre || 'ქართული სცენა'}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {i18n.trackStatuses[track.status] || track.status}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        ★ {fairRating.toFixed(2)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {trackRevCount} {i18n.portal.reviewsCountLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {/* მარჯვენა მხარე: შეფასების მაჩვენებლები (ექსპერტი, ხალხი) და ტრეკის გვერდზე გადასვლა */}
                <div className="flex flex-wrap items-center justify-between md:justify-end gap-5 shrink-0">
                  <div className="flex items-center gap-5 text-xs">
                    <div className="text-left md:text-right">
                      <span className="block text-[11px] text-zinc-500">
                        {i18n.artist.expertBadge}
                      </span>
                      <span className="font-mono-tabular text-base font-extrabold text-amber-400">
                        {expertScoreVal !== null
                          ? expertScoreVal.toFixed(1)
                          : '—'}
                      </span>
                    </div>

                    <div className="text-left md:text-right">
                      <span className="block text-[11px] text-zinc-500">
                        {i18n.artist.communityBadge}
                      </span>
                      <span className="font-mono-tabular text-base font-extrabold text-emerald-400">
                        {communityScoreVal !== null
                          ? communityScoreVal.toFixed(1)
                          : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void launchTrackOnAir(track.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-300 bg-[#0B0F17] border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Radio className="w-3.5 h-3.5 text-amber-400" />
                      <span>{i18n.phrases.launchOnAir}</span>
                    </button>

                    <a
                      href={`/track/${track.id}`}
                      onClick={(e) => handleTrackClick(track.id, e)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span>{i18n.artist.openTrackDetails}</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
