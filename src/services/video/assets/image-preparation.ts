import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import {sourceImageJob,guardSourceImageReceipt,guardSourceImageProof,type SourceImageProof} from '@/contracts/video/source-image';
import type {Environment} from '@/services/video/config/environment';
import {StoreConflict,StoreMissing,type AtomicStore} from '@/services/video/storage/atomic-store';
const Input=z.strictObject({projectId:z.uuid(),assetId:z.uuid(),sourceMime:z.enum(['image/png','image/jpeg','image/webp']),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),sourceBytes:z.number().int().positive().max(20*1024*1024)});
export type SourceImageInput=z.infer<typeof Input>;
/** The durable journal belongs to the caller's authorized operation, independent of execution transport. */
export interface SourceImageJournal {store:AtomicStore;prefix:string}
interface Invocation {schemaVersion:1;kind:'source_image';argumentsSha256:string;state:'started'|'completed';outputKey?:string;proof?:SourceImageProof}
type Options={env?:Environment;journal:SourceImageJournal;assertActive:()=>Promise<void>};
async function directory(path:string){const stat=await lstat(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('SOURCE_IMAGE_CHANGED')}
function identity(root:string,raw:SourceImageInput,journal:SourceImageJournal){
 const parsed=Input.safeParse(raw);if(!parsed.success||!isAbsolute(root)||/[\u0000-\u001f]/.test(root))throw Error('SOURCE_IMAGE_INPUT_INVALID');
 const input=parsed.data,scope=journal.prefix.split('/');
 if(scope.length!==5||scope[0]!=='projects'||scope[1]!==input.projectId||scope[2]!=='operations'||!z.uuid().safeParse(scope[3]).success||scope[4]!=='media-effects')throw Error('SOURCE_IMAGE_INPUT_INVALID');
 const operationId=scope[3],argumentsSha256=canonicalHash({kind:'source_image',operationId,input});
 return{input,operationId,argumentsSha256,key:journal.prefix+'/'+argumentsSha256};
}
async function originalBytes(root:string,input:SourceImageInput){
 await directory(root);await directory(join(root,'assets'));await directory(join(root,'assets',input.projectId));
 const file=await open(join(root,'assets',input.projectId,input.assetId+'.bin'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==input.sourceBytes)throw Error('IMAGE_INPUT_CHANGED');const data=await file.readFile();if(data.length!==input.sourceBytes||createHash('sha256').update(data).digest('hex')!==input.sourceSha256)throw Error('IMAGE_INPUT_CHANGED')}finally{await file.close()}
}
async function outputBytes(root:string,key:string,receipt:Extract<ReturnType<typeof guardSourceImageReceipt>,{status:'pass'}>){
 if(!/^[a-f0-9]{64}$/.test(key))throw Error('SOURCE_IMAGE_PROOF_CHANGED');
 const dir=join(root,'media','image-preparation',key);
 for(const path of [root,join(root,'media'),join(root,'media','image-preparation'),dir])await directory(path);
 const file=await open(join(dir,'view.png'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==receipt.bytes)throw Error('SOURCE_IMAGE_CHANGED');const data=await file.readFile();if(data.length<24||data.length!==receipt.bytes||createHash('sha256').update(data).digest('hex')!==receipt.sha256||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.toString('ascii',12,16)!=='IHDR'||data.readUInt32BE(16)!==receipt.width||data.readUInt32BE(20)!==receipt.height)throw Error('SOURCE_IMAGE_CHANGED');return data}finally{await file.close()}
}
function completed(raw:Invocation,argumentsSha256:string){
 if(raw.schemaVersion!==1||raw.kind!=='source_image'||raw.argumentsSha256!==argumentsSha256)throw Error('SOURCE_IMAGE_PROOF_CHANGED');
 if(raw.state!=='completed')throw Error('MEDIA_STOP_UNKNOWN');
 if(!raw.proof||!raw.outputKey||!/^[a-f0-9]{64}$/.test(raw.outputKey))throw Error('SOURCE_IMAGE_PROOF_CHANGED');
 return{proof:raw.proof,outputKey:raw.outputKey};
}
export async function prepareSourceImage(root:string,raw:SourceImageInput,options:Options){
 await options.assertActive();const {input,operationId,argumentsSha256,key}=identity(root,raw,options.journal);
 // Recovery consults the operation receipt before loading any native runtime.
 try{const saved=completed((await options.journal.store.readFresh<Invocation>(key)).value,argumentsSha256);return readSourceImageView(root,input,saved.proof,options)}catch(error){if(!(error instanceof StoreMissing))throw error}
 await originalBytes(root,input);await options.assertActive();
 const {createMediaRuntime}=await import('@/services/video/media/configuration');
 const runtime=await createMediaRuntime(root,options.env||process.env,{projectId:input.projectId,operationId});
 try{
  await options.assertActive();
  const job=sourceImageJob({...input,schemaVersion:1,runtimeDigest:runtime.runtimeDigest,producerSha256:runtime.version.renderer,maxEdge:2048});
  try{await options.journal.store.create<Invocation>(key,{schemaVersion:1,kind:'source_image',argumentsSha256,state:'started'})}
  catch(error){if(!(error instanceof StoreConflict))throw error;const saved=completed((await options.journal.store.readFresh<Invocation>(key)).value,argumentsSha256);return readSourceImageView(root,input,saved.proof,options)}
  await options.assertActive();
  // Revoke in-flight native work when the owning asset/operation disappears.
  const abort=new AbortController();let fenceError:unknown,poll=Promise.resolve();
  const timer=setInterval(()=>{poll=poll.then(()=>options.assertActive()).catch(error=>{fenceError=error;abort.abort()})},100);
  let result:Awaited<ReturnType<typeof runtime.prepareImage>>;
  try{result=await runtime.prepareImage({...input,sourcePath:join(root,'assets',input.projectId,input.assetId+'.bin'),maxEdge:2048},{signal:abort.signal})}
  catch(error){throw fenceError??error}
  finally{clearInterval(timer);await poll}
  if(fenceError)throw fenceError;
  if(result.runtimeDigest!==job.runtimeDigest||!/^[a-f0-9]{64}$/.test(result.key)||result.outputPath!==join(root,'media','image-preparation',result.key,'view.png'))throw Error('SOURCE_IMAGE_PROOF_CHANGED');
  const receipt=guardSourceImageReceipt({schemaVersion:1,status:'pass',jobSha256:job.jobSha256,assetId:input.assetId,sourceSha256:input.sourceSha256,runtimeDigest:job.runtimeDigest,producerSha256:job.producerSha256,sourceMime:input.sourceMime,sourceBytes:input.sourceBytes,encodedWidth:result.encodedWidth,encodedHeight:result.encodedHeight,orientedWidth:result.orientedWidth,orientedHeight:result.orientedHeight,width:result.width,height:result.height,mime:result.mime,sha256:result.sha256,bytes:result.bytes,transform:result.transform,coordinates:result.coordinates},job);
  if(receipt.status!=='pass')throw Error('SOURCE_IMAGE_PROOF_CHANGED');
  const proof=guardSourceImageProof({schemaVersion:1,operationId,argumentsSha256,job,receipt},input);
  await originalBytes(root,input);const data=await outputBytes(root,result.key,receipt);await options.assertActive();
  const record=await options.journal.store.readFresh<Invocation>(key);
  if(record.value.state!=='started'||record.value.argumentsSha256!==argumentsSha256)throw Error('SOURCE_IMAGE_PROOF_CHANGED');
  await options.journal.store.cas<Invocation>(key,record.etag,{schemaVersion:1,kind:'source_image',argumentsSha256,state:'completed',outputKey:result.key,proof});
  return{job,receipt,path:result.outputPath,data,proof};
 }finally{await runtime.close()}
}
/** Read-only recovery verifies authorized original bytes, completed receipt and PNG. It never creates a runtime. */
export async function readSourceImageView(root:string,raw:SourceImageInput,rawProof:SourceImageProof,options:Pick<Options,'journal'|'assertActive'>){
 await options.assertActive();const {input,operationId,argumentsSha256,key}=identity(root,raw,options.journal),proof=guardSourceImageProof(rawProof,input);
 if(proof.operationId!==operationId||proof.argumentsSha256!==argumentsSha256)throw Error('SOURCE_IMAGE_PROOF_CHANGED');
 await originalBytes(root,input);
 const record=completed((await options.journal.store.readFresh<Invocation>(key)).value,argumentsSha256);
 if(canonicalHash(record.proof)!==canonicalHash(proof))throw Error('SOURCE_IMAGE_PROOF_CHANGED');
 const receipt=guardSourceImageReceipt(proof.receipt,proof.job);if(receipt.status!=='pass')throw Error('SOURCE_IMAGE_PROOF_CHANGED');
 const data=await outputBytes(root,record.outputKey,receipt);await options.assertActive();
 return{job:proof.job,receipt,path:join(root,'media','image-preparation',record.outputKey,'view.png'),data,proof};
}
