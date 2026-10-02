import {CompanionShell}from '@/components/video-studio/companion-shell';
export default async function ProjectPage({params}:{params:Promise<{projectId:string}>}){const{projectId}=await params;return<CompanionShell key={projectId} projectId={projectId}/>}
