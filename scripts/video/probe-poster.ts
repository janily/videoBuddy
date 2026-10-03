import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {chmod,copyFile,mkdir,mkdtemp,readFile,realpath,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {readPreviewBundle} from '../../src/services/video/preview/commit';
import {verifyPreviewPackage} from '../../src/services/video/preview/package';
import {extractVisualFrames,readVisualEvidence} from '../../src/services/video/quality/visual-evidence';
import {posterFrame,prepareExportPoster} from '../../src/services/video/exports/poster';
import {persistArchiveObject} from '../../src/services/video/exports/archive-object';
import {actualArtifactSha256} from '../../src/services/video/exports/verified-file';
async function main(){
 if(!process.argv.includes('--poster'))throw Error('POSTER_PROBE_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-composition-probe.json','utf8')),projects=new ProjectStore(new FileStore(proof.root)),controlKey=`projects/${proof.projectId}/control`,before=(await projects.store.readFresh<ProjectControl>(controlKey)).value;
 const bundle=await readPreviewBundle(projects,proof.projectId,before.currentPreviewId!,proof.root),frozen=await verifyPreviewPackage(projects,proof.projectId,bundle,proof.root),movie=proof.record.movie,frame=posterFrame(frozen.timeline);
 let requests=0;globalThis.fetch=async()=>{requests++;throw Error('POSTER_PROBE_NETWORK_FORBIDDEN')};
 const root=await realpath(await mkdtemp(join(process.cwd(),'.video-local','poster-'))),projectId=randomUUID(),artifactId=randomUUID(),posterId=randomUUID(),key=`projects/${projectId}/artifacts/${artifactId}/files/final.mp4`;
 await mkdir(join(root,'objects',`projects/${projectId}/artifacts/${artifactId}/files`),{recursive:true,mode:0o700});await copyFile(movie.outputPath,join(root,'objects',key));await chmod(join(root,'objects',key),0o600);
 if(await actualArtifactSha256(root,key,movie.technicalQa.bytes)!==movie.technicalQa.sha256)throw Error('POSTER_FILM_CHANGED');
 const input={outputPath:join(root,'objects',key),sha256:movie.technicalQa.sha256,width:frozen.filmSpec.output.width,height:frozen.filmSpec.output.height,totalFrames:frozen.filmSpec.output.totalFrames},image='sha256:'+frozen.filmSpec.runtimeDigest;
 const evidence=await extractVisualFrames(root,input,[frame],image,{publishedArtifact:{projectId,artifactId}}),images=await readVisualEvidence(root,evidence),bytes=Buffer.from(images.get('frame-'+frame)!);
 const replay=await extractVisualFrames(root,input,[frame],image,{publishedArtifact:{projectId,artifactId},mustExist:true});if(canonicalHash(replay)!==canonicalHash(evidence))throw Error('POSTER_REPLAY_CHANGED');
 const sha256=createHash('sha256').update(bytes).digest('hex'),posterKey=`projects/${projectId}/artifacts/${posterId}/files/poster.png`,path=join(root,'objects',posterKey);
 await persistArchiveObject(root,posterKey,sha256,bytes);await persistArchiveObject(root,posterKey,sha256,bytes);
 if(await actualArtifactSha256(root,posterKey,bytes.length)!==sha256)throw Error('POSTER_OBJECT_CHANGED');
 let overwriteRejected=false;try{await persistArchiveObject(root,posterKey,createHash('sha256').update(Buffer.alloc(100)).digest('hex'),Buffer.alloc(100))}catch{overwriteRejected=true}
 const file=await stat(path);if(file.mode%512!==0o600||file.nlink!==1||!overwriteRejected)throw Error('POSTER_OBJECT_INVALID');
 const checked=spawnSync('python3',['-c',"import sys,struct,zlib,json; b=open(sys.argv[1],'rb').read(); assert b[:8]==bytes.fromhex('89504e470d0a1a0a'); off=8; payload=b''; width=height=components=None; ended=False\nwhile off<len(b):\n n=struct.unpack('>I',b[off:off+4])[0]; kind=b[off+4:off+8]; data=b[off+8:off+8+n]; crc=struct.unpack('>I',b[off+8+n:off+12+n])[0]; assert zlib.crc32(kind+data)&0xffffffff==crc; off+=n+12\n if kind==b'IHDR':\n  width,height,depth,color,compression,filter,interlace=struct.unpack('>IIBBBBB',data); assert depth==8 and compression==filter==interlace==0; components={0:1,2:3,4:2,6:4}[color]\n if kind==b'IDAT': payload+=data\n if kind==b'IEND': ended=True; break\nassert ended and off==len(b); decoded=zlib.decompress(payload); assert len(decoded)==height*(width*components+1); print(json.dumps({'pngCrcAndDecodedRowsPassed':True,'width':width,'height':height}))",path],{encoding:'utf8',timeout:15000});
 if(checked.status!==0)throw Error('POSTER_PNG_INDEPENDENT_CHECK_FAILED');const pngCheck=JSON.parse(checked.stdout);
 if(pngCheck.width!==input.width||pngCheck.height!==input.height)throw Error('POSTER_DIMENSIONS_CHANGED');
 let publicationBlock='';try{await prepareExportPoster(projects,before.ownerKeyHash,proof.projectId,randomUUID(),proof.root)}catch(error){publicationBlock=error instanceof Error?error.message:''}
 if(publicationBlock!=='RESULT_STALE'||requests||canonicalHash(before)!==canonicalHash((await projects.store.readFresh<ProjectControl>(controlKey)).value))throw Error('POSTER_PUBLICATION_GATE_CHANGED');
 await writeFile('docs/engineering/evidence/poster-real-frame.png',bytes);
 const result={executedAt:new Date().toISOString(),status:'pass',sourceProjectId:proof.projectId,filmSha256:input.sha256,runtimeDigest:frozen.filmSpec.runtimeDigest,frame,...pngCheck,sha256,bytes:bytes.length,root,path,privateMode:'0600',hardlinks:file.nlink,replayIdentical:true,overwriteRejected,sourceControlUnchanged:true,additionalModelCalls:requests,publicationBlock,publicExportAvailable:false,limits:'Real frame from the real 1080p diagnostic movie, copied into isolated private artifact storage; no qualified result or fabricated QA publication. Source diagnostic project remains unchanged.'};
 await writeFile('docs/engineering/evidence/poster-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
