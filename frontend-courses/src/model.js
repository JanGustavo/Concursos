export function flattenTree(node, parents=[]){
 const path=[...parents,node.name];
 if(node.type!=='folder')return [{...node,path,folderPath:parents}];
 return (node.children||[]).flatMap(child=>flattenTree(child,path));
}
export function filterTree(node,query,type='all',parentMatches=false){
 const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const matches=parentMatches||!query||fold(node.name).includes(fold(query));
 if(node.type!=='folder')return matches&&(type==='all'||node.type===type)?node:null;
 const children=node.children.map(n=>filterTree(n,query,type,matches)).filter(Boolean);
 return children.length?{...node,children}:null;
}
export function relatedResources(entries,selected){
 if(!selected)return [];
 const key=JSON.stringify(selected.folderPath);
 return entries.filter(e=>e.type==='pdf'&&e.id!==selected.id&&JSON.stringify(e.folderPath)===key);
}
export function readProgress(value){
 try{const d=JSON.parse(value||'{}');if(!d||typeof d!=='object'||Array.isArray(d))return {};
 return Object.fromEntries(Object.entries(d).filter(([id,v])=>id&&v&&typeof v==='object').map(([id,v])=>[id,{time:Number.isFinite(v.time)&&v.time>=0?v.time:0,done:v.done===true}]));}catch{return {}}
}
