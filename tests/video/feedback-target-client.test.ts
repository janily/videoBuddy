import {it,expect} from 'vitest';
import {feedbackTarget,parseMessageIntent} from '@/services/video/revisions/client-contract';
const projectId=crypto.randomUUID(),result={resultId:crypto.randomUUID(),artifactId:crypto.randomUUID(),revisionId:crypto.randomUUID(),bundleHash:'a'.repeat(64),createdAt:new Date().toISOString()};
const view={projectId,currentResult:result,previousResult:{...result,artifactId:crypto.randomUUID(),revisionId:crypto.randomUUID()},currentPreview:null};
it('selects exact visible current or previous artifacts with no inherited playhead',()=>{
 expect(feedbackTarget(view,undefined)).toMatchObject({target:{artifactId:result.artifactId,revisionId:result.revisionId,sourceTimeMs:null},label:'当前视频'});
 expect(feedbackTarget(view,{artifactId:view.previousResult.artifactId,revisionId:view.previousResult.revisionId,sourceTimeMs:null}).label).toBe('上个结果');
 expect(feedbackTarget(view,{artifactId:crypto.randomUUID(),revisionId:result.revisionId,sourceTimeMs:null})).toMatchObject({target:null,stale:true});
});
it('keeps the original message identity and target across a cold parse and refuses foreign or corrupt storage',()=>{
 const request={schemaVersion:5,clientCommandId:crypto.randomUUID(),clientMessageId:crypto.randomUUID(),text:'音乐调小',attachmentIds:[],target:{artifactId:result.artifactId,revisionId:result.revisionId,sourceTimeMs:null}};
 const raw=JSON.stringify({version:1,projectId,request});expect(parseMessageIntent(raw,projectId)?.request).toEqual(request);
 expect(parseMessageIntent(raw,crypto.randomUUID())).toBeNull();expect(parseMessageIntent('{bad',projectId)).toBeNull();expect(parseMessageIntent(JSON.stringify({version:1,projectId,request:{...request,token:'secret'}}),projectId)).toBeNull();
});
