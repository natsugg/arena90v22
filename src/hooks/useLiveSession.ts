import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  doc,
  collection,
  query,
  where,
  onSnapshot,
  setDoc,
  getDoc,
  updateDoc,
  increment,
  serverTimestamp,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import {
  calculateAverageScore,
  calculateMetaScore,
  computeUpdatedCommunityScores,
  getArtistIdFromName,
  DEFAULT_ROLE_VOTE_WEIGHTS,
  type ArtistProfile,
  type CriteriaScores,
  type LiveSession,
  type LiveStreamStatus,
  type TopCritic,
  type Track,
  type TrackReview,
  type TrackStatus,
  type User,
  type UserRole,
} from '../types';
import defaultCoverImg from '../assets/images/default_track_cover_1790747990267.jpg';
import studioEmblemImg from '../assets/images/studio_vinyl_emblem_1790748005639.jpg';
import caucasusSynthImg from '../assets/images/cover_caucasus_synth_1790748715826.jpg';
import rustaveliJazzImg from '../assets/images/cover_rustaveli_jazz_1790748728643.jpg';
import blackSeaPostpunkImg from '../assets/images/cover_black_sea_postpunk_1790748739650.jpg';

export const PRESET_COVERS = {
  vinyl: defaultCoverImg,
  console: studioEmblemImg,
  synth: caucasusSynthImg,
  jazz: rustaveliJazzImg,
  postpunk: blackSeaPostpunkImg,
};

const STORAGE_SESSION_KEY = 'soundcheck_live_session_v3';
const STORAGE_TRACKS_KEY = 'soundcheck_tracks_catalog_v3';
const STORAGE_REVIEWS_KEY = 'soundcheck_tracks_reviews_v3';
const STORAGE_CRITICS_KEY = 'soundcheck_top_critics_v3';
const SYNC_EVENT_NAME = 'soundcheck:live-sync';
const BROADCAST_CHANNEL_NAME = 'soundcheck_live_channel';

export const INITIAL_CRITERIA_SCORES: CriteriaScores = {
  lyrics: 8.6,
  flow: 9.0,
  production: 9.4,
  identity: 8.9,
  vibe: 9.2,
};

const NOW = Date.now();
const DAY_MS = 86_400_000;

export const INITIAL_ARTISTS: ArtistProfile[] = [
  {
    id: 'artist_kordz_moku',
    name: 'KORDZ & MOKU T',
    bio: 'ქართული ელექტრონული სცენისა და ალტერნატიული ჰიპ-ჰოპის კოლაბორაციული პროექტი. გამოირჩევა რთული სინთეზური არანჟირებით, პოლირიტმული ფლოუთი და თბილისური ურბანული ჟღერადობით.',
    avatarUrl: defaultCoverImg,
    genres: ['ელექტრონული ჰიპ-ჰოპი', 'უკ-გარაჟი', 'სინთ-ფანკი'],
    city: 'თბილისი',
    socialLinks: {
      spotify: 'https://open.spotify.com',
      youtube: 'https://youtube.com',
      soundcloud: 'https://soundcloud.com',
      instagram: 'https://instagram.com',
    },
  },
  {
    id: 'artist_nikakoi_tba',
    name: 'NIKAKOI & TBA',
    bio: 'ქართული IDM-ისა და ემბიენტ-ელექტრონიკის პიონერული დუეტი. ქმნის ანალოგური სინთეზატორებისა და კავკასიური აკუსტიკური ტექსტურების უნიკალურ აუდიო-არქიტექტურას.',
    avatarUrl: caucasusSynthImg,
    genres: ['IDM / სინთვეივი', 'ემბიენტ-ელექტრონიკა', 'ექსპერიმენტული'],
    city: 'თბილისი',
    socialLinks: {
      spotify: 'https://open.spotify.com',
      youtube: 'https://youtube.com',
      soundcloud: 'https://soundcloud.com',
    },
  },
  {
    id: 'artist_tamada_jazz',
    name: 'TAMADA & JAZZ ENSEMBLE',
    bio: 'თანამედროვე ქართული ნუ-ჯაზის, ფიუჟენისა და ტრადიციული მრავალხმიანი ინტონაციების სინთეზი ცოცხალი სასულე და პერკუსიული სექციით.',
    avatarUrl: rustaveliJazzImg,
    genres: ['ნუ-ჯაზი / ფიუჟენი', 'ეთნო-ელექტრონიკა', 'სოული'],
    city: 'თბილისი',
    socialLinks: {
      spotify: 'https://open.spotify.com',
      youtube: 'https://youtube.com',
      instagram: 'https://instagram.com',
    },
  },
  {
    id: 'artist_eko_vinda',
    name: 'EKO & VINDA FOLIO',
    bio: 'შავი ზღვისპირა პოსტ-პანკისა და ინდი-როკის გამორჩეული წარმომადგენლები. პოეტური ქართული ტექსტები, მელანქოლიური გიტარის რიფები და დრამ-მანქანების ჰიპნოზური პულსაცია.',
    avatarUrl: blackSeaPostpunkImg,
    genres: ['პოსტ-პანკი / ინდი', 'კოლდვეივი', 'ალტერნატიული როკი'],
    city: 'ბათუმი / თბილისი',
    socialLinks: {
      spotify: 'https://open.spotify.com',
      youtube: 'https://youtube.com',
      soundcloud: 'https://soundcloud.com',
      instagram: 'https://instagram.com',
    },
  },
  {
    id: 'artist_kayg_luna',
    name: 'KAY G & LUNA',
    bio: 'ახალი თაობის ქართული ალტერნატიული R&B და ნეო-სოულ დუეტი. ხავერდოვანი ვოკალური ჰარმონიები, ღრმა ბას-ხაზები და ატმოსფერული ღამის ჟღერადობა.',
    avatarUrl: studioEmblemImg,
    genres: ['ალტერნატიული R&B', 'ნეო-სოული', 'ლოუ-ფაი'],
    city: 'თბილისი',
    socialLinks: {
      spotify: 'https://open.spotify.com',
      youtube: 'https://youtube.com',
      instagram: 'https://instagram.com',
    },
  },
  {
    id: 'artist_jeronimo_ice',
    name: 'JERONIMO & ICE',
    bio: 'კლასიკური თბილისური ბუმ-ბეპისა და ანდერგრაუნდ ჰიპ-ჰოპის ოსტატები. ვინილის სემპლინგი, მკვეთრი სოციალური ლირიკა და უკომპრომისო სტუდიური ჟღერადობა.',
    avatarUrl: defaultCoverImg,
    genres: ['ბუმ-ბეპი / ჰიპ-ჰოპი', 'ანდერგრაუნდ რეპი'],
    city: 'თბილისი',
    socialLinks: {
      spotify: 'https://open.spotify.com',
      youtube: 'https://youtube.com',
      soundcloud: 'https://soundcloud.com',
    },
  },
];

export const INITIAL_DEMO_TRACKS: Track[] = [
  {
    id: 'track_tbilisi_night',
    title: 'ღამის თბილისი (Tbilisi Nocturne)',
    artist: 'KORDZ & MOKU T',
    artistId: 'artist_kordz_moku',
    coverUrl: defaultCoverImg,
    audioUrl: 'https://soundcheck.live/audio/tbilisi-nocturne.mp3',
    sourceUrl: 'https://open.spotify.com/track/tbilisi-nocturne',
    genre: 'ელექტრონული ჰიპ-ჰოპი',
    duration: 214,
    submittedBy: 'streamer_host',
    submittedByName: 'სტუდია',
    isPriority: true,
    status: 'on_air',
    expertScore: {
      lyrics: 8.8,
      flow: 9.2,
      production: 9.6,
      identity: 9.1,
      vibe: 9.4,
    },
    expertTotalScore: 9.2,
    communityScore: {
      lyrics: 8.6,
      flow: 9.0,
      production: 9.4,
      identity: 8.9,
      vibe: 9.2,
    },
    communityTotalScore: 9.0,
    communityVotesCount: 184,
    metaScore: 91,
    createdAt: NOW - 4 * DAY_MS,
    updatedAt: NOW - 1 * DAY_MS,
  },
  {
    id: 'track_metekhi_drift',
    title: 'მეტეხის ქარი (Metekhi Drift)',
    artist: 'KORDZ & MOKU T',
    artistId: 'artist_kordz_moku',
    coverUrl: studioEmblemImg,
    audioUrl: 'https://soundcheck.live/audio/metekhi-drift.mp3',
    sourceUrl: 'https://youtube.com/watch?v=metekhi-drift',
    genre: 'სინთ-ფანკი',
    duration: 196,
    submittedBy: 'critic_giorgi',
    submittedByName: 'გიორგი მაისურაძე',
    isPriority: false,
    status: 'reviewed',
    expertScore: {
      lyrics: 8.5,
      flow: 9.4,
      production: 9.8,
      identity: 9.3,
      vibe: 9.5,
    },
    expertTotalScore: 9.3,
    communityScore: {
      lyrics: 8.4,
      flow: 9.1,
      production: 9.5,
      identity: 9.0,
      vibe: 9.3,
    },
    communityTotalScore: 9.1,
    communityVotesCount: 142,
    metaScore: 92,
    createdAt: NOW - 11 * DAY_MS,
    updatedAt: NOW - 3 * DAY_MS,
  },
  {
    id: 'track_kavkasioni_pulse',
    title: 'კავკასიონის პულსი',
    artist: 'NIKAKOI & TBA',
    artistId: 'artist_nikakoi_tba',
    coverUrl: caucasusSynthImg,
    audioUrl: 'https://soundcheck.live/audio/kavkasioni-pulse.mp3',
    sourceUrl: 'https://open.spotify.com/track/kavkasioni-pulse',
    genre: 'IDM / სინთვეივი',
    duration: 246,
    submittedBy: 'critic_giorgi',
    submittedByName: 'გიორგი მაისურაძე',
    isPriority: true,
    status: 'reviewed',
    expertScore: {
      lyrics: 8.4,
      flow: 9.0,
      production: 9.8,
      identity: 9.5,
      vibe: 9.3,
    },
    expertTotalScore: 9.2,
    communityScore: {
      lyrics: 8.3,
      flow: 8.8,
      production: 9.5,
      identity: 9.2,
      vibe: 9.1,
    },
    communityTotalScore: 9.0,
    communityVotesCount: 152,
    metaScore: 91,
    createdAt: NOW - 9 * DAY_MS,
    updatedAt: NOW - 2 * DAY_MS,
  },
  {
    id: 'track_kazbegi_aurora',
    title: 'ყაზბეგის ავრორა',
    artist: 'NIKAKOI & TBA',
    artistId: 'artist_nikakoi_tba',
    coverUrl: caucasusSynthImg,
    audioUrl: 'https://soundcheck.live/audio/kazbegi-aurora.mp3',
    sourceUrl: 'https://soundcloud.com/nikakoi/kazbegi-aurora',
    genre: 'ემბიენტ-ელექტრონიკა',
    duration: 268,
    submittedBy: 'critic_nino',
    submittedByName: 'ნინო ქავთარაძე',
    isPriority: false,
    status: 'reviewed',
    expertScore: {
      lyrics: 8.0,
      flow: 8.7,
      production: 9.9,
      identity: 9.6,
      vibe: 9.4,
    },
    expertTotalScore: 9.1,
    communityScore: {
      lyrics: 8.2,
      flow: 8.6,
      production: 9.6,
      identity: 9.4,
      vibe: 9.2,
    },
    communityTotalScore: 9.0,
    communityVotesCount: 119,
    metaScore: 91,
    createdAt: NOW - 21 * DAY_MS,
    updatedAt: NOW - 6 * DAY_MS,
  },
  {
    id: 'track_rustaveli_midnight',
    title: 'რუსთაველის შუაღამე',
    artist: 'TAMADA & JAZZ ENSEMBLE',
    artistId: 'artist_tamada_jazz',
    coverUrl: rustaveliJazzImg,
    audioUrl: 'https://soundcheck.live/audio/rustaveli-midnight.mp3',
    sourceUrl: 'https://open.spotify.com/track/rustaveli-midnight',
    genre: 'ნუ-ჯაზი / ფიუჟენი',
    duration: 230,
    submittedBy: 'critic_nino',
    submittedByName: 'ნინო ქავთარაძე',
    isPriority: false,
    status: 'reviewed',
    expertScore: {
      lyrics: 9.1,
      flow: 8.9,
      production: 9.0,
      identity: 9.6,
      vibe: 9.2,
    },
    expertTotalScore: 9.2,
    communityScore: {
      lyrics: 8.9,
      flow: 8.7,
      production: 8.8,
      identity: 9.3,
      vibe: 9.0,
    },
    communityTotalScore: 8.9,
    communityVotesCount: 128,
    metaScore: 91,
    createdAt: NOW - 14 * DAY_MS,
    updatedAt: NOW - 3 * DAY_MS,
  },
  {
    id: 'track_batumi_storm',
    title: 'შავი ზღვის ქარიშხალი',
    artist: 'EKO & VINDA FOLIO',
    artistId: 'artist_eko_vinda',
    coverUrl: blackSeaPostpunkImg,
    audioUrl: 'https://soundcheck.live/audio/batumi-storm.mp3',
    sourceUrl: 'https://open.spotify.com/track/batumi-storm',
    genre: 'პოსტ-პანკი / ინდი',
    duration: 204,
    submittedBy: 'critic_levan',
    submittedByName: 'ლევან ბერიძე',
    isPriority: false,
    status: 'reviewed',
    expertScore: {
      lyrics: 9.5,
      flow: 8.4,
      production: 8.7,
      identity: 9.3,
      vibe: 9.1,
    },
    expertTotalScore: 9.0,
    communityScore: {
      lyrics: 9.3,
      flow: 8.3,
      production: 8.6,
      identity: 9.0,
      vibe: 8.9,
    },
    communityTotalScore: 8.8,
    communityVotesCount: 116,
    metaScore: 89,
    createdAt: NOW - 19 * DAY_MS,
    updatedAt: NOW - 5 * DAY_MS,
  },
  {
    id: 'track_mtatsminda_echo',
    title: 'მთაწმინდის ექო',
    artist: 'KAY G & LUNA',
    artistId: 'artist_kayg_luna',
    coverUrl: studioEmblemImg,
    audioUrl: 'https://soundcheck.live/audio/mtatsminda-echo.mp3',
    sourceUrl: 'https://open.spotify.com/track/mtatsminda-echo',
    genre: 'ალტერნატიული R&B',
    duration: 198,
    submittedBy: 'streamer_host',
    submittedByName: 'სტუდია',
    isPriority: false,
    status: 'community_catalog',
    expertScore: {
      lyrics: 8.2,
      flow: 8.7,
      production: 9.0,
      identity: 8.6,
      vibe: 8.8,
    },
    expertTotalScore: 8.7,
    communityScore: {
      lyrics: 8.1,
      flow: 8.5,
      production: 8.8,
      identity: 8.4,
      vibe: 8.7,
    },
    communityTotalScore: 8.5,
    communityVotesCount: 94,
    metaScore: 86,
    createdAt: NOW - 24 * DAY_MS,
    updatedAt: NOW - 6 * DAY_MS,
  },
  {
    id: 'track_vera_tape',
    title: 'ვერის ჩანაწერები Vol. 3',
    artist: 'JERONIMO & ICE',
    artistId: 'artist_jeronimo_ice',
    coverUrl: defaultCoverImg,
    audioUrl: 'https://soundcheck.live/audio/vera-tape.mp3',
    sourceUrl: 'https://youtu.be/vera-tape-vol3',
    genre: 'ბუმ-ბეპი / ჰიპ-ჰოპი',
    duration: 189,
    submittedBy: 'critic_sandro',
    submittedByName: 'სანდრო კახიძე',
    isPriority: true,
    status: 'in_queue',
    expertScore: null,
    expertTotalScore: null,
    communityScore: {
      lyrics: 8.9,
      flow: 8.8,
      production: 8.4,
      identity: 8.6,
      vibe: 8.5,
    },
    communityTotalScore: 8.6,
    communityVotesCount: 73,
    metaScore: 86,
    createdAt: NOW - 3600_000 * 3,
    updatedAt: NOW - 3600_000 * 2,
  },
  {
    id: 'track_sololaki_rain',
    title: 'სოლოლაკის წვიმა',
    artist: 'EKO & VINDA FOLIO',
    artistId: 'artist_eko_vinda',
    coverUrl: blackSeaPostpunkImg,
    audioUrl: 'https://soundcheck.live/audio/sololaki-rain.mp3',
    sourceUrl: 'https://open.spotify.com/track/sololaki-rain',
    genre: 'პოსტ-პანკი / ინდი',
    duration: 212,
    submittedBy: 'critic_levan',
    submittedByName: 'ლევან ბერიძე',
    isPriority: false,
    status: 'in_queue',
    expertScore: null,
    expertTotalScore: null,
    communityScore: {
      lyrics: 9.2,
      flow: 8.5,
      production: 8.8,
      identity: 9.1,
      vibe: 9.0,
    },
    communityTotalScore: 8.9,
    communityVotesCount: 41,
    metaScore: 89,
    createdAt: NOW - 3600_000 * 1,
    updatedAt: NOW - 3600_000 * 1,
  },
];

export const INITIAL_DEMO_REVIEWS: TrackReview[] = [
  {
    id: 'rev_1',
    trackId: 'track_tbilisi_night',
    trackTitle: 'ღამის თბილისი (Tbilisi Nocturne)',
    trackArtist: 'KORDZ & MOKU T',
    trackCoverUrl: defaultCoverImg,
    authorId: 'critic_giorgi',
    authorName: 'გიორგი მაისურაძე',
    authorRole: 'expert',
    voteWeight: 5.0,
    scores: {
      lyrics: 8.8,
      flow: 9.3,
      production: 9.7,
      identity: 9.1,
      vibe: 9.5,
    },
    totalScore: 9.3,
    text: 'საოცრად დახვეწილი სინთეზი ქართული ურბანული ჟღერადობისა და თანამედროვე ელექტრონული პროდაქშენის. ბას-ხაზი და სინთეზატორების არანჟირება პირველივე წამებიდან ქმნის ღამის თბილისის კინემატოგრაფიულ ატმოსფეროს, ხოლო MOKU T-ის ფლოუ ზუსტად ჯდება რთულ რიტმულ სტრუქტურაში.',
    helpfulCount: 42,
    helpfulVoterIds: [],
    createdAt: NOW - 3600_000 * 5,
  },
  {
    id: 'rev_2',
    trackId: 'track_kavkasioni_pulse',
    trackTitle: 'კავკასიონის პულსი',
    trackArtist: 'NIKAKOI & TBA',
    trackCoverUrl: caucasusSynthImg,
    authorId: 'critic_nino',
    authorName: 'ნინო ქავთარაძე',
    authorRole: 'vip',
    voteWeight: 2.0,
    scores: {
      lyrics: 8.4,
      flow: 8.9,
      production: 9.8,
      identity: 9.5,
      vibe: 9.2,
    },
    totalScore: 9.2,
    text: 'მიქსინგი და ხმის დიზაინი უმაღლეს დონეზეა შესრულებული. IDM-ის და ანალოგური სინთეზატორების ტექსტურები ქმნის სივრცულ, ცივ და ამავდროულად ძალიან ემოციურ გარემოს. წლის ერთ-ერთი ყველაზე გამორჩეული ინსტრუმენტული და ვოკალური ნამუშევარია ქართულ სცენაზე.',
    helpfulCount: 31,
    helpfulVoterIds: [],
    createdAt: NOW - 3600_000 * 14,
  },
  {
    id: 'rev_3',
    trackId: 'track_batumi_storm',
    trackTitle: 'შავი ზღვის ქარიშხალი',
    trackArtist: 'EKO & VINDA FOLIO',
    trackCoverUrl: blackSeaPostpunkImg,
    authorId: 'critic_levan',
    authorName: 'ლევან ბერიძე',
    authorRole: 'expert',
    voteWeight: 5.0,
    scores: {
      lyrics: 9.6,
      flow: 8.5,
      production: 8.8,
      identity: 9.4,
      vibe: 9.2,
    },
    totalScore: 9.1,
    text: 'პოეტური ტექსტი და მელანქოლიური გიტარის რიფები საოცარ სინერგიას ქმნის. ტექსტური მეტაფორები ზღვისა და შინაგანი თავისუფლების შესახებ ქართულ ალტერნატიულ მუსიკაში იშვიათი სიღრმით გამოირჩევა. აუცილებლად მოსასმენი რელიზია.',
    helpfulCount: 27,
    helpfulVoterIds: [],
    createdAt: NOW - 3600_000 * 28,
  },
];

export const INITIAL_TOP_CRITICS: TopCritic[] = [
  {
    uid: 'critic_giorgi',
    displayName: 'გიორგი მაისურაძე',
    role: 'expert',
    voteWeight: 5.0,
    xp: 4850,
    reviewsCount: 64,
    helpfulVotesReceived: 312,
  },
  {
    uid: 'critic_nino',
    displayName: 'ნინო ქავთარაძე',
    role: 'vip',
    voteWeight: 2.0,
    xp: 3420,
    reviewsCount: 49,
    helpfulVotesReceived: 218,
  },
  {
    uid: 'critic_levan',
    displayName: 'ლევან ბერიძე',
    role: 'expert',
    voteWeight: 5.0,
    xp: 3190,
    reviewsCount: 41,
    helpfulVotesReceived: 194,
  },
  {
    uid: 'critic_sandro',
    displayName: 'სანდრო კახიძე',
    role: 'moderator',
    voteWeight: 2.5,
    xp: 2640,
    reviewsCount: 35,
    helpfulVotesReceived: 147,
  },
  {
    uid: 'critic_ana',
    displayName: 'ანა წერეთელი',
    role: 'viewer',
    voteWeight: 1.0,
    xp: 1890,
    reviewsCount: 28,
    helpfulVotesReceived: 96,
  },
];

export const INITIAL_LIVE_SESSION: LiveSession = {
  id: 'current',
  isLive: true,
  streamStatus: 'listening',
  activeTrackId: 'track_tbilisi_night',
  activeTrackSnapshot: {
    id: 'track_tbilisi_night',
    title: 'ღამის თბილისი (Tbilisi Nocturne)',
    artist: 'KORDZ & MOKU T',
    coverUrl: defaultCoverImg,
    genre: 'ელექტრონული ჰიპ-ჰოპი',
    expertScore: {
      lyrics: 8.8,
      flow: 9.2,
      production: 9.6,
      identity: 9.1,
      vibe: 9.4,
    },
    expertTotalScore: 9.2,
    communityTotalScore: 9.0,
    communityVotesCount: 184,
    metaScore: 91,
  },
  hostId: 'streamer_host',
  title: 'ქართული რელიზების ლაივ-განხილვა #14',
  votingOpen: true,
  isPlaying: true,
  playbackPosition: 64,
  showObsOverlay: true,
  obsTheme: 'dark',
  liveExpertDraft: INITIAL_CRITERIA_SCORES,
  viewersCount: 318,
  updatedAt: NOW,
};

function readLocalSession(): LiveSession {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION_KEY);
    if (raw) return JSON.parse(raw) as LiveSession;
  } catch {
    // ignore
  }
  return INITIAL_LIVE_SESSION;
}

function readLocalTracks(): Track[] {
  try {
    const raw = localStorage.getItem(STORAGE_TRACKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Track[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return INITIAL_DEMO_TRACKS;
}

function readLocalReviews(): TrackReview[] {
  try {
    const raw = localStorage.getItem(STORAGE_REVIEWS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TrackReview[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return INITIAL_DEMO_REVIEWS;
}

function readLocalCritics(): TopCritic[] {
  try {
    const raw = localStorage.getItem(STORAGE_CRITICS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TopCritic[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return INITIAL_TOP_CRITICS;
}

interface BroadcastPayload {
  session: LiveSession;
  tracks: Track[];
  reviews: TrackReview[];
  critics: TopCritic[];
}

function broadcastStateUpdate(payload: BroadcastPayload) {
  try {
    localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(payload.session));
    localStorage.setItem(STORAGE_TRACKS_KEY, JSON.stringify(payload.tracks));
    localStorage.setItem(STORAGE_REVIEWS_KEY, JSON.stringify(payload.reviews));
    localStorage.setItem(STORAGE_CRITICS_KEY, JSON.stringify(payload.critics));
  } catch {
    // ignore quota errors
  }

  window.dispatchEvent(
    new CustomEvent(SYNC_EVENT_NAME, {
      detail: payload,
    })
  );

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      channel.postMessage(payload);
      channel.close();
    } catch {
      // ignore
    }
  }
}

export interface UseLiveSessionOptions {
  sessionId?: string;
  requireAuth?: boolean;
}

export interface SubmitReviewInput {
  trackId: string;
  authorName: string;
  scores: CriteriaScores;
  text: string;
}

export interface SubmitNewTrackInput {
  title: string;
  artist: string;
  genre: string;
  sourceUrl: string;
  coverUrl?: string;
  destinationStatus: 'community_catalog' | 'in_queue';
}

export interface UseLiveSessionResult {
  session: LiveSession | null;
  activeTrack: Track | null;
  tracksQueue: Track[];
  inQueueTracks: Track[];
  artists: ArtistProfile[];
  reviews: TrackReview[];
  topCritics: TopCritic[];
  userProfile: User | null;
  loading: boolean;
  sessionLoading: boolean;
  trackLoading: boolean;
  error: Error | null;
  isLive: boolean;
  votingOpen: boolean;
  isFirestoreSynced: boolean;
  updateDraftScores: (draft: CriteriaScores) => Promise<void>;
  updateStreamStatus: (status: LiveStreamStatus) => Promise<void>;
  lockInVerdict: (finalScores: CriteriaScores) => Promise<void>;
  addAndActivateTrack: (input: {
    title: string;
    artist: string;
    coverUrl: string;
    genre?: string;
    audioUrl?: string;
    sourceUrl?: string;
  }) => Promise<Track>;
  submitNewTrack: (input: SubmitNewTrackInput) => Promise<Track>;
  launchTrackOnAir: (trackId: string) => Promise<void>;
  selectActiveTrack: (trackId: string) => Promise<void>;
  updateCommunityPrediction: (communityAvg: number) => Promise<void>;
  submitTrackReview: (input: SubmitReviewInput) => Promise<TrackReview>;
  toggleReviewHelpful: (reviewId: string, trackId?: string) => Promise<void>;
}

/**
 * უზრუნველყოფს ავტორიზებული მომხმარებლის პროფილის არსებობას `/users/{uid}` კოლექციაში
 */
async function ensureUserProfileInFirestore(uid: string, displayName: string | null) {
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        displayName: (displayName || 'ქართველი მუსიკოსი').slice(0, 80),
        role: 'viewer',
        xp: 0,
        voteWeight: 1.0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // ignore if offline or permissions pending
  }
}

export function useLiveSession(
  options: UseLiveSessionOptions | string = 'current'
): UseLiveSessionResult {
  const sessionId =
    typeof options === 'string' ? options : (options.sessionId ?? 'current');
  const requireAuth =
    typeof options === 'string' ? false : (options.requireAuth ?? false);

  const [authReady, setAuthReady] = useState<boolean>(!requireAuth);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => Boolean(auth.currentUser)
  );
  const [tracksQueue, setTracksQueue] = useState<Track[]>(() =>
    readLocalTracks()
  );
  const [reviews, setReviews] = useState<TrackReview[]>([]);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [topCritics, setTopCritics] = useState<TopCritic[]>(() =>
    readLocalCritics()
  );
  const [session, setSession] = useState<LiveSession | null>(() =>
    readLocalSession()
  );
  const [activeTrack, setActiveTrack] = useState<Track | null>(() => {
    const initialSession = readLocalSession();
    const initialTracks = readLocalTracks();
    return (
      initialTracks.find((t) => t.id === initialSession.activeTrackId) ??
      initialTracks[0] ??
      null
    );
  });
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [trackLoading, setTrackLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isFirestoreSynced, setIsFirestoreSynced] = useState<boolean>(false);

  // Ref для доступа к актуальному списку треков без пересоздания подписки на activeTrack
  const tracksQueueRef = useRef<Track[]>(tracksQueue);
  useEffect(() => {
    tracksQueueRef.current = tracksQueue;
  }, [tracksQueue]);

  // Ref таймера дебаунса (190 мс) для записи драфта ползунков в Firestore
  const draftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      setIsAuthenticated(Boolean(user));
      setAuthReady(true);

      if (user) {
        void ensureUserProfileInFirestore(user.uid, user.displayName);
        const userRef = doc(db, 'users', user.uid);
        unsubscribeProfile = onSnapshot(
          userRef,
          (snap) => {
            if (snap.exists()) {
              const data = snap.data() as User;
              setUserProfile({
                ...data,
                uid: snap.id,
                role: data.role || 'viewer',
                voteWeight:
                  typeof data.voteWeight === 'number'
                    ? data.voteWeight
                    : DEFAULT_ROLE_VOTE_WEIGHTS[data.role || 'viewer'] ?? 1.0,
              });
            } else {
              setUserProfile({
                uid: user.uid,
                displayName: user.displayName || 'ქართველი მსმენელი',
                role: 'viewer',
                xp: 0,
                voteWeight: 1.0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
          },
          () => {
            setUserProfile({
              uid: user.uid,
              displayName: user.displayName || 'ქართველი მსმენელი',
              role: 'viewer',
              xp: 0,
              voteWeight: 1.0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          }
        );
      } else {
        setUserProfile(null);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  // Cross-tab & Same-tab მყისიერი სინქრონიზაცია
  useEffect(() => {
    const applyPayload = (data: Partial<BroadcastPayload>) => {
      if (data.session) setSession(data.session);
      if (data.reviews) setReviews(data.reviews);
      if (data.critics) setTopCritics(data.critics);
      if (data.tracks) {
        setTracksQueue(data.tracks);
        const currentActiveId =
          data.session?.activeTrackId ?? session?.activeTrackId;
        if (currentActiveId) {
          const found = data.tracks.find((t) => t.id === currentActiveId);
          if (found) setActiveTrack(found);
        }
      }
    };

    const handleSyncEvent = (event: Event) => {
      const custom = event as CustomEvent<BroadcastPayload>;
      if (custom.detail) applyPayload(custom.detail);
    };

    window.addEventListener(SYNC_EVENT_NAME, handleSyncEvent);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        channel.onmessage = (msg) => {
          if (msg.data) applyPayload(msg.data as Partial<BroadcastPayload>);
        };
      } catch {
        // ignore
      }
    }

    return () => {
      window.removeEventListener(SYNC_EVENT_NAME, handleSyncEvent);
      if (channel) channel.close();
    };
  }, [session?.activeTrackId]);

  // 1. Firestore real-time `onSnapshot` მოსმენა `live_sessions/{sessionId}` დოკუმენტზე
  useEffect(() => {
    if (!sessionId) {
      setSessionLoading(false);
      return;
    }

    if (requireAuth && (!authReady || !isAuthenticated)) {
      setSessionLoading(!authReady);
      return;
    }

    setSessionLoading(true);
    setError(null);

    const sessionPath = `live_sessions/${sessionId}`;
    const sessionRef = doc(db, 'live_sessions', sessionId);

    const unsubscribeSession = onSnapshot(
      sessionRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Omit<LiveSession, 'id'>;
          const nextSession: LiveSession = {
            ...data,
            id: snapshot.id,
            activeTrackId: data.activeTrackId || null,
          };
          setSession(nextSession);
          setIsFirestoreSynced(true);
        }
        setSessionLoading(false);
      },
      (err) => {
        setSessionLoading(false);
        const normalizedError =
          err instanceof Error ? err : new Error(String(err));
        setError(normalizedError);
        try {
          handleFirestoreError(err, OperationType.GET, sessionPath);
        } catch (handledErr) {
          setError(
            handledErr instanceof Error
              ? handledErr
              : new Error(String(handledErr))
          );
        }
      }
    );

    return () => {
      unsubscribeSession();
    };
  }, [sessionId, requireAuth, authReady, isAuthenticated]);

  // 1b. Firestore `tracks` კოლექციის რეალურ დროში მოსმენა (ღიაა ყველა მომხმარებლისთვის, სტუმრებისა და OBS-ის ჩათვლით)
  useEffect(() => {
    const tracksQuery = query(
      collection(db, 'tracks'),
      where('status', 'in', [
        'in_queue',
        'on_air',
        'reviewed',
        'community_catalog',
      ])
    );

    const unsubscribeTracks = onSnapshot(
      tracksQuery,
      (snapshot) => {
        if (snapshot.empty) return;
        const firestoreTracks: Track[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data() as Omit<Track, 'id'>;
          const createdMs =
            typeof d.createdAt === 'number'
              ? d.createdAt
              : d.createdAt &&
                  typeof (d.createdAt as { toMillis?: () => number }).toMillis ===
                    'function'
                ? (d.createdAt as { toMillis: () => number }).toMillis()
                : Date.now();
          return {
            ...d,
            id: docSnap.id,
            artistId: d.artistId || getArtistIdFromName(d.artist || ''),
            createdAt: createdMs,
          };
        });

        setTracksQueue((prev) => {
          const map = new Map<string, Track>();
          prev.forEach((t) => map.set(t.id, t));
          firestoreTracks.forEach((ft) => map.set(ft.id, ft));
          return Array.from(map.values());
        });
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'tracks');
        } catch {
          // logged by handleFirestoreError
        }
      }
    );

    return () => unsubscribeTracks();
  }, []);

  // 2. Firestore real-time `onSnapshot` მოსმენა აქტიურ ტრეკზე (`tracks/{activeTrackId}`)
  const activeTrackId = session?.activeTrackId ?? null;

  useEffect(() => {
    if (!activeTrackId || activeTrackId.trim() === '') {
      setActiveTrack(null);
      setTrackLoading(false);
      return;
    }

    const localMatch = tracksQueueRef.current.find(
      (t) => t.id === activeTrackId
    );
    if (localMatch) {
      setActiveTrack(localMatch);
    }

    if (requireAuth && (!authReady || !isAuthenticated)) {
      setTrackLoading(false);
      return;
    }

    setTrackLoading(true);
    const trackPath = `tracks/${activeTrackId}`;
    const trackRef = doc(db, 'tracks', activeTrackId);

    const unsubscribeTrack = onSnapshot(
      trackRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as Omit<Track, 'id'>;
          const firestoreTrack: Track = {
            ...data,
            id: snapshot.id,
            artistId: data.artistId || getArtistIdFromName(data.artist || ''),
          };
          setActiveTrack(firestoreTrack);
          setTracksQueue((prev) => {
            const exists = prev.some((item) => item.id === firestoreTrack.id);
            if (!exists) return [firestoreTrack, ...prev];
            return prev.map((item) =>
              item.id === firestoreTrack.id ? firestoreTrack : item
            );
          });
        }
        setTrackLoading(false);
      },
      (err) => {
        setTrackLoading(false);
        const normalizedError =
          err instanceof Error ? err : new Error(String(err));
        setError(normalizedError);
        try {
          handleFirestoreError(err, OperationType.GET, trackPath);
        } catch (handledErr) {
          setError(
            handledErr instanceof Error
              ? handledErr
              : new Error(String(handledErr))
          );
        }
      }
    );

    return () => {
      unsubscribeTrack();
    };
  }, [activeTrackId, requireAuth, authReady, isAuthenticated]);

  const syncSessionToFirestore = useCallback(
    async (nextSession: LiveSession) => {
      if (!auth.currentUser) return;
      const sessionPath = `live_sessions/${sessionId}`;
      try {
        await setDoc(
          doc(db, 'live_sessions', sessionId),
          {
            id: sessionId,
            isLive: nextSession.isLive,
            streamStatus: nextSession.streamStatus,
            activeTrackId: nextSession.activeTrackId ?? '',
            hostId: auth.currentUser.uid,
            title: nextSession.title,
            votingOpen: nextSession.votingOpen,
            isPlaying: nextSession.isPlaying,
            playbackPosition: nextSession.playbackPosition,
            showObsOverlay: nextSession.showObsOverlay,
            obsTheme: nextSession.obsTheme,
            liveExpertDraft: nextSession.liveExpertDraft ?? null,
            viewersCount: nextSession.viewersCount ?? 1,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        setIsFirestoreSynced(true);
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, sessionPath);
        } catch {
          // logged by handleFirestoreError
        }
      }
    },
    [sessionId]
  );

  const syncTrackToFirestore = useCallback(
    async (track: Track, isCreate: boolean = false) => {
      if (!auth.currentUser) return;
      const trackPath = `tracks/${track.id}`;
      try {
        await ensureUserProfileInFirestore(
          auth.currentUser.uid,
          auth.currentUser.displayName
        );
        const trackRef = doc(db, 'tracks', track.id);
        let shouldSetCreatedAt = isCreate;
        let existingSubmittedBy: string | null = null;
        if (!isCreate) {
          const existingSnap = await getDoc(trackRef);
          if (!existingSnap.exists()) {
            shouldSetCreatedAt = true;
          } else {
            const existingData = existingSnap.data();
            if (typeof existingData?.submittedBy === 'string') {
              existingSubmittedBy = existingData.submittedBy;
            }
          }
        }

        const payload: Record<string, unknown> = {
          id: track.id,
          title: track.title.slice(0, 120),
          artist: track.artist.slice(0, 120),
          artistId: track.artistId || getArtistIdFromName(track.artist),
          coverUrl: (track.coverUrl || defaultCoverImg).slice(0, 500),
          audioUrl: (
            track.audioUrl || 'https://soundcheck.live/audio/stream.mp3'
          ).slice(0, 500),
          sourceUrl: (track.sourceUrl || 'https://open.spotify.com').slice(
            0,
            500
          ),
          genre: (track.genre || 'ქართული სცენა').slice(0, 60),
          duration: track.duration ?? 210,
          submittedBy: existingSubmittedBy ?? auth.currentUser.uid,
          submittedByName: (
            auth.currentUser.displayName ||
            track.submittedByName ||
            'მუსიკოსი'
          ).slice(0, 80),
          isPriority: Boolean(track.isPriority),
          status: track.status,
          expertScore: track.expertScore ?? null,
          expertTotalScore: track.expertTotalScore ?? null,
          communityScore: track.communityScore ?? null,
          communityTotalScore: track.communityTotalScore ?? null,
          communityVotesCount: track.communityVotesCount ?? 0,
          metaScore: track.metaScore ?? null,
          updatedAt: serverTimestamp(),
        };
        if (shouldSetCreatedAt) {
          payload.createdAt = serverTimestamp();
        }
        await setDoc(trackRef, payload, {
          merge: !shouldSetCreatedAt,
        });
      } catch (err) {
        try {
          handleFirestoreError(
            err,
            isCreate ? OperationType.CREATE : OperationType.UPDATE,
            trackPath
          );
        } catch {
          // logged by handleFirestoreError
        }
      }
    },
    []
  );

  const updateDraftScores = useCallback(
    async (draft: CriteriaScores) => {
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const nextSession: LiveSession = {
        ...currentSession,
        liveExpertDraft: draft,
        updatedAt: Date.now(),
      };
      // 1. Локальный стейт, BroadcastChannel и встроенное превью реагируют мгновенно (0 мс)
      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: tracksQueue,
        reviews,
        critics: topCritics,
      });

      // 2. Запись в Firestore обернута в debounce (190 мс)
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
      }
      draftDebounceRef.current = setTimeout(() => {
        draftDebounceRef.current = null;
        void syncSessionToFirestore(nextSession);
      }, 190);
    },
    [session, tracksQueue, reviews, topCritics, syncSessionToFirestore]
  );

  const updateStreamStatus = useCallback(
    async (status: LiveStreamStatus) => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const nextSession: LiveSession = {
        ...currentSession,
        streamStatus: status,
        isLive: status !== 'idle',
        votingOpen: status === 'listening',
        updatedAt: Date.now(),
      };
      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: tracksQueue,
        reviews,
        critics: topCritics,
      });
      await syncSessionToFirestore(nextSession);
    },
    [session, tracksQueue, reviews, topCritics, syncSessionToFirestore]
  );

  const lockInVerdict = useCallback(
    async (finalScores: CriteriaScores) => {
      if (draftDebounceRef.current) {
        clearTimeout(draftDebounceRef.current);
        draftDebounceRef.current = null;
      }
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const expertAvg = calculateAverageScore(finalScores);
      const currentTrack =
        activeTrack ??
        tracksQueue.find((t) => t.id === currentSession.activeTrackId) ??
        null;

      const communityScores = currentTrack?.communityScore ?? null;
      const computedMeta =
        calculateMetaScore(finalScores, communityScores) ??
        Math.round(expertAvg * 10);

      let updatedTracks = tracksQueue;
      let updatedActiveTrack: Track | null = currentTrack;

      if (currentTrack) {
        updatedActiveTrack = {
          ...currentTrack,
          status: 'reviewed',
          expertScore: finalScores,
          expertTotalScore: expertAvg,
          metaScore: computedMeta,
          updatedAt: Date.now(),
        };
        updatedTracks = tracksQueue.map((t) =>
          t.id === currentTrack.id ? updatedActiveTrack! : t
        );
        setActiveTrack(updatedActiveTrack);
        setTracksQueue(updatedTracks);
        void syncTrackToFirestore(updatedActiveTrack, false);
      }

      const nextSession: LiveSession = {
        ...currentSession,
        streamStatus: 'revealed',
        votingOpen: false,
        liveExpertDraft: finalScores,
        activeTrackSnapshot: updatedActiveTrack
          ? {
              id: updatedActiveTrack.id,
              title: updatedActiveTrack.title,
              artist: updatedActiveTrack.artist,
              coverUrl: updatedActiveTrack.coverUrl,
              genre: updatedActiveTrack.genre,
              expertScore: finalScores,
              expertTotalScore: expertAvg,
              communityTotalScore:
                updatedActiveTrack.communityTotalScore ?? 8.5,
              communityVotesCount:
                updatedActiveTrack.communityVotesCount ?? 120,
              metaScore: computedMeta,
            }
          : currentSession.activeTrackSnapshot,
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });
      await syncSessionToFirestore(nextSession);
    },
    [
      session,
      activeTrack,
      tracksQueue,
      reviews,
      topCritics,
      syncSessionToFirestore,
      syncTrackToFirestore,
    ]
  );

  /**
   * ახალი ტრეკის წარდგენა მომხმარებლის / მუსიკოსის მიერ
   * (`community_catalog` — პირდაპირ კატალოგში ან `in_queue` — სტრიმის რიგში)
   */
  const submitNewTrack = useCallback(
    async (input: SubmitNewTrackInput): Promise<Track> => {
      const cleanId = `track_${Date.now()}`;
      const cleanArtist = input.artist.trim().slice(0, 120);
      const cleanTitle = input.title.trim().slice(0, 120);
      const cleanGenre = (input.genre || 'ქართული სცენა').trim().slice(0, 60);
      const cleanSourceUrl = input.sourceUrl.trim().slice(0, 500);
      const cleanCoverUrl =
        (input.coverUrl ?? '').trim().slice(0, 500) || defaultCoverImg;

      const status: TrackStatus = input.destinationStatus;

      const newTrack: Track = {
        id: cleanId,
        title: cleanTitle,
        artist: cleanArtist,
        artistId: getArtistIdFromName(cleanArtist),
        coverUrl: cleanCoverUrl,
        audioUrl: cleanSourceUrl || 'https://soundcheck.live/audio/stream.mp3',
        sourceUrl: cleanSourceUrl,
        genre: cleanGenre,
        duration: 210,
        submittedBy: auth.currentUser?.uid ?? 'musician_user',
        submittedByName:
          auth.currentUser?.displayName ?? 'ქართველი მუსიკოსი',
        isPriority: false,
        status,
        expertScore: null,
        expertTotalScore: null,
        communityScore: null,
        communityTotalScore: null,
        communityVotesCount: 0,
        metaScore: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const updatedTracks = [newTrack, ...tracksQueue];
      setTracksQueue(updatedTracks);

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      broadcastStateUpdate({
        session: currentSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });

      await syncTrackToFirestore(newTrack, true);
      return newTrack;
    },
    [tracksQueue, session, reviews, topCritics, syncTrackToFirestore]
  );

  const addAndActivateTrack = useCallback(
    async (input: {
      title: string;
      artist: string;
      coverUrl: string;
      genre?: string;
      audioUrl?: string;
      sourceUrl?: string;
    }): Promise<Track> => {
      const cleanId = `track_${Date.now()}`;
      const defaultDraft: CriteriaScores = {
        lyrics: 8.0,
        flow: 8.0,
        production: 8.0,
        identity: 8.0,
        vibe: 8.0,
      };

      const cleanArtist = input.artist.trim().slice(0, 120);
      const cleanAudioUrl =
        (input.audioUrl || input.sourceUrl || '').trim().slice(0, 500) ||
        'https://soundcheck.live/audio/stream.mp3';
      const cleanSourceUrl = (input.sourceUrl || input.audioUrl || '')
        .trim()
        .slice(0, 500);
      const newTrack: Track = {
        id: cleanId,
        title: input.title.trim().slice(0, 120),
        artist: cleanArtist,
        artistId: getArtistIdFromName(cleanArtist),
        coverUrl: input.coverUrl.trim() || defaultCoverImg,
        audioUrl: cleanAudioUrl,
        sourceUrl: cleanSourceUrl || undefined,
        genre: (input.genre || 'ქართული სცენა').trim().slice(0, 60),
        duration: 205,
        submittedBy: auth.currentUser?.uid ?? 'streamer_host',
        submittedByName: auth.currentUser?.displayName ?? 'სტუდია',
        isPriority: true,
        status: 'on_air',
        expertScore: null,
        expertTotalScore: null,
        communityScore: {
          lyrics: 8.4,
          flow: 8.6,
          production: 8.8,
          identity: 8.5,
          vibe: 8.7,
        },
        communityTotalScore: 8.6,
        communityVotesCount: 18,
        metaScore: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const updatedTracks = [
        newTrack,
        ...tracksQueue.map((t) =>
          t.status === 'on_air'
            ? { ...t, status: (t.expertScore ? 'reviewed' : 'community_catalog') as TrackStatus }
            : t
        ),
      ];
      setTracksQueue(updatedTracks);
      setActiveTrack(newTrack);

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const nextSession: LiveSession = {
        ...currentSession,
        isLive: true,
        streamStatus: 'listening',
        votingOpen: true,
        activeTrackId: newTrack.id,
        liveExpertDraft: defaultDraft,
        activeTrackSnapshot: {
          id: newTrack.id,
          title: newTrack.title,
          artist: newTrack.artist,
          coverUrl: newTrack.coverUrl,
          genre: newTrack.genre,
          expertScore: null,
          expertTotalScore: null,
          communityTotalScore: newTrack.communityTotalScore ?? 8.6,
          communityVotesCount: newTrack.communityVotesCount,
          metaScore: null,
        },
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });
      await syncTrackToFirestore(newTrack, true);
      await syncSessionToFirestore(nextSession);
      return newTrack;
    },
    [
      session,
      tracksQueue,
      reviews,
      topCritics,
      syncSessionToFirestore,
      syncTrackToFirestore,
    ]
  );

  /**
   * ერთი კლიკით გადააქვს არჩეული ტრეკი მიმდინარე ლაივ-სესიის `activeTrackId`-ში
   * და მის სტატუსს ცვლის `'on_air'`-ზე ("ეთერში გაშვება").
   */
  const launchTrackOnAir = useCallback(
    async (trackId: string) => {
      const target = tracksQueue.find((t) => t.id === trackId);
      if (!target) return;

      const updatedTarget: Track = {
        ...target,
        status: 'on_air',
        updatedAt: Date.now(),
      };

      const updatedTracks: Track[] = tracksQueue.map((t) => {
        if (t.id === trackId) return updatedTarget;
        if (t.status === 'on_air') {
          return {
            ...t,
            status: t.expertScore ? 'reviewed' : 'community_catalog',
          };
        }
        return t;
      });

      setTracksQueue(updatedTracks);
      setActiveTrack(updatedTarget);

      const nextDraft: CriteriaScores =
        updatedTarget.expertScore ??
        session?.liveExpertDraft ??
        INITIAL_CRITERIA_SCORES;

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const nextSession: LiveSession = {
        ...currentSession,
        isLive: true,
        activeTrackId: updatedTarget.id,
        streamStatus: updatedTarget.expertScore ? 'revealed' : 'listening',
        votingOpen: !updatedTarget.expertScore,
        liveExpertDraft: nextDraft,
        activeTrackSnapshot: {
          id: updatedTarget.id,
          title: updatedTarget.title,
          artist: updatedTarget.artist,
          coverUrl: updatedTarget.coverUrl,
          genre: updatedTarget.genre,
          expertScore: updatedTarget.expertScore,
          expertTotalScore: updatedTarget.expertTotalScore ?? null,
          communityTotalScore: updatedTarget.communityTotalScore ?? 8.5,
          communityVotesCount: updatedTarget.communityVotesCount,
          metaScore: updatedTarget.metaScore,
        },
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });

      await syncTrackToFirestore(updatedTarget, false);
      await syncSessionToFirestore(nextSession);
    },
    [
      session,
      tracksQueue,
      reviews,
      topCritics,
      syncTrackToFirestore,
      syncSessionToFirestore,
    ]
  );

  const selectActiveTrack = useCallback(
    async (trackId: string) => {
      await launchTrackOnAir(trackId);
    },
    [launchTrackOnAir]
  );

  const updateCommunityPrediction = useCallback(
    async (communityAvg: number) => {
      const rounded = Math.round(communityAvg * 10) / 10;
      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const currentTrack = activeTrack;

      let updatedTracks = tracksQueue;
      if (currentTrack) {
        const updatedTrack: Track = {
          ...currentTrack,
          communityTotalScore: rounded,
          communityVotesCount: (currentTrack.communityVotesCount || 50) + 1,
          updatedAt: Date.now(),
        };
        setActiveTrack(updatedTrack);
        updatedTracks = tracksQueue.map((t) =>
          t.id === currentTrack.id ? updatedTrack : t
        );
        setTracksQueue(updatedTracks);
      }

      const nextSession: LiveSession = {
        ...currentSession,
        activeTrackSnapshot: currentSession.activeTrackSnapshot
          ? {
              ...currentSession.activeTrackSnapshot,
              communityTotalScore: rounded,
            }
          : null,
        updatedAt: Date.now(),
      };

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: updatedTracks,
        reviews,
        critics: topCritics,
      });
      await syncSessionToFirestore(nextSession);
    },
    [session, activeTrack, tracksQueue, reviews, topCritics, syncSessionToFirestore]
  );

  const submitTrackReview = useCallback(
    async (input: SubmitReviewInput): Promise<TrackReview> => {
      const targetTrack = tracksQueue.find((t) => t.id === input.trackId);
      if (!targetTrack) {
        throw new Error('ტრეკი ვერ მოიძებნა');
      }

      // ხმის წონა და როლი მკაცრად მოდის მხოლოდ ავტორიზებული მომხმარებლის პროფილიდან (userProfile)
      const role: UserRole = userProfile?.role ?? 'viewer';
      const voteWeight: number = userProfile?.voteWeight ?? 1.0;
      const reviewAvg = calculateAverageScore(input.scores);
      const reviewId = `rev_${Date.now()}`;
      const authorId = auth.currentUser?.uid ?? `user_${Date.now()}`;
      const cleanAuthorName =
        input.authorName.trim().slice(0, 80) ||
        userProfile?.displayName ||
        auth.currentUser?.displayName ||
        'მელომანი';

      const newReview: TrackReview = {
        id: reviewId,
        trackId: targetTrack.id,
        trackTitle: targetTrack.title,
        trackArtist: targetTrack.artist,
        trackCoverUrl: targetTrack.coverUrl,
        authorId,
        authorName: cleanAuthorName,
        authorRole: role,
        voteWeight,
        scores: input.scores,
        totalScore: reviewAvg,
        text: input.text.trim().slice(0, 3000),
        helpfulCount: 1,
        helpfulVoterIds: [authorId],
        createdAt: Date.now(),
      };

      const recalculated = computeUpdatedCommunityScores(
        targetTrack,
        input.scores,
        voteWeight
      );

      const updatedTrack: Track = {
        ...targetTrack,
        communityScore: recalculated.communityScore,
        communityTotalScore: recalculated.communityTotalScore,
        communityVotesCount: recalculated.communityVotesCount,
        metaScore: recalculated.metaScore,
        updatedAt: Date.now(),
      };

      const nextTracks = tracksQueue.map((t) =>
        t.id === updatedTrack.id ? updatedTrack : t
      );
      const nextReviews = [newReview, ...reviews];

      const existingCriticIdx = topCritics.findIndex(
        (c) =>
          c.uid === authorId ||
          c.displayName.toLowerCase() === cleanAuthorName.toLowerCase()
      );
      let nextCritics: TopCritic[];
      if (existingCriticIdx >= 0) {
        nextCritics = topCritics.map((c, idx) =>
          idx === existingCriticIdx
            ? {
                ...c,
                xp: c.xp + 120,
                reviewsCount: c.reviewsCount + 1,
                helpfulVotesReceived: c.helpfulVotesReceived + 1,
              }
            : c
        );
      } else {
        nextCritics = [
          ...topCritics,
          {
            uid: authorId,
            displayName: cleanAuthorName,
            role,
            voteWeight,
            xp: 250,
            reviewsCount: 1,
            helpfulVotesReceived: 1,
          },
        ];
      }
      nextCritics.sort(
        (a, b) =>
          b.helpfulVotesReceived * 10 + b.xp - (a.helpfulVotesReceived * 10 + a.xp)
      );

      setTracksQueue(nextTracks);
      setReviews(nextReviews);
      setTopCritics(nextCritics);
      if (activeTrack?.id === updatedTrack.id) {
        setActiveTrack(updatedTrack);
      }

      const currentSession = session ?? INITIAL_LIVE_SESSION;
      const nextSession: LiveSession =
        currentSession.activeTrackId === updatedTrack.id
          ? {
              ...currentSession,
              activeTrackSnapshot: {
                id: updatedTrack.id,
                title: updatedTrack.title,
                artist: updatedTrack.artist,
                coverUrl: updatedTrack.coverUrl,
                genre: updatedTrack.genre,
                expertScore: updatedTrack.expertScore,
                expertTotalScore: updatedTrack.expertTotalScore ?? null,
                communityTotalScore: updatedTrack.communityTotalScore ?? null,
                communityVotesCount: updatedTrack.communityVotesCount,
                metaScore: updatedTrack.metaScore,
              },
              updatedAt: Date.now(),
            }
          : currentSession;

      setSession(nextSession);
      broadcastStateUpdate({
        session: nextSession,
        tracks: nextTracks,
        reviews: nextReviews,
        critics: nextCritics,
      });

      if (auth.currentUser) {
        await ensureUserProfileInFirestore(
          auth.currentUser.uid,
          auth.currentUser.displayName
        );
        const trackPath = `tracks/${targetTrack.id}`;
        const trackRef = doc(db, 'tracks', targetTrack.id);
        try {
          const trackSnap = await getDoc(trackRef);
          if (!trackSnap.exists()) {
            await setDoc(trackRef, {
              id: targetTrack.id,
              title: targetTrack.title.slice(0, 120),
              artist: targetTrack.artist.slice(0, 120),
              artistId:
                targetTrack.artistId || getArtistIdFromName(targetTrack.artist),
              coverUrl: (targetTrack.coverUrl || defaultCoverImg).slice(0, 500),
              audioUrl: (
                targetTrack.audioUrl || 'https://soundcheck.live/audio/stream.mp3'
              ).slice(0, 500),
              sourceUrl: (
                targetTrack.sourceUrl || 'https://open.spotify.com'
              ).slice(0, 500),
              genre: (targetTrack.genre || 'ქართული სცენა').slice(0, 60),
              duration: targetTrack.duration ?? 210,
              submittedBy: auth.currentUser.uid,
              submittedByName: (
                auth.currentUser.displayName || 'ქართველი მუსიკოსი'
              ).slice(0, 80),
              isPriority: false,
              status: 'community_catalog',
              expertScore: null,
              expertTotalScore: null,
              communityScore: null,
              communityTotalScore: null,
              communityVotesCount: 0,
              metaScore: null,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          await updateDoc(trackRef, {
            communityScore: recalculated.communityScore,
            communityTotalScore: recalculated.communityTotalScore,
            communityVotesCount: recalculated.communityVotesCount,
            metaScore: recalculated.metaScore,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.UPDATE, trackPath);
          } catch {
            // logged by handleFirestoreError
          }
        }

        const reviewPath = `tracks/${targetTrack.id}/reviews/${reviewId}`;
        try {
          await setDoc(
            doc(collection(db, 'tracks', targetTrack.id, 'reviews'), reviewId),
            {
              id: reviewId,
              trackId: targetTrack.id,
              authorId: auth.currentUser.uid,
              authorName: cleanAuthorName,
              authorRole: role,
              voteWeight,
              scores: input.scores,
              totalScore: reviewAvg,
              text: newReview.text,
              helpfulCount: 1,
              createdAt: serverTimestamp(),
            }
          );
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.CREATE, reviewPath);
          } catch {
            // logged by handleFirestoreError
          }
        }
      }

      return newReview;
    },
    [tracksQueue, reviews, topCritics, activeTrack?.id, session, userProfile]
  );

  const toggleReviewHelpful = useCallback(
    async (reviewId: string, explicitTrackId?: string) => {
      const voterId = auth.currentUser?.uid ?? 'local_visitor';
      let targetAuthorId: string | null = null;
      let targetTrackId: string | null = explicitTrackId ?? null;
      let delta = 1;

      const nextReviews = reviews.map((rev) => {
        if (rev.id !== reviewId) return rev;
        targetAuthorId = rev.authorId;
        targetTrackId = rev.trackId;
        const voters = rev.helpfulVoterIds ?? [];
        const alreadyVoted = voters.includes(voterId);
        delta = alreadyVoted ? -1 : 1;
        return {
          ...rev,
          helpfulCount: Math.max(0, rev.helpfulCount + delta),
          helpfulVoterIds: alreadyVoted
            ? voters.filter((id) => id !== voterId)
            : [...voters, voterId],
        };
      });

      let nextCritics = topCritics;
      if (targetAuthorId && delta !== 0) {
        nextCritics = topCritics
          .map((c) =>
            c.uid === targetAuthorId
              ? {
                  ...c,
                  helpfulVotesReceived: Math.max(
                    0,
                    c.helpfulVotesReceived + delta
                  ),
                  xp: Math.max(0, c.xp + delta * 15),
                }
              : c
          )
          .sort(
            (a, b) =>
              b.helpfulVotesReceived * 10 +
              b.xp -
              (a.helpfulVotesReceived * 10 + a.xp)
          );
      }

      setReviews(nextReviews);
      setTopCritics(nextCritics);
      broadcastStateUpdate({
        session: session ?? INITIAL_LIVE_SESSION,
        tracks: tracksQueue,
        reviews: nextReviews,
        critics: nextCritics,
      });

      if (auth.currentUser && targetTrackId && delta === 1) {
        const reviewPath = `tracks/${targetTrackId}/reviews/${reviewId}`;
        try {
          await updateDoc(
            doc(db, 'tracks', targetTrackId, 'reviews', reviewId),
            {
              helpfulCount: increment(1),
            }
          );
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.UPDATE, reviewPath);
          } catch {
            // logged by handleFirestoreError
          }
        }
      }
    },
    [reviews, topCritics, session, tracksQueue]
  );

  // ტრეკები სტატუსით 'in_queue', დალაგებული დამატების დროის მიხედვით (ზრდადობით: პირველი დამატებული პირველია რიგში)
  const inQueueTracks = useMemo(() => {
    return tracksQueue
      .filter((t) => t.status === 'in_queue')
      .sort((a, b) => {
        const timeA = typeof a.createdAt === 'number' ? a.createdAt : 0;
        const timeB = typeof b.createdAt === 'number' ? b.createdAt : 0;
        return timeA - timeB;
      });
  }, [tracksQueue]);

  // ყველა არტისტის დინამიკური სია (საბაზისო პროფილები + ახალდამატებული ტრეკების არტისტები)
  const artists = useMemo(() => {
    const map = new Map<string, ArtistProfile>();
    INITIAL_ARTISTS.forEach((a) => map.set(a.id, a));

    tracksQueue.forEach((t) => {
      const id = t.artistId || getArtistIdFromName(t.artist);
      if (!map.has(id)) {
        map.set(id, {
          id,
          name: t.artist,
          bio: `${t.artist} — დამოუკიდებელი მუსიკალური პროექტი SoundCheck Live-ის პლატფორმაზე. ჟანრი: ${t.genre || 'ქართული სცენა'}.`,
          avatarUrl: t.coverUrl || defaultCoverImg,
          genres: t.genre ? [t.genre] : ['ქართული სცენა'],
          city: 'თბილისი',
          socialLinks: {
            spotify: t.sourceUrl || 'https://open.spotify.com',
            youtube: 'https://youtube.com',
          },
        });
      }
    });

    return Array.from(map.values());
  }, [tracksQueue]);

  return {
    session,
    activeTrack,
    tracksQueue,
    inQueueTracks,
    artists,
    reviews,
    topCritics,
    userProfile,
    loading: sessionLoading || trackLoading,
    sessionLoading,
    trackLoading,
    error,
    isLive: Boolean(session?.isLive && session?.streamStatus !== 'idle'),
    votingOpen: Boolean(session?.votingOpen),
    isFirestoreSynced,
    updateDraftScores,
    updateStreamStatus,
    lockInVerdict,
    addAndActivateTrack,
    submitNewTrack,
    launchTrackOnAir,
    selectActiveTrack,
    updateCommunityPrediction,
    submitTrackReview,
    toggleReviewHelpful,
  };
}

export default useLiveSession;
