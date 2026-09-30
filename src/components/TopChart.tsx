import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from 'firebase/firestore';
import { Plus, Lock, MessageSquare } from 'lucide-react';
import { db } from '../lib/firebase';
import { i18n } from '../lib/i18n';
import { PRESET_COVERS } from '../hooks/useLiveSession';
import {
  CRITERIA_KEYS,
  calculateAverageScore,
  calculateCriteriaBreakdown,
  calculateFairTrackRating,
  getArtistIdFromName,
  normalizeScoreToTen,
  toTimestampMillis,
  type CriteriaKey,
  type CriteriaScores,
  type Track,
  type TrackReview,
  type UserRole,
} from '../types';

export interface TopChartProps {
  tracks: Track[];
  reviews: TrackReview[];
  loading?: boolean;
  canPublishTrack?: boolean;
  onSelectTrack?: (trackId: string) => void;
  onSelectArtist?: (artistIdOrName: string, e?: React.MouseEvent) => void;
  onOpenSubmitModal?: () => void;
}

interface HoverAnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
}

const SEVENTY_TWO_HOURS_MS = 72 * 3600 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 3600 * 1000;

export default function TopChart({
  tracks,
  reviews,
  loading = false,
  canPublishTrack = false,
  onSelectTrack,
  onSelectArtist,
  onOpenSubmitModal,
}: TopChartProps) {
  const [hoveredTrackId, setHoveredTrackId] = useState<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<HoverAnchorRect | null>(null);
  const [latestReviewByTrack, setLatestReviewByTrack] = useState<
    Record<string, TrackReview | null>
  >({});
  const [loadingReviewTrackId, setLoadingReviewTrackId] = useState<
    string | null
  >(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // სორტირება metaScore-ით (ან შეწონილი peopleScore-ით)
  const rankedTracks = useMemo(() => {
    return [...tracks]
      .sort((a, b) => {
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
      })
      .slice(0, 24);
  }, [tracks]);

  // რეცენზიების დაჯგუფება ტრეკების მიხედვით
  const reviewsByTrackMap = useMemo(() => {
    const map = new Map<string, TrackReview[]>();
    reviews.forEach((rev) => {
      const list = map.get(rev.trackId) ?? [];
      list.push(rev);
      map.set(rev.trackId, list);
    });
    map.forEach((list) => {
      list.sort(
        (a, b) => toTimestampMillis(b.createdAt) - toTimestampMillis(a.createdAt)
      );
    });
    return map;
  }, [reviews]);

  // ჰოვერის დროს ბოლო რეალური რეცენზიის წამოღება Firestore-ის ქვეკოლექციიდან: tracks/{id}/reviews (limit 1, orderBy createdAt desc)
  useEffect(() => {
    if (!hoveredTrackId) return;

    let cancelled = false;
    setLoadingReviewTrackId(hoveredTrackId);

    const fetchLatestReview = async () => {
      try {
        const reviewsRef = collection(db, 'tracks', hoveredTrackId, 'reviews');
        const q = query(reviewsRef, orderBy('createdAt', 'desc'), limit(1));
        const snap = await getDocs(q);

        if (cancelled) return;

        if (!snap.empty) {
          const docSnap = snap.docs[0];
          const data = docSnap.data();
          const scores: CriteriaScores = (data.scores as CriteriaScores) || {
            lyrics: 0,
            flow: 0,
            production: 0,
            identity: 0,
            vibe: 0,
          };
          const loadedReview: TrackReview = {
            id: docSnap.id,
            trackId: (data.trackId as string) || hoveredTrackId,
            authorId: (data.authorId as string) || '',
            authorName: (data.authorName as string) || i18n.roles.viewer,
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
            createdAt: toTimestampMillis(data.createdAt),
          };
          setLatestReviewByTrack((prev) => ({
            ...prev,
            [hoveredTrackId]: loadedReview,
          }));
        } else {
          const fallbackFromLive =
            reviewsByTrackMap.get(hoveredTrackId)?.[0] ?? null;
          setLatestReviewByTrack((prev) => ({
            ...prev,
            [hoveredTrackId]: fallbackFromLive,
          }));
        }
      } catch {
        if (!cancelled) {
          const fallbackFromLive =
            reviewsByTrackMap.get(hoveredTrackId)?.[0] ?? null;
          setLatestReviewByTrack((prev) => ({
            ...prev,
            [hoveredTrackId]: fallbackFromLive,
          }));
        }
      } finally {
        if (!cancelled) {
          setLoadingReviewTrackId(null);
        }
      }
    };

    void fetchLatestReview();

    return () => {
      cancelled = true;
    };
  }, [hoveredTrackId, reviewsByTrackMap]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseEnterRow = (
    trackId: string,
    e: React.MouseEvent<HTMLDivElement>
  ) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchorRect({
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
    });
    setHoveredTrackId(trackId);
  };

  const handleMouseLeaveRow = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredTrackId(null);
      setAnchorRect(null);
    }, 120);
  };

  const hoveredTrack = useMemo(
    () => rankedTracks.find((t) => t.id === hoveredTrackId) ?? null,
    [rankedTracks, hoveredTrackId]
  );

  if (loading && rankedTracks.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 animate-pulse">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-xl bg-zinc-800/80 shrink-0" />
              <div className="flex-1 space-y-2.5 pt-1">
                <div className="h-3.5 w-24 bg-zinc-800/80 rounded" />
                <div className="h-5 w-40 bg-zinc-800/80 rounded" />
                <div className="h-3.5 w-28 bg-zinc-800/80 rounded" />
              </div>
            </div>
            <div className="pt-3.5 border-t border-zinc-800/80 flex justify-between">
              <div className="h-6 w-24 bg-zinc-800/80 rounded" />
              <div className="h-4 w-20 bg-zinc-800/80 rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (rankedTracks.length === 0) {
    return (
      <div className="border border-zinc-800/90 bg-[#111723] rounded-2xl p-10 text-center space-y-4">
        <p className="text-sm md:text-base font-medium text-zinc-200">
          {i18n.portal.emptyCatalogTracks}
        </p>
        {onOpenSubmitModal && canPublishTrack ? (
          <div>
            <button
              type="button"
              onClick={onOpenSubmitModal}
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
    );
  }

  // ჰოვერ-პრევიუს პოზიციის გამოთვლა ეკრანის საზღვრების გათვალისწინებით
  const computePopupStyle = (): React.CSSProperties => {
    if (!anchorRect || typeof window === 'undefined') {
      return { display: 'none' };
    }
    const cardWidth = 340;
    const cardEstimatedHeight = 330;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = anchorRect.right + 14;
    if (left + cardWidth > viewportW - 16) {
      left = Math.max(16, anchorRect.left - cardWidth - 14);
      if (left < 16) {
        left = Math.max(
          16,
          Math.min(viewportW - cardWidth - 16, anchorRect.left)
        );
      }
    }

    let top = anchorRect.top;
    if (top + cardEstimatedHeight > viewportH - 16) {
      top = Math.max(16, viewportH - cardEstimatedHeight - 16);
    }

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${cardWidth}px`,
      zIndex: 9999,
    };
  };

  const renderHoverPreviewPortal = () => {
    if (!hoveredTrack || !anchorRect || typeof document === 'undefined') {
      return null;
    }

    const breakdown: CriteriaScores | undefined =
      hoveredTrack.criteriaBreakdown ??
      calculateCriteriaBreakdown(
        hoveredTrack.expertScore,
        hoveredTrack.communityScore
      );

    const latestReview =
      latestReviewByTrack[hoveredTrack.id] !== undefined
        ? latestReviewByTrack[hoveredTrack.id]
        : reviewsByTrackMap.get(hoveredTrack.id)?.[0] ?? null;

    return createPortal(
      <div
        style={computePopupStyle()}
        onMouseEnter={() => {
          if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
          }
        }}
        onMouseLeave={handleMouseLeaveRow}
        className="pointer-events-auto rounded-2xl border border-zinc-700/90 bg-[#0B0F17]/95 backdrop-blur-md p-4 shadow-2xl space-y-3.5 text-zinc-100 transition-opacity duration-150"
      >
        {/* 1. ტრეკის გარეკანი, სათაური, არტისტი */}
        <div className="flex items-center gap-3 pb-3 border-b border-zinc-800/90">
          <img
            src={hoveredTrack.coverUrl || PRESET_COVERS.vinyl}
            alt={hoveredTrack.title}
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = PRESET_COVERS.vinyl;
            }}
            className="w-12 h-12 rounded-xl object-cover bg-zinc-900 border border-zinc-800 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-zinc-100 truncate">
              {hoveredTrack.title}
            </p>
            <p className="text-xs text-zinc-400 truncate">
              {hoveredTrack.artist}
            </p>
          </div>
        </div>

        {/* 2. 5 რეალური კრიტერიუმის სკალა Firestore-იდან პროცენტებში (0-100%) */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-zinc-400">
            {i18n.chart.hoverPreviewTitle}
          </p>
          {breakdown ? (
            <div className="space-y-1.5">
              {CRITERIA_KEYS.map((key: CriteriaKey) => {
                const rawScore = breakdown[key] ?? 0;
                const pct = Math.max(
                  0,
                  Math.min(100, Math.round((rawScore / 10) * 100))
                );
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-300">
                        {i18n.criteriaShort[key]}
                      </span>
                      <span className="font-mono-tabular font-semibold text-amber-400">
                        {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-amber-500 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 py-1">
              {i18n.chart.noCriteriaYet}
            </p>
          )}
        </div>

        {/* 3. ბოლო რეალური რეცენზიის ტექსტი ქვეკოლექციიდან tracks/{id}/reviews */}
        <div className="pt-2.5 border-t border-zinc-800/90 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span className="inline-flex items-center gap-1 font-semibold">
              <MessageSquare className="w-3 h-3 text-emerald-400" />
              <span>{i18n.chart.latestReviewTitle}</span>
            </span>
            {latestReview && (
              <span className="font-mono-tabular font-bold text-amber-400">
                ★ {latestReview.totalScore.toFixed(1)}/10
              </span>
            )}
          </div>

          {loadingReviewTrackId === hoveredTrack.id && !latestReview ? (
            <p className="text-xs text-zinc-500">
              {i18n.portal.loadingData}
            </p>
          ) : latestReview ? (
            <div className="space-y-1">
              <p className="text-xs text-zinc-300 line-clamp-3 leading-relaxed break-words">
                „{latestReview.text}“
              </p>
              <p className="text-[11px] text-zinc-500 truncate">
                — {latestReview.authorName}
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              {i18n.chart.noReviewsForTrack}
            </p>
          )}
        </div>
      </div>,
      document.body
    );
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {rankedTracks.map((track: Track, index: number) => {
          const currentRank = index + 1;
          const delta = track.previousRank
            ? track.previousRank - currentRank
            : 0;

          const createdMs = toTimestampMillis(track.createdAt);
          const isAddedWithin72h =
            createdMs > 0 && Date.now() - createdMs < SEVENTY_TWO_HOURS_MS;
          const isNew = !track.previousRank || isAddedWithin72h;

          const trackRevs = reviewsByTrackMap.get(track.id) ?? [];
          const recent48hReviewsCount = trackRevs.filter((r) => {
            const revMs = toTimestampMillis(r.createdAt);
            return revMs > 0 && Date.now() - revMs < FORTY_EIGHT_HOURS_MS;
          }).length;
          const isHot = recent48hReviewsCount >= 3;

          const realReviewsCount =
            typeof track.reviewsCount === 'number'
              ? Math.max(track.reviewsCount, trackRevs.length)
              : trackRevs.length;

          const normalizedTrackForScore: Track = {
            ...track,
            metaScore:
              typeof track.metaScore === 'number' && track.metaScore > 0
                ? normalizeScoreToTen(track.metaScore)
                : null,
            peopleScore:
              typeof track.peopleScore === 'number' && track.peopleScore > 0
                ? normalizeScoreToTen(track.peopleScore)
                : track.communityTotalScore
                  ? normalizeScoreToTen(track.communityTotalScore)
                  : null,
          };

          const matchPercentage =
            (
              ((normalizedTrackForScore.metaScore ||
                normalizedTrackForScore.peopleScore ||
                0) /
                10) *
              100
            ).toFixed(0) + '%';

          const expertTotal =
            track.expertTotalScore ??
            (track.expertScore
              ? calculateAverageScore(track.expertScore)
              : null);
          const communityTotal =
            track.communityTotalScore ??
            (track.communityScore
              ? calculateAverageScore(track.communityScore)
              : null);
          const fairRating = calculateFairTrackRating(normalizedTrackForScore);
          const resolvedArtistId =
            track.artistId || getArtistIdFromName(track.artist);

          return (
            <div
              key={track.id}
              onClick={() => onSelectTrack && onSelectTrack(track.id)}
              onMouseEnter={(e) => handleMouseEnterRow(track.id, e)}
              onMouseLeave={handleMouseLeaveRow}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (onSelectTrack) onSelectTrack(track.id);
                }
              }}
              className="group border border-zinc-800/90 bg-[#111723] hover:border-zinc-700 rounded-2xl p-5 transition-colors cursor-pointer flex flex-col justify-between gap-4"
            >
              <div className="flex items-start gap-4">
                {/* რანგის ნომერი, მოძრაობის ინდიკატორი და გარეკანი */}
                <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center">
                  <img
                    src={track.coverUrl || PRESET_COVERS.vinyl}
                    alt={track.title}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = PRESET_COVERS.vinyl;
                    }}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-zinc-950/90 text-[11px] font-mono-tabular font-bold text-amber-400">
                    #{currentRank < 10 ? `0${currentRank}` : currentRank}
                  </div>

                  {/* პოზიციის დინამიკის ინდიკატორი */}
                  <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-1">
                    {delta > 0 ? (
                      <span
                        title={i18n.chart.rankUp}
                        className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-mono-tabular font-bold text-emerald-300"
                      >
                        ▲ +{delta}
                      </span>
                    ) : delta < 0 ? (
                      <span
                        title={i18n.chart.rankDown}
                        className="px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-[10px] font-mono-tabular font-bold text-rose-300"
                      >
                        ▼ {Math.abs(delta)}
                      </span>
                    ) : (
                      <span
                        title={i18n.chart.rankStable}
                        className="px-1.5 py-0.5 rounded bg-zinc-900/90 border border-zinc-700/80 text-[10px] font-mono-tabular font-bold text-zinc-300"
                      >
                        =
                      </span>
                    )}
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                    <span className="truncate max-w-[130px]">
                      {track.genre || i18n.ui.genre}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular font-bold text-amber-400">
                      {matchPercentage}
                    </span>
                    {fairRating > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-tabular text-zinc-300">
                          ★ {fairRating.toFixed(1)}
                        </span>
                      </>
                    )}

                    {/* NEW და HOT ბეიჯები */}
                    {isNew && (
                      <span
                        title={i18n.chart.newBadgeTooltip}
                        className="px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-[10px] font-mono-tabular font-bold text-purple-300"
                      >
                        {i18n.chart.newBadge}
                      </span>
                    )}
                    {isHot && (
                      <span
                        title={i18n.chart.hotBadgeTooltip}
                        className="px-1.5 py-0.5 rounded bg-orange-500/20 border border-orange-500/40 text-[10px] font-bold text-orange-300"
                      >
                        {i18n.chart.hotBadge}
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-bold text-zinc-100 group-hover:text-amber-400 transition-colors truncate">
                    {track.title}
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs text-zinc-400 truncate">
                    <span>{i18n.ui.artist}:</span>
                    <button
                      type="button"
                      onClick={(e) =>
                        onSelectArtist && onSelectArtist(resolvedArtistId, e)
                      }
                      className="text-zinc-200 font-medium hover:text-amber-400 hover:underline truncate cursor-pointer"
                    >
                      {track.artist}
                    </button>
                  </div>

                  {/* სანდოობის დონის (Confidence Level) ბეიჯი რეალური reviewsCount-ის მიხედვით */}
                  <div className="pt-0.5 flex flex-wrap items-center gap-2">
                    {realReviewsCount < 5 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/35 text-[11px] font-medium text-amber-300">
                        {i18n.chart.preliminaryScore}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/35 text-[11px] font-medium text-emerald-300">
                        {i18n.chart.verifiedRating}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* ქულების და რეცენზიების ზოლი */}
              <div className="pt-3.5 border-t border-zinc-800/80 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-4">
                  <div>
                    <span className="block text-[11px] text-zinc-500">
                      {i18n.portal.expertScoreLabel}
                    </span>
                    <span className="font-mono-tabular text-sm font-bold text-amber-400">
                      {expertTotal !== null ? expertTotal.toFixed(1) : '—'}
                    </span>
                  </div>

                  <div>
                    <span className="block text-[11px] text-zinc-500">
                      {i18n.portal.communityScoreLabel}
                    </span>
                    <span className="font-mono-tabular text-sm font-bold text-emerald-400">
                      {communityTotal !== null
                        ? communityTotal.toFixed(1)
                        : '—'}
                    </span>
                  </div>
                </div>

                <div className="text-right text-zinc-400 font-mono-tabular">
                  <span>
                    {matchPercentage} · {realReviewsCount}{' '}
                    {i18n.portal.reviewsCountLabel}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {renderHoverPreviewPortal()}
    </>
  );
}
