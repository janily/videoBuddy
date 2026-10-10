import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {extractLocalPdfText} from '@/services/video/assets/local-pdf';
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'vb-local-pdf-'))});
afterEach(async()=>{await rm(root,{recursive:true,force:true})});
function pdf(text:string){
 const stream=`BT /F1 12 Tf 20 50 Td (${text}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${object}\nendobj\n`});const start=Buffer.byteLength(data);data+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return data;
}
it('extracts actual PDF text in a bounded worker without a media container',async()=>{
 const path=join(root,'source.pdf');await writeFile(path,pdf('VideoBuddy local PDF'));
 expect(await extractLocalPdfText(path)).toEqual(['VideoBuddy local PDF']);
});
it('rejects symlinks and malformed bytes before publishing text',async()=>{
 const path=join(root,'source.pdf');await writeFile(path,'not a pdf');await symlink(path,join(root,'alias.pdf'));
 await expect(extractLocalPdfText(join(root,'alias.pdf'))).rejects.toThrow('ASSET_INVALID');
 await expect(extractLocalPdfText(path)).rejects.toThrow('ASSET_INVALID');
});
it('honors pre-cancelled jobs',async()=>{
 const path=join(root,'source.pdf');await writeFile(path,pdf('Never parse'));
 await expect(extractLocalPdfText(path,{signal:AbortSignal.abort()})).rejects.toThrow('PDF_CANCELLED');
});
