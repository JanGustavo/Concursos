# Assistente Groq compartilhado

Implementação de chat em texto, sem ferramentas nem alterações automáticas no calendário. A instância `assistant` de `ai_service.py` é única por processo; cada chamada contém somente a conversa enviada pelo usuário autenticado. Não há histórico de mensagens no servidor nem armazenamento local do chat. A interface limpa a conversa ao trocar de conta. Somente o tópico e a matéria são preparados ao clicar em Perguntar à IA; o usuário precisa enviar a mensagem.

## Configuração

Na raiz local do projeto, execute `./configurarGroq.sh`. A chave é solicitada com entrada oculta, transmitida via SSH e salva com permissão 0600 em `/var/www/tjpb/groq-config.json`. Não passa como argumento de processo e não entra no HTML, no Git ou no pacote de deploy. O script reinicia apenas `tjpb-estudo.service`. Requer o mesmo acesso SSH usado pelo deploy. Nunca cole a chave no chat.

Também é possível criar o arquivo no servidor usando `groq-config.example.json` como estrutura, ou definir `GROQ_API_KEY` e opcionalmente `GROQ_MODEL` no ambiente do serviço. Variáveis de ambiente têm precedência. O arquivo de configuração não é substituído por deploys.

Sem chave, a interface apresenta Aguardando configuração e impede o envio. Após configurar, use Verificar novamente. O modelo padrão é `openai/gpt-oss-20b`, ajustável no servidor. Consulte a disponibilidade da sua conta e o catálogo oficial antes de trocar: https://console.groq.com/docs/models . API usada: https://console.groq.com/docs/api-reference . A ausência de chave impede validar respostas reais; os testes usam transporte simulado.

## API e limites

- GET `/api/ai/status`: autenticado, informa somente disponibilidade/provedor/estratégia, nunca chaves.
- POST `/api/ai/chat`: autenticado; até 16 mensagens, 16000 caracteres por mensagem e 40000 no total. Frontend envia até 6 mensagens anteriores e a nova pergunta. Resposta em texto, renderizada sem HTML.
- Limites locais: 6 solicitações/minuto por usuário, 30 globais/minuto, 2 gerações simultâneas. Limites da Groq também se aplicam. Timeout de transporte: 30 s. Limites reiniciam com o processo e devem migrar para armazenamento compartilhado se houver múltiplas réplicas.
- Erros do provedor são traduzidos; não devolvemos corpo, cabeçalhos nem credenciais de upstream.

## Round robin futuro

O seletor padrão agora é RoundRobinSelector, com até três chaves. Consulte o procedimento abaixo para cadastrar e testar o pool.

## Referências do KanbanDoro

Foram adaptados os padrões de `src/ResumePointEditor.tsx` (onde parei/próximo passo), tarefas/etapas em `src/main.tsx` e foco semanal por matéria em `src/StudyDashboard.tsx`. A implementação do TJPB permanece independente da extensão Chrome, sem copiar stores, permissões ou integrações Gmail/Calendar.

## Correção de acesso — 02/11/2026

A chave salva foi confirmada válida pelo catálogo real da conta. O cliente Python padrão recebia HTTP 403; as chamadas agora identificam a aplicação com `User-Agent: TJPB-Study/1.0` e aceitam JSON. O modelo anterior não aparecia no catálogo dessa conta e respondia `model_not_found`; foi substituído por `openai/gpt-oss-20b`, com resposta real verificada. GET de status consulta o catálogo autenticado (cache interno de 60 s), distingue configuração ausente, autorização recusada, modelo indisponível e falha transitória. O script valida autorização e disponibilidade do modelo antes de salvar; uma falha preserva a configuração anterior. A interface revalida ao abrir o painel, sem depender de novo deploy.

## Propostas e áudio

`POST /api/ai/plan` recebe preferências e teto diário e retorna uma proposta de sete dias com duas atividades no máximo por dia. Usa Structured Outputs (JSON Schema estrito) e validação independente no servidor e navegador; não escreve o calendário. Referência: https://console.groq.com/docs/structured-outputs . A importação acontece apenas após prévia e confirmação no modal. A resposta usa dias da semana 0=domingo até 6=sábado, mapeados às próximas sete datas a partir da escolha da pessoa.

`POST /api/ai/transcribe` mantém a autenticação da conta e envia a gravação solicitada pela pessoa à Groq. Não grava áudio em disco. O cliente limita a gravação a dois minutos e cancela a captura/upload quando o modal é fechado. A transcrição fica no campo para revisão antes de gerar o plano. A confirmação substitui somente sessões automáticas intocadas dentro da semana; lê o armazenamento atual antes de reconciliar, preservando histórico e cartões editados.

## Questões importadas e Anki

A ação Perguntar à IA da questão envia o prompt completo ao painel para revisão, sem submissão automática. Esse modo prioriza explicitamente a questão selecionada e não injeta os tópicos do calendário. O histórico é reduzido removendo mensagens antigas inteiras quando o total ultrapassa 40000 caracteres; a pergunta atual não é truncada. A interface recusa texto maior que 16000 caracteres com indicação para reduzir.

O ChatGPT recebe um link com o prompt codificado na query e uma tentativa de cópia de segurança. O preenchimento por URL pode depender do cliente ChatGPT; para links excessivamente longos, a interface conserva o texto completo para cópia e abre a página inicial, sem cortar o enunciado.

## Três chaves e round robin

Na raiz do projeto, execute `./configurarGroqRR.sh 1`, `./configurarGroqRR.sh 2` ou `./configurarGroqRR.sh 3`.
Cada chamada solicita uma chave existente da Groq com entrada oculta, valida autenticação e modelo e grava apenas o slot escolhido em `/var/www/tjpb/.env` (600), preservando os demais. Ao adicionar o segundo slot, a chave antiga é migrada para o primeiro automaticamente. O script reinicia somente o TJPB.

Execute `./testarGroqRR.sh` para validar todas as chaves na API de modelos e conferir duas voltas do seletor real. Não gera respostas de chat. Os números do teste representam a ordem das chaves ativas. Chaves repetidas são rejeitadas no cadastro e deduplicadas na leitura.

As solicitações de chat, planejamento e transcrição alternam entre as chaves ativas. Consultas de status não avançam a rotação. O contador é protegido por lock e reinicia com o processo. A seleção não implementa failover nem aumenta os limites locais do app.

Os slots no ambiente do serviço têm precedência sobre os slots do arquivo. Sem slots, o backend continua aceitando GROQ_API_KEY ou o JSON antigo. Deploys preservam o .env. Use os scripts RR para gerenciar o pool, pois o configurarGroq.sh antigo altera apenas a configuração legada.
