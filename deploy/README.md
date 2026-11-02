# Deploy do TJPB na VPS

Site: https://tjpb.jangustavo.me/
Servidor: 64.236.155.209 · usuário: azureuser
Unidade: tjpb-estudo.service
Diretório remoto: /var/www/tjpb
Backend: Python 3, escutando 127.0.0.1:8766; proxy HTTPS existente do Nginx.

Na raiz deste projeto:

```bash
./newDeploy.sh --check
./newDeploy.sh
```

Parâmetros opcionais, no mesmo formato do script de referência:

```bash
./newDeploy.sh 64.236.155.209 /caminho/da/chave.pem azureuser
```

O script gera o HTML, empacota apenas doze arquivos explícitos da aplicação, verifica seus hashes e faz upload. O pacote contém o código, os ícones e os dois catálogos de aulas. Não envia banco de usuários, sessões, respostas, backups sincronizados, .env ou código de outros projetos. O token OAuth do Drive é provisionado separadamente por SSH, em modo 0600, somente quando ainda não existe na VPS; não é incluído no pacote e o token remoto é preservado nos deploys seguintes. A chave SSH é usada diretamente pelo OpenSSH e não é copiada nem incluída nos logs. A identidade do servidor é verificada pelo known_hosts.

O helper `remote-tjpb.sh` valida a unidade e o diretório, obtém um lock, guarda o código anterior e copia `dados/` com o serviço parado. Depois substitui somente a lista de arquivos, confirma que os dados não mudaram durante a instalação e inicia somente tjpb-estudo.service. Confere o HTML local e o publicado via HTTPS, o relatório e a API anônima. Compara PIDs dos serviços Nginx/CronFlow/Docker e IDs/horários de inicialização dos contêineres antes/depois. Não reinicia nem altera esses outros serviços.

Uma falha após o início da instalação tenta restaurar o código anterior e reinicia apenas o TJPB. Os dados não são revertidos automaticamente, para não apagar respostas novas. Não altera Nginx, certificados ou unidades systemd.

## Último deploy verificado

01/11/2026, 19:07 (America/Sao_Paulo).
Backup anterior: `/var/www/tjpb/.deploy/backups/20261101T220737Z-896d1399`.
Verificações de HTTPS, relatório, API, preservação dos dados e isolamento dos demais serviços passaram.
Log: `deploy/logs/20261101T220719Z-deploy.log`.

Para voltar ao código anterior a essa atualização, execute explicitamente:

```bash
./newDeploy.sh --rollback 20261101T220737Z-896d1399
```

Cada deploy imprime seu BACKUP_ID. Use o ID desejado; o comando de rollback também salva o código que estiver ativo antes da reversão. Backups ficam em `/var/www/tjpb/.deploy/backups/` e logs locais em `deploy/logs/`.

## Cursos do Drive

A build React é executada antes do builder HTML. Os catálogos `drive_catalog.json` e `drive_tree.json` são os únicos arquivos de `dados/` atualizados pelo pacote. O banco e os arquivos de progresso continuam sendo preservados por checksum. A saúde de publicação também verifica que a biblioteca exige login e que os caminhos de credenciais respondem 404. A autorização Drive fica em `/var/www/tjpb/token.json`, somente no servidor, e não deve ser enviada a um repositório ou exposta em logs.

A leitura parcial real de vídeo e PDF do Drive foi confirmada tanto localmente quanto na VPS (HTTP 206, 1.024 bytes por teste). Os outros serviços/contêineres mantiveram PIDs, IDs e horários de inicialização. O módulo de aulas está documentado em `../frontend-courses/README.md`.

### Publicação de 02/11/2026 — identidade roxa e ciclo de estudos

Backup: `20261102T030813Z-6e235389`. Log: `deploy/logs/20261102T030755Z-deploy.log`.

Inclui tema compartilhado (app e relatórios), Por onde começar, calendário/kanban com backup local e filtro PDF/vídeo. Lint e build passaram; 30 testes JS e 34 testes Python passaram. Revisão em 390px e 1366px, registro e persistência de sessões, arrastar cartões, isolamento por conta e filtros reais da biblioteca conferidos. Deploy confirmou os dados de produção inalterados e os demais serviços/contêineres com os mesmos PIDs e datas de início. Somente `tjpb-estudo.service` foi reiniciado.

### Publicação de 02/11/2026 — Kanban e Groq

Backup: `20261102T032610Z-46f10786`. Log: `deploy/logs/20261102T032552Z-deploy.log`.

Checklist, prioridade, retomada, busca, pendências anteriores e distribuição semanal adaptados dos padrões do KanbanDoro. Assistente global com API autenticada e seleção de provedor isolada para futura rotação. Chave ainda não configurada: exibe o estado de espera; nenhuma requisição real à Groq foi feita. Configuração: `./configurarGroq.sh` e `scripts/IA_GROQ.md`. O pacote agora inclui `ai_service.py` e continua excluindo configurações privadas. Validação: lint/build, 31 testes JS e 47 Python, revisão da interface em desktop e 390px. Dados de produção e demais serviços preservados pelo deploy.

### Publicação de 02/11/2026 — acesso Groq e primeiro uso

Backup: `20261102T035314Z-33cfc735`. Log: `deploy/logs/20261102T035257Z-deploy.log`.

Diagnóstico real: chave existente válida; identificação padrão Python recebia HTTP 403, corrigido com identificação da aplicação. Modelo anterior ausente do catálogo da conta; configurado `openai/gpt-oss-20b` preservando a chave. Após publicar, o status retornou ready/available e uma mensagem neutra recebeu resposta real. O script agora valida acesso e modelo antes de salvar.

Primeiro uso em três etapas, com prévia e distribuição semanal editável; Português/RLM combinados, revisão sábado, redação domingo, descanso opcional. Iniciais/cores por matéria e meta diária ajustada ao perfil. Somente planejamentos automáticos intocados são substituídos ao reaplicar a mesma semana. HTML usa rede primeiro e fallback offline no service worker v8. Validação: lint/build, 40 testes JS e 50 Python; revisão desktop/mobile e alteração de semana/tempo sem duplicação. Deploy confirmou dados preservados e demais serviços sem reinício.
