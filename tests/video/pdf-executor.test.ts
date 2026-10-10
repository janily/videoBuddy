import {expect,it,vi} from 'vitest';
import {assertPdfRuntime,extractPdfText} from '@/services/video/assets/pdf-executor';
import {extractLocalPdfText} from '@/services/video/assets/local-pdf';
vi.mock('@/services/video/assets/local-pdf',()=>({extractLocalPdfText:vi.fn()}));
it('checks local parser installation without executing a native process',async()=>{await expect(assertPdfRuntime()).resolves.toBeUndefined()});
it('routes source-worker extraction through the bounded local parser',async()=>{
 vi.mocked(extractLocalPdfText).mockResolvedValueOnce(['Actual bounded parser output']);expect(await extractPdfText('/tmp/source.pdf','asset-id')).toEqual(['Actual bounded parser output']);expect(extractLocalPdfText).toHaveBeenCalledWith('/tmp/source.pdf');
 vi.mocked(extractLocalPdfText).mockRejectedValueOnce(Error('PDF_TEXT_LIMIT'));await expect(extractPdfText('/tmp/source.pdf','asset-id')).rejects.toThrow('PDF_TEXT_LIMIT');
});
