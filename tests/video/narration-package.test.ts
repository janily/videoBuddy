import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {link,mkdtemp,mkdir,readFile,readdir,rm,stat,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {FileStore} from '@/services/video/storage/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {probeVoiceWav} from '@/services/video/audio/wav';
import type {VerifiedNarrationManifest} from '@/services/video/audio/asr';
import type {TimingDraft} from '@/services/video/preview/timing-draft';
import {archiveVerifiedNarration,loadPackagedNarration} from '@/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '@/contracts/video/film-package';
import type {FilmSpec,FilmTimeline} from '@/contracts/video/film';
import {seedPreviewBundle} from './fixtures/preview-package';

async function fixture(root:string){
 const bytes=Buffer.alloc(44+24000*4);
 bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(3,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(32,34);bytes.write('data',36);bytes.writeUInt32LE(24000*4,40);
 for(let i=0;i<24000;i++)bytes.writeFloatLE(Math.sin(i/10)*0.1,44+i*4);
 const outputPath=join(root,'voice','fixture','narration.wav');await mkdir(join(root,'voice','fixture'),{recursive:true});await writeFile(outputPath,bytes);
 const wav=probeVoiceWav(bytes);
 const verified:VerifiedNarrationManifest={durationMs:20000,lines:[{lineId:'line_1',language:'zh-CN',spokenText:'活动十月八日开始。',displayText:'活动十月八日开始。',expectedAsrText:'活动十月八日开始。',startMs:1000,reservedMs:19000,durationMs:1000,voice:{lineId:'line_1',language:'zh-CN',voice:'zf_001',provider:'kokoro-js',model:'test-only',modelLicense:'Apache-2.0',runtimeDigest:'a'.repeat(64),outputPath,wav},asrStatus:'pass',wordTimingsStatus:'available',asr:{model:'Systran/faster-whisper-small',runtimeDigest:'b'.repeat(64),voiceSha256:wav.sha256},recognizedText:'活动十月八日开始。',wordTimings:[{text:'活动十月八日开始',startMs:0,endMs:950,probability:0.9}]}]};
 const narration:TimingDraft['narration']=[{lineId:'line_1',spokenText:verified.lines[0].spokenText,displayText:verified.lines[0].displayText,expectedAsrText:verified.lines[0].expectedAsrText,startSample:48000,endSample:96000,voiceSha256:wav.sha256,voiceRuntimeDigest:'a'.repeat(64),asrRuntimeDigest:'b'.repeat(64)}];
 return{bytes,verified,narration};
}

it('T10 archives actual narration bytes and timing provenance; reads independently of disposable voice directories',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-narration-package-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),revisionId=randomUUID(),input=await fixture(root);
  const [first,replay]=await Promise.all([archiveVerifiedNarration(projects,root,projectId,revisionId,input.verified,input.narration),archiveVerifiedNarration(projects,root,projectId,revisionId,input.verified,input.narration)]);
  expect(replay).toEqual(first);expect(first.lines).toHaveLength(1);
  const packaged=await loadPackagedNarration(projects.store,root,projectId,revisionId,first.sources[0].sourceRef);
  expect(packaged.timelineLine).toEqual(first.lines[0]);
  expect(packaged.words.words).toEqual(input.verified.lines[0].wordTimings);
  expect(packaged.words.voiceSha256).toBe(first.lines[0].audioRef.sha256);
  const objectPath=join(root,'objects',first.lines[0].audioRef.key);
  expect(await readFile(objectPath)).toEqual(input.bytes);
  await rm(join(root,'voice'),{recursive:true});
  expect((await loadPackagedNarration(projects.store,root,projectId,revisionId,first.sources[0].sourceRef)).timelineLine).toEqual(first.lines[0]);
  const changed=Buffer.from(input.bytes);changed.writeFloatLE(0.25,44);await writeFile(objectPath,changed);
  await expect(loadPackagedNarration(projects.store,root,projectId,revisionId,first.sources[0].sourceRef)).rejects.toThrow('NARRATION_AUDIO_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('T10 rejects redirected objects, changed ASR records, source links and altered spoken facts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-narration-reject-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),revisionId=randomUUID(),input=await fixture(root);
  const packaged=await archiveVerifiedNarration(projects,root,projectId,revisionId,input.verified,input.narration);
  const sourceRef=packaged.sources[0].sourceRef,source=(await projects.store.readFresh<Record<string,unknown>>(sourceRef.key)).value;
  const objectPath=join(root,'objects',packaged.lines[0].audioRef.key);
  await rm(objectPath);await symlink(input.verified.lines[0].voice.outputPath,objectPath);
  await expect(loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef)).rejects.toThrow('NARRATION_AUDIO_CHANGED');
  await rm(objectPath);await writeFile(objectPath,input.bytes);await link(objectPath,join(root,'linked.wav'));
  await expect(loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef)).rejects.toThrow('NARRATION_AUDIO_CHANGED');
  await rm(join(root,'linked.wav'));
  const redirectedRef=await projects.index.immutable(`projects/${projectId}/revisions/${revisionId}/narration-source`,{...source,audioRef:{...packaged.lines[0].audioRef,key:packaged.lines[0].audioRef.key.replace(revisionId,randomUUID())}});
  await expect(loadPackagedNarration(projects.store,root,projectId,revisionId,redirectedRef)).rejects.toThrow('NARRATION_AUDIO_CHANGED');
  const words=await projects.store.readFresh(packaged.lines[0].wordTimingsRef.key);
  await projects.store.cas(packaged.lines[0].wordTimingsRef.key,words.etag,{bad:'changed'});
  await expect(loadPackagedNarration(projects.store,root,projectId,revisionId,sourceRef)).rejects.toThrow('NARRATION_REF_CHANGED');
  const bad=structuredClone(input.verified);bad.lines[0].recognizedText='活动十月九日开始。';
  await expect(archiveVerifiedNarration(projects,root,projectId,randomUUID(),bad,input.narration)).rejects.toThrow('ASR_MISMATCH');
  const badWords=structuredClone(input.verified);badWords.lines[0].wordTimings[0].text='活动十月九日开始';
  await expect(archiveVerifiedNarration(projects,root,projectId,randomUUID(),badWords,input.narration)).rejects.toThrow('ASR_MISMATCH');
  await expect(archiveVerifiedNarration(projects,root,projectId,randomUUID(),input.verified,[{...input.narration[0],endSample:96001}])).rejects.toThrow('NARRATION_TIMING_CHANGED');
  await expect(archiveVerifiedNarration(projects,root,projectId,randomUUID(),input.verified,[])).rejects.toThrow('NARRATION_TIMING_CHANGED');
  await writeFile(join(root,'outside.wav'),input.bytes);await rm(input.verified.lines[0].voice.outputPath);await symlink(join(root,'outside.wav'),input.verified.lines[0].voice.outputPath);
  await expect(archiveVerifiedNarration(projects,root,projectId,randomUUID(),input.verified,input.narration)).rejects.toThrow('NARRATION_AUDIO_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('T11 checks actual packaged voice bytes and ASR references before accepting a FilmSpec',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-film-narration-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),revisionId=randomUUID(),input=await fixture(root);
  // Film fixture's sole shot starts at 0; the independent archive fixture starts at 1 s.
  input.verified.lines[0].startMs=0;input.narration[0].startSample=0;input.narration[0].endSample=48000;
  const archived=await archiveVerifiedNarration(projects,root,projectId,revisionId,input.verified,input.narration);
  const bundle=await seedPreviewBundle(projects,{projectId,revisionId,durationSec:20,script:[input.verified.lines[0].spokenText],previewArtifactSha256:'c'.repeat(64),narration:archived,voiceMetadata:input.narration});
  const spec=(await projects.store.readFresh<FilmSpec>(bundle.filmSpecRef.key)).value,prefix=`projects/${projectId}/revisions/${revisionId}`;
  const timeline=(await projects.store.readFresh<FilmTimeline>(spec.timelineRef.key)).value;
  const missingNarration=await projects.index.immutable(`${prefix}/timeline`,{...timeline,narration:[]});
  await expect(loadVerifiedFilmPackage(projects.store,spec,root)).resolves.toMatchObject({timeline:{narration:archived.lines}});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,timelineRef:missingNarration},root)).rejects.toThrow('FILM_NARRATION_CHANGED');
  const forgedTimelineRef=await projects.index.immutable(`${prefix}/timeline`,{...timeline,narration:[{...archived.lines[0],spokenText:'活动十月九日开始。'}]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,timelineRef:forgedTimelineRef},root)).rejects.toThrow('FILM_NARRATION_CHANGED');
  const audio=(await projects.store.readFresh<Record<string,unknown>>(spec.audioManifestRef.key)).value;
  const noSourcesRef=await projects.index.immutable(`${prefix}/audio`,{...audio,sources:[]});
  await expect(loadVerifiedFilmPackage(projects.store,{...spec,audioManifestRef:noSourcesRef},root)).rejects.toThrow('FILM_NARRATION_CHANGED');
  const words=await projects.store.readFresh(archived.lines[0].wordTimingsRef.key);
  await projects.store.cas(archived.lines[0].wordTimingsRef.key,words.etag,{bad:'changed'});
  await expect(loadVerifiedFilmPackage(projects.store,spec,root)).rejects.toThrow('NARRATION_REF_CHANGED');
  await projects.store.cas(archived.lines[0].wordTimingsRef.key,(await projects.store.readFresh(archived.lines[0].wordTimingsRef.key)).etag,words.value);
  await writeFile(join(root,'objects',archived.lines[0].audioRef.key),Buffer.from('broken wav'));
  await expect(loadVerifiedFilmPackage(projects.store,spec,root)).rejects.toThrow('NARRATION_AUDIO_CHANGED');
 }finally{await rm(root,{recursive:true,force:true})}
});

it('T10 recovers an interrupted publish in a cold process without accepting unexplained hardlinks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-narration-crash-'));
 try{
  const projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),revisionId=randomUUID(),input=await fixture(root);
  const packaged=await archiveVerifiedNarration(projects,root,projectId,revisionId,input.verified,input.narration),object=packaged.lines[0].audioRef;
  const objectPath=join(root,'objects',object.key);await rm(objectPath);
  // Kill the real publication helper immediately after the real link syscall, with no production fault flag.
  const crashCode='import os,runpy,sys\noriginal=os.link\ndef crash(src,dst):\n original(src,dst)\n os._exit(73)\nos.link=crash\nscript=sys.argv[1]\nsys.argv=sys.argv[1:]\nrunpy.run_path(script,run_name="__main__")';
  const child=spawn(process.env.VIDEO_PYTHON_PATH||'python3',['-c',crashCode,join(process.cwd(),'runtime/storage/narration_object.py'),root,'publish',object.key,String(object.bytes)],{stdio:['pipe','pipe','pipe']});
  child.stdin.on('error',()=>{});
  const exited=new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
  child.stdin.end(input.bytes);
  expect(await exited).toBe(73);expect((await stat(objectPath)).nlink).toBe(2);
  const recovered=await loadPackagedNarration(new FileStore(root),root,projectId,revisionId,packaged.sources[0].sourceRef);
  expect(recovered.timelineLine).toEqual(packaged.lines[0]);expect((await stat(objectPath)).nlink).toBe(1);
  expect((await readdir(dirname(objectPath))).filter(name=>name.endsWith('.tmp'))).toEqual([]);
  expect(await archiveVerifiedNarration(projects,root,projectId,revisionId,input.verified,input.narration)).toEqual(packaged);
 }finally{await rm(root,{recursive:true,force:true})}
});
