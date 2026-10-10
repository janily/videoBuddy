import {describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {aiMetadata,assembleArguments} from '@/services/video/media/local/arguments';
import {readQuickSettings,takeFor,updateQuickSettings} from '@/services/video/quick/settings';
import {loadMusicLibrary,pickTrack,type MusicLibrary} from '@/services/video/music/library';
import {FileStore} from '@/services/video/storage/file-store';

describe('final composition',()=>{
 it('copies video while writing AIGC metadata and looped faded music',()=>{
  const args=assembleArguments('/data/clips.txt','/data/final.mp4',{durationSec:30,title:'中秋祝福',musicPath:'/music/calm.mp3'}),joined=args.join(' ');
  expect(args.slice(args.indexOf('-c:v'),args.indexOf('-c:v')+2)).toEqual(['-c:v','copy']);
  expect(joined).toContain(`comment=${aiMetadata}`);expect(args).toContain('-stream_loop');expect(joined).toContain('afade=t=out');expect(joined).toContain('loudnorm');
  expect(args.slice(args.indexOf('-t'),args.indexOf('-t')+2)).toEqual(['-t','30']);expect(joined).not.toContain('drawtext');
 });
 it('writes a silent stereo track when there is no music',()=>{
  const args=assembleArguments('/data/clips.txt','/data/final.mp4',{durationSec:30,title:'film',musicPath:null});
  expect(args.join(' ')).toContain('anullsrc=r=48000:cl=stereo');expect(args).not.toContain('-stream_loop');
 });
});

describe('music library',()=>{
 it('loads a verified library and picks by style and mood',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'vb-music-'));
  try{
   const files={'calm.mp3':Buffer.alloc(2048,1),'festive.mp3':Buffer.alloc(2048,2)};
   for(const [name,bytes] of Object.entries(files))await writeFile(join(dir,name),bytes);
   const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
   await writeFile(join(dir,'library.json'),JSON.stringify({schemaVersion:1,tracks:[
    {id:'calm',title:'晨光',file:'calm.mp3',durationSec:60,moods:['清新','柔和'],styles:['watercolor'],license:'CC0',sha256:sha(files['calm.mp3'])},
    {id:'festive',title:'团圆',file:'festive.mp3',durationSec:60,moods:['喜庆','温暖'],styles:['papercut-red','paper-lantern'],license:'CC0',sha256:sha(files['festive.mp3'])},
   ]}));
   const library=await loadMusicLibrary({VIDEO_MUSIC_DIR:dir},{verifyFiles:true}) as MusicLibrary;
   expect(library.tracks.map(t=>t.id)).toEqual(['calm','festive']);
   expect(pickTrack(library,{styleSlug:'paper-lantern',text:'中秋团圆',durationSec:30})?.id).toBe('festive');
   expect(pickTrack(library,{styleSlug:'watercolor',text:'植物科普',durationSec:30})?.id).toBe('calm');
   expect(pickTrack(library,{styleSlug:'paper-lantern',text:'',durationSec:30,exclude:['festive']})?.id).toBe('calm');
   await writeFile(join(dir,'calm.mp3'),Buffer.alloc(2048,9));
   await expect(loadMusicLibrary({VIDEO_MUSIC_DIR:dir},{verifyFiles:true})).rejects.toThrow('MUSIC_TRACK_CHANGED');
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('treats a missing library as no music',async()=>{
  expect(await loadMusicLibrary({})).toBeNull();
  expect(await loadMusicLibrary({VIDEO_MUSIC_DIR:join(tmpdir(),'vb-no-such-dir-'+Date.now())})).toBeNull();
 });
});

describe('quick settings',()=>{
 it('counts shot redraws per brief and keeps the music choice',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vb-quick-'));
  try{
   const store=new FileStore(root),projectId=crypto.randomUUID();
   expect((await readQuickSettings(store,projectId)).music).toEqual({mode:'auto'});
   await updateQuickSettings(store,projectId,{redoShotId:'shot-2',briefVersion:3});
   await updateQuickSettings(store,projectId,{redoShotId:'shot-2',briefVersion:3});
   await updateQuickSettings(store,projectId,{music:{mode:'off'},briefVersion:3});
   const settings=await readQuickSettings(store,projectId);
   expect(takeFor(settings,3,'shot-2')).toBe(2);expect(takeFor(settings,3,'shot-1')).toBe(0);expect(settings.music).toEqual({mode:'off'});
   // A new brief starts from fresh drawings.
   expect(takeFor(settings,4,'shot-2')).toBe(0);
   await updateQuickSettings(store,projectId,{redoShotId:'shot-1',briefVersion:4});
   const next=await readQuickSettings(store,projectId);
   expect(next.takes).toEqual({'shot-1':1});expect(next.music).toEqual({mode:'off'});
  }finally{await rm(root,{recursive:true,force:true})}
 });
});
