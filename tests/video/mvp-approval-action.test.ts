import {expect,it} from 'vitest';
import {approvalAction} from '@/services/video/preview/action';
import {seedApprovedProject} from './fixtures/approved-project';
import type {ProjectControl} from '@/contracts/video/project';
it('enables only a ready unexpired frozen MVP preview and blocks updates, unresolved work, and legacy full packages',async()=>{
 const f=await seedApprovedProject(),c=(await f.projects.store.readFresh<ProjectControl>(`projects/${f.projectId}/control`)).value,ready={...c,phase:'preview_ready' as const,activeProduction:null},bundle={...f.bundle,renderInputs:{...f.bundle.renderInputs,qualityPolicyRef:{key:'unit',sha256:'a'.repeat(64),bytes:20,mime:'application/json' as const}}};
 expect(approvalAction(ready,bundle,{generationEnabled:true,missing:[]})).toMatchObject({enabled:true});
 for(const changed of [{...ready,inputPending:true},{...ready,activeConversation:'pending'},{...ready,briefVersion:ready.briefVersion+1},{...ready,unresolvedMediaStops:{[f.operationId]:'render' as const}}])expect(approvalAction(changed,bundle,{generationEnabled:true,missing:[]}).enabled).toBe(false);
 expect(approvalAction(ready,{...bundle,expiresAt:'2000-01-01T00:00:00Z'},{generationEnabled:true,missing:[]}).enabled).toBe(false);
 expect(approvalAction(ready,f.bundle,{generationEnabled:true,missing:[]}).enabled).toBe(false);
 expect(approvalAction(ready,bundle,{generationEnabled:false,missing:[]}).enabled).toBe(false);
});
