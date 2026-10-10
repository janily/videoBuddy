import {searchStyles}from '@/services/video/styles/registry';
import {mvpProfile}from '@/services/video/config/profile';
/** Styles plus which of them the configured delivery profile can actually produce right now. */
export async function GET(request:Request){
 const url=new URL(request.url),styles=searchStyles(url.searchParams.get('q')||'',url.searchParams.get('category')||undefined);
 const profile='mvp';
 const deliverableStyleIds=profile==='mvp'?[...mvpProfile.styleSlugs]:styles.map(style=>style.id);
 return Response.json({styles,profile,deliverableStyleIds},{headers:{'Cache-Control':'private,no-store'}});
}
