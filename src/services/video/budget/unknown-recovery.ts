import {z} from 'zod';
import {StoreMissing,createOrRead,type AtomicStore} from '../storage/atomic-store';
import {canonicalHash} from '../domain/hash';
import {requireUnlimitedValidation} from './validation-authorization';
const key='budgets/model-unknown-recovery-authorization';
const Schema=z.strictObject({schemaVersion:z.literal(1),authorizationId:z.uuid(),authorizedAt:z.string().datetime(),source:z.literal('user_instruction'),sourceSha256:z.string().regex(/^[a-f0-9]{64}$/),maxDeferredUnknown:z.number().int().min(1).max(3)});
/** Local operator only. This permits different calls, never replay of an
 * unknown effect, refund, fee settlement, or restart of an unknown media job. */
export async function authorizeUnknownModelRecovery(store:AtomicStore,raw:unknown){await requireUnlimitedValidation(store);const auth=Schema.parse(raw),saved=await createOrRead(store,key,auth);if(canonicalHash(saved)!==canonicalHash(auth))throw Error('IDEMPOTENCY_CONFLICT');return auth}
export async function unknownModelRecoveryLimit(store:AtomicStore){await requireUnlimitedValidation(store);try{return Schema.parse((await store.readFresh(key)).value).maxDeferredUnknown}catch(error){if(error instanceof StoreMissing)throw Error('MODEL_USAGE_UNCERTAIN');throw error}}
