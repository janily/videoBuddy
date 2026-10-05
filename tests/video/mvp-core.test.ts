import {expect,it} from 'vitest';
import {seedApprovedProject} from './fixtures/approved-project';
import {prepareMvpCoreEvidence} from '@/services/video/render/mvp-core';
it('creates core proof from actual verified frozen manifests, retaining its exact movie binding',async()=>{
 const f=await seedApprovedProject(),sha='a'.repeat(64),proof=await prepareMvpCoreEvidence(f.projects,'owner',f.projectId,f.operationId,0,sha,{root:f.root,env:f.env});
 expect(proof).toMatchObject({filmSha256:sha,license:'pass',fontCoverage:'pass',subtitleSync:'pass'});
 const saved=(await f.projects.store.readFresh(proof.ref)).value;expect(saved).toMatchObject({filmSha256:sha,captionScope:'frozen_caption_layer',captionCount:0,rightsScope:'verified_manifest_basis_and_locked_font_notice'});
 await expect(prepareMvpCoreEvidence(f.projects,'owner',f.projectId,f.operationId,0,'b'.repeat(64),{root:f.root,env:f.env})).rejects.toThrow('RENDER_OUTPUT_CHANGED');
});
it('does not write a proof when a verified source changes or the operation is fenced',async()=>{
 const f=await seedApprovedProject(),spec=(await f.projects.store.readFresh<{sourceManifestRef:{key:string}}>(f.bundle.filmSpecRef.key)).value,snapshot=await f.projects.store.readFresh(spec.sourceManifestRef.key);await f.projects.store.cas(spec.sourceManifestRef.key,snapshot.etag,{schemaVersion:1,modules:[],actors:[],captionStyles:[]});
 await expect(prepareMvpCoreEvidence(f.projects,'owner',f.projectId,f.operationId,0,'a'.repeat(64),{root:f.root,env:f.env})).rejects.toThrow('PREVIEW_PACKAGE_INVALID');
 const keys=await f.projects.store.listKeys?.(`projects/${f.projectId}/approvals/${f.approval.approvalId}`,1);expect(keys?.some(key=>key.endsWith('mvp-core-v1-stage'))).toBe(false);
});
