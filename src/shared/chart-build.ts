// A chart the learner draws, described as data the way a table and a drawing are. The publishing
// validator, the learner's renderer and the editor's form all read these rules, so a chart that
// saves is a chart that can be drawn and finished.
//
// Why this block exists: NCS 수리능력 has four areas and 도표작성 is one of them, but it was the one
// area we could only ask *about* — 「이 자료에 어떤 그래프가 맞나」 is a choice question, and choosing
// a graph is not drawing one. Drawing is where the learner finds out that an axis has to reach the
// largest value, that a bar's height is read against the ticks and not against the bar beside it,
// and that a value between two ticks still has one place it belongs. None of that survives being
// turned into four options.
//
// What it does not do: it does not ask the learner to pick the kind of chart, to name the axes or
// to write the title. Those are decisions with reasons behind them, and a reason is argued in prose
// and checked with a choice. This block is the mechanical half — the data is on the table in front
// of them and they put it on the grid — which is the half that cannot be learned by reading.

export const chartBuildLimits = {
  minBars: 2, maxBars: 8, maxLabel: 20, maxCaption: 200, maxNote: 200, maxPrompt: 300,
  /** An axis is read by counting ticks, and past this many nobody counts them. */
  minTicks: 2, maxTicks: 40,
  maxValue: 1_000_000,
} as const;

/** One column of the chart: what it is, and how tall it should end up. */
export type ChartBar = { label: string; value: number };
export type ChartBuild = {
  /** The source data's name, and the accessible name of the table it is shown in, so it is plain text. */
  caption: string;
  /** One line under the data for what the numbers are in — 「단위: 만 원」. */
  note?: string;
  bars: ChartBar[];
  /** The top of the vertical axis and the gap between ticks. Every value has to land on a tick. */
  axisMax: number;
  axisStep: number;
  /** What the learner is asked to do, and what is said when the chart matches the data. */
  prompt: string;
  promptAlt?: string;
  successText?: string;
};

/** Every tick on the vertical axis, from the bottom up. The count is what makes an axis readable. */
export const chartTicks = (axisMax: number, axisStep: number): number[] =>
  Array.from({ length: Math.floor(axisMax / axisStep) + 1 }, (_, index) => index * axisStep);

/**
 * Why a chart cannot be saved, in the words the author needs. A chart whose values do not land on
 * ticks is the one worth refusing loudly: it draws, it looks right, and it can never be finished.
 */
export function chartBuildIssue(chart: ChartBuild): string | null {
  if (!chart.caption.trim()) return '자료의 제목을 적어 주세요. 화면 낭독에서 이 자료의 이름이 돼요.';
  if (!chart.prompt.trim()) return '무엇을 하라는 것인지 한 줄로 적어 주세요.';
  if (chart.axisStep <= 0) return '눈금 간격은 $0$보다 커야 해요.';
  if (chart.axisMax <= 0) return '세로축의 꼭대기는 $0$보다 커야 해요.';
  if (chart.axisMax % chart.axisStep !== 0) return '세로축의 꼭대기가 눈금 간격으로 나누어떨어져야 해요.';
  const ticks = chart.axisMax / chart.axisStep;
  if (ticks < chartBuildLimits.minTicks) return '눈금이 너무 적어요. 간격을 줄이거나 꼭대기를 올려 주세요.';
  if (ticks > chartBuildLimits.maxTicks) return `눈금이 ${ticks}칸이라 세기 어려워요. 간격을 넓혀 주세요.`;
  if (chart.bars.length < chartBuildLimits.minBars) return '막대를 둘 이상 두어야 견줄 것이 생겨요.';
  if (chart.bars.some((bar) => !bar.label.trim())) return '이름이 빈 막대가 있어요.';
  const labels = chart.bars.map((bar) => bar.label.trim());
  if (new Set(labels).size !== labels.length) return '이름이 같은 막대가 둘 있어요. 어느 쪽인지 가릴 수 없어요.';
  for (const bar of chart.bars) {
    if (bar.value < 0) return `「${bar.label}」의 값이 음수예요. 아래로는 그릴 수 없어요.`;
    if (bar.value > chart.axisMax) return `「${bar.label}」의 값이 세로축 꼭대기보다 커요. 꼭대기를 올려 주세요.`;
    // The learner moves a bar one tick at a time, so a value between ticks is one they cannot reach.
    if (bar.value % chart.axisStep !== 0) return `「${bar.label}」의 값이 눈금에 걸리지 않아요. 눈금 간격의 배수여야 학습자가 맞출 수 있어요.`;
  }
  return null;
}

/** Where a bar is now, by its label. A bar nobody has moved is at the bottom. */
export type ChartDrawing = Record<string, number>;
export const heightOf = (drawing: ChartDrawing, label: string): number => drawing[label] ?? 0;

/** One bar moved, rounded to a tick and kept on the axis — the only way the learner changes a chart. */
export function setBar(drawing: ChartDrawing, chart: ChartBuild, label: string, value: number): ChartDrawing {
  const snapped = Math.round(value / chart.axisStep) * chart.axisStep;
  return { ...drawing, [label]: Math.min(chart.axisMax, Math.max(0, snapped)) };
}

/** How many bars already match the data. The data is on the table beside the grid, so saying this
 *  is not giving an answer away — it is telling the learner which column to look at again. */
export const barsMatching = (chart: ChartBuild, drawing: ChartDrawing): number =>
  chart.bars.filter((bar) => heightOf(drawing, bar.label) === bar.value).length;

export const chartComplete = (chart: ChartBuild, drawing: ChartDrawing): boolean =>
  barsMatching(chart, drawing) === chart.bars.length;
