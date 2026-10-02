import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {FileStore} from '../../src/services/video/storage/file-store';
import {ProjectStore} from '../../src/services/video/storage/project-store';
import {LocalAssetBytes} from '../../src/services/video/assets/local-bytes';
import {reserveAsset,markUploaded} from '../../src/services/video/assets/reservations';
import {runSourceAnalysisOnce} from '../../src/services/video/assets/source-worker';
import {assertPdfRuntime} from '../../src/services/video/assets/pdf-executor';
import type {ProjectControl} from '../../src/contracts/video/project';
import type {TextAnalysis} from '../../src/services/video/assets/analysis';

async function main(){
 const image=process.env.VIDEO_MEDIA_IMAGE_REF,digest=process.env.VIDEO_MEDIA_RUNTIME_DIGEST;
 if(!image||!digest||image!==`sha256:${digest}`)throw Error('CONFIGURATION_REQUIRED: pinned PDF runtime');
 process.env.VIDEO_MEDIA_TIMEOUT_SECONDS='60';
 await assertPdfRuntime();
 const root=await mkdtemp(join(tmpdir(),'vb-pdf-probe-')),browser=await chromium.launch();
 try{
  const page=await browser.newPage(),store=new FileStore(root),projects=new ProjectStore(store);
  await page.setContent('<html><body><h1>活动资料</h1><p>日期：10月8日</p><p>地点：上海</p></body></html>');
  const pdf=await page.pdf();
  const {projectId}=await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()});
  const asset=await reserveAsset(store,`projects/${projectId}/control`,{filename:'活动.pdf',declaredBytes:pdf.length,declaredMime:'application/pdf',intendedUse:'reference',rightsConfirmed:true},randomUUID());
  const wrote=await new LocalAssetBytes(root).put(projectId,asset.id,new Request('https://video.test/file',{method:'PUT',headers:{'content-type':'application/pdf'},body:pdf,duplex:'half'} as RequestInit),{declaredMime:'application/pdf',declaredBytes:pdf.length});
  await markUploaded(store,`projects/${projectId}/control`,asset.id,wrote.sha256,wrote.bytes);
  process.env.VIDEO_DATA_DIR=root;
  await runSourceAnalysisOnce(store,root);
  const control=(await store.readFresh<ProjectControl>(`projects/${projectId}/control`)).value;
  const output=control.assets.find(item=>item.id===asset.id);
  if(!output||output.status!=='ready'||!output.analysisRef||control.inputPending)throw Error(`PDF_PROBE_FAILED: ${output?.status}`);
  const analysis=(await store.readFresh<TextAnalysis>(output.analysisRef.key)).value;
  if(!analysis.pages?.some(text=>text.includes('上海')))throw Error('PDF_PROBE_FAILED: missing real page text');
  const screenshot=await page.screenshot({type:'png'});
  await page.setContent(`<html><body><img src="data:image/png;base64,${screenshot.toString('base64')}"/></body></html>`);
  const scanned=await page.pdf();
  const scannedProject=(await projects.create('owner',{schemaVersion:5,clientCommandId:randomUUID(),clientCreateId:randomUUID()})).projectId;
  const scannedAsset=await reserveAsset(store,`projects/${scannedProject}/control`,{filename:'扫描件.pdf',declaredBytes:scanned.length,declaredMime:'application/pdf',intendedUse:'reference',rightsConfirmed:true},randomUUID());
  const scannedBytes=await new LocalAssetBytes(root).put(scannedProject,scannedAsset.id,new Request('https://video.test/file',{method:'PUT',headers:{'content-type':'application/pdf'},body:scanned,duplex:'half'} as RequestInit),{declaredMime:'application/pdf',declaredBytes:scanned.length});
  await markUploaded(store,`projects/${scannedProject}/control`,scannedAsset.id,scannedBytes.sha256,scannedBytes.bytes);
  await runSourceAnalysisOnce(store,root);
  const scannedControl=(await store.readFresh<ProjectControl>(`projects/${scannedProject}/control`)).value;
  if(scannedControl.assets[0].status!=='failed'||scannedControl.assets[0].errorCode!=='PDF_TEXT_UNAVAILABLE'||scannedControl.inputPending)throw Error('PDF_PROBE_FAILED: scanned PDF must fail visibly');
  const evidence={runtimeDigest:digest,sourceSha256:wrote.sha256,bytes:wrote.bytes,pageCount:analysis.pages.length,assetStatus:output.status,briefVersion:control.briefVersion,inputPending:control.inputPending,containsShanghai:true,scannedPdf:{bytes:scannedBytes.bytes,status:scannedControl.assets[0].status,errorCode:scannedControl.assets[0].errorCode,inputPending:scannedControl.inputPending}};
  if(process.argv.includes('--record'))await writeFile('docs/engineering/evidence/pdf-probe.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify(evidence)+'\n');
  await page.close();
 }finally{await browser.close();await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1});
