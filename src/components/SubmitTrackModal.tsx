import React, { useState, useEffect } from 'react';
import {
  X,
  Music2,
  Radio,
  Library,
  Check,
  LogIn,
  Link2,
  Image as ImageIcon,
  UserCheck,
} from 'lucide-react';
import {
  signInWithPopup,
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth, googleProvider } from '../lib/firebase';
import { i18n } from '../lib/i18n';
import { fetchYouTubeMetadata, extractYouTubeId } from '../lib/youtube';
import { useLiveSession, PRESET_COVERS } from '../hooks/useLiveSession';
import { VALIDATION_CONSTRAINTS, type Track } from '../types';

export interface SubmitTrackModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  defaultArtist?: string;
  onSubmitted?: (track: Track) => void;
}

export default function SubmitTrackModal({
  isOpen = true,
  onClose,
  defaultArtist = '',
  onSubmitted,
}: SubmitTrackModalProps) {
  const { submitNewTrack } = useLiveSession('current');

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(
    () => auth.currentUser
  );
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState(defaultArtist);
  const [genre, setGenre] = useState('ელექტრონული ჰიპ-ჰოპი');
  const [sourceUrl, setSourceUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState<string>(PRESET_COVERS.vinyl);
  const [destinationStatus, setDestinationStatus] = useState<
    'community_catalog' | 'in_queue'
  >('in_queue');

  const [submitting, setSubmitting] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [youtubeAutoFilled, setYoutubeAutoFilled] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSourceUrlChange = async (value: string) => {
    setSourceUrl(value);
    setYoutubeAutoFilled(false);

    const videoId = extractYouTubeId(value);
    if (!videoId) return;

    setYoutubeLoading(true);
    try {
      const meta = await fetchYouTubeMetadata(value);
      if (meta) {
        if (meta.title) setTitle(meta.title);
        if (meta.artist) setArtist(meta.artist);
        if (meta.coverUrl) setCoverUrl(meta.coverUrl);
        setYoutubeAutoFilled(true);
      }
    } finally {
      setYoutubeLoading(false);
    }
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setCurrentUser(u);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (defaultArtist) {
      setArtist(defaultArtist);
    }
  }, [defaultArtist]);

  if (!isOpen) return null;

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setErrorMsg(null);
    } catch (err) {
      console.error('Google Sign-In Error:', err);
    }
  };

  const isValidHttpUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanTitle = title.trim();
    const cleanArtist = artist.trim();
    const cleanGenre = genre.trim();
    const cleanSource = sourceUrl.trim();
    const cleanCover = coverUrl.trim();

    if (!cleanTitle || !cleanArtist || !cleanGenre || !cleanSource) {
      setErrorMsg(i18n.submitModal.validationRequired);
      return;
    }

    if (!isValidHttpUrl(cleanSource)) {
      setErrorMsg(i18n.submitModal.validationInvalidUrl);
      return;
    }

    setSubmitting(true);
    try {
      const createdTrack = await submitNewTrack({
        title: cleanTitle.slice(0, VALIDATION_CONSTRAINTS.TRACK_TITLE_MAX_LENGTH),
        artist: cleanArtist.slice(
          0,
          VALIDATION_CONSTRAINTS.TRACK_ARTIST_MAX_LENGTH
        ),
        genre: cleanGenre.slice(0, VALIDATION_CONSTRAINTS.GENRE_MAX_LENGTH),
        sourceUrl: cleanSource.slice(0, VALIDATION_CONSTRAINTS.URL_MAX_LENGTH),
        coverUrl:
          cleanCover.slice(0, VALIDATION_CONSTRAINTS.URL_MAX_LENGTH) ||
          PRESET_COVERS.vinyl,
        destinationStatus,
      });

      setSuccessMsg(
        destinationStatus === 'community_catalog'
          ? i18n.submitModal.successCatalog
          : i18n.submitModal.successQueue
      );
      setTitle('');
      setSourceUrl('');

      if (onSubmitted) {
        onSubmitted(createdTrack);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : i18n.submitModal.validationRequired
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-track-modal-title"
    >
      <div className="w-full max-w-xl border border-zinc-800 bg-[#111723] rounded-2xl p-6 md:p-7 shadow-2xl space-y-5 my-8">
        {/* მოდალური ფანჯრის სათაური */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-800/80">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Music2 className="w-5 h-5 text-amber-400 shrink-0" />
              <h2
                id="submit-track-modal-title"
                className="text-xl font-bold text-zinc-100"
              >
                {i18n.submitModal.title}
              </h2>
            </div>
            <p className="text-xs text-zinc-400">
              {i18n.submitModal.subtitle}
            </p>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={i18n.submitModal.cancelButton}
              className="p-2 text-zinc-400 hover:text-zinc-100 rounded-lg hover:bg-zinc-800/60 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ავტორიზებული მუსიკოსის / მომხმარებლის სტატუსის ზოლი */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0B0F17] border border-zinc-800/90 text-xs">
          <div className="flex items-center gap-2.5 text-zinc-300">
            <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              {currentUser
                ? `${currentUser.displayName || currentUser.email || 'ავტორიზებული მუსიკოსი'}`
                : i18n.submitModal.authNotice}
            </span>
          </div>

          {!currentUser && (
            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40 rounded-lg hover:bg-amber-500/25 transition-colors cursor-pointer whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{i18n.nav.signInGoogle}</span>
            </button>
          )}
        </div>

        {/* ტრეკის წარდგენის ფორმა */}
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 1. სათაური */}
            <div>
              <label
                htmlFor="submit-track-title"
                className="block text-xs font-medium text-zinc-200 mb-1.5"
              >
                {i18n.submitModal.fields.title} *
              </label>
              <input
                id="submit-track-title"
                type="text"
                required
                maxLength={VALIDATION_CONSTRAINTS.TRACK_TITLE_MAX_LENGTH}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={i18n.submitModal.fields.titlePlaceholder}
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            {/* 2. არტისტი */}
            <div>
              <label
                htmlFor="submit-track-artist"
                className="block text-xs font-medium text-zinc-200 mb-1.5"
              >
                {i18n.submitModal.fields.artist} *
              </label>
              <input
                id="submit-track-artist"
                type="text"
                required
                maxLength={VALIDATION_CONSTRAINTS.TRACK_ARTIST_MAX_LENGTH}
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder={i18n.submitModal.fields.artistPlaceholder}
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 3. ჟანრი */}
            <div>
              <label
                htmlFor="submit-track-genre"
                className="block text-xs font-medium text-zinc-200 mb-1.5"
              >
                {i18n.submitModal.fields.genre} *
              </label>
              <input
                id="submit-track-genre"
                type="text"
                required
                maxLength={VALIDATION_CONSTRAINTS.GENRE_MAX_LENGTH}
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={i18n.submitModal.fields.genrePlaceholder}
                className="w-full px-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            {/* 4. ბმული (YouTube / Spotify) */}
            <div>
              <label
                htmlFor="submit-track-url"
                className="block text-xs font-medium text-zinc-200 mb-1.5"
              >
                {i18n.submitModal.fields.sourceUrl} (YouTube / Spotify) *
              </label>
              <div className="relative">
                <Link2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="submit-track-url"
                  type="url"
                  required
                  maxLength={VALIDATION_CONSTRAINTS.URL_MAX_LENGTH}
                  value={sourceUrl}
                  onChange={(e) => void handleSourceUrlChange(e.target.value)}
                  placeholder={i18n.submitModal.fields.sourceUrlPlaceholder}
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              {youtubeLoading && (
                <p className="text-[11px] text-amber-400 mt-1">
                  {i18n.ui.youtubeFetching}
                </p>
              )}
              {youtubeAutoFilled && !youtubeLoading && (
                <p className="text-[11px] text-emerald-400 mt-1 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" />
                  <span>{i18n.ui.youtubeFetched}</span>
                </p>
              )}
            </div>
          </div>

          {/* 5. გარეკანი */}
          <div>
            <label
              htmlFor="submit-track-cover"
              className="block text-xs font-medium text-zinc-200 mb-1.5"
            >
              {i18n.submitModal.fields.coverUrl} ({i18n.submitModal.fields.coverUrlHint})
            </label>
            <div className="flex items-center gap-3">
              {coverUrl && (
                <img
                  src={coverUrl}
                  alt={i18n.ui.coverPreview}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-lg object-cover bg-zinc-900 border border-zinc-800 shrink-0"
                />
              )}
              <div className="relative flex-1">
                <ImageIcon className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="submit-track-cover"
                  type="text"
                  maxLength={VALIDATION_CONSTRAINTS.URL_MAX_LENGTH}
                  value={coverUrl}
                  onChange={(e) => setCoverUrl(e.target.value)}
                  placeholder={i18n.submitModal.fields.coverUrlPlaceholder}
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-[#0B0F17] border border-zinc-800 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => setCoverUrl(PRESET_COVERS.vinyl)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  coverUrl === PRESET_COVERS.vinyl
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {i18n.ui.presetCover1}
              </button>
              <button
                type="button"
                onClick={() => setCoverUrl(PRESET_COVERS.synth)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  coverUrl === PRESET_COVERS.synth
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {i18n.ui.presetCover3}
              </button>
              <button
                type="button"
                onClick={() => setCoverUrl(PRESET_COVERS.jazz)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  coverUrl === PRESET_COVERS.jazz
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {i18n.ui.presetCover4}
              </button>
              <button
                type="button"
                onClick={() => setCoverUrl(PRESET_COVERS.postpunk)}
                className={`px-2.5 py-1 text-xs rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                  coverUrl === PRESET_COVERS.postpunk
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-zinc-800 bg-[#0B0F17] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {i18n.ui.presetCover5}
              </button>
            </div>
          </div>

          {/* დანიშნულების არჩევა: კატალოგში დამატება vs სტრიმის რიგში გაგზავნა */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
            <span className="block text-xs font-medium text-zinc-200">
              {i18n.submitModal.destinationLabel}
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* ოფცია 1: სტრიმის რიგში გაგზავნა (in_queue) */}
              <button
                type="button"
                onClick={() => setDestinationStatus('in_queue')}
                className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer space-y-1 ${
                  destinationStatus === 'in_queue'
                    ? 'border-amber-500/70 bg-amber-500/10'
                    : 'border-zinc-800 bg-[#0B0F17] hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-zinc-100">
                    {i18n.submitModal.sendToStreamQueue}
                  </span>
                  <Radio
                    className={`w-4 h-4 shrink-0 ${
                      destinationStatus === 'in_queue'
                        ? 'text-amber-400'
                        : 'text-zinc-500'
                    }`}
                  />
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  {i18n.submitModal.addToQueue} · {i18n.submitModal.sendToStreamQueueDesc}
                </p>
              </button>

              {/* ოფცია 2: კატალოგში დამატება (community_catalog) */}
              <button
                type="button"
                onClick={() => setDestinationStatus('community_catalog')}
                className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer space-y-1 ${
                  destinationStatus === 'community_catalog'
                    ? 'border-emerald-500/70 bg-emerald-500/10'
                    : 'border-zinc-800 bg-[#0B0F17] hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-zinc-100">
                    {i18n.submitModal.addToCatalog}
                  </span>
                  <Library
                    className={`w-4 h-4 shrink-0 ${
                      destinationStatus === 'community_catalog'
                        ? 'text-emerald-400'
                        : 'text-zinc-500'
                    }`}
                  />
                </div>
                <p className="text-[11px] text-zinc-400 leading-snug">
                  {i18n.submitModal.addToCatalogDesc}
                </p>
              </button>
            </div>
          </div>

          {errorMsg && (
            <p className="text-xs font-medium text-red-400">{errorMsg}</p>
          )}

          {successMsg && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800/80">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-xs font-medium text-zinc-300 bg-[#0B0F17] border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                {i18n.submitModal.cancelButton}
              </button>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-xs font-bold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              {destinationStatus === 'community_catalog'
                ? i18n.submitModal.addToCatalog
                : i18n.submitModal.sendToStreamQueue}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
