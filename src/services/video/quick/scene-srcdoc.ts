/** Opaque-origin iframe plus this policy prevents network and host-document access. */
export function sceneSrcdoc(source:string,durationSec:number,fontCss='',startSec=0){
 const csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 const bridge=`<script>(()=>{const duration=${JSON.stringify(durationSec)};let pending=0;function draw(t){pending=Math.max(0,Math.min(duration,t));if(window.READY&&typeof window.render==='function')window.render(pending+${JSON.stringify(startSec)})}window.addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='videobuddy:time'||typeof e.data.timeSec!=='number'||!Number.isFinite(e.data.timeSec))return;draw(e.data.timeSec)});window.addEventListener('load',()=>{Promise.resolve(document.fonts.ready).then(()=>draw(pending))})})();</script>`;
 return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;overflow:hidden}*{box-sizing:border-box}${fontCss}</style>${bridge}${source}`;
}
