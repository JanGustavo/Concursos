# Cursos e aulas TJPB

A aplicação possui um único módulo React, `src/CourseLibrary.jsx`. As dez áreas são dados retornados pelo catálogo, sem uma cópia do componente por curso. A navegação de pastas, o player e os materiais usam os mesmos componentes internos (`TreeNode` e `LessonPlayer`).

Uso completo, montado por `src/main.jsx`:

```jsx
<CourseLibrary />
```

Para encapsular apenas uma área em outra tela:

```jsx
<CourseLibrary courseId={idRecebidoDoCatalogo} apiBase="/biblioteca/api" />
```

`courseId` restringe a interface ao curso informado. IDs são os retornados pela API, não devem ser inventados. Busca, ordenação, associação de PDFs, vídeo, velocidade, conclusão e retomada continuam no mesmo módulo.

## Compilar

```bash
npm --prefix frontend-courses ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend-courses run build
python3 scripts/build_mobile.py
```

A compilação gera `assets/courses-app.js` e `assets/courses-app.css`, incorporados ao HTML pelo builder. O navegador não baixa React de CDN. Não há token ou catálogo privado embutido no bundle.

## Backend e autenticação

`library_service.py` adapta as regras do protótipo `scripts/tjpb_library.py` e do blueprint para o servidor HTTP já utilizado pelo site. A produção continua usando `servir.py`, sem migração de framework nem alteração do proxy. Os protótipos Flask foram preservados como referência e não são executados pelo serviço publicado.

- `POST /api/library/session`: valida o token da conta TJPB e estabelece cookie HttpOnly limitado a `/biblioteca`, SameSite Strict e Secure no HTTPS.
- `GET /biblioteca/api/tree`: catálogo estruturado, somente autenticado.
- `GET/HEAD /biblioteca/api/media/<id>`: vídeo ou PDF pertencente ao catálogo, somente autenticado; aceita Range e devolve 206 quando solicitado. Sem Range, entrega 200 com streaming completo.
- `POST /api/library/logout`: expira o cookie de mídia.

O OAuth do Drive é lido de `token.json` apenas pelo servidor. A renovação usa o endpoint oficial do Google, com gravação atômica e modo 0600. O arquivo não é servido pelo site nem incluído no pacote de código. O deploy provisiona a autorização por SSH somente se ainda não houver token na VPS e preserva o token remoto nos próximos deploys.

Os catálogos `dados/drive_tree.json` e `dados/drive_catalog.json` são snapshots atualizáveis pelo fluxo já existente. Somente vídeos e PDFs presentes na árvore processada podem ser transmitidos. Imagens e arquivos incompletos não entram como aulas. As pastas técnicas de vídeos/PDFs são achatadas, mantendo os módulos de ensino. PDFs associados são os da mesma pasta lógica da aula.

## Limites e armazenamento

Aulas/PDFs exigem internet. A biblioteca e as APIs autenticadas não são armazenadas no service worker. O progresso fica no localStorage, separado por conta TJPB, sem sincronização entre dispositivos nesta versão. O catálogo não é uma sincronização contínua com o Drive. A transmissão permite até seis conexões simultâneas, no máximo duas por usuário.

## Verificação

34 testes Python e 22 testes JavaScript passaram (56 ao todo). Cobrem autenticação/cookie, bloqueio de arquivos privados, Range, limites de conexão, OAuth, vínculo de materiais e regressão das questões. Um vídeo e um PDF reais do catálogo responderam HTTP 206; no navegador de teste, uma videoaula carregou, teve a velocidade alterada e retomou a posição/conclusão após recarregar. A conta usada na prévia pertence a um banco temporário, não ao banco de produção.

## Identidade e planejamento

`assets/cyber-theme.css` concentra os tokens e controles compartilhados, baseados nos padrões visuais do CronFlow. O gerador incorpora esse CSS no app e nos dois relatórios; `assets/report-theme.css` adapta os elementos dos relatórios sem alterar dados.

`StudyPlanner.jsx` monta as telas Por onde começar e Ciclo de estudos. O modelo `planner-model.js` valida sessões, datas locais, backups e ciclo inicial. Não altera APIs ou stores de questões. Sessões ficam no localStorage `tjpb-study-planner-v1:<user.id>` (ou `:guest`), sem sincronização remota. Backup JSON importa por mesclagem, preservando IDs existentes. Tempo diário soma apenas sessões concluídas na data selecionada como data de estudo.

Validação: `eslint --ext .js,.jsx frontend-courses/src` (ESLint 6+ disponível no sistema), `node --test frontend-courses/src/*test.js tests/practice-core.test.cjs`, `python3 -m unittest discover -s tests -q`, seguido do build e de `python3 scripts/build_mobile.py`.

O quadro também suporta checklist de até 12 etapas, prioridade, onde parei/próximo passo, busca e pendências anteriores, mantendo compatibilidade com backups antigos. `StudyTaskDetails.jsx` centraliza os campos e cartões. `StudyAssistant.jsx` monta um único botão global, fora dos painéis, usando exclusivamente a API autenticada do servidor. Configuração: `scripts/IA_GROQ.md`.

`StudyOnboarding.jsx` oferece o primeiro uso em três etapas: ritmo, distribuição semanal e prévia. `planner-profile.js` gera sete dias a partir da data escolhida, com três dias de TI, Português/RLM combinados, sábado revisão e domingo redação por padrão. Cada dia permite descanso e minutos próprios. O complemento usa até 25 minutos do total, sem somar tempo extra. A confirmação mescla sessões sem apagar histórico e salva preferências por conta/navegador (`:preferences`); backups incluem preferências opcionais e mantêm compatibilidade com versões anteriores. As cores e iniciais das matérias são compartilhadas no formulário, prévia, calendário e cartões; a meta do dia respeita o perfil.

Ao reaplicar uma semana, somente sessões automáticas ainda planejadas e intocadas dessa semana são substituídas. Editar um cartão, suas etapas ou mover seu estado o torna independente da geração automática; histórico e sessões em estudo/concluídas ficam preservados. A navegação HTML do service worker agora usa rede primeiro, com fallback para cópia offline, evitando telas antigas após deploy.

## Correções de instruções, modais e PDFs (03/11/2026)

A seção Prova e discursiva vem de `assets/exam-guide.html`, baseada no material enviado e no edital consolidado/segunda retificação. A proposta pedagógica de 30 linhas é identificada como sugestão; não há pesos inventados de correção. Provas anteriores ficam em uma seção recolhível com roteiro de resolver, corrigir e aplicar em estudo de caso. O endereço legado `tjpb_desenvolvimento_sistemas_relatorio.html` também recebe o guia atualizado.

`AiPlanModal.jsx` é montado com portal diretamente no body e usa showModal, fechamento e confirmação separados. A API retorna JSON validado; o calendário só é alterado no último botão de confirmação. Voz usa MediaRecorder e a rota de transcrição existente da Groq, com fallback do navegador; fechar interrompe captura e cancela uploads. A fala explicativa é opcional pelo botão Ouvir como funciona. Planos automáticos legados de origem `ai-plan` e atuais de origem `weekly-profile` seguem a mesma proteção de registros editados/em andamento/concluídos.

O ranking também é movido ao body. Fecha por botão superior, botão inferior, Escape ou clique fora, e a tabela tem rolagem própria. Há teste de DOM para evitar regressão de um modal dentro de uma seção oculta.

`PdfViewer.jsx` carrega PDF.js apenas ao selecionar PDF. `pdf-reader.js` e `pdf-worker.mjs` são assets locais públicos de código, sem credenciais. Requisições privadas do arquivo enviam o Bearer da conta explicitamente e não dependem do visualizador nativo do navegador. O leitor tem páginas, zoom, texto extraível e download autenticado. PDFs não entram no cache offline nem são publicados em um serviço externo. Build gera os dois assets, incluídos explicitamente no deploy.

Testes de DOM usam jsdom; não substituem conferir permissões reais de microfone ou diferenças visuais de cada navegador. O teste do motor PDF usa um documento sintético e renderiza a página com o PDF.js real.

## Anki e ações por questão

`AnkiLibrary.jsx` monta uma área autenticada de decks. `dados/anki_catalog.json` registra somente IDs, nomes e tamanhos dos dois arquivos verificados na pasta fornecida. Não inclui os pacotes de 213 MB/1,7 MB no build e não muda compartilhamento no Drive. A biblioteca serve apenas IDs permitidos pelo catálogo, com MIME binário, Content-Disposition attachment e streaming de 64 KiB; Range e login seguem as regras da biblioteca. O download renova a sessão antes de navegar ao arquivo, sem criar Blob de centenas de megabytes no aparelho. Progresso de cartões permanece no Anki.

Os botões após responder uma questão oferecem ChatGPT com o prompt no link e Groq no painel local da aplicação. Ver/copiar prompt continua disponível. Contexto completo da questão não é substituído pelas sugestões do calendário.
