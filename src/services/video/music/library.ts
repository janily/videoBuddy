import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {z} from 'zod';
import {styleFits} from '@/services/video/styles/recommendations';
import type {Environment} from '@/services/video/config/environment';

/**
 * Licensed music library. The operator puts audio files and a `library.json`
 * into VIDEO_MUSIC_DIR; nothing is downloaded at run time. Each track records
 * where its licence comes from so a community deployment can show it.
 *
 * library.json:
 * {"schemaVersion":1,"tracks":[{"id":"calm-piano-01","title":"晨光","file":"calm-piano-01.mp3",
 *   "durationSec":95,"moods":["温暖","安静"],"styles":["watercolor","crayon-book"],
 *   "license":"CC0","source":"https://…","sha256":"…"}]}
 */
const TrackSchema=z.strictObject({
 id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
 title:z.string().min(1).max(80),
 file:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(mp3|m4a|aac|wav|ogg|flac)$/),
 durationSec:z.number().positive().max(1800),
 moods:z.array(z.string().min(1).max(20)).max(12),
 styles:z.array(z.string().min(1).max(64)).max(43).default([]),
 license:z.string().min(1).max(200),
 source:z.string().max(500).optional(),
 sha256:z.string().regex(/^[a-f0-9]{64}$/),
});
const LibrarySchema=z.strictObject({schemaVersion:z.literal(1),tracks:z.array(TrackSchema).max(500)});
export type MusicTrack=z.infer<typeof TrackSchema>&{path:string};
export interface MusicLibrary{dir:string;tracks:MusicTrack[]}
export interface PublicTrack{id:string;title:string;moods:string[];license:string}

export function musicDirectory(env:Environment=process.env){const dir=env.VIDEO_MUSIC_DIR;return dir&&isAbsolute(dir)?dir:undefined}

/** Reads and verifies the library. A missing directory means "no library", not an error. */
export async function loadMusicLibrary(env:Environment=process.env,options:{verifyFiles?:boolean}={}):Promise<MusicLibrary|null>{
 const dir=musicDirectory(env);if(!dir)return null;
 let raw:string;try{raw=await readFile(join(dir,'library.json'),'utf8')}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error}
 const parsed=LibrarySchema.safeParse(JSON.parse(raw));if(!parsed.success)throw Error('MUSIC_LIBRARY_INVALID');
 if(new Set(parsed.data.tracks.map(track=>track.id)).size!==parsed.data.tracks.length)throw Error('MUSIC_LIBRARY_INVALID');
 const base=await realpath(dir),tracks:MusicTrack[]=[];
 for(const track of parsed.data.tracks){
  const path=join(base,track.file),info=await lstat(path).catch(()=>null);
  if(!info||!info.isFile()||info.isSymbolicLink()||info.size<1024||info.size>80*1024*1024)throw Error('MUSIC_LIBRARY_INVALID');
  if(options.verifyFiles&&createHash('sha256').update(await readFile(path)).digest('hex')!==track.sha256)throw Error('MUSIC_TRACK_CHANGED');
  tracks.push({...track,path});
 }
 return{dir:base,tracks};
}
export function publicTracks(library:MusicLibrary|null):PublicTrack[]{return (library?.tracks||[]).map(({id,title,moods,license})=>({id,title,moods,license}))}

/** Picks the best-fitting track for a style and brief; deterministic for the same inputs. */
export function pickTrack(library:MusicLibrary,input:{styleSlug:string|null;text:string;durationSec:number;exclude?:string[]}):MusicTrack|undefined{
 const fit=input.styleSlug?styleFits[input.styleSlug]:undefined,text=input.text.toLocaleLowerCase();
 const moodWords=[...(fit?.mood.split(/[、，,\s]+/)||[])].filter(Boolean);
 const scored=library.tracks.filter(track=>!input.exclude?.includes(track.id)).map((track,index)=>{
  let score=0;
  if(input.styleSlug&&track.styles.includes(input.styleSlug))score+=6;
  for(const mood of track.moods){if(moodWords.some(word=>word.includes(mood)||mood.includes(word)))score+=3;if(text.includes(mood.toLocaleLowerCase()))score+=2}
  if(track.durationSec>=input.durationSec)score+=1;
  return{track,index,score};
 });
 scored.sort((a,b)=>b.score-a.score||a.index-b.index);
 return scored[0]?.track;
}
