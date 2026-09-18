'use client';

import { useId, useRef, useState } from 'react';
import {
  changeFor, createSceneItem, createZone, emptyFrames, frameLimits, itemBounds, moveItem, nameItem, reorderItem,
  resizeItem, sceneColorLabels, sceneColors, sceneItemKinds, sceneItemLabels, sceneLimits, scenePalette, setChange, snap,
  type Scene, type SceneColor, type SceneFrame, type SceneItem, type SceneItemKind, type SceneZone,
} from '@/shared/scene';
import { sceneTemplates, templateItems } from '@/shared/scene-templates';
import { SceneShapes } from '@/features/learning/content-blocks';
import { Icon } from '@/features/learning/icons';
import { useRemovalNotice } from './edit-history';

const step = 2;
const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Reads a scene out of a block payload without trusting it: a malformed drawing opens as empty
 *  rather than throwing an author out of the editor. */
function readScene(payload: Record<string, unknown>): Scene {
  const items = Array.isArray(payload.items) ? (payload.items as SceneItem[]).filter((item) => !!item && sceneItemKinds.includes(item?.kind)) : [];
  const frames = Array.isArray(payload.frames) ? (payload.frames as SceneFrame[]).filter((frame) => !!frame && Array.isArray(frame.changes)) : undefined;
  const zones = Array.isArray(payload.zones) ? (payload.zones as SceneZone[]).filter((zone) => !!zone && typeof zone.id === 'string') : undefined;
  return {
    width: number(payload.width, sceneLimits.defaultWidth), height: number(payload.height, sceneLimits.defaultHeight),
    items, frames, zones,
  };
}

type Drag = { index: number; mode: 'move' | 'resize'; on: 'item' | 'zone'; originX: number; originY: number; item?: SceneItem; zone?: SceneZone };

/**
 * A drawing surface instead of a coordinate form. Shapes are dragged and resized with the pointer,
 * and the same renderer the learner sees draws the canvas, so what is arranged here is what ships.
 * Everything it produces is the declarative scene the validator already checks.
 */
/**
 * `arrangingRefusal`, when set, is the reason this drawing may not be arranged by hand — it sits
 * somewhere arranging would be read as an answer, or as the explanation of one. The publishing
 * validator refuses those, and this refuses them here rather than at the end of the work.
 */
export function SceneEditor({ payload, onChange, arrangingRefusal }: {
  payload: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; arrangingRefusal?: string;
}) {
  const scene = readScene(payload);
  const gridId = useId();
  const notifyRemoval = useRemovalNotice();
  const [selected, setSelected] = useState<{ on: 'item' | 'zone'; index: number } | null>(null);
  const [frameIndex, setFrameIndex] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const frames = scene.frames;
  const zones = scene.zones ?? [];
  const task = payload.task as Scene['task'];
  // While a frame is open the canvas shows that moment, and a drag records the move into it.
  const frame = frames && frameIndex !== null ? frames[Math.min(frameIndex, frames.length - 1)] : undefined;

  const write = (items: SceneItem[], size?: { width: number; height: number }) =>
    onChange({ ...payload, width: size?.width ?? scene.width, height: size?.height ?? scene.height, items });
  const writeFrames = (next: SceneFrame[] | undefined, items: SceneItem[] = scene.items) =>
    onChange({ ...payload, width: scene.width, height: scene.height, items, ...(next ? { frames: next } : {}), ...(next ? {} : { frames: undefined }) });
  const replace = (index: number, item: SceneItem) => write(scene.items.map((current, position) => (position === index ? item : current)));
  const writeZones = (next: SceneZone[] | undefined, extra: Record<string, unknown> = {}) =>
    onChange({ ...payload, width: scene.width, height: scene.height, items: scene.items, zones: next, ...extra });
  const item = selected?.on === 'item' ? scene.items[selected.index] : undefined;
  const zone = selected?.on === 'zone' ? zones[selected.index] : undefined;

  /** Pointer position in the drawing's own units, so a resized canvas needs no other arithmetic. */
  const at = (event: React.PointerEvent) => {
    const box = surface.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: ((event.clientX - box.left) / box.width) * scene.width, y: ((event.clientY - box.top) / box.height) * scene.height };
  };
  const start = (event: React.PointerEvent, index: number, mode: Drag['mode'], on: Drag['on'] = 'item') => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = at(event);
    setSelected({ on, index });
    setDrag({ index, mode, on, originX: point.x, originY: point.y, item: on === 'item' ? scene.items[index] : undefined, zone: on === 'zone' ? zones[index] : undefined });
  };
  const track = (event: React.PointerEvent) => {
    if (!drag) return;
    const point = at(event);
    const dx = snap(point.x - drag.originX, step);
    const dy = snap(point.y - drag.originY, step);
    if (drag.on === 'zone' && drag.zone) {
      const zone = drag.zone;
      writeZones(zones.map((current, index) => (index !== drag.index ? current : drag.mode === 'move'
        ? { ...current, x: zone.x + dx, y: zone.y + dy }
        : { ...current, width: Math.max(step, zone.width + dx), height: Math.max(step, zone.height + dy) })));
      return;
    }
    if (!drag.item) return;
    const dragged = drag.item;
    if (frames && frameIndex !== null && drag.mode === 'move') {
      // Inside a frame the drawing itself never moves; the frame remembers where the shape goes.
      const named = nameItem(scene.items, drag.index);
      const base = changeFor(frames[frameIndex], named.items[drag.index]);
      writeFrames(setChange(frames, frameIndex, named.id, { dx: (base?.dx ?? 0) + dx, dy: (base?.dy ?? 0) + dy }), named.items);
      setDrag({ ...drag, originX: point.x, originY: point.y });
      return;
    }
    if (drag.mode === 'move') replace(drag.index, moveItem(dragged, dx, dy));
    else {
      const bounds = itemBounds(dragged);
      replace(drag.index, resizeItem(dragged, Math.max(step, bounds.width + dx), Math.max(step, bounds.height + dy)));
    }
  };

  const add = (kind: SceneItemKind) => {
    if (scene.items.length >= sceneLimits.maxItems) return;
    write([...scene.items, createSceneItem(kind, scene)]);
    setSelected({ on: 'item', index: scene.items.length });
  };
  const bounds = item ? itemBounds(item) : zone ? { x: zone.x, y: zone.y, width: zone.width, height: zone.height } : null;
  const selectedShift = item ? changeFor(frame, item) : undefined;

  return <div className="scene-editor">
    <div className="scene-templates"><span className="editor-label">바탕 추가</span><p className="editor-note">그림을 고르면 바탕이 추가돼요. 도형과 숫자는 각각 선택해 고칠 수 있어요.</p>
      <div className="scene-template-buttons">{sceneTemplates.map(template => <button key={template.key} type="button" className="button secondary"
        disabled={scene.items.length + templateItems(template.key, scene).length > sceneLimits.maxItems}
        onClick={() => { write([...templateItems(template.key, scene), ...scene.items]); setSelected(null); }}>
        <strong>{template.label}</strong><small>{template.description}</small>
      </button>)}</div>
    </div>
    <div className="scene-tools">
      <span className="editor-label">도형 추가</span>
      {sceneItemKinds.map((kind) => <button key={kind} type="button" className="button secondary" disabled={scene.items.length >= sceneLimits.maxItems} onClick={() => add(kind)}>
        <Icon name="plus" size={13} />{sceneItemLabels[kind]}</button>)}
    </div>

    <div className="scene-canvas">
      <svg ref={surface} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ aspectRatio: `${scene.width} / ${scene.height}`, maxWidth: scene.width }}
        onPointerMove={track} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}
        onPointerDown={(event) => { if (event.target === surface.current) setSelected(null); }}>
        <defs><pattern id={gridId} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0 L0 0 0 20" fill="none" stroke="#dfe4d5" strokeWidth="0.5" /></pattern></defs>
        <rect width={scene.width} height={scene.height} fill={`url(#${gridId})`} />
        <SceneShapes items={scene.items} frame={frame} />
        {/* A transparent hit area per shape: thin lines and hollow shapes stay easy to grab. It follows
            the shape into the open frame, so a moved shape is grabbed where it is drawn. */}
        {scene.items.map((current, index) => {
          const shift = changeFor(frame, current);
          const raw = itemBounds(current);
          const box = { ...raw, x: raw.x + (shift?.dx ?? 0), y: raw.y + (shift?.dy ?? 0) };
          return <rect key={index} x={box.x - 2} y={box.y - 2} width={Math.max(box.width + 4, 6)} height={Math.max(box.height + 4, 6)}
            fill="transparent" style={{ cursor: 'move' }} onPointerDown={(event) => start(event, index, 'move')} />;
        })}
        {/* Zones are drawn as outlines the author can drag and stretch like any other shape. */}
        {zones.map((current, index) => <g key={current.id}>
          <rect x={current.x} y={current.y} width={current.width} height={current.height} rx={3} className="scene-zone" />
          <rect x={current.x} y={current.y} width={current.width} height={current.height} fill="transparent"
            style={{ cursor: 'move' }} onPointerDown={(event) => start(event, index, 'move', 'zone')} />
        </g>)}
        {bounds && selected && <g className="scene-selection" transform={`translate(${selectedShift?.dx ?? 0}, ${selectedShift?.dy ?? 0})`}>
          <rect x={bounds.x - 2} y={bounds.y - 2} width={Math.max(bounds.width + 4, 6)} height={Math.max(bounds.height + 4, 6)}
            fill="none" stroke="var(--green)" strokeWidth="1" strokeDasharray="4 3" pointerEvents="none" />
          <rect x={bounds.x + Math.max(bounds.width, 4) - 3} y={bounds.y + Math.max(bounds.height, 4) - 3} width="7" height="7"
            fill="var(--white)" stroke="var(--green)" strokeWidth="1" style={{ cursor: 'nwse-resize' }}
            onPointerDown={(event) => start(event, selected.index, 'resize', selected.on)} />
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

    <div className="scene-frames">
      <div className="scene-frames-head">
        <span className="editor-label">장면</span>
        {frames
          ? <button type="button" className="text-button" onClick={() => { writeFrames(undefined); setFrameIndex(null); }}>움직임 끄기</button>
          : <button type="button" className="text-button" onClick={() => { writeFrames(emptyFrames()); setFrameIndex(1); }}>
              <Icon name="play" size={13} />움직이게 만들기</button>}
      </div>
      {frames ? <>
        <p className="editor-note">장면을 고르고 도형을 끌면 그 장면에서의 위치가 정해져요. 그림 자체는 그대로 남습니다.</p>
        <div className="scene-frame-list">
          <button type="button" className={frameIndex === null ? 'active' : ''} onClick={() => setFrameIndex(null)}>기본</button>
          {frames.map((_, index) => <button key={index} type="button" className={frameIndex === index ? 'active' : ''}
            onClick={() => setFrameIndex(index)}>{index + 1}</button>)}
          <button type="button" className="text-button" disabled={frames.length >= frameLimits.maxFrames}
            onClick={() => { writeFrames([...frames, { changes: [] }]); setFrameIndex(frames.length); }}>
            <Icon name="plus" size={13} />장면 추가</button>
          {frameIndex !== null && frames.length > frameLimits.minFrames && <button type="button" className="text-button"
            onClick={() => { writeFrames(frames.filter((_, index) => index !== frameIndex)); setFrameIndex(null); }}>
            <Icon name="close" size={13} />이 장면 삭제</button>}
        </div>
        {frame && frameIndex !== null && <label className="editor-field"><span className="editor-label">이 장면의 캡션</span>
          <input value={frame.caption ?? ''} maxLength={200}
            onChange={(event) => writeFrames(frames.map((current, index) =>
              (index === frameIndex ? { ...current, caption: event.target.value || undefined } : current)))} /></label>}
        <div className="scene-size">
          <label className="editor-field"><span className="editor-label">장면 간격(ms)</span>
            <input type="number" min={frameLimits.minMs} max={frameLimits.maxMs} value={number(payload.frameMs, frameLimits.defaultMs)}
              onChange={(event) => onChange({ ...payload, frameMs: Number(event.target.value) })} /></label>
          <label className="editor-field editor-check"><input type="checkbox" checked={payload.loop === true}
            onChange={(event) => onChange({ ...payload, loop: event.target.checked })} /><span className="editor-label">반복</span></label>
          <label className="editor-field editor-check"><input type="checkbox" checked={payload.autoplay === true}
            onChange={(event) => onChange({ ...payload, autoplay: event.target.checked })} /><span className="editor-label">자동 재생</span></label>
        </div>
      </> : <p className="editor-note">움직임을 켜면 같은 그림을 여러 장면으로 이어 보여줍니다.</p>}
    </div>

    <div className="scene-frames">
      <div className="scene-frames-head">
        <span className="editor-label">직접 놓아 보기</span>
        {zones.length
          ? <button type="button" className="text-button" onClick={() => { writeZones(undefined, { task: undefined }); setSelected(null); }}>조작 끄기</button>
          : <button type="button" className="text-button" disabled={!!frames || !!arrangingRefusal}
              onClick={() => writeZones([createZone(scene, [])], { task: { prompt: '조각을 알맞은 자리에 놓아 보세요.' } })}>
              <Icon name="plus" size={13} />놓아 보게 만들기</button>}
      </div>
      {zones.length ? <>
        {arrangingRefusal
          ? <p className="editor-note editor-warn">{arrangingRefusal} 「조작 끄기」로 끄거나, 이 그림을 수업 본문으로 옮겨 주세요.</p>
          : <p className="editor-note">도형에 「끌 수 있음」을 켜고, 놓는 자리를 만들어 어떤 도형을 받을지 정합니다. 채점하지는 않아요.</p>}
        <label className="editor-field"><span className="editor-label">안내 문장</span>
          <input value={task?.prompt ?? ''} maxLength={300}
            onChange={(event) => writeZones(zones, { task: { ...task, prompt: event.target.value } })} /></label>
        <label className="editor-field"><span className="editor-label">낭독용 안내<em>선택</em></span>
          <input value={task?.promptAlt ?? ''} maxLength={300}
            onChange={(event) => writeZones(zones, { task: { ...task, prompt: task?.prompt ?? '', promptAlt: event.target.value || undefined } })} />
          <small>안내에 수식을 쓸 때 필수예요.</small></label>
        <label className="editor-field"><span className="editor-label">다 놓았을 때 문구<em>선택</em></span>
          <input value={task?.successText ?? ''} maxLength={300}
            onChange={(event) => writeZones(zones, { task: { ...task, prompt: task?.prompt ?? '', successText: event.target.value || undefined } })} /></label>
        <div className="scene-frame-list">
          {zones.map((current, index) => <button key={current.id} type="button"
            className={selected?.on === 'zone' && selected.index === index ? 'active' : ''}
            onClick={() => setSelected({ on: 'zone', index })}>{current.label || current.id}</button>)}
          <button type="button" className="text-button"
            onClick={() => { writeZones([...zones, createZone(scene, zones.map((current) => current.id))], { task }); setSelected({ on: 'zone', index: zones.length }); }}>
            <Icon name="plus" size={13} />놓는 자리 추가</button>
        </div>
      </> : <p className="editor-note">{arrangingRefusal
        ? `${arrangingRefusal} 수업 본문에서는 쓸 수 있어요.`
        : frames ? '움직이는 그림은 직접 놓아 보게 만들 수 없어요. 한 그림은 스스로 움직이거나 학습자가 옮기거나, 둘 중 하나입니다.' : '학습자가 도형을 끌어다 놓게 하려면 켜세요.'}</p>}
    </div>

    {zone && selected?.on === 'zone'
      ? <ZonePanel zone={zone} items={scene.items}
          onChange={(next) => writeZones(zones.map((current, index) => (index === selected.index ? next : current)), { task })}
          onRemove={() => { writeZones(zones.filter((_, index) => index !== selected.index), { task }); setSelected(null); notifyRemoval('놓는 자리'); }} />
      : item && selected?.on === 'item'
        ? <ItemPanel item={item} index={selected.index} total={scene.items.length} arrangeable={zones.length > 0}
            onChange={(next) => replace(selected.index, next)}
            onName={() => {
              const named = nameItem(scene.items, selected.index);
              write(named.items);
              return named.id;
            }}
            onReorder={(delta) => {
              write(reorderItem(scene.items, selected.index, delta));
              setSelected({ on: 'item', index: Math.min(Math.max(selected.index + delta, 0), scene.items.length - 1) });
            }}
            onRemove={() => { write(scene.items.filter((_, position) => position !== selected.index)); setSelected(null); notifyRemoval('도형'); }} />
        : <p className="editor-note">도형을 클릭하면 색과 위치를 고칠 수 있어요. 빈 곳을 누르면 선택이 풀립니다.</p>}
  </div>;
}

function ZonePanel({ zone, items, onChange, onRemove }: {
  zone: SceneZone; items: SceneItem[]; onChange: (next: SceneZone) => void; onRemove: () => void;
}) {
  const movable = items.filter((item) => item.draggable && item.id);
  return <div className="scene-panel">
    <header>
      <strong>놓는 자리</strong>
      <button type="button" className="icon-button" aria-label="이 자리 삭제" onClick={onRemove}><Icon name="close" size={14} /></button>
    </header>
    <label className="editor-field"><span className="editor-label">이 자리의 이름</span>
      <input value={zone.label} maxLength={80} onChange={(event) => onChange({ ...zone, label: event.target.value })} />
      <small>화면 낭독에서 이 자리를 부르는 이름이에요.</small></label>
    <div className="editor-picker">
      <span className="editor-label">받을 도형<em>선택</em></span>
      {movable.length
        ? movable.map((item) => {
          const checked = zone.accepts?.includes(item.id!) ?? false;
          return <label key={item.id} className="editor-check">
            <input type="checkbox" checked={checked} onChange={() => onChange({ ...zone,
              accepts: checked ? zone.accepts?.filter((id) => id !== item.id) : [...(zone.accepts ?? []), item.id!] })} />
            <span><strong>{item.label || item.id}</strong></span>
          </label>;
        })
        : <p className="editor-note">먼저 도형에 「끌 수 있음」을 켜 주세요.</p>}
      <small className="editor-note">아무것도 고르지 않으면 어떤 도형이든 받습니다.</small>
    </div>
  </div>;
}

/**
 * A colour is chosen by looking at it. The palette's keys name these for the renderer, and one of
 * them reading `fill-soft` told an author nothing about what it would draw.
 */
function ColorPicker({ label, value, onChange }: { label: string; value: string | undefined; onChange: (next: string) => void }) {
  const chosen = value ?? 'none';
  return <div className="editor-field">
    <span className="editor-label">{label}</span>
    <div className="scene-swatches" role="group" aria-label={label}>
      {sceneColors.map((name) => <button key={name} type="button" aria-pressed={name === chosen} aria-label={sceneColorLabels[name]}
        title={sceneColorLabels[name]} className={`scene-swatch${name === chosen ? ' active' : ''}${name === 'none' ? ' empty' : ''}`}
        style={name === 'none' ? undefined : { background: scenePalette[name] }}
        onClick={() => onChange(name)} />)}
    </div>
    {/* A drawing may also carry a colour written as a hex value, which no swatch stands for. */}
    <small>{sceneColorLabels[chosen as SceneColor] ?? chosen}</small>
  </div>;
}

function ItemPanel({ item, index, total, arrangeable, onChange, onName, onReorder, onRemove }: {
  item: SceneItem; index: number; total: number; arrangeable: boolean;
  onChange: (next: SceneItem) => void; onName: () => string; onReorder: (delta: number) => void; onRemove: () => void;
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

      {arrangeable && <>
        <label className="editor-field editor-check">
          <input type="checkbox" checked={item.draggable === true}
            onChange={(event) => set({ draggable: event.target.checked || undefined, id: event.target.checked ? (item.id ?? onName()) : item.id })} />
          <span className="editor-label">끌 수 있음</span>
        </label>
        {item.draggable && <label className="editor-field"><span className="editor-label">이 도형의 이름</span>
          <input value={item.label ?? ''} maxLength={80} onChange={(event) => set({ label: event.target.value })} />
          <small>학습자가 이 도형을 집을 때 읽히는 이름이에요.</small></label>}
      </>}

      {item.kind === 'text' && <>
        <label className="editor-field"><span className="editor-label">글자</span>
          <input value={item.text} maxLength={sceneLimits.maxText} onChange={(event) => onChange({ ...item, text: event.target.value })} />
          <small>수식은 본문과 같이 $...$로 씁니다. 예: $\frac{3}{4}$</small></label>
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
