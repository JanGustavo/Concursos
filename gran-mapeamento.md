# Filtros do Gran ligados ao mapa de estudos

Verificação: 25/10/2026, pela interface autenticada do Gran Questões.

O catálogo `gran-filtros-verificados.json` registra 21 buscas, organizadas nos 19 blocos do mapa. O HTML inclui os mesmos dados internamente, para continuar funcionando como arquivo local, sem depender de carregar o JSON pela rede.

## O que foi confirmado

Rota de interface: `https://questoes.grancursosonline.com.br/aluno/filtro/concursos`.

| Parâmetro | Valor confirmado | Significado |
| --- | --- | --- |
| `banca` | `102` | FGV |
| `assunto` | ID ou lista de IDs separados por vírgula | Disciplina, assunto ou conjunto de subassuntos selecionados |
| `anulada` | `0` | Excluir anuladas |
| `desatualizada` | `0` | Excluir desatualizadas |
| `nivel` | `1` | Superior |
| `dificuldade` | `4` | Difícil |
| `anos` | `2026` | Ano selecionado no teste |
| `carreira` | `103` | Tribunais |

Exemplo real confirmado: `?nivel=1&dificuldade=4&anos=2026&carreira=103&banca=102&assunto=404802&desatualizada=0&anulada=0`, para LGPD. A interface exibiu os filtros correspondentes e um resultado no momento da consulta. A quantidade pode mudar.

## Como usar no HTML

1. Abra um assunto do mapa.
2. Expanda **Praticar questões · buscar na FGV**.
3. Se desejar, marque nível superior, tribunais, difícil ou ano 2026.
4. Abra uma das buscas verificadas. A resolução acontece no Gran; o banco local de tentativas ainda não está integrado à página.

Cada registro do catálogo guarda bloco, nome do filtro, URL gerada, parâmetros, contagem observada e data. Os filtros são recortes pedagógicos: por exemplo, LGPD atende uma parte de Tecnologia no Judiciário; acessibilidade atende uma parte de UI/UX. Eles não comprovam cobertura de todos os itens do edital.

## Comportamentos observados

- Selecionar ramos pode gerar vários IDs. As listas variaram conforme os subassuntos disponíveis/selecionados na interface. Não presumir que um ID inclua automaticamente todos os descendentes.
- Selecionar duas disciplinas e apenas um assunto pode incluir a outra disciplina inteira. Os filtros finais registrados foram refeitos com uma disciplina por vez.
- A escolha de **Mais relevantes** não alterou a URL. A ordenação não foi convertida em parâmetro por suposição.
- A segunda página foi confirmada pelo controle de página desabilitado/selecionado. O tamanho de 50 questões foi confirmado pela contagem de 50 controles de questões. Esses ajustes não alteraram a URL observada.
- Portanto, não foram inventados parâmetros como `page`, `limit` ou `order` para essa rota.

## O que ainda não está confirmado

Este é um mapa de **URLs de filtro da interface**, não de endpoints internos da API. Não foram inspecionados endpoints, métodos HTTP, corpos de requisição, cabeçalhos ou autenticação da API. O catálogo não contém cookies, senhas ou tokens.

Para documentar a API, seria necessário observar as requisições efetivamente feitas ao mudar filtros/páginas ou encontrar documentação. A URL da página sozinha não comprova como a API recebe esses valores.

As questões e gabaritos não foram extraídos nesta verificação, e nenhuma resposta foi enviada. O JSON de questões continua sendo a entrada prevista para o app próprio de prática e estatísticas.
