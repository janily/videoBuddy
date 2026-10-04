// Trusted compositor primitive. Inputs are frozen captions and an explicitly
// reserved clear region; generated shot code never controls this renderer.
const FONT_SIZE=52,LINE_HEIGHT=72,PADDING=24,REVEAL_MS=350;
const segmenter=new Intl.Segmenter('und',{granularity:'grapheme'});
function validBox(box){return box&&['x','y','width','height'].every(k=>Number.isFinite(box[k]))&&box.x>=0&&box.y>=0&&box.width>2*PADDING+FONT_SIZE&&box.height>=LINE_HEIGHT+2*PADDING&&box.width<=3840&&box.height<=3840}
function random(seed){let value=2166136261;for(const c of seed)value=Math.imul(value^c.charCodeAt(0),16777619);value=Math.imul(value^(value>>>16),0x85ebca6b);value=Math.imul(value^(value>>>13),0xc2b2ae35);return ((value^(value>>>16))>>>0)/4294967296}
export function layoutBookCaption(text,{safeBox,measure}){
 if(typeof text!=='string'||!text.trim()||text.length>500||/[\u0000-\u0009\u000b-\u001f\u007f\r]/.test(text)||!validBox(safeBox)||typeof measure!=='function')throw Error('BOOK_CAPTION_LAYOUT_INVALID');
 const chinese=/\p{Script=Han}/u.test(text),maxWidth=safeBox.width-2*PADDING-6,lines=[[]],widths=[0];
 for(const {segment} of segmenter.segment(text)){
  if(segment==='\n'){lines.push([]);widths.push(0);continue}
  const family=chinese?'Ma Shan Zheng':'Patrick Hand',width=measure(segment,family,FONT_SIZE);
  if(!Number.isFinite(width)||width<0||width>FONT_SIZE*4||width>maxWidth)throw Error('BOOK_CAPTION_METRICS_INVALID');
  if(widths.at(-1)+width>maxWidth&&lines.at(-1).length){lines.push([]);widths.push(0)}
  lines.at(-1).push({text:segment,family,width});widths[widths.length-1]+=width;
 }
 if(lines.length>2||lines.some(line=>!line.length)||lines.length*LINE_HEIGHT+2*PADDING+6>safeBox.height)throw Error('BOOK_CAPTION_OVERFLOW');
 const height=lines.length*LINE_HEIGHT+2*PADDING,width=Math.max(...widths)+2*PADDING;
 const bounds={x:safeBox.x+(safeBox.width-width)/2,y:safeBox.y+(safeBox.height-height)/2,width,height},glyphs=[];
 for(let row=0;row<lines.length;row++){
  let x=safeBox.x+(safeBox.width-widths[row])/2;
  for(const glyph of lines[row]){glyphs.push({...glyph,x:x+glyph.width/2,y:bounds.y+PADDING+LINE_HEIGHT*(row+0.5)});x+=glyph.width}
 }
 return{glyphs,bounds,fontSize:FONT_SIZE,revealMs:REVEAL_MS};
}
export function bookCaptionState(layout,cue,timeMs){
 if(!cue||typeof cue.id!=='string'||!cue.id||!Number.isSafeInteger(cue.startMs)||cue.startMs<0||!Number.isSafeInteger(cue.endMs)||cue.endMs<=cue.startMs+REVEAL_MS||!Number.isFinite(timeMs)||timeMs<0)throw Error('BOOK_CAPTION_TIME_INVALID');
 const stableReadableStartMs=cue.startMs+REVEAL_MS;
 if(timeMs<cue.startMs||timeMs>=cue.endMs)return{glyphs:[],stableReadableStartMs};
 const count=Math.min(layout.glyphs.length,1+Math.floor((timeMs-cue.startMs)/REVEAL_MS*Math.max(0,layout.glyphs.length-1))),tick=Math.floor(timeMs*12/1000);
 return{stableReadableStartMs,glyphs:layout.glyphs.slice(0,count).map((glyph,index)=>({...glyph,dx:(random(`${cue.id}:${tick}:${index}:x`)-0.5)*1.4,dy:(random(`${cue.id}:${tick}:${index}:y`)-0.5)*1.4,angle:(random(`${cue.id}:${tick}:${index}:r`)-0.5)*0.07}))};
}
export function drawBookCaption(ctx,layout,cue,timeMs){
 const state=bookCaptionState(layout,cue,timeMs);if(!state.glyphs.length)return state;
 ctx.save();
 try{
  const b=layout.bounds;ctx.beginPath();
  // The knock-out uses a fixed torn edge. Only ink boils; the page stays still.
  for(let side=0;side<4;side++)for(let step=0;step<=12;step++){
   const u=step/12,jitter=(random(`${cue.id}:paper:${side}:${step}`)-0.5)*5;
   const x=side===0?b.x+u*b.width:side===1?b.x+b.width+jitter:side===2?b.x+(1-u)*b.width:b.x+jitter;
   const y=side===0?b.y+jitter:side===1?b.y+u*b.height:side===2?b.y+b.height+jitter:b.y+(1-u)*b.height;
   if(side===0&&step===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.closePath();ctx.fillStyle='#f4efe3';ctx.fill();ctx.clip();
  // Fixed fine paper tooth, with no random or wall-clock dependency.
  ctx.fillStyle='rgba(96,72,46,0.055)';
  for(let i=0;i<Math.ceil(b.width*b.height/180);i++)ctx.fillRect(b.x+random(`${cue.id}:grain:${i}:x`)*b.width,b.y+random(`${cue.id}:grain:${i}:y`)*b.height,1,1);
  ctx.fillStyle='#563c2e';ctx.textAlign='center';ctx.textBaseline='middle';
  for(const glyph of state.glyphs){ctx.save();ctx.translate(glyph.x+glyph.dx,glyph.y+glyph.dy);ctx.rotate(glyph.angle);ctx.font=`${layout.fontSize}px "${glyph.family}"`;ctx.fillText(glyph.text,0,0);ctx.restore()}
 }finally{ctx.restore()}
 return state;
}
