import {createServer,type Server} from 'node:http';
import type {RuntimeFont} from '../runtime-version';
export interface SceneResources {origin:string;allowed:Set<string>;close:()=>Promise<void>}
export async function sceneResources(sourceHtml:string,assets:Map<string,{data:Buffer;mime:string}>,fonts:RuntimeFont[]):Promise<SceneResources>{
 let origin='';
 const routes=new Map(assets);for(const font of fonts)routes.set(`/fonts/${font.id}/${font.filename}`,{data:font.data,mime:font.filename.endsWith('.otf')?'font/otf':'font/ttf'});
 const css=fonts.map(font=>`@font-face{font-family:${JSON.stringify(font.family)};src:url('/fonts/${font.id}/${font.filename}');font-display:block}`).join('')+'html,body{margin:0;overflow:hidden}body{font-family:"Noto Sans SC",sans-serif}';
 const scene=Buffer.from(`<meta charset="utf-8"><style>${css}</style>${sourceHtml}`);routes.set('/scene.html',{data:scene,mime:'text/html; charset=utf-8'});
 const server:Server=createServer((req,res)=>{
  const pathname=req.url||'',resource=routes.get(pathname);
  if(req.headers.host!==new URL(origin).host||!['GET','HEAD'].includes(req.method||'')||!resource){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':resource.mime,'Content-Length':resource.data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' ${origin}; img-src ${origin} data: blob:; font-src ${origin}; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`});res.end(req.method==='HEAD'?undefined:resource.data);
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const address=server.address();if(!address||typeof address==='string')throw Error('RESOURCE_SERVER_FAILED');origin=`http://127.0.0.1:${address.port}`;
 return{origin,allowed:new Set([...routes.keys()].map(path=>origin+path)),close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve())})};
}
