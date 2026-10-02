import {createHash} from 'node:crypto';
export function probeMarkdown(bytes:Uint8Array){
 if(bytes.byteLength>1024*1024)throw Error('ASSET_INVALID: Markdown limit');
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\0'))throw Error();return{text,bytes:bytes.byteLength,mime:'text/markdown',sha256:createHash('sha256').update(bytes).digest('hex'),trust:'untrusted_material' as const}}
 catch{throw Error('ASSET_INVALID: UTF-8 required')}
}
