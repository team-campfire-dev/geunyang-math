'use client';

import { useEffect, useState } from 'react';
import { usageFeatureLabels, type AiUsageView, type UsageTotals } from '@/shared/ai-usage';
import { aiUsageApi } from './api-client';

const messageOf = (reason: unknown) => (reason instanceof Error ? reason.message : '불러오지 못했어요. 다시 시도해 주세요.');
/** Dollars to the cent, or to a tenth of a cent where the sum is under a dollar and cents would read as nothing. */
const usd = (micros: number) => {
  const value = micros / 1_000_000;
  return `$${value < 1 && value > 0 ? value.toFixed(3) : value.toFixed(2)}`;
};
const count = (value: number) => value.toLocaleString('ko-KR');
const tokens = (value: number) => (value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value));
const when = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
/** How much of what was read came from the cache — what a repeated instruction should mostly be. */
const cacheShare = (totals: UsageTotals) => {
  const read = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return read ? Math.round((totals.cacheReadTokens / read) * 100) : 0;
};

/**
 * What the models cost, for the operator: the last thirty days by day, by feature and model, and by
 * account, beside the limits that stop it. Every number is what the API reported for each call,
 * priced as the call was made; nothing here is estimated after the fact.
 */
export function AiUsagePanel() {
  const [view, setView] = useState<AiUsageView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    aiUsageApi.view().then((response) => { if (live) setView(response.usage); }, (reason) => { if (live) setError(messageOf(reason)); });
    return () => { live = false; };
  }, []);

  if (!view) return <section className="dashboard-section">{error ? <p className="error-banner" role="alert">{error}</p> : <p className="editor-note">불러오는 중이에요.</p>}</section>;
  const share = Math.min(100, view.limits.serviceDay ? Math.round((view.serviceDay / view.limits.serviceDay) * 100) : 0);
  const spentDays = view.days.filter((item) => item.calls > 0);

  return <section className="dashboard-section ai-usage">
    <div className="section-heading"><div><h2>AI 사용량</h2>
      <p className="editor-note">학습자와 작성자가 일으킨 모델 호출을 호출마다 기록한 것이에요. 비용은 그 호출의 토큰을 그때의 가격(미국 달러)으로 셈한 값이에요. 최근 30일을 보여 줘요.</p></div></div>

    <div className="usage-stats">
      <div className="usage-stat"><span>최근 24시간 · 서비스 전체</span><strong>{usd(view.serviceDay)}</strong>
        <div className="usage-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label="서비스 하루 한도 중 쓴 비율"><i style={{ width: `${share}%` }} /></div>
        <small>하루 한도 {usd(view.limits.serviceDay)}의 {share}%</small></div>
      <div className="usage-stat"><span>30일 합계</span><strong>{usd(view.total.costMicros)}</strong><small>호출 {count(view.total.calls)}번</small></div>
      <div className="usage-stat"><span>캐시에서 읽은 입력</span><strong>{cacheShare(view.total)}%</strong>
        <small>입력 {tokens(view.total.inputTokens)} · 캐시 읽기 {tokens(view.total.cacheReadTokens)} · 캐시 쓰기 {tokens(view.total.cacheWriteTokens)} · 출력 {tokens(view.total.outputTokens)}</small></div>
    </div>

    <fieldset className="editor-panel">
      <legend>한도</legend>
      <p className="editor-note">한 계정은 24시간에 {usd(view.limits.accountDay)}, 30일에 {usd(view.limits.accountMonth)}까지, 서비스 전체는 24시간에 {usd(view.limits.serviceDay)}까지 써요. 넘으면 새 생성을 시작하지 않고 학습자와 작성자에게 그렇게 말해요(이미 돌고 있는 생성은 끝까지 해요). 서버 환경 변수 <code>AI_ACCOUNT_DAILY_USD</code>, <code>AI_ACCOUNT_MONTHLY_USD</code>, <code>AI_SERVICE_DAILY_USD</code>로 바꿔요.</p>
    </fieldset>

    <fieldset className="editor-panel">
      <legend>기능별</legend>
      {view.features.length ? <div className="usage-table-wrap"><table className="usage-table">
        <thead><tr><th>기능</th><th>실행</th><th>호출</th><th>비용</th><th>실행당</th></tr></thead>
        <tbody>{view.features.map((item) => <tr key={item.feature}><td>{usageFeatureLabels[item.feature] ?? item.feature}</td><td>{count(item.runs)}</td>
          <td>{count(item.calls)}</td><td>{usd(item.costMicros)}</td><td>{usd(item.runs ? Math.round(item.costMicros / item.runs) : 0)}</td></tr>)}</tbody>
      </table></div> : <p className="editor-note">최근 30일에는 모델 호출이 없었어요.</p>}
    </fieldset>

    {view.accounts.length > 0 && <fieldset className="editor-panel">
      <legend>계정별</legend>
      <div className="usage-table-wrap"><table className="usage-table">
        <thead><tr><th>계정</th><th>24시간</th><th>30일</th><th>실행</th><th>마지막</th></tr></thead>
        <tbody>{view.accounts.map((account) => {
          const near = account.last24h >= view.limits.accountDay * 0.8 || account.last30d >= view.limits.accountMonth * 0.8;
          return <tr key={account.userId ?? 'deleted'} className={near ? 'is-near' : undefined}><td>{account.displayName}</td>
            <td>{usd(account.last24h)}</td><td>{usd(account.last30d)}</td><td>{count(account.runs)}</td><td>{when(account.lastAt)}</td></tr>;
        })}</tbody>
      </table></div>
      <p className="editor-note">한도의 80%를 넘은 계정은 굵게 보여요.</p>
    </fieldset>}

    {spentDays.length > 0 && <fieldset className="editor-panel">
      <legend>날짜별 (한국 시간)</legend>
      <div className="usage-table-wrap"><table className="usage-table">
        <thead><tr><th>날짜</th><th>비용</th><th>호출</th>{view.features.map((item) => <th key={item.feature}>{usageFeatureLabels[item.feature] ?? item.feature}</th>)}</tr></thead>
        <tbody>{spentDays.map((item) => <tr key={item.day}><td>{item.day}</td><td>{usd(item.costMicros)}</td><td>{count(item.calls)}</td>
          {view.features.map((feature) => <td key={feature.feature}>{usd(item.byFeature[feature.feature] ?? 0)}</td>)}</tr>)}</tbody>
      </table></div>
    </fieldset>}

    {view.models.length > 0 && <fieldset className="editor-panel">
      <legend>모델별</legend>
      <div className="usage-table-wrap"><table className="usage-table">
        <thead><tr><th>답한 모델</th><th>호출</th><th>비용</th><th>캐시 읽기</th></tr></thead>
        <tbody>{view.models.map((item) => <tr key={item.model}><td><code>{item.model}</code></td><td>{count(item.calls)}</td><td>{usd(item.costMicros)}</td><td>{cacheShare(item)}%</td></tr>)}</tbody>
      </table></div>
    </fieldset>}
  </section>;
}
