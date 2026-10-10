import {describe,it,expect} from 'vitest';
import {deriveCanvasState,estimateMinutes} from '@/components/video-studio/canvas/state';
import type {ProjectView} from '@/contracts/video/project';
const base={messages:[{role:'user',text:'中秋给家人'}],understanding:{subject:'中秋祝福',audience:'家人',summary:[]},preferences:{styleSlug:null},briefVersion:2,activeProduction:null,currentResult:null} as unknown as ProjectView;
describe('accumulated canvas stage',()=>{
 it('uses persisted project content and a sufficient brief before style selection',()=>{
  expect(deriveCanvasState(null).stage).toBe('S0');
  expect(deriveCanvasState({...base,messages:[],understanding:{...base.understanding,subject:''}}).stage).toBe('S0');
  expect(deriveCanvasState({...base,messages:[]}).stage).toBe('S2');
  expect(deriveCanvasState({...base,messages:[],currentResult:{artifactId:'saved',resultId:'result',revisionId:'revision',bundleHash:'a'.repeat(64),createdAt:'2026-10-10T00:00:00Z'}}).stage).toBe('S5');
  expect(deriveCanvasState({...base,understanding:{...base.understanding,audience:'',objective:''}}).stage).toBe('S1');
  expect(deriveCanvasState(base).stage).toBe('S2');
 });
 it('accepts skipping directly to script without triggering production',()=>{
  expect(deriveCanvasState({...base,preferences:{...base.preferences,styleSlug:'ink-wash'}})).toMatchObject({stage:'S3',focus:'script'});
 });
 it('keeps production foremost and detects changed briefs after completion',()=>{
  const ready={...base,currentResult:{artifactId:'result'},script:{briefVersion:1,state:'ready',summary:'',selectionReason:'',shots:[]}} as unknown as ProjectView;
  expect(deriveCanvasState(ready).stage).toBe('S6');
  expect(deriveCanvasState({...ready,activeProduction:{id:'job',kind:'preview',status:'running',streamEpoch:1}}).stage).toBe('S4');
 });
 it('keeps result stale after a new script is ready and focuses results over old guidance',()=>{
  const view={...base,preferences:{...base.preferences,styleSlug:'paper-lantern'},currentResult:{artifactId:'film',briefVersion:1},script:{briefVersion:2,state:'ready',summary:'',selectionReason:'',shots:[]}} as unknown as ProjectView;
  expect(deriveCanvasState(view)).toMatchObject({stage:'S6',focus:'result',stale:true});
 });
 it('only shows approximate whole minutes based on actual counts',()=>{
  expect(estimateMinutes('visual',2,4)).toBe(3);
  expect(estimateMinutes('music',0,4)).toBe(1);
 });
});
