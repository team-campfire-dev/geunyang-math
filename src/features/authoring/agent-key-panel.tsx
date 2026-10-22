'use client';

import { useEffect, useState } from 'react';
import { agentInstructions, agentKeyDays, connectorUrl, type AgentKeyAction, type AgentKeyDays, type AgentKeyView, type AgentKeysView } from '@/shared/agent';
import { Icon } from '@/features/learning/icons';
import { apiOrigin } from '@/features/api-client';
import { agentKeysApi } from './api-client';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.');
const day = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
const used = (key: AgentKeyView) => (key.lastUsedAt
  ? `${new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(key.lastUsedAt))}에 마지막으로 씀`
  : '아직 쓰지 않음');

/**
 * Codes this account gives an AI so it can write lessons as this account. A chat app is given the
 * connector address and asks for the code on our own connect page; a tool that sends requests itself
 * is given the code with the API's address. A code is shown once, the moment it is made; after that
 * only its first characters are kept, so a lost code is revoked and made again rather than looked up.
 */
export function AgentKeyPanel({ userId }: { userId: string }) {
  const [view, setView] = useState<AgentKeysView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [days, setDays] = useState<AgentKeyDays>(7);
  const [publish, setPublish] = useState(false);
  const [issued, setIssued] = useState<{ key: AgentKeyView; code: string } | null>(null);
  const [copied, setCopied] = useState('');

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
      if (response.issued) { setIssued(response.issued); setCopied(''); setName(''); setPublish(false); }
      // A code just revoked is no use to paste anywhere, so it is not left on screen.
      if (action.action === 'key.revoke' && issued?.key.id === action.keyId) setIssued(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };

  if (!view) return <section className="dashboard-section">{error ? <p className="error-banner" role="alert">{error}</p> : <p className="editor-note">불러오는 중이에요.</p>}</section>;
  const origin = apiOrigin || window.location.origin;
  const connector = connectorUrl(origin);
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); }
    catch { setError('복사하지 못했어요. 글을 직접 골라 복사해 주세요.'); }
  };
  const copyLabel = (what: string, label: string) => (copied === what ? '복사했어요' : label);

  return <section className="dashboard-section agent-keys">
    <div className="section-heading"><div><h2>AI 연결</h2>
      <p className="editor-note">Claude·ChatGPT·Gemini 채팅 창에서 이 서비스를 연결하면, 그 AI가 내 계정으로 수업 초안을 만들고 고칠 수 있어요. 연결할 때 여기서 만든 코드를 넣어요. 코드는 내가 가진 권한보다 더 할 수 없고, 거두면 그 코드로 맺은 연결이 모두 바로 끊겨요.</p></div></div>
    {error && <p className="error-banner" role="alert">{error}</p>}

    <fieldset className="editor-panel">
      <legend>채팅 앱에 연결하는 법</legend>
      <div className="editor-actions">
        <code className="agent-connector">{connector}</code>
        <button type="button" className="button secondary" onClick={() => void copy('url', connector)}><Icon name="copy" size={15} />{copyLabel('url', '주소 복사')}</button>
      </div>
      <ol className="agent-steps">
        <li><strong>Claude</strong> — 설정 → 커넥터 → 「커스텀 커넥터 추가」에 이 주소를 넣어요.</li>
        <li><strong>ChatGPT</strong> — 설정의 앱(커넥터)에서 MCP 서버를 추가하고, 인증은 OAuth로 둬요.</li>
        <li><strong>Gemini</strong> — 웹 앱에서 MCP 서버 주소로 「커스텀 앱」을 추가해요. Google이 지금은 미국의 개인 계정에만 열어 두었어요.</li>
      </ol>
      <p className="editor-note">추가하면 그냥수학의 연결 화면이 열려요. 거기에 아래에서 만든 코드를 넣으면 연결돼요. 연결된 뒤에는 채팅에서 「중2 일차방정식 수업의 설명을 더 쉽게 고쳐 줘」처럼 말하면 돼요.</p>
    </fieldset>

    {issued && <fieldset className="editor-panel agent-issued">
      <legend>새 코드 · {issued.key.name}</legend>
      <p className="editor-note"><strong>이 코드는 지금 한 번만 보여요.</strong> 채팅 앱의 연결 화면에 넣으세요. 잃어버리면 거두고 새로 만들면 돼요.</p>
      <input className="agent-code" readOnly value={issued.code} aria-label="새 코드" onFocus={(event) => event.currentTarget.select()} />
      <div className="editor-actions">
        <button type="button" className="button primary" onClick={() => void copy('code', issued.code)}><Icon name="copy" size={15} />{copyLabel('code', '코드 복사')}</button>
        <button type="button" className="button secondary" onClick={() => void copy('api', agentInstructions(origin, issued.code))}>{copyLabel('api', 'API 안내와 함께 복사')}</button>
        <button type="button" className="text-button" onClick={() => setIssued(null)}>닫기</button>
      </div>
      <p className="editor-note">「API 안내와 함께 복사」는 Claude Code처럼 요청을 직접 보내는 도구에 붙여 넣는 글이에요.</p>
    </fieldset>}

    <fieldset className="editor-panel">
      <legend>건넨 코드</legend>
      {view.keys.length ? <div className="role-list">{view.keys.map((key) => <div key={key.id} className="role-row">
        <span className="role-who">
          <strong>{key.name}<em>{key.hint}…</em></strong>
          <small>{key.mayPublish ? '발행까지' : '초안과 검토 요청까지'} · {day(key.expiresAt)}까지 · {used(key)}</small>
          <small>{key.connections.length ? `연결된 앱: ${key.connections.map((connection) => connection.name).join(', ')}` : '연결된 앱 없음'}</small>
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
