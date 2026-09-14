import googleG from './assets/google-g.png';

/** Official gradient G asset: https://developers.google.com/identity/branding-guidelines */
export function GoogleLoginButton({ pending, disabled, onClick }: { pending: boolean; disabled: boolean; onClick: () => void }) {
  return <button className="google-login-button" type="button" disabled={disabled || pending} onClick={onClick}>
    {/* The official logo is served locally, with its original colors and proportions. */}
    <img src={googleG.src} width="20" height="20" alt="" aria-hidden="true" />
    <span>{pending ? 'Google로 이동 중…' : 'Google로 계속하기'}</span>
  </button>;
}
