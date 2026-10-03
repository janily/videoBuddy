import {randomUUID} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {verifyPreviewPackage} from '../../src/services/video/preview/package';
import type {PreviewBundle} from '../../src/services/video/preview/bundle';
import type {ProjectControl} from '../../src/contracts/video/project';
import {assemblePictureSequence} from '../../src/services/video/media/picture-sequence';
import {composeVideo} from '../../src/services/video/media/compose';
import {inspectStereoTrackWav} from '../../src/services/video/audio/wav';
import type {DockerInvocation} from '../../src/services/video/media/docker-journal';

async function main(){
 if(!process.argv.includes('--render-journal'))throw Error('RENDER_JOURNAL_OPT_IN_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/approved-pictures-probe.json','utf8'));
 const original=new ProjectStore(new FileStore(source.root)),control=(await original.store.readFresh<ProjectControl>(`projects/${source.projectId}/control`)).value;
 const bundle=(await original.store.readFresh<PreviewBundle>(`projects/${source.projectId}/previews/${control.currentPreviewId}/manifest`)).value;
 const frozen=await verifyPreviewPackage(original,source.projectId,bundle,source.root),track=frozen.filmAudioTrack;
 if(!track||track.wav.channels!==2)throw Error('ARCHIVED_STEREO_TRACK_REQUIRED');
 const root=await mkdtemp(join(process.cwd(),'.video-local','render-journal-')),store=new FileStore(root),projectId=randomUUID(),operationId=randomUUID(),prefix=`projects/${projectId}/operations/${operationId}/media-effects`,journal={store,prefix};
 const env={...process.env,VIDEO_MEDIA_IMAGE_REF:'sha256:'+frozen.filmSpec.runtimeDigest,VIDEO_MEDIA_RUNTIME_DIGEST:frozen.filmSpec.runtimeDigest,VIDEO_MEDIA_TIMEOUT_SECONDS:'600'};
 let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('RENDER_JOURNAL_NETWORK_FORBIDDEN')};
 for(const shot of source.record.shots){const destination=join(root,'media',shot.stageKey,'output');await mkdir(destination,{recursive:true});await copyFile(join(source.root,'media',shot.stageKey,'output','picture.mp4'),join(destination,'picture.mp4'))}
 const trackDir=join(root,'audio','archived');await mkdir(trackDir,{recursive:true});const trackPath=join(trackDir,'track.wav');await copyFile(track.outputPath,trackPath);
 const wav=await inspectStereoTrackWav(trackPath,frozen.filmSpec.output.totalFrames*48000/frozen.filmSpec.output.fps,track.wav.silence);if(wav.sha256!==track.wav.sha256)throw Error('ARCHIVED_TRACK_CHANGED');
 let checks=0;const assertActive=async()=>{checks++;if(canonicalHash((await original.store.readFresh<ProjectControl>(`projects/${source.projectId}/control`)).value)!==canonicalHash(control))throw Error('SOURCE_CONTROL_CHANGED')};
 const input={projectId,revisionId:bundle.revisionId,shots:source.record.shots.map((shot:{shotId:string;startFrame:number;endFrame:number;stageKey:string;sha256:string})=>({shotId:shot.shotId,startFrame:shot.startFrame,endFrame:shot.endFrame,stageKey:shot.stageKey,sha256:shot.sha256})),width:frozen.filmSpec.output.width,height:frozen.filmSpec.output.height,fps:frozen.filmSpec.output.fps,runtimeDigest:frozen.filmSpec.runtimeDigest,fence:0};
 const picture=await assemblePictureSequence(root,input,env,{journal,assertActive});
 const spec={width:input.width,height:input.height,fps:input.fps,durationSec:picture.totalFrames/input.fps,bundleHash:bundle.bundleHash,fence:0},archivedTrack={...track,outputPath:trackPath,wav};
 const movie=await composeVideo(root,join(root,'picture-sequence',picture.stageKey),archivedTrack,[],null,spec,env,{journal,assertActive,producerReceipt:true});
 const keys=await store.listKeys(prefix,1),receipts=await Promise.all(keys.map(async key=>({key,...(await store.readFresh<DockerInvocation>(key)).value})));
 if(receipts.length!==2||receipts.some(value=>value.state!=='completed'))throw Error('RENDER_JOURNAL_INCOMPLETE');
 const coldJournal={store:new FileStore(root),prefix};
 const replayPicture=await assemblePictureSequence(root,input,env,{journal:coldJournal,assertActive,mustExist:true});
 const replayMovie=await composeVideo(root,join(root,'picture-sequence',picture.stageKey),archivedTrack,[],null,spec,env,{journal:coldJournal,assertActive,producerReceipt:true,mustExist:true});
 if(canonicalHash(picture)!==canonicalHash(replayPicture)||canonicalHash(movie)!==canonicalHash(replayMovie)||networkCalls)throw Error('RENDER_JOURNAL_REPLAY_CHANGED');
 for(const receipt of receipts)if(canonicalHash(receipt)!==canonicalHash({key:receipt.key,...(await coldJournal.store.readFresh<DockerInvocation>(receipt.key)).value}))throw Error('RENDER_JOURNAL_RECEIPT_CHANGED');
 const report={executedAt:new Date().toISOString(),status:'pass',root,projectId,operationId,sourceRoot:source.root,sourceBundleHash:bundle.bundleHash,checks,networkCalls,sourceControlUnchanged:true,sourceTrackSha256:wav.sha256,picture,movie,receipts,coldReplayIdentical:true,resultPublished:false,limits:'Isolated diagnostic copy of actual frozen 1080p pictures and archived stereo music/foley. Executes sequence and composition with persistent producer receipts, then cold read-only replay and independent full decode/loudness. No new approval, model call, narration ASR, cancellation, full visual/listening quality or delivery proof. All original failures and unknown provider calls remain unchanged.'};
 await writeFile('docs/engineering/evidence/render-journal-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'pass',root,checks,receipts:receipts.length,technicalQa:movie.technicalQa,coldReplayIdentical:true,networkCalls}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
