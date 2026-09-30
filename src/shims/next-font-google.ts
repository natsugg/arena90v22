export interface NextFontOptions {
  subsets?: string[];
  weight?: string | string[];
  variable?: string;
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional';
}

export interface NextFontResult {
  className: string;
  variable: string;
  style: {
    fontFamily: string;
    fontWeight?: number | string;
    fontStyle?: string;
  };
}

/**
 * Next.js `next/font/google` compatible loader for Noto Sans Georgian.
 */
export function Noto_Sans_Georgian(options?: NextFontOptions): NextFontResult {
  const variableName = options?.variable ?? '--font-noto-georgian';
  return {
    className: 'font-georgian',
    variable: variableName,
    style: {
      fontFamily:
        '"Noto Sans Georgian", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
  };
}
