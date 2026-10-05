import {pinyin} from 'pinyin-pro';
import {assertAsrExpected,normalizeAsr} from '../timeline/compile';
export type RecognitionPolicy='mandarin_pronunciation_v1';
/** Compare the pronunciation, including tones and polyphonic context. This does
 * not alter source/display text, ASR words, timestamps or the archived transcript.
 * Legacy packages retain their exact-text policy. Non-Han tokens remain exact. */
export function assertRecognitionExpected(original:string,proposed:string,raw:string,policy?:RecognitionPolicy){
 if(policy!==undefined&&policy!=='mandarin_pronunciation_v1')throw Error('ASR_POLICY_INVALID');
 try{assertAsrExpected(original,proposed,raw);return}catch(error){if((error as Error).message!=='ASR_MISMATCH'||!policy)throw error}
 const expected=normalizeAsr(original),recognized=normalizeAsr(raw);
 const tokens=(text:string)=>text.match(/\p{Script=Han}|[^\p{Script=Han}]+/gu)||[];
 const a=tokens(expected),b=tokens(recognized),ap=pinyin(expected,{type:'array',toneType:'num'}),bp=pinyin(recognized,{type:'array',toneType:'num'});
 if(!a.length||a.length!==b.length||ap.length!==bp.length||ap.some((sound,index)=>sound!==bp[index])||a.some((token,index)=>!/^\p{Script=Han}$/u.test(token)&&token!==b[index]))throw Error('ASR_MISMATCH');
}
