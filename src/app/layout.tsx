import React from 'react';
import { Noto_Sans_Georgian } from 'next/font/google';
import { i18n } from '../lib/i18n';

const notoSansGeorgian = Noto_Sans_Georgian({
  subsets: ['georgian'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto-georgian',
  display: 'swap',
});

export const metadata = {
  title: `${i18n.brand.name} — ${i18n.brand.subtitle}`,
  description: i18n.brand.subtitle,
};

export interface RootLayoutProps {
  children: React.ReactNode;
  transparent?: boolean;
}

export default function RootLayout({
  children,
  transparent = false,
}: RootLayoutProps) {
  return (
    <div
      lang="ka"
      style={notoSansGeorgian.style}
      className={`${notoSansGeorgian.className} ${notoSansGeorgian.variable} min-h-screen antialiased selection:bg-amber-500/20 selection:text-amber-300 ${
        transparent
          ? 'bg-transparent text-zinc-100'
          : 'bg-[#0B0F17] text-zinc-100'
      }`}
    >
      {children}
    </div>
  );
}
