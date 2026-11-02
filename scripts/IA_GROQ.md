# Assistente Groq compartilhado

Implementação de chat em texto, sem ferramentas nem alterações automáticas no calendário. A instância `assistant` de `ai_service.py` é única por processo; cada chamada contém somente a conversa enviada pelo usuário autenticado. Não há histórico de mensagens no servidor nem armazenamento local do chat. A interface limpa a conversa ao trocar de conta. Somente o tópico e a matéria são preparados ao clicar em Perguntar à IA; o usuário precisa enviar a mensagem.

## Configuração

Na raiz local do projeto, execute `./configurarGroq.sh`. A chave é solicitada com entrada oculta, transmitida via SSH e salva com permissão 0600 em `/var/www/tjpb/groq-config.json`. Não passa como argumento de processo e não entra no HTML, no Git ou no pacote de deploy. O script reinicia apenas `tjpb-estudo.service`. Requer o mesmo acesso SSH usado pelo deploy. Nunca cole a chave no chat.

Também é possível criar o arquivo no servidor usando `groq-config.example.json` como estrutura, ou definir `GROQ_API_KEY` e opcionalmente `GROQ_MODEL` no ambiente do serviço. Variáveis de ambiente têm precedência. O arquivo de configuração não é substituído por deploys.

Sem chave, a interface apresenta Aguardando configuração e impede o envio. Após configurar, use Verificar novamente. O modelo padrão é `openai/gpt-oss-20b`, ajustável no servidor. Consulte a disponibilidade da sua conta e o catálogo oficial antes de trocar: https://console.groq.com/docs/models . API usada: https://console.groq.com/docs/api-reference . A ausência de chave impede validar respostas reais; os testes usam transporte simulado.

## API e limites

- GET `/api/ai/status`: autenticado, informa somente disponibilidade/provedor/estratégia, nunca chaves.
- POST `/api/ai/chat`: autenticado; até 16 mensagens, 2000 caracteres por mensagem e 16000 no total. Frontend envia até 6 mensagens anteriores e a nova pergunta. Resposta em texto, renderizada sem HTML.
- Limites locais: 6 solicitações/minuto por usuário, 30 globais/minuto, 2 gerações simultâneas. Limites da Groq também se aplicam. Timeout de transporte: 30 s. Limites reiniciam com o processo e devem migrar para armazenamento compartilhado se houver múltiplas réplicas.
- Erros do provedor são traduzidos; não devolvemos corpo, cabeçalhos nem credenciais de upstream.

## Round robin futuro

`SingleProviderSelector.select(providers)` é o ponto de seleção isolado. Hoje, `providers()` produz no máximo uma configuração e o seletor sempre retorna a primeira. Uma futura estratégia poderá substituir esse seletor e habilitar um pool de configurações do servidor, sem mudar o contrato do navegador. Ainda não há rotação ou failover automático.

## Referências do KanbanDoro

Foram adaptados os padrões de `src/ResumePointEditor.tsx` (onde parei/próximo passo), tarefas/etapas em `src/main.tsx` e foco semanal por matéria em `src/StudyDashboard.tsx`. A implementação do TJPB permanece independente da extensão Chrome, sem copiar stores, permissões ou integrações Gmail/Calendar.

## Correção de acesso — 02/11/2026

A chave salva foi confirmada válida pelo catálogo real da conta. O cliente Python padrão recebia HTTP 403; as chamadas agora identificam a aplicação com `User-Agent: TJPB-Study/1.0` e aceitam JSON. O modelo anterior não aparecia no catálogo dessa conta e respondia `model_not_found`; foi substituído por `openai/gpt-oss-20b`, com resposta real verificada. GET de status consulta o catálogo autenticado (cache interno de 60 s), distingue configuração ausente, autorização recusada, modelo indisponível e falha transitória. O script valida autorização e disponibilidade do modelo antes de salvar; uma falha preserva a configuração anterior. A interface revalida ao abrir o painel, sem depender de novo deploy.
