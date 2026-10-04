import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {z} from 'zod';

// Runs inside the pinned producer. A host-side probe cannot attest which
// source track was mixed into an otherwise technically valid cached movie.
export const compositionProducer=String.raw`
import hashlib,json,os,subprocess,sys
job=json.loads(sys.argv[1])
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(1048576),b''):h.update(part)
 return h.hexdigest()
for name,path in [('pictureSha256','/input/picture.mp4'),('trackSha256','/input/track.wav'),('srtSha256','/input/subtitles.srt')]:
 if job[name] is not None and digest(path)!=job[name]:raise RuntimeError('COMPOSITION_SOURCE_CHANGED')
subprocess.run(job.pop('argv'),check=True)
job.update(schemaVersion=1,outputSha256=digest('/output/final.mp4'),outputBytes=os.stat('/output/final.mp4').st_size)
with open('/output/receipt.tmp','x') as f:
 json.dump(job,f);f.flush();os.fsync(f.fileno())
os.replace('/output/receipt.tmp','/output/composition-receipt.json')
fd=os.open('/output',os.O_RDONLY);os.fsync(fd);os.close(fd)
`;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema=z.strictObject({schemaVersion:z.literal(1),stageKey:hash,pictureSha256:hash,trackSha256:hash,srtSha256:hash.nullable(),outputSha256:hash,outputBytes:z.number().int().positive()});
export async function verifyCompositionReceipt(path:string,expected:{stageKey:string;pictureSha256:string;trackSha256:string;srtSha256:string|null},output:{sha256:string;bytes:number}){
 let raw:string;
 try{
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>4096)throw Error('COMPOSITION_STAGE_UNKNOWN');raw=await file.readFile('utf8')}finally{await file.close()}
 }catch{throw Error('COMPOSITION_STAGE_UNKNOWN')}
 const receipt=receiptSchema.safeParse(JSON.parse(raw));if(!receipt.success)throw Error('COMPOSITION_STAGE_UNKNOWN');
 const value=receipt.data;
 for(const field of ['stageKey','pictureSha256','trackSha256','srtSha256'] as const)if(value[field]!==expected[field])throw Error('COMPOSITION_SOURCE_CHANGED');
 if(value.outputSha256!==output.sha256||value.outputBytes!==output.bytes)throw Error('COMPOSITION_OUTPUT_CHANGED');
}

export const bookCompositionProducer=String.raw`
import hashlib,json,os,subprocess,sys
job=json.loads(sys.argv[1])
def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(1048576),b''):h.update(part)
 return h.hexdigest()
for name,path in [('pictureSha256','/input/picture.mp4'),('trackSha256','/input/track.wav'),('srtSha256','/input/subtitles.srt'),('captionLayerSha256','/input/captions.mov')]:
 if digest(path)!=job[name]:raise RuntimeError('COMPOSITION_SOURCE_CHANGED')
subprocess.run(job.pop('argv'),check=True)
job.update(schemaVersion=2,outputSha256=digest('/output/final.mp4'),outputBytes=os.stat('/output/final.mp4').st_size)
with open('/output/receipt.tmp','x') as f:
 json.dump(job,f);f.flush();os.fsync(f.fileno())
os.replace('/output/receipt.tmp','/output/composition-receipt.json')
fd=os.open('/output',os.O_RDONLY);os.fsync(fd);os.close(fd)
print(json.dumps(job))
`;
const bookReceiptSchema=receiptSchema.extend({schemaVersion:z.literal(2),srtSha256:hash,captionLayerSha256:hash});
export async function verifyBookCompositionReceipt(path:string,expected:{stageKey:string;pictureSha256:string;trackSha256:string;srtSha256:string|null;captionLayerSha256:string},output:{sha256:string;bytes:number},nativeOutput:string){
 let value;
 try{const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size>4096)throw Error();const buffer=Buffer.alloc(4097),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead!==info.size||bytesRead>4096)throw Error();value=bookReceiptSchema.parse(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')))}finally{await file.close()}}catch{throw Error('COMPOSITION_STAGE_UNKNOWN')}
 let native;try{native=bookReceiptSchema.parse(JSON.parse(nativeOutput))}catch{throw Error('COMPOSITION_PRODUCER_UNKNOWN')}
 if(JSON.stringify(native)!==JSON.stringify(value))throw Error('COMPOSITION_RECEIPT_CHANGED');
 for(const field of ['stageKey','pictureSha256','trackSha256','srtSha256','captionLayerSha256'] as const)if(value[field]!==expected[field])throw Error('COMPOSITION_SOURCE_CHANGED');
 if(value.outputSha256!==output.sha256||value.outputBytes!==output.bytes)throw Error('COMPOSITION_OUTPUT_CHANGED');
}
