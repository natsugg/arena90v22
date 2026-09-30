export interface YouTubeMetadata {
  title: string;
  artist: string;
  coverUrl: string;
  videoId: string;
  audioUrl: string;
}

/**
 * YouTube-ის ვიდეოს ID-ის ამოღება ფორმატებიდან:
 * - youtube.com/watch?v=...
 * - youtu.be/...
 * - youtube.com/shorts/...
 * - youtube.com/embed/...
 */
export function extractYouTubeId(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const pattern =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,15})/;
  const match = trimmed.match(pattern);
  if (match && match[1]) {
    return match[1];
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^(?:www\.|m\.)/, '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      if (id && /^[a-zA-Z0-9_-]{6,15}$/.test(id)) {
        return id;
      }
    }
    if (host === 'youtube.com' || host === 'music.youtube.com') {
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{6,15}$/.test(vParam)) {
        return vParam;
      }
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (
        (segments[0] === 'shorts' ||
          segments[0] === 'embed' ||
          segments[0] === 'v') &&
        segments[1] &&
        /^[a-zA-Z0-9_-]{6,15}$/.test(segments[1])
      ) {
        return segments[1];
      }
    }
  } catch {
    // არავალიდური URL
  }

  return null;
}

/**
 * აბრუნებს YouTube ვიდეოს გარეკანის (hqdefault.jpg) ბმულს.
 */
export function getYouTubeThumbnail(videoId: string): string {
  return 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg';
}

/**
 * ასუფთავებს ვიდეოს სათაურს კლიკბეიტისა და ტექნიკური მინაწერებისგან:
 * [Official Video], (Official Audio), (Music Video), (Visualizer), (Prod. by ...) და ზედმეტი ფრჩხილები.
 */
export function cleanYouTubeTitle(rawTitle: string): string {
  return rawTitle
    .replace(
      /[\(\[\{]\s*(?:official\s*)?(?:music\s*)?(?:video|audio|visualizer|lyric\s*video|lyrics|clip|hd|4k|hq|live|premiere)\s*[\)\]\}]/gi,
      ''
    )
    .replace(
      /[\(\[\{]\s*(?:prod\.?\s*(?:by)?|produced\s+by)\s*[^\)\]\}]*[\)\]\}]/gi,
      ''
    )
    .replace(/[\(\[\{]\s*[\)\]\}]/g, '')
    .replace(/\s+[–—]\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * YouTube oEmbed მეტამონაცემების წამოღება და ავტომატური დამუშავება.
 */
export async function fetchYouTubeMetadata(
  url: string
): Promise<YouTubeMetadata | null> {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;

  const cleanUrl = url.trim();
  const coverUrl = getYouTubeThumbnail(videoId);

  try {
    let oembedData: { title?: string; author_name?: string } | null = null;

    const noembedRes = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(cleanUrl)}`
    );
    if (noembedRes.ok) {
      const json = (await noembedRes.json()) as {
        title?: string;
        author_name?: string;
        error?: string;
      };
      if (json && json.title && !json.error) {
        oembedData = json;
      }
    }

    if (!oembedData) {
      const fallbackRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${videoId}`
        )}&format=json`
      );
      if (fallbackRes.ok) {
        oembedData = (await fallbackRes.json()) as {
          title?: string;
          author_name?: string;
        };
      }
    }

    if (!oembedData || !oembedData.title) {
      return null;
    }

    const cleanedTitle = cleanYouTubeTitle(oembedData.title);
    const cleanedAuthor = (oembedData.author_name || '')
      .replace(/\s*-\s*Topic$/i, '')
      .trim();

    let artist = '';
    let title = '';

    if (cleanedTitle.includes(' - ')) {
      const [leftPart, ...rightParts] = cleanedTitle.split(' - ');
      artist = leftPart.trim();
      title = rightParts.join(' - ').trim();
    } else {
      artist = cleanedAuthor;
      title = cleanedTitle;
    }

    return {
      title: title || cleanedTitle,
      artist: artist || cleanedAuthor,
      coverUrl,
      videoId,
      audioUrl: cleanUrl,
    };
  } catch {
    return null;
  }
}
