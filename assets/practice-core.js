const PracticeCore = (() => {
  const blocks = new Set(['p1','p2','p3','p4','r1','r2','r3','r4',...Array.from({length:11},(_,i)=>'t'+(i+1))]);
  const fold = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const copy = o => JSON.parse(JSON.stringify(o));
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const integer = (x,name) => { if(!Number.isSafeInteger(x)||x<0)throw Error(name+' inválido.'); return x; };
  function inferBlock(subject) {
    const s=fold(subject);
    if(/crase|virgula|classes|gerundio|passiva|concordancia|regencia|pontuacao|pronom|norma culta|sintaxe|adverbio|adjetivo|substantivo/.test(s))return 'p3';
    if(/senao|porque|por que|ortograf|coesao|conector|tempos verbais/.test(s))return 'p2';
    if(/reescrita|reorganizacao|substituicao|redundancia|redacao oficial/.test(s))return 'p4';
    if(/interpretacao|texto|noticia|literatura|significacao|estrangeirismo|tipologia/.test(s))return 'p1';
    if(/banco de dados|sql|sgbd|postgres|relacional|modelagem relacional|nosql/.test(s))return 't5';
    if(/engenharia de software|scrum|requisito|metodologia agil|cascata|xp|rup/.test(s))return 't2';
    if(/programacao|algoritmo|java|python|javascript|typescript|estruturas de dados/.test(s))return 't3';
    if(/arquitetura|microservi|rest|api|design pattern|mvc|padroes de projeto/.test(s))return 't4';
    if(/devops|docker|kubernetes|ci\/cd|pipeline|nuvem|aws|git\b/.test(s))return 't7';
    if(/seguranca|owasp|criptografia|qualidade|teste de software|vulnerabilidade/.test(s))return 't8';
    if(/inteligencia artificial|machine learning|ia generativa|llm|deep learning/.test(s))return 't9';
    if(/lgpd|pje|pdpj|transformacao digital|judiciario|governan|itil|cobit/.test(s))return 't10';
    if(/acessibilidade|wcag|usabilidade|ux|ui/.test(s))return 't11';
    if(/logica|proposic|tabela.verdade|argumentacao/.test(s))return 'r4';
    if(/probabilidade|combinatoria|estatistica/.test(s))return 'r3';
    if(/algebra|equac|matriz|funcao/.test(s))return 'r2';
    if(/aritmetica|porcentagem|juros|regra de tres/.test(s))return 'r1';
    return null;
  }
  function prepareQuestions(data, previous={}, fallbackBlock=null) {
    if(!object(data)||!Array.isArray(data.questoes))throw Error('O arquivo precisa de uma lista questoes.');
    if(data.questoes.length>10000)throw Error('Importe até 10.000 questões por arquivo.');
    const texts=data.textos||[];
    if(!Array.isArray(texts)||!texts.every(t=>typeof t==='string'))throw Error('A lista textos é inválida.');
    const seen=new Set(), result={};
    for(const q of data.questoes) {
      if(!object(q)||typeof q.id!=='string'||!q.id.trim())throw Error('Questão sem identificador.');
      const id=q.id.trim();if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id))throw Error('Identificador inválido: '+id);if(seen.has(id))throw Error('ID repetido no arquivo: '+id);seen.add(id);
      if(typeof q.enunciado!=='string'||!q.enunciado.trim())throw Error(id+': enunciado vazio.');
      const alts=q.alternativas;
      if(!object(alts)||Object.keys(alts).length<2||!Object.entries(alts).every(([k,v])=>/^[A-E]$/.test(k)&&typeof v==='string'&&v.trim()))throw Error(id+': alternativas inválidas.');
      const gab=String(q.gabarito||'').trim().toUpperCase();
      if(!Object.hasOwn(alts,gab))throw Error(id+': gabarito ausente ou inválido.');
      let texto=q.texto||'';
      if(typeof texto!=='string')throw Error(id+': texto inválido.');
      if(q.texto_id!==null&&q.texto_id!==undefined){if(!Number.isInteger(q.texto_id)||q.texto_id<0||q.texto_id>=texts.length)throw Error(id+': referência de texto inválida.');texto=texts[q.texto_id];}
      const subjects=q.assunto||[];
      if(!Array.isArray(subjects)||!subjects.every(a=>typeof a==='string'))throw Error(id+': assunto inválido.');
      const bloco=q.bloco||data.bloco||previous[id]?.bloco||fallbackBlock||inferBlock(subjects.join(' > '));
      if(bloco&&!blocks.has(bloco))throw Error(id+': bloco desconhecido.');
      const reasons=[];
      if(!bloco)reasons.push('Sem bloco identificado: importe com o bloco escolhido.');
      if(/sublinhad/i.test(q.enunciado)&&!/[«]|<u\b/i.test([q.enunciado,texto,...Object.values(alts)].join(' ')))reasons.push('O enunciado depende de sublinhado que não foi preservado.');
      if(/metodologia de ensino/.test(fold(subjects.join(' '))))reasons.push('Questão sobre ensino de Português; fora do foco deste edital.');
      if(q.anulada===true||q.desatualizada===true)reasons.push('Marcada como anulada ou desatualizada.');
      const fingerprint=JSON.stringify([q.enunciado,texto,alts,gab]);
      const old=previous[id], version=old ? (old.version||1)+(old.fingerprint!==fingerprint?1:0) : (Number.isSafeInteger(q.version)&&q.version>0?q.version:1);
      result[id]={id,enunciado:q.enunciado,texto,alternativas:copy(alts),gabarito:gab,assunto:[...subjects],bloco,
        prova:typeof q.prova==='string'?q.prova:'',fonte:typeof(q.fonte||data.fonte)==='string'?(q.fonte||data.fonte):null,
        gerado_em:q.gerado_em||data.gerado_em||null,review:reasons,version,fingerprint};
    }
    return result;
  }
  function merge(store,data,fallbackBlock=null) {
    const parsed=prepareQuestions(data,store.questions,fallbackBlock);
    const next={...copy(store),questions:{...store.questions,...parsed}};
    if(data.tentativas!==undefined){
      if(!Array.isArray(data.tentativas))throw Error('Histórico de tentativas inválido.');
      const known=new Map(next.attempts.map(a=>[a.id,a]));
      for(const raw of data.tentativas){
        if(!object(raw)||typeof raw.id!=='string'||!raw.id||!next.questions[raw.questao_id])throw Error('Tentativa sem questão ou identificador válido.');
        if(!/^[A-E]$/.test(raw.resposta)||!/^[A-E]$/.test(raw.gabarito))throw Error('Resposta ou gabarito histórico inválido.');
        if(!blocks.has(raw.bloco)||typeof raw.quando!=='string'||!Number.isFinite(Date.parse(raw.quando)))throw Error('Bloco ou data da tentativa inválidos.');
        const a={id:raw.id,questao_id:raw.questao_id,resposta:raw.resposta,gabarito:raw.gabarito,
          correta:raw.resposta===raw.gabarito,bloco:raw.bloco,quando:raw.quando,
          justificativa:typeof raw.justificativa==='string'?raw.justificativa:'',confianca:['certeza','duvida','chute'].includes(raw.confianca)?raw.confianca:'duvida',version:Number.isSafeInteger(raw.version)?raw.version:1};
        if(known.has(a.id)&&JSON.stringify(known.get(a.id))!==JSON.stringify(a))throw Error('Tentativa repetida com conteúdo diferente: '+a.id);
        known.set(a.id,a);
      }
      next.attempts=[...known.values()].sort((a,b)=>a.quando.localeCompare(b.quando)||a.id.localeCompare(b.id));
    }
    return next;
  }
  function answer(store,id,response,justification,confidence,attemptId,when) {
    const q=store.questions[id];
    if(!q||q.review.length)throw Error('Esta questão precisa de revisão antes do treino.');
    if(!['certeza','duvida','chute'].includes(confidence))throw Error('Confiança inválida.');
    if(!Object.hasOwn(q.alternativas,response))throw Error('Selecione uma alternativa válida.');
    if(store.attempts.some(a=>a.id===attemptId))return store;
    return {...store,attempts:[...store.attempts,{id:attemptId,questao_id:id,resposta:response,gabarito:q.gabarito,correta:response===q.gabarito,
      bloco:q.bloco,quando:when,justificativa:String(justification||''),confianca:confidence,version:q.version}]};
  }
  function progress(store) {
    const bs={},seen={};
    const init=b=>{if(!bs[b]){bs[b]={questoes:0,tentativas:0,acertos:0,respondidas:0,pct:null,assuntos:[]};seen[b]=new Set()}};
    for(const q of Object.values(store.questions)){if(q.bloco){init(q.bloco);bs[q.bloco].questoes++}}
    const subjects={};
    for(const a of store.attempts){const q=store.questions[a.questao_id];if(!q)continue;init(a.bloco);const b=bs[a.bloco];b.tentativas++;b.acertos+=Number(a.correta);seen[a.bloco].add(q.id);
      const subject=q.assunto.slice(1).join(' > ')||q.assunto.join(' > ')||'(sem assunto)';const key=JSON.stringify([a.bloco,subject]);
      subjects[key]||={bloco:a.bloco,assunto:subject,tentativas:0,acertos:0};subjects[key].tentativas++;subjects[key].acertos+=Number(a.correta);
    }
    for(const [key,b] of Object.entries(bs)){b.respondidas=seen[key].size;b.questoes=Math.max(b.questoes,b.respondidas);b.pct=b.tentativas?Math.round(100*b.acertos/b.tentativas):null}
    for(const a of Object.values(subjects)){const {bloco,...s}=a;s.pct=Math.round(100*s.acertos/s.tentativas);bs[bloco].assuntos.push(s)}
    Object.values(bs).forEach(b=>b.assuntos.sort((a,b)=>a.pct-b.pct||b.tentativas-a.tentativas));
    return {gerado_em:new Date().toISOString(),origem:'navegador',blocos:bs};
  }
  function normalizeProgress(o) {
    if(!object(o)||!object(o.blocos))throw Error('Progresso sem lista de blocos.');
    const result={gerado_em:typeof o.gerado_em==='string'?o.gerado_em.slice(0,40):'',origem:typeof o.origem==='string'?o.origem:'importado',blocos:{}};
    for(const [id,b] of Object.entries(o.blocos)){
      if(!blocks.has(id))throw Error('Bloco desconhecido no progresso: '+id);
      if(!object(b))throw Error('Bloco de progresso inválido.');
      const total=integer(b.tentativas,'Tentativas'),ac=integer(b.acertos,'Acertos'),count=integer(b.questoes,'Questões'),seen=integer(b.respondidas,'Respondidas');
      if(ac>total||seen>count||seen>total)throw Error('Contadores de progresso inconsistentes.');
      if(b.assuntos!==undefined&&!Array.isArray(b.assuntos))throw Error('Assuntos de progresso inválidos.');
      const subjects=(b.assuntos||[]).map(a=>{if(!object(a)||typeof a.assunto!=='string')throw Error('Assunto inválido.');const t=integer(a.tentativas,'Tentativas'),c=integer(a.acertos,'Acertos');if(c>t)throw Error('Acertos inválidos.');return{assunto:a.assunto.slice(0,1000),tentativas:t,acertos:c,pct:t?Math.round(100*c/t):null}});
      result.blocos[id]={questoes:count,tentativas:total,acertos:ac,respondidas:seen,pct:total?Math.round(100*ac/total):null,assuntos:subjects};
    }
    return result;
  }
  function backup(store) {
    const texts=[],index=new Map();
    const questions=Object.values(store.questions).map(q=>{let tid=null;if(q.texto){if(!index.has(q.texto)){index.set(q.texto,texts.length);texts.push(q.texto)}tid=index.get(q.texto)}const {fingerprint,review,texto,...rest}=q;return{...rest,texto_id:tid}});
    return {formato:'tjpb-questoes-backup-v1',gerado_em:new Date().toISOString(),textos:texts,questoes:questions,tentativas:copy(store.attempts)};
  }
  function eligible(store,block='',wrong=false) {
    const latest=new Map();for(const a of store.attempts)latest.set(a.questao_id,a);
    return Object.values(store.questions).filter(q=>!q.review.length&&(!block||q.bloco===block)&&(!wrong||latest.get(q.id)?.correta===false));
  }
  return {blocks,prepareQuestions,merge,answer,progress,normalizeProgress,backup,eligible};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=PracticeCore;
