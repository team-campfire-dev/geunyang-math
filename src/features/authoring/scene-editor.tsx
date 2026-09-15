'use client';

import { useRef, useState } from 'react';
import {
  createSceneItem, itemBounds, moveItem, reorderItem, resizeItem, sceneColors, sceneItemKinds, sceneItemLabels,
  sceneLimits, snap, type Scene, type SceneItem, type SceneItemKind,
} from '@/shared/scene';
import { SceneShapes } from '@/features/learning/content-blocks';
import { Icon } from '@/features/learning/icons';

const step = 2;
const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Reads a scene out of a block payload without trusting it: a malformed drawing opens as empty
 *  rather than throwing an author out of the editor. */
function readScene(payload: Record<string, unknown>): Scene {
  const items = Array.isArray(payload.items) ? (payload.items as SceneItem[]).filter((item) => !!item && sceneItemKinds.includes(item?.kind)) : [];
  return { width: number(payload.width, sceneLimits.defaultWidth), height: number(payload.height, sceneLimits.defaultHeight), items };
}

type Drag = { index: number; mode: 'move' | 'resize'; originX: number; originY: number; item: SceneItem };

/**
 * A drawing surface instead of a coordinate form. Shapes are dragged and resized with the pointer,
 * and the same renderer the learner sees draws the canvas, so what is arranged here is what ships.
 * Everything it produces is the declarative scene the validator already checks.
 */
export function SceneEditor({ payload, onChange }: { payload: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const scene = readScene(payload);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const surface = useRef<SVGSVGElement>(null);

  const write = (items: SceneItem[], size?: { width: number; height: number }) =>
    onChange({ ...payload, width: size?.width ?? scene.width, height: size?.height ?? scene.height, items });
  const replace = (index: number, item: SceneItem) => write(scene.items.map((current, position) => (position === index ? item : current)));
  const item = selected !== null ? scene.items[selected] : undefined;

  /** Pointer position in the drawing's own units, so a resized canvas needs no other arithmetic. */
  const at = (event: React.PointerEvent) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: ((event.clientX - box.left) / box.width) * scene.width, y: ((event.clientY - box.top) / box.height) * scene.height };
  };
  const start = (event: React.PointerEvent, index: number, mode: Drag['mode']) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = at(event);
    setSelected(index);
    setDrag({ index, mode, originX: point.x, originY: point.y, item: scene.items[index] });
  };
  const track = (event: React.PointerEvent) => {
    if (!drag) return;
    const point = at(event);
    const dx = snap(point.x - drag.originX, step);
    const dy = snap(point.y - drag.originY, step);
    if (drag.mode === 'move') replace(drag.index, moveItem(drag.item, dx, dy));
    else {
      const bounds = itemBounds(drag.item);
      replace(drag.index, resizeItem(drag.item, Math.max(step, bounds.width + dx), Math.max(step, bounds.height + dy)));
    }
  };

  const add = (kind: SceneItemKind) => {
    if (scene.items.length >= sceneLimits.maxItems) return;
    write([...scene.items, createSceneItem(kind, scene)]);
    setSelected(scene.items.length);
  };
  const bounds = item ? itemBounds(item) : null;

  return <div className="scene-editor">
    <div className="scene-tools">
      <span className="editor-label">도형 추가</span>
      {sceneItemKinds.map((kind) => <button key={kind} type="button" className="button secondary" onClick={() => add(kind)}>
        <Icon name="plus" size={13} />{sceneItemLabels[kind]}</button>)}
    </div>

    <div className="scene-canvas">
      <svg ref={surface} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ aspectRatio: `${scene.width} / ${scene.height}` }}
        onPointerMove={track} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
        onPointerDown={(event) => { if (event.target === surface.current) setSelected(null); }}>
        <defs><pattern id="scene-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 L0 0 0 20" fill="none" stroke="#dfe4d5" strokeWidth="0.5" /></pattern></defs>
        <rect width={scene.width} height={scene.height} fill="url(#scene-grid)" />
        <SceneShapes items={scene.items} />
        {/* A transparent hit area per shape: thin lines and hollow shapes stay easy to grab. */}
        {scene.items.map((current, index) => {
          const box = itemBounds(current);
          return <rect key={index} x={box.x - 2} y={box.y - 2} width={Math.max(box.width + 4, 6)} height={Math.max(box.height + 4, 6)}
            fill="transparent" style={{ cursor: 'move' }} onPointerDown={(event) => start(event, index, 'move')} />;
        })}
        {bounds && selected !== null && <g className="scene-selection">
          <rect x={bounds.x - 2} y={bounds.y - 2} width={Math.max(bounds.width + 4, 6)} height={Math.max(bounds.height + 4, 6)}
            fill="none" stroke="var(--green)" strokeWidth="1" strokeDasharray="4 3" pointerEvents="none" />
          <rect x={bounds.x + Math.max(bounds.width, 4) - 3} y={bounds.y + Math.max(bounds.height, 4) - 3} width="7" height="7"
            fill="var(--white)" stroke="var(--green)" strokeWidth="1" style={{ cursor: 'nwse-resize' }}
            onPointerDown={(event) => start(event, selected, 'resize')} />
        </g>}
      </svg>
    </div>

    <div className="scene-size">
      <label className="editor-field"><span className="editor-label">가로</span>
        <input type="number" min={sceneLimits.minSize} max={sceneLimits.maxSize} value={scene.width}
          onChange={(event) => write(scene.items, { width: Number(event.target.value), height: scene.height })} /></label>
      <label className="editor-field"><span className="editor-label">세로</span>
        <input type="number" min={sceneLimits.minSize} max={sceneLimits.maxSize} value={scene.height}
          onChange={(event) => write(scene.items, { width: scene.width, height: Number(event.target.value) })} /></label>
      <span className="editor-note">도형 {scene.items.length} / {sceneLimits.maxItems}</span>
    </div>

    {item && selected !== null
      ? <ItemPanel item={item} index={selected} total={scene.items.length}
          onChange={(next) => replace(selected, next)}
          onReorder={(delta) => { write(reorderItem(scene.items, selected, delta)); setSelected(Math.min(Math.max(selected + delta, 0), scene.items.length - 1)); }}
          onRemove={() => { write(scene.items.filter((_, position) => position !== selected)); setSelected(null); }} />
      : <p className="editor-note">도형을 클릭하면 색과 위치를 고칠 수 있어요. 빈 곳을 누르면 선택이 풀립니다.</p>}
  </div>;
}

function ColorPicker({ label, value, onChange }: { label: string; value: string | undefined; onChange: (next: string) => void }) {
  return <label className="editor-field"><span className="editor-label">{label}</span>
    <select value={value ?? 'none'} onChange={(event) => onChange(event.target.value)}>
      {sceneColors.map((name) => <option key={name} value={name}>{name}</option>)}
    </select></label>;
}

function ItemPanel({ item, index, total, onChange, onReorder, onRemove }: {
  item: SceneItem; index: number; total: number;
  onChange: (next: SceneItem) => void; onReorder: (delta: number) => void; onRemove: () => void;
}) {
  const set = (patch: Partial<SceneItem>) => onChange({ ...item, ...patch } as SceneItem);
  return <div className="scene-panel">
    <header>
      <strong>{sceneItemLabels[item.kind]}</strong>
      <div className="editor-block-tools">
        <button type="button" className="icon-button" aria-label="뒤로 보내기" disabled={index === 0} onClick={() => onReorder(-1)}>↓</button>
        <button type="button" className="icon-button" aria-label="앞으로 가져오기" disabled={index === total - 1} onClick={() => onReorder(1)}>↑</button>
        <button type="button" className="icon-button" aria-label="도형 삭제" onClick={onRemove}><Icon name="close" size={14} /></button>
      </div>
    </header>
    <div className="scene-fields">
      <ColorPicker label="채우기" value={item.fill} onChange={(fill) => set({ fill })} />
      {item.kind !== 'text' && <>
        <ColorPicker label="선" value={item.stroke} onChange={(stroke) => set({ stroke })} />
        <label className="editor-field"><span className="editor-label">선 굵기</span>
          <input type="number" step="0.5" min={sceneLimits.minStroke} max={sceneLimits.maxStroke} value={item.strokeWidth ?? 1}
            onChange={(event) => set({ strokeWidth: Number(event.target.value) })} /></label>
        <label className="editor-field editor-check"><input type="checkbox" checked={item.dash === true}
          onChange={(event) => set({ dash: event.target.checked })} /><span className="editor-label">점선</span></label>
      </>}
      <label className="editor-field"><span className="editor-label">회전(°)</span>
        <input type="number" min={-360} max={360} value={item.rotate ?? 0} onChange={(event) => set({ rotate: Number(event.target.value) })} /></label>

      {item.kind === 'text' && <>
        <label className="editor-field"><span className="editor-label">글자</span>
          <input value={item.text} maxLength={sceneLimits.maxText} onChange={(event) => onChange({ ...item, text: event.target.value })} /></label>
        <label className="editor-field"><span className="editor-label">크기</span>
          <input type="number" min={sceneLimits.minFontSize} max={sceneLimits.maxFontSize} value={item.size ?? 14}
            onChange={(event) => onChange({ ...item, size: Number(event.target.value) })} /></label>
        <label className="editor-field"><span className="editor-label">기준점</span>
          <select value={item.anchor ?? 'start'} onChange={(event) => onChange({ ...item, anchor: event.target.value as 'start' | 'middle' | 'end' })}>
            <option value="start">왼쪽</option><option value="middle">가운데</option><option value="end">오른쪽</option>
          </select></label>
      </>}

      {item.kind === 'line' && <label className="editor-field"><span className="editor-label">화살표</span>
        <select value={item.arrow ?? 'none'} onChange={(event) => onChange({ ...item, arrow: event.target.value as 'none' | 'end' | 'both' })}>
          <option value="none">없음</option><option value="end">끝</option><option value="both">양쪽</option>
        </select></label>}

      {item.kind === 'rect' && <label className="editor-field"><span className="editor-label">모서리 둥글기</span>
        <input type="number" min={0} max={200} value={item.radius ?? 0} onChange={(event) => onChange({ ...item, radius: Number(event.target.value) })} /></label>}

      {item.kind === 'polygon' && <label className="editor-field editor-check">
        <input type="checkbox" checked={item.closed !== false} onChange={(event) => onChange({ ...item, closed: event.target.checked })} />
        <span className="editor-label">닫힌 도형</span></label>}
    </div>

    {item.kind === 'path' && <label className="editor-field"><span className="editor-label">곡선 좌표 (SVG path)</span>
      <textarea rows={3} value={item.d} maxLength={sceneLimits.maxPath} onChange={(event) => onChange({ ...item, d: event.target.value })} />
      <small>명령과 숫자만 들어갑니다. 여기에 원하는 모양을 직접 적거나 붙여 넣을 수 있어요.</small></label>}

    {item.kind === 'polygon' && <label className="editor-field"><span className="editor-label">꼭짓점</span>
      <textarea rows={2} value={item.points.map(([x, y]) => `${x},${y}`).join(' ')}
        onChange={(event) => {
          const points = event.target.value.trim().split(/\s+/).map((pair) => pair.split(',').map(Number) as [number, number])
            .filter((pair) => pair.length === 2 && pair.every(Number.isFinite));
          if (points.length >= 2) onChange({ ...item, points: points.slice(0, sceneLimits.maxPoints) });
        }} />
      <small>{'"x,y" 쌍을 공백으로 나열해요. 점을 더하거나 빼려면 여기서 고칩니다.'}</small></label>}
  </div>;
}
