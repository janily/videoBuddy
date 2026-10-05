export interface BookCaptionBox{x:number;y:number;width:number;height:number}
export interface BookGlyph{text:string;family:'Long Cang'|'Patrick Hand';width:number;x:number;y:number}
export interface BookCaptionLayout{glyphs:BookGlyph[];bounds:BookCaptionBox;fontSize:number;revealMs:number}
export interface BookCaptionCue{id:string;startMs:number;endMs:number}
export interface BookCaptionState{glyphs:(BookGlyph&{dx:number;dy:number;angle:number})[];stableReadableStartMs:number}
export function layoutBookCaption(text:string,options:{safeBox:BookCaptionBox;measure:(text:string,family:string,fontSize:number)=>number}):BookCaptionLayout;
export function bookCaptionState(layout:BookCaptionLayout,cue:BookCaptionCue,timeMs:number):BookCaptionState;
export function drawBookCaption(ctx:CanvasRenderingContext2D,layout:BookCaptionLayout,cue:BookCaptionCue,timeMs:number):BookCaptionState;
