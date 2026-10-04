import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {compositionMediaJournal} from '@/services/video/preview/composite-journal';
it('uses current ownership for ordinary composition and refuses unbound frozen journal substitution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-composite-journal-'));
 try{
  const store=new FileStore(root),projects=new ProjectStore(store),projectId=randomUUID(),revisionId=randomUUID(),operationId=randomUUID();
  expect((await compositionMediaJournal(projects,root,projectId,revisionId,operationId,0)).prefix).toBe(`projects/${projectId}/operations/${operationId}/media-effects`);
  const film={outputPath:join(root,'composition','final.mp4'),sha256:'a'.repeat(64),durationMs:20000,technicalQa:'pass' as const};
  await expect(compositionMediaJournal(projects,root,projectId,revisionId,operationId,0,film)).rejects.toThrow('FROZEN_PREVIEW_CHANGED');
  await store.create(`projects/${projectId}/operations/${operationId}`,{id:operationId,projectId,revisionId,kind:'preview',commandId:randomUUID(),frozenPreviewSha256:'a'.repeat(64)});
  await expect(compositionMediaJournal(projects,root,projectId,revisionId,operationId,0)).rejects.toThrow('FROZEN_PREVIEW_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
