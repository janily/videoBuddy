import {AnyBookTimingFontSchema,bookFontVersion,type AnyBookTimingFont} from './book-font';
import {canonicalHash} from '../domain/hash';
import {createOrRead} from '../storage/atomic-store';
import type {AtomicStore} from '../storage/atomic-store';
export function bookFontReceiptKey(runtimeDigest:string,version:1|2=1){if(!/^[a-f0-9]{64}$/.test(runtimeDigest))throw Error('FONT_RECEIPT_CHANGED');return `runtime-receipts/${runtimeDigest}/${version===2?'clear-book-font':'book-font'}`}
export async function readBookFontReceipt(store:AtomicStore,runtimeDigest:string,version:1|2=1){const font=AnyBookTimingFontSchema.parse((await store.readFresh(bookFontReceiptKey(runtimeDigest,version))).value);if(font.runtimeDigest!==runtimeDigest||bookFontVersion(font)!==version)throw Error('FONT_RECEIPT_CHANGED');return font}
export async function recordBookFontReceipt(store:AtomicStore,font:AnyBookTimingFont){const valid=AnyBookTimingFontSchema.parse(font),saved=await createOrRead(store,bookFontReceiptKey(valid.runtimeDigest,bookFontVersion(valid)),valid);if(canonicalHash(saved)!==canonicalHash(valid))throw Error('FONT_RECEIPT_CHANGED');return readBookFontReceipt(store,valid.runtimeDigest,bookFontVersion(valid))}

export async function frozenBookFontHashes(store:AtomicStore,font:AnyBookTimingFont){const actual=await readBookFontReceipt(store,font.runtimeDigest,bookFontVersion(font));if(canonicalHash(actual)!==canonicalHash(font))throw Error('FONT_RECEIPT_CHANGED');return actual.faces.map(face=>face.fontSha256)}
