import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import type {ProjectControl,ArchivedMessage} from '@/contracts/video/project';
import {mandatoryDeliveryRules} from '@/services/video/quality/delivery';
import {seedPreviewBundle} from './preview-package';
export async function musicChangeProject(root:string,owner:string){
 const store=new FileStore(root),projects=new ProjectStore(store),{projectId}=await projects.create(owner,{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),artifactId=randomUUID(),revisionId=randomUUID(),resultId=randomUUID();
 const bundle=await seedPreviewBundle(projects,{projectId,revisionId,durationSec:20,briefVersion:1,previewArtifactSha256:'b'.repeat(64)});await store.create(`projects/${projectId}/previews/${bundle.previewId}/manifest`,bundle);
 const bytes=Buffer.from('change authorization protocol fixture; not qualified media'),sha256=createHash('sha256').update(bytes).digest('hex'),key=`projects/${projectId}/artifacts/${artifactId}/files/final.mp4`;
 await mkdir(join(root,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true});await writeFile(join(root,'objects',key),bytes);
 await store.create(`projects/${projectId}/artifacts/${artifactId}/manifest`,{id:artifactId,revisionId,objectRef:{key,sha256,bytes:bytes.length,mime:'video/mp4'},qaPassed:true,uploaded:true,filename:'final.mp4'});
 const manifest={resultId,artifactId,revisionId,previewId:bundle.previewId,approvalId:randomUUID(),bundleHash:bundle.bundleHash,mp4Sha256:sha256,mp4Bytes:bytes.length,qualityPolicy:{schemaVersion:1,audioIntent:'silent',captions:false,requiredRules:[...mandatoryDeliveryRules]},qualityChecks:[...mandatoryDeliveryRules,'decoded_silence'].map(ruleId=>({ruleId,result:'pass',severity:'blocking',evidenceRefs:['protocol-fixture-not-real-QA']})),createdAt:new Date().toISOString()};
 await store.create(`projects/${projectId}/results/${resultId}/manifest`,manifest);await updateJson(store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'ready' as const,currentResultId:resultId}));
 const message:ArchivedMessage={id:randomUUID(),clientMessageId:randomUUID(),operationId:randomUUID(),ordinal:1,role:'user',text:'这版音乐调小一点',target:{artifactId,revisionId,sourceTimeMs:null},status:'completed',contentVersion:1};await projects.archiveMessage(projectId,message);
 const proposal={schemaVersion:5 as const,changePlanId:randomUUID(),sourceMessageId:message.id,targetArtifactId:artifactId,revisionId,operations:[{field:'musicGainDb' as const,value:-3}],factsChanged:false,reason:'降低整片配乐，保留旁白和事实'};
 return{store,projects,projectId,artifactId,revisionId,resultId,message,proposal,manifest,key,bytes};
}
