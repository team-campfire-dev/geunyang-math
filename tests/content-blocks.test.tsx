// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from './render';
import { ContentBlocks, RichText, SceneTaskFigure, unsupportedRequiredBlocks } from '@/features/learning/content-blocks';
import type { ContentBlock, GlossaryEntry } from '@/shared/api';
import type { SceneItem, SceneZone } from '@/shared/scene';

const block = (kind: string, typeVersion: number, payload: Record<string, unknown>, extra: Partial<ContentBlock> = {}): ContentBlock =>
  ({ blockId: `${kind}:${typeVersion}`, kind, typeVersion, required: true, payload, ...extra });
const entry = (conceptKey: string, label: string, summary: string): GlossaryEntry =>
  ({ conceptKey, scopeKind: 'global', scopeKey: '', label, summary, usageNote: '분수를 읽을 때 쓰는 말이에요.', blocks: [], lessonKey: null });
const scene = (payload: Record<string, unknown>) =>
  block('core.scene', 1, { alt: '조각을 나란히 놓은 그림', width: 320, height: 200, items: [{ kind: 'strip', x: 10, y: 10, width: 300, height: 60, parts: 4, filled: 3 }], ...payload });

describe('prose on the learning screen', () => {
  it('renders a formula as math and leaves everything else as text', () => {
    const { container } = render(<RichText text={'앞 $\\frac{1}{2}$ 뒤 <b>진하게</b>'} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    // Only the math renderer makes markup: what an author wrote stays a text node.
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>진하게</b>');
  });

  it('marks the concepts the server revealed and leaves a withheld one as plain text', () => {
    render(<ContentBlocks
      blocks={[block('core.rich_text', 3, {
        text: '분모가 같으면 분자만 더해요.',
        definitions: [{ conceptKey: 'term.denominator', surface: '분모' }, { conceptKey: 'term.numerator', surface: '분자' }],
      })]}
      glossary={{ entries: [entry('term.denominator', '분모', '한 덩이를 몇으로 나눴는지예요.')] }} />);
    expect(screen.getByRole('button', { name: '분모' })).toBeDefined();
    expect(screen.queryByRole('button', { name: '분자' })).toBeNull();
    expect(screen.getByText(/분자만 더해요/)).toBeDefined();
  });

  it('opens a definition where it was read and closes it again', () => {
    render(<ContentBlocks
      blocks={[block('core.rich_text', 3, { text: '분모가 같으면 더하기 쉬워요.', definitions: [{ conceptKey: 'term.denominator', surface: '분모' }] })]}
      glossary={{ entries: [entry('term.denominator', '분모', '한 덩이를 몇으로 나눴는지예요.')] }} />);
    const mark = screen.getByRole('button', { name: '분모' });
    expect(mark.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(mark);
    expect(mark.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('한 덩이를 몇으로 나눴는지예요.')).toBeDefined();
    fireEvent.keyDown(mark, { key: 'Escape' });
    expect(screen.queryByText('한 덩이를 몇으로 나눴는지예요.')).toBeNull();
  });
});

describe('a block this version cannot draw', () => {
  const unknownRequired = block('core.video', 1, { src: 'lesson.mp4' });
  const unknownOptional = block('core.video', 1, { src: 'lesson.mp4' }, { blockId: 'optional', required: false, fallback: '조각을 나누는 장면이에요.' });

  it('stops the step when the block was required', () => {
    render(<ContentBlocks blocks={[unknownRequired]} />);
    expect(screen.getByRole('alert').textContent).toContain('이 단계를 완료할 수 없어요');
    expect(unsupportedRequiredBlocks([unknownRequired])).toBe(true);
  });

  it('reads the author\'s replacement when the block was optional', () => {
    render(<ContentBlocks blocks={[unknownOptional]} />);
    expect(screen.getByText('조각을 나누는 장면이에요.')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(unsupportedRequiredBlocks([unknownOptional])).toBe(false);
  });
});

describe('a drawing', () => {
  it('is drawn at the size it was given, so the editor and the lesson agree', () => {
    const { container } = render(<ContentBlocks blocks={[scene({})]} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 320 200');
    expect(svg.style.maxWidth).toBe('320px');
    expect(screen.getByRole('img', { name: '조각을 나란히 놓은 그림' })).toBeDefined();
  });

  it('carries the still picture\'s name through the whole movement', () => {
    render(<ContentBlocks blocks={[scene({ frames: [{ caption: '먼저', changes: [] }, { caption: '다음', changes: [] }] })]} />);
    expect(screen.getByText('장면 1 / 2')).toBeDefined();
    expect(screen.getByRole('button', { name: '이전 장면' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '다음 장면' }));
    expect(screen.getByText('장면 2 / 2')).toBeDefined();
    expect(screen.getByText('다음')).toBeDefined();
  });

  it('lets a frame show a shape the drawing starts with hidden', () => {
    // Writing a shape at opacity 0 and turning it on in a later frame is how a scene reveals a step.
    // The shape's own opacity and the frame's multiply in SVG, so the frame has to replace it.
    const items: SceneItem[] = [{ kind: 'rect', id: 'later', x: 10, y: 10, width: 40, height: 20, fill: 'green', opacity: 0 }];
    const { container } = render(<ContentBlocks blocks={[scene({ items,
      frames: [{ caption: '아직', changes: [] }, { caption: '이제', changes: [{ id: 'later', opacity: 1 }] }] })]} />);
    expect(container.querySelector('rect')!.getAttribute('opacity')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '다음 장면' }));
    const shown = container.querySelector('rect')!;
    expect(shown.getAttribute('opacity'), '장면이 켠 도형이 여전히 보이지 않는다').toBeNull();
    expect((shown.parentElement as HTMLElement).style.opacity).toBe('1');
  });

  it('keeps the space before a formula inside a drawing\'s label', () => {
    const items: SceneItem[] = [{ kind: 'text', x: 10, y: 20, text: '양쪽에서 똑같이 $3$을 덜어요' }];
    const { container } = render(<ContentBlocks blocks={[scene({ items })]} />);
    const label = container.querySelector('foreignObject > div')!;
    // The prose and the formula are one flex item together, or the flex box eats the space between.
    expect(label.children).toHaveLength(1);
    expect(label.firstElementChild!.innerHTML).toContain('똑같이 ');
  });

  it('keeps a bar drawn by a retired block readable', () => {
    render(<ContentBlocks blocks={[block('core.figure', 1, {
      alt: '4등분 중 3개를 칠한 막대', primitive: { kind: 'fraction_strip', parts: 4, filled: 3, label: '$\\frac{3}{4}$' },
    })]} />);
    // role="img" hides what is inside, so the name has to be plain even when the caption is a formula.
    expect(screen.getAllByRole('img', { name: '4등분 중 3개를 칠한 막대' }).length).toBeGreaterThan(0);
  });

  it('names a bar whose caption is a formula by its written-out name', () => {
    render(<ContentBlocks blocks={[block('math.fraction_strip', 1, { parts: 2, filled: 1, label: '$\\frac{1}{2}$', labelAlt: '2등분 중 1개' })]} />);
    const figure = screen.getByRole('figure', { name: '2등분 중 1개' });
    expect(within(figure).getByText((_, node) => node?.className === 'katex')).toBeDefined();
  });
});

describe('a table of numbers', () => {
  const table = (payload: Record<string, unknown>) => block('core.table', 1, {
    caption: '지점별 매출', note: '단위: 만 원', rowHeader: true,
    columns: [{ label: '지점' }, { label: '2023년', align: 'end' }, { label: '2024년', align: 'end' }],
    rows: [{ cells: ['A지점', '3,200', '3,600'] }, { cells: ['B지점', '2,800', '2,700'] }],
    ...payload,
  });

  it('names every value with its row and its column, which is what prose cannot do', () => {
    render(<ContentBlocks blocks={[table({})]} />);
    // The caption is the table's accessible name, so the whole thing can be found by it.
    const drawn = screen.getByRole('table', { name: /지점별 매출/ });
    // A column header is a column header and a row name is a row name, not bold text.
    expect(within(drawn).getByRole('columnheader', { name: '2024년' })).toBeDefined();
    expect(within(drawn).getByRole('rowheader', { name: 'A지점' })).toBeDefined();
    expect(within(drawn).getAllByRole('row')).toHaveLength(3);
    expect(within(drawn).getByText('3,600')).toBeDefined();
    expect(screen.getByText('단위: 만 원')).toBeDefined();
  });

  it('lines up the digits of a column that holds numbers', () => {
    const { container } = render(<ContentBlocks blocks={[table({})]} />);
    // The first column names the rows and reads as words; the other two are read down as numbers.
    expect([...container.querySelectorAll('tbody tr:first-child td')].map((cell) => cell.className))
      .toEqual(['is-end', 'is-end']);
  });

  it('draws math in a cell the way prose draws it', () => {
    const { container } = render(<ContentBlocks blocks={[table({
      rowHeader: false,
      columns: [{ label: '식' }, { label: '값', align: 'end' }],
      rows: [{ cells: ['$\\frac{1}{2}$', '0.5'] }],
    })]} />);
    expect(container.querySelector('tbody .katex')).not.toBeNull();
  });

  it('is not drawn at all when a row does not line up with the columns', () => {
    // A hole in a table of numbers reads as a value, and there is no value there.
    const crooked = table({ rows: [{ cells: ['A지점', '3,200'] }] });
    render(<ContentBlocks blocks={[crooked]} />);
    expect(screen.getByRole('alert').textContent).toContain('이 단계를 완료할 수 없어요');
    expect(unsupportedRequiredBlocks([crooked])).toBe(true);
  });

  it('can be scrolled sideways by somebody who is not using a pointer', () => {
    const { container } = render(<ContentBlocks blocks={[table({})]} />);
    const box = container.querySelector('.data-table')!;
    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('aria-label')).toBe('지점별 매출');
  });
});

describe('a chart the learner draws', () => {
  const chart = (payload: Record<string, unknown> = {}) => block('core.chart_build', 1, {
    caption: '지점별 접수 건수', note: '단위: 건', axisMax: 40, axisStep: 10,
    prompt: '표의 값을 막대그래프로 옮겨 그려 보세요.',
    successText: '자료와 똑같아졌어요.',
    bars: [{ label: 'A지점', value: 30 }, { label: 'B지점', value: 10 }],
    ...payload,
  });

  it('shows the data beside the grid, since the learner is transcribing and not guessing', () => {
    render(<ContentBlocks blocks={[chart()]} />);
    expect(screen.getByRole('group', { name: '지점별 접수 건수' })).toBeDefined();
    expect(screen.getByText('표의 값을 막대그래프로 옮겨 그려 보세요.')).toBeDefined();
    expect(screen.getByText('막대 2개 중 0개가 자료와 같아요.')).toBeDefined();
  });

  it('finishes from the keyboard alone, with nothing dragged', () => {
    render(<ContentBlocks blocks={[chart()]} />);
    const first = screen.getByRole('slider', { name: 'A지점' });
    expect(first.getAttribute('aria-valuenow')).toBe('0');
    expect(first.getAttribute('aria-valuemax')).toBe('40');
    for (let press = 0; press < 3; press += 1) fireEvent.keyDown(first, { key: 'ArrowUp' });
    expect(first.getAttribute('aria-valuenow')).toBe('30');
    expect(screen.getByText('막대 2개 중 1개가 자료와 같아요.')).toBeDefined();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'B지점' }), { key: 'ArrowUp' });
    expect(screen.getByText('자료와 똑같아졌어요.')).toBeDefined();
  });

  it('keeps a bar on the axis however long a key is held', () => {
    render(<ContentBlocks blocks={[chart()]} />);
    const bar = screen.getByRole('slider', { name: 'A지점' });
    fireEvent.keyDown(bar, { key: 'ArrowDown' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(bar, { key: 'End' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    fireEvent.keyDown(bar, { key: 'ArrowUp' });
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
    fireEvent.keyDown(bar, { key: 'Home' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });

  it('puts every bar back on the floor', () => {
    render(<ContentBlocks blocks={[chart()]} />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'A지점' }), { key: 'End' });
    fireEvent.click(screen.getByRole('button', { name: '처음으로' }));
    expect(screen.getByRole('slider', { name: 'A지점' }).getAttribute('aria-valuenow')).toBe('0');
  });

  it('draws nothing at all when a value could never be reached', () => {
    // The bars move a tick at a time, so 25 on a 10-tick axis is a task with no ending. Drawing it
    // anyway would leave the learner trying; refusing it is what sends the author back to fix it.
    const { container } = render(<ContentBlocks blocks={[chart({ bars: [{ label: 'A', value: 25 }, { label: 'B', value: 10 }] })]} />);
    expect(container.querySelector('.chart-build')).toBeNull();
    expect(container.querySelector('.unsupported-block')).not.toBeNull();
  });
});

describe('a drawing the learner arranges', () => {
  const items: SceneItem[] = [{ kind: 'rect', id: 'piece', label: '조각', draggable: true, x: 10, y: 120, width: 40, height: 40 }];
  const zones: SceneZone[] = [{ id: 'slot', x: 200, y: 20, width: 60, height: 60, label: '빈 자리' }];

  it('finishes from the keyboard alone, with nothing dragged', () => {
    render(<SceneTaskFigure width={320} height={200} items={items} zones={zones}
      task={{ prompt: '조각을 빈 자리에 놓아 보세요.', successText: '자리를 다 채웠어요.' }} alt="조각을 옮기는 그림" />);
    expect(screen.getByText('1곳 중 0곳을 채웠어요.')).toBeDefined();
    const piece = screen.getByRole('button', { name: '조각' });
    fireEvent.keyDown(piece, { key: 'Enter' });
    expect(piece.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('조각을 들고 있어요. 놓을 자리를 골라 주세요.')).toBeDefined();
    fireEvent.keyDown(screen.getByRole('button', { name: '빈 자리, 비어 있음' }), { key: 'Enter' });
    expect(screen.getByText('자리를 다 채웠어요.')).toBeDefined();
    expect(screen.getByRole('button', { name: '조각, 놓음' })).toBeDefined();
  });

  it('draws a piece the learner moves on top of whatever it lands on', () => {
    // 분수 막대 is written after the 조각 in the same drawing, so a piece dropped into the bar was
    // painted under it and disappeared. Movable shapes are painted last, whatever order they sit in.
    const board: SceneItem[] = [
      { kind: 'rect', id: 'piece', label: '조각', draggable: true, x: 10, y: 120, width: 40, height: 40 },
      { kind: 'rect', id: 'bar', x: 190, y: 10, width: 80, height: 80 },
    ];
    const { container } = render(<SceneTaskFigure width={320} height={200} items={board} zones={zones}
      task={{ prompt: '조각을 빈 자리에 놓아 보세요.' }} alt="조각을 옮기는 그림" />);
    const drawn = [...container.querySelectorAll('svg rect')].map((node) => node.getAttribute('width'));
    // The board's 80 comes before the piece's 40; the zone and the hit target are drawn around them.
    expect(drawn.indexOf('80')).toBeLessThan(drawn.indexOf('40'));
  });

  it('writes each seat\'s name on the page, not only into the label a screen reader hears', () => {
    // 「분수 · 소수 · 백분율」 shipped as three identical dashed boxes: the name was in `aria-label`
    // and nowhere on screen, so a sighted learner could only place the pieces by guessing.
    const { container } = render(<SceneTaskFigure width={320} height={200} items={items} zones={zones}
      task={{ prompt: '조각을 빈 자리에 놓아 보세요.' }} alt="조각을 옮기는 그림" />);
    const drawn = [...container.querySelectorAll('.scene-zone-label')].map((node) => node.textContent);
    expect(drawn).toEqual(['빈 자리']);
  });

  it('puts everything back where it started', () => {
    render(<SceneTaskFigure width={320} height={200} items={items} zones={zones}
      task={{ prompt: '조각을 빈 자리에 놓아 보세요.' }} alt="조각을 옮기는 그림" />);
    fireEvent.keyDown(screen.getByRole('button', { name: '조각' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: '빈 자리, 비어 있음' }), { key: 'Enter' });
    expect(screen.getByText('다 놓았어요.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '처음으로' }));
    expect(screen.getByText('1곳 중 0곳을 채웠어요.')).toBeDefined();
  });
});
