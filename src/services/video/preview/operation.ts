import {z} from 'zod';
import {ObjectRefSchema} from '@/contracts/video/domain';
import type {ProjectControl} from '@/contracts/video/project';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {canonicalHash} from '@/services/video/domain/hash';
const schema=z.object({id:z.uuid(),projectId:z.uuid(),kind:z.literal('preview'),revisionId:z.uuid(),previewId:z.uuid(),briefVersion:z.number().int().nonnegative(),consentEpoch:z.number().int().nonnegative(),understandingRef:ObjectRefSchema,status:z.enum(['reserved','running','succeeded'])});
export async function assertPreviewOperation(projects:ProjectStore,control:ProjectControl,operationId:string,revisionId:string,previewId:string,consentEpoch:number){
 const raw=await projects.store.readFresh(`projects/${control.projectId}/operations/${operationId}`).catch(()=>{throw Error('PREVIEW_OPERATION_CHANGED')});
 const parsed=schema.safeParse(raw.value);
 if(!parsed.success)throw Error('PREVIEW_OPERATION_CHANGED');
 const op=parsed.data;
 if(op.id!==operationId||op.projectId!==control.projectId||op.revisionId!==revisionId||op.previewId!==previewId||op.briefVersion!==control.briefVersion||op.consentEpoch!==consentEpoch||canonicalHash(op.understandingRef)!==canonicalHash(control.understandingRef))throw Error('PREVIEW_OPERATION_CHANGED');
 return op;
}
