import {spawn} from 'node:child_process';
import {Environment} from '@/services/video/config/environment';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {PostMixFilm,verifiedFilmHash} from './postmix-asr';

export function loudnessDockerArguments(image:string,user:string,filmPath:string){
 if(!/^sha256:[a-f0-9]{64}$/.test(image)||!/^\d+:\d+$/.test(user)||!/^\/[A-Za-z0-9_./-]+$/.test(filmPath))throw Error('LOUDNESS_JOB_INVALID');
 return['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','2','--memory','1g','--memory-swap','1g','--user',user,'--mount',`type=bind,src=${filmPath},dst=/input/final.mp4,readonly`,image,'ffmpeg','-hide_banner','-nostdin','-nostats','-v','info','-i','/input/final.mp4','-map','0:a:0','-vn','-sn','-dn','-af','loudnorm=I=-14:TP=-1.2:LRA=11:print_format=json','-f','null','-'];
}
export function parseLoudnessReport(output:string){
 const start=output.lastIndexOf('{'),end=output.lastIndexOf('}');
 if(start<0||end<=start)throw Error('LOUDNESS_REPORT_INVALID');
 let report:unknown;try{report=JSON.parse(output.slice(start,end+1))}catch{throw Error('LOUDNESS_REPORT_INVALID')}
 if(!report||typeof report!=='object')throw Error('LOUDNESS_REPORT_INVALID');
 const fields=report as Record<string,unknown>;
 function level(key:string){const value=fields[key];if(typeof value!=='string'||!/^-?(?:\d+(?:\.\d+)?|inf)$/.test(value))throw Error('LOUDNESS_REPORT_INVALID');const number=value==='-inf'?-Infinity:Number(value);if(Number.isNaN(number))throw Error('LOUDNESS_REPORT_INVALID');return number}
 const integratedLufs=level('input_i'),truePeakDbtp=level('input_tp');
 if(integratedLufs===Infinity||truePeakDbtp===Infinity||integratedLufs>0||truePeakDbtp>10)throw Error('LOUDNESS_REPORT_INVALID');
 return{integratedLufs,truePeakDbtp};
}
export function classifyLoudness(result:{integratedLufs:number;truePeakDbtp:number},intentionalSilence:boolean){
 const silent=result.integratedLufs===-Infinity&&result.truePeakDbtp===-Infinity;
 return intentionalSilence?(silent?'not_applicable':'fail'):(!silent&&result.integratedLufs>=-15&&result.integratedLufs<=-13&&result.truePeakDbtp<=-1.2?'pass':'fail');
}
export async function measureFinalLoudness(root:string,film:PostMixFilm,intentionalSilence:boolean,env:Environment=process.env){
 await verifiedFilmHash(root,film);
 const config=dockerConfiguration(env,'loudness');
 const child=spawn('docker',loudnessDockerArguments(config.image,config.user,film.outputPath),{stdio:['ignore','ignore','pipe'],signal:AbortSignal.timeout(120000)}),errors:Buffer[]=[];let size=0;
 child.stderr.on('data',(part:Buffer)=>{size+=part.length;if(size<=32*1024)errors.push(part);else child.kill()});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',value=>resolve(value??1))});
 if(code!==0||size>32*1024)throw Error(`LOUDNESS_MEASURE_FAILED: docker exit ${code}; ${Buffer.concat(errors).toString('utf8').slice(0,250)}`);
 const result=parseLoudnessReport(Buffer.concat(errors).toString('utf8'));
 const status=classifyLoudness(result,intentionalSilence);
 return{status,filmSha256:film.sha256,runtimeDigest:config.runtimeDigest,integratedLufs:Number.isFinite(result.integratedLufs)?result.integratedLufs:null,truePeakDbtp:Number.isFinite(result.truePeakDbtp)?result.truePeakDbtp:null,targetLufs:-14,toleranceLu:1,maxTruePeakDbtp:-1.2};
}
