import {z} from 'zod';
import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import {AudioPlanSchema} from '@/contracts/video/audio-plan';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {loadAudioExecution} from '@/services/video/audio/execution-package';
import {readNarrationJson} from '@/services/video/audio/narration-package';

export const MusicGainOperationSchema=z.strictObject({field:z.literal('musicGainDb'),value:z.number().min(-6).max(0),valueMode:z.enum(['relative','absolute']).optional()}).refine(operation=>operation.valueMode!=='relative'||operation.value<0);
// Reads actual archived tracks and fixed producer receipts; this is not an owner
// check or permission to execute. The caller must independently authorize the result.
export async function readMusicGainBaseline(store:AtomicStore,root:string,projectId:string,revisionId:string,executionRef:ObjectRef,planRef:ObjectRef,timingDraftRef:ObjectRef){
 const refs=[executionRef,planRef,timingDraftRef].map(ref=>ObjectRefSchema.parse(ref));
 const loaded=await loadAudioExecution(store,root,projectId,revisionId,refs[0],refs[1],refs[2]);
 const plan=AudioPlanSchema.parse(await readNarrationJson(store,refs[1],`projects/${projectId}/revisions/${revisionId}/audio-plan/`));
 if(!plan.music.length||loaded.package.tracks.music.wav.silence)throw Error('MUSIC_NOT_PRESENT');
 const data=loaded.package;
 return{projectId,revisionId,executionRef:refs[0],planRef:refs[1],timingDraftRef:refs[2],runtimeDigest:data.runtimeDigest,musicGainDb:data.schemaVersion===3?data.master.musicGainDb:0,totalSamples:data.totalSamples,trackSha256:{voice:data.tracks.voice.wav.sha256,music:data.tracks.music.wav.sha256,foley:data.tracks.foley.wav.sha256,mix:data.tracks.mix.wav.sha256}};
}
export function resolveMusicGain(originalMusicGainDb:number,rawOperation:unknown){
 if(!z.number().min(-6).max(0).safeParse(originalMusicGainDb).success)throw Error('MUSIC_GAIN_BASELINE_INVALID');
 const parsed=MusicGainOperationSchema.safeParse(rawOperation);if(!parsed.success)throw Error('CHANGE_PLAN_INVALID');const operation=parsed.data;
 const value=operation.valueMode==='relative'?originalMusicGainDb+operation.value:operation.value;
 if(!Number.isFinite(value)||value<-6||value>0)throw Error('CHANGE_PREVIEW_REQUIRED');
 return{originalMusicGainDb,musicGainDb:value,deltaDb:value-originalMusicGainDb,scope:'entire_film' as const};
}
