import catalog from './catalog.json';
export interface StyleProfile{aspect:'16:9'|'9:16';fps:24|30|60;language:'zh-CN'|'en';durationSec:number}
export interface StylePack{id:string;slug:string;nameZh:string;nameEn:string;categoryZh:string;technicalReviewFocus:string;styleSource:string;upstreamCommit:string;packVersion:string;rulesHash:string;supportedProfiles:StyleProfile[];deliveryStatus:string;capabilityReason:string;license:string}
export function listStyles():StylePack[]{return catalog as StylePack[]}
export function getStyle(slug:string):StylePack{const style=listStyles().find(s=>s.id===slug);if(!style)throw Error('CAPABILITY_UNAVAILABLE: unknown style');return style}
export function searchStyles(query:string,category?:string){const q=query.trim().toLocaleLowerCase();return listStyles().filter(s=>(!category||s.categoryZh===category)&&[s.id,s.nameZh,s.nameEn].some(v=>v.toLocaleLowerCase().includes(q)))}
