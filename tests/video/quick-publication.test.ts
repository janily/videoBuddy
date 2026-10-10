import {it,expect} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ProjectStore} from '@/services/video/storage/project-store';
import {FileStore} from '@/services/video/storage/file-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {publishQuickFilm} from '@/services/video/results/publish-film';
import {runQuickFilmOperation} from '@/services/video/quick/operation';
import {LocalEventLog} from '@/services/video/stream/local-event-log';
import type {ProjectControl} from '@/contracts/video/project';
import type {PreviewOperation} from '@/services/video/quick/prepare';
async function fixture(root:string){
 const projects=new ProjectStore(new FileStore(root)),{projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()}),operationId=randomUUID();
 const c=await updateJson(projects.store,`projects/${projectId}/control`,(c:ProjectControl)=>({...c,phase:'generating' as const,activeProduction:operationId}));
 const op:PreviewOperation={id:operationId,projectId,commandId:randomUUID(),kind:'preview',status:'running',canonicalRunId:operationId,streamEpoch:0,fence:0,revisionId:randomUUID(),previewId:randomUUID(),briefVersion:0,consentEpoch:0,understandingRef:c.understandingRef};
 await projects.store.create(`projects/${projectId}/operations/${operationId}`,op);
 const bytes=Buffer.alloc(2048);bytes.write('ftyp',4);const outputPath=join(root,'film.mp4');await writeFile(outputPath,bytes);
 const film={outputPath,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,width:1920,height:1080,durationSec:30,fps:24 as const,styleSlug:'ink-wash',aspect:'16:9' as const,briefVersion:0,shots:[{id:'shot',scriptLine:'hello',startFrame:0,endFrame:720,take:0}],music:null};
 return{projects,projectId,operationId,op,film};
}
it('never publishes output whose brief differs from the authorized operation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-publication-'));try{const f=await fixture(root);await expect(publishQuickFilm(f.projects,f.projectId,f.operationId,f.op,{...f.film,briefVersion:1},root)).rejects.toThrow('PREVIEW_STALE');expect((await f.projects.access('owner',f.projectId)).currentResultId).toBeUndefined()}finally{await rm(root,{recursive:true,force:true})}
});
it('recovers a committed publication after a newer result becomes current without rerendering',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-publication-replay-'));try{const f=await fixture(root),result=await publishQuickFilm(f.projects,f.projectId,f.operationId,f.op,f.film,root);
 await updateJson(f.projects.store,`projects/${f.projectId}/control`,(c:ProjectControl)=>({...c,currentResultId:randomUUID(),previousResultId:result.resultId}));
 let renders=0;await runQuickFilmOperation(f.projects.store,new LocalEventLog(root),f.projectId,f.operationId,{root,build:async()=>{renders++;throw Error('MUST_NOT_RENDER')}});expect(renders).toBe(0);expect((await f.projects.operation(f.projectId,f.operationId))?.status).toBe('succeeded');
 }finally{await rm(root,{recursive:true,force:true})}
});
