import {z} from 'zod';
export const ObjectRefSchema=z.strictObject({key:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().nonnegative(),mime:z.string()});
export type ObjectRef=z.infer<typeof ObjectRefSchema>;
export const SourceRefSchema=z.strictObject({type:z.enum(['user_message','uploaded_material','inferred_preference']),id:z.string(),locator:z.string().optional(),excerpt:z.string().optional()});
export const FactSchema=z.strictObject({id:z.string().min(1),text:z.string().min(1).max(2000),sourceRefs:z.array(SourceRefSchema).min(1),status:z.enum(['provided','confirmed','conflicting','excluded']),mustInclude:z.boolean(),critical:z.boolean(),supersedesFactId:z.string().optional()});
export const PreferencesSchema=z.strictObject({durationSec:z.number().int().min(20).max(30),aspect:z.enum(['16:9','9:16']),language:z.enum(['zh-CN','en']),styleSlug:z.string().nullable()});
export const UnderstandingSchema=z.strictObject({schemaVersion:z.literal(5),briefVersion:z.number().int().nonnegative(),subject:z.string(),audience:z.string().optional(),objective:z.string().optional(),summary:z.array(z.string()).max(3),facts:z.array(FactSchema),assetUses:z.array(z.strictObject({assetId:z.string().uuid(),purpose:z.string(),required:z.boolean()})),preferences:PreferencesSchema,skippedTopics:z.array(z.string()),askedTopics:z.array(z.string()),optionalQuestionCount:z.number().int().nonnegative(),unresolvedConflictIds:z.array(z.string()),sourceMessageIds:z.array(z.string().uuid())});
export type Understanding=z.infer<typeof UnderstandingSchema>;
export function initialUnderstanding():Understanding{return{schemaVersion:5,briefVersion:0,subject:'',summary:[],facts:[],assetUses:[],preferences:{durationSec:30,aspect:'16:9',language:'zh-CN',styleSlug:null},skippedTopics:[],askedTopics:[],optionalQuestionCount:0,unresolvedConflictIds:[],sourceMessageIds:[]}}
const source={sourceMessageIds:z.array(z.string().uuid()).min(1)};
export const UnderstandingPatchSchema=z.strictObject({baseBriefVersion:z.number().int().nonnegative(),operations:z.array(z.discriminatedUnion('op',[
 z.strictObject({op:z.literal('add_fact'),fact:FactSchema,...source}),
 z.strictObject({op:z.literal('supersede_fact'),factId:z.string(),fact:FactSchema,...source}),
 z.strictObject({op:z.literal('set_preference'),field:z.enum(['durationSec','aspect','language','styleSlug']),value:z.union([z.string(),z.number(),z.null()]),...source}),
 z.strictObject({op:z.literal('set_asset_use'),assetId:z.string().uuid(),purpose:z.string(),required:z.boolean(),...source}),
 z.strictObject({op:z.literal('mark_topic_skipped'),topic:z.string(),...source}),
 z.strictObject({op:z.literal('mark_topic_asked'),topic:z.string(),optional:z.boolean(),...source}),
 z.strictObject({op:z.literal('resolve_conflict'),factIds:z.array(z.string()).min(1),selectedFactId:z.string(),...source}),
 z.strictObject({op:z.literal('replace_summary'),summary:z.array(z.string().min(1)).max(3),subject:z.string().optional(),audience:z.string().optional(),objective:z.string().optional(),...source}),
])).max(30)});
export type UnderstandingPatch=z.infer<typeof UnderstandingPatchSchema>;
