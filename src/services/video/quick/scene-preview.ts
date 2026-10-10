import {sceneSrcdoc} from './scene-srcdoc';
export {sceneSrcdoc} from './scene-srcdoc';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalHash} from '@/services/video/domain/hash';
import {createOrRead} from '@/services/video/storage/atomic-store';
import type {ProjectStore} from '@/services/video/storage/project-store';
import {LocalAssetBytes} from '@/services/video/assets/local-bytes';
import {readFile} from 'node:fs/promises';
import {loadRuntimeFonts} from '@/services/video/media/runtime-version';
import {VisualShotSourceSchema,type VisualShotSource} from '@/contracts/video/visual-shot';

const RecordSchema=z.strictObject({projectId:z.uuid(),operationId:z.uuid(),shotId:z.string().min(1).max(120),take:z.number().int().nonnegative(),width:z.number().int().min(64).max(3840),height:z.number().int().min(64).max(3840),fps:z.union([z.literal(24),z.literal(30),z.literal(60)]),source:VisualShotSourceSchema});
type SceneRecord=z.infer<typeof RecordSchema>;
function key(projectId:string,operationId:string,shotId:string,take:number){
 if(!z.uuid().safeParse(projectId).success||!z.uuid().safeParse(operationId).success||!shotId||shotId.length>120||!Number.isSafeInteger(take)||take<0)throw Error('ACCESS_NOT_FOUND');
 return `projects/${projectId}/operations/${operationId}/scenes/${canonicalHash({shotId,take})}`;
}
export async function saveScenePreview(projects:ProjectStore,input:SceneRecord){
 const record=RecordSchema.parse(input);if(record.source.shotId!==record.shotId)throw Error('VISUAL_SOURCE_INVALID');
 const saved=await createOrRead(projects.store,key(record.projectId,record.operationId,record.shotId,record.take),record);
 if(canonicalHash(saved)!==canonicalHash(record))throw Error('VISUAL_SOURCE_INVALID');
}
export async function readScenePreview(projects:ProjectStore,owner:string,root:string,input:{projectId:string;operationId:string;shotId:string;take:number}){
 const control=await projects.access(owner,input.projectId);
 const record=RecordSchema.parse((await projects.store.readFresh(key(input.projectId,input.operationId,input.shotId,input.take))).value);
 if(record.projectId!==input.projectId||record.operationId!==input.operationId||record.shotId!==input.shotId||record.take!==input.take)throw Error('ACCESS_NOT_FOUND');
 let html=record.source.sourceHtml;
 for(const id of record.source.assetIds){
  const asset=control.assets.find(asset=>asset.id===id&&asset.status==='ready'&&asset.rightsConfirmed);if(!asset||!['image/png','image/jpeg','image/webp'].includes(asset.declaredMime))throw Error('ACCESS_NOT_FOUND');
  const actual=await new LocalAssetBytes(root).inspect(input.projectId,id,asset.declaredMime);if(actual.sha256!==asset.sha256||actual.bytes!==asset.bytes)throw Error('RUNTIME_ASSET_CHANGED');
  const data=await readFile(actual.path);if(createHash('sha256').update(data).digest('hex')!==actual.sha256||data.length!==actual.bytes)throw Error('RUNTIME_ASSET_CHANGED');
  html=html.replaceAll(`/assets/${id}.bin`,`data:${asset.declaredMime};base64,${data.toString('base64')}`);
 }
 const {fonts}=await loadRuntimeFonts(join(process.cwd(),'runtime/fonts'));
 const css=fonts.filter(font=>html.includes(font.family)||font.id==='notosanssc').map(font=>`@font-face{font-family:${JSON.stringify(font.family)};src:url(data:font/ttf;base64,${font.data.toString('base64')})}body{font-family:'Noto Sans SC',sans-serif}`).join('');
 const durationSec=(record.source.endFrame-record.source.startFrame)/record.fps;
 return{srcdoc:sceneSrcdoc(html,durationSec,css,record.source.startFrame/record.fps),durationSec,width:record.width,height:record.height};
}
export type {VisualShotSource};
