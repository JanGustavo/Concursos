import {PdfViewer} from './PdfViewer.jsx';
import {StageBadge} from './StageBadge.jsx';
import React,{useState,useEffect,useMemo,useRef,useCallback} from 'react';
import {flattenTree,filterTree,relatedResources,readProgress} from './model.js';
const authHeaders=()=>({'Content-Type':'application/json',Authorization:'Bearer '+(localStorage.getItem('tjpb-auth-token-v1')||'')});
const minutes=time=>Math.floor(time/60)+':'+String(Math.floor(time%60)).padStart(2,'0');
const clean=name=>name.replace(/^\d+\s*-\s*/,'');
function MaterialFilter({value,onChange}){
 return <label className="course-type-filter">Tipo de material<select value={value} onChange={e=>onChange(e.target.value)}><option value="all">Todos os materiais</option><option value="pdf">Apenas PDFs</option><option value="video">Apenas vídeos</option></select></label>;
}
async function readResponse(response){let data;try{data=await response.json()}catch{throw Error('Não foi possível conectar à biblioteca. Confira sua conexão e tente novamente.')}if(!response.ok)throw Error(data.error||'A biblioteca não está disponível agora.');return data}
function TreeNode({node,selected,progress,onSelect,depth=0,forceOpen=false}){
 if(node.type!=='folder')return <li><button type="button" className={'course-file '+(selected?.id===node.id?'active':'')} onClick={()=>onSelect(node)} aria-current={selected?.id===node.id?'true':undefined}><span aria-hidden="true">{progress[node.id]?.done?'✓':node.type==='video'?'▷':'▤'}</span><span>{node.name}</span><small>{progress[node.id]?.done?(node.type==='pdf'?'Visualizado':'Concluída'):node.type==='video'?'Vídeo':'PDF'}</small></button></li>;
 return <li><details open={depth===0||forceOpen?true:undefined}><summary>{node.name}</summary><ul>{node.children.map(n=><TreeNode key={n.id} node={n} selected={selected} progress={progress} onSelect={onSelect} depth={depth+1} forceOpen={forceOpen}/>)}</ul></details></li>;
}
function LessonPlayer({entry,apiBase,record,speed,onSave,onEnded,onError}){
 const markPdfViewed=useCallback(()=>onSave(entry.id,{done:true}),[entry.id,onSave]);
 const ref=useRef(null),saved=useRef(record?.time||0),last=useRef(0);
 useEffect(()=>{if(ref.current)ref.current.playbackRate=speed},[speed]);
 useEffect(()=>{const video=ref.current;const flush=()=>{if(video)onSave(entry.id,{time:video.currentTime||0})};window.addEventListener('pagehide',flush);return ()=>{if(video)video.pause();flush();window.removeEventListener('pagehide',flush)}},[entry.id,onSave]);
 if(entry.type==='pdf')return <PdfViewer entry={entry} apiBase={apiBase} onViewed={markPdfViewed}/>;
 const save=force=>{if(ref.current&&(force||Date.now()-last.current>5000)){last.current=Date.now();onSave(entry.id,{time:ref.current.currentTime||0})}};
 return <video ref={ref} controls playsInline preload="metadata" src={apiBase+'/media/'+encodeURIComponent(entry.id)} onLoadedMetadata={()=>{if(saved.current>0&&saved.current<ref.current.duration-5)ref.current.currentTime=saved.current;ref.current.playbackRate=speed}} onTimeUpdate={()=>save(false)} onPause={()=>save(true)} onSeeked={()=>save(true)} onEnded={()=>onEnded(entry.id)} onError={onError}/>;
}
export function CourseLibrary({courseId=null,apiBase='/biblioteca/api'}){
 const [catalog,setCatalog]=useState(null),[user,setUser]=useState(null),[state,setState]=useState('loading'),[error,setError]=useState('');
 const [selectedCourse,setSelectedCourse]=useState(courseId),[entryId,setEntryId]=useState(null),[query,setQuery]=useState(''),[progress,setProgress]=useState({}),[speed,setSpeed]=useState(1),[storageError,setStorageError]=useState(false),[reload,setReload]=useState(0);
 const progressKey=useRef(''),lastKey=useRef('');
 const [materialType,setMaterialType]=useState('all');
 useEffect(()=>{
  const controller=new AbortController();let timer;
  const load=async()=>{
   setState('loading');setError('');setSelectedCourse(courseId);setEntryId(null);
   try{
    const token=localStorage.getItem('tjpb-auth-token-v1');if(!token){setUser(null);setCatalog(null);setState('login');return}
    const session=await fetch('/api/library/session',{method:'POST',headers:authHeaders(),body:'{}',signal:controller.signal});
    if(session.status===401){setUser(null);setCatalog(null);setState('login');return}
    const info=await readResponse(session);setUser(info.user);
    progressKey.current='tjpb-library-progress-v3:'+info.user.id;lastKey.current='tjpb-library-last-v3:'+info.user.id;
    setProgress(readProgress(localStorage.getItem(progressKey.current)));
    const data=await readResponse(await fetch(apiBase+'/tree',{headers:authHeaders(),cache:'no-store',signal:controller.signal}));
    setCatalog(data);setState('ready');
    try{const last=JSON.parse(localStorage.getItem(lastKey.current)||'null');if(last&&(!courseId||last.course===courseId)&&data.courses.some(c=>c.id===last.course)){setSelectedCourse(last.course);setEntryId(last.entry)}}catch{}
    timer=setInterval(()=>{fetch('/api/library/session',{method:'POST',headers:authHeaders(),body:'{}'}).then(r=>{if(r.status===401)setState('login')}).catch(()=>{})},20*60*1000);
   }catch(e){if(e.name!=='AbortError'){setError(e.message);setState('error')}}
  };
  load();const changed=()=>{setCatalog(null);setEntryId(null);setSelectedCourse(courseId);setReload(n=>n+1)};
  window.addEventListener('tjpb-auth-change',changed);
  return ()=>{controller.abort();clearInterval(timer);window.removeEventListener('tjpb-auth-change',changed)};
 },[apiBase,courseId,reload]);
 const course=catalog?.courses.find(c=>c.id===selectedCourse);
 const entries=useMemo(()=>course?flattenTree(course.tree):[],[course]);
 const selected=entries.find(e=>e.id===entryId)||null;
 const visibleTree=useMemo(()=>course?filterTree(course.tree,query.trim(),materialType):null,[course,query,materialType]);
 const visibleEntries=useMemo(()=>visibleTree?flattenTree(visibleTree):[],[visibleTree]);
 const filteredCourses=useMemo(()=>(catalog?.courses||[]).filter(c=>filterTree(c.tree,query.trim(),materialType)),[catalog,query,materialType]);
 const videos=visibleEntries.filter(e=>e.type==='video'),index=videos.findIndex(e=>e.id===entryId);
 const chooseType=type=>{setMaterialType(type);if(selected&&type!=='all'&&selected.type!==type){setEntryId(null);setError('')}};
 const resources=useMemo(()=>relatedResources(entries,selected),[entries,selected]);
 const save=useCallback((id,patch)=>setProgress(previous=>{const next={...previous,[id]:{...previous[id],...patch}};try{localStorage.setItem(progressKey.current,JSON.stringify(next))}catch{setStorageError(true)}return next}),[]);
 const chooseEntry=entry=>{setEntryId(entry.id);setError('');try{localStorage.setItem(lastKey.current,JSON.stringify({course:course.id,entry:entry.id}))}catch{setStorageError(true)}};
 const chooseCourse=c=>{setSelectedCourse(c.id);setEntryId(null);setQuery('');setError('')};
 const requestLogin=()=>window.dispatchEvent(new Event('tjpb-request-login'));
 if(state==='loading')return <div className="course-gate" role="status"><span className="eyebrow">CURSOS E AULAS</span><h2>Carregando sua biblioteca…</h2><p>Conectando aos materiais do curso.</p><div className="course-skeleton" aria-hidden="true"><i/><i/><i/></div></div>;
 if(state==='login')return <div className="course-gate"><span className="courses-badge">Cursos e aulas</span><h2>Seu próximo assunto começa aqui.</h2><p>Entre na sua conta do TJPB para acessar as videoaulas e os materiais organizados por curso e módulo.</p><button className="practice-btn primary" onClick={requestLogin}>Entrar para acessar os cursos</button><p className="practice-caption">Aulas e PDFs precisam de internet. As questões importadas continuam disponíveis no módulo próprio.</p></div>;
 if(state==='error')return <div className="course-gate"><h2>Não foi possível abrir a biblioteca</h2><p role="alert">{error}</p><button className="practice-btn" onClick={()=>setReload(n=>n+1)}>Tentar novamente</button></div>;
 if(courseId&&!course)return <div className="course-gate"><h2>Curso não encontrado</h2><p>Confira o curso configurado para esta tela.</p></div>;
 const completed=entries.filter(v=>progress[v.id]?.done).length;
 const allDone=catalog.courses.reduce((n,c)=>n+flattenTree(c.tree).filter(e=>progress[e.id]?.done).length,0);
 return <div className="course-library">
  <div className="course-topline"><span className="eyebrow">BIBLIOTECA DO DRIVE · {user?.nome}</span><span className="course-access">Acesso autenticado</span></div>
  {!course?<>
   <h2>Aulas e materiais</h2><p className="practice-lead">Escolha uma área, abra um módulo e estude no seu ritmo.</p>
   <div className="course-stats"><div><strong>{catalog.courses.length}</strong><span>áreas de estudo</span></div><div><strong>{catalog.videos}</strong><span>videoaulas</span></div><div><strong>{catalog.pdfs}</strong><span>materiais em PDF</span></div><div><strong>{allDone}</strong><span>{allDone===1?'material concluído':'materiais concluídos'} neste navegador</span></div></div>
   <div className="course-discovery"><label className="course-search-label">Encontrar curso ou assunto<input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="Ex.: banco de dados, crase, Scrum…"/></label><MaterialFilter value={materialType} onChange={chooseType}/></div>
   <p className="practice-caption" role="status">{filteredCourses.length} cursos com materiais neste filtro.</p>
   <div className="course-grid">{filteredCourses.map((c,i)=>{const done=flattenTree(c.tree).filter(e=>progress[e.id]?.done).length;const total=c.videos+c.pdfs;return <button key={c.id} className="course-card" onClick={()=>chooseCourse(c)}><span className="course-card-number">{String(i+1).padStart(2,'0')} <span aria-hidden="true">→</span></span><h3>{clean(c.title)}</h3><StageBadge stage={done===0?'new':done===total?'done':'active'}/><p>{materialType==='pdf'?c.pdfs+' PDFs':materialType==='video'?c.videos+' vídeos':c.videos+' vídeos · '+c.pdfs+' PDFs'}</p><div className="course-progress-track"><i style={{width:(total?done/total*100:0)+'%'}}/></div><small>{done+' de '+total+' '+(done===1?'material concluído':'materiais concluídos')}</small></button>})}</div>
   {!filteredCourses.length&&<p className="module-note">Nenhum curso encontrado. Tente outro assunto ou tipo de material.</p>}
  </>:<>
   {!courseId&&<button className="course-back" onClick={()=>{setSelectedCourse(null);setEntryId(null);setQuery('');try{localStorage.removeItem(lastKey.current)}catch{}}}>← Todos os cursos</button>}
   <h2>{clean(course.title)}</h2><p className="practice-lead">{course.videos} videoaulas · {course.pdfs} PDFs · {completed} {completed===1?'material concluído':'materiais concluídos'}</p>
   <div className="course-material-toolbar"><p className="practice-caption" role="status">{visibleEntries.length} materiais na lista.</p><MaterialFilter value={materialType} onChange={chooseType}/></div>
   <div className="course-workspace"><aside className="course-sidebar"><label className="course-search-label">Buscar neste curso<input value={query} onChange={e=>setQuery(e.target.value)} type="search" placeholder="Aula, módulo ou material…"/></label><nav aria-label="Módulos e aulas">{visibleTree?<ul className="course-tree"><TreeNode node={visibleTree} selected={selected} progress={progress} onSelect={chooseEntry} forceOpen={Boolean(query.trim())}/></ul>:<p>Nenhuma aula encontrada.</p>}</nav></aside>
   <section className="course-stage" aria-label="Conteúdo da aula">{selected?<>
    <p className="course-breadcrumb">{selected.path.slice(0,-1).map(clean).join(' / ')}</p><h3>{selected.name}</h3>
    <LessonPlayer key={selected.id} entry={selected} apiBase={apiBase} record={progress[selected.id]} speed={speed} onSave={save} onEnded={id=>save(id,{time:0,done:true})} onError={()=>setError('Não foi possível reproduzir este vídeo. Confira sua conexão ou entre novamente para renovar o acesso.')}/>
    {selected.type==='pdf'&&<div className="course-player-actions"><span role="status">{progress[selected.id]?.done?'✓ PDF visualizado':'PDF ainda não visualizado'}</span><button type="button" className="practice-btn" onClick={()=>save(selected.id,{done:!progress[selected.id]?.done})}>{progress[selected.id]?.done?'Desmarcar PDF':'Marcar PDF como visualizado'}</button></div>}
    {selected.type==='video'&&<><div className="course-player-actions"><button className="practice-btn" disabled={index<=0} onClick={()=>chooseEntry(videos[index-1])}>← Aula anterior</button><button className="practice-btn" disabled={index<0||index>=videos.length-1} onClick={()=>chooseEntry(videos[index+1])}>Próxima aula →</button><label>Velocidade<select value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[.75,1,1.25,1.5,1.75,2].map(v=><option value={v} key={v}>{String(v).replace('.',',')}×</option>)}</select></label><button className="practice-btn primary" onClick={()=>save(selected.id,{done:!progress[selected.id]?.done})}>{progress[selected.id]?.done?'✓ Concluída · desmarcar':'Marcar como concluída'}</button></div><p className="practice-caption">{progress[selected.id]?.done?'Aula concluída.':progress[selected.id]?.time?'Posição salva: '+minutes(progress[selected.id].time):'Aula ainda não iniciada.'}</p></>}
    {error&&<p role="alert" className="course-error">{error}</p>}
    <div className="course-resources"><h4>Materiais desta pasta</h4>{resources.length?resources.map(pdf=><a key={pdf.id} href={apiBase+'/media/'+encodeURIComponent(pdf.id)} target="_blank" rel="noopener noreferrer" onClick={()=>save(pdf.id,{done:true})}>▤ {pdf.name} ↗</a>):<p className="practice-caption">Não há outro PDF nesta pasta. Explore os demais materiais na lista de módulos.</p>}</div>
   </>:<div className="course-empty"><span aria-hidden="true">▷</span><h3>Escolha sua próxima aula</h3><p>Abra um módulo na lista e selecione um vídeo ou PDF. A posição do vídeo será salva neste navegador.</p></div>}</section></div>
  </>}
  {storageError&&<p role="alert" className="course-error">Não foi possível salvar seu progresso. Permita o armazenamento neste navegador antes de continuar.</p>}
  <p className="course-footnote">Catálogo importado do Drive. Progresso de aulas salvo neste navegador e por conta; ainda não sincroniza entre aparelhos. Vídeos e PDFs exigem conexão.</p>
 </div>;
}
