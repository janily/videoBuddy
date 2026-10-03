import {it,expect} from 'vitest';
import {parseRestoreIntent} from '@/services/video/results/client-contract';
const projectId='10000000-0000-4000-8000-000000000001',artifactId='20000000-0000-4000-8000-000000000002';
it('restores only a bounded project-bound original command without access URLs or token fields',()=>{
 const intent={version:1,projectId,artifactId,request:{schemaVersion:5,clientCommandId:'30000000-0000-4000-8000-000000000003'}};
 expect(parseRestoreIntent(JSON.stringify(intent),projectId)).toEqual(intent);
 for(const value of [JSON.stringify({...intent,projectId:artifactId}),JSON.stringify({...intent,token:'private'}),JSON.stringify({...intent,artifactId:'../other'}),JSON.stringify({...intent,request:{...intent.request,accessUrl:'https://outside.example'}}),'broken',' '.repeat(2049)])expect(parseRestoreIntent(value,projectId)).toBeNull();
});
