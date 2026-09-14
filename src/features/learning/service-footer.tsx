import Link from 'next/link';

export function ServiceFooter() {
  return <footer className="service-footer">
    <span>geunyang math</span>
    <nav aria-label="서비스 안내"><Link href="/privacy/">개인정보 안내</Link><a href="mailto:zeratulspc@gmail.com">문의</a></nav>
  </footer>;
}
