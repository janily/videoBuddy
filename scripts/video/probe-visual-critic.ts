import {mkdir,mkdtemp,readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {readNarrationJson} from '../../src/services/video/audio/narration-package';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
import {visualReviewContext} from '../../src/contracts/video/visual-review';
import {readVisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {technicalVideoQa} from '../../src/services/video/media/technical-qa';
import {runVisualCritic} from '../../src/mastra/video/critic';
import {reserveModelBudget} from '../../src/services/video/budget/model-budget';
import {withAccountedModel} from '../../src/services/video/budget/model-call';
import {getStyle} from '../../src/services/video/styles/registry';
import {loadStageKnowledge} from '../../src/services/video/styles/knowledge-loader';
import {canonicalHash,canonicalJson} from '../../src/services/video/domain/hash';
import {probeEnvironment,recordModelRequests} from './helpers/real-probe';
import type {Environment} from '../../src/services/video/config/environment';
async function main(){
 if(!process.argv.includes('--critic'))throw Error('VISUAL_CRITIC_OPT_IN_REQUIRED');
 if(!process.env.MODEL_API_KEY||!process.env.MODEL_BASE_URL)throw Error('VISUAL_CRITIC_CREDENTIALS_REQUIRED');
 const source=JSON.parse(await readFile('docs/engineering/evidence/visual-evidence-probe.json','utf8')),native=JSON.parse(await readFile('docs/engineering/evidence/native-package-probe.json','utf8')),sourceRoot=await realpath(source.root),rel=relative(await realpath(resolve('.video-local/real-creation')),sourceRoot);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||sourceRoot!==native.root)throw Error('VISUAL_CRITIC_NATIVE_ROOT_REQUIRED');
 const sourceStore=new FileStore(sourceRoot),spec=await readNarrationJson(sourceStore,source.filmSpecRef,'projects/'+source.projectId+'/revisions/'+source.revisionId+'/film/'),frozen=await loadVerifiedFilmPackage(sourceStore,spec,sourceRoot),movie=native.composite;
 const env:Environment={...probeEnvironment(sourceRoot),VIDEO_CRITIC_MODEL:'gemini-3.8-flash'},actual=await technicalVideoQa(join(sourceRoot,'composition',movie.stageKey),env.VIDEO_MEDIA_IMAGE_REF!,'output/final.mp4',{width:movie.technicalQa.width,height:movie.technicalQa.height,durationSec:20,fps:24,audio:true,audioChannels:2});
 if(actual.sha256!==source.evidence.filmSha256||actual.sha256!==movie.technicalQa.sha256)throw Error('VISUAL_CRITIC_FILM_CHANGED');
 const images=await readVisualEvidence(sourceRoot,source.evidence),style=getStyle(frozen.filmSpec.style.slug),knowledge=await loadStageKnowledge(style.slug,'style');
 const context=visualReviewContext({filmSha256:actual.sha256,filmSpecSha256:source.filmSpecRef.sha256,styleSlug:style.slug,styleRulesHash:style.rulesHash,round:1,frames:source.evidence.frames.map(({id,frame,sha256,bytes}:{id:string;frame:number;sha256:string;bytes:number})=>({id,frame,sha256,bytes})),facts:frozen.facts.facts.filter(fact=>fact.critical||fact.mustInclude).map(({id,text})=>({id,text}))});
 // New, explicitly paid read-only experiment scope; historical production ledgers remain untouched.
 const parent=resolve('.video-local/visual-critic');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'run-')),projects=new ProjectStore(new FileStore(root)),projectId=randomUUID(),stage=randomUUID();
 const cost={inputTokens:Buffer.byteLength(canonicalJson({context,styleRules:knowledge.rules}))+4096+context.frames.length*8192,outputTokens:16000};
 const reservation=(await reserveModelBudget(projects.store,projectId,stage,cost,{projectCalls:1,projectInputTokens:200000,projectOutputTokens:16000,dailyCalls:1})).reservation,transport=recordModelRequests(env,root,1);
 let review,errorCode;
 try{review=await withAccountedModel(projects.store,reservation,()=>runVisualCritic(context,images,cost.outputTokens,env))}catch(error){errorCode=String((error as Error).message).replaceAll(env.MODEL_API_KEY!,'[redacted]').slice(0,200)}finally{await transport.flush();transport.restore()}
 const budget=(await projects.store.readFresh<{accounting?:Record<string,unknown>}>('projects/'+projectId+'/budget')).value;
 const contextRef=await projects.index.immutable('projects/'+projectId+'/visual-review-context',context),reviewRef=review?await projects.index.immutable('projects/'+projectId+'/visual-review',review):null;
 const evidence={executedAt:new Date().toISOString(),status:review?'validated':'blocked',root,sourceRoot,sourceProjectId:source.projectId,sourceRevisionId:source.revisionId,filmSpecRef:source.filmSpecRef,filmSha256:actual.sha256,frameEvidenceSha256:canonicalHash(source.evidence),contextRef,reviewRef,model:env.VIDEO_CRITIC_MODEL,providerOrigin:new URL(env.MODEL_BASE_URL!).origin,reserved:cost,requests:transport.requests,actual:budget.accounting?.[reservation.id],...(errorCode?{errorCode}:{}),review:review||null,limits:'One paid native Mastra multimodal Critic request on four exact real movie frames; zero retries, HTTP deadline, actual usage ledger in a new isolated read-only technical experiment scope. Historical ledgers are not cleared or migrated. Provider ignores hard token limits. This is one sampled round, not full visual/reading-time/motion QA and never listening QA or a publishable delivery.'};
 await writeFile('docs/engineering/evidence/visual-critic-probe.json',JSON.stringify(evidence,null,2).replaceAll(env.MODEL_API_KEY!,'[redacted]')+'\n');
 console.log(JSON.stringify({status:evidence.status,requests:transport.requests.length,actual:evidence.actual,...(errorCode?{errorCode}:{}),facts:review?.facts,style:review?.style,readability:review?.readability}));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:String(error?.message||'VISUAL_CRITIC_FAILED').replaceAll(process.env.MODEL_API_KEY||'missing-key','[redacted]').slice(0,200)}));process.exitCode=1});
