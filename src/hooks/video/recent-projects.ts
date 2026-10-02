const key='vb-recent-project-ids';
export function recentProjectIds(){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter((id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id)).slice(0,20):[]}catch{return[]}}
export function rememberProject(id:string){try{localStorage.setItem(key,JSON.stringify([id,...recentProjectIds().filter(p=>p!==id)].slice(0,20)))}catch{/* Storage can be disabled without affecting private project access. */}}
