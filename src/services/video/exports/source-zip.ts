import {validateArchiveEntries} from './export';

export type SourceArchiveEntry={path:string;bytes:Buffer};
export const archiveByteLimit=150*1024*1024;
const credentialName='(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|signing[_-]?key|session[_-]?(?:key|token)|aws[_-]?secret[_-]?access[_-]?key|secret|password|authorization|cookie)';
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
export function assertArchiveText(text:string){
 const privateText=new RegExp('\\bsk-[a-zA-Z0-9_-]{12,}|\\bBearer\\s+\\S+|-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|[?&](?:token|signature|X-Amz-Signature|X-Goog-Signature)=|["\\\']?'+credentialName+'["\\\']?\\s*[:=]\\s*["\\\']?[^\\s"\\\',}]+','i'),privateKey=new RegExp('^'+credentialName+'$','i');
 function scan(value:unknown){
  if(typeof value==='string'){
   if(privateText.test(value))throw Error('ARCHIVE_PRIVATE_DATA');
   try{if(privateText.test(decodeURIComponent(value)))throw Error('ARCHIVE_PRIVATE_DATA')}catch(error){if(error instanceof Error&&error.message==='ARCHIVE_PRIVATE_DATA')throw error}
  }else if(value&&typeof value==='object')for(const[key,child]of Object.entries(value)){
   if(privateKey.test(key))throw Error('ARCHIVE_PRIVATE_DATA');scan(child);
  }
 }
 scan(text);let parsed:unknown;try{parsed=JSON.parse(text)}catch{return}scan(parsed);
}
function assertArchiveWav(bytes:Buffer){
 if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.readUInt32LE(4)+8!==bytes.length)throw Error('ARCHIVE_INVALID');
 let offset=12,hasData=false,hasFormat=false;
 while(offset+8<=bytes.length){
  const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,end=start+length;
  if(end>bytes.length)throw Error('ARCHIVE_INVALID');
  if(type==='data'){if(hasData)throw Error('ARCHIVE_INVALID');hasData=true}
  else{if(type==='fmt ')hasFormat=true;assertArchiveText(bytes.toString('utf8',start,end))}
  offset=end+length%2;
 }
 if(offset!==bytes.length||!hasData||!hasFormat)throw Error('ARCHIVE_INVALID');
}
/** Stored ZIP: bounded size, fixed timestamp, UTF-8 paths, regular-file attributes.
 * No subprocess, generated code execution, filesystem traversal or ambient files. */
export function encodeSourceArchive(entries:SourceArchiveEntry[]):Buffer{
 if(!entries.length||entries.length>2048)throw Error('ARCHIVE_INVALID');
 const names=new Set<string>(),sorted=[...entries].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 validateArchiveEntries(sorted.map(e=>({path:e.path,bytes:e.bytes.length,symlink:false,hardlinks:1})),sorted.map(e=>e.path));
 let size=22;
 for(const entry of sorted){
  const path=entry.path,name=Buffer.from(path),folded=path.normalize('NFC').toLowerCase();
  if(path!==path.normalize('NFC')||name.length>1024||/[\\\u007f]/.test(path)||path.split('/').some(part=>!part||part==='.'||/[. ]$/.test(part)||part.includes(':')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))||names.has(folded))throw Error('ARCHIVE_INVALID');
  names.add(folded);size+=76+name.length*2+entry.bytes.length;
  if(size>archiveByteLimit)throw Error('ARCHIVE_INVALID');
  if(path.endsWith('.wav'))assertArchiveWav(entry.bytes);else assertArchiveText(entry.bytes.toString('utf8'));
 }
 for(const name of names)for(let end=name.indexOf('/');end!==-1;end=name.indexOf('/',end+1))if(names.has(name.slice(0,end)))throw Error('ARCHIVE_INVALID');
 const output=Buffer.alloc(size);let offset=0;const records:{name:Buffer;crc:number;size:number;offset:number}[]=[];
 for(const entry of sorted){
  const name=Buffer.from(entry.path),crc=crc32(entry.bytes),start=offset;
  output.writeUInt32LE(0x04034b50,offset);output.writeUInt16LE(20,offset+4);output.writeUInt16LE(0x800,offset+6);output.writeUInt16LE(33,offset+12);
  output.writeUInt32LE(crc,offset+14);output.writeUInt32LE(entry.bytes.length,offset+18);output.writeUInt32LE(entry.bytes.length,offset+22);output.writeUInt16LE(name.length,offset+26);
  offset+=30;name.copy(output,offset);offset+=name.length;entry.bytes.copy(output,offset);offset+=entry.bytes.length;
  records.push({name,crc,size:entry.bytes.length,offset:start});
 }
 const directoryStart=offset;
 for(const record of records){
  output.writeUInt32LE(0x02014b50,offset);output.writeUInt16LE(0x314,offset+4);output.writeUInt16LE(20,offset+6);output.writeUInt16LE(0x800,offset+8);output.writeUInt16LE(33,offset+14);
  output.writeUInt32LE(record.crc,offset+16);output.writeUInt32LE(record.size,offset+20);output.writeUInt32LE(record.size,offset+24);output.writeUInt16LE(record.name.length,offset+28);output.writeUInt32LE(0x81a40000,offset+38);output.writeUInt32LE(record.offset,offset+42);
  offset+=46;record.name.copy(output,offset);offset+=record.name.length;
 }
 output.writeUInt32LE(0x06054b50,offset);output.writeUInt16LE(records.length,offset+8);output.writeUInt16LE(records.length,offset+10);output.writeUInt32LE(offset-directoryStart,offset+12);output.writeUInt32LE(directoryStart,offset+16);
 return output;
}
