import React, {useState} from 'react';

export function ExamAssistant() {
  const [question, setQuestion] = useState('');
  function ask(value) {
    const guide = document.getElementById('exam-guide');
    const text = guide?.innerText || guide?.textContent || '';
    const sources = Array.from(guide?.querySelectorAll('a[href]') || []).map(link => link.textContent.trim() + ' — ' + link.href).join('\n');
    window.dispatchEvent(new CustomEvent('tjpb-ask-ai', {detail: {
      source: 'edital',
      prompt: 'Estou me preparando para TJPB, Analista de TI, Desenvolvimento de Sistemas, banca FGV. Minha dúvida: ' + value +
        '\n\nContexto disponível no guia da plataforma (síntese do edital, confira a versão e as fontes indicadas):\n' + text.trim().slice(0, 10000) + '\nFontes indicadas no guia:\n' + sources.slice(0, 1500) +
        '\n\nUse somente as regras confirmadas neste contexto. Links são referências, não documentos que você leu. Se faltar o conteúdo do anexo para confirmar se uma matéria consta, peça o trecho. Diferencie carga semanal sugerida de exigência do edital. Para propor horas, pergunte minha disponibilidade e meu nível. Explique com clareza e cite a seção ou fonte disponível.',
    }}));
  }
  return <section className="exam-ai-panel" aria-labelledby="exam-ai-title">
    <div><span className="eyebrow">Assistente · Groq</span><h3 id="exam-ai-title">Converse sobre sua preparação</h3>
      <p>Leve as informações deste guia para a IA e tire dúvidas sobre a prova, a discursiva e sua rotina.</p>
      <p className="practice-caption">O assistente recebe a síntese desta página. Para conferir um tópico específico do anexo, cole o trecho do edital na conversa.</p>
    </div>
    <div className="exam-ai-shortcuts">
      {['Como devo estruturar o estudo de caso técnico?', 'Como distribuir minhas horas semanais de estudo?', 'Como conferir se uma matéria está no conteúdo programático?'].map(value =>
        <button type="button" className="practice-btn" key={value} onClick={() => ask(value)}>{value}</button>)}
    </div>
    <form onSubmit={event => {event.preventDefault(); if (question.trim()) ask(question.trim());}}>
      <label htmlFor="exam-ai-question">Sua dúvida sobre o edital ou os estudos</label>
      <textarea id="exam-ai-question" rows="2" maxLength="2000" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ex. Tenho 10 horas semanais. Como começo?"/>
      <button type="submit" className="practice-btn primary" disabled={!question.trim()}>Perguntar à IA</button>
    </form>
  </section>;
}
