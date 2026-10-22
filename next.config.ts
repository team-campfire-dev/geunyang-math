import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  // The page where a code is typed to connect a chat app is never shown inside another site, and
  // never tells another site where the author came from: its address carries the app's request.
  // `same-origin`, not `no-referrer`: with no referrer at all a browser sends `Origin: null` on the
  // page's own form, and the answer to it is refused as coming from somewhere else.
  async headers() {
    return [{ source: '/oauth/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
};
export default config;
