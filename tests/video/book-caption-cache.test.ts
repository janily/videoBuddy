import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {FileStore} from '@/services/video/storage/file-store';
import {reserveDockerInvocation,finishDockerInvocation} from '@/services/video/media/docker-journal';
const {run}=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('@/services/video/media/owned-docker',()=>({runOwnedDocker:run}));
vi.mock('@/services/video/audio/style-font',()=>({readPinnedStyleFont:async()=>({glyphs:new Set([...'Observe growth.'])})}));
import {prepareBookCaptionLayer,bookCaptionStyle} from '@/services/video/media/book-caption-layer';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const image='sha256:'+'a'.repeat(64),env={VIDEO_MEDIA_IMAGE_REF:image,VIDEO_MEDIA_RUNTIME_DIGEST:image.slice(7),VIDEO_MEDIA_TIMEOUT_SECONDS:'60'},style=bookCaptionStyle({width:1920,height:1080},{x:100,y:800,width:1720,height:200}),spec={width:1280,height:720,durationSec:20,fps:24 as const,bundleHash:'b'.repeat(64),fence:0},cues=[{lineId:'line_1',text:'Observe growth.',startMs:0,endMs:5000,startFrame:0,endFrame:120,voiceSha256:'c'.repeat(64)}];
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'vb-book-cache-')),store=new FileStore(root),journal={store,prefix:`projects/${randomUUID()}/operations/${randomUUID()}/media-effects`};
 run.mockImplementation(async(args:string[],timeout:number,actualImage:string,active:unknown,owned:typeof journal)=>{
  const record=await reserveDockerInvocation(owned,args,actualImage),mount=args.find(v=>v.startsWith('type=bind,src=')&&v.endsWith('dst=/work,readonly'))!,stage=mount.slice('type=bind,src='.length,-',dst=/work,readonly'.length),job=JSON.parse(await readFile(join(stage,'job.json'),'utf8')),bytes=Buffer.from('protocol fixture: native-owned alpha bytes');
  const receipt={schemaVersion:1,jobSha256:args.at(-1),rendererSha256:job.rendererSha256,outputSha256:sha(bytes),outputBytes:bytes.length,frames:job.frames,width:job.width,height:job.height,fps:job.fps};
  await writeFile(join(stage,'output','captions.mov'),bytes);await writeFile(join(stage,'output','receipt.json'),JSON.stringify(receipt));await finishDockerInvocation(owned,record,'completed',JSON.stringify(receipt));return JSON.stringify(receipt);
 });
 const result=await prepareBookCaptionLayer(root,cues,style,spec,env,{journal});return{root,journal,result,receiptPath:join(root,'caption-layer',result.stageKey,'output','receipt.json')};
}
it('rejects re-signed cache bytes against the original completed producer output',async()=>{
 const {root,journal,result,receiptPath}=await fixture();run.mockClear();
 await expect(prepareBookCaptionLayer(root,cues,style,spec,env,{journal,mustExist:true})).resolves.toEqual(result);expect(run).not.toHaveBeenCalled();
 const forged=Buffer.from('different alpha content'),receipt=JSON.parse(await readFile(receiptPath,'utf8'));await writeFile(result.outputPath,forged);await writeFile(receiptPath,JSON.stringify({...receipt,outputSha256:sha(forged),outputBytes:forged.length}));
 await expect(prepareBookCaptionLayer(root,cues,style,spec,env,{journal,mustExist:true})).rejects.toThrow('BOOK_CAPTION_RECEIPT_CHANGED');expect(run).not.toHaveBeenCalled();
});
it('bounds receipt reads and refuses a cache without its producer journal',async()=>{
 const {root,journal,receiptPath}=await fixture();run.mockClear();await writeFile(receiptPath,'x'.repeat(4097));
 await expect(prepareBookCaptionLayer(root,cues,style,spec,env,{journal,mustExist:true})).rejects.toThrow('BOOK_CAPTION_RECEIPT_INVALID');
 await expect(prepareBookCaptionLayer(root,cues,style,spec,env,{mustExist:true})).rejects.toThrow('BOOK_CAPTION_JOURNAL_REQUIRED');expect(run).not.toHaveBeenCalled();
});
