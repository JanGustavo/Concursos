const PRACTICE_KEY='tjpb-question-bank-v1', SESSION_KEY='tjpb-question-session-v1';
let practiceStore={questions:{},attempts:[]},practiceSession=null;
const byId=id=>document.getElementById(id);
function practiceStatus(text,error=false){byId('practice-status').textContent=text;byId('practice-status').classList.toggle('error',error)}
function persistPractice(next){
  try{localStorage.setItem(PRACTICE_KEY,JSON.stringify(PracticeCore.backup(next)))}catch{throw Error('Não foi possível salvar no navegador. Libere espaço ou permita o armazenamento antes de responder.');}
  practiceStore=next;
}
function saveSession(){try{if(practiceSession)localStorage.setItem(SESSION_KEY,JSON.stringify(practiceSession));else localStorage.removeItem(SESSION_KEY)}catch{practiceStatus('O histórico foi salvo, mas a posição deste treino não pôde ser guardada.',true)}}
function practiceProgress(){loadProgress(PracticeCore.progress(practiceStore))}
function renderPracticeOverview(){
  const eligible=PracticeCore.eligible(practiceStore),all=Object.values(practiceStore.questions),n=practiceStore.attempts.length,hits=practiceStore.attempts.filter(a=>a.correta).length;
  byId('practice-metrics').innerHTML=`<div class="practice-metric"><strong>${eligible.length}</strong><span>questões prontas / ${all.length} no banco</span></div><div class="practice-metric"><strong>${n}</strong><span>tentativas deste aparelho</span></div><div class="practice-metric"><strong>${n?Math.round(hits*100/n)+'%':'—'}</strong><span>taxa de acerto nas tentativas</span></div>`;
  const pending=all.filter(q=>q.review.length);
  byId('pending-label').textContent=pending.length+' questões aguardando revisão';
  byId('pending-list').innerHTML=pending.map(q=>`<li><strong>${esc(q.id)}</strong> · ${esc(q.assunto.slice(1).join(' > '))}<br>${esc(q.review.join(' '))}</li>`).join('');
  byId('practice-pending').hidden=!pending.length;
  const available=PracticeCore.eligible(practiceStore,byId('practice-block').value,byId('practice-wrong').checked);
  byId('practice-available').textContent=available.length+' questões disponíveis neste filtro. O treino usará até '+byId('practice-size').value+'.';
  byId('practice-start').disabled=!available.length;
  byId('bank-import').disabled=Boolean(practiceSession);
}
function renderPracticeBlock(id){
  const count=PracticeCore.eligible(practiceStore,id).length;
  byId('practice-block-note').textContent=count?count+' questões prontas neste aparelho':'Importe um JSON deste bloco para começar.';
  byId('practice-block-button').textContent=count?'Questões importadas ('+count+')':'Abrir questões importadas';
}
function setPracticePanel(panel){
  byId('practice-setup').hidden=panel!=='setup';byId('practice-session').hidden=panel!=='session';byId('practice-result').hidden=panel!=='result';
}
function newPracticeId(){return typeof crypto.randomUUID==='function'?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
let timerInterval = null;
function stopCountdown() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = byId('session-countdown');
  if (el) el.hidden = true;
}
function startCountdown(seconds) {
  stopCountdown();
  if (!seconds || seconds <= 0) return;
  const el = byId('session-countdown');
  const disp = byId('countdown-display');
  if (!el || !disp) return;
  el.hidden = false;
  el.classList.remove('timer-warning');
  let remaining = seconds;
  const update = () => {
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    disp.textContent = `${m}:${s}`;
    if (remaining <= 30) el.classList.add('timer-warning');
    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      practiceStatus('Tempo sugerido para a questão esgotado (ritmo de prova). Finalize sua resposta!', true);
    }
    remaining--;
  };
  update();
  timerInterval = setInterval(update, 1000);
}

const AUTH_TOKEN_KEY = 'tjpb-auth-token-v1';
let currentUser = null;
let isRegisterMode = false;

function getAuthHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}

async function checkCurrentUser() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    updateUserUI(null);
    return;
  }
  try {
    const res = await fetch('/api/me', { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.ok && data.user) {
      currentUser = data.user;
      updateUserUI(currentUser);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      currentUser = null;
      updateUserUI(null);
    }
  } catch {
    updateUserUI(currentUser);
  }
}

function updateUserUI(user) {
  const disp = byId('user-display');
  const btnAuth = byId('btn-open-auth');
  const btnLogout = byId('btn-logout');
  if (!disp) return;
  if (user) {
    disp.textContent = `👤 ${user.nome} (@${user.username})`;
    if (btnAuth) btnAuth.hidden = true;
    if (btnLogout) btnLogout.hidden = false;
  } else {
    disp.textContent = '👤 Visitante (não autenticado)';
    if (btnAuth) btnAuth.hidden = false;
    if (btnLogout) btnLogout.hidden = true;
  }
}

function openAuthDialog(register = false) {
  isRegisterMode = register;
  byId('auth-title').textContent = isRegisterMode ? 'Criar Conta na Turma' : 'Entrar na Turma';
  byId('btn-submit-auth').textContent = isRegisterMode ? 'Cadastrar e Entrar' : 'Entrar';
  byId('btn-toggle-auth-mode').textContent = isRegisterMode ? 'Já tem conta? Entrar' : 'Não tem conta? Cadastrar';
  byId('auth-nome-group').hidden = !isRegisterMode;
  byId('auth-error').hidden = true;
  byId('auth-username').value = '';
  byId('auth-password').value = '';
  byId('auth-nome').value = '';
  byId('modal-auth').showModal();
}

async function handleAuthSubmit() {
  const username = byId('auth-username').value.trim();
  const password = byId('auth-password').value;
  const nome = byId('auth-nome').value.trim();
  const errEl = byId('auth-error');
  errEl.hidden = true;
  const endpoint = isRegisterMode ? '/api/register' : '/api/login';
  const payload = isRegisterMode ? { username, password, nome } : { username, password };
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Falha ao autenticar.');
    localStorage.setItem(AUTH_TOKEN_KEY, data.user.token);
    currentUser = data.user;
    updateUserUI(currentUser);
    byId('modal-auth').close();
    window.dispatchEvent(new Event('tjpb-auth-change'));
    practiceStatus(`Bem-vindo, ${currentUser.nome}! Seus dados estão conectados.`);
    syncWithServer();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

function logoutUser() {
  void fetch('/api/library/logout', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
  localStorage.removeItem(AUTH_TOKEN_KEY);
  currentUser = null;
  updateUserUI(null);
  window.dispatchEvent(new Event('tjpb-auth-change'));
  practiceStatus('Você saiu da sua conta.');
}

async function openLeaderboard() {
  byId('modal-leaderboard').showModal();
  refreshLeaderboard();
}

async function refreshLeaderboard() {
  const tbody = byId('leaderboard-body');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:15px;">Atualizando ranking...</td></tr>';
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    if (!data.ok || !data.leaderboard.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:15px;">Nenhum participante pontuou ainda. Seja o primeiro!</td></tr>';
      return;
    }
    tbody.innerHTML = data.leaderboard.map(item => {
      let badge = item.posicao;
      if (item.posicao === 1) badge = '<span class="badge-gold">🥇 1º</span>';
      else if (item.posicao === 2) badge = '<span class="badge-silver">🥈 2º</span>';
      else if (item.posicao === 3) badge = '<span class="badge-bronze">🥉 3º</span>';
      
      const isMe = currentUser && currentUser.username === item.username;
      const highlightStyle = isMe ? 'style="font-weight:bold;background:rgba(37,99,235,0.1);"' : '';
      return `<tr ${highlightStyle}>
        <td>${badge}</td>
        <td>${esc(item.nome)} <small style="color:var(--muted)">(@${esc(item.username)})</small></td>
        <td><strong>${item.acertos}</strong></td>
        <td>${item.total}</td>
        <td>${item.taxa}%</td>
        <td>🔥 ${item.dias_ativos}d</td>
      </tr>`;
    }).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:15px;color:red;">Não foi possível carregar o placar.</td></tr>';
  }
}

async function syncWithServer() {
  practiceStatus('Sincronizando com o servidor...');
  try {
    const payload = PracticeCore.backup(practiceStore);
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Servidor respondeu com código ' + res.status);
    const data = await res.json();
    practiceStatus('✔ ' + (data.msg || 'Sincronização concluída com sucesso!'));
  } catch (err) {
    practiceStatus('Falha ao sincronizar: ' + err.message, true);
  }
}

function startPractice(){
  const available=PracticeCore.eligible(practiceStore,byId('practice-block').value,byId('practice-wrong').checked);
  for(let i=available.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[available[i],available[j]]=[available[j],available[i]]}
  if(!available.length){practiceStatus('Não há questões prontas com esse filtro.');return}
  practiceSession={id:newPracticeId(),ids:available.slice(0,Number(byId('practice-size').value)).map(q=>q.id),index:0,timerSeconds:Number(byId('practice-timer')?.value||0)};
  saveSession();renderPracticeQuestion();renderPracticeOverview();
}
function currentPracticeAttempt(){return practiceSession&&practiceStore.attempts.find(a=>a.id===practiceSession.id+':'+practiceSession.index)}
function renderPracticeQuestion(){
  if(!practiceSession)return;
  const q=practiceStore.questions[practiceSession.ids[practiceSession.index]];
  if(!q||q.review.length){practiceSession=null;saveSession();setPracticePanel('setup');practiceStatus('O treino foi encerrado porque uma questão mudou ou precisa de revisão. As respostas anteriores foram preservadas.');return}
  setPracticePanel('session');
  byId('session-position').textContent='Questão '+(practiceSession.index+1)+' de '+practiceSession.ids.length;
  byId('question-meta').textContent=q.id+' · '+q.assunto.join(' > ')+'\n'+q.prova;
  byId('question-statement').textContent=q.enunciado;
  byId('question-reading').hidden=!q.texto;byId('question-reading').open=Boolean(q.texto);byId('question-text').textContent=q.texto;
  byId('question-options').innerHTML=Object.entries(q.alternativas).sort(([a],[b])=>a.localeCompare(b)).map(([letter,text])=>`<label class="question-option" data-letter="${letter}"><input type="radio" name="practice-answer" value="${letter}"><span><span class="option-letter">${letter}</span>${esc(text).replace(/«([^»]+)»/g,'<mark>$1</mark>')}</span></label>`).join('');
  byId('question-why').value='';byId('question-confidence').value='duvida';byId('question-answer').disabled=true;byId('question-answer').hidden=false;
  byId('question-feedback').hidden=true;byId('question-after').hidden=true;byId('question-ai').hidden=true;
  byId('question-why').disabled=false;byId('question-confidence').disabled=false;
  const attempt=currentPracticeAttempt();if(attempt){stopCountdown();renderPracticeFeedback(attempt);}else{startCountdown(practiceSession.timerSeconds);}
  byId('practice-session').scrollIntoView({block:'start',behavior:'instant'});
}
function renderPracticeFeedback(attempt){
  stopCountdown();
  byId('question-options').querySelectorAll('input').forEach(input=>{input.disabled=true;input.checked=input.value===attempt.resposta;input.closest('label').classList.toggle('answer-right',input.value===attempt.gabarito);input.closest('label').classList.toggle('answer-wrong',input.value===attempt.resposta&&!attempt.correta)});
  byId('question-why').value=attempt.justificativa;byId('question-why').disabled=true;byId('question-confidence').value=attempt.confianca;byId('question-confidence').disabled=true;
  byId('question-answer').hidden=true;byId('question-feedback').hidden=false;byId('question-after').hidden=false;
  const title=attempt.correta?'Resposta correta.':'Resposta incorreta.';
  byId('question-feedback').innerHTML=`<strong>${title}</strong>Você marcou ${esc(attempt.resposta)}. Gabarito importado: ${esc(attempt.gabarito)}.<small>Resposta e justificativa salvas neste navegador. A explicação conceitual pode ser estudada no mapa ou preparada para o ChatGPT.</small>`;
  byId('question-next').textContent=practiceSession.index===practiceSession.ids.length-1?'Ver resultado':'Próxima questão';
}
function gradePractice(){
  if(!practiceSession||currentPracticeAttempt())return;
  const selected=byId('question-options').querySelector('input:checked');if(!selected)return;
  try{
    const next=PracticeCore.answer(practiceStore,practiceSession.ids[practiceSession.index],selected.value,byId('question-why').value,byId('question-confidence').value,practiceSession.id+':'+practiceSession.index,new Date().toISOString());
    persistPractice(next);saveSession();renderPracticeFeedback(currentPracticeAttempt());practiceProgress();renderPracticeOverview();practiceStatus('Resposta salva.');
  }catch(e){practiceStatus(e.message,true)}
}
function finishPractice(){
  stopCountdown();
  if(!practiceSession)return;
  const attempts=practiceStore.attempts.filter(a=>a.id.startsWith(practiceSession.id+':'));
  const hits=attempts.filter(a=>a.correta).length;practiceSession=null;saveSession();setPracticePanel('result');
  byId('practice-result').innerHTML=`<h3>Treino encerrado</h3><p><strong>${hits} acertos em ${attempts.length} respostas${attempts.length?' · '+Math.round(100*hits/attempts.length)+'%':''}</strong></p><p class="practice-caption">As tentativas e justificativas foram salvas. Seu mapa já mostra o progresso deste aparelho.</p><button class="practice-btn primary" type="button" id="practice-again">Preparar outro treino</button>`;
  byId('practice-again').addEventListener('click',()=>{setPracticePanel('setup');renderPracticeOverview()});renderPracticeOverview();practiceProgress();
}
function downloadPractice(name,text,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function buildPracticeDoubt(){
  const q=practiceStore.questions[practiceSession.ids[practiceSession.index]],a=currentPracticeAttempt();
  return `Sou candidato ao TJPB, Analista Judiciário de TI – Desenvolvimento de Sistemas, banca FGV. Quero entender e aplicar o conceito, com um exemplo simples e uma pergunta de transferência depois da explicação.\n\nAssunto: ${q.assunto.join(' > ')}\nQuestão: ${q.id}\nProva informada no arquivo: ${q.prova}\n${q.texto?'Texto associado:\n'+q.texto+'\n\n':''}Enunciado:\n${q.enunciado}\n\n${Object.entries(q.alternativas).map(([k,v])=>k+') '+v).join('\n')}\n\nMinha resposta: ${a.resposta}.\nGabarito importado: ${a.gabarito} (ainda não conferido na fonte).\nMeu raciocínio: ${a.justificativa||'Não registrei.'}\nConfiança: ${a.confianca}.\n\nExplique o conceito e por que cada alternativa funciona ou falha. Avalie meu raciocínio sem presumir minha dificuldade. Se o gabarito parecer inconsistente ou faltar um destaque no texto, aponte a dúvida. Não invente comentário oficial ou frequência de cobrança da FGV. Ao citar questões reais, informe a fonte. Espere minha resposta à pergunta de transferência.`;
}
async function copyPracticeText(field){
  try{await navigator.clipboard.writeText(field.value);practiceStatus('Prompt copiado. Cole na conversa do ChatGPT.');return}catch{}
  field.focus();field.select();try{if(document.execCommand('copy')){practiceStatus('Prompt copiado.');return}}catch{}
  practiceStatus('Texto selecionado. Use Copiar no menu do celular ou Ctrl+C no computador.');
}
function isPhone(){return /Android|iPhone|iPad/i.test(navigator.userAgent)}
function phoneChatClick(e){
  if(!isPhone())return;
  e.preventDefault();void copyStudyPrompt();window.open('https://chatgpt.com/','_blank','noopener,noreferrer');
}

for(const select of [byId('practice-block'),byId('bank-import-block')])while(select.options.length>1)select.remove(1);
Object.keys(nodes).forEach(id=>{for(const select of [byId('practice-block'),byId('bank-import-block')]){const option=document.createElement('option');option.value=id;option.textContent=id+' · '+nodes[id].title;select.appendChild(option)}});
for(const id of ['practice-block','practice-size','practice-wrong'])byId(id).addEventListener('change',renderPracticeOverview);
byId('practice-start').addEventListener('click',startPractice);
byId('question-options').addEventListener('change',()=>{byId('question-answer').disabled=!byId('question-options').querySelector('input:checked')});
byId('question-answer').addEventListener('click',gradePractice);
byId('practice-stop').addEventListener('click',finishPractice);
byId('question-next').addEventListener('click',()=>{if(practiceSession.index+1>=practiceSession.ids.length)finishPractice();else{practiceSession.index++;saveSession();renderPracticeQuestion()}});
byId('question-explain').addEventListener('click',()=>{byId('question-ai-prompt').value=buildPracticeDoubt();byId('question-ai').hidden=false;byId('question-ai').scrollIntoView({block:'nearest'})});
byId('question-ai-copy').addEventListener('click',()=>copyPracticeText(byId('question-ai-prompt')));
byId('bank-sync')?.addEventListener('click',syncWithServer);
byId('bank-import').addEventListener('click',()=>byId('bank-file').click());
byId('bank-file').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{if(file.size>20*1024*1024)throw Error('O arquivo excede 20 MB. Divida em lotes menores.');const data=JSON.parse(await file.text());const next=PracticeCore.merge(practiceStore,data,byId('bank-import-block').value||null);persistPractice(next);practiceProgress();renderPracticeOverview();practiceStatus('Arquivo importado. '+Object.keys(next.questions).length+' questões no banco; histórico preservado.')}catch(error){practiceStatus('Importação recusada: '+error.message+' O banco anterior foi preservado.',true)}
});
byId('bank-backup').addEventListener('click',()=>{downloadPractice('tjpb-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(PracticeCore.backup(practiceStore),null,2));practiceStatus('Backup preparado para download. Guarde-o para recuperar ou transferir seu histórico.');});
byId('bank-progress').addEventListener('click',()=>downloadPractice('progresso.json',JSON.stringify(PracticeCore.progress(practiceStore),null,2)));
byId('bank-offline').addEventListener('click',()=>{
  const clone=document.documentElement.cloneNode(true);clone.querySelector('#practice-seed').textContent=JSON.stringify(PracticeCore.backup(practiceStore)).replace(/</g,'\\u003c');clone.querySelectorAll('dialog').forEach(d=>d.removeAttribute('open'));
  downloadPractice('tjpb-estudo-offline.html','<!doctype html>\n'+clone.outerHTML,'text/html');practiceStatus('App preparado para download com as questões e tentativas atuais. No Android, abra o HTML no Chrome. Salve também um backup JSON.');
});
byId('practice-block-button').addEventListener('click',()=>{const id=currentStudyNode;modal.close();byId('practice-block').value=id;showView('questions-view');renderPracticeOverview();byId('practice-setup').scrollIntoView({block:'start'})});
byId('detail-items').addEventListener('click',e=>{if(e.target.closest('[data-study]'))phoneChatClick(e)});byId('study-open-app').addEventListener('click',phoneChatClick);
try{
  const saved=localStorage.getItem(PRACTICE_KEY),data=saved?JSON.parse(saved):JSON.parse(byId('practice-seed').textContent);
  practiceStore=PracticeCore.merge({questions:{},attempts:[]},data);if(!saved)persistPractice(practiceStore);
}catch(error){practiceStatus('Não foi possível carregar o banco: '+error.message+' Importe um backup para continuar.',true)}
try{const saved=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');if(saved&&typeof saved.id==='string'&&Array.isArray(saved.ids)&&saved.ids.length&&saved.ids.every(id=>practiceStore.questions[id])&&Number.isInteger(saved.index)&&saved.index>=0&&saved.index<saved.ids.length)practiceSession=saved}catch{}
renderPracticeOverview();
if(practiceStore.attempts.length)practiceProgress();
setPracticePanel('setup');
if(practiceSession)renderPracticeQuestion();
const initialViews={inicio:'start-view',ciclo:'planner-view',questoes:'questions-view',gran:'gran-view',cursos:'courses-view',banca:'data-view'};
showView(initialViews[new URLSearchParams(location.search).get('view')]||'map-view');

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname.startsWith('192.168.') || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

byId('btn-open-auth')?.addEventListener('click', () => openAuthDialog(false));
byId('btn-close-auth')?.addEventListener('click', () => byId('modal-auth').close());
byId('btn-toggle-auth-mode')?.addEventListener('click', () => openAuthDialog(!isRegisterMode));
byId('form-auth')?.addEventListener('submit', (e) => { e.preventDefault(); handleAuthSubmit(); });
byId('btn-logout')?.addEventListener('click', logoutUser);
byId('btn-open-leaderboard')?.addEventListener('click', openLeaderboard);
byId('btn-close-leaderboard')?.addEventListener('click', () => byId('modal-leaderboard').close());
byId('btn-refresh-leaderboard')?.addEventListener('click', refreshLeaderboard);
checkCurrentUser();
// O diálogo de login deve funcionar também quando o módulo de questões está oculto.
document.body.appendChild(byId('modal-auth'));
window.addEventListener('tjpb-request-login',()=>openAuthDialog(false));
