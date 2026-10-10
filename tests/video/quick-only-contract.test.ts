import {expect,it} from 'vitest';
import {initialUnderstanding} from '@/contracts/video/domain';
import {ReserveUploadRequestSchema,ExportRequestSchema,commandSchemas} from '@/contracts/video/commands';
it('has only visual preferences and the shipping 30 second default',()=>{
 expect(initialUnderstanding().preferences).toEqual({durationSec:30,aspect:'16:9',language:'zh-CN',styleSlug:null});
});
it('rejects retired approval commands and audio source uploads',()=>{
 expect(commandSchemas).not.toHaveProperty('ApprovePreviewRequest');
 const request={schemaVersion:5,clientCommandId:crypto.randomUUID(),filename:'voice.wav',declaredBytes:100,declaredMime:'audio/wav',intendedUse:'reference',rightsConfirmed:true};
 expect(ReserveUploadRequestSchema.safeParse(request).success).toBe(false);
 expect(ReserveUploadRequestSchema.safeParse({...request,filename:'notes.md',declaredMime:'text/markdown'}).success).toBe(true);
});
it('only permits mp4 and poster exports',()=>{
 const request={schemaVersion:5,clientCommandId:crypto.randomUUID(),artifactId:crypto.randomUUID()};
 for(const format of ['mp4','poster'])expect(ExportRequestSchema.safeParse({...request,format}).success).toBe(true);
 for(const format of ['srt','treatment','credits','quality','source_zip'])expect(ExportRequestSchema.safeParse({...request,format}).success).toBe(false);
});
