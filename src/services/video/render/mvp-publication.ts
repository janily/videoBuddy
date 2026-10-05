import {ProjectStore} from '../storage/project-store';
import {canonicalHash} from '../domain/hash';
import {verifierStore} from './content-review';
import {renderApproved} from './pipeline';
import type {ResultManifest} from '../results/publish';
import type {Environment} from '../config/environment';
/** A passing row is insufficient. Replay the existing owned producers and
 * evidence; the verification adapter cannot create or mutate missing stages. */
export async function verifyMvpPublication(projects:ProjectStore,owner:string,projectId:string,operationId:string,fence:number,result:ResultManifest,options:{root:string;env?:Environment}){
 const verifier=new ProjectStore(verifierStore(projects.store));
 const verified=await renderApproved(verifier,owner,projectId,operationId,fence,{resultId:result.resultId,artifactId:result.artifactId,createdAt:result.createdAt},{...options,mustExist:true},async()=>{});
 if(canonicalHash(verified.result)!==canonicalHash(result))throw Error('QUALITY_BLOCKED');
}
