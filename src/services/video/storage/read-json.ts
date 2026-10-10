import {ObjectRefSchema,type ObjectRef} from '@/contracts/video/domain';
import {canonicalHash,canonicalJson} from '@/services/video/domain/hash';
import type {AtomicStore} from './atomic-store';
export async function readVerifiedJson(store:AtomicStore,ref:ObjectRef,prefix:string):Promise<unknown>{
 if(!ObjectRefSchema.safeParse(ref).success||ref.mime!=='application/json'||ref.bytes<1||!ref.key.startsWith(prefix))throw Error('OBJECT_REF_CHANGED');
 try{
  const value=(await store.readFresh<unknown>(ref.key)).value;
  if(canonicalHash(value)!==ref.sha256||Buffer.byteLength(canonicalJson(value))!==ref.bytes)throw Error('OBJECT_REF_CHANGED');
  return value;
 }catch{throw Error('OBJECT_REF_CHANGED')}
}
