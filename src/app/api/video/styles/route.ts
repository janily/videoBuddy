import {searchStyles}from '@/services/video/styles/registry';
export async function GET(request:Request){const url=new URL(request.url);return Response.json({styles:searchStyles(url.searchParams.get('q')||'',url.searchParams.get('category')||undefined)},{headers:{'Cache-Control':'private,no-store'}})}
