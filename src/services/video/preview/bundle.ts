import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import {validateExcerptMap} from './excerpt';

const Digest=z.string().regex(/^[a-f0-9]{64}$/);
const Id=z.string().uuid();
const ObjectRef=z.strictObject({key:z.string().min(1),sha256:Digest,bytes:z.number().int().positive(),mime:z.literal('application/json')});
const RenderInputs=z.strictObject({
 sourceCodeSha256:Digest,timelineSha256:Digest,audioSha256:Digest,
 assetSha256s:z.array(Digest),fontSha256s:z.array(Digest),
 profile:z.strictObject({width:z.number().int().positive(),height:z.number().int().positive(),fps:z.union([z.literal(24),z.literal(30),z.literal(60)])}),
 runtimeDigests:z.record(z.string().min(1),Digest).refine(value=>value.media!==undefined),qualityPolicySha256:Digest,qualityPolicyRef:ObjectRef.optional()
});
const Segment=z.strictObject({previewStartMs:z.number().int().nonnegative(),previewEndMs:z.number().int().positive(),sourceStartMs:z.number().int().nonnegative().nullable(),sourceEndMs:z.number().int().nonnegative().nullable(),shotId:z.string().min(1).nullable()});
const Input=z.strictObject({
 previewId:Id,revisionId:Id,briefVersion:z.number().int().nonnegative(),filmSpecRef:ObjectRef,renderInputs:RenderInputs,
 script:z.array(z.string().min(1)).min(1),facts:z.array(z.strictObject({text:z.string().min(1),source:z.string().min(1)})),
 criticalFacts:z.array(z.strictObject({text:z.string().min(1),source:z.string().min(1)})),summary:z.string().min(1),
 previewArtifactId:Id,previewArtifactSha256:Digest,excerptMap:z.array(Segment).min(1),sourceDurationMs:z.number().int().positive(),
 qualityEvidenceRefs:z.array(z.string().min(1)).min(1)
});
export type PreviewBundleInput=z.input<typeof Input>;
export type PreviewBundle=z.output<typeof Input>&{scriptHash:string;factsHash:string;bundleHash:string;expiresAt:string};

function hashes(input:z.output<typeof Input>){
 const scriptHash=canonicalHash(input.script),factsHash=canonicalHash(input.facts);
 const bundleHash=canonicalHash({filmSpecSha256:input.filmSpecRef.sha256,scriptHash,factsHash,...input.renderInputs});
 return{scriptHash,factsHash,bundleHash};
}
function parse(input:unknown){
 const result=Input.safeParse(input);
 if(!result.success)throw Error('PREVIEW_BUNDLE_INVALID');
 const value=result.data;
 if(value.criticalFacts.some(fact=>!value.facts.some(item=>item.text===fact.text&&item.source===fact.source)))throw Error('PREVIEW_BUNDLE_INVALID');
 validateExcerptMap(value.excerptMap,value.sourceDurationMs);
 for(const segment of value.excerptMap)if((segment.sourceStartMs===null)!==(segment.shotId===null))throw Error('EXCERPT_INVALID');
 return value;
}
export function createPreviewBundle(input:PreviewBundleInput,now=Date.now()):PreviewBundle{
 if(!Number.isFinite(now))throw Error('PREVIEW_BUNDLE_INVALID');
 const value=parse(input);
 return{...value,...hashes(value),expiresAt:new Date(now+24*60*60*1000).toISOString()};
}
export function verifyPreviewBundle(bundle:PreviewBundle):boolean{
 try{
  const {scriptHash,factsHash,bundleHash,expiresAt,...input}=bundle;
  const value=parse(input);
  const expected=hashes(value);
  return scriptHash===expected.scriptHash&&factsHash===expected.factsHash&&bundleHash===expected.bundleHash&&Number.isFinite(Date.parse(expiresAt));
 }catch{return false}
}
export function assertPreviewArtifact(bundle:PreviewBundle,actualSha256:string){
 if(!verifyPreviewBundle(bundle)||bundle.previewArtifactSha256!==actualSha256)throw Error('PREVIEW_ARTIFACT_MISMATCH');
}
