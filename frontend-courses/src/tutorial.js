import {GuidedTour} from './guidedTour.ts';
import './tutorial.css';

const steps = [
  {selector:'#start-tab',title:'Comece pelo seu caminho',description:'Em Por onde começar, veja a sequência dos assuntos e escolha um ponto de partida para seu nível.'},
  {selector:'#map-tab',title:'Conecte os assuntos',description:'Abra um tópico do mapa para ver os conceitos, praticar e marcar o que você já estudou.'},
  {selector:'#planner-tab',title:'Monte sua semana',description:'Abra Ciclo de estudos e ajuste os dias e minutos disponíveis. Revise a proposta antes de aplicar ao calendário.'},
  {selector:'#questions-tab',title:'Pratique e entenda seus erros',description:'Resolva questões, registre seu raciocínio e leve a dúvida ao ChatGPT ou à Groq pelos botões da questão.'},
  {selector:'#courses-tab',title:'Retome de onde parou',description:'Encontre vídeos e PDFs por assunto. Marque aulas concluídas e acompanhe os materiais visualizados neste navegador.'},
  {selector:'#data-tab',title:'Prepare a discursiva',description:'Consulte o guia da prova e use Perguntar à IA para levar o contexto do edital à conversa.'},
  {selector:'.assistant-trigger',title:'Seu assistente está aqui',description:'Entre na sua conta para conversar com a Groq. Explique sua dúvida e confira as respostas com o edital e os materiais. A IA recebe o contexto que você envia.'},
  {selector:'#tutorial-button',title:'Reveja quando precisar',description:'Este botão abre o tutorial novamente. Comece por um assunto e ajuste a rotina conforme avançar.'},
];
const tour = new GuidedTour({
  steps,
  storage: {
    get: () => localStorage.getItem('tjpb-tutorial-v1') === 'seen',
    set: () => localStorage.setItem('tjpb-tutorial-v1', 'seen'),
  },
  onStart: () => document.body.classList.add('tjpb-tour-active'),
  onComplete: () => document.body.classList.remove('tjpb-tour-active'),
  onSkip: () => document.body.classList.remove('tjpb-tour-active'),
});
document.getElementById('tutorial-button')?.addEventListener('click', () => void tour.start({force:true}));
document.getElementById('footer-tutorial')?.addEventListener('click', () => void tour.start({force:true}));
const auto = window.setTimeout(() => {
  if (!document.querySelector('dialog[open]')) void tour.start();
}, 1200);
window.addEventListener('pagehide', () => {
  window.clearTimeout(auto);
  tour.destroy();
  document.body.classList.remove('tjpb-tour-active');
});
