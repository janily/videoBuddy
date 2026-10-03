import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {verifyCompositionReceipt} from '@/services/video/media/composition-receipt';

it('rejects orphan outputs and receipts for a different input or output',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vb-receipt-')),path=join(root,'receipt.json');
 const expected={stageKey:'a'.repeat(64),pictureSha256:'b'.repeat(64),trackSha256:'c'.repeat(64),srtSha256:null};
 const output={sha256:'d'.repeat(64),bytes:1000};
 await expect(verifyCompositionReceipt(path,expected,output)).rejects.toThrow('COMPOSITION_STAGE_UNKNOWN');
 await writeFile(path,JSON.stringify({schemaVersion:1,...expected,outputSha256:output.sha256,outputBytes:output.bytes}));
 await expect(verifyCompositionReceipt(path,expected,output)).resolves.toBeUndefined();
 await expect(verifyCompositionReceipt(path,{...expected,trackSha256:'e'.repeat(64)},output)).rejects.toThrow('COMPOSITION_SOURCE_CHANGED');
 await expect(verifyCompositionReceipt(path,expected,{...output,sha256:'f'.repeat(64)})).rejects.toThrow('COMPOSITION_OUTPUT_CHANGED');
});
