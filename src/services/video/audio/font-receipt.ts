import {z} from 'zod';
import type {AtomicStore} from '@/services/video/storage/atomic-store';
import {createOrRead} from '@/services/video/storage/atomic-store';
import {canonicalHash} from '@/services/video/domain/hash';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const schema=z.strictObject({schemaVersion:z.literal(1),runtimeDigest:digest,fontPath:z.literal('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),fontSha256:digest});
function key(runtimeDigest:string){digest.parse(runtimeDigest);return 'runtime-receipts/'+runtimeDigest+'/subtitle-font'}
// Readers verify a worker's immutable runtime receipt without executing media.
export async function readSubtitleFontReceipt(store:AtomicStore,runtimeDigest:string){
 const value=schema.parse((await store.readFresh(key(runtimeDigest))).value);
 if(value.runtimeDigest!==runtimeDigest)throw Error('FONT_RECEIPT_CHANGED');
 return value.fontSha256;
}
export async function recordSubtitleFontReceipt(store:AtomicStore,runtimeDigest:string,fontSha256:string){
 const value=schema.parse({schemaVersion:1,runtimeDigest,fontPath:'/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',fontSha256});
 const saved=await createOrRead(store,key(runtimeDigest),value);
 if(canonicalHash(saved)!==canonicalHash(value))throw Error('FONT_RECEIPT_CHANGED');
 return readSubtitleFontReceipt(store,runtimeDigest);
}
