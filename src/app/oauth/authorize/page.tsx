import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDatabase } from '@/server/db';
import { readAuthorization, serviceOrigin } from '@/server/agent-oauth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'AI 연결 · 그냥수학', robots: { index: false, follow: false } };

/**
 * Where a chat app sends the author when it asks to connect. The author types the code they made in
 * 「AI 연결」 and says yes or no. The page names the app and the address it will be answered at,
 * because an app's name is whatever it registered under, and the address is the part it cannot fake.
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams(Object.entries(raw).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])));
  const failed = params.get('failed') === '1';
  params.delete('failed');
  const read = await readAuthorization(getDatabase(), params, serviceOrigin());
  if ('redirect' in read) redirect(read.redirect);

  return <div className="privacy-page">
    <header className="privacy-header"><Link href="/" aria-label="그냥수학 홈"><span className="brand-word">그냥<span>수학</span></span></Link></header>
    <main id="main-content" className="connect-content">
      {'show' in read
        ? <section className="connect-card"><h1>연결할 수 없어요</h1><p>{read.show}</p></section>
        : <form className="connect-card" method="post" action="/api/oauth/authorize">
          <h1>AI 연결</h1>
          <p><strong>{read.ok.client.name}</strong>이(가) 내 계정으로 그냥수학의 수업 초안을 읽고 고치려고 해요.</p>
          <p className="connect-where">연결하면 <code>{new URL(read.ok.redirectUri).host}</code>(으)로 돌아가요.</p>
          {[...params].map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
          <label className="connect-field"><span>편집 화면 「AI 연결」에서 만든 코드</span>
            <input name="agent_code" type="password" autoComplete="off" spellCheck={false} placeholder="gmk_…" required autoFocus /></label>
          {failed && <p className="connect-error" role="alert">코드가 맞지 않거나 기간이 지났어요. 「AI 연결」에서 코드를 확인해 주세요.</p>}
          <p className="connect-note">코드의 권한 그대로 연결돼요. 발행을 맡기지 않은 코드라면 초안을 쓰고 검토를 요청하는 데까지만 해요. 코드를 거두면 이 연결도 끊겨요.</p>
          <div className="connect-actions">
            <button type="submit" name="decision" value="allow" className="button primary">연결하기</button>
            <button type="submit" name="decision" value="deny" formNoValidate className="text-button">거절</button>
          </div>
        </form>}
    </main>
  </div>;
}
