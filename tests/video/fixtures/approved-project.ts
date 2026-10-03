import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl} from '@/contracts/video/project';
import type {ApprovalRecord} from '@/services/video/preview/approve';
import {seedPreviewBundle} from './preview-package';

export async function seedApprovedProject(){
 const root=await mkdtemp(join(tmpdir(),'vb-approved-visual-')),projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
 const bundle=await seedPreviewBundle(projects,{projectId,previewArtifactSha256:'7'.repeat(64),durationSec:20}),operationId=randomUUID(),approvalId=randomUUID(),commandId=randomUUID();
 await projects.store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
 const spec=(await projects.store.readFresh<{understandingRef:ProjectControl['understandingRef']}>(bundle.filmSpecRef.key)).value;
 const approval:ApprovalRecord={approvalId,projectId,previewId:bundle.previewId,revisionId:bundle.revisionId,bundleHash:bundle.bundleHash,scriptHash:bundle.scriptHash,factsHash:bundle.factsHash,briefVersion:bundle.briefVersion,clientCommandId:commandId,source:'preview_button',ownerKeyHash:'owner',approvedAt:new Date().toISOString(),consentEpoch:0};
 await projects.store.create(`projects/${projectId}/approvals/${approvalId}`,approval);
 await projects.store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,commandId,kind:'render',status:'running',canonicalRunId:operationId,streamEpoch:0,fence:0,approvalId,bundleHash:bundle.bundleHash,consentEpoch:0});
 await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,briefVersion:bundle.briefVersion,understandingRef:spec.understandingRef,phase:'rendering' as const,currentPreviewId:bundle.previewId,currentApprovalId:approvalId,activeProduction:operationId,previewState:'ready' as const}));
 const env={VIDEO_MEDIA_IMAGE_REF:'sha256:'+'1'.repeat(64),VIDEO_MEDIA_RUNTIME_DIGEST:'1'.repeat(64),VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 return{root,projects,projectId,operationId,bundle,approval,env};
}
