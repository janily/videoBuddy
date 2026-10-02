export interface SseRecord{id:string;event:string;data:string}
export class SseParser{
 private decoder=new TextDecoder('utf-8',{fatal:true});private buffer='';
 push(bytes:Uint8Array):SseRecord[]{
  this.buffer+=this.decoder.decode(bytes,{stream:true});
  if(this.buffer.length>256*1024)throw Error('STREAM_RECORD_TOO_LARGE');
  const output:SseRecord[]=[];
  for(;;){const match=/\r?\n\r?\n/.exec(this.buffer);if(!match)break;
   const block=this.buffer.slice(0,match.index);this.buffer=this.buffer.slice(match.index+match[0].length);
   let id='',event='message';const data:string[]=[];
   for(const line of block.split(/\r?\n/)){if(line.startsWith(':'))continue;const colon=line.indexOf(':');const field=colon<0?line:line.slice(0,colon);let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);if(field==='id'&&!value.includes('\0'))id=value;if(field==='event')event=value;if(field==='data')data.push(value)}
   if(data.length)output.push({id,event,data:data.join('\n')});
  }return output;
 }
}
export function parseCursor(value:string){if(!/^\d+:\d+$/.test(value))throw Error('CURSOR_INVALID');const [epoch,index]=value.split(':').map(Number);if(!Number.isSafeInteger(epoch)||!Number.isSafeInteger(index))throw Error('CURSOR_INVALID');return{epoch,index}}
