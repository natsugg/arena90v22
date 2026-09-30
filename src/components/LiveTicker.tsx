import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { Activity } from 'lucide-react';
import { db } from '../lib/firebase';
import { i18n } from '../lib/i18n';
import {
  calculateAverageScore,
  toTimestampMillis,
  type CriteriaScores,
} from '../types';

export interface LiveTickerProps {
  onSelectTrack?: (trackId: string) => void;
}

interface TickerReviewEvent {
  id: string;
  type: 'review';
  trackId: string;
  authorName: string;
  trackTitle?: string;
  score: number;
  createdAt: number;
}

interface TickerTrackEvent {
  id: string;
  type: 'track';
  trackId: string;
  artist: string;
  title: string;
  createdAt: number;
}

type TickerItem = TickerReviewEvent | TickerTrackEvent;

export default function LiveTicker({ onSelectTrack }: LiveTickerProps) {
  const [recentReviews, setRecentReviews] = useState<TickerReviewEvent[]>([]);
  const [recentTracks, setRecentTracks] = useState<TickerTrackEvent[]>([]);
  const [trackTitlesById, setTrackTitlesById] = useState<
    Record<string, { title: string; artist: string }>
  >({});

  // 1. პირდაპირი გამოწერა ბოლო 5 დამატებულ ტრეკზე: collection(db, 'tracks') (limit 5, orderBy createdAt desc)
  useEffect(() => {
    const tracksQuery = query(
      collection(db, 'tracks'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    const unsubscribeTracks = onSnapshot(
      tracksQuery,
      (snapshot) => {
        const loadedTracks: TickerTrackEvent[] = [];
        const titlesMap: Record<string, { title: string; artist: string }> = {};

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const title = typeof data.title === 'string' ? data.title : '';
          const artist = typeof data.artist === 'string' ? data.artist : '';
          const createdAt = toTimestampMillis(data.createdAt);

          if (title) {
            titlesMap[docSnap.id] = { title, artist };
            loadedTracks.push({
              id: `track_${docSnap.id}`,
              type: 'track',
              trackId: docSnap.id,
              artist,
              title,
              createdAt,
            });
          }
        });

        setTrackTitlesById((prev) => ({ ...prev, ...titlesMap }));
        setRecentTracks(loadedTracks);
      },
      () => {
        setRecentTracks([]);
      }
    );

    return () => unsubscribeTracks();
  }, []);

  // 2. პირდაპირი გამოწერა ბოლო 10 რეცენზიაზე: collectionGroup(db, 'reviews') (limit 10, orderBy createdAt desc)
  useEffect(() => {
    let fallbackUnsub: (() => void) | null = null;

    const mapReviewDocs = (
      docs: Array<{
        id: string;
        data: () => Record<string, unknown>;
        ref: { parent: { parent: { id: string } | null } };
      }>
    ): TickerReviewEvent[] => {
      return docs
        .map((docSnap) => {
          const data = docSnap.data();
          const parentTrackId = docSnap.ref.parent.parent?.id ?? '';
          const trackId =
            (typeof data.trackId === 'string' && data.trackId) || parentTrackId;
          const authorName =
            (typeof data.authorName === 'string' && data.authorName) ||
            i18n.roles.viewer;
          const scores = data.scores as CriteriaScores | undefined;
          const totalScore =
            typeof data.totalScore === 'number'
              ? data.totalScore
              : scores
                ? calculateAverageScore(scores)
                : 0;
          const trackTitle =
            typeof data.trackTitle === 'string' ? data.trackTitle : undefined;
          const createdAt = toTimestampMillis(data.createdAt);

          return {
            id: `rev_${docSnap.id}_${trackId}`,
            type: 'review' as const,
            trackId,
            authorName,
            trackTitle,
            score: totalScore,
            createdAt,
          };
        })
        .filter((item) => Boolean(item.trackId));
    };

    const reviewsGroupQuery = query(
      collectionGroup(db, 'reviews'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    const unsubscribeReviews = onSnapshot(
      reviewsGroupQuery,
      (snapshot) => {
        const mapped = mapReviewDocs(snapshot.docs);
        setRecentReviews(mapped);
      },
      () => {
        // თუ collectionGroup ინდექსი ჯერ იქმნება, ვიყენებთ collectionGroup(db, 'reviews') limit(10) და ვალაგებთ createdAt desc-ით
        const unindexedQuery = query(collectionGroup(db, 'reviews'), limit(10));
        fallbackUnsub = onSnapshot(
          unindexedQuery,
          (snap) => {
            const mapped = mapReviewDocs(snap.docs).sort(
              (a, b) => b.createdAt - a.createdAt
            );
            setRecentReviews(mapped);
          },
          () => {
            setRecentReviews([]);
          }
        );
      }
    );

    return () => {
      unsubscribeReviews();
      if (fallbackUnsub) fallbackUnsub();
    };
  }, []);

  // თუ რეცენზიის ტრეკის სათაური არ არის ქეშში, წამოვიღოთ Firestore-ის `tracks/{id}` დოკუმენტიდან
  useEffect(() => {
    const missingTrackIds = recentReviews
      .map((r) => r.trackId)
      .filter((id) => id && !trackTitlesById[id]);

    if (missingTrackIds.length === 0) return;

    const uniqueMissing = Array.from(new Set(missingTrackIds));
    let cancelled = false;

    const loadMissingTitles = async () => {
      const updates: Record<string, { title: string; artist: string }> = {};
      for (const tId of uniqueMissing) {
        try {
          const snap = await getDoc(doc(db, 'tracks', tId));
          if (snap.exists()) {
            const d = snap.data();
            updates[tId] = {
              title: typeof d.title === 'string' ? d.title : tId,
              artist: typeof d.artist === 'string' ? d.artist : '',
            };
          }
        } catch {
          // ignore
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setTrackTitlesById((prev) => ({ ...prev, ...updates }));
      }
    };

    void loadMissingTitles();

    return () => {
      cancelled = true;
    };
  }, [recentReviews, trackTitlesById]);

  // გავაერთიანოთ რეცენზიები და ახალი რელიზები ქრონოლოგიურად
  const tickerItems = useMemo<TickerItem[]>(() => {
    const combined: TickerItem[] = [...recentReviews, ...recentTracks];
    combined.sort((a, b) => b.createdAt - a.createdAt);
    return combined;
  }, [recentReviews, recentTracks]);

  const handleItemClick = (trackId: string) => {
    if (!trackId) return;
    if (onSelectTrack) {
      onSelectTrack(trackId);
    } else {
      window.history.pushState({}, '', `/track/${trackId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  // თუ ბაზაში ჯერ არ არის რეცენზიები ან ტრეკები — ვაჩვენებთ სტატუსის სტრიქონს
  if (tickerItems.length === 0) {
    return (
      <div className="w-full border-b border-zinc-800/80 bg-[#0D131E] px-4 sm:px-6 py-2">
        <div className="max-w-[1360px] mx-auto flex items-center justify-center gap-2 text-xs text-zinc-400">
          <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>{i18n.ticker.defaultStatus}</span>
        </div>
      </div>
    );
  }

  // უსასრულო გლუვი სტრიქონისთვის (CSS marquee) ვამრავლებთ სიას 2-ჯერ
  const marqueeList = [...tickerItems, ...tickerItems];

  return (
    <div className="w-full border-b border-zinc-800/80 bg-[#0D131E] overflow-hidden select-none">
      <div className="flex items-center">
        {/* მარცხენა ფიქსირებული ინდიკატორი */}
        <div className="z-10 flex items-center gap-1.5 px-3.5 py-2 bg-[#111723] border-r border-zinc-800/90 text-[11px] font-semibold text-amber-400 shrink-0">
          <Activity className="w-3.5 h-3.5 animate-pulse" />
          <span className="hidden sm:inline">
            {i18n.ticker.liveActivityLabel}
          </span>
        </div>

        {/* ჰორიზონტალური მორბენალი სტრიქონი */}
        <div className="relative flex-1 overflow-hidden py-2">
          <div className="animate-marquee items-center gap-8 px-4">
            {marqueeList.map((item, idx) => {
              if (item.type === 'review') {
                const resolvedTrackTitle =
                  item.trackTitle ||
                  trackTitlesById[item.trackId]?.title ||
                  item.trackId;
                return (
                  <button
                    key={`${item.id}_${idx}`}
                    type="button"
                    onClick={() => handleItemClick(item.trackId)}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-amber-400 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <span className="text-amber-400 font-bold">★</span>
                    <span className="font-semibold text-zinc-100">
                      {item.authorName}
                    </span>
                    <span className="text-zinc-400">
                      {i18n.ticker.ratedVerb}
                    </span>
                    <span className="font-semibold text-amber-300 underline-offset-4 hover:underline">
                      {resolvedTrackTitle}
                    </span>
                    <span className="text-zinc-500">—</span>
                    <span className="font-mono-tabular font-bold text-emerald-400">
                      {item.score.toFixed(1)}/10
                    </span>
                  </button>
                );
              }

              return (
                <button
                  key={`${item.id}_${idx}`}
                  type="button"
                  onClick={() => handleItemClick(item.trackId)}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-300 hover:text-amber-400 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <span>🔥</span>
                  <span className="text-zinc-400">
                    {i18n.ticker.newReleasePrefix}:
                  </span>
                  <span className="font-semibold text-zinc-100">
                    {item.artist}
                  </span>
                  <span className="text-zinc-500">—</span>
                  <span className="font-semibold text-amber-300 underline-offset-4 hover:underline">
                    {item.title}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
