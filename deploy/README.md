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

O script gera o HTML, empacota apenas nove arquivos explícitos da aplicação, verifica seus hashes e faz upload. Não envia banco de usuários, sessões, respostas, backups sincronizados, .env ou código de outros projetos. A chave SSH é usada diretamente pelo OpenSSH e não é copiada nem incluída nos logs. A identidade do servidor é verificada pelo known_hosts.

O helper `remote-tjpb.sh` valida a unidade e o diretório, obtém um lock, guarda o código anterior e copia `dados/` com o serviço parado. Depois substitui somente a lista de arquivos, confirma que os dados não mudaram durante a instalação e inicia somente tjpb-estudo.service. Confere o HTML local e o publicado via HTTPS, o relatório e a API anônima. Compara PIDs dos serviços Nginx/CronFlow/Docker e IDs/horários de inicialização dos contêineres antes/depois. Não reinicia nem altera esses outros serviços.

Uma falha após o início da instalação tenta restaurar o código anterior e reinicia apenas o TJPB. Os dados não são revertidos automaticamente, para não apagar respostas novas. Não altera Nginx, certificados ou unidades systemd.

## Último deploy verificado

31/10/2026, 19:08 (America/Sao_Paulo).
Backup anterior: `/var/www/tjpb/.deploy/backups/20261031T220803Z-f0f896aa`.
Verificações de HTTPS, relatório, API, preservação dos dados e isolamento dos demais serviços passaram.
Log: `deploy/logs/20261031T220749Z-deploy.log`.

Para voltar ao código anterior a essa atualização, execute explicitamente:

```bash
./newDeploy.sh --rollback 20261031T220803Z-f0f896aa
```

Cada deploy imprime seu BACKUP_ID. Use o ID desejado; o comando de rollback também salva o código que estiver ativo antes da reversão. Backups ficam em `/var/www/tjpb/.deploy/backups/` e logs locais em `deploy/logs/`.
