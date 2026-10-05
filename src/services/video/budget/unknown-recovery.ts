import {z} from 'zod';
import {StoreMissing,createOrRead,updateJson,type AtomicStore} from '../storage/atomic-store';
import {canonicalHash} from '../domain/hash';
import {requireUnlimitedValidation} from './validation-authorization';
const key='budgets/model-unknown-recovery-authorization';
const Base={authorizationId:z.uuid(),authorizedAt:z.string().datetime(),source:z.literal('user_instruction'),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),};
const Schema=z.union([z.strictObject({schemaVersion:z.literal(1),...Base,maxDeferredUnknown:z.number().int().min(1).max(3)}),z.strictObject({schemaVersion:z.literal(2),...Base,maxDeferredUnknown:z.number().int().min(1).max(8)})]);
/** Local operator only. This permits different calls, never replay of an
 * unknown effect, refund, fee settlement, or restart of an unknown media job. */
export async function authorizeUnknownModelRecovery(store:AtomicStore,raw:unknown){await requireUnlimitedValidation(store);const auth=Schema.parse(raw),saved=await createOrRead(store,key,auth);if(canonicalHash(saved)!==canonicalHash(auth))throw Error('IDEMPOTENCY_CONFLICT');return auth}
export async function unknownModelRecoveryLimit(store:AtomicStore){await requireUnlimitedValidation(store);try{return Schema.parse((await store.readFresh(key)).value).maxDeferredUnknown}catch(error){if(error instanceof StoreMissing)throw Error('MODEL_USAGE_UNCERTAIN');throw error}}

/** Explicit authorized operator extension; preserve the original authorization. */
export async function extendUnknownModelRecovery(store:AtomicStore,raw:unknown){
 await requireUnlimitedValidation(store);const auth=Schema.parse(raw);if(auth.schemaVersion!==2)throw Error('MODEL_RECOVERY_EXTENSION_INVALID');
 const original=(await store.readFresh(key)).value,old=Schema.parse(original);
 if(auth.maxDeferredUnknown<old.maxDeferredUnknown)throw Error('MODEL_RECOVERY_EXTENSION_INVALID');
 const history=await createOrRead(store,key+'-history/'+canonicalHash(original),original);if(canonicalHash(history)!==canonicalHash(original))throw Error('MODEL_ACCOUNTING_INVALID');
 await updateJson(store,key,(current:unknown)=>{if(canonicalHash(current)===canonicalHash(auth))return current;if(canonicalHash(current)!==canonicalHash(original))throw Error('IDEMPOTENCY_CONFLICT');return auth});return auth;
}
