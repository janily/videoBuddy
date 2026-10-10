import {describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {binaryVersion,inspectFontLock,sandboxPolicy,supportedNode} from '../../scripts/video/doctor';
describe('runtime doctor gates',()=>{
 it('requires the supported Node line and ffmpeg/ffprobe major version',()=>{
  expect(supportedNode('v22.13.0')).toBe(true);expect(supportedNode('22.23.3')).toBe(true);
  for(const version of ['22.12.0','24.0.0','20.19.0'])expect(supportedNode(version)).toBe(false);
  expect(binaryVersion('ffmpeg version 6.1.1-3ubuntu5\nbuilt with gcc','ffmpeg').supported).toBe(true);
  expect(binaryVersion('ffprobe version 7.1-static','ffprobe').supported).toBe(true);
  expect(binaryVersion('ffmpeg version 5.1','ffmpeg').supported).toBe(false);
  expect(binaryVersion('unidentified build','ffmpeg').supported).toBe(false);
 });
 it('never treats unsafe or alternate browser paths as production sandbox evidence',()=>{
  expect(sandboxPolicy({},true)).toEqual({sandbox:true,unsafe:false});
  expect(sandboxPolicy({NODE_ENV:'development',VIDEO_UNSAFE_NO_SANDBOX:'1'},false)).toEqual({sandbox:false,unsafe:true});
  expect(()=>sandboxPolicy({VIDEO_UNSAFE_NO_SANDBOX:'1'},true)).toThrow('UNSAFE_SANDBOX_FORBIDDEN');
  expect(()=>sandboxPolicy({VIDEO_UNSAFE_NO_SANDBOX:'1'},false)).toThrow('UNSAFE_SANDBOX_FORBIDDEN');
  expect(()=>sandboxPolicy({NODE_ENV:'production',VIDEO_UNSAFE_NO_SANDBOX:'1'},false)).toThrow('UNSAFE_SANDBOX_FORBIDDEN');
  expect(()=>sandboxPolicy({VIDEO_CHROMIUM_EXECUTABLE_PATH:'/tmp/chrome'},true)).toThrow('CUSTOM_CHROMIUM_FORBIDDEN');
 });
 it('verifies pinned fonts, licenses and metadata and rejects altered bytes or traversal',async()=>{
  const root=await mkdtemp(join(tmpdir(),'vb-doctor-'));
  try{
   const bytes=Buffer.from('fixture'),entry={buildPath:'font.ttf',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
   const lock={schemaVersion:1,fonts:[{font:entry,licenseFile:entry,metadata:entry}]};
   await writeFile(join(root,'font.ttf'),bytes);await writeFile(join(root,'fonts.lock.json'),JSON.stringify(lock));
   expect(await inspectFontLock(root)).toMatchObject({fonts:1,files:3});
   await writeFile(join(root,'font.ttf'),'changed');await expect(inspectFontLock(root)).rejects.toThrow('FONT_CHECKSUM_MISMATCH');
   lock.fonts[0].font={...entry,buildPath:'../outside.ttf'};await writeFile(join(root,'fonts.lock.json'),JSON.stringify(lock));await expect(inspectFontLock(root)).rejects.toThrow('FONT_LOCK_INVALID');
  }finally{await rm(root,{recursive:true,force:true})}
 });
 it('ships the resource and isolation boundary without blocking browser user namespaces',async()=>{
  const unit=await readFile('deploy/systemd/videobuddy-render.service','utf8');
  for(const setting of ['User=videobuddy-render','Group=videobuddy-media','MemoryMax=6G','TasksMax=256','ProtectSystem=strict','ReadWritePaths=/var/lib/videobuddy/media','PrivateNetwork=yes','IPAddressDeny=any','IPAddressAllow=localhost','NoNewPrivileges=yes','ExecStart=/usr/bin/env -i '])expect(unit).toContain(setting);
  expect(unit).not.toMatch(/^RestrictNamespaces=/m);expect(unit).not.toMatch(/^SystemCallFilter=/m);expect(unit).not.toContain('EnvironmentFile=/etc/videobuddy/video.env');
  expect(unit).not.toContain('MODEL_API_KEY');expect(unit).not.toContain('VIDEO_SESSION_SIGNING_KEY');
 });
});
