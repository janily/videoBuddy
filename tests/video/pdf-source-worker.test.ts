import {beforeEach,afterEach,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {LocalAssetBytes} from '@/services/video/assets/local-bytes';
import {reserveAsset,markUploaded} from '@/services/video/assets/reservations';
import {runSourceAnalysisOnce} from '@/services/video/assets/source-worker';
import type {ProjectControl} from '@/contracts/video/project';
import type {TextAnalysis} from '@/services/video/assets/analysis';

let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-pdf-analysis-'))});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
async function setup(){
 const store=new FileStore(root),projects=new ProjectStore(store);
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:crypto.randomUUID(),clientCreateId:crypto.randomUUID()});
 const bytes=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
 const asset=await reserveAsset(store,`projects/${projectId}/control`,{filename:'真实资料.pdf',declaredBytes:bytes.length,declaredMime:'application/pdf',intendedUse:'reference',rightsConfirmed:true},crypto.randomUUID());
 const result=await new LocalAssetBytes(root).put(projectId,asset.id,new Request('https://video.test/file',{method:'PUT',headers:{'content-type':'application/pdf'},body:bytes,duplex:'half'} as RequestInit),{declaredMime:'application/pdf',declaredBytes:bytes.length});
 await markUploaded(store,`projects/${projectId}/control`,asset.id,result.sha256,result.bytes);
 return{store,projectId,asset};
}
it('publishes extracted PDF pages once and releases pending analysis',async()=>{
 const {store,projectId,asset}=await setup();let calls=0;
 const extract=async()=>{calls++;return['活动日期：10月8日','地点：上海']};
 await runSourceAnalysisOnce(store,root,extract);
 await runSourceAnalysisOnce(store,root,extract);
 const control=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
 expect(calls).toBe(1);expect(control.inputPending).toBe(false);expect(control.briefVersion).toBe(1);
 expect(control.assets[0]).toMatchObject({id:asset.id,status:'ready'});
 const analysis=(await store.readFresh<TextAnalysis>(control.assets[0].analysisRef!.key)).value;
 expect(analysis.pages).toEqual(['活动日期：10月8日','地点：上海']);expect(analysis.trust).toBe('untrusted_material');
});
it('a scanned PDF without readable text fails visibly and unlocks pending input',async()=>{
 const {store,projectId}=await setup();
 await runSourceAnalysisOnce(store,root,async()=>{throw Error('PDF_TEXT_UNAVAILABLE')});
 const control=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
 expect(control.assets[0]).toMatchObject({status:'failed',errorCode:'PDF_TEXT_UNAVAILABLE'});
 expect(control.inputPending).toBe(false);
});
