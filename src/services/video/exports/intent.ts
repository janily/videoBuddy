import {z} from 'zod';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {updateJson} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
import type {ExportOperation} from './operation';
export interface ExportIntent{kind:'export';hash:string;operation?:ExportOperation}
/** Repair the reserving command before any process may dispatch or retire its slot.
 * Without this binding a lost slot ACK could make the original command follow a retry. */
export async function bindReservedExportCommand(store:AtomicStore,operation:ExportOperation){
 if(operation.kind!=='export'||operation.format!=='source_zip'||![operation.projectId,operation.id,operation.commandId,operation.sourceArtifactId].every(id=>z.uuid().safeParse(id).success))throw Error('EXPORT_FENCED');
 const expected=canonicalHash({kind:'export',body:{schemaVersion:5,clientCommandId:operation.commandId,artifactId:operation.sourceArtifactId,format:'source_zip'}});
 return updateJson(store,`projects/${operation.projectId}/commands/${operation.commandId}`,(intent:ExportIntent)=>{
  if(intent.kind!=='export'||intent.hash!==expected||intent.operation&&canonicalHash(intent.operation)!==canonicalHash(operation))throw Error('IDEMPOTENCY_CONFLICT');
  return intent.operation?intent:{...intent,operation};
 });
}
