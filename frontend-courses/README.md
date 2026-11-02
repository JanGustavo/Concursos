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
