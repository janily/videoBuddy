import {expect,it} from 'vitest';
import {layoutBookCaption,bookCaptionState} from '../../runtime/media/book-caption.mjs';
const measure=(text:string,family:string)=>family==='Ma Shan Zheng'?52:26;
const box={x:100,y:800,width:1720,height:200};
it('lays out measured Chinese and Latin handwriting inside an explicit safe region',()=>{
 const result=layoutBookCaption('洒下适量的水，润湿土壤。',{safeBox:box,measure});
 expect(result.glyphs.map(g=>g.text).join('')).toBe('洒下适量的水，润湿土壤。');
 expect(result.glyphs.every(g=>g.family==='Ma Shan Zheng')).toBe(true);
 expect(result.bounds.x).toBeGreaterThanOrEqual(box.x);expect(result.bounds.y+result.bounds.height).toBeLessThanOrEqual(box.y+box.height);
 const english=layoutBookCaption('Observe growth, care with patience.',{safeBox:box,measure});
 expect(english.glyphs.every(g=>g.family==='Patrick Hand')).toBe(true);
 expect(()=>layoutBookCaption('长'.repeat(200),{safeBox:box,measure})).toThrow('BOOK_CAPTION_OVERFLOW');
 expect(()=>layoutBookCaption('text',{safeBox:{...box,width:0},measure})).toThrow('BOOK_CAPTION_LAYOUT_INVALID');
});
it('reveals left to right then boils at 12 fps without call-order state',()=>{
 const layout=layoutBookCaption('观察成长',{safeBox:box,measure});
 const cue={id:'line_1',startMs:1000,endMs:6000};
 expect(bookCaptionState(layout,cue,999).glyphs).toHaveLength(0);
 expect(bookCaptionState(layout,cue,1000).glyphs).toHaveLength(1);
 expect(bookCaptionState(layout,cue,1350).glyphs).toHaveLength(4);
 expect(bookCaptionState(layout,cue,2000)).toEqual(bookCaptionState(layout,cue,2040));
 bookCaptionState(layout,cue,4000);
 expect(bookCaptionState(layout,cue,2000)).toEqual(bookCaptionState(layout,cue,2000));
 expect(bookCaptionState(layout,cue,6000).glyphs).toHaveLength(0);
 expect(bookCaptionState(layout,cue,1500).stableReadableStartMs).toBe(1350);
});
it('rejects invalid metrics and unsafe text rather than hiding or shrinking captions',()=>{
 for(const width of [NaN,Infinity,-1,500])expect(()=>layoutBookCaption('观察',{safeBox:box,measure:()=>width})).toThrow('BOOK_CAPTION_METRICS_INVALID');
 for(const text of ['', ' ', 'x\rY', 'x\u0000y', 'x\n\nY'])expect(()=>layoutBookCaption(text,{safeBox:box,measure})).toThrow();
 expect(()=>layoutBookCaption('W',{safeBox:{x:0,y:0,width:110,height:120},measure:()=>100})).toThrow('BOOK_CAPTION_METRICS_INVALID');
 const layout=layoutBookCaption('观察',{safeBox:box,measure});
 for(const time of [NaN,Infinity,-1])expect(()=>bookCaptionState(layout,{id:'line',startMs:0,endMs:2000},time)).toThrow('BOOK_CAPTION_TIME_INVALID');
});

it('reserves the torn-paper extent on tight safe-region boundaries',()=>{
 expect(()=>layoutBookCaption('观察成长',{safeBox:{x:100,y:800,width:400,height:120},measure})).toThrow('BOOK_CAPTION_OVERFLOW');
 expect(()=>layoutBookCaption('观察\n成长',{safeBox:{x:100,y:800,width:400,height:192},measure})).toThrow('BOOK_CAPTION_OVERFLOW');
 const exact=layoutBookCaption('观察',{safeBox:{x:100,y:800,width:158,height:126},measure});
 expect(exact.bounds).toEqual({x:103,y:803,width:152,height:120});
 const actualAdvance=()=>52.00004577636719; // Frozen Chromium measurement in the native v3 receipt.
 expect(()=>layoutBookCaption('观察',{safeBox:{x:100,y:800,width:158,height:126},measure:actualAdvance})).toThrow('BOOK_CAPTION_OVERFLOW');
 expect(layoutBookCaption('观察',{safeBox:{x:100,y:800,width:160,height:126},measure:actualAdvance}).glyphs).toHaveLength(2);
});
