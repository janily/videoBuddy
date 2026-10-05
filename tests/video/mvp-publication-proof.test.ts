import {expect,it,vi} from 'vitest';
import {canonicalHash} from '@/services/video/domain/hash';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyMvpPublication} from '@/services/video/render/mvp-publication';
import type {ResultManifest} from '@/services/video/results/publish';
import {filmDeliveryPolicy} from '@/services/video/quality/delivery';
import {randomUUID} from 'node:crypto';
const ports=vi.hoisted(()=>({render:vi.fn()}));vi.mock('@/services/video/render/pipeline',()=>({renderApproved:ports.render}));
const result:ResultManifest={resultId:randomUUID(),artifactId:randomUUID(),revisionId:randomUUID(),previewId:randomUUID(),approvalId:randomUUID(),bundleHash:'a'.repeat(64),mp4Sha256:'b'.repeat(64),mp4Bytes:100,qualityPolicy:filmDeliveryPolicy({fps:24,totalFrames:480,sampleRate:48000,sections:[],shots:[],cues:[],narration:[],music:[],foley:[],captions:[],intentionalBlackRanges:[],intentionalSilenceRanges:[]},'mvp'),qualityChecks:[],createdAt:new Date().toISOString()};
it('replays actual producers read-only and rejects quality rows that differ from the frozen delivery proof',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-mvp-publish-')),projects=new ProjectStore(new FileStore(root));ports.render.mockImplementation(async(p:ProjectStore,_owner:string,_pid:string,_op:string,_fence:number,_targets:unknown,options:{mustExist:boolean})=>{expect(options.mustExist).toBe(true);await expect(p.store.create('missing',{})).rejects.toThrow();return{result,outputPath:'/protocol-only.mp4'}});
 await verifyMvpPublication(projects,'owner',randomUUID(),randomUUID(),0,result,{root});expect(ports.render).toHaveBeenCalledOnce();
 ports.render.mockResolvedValue({result:{...result,qualityChecks:[{ruleId:'license',result:'not_checked',severity:'blocking',evidenceRefs:[]}]},outputPath:'/protocol-only.mp4'});await expect(verifyMvpPublication(projects,'owner',randomUUID(),randomUUID(),0,result,{root})).rejects.toThrow('QUALITY_BLOCKED');expect(canonicalHash(result)).toMatch(/^[a-f0-9]{64}$/);
});
