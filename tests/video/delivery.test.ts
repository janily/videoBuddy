import{it,expect}from'vitest';
import{validateArchiveEntries,assertArtifactAccess}from'@/services/video/exports/export';
it.each(['.env.local','fonts/private.ttf','weights/model.onnx','cache/model.safetensors','../other/file','tmp/signed-url.txt'])('AT-044 excludes credentials, fonts, weights and temporary data: %s',path=>expect(()=>validateArchiveEntries([{path,bytes:100,symlink:false,hardlinks:1}],[])).toThrow('ARCHIVE_INVALID'));
it('allowlisted source files can be included without claiming missing files exist',()=>{
 expect(validateArchiveEntries([{path:'source/scene.js',bytes:100,symlink:false,hardlinks:1}],['source/scene.js'])).toEqual(['source/scene.js']);
});
it('AT-089 tombstones and unvalidated media cannot acquire new signed download access',()=>{
 expect(()=>assertArtifactAccess({deletedAt:'now'}, {qaPassed:true,uploaded:true,mime:'video/mp4'})).toThrow('ACCESS_NOT_FOUND');
 expect(()=>assertArtifactAccess({}, {qaPassed:false,uploaded:true,mime:'video/mp4'})).toThrow('QUALITY_BLOCKED');
});
