import {z} from 'zod';
import {SendMessageRequestSchema,FeedbackTargetSchema,type FeedbackTarget} from '@/contracts/video/commands';
import type {ProjectView} from '@/contracts/video/project';
const Intent=z.strictObject({version:z.literal(1),projectId:z.uuid(),request:SendMessageRequestSchema,preserveDraft:z.boolean().optional()});
export type MessageIntent=z.infer<typeof Intent>;
export const FeedbackSelectionSchema=z.strictObject({version:z.literal(1),projectId:z.uuid(),target:FeedbackTargetSchema.extend({sourceTimeMs:z.null()})});
export function parseMessageIntent(raw:string,projectId:string){
 if(raw.length>32768)return null;
 try{const value=Intent.safeParse(JSON.parse(raw));return value.success&&value.data.projectId===projectId?value.data:null}catch{return null}
}
export function feedbackTarget(view:Pick<ProjectView,'currentResult'|'previousResult'|'currentPreview'>|null,selection:FeedbackTarget|null|undefined){
 const current=view?.currentResult,previous=view?.previousResult,preview=view?.currentPreview;
 const candidates=[...(current?[{...current,label:'当前视频'}]:[]),...(previous?[{...previous,label:'上个结果'}]:[]),...(preview?[{artifactId:preview.previewArtifactId,revisionId:preview.revisionId,label:'效果片段'}]:[])];
 const defaultArtifact=current?.artifactId??preview?.previewArtifactId;
 const match=selection===undefined?candidates.find(item=>item.artifactId===defaultArtifact):selection&&candidates.find(item=>item.artifactId===selection.artifactId&&item.revisionId===selection.revisionId);
 return match?{target:{artifactId:match.artifactId,revisionId:match.revisionId,sourceTimeMs:null},label:match.label,stale:false}:{target:null,label:'',stale:selection!==undefined};
}
