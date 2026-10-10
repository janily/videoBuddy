import type {Understanding} from '@/contracts/video/domain';
import {listStyles} from '@/services/video/styles/registry';
export const mvpProfile={styleSlugs:listStyles().map(style=>style.id) as readonly string[],aspect:'16:9',minDurationSec:20,maxDurationSec:30,languages:['zh-CN','en'] as readonly string[]} as const;
/** User-facing reason the current preferences fall outside the MVP profile, or undefined when supported. */
export function mvpProfileGap(understanding:Pick<Understanding,'preferences'>,_options:{portrait?:boolean}={}):string|undefined{
 void _options;const p=understanding.preferences;
 if(!p.styleSlug||!mvpProfile.styleSlugs.includes(p.styleSlug))return '先选一种画风，就能开始做视频。';
 if(!['16:9','9:16'].includes(p.aspect))return '当前版本先支持横屏（16:9）视频。';
 if(p.durationSec<mvpProfile.minDurationSec||p.durationSec>mvpProfile.maxDurationSec)return `当前版本先支持 ${mvpProfile.minDurationSec}–${mvpProfile.maxDurationSec} 秒的视频，告诉我想要多长就行。`;
 if(!mvpProfile.languages.includes(p.language))return '当前版本先支持中文或英文。';
 return undefined;
}
export function deliveryGap(understanding:Pick<Understanding,'preferences'>){const message=mvpProfileGap(understanding);return message?{code:'MVP_PROFILE_UNSUPPORTED' as const,message}:undefined}
