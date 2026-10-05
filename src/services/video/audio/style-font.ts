import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Environment} from '@/services/video/config/environment';
import {dockerConfiguration} from '@/services/video/media/docker-executor';
import {runOwnedDocker} from '@/services/video/media/owned-docker';
import {readDockerInvocation,dockerArgumentsHash} from '@/services/video/media/docker-journal';
import type {DockerJournal} from '@/services/video/media/docker-journal';
import {trustedStyleFont} from '@/services/video/media/font-catalog';
import {parseFontCharset} from './subtitles';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const actualSchema=z.strictObject({family:z.string().min(1).max(500),charset:z.string().min(1).max(200000),fontSha256:digest,fontBytes:z.number().int().positive(),licenseSha256:digest,metadataSha256:digest});
const inspector=String.raw`
import hashlib,json,pathlib,subprocess,sys
font=pathlib.Path(sys.argv[1]);notice=pathlib.Path(sys.argv[2]);metadata=pathlib.Path(sys.argv[3])
for path in [font,notice,metadata]:
    assert path.is_file() and not path.is_symlink() and path.stat().st_nlink==1
    assert 128<=path.stat().st_size<=12*1024*1024
raw=subprocess.run(['fc-query','-i','0','-f','%{family}\n%{charset}',str(font)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8).stdout.decode()
family,charset=raw.split('\n',1)
print(json.dumps(dict(family=family,charset=charset,fontSha256=hashlib.sha256(font.read_bytes()).hexdigest(),fontBytes=font.stat().st_size,licenseSha256=hashlib.sha256(notice.read_bytes()).hexdigest(),metadataSha256=hashlib.sha256(metadata.read_bytes()).hexdigest())))
`;
// This reads preinstalled locked resources. It never fetches fonts or permits a
// system fallback to masquerade as the requested face.
export async function readPinnedStyleFont(env:Environment,id:string,options:{run?:typeof runOwnedDocker;journal?:DockerJournal;assertActive?:()=>Promise<void>;mustExist?:boolean}={}){
 const font=trustedStyleFont(id),config=dockerConfiguration(env,'style-font-'+id),doc='/usr/share/doc/videobuddy-fonts/'+font.id;
 const args=['run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--cpus','1','--memory','256m','--memory-swap','256m','--user',config.user,config.image,'python3','-c',inspector,font.runtimePath,doc+'/OFL.txt',doc+'/METADATA.pb'];
 let raw:string;
 if(options.mustExist){
  if(!options.journal)throw Error('STYLE_FONT_PROOF_MISSING');
  const receipt=await readDockerInvocation(options.journal,dockerArgumentsHash(args,config.image),config.image);
  if(receipt.state!=='completed'||receipt.output===undefined)throw Error('MEDIA_STOP_UNKNOWN');
  raw=receipt.output;
 }else raw=await (options.run||runOwnedDocker)(args,15000,config.image,options.assertActive,options.journal);
 let actual:z.infer<typeof actualSchema>;let glyphs:Set<string>;
 try{
  actual=actualSchema.parse(JSON.parse(raw));
  if(!actual.family.split(',').includes(font.family)||actual.fontSha256!==font.font.sha256||actual.fontBytes!==font.font.bytes||actual.licenseSha256!==font.licenseFile.sha256||actual.metadataSha256!==font.metadata.sha256)throw Error('changed');
  glyphs=parseFontCharset(actual.charset);
 }catch{throw Error('STYLE_FONT_RUNTIME_CHANGED')}
 await options.assertActive?.();
 return{id:font.id,family:font.family,runtimeDigest:config.runtimeDigest,fontSha256:actual.fontSha256,fontBytes:actual.fontBytes,licenseSha256:actual.licenseSha256,metadataSha256:actual.metadataSha256,charsetSha256:createHash('sha256').update(actual.charset).digest('hex'),glyphs};
}
