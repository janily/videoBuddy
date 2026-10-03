import {AudioPlanSchema,type AudioPlan} from '@/contracts/video/audio-plan';
export function masterMixFilter(raw:AudioPlan['mix'],samples:number,hasVoice:boolean,musicGainDb?:number){
 const parsed=AudioPlanSchema.shape.mix.safeParse(raw);
 if(!parsed.success||!Number.isSafeInteger(samples)||samples<960000||samples>5760000||(musicGainDb!==undefined&&(!Number.isFinite(musicGainDb)||musicGainDb<-6||musicGainDb>0)))throw Error('AUDIO_MIX_INVALID');
 const mix=parsed.data,voice='[0:a]aresample=48000,aformat=sample_fmts=flt:channel_layouts=stereo,volume='+mix.voiceGainDb+'dB';
 const music='[1:a]aformat=sample_fmts=flt:channel_layouts=stereo'+(musicGainDb===undefined?'':',volume='+musicGainDb+'dB');
 const foley='[2:a]aformat=sample_fmts=flt:channel_layouts=stereo[foley]';
 const gain=10**(mix.duck.thresholdDb/20),duck='sidechaincompress=threshold='+gain+':ratio='+mix.duck.ratio+':attack='+mix.duck.attackMs+':release='+mix.duck.releaseMs;
 return(hasVoice?[voice+',acompressor=threshold=0.08:ratio=4:attack=2:release=100:detection=peak,asplit=2[voice][side]',music+'[bed]','[bed][side]'+duck+'[music]',foley]:[voice+'[voice]',music+'[music]',foley]).concat('[voice][music][foley]amix=inputs=3:duration=first:normalize=0,atrim=end_sample='+samples+',asetpts=PTS-STARTPTS[out]').join(';');
}
