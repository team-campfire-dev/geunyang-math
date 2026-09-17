import type { Scene, SceneItem } from './scene';

export const sceneTemplates = [
  { key: 'number-line', label: '수직선', description: '음수·소수·크기 비교' },
  { key: 'coordinates', label: '좌표평면', description: '좌표·함수·그래프' },
  { key: 'triangle', label: '삼각형', description: '각도·길이·넓이' },
  { key: 'fraction', label: '분수 막대', description: '부분과 전체' },
] as const;
export type SceneTemplate = typeof sceneTemplates[number]['key'];

/** Templates use existing scene primitives, so old learners can render them unchanged. */
export function templateItems(key: SceneTemplate, scene: Pick<Scene, 'width' | 'height'>): SceneItem[] {
  const {width:w, height:h} = scene;
  const line = (x1:number,y1:number,x2:number,y2:number,arrow:'none'|'end'|'both'='none'): SceneItem => ({kind:'line',x1,y1,x2,y2,arrow,stroke:'ink',strokeWidth:1});
  const label = (x:number,y:number,text:string): SceneItem => ({kind:'text',x,y,text,size:12,anchor:'middle',fill:'ink'});
  if (key === 'number-line') return [line(w*.08,h*.45,w*.92,h*.45,'both'), ...Array.from({length:7},(_,i) => {
    const x=w*(.2+i*.1); return [line(x,h*.42,x,h*.48),label(x,h*.6,String(i-3))];
  }).flat()];
  if (key === 'coordinates') return [line(w*.1,h*.5,w*.9,h*.5,'end'),line(w*.5,h*.9,w*.5,h*.1,'end'),
    label(w*.92,h*.58,'x'),label(w*.55,h*.1,'y'),label(w*.46,h*.58,'0'),
    ...[-2,-1,1,2].flatMap(i=>[line(w*(.5+i*.13),h*.48,w*(.5+i*.13),h*.52),label(w*(.5+i*.13),h*.6,String(i)),
      line(w*.485,h*(.5-i*.15),w*.515,h*(.5-i*.15)),label(w*.44,h*(.52-i*.15),String(i))])];
  if (key === 'triangle') return [{kind:'polygon',points:[[w*.5,h*.15],[w*.8,h*.8],[w*.2,h*.8]],closed:true,fill:'sky',stroke:'ink',strokeWidth:1.5},
    label(w*.5,h*.1,'A'),label(w*.84,h*.86,'B'),label(w*.16,h*.86,'C')];
  return [{kind:'strip',x:w*.15,y:h*.4,width:w*.7,height:h*.2,parts:4,filled:1,fill:'green',stroke:'ink',strokeWidth:1}];
}
