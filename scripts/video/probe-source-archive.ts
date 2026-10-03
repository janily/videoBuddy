import {spawnSync} from 'node:child_process';
import {mkdtemp,open,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import type {ProjectControl} from '../../src/contracts/video/project';
import {prepareFrozenSourceArchive} from '../../src/services/video/exports/source-archive';
import {canonicalHash} from '../../src/services/video/domain/hash';
import {loadVerifiedFilmPackage} from '../../src/contracts/video/film-package';
async function main(){
 if(!process.argv.includes('--archive'))throw Error('SOURCE_ARCHIVE_OPT_IN_REQUIRED');
 const proof=JSON.parse(await readFile('docs/engineering/evidence/approved-composition-probe.json','utf8')),projects=new ProjectStore(new FileStore(proof.root)),key=`projects/${proof.projectId}/control`,before=(await projects.store.readFresh<ProjectControl>(key)).value;
 let modelCalls=0;globalThis.fetch=async()=>{modelCalls++;throw Error('SOURCE_ARCHIVE_NETWORK_FORBIDDEN')};
 const previewId=before.currentPreviewId!;
 const first=await prepareFrozenSourceArchive(projects,before.ownerKeyHash,proof.projectId,previewId,proof.root),second=await prepareFrozenSourceArchive(new ProjectStore(new FileStore(proof.root)),before.ownerKeyHash,proof.projectId,previewId,proof.root);
 if(!first.bytes.equals(second.bytes)||modelCalls||canonicalHash(before)!==canonicalHash((await projects.store.readFresh<ProjectControl>(key)).value))throw Error('SOURCE_ARCHIVE_REPLAY_CHANGED');
 const directory=await mkdtemp(join(proof.root,'source-archive-')),path=join(directory,first.sha256+'.zip'),file=await open(path,'wx',0o600);
 try{await file.writeFile(first.bytes);await file.sync()}finally{await file.close()}
 const parent=await open(directory,'r');try{await parent.sync()}finally{await parent.close()}
 const checked=spawnSync('python3',['-c',"import sys,json,zipfile,hashlib; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; m=json.loads(z.read('archive-manifest.json')); assert set(z.namelist())=={e['path'] for e in m['entries']}|{'archive-manifest.json'}; [None if len(z.read(e['path']))==e['bytes'] and hashlib.sha256(z.read(e['path'])).hexdigest()==e['sha256'] else sys.exit(1) for e in m['entries']]; print(json.dumps({'entries':len(z.namelist()),'crcAndEveryEntryHashPassed':True}))",path],{encoding:'utf8',timeout:30000});
 if(checked.status!==0)throw Error('SOURCE_ARCHIVE_INDEPENDENT_CHECK_FAILED');
 const importedRoot=await mkdtemp(join(proof.root,'source-archive-import-'));
 const restored=spawnSync('python3',['-c',"import sys,zipfile,pathlib; z=zipfile.ZipFile(sys.argv[1]); root=pathlib.Path(sys.argv[2]); assert all(not pathlib.PurePosixPath(n).is_absolute() and '..' not in pathlib.PurePosixPath(n).parts and '\\\\' not in n for n in z.namelist()); z.extractall(root)",path,importedRoot],{encoding:'utf8',timeout:30000});
 if(restored.status!==0)throw Error('SOURCE_ARCHIVE_RESTORE_FAILED');
 const importedFilm=JSON.parse(await readFile(join(importedRoot,'film.json'),'utf8'));
 const imported=await loadVerifiedFilmPackage(new FileStore(join(importedRoot,'state')),importedFilm,importedRoot);
 if(imported.filmSpec.revisionId!==first.manifest.revisionId)throw Error('SOURCE_ARCHIVE_RESTORE_CHANGED');
 const validation=JSON.parse(checked.stdout),result={executedAt:new Date().toISOString(),status:'pass',projectId:proof.projectId,revisionId:first.manifest.revisionId,previewId,bundleHash:first.manifest.bundleHash,path,sha256:first.sha256,bytes:first.bytes.length,...validation,importedRoot,restoredFilmPackageVerified:true,replayIdentical:true,controlUnchanged:true,additionalModelCalls:modelCalls,resultPublished:false,publicExportAvailable:false,limits:'Private diagnostic source archive from a real frozen film package. No user assets are referenced. Independent ZIP extraction into fresh storage passed loadVerifiedFilmPackage, including frozen scene documents, archived audio WAVs and authoritative audio execution receipts. No final-quality approval; public export operation and download binding remain pending. Font binaries/model weights are excluded; no claim of a single-click offline rebuild or image-source attestation.'};
 await writeFile('docs/engineering/evidence/source-archive-probe.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(error=>{console.error(JSON.stringify({status:'fail',errorCode:error.message}));process.exitCode=1});
