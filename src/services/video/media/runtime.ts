import {createHash} from 'node:crypto';
import {runtimeAssets,type RuntimeAsset} from './runtime-assets';
import type {RuntimeVersion} from './runtime-version';
/** Transport-neutral render contract. No process/container handle escapes it. */
export interface MediaJob {projectId:string;operationId:string;attemptId:string;stageKey:string;bundleHash:string;runtimeDigest:string;sourceHtml:string;logicalWidth:number;logicalHeight:number;outputWidth:number;outputHeight:number;fps:24|30|60;startFrame:number;endFrame:number;seed:number;fence:number;assets?:RuntimeAsset[]}
export interface MediaOptions {signal?:AbortSignal}
export interface RenderOptions extends MediaOptions {onPoster?:(buffer:Buffer)=>void|Promise<void>}
export interface VideoProbe {sha256:string;bytes:number;width:number;height:number;durationSec:number;fps:number;frameCount:number;audio:boolean;audioChannels?:number;videoCodec:string;pixelFormat:string;colorSpace:string;audioCodec?:string;sampleRate?:number;tags:Record<string,string>}
export interface RenderedVideo extends VideoProbe {key:string;outputPath:string;runtimeDigest:string;manifestPath:string;kind:'clip'|'final';poster?:{path:string;sha256:string;bytes:number}}
export interface AssembleInput {projectId:string;clips:RenderedVideo[];music:{path:string;sha256:string;bytes:number;trackId:string}|null;title:string}
export interface ImageInput {projectId:string;assetId:string;sourcePath:string;sourceMime:'image/png'|'image/jpeg'|'image/webp';sourceSha256:string;sourceBytes:number;maxEdge?:2048}
export interface PreparedImage {key:string;outputPath:string;sha256:string;bytes:number;width:number;height:number;encodedWidth:number;encodedHeight:number;orientedWidth:number;orientedHeight:number;runtimeDigest:string;mime:'image/png';transform:'full_image_resize';coordinates:'oriented_image_normalized'}
export interface ProbeOptions extends MediaOptions {fullDecode?:boolean;expected?:{width:number;height:number;durationSec:number;fps:number;audio:boolean}}
export interface MediaRuntime {readonly runtimeDigest:string;readonly version:RuntimeVersion;renderShot(job:MediaJob,options?:RenderOptions):Promise<RenderedVideo>;assemble(input:AssembleInput,options?:MediaOptions):Promise<RenderedVideo>;probe(outputPath:string,options?:ProbeOptions):Promise<VideoProbe>;prepareImage(input:ImageInput,options?:MediaOptions):Promise<PreparedImage>;close():Promise<void>}
/** Byte-compatible with the previous stage identity; operation retries share pixels. */
export function computeStageKey(job:Omit<MediaJob,'stageKey'|'operationId'|'attemptId'>){
 const sourceHash=createHash('sha256').update(job.sourceHtml).digest('hex'),assets=runtimeAssets(job.assets||[]);
 return createHash('sha256').update(JSON.stringify([job.projectId,job.bundleHash,job.runtimeDigest,sourceHash,job.logicalWidth,job.logicalHeight,job.outputWidth,job.outputHeight,job.fps,job.startFrame,job.endFrame,job.seed,job.fence,...(assets.length?[{assets}]:[])])).digest('hex');
}
