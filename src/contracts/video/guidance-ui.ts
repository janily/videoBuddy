import {z} from 'zod';

export const CanvasTargetSchema=z.enum(['brief','style','script','result','style-library']);
export const QuickReplySchema=z.strictObject({label:z.string().min(1).max(8),text:z.string().min(1).max(60)});
export const StyleRecommendationSchema=z.strictObject({styleId:z.string().min(1),reason:z.string().min(1).max(30),primary:z.boolean()});
export const CanvasRefSchema=z.strictObject({text:z.string().min(1),target:CanvasTargetSchema,shotId:z.string().min(1).optional()});
export const ReadinessSchema=z.strictObject({brief:z.enum(['missing','partial','enough']),nextStep:z.enum(['ask','choose_style','review_script','generate','done'])});
export const GuidanceUISchema=z.strictObject({
 quickReplies:z.array(QuickReplySchema).max(4).optional(),
 recommendations:z.array(StyleRecommendationSchema).min(2).max(3).optional(),
 canvasFocus:CanvasTargetSchema.optional(),canvasRefs:z.array(CanvasRefSchema).optional(),readiness:ReadinessSchema.optional(),
});
export type GuidanceUI=z.infer<typeof GuidanceUISchema>;
export type CanvasTarget=z.infer<typeof CanvasTargetSchema>;

// Presentation metadata must never invalidate the underlying conversation.
// Catch invalid items before filtering them so good siblings survive.
export const tolerantGuidanceFields={
 quickReplies:z.array(QuickReplySchema.optional().catch(undefined)).optional().catch(undefined),
 recommendations:GuidanceUISchema.shape.recommendations.catch(undefined),
 canvasFocus:CanvasTargetSchema.optional().catch(undefined),
 canvasRefs:z.array(CanvasRefSchema.optional().catch(undefined)).optional().catch(undefined),
 readiness:ReadinessSchema.optional().catch(undefined),
};

export function guidanceUI(value:unknown,reply:string):GuidanceUI{
 const raw=z.object(tolerantGuidanceFields).parse(value),ui:GuidanceUI={};
 const quickReplies=raw.quickReplies?.filter(item=>item!==undefined).slice(0,4);
 const canvasRefs=raw.canvasRefs?.filter(item=>item!==undefined).filter(item=>reply.includes(item.text));
 if(quickReplies?.length)ui.quickReplies=quickReplies;
 if(canvasRefs?.length)ui.canvasRefs=canvasRefs;
 if(raw.recommendations)ui.recommendations=raw.recommendations;
 if(raw.canvasFocus)ui.canvasFocus=raw.canvasFocus;
 if(raw.readiness)ui.readiness=raw.readiness;
 return ui;
}
