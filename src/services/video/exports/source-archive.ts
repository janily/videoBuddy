import {bookFontReceiptKey} from '../audio/book-font-receipt';
import {trustedStyleFont} from '../media/font-catalog';
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {readPreviewBundle} from '@/services/video/preview/commit';
import {verifyPreviewPackage} from '@/services/video/preview/package';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import {WordTimingManifestSchema} from '@/services/video/audio/narration-package';
import {speechReviewExportAudit} from '@/services/video/audio/spoken-review';
import {archiveByteLimit,encodeSourceArchive,type SourceArchiveEntry} from './source-zip';

const runtimeFiles=['Dockerfile','package.json','package-lock.json','LICENSES.md','render.mjs','runner.py','sound.py','master.py','analyze-pdf.mjs'] as const;
function sha(bytes:Buffer){return createHash('sha256').update(bytes).digest('hex')}
async function safeFile(base:string,key:string,limit:number){
 const baseReal=await realpath(base),path=join(base,key),actual=await realpath(path);
 if(!actual.startsWith(baseReal+'/'))throw Error('ARCHIVE_SOURCE_CHANGED');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await file.stat();
  if(!before.isFile()||before.nlink!==1||before.size>limit)throw Error('ARCHIVE_SOURCE_CHANGED');
  const bytes=await file.readFile(),after=await file.stat();
  if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.nlink!==1)throw Error('ARCHIVE_SOURCE_CHANGED');
  return bytes;
 }finally{await file.close()}
}
function references(value:unknown,found:ObjectRef[]=[]):ObjectRef[]{
 if(!value||typeof value!=='object')return found;
 const ref=ObjectRefSchema.safeParse(value);if(ref.success){found.push(ref.data);return found}
 for(const child of Object.values(value))references(child,found);return found;
}
/** Builds private bytes only. Publication/download eligibility remains the result QA gate.
 * Never enumerates the workspace, state indexes, messages, environment or model cache. */
export async function prepareFrozenSourceArchive(projects:ProjectStore,owner:string,projectId:string,previewId:string,root:string){
 if(!isAbsolute(root)||![projectId,previewId].every(id=>z.uuid().safeParse(id).success))throw Error('VALIDATION_FAILED');
 const control=await projects.access(owner,projectId),bundle=await readPreviewBundle(projects,projectId,previewId,root),frozen=await verifyPreviewPackage(projects,projectId,bundle,root);
 // A usage right is insufficient evidence of a redistribution right. Refuse rather
 // than silently omit referenced user assets or expose them without authorization.
 if(frozen.assetManifest.assets.length)throw Error('ARCHIVE_ASSET_REDISTRIBUTION_REQUIRED');
 const revision=`projects/${projectId}/revisions/${bundle.revisionId}/`,understanding=`projects/${projectId}/understanding/`;
 const entries:SourceArchiveEntry[]=[],seen=new Map<string,string>();let total=0;
 function add(path:string,bytes:Buffer){total+=bytes.length;if(total>archiveByteLimit||entries.length>=2047)throw Error('ARCHIVE_INVALID');entries.push({path,bytes})}
 const pending:ObjectRef[]=[bundle.filmSpecRef];
 while(pending.length){
  const ref=pending.shift()!;
  if(seen.has(ref.key)){if(seen.get(ref.key)!==canonicalHash(ref))throw Error('ARCHIVE_SOURCE_CHANGED');continue}
  if(!/^[A-Za-z0-9/_-]+(?:\.wav)?$/.test(ref.key)||ref.key.split('/').some(part=>!part)||!ref.key.startsWith(revision)&&!ref.key.startsWith(understanding)||ref.bytes>archiveByteLimit-total)throw Error('ARCHIVE_SOURCE_CHANGED');
  seen.set(ref.key,canonicalHash(ref));
  let bytes:Buffer,path:string;
  if(ref.mime==='application/json'){
   const value=(await projects.store.readFresh(ref.key)).value;bytes=Buffer.from(canonicalJson(value));
   path=ref.key===bundle.filmSpecRef.key?'film.json':'state/'+ref.key+'.json';
   if(value&&typeof value==='object'&&'html' in value&&typeof value.html==='string')add('source/'+ref.sha256+'.html',Buffer.from(value.html));
   const narrationWords=ref.key.startsWith(revision+'narration-words/')?WordTimingManifestSchema.safeParse(value):undefined;
   if(narrationWords?.success&&narrationWords.data.speechReview){
    const {ref:reviewRef,...publicEvidence}=narrationWords.data.speechReview;
    const auditPath=`audit/speech-reviews/${reviewRef.sha256}.json`;
    if(!entries.some(entry=>entry.path===auditPath))add(auditPath,Buffer.from(canonicalJson(await speechReviewExportAudit(projects.store,projectId,reviewRef))));
    // Preserve original JSON bytes/hashes, but do not traverse the private
    // authority reference into owner data or the user's chat history.
    pending.push(...references({...narrationWords.data,speechReview:publicEvidence}));
   }else pending.push(...references(value));
  }else if(ref.mime==='audio/wav'&&ref.key.startsWith(revision)&&/\/(?:audio-files|sound-files)\/[a-f0-9]{64}\.wav$/.test(ref.key)){
   bytes=await safeFile(join(root,'objects'),ref.key,archiveByteLimit-total);path='objects/'+ref.key;
  }else throw Error('ARCHIVE_SOURCE_CHANGED');
  if(bytes.length!==ref.bytes||sha(bytes)!==ref.sha256)throw Error('ARCHIVE_SOURCE_CHANGED');
  add(path,bytes);
 }
 if(frozen.audioExecution)for(const kind of ['sound','master'] as const){
  const key=revision+'audio-run-receipts/'+kind+'/'+frozen.audioExecution[kind].stageKey;
  add('state/'+key+'.json',Buffer.from(canonicalJson((await projects.store.readFresh(key)).value)));
 }
 for(const file of runtimeFiles)add('runtime/media/'+file,await safeFile(join(process.cwd(),'runtime/media'),file,archiveByteLimit-total));
 const bookFont=frozen.timing.font?.family==='Crayon Book Handwriting'?frozen.timing.font:null;
 const captionFontReceipt=frozen.sourceManifest.captionStyles.length?(bookFont?bookFontReceiptKey(frozen.filmSpec.runtimeDigest):`runtime-receipts/${frozen.filmSpec.runtimeDigest}/subtitle-font`):null;
 if(captionFontReceipt)add('state/'+captionFontReceipt+'.json',Buffer.from(canonicalJson((await projects.store.readFresh(captionFontReceipt)).value)));
 if(bookFont){
  const fonts=bookFont.faces.map(face=>{const locked=trustedStyleFont(face.id);return{...face,runtimePath:locked.runtimePath,sourceUrl:locked.font.url,licenseUrl:locked.licenseFile.url,metadataUrl:locked.metadata.url}});
  add('font-fetch-manifest.json',Buffer.from(canonicalJson({schemaVersion:2,fontBinariesIncluded:false,runtimeDigest:frozen.filmSpec.runtimeDigest,captionReceiptKey:captionFontReceipt,rendererSha256:bookFont.rendererSha256,producerSha256:bookFont.producerSha256,fonts,verification:'Acquire exactly the locked files and pinned media runtime. Verify font, notice, metadata and renderer digests before rebuilding; no font or model binaries are bundled.'})));
  for(const name of ['book-caption.mjs','book-caption-producer.mjs','fonts.lock.json','FONTS.md']){
   const bytes=await safeFile(join(process.cwd(),'runtime/media'),name,1048576);
   const expected=name==='book-caption.mjs'?bookFont.rendererSha256:name==='book-caption-producer.mjs'?bookFont.producerSha256:null;
   if(expected&&createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('SOURCE_CAPTION_RUNTIME_CHANGED');
   add('runtime/media/'+name,bytes);
  }
 }else add('font-fetch-manifest.json',Buffer.from(canonicalJson({schemaVersion:1,fontBinariesIncluded:false,runtimeDigest:frozen.filmSpec.runtimeDigest,fonts:[{family:'Noto Sans CJK',runtimePath:'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',frozenCaptionSha256s:bundle.renderInputs.fontSha256s,captionReceiptKey:captionFontReceipt,sourceUrl:'https://github.com/notofonts/noto-cjk',licenseUrl:'https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE',acquisition:'Obtain Noto Sans CJK through the official download guides or the fonts-noto-cjk package in the pinned Debian media image. Read the applicable license before installation. Match every frozen caption SHA-256; a current upstream download may have different bytes.',verification:'Caption hashes are frozen only when captions are present. No independent digest is asserted for browser fallback fonts; acquire the original pinned image for its font environment.'}]})));
 add('TREATMENT.json',Buffer.from(canonicalJson(frozen.treatment)));
 add('timeline.json',Buffer.from(canonicalJson(frozen.timeline)));
 add('CREDITS.json',Buffer.from(canonicalJson({schemaVersion:1,sources:frozen.audioManifest.sources,runtimeLicenseFile:'runtime/media/LICENSES.md',redistribution:'No user assets included; none are referenced.',fontBinariesIncluded:false,modelWeightsIncluded:false})));
 add('runtime-lock.json',Buffer.from(canonicalJson({schemaVersion:1,mediaImageDigest:frozen.filmSpec.runtimeDigest,seed:frozen.filmSpec.seed,profile:frozen.filmSpec.output,implementationFiles:'Bundled runtime source is the current reference implementation; use the pinned image for the original execution environment.'})));
 add('REBUILD.md',Buffer.from('# Frozen VideoBuddy source project\n\nfilm.json is the root. JSON ObjectRefs are in state/<key>.json (the root film reference is film.json); WAV ObjectRefs are in objects/<key>. Each reference preserves its original SHA-256 and byte count. Private speech-review authority ObjectRefs are intentionally external: audit/speech-reviews/<confirmation-sha>.json supplies a non-authorizing listening audit, without owner credentials or chat messages. It cannot grant a new review or production approval. source/ contains the shot HTML copied from the frozen source documents. timeline.json and TREATMENT.json are convenience copies.\n\nInspect runtime-lock.json for the pinned media image, seed and frame profile. The runtime/media source, dependency lock and license notice are included as a reference implementation; their identity with a historical image has not been independently attested. Obtain the pinned image to reproduce the original renderer. Generated shot code must run in an isolated, credential-free Chromium container with network access disabled; do not execute it on the web host. Use the sourceModule references and startFrame/endFrame in the timeline, then compose the pictures with the frozen audio tracks and caption timing.\n\nThis is a source archive, not a quality approval or a final video. Font binaries, voice/ASR model weights, credentials and caches are excluded. Install dependencies and acquire those resources under their licenses if rerendering requires them. The archive does not promise a single-click or fully offline rebuild. No new model calls are required to inspect these frozen sources.\n'));
 const manifest={schemaVersion:1,projectId,revisionId:bundle.revisionId,previewId,bundleHash:bundle.bundleHash,entries:entries.map(entry=>({path:entry.path,bytes:entry.bytes.length,sha256:sha(entry.bytes)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
 add('archive-manifest.json',Buffer.from(canonicalJson(manifest)));
 const bytes=encodeSourceArchive(entries),after=await projects.access(owner,projectId);
 if(after.consentEpoch!==control.consentEpoch||canonicalHash(await readPreviewBundle(projects,projectId,previewId,root))!==canonicalHash(bundle))throw Error('ARCHIVE_SOURCE_CHANGED');
 return{bytes,sha256:sha(bytes),manifest};
}
