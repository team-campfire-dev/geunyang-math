import type { CSSProperties } from 'react';

export type IconName = 'home' | 'book' | 'pencil' | 'chart' | 'arrow' | 'back' | 'check' | 'clock' | 'spark' | 'close' | 'chevron' | 'logout' | 'lightbulb' | 'plus' | 'play' | 'pause' | 'copy' | 'settings';
const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
  book: <><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1v15" /><path d="M5 8h3M16 8h3M5 12h3M16 12h3" /></>,
  pencil: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L5 15Z" /><path d="m5 15 4 4" /></>,
  chart: <><path d="M4 3v17h17M9 15V9M14 15V5M19 15v-4" /></>,
  arrow: <><path d="M4 12h15m-6-6 6 6-6 6" /></>,
  back: <><path d="M20 12H5m6-6-6 6 6 6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  logout: <><path d="M9 3H4v18h5M13 7l5 5-5 5M8 12h12" /></>,
  lightbulb: <><path d="M8 17c0-3-3-4-3-8a7 7 0 1 1 14 0c0 4-3 5-3 8ZM9 21h6M9 17h6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="M8 5.5v13l11-6.5Z" />,
  pause: <path d="M9 5v14M15 5v14" />,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M15.5 9V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5H9" /></>,
  settings: <><path d="M4 7h9M19 7h1M4 17h5M15 17h5" /><circle cx="16" cy="7" r="2.4" /><circle cx="12" cy="17" r="2.4" /></>,
};
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
