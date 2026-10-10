import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {FileStore} from './helpers/file-store';
import {ProjectStore} from '@/services/video/storage/project-store';
import {saveScenePreview,readScenePreview,sceneSrcdoc} from '@/services/video/quick/scene-preview';
vi.mock('@/services/video/media/runtime-version',()=>({loadRuntimeFonts:async()=>({fonts:[]})}));
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))});
it('keeps generated source private and immutable with operation/shot/take scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-scene-'));roots.push(root);const projects=new ProjectStore(new FileStore(root));
 const {projectId}=await projects.create('owner',{schemaVersion:5,clientCreateId:randomUUID(),clientCommandId:randomUUID()});
 const input={projectId,operationId:randomUUID(),shotId:'shot-1',take:0,width:1920,height:1080,fps:24 as const,source:{schemaVersion:1 as const,briefVersion:0,styleSlug:'watercolor',styleRulesHash:'a'.repeat(64),timingDraftHash:'b'.repeat(64),shotId:'shot-1',startFrame:48,endFrame:96,factIds:[],assetIds:[],sourceHtml:'<canvas id="c"></canvas><script>window.READY=true;window.render=t=>document.getElementById("c").dataset.time=t;</script>'}};
 await saveScenePreview(projects,input);await saveScenePreview(projects,input);
 await expect(saveScenePreview(projects,{...input,source:{...input.source,sourceHtml:input.source.sourceHtml+'changed'}})).rejects.toThrow('VISUAL_SOURCE_INVALID');
 await expect(readScenePreview(projects,'other',root,input)).rejects.toThrow('ACCESS_NOT_FOUND');
 await expect(readScenePreview(projects,'owner',root,{...input,operationId:'../../private'})).rejects.toThrow('ACCESS_NOT_FOUND');
 const result=await readScenePreview(projects,'owner',root,input);expect(result).toMatchObject({durationSec:2,width:1920,height:1080});expect(result.srcdoc).toContain('window.render(pending+2)');
});
it('puts deny-network policy before untrusted markup and scopes parent commands',()=>{
 const html=sceneSrcdoc('<script>fetch("https://example.com")</script>',3);
 expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('fetch('));
 expect(html).toContain("connect-src 'none'");expect(html).toContain("frame-src 'none'");expect(html).toContain("img-src data:");expect(html).toContain('e.source!==parent');expect(html).toContain('Number.isFinite');
});
