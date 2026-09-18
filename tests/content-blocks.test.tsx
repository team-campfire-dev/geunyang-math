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
