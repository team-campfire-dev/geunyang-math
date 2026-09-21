import { describe, expect, it } from 'vitest';
import { barsMatching, chartBuildIssue, chartComplete, chartTicks, heightOf, setBar,
  type ChartBuild } from '@/shared/chart-build';

/**
 * The rules a chart the learner draws has to keep. The one worth holding hardest is that every
 * value lands on a tick: a chart whose bars move a tick at a time and whose data sits between two
 * of them draws correctly, looks correct, and can never be finished.
 */
const chart: ChartBuild = {
  caption: '지점별 접수 건수', note: '단위: 건', axisMax: 40, axisStep: 10,
  bars: [{ label: 'A지점', value: 30 }, { label: 'B지점', value: 10 }, { label: 'C지점', value: 40 }],
  prompt: '표의 값을 막대그래프로 옮겨 그려 보세요.',
};

describe('a chart the learner draws', () => {
  it('counts the ticks the axis is read against', () => {
    expect(chartTicks(40, 10)).toEqual([0, 10, 20, 30, 40]);
  });

  it('refuses a value that lands between two ticks, which is a task nobody can finish', () => {
    expect(chartBuildIssue({ ...chart, bars: [{ label: 'A', value: 25 }, { label: 'B', value: 10 }] }))
      .toMatch(/눈금에 걸리지 않아요/);
    expect(chartBuildIssue(chart)).toBeNull();
  });

  it('refuses an axis that cannot be drawn or read', () => {
    expect(chartBuildIssue({ ...chart, axisMax: 45 })).toMatch(/나누어떨어져야/);
    expect(chartBuildIssue({ ...chart, axisMax: 10, axisStep: 10 })).toMatch(/눈금이 너무 적어요/);
    expect(chartBuildIssue({ ...chart, axisMax: 1000, axisStep: 1 })).toMatch(/세기 어려워요/);
    expect(chartBuildIssue({ ...chart, bars: [{ label: 'A', value: 50 }, { label: 'B', value: 10 }] }))
      .toMatch(/꼭대기보다 커요/);
  });

  it('refuses two bars with the same name, since neither could be named to a reader', () => {
    expect(chartBuildIssue({ ...chart, bars: [{ label: 'A', value: 10 }, { label: 'A', value: 20 }] }))
      .toMatch(/이름이 같은 막대/);
  });

  it('snaps a bar to the nearest tick and keeps it on the axis', () => {
    expect(setBar({}, chart, 'A지점', 26)['A지점']).toBe(30);
    expect(setBar({}, chart, 'A지점', 24)['A지점']).toBe(20);
    expect(setBar({}, chart, 'A지점', -8)['A지점']).toBe(0);
    expect(setBar({}, chart, 'A지점', 900)['A지점']).toBe(40);
  });

  it('starts every bar on the floor and finishes only when all of them match', () => {
    let drawing = {};
    expect(heightOf(drawing, 'A지점')).toBe(0);
    expect(barsMatching(chart, drawing)).toBe(0);
    drawing = setBar(drawing, chart, 'A지점', 30);
    drawing = setBar(drawing, chart, 'B지점', 10);
    expect(barsMatching(chart, drawing)).toBe(2);
    expect(chartComplete(chart, drawing)).toBe(false);
    drawing = setBar(drawing, chart, 'C지점', 40);
    expect(chartComplete(chart, drawing)).toBe(true);
  });
});
