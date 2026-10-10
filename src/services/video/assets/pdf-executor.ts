import {access} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {extractLocalPdfText} from './local-pdf';

/** Check installed parser/worker files without evaluating untrusted documents. */
export async function assertPdfRuntime(){
 try{
  const require=createRequire(import.meta.url);
  await Promise.all([access(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')),access(join(process.cwd(),'src/services/video/assets/pdf-worker.mjs'))]);
 }catch{throw Error('PDF_RUNTIME_UNAVAILABLE')}
}
export async function extractPdfText(path:string,_assetId:string):Promise<string[]>{
 void _assetId;
 return extractLocalPdfText(path);
}
