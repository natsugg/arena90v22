import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Disc3, Radio, Award } from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { i18n } from '../../lib/i18n';
import {
  INITIAL_CRITERIA_SCORES,
  INITIAL_LIVE_SESSION,
  PRESET_COVERS,
} from '../../hooks/useLiveSession';
import {
  CRITERIA_KEYS,
  calculateAverageScore,
  calculateMetaScore,
  type CriteriaScores,
  type LiveSession,
  type LiveStreamStatus,
  type Track,
} from '../../types';

export interface OverlayPageProps {
  /** ჩაშენებული პრევიუს რეჟიმი თუ სრული OBS ეკრანი */
  embedded?: boolean;
}

export default function OverlayPage({ embedded = false }: OverlayPageProps) {
  const [session, setSession] = useState<LiveSession>(() => INITIAL_LIVE_SESSION);
  const [fallbackTrack, setFallbackTrack] = useState<Track | null>(null);
  const [imgError, setImgError] = useState(false);

  // 1. სრულიად ავტონომიური, უპირობო პირდაპირი Firestore onSnapshot მოსმენა `live_sessions/current` დოკუმენტზე (ავტორიზაციის გარეშე, OBS CEF-ისთვის)
  useEffect(() => {
    const sessionRef = doc(db, 'live_sessions', 'current');
    const unsubscribeSession = onSnapshot(
      sessionRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Omit<LiveSession, 'id'>;
          setSession({
            ...INITIAL_LIVE_SESSION,
            ...data,
            id: snapshot.id,
            activeTrackId: data.activeTrackId || null,
            activeTrackSnapshot: data.activeTrackSnapshot ?? null,
            liveExpertDraft: data.liveExpertDraft ?? null,
          });
        }
      },
      (err) => {
        console.error('OBS Overlay session snapshot error:', err);
      }
    );

    return () => unsubscribeSession();
  }, []);

  // 2. დამხმარე (Fallback) მოსმენა `tracks/{activeTrackId}` დოკუმენტზე, თუ activeTrackSnapshot არ არის შევსებული
  useEffect(() => {
    const activeId = session?.activeTrackId;
    if (!activeId || activeId.trim() === '') {
      setFallbackTrack(null);
      return;
    }

    const trackRef = doc(db, 'tracks', activeId);
    const unsubscribeTrack = onSnapshot(
      trackRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setFallbackTrack({
            ...(snapshot.data() as Omit<Track, 'id'>),
            id: snapshot.id,
          });
        } else {
          setFallbackTrack(null);
        }
      },
      () => {
        setFallbackTrack(null);
      }
    );

    return () => unsubscribeTrack();
  }, [session?.activeTrackId]);

  useEffect(() => {
    setImgError(false);
  }, [session?.activeTrackSnapshot?.coverUrl, fallbackTrack?.coverUrl]);

  // OBS Browser Source-ისთვის სრულიად გამჭვირვალე ფონის უზრუნველყოფა
  useEffect(() => {
    if (!embedded) {
      const prevHtmlBg = document.documentElement.style.background;
      const prevBodyBg = document.body.style.background;
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      return () => {
        document.documentElement.style.background = prevHtmlBg;
        document.body.style.background = prevBodyBg;
      };
    }
  }, [embedded]);

  // ლოკალური და ტაბებს შორის სინქრონიზაცია მყისიერი პრევიუსთვის სტუდიაში
  useEffect(() => {
    const handleSyncEvent = (event: Event) => {
      const custom = event as CustomEvent<{ session?: LiveSession }>;
      if (custom.detail?.session) {
        setSession(custom.detail.session);
      }
    };

    window.addEventListener('soundcheck:live-sync', handleSyncEvent);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('soundcheck_live_channel');
        channel.onmessage = (msg) => {
          if (msg.data?.session) {
            setSession(msg.data.session as LiveSession);
          }
        };
      } catch {
        // ignore
      }
    }

    return () => {
      window.removeEventListener('soundcheck:live-sync', handleSyncEvent);
      if (channel) channel.close();
    };
  }, []);

  const status: LiveStreamStatus = session?.streamStatus ?? 'idle';
  const isRevealed = status === 'revealed';
  const snapshot = session?.activeTrackSnapshot ?? null;
  const showOverlay = session?.showObsOverlay ?? true;
  const obsTheme = session?.obsTheme ?? 'dark';

  // 3. პირდაპირი მიბმა სტრიმერის დრაფტზე (`session.liveExpertDraft`) ყოველ სნაპშოტზე
  const displayedScores: CriteriaScores =
    session?.liveExpertDraft ??
    snapshot?.expertScore ??
    fallbackTrack?.expertScore ??
    INITIAL_CRITERIA_SCORES;

  const averageScore = calculateAverageScore(displayedScores);
  const communityScore =
    snapshot?.communityTotalScore ?? fallbackTrack?.communityTotalScore ?? null;

  const metaScore =
    snapshot?.metaScore ??
    calculateMetaScore(
      displayedScores,
      fallbackTrack?.communityScore ?? null
    ) ??
    Math.round(averageScore * 10);

  // 4. ტრეკის სახელწოდება, არტისტი და გარეკანი მოდის სნაპშოტიდან ან რეალურად არსებული ტრეკიდან (`tracks/{activeTrackId}`)
  const trackTitle =
    snapshot?.title || fallbackTrack?.title || i18n.ui.noActiveTrack;
  const trackArtist = snapshot?.artist || fallbackTrack?.artist || '—';
  const trackCover =
    snapshot?.coverUrl || fallbackTrack?.coverUrl || PRESET_COVERS.vinyl;

  const themeCardClass =
    obsTheme === 'neon'
      ? 'max-w-[540px] bg-[#090B14]/92 border-fuchsia-500/40 shadow-[0_24px_70px_rgba(217,70,239,0.25)]'
      : obsTheme === 'minimal'
        ? 'max-w-[540px] bg-[#0B0F17]/80 border-zinc-700/50 shadow-none'
        : obsTheme === 'compact'
          ? 'max-w-[440px] bg-[#0B0F17]/95 border-zinc-800/90 shadow-2xl'
          : 'max-w-[540px] bg-[#0B0F17]/92 border-zinc-800/90 shadow-2xl';

  if (!showOverlay && !embedded) {
    return <div className="min-h-screen w-full bg-transparent" />;
  }

  return (
    <div
      className={`w-full ${
        embedded ? 'py-4' : 'min-h-screen p-8 flex items-end justify-start'
      } bg-transparent select-none`}
    >
      <div
        className={`relative w-full backdrop-blur-md border rounded-2xl p-6 text-zinc-100 overflow-hidden transition-all duration-300 ${themeCardClass} ${
          !showOverlay && embedded ? 'opacity-45 grayscale' : 'opacity-100'
        }`}
      >
        {/* ზედა სტატუსის ზოლი ქართულად */}
        <div className="flex items-center justify-between gap-3 pb-4 mb-5 border-b border-zinc-800/80 text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <Radio
              className={`w-3.5 h-3.5 ${
                status === 'idle'
                  ? 'text-zinc-500'
                  : status === 'revealed'
                    ? 'text-amber-400'
                    : 'text-emerald-400 animate-pulse'
              }`}
            />
            <span className="font-medium text-zinc-400">
              {i18n.ui.activeTrack}
            </span>
            <span aria-hidden="true" className="text-zinc-600">
              ·
            </span>
            <span
              className={`font-semibold ${
                isRevealed
                  ? 'text-amber-400'
                  : status === 'locked'
                    ? 'text-sky-400'
                    : 'text-emerald-400'
              }`}
            >
              {i18n.statuses[status]}
            </span>
          </div>

          <div className="font-mono-tabular text-zinc-400">
            <span>{i18n.ui.metaScore}: </span>
            <span className="text-zinc-100 font-semibold">{metaScore}</span>
          </div>
        </div>

        {/* ტრეკის ბარათი: გარეკანი, სახელწოდება, არტისტი და ქულების შეჯამება */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative w-20 h-20 rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center">
            {!imgError && trackCover ? (
              <img
                src={trackCover}
                alt={trackTitle}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <Disc3 className="w-9 h-9 text-amber-400" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-zinc-100 truncate">
              {trackTitle}
            </h2>
            <p className="text-sm text-zinc-400 truncate mt-0.5">
              {i18n.ui.artist}:{' '}
              <span className="text-zinc-200 font-medium">{trackArtist}</span>
            </p>

            {/* საშუალო ქულა და ხალხის პროგნოზი (Zero-Pill სუფთა ტექსტური მეტამონაცემებით) */}
            <div className="flex items-center gap-3 mt-2.5 text-xs text-zinc-400">
              <div>
                <span>{i18n.ui.averageScore}: </span>
                <span className="font-mono-tabular font-bold text-amber-400 text-sm">
                  {averageScore.toFixed(1)}
                </span>
              </div>
              <span aria-hidden="true" className="text-zinc-600">
                ·
              </span>
              <div>
                <span>{i18n.ui.communityPrediction}: </span>
                <span className="font-mono-tabular font-semibold text-zinc-200 text-sm">
                  {communityScore !== null ? communityScore.toFixed(1) : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 5 ანიმირებული პროგრესის ზოლი (GPU Compositor scaleX) */}
        <div className="space-y-3.5">
          {CRITERIA_KEYS.map((key) => {
            const val = displayedScores[key];
            const ratio = Math.min(1, Math.max(0.05, val / 10));

            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-zinc-200">
                    {i18n.criteria[key]}
                  </span>
                  <span className="font-mono-tabular font-bold text-amber-400">
                    {val.toFixed(1)}
                  </span>
                </div>

                <div className="w-full h-2 bg-zinc-900/90 rounded-full overflow-hidden border border-zinc-800/80">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: ratio }}
                    transition={{
                      type: 'spring',
                      stiffness: 260,
                      damping: 28,
                    }}
                    style={{ transformOrigin: 'left' }}
                    className={`h-full w-full rounded-full ${
                      isRevealed ? 'bg-amber-400' : 'bg-amber-500/85'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* სტატუსი 'revealed' — მსხვილი აქცენტური შტამპის ანიმაცია "ვერდიქტი" საბოლოო ქულით */}
        <AnimatePresence>
          {isRevealed && (
            <motion.div
              key="verdict-stamp"
              initial={{ opacity: 0, scale: 1.85, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: -4 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{
                type: 'spring',
                stiffness: 340,
                damping: 20,
              }}
              className="mt-6 pt-5 border-t border-amber-500/30 flex items-center justify-between"
            >
              <div className="inline-flex items-center gap-2.5 px-4 py-2 border-2 border-amber-400 rounded-xl bg-amber-500/15 text-amber-300 shadow-lg">
                <Award className="w-6 h-6 text-amber-400 shrink-0" />
                <span className="text-xl font-extrabold tracking-wider">
                  {i18n.ui.verdictStamp}
                </span>
              </div>

              <div className="text-right">
                <span className="block text-xs text-zinc-400">
                  {i18n.ui.averageScore}
                </span>
                <div className="flex items-baseline justify-end gap-1.5">
                  <span className="text-4xl font-extrabold font-mono-tabular text-amber-400">
                    {averageScore.toFixed(1)}
                  </span>
                  <span className="text-xs font-mono-tabular text-zinc-400">
                    / 10.0
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
