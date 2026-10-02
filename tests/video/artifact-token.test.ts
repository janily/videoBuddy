import{it,expect}from'vitest';
import{issueArtifactToken,verifyArtifactToken}from'@/services/video/exports/local-token';
const data={projectId:'10000000-0000-4000-8000-000000000001',artifactId:'20000000-0000-4000-8000-000000000002',owner:'owner-a',purpose:'play' as const};
it('short-lived private artifact token is bound to owner, project, artifact and purpose',()=>{
 const token=issueArtifactToken(data,'s'.repeat(64),1000);
 expect(verifyArtifactToken(token,data,'s'.repeat(64),1001)).toBe(true);
 expect(()=>verifyArtifactToken(token,{...data,owner:'owner-b'},'s'.repeat(64),1001)).toThrow('ACCESS_NOT_FOUND');
 expect(()=>verifyArtifactToken(token,{...data,purpose:'download'},'s'.repeat(64),1001)).toThrow('ACCESS_NOT_FOUND');
 expect(()=>verifyArtifactToken(token,data,'s'.repeat(64),181001)).toThrow('ACCESS_NOT_FOUND');
 expect(()=>verifyArtifactToken(token+'x',data,'s'.repeat(64),1001)).toThrow('ACCESS_NOT_FOUND');
});
