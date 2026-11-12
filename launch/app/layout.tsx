import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteNav } from '@/components/SiteNav';
import './globals.css';

// Same two families as authentyc.ai.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-space-grotesk' });

const description =
  'Write one prompt. Four small AI models build from it. Your score leans on the one that did worst. A coding challenge by Authentyc.';

export const metadata: Metadata = {
  metadataBase: new URL('https://leetvibecode.authentyc.ai'),
  title: { default: 'LeetVibeCode by Authentyc', template: '%s | LeetVibeCode by Authentyc' },
  description,
  openGraph: { title: 'LeetVibeCode by Authentyc', description, siteName: 'LeetVibeCode', type: 'website' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-dark-800 focus:px-4 focus:py-2"
        >
          Skip to main content
        </a>
        <SiteNav />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
