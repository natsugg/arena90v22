/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { Copy, Check, LogIn, LogOut, Plus } from 'lucide-react';
import RootLayout from './app/layout';
import HomePage from './app/page';
import TrackDetailPage from './app/track/[id]/page';
import ArtistProfilePage from './app/artist/[id]/page';
import StudioPage from './app/studio/page';
import OverlayPage from './app/overlay/page';
import SubmitTrackModal from './components/SubmitTrackModal';
import { auth, googleProvider } from './lib/firebase';
import { i18n } from './lib/i18n';

type ActiveRoute = 'catalog' | 'track' | 'artist' | 'studio' | 'overlay';

interface RouteState {
  view: ActiveRoute;
  trackId: string;
  artistId: string;
}

function detectInitialRoute(): RouteState {
  const defaultState: RouteState = {
    view: 'catalog',
    trackId: 'track_tbilisi_night',
    artistId: 'artist_kordz_moku',
  };

  if (typeof window === 'undefined') {
    return defaultState;
  }

  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path.startsWith('/overlay') || params.get('view') === 'overlay') {
    return { ...defaultState, view: 'overlay' };
  }
  if (path.startsWith('/studio') || params.get('view') === 'studio') {
    return { ...defaultState, view: 'studio' };
  }
  if (path.startsWith('/artist/')) {
    const idFromPath = path.replace('/artist/', '').split('/')[0];
    return {
      ...defaultState,
      view: 'artist',
      artistId: idFromPath || 'artist_kordz_moku',
    };
  }
  if (path.startsWith('/track/')) {
    const idFromPath = path.replace('/track/', '').split('/')[0];
    return {
      ...defaultState,
      view: 'track',
      trackId: idFromPath || 'track_tbilisi_night',
    };
  }
  return defaultState;
}

export default function App() {
  const [routeState, setRouteState] = useState<RouteState>(detectInitialRoute);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [copiedObs, setCopiedObs] = useState(false);
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [submitModalArtist, setSubmitModalArtist] = useState<string>('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  const navigate = (
    view: ActiveRoute,
    options?: { trackId?: string; artistId?: string }
  ) => {
    const nextTrackId = options?.trackId ?? routeState.trackId;
    const nextArtistId = options?.artistId ?? routeState.artistId;
    setRouteState({
      view,
      trackId: nextTrackId,
      artistId: nextArtistId,
    });
    try {
      const nextUrl =
        view === 'overlay'
          ? '/overlay'
          : view === 'studio'
            ? '/studio'
            : view === 'artist'
              ? `/artist/${encodeURIComponent(nextArtistId)}`
              : view === 'track'
                ? `/track/${encodeURIComponent(nextTrackId)}`
                : '/';
      window.history.pushState({}, '', nextUrl);
    } catch {
      // ignore history errors in sandboxed iframe
    }
  };

  const handleOpenSubmitModal = (defaultArtistName?: string) => {
    setSubmitModalArtist(defaultArtistName ?? '');
    setSubmitModalOpen(true);
  };

  const handleCopyObsLink = async () => {
    const obsUrl = `${window.location.origin}/overlay`;
    try {
      await navigator.clipboard.writeText(obsUrl);
      setCopiedObs(true);
      setTimeout(() => setCopiedObs(false), 2000);
    } catch {
      setCopiedObs(true);
      setTimeout(() => setCopiedObs(false), 2000);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Google Sign-In Error:', err);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign-Out Error:', err);
    }
  };

  // სუფთა OBS Browser Source რეჟიმი (/overlay)
  if (routeState.view === 'overlay') {
    return (
      <RootLayout transparent>
        <div className="relative min-h-screen bg-transparent">
          <div className="fixed top-4 right-4 z-50 opacity-20 hover:opacity-100 transition-opacity flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('catalog')}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900/90 text-zinc-200 border border-zinc-700 rounded-lg cursor-pointer whitespace-nowrap"
            >
              {i18n.nav.catalog}
            </button>
            <button
              type="button"
              onClick={() => navigate('studio')}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-900/90 text-amber-300 border border-zinc-700 rounded-lg cursor-pointer whitespace-nowrap"
            >
              {i18n.nav.studio}
            </button>
          </div>
          <OverlayPage />
        </div>
      </RootLayout>
    );
  }

  return (
    <RootLayout>
      {/* 3-ზონიანი Top Bar Contract */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/90 bg-[#0B0F17]">
        {/* ზონა 1: ბრენდის სახელწოდება (ერთი ელემენტი) */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('catalog');
          }}
          className="text-lg font-bold tracking-tight text-zinc-100 whitespace-nowrap"
        >
          {i18n.brand.name}
        </a>

        {/* ზონა 2: ნავიგაციის ბმულები */}
        <nav className="flex items-center gap-6 text-sm font-medium text-zinc-400">
          <button
            type="button"
            onClick={() => navigate('catalog')}
            className={`transition-colors whitespace-nowrap cursor-pointer ${
              routeState.view === 'catalog' || routeState.view === 'track'
                ? 'text-amber-400 underline underline-offset-8'
                : 'hover:text-zinc-100'
            }`}
          >
            {i18n.nav.catalog}
          </button>

          <button
            type="button"
            onClick={() => navigate('artist')}
            className={`transition-colors whitespace-nowrap cursor-pointer ${
              routeState.view === 'artist'
                ? 'text-amber-400 underline underline-offset-8'
                : 'hover:text-zinc-100'
            }`}
          >
            {i18n.nav.artists}
          </button>

          <button
            type="button"
            onClick={() => navigate('studio')}
            className={`transition-colors whitespace-nowrap cursor-pointer ${
              routeState.view === 'studio'
                ? 'text-amber-400 underline underline-offset-8'
                : 'hover:text-zinc-100'
            }`}
          >
            {i18n.nav.studio}
          </button>

          <button
            type="button"
            onClick={() => navigate('overlay')}
            className="hidden md:inline hover:text-zinc-100 transition-colors whitespace-nowrap cursor-pointer"
          >
            {i18n.nav.overlay}
          </button>
        </nav>

        {/* ზონა 3: ძირითადი მოქმედებები */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleOpenSubmitModal()}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{i18n.nav.submitTrack}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleCopyObsLink()}
            className="hidden xl:flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-200 bg-[#111723] border border-zinc-800 rounded-lg hover:border-zinc-700 transition-colors whitespace-nowrap cursor-pointer"
          >
            {copiedObs ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{i18n.nav.copiedObsUrl}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                <span>{i18n.nav.copyObsUrl}</span>
              </>
            )}
          </button>

          {currentUser ? (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{i18n.nav.signOut}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-zinc-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{i18n.nav.signInGoogle}</span>
            </button>
          )}
        </div>
      </header>

      {/* მთავარი სამუშაო სივრცე */}
      <main className="pb-14">
        {routeState.view === 'catalog' && (
          <HomePage
            onSelectTrack={(id) => navigate('track', { trackId: id })}
            onSelectArtist={(id) => navigate('artist', { artistId: id })}
            onOpenStudio={() => navigate('studio')}
            onOpenSubmitModal={() => handleOpenSubmitModal()}
          />
        )}

        {routeState.view === 'track' && (
          <TrackDetailPage
            trackId={routeState.trackId}
            onBackToCatalog={() => navigate('catalog')}
            onSelectArtist={(id) => navigate('artist', { artistId: id })}
            onOpenStudio={() => navigate('studio')}
          />
        )}

        {routeState.view === 'artist' && (
          <ArtistProfilePage
            artistId={routeState.artistId}
            onBackToCatalog={() => navigate('catalog')}
            onSelectTrack={(id) => navigate('track', { trackId: id })}
            onSelectArtist={(id) => navigate('artist', { artistId: id })}
            onOpenSubmitModal={(artistName) =>
              handleOpenSubmitModal(artistName)
            }
          />
        )}

        {routeState.view === 'studio' && (
          <div className="space-y-6">
            <StudioPage
              onSelectArtist={(id) => navigate('artist', { artistId: id })}
              onSelectTrack={(id) => navigate('track', { trackId: id })}
              onOpenSubmitModal={() => handleOpenSubmitModal()}
            />
            <section className="max-w-[1360px] mx-auto px-6">
              <div className="border border-zinc-800/90 rounded-2xl p-6 bg-[#070A0F]">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-zinc-800/80">
                  <div>
                    <h2 className="text-base font-semibold text-zinc-100">
                      {i18n.nav.overlay} — რეალურ დროში სინქრონიზაცია
                    </h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      {i18n.ui.obsTransparentHint}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('overlay')}
                    className="px-3.5 py-2 text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg hover:bg-amber-500/20 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {i18n.nav.overlay} (სრული ეკრანი)
                  </button>
                </div>
                <OverlayPage embedded />
              </div>
            </section>
          </div>
        )}
      </main>

      {/* გლობალური ტრეკის წარდგენის მოდალური ფანჯარა */}
      <SubmitTrackModal
        isOpen={submitModalOpen}
        onClose={() => setSubmitModalOpen(false)}
        defaultArtist={submitModalArtist}
      />
    </RootLayout>
  );
}
