import {z} from 'zod';
import {listStyles} from '@/services/video/styles/registry';
const stage=z.enum(['S0','S1','S2','S3','S4','S5','S6']);
const styleId=z.string().refine(id=>listStyles().some(style=>style.id===id));
const elapsed=z.number().finite().int().min(0).max(7*86400000);
// Strict allowlist: never accept messages, free-form labels, URLs or model output.
export const AnalyticsEventSchema=z.discriminatedUnion('name',[
 z.strictObject({name:z.literal('stage_enter'),payload:z.strictObject({stage})}),
 z.strictObject({name:z.literal('style_recommend_shown'),payload:z.strictObject({ids:z.array(styleId).min(1).max(3)})}),
 z.strictObject({name:z.literal('style_selected'),payload:z.strictObject({id:styleId,fromRecommend:z.boolean(),origin:z.enum(['canvas','chat']).optional()})}),
 z.strictObject({name:z.literal('quick_reply_clicked'),payload:z.strictObject({index:z.number().int().min(0).max(3),labelLength:z.number().int().min(0).max(8)})}),
 z.strictObject({name:z.literal('script_ready'),payload:z.strictObject({ms:elapsed})}),
 z.strictObject({name:z.literal('generate_clicked'),payload:z.strictObject({stage})}),
 z.strictObject({name:z.literal('shot_state'),payload:z.strictObject({state:z.enum(['drawing','drawn','rendering','rendered'])})}),
 z.strictObject({name:z.literal('result_ready'),payload:z.strictObject({ms:elapsed})}),
 z.strictObject({name:z.literal('result_downloaded'),payload:z.strictObject({})}),
 z.strictObject({name:z.literal('redo_shot'),payload:z.strictObject({})}),
 z.strictObject({name:z.literal('music_changed'),payload:z.strictObject({})}),
]);
export type AnalyticsEvent=z.infer<typeof AnalyticsEventSchema>;
export const AnalyticsRequestSchema=z.strictObject({eventId:z.string().uuid(),projectId:z.string().uuid(),event:AnalyticsEventSchema});
export type StoredAnalyticsEvent=AnalyticsEvent&{eventId:string;projectId:string;receivedAt:string};
