# CLAUDE.md - Controle do Acervo (SCA)

Este arquivo guarda só o que muda uma DECISÃO de quem escreve código aqui. A referência completa
(estrutura do repositório, stack, comandos, tabela de rotas, banco, instalação) vive no `README.md`,
e como subir o ambiente, no `levantar_servico.md`.

## Git Rules

- **NEVER create commits automatically.** The user will always review changes and commit manually. Do not run `git add`, `git commit`, or `git push` unless the user explicitly asks for it in that specific message.

## Este repositório é PÚBLICO

Nunca escreva em arquivo versionado: endereço de servidor, IP interno, porta acoplada a host,
pasta de rede, caminho de máquina (letra de unidade, UNC) nem segredo com valor. Cite a **CHAVE**
do `server/config.env`, que é gitignored e nunca foi commitado. O catálogo comentado, sem valor
nenhum, está em `.env.example`.

O guard `scripts/check_vazamento.py` faz a regra cumprir no pre-commit (`.githooks/pre-commit`,
fail-closed). Numa máquina nova ele só liga com `git config core.hooksPath .githooks`. Ele checa
só o que vaza, nunca estilo: guard que bloqueia todo commit ensina `--no-verify`.

## O que o sistema é, em um parágrafo

O **SCA** gerencia o acervo geoespacial do 1º CGEO: produtos versionados (cartas, ortoimagens, modelos
de elevação), seus arquivos, os volumes de armazenamento, a mapoteca física e, desde 2026-07-27, o
controle orçamentário. São **três módulos de autorização no mesmo servidor e na mesma interface**:
`acervo`, `mapoteca` e `orcamento`. Desde 2026-08-02 ele também é o **dono da identidade**: guarda o
hash da senha, valida o login sozinho e cadastra usuário pela própria interface. Não depende de
serviço externo nenhum.

## Modelo de autorização

```
dgeo.usuario.administrador BOOLEAN      -- administrador de TUDO, acima de qualquer modulo
dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
dominio.tipo_perfil (code, nome)        -- 1 consulta, 2 operador, 3 gerente (hierarquicos)
dominio.modulo (code, nome, nome_abrev) -- 1 acervo, 2 mapoteca, 3 orcamento
```

- `verifyPerfil(minimo, modulo)` compara `perfil_id >= minimo` e **lê o banco a cada requisição**, não o token. É o que faz desativar usuário ou rebaixar perfil valer na hora.
- `administrador` é **global e único**, curto-circuita qualquer módulo. Não existe administrador por módulo.
- Quem não tem linha para um módulo **não acessa aquele módulo**. Conceder é ato explícito, nunca efeito colateral de migração.
- `dominio.modulo` é tabela, e não CHECK, para que absorver outro sistema seja um `INSERT`.
- `verifyAdmin` fica para rota de plataforma (usuários, views materializadas, limpeza de download).

**Armadilha que já custou caro:** o default do `verifyPerfil` é `'acervo'`. Rota do orçamento ou da
mapoteca que esquecer o segundo argumento passa a cobrar perfil no ACERVO, sem erro visível. O teste
`server/src/__tests__/routes/orcamento/modulo_em_toda_rota.test.js` lê o fonte e faz cumprir.

## Decisões de design deliberadas

Parecem defeito e não são. Não "conserte" nenhuma sem falar com o chefe.

### Autenticação dentro do SCA (2026-08-02)

Até esta data `dgeo.usuario` era um **espelho**: o SCA não sabia validar uma senha, e todo login
virava um `POST` no [Auth Server](https://github.com/1cgeo/auth_server), noutro processo e noutro
banco. Custava três coisas: o SCA não subia com o outro serviço fora do ar, cadastrar gente era
trabalho em DOIS sistemas (criar lá, importar aqui) e **"trocar a minha senha" era uma tela que o
SCA não tinha e não poderia ter**.

- **O catálogo de APLICAÇÕES não veio, e é por isso que `dgeo.login.cliente` é VARCHAR.** O Auth
  Server serve o SAP e o Gerenciador FME além do SCA, e por isso tinha `dgeo.aplicacao` com CRUD
  próprio. Aqui a lista fechada é `sca_web` e `sca_qgis`, e ela já vive no Joi de
  `login/login_schema.js`: a rota só grava o que ela mesma acabou de aceitar, então valor fora da
  lista não tem por onde entrar. Uma tabela de domínio seria administrar um catálogo de duas
  linhas. `dgeo.login.usuario_id` é ANULÁVEL de propósito: apagar a pessoa não apaga a passagem
  dela, senão a contagem de acessos do mês mudaria retroativamente ao demitir alguém.
- **`dgeo.usuario.senha` é ANULÁVEL nos DOIS caminhos, e o login trata isso como caso próprio.**
  Os hashes de quem já existia foram copiados do banco do Auth Server por
  `scripts/copiar_usuarios_auth.js`, fora do sistema, depois da migração (bcrypt é portátil, e o
  custo é o mesmo 10 dos dois lados). Nula significa "cadastrada e ainda sem senha local", e a
  resposta diz isso em vez de "usuário ou senha inválida" — a causa é administrativa, e mandar a
  pessoa tentar de novo a senha certa para sempre é o que a mensagem genérica faria. A tela
  `#/usuarios` marca quem está nesse estado, senão a pessoa só apareceria ao reclamar que não
  entra. **Não existe `SET NOT NULL` como passo final**, embora ele tenha sido planejado: `er/`
  declararia a coluna obrigatória e a migração não, e o `migrations/ensaiar_migracao.cjs` existe
  justamente para provar que atualização e instalação nova chegam ao mesmo schema. Nenhum caminho
  de escrita produz nulo — `criaUsuario` sempre grava hash —, então a garantia que se perde é
  teórica, e a que se ganha (os dois caminhos convergirem) é verificada a cada ensaio.
- **Há UM caminho de conferência de senha no sistema, e um só de geração de hash.** `login/senha.js`
  gera e confere; `loginCtrl.conferirSenha` é o que a troca de senha usa. `usuario/` importa dos
  dois em vez de chamar bcrypt por conta própria: dois lugares escolhendo o custo divergiriam no
  primeiro ajuste, e o hash mais fraco seria justamente o que ninguém estaria olhando.
- **Excluir usuário quase sempre falha, e está certo.** `dgeo.usuario.uuid` é referenciado por
  dezenas de tabelas dos três módulos. Quem já trabalhou no sistema não se apaga, se **desativa** —
  apagar reescreveria a autoria do que a pessoa cadastrou. A rota existe para o cadastro errado de
  cinco minutos atrás, e o `23503` vira frase que diz o que fazer, em vez do 500 cru da FK. Só
  `dgeo.usuario_perfil` cai junto, por CASCADE: perfil sem dono não é histórico de nada.
- **O reset administrativo vale para ADMINISTRADOR também, ao contrário do original.** Lá
  (`GET_NON_ADMIN_USERS`) o reset recusava administrador. Aqui o administrador é global e único, e
  recusar bloquearia justamente a conta sem outro caminho de recuperação. Não há escalada: quem
  chama a rota já é administrador e já passa em todo módulo.
- **A política de senha ficou em PARIDADE (qualquer coisa não vazia), de propósito.** Subir o piso
  no mesmo dia em que o login mudou de lugar recusaria a senha que muita gente já usa. Quando
  virar política, o lugar é o `senha` de `usuario_schema.js`, e ela sobe nas três rotas de uma vez.
- **`/perfil` é registrado ANTES de `/:uuid`.** O Express casa na ordem de declaração, e
  `PUT /perfil` cairia na rota de administrador com 'perfil' no lugar do uuid.
- **Os campos de identidade do `PUT /usuarios/:uuid` são OPCIONAIS, com omissão valendo "não mexe".**
  Os botões de alternar da tela de usuários chamam essa rota só com `administrador` e `ativo`, e
  isso é anterior a ela saber editar cadastro. Quem preenche o valor atual é o `preserveOmitted`;
  um `.default()` no Joi injetaria a chave e apagaria o nome de quem só foi ativado.

### Autenticação e superfície pública

- **`/api/integracao/*` não tem autenticação.** GET públicos e somente leitura, para o vault do chefe da DGEO consumir o SCA sem credencial. Expõem só cobertura do acervo, produtos concluídos no mês (por `acervo.versao.data_edicao`) e o agregado da mapoteca que o RPCMTec exige, sem endereço, contato ou observação de impressão.
- **`GET /api/mapoteca/pedido/localizador/:localizador` não tem autenticação.** É o acompanhamento do pedido pelo próprio cliente, que não tem conta. Já foi fechada por engano uma vez, numa classificação automática de rotas.
- **`/logs` não tem autenticação, e o CORS aceita qualquer origem.** O sistema roda em rede interna.
- **Credencial de banco na URI de camada do QGIS.** O plugin conecta direto no PostgreSQL para carregar camada. Aceitável em rede interna.

### Estrutura e convenções que parecem inconsistência

- **A mapoteca usa `usuario_id` (INTEGER) e o acervo usa `usuario_uuid` (UUID).** `dgeo.usuario` tem os dois. Tabela nova segue a convenção do acervo (UUID), que é a do orçamento também.
- **O módulo orçamento tem o próprio `schema_validation`** (`orcamento/utils/`). O do SCA descarta chave desconhecida e responde 200; o do orçamento recusa com 400 e sugere a chave parecida. São contratos diferentes de propósito: unificar afrouxaria em silêncio as 67 rotas do orçamento. `orcamento/utils/index.js` reexporta o `utils/` do SCA com essa única substituição.
- **O schema `orcamento` não tem PostGIS nem geometria.** Orçamento não tem dado espacial.

### Interface

- **A troca de módulo mora na SIDEBAR, não num dropdown na navbar.** Cada módulo é uma seção colapsável, e o cabeçalho dela leva para a home do módulo. O dropdown existiu por algumas horas em 2026-07-27 e foi recusado pelo chefe. Junto veio a regra que o desenho anterior violava: a sidebar é montada uma vez e **nunca se desmonta**, senão entrar numa rota de plataforma (`#/usuarios`) apaga o menu do módulo.
- **O administrador global não é coluna da tabela de usuários.** Ele é propriedade da pessoa, então aparece como marca ao lado do nome. Repetir "Administrador" numa coluna por módulo sugere que existe administrador de módulo, que é justamente o que o modelo não tem.
- **O ano de referência é contexto de MÓDULO, e mora na navbar.** Pela fábrica `@store/year-store.js`: chave de `localStorage` e evento são namespaced por módulo (`@sca-mapoteca-ano`, `anochange:mapoteca`), senão escolher 2025 num módulo mudaria o outro sob os pés de quem troca pela sidebar. O seletor é o mesmo componente; a diferença é de política: no orçamento o ano também decide **onde se cadastra**, e por isso ele oferece "+ Outro ano…"; na mapoteca o ano só **filtra o que já aconteceu**. Na mapoteca vale para o dashboard inteiro, pedidos, consumo, RPCMTec e detalhe do material; fica de fora só a lista de **clientes**, que é cadastro e não movimento. Pedidos esteve fora por algumas horas em 2026-07-28 e o chefe reverteu no mesmo dia. O custo, deliberado: o pedido de dezembro concluído em janeiro só aparece trocando o ano na navbar.
- **No dashboard da mapoteca existem DOIS recortes anuais, e cada aba diz na tela qual é o dela.** Resumo Anual e Mapa contam por data de **entrega** (`FILTRO_ENTREGUE_ANO`); Pedidos e Atendimento, por data do **pedido** (`FILTRO_ANO_PEDIDO`). O pedido de dezembro de 2025 entregue em janeiro de 2026 cai em anos diferentes nos dois, e os dois estão certos. Sem a linha de escopo na tela (`.dashboard__escopo`) os números pareceriam se contradizer. A aba Materiais é meio a meio e também avisa: o consumo é do ano, mas o **estoque é o saldo de hoje** e ignora o seletor, porque "estoque de 2025" não existe; a rota dele é a única do dashboard que não aceita `ano`. As janelas deslizantes ("últimos 6 meses") saíram junto: em 2025 elas continuariam terminando hoje.

### Mapa

- **`maplibre-gl` é a única dependência de mapa, e entra por `import()` dinâmico.** Decisão do chefe em 2026-07-25. Ela pesa cerca de 1 MB minificada, contra 290 KB de todo o resto da interface: num `import` de topo, quem abre a tela de pedidos baixaria o mapa junto. `components/mapa/base.js` a carrega sob demanda (`carregarMapLibre()`) e ela vira um pedaço próprio no build; é dele que saem os dois mapas que existem, a busca do acervo e as entregas da mapoteca. O CSS dela continua estático, que são poucos KB e evita o mapa nascer sem controles. O fundo é OSM: sem internet os polígonos continuam aparecendo, porque vêm da nossa API. Em teste, `@components/mapa/maplibre-stub.js` faz o papel da biblioteca, porque o jsdom não tem WebGL.
- **Os filtros do mapa da mapoteca são do SERVIDOR, e a escala entra pelo rótulo.** O cliente não existe na feição (ela traz a CONTAGEM de OMs atendidas), então filtrar tipo e escala na tela e o cliente no servidor faria as três contas seguirem regras diferentes. A escala vai como `'1:50.000'`, e não como código de domínio, porque a escala personalizada tem um código só para todos os denominadores: por código, 1:30.000 e 1:75.000 virariam uma opção chamada "personalizada".
- **Nos DOIS mapas de polígono o rótulo sai de uma fonte de PONTOS, e o preenchimento é ordenado
  por área.** Valia só para a mapoteca até 2026-08-02, quando o mesmo defeito foi visto na busca do
  acervo com UM produto na tela: a folha que cruza a borda de um ladrilho aparecia rotulada duas
  vezes. A causa é a mesma nos dois, e a correção também — `acervo_ctrl.buscaGeometrias` passou a
  devolver `ponto` (`ST_PointOnSurface`) e `area`, como `mapoteca/dashboard_ctrl.js` já fazia. Ter
  consertado num mapa e não no outro é o que fez o defeito sobreviver: a decisão abaixo estava
  escrita, e ainda assim o segundo mapa nasceu com ela.
- **No mapa da mapoteca o rótulo sai de uma fonte de PONTOS, e o preenchimento é ordenado por área.** Rotulando o polígono, a mesma carta aparecia duas vezes: o MapLibre corta o GeoJSON em ladrilhos e ancora o texto por pedaço. O ponto vem do servidor por `ST_PointOnSurface` (e não `ST_Centroid`, que cai fora de uma folha em L). A ordenação existe porque o mapeamento é **aninhado por escala**: sem `fill-sort-key` pela área negativa, a folha grande cai por cima da pequena e a engole, inclusive para o clique. O tom de azul mais escuro é a soma dos preenchimentos translúcidos empilhados, não erro de classificação.
- **Polígono empilhado no mapa da mapoteca é PRODUTO diferente, nunca versão.** A consulta agrega por `prod.id`; a versão só aparece no caminho `produto_pedido -> versao -> produto`, nunca no resultado. O empilhamento tem duas origens legítimas: o aninhamento por escala (a 2952-1-SO está contida na 2952 e na 535), e Carta Topográfica e Carta Ortoimagem da MESMA folha, que no SCA são produtos distintos com contorno idêntico. Por isso o balão lista TODOS os produtos sob o ponteiro: mostrar um só era o que fazia a tela parecer errada.
- **A informação do mapa da mapoteca sai num painel FIXO, não num balão que segue o ponteiro.** O balão do MapLibre é ancorado na coordenada apontada, então perto da borda do quadro ele saía da área visível — e a carta perto da borda é justamente a que se aponta. O painel nunca esvazia: sem carta sob o ponteiro volta ao texto de convite, porque aparecer e sumir a cada movimento do mouse é o que faz um painel piscar. O `max-height` para antes do rodapé para não cobrir a barra de escala.

### Busca e filtros

- **As opções de filtro são FACETADAS: cada lista aplica os outros filtros, nunca o próprio.** Pedido do chefe em 2026-07-28 ("um filtro deve filtrar o quantitativo do outro"). Aplicar também o próprio filtro deixaria cada lista com uma opção só. Elas ficam em endpoint próprio (`/dashboard/entregas_filtros`, `/acervo/busca/facetas`), e não junto das feições, porque o cache é por combinação e a tela pede as duas coisas em paralelo. Quando o cruzamento zera a escolha atual, a tela a MANTÉM com "(0)" em vez de descartá-la: descartar desfaria em silêncio o que a pessoa pediu. Duas exceções: a troca de ano, onde a opção some porque não existe mesmo; e, na busca do acervo, o subtipo que não pertence ao tipo recém-escolhido, que é DESCARTADO porque não cruzou a zero, deixou de fazer sentido. As contagens saem do MESMO `montarFiltrosBusca` da lista e da camada do mapa, então nenhuma pode divergir do resultado.
- **A sugestão de palavra-chave da busca é um popover NOSSO, não `<datalist>`.** O nativo escolhe sozinho quantas linhas mostrar, sem CSS que o alcance, e com as vinte etiquetas que a rota devolve abria cobrindo boa parte da tela. Junto vieram três coisas que o datalist não dava: a contagem de usos como texto de verdade, setas e Enter iguais em todo navegador, e a lista refeita a cada tecla contra o servidor. Enter com o campo digitado aplica o texto como está, de propósito: a sugestão vem limitada a 20 e o acervo tem mais etiquetas do que isso.
- **A busca do acervo lista PRODUTOS, e a ficha lista as versões da mais nova para a mais antiga.** O cartão anuncia a última edição (`ORDER BY v.data_edicao DESC LIMIT 1`) e a contagem de versões; a ficha traz todas, ordenadas no SERVIDOR por `data_edicao DESC NULLS LAST, id DESC`. Ordenar na tela não serviria: quem lê essa rota inclui o plugin. `NULLS LAST` porque versão sem data de edição é registro incompleto, e não a mais nova.

### RPCMTec e relatórios

- **O RPCMTec é UM gerador só, fora dos três módulos.** Ele é o relatório mensal da DIVISÃO: a mesma edição fala de acervo, mapoteca e orçamento, e o chefe assina uma só. Até 2026-08-01 era gerado em DOIS lugares que não se conheciam, cada um com a própria numeração de seção e o próprio DOCX; quem montava a edição colava um arquivo no outro, no Word, todo mês. Hoje é `server/src/rpcmtec/` sob `/api/rpcmtec`, com tela em `#/rpcmtec` e a edição mensal em `rpcmtec.edicao`. A guarda é **`verifyAdmin`**, e não `verifyPerfil`: o relatório traz valor de crédito, de empenho e de liquidação, e não existe "perfil de RPCMTec" porque não existe módulo RPCMTec. O que NÃO foi junto é a execução por ND que alimenta as abas do painel do orçamento: virou `/api/orcamento/dashboard/execucao_nd`, com `verifyPerfil('consulta','orcamento')`, porque o painel pede NÚMEROS quebrados em PDR e Extra-PDR e o relatório pede a visão do PDR já formatada. Servir os dois da mesma rota obrigaria a guarda mais fraca a valer para as duas.
- **O DOCX do RPCMTec copia a FORMATAÇÃO do documento da Divisão, medida no OOXML.** As constantes de `rpcmtec/rpcmtec_docx.js` (Calibri, 12pt no título e no cabeçalho e 10pt no corpo, preenchimento `DDD9C4`, borda de 1pt, recuo `-141`, página Letter com margem superior de 990) são valores LIDOS do documento real, não escolhas nossas: cada tabela tem de ser colável na subseção de mesmo número sem ninguém reformatar. Cada subseção tem GRADE DE COLUNA própria, porque elas não são proporcionais entre si. Só saem as subseções que o SCA preenche INTEIRAS; o que fica de fora está listado com o motivo no cabeçalho de `rpcmtec_ctrl.js` e aparece na tela, para ninguém procurar o que não existe.
- **Três números do RPCMTec só se provaram errados contra PRODUÇÃO, e a lição é essa.** Os três passavam nos testes e eram plausíveis na tela. (1) A **3.3 Extra-PIT** saiu do gerador: ela vinha de `previsto_pit = false`, que é FALSE por default na maioria dos pedidos. O Extra-PIT do RPCMTec é a exceção AUTORIZADA, e o SCA não guarda o que a distingue. (2) A **% da ASC passava de 100%** porque o numerador era o acervo inteiro, que tem folha de fora da área; hoje é recortado por `limites.area_suprimento`. (3) A **versão PLANEJADA entrava como produto entregue**: ela é promessa de produção e sua `data_edicao` é a data do cadastro. Corrigido em `integracaoCtrl.getProdutosFinalizados`, o que conserta junto a rota pública do vault da DGEO.
- **O Anuário Estatístico e o RTM saem de planilha-SEMENTE, e não são redesenhados.** Os arquivos reais estão versionados em `rpcmtec/modelos/`, com os dados removidos (no RTM, 1.628 linhas: elas traziam nome de OM e quantidade entregue, e este repositório é público). Gerar é abrir o ZIP, trocar só o valor das células dentro do `content.xml` e reescrever o resto byte a byte. Antes eram montados do zero e tinham os números certos **sem ser** o arquivo que a DSG confere linha a linha. No Anuário, TODA célula de valor é reescrita, inclusive as que dão zero: deixar de escrever uma deixaria ali o número da semente num relatório de outro mês, que é o modo de falhar mais perigoso desse arquivo. O casamento é por RÓTULO com contagem conferida (falha alto), e as fórmulas da semente viram valor de propósito: ela traz `Exército = SUM(RM:EE)`, e RM e EE são justamente as duas colunas que o SCA não sabe preencher. `utils/ods_export.js` ficou só com o ZIP (abrir e reescrever); o construtor de `.ods` do zero saiu em 2026-08-01 junto com o último chamador.
- **`GET /api/rpcmtec/rtm/ods` e `GET /api/mapoteca/relatorio/impressao_detalhada_ods` chamam o MESMO `gerarRtmOds`** e produzem arquivo idêntico (provado por hash): dois caminhos para o mesmo arquivo com formatos diferentes é a divergência que a fusão do RPCMTec existiu para acabar. O módulo do gerador só importa `utils`, então não há ciclo entre mapoteca e rpcmtec.

### Acervo

- **Produto que JÁ ESTÁ no volume entra por `POST /api/arquivo/catalogar/product`, e o servidor mede o hash.** Passar por `prepare-upload`/`confirm-upload` cobrava por um trabalho que não acontece: o cliente lia o arquivo inteiro para declarar o checksum e o `confirm-upload` lia tudo de novo para conferir uma cópia que nunca houve (362 GB relidos no LOTE_1 do Convênio RS, de 1h20 a 3h), **com essa releitura dentro da transação**, aberta por horas e sem retomada parcial. Agora o servidor lê UMA vez, fora de transação, e grava o checksum e o tamanho que ele mesmo mediu; o cliente não declara nenhum dos dois, e mandá-los é 400, porque descartado em silêncio ele acreditaria ter gravado o que mandou. É a mesma política do `/atualizar-checksum`. O `volume_armazenamento_id` vem no CORPO: no upload o volume é o primário do tipo de produto, porque o servidor escolhe para onde copiar, e aqui é onde o arquivo já está. **A rota só aceita volume com `layout_origem = true`**, e essa é a porta que a impede de virar atalho para pular a validação de transferência no acervo comum. Unicidade física, identidade do produto, sequência de versão e existência do arquivo continuam valendo. Junto veio a validação de travessia de caminho (`utils/caminho_volume.js`), que **não existia**: `path.join` não protege contra `..`. Só cobre produto novo; versão e arquivo avulsos continuam no `prepare-upload`.

- **A LÁPIDE do arquivo excluído mora num módulo só, e o vínculo com o download casa por `uuid_arquivo`, nunca por ordem.** Excluir no acervo copia o arquivo para `acervo.arquivo_deletado` e leva os downloads dele junto. Esse bloco de ~55 linhas, com 21 colunas escritas à mão, estava copiado em TRÊS lugares (`deleteArquivos`, `deleteVersoes`, `deleteProdutos`), e só o primeiro tinha teste — por uma rota, que provava a contagem e não as colunas. Acrescentar coluna a `acervo.arquivo` exigia lembrar dos três, e esquecer um não dá erro: a lápide nasce com o campo nulo e a falta só aparece quando alguém for procurar o dado. Hoje é `arquivo/arquivo_deletado.js`, na feature dona de `acervo.arquivo`, pelo mesmo desenho de `mapoteca/query_fragments.js`. Como todo dado da lápide sai da PRÓPRIA `acervo.arquivo`, virou `INSERT ... SELECT` com CTE: apagar um produto com 400 arquivos era **2.000 idas ao banco dentro de uma transação, e passou a 4**, independente da quantidade. O pareamento download → lápide usa `RETURNING id, uuid_arquivo` casado com `acervo.arquivo.uuid_arquivo` (que é UNIQUE), e **não** a ordem em que o banco devolve os ids: por ordem funcionaria hoje e trocaria os downloads de dois arquivos no dia em que o plano mudasse, sem erro nenhum e com as contagens ainda batendo. É o caso que `__tests__/integration/exclusao_acervo.test.js` guarda, com quantidades diferentes de download por arquivo justamente para que a troca apareça.

### Escrita do acervo pela interface web (2026-08-01)

Até aqui o módulo acervo do client era **100% leitura**, e todo cadastro passava pelo plugin do QGIS,
que exige QGIS instalado e acesso SMB ao volume. Quem não tinha os dois não catalogava nada.

- **O método de definir a GEOMETRIA sai da ESCALA, e não da vontade de quem cadastra.** Escala 1 a 4
  (25k, 50k, 100k, 250k) é enquadramento SCN e o quadro nasce do **MI ou do INOM**, calculado, sem
  desenho a mão. Escala 5 (personalizada) não tem folha para calcular, e ali valem os **cantos**, com
  o desenho livre como escape para o recorte irregular (que existe: o invariante `1e_info` conta
  quantos são). Não é restrição gratuita: folha do SCN tem quadro DEFINIDO pelo identificador, e
  desenhá-la a mão é o que produz os defeitos que a auditoria persegue **depois do fato** — `1d`, `1e`,
  `1g`, `1h` (MI preenchido com o INOM, 29 produtos errados achados em 2026-07-30) e `1i`. Nascendo do
  identificador, geometria, MI, INOM e escala ficam coerentes **por construção**. Quando a escala
  ainda não foi escolhida, o editor PERGUNTA o enquadramento em vez de assumir: cair no modo livre por
  omissão ofereceria desenho a mão para uma folha sistemática.
- **INOM → polígono é FÓRMULA; MI ↔ INOM é TABELA.** `utils/scn.js` faz a decomposição do SCN por
  aritmética, em SEGUNDOS DE ARCO (em grau, o 1/3 do nível de 1:100.000 não tem representação binária
  exata e o canto sai com ruído). Os tamanhos que ele produz são exatamente os do invariante `1e`, e a
  profundidade em tokens mapeia para `tipo_escala_id` pela regra do `1d`: **são a mesma régua, e
  divergirem é defeito de um dos dois.** Já o MI é numeração histórica sem fórmula, e folha fora do
  território brasileiro simplesmente **não tem MI**. "Esta folha não tem MI" é RESPOSTA, não erro.
- **Os CSV de `utils/scn_dados/` vêm do DSGTools e carregam a licença de origem (GPL-2.0).** Este
  repositório é MIT. As duas obras são da DSG/Exército, o que torna o porte decisão INTERNA e não uso
  de obra de terceiro; por isso os dados moram em diretório próprio, com `LICENSE-DSGTOOLS` ao lado
  e atribuição no `README.md` de lá. **Não é código portado — o cálculo foi escrito do padrão.**
  **Pendência do chefe:** o porte foi decidido no desenvolvimento, e quem lê este repositório vê MIT
  com uma pasta GPL-2.0 dentro. Confirmar com a chefia antes do próximo `push` público.
- **Os TRÊS tipos de versão entram pela web, e o que muda entre eles é o CAMINHO da gravação, não o
  formulário.** Regular nasce COM o arquivo e por isso sai do formulário para o assistente de
  carregamento; Planejada e Registro histórico nascem sem arquivo e gravam direto, cada uma na sua
  rota (`/versao_planejada` e `/versao_historica`), que são irmãs e têm o mesmo corpo. O tipo NÃO vai
  no corpo: as duas rotas o fixam no servidor, e mandá-lo seria um campo descartado em silêncio.
  Uma rota por coisa, e não um inteiro escondido: "promessa de produção" e "folha que existe e o
  acervo não tem o arquivo" são fatos diferentes, e o RPCMTec conta produto entregue por tipo de
  versão. Por isso a tela EXPLICA cada tipo em uma frase — os três preenchem os mesmos campos, e sem a
  frase a escolha viraria um número. A carga em LOTE continua sendo do plugin ou do CLI: esta tela
  grava uma versão por vez, e o acervo legado entra por dezenas de folhas. O tipo gravado entra na
  lista mesmo quando não é um dos oferecidos — sem isso, abrir a edição mostraria o campo vazio e
  salvar converteria em silêncio.
- **Versão Regular não se grava no formulário: ela vai para o assistente de carregamento.** O
  servidor não tem rota que crie Regular sem arquivo (`produto_ctrl.js:874-882`), e o arquivo é o que
  a define. O formulário valida tudo (ele espelha o gatilho `acervo.validate_version`) e passa o corpo
  PRONTO ao assistente, que só cuida dos arquivos: uma segunda cópia do espelho divergiria da
  primeira. O botão muda de nome para "Continuar para os arquivos", porque "Salvar" mentiria.
- **O subtipo da VERSÃO é filtrado pelo tipo do produto.** A lista inteira tem 29 entradas e cobre os
  treze tipos; oferecer todas convida a gravar "Modelo Digital de Superfície" numa versão de Carta
  Topográfica. Nada no banco impede, e é por isso que o servidor persegue esse caso no invariante `3h`.
  O subtipo já gravado continua na lista mesmo fora do tipo, porque o `3h` é REVISAR e há combinação
  legada tolerada.
- **`GET /api/produtos/folha?mi=|inom=` devolve o quadro da folha**, `verifyPerfil('consulta')`. Aceita
  um identificador só: os dois juntos fariam o servidor desempatar em silêncio.

- **O upload web é UMA requisição, e o SERVIDOR decide o nome, a extensão e o checksum.** Até
  2026-08-01 o servidor nunca escreveu no volume: quem copiava era o plugin, por SMB.
  `arquivo/upload_web.js` fecha o sentido contrário, e o desenho passou por uma revisão em
  2026-08-02 que mudou duas coisas de fundo:

  **Sem sessão.** A primeira versão reusava a máquina de `prepare-upload`/`confirm-upload`: três
  chamadas e quatro tabelas `_temp`. O par existe para cobrir a janela em que o PLUGIN sai para
  copiar os bytes por conta própria; no navegador os bytes vêm DENTRO da requisição, então não há
  janela e não há o que a sessão cubra — é o mesmo raciocínio que `/catalogar/product` já
  registrava. Usá-la mesmo assim cobrava caro: sessão abandonada virava linha pendurada em
  `upload_session` e `.parcial` no volume até o cron de 24 h. Hoje são
  `POST /api/arquivo/upload-web/{produto,versao}`, multipart, e ou tudo entra ou nada entra. O que
  se perde é reenviar só o arquivo que falhou; vale, porque o teto é de poucos GB
  (`UPLOAD_WEB_MAX_GB`, default 2) e a mediana em produção é de 6 a 11 MB.

  **O cliente não nomeia.** O nome físico sai de `acervo.nome_arquivo_padrao`, a MESMA função que o
  invariante `7a` usa para auditar — "auditor e escritor são a mesma regra" já estava escrito em
  `renomearPadrao`, e a primeira versão do upload web o contrariava. O custo era medível: cada envio
  criava uma linha de DEFECT no `7a`. Medido em 2026-08-02, um arquivo entrou como `carta_ensaio`
  onde o padrão pedia `CT_s12_2757-1-NE_1dsg`. Pela mesma razão o cliente não declara a **extensão**
  (ela sai do arquivo enviado; declarada, poderia dizer `tif` num PDF) nem o **checksum** e o
  **tamanho** (o servidor os mede no mesmo passo da escrita, e o navegador nem teria como: o
  `crypto.subtle` exige o arquivo inteiro em memória). Mandar qualquer um dos quatro é 400.

  **O padrão dá UM nome por versão, e quem separa os arquivos é a extensão** — `nome_arquivo_padrao`
  não recebe `tipo_arquivo_id`, e a unicidade física é `(volume, nome_arquivo, extensao)`. Dois
  arquivos da mesma versão com a mesma extensão são RECUSADOS, e não desambiguados com um sufixo:
  um `_2` faria o escritor nomear diferente do que o `renomear-padrao` e o `7a` esperam.

  As demais decisões seguem: escrita **atômica** (`<destino>.parcial` e `rename` no fim), o `rename`
  DENTRO da transação e depois do INSERT (é a ordem do `renomearPadrao`: o índice único arbitra a
  colisão com o disco intacto, e falha de disco derruba o registro junto), `motivoCaminhoInseguro`
  no nome derivado, e storage próprio do multer em vez de `diskStorage` (aquele grava e devolve o
  caminho, e o hash exigiria uma SEGUNDA leitura).

  **O teto do multer TRUNCA o fluxo, não o derruba.** O busboy para de emitir e marca `truncated`;
  sem conferir isso, o `pipeline` termina normal e o arquivo entra pela metade, com um checksum
  calculado sobre a metade — "válido" para sempre, e nada depois o acusa. A guarda está logo após o
  `pipeline`, e tem teste próprio.

  **TRÊS ROTAS, e a tela é a mesma nas três:** `/upload-web/produto` (produto novo, com a primeira
  versão e os arquivos dela), `/upload-web/versao` (versão nova em produto que já existe) e
  `/upload-web/arquivos` (arquivos numa versão que já existe). A terceira é o que **completa a versão
  PLANEJADA**, que nasce sem arquivo de propósito e o recebe nesta MESMA versão quando a produção
  termina: sem ela, a folha planejada pela web não tinha como ser completada pela web. Ela **não muda
  o tipo da versão** ao dar-lhe arquivo — "Planejada" e "Regular" dizem coisas diferentes sobre a
  PROMESSA, não sobre ter byte, e o RPCMTec conta produto entregue por tipo de versão. E o volume
  dela é o dos arquivos que a versão JÁ TEM, e não o primário do tipo: o primário pode ter mudado
  depois, e a unicidade de nome físico vale POR VOLUME, então metade da versão num volume e metade
  noutro deixaria de ser protegida contra colisão.

  **No caminho "produto e versão num passo só" o produto NÃO é gravado antes.** O corpo dele segue
  pendente do formulário de produto para o de versão, e quem grava os dois é a rota que os cria
  juntos. Gravar antes deixaria uma casca sem versão toda vez que alguém desistisse no passo
  seguinte — e desiste, porque é lá que o gatilho cobra o rótulo e o subtipo.

  **A ordem das partes do multipart importa:** o campo `dados` (JSON) vem ANTES dos arquivos, porque
  é dele que sai o destino de cada byte, lido enquanto o corpo ainda chega. Parte fora de ordem é
  recusada com a razão. E o n-ésimo arquivo casa com a n-ésima descrição, então as contagens têm de
  bater.

- **Data de versão é DIA DE CALENDÁRIO: `Joi.date().iso().raw()`, nunca `Joi.date()`.** Sem o
  `.raw()`, o Joi converte 'AAAA-MM-DD' em meia-noite UTC e a coluna `TIMESTAMP WITH TIME ZONE` guarda
  **21:00 do dia anterior** em UTC-3. Medido em 2026-08-01 cadastrando pela web, que manda o formato
  do `<input type="date">`: edição pedida em 01/08 voltou 31/07 na ficha. O custo não é a tela —
  `acervo.versao.data_edicao` é o que conta produto entregue no MÊS (`integracaoCtrl.getProdutosFinalizados`,
  e por ele o RPCMTec), então a carta editada no dia 1º entrava no relatório do mês anterior, e
  ninguém confere um relatório contra a data de cada folha. O `.iso()` anda JUNTO do `.raw()`: sem
  ele a string seguiria crua para o Postgres, e '01/08/2026' seria lido como 8 de JANEIRO, porque o
  DateStyle padrão é MDY. Mesma solução de `projeto_schema.js` e de `mapoteca.pedido`. É o padrão da
  casa para dia de calendário, e vale para `produto_schema.js` e `arquivo_schema.js`.

- **Modal empilhado: só o do TOPO responde ao Escape e ao Tab.** A ficha do produto abre "Nova versão"
  e "Editar" por cima de si mesma, e o editor de geometria abre por cima do formulário. Cada modal
  registrava o próprio `keydown` no `document`, e um único Escape fechava TODOS (medido em 2026-08-01,
  com dois modais abertos). O `stopPropagation` que estava lá não resolve: ele barra a propagação para
  outros elementos, e não os demais ouvintes do MESMO elemento — e nem `stopImmediatePropagation`
  bastaria, porque em captura os ouvintes do `document` rodam na ordem de registro e quem responderia
  primeiro seria o modal de BAIXO. Hoje `modal-base.js` mantém uma pilha, e a saída dela é por
  identidade, e não `pop()`: fechar pelo botão um modal que não é o do topo é possível.

### Plugin da mapoteca

- **O plugin é um cliente do MÓDULO mapoteca, e nenhuma rota dele é do acervo.** A permissão segue o módulo do TRABALHO, e não o do dado: quem imprime tem operador na mapoteca e pode não ter perfil nenhum no acervo. O par prepare/confirm do download fechava em `POST /api/acervo/confirm-download`, que é `verifyPerfil('consulta')` sem módulo — ou seja, consulta no ACERVO. Esse usuário chegava ao fim de um download bem-sucedido e levava 403: os PDFs ficavam na pasta, os tokens ficavam `pending` e `acervo.cleanup_expired_downloads()` os marcava como `failed` 24h depois, então o histórico registrava falha em toda impressão que dera certo. Hoje é `POST /api/mapoteca/impressao/confirmar_download`, com `verifyPerfil('operador','mapoteca')` e **o mesmo `acervoCtrl.confirmDownload`**: `acervo.download` é uma tabela só, e duas implementações de "confirmar download" divergiriam na primeira coluna nova. O teste guarda o 403 da rota gêmea de propósito — o `test_user` da semente tem perfil nos dois módulos, e por isso o caso real nunca aparecia.
- **A tela lê a FILA (`/pedido/em_aberto`), e não a lista de pedidos.** `GET /api/mapoteca/pedido` passou a filtrar pelo ano de contexto do módulo (o `ano` da query cai no ano corrente quando não vem), e o plugin não tem seletor de ano: pelo caminho antigo, o pedido de dezembro ainda aberto em janeiro sumia da tela sem aviso nenhum. Junto saiu a constante `SITUACOES_INATIVAS = {5, 6}` que vivia em Python: a régua do que é trabalho de quem imprime é `SITUACOES_EM_ABERTO` em `query_fragments.js`, e a cópia já estava dois commits atrás (mostrava Remetido e Aguardando produção, tirados da fila em 2026-07-31 e 2026-07-30).
- **O item AVULSO não é "item sem PDF", e a resposta do prepare diz qual é qual.** Os dois chegam em `itens_sem_pdf`, e o operador os trata de formas opostas: o avulso (papel quadriculado, carta de outro CGEO) nunca terá arquivo no acervo e se imprime do original; o item do acervo sem PDF é uma falta de verdade, que alguém tem de carregar. Anunciados com a mesma frase, mandavam procurar o que não existe. Por isso `item_avulso` e `avulso_descricao` saem no `map()` de `prepareDownloadImpressao`, e o manifesto CSV lista o pedido INTEIRO, e não só o que veio por download — um manifesto que só mostra o baixado esconde justamente as linhas que exigem atenção.
- **`core/api_client.py` é gêmeo do arquivo de mesmo nome em `ferramentas_acervo/`, com duas diferenças deliberadas:** o default de `pode()` é `mapoteca`, e aqui não existe o cache de `core/dominios.py`, cujas rotas são todas do acervo (`gerencia/dominio/*`, `projetos/*`, `volumes/*`) e voltariam 403 para este usuário. Correção de comportamento (thread da mensagem de erro, re-login, timeout) vale para os dois — o guarda de thread do `show_error` já esteve só num deles.

### Dependências e ambiente de teste

- **Pacote ESM puro entra no servidor por `require()`, e no Jest por dublê mapeado.** O servidor é CommonJS, e `serialize-error` (usado por `utils/app_error.js`, ou seja, por quase tudo) é ESM puro desde a versão 9. Ele era carregado por `import()` dinâmico, e isso **impedia a suíte inteira do servidor de rodar**: dentro do contexto de VM do Jest o `import()` exige `NODE_OPTIONS=--experimental-vm-modules`, e com essa flag o Jest 30 no Node 24 quebra antes, em `ERR_VM_MODULE_NOT_MODULE`. Hoje `utils/serialize_error_loader.js` tenta `require()` primeiro (o Node aceita `require()` de ESM sem flag desde a 22.12) e só cai no `import()` se der `ERR_REQUIRE_ESM`. No Jest, `moduleNameMapper` aponta para um dublê CJS em `__tests__/helpers/`. **Não devolva a flag aos scripts de teste**: ela é a causa, não a cura. Ao acrescentar dependência ESM pura, siga este par.
- **A suíte do servidor tem DOIS pacotes, e um banco POR WORKER do Jest.** Até 2026-08-01 era `jest --runInBand`: 366 segundos para qualquer mudança, porque os 28 arquivos que usam PostgreSQL compartilhavam um `sca_test` só e o `cleanTestData()` faz TRUNCATE nas tabelas inteiras — dois workers em paralelo apagariam os dados um do outro, com falha intermitente em arquivo que ninguém tocou. Hoje o `globalSetup` monta um banco-TEMPLATE e clona `sca_test_1..N` dele (`CREATE DATABASE ... TEMPLATE` é cópia de arquivo; rodar os `er/*.sql` N vezes sairia mais caro que serializar), e `worker_db.js` escolhe o banco de cada worker por `JEST_WORKER_ID`, antes de qualquer `require` do config. Resultado: `test:rapido` 3s, `test:banco` 181s. **Quem entra em qual pacote sai de LER O FONTE** (`require` de `helpers/db` ou de `helpers/app`), e não de uma lista: lista seria cópia. São os DOIS sinais porque o `getApp()` de `helpers/app` também chama `db.createConn()` — `routes/auth.test.js` usa só o segundo, e com um sinal só ele caiu no pacote rápido e derrubou o worker em vez de falhar com asserção. O piso hoje é o `routes/mapoteca.test.js`, que sozinho leva 179s.
- **Teste de schema prova o MOTIVO da recusa, nunca só que houve recusa.** `expect(error).toBeDefined()` passa quando o fixture quebra por outro campo, então a regra do título deixa de ser guardada sem ninguém notar: medido no schema de arquivo em 2026-08-01, onde o caso do tileserver passava igual com o `nome` quebrado. O helper é `__tests__/helpers/joi.js` (`recusaPor(resultado, campo, tipo)` / `aceita(resultado)`), e ele confere `error.details[0]`, que com o `abortEarly` do Joi é o PRIMEIRO erro — é isso que separa "recusou pela regra" de "recusou por acidente". Na conversão, 177 casos viraram 116, e o reforço achou três coisas que ninguém sabia: `arquivos_ids: []` é recusado por `array.includesRequiredUnknowns` e não pelo `.min(1)` que está no schema; `versaoRelacionamento` usa a outra construção e dá `array.min`; e a UNIQUE da NC responde 409, não 400.
- **O que é mockado NÃO se testa de novo contra o banco.** O módulo orçamento roda contra `helpers/orcamento/mockDb`, e isso prova o mapeamento de parâmetro (`nota_empenho_id` → `notaEmpenhoId`, bug real com o `$<param>` do pg-promise) e nada sobre a consulta: `expect.stringContaining('INSERT INTO orcamento.rpnp')` passa com o SQL inteiro quebrado. Até 2026-08-01 nenhum SQL do módulo era executado em teste nenhum. O `integration/orcamento.test.js` fecha a lacuna cobrindo **só o que exige banco de verdade**: as regras que vivem dentro de `db.conn.tx` com agregação lida do banco (o teto da liquidação, a soma das alocações da NE), a tradução de UNIQUE e FK do PostgreSQL para status legível, e o encadeamento NC → NE → liquidação. Validação Joi e 404 de id inexistente continuam no pacote mockado, que roda em milissegundos: repetir ali só deixaria a suíte lenta.
- **O rate limit é desligado sob `NODE_ENV=test`.** São 200 requisições por minuto, e a suíte passa disso no meio do arquivo de rotas da mapoteca. O efeito ruim não era falhar, era fazer falhar um teste **que não mudou**, só porque um teste novo entrou antes dele no mesmo minuto: a suíte passava a depender de ordem e de relógio.
- **`archiver` fica na 7, e os `overrides` do `server/package.json` são o que zera a auditoria.** NUNCA rode `npm audit fix --force` aqui. Ele sobe o `archiver` para 8, que é **ESM puro e não exporta mais função chamável**: as classes `Archiver`/`ZipArchive` substituíram `archiver('zip', ...)`, e as duas exportações em ZIP quebram no boot. Medido em 2026-07-27. As 7 vulnerabilidades da subárvore vinham todas de `brace-expansion`, então os `overrides` corrigem a raiz sem tocar na API. O `readdir-glob` precisa de override próprio (`minimatch` ^10.2.5) porque o `minimatch` 5 faz `require('brace-expansion')` esperando a função direta, e a versão 5 exporta `{ expand }` nomeado: sem esse segundo override, o `npm audit` diz "0 vulnerabilities" com o `archive.glob()` quebrado. Quem cobre isso é `acervo_zip_ctrl.test.js`, que abre o ZIP e descomprime, em vez de conferir o tipo do retorno.

## Regras de negócio

### Mapoteca, consumo de material

- **Consumo** só pode sair da **Seção** (`tipo_localizacao` code=1). Material tem que ser transferido para a Seção antes de ser consumido, e o trigger recusa consumo sem saldo lá. Localizações: 1=Seção, 2=Almoxarifado, 3=Aquisição realizada, 4=Saldo no empenho.
- **`tipo_material.categoria_id` é COLUNA, e é o que separa as tabelas 7.2 (Papel) e 7.3 (Tintas) do RPCMTec.** Derivar do nome ("começa com Cartucho") acerta o catálogo de hoje e cai calado no primeiro "Tinta preta 300ml": o material vai para a tabela errada, sem erro nenhum, e o relatório que o chefe assina mente sem avisar. O default é `3` (Outro), e não Papel: material sem categoria escolhida fica FORA das duas tabelas, e faltar de uma tabela é visível, ao contrário de aparecer na errada. Cabeçote é Outro de propósito (é peça de reposição, não insumo de impressão).
- **O estoque guarda só o saldo de HOJE, sem histórico mensal.** Por isso as colunas "Estoque mês anterior" e "Previsão de falta de estoque" do RPCMTec saem `-`. Ele NÃO é derivável de estoque atual + consumo do mês: a conta ignora as entradas (compra, transferência do almoxarifado) e erraria em silêncio todo mês em que houve reposição. Fechar essa lacuna exige uma tabela de movimento ou de fotografia mensal; enquanto não existir, o `-` é a resposta honesta.
- **Escala de item de pedido nunca sai NULA: o avulso é 'Sem escala'.** O `COALESCE` mora no fragmento `ESCALA_DISPLAY_ITEM`, e não em cada consulta. O item avulso não aponta produto do acervo, então `prod.tipo_escala_id` é nulo, e a tela mostrava a palavra "null" — foi assim que apareceu uma fatia chamada `null` no gráfico do dashboard. Deixar a regra no chamador foi o que permitiu quatro consultas acertarem e uma esquecer.

### Orçamento

- **Não existe entidade "exercício", "PCA" nem cabeçalho de "PDR".** Tudo se amarra ao **ano** (coluna `ano SMALLINT`, sem FK). O PCA do ano é o conjunto de DFDs daquele ano; o PDR é o conjunto dos `pdr_item` do ano.
- A **NE empenha contra uma NC obrigatória** e herda dela ND, PI e GND. A **licitação** não tem vínculo com DFD.
- A **NC** tem o par `(ano, numero, cod_nd)` único por UG emitente, e `valor_recolhido` é informativo (não altera `valor_nc`).
- `orcamento.configuracao` é **singleton** (`CHECK (id = 1)`): o backend só faz `UPDATE`, a linha nasce no DDL.

## Padrões que todo código novo segue

### Feature do servidor: 4 arquivos

```
feature/
├── index.js              # re-exporta a rota
├── feature_ctrl.js       # logica e SQL, sem req/res
├── feature_route.js      # rotas, middlewares, asyncHandler
└── feature_schema.js     # Joi
```

Montada em `routes.js`. As do orçamento vivem em `server/src/orcamento/` e entram sob `/api/orcamento/`.

### Rota

```javascript
router.post(
  '/endpoint',
  verifyPerfil('operador', 'orcamento'),  // SEMPRE com o modulo explicito fora do acervo
  schemaValidation({ body: schema }),
  asyncHandler(async (req, res, next) => {
    const result = await ctrl.someMethod(req.body)
    return res.sendJsonAndLog(true, 'Message', httpCode.OK, result)
  })
)
```

### Envelope, erros e constantes

- Toda resposta sai por `res.sendJsonAndLog()`: `{ version, success, message, dados, error }`. 500 vira sempre a mensagem genérica.
- `AppError(message, statusCode, errorTrace)` mais `asyncHandler` (catch para o `next`) mais o middleware final. Falha de boot cai em `errorHandler.critical()` e mata o processo.
- `server/src/utils/domain_constants.js` centraliza o valor de código de toda tabela de domínio. Use as constantes, nunca número mágico em SQL.

### Página nova no client

O contrato está em `client/src/js/modules/registry.js`, e é ele que manda. Um manifesto por módulo
declara menu, rotas e o perfil mínimo de cada uma; o roteador não se toca. Perfil de rota no client é
**só ergonomia**: quem barra escrita é o `verifyPerfil` no servidor.

## Convenções de código

- Servidor: CommonJS, `'use strict'`, SQL parametrizado com parâmetro nomeado do pg-promise (`$<param>`), `db.conn.task()` ou `db.conn.tx()`.
- Client: Vanilla JS com módulos ES, sem framework e sem TypeScript. `el()` de `utils/dom.js` para DOM, BEM no CSS, tokens de design em `design-tokens.css`, tema por `[data-theme]`.
- Plugin: Python 3 com PyQt6, uma pasta por diálogo em `gui/`, chamadas por `self.api_client`.
- CLI: dependência ZERO e contrato lido do **Joi vivo** em tempo de execução. Nunca copie contrato para dentro do CLI.
- **Toda string de interface e mensagem de erro em português do Brasil.** Coluna de banco em `snake_case` sem acento. Variável JS em `camelCase`, Python em `snake_case`.
- Sem em-dash em nada. Acentuação correta em português, nunca dentro de código, URL ou identificador.
- Data absoluta (2026-07-27), nunca "ontem".

## O que não fazer

- Não introduza ORM, TypeScript no servidor, framework de front, Docker ou biblioteca de UI sem registrar a decisão e o motivo.
- Não recrie a SPA React da mapoteca, que foi removida de propósito.
- Não recrie clients separados por módulo: `acervo_client` e `mapoteca_client` foram apagados em 2026-07-27, e a interface é uma só.
- Não guarde senha em claro, nem a devolva por rota nenhuma. O SCA guarda o **hash bcrypt** em
  `dgeo.usuario.senha` desde 2026-08-02, e o único lugar que gera e confere hash é
  `login/senha.js`. (Esta linha dizia "não armazene senha: a verificação é sempre delegada ao Auth
  Server" e valia até a fusão.)
- Não invente campo de domínio que não está no DDL nem no schema Joi. Marque como pendência.
- Não escreva em `er/` para atualizar banco existente: `er/` é instalação nova, o caminho de atualização é `migrations/`.
