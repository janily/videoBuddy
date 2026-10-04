import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareStyleFontBuild} from '../../scripts/video/helpers/style-font-build';
it('rejects an incomplete or substituted trusted font cache before producing a build context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-font-build-'));try{
  const cache=join(root,'cache'),output=join(root,'build');await mkdir(cache);await mkdir(join(cache,'mashanzheng'));
  await expect(prepareStyleFontBuild(cache,output)).rejects.toThrow('STYLE_FONT_SOURCE_CHANGED');
  await writeFile(join(cache,'mashanzheng/MaShanZheng-Regular.ttf'),Buffer.alloc(5857936));
  await expect(prepareStyleFontBuild(cache,output)).rejects.toThrow('STYLE_FONT_SOURCE_CHANGED');
  await expect(lstat(output)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true})}
});
it('rejects linked cache directories and leaves their contents untouched',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-font-links-'));try{
  const cache=join(root,'cache'),outside=join(root,'outside'),output=join(root,'build');await mkdir(cache);await mkdir(outside);await writeFile(join(outside,'sentinel'),'retained');await symlink(outside,join(cache,'mashanzheng'));
  await expect(prepareStyleFontBuild(cache,output)).rejects.toThrow('STYLE_FONT_SOURCE_CHANGED');
  expect(await readFile(join(outside,'sentinel'),'utf8')).toBe('retained');await expect(lstat(output)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true})}
});
