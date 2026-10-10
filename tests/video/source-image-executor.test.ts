import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {prepareSourceImage,readSourceImageView} from '@/services/video/assets/image-preparation';
import {FileStore} from '@/services/video/storage/file-store';
import {mkdtemp,mkdir,readFile,rm,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {canonicalHash} from '@/services/video/domain/hash';
const mocked=vi.hoisted(()=>({create:vi.fn(),prepare:vi.fn(),close:vi.fn()}));
vi.mock('@/services/video/media/configuration',()=>({createMediaRuntime:mocked.create}));
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-image-prepare-'));vi.clearAllMocks();mocked.close.mockResolvedValue(undefined)});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
async function fixture(){
 const projectId=randomUUID(),operationId=randomUUID(),assetId=randomUUID(),store=new FileStore(root),original=await readFile('tests/fixtures/source-image/original.jpeg'),data=await readFile('tests/fixtures/source-image/view.png'),known=JSON.parse(await readFile('tests/fixtures/source-image/proof.json','utf8')).receipt;
 const input={projectId,assetId,sourceMime:'image/jpeg' as const,sourceSha256:createHash('sha256').update(original).digest('hex'),sourceBytes:original.length},journal={store,prefix:`projects/${projectId}/operations/${operationId}/media-effects`};
 await mkdir(join(root,'assets',projectId),{recursive:true});await writeFile(join(root,'assets',projectId,assetId+'.bin'),original);
 const result={key:'d'.repeat(64),outputPath:join(root,'media','image-preparation','d'.repeat(64),'view.png'),runtimeDigest:'b'.repeat(64),mime:'image/png' as const,transform:'full_image_resize' as const,coordinates:'oriented_image_normalized' as const,sha256:known.sha256,bytes:data.length,width:known.width,height:known.height,encodedWidth:known.encodedWidth,encodedHeight:known.encodedHeight,orientedWidth:known.orientedWidth,orientedHeight:known.orientedHeight};
 mocked.create.mockResolvedValue({runtimeDigest:'b'.repeat(64),version:{renderer:'c'.repeat(64)},prepareImage:mocked.prepare,close:mocked.close});
 mocked.prepare.mockImplementation(async()=>{await mkdir(join(root,'media','image-preparation',result.key),{recursive:true});await writeFile(result.outputPath,data);return result});
 return{projectId,operationId,assetId,store,input,journal,result,original,data};
}
it('rejects revoked ownership before configuration, local writes or runtime admission',async()=>{
 const projectId=randomUUID(),operationId=randomUUID(),assetId=randomUUID(),store=new FileStore(root);
 await expect(prepareSourceImage(root,{projectId,assetId,sourceMime:'image/png',sourceSha256:'a'.repeat(64),sourceBytes:100},{env:{},journal:{store,prefix:`projects/${projectId}/operations/${operationId}/media-effects`},assertActive:async()=>{throw Error('ASSET_REMOVED')}})).rejects.toThrow('ASSET_REMOVED');expect(await store.listKeys('projects',4)).toEqual([]);expect(mocked.create).not.toHaveBeenCalled();
});
it('persists original identity and orientation and cold-recovers with no runtime or writes',async()=>{
 const f=await fixture(),options={journal:f.journal,assertActive:async()=>{}};
 const first=await prepareSourceImage(root,f.input,options);
 expect(first.receipt).toMatchObject({sourceSha256:f.input.sourceSha256,sourceBytes:f.input.sourceBytes,orientedWidth:f.result.orientedWidth,orientedHeight:f.result.orientedHeight,width:683,height:2048});
 expect(mocked.prepare).toHaveBeenCalledWith({...f.input,sourcePath:join(root,'assets',f.projectId,f.assetId+'.bin'),maxEdge:2048},{signal:expect.any(AbortSignal)});expect(mocked.close).toHaveBeenCalledOnce();
 mocked.create.mockRejectedValue(Error('RUNTIME_UNAVAILABLE'));f.store.create=async()=>{throw Error('UNEXPECTED_WRITE')};f.store.cas=async()=>{throw Error('UNEXPECTED_WRITE')};
 expect((await prepareSourceImage(root,f.input,options)).data.equals(f.data)).toBe(true);
 expect((await readSourceImageView(root,f.input,first.proof,options)).proof).toEqual(first.proof);expect(mocked.create).toHaveBeenCalledOnce();expect(mocked.prepare).toHaveBeenCalledOnce();
});
it('rejects mismatched operation scopes and changed original bytes before native admission',async()=>{
 const f=await fixture();await expect(prepareSourceImage(root,f.input,{journal:{...f.journal,prefix:`projects/${randomUUID()}/operations/${f.operationId}/media-effects`},assertActive:async()=>{}})).rejects.toThrow('SOURCE_IMAGE_INPUT_INVALID');
 await writeFile(join(root,'assets',f.projectId,f.assetId+'.bin'),Buffer.from('changed'));
 await expect(prepareSourceImage(root,f.input,{journal:f.journal,assertActive:async()=>{}})).rejects.toThrow('IMAGE_INPUT_CHANGED');expect(mocked.create).not.toHaveBeenCalled();
});
it('does not replay an interrupted invocation after process restart',async()=>{
 const f=await fixture();mocked.prepare.mockRejectedValue(Error('TRANSPORT_LOST'));
 await expect(prepareSourceImage(root,f.input,{journal:f.journal,assertActive:async()=>{}})).rejects.toThrow('TRANSPORT_LOST');
 await expect(prepareSourceImage(root,f.input,{journal:{...f.journal,store:new FileStore(root)},assertActive:async()=>{}})).rejects.toThrow('MEDIA_STOP_UNKNOWN');expect(mocked.prepare).toHaveBeenCalledOnce();expect(mocked.close).toHaveBeenCalledOnce();
});
it('rejects wrong runtime identity or output paths and closes the runtime',async()=>{
 const f=await fixture();mocked.prepare.mockResolvedValue({...f.result,outputPath:join(root,'unowned.png')});
 await expect(prepareSourceImage(root,f.input,{journal:f.journal,assertActive:async()=>{}})).rejects.toThrow('SOURCE_IMAGE_PROOF_CHANGED');expect(mocked.close).toHaveBeenCalledOnce();
});
it('rejects image replacement and revoked authorization during preparation before completing receipt',async()=>{
 const f=await fixture(),perform=mocked.prepare.getMockImplementation()!;let active=true;
 mocked.prepare.mockImplementation(async()=>{const result=await perform();active=false;return result});
 await expect(prepareSourceImage(root,f.input,{journal:f.journal,assertActive:async()=>{if(!active)throw Error('ASSET_REMOVED')}})).rejects.toThrow('ASSET_REMOVED');
 const key=f.journal.prefix+'/'+canonicalHash({kind:'source_image',operationId:f.operationId,input:f.input});expect((await f.store.readFresh<{state:string}>(key)).value.state).toBe('started');expect(mocked.close).toHaveBeenCalledOnce();
});
it('rejects symlinked source directories before reading uploaded bytes',async()=>{
 const f=await fixture();await symlink(join(root,'assets',f.projectId),join(root,'alias'),'dir');
 const {rename,unlink}=await import('node:fs/promises');await rename(join(root,'assets',f.projectId),join(root,'outside'));await unlink(join(root,'alias'));await symlink(join(root,'outside'),join(root,'assets',f.projectId),'dir');
 await expect(prepareSourceImage(root,f.input,{journal:f.journal,assertActive:async()=>{}})).rejects.toThrow('SOURCE_IMAGE_CHANGED');expect(mocked.create).not.toHaveBeenCalled();
});

it('aborts the local runtime when ownership is revoked during native decoding',async()=>{
 const f=await fixture();let active=true;
 mocked.prepare.mockImplementation(async(_input,{signal}:{signal:AbortSignal})=>{active=false;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('IMAGE_CANCELLED')),{once:true}))});
 await expect(prepareSourceImage(root,f.input,{journal:f.journal,assertActive:async()=>{if(!active)throw Error('ASSET_REMOVED')}})).rejects.toThrow('ASSET_REMOVED');expect(mocked.close).toHaveBeenCalledOnce();
});
