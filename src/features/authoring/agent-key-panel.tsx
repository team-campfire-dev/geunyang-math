'use client';

import { useEffect, useState } from 'react';
import { agentInstructions, agentKeyDays, type AgentKeyAction, type AgentKeyDays, type AgentKeyView, type AgentKeysView } from '@/shared/agent';
import { Icon } from '@/features/learning/icons';
import { apiOrigin } from '@/features/api-client';
import { agentKeysApi } from './api-client';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.');
const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
const used = (key: AgentKeyView) => (key.lastUsedAt
  ? `${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(key.lastUsedAt))}에 마지막으로 씀`
  : '아직 쓰지 않음');

/**
 * Codes this account gives an AI so it can write lessons as this account. A code is shown once, the
 * moment it is made, together with the words to paste into the conversation; after that only its first
 * characters are kept, so a lost code is revoked and made again rather than looked up.
 */
export function AgentKeyPanel({ userId }: { userId: string }) {
  const [view, setView] = useState<AgentKeysView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState<AgentKeyDays>(7);
  const [publish, setPublish] = useState(false);
  const [issued, setIssued] = useState<{ key: AgentKeyView; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    agentKeysApi.view().then((response) => { if (live) setView(response.view); }, (reason) => { if (live) setError(messageOf(reason)); });
    return () => { live = false; };
  }, []);

  const act = async (action: AgentKeyAction) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await agentKeysApi.act(action, userId);
      setView(response.view);
      if (response.issued) { setIssued(response.issued); setCopied(false); setName(''); setPublish(false); }
      // A code just revoked is no use to paste anywhere, so it is not left on screen.
      if (action.action === 'key.revoke' && issued?.key.id === action.keyId) setIssued(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };

  if (!view) return <section className="dashboard-section">{error ? <p className="error-banner" role="alert">{error}</p> : <p className="editor-note">불러오는 중이에요.</p>}</section>;
  const instructions = issued ? agentInstructions(apiOrigin || window.location.origin, issued.code) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(instructions); setCopied(true); }
    catch { setError('복사하지 못했어요. 글을 직접 골라 복사해 주세요.'); }
  };

  return <section className="dashboard-section agent-keys">
    <div className="section-heading"><div><h2>AI 연결</h2>
      <p className="editor-note">AI에게 코드를 건네면 그 AI가 내 계정으로 수업 초안을 고칠 수 있어요. 코드는 내가 가진 권한보다 더 할 수 없고, 거두면 바로 막혀요.</p></div></div>
    {error && <p className="error-banner" role="alert">{error}</p>}

    {issued && <fieldset className="editor-panel agent-issued">
      <legend>새 코드 · {issued.key.name}</legend>
      <p className="editor-note"><strong>이 코드는 지금 한 번만 보여요.</strong> 아래 글을 복사해 AI와의 대화에 붙여 넣으세요. 잃어버리면 거두고 새로 만들면 돼요.</p>
      <textarea className="agent-instructions" readOnly value={instructions} rows={9} aria-label="AI에게 건넬 안내와 코드"
        onFocus={(event) => event.currentTarget.select()} />
      <div className="editor-actions">
        <button type="button" className="button primary" onClick={() => void copy()}><Icon name="copy" size={15} />{copied ? '복사했어요' : '안내와 코드 복사'}</button>
        <button type="button" className="text-button" onClick={() => setIssued(null)}>닫기</button>
      </div>
    </fieldset>}

    <fieldset className="editor-panel">
      <legend>건넨 코드</legend>
      {view.keys.length ? <div className="role-list">{view.keys.map((key) => <div key={key.id} className="role-row">
        <span className="role-who">
          <strong>{key.name}<em>{key.hint}…</em></strong>
          <small>{key.mayPublish ? '발행까지' : '초안과 검토 요청까지'} · {day(key.expiresAt)}까지 · {used(key)}</small>
        </span>
        <button type="button" className="text-button" disabled={busy} onClick={() => void act({ action: 'key.revoke', keyId: key.id })}>
          <Icon name="close" size={14} />거두기</button>
      </div>)}</div>
        : <p className="empty-inline">아직 건넨 코드가 없어요.</p>}
    </fieldset>

    <fieldset className="editor-panel">
      <legend>코드 만들기</legend>
      <p className="editor-note">발행하지 않는 코드는 초안을 쓰고 검토를 요청하는 데까지만 해요. 발행은 내가 검토한 뒤 편집 화면에서 해요.</p>
      <div className="editor-actions">
        <label className="editor-field"><span className="editor-label">이름</span>
          <input value={name} maxLength={80} placeholder="예: Claude 중2 수업 다듬기" onChange={(event) => setName(event.target.value)} /></label>
        <label className="editor-field"><span className="editor-label">쓸 수 있는 기간</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value) as AgentKeyDays)}>
            {agentKeyDays.map((value) => <option key={value} value={value}>{value}일</option>)}
          </select></label>
      </div>
      {view.mayPublish && <label className="editor-field editor-check">
        <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} />
        <span className="editor-label">발행도 맡기기</span><small>초안 발행과 뜻풀이 저장처럼 학습자에게 바로 보이는 일까지 해요.</small>
      </label>}
      <div className="editor-actions">
        <button type="button" className="button secondary" disabled={busy || !name.trim()}
          onClick={() => void act({ action: 'key.issue', name: name.trim(), days, mayPublish: publish })}><Icon name="plus" size={15} />코드 만들기</button>
      </div>
    </fieldset>
  </section>;
}
