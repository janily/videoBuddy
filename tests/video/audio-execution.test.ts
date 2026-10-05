import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {AudioPlanSchema} from '@/contracts/video/audio-plan';
import {TimingDraftSchema} from '@/services/video/preview/timing-draft';
import {canonicalJson,canonicalHash} from '@/services/video/domain/hash';
import {probeTrackWav,probeStereoTrackWav} from '@/services/video/audio/wav';
import {compileSoundJob} from '@/services/video/audio/sound';
import {masterMixFilter} from '@/services/video/audio/master';
import {archiveAudioExecution,loadAudioExecution} from '@/services/video/audio/execution-package';
import {archiveSynthSources} from '@/services/video/audio/execution-package';
import {seedPreviewBundle} from './fixtures/preview-package';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import {compileAudioCues} from '@/contracts/video/audio-plan';
import {getStyle} from '@/services/video/styles/registry';
import {revisionSeed} from '@/services/video/timeline/seed';
import type {FilmSpec} from '@/contracts/video/film';
import {verifyPostMixNoNarration} from '@/services/video/audio/postmix-asr';
import {readMusicGainBaseline} from '@/services/video/revisions/music-gain';

function pcm(channels:1|2,active:boolean){
 const samples=960000,bytes=Buffer.alloc(44+samples*channels*4);
 bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(3,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(48000*channels*4,28);bytes.writeUInt16LE(channels*4,32);bytes.writeUInt16LE(32,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 if(active)for(let i=0;i<48000*channels;i++)bytes.writeFloatLE(0.1*Math.sin(i/10),44+i*4);
 return bytes;
}
async function fixture(root:string,musicGainDb?:number,speechPriority?:'voice-first-v1'){
 const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),revisionId=randomUUID(),prefix='projects/'+projectId+'/revisions/'+revisionId,runtimeDigest='a'.repeat(64);
 const voiceBytes=pcm(1,Boolean(speechPriority)),musicBytes=pcm(2,true),foleyBytes=pcm(2,false),voicePath=join(root,'audio','fixture','track.wav');
 await mkdir(dirname(voicePath),{recursive:true});await writeFile(voicePath,voiceBytes);
 const voiceWav=probeTrackWav(voiceBytes,960000,true),musicWav=probeStereoTrackWav(musicBytes,960000,false),foleyWav=probeStereoTrackWav(foleyBytes,960000,true);
 const timing=TimingDraftSchema.parse({schemaVersion:1,briefVersion:1,styleSlug:'crayon-book',styleRulesHash:getStyle('crayon-book').rulesHash,durationMs:20000,totalFrames:480,fps:24,sampleRate:48000,shots:[{id:'shot',startFrame:0,endFrame:480,visualIntent:'展示主题',factIds:['fact-0']}],narration:speechPriority?[{lineId:'line-1',spokenText:'Hello',displayText:'Hello',expectedAsrText:'Hello',startSample:0,endSample:48000,voiceSha256:voiceWav.sha256,voiceRuntimeDigest:runtimeDigest,asrRuntimeDigest:runtimeDigest}]:[],captions:[],track:{outputPath:voicePath,sha256:voiceWav.sha256,samples:960000,runtimeDigest,silence:voiceWav.silence},font:null,qualityStatus:'semantic_not_checked'});
 const timingRef=await projects.index.immutable(prefix+'/timing-draft',timing);
 const plan=AudioPlanSchema.parse({schemaVersion:1,briefVersion:1,styleSlug:'crayon-book',styleRulesHash:getStyle('crayon-book').rulesHash,timingDraftHash:timingRef.sha256,seed:revisionSeed(projectId,revisionId),sections:[{id:'all',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],cues:[{id:'hit',sourceShotId:'shot',requestedTimeUs:0,alignmentPolicy:'audio'}],sources:[{id:'test-string',kind:'synthesis',description:'test fixture',material:'synthetic',recipe:{instrument:'sine',frequencyHz:220,attackMs:5,releaseMs:100}}],music:[{eventId:'note',cueId:'hit',source:'test-string',durationSamples:48000,gainDb:-20,pan:0}],foley:[],intentionalSilenceRanges:[],mix:{targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2,voiceGainDb:0,duck:{thresholdDb:-24,ratio:4,attackMs:10,releaseMs:180}},reasoning:'Package unit fixture, not evidence of rendering/listening.'});
 const planRef=await projects.index.immutable(prefix+'/audio-plan',plan),job=compileSoundJob(plan,20000,24);
 const toolHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
 const soundTool=toolHash(await readFile('runtime/media/sound.py')),masterTool=canonicalHash([toolHash(await readFile('runtime/media/master.py')),soundTool]);
 const soundKey=canonicalHash({job,runtimeDigest,toolSha256:soundTool,layout:'output-only-v2'});
 const musicPath=join(root,'sound',soundKey,'output','music.wav'),foleyPath=join(dirname(musicPath),'foley.wav');
 await mkdir(dirname(musicPath),{recursive:true});await writeFile(musicPath,musicBytes);await writeFile(foleyPath,foleyBytes);
 const stems={stageKey:soundKey,planSha256:planRef.sha256,runtimeDigest,toolSha256:soundTool,music:{outputPath:musicPath,wav:musicWav},foley:{outputPath:foleyPath,wav:foleyWav},qualityStatus:'listening_not_checked' as const};
 const doc={schemaVersion:speechPriority?3:musicGainDb===undefined?1:2,...(speechPriority?{speechPriority}:{}),...(musicGainDb===undefined?{}:{musicGainDb}),planSha256:planRef.sha256,samples:960000,hasVoice:!voiceWav.silence,mix:plan.mix,filter:masterMixFilter(plan.mix,960000,!voiceWav.silence,musicGainDb,speechPriority),inputSha256:{voice:voiceWav.sha256,music:musicWav.sha256,foley:foleyWav.sha256}};
 const masterKey=canonicalHash({document:doc,runtimeDigest,toolSha256:masterTool}),masterPath=join(root,'audio-master',masterKey,'output','master.wav');
 const mixBytes=Buffer.from(musicBytes);if(musicGainDb!==undefined)for(let offset=44;offset<mixBytes.length;offset+=4)mixBytes.writeFloatLE(mixBytes.readFloatLE(offset)*10**(musicGainDb/20),offset);
 const mixWav=probeStereoTrackWav(mixBytes,960000,false);
 await mkdir(dirname(masterPath),{recursive:true});await writeFile(masterPath,mixBytes);
 await writeFile(join(root,'sound',soundKey,'job.json'),canonicalJson(job));
 await writeFile(join(dirname(musicPath),'state.json'),JSON.stringify({schemaVersion:1,jobSha256:canonicalHash(job),outputs:{music:musicWav.sha256,foley:foleyWav.sha256}}));
 await writeFile(join(root,'audio-master',masterKey,'job.json'),canonicalJson(doc));
 await writeFile(join(dirname(masterPath),'state.json'),JSON.stringify({schemaVersion:1,jobSha256:canonicalHash(doc),outputSha256:mixWav.sha256}));
 const narration={outputPath:voicePath,runtimeDigest,wav:voiceWav,kind:'narration_only' as const,qaStatus:'not_checked' as const};
 const master={stageKey:masterKey,...(speechPriority?{speechPriority}:{}),...(musicGainDb===undefined?{}:{musicGainDb}),planSha256:planRef.sha256,toolSha256:masterTool,voiceSha256:voiceWav.sha256,musicSha256:musicWav.sha256,foleySha256:foleyWav.sha256,track:{outputPath:masterPath,runtimeDigest,wav:mixWav,kind:'film_mix' as const,qaStatus:'not_checked' as const},qualityStatus:'listening_not_checked' as const};
 return {projects,projectId,revisionId,prefix,plan,planRef,timing,timingRef,narration,stems,master};
}
it('archives all four actual buses and reloads with no disposable audio directories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-audio-package-'));
 try{
  const f=await fixture(root);
  const ref=await archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,f.master);
  const before=await loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef);
  expect(before.package.qualityStatus).toBe('listening_not_checked');
  expect(before.track.wav.channels).toBe(2);
  expect(before.package.tracks.voice.wav.peakDbfs).toBeNull();
  expect((await readMusicGainBaseline(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef)).musicGainDb).toBe(0);
  const moviePath=join(root,'composition','unit','output','final.mp4'),movie=Buffer.alloc(2048,1);
  await mkdir(dirname(moviePath),{recursive:true});await writeFile(moviePath,movie);
  const film={outputPath:moviePath,sha256:createHash('sha256').update(movie).digest('hex'),durationMs:20000,technicalQa:'pass' as const};
  // Opaque unit bytes test only the frozen-voice applicability seam, not video QA or listening.
  const applicability=await verifyPostMixNoNarration(f.projects.store,root,film,f.projectId,f.revisionId,ref,f.planRef,f.timingRef);
  expect(applicability).toMatchObject({status:'not_applicable',reason:'no_narration',executionSha256:ref.sha256,lines:[]});
  for(const name of ['audio','sound','audio-master'])await rm(join(root,name),{recursive:true});
  const after=await loadAudioExecution(new FileStore(root),root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef);
  expect(after).toEqual(before);
  await writeFile(after.track.outputPath,'corrupt');
  await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('rejects re-signed mix changes, redirected tracks, false voice silence and symlink sources',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-audio-package-'));
 try{
  const f=await fixture(root),ref=await archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,f.master);
  const loaded=await loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef),data=loaded.package;
  const changedPlanRef=await f.projects.index.immutable(f.prefix+'/audio-plan',{...f.plan,mix:{...f.plan.mix,voiceGainDb:1}});
  await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,ref,changedPlanRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
  const wrong=await f.projects.index.immutable(f.prefix+'/audio-execution',{...data,tracks:{...data.tracks,mix:{...data.tracks.mix,audioRef:{...data.tracks.mix.audioRef,key:data.tracks.mix.audioRef.key.replace(f.revisionId,randomUUID())}}}});
  await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,wrong,f.planRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
  const falseSilence=await f.projects.index.immutable(f.prefix+'/audio-execution',{...data,tracks:{...data.tracks,voice:{...data.tracks.voice,wav:{...data.tracks.voice.wav,silence:false}}}});
  await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,falseSilence,f.planRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
  const changed=await readFile(f.master.track.outputPath);changed.writeFloatLE(0.2,44);
  const changedWav=probeStereoTrackWav(changed,960000,false),changedObject={key:f.prefix+'/sound-files/'+changedWav.sha256+'.wav',sha256:changedWav.sha256,bytes:changedWav.bytes,mime:'audio/wav'};
  await writeFile(join(root,'objects',changedObject.key),changed);
  const receipts=(await f.projects.store.readFresh<{schemaVersion:number;kind:string;soundState:unknown;masterState:{schemaVersion:number;jobSha256:string;outputSha256:string}}>(data.receiptsRef.key)).value;
  const forgedReceiptsRef=await f.projects.index.immutable(f.prefix+'/audio-receipts',{...receipts,masterState:{...receipts.masterState,outputSha256:changedWav.sha256}});
  const forgedRef=await f.projects.index.immutable(f.prefix+'/audio-execution',{...data,receiptsRef:forgedReceiptsRef,tracks:{...data.tracks,mix:{audioRef:changedObject,wav:changedWav}}});
  // Even a re-signed nonzero output and matching re-signed receipt cannot redirect the fixed run slot.
  await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,forgedRef,f.planRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
  await rm(f.master.track.outputPath);await symlink(f.stems.music.outputPath,f.master.track.outputPath);
  await expect(archiveAudioExecution(f.projects,root,f.projectId,randomUUID(),f.planRef,f.timingRef,f.narration,f.stems,f.master)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('independently binds a musical FilmSpec to executed bytes and refuses removal of execution provenance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-film-audio-execution-'));
 try{
  const f=await fixture(root),index=f.projects.index;
  const bundle=await seedPreviewBundle(f.projects,{projectId:f.projectId,revisionId:f.revisionId,briefVersion:1,durationSec:20,previewArtifactSha256:'e'.repeat(64)});
  const spec=(await f.projects.store.readFresh<FilmSpec>(bundle.filmSpecRef.key)).value;
  const original=await loadVerifiedFilmPackage(f.projects.store,spec,root);
  const ref=await archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,f.master);
  const understandingRef=await index.immutable('projects/'+f.projectId+'/understanding/1',{...original.understanding,preferences:{...original.understanding.preferences,musicMode:'composed'}});
  const generated=await archiveSynthSources(f.projects,f.projectId,f.revisionId,f.planRef,f.plan,f.timing.track.runtimeDigest);
  const audioManifestRef=await index.immutable(f.prefix+'/audio-manifest',{...original.audioManifest,planRef:f.planRef,timingDraftRef:f.timingRef,executionRef:ref,sources:generated});
  const timelineRef=await index.immutable(f.prefix+'/timeline',{...original.timeline,sections:f.plan.sections,cues:compileAudioCues(f.plan,24),music:f.plan.music,foley:f.plan.foley,intentionalSilenceRanges:[{startSample:0,endSample:960000,buses:['voice']}]});
  const entry=original.sourceManifest.modules[0],code=(await f.projects.store.readFresh<{html:string;visualSourceRef:{key:string};timingDraftRef:unknown}>(entry.sourceRef.key)).value;
  const raw=(await f.projects.store.readFresh<Record<string,unknown>>(code.visualSourceRef.key)).value;
  const visualSourceRef=await index.immutable(f.prefix+'/visual-source/shot',{...raw,timingDraftHash:f.timingRef.sha256});
  const sourceRef=await index.immutable(f.prefix+'/source-code',{...code,visualSourceRef,timingDraftRef:f.timingRef});
  const sourceManifestRef=await index.immutable(f.prefix+'/source-manifest',{...original.sourceManifest,modules:[{...entry,sourceRef}]});
  const musical={...spec,understandingRef,audioManifestRef,timelineRef,sourceManifestRef,runtimeDigest:f.timing.track.runtimeDigest};
  await expect(loadVerifiedFilmPackage(f.projects.store,musical,root)).resolves.toMatchObject({timeline:{music:f.plan.music},audioExecution:{qualityStatus:'listening_not_checked'}});
  const missingRef=await index.immutable(f.prefix+'/audio-manifest',{...original.audioManifest,planRef:f.planRef,timingDraftRef:f.timingRef,sources:generated});
  await expect(loadVerifiedFilmPackage(f.projects.store,{...musical,audioManifestRef:missingRef},root)).rejects.toThrow('FILM_AUDIO_EXECUTION_NOT_READY');
  const removedSources=await index.immutable(f.prefix+'/audio-manifest',{...original.audioManifest,planRef:f.planRef,timingDraftRef:f.timingRef,executionRef:ref,sources:[]});
  await expect(loadVerifiedFilmPackage(f.projects.store,{...musical,audioManifestRef:removedSources},root)).rejects.toThrow('FILM_AUDIO_PLAN_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('rejects a replaced all-zero master despite valid plan, input hashes and stage identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-audio-master-receipt-'));
 try{
  const f=await fixture(root);
  await writeFile(f.master.track.outputPath,await readFile(f.stems.foley.outputPath));
  const replaced={...f.master,track:{...f.master.track,wav:f.stems.foley.wav}};
  await expect(archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,replaced)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('does not archive an output whose actual trusted completion marker is absent',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-audio-uncommitted-'));
 try{
  const f=await fixture(root);
  await rm(join(dirname(f.master.track.outputPath),'state.json'));
  await expect(archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,f.master)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
it('archives explicit music gain as a new execution version and cold reads independently verify its original gain',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-audio-gain-package-'));
 try{
  const f=await fixture(root,-3),ref=await archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,f.master);
  const loaded=await loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef);expect(loaded.package).toMatchObject({schemaVersion:3,master:{musicGainDb:-3}});
  expect((await readMusicGainBaseline(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef)).musicGainDb).toBe(-3);
  for(const dir of ['audio','sound','audio-master'])await rm(join(root,dir),{recursive:true});
  expect(await loadAudioExecution(new FileStore(root),root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef)).toEqual(loaded);
 }finally{await rm(root,{recursive:true,force:true})}
});
it('gain metadata cannot redirect a frozen master by re-signing its package and receipt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-audio-gain-tamper-'));
 try{
  const f=await fixture(root,-3),ref=await archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,f.master),loaded=await loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef),data=loaded.package;
  if(data.schemaVersion!==3)throw Error('EXPECTED_GAIN_PACKAGE');
  const wrong=await f.projects.index.immutable(f.prefix+'/audio-execution',{...data,master:{...data.master,musicGainDb:-4}});await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,wrong,f.planRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
  const doc={schemaVersion:2,musicGainDb:-4,planSha256:f.planRef.sha256,samples:data.totalSamples,hasVoice:false,mix:f.plan.mix,filter:masterMixFilter(f.plan.mix,data.totalSamples,false,-4),inputSha256:{voice:data.tracks.voice.wav.sha256,music:data.tracks.music.wav.sha256,foley:data.tracks.foley.wav.sha256}};
  const receipts=(await f.projects.store.readFresh<{schemaVersion:1;kind:string;soundState:unknown;masterState:{schemaVersion:1;jobSha256:string;outputSha256:string}}>(data.receiptsRef.key)).value;
  const forgedReceiptsRef=await f.projects.index.immutable(f.prefix+'/audio-receipts',{...receipts,masterState:{...receipts.masterState,jobSha256:canonicalHash(doc)}}),stageKey=canonicalHash({document:doc,runtimeDigest:data.runtimeDigest,toolSha256:data.master.toolSha256});
  const forged=await f.projects.index.immutable(f.prefix+'/audio-execution',{...data,master:{...data.master,musicGainDb:-4,stageKey},receiptsRef:forgedReceiptsRef});await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,forged,f.planRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('freezes voice-first music and foley attenuation and verifies it after disposable directories are removed',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-voice-first-package-'));
 try{
  const f=await fixture(root,undefined,'voice-first-v1'),ref=await archiveAudioExecution(f.projects,root,f.projectId,f.revisionId,f.planRef,f.timingRef,f.narration,f.stems,f.master);
  const before=await loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef);
  expect(before.package).toMatchObject({schemaVersion:4,master:{speechPriority:'voice-first-v1'},tracks:{voice:{wav:{silence:false}}}});
  const doc=JSON.parse(await readFile(join(root,'audio-master',f.master.stageKey,'job.json'),'utf8'));
  expect(doc).toMatchObject({schemaVersion:3,speechPriority:'voice-first-v1',hasVoice:true});
  expect(doc.filter).toContain('[1:a]aformat=sample_fmts=flt:channel_layouts=stereo,volume=-12dB');expect(doc.filter).toContain('[2:a]aformat=sample_fmts=flt:channel_layouts=stereo,volume=-12dB');
  for(const dir of ['audio','sound','audio-master'])await rm(join(root,dir),{recursive:true});
  expect(await loadAudioExecution(new FileStore(root),root,f.projectId,f.revisionId,ref,f.planRef,f.timingRef)).toEqual(before);
  // Re-signing the package cannot remove the gain policy from its executed run.
  if(before.package.schemaVersion!==4)throw Error('EXPECTED_VOICE_FIRST_PACKAGE');
  const {speechPriority,...legacyMaster}=before.package.master;
  expect(speechPriority).toBe('voice-first-v1');
  const forged=await f.projects.index.immutable(f.prefix+'/audio-execution',{...before.package,schemaVersion:2,master:legacyMaster});
  await expect(loadAudioExecution(f.projects.store,root,f.projectId,f.revisionId,forged,f.planRef,f.timingRef)).rejects.toThrow('AUDIO_EXECUTION_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});
