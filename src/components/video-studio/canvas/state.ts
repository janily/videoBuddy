import type {ProjectView} from '@/contracts/video/project';
export type CanvasTarget='brief'|'style'|'script'|'result';
export type CanvasStage='S0'|'S1'|'S2'|'S3'|'S4'|'S5'|'S6';
export type CardStatus='待开始'|'进行中'|'需要你选'|'已完成'|'已更新'|'需要更新';
export function latestCanvasUI(view:ProjectView|null){return view?.messages.filter(m=>m.role==='assistant').at(-1)?.ui}
export function deriveCanvasState(view:ProjectView|null):{stage:CanvasStage;focus:CanvasTarget;briefReady:boolean;stale:boolean}{
 const briefReady=Boolean(view?.understanding.subject.trim()&&(view.understanding.audience?.trim()||view.understanding.objective?.trim()||view.messages.some(m=>m.role==='user'&&/就这些|就这样|够了|直接做/.test(m.text))||latestCanvasUI(view)?.readiness?.brief==='enough'));
 const stale=Boolean(view&&(view.currentResult?.briefVersion!==undefined&&view.currentResult.briefVersion<view.briefVersion||view.script&&(view.script.state==='stale'||view.script.briefVersion<view.briefVersion)));
 const stage:CanvasStage=!view||(!view.messages.some(m=>m.role==='user')&&!view.understanding.subject.trim()&&!view.currentResult&&!view.script&&!('legacyMigrationNotice' in view))?'S0':view.activeProduction?'S4':view.currentResult?(stale?'S6':'S5'):!briefReady?'S1':!view.preferences.styleSlug?'S2':'S3';
 const defaultFocus:CanvasTarget=stage==='S0'||stage==='S1'?'brief':stage==='S2'?'style':stage==='S3'||stage==='S4'?'script':'result';
 return {stage,focus:stage==='S4'||stage==='S5'||stage==='S6'?defaultFocus:latestCanvasUI(view)?.canvasFocus||defaultFocus,briefReady,stale};
}
export const productionSteps=[{id:'treatment',label:'构思'},{id:'visual',label:'画镜头'},{id:'picture',label:'渲染'},{id:'composition',label:'拼接'},{id:'music',label:'配乐'}] as const;
export type ProductionActivity={label:string;stage?:string;completed?:number;total?:number;unit?:string};
export function productionIndex(stage?:string){return stage==='publication'?4:Math.max(0,productionSteps.findIndex(step=>step.id===stage))}
export function estimateMinutes(stage:string|undefined,completed=0,total=4){const index=productionIndex(stage),left=Math.max(0,total-completed);return Math.max(1,Math.ceil((index<=1?(index===0?total:left)*25+total*15+20:index===2?left*15+20:20)/60))}
