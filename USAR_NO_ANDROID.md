# Usar no Android

1. **Instalação PWA ou Acesso no Navegador**:
   - No Wi-Fi de casa, com o computador executando `python3 servir.py --port 8766`, abra `http://<IP-DO-COMPUTADOR>:8766/?view=questoes` no Chrome do Android.
   - O app agora é uma **PWA**: o Chrome exibirá o banner ou a opção no menu **"Adicionar à tela inicial" / "Instalar aplicativo"**.
   - Uma vez aberto/instalado, o Service Worker faz o cache offline de forma automática.
2. **Uso Offline Completo**:
   - O aplicativo funciona sem internet (modo avião).
   - Você também pode continuar usando a opção **"Baixar app offline"** se preferir o arquivo autônomo `tjpb-estudo-offline.html`.
3. **Sincronização com o PC (1-clique)**:
   - Ao terminar seus treinos no celular, quando estiver no Wi-Fi de casa, basta tocar em **"Sincronizar com PC"** na barra de ações.
   - O backup do seu progresso, respostas e justificativas será enviado via API diretamente para `dados/ultimo_backup_sincronizado.json` no computador.
4. **Simulado Cronometrado**:
   - Há um cronômetro com tempo de prova configurável (padrão FGV de 3 minutos por questão, com alerta visual nos últimos 30 segundos) para simular o ritmo real de prova.

## Banco de Questões

- **28 questões prontas no seed inicial**:
  - Questões de Língua Portuguesa (FGV) com sublinhados recuperados.
  - Questões de TI (Engenharia de Software, Qualidade/Testes, Banco de Dados/ACID/SQL, Design Patterns, DevOps/Kubernetes, Segurança OWASP e LGPD).
- Inferência inteligente de blocos para disciplinas de TI e Português ao importar novos lotes.

## Computador

Na pasta do projeto: `python3 servir.py --port 8766`. Se o IP mudar, use o IP atual do Wi-Fi. O servidor entrega apenas o HTML e não lista os arquivos da pasta.

O script `estudo.py` continua disponível para estudar pelo terminal. Execute `python3 estudo.py --help`. O banco SQLite e o histórico do navegador são independentes; a exportação de progresso permite visualizar o resumo do SQLite no mapa.

## Validação desta atualização

- 10 testes Python e 17 testes JavaScript passaram.
- No navegador, a importação de lote fictício, correção, justificativa, recarga sem duplicação e resultado foram verificados.
- Tela testada com largura de 390 px, sem rolagem horizontal na aba Questões.
- O HTML offline baixado foi inspecionado: contém questões e tentativas; todos os scripts executáveis passaram na verificação de sintaxe. Isso não substitui o teste em modo avião no Android.
- Os arquivos anexados originais foram preservados em `referencias/`.
