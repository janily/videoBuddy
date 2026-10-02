import{it,expect}from'vitest';
import{mapPreviewTime,validateExcerptMap}from'@/services/video/preview/excerpt';
const preview={previewArtifactId:'artifact',revisionId:'revision',excerptMap:[{previewStartMs:0,previewEndMs:3000,sourceStartMs:0,sourceEndMs:3000,shotId:'one'},{previewStartMs:3000,previewEndMs:6000,sourceStartMs:18000,sourceEndMs:21000,shotId:'two'},{previewStartMs:6000,previewEndMs:9000,sourceStartMs:40000,sourceEndMs:43000,shotId:'three'}]};
it('AT-036 second preview segment maps to actual source time',()=>expect(mapPreviewTime(preview,4000)).toEqual({artifactId:'artifact',revisionId:'revision',previewTimeMs:4000,sourceTimeMs:19000}));
it('AT-081 unmapped transition time never receives a false source location',()=>{expect(mapPreviewTime(preview,-1)).toBeNull();expect(mapPreviewTime(preview,9000)).toBeNull()});
it('an excerpt is six to twelve seconds and source intervals retain equal duration',()=>{
 expect(validateExcerptMap(preview.excerptMap,45000)).toBe(9000);
 expect(()=>validateExcerptMap([{previewStartMs:0,previewEndMs:5000,sourceStartMs:0,sourceEndMs:4000,shotId:'bad'}],45000)).toThrow('EXCERPT_INVALID');
});
