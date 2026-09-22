import type { Metadata, Viewport } from 'next';
import { Gaegu, IBM_Plex_Mono, Jua } from 'next/font/google';
import localFont from 'next/font/local';
import 'katex/dist/katex.min.css';
import './globals.css';

/* Three faces, three jobs — the screens stop reading as one undifferentiated block of UI text.
 *
 * Pretendard carries the reading. It is self-hosted as a single variable woff2 so the Capacitor
 * build keeps it offline; the old stack named "DM Sans" without ever loading it, so every Korean
 * sentence — which is nearly all of them — silently fell through to the system face anyway.
 *
 * Gaegu is the hand: the wordmark, the small labels above a heading, the notes that speak to the
 * learner rather than describing the screen. preload is off because a Korean face ships as ~90
 * subset files; left on, every page pre-fetches all of them, and the light one wins the race and
 * flashes the body text in handwriting before Pretendard lands.
 *
 * Jua is the wordmark and nothing else: a rounded Korean gothic, which is what 그냥수학 is drawn in.
 * It comes at one weight and is used for four characters, so preload is off for the same reason
 * Gaegu's is — left on, a Korean face pre-fetches its whole set of subset files on every page.
 *
 * Plex Mono is for figures only — minutes, counts, step numbers. It carries latin, so the Korean
 * that sits beside a number ("10분") falls to Pretendard by way of the fallback chain below rather
 * than to whatever generic monospace the platform keeps.
 */
const pretendard = localFont({ src: './fonts/PretendardVariable.woff2', variable: '--font-sans', display: 'swap', weight: '45 920' });
const gaegu = Gaegu({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-hand', display: 'swap', preload: false });
const jua = Jua({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap', preload: false });
const plexMono = IBM_Plex_Mono({ weight: ['400', '500', '600'], subsets: ['latin'], variable: '--font-mono', display: 'swap' });

/* Where a shared link points. The og and twitter images next to this file are served as absolute
 * URLs, and Next has nothing to build them from unless the origin is named here — without it a
 * build prints a warning and the card falls back to localhost, which renders as no card at all in
 * every chat app. APP_ORIGIN is the same variable the auth callback is registered under. */
const origin = process.env.APP_ORIGIN ?? 'https://geunyang-math.team-campfire.dev';

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: '그냥수학 · 다시 시작하는 수학',
  description: '기초부터 차근차근, 내 속도로 다시 배우는 수학. 짧은 수업과 꾸준한 연습으로 나만의 배움을 이어가세요.',
  applicationName: '그냥수학',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f7f4ec' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className={`${pretendard.variable} ${gaegu.variable} ${jua.variable} ${plexMono.variable}`}><body>{children}</body></html>;
}
