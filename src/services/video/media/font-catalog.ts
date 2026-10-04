import {z} from 'zod';
import lock from '../../../../runtime/media/fonts.lock.json';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const file=z.strictObject({url:z.string(),sha256:digest,bytes:z.number().int().min(128).max(12*1024*1024),buildPath:z.string()});
const font=z.strictObject({id:z.string().regex(/^[a-z0-9-]+$/),family:z.string().regex(/^[A-Za-z0-9 -]{1,80}$/),filename:z.string().regex(/^[A-Za-z0-9_-]+\.ttf$/),license:z.literal('OFL-1.1'),font:file,licenseFile:file,metadata:file,runtimePath:z.string()});
const parsed=z.strictObject({schemaVersion:z.literal(1),upstreamRepository:z.literal('https://github.com/google/fonts'),upstreamCommit:z.string().regex(/^[a-f0-9]{40}$/),baseImage:z.string().regex(/^sha256:[a-f0-9]{64}$/),fonts:z.array(font).min(1).max(100),policy:z.string().min(1)}).parse(lock);
for(const entry of parsed.fonts){
 const prefix=`https://raw.githubusercontent.com/google/fonts/${parsed.upstreamCommit}/ofl/${entry.id}/`;
 for(const [source,name] of [[entry.font,entry.filename],[entry.licenseFile,'OFL.txt'],[entry.metadata,'METADATA.pb']] as const){
  if(source.url!==prefix+name||source.buildPath!==entry.id+'/'+name)throw Error('STYLE_FONT_CATALOG_INVALID');
 }
 if(entry.runtimePath!=='/usr/local/share/fonts/videobuddy/'+entry.filename)throw Error('STYLE_FONT_CATALOG_INVALID');
}
if(new Set(parsed.fonts.map(f=>f.id)).size!==parsed.fonts.length||new Set(parsed.fonts.map(f=>f.runtimePath)).size!==parsed.fonts.length)throw Error('STYLE_FONT_CATALOG_INVALID');
export function styleFontBuildLock(){return structuredClone(parsed)}
export function trustedStyleFont(id:string){const entry=parsed.fonts.find(font=>font.id===id);if(!entry)throw Error('STYLE_FONT_UNSUPPORTED');return structuredClone(entry)}
