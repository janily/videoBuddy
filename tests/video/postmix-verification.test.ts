import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash} from '@/services/video/domain/hash';
import {StoreMissing} from '@/services/video/storage/atomic-store';
import {verifyCompletedPostMixJournal} from '@/services/video/audio/postmix-verification';
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-postmix-verification-'))});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
it('requires actual completed receipts for every cold verification read and never treats missing journals as legacy cache',async()=>{
 const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),journalOperationId=randomUUID(),prefix=`projects/${projectId}/operations/${journalOperationId}/media-effects`,key=prefix+'/'+('a'.repeat(64));
 const verify=vi.fn(async(store:typeof projects.store)=>{await store.readFresh(key);return{status:'pass'}});
 await expect(verifyCompletedPostMixJournal(projects,projectId,journalOperationId,verify)).rejects.toThrow('POSTMIX_VERIFICATION_RECEIPT_REQUIRED');
 expect(verify).toHaveBeenCalledOnce();
 const receipt={schemaVersion:1,invocation:randomUUID(),image:'sha256:'+('b'.repeat(64)),argsSha256:'a'.repeat(64),state:'started'};
 await projects.store.create(key,receipt);
 await expect(verifyCompletedPostMixJournal(projects,projectId,journalOperationId,verify)).rejects.toThrow('POSTMIX_VERIFICATION_RECEIPT_REQUIRED');
 const saved=await projects.store.readFresh(key);await projects.store.cas(key,saved.etag,{...receipt,state:'completed',output:''});
 const result=await verifyCompletedPostMixJournal(projects,projectId,journalOperationId,verify);
 expect(result.result).toEqual({status:'pass'});expect(result.receipts).toEqual([{key,sha256:canonicalHash({...receipt,state:'completed',output:''}),bytes:Buffer.byteLength(JSON.stringify({...receipt,state:'completed',output:''})),mime:'application/json'}]);
 // Other storage reads preserve normal absence semantics; the strict boundary
 // applies only to this precise completed native journal.
 await expect(verifyCompletedPostMixJournal(projects,projectId,journalOperationId,async store=>{await store.readFresh('other');return{}})).rejects.toBeInstanceOf(StoreMissing);
});
it('rejects foreign or empty journal verification and blocks writes during a cold evidence check',async()=>{
 const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),journalOperationId=randomUUID();
 await expect(verifyCompletedPostMixJournal(projects,projectId,'../foreign',async()=>({}))).rejects.toThrow('POSTMIX_VERIFICATION_CHANGED');
 await expect(verifyCompletedPostMixJournal(projects,projectId,journalOperationId,async()=>({}))).rejects.toThrow('POSTMIX_VERIFICATION_RECEIPT_REQUIRED');
 await expect(verifyCompletedPostMixJournal(projects,projectId,journalOperationId,async store=>{await store.create('any',{});return{}})).rejects.toThrow('POSTMIX_VERIFICATION_READ_ONLY');
 await expect(projects.store.readFresh('any')).rejects.toBeInstanceOf(StoreMissing);
});
