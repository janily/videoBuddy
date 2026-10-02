import {readFile} from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';

const filename=process.argv[2];
if(filename!=='/input/document.pdf')throw Error('PDF_INPUT_INVALID');
const bytes=new Uint8Array(await readFile(filename));
const task=getDocument({data:bytes,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,stopAtErrors:true});
try{
 const document=await task.promise;
 if(document.numPages<1||document.numPages>100)throw Error('PDF_PAGE_LIMIT');
 const pages=[];
 for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
  const page=await document.getPage(pageNumber);
  const content=await page.getTextContent();
  const text=content.items.map(item=>'str' in item?item.str+(item.hasEOL?'\n':' '):'').join('').trim();
  pages.push(text);
  page.cleanup();
  if(Buffer.byteLength(JSON.stringify(pages))>1024*1024)throw Error('PDF_TEXT_LIMIT');
 }
 process.stdout.write(JSON.stringify({pages}));
}finally{await task.destroy()}
