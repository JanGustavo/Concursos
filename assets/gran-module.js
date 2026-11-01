function granModuleUrl(filter){
 const url=new URL(filter.url);
 url.searchParams.set('banca','102');url.searchParams.set('anulada','0');url.searchParams.set('desatualizada','0');
 for(const [control,param,value] of [['level','nivel','1'],['court','carreira','103'],['hard','dificuldade','4'],['year','anos','2026']]){
  if(document.getElementById('gran-module-'+control).checked)url.searchParams.set(param,value);else url.searchParams.delete(param);
 }
 return url.href;
}
function renderGranModule(){
 const block=document.getElementById('gran-module-block').value;
 const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const query=fold(document.getElementById('gran-module-query').value.trim());
 let total=0;
 const cards=Object.entries(nodes).filter(([id])=>!block||id===block).map(([id,node])=>{
  const filters=granSearchCatalog.topics.filter(f=>f.blocos.includes(id)&&(!query||fold(node.title+' '+node.items.join(' ')+' '+f.label).includes(query)));
  if(!filters.length)return '';
  total+=filters.length;
  const confirmed=filters.filter(f=>f.verified),pending=filters.filter(f=>!f.verified);
  const link=f=>`<a class="gran-external-link" href="${esc(granModuleUrl(f))}" target="_blank" rel="noopener noreferrer"><span>${esc(f.label)}<small>${f.verified?'Mapeamento verificado em 25/10/2026':'Busca a conferir no Gran'}</small></span><span aria-hidden="true">↗</span><span class="sr-only"> · abrir no site do Gran</span></a>`;
  return `<article class="practice-card gran-module-card"><div class="eyebrow">${esc(node.stage)}</div><h3>${esc(node.title)}</h3>${confirmed.map(link).join('')}${pending.length?`<details class="gran-unverified"><summary>Buscas a conferir (${pending.length})</summary>${pending.map(link).join('')}</details>`:''}</article>`;
 }).join('');
 document.getElementById('gran-module-results').innerHTML=cards||'<p class="module-note">Nenhum filtro encontrado. Tente outro termo ou selecione todas as áreas.</p>';
 document.getElementById('gran-module-count').textContent=total+' atalhos de busca no Gran. Os links abrem uma nova aba externa.';
}
while(document.getElementById('gran-module-block').options.length>1)document.getElementById('gran-module-block').remove(1);
for(const [id,node] of Object.entries(nodes)){
 const option=document.createElement('option');option.value=id;option.textContent=node.title;document.getElementById('gran-module-block').appendChild(option);
}
document.getElementById('gran-module-block').addEventListener('change',renderGranModule);
document.getElementById('gran-module-query').addEventListener('input',renderGranModule);
document.querySelectorAll('.gran-module-refine input').forEach(input=>input.addEventListener('change',renderGranModule));
renderGranModule();
