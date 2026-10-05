import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {seedPreviewBundle} from './fixtures/preview-package';
import {createPreviewBundle,type PreviewBundle} from '@/services/video/preview/bundle';
import {verifyPreviewPackage} from '@/services/video/preview/package';
import {filmDeliveryPolicy} from '@/services/video/quality/delivery';
import type {FilmTimeline} from '@/contracts/video/film';
function input(bundle:PreviewBundle){const value={...bundle};delete (value as Partial<PreviewBundle>).scriptHash;delete (value as Partial<PreviewBundle>).factsHash;delete (value as Partial<PreviewBundle>).bundleHash;delete (value as Partial<PreviewBundle>).expiresAt;return value}
async function fixture(){const root=await mkdtemp(join(tmpdir(),'vb-mvp-policy-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),bundle=await seedPreviewBundle(projects,{projectId,durationSec:20,previewArtifactSha256:'7'.repeat(64)});return{root,projects,projectId,bundle}}
it('loads legacy policy without a ref and new MVP policy from its frozen verified ref',async()=>{
 const f=await fixture(),old=await verifyPreviewPackage(f.projects,f.projectId,f.bundle,f.root);expect(old.deliveryPolicy.schemaVersion).toBe(1);
 const spec=old.filmSpec,timeline=(await f.projects.store.readFresh<FilmTimeline>(spec.timelineRef.key)).value,policy=filmDeliveryPolicy(timeline,'mvp'),ref=await f.projects.index.immutable(`projects/${f.projectId}/revisions/${f.bundle.revisionId}/quality-policy`,policy);
 const bundle=createPreviewBundle({...input(f.bundle),renderInputs:{...f.bundle.renderInputs,qualityPolicySha256:ref.sha256,qualityPolicyRef:{...ref,mime:'application/json'}}});
 const frozen=await verifyPreviewPackage(f.projects,f.projectId,bundle,f.root);expect(frozen.deliveryPolicy).toEqual(policy);expect(bundle.bundleHash).not.toBe(f.bundle.bundleHash);
 await f.projects.store.cas(ref.key,(await f.projects.store.readFresh(ref.key)).etag,{...policy,requiredRules:policy.requiredRules.filter(r=>r!=='license')});
 await expect(verifyPreviewPackage(f.projects,f.projectId,bundle,f.root)).rejects.toThrow();
});
it('rejects a re-signed weakened MVP policy and a foreign project policy reference',async()=>{
 const f=await fixture(),old=await verifyPreviewPackage(f.projects,f.projectId,f.bundle,f.root),policy=filmDeliveryPolicy(old.timeline,'mvp');
 for(const [prefix,value] of [[`projects/${f.projectId}/revisions/${f.bundle.revisionId}/quality-policy`,{...policy,requiredRules:policy.requiredRules.filter(r=>r!=='license')}],[`projects/${randomUUID()}/revisions/${f.bundle.revisionId}/quality-policy`,policy]] as const){
  const ref=await f.projects.index.immutable(prefix,value),bundle=createPreviewBundle({...input(f.bundle),renderInputs:{...f.bundle.renderInputs,qualityPolicySha256:ref.sha256,qualityPolicyRef:{...ref,mime:'application/json'}}});await expect(verifyPreviewPackage(f.projects,f.projectId,bundle,f.root)).rejects.toThrow();
 }
});
