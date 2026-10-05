import {expect,it} from 'vitest';
import {mkdtemp,mkdir,symlink,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {persistProbeArchive} from '../../scripts/video/helpers/probe-archive';
it('writes each diagnostic archive into a fresh private directory, ignoring a preplaced legacy child symlink',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-probe-archive-')),outside=await mkdtemp(join(tmpdir(),'vb-probe-outside-'));
 try{
  await mkdir(join(root,'delivery-diagnostics'));await symlink(outside,join(root,'delivery-diagnostics','clear-preview-source'));
  const bytes=Buffer.from('private protocol fixture'),path=await persistProbeArchive(root,bytes);
  expect((await realpath(path)).startsWith((await realpath(root))+'/')).toBe(true);expect(await readFile(path)).toEqual(bytes);
  const second=await persistProbeArchive(root,bytes);expect(second).not.toBe(path);expect(await readFile(second)).toEqual(bytes);
  await expect(readFile(join(outside,'source.zip'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await Promise.all([rm(root,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})])}
});
it('rejects a symlink used as the configured private root before writing an archive',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'vb-probe-parent-')),outside=await mkdtemp(join(tmpdir(),'vb-probe-root-'));
 try{
  const root=join(parent,'linked-root');await symlink(outside,root);
  await expect(persistProbeArchive(root,Buffer.from('private'))).rejects.toThrow('PROBE_ARCHIVE_PATH_CHANGED');
  await expect(readFile(join(outside,'delivery-diagnostics','clear-preview-source','source.zip'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await Promise.all([rm(parent,{recursive:true,force:true}),rm(outside,{recursive:true,force:true})])}
});
