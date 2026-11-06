import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import './support-pix.css';

const emojis = ['🎉', '💜', '🚀', '✨', '🙏'];
const colors = ['#6200ee', '#9c42f5', '#c084fc', '#f472b6', '#facc15', '#34d399', '#60a5fa'];

function playSuccess() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    const context = new Audio();
    void context.resume().then(() => {
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = context.currentTime + index * .12;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.15, start + .05);
        gain.gain.exponentialRampToValueAtTime(.001, start + .6);
        oscillator.start(start);
        oscillator.stop(start + .6);
        if (index === 3) oscillator.onended = () => { void context.close(); };
      });
    }).catch(() => { void context.close(); });
  } catch { /* Audio is optional when the browser blocks playback. */ }
}

export function SupportPix() {
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const thanksButton = useRef(null);
  const [open, setOpen] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [emoji, setEmoji] = useState(0);
  const [amount, setAmount] = useState('5');
  const [custom, setCustom] = useState('');
  const [payment, setPayment] = useState(null);
  const [imageReady, setImageReady] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    closeButton.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!thanks) return;
    thanksButton.current?.focus();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      setEmoji(step % emojis.length);
      if (step === 9) window.clearInterval(timer);
    }, 300);
    return () => window.clearInterval(timer);
  }, [thanks]);

  useEffect(() => {
    if (!open || thanks) return;
    setPayment(null);
    setImageReady(false);
    setMessage('');
    const value = amount === 'custom' ? custom.trim().replace(',', '.') : amount;
    if (!/^[0-9]{1,5}(\.[0-9]{1,2})?$/.test(value) || Number(value) < 1) {
      setLoading(false);
      setMessage('Informe um valor entre R$ 1 e R$ 99.999,99.');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/support/pix?' + new URLSearchParams({amount: Number(value).toFixed(2)}), {signal: controller.signal});
        const data = await response.json();
        if (!response.ok || !data.payload || !data.qrCode) throw Error('Pix indisponível.');
        if (!controller.signal.aborted) setPayment(data);
      } catch {
        if (!controller.signal.aborted) setMessage('Não foi possível carregar o Pix. Selecione um valor para tentar novamente.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, thanks, amount, custom]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(payment.payload);
      setMessage('Código copiado.');
    } catch {
      setMessage('Abra “Ver código Pix” para selecionar e copiar o código.');
    }
  }

  function launch() {
    setThanks(false);
    setEmoji(0);
    setPayment(null);
    setOpen(true);
  }

  return <section className="support-pix">
    <div className="support-story">
      <div className="support-story-copy">
        <span className="support-kicker">Uma comunidade, o mesmo objetivo</span>
        <h2>Você cuida da preparação.<br/><span>A gente constrói o caminho junto.</span></h2>
        <p>Entre trabalho, faculdade e aquela revisão no ônibus, cada minuto de estudo conta. O TJPB Estudos reúne ferramentas para tornar essa jornada mais organizada.</p>
        <p>Se o mapa, as questões ou os materiais já facilitaram seu dia, considere retribuir com um apoio. Sua contribuição ajuda a manter o servidor e dá fôlego para continuar melhorando a plataforma.</p>
        <button className="pix-trigger-btn" type="button" onClick={launch}>
          <span className="pix-trigger-icon" aria-hidden="true">💜</span> Quero apoiar o projeto
        </button>
        <small>Contribuição voluntária por Pix. Escolha um valor que caiba no seu momento.</small>
      </div>
      <aside className="support-companion" aria-label="Uma mensagem do nosso companheiro de estudos">
        <div className="support-mascot" aria-hidden="true">
          <span className="support-antenna"/>
          <div className="support-robot-face"><i/><i/><span/></div>
          <span className="support-robot-heart">💜</span>
        </div>
        <p>“Uma questão de cada vez.<br/>Uma ajuda de cada vez.<br/><strong>A gente vai mais longe junto.”</strong></p>
        <span className="support-companion-label">Seu companheiro de estudos</span>
      </aside>
    </div>
    <div className="support-impact" aria-label="Como seu apoio contribui">
      <article><span aria-hidden="true">☁</span><h3>Manter o site no ar</h3><p>Servidor e infraestrutura para acessar suas ferramentas de estudo.</p></article>
      <article><span aria-hidden="true">⌘</span><h3>Cuidar da plataforma</h3><p>Tempo de desenvolvimento, correções e melhorias no uso pelo celular.</p></article>
      <article><span aria-hidden="true">✎</span><h3>Preparar o próximo passo</h3><p>Organização de materiais e dedicação à criação de novos conteúdos.</p></article>
    </div>
    <div className="support-note"><span aria-hidden="true">💜</span><p><strong>Hoje o apoio cabe a quem pode.</strong> Se agora não for o seu momento, compartilhar a plataforma com alguém que estuda também ajuda. Obrigado por fazer parte.</p></div>
    {createPortal(<dialog ref={dialog} className="pix-overlay" aria-labelledby="pix-title"
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      {open && <>
        <div className="pix-particles" aria-hidden="true">
          {Array.from({length: 18}, (_, index) => <i key={index} className="pix-particle" style={{
            left: ((index * 37) % 100) + '%', background: colors[index % colors.length],
            animationDelay: -(index % 5) + 's', animationDuration: (4 + index % 6) + 's',
          }}/>)}
        </div>
        {thanks && <div className="pix-confetti-wrap" aria-hidden="true">
          {Array.from({length: 60}, (_, index) => <i key={index} className="pix-confetti-piece" style={{
            left: ((index * 37) % 100) + '%', top: -10 - index % 20,
            background: colors[index % colors.length], width: 6 + index % 8, height: 6 + index % 8,
            borderRadius: index % 2 ? '50%' : '2px',
            animationDuration: (1.2 + index % 15 / 10) + 's', animationDelay: (index % 8 / 10) + 's',
          }}/>)}
        </div>}
        <div className={thanks ? 'pix-thanks-card' : 'pix-modal'} onClick={event => event.stopPropagation()}>
          <button ref={closeButton} type="button" className="pix-close" aria-label="Fechar modal" onClick={() => setOpen(false)}>✕</button>
          {thanks ? <>
            <div className="pix-thanks-emoji" aria-hidden="true">{emojis[emoji]}</div>
            <h2 id="pix-title" className="pix-thanks-title">Muito obrigado!</h2>
            <p className="pix-thanks-msg">Seu apoio ajuda o TJPB Estudos a continuar crescendo. 💜</p>
            <p className="pix-instruction">O pagamento não é verificado automaticamente aqui.</p>
            <button ref={thanksButton} type="button" className="pix-thanks-close" onClick={() => setOpen(false)}>Continuar explorando</button>
          </> : <>
            <div className="pix-heart-anim" aria-hidden="true">💜</div>
            <h2 id="pix-title" className="pix-title">Ajude o Projeto</h2>
            <p className="pix-subtitle">Seu apoio ajuda com o servidor e com o tempo dedicado à plataforma.<br/>Escolha o valor que fizer sentido para você.</p>
            <div className="pix-amounts" role="group" aria-label="Valor da contribuição">
              {[['5', '☕', 'Café'], ['10', '💜', 'Apoio'], ['20', '🚀', 'Impulso']].map(([value, icon, label]) =>
                <button type="button" key={value} className="pix-amount-btn" aria-pressed={amount === value} onClick={() => setAmount(value)}>
                  <span className="pix-amount-emoji" aria-hidden="true">{icon}</span>
                  <span className="pix-amount-label">{label}</span><strong>R$ {value}</strong>
                </button>)}
            </div>
            <button type="button" className="pix-custom-toggle" aria-pressed={amount === 'custom'} onClick={() => setAmount('custom')}>Outro valor</button>
            {amount === 'custom' && <label className="pix-custom">Valor em reais
              <input inputMode="decimal" value={custom} onChange={event => setCustom(event.target.value)} placeholder="Ex. 12,50"/>
            </label>}
            <div className="pix-qr-wrap" aria-busy={loading || Boolean(payment && !imageReady)}>
              {(loading || (payment && !imageReady)) && <div className="pix-qr-loader"><span className="pix-spinner"/><span>Carregando QR Code…</span></div>}
              {payment && <img className={'pix-qr-img' + (imageReady ? ' pix-qr-ready' : '')} src={payment.qrCode} alt="QR Code Pix"
                onLoad={() => setImageReady(true)} onError={() => { setPayment(null); setMessage('Não foi possível exibir o QR Code. Selecione outro valor.'); }}/>}
            </div>
            <p className="pix-status" role="status">{message}</p>
            {payment && imageReady && <>
              <p className="pix-instruction">Abra o app do banco → <strong>Pix</strong> → <strong>Ler QR Code</strong>.<br/>Confira o destinatário e o valor antes de confirmar.</p>
              <button type="button" className="pix-copy" onClick={copy}>Copiar Pix Copia e Cola</button>
              <details><summary>Ver código Pix</summary><textarea aria-label="Código Pix" readOnly rows="3" value={payment.payload}/></details>
              <button type="button" className="pix-paid-btn" onClick={() => { setThanks(true); playSuccess(); }}>✅ Já contribuí!</button>
            </>}
          </>}
        </div>
      </>}
    </dialog>, document.body)}
  </section>;
}
