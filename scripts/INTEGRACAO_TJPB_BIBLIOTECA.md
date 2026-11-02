# Biblioteca TJPB: integração aplicada

A integração foi aplicada em 01/11/2026 à área Cursos e aulas do site TJPB.

- Frontend único e reutilizável: `frontend-courses/src/CourseLibrary.jsx`.
- Backend compartilhado: `library_service.py`, adaptado das regras de hierarquia e transmissão do protótipo/blueprint.
- Adaptador HTTP de produção: `servir.py`, com autenticação real das contas TJPB e cookie HttpOnly para o player.
- Catálogos privados: `dados/drive_tree.json` e `dados/drive_catalog.json`.
- Credencial do Drive: `token.json`, somente no servidor, modo 0600. Não incluir no HTML, em commits ou em pacotes estáticos.

O `tjpb_library.py` e o `tjpb_library_blueprint.py` permanecem como protótipos Flask de referência; não precisam ser iniciados para usar o site publicado. A produção não depende de um segundo servidor Flask.

A arquitetura, os exemplos de reutilização por curso, o build, as rotas, o armazenamento e os testes estão documentados em `../frontend-courses/README.md`. O deploy continua sendo `../newDeploy.sh`, restrito ao TJPB.

O catálogo é um snapshot. Para incorporar mudanças do Drive, execute o fluxo existente de exportação e depois o deploy. Aulas e PDFs exigem internet; o progresso de aulas é local ao navegador e separado por conta nesta versão.
