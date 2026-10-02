import{expect,it}from'vitest';
import{validateFilmSpec,validateFilmTimeline}from'@/contracts/video/film';
import{getStyle}from'@/services/video/styles/registry';

const projectId='00000000-0000-4000-8000-000000000011',revisionId='00000000-0000-4000-8000-000000000012';
const digest='a'.repeat(64),ref=(name:string,mime='application/json')=>({key:`projects/${projectId}/revisions/${revisionId}/${name}`,sha256:digest,bytes:100,mime});
const style=getStyle('crayon-book');
const spec={schemaVersion:5,projectId,revisionId,briefVersion:1,style:{slug:style.slug,packVersion:style.packVersion,upstreamCommit:style.upstreamCommit},output:{width:1920,height:1080,fps:24,totalFrames:480,sampleRate:48000},seed:7,understandingRef:ref('understanding'),treatmentRef:ref('treatment'),factsRef:ref('facts'),timelineRef:ref('timeline'),assetManifestRef:ref('assets'),sourceManifestRef:ref('sources'),audioManifestRef:ref('audio'),runtimeDigest:digest,qualityPolicyVersion:'v1'};
const cut={kind:'cut',overlapFrames:0},shot=(id:string,startFrame:number,endFrame:number)=>({id,startFrame,endFrame,purpose:'introduce',framing:'medium',camera:'static',sourceModule:'scene-a',actorIds:['actor-a'],transitionIn:cut,transitionOut:cut,factIds:['fact-a']});
const timeline={totalFrames:480,fps:24,sampleRate:48000,sections:[{id:'intro',startFrame:0,endFrame:480,bpm:120,beatsPerBar:4,beatUnit:4,barOffset:0}],shots:[shot('s1',0,240),shot('s2',240,480)],cues:[{id:'c1',sourceShotId:'s1',requestedTimeUs:1000000,alignmentPolicy:'frame',resolvedFrame:24,resolvedSample:48000,quantizationErrorUs:0}],narration:[{lineId:'line-1',displayText:'你好',spokenText:'你好',expectedAsrText:'你好',voiceConfigHash:digest,audioRef:ref('voice','audio/wav'),startSample:48000,endSample:144000,wordTimingsRef:ref('words')}],music:[{eventId:'m1',cueId:'c1',source:'licensed-music-a',durationSamples:48000,gainDb:-12,pan:0}],foley:[{eventId:'f1',cueId:'c1',source:'licensed-foley-a',pitch:1,durationSamples:24000,gainDb:-6,pan:0}],captions:[{id:'caption-1',lineId:'line-1',text:'你好',startFrame:24,endFrame:120,stableReadableStartFrame:24,styleRef:'caption-a',factIds:['fact-a']}],intentionalBlackRanges:[],intentionalSilenceRanges:[]};
const refs={sourceModules:new Set(['scene-a']),actorIds:new Set(['actor-a']),factIds:new Set(['fact-a']),captionStyles:new Set(['caption-a']),audioSources:new Set(['licensed-music-a','licensed-foley-a']),audioBuses:new Set(['voice','music','foley'])};

it('T01 checks a 1080p FilmSpec against known style version and exact timeline profile',()=>{
 expect(validateFilmSpec(spec,timeline)).toMatchObject({projectId,revisionId});
 expect(()=>validateFilmSpec({...spec,output:{...spec.output,totalFrames:479}},timeline)).toThrow('FILM_SPEC_INVALID');
 expect(()=>validateFilmSpec({...spec,style:{...spec.style,upstreamCommit:'stale'}},timeline)).toThrow('FILM_SPEC_INVALID');
 expect(()=>validateFilmSpec({...spec,unknown:true},timeline)).toThrow('FILM_SPEC_INVALID');
});
it('T01 checks full frame coverage, declared crossfades, and source references',()=>{
 expect(validateFilmTimeline(timeline,refs)).toMatchObject({totalFrames:480});
 expect(()=>validateFilmTimeline({...timeline,shots:[shot('s1',0,240),shot('s2',241,480)]},refs)).toThrow('TIMELINE_COVERAGE');
 expect(()=>validateFilmTimeline({...timeline,shots:[shot('s1',0,240),shot('s2',220,480)]},refs)).toThrow('TIMELINE_TRANSITION');
 const faded={...timeline,shots:[{...shot('s1',0,240),transitionOut:{kind:'crossfade',overlapFrames:20}},{...shot('s2',220,480),transitionIn:{kind:'crossfade',overlapFrames:20}}]};
 expect(validateFilmTimeline(faded,refs).shots).toHaveLength(2);
 const triple={...timeline,shots:[{...shot('s1',0,200),transitionOut:{kind:'crossfade',overlapFrames:100}},{...shot('s2',100,300),transitionIn:{kind:'crossfade',overlapFrames:100},transitionOut:{kind:'crossfade',overlapFrames:110}},{...shot('s3',190,480),transitionIn:{kind:'crossfade',overlapFrames:110}}]};
 expect(()=>validateFilmTimeline(triple,refs)).toThrow('TIMELINE_TRANSITION');
 expect(()=>validateFilmTimeline(timeline,{...refs,factIds:new Set()})).toThrow('TIMELINE_REFERENCE');
});
it('T01 rejects quantization forgery, narration overflow and unlicensed audio source references',()=>{
 expect(()=>validateFilmTimeline({...timeline,cues:[{...timeline.cues[0],resolvedSample:48001}]},refs)).toThrow('TIMELINE_QUANTIZATION');
 expect(()=>validateFilmTimeline({...timeline,narration:[{...timeline.narration[0],endSample:960001}]},refs)).toThrow('TIMELINE_AUDIO_RANGE');
 expect(()=>validateFilmTimeline({...timeline,music:[{...timeline.music[0],source:'missing-track'}]},refs)).toThrow('TIMELINE_REFERENCE');
 expect(()=>validateFilmTimeline({...timeline,captions:[{...timeline.captions[0],lineId:'missing'}]},refs)).toThrow('TIMELINE_REFERENCE');
 expect(()=>validateFilmTimeline({...timeline,intentionalSilenceRanges:[{startSample:0,endSample:48000,buses:['unknown']}]},refs)).toThrow('TIMELINE_REFERENCE');
});
