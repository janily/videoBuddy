import {parentPort,workerData} from 'node:worker_threads';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const task=getDocument({data:workerData,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true,useWorkerFetch:false});
try{
 const document=await task.promise;
 if(document.numPages<1||document.numPages>100)throw Error('PDF_PAGE_LIMIT');
 const pages=[];
 for(let number=1;number<=document.numPages;number++){
  const page=await document.getPage(number),content=await page.getTextContent();
  pages.push(content.items.map(item=>'str'in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim());
  page.cleanup();if(Buffer.byteLength(JSON.stringify(pages))>40000)throw Error('PDF_TEXT_LIMIT');
 }
 if(!pages.some(page=>page.trim()))throw Error('PDF_TEXT_UNAVAILABLE');
 parentPort.postMessage({pages});
}catch(error){parentPort.postMessage({error:error instanceof Error?error.message:'PDF_EXTRACTION_FAILED'})}
finally{await task.destroy()}
