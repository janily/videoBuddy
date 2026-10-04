import {BookTimingFontSchema,type BookTimingFont} from './book-font';
import {canonicalHash} from '../domain/hash';
import {createOrRead} from '../storage/atomic-store';
import type {AtomicStore} from '../storage/atomic-store';
export function bookFontReceiptKey(runtimeDigest:string){if(!/^[a-f0-9]{64}$/.test(runtimeDigest))throw Error('FONT_RECEIPT_CHANGED');return `runtime-receipts/${runtimeDigest}/book-font`}
export async function readBookFontReceipt(store:AtomicStore,runtimeDigest:string){const font=BookTimingFontSchema.parse((await store.readFresh(bookFontReceiptKey(runtimeDigest))).value);if(font.runtimeDigest!==runtimeDigest)throw Error('FONT_RECEIPT_CHANGED');return font}
export async function recordBookFontReceipt(store:AtomicStore,font:BookTimingFont){const valid=BookTimingFontSchema.parse(font),saved=await createOrRead(store,bookFontReceiptKey(valid.runtimeDigest),valid);if(canonicalHash(saved)!==canonicalHash(valid))throw Error('FONT_RECEIPT_CHANGED');return readBookFontReceipt(store,valid.runtimeDigest)}

export async function frozenBookFontHashes(store:AtomicStore,font:BookTimingFont){const actual=await readBookFontReceipt(store,font.runtimeDigest);if(canonicalHash(actual)!==canonicalHash(font))throw Error('FONT_RECEIPT_CHANGED');return actual.faces.map(face=>face.fontSha256)}
