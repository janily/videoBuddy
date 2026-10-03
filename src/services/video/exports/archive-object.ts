import {spawn} from 'node:child_process';
import {join} from 'node:path';
export async function persistArchiveObject(root:string,key:string,sha256:string,bytes:Buffer){
 const child=spawn(/* turbopackIgnore: true */ process.env.VIDEO_PYTHON_PATH||'python3',[join(process.cwd(),'runtime/storage/artifact_object.py'),root,key,sha256,String(bytes.length)],{stdio:['pipe','pipe','ignore'],signal:AbortSignal.timeout(30000)});
 let output='';child.stdout.on('data',(part:Buffer)=>{output+=part.toString('utf8');if(output.length>1024)child.kill()});child.stdin.on('error',()=>{});
 const code=await new Promise<number>((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1));child.stdin.end(bytes)});
 if(code!==0||output.length>1024)throw Error('ARTIFACT_INVALID');
 try{if(JSON.parse(output).ok!==true)throw Error()}catch{throw Error('ARTIFACT_INVALID')}
}
