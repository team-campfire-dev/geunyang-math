import type { Metadata, Viewport } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'geunyang math · 그냥, 다시 시작하는 수학',
  description: '기초부터 차근차근, 내 속도로 다시 배우는 수학. 짧은 수업과 꾸준한 연습으로 나만의 배움을 이어가세요.',
  applicationName: 'geunyang math',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f8f7f3' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
