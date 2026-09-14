import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceFooter } from '@/features/learning/service-footer';

export const metadata: Metadata = {
  title: '개인정보 안내 · geunyang math',
  description: 'geunyang math에서 사용하는 계정 정보와 학습 기록, 로그인 쿠키, 데이터 보관 및 삭제 요청 방법을 안내합니다.',
};

export default function PrivacyPage() {
  return <div className="privacy-page">
    <header className="privacy-header"><Link href="/" aria-label="geunyang math 홈">geunyang <span>math</span></Link><Link href="/">학습 공간으로 돌아가기 <span aria-hidden="true">↗</span></Link></header>
    <main id="main-content" className="privacy-content">
      <div className="privacy-heading"><div className="eyebrow">YOUR LEARNING, YOUR INFORMATION</div><h1>개인정보 안내</h1><p>나의 배움을 이어가기 위해 어떤 정보를 사용하는지,<br className="privacy-desktop-break" /> 보관한 정보를 어떻게 삭제할 수 있는지 알려드려요.</p><span className="privacy-date">안내 기준일 · 2026년 9월 14일</span></div>
      <article className="privacy-sheet">
        <section><span className="privacy-number">01</span><h2>계정 연결과 학습 기록</h2>
          <p>Google 로그인으로 같은 학습 공간을 다시 찾을 수 있도록 Google 계정의 고유 식별자(<code>sub</code>)와 표시 이름을 데이터베이스에 저장합니다. 로그인할 때 Google이 제공한 이메일 확인 상태(<code>email_verified</code>)를 검증합니다.</p>
          <p>이메일 주소와 프로필 사진, Google의 액세스 토큰·갱신 토큰·ID 토큰은 영구 저장하지 않습니다.</p>
          <p>클래스 학습과 복습을 이어가기 위해 다음 정보를 계정과 연결해 저장합니다.</p>
          <ul><li>학습 목표와 하루 학습 시간</li><li>시작한 클래스와 단계별 진도, 완료 기록</li><li>문제에 입력한 답안과 풀이 결과, 힌트 사용 기록</li><li>배정된 과제와 제출 기록</li><li>시작점 진단의 답안·건너뛰기·결과와 진행 상태</li><li>직접 고른 추천 수업과 추천이 달라진 이유·학습 상태 기록</li></ul>
        </section>
        <section><span className="privacy-number">02</span><h2>로그인을 유지하는 정보</h2>
          <p>서비스 세션 쿠키는 로그인 상태를 유지하며 유효기간은 7일입니다. Google 로그인 도중 사용하는 임시 쿠키의 유효기간은 10분입니다. 두 쿠키 모두 페이지의 자바스크립트에서 읽을 수 없는 <code>HttpOnly</code> 방식으로 설정합니다.</p>
          <p>로그인 후 보고 있던 클래스로 돌아가기 위해 현재 탭의 <code>sessionStorage</code>에 클래스 식별자와 생성 시각을 저장할 수 있습니다. 30분이 지난 복귀 정보는 사용하지 않고 다음 확인 때 정리합니다. 이 공간에는 인증 토큰을 저장하지 않습니다.</p>
        </section>
        <section><span className="privacy-number">03</span><h2>서비스 연결과 접속 정보</h2>
          <p>서비스와 데이터베이스는 Oracle Cloud 인프라에서 운영하며, 웹 접속 요청은 Cloudflare 프록시를 거쳐 처리합니다. 웹에 접속할 때 요청 경로와 접속 정보 등 기본 서버 로그가 생성될 수 있으며, 서비스 운영과 오류 확인에 사용합니다.</p>
          <p>Google 로그인 과정에서는 브라우저와 서버가 Google의 인증 서비스에 연결합니다. 로그인 버튼의 Google Sans 글꼴을 표시하기 위해 브라우저가 <code>fonts.gstatic.com</code>에 요청할 수 있으며, 이때 IP 주소 등 일반적인 웹 요청 정보가 Google에 전달됩니다.</p>
        </section>
        <section><span className="privacy-number">04</span><h2>보관과 삭제 요청</h2>
          <p>다음에 로그인했을 때 학습을 이어갈 수 있도록 계정과 학습 데이터는 삭제 요청 전까지 보관합니다. 로그아웃은 현재 기기의 로그인 상태를 종료하는 기능이며, 계정이나 학습 기록을 삭제하지 않습니다.</p>
          <p>현재 서비스 안에서 자동으로 계정을 탈퇴하는 기능은 없습니다. 계정과 학습 데이터 삭제를 원하시면 <a href="mailto:zeratulspc@gmail.com?subject=geunyang%20math%20%EA%B3%84%EC%A0%95%20%EC%82%AD%EC%A0%9C%20%EC%9A%94%EC%B2%AD">zeratulspc@gmail.com</a>으로 요청해 주세요. 삭제할 계정을 확인하기 위해 필요한 내용을 별도로 안내합니다. 비밀번호나 인증 코드는 보내지 마세요.</p>
        </section>
        <section><span className="privacy-number">05</span><h2>궁금한 점이 있다면</h2>
          <p>개인정보와 학습 기록에 관한 문의는 <a href="mailto:zeratulspc@gmail.com">zeratulspc@gmail.com</a>으로 보내 주세요. 이 페이지는 현재 서비스에서 실제로 사용하는 정보와 처리 방식을 안내합니다.</p>
        </section>
      </article>
      <Link className="privacy-return" href="/">← 나의 학습 공간으로</Link>
    </main>
    <ServiceFooter />
  </div>;
}
