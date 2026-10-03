import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';

export function revisionSeed(projectId:string,revisionId:string){
 if(![projectId,revisionId].every(id=>z.uuid().safeParse(id).success))throw Error('VALIDATION_FAILED');
 return Number.parseInt(canonicalHash({projectId,revisionId,kind:'film-seed-v1'}).slice(0,8),16);
}
