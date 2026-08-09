# Decisões de design deliberadas

Cada uma destas **parece defeito e não é**. Não "conserte" nenhuma sem falar com o chefe.

Forma de toda entrada: a decisão em negrito, e o que custou a alternativa. Este arquivo guarda a
decisão VIGENTE, nunca o caminho até ela: ao mudar uma decisão, reescreva o texto. O resumo de uma
linha está no [`CLAUDE.md`](../CLAUDE.md); o detalhe de um trecho, no comentário do próprio arquivo.

## Autenticação e identidade

- **O SCA é o dono da identidade: guarda o hash bcrypt em `dgeo.usuario.senha` e valida o login
  sozinho.** Não há serviço externo a subir junto, e "trocar a minha senha" é tela que ele pode ter.
- **`dgeo.login.cliente` é VARCHAR, e não FK; `dgeo.login.usuario_id` é ANULÁVEL.** A lista fechada
  (`sca_web`, `sca_qgis`) vive no Joi de `login/login_schema.js`, e domínio seria administrar um
  catálogo de duas linhas. Sem o anulável, a contagem de acessos do mês mudaria ao demitir alguém.
- **`dgeo.usuario.senha` é ANULÁVEL nos DOIS caminhos (`er/` e migração), e não há `SET NOT NULL`
  final.** Nulo é "cadastrada e ainda sem senha local", e o login responde isso em vez de "senha
  inválida", porque a causa é administrativa. Travar a coluna só num dos caminhos faria instalação
  nova e atualização divergirem, que é o que `migrations/ensaiar_migracao.cjs` existe para impedir.
- **Há UM caminho de conferência de senha e UM de geração de hash** (`login/senha.js`). Dois lugares
  escolhendo o custo divergiriam no primeiro ajuste, e o hash mais fraco seria o que ninguém olharia.
- **Excluir usuário quase sempre falha, e está certo:** o `uuid` é referenciado por dezenas de
  tabelas, e apagar reescreveria a autoria do que a pessoa cadastrou. Quem já trabalhou se
  **desativa**, e o `23503` vira frase que diz isso.
- **O reset administrativo de senha vale para ADMINISTRADOR também.** Ele é global e único, e recusar
  bloquearia a conta sem outro caminho de recuperação.
- **A política de senha é PARIDADE (qualquer coisa não vazia).** Um piso mais alto recusaria a senha
  que muita gente já usa; o lugar de subir é o `senha` de `usuario_schema.js`, que serve às três rotas.
- **No `PUT /usuarios/:uuid` os campos de identidade são OPCIONAIS, e omitir vale "não mexe".** Os
  botões de alternar chamam a rota só com `administrador` e `ativo`, e um `.default()` no Joi apagaria
  o nome de quem só foi ativado.

## Autorização e superfície pública

- **PRODUÇÃO e EFETIVO viraram módulos na 1.33.0** (`dominio.modulo` 4 e 5), na palavra do chefe: "Em
  Gestão temos controle só de acervo, mapoteca, orçamentário, está faltando de produção e efetivo.
  Acredito que o operador para Produção seja execução do pit, extra-pit e capacitação ministrada. E o
  Operador para efetivo seja aproveitamento e capacitação recebida."
  **O problema era medido**: a execução do PIT, o Extra-PIT, a capacitação e o aproveitamento eram
  TODOS `verifyAdmin`, porque não existia módulo para eles. Em 2026-08-06, das 28 contas ativas 7
  conseguiam fazer alguma coisa, e 5 dessas 7 carregavam a flag global. Não era descuido de quem
  concedeu: não havia como dar menos. A mesma flag que libera lançar um mês do PIT libera o orçamento
  inteiro e o cadastro de usuários.
  **O que NÃO entrou, e continua `verifyAdmin`**: a META e a REVISÃO do PIT (alterar o PIT é ato da
  DSG, e o que está no sistema é transcrição de documento assinado), a EDIÇÃO do RPCMTec (o relatório
  que o chefe assina), o cadastro de usuários e o orçamento. Também ficaram de
  fora `POST` e `DELETE /metas/extra/:id/versoes`: elas gravam em `acervo.versao`, e quem manda no
  acervo é o módulo acervo.
  **A leitura do efetivo se partiu em dois níveis**, e essa partição durou dois dias: até 2026-08-08
  era operador no cadastro e GERENTE no mapa anual e no resumo mensal. A régua dos três níveis a
  substituiu, e hoje a LEITURA inteira do efetivo é de `consulta` e a ESCRITA do dado alheio é de
  `gerente`. O que ficou daquela ideia foi o princípio: o quadro que agrega a Divisão não é do mesmo
  nível que o lançamento de uma linha.
  O código do módulo é fixo nos DOIS lados (`dominio.modulo` e o mapa `MODULO` de
  `verify_perfil.js`), e um teste compara os dois lendo o DDL: um módulo novo só num deles faria toda
  concessão cair em "Módulo desconhecido", ou a consulta procurar um `modulo_id` que a FK recusa.
- **Ter conta e ter acesso são dois momentos, e o intervalo entre eles é uma TELA.** A conta que o
  administrador acaba de criar nasce sem nenhuma linha em `dgeo.usuario_perfil`: a senha funciona, o
  login responde, e não há nada lá dentro que seja dela. Até 2026-08-07 essa pessoa entrava e caía em
  `#/unauthorized`, com "403 Acesso negado" e um botão **Sair** -- a tela dizia a quem tinha acabado
  de receber uma conta que ela não tinha conta nenhuma. Agora a raiz dela é `#/perfil`: ela corrige o
  próprio cadastro, troca a própria senha e lê, na seção **Meus acessos**, que ainda não tem acesso a
  módulo nenhum e que o acesso se pede ao ADMINISTRADOR -- e não a um gerente, porque quem concede
  perfil é `verifyAdmin` em `/api/usuarios`, e mandar pedir a quem não pode dar faria a pessoa
  percorrer o caminho errado antes de chegar ao certo. É a única tela do sistema que nunca depende de
  perfil (`authLoader`), e é de propósito: sem ela, trocar de senha seria privilégio de quem já tem
  acesso.
  **Do lado do servidor isso virou a guarda `verifyAcesso`** (administrador global OU qualquer perfil
  em qualquer módulo, lido do BANCO a cada requisição), e as leituras do PIT e do Extra-PIT saíram de
  `verifyLogin` para ela. Eram o que a conta sem concessão alcançava: o plano de trabalho da Divisão
  inteira, no primeiro segundo de vida da conta. `verifyLogin` continua onde tem de continuar -- o
  próprio cadastro (`/usuarios/perfil`) e a própria senha --, porque são justamente as rotas que essa
  pessoa precisa alcançar, e trancá-las a deixaria do lado de fora da própria conta.
  **O menu acompanha**: a seção Produção era a única coisa desenhada na sidebar de quem não tinha
  perfil, e passou a exigir `temAlgumAcesso()`. Oferecer no menu uma tela que responde 403 é o mesmo
  desencontro que `podeAbrirRota` existe para evitar do lado dos módulos.
- **A régua dos três perfis é uma FRASE, e ela vale no sistema inteiro:** `consulta` LÊ as telas do
  módulo, `operador` LANÇA, `gerente` responde pela área e vê tudo dela. Rota nova escolhe o piso por
  ela, e não por costume, senão cada tela nasceria com a permissão de quem a escreveu naquele dia.
  **A lista NÃO hierárquica (`perfis: ['consulta','gerente']`) é a primeira exceção, e é
  deliberada:** ela descreve tela que o OPERADOR não vê embora esteja acima da consulta, e por isso
  se lê com `ehDeAlgumPerfil`, nunca com `temPerfil`. São dois casos, e cada um tem sua razão
  escrita ao lado: a mapoteca separa quem ATENDE pedido de quem lê o acervo dela, e
  `#/aproveitamento` deixa o operador de fora porque ele cuida só do PRÓPRIO aproveitamento, que está
  em `#/perfil`. **A segunda exceção é `#/acervo/administracao`**, que é do ADMINISTRADOR e é a única
  tela que o gerente da área não alcança: o chefe separou trabalhar no acervo de administrar o
  acervo.
- **`/api/integracao/*` não tem autenticação.** Somente leitura, para o vault da DGEO consumir o SCA
  sem credencial; expõe cobertura, produtos concluídos no mês e o agregado da mapoteca, sem endereço,
  contato nem observação de impressão.
- **`GET /api/mapoteca/pedido/localizador/:localizador` não tem autenticação.** É o acompanhamento
  pelo próprio cliente, que não tem conta. Já foi fechada por engano numa classificação automática.
- **`/logs` não tem autenticação, e o CORS aceita qualquer origem.** O sistema roda em rede interna.
- **Credencial de banco na URI de camada do QGIS.** O plugin conecta direto no PostgreSQL; é para isso
  que existe o papel somente leitura (`DB_USER_READONLY`).
- **A LEITURA do RPCMTec usa `verifyGerente`, e `#/rastreabilidade` usa `verifyRastreabilidade`.**
  (O `verifyGerente` era da grade do PIT, que em 2026-08-08 desceu para
  `verifyPerfil('consulta', 'pit')`, porque tem módulo próprio; ele foi REAPROVEITADO no
  RPCMTec, e não recriado.) Não é
  `verifyPerfil`, que lê um módulo por vez e estas telas não são de módulo nenhum; nem `verifyLogin`,
  que lê o `administrador` do TOKEN, envelhecido até o `JWT_EXPIRACAO`. O recorte é do SERVIDOR: no
  cliente seria sugestão.
- **O rate limit é dimensionado para CLIENTE DE LOTE, não para navegador.** Um teto de tela partiria
  ao meio uma carga do `acervo_cli` com 429, deixando parte das versões migradas e parte não.

## O SCA absorve o não-produção do SAP

- **A fusão é por ADIÇÃO aqui, e não por remoção lá** (chefe). Na transição há duas cópias vivas de
  cada fato, e o banco não as reconcilia: a divergência é possível e esperada.
- **O critério para trazer uma subseção é não depender de `macrocontrole`, e não "está no SAP".** O
  critério continua valendo; o que estava errado era o TAMANHO que se supunha do acoplamento de
  `controle_campo`. **A 2.5 (atividades de campo) VEIO em 2026-08-08**, e a frase que morava aqui
  ("ela não veio porque `controle_campo` referencia `macrocontrole.produto`") foi MEDIDA no mesmo
  dia: o que aponta `macrocontrole` é UMA tabela de junção e UMA rota de apoio, e o núcleo (`campo`,
  `imagem`, `track`, `track_p`) não o toca em lugar nenhum. Cortada a junção, o resto atravessa.
  A régua não é "veio do SAP", é "o SCA sabe provar". A **2.3 (lote) continua digitada** pela mesma
  régua, e por isso: o lote de produção vive em `macrocontrole` e não tem entidade aqui.
- **A 2.1 sai INTEIRA do SCA, inclusive as metas de produção.** Meia tabela de cada sistema obrigaria
  quem a cola a descobrir todo mês quais linhas vêm de onde.
- **Os códigos dos domínios novos e as grades de coluna do DOCX são os do SAP.** A linha migrada não
  precisa de tabela de tradução, e divergir na grade faria a mesma subseção sair de dois tamanhos.
- **`pit.demanda_extra` não tem `lote_id`, ao contrário do SAP.** Lá ele evita a 2.1 contar duas
  vezes; aqui não há o que descontar, e apontar `acervo.lote` inventaria um vínculo que não existe.

## O SCA abre espaço para o core do SAP

- **O módulo 4 devolveu o nome "Produção" em 2026-08-09** (chefe). Ele passou a se chamar `PIT` /
  `pit`. O code NÃO mudou, então nenhuma concessão de `dgeo.usuario_perfil` foi tocada e ninguém
  perdeu acesso. O que forçou a troca é o core de produção do SAP (`macrocontrole`, 45 tabelas), que
  vai entrar num módulo, e esse módulo é que se chama Produção. O descompasso já existia e era
  visível: o menu diz "PIT" desde que a seção nasceu, e o `nome_abrev` dizia outra coisa.
  **`nome_abrev` é IDENTIFICADOR**, comparado por igualdade em `verifyPerfil`, no mapa `MODULO`, no
  `modulo` de cada subseção do RPCMTec, no `visivel` da sidebar e no `perfilLoader` do client: foram
  94 ocorrências de código em 22 arquivos, e o piso do banco subiu para 1.50.0 porque um servidor
  velho contra este banco recusa toda concessão do módulo 4 sem erro nenhum na tela.
- **`pit.exercicio` virou `pit.pit` no mesmo dia** (chefe). O PIT é o documento do ANO: `pit.pit` é a
  linha do documento, e `pit.meta` é o que ele promete. **O homônimo do SAP é real e foi aceito
  antes da troca**: lá, `macrocontrole.pit` é a META, e corresponde ao `pit.meta` daqui. Quando o
  core atravessar, duas tabelas chamadas `pit` vão existir no mesmo banco querendo dizer coisas
  diferentes.
- **A entidade de auditoria NÃO acompanhou a tabela, e continua `exercicio`.** `auditoria.evento`
  guarda `entidade` como TEXTO, e a trilha é append-only. Medido no dump de produção de 2026-08-08:
  15 eventos com `exercicio`, e ZERO com o módulo `producao` (o `pit` sempre foi auditado sob
  `plataforma`). Renomear a entidade os deixaria órfãos de ficha, e reescrevê-los seria a aplicação
  corrigindo a própria prova. A chave do mapa é `schema.tabela` e a entidade é o AGREGADO: as duas
  divergirem já era normal (`campo.campo_militar` tem entidade `campo`).
- **O corpo do `INSERT` de `dominio.modulo` não aceita prosa.**
  `__tests__/routes/orcamento/verify_perfil.test.js` lê aquele bloco do DDL com um `[\s\S]*?;` não
  guloso, para provar que o mapa `MODULO` do código espelha o banco. Um ponto e vírgula dentro de um
  comentário ali corta a captura no meio, e o teste passa a ver três módulos em vez de seis. Custou
  uma suíte vermelha em 2026-08-09, e o comentário do code 4 mora ACIMA do `INSERT` por isso.
- **O que a análise da fusão mediu, e que ainda não foi resolvido** (2026-08-09). `dominio.tipo_produto`
  existe nos dois sistemas com os mesmos códigos e significados diferentes: o do SAP é, código a
  código, o `subtipo_produto` do SCA. O código 9 é 'Modelo 3D' aqui e 'Fototriangulação' lá; o 13 é
  'Levantamento topográfico' aqui e 'Carta Temática' lá. Quem juntar por código reclassifica o
  acervo inteiro sem erro nenhum. **O chefe decidiu em 2026-08-09 que o SAP é que se adapta ao SCA**,
  e não o contrário: tipo de produto, produto e usuário mudam lá.

## Campo

- **O schema `campo` NÃO é um módulo, e `dominio.modulo` continua com seis linhas** (chefe,
  2026-08-08). A tela mora na seção PIT e cobra `verifyPerfil(nível, 'pit')`: campo é o trabalho
  que o PIT promete, e não uma área própria a conceder. Um módulo novo obrigaria a conceder perfil de
  novo a quem já responde pela Produção, só para ver o que ela prometeu.
- **`campo.ano` REFERENCIA `pit.exercicio`, e isso contraria o precedente ao lado** (chefe,
  2026-08-08). `rpcmtec.capacitacao.ano` é um SMALLINT solto, e o comentário dela diz por quê:
  capacitação tem 2013, 2018, 2019 e mais, e o PIT só tem 2025 e 2026. Campo está no mesmo caso de
  fato (os 54 do dump vão de 2013 a 2026) e a saída escolhida foi a OPOSTA: a CARGA cria os dez
  exercícios que faltam, Encerrados e vazios, para que o ano do campo seja o ano do plano de verdade.
  Quem os cria é `scripts/carregar_campo_sap.py`, e não a migração: um banco que nunca vai receber
  dado do SAP não ganha dez exercícios inventados.
- **`campo.geom` é NOT NULL** (chefe, 2026-08-08). Os 7 campos sem polígono do dump são TODOS os voos
  de drone de 2026 -- prática de hoje, e não dado velho mal preenchido. A carga NÃO inventa um ponto
  no meio do município: ela para e cobra o desenho, que é o que faz a coluna valer alguma coisa.
  `--sem-geometria pular` deixa esses campos de fora em vez de bloquear o resto, nomeados no
  relatório e no cabeçalho do SQL; nenhum dos dois caminhos inventa geometria.
- **A área entra por ARQUIVO GeoJSON, e o desenho no mapa foi REMOVIDO** (chefe, 2026-08-09). A tela
  tinha um editor sobre o MapLibre, com o gesto compartilhado de `components/mapa/desenho-area.js`. A
  razão da troca é o dado: a área de um campo não nasce na tela -- ela vem do plano de voo do drone,
  do polígono da folha ou do KML da operação, coisas que já existem em arquivo antes de alguém abrir
  o SCA. Redesenhar a mão o que já está desenhado é transcrever, e transcrição erra.
- **UM polígono só, e foi MEDIDO antes de decidido** (chefe, 2026-08-09). Dos 47 polígonos do dump de
  produção do SAP, os 47 têm UMA parte (`ST_NumGeometries` = 1) e nenhum tem buraco: o MultiPolygon
  de várias partes era defesa contra um caso que não existe, e defesa contra caso inexistente custa
  caro na entrada -- um GeoJSON com duas partes por engano entraria calado, e a área do campo passaria
  a ser outra. **A COLUNA CONTINUA MULTIPOLYGON**, e o estreitamento é na PORTA (`campo_schema.js` e
  `pages/campo/campo-geojson.js`): trocar o tipo da coluna custaria uma migração de estrutura para
  ganhar nada, e a coluna aceitar mais do que a porta deixa entrar não é incoerência. Buraco continua
  permitido: um polígono com ilha interna ainda é UM polígono, e o corte é sobre partes, não anéis.
- **`campo_versao` aponta `acervo.versao` (a EDIÇÃO), e é OPCIONAL** (chefe, 2026-08-08). Não aponta
  `acervo.produto`: o que o campo alimenta é uma edição específica, e a mesma folha reambulada duas
  vezes são duas versões e um produto só. A ausência é o caso comum -- viagem internacional, exercício
  e apoio a outra OM não geram produto a apontar, e no dump 3 campos de 54 tinham vínculo.
- **`militares_externos` é TEXTO ao lado da junção `campo_militar`, e não é preguiça.** Dos 145 nomes
  distintos do dump, 37 casam com `dgeo.usuario` por posto mais nome de guerra e 59 casam só pelo nome
  de guerra: o texto do SAP guardava a patente DA ÉPOCA ("ST Ferraz" hoje era "1º Sgt Ferraz" antes).
  Sem a coluna de texto, o efetivo dos campos antigos se perderia em silêncio.
- **Os códigos de `campo.situacao` são os do SAP; os de `campo.categoria` são NOVOS.** É a única
  divergência de código desta travessia, e a razão é que no SAP a categoria era um `ENUM` do Postgres
  (`controle_campo.categoria_campo`), que não tem número a herdar. A ordem é a da declaração do ENUM.
- **`campo.track_linha` é VIEW COMUM, e não materializada como no SAP.** Materializar obrigaria
  alguém a lembrar de atualizar depois de cada importação de GPX, e linha velha mente sem avisar. O
  custo real é pequeno: são 76 trajetos, e a tela pede o de UM campo por vez.
- **O que NÃO atravessou, e por quê.** `orgao` era '1º CGEO' em 54 linhas de 54, uma coluna que só
  sabia repetir de quem é o banco. `track_p.x_ll` e `y_ll` eram a longitude e a latitude do MESMO
  ponto que `geom` já guarda, e duas cópias de uma coordenada não têm como as duas estarem certas
  depois da primeira correção.
- **A FICHA É SÓ LEITURA, e tudo o que escreve mora em "Editar"** (chefe, 2026-08-09). Até essa data
  a ficha tinha botão de enviar e de remover foto e trajeto, e a pessoa mudava o cadastro sem nunca
  ter dito que ia editar -- a foto apagada por engano ali não tinha de onde voltar. O único botão da
  ficha que leva a escrever é "Editar", e ele FECHA a ficha antes de abrir o formulário: dois modais
  empilhados esconderiam qual dos dois está gravando.
  **As abas de foto e de trajeto do formulário GRAVAM NA HORA**, e o botão "Salvar" não as inclui:
  enviar uma foto é um POST próprio. Fechar sem salvar não desfaz o que já subiu, e o texto da aba
  diz isso. Elas só existem na EDIÇÃO, e não é limitação de tela: `campo.imagem` e `campo.track`
  referenciam `campo_id`, então não há a que pendurar o arquivo antes de o campo ter id.
- **A régua da tela, na frase do chefe (2026-08-09):** o OPERADOR cadastra e edita campos, e "editar"
  inclui acrescentar e remover foto, vídeo e trajeto; o VISUALIZADOR só vê; o GERENTE e o
  ADMINISTRADOR fazem tudo, e o "tudo" a mais é APAGAR o campo.
- **A exclusão do campo é de GERENTE, e a da foto é de operador.** Não é a escrita que pesa, é o
  alcance: o `ON DELETE CASCADE` leva as categorias, os militares, as versões, as fotos, os vídeos,
  os trajetos e os pontos de GPS, e apagar um campo de 2019 destrói as únicas cópias daquelas fotos.
  Quem subiu o arquivo errado há um minuto tem de poder tirá-lo, e o alcance ali é uma linha.
- **O SRID é 4674, e não o 4326 do SAP.** Todo o SCA guarda em SIRGAS2000; a diferença entre os dois
  é subcentimétrica, mas sem a conversão o cruzamento com `limites.municipio` -- que é de onde sai a
  coluna "Local" da 2.5 -- pediria um `ST_Transform` em toda consulta.
- **Até 283 MB entram no banco quando a carga rodar**: 179 MB de foto e vídeo e 97 MB de ponto de
  GPS, em `bytea`, que é o que `orcamento`, `mapoteca`, `pit` e `rpcmtec` já fazem com anexo. O que
  não tem precedente aqui é o TAMANHO, e é por isso que `express.json` subiu de 50mb para 60mb: o
  maior vídeo tem 37 MB, e base64 cresce o binário em um terço. **O teto do Joi
  (`campo_schema.MAX_BASE64`) tem de caber no do Express**: com o do Express menor, o corpo grande
  morre com um 413 do body parser e o Joi nunca roda.

## PIT e Extra-PIT

- **`pit.meta` guarda em COLUNAS o que o PIT promete, e elas nascem NULAS.** Separar o texto legado de
  `descricao` por expressão regular erra calado onde há ponto na escala e separador de milhar, e
  quantidade errada vira porcentagem errada no relatório que o chefe assina.
- **Não existe coluna de "nome da meta":** a linha de cabeçalho (`item` nulo) já é esse nome.
- **A NUMERAÇÃO da meta não é estável entre anos, e por isso o que se guarda é o `id`.** O PIT é
  reescrito todo ano e a meta 4 de 2026 não é a meta 4 de 2025; quem apontar para o código teria um
  vínculo que muda de significado sozinho na virada do ano, sem uma linha de código ter mudado.
- **Só a meta-FOLHA recebe lançamento.** Lançar no cabeçalho contaria o total duas vezes, e as duas
  contas continuariam "certas" cada uma por si.
- **O lançamento é MANUAL só no item de origem Manual**, e `pit.meta_item.origem_id` (1 Manual, 2
  Capacitação, 3 Produção, 4 Impressão) é quem diz de onde vem o número. Nas três origens calculadas o
  planejado e o realizado são CONTADOS na leitura, das entidades que cumprem o item, e a escrita à mão
  ali é recusada com 400. Havia aqui, até 2026-08-08, a frase "não há coluna de origem, porque não há
  o que calcular enquanto o SAP não entrar": ela descrevia o schema anterior à 1.30.0.
- **O planejado é COLUNA de `pit.execucao`, e não tabela irmã.** As duas abas da planilha da Divisão
  têm as mesmas linhas e os mesmos doze meses; duas tabelas repetiriam a chave (meta, mês) e deixariam
  a comparação, que é a razão de as duas existirem, a um JOIN de distância.
- **O planejamento é MENSAL, e a soma dos doze tem de bater com a quantidade do ano.** A tela acusa
  quando não bate; `quantidade_prevista` sozinha não diz em que mês a entrega foi prometida.
- **`pit.execucao.quantidade` não tem NOT NULL.** A linha nasce com o plano, então NULO é "ninguém
  lançou" e zero é "conferi e não houve"; com NOT NULL, planejar um mês gravaria um realizado zero e a
  2.1 afirmaria que se conferiu e não houve entrega. Um CHECK
  (`execucao_diz_alguma_coisa`) recusa a linha com os DOIS números nulos. **São DOIS termos, e foram
  quatro até a 1.44.0**, quando `data_conclusao` e `observacao` saíram: o CHECK encolheu junto com a
  tabela, no mesmo arquivo de migração.
- **O nome `execucao` ficou, embora a tabela guarde as duas coisas.** Renomear orfanaria o rastro:
  `auditoria.evento` guarda o nome da tabela em cada linha, e aquele schema não tem UPDATE nem DELETE.
- **A cor da grade é do ACUMULADO, nunca do mês sozinho.** A régua mensal não enxerga adiantamento, e
  pinta de vermelho o mês cujo prometido foi entregue antes. **Mês corrente e futuro não recebem cor**,
  e o `title` mostra as duas contas, senão célula verde com realizado zero se leria como erro. Salvar
  redesenha a LINHA e os doze meses dela, porque mexer em maio muda a cor de junho a dezembro;
  refazer a grade inteira destruía a célula onde o Tab tinha acabado de pôr o foco.
- **O `meta_id` vai como NÚMERO no corpo, e quem converte é o cliente.** O Joi desta rota é
  `.strict()`, porque a escrita também vem de CLI e de carga, e o BIGSERIAL chega como string no JSON.
- **Extra-PIT é a exceção AUTORIZADA, e `documento_autorizacao` é NOT NULL.** Derivar de
  `previsto_pit` traz uma ordem de grandeza a mais de linhas, porque o campo é FALSE por default.
- **Ficaram de fora, por falta de decisão do chefe:** `Situação` e `Pronto` da EXEC_PIT (vazias no
  arquivo); a importação do `pit.ods`, que exige decidir qual revisão vence; e o replanejamento, hoje
  só no rastro de auditoria.
- **A GRADE FOI PODADA em 2026-08-08 (1.44.0), e o critério é o do próprio parágrafo acima.**
  `data_conclusao` e `observacao` eram as ÚNICAS 2 colunas das 88 do schema `pit` nulas em 100% das
  linhas (0 de 109), com ZERO aparições em 144 eventos de auditoria e sem uma única mensagem de commit
  que as justificasse. Elas eram o mesmo erro que manteve `Situação` e `Pronto` de fora, cometido no
  mesmo mês e não pego na hora: campo inventado sem se saber o que ele guarda. **Um beco sem saída
  morreu junto:** a célula que só as tivesse não podia ser apagada pela tela, que só sabe mandar
  planejada e realizada, e a limpeza deixava a linha viva e invisível. **Se a meta de ato único voltar
  a fazer falta, ela volta com o caso na mão.**
- **As 19 células de `pit.execucao` em item de origem CALCULADA foram APAGADAS na mesma migração, e
  isso é dado morto, não schema.** Sete itens automáticos (1.3 com 6, 4.1 com 8, e 1.4, 1.8, 4.2, 4.3
  e 5.1 com uma cada) carregavam lançamento manual de 2026-08-03, anterior à troca de `origem_id`.
  Hoje ninguém as lê, porque a CTE `celula` escolhe o valor calculado; o custo era o dia em que um
  item voltasse a ser Manual, o que é um clique na tela de metas: os 19 lançamentos REAPARECERIAM
  como se alguém os tivesse feito, com números de agosto de 2026 e nada acusando. **O DELETE é o único
  passo de migração que escreve em `auditoria.evento`:** cada linha virou um evento `D` com o
  `dados_antes` inteiro, `origem = 'migracao'` e usuário nulo, gravado ANTES do `DROP COLUMN` para o
  `to_jsonb` guardar o registro como ele era. Desfazer é ler o JSON de volta.
- **A 1.44.0 NÃO sobe o piso do banco, e a 1.43.0 sobe** (`MIN_DATABASE_VERSION`, em
  `server/src/config.js`). A regra é a mesma nas duas: remover só obriga a migrar quando o código
  ainda lia o que saiu. Aqui ele parou de ler as duas colunas ANTES de elas caírem, então um banco que
  ainda as tenha serve o servidor inteiro.
- **O `resumoDoAno` lia a revisão do MÊS no FROM externo e a de HOJE na célula, e a correção de
  2026-08-08 foi feita mesmo com a medição dizendo que o defeito não era alcançável.** Fica
  registrado para ninguém reabrir o caso achando que há defeito latente: `pit.meta_em(d)` é a consulta
  de `pit.meta_vigente` mais o predicado `data_vigencia <= d`, então todo item que ela lista está na
  outra POR CONSTRUÇÃO, e o `LEFT JOIN` do resumo nunca perdia célula. Conferido contra a produção
  restaurada, mês a mês de 2026: **zero itens em `meta_em(d)` fora de `meta_vigente`.** A correção
  entrou assim mesmo porque passa a valer por construção em vez de por acidente de duas definições
  coincidirem: `meta_vigente` é a única das duas sem teto de data, e no dia em que ela ganhar filtro
  próprio o relatório de março mudaria sozinho, sem escrita nenhuma e sem erro nenhum. **O que a mesma
  medição achou de verdade** foi outro defeito, esse alcançável: o resumo não filtrava meta cancelada,
  e a 2.1 de julho de 2026 saía com 42 linhas onde deveriam ser 40 (os itens 5.2 e 5.3, cancelados
  pela R1 em 2026-05-14).

## Efetivo

- **O aproveitamento é INTERVALO, e não retrato mensal.** `dgeo.efetivo_periodo` diz quando a pessoa
  esteve na Divisão e `dgeo.impedimento` o que a tirou do trabalho, e quanto; mês, semana e ano viram
  CONSULTA. Texto livre por mês não soma, não compara e não sabe dizer o que houve no dia 06 de março.
- **Impedimento é o que TIRA a pessoa do trabalho da Divisão, e a descrição é TEXTO LIVRE** (chefe).
  "Chefe do S5", "LTSP" e "Fiscal administrativo" não cabem numa taxonomia de cinco linhas.
- **A não sobreposição de PASSAGEM é do BANCO** (`EXCLUDE USING gist` com `daterange`), senão ficaria
  a um `INSERT` de distância de ser furada pelo CLI, pela carga ou pelo `psql`. O `[]` fecha os dois
  lados. **IMPEDIMENTO pode sobrepor**, e os percentuais somam truncados em 100%, senão o sistema
  negaria o fato de alguém estar de licença E chefiando seção.
- **A conta é por DIA, e em dia CORRIDO.** Dia útil exigiria um calendário de feriados só para mudar o
  denominador, e o mês quebrado é o caso que motivou tudo.
- **A disponibilidade tem TRÊS estados**: nulo (não estava na Divisão), zero (estava, e um impedimento
  consumiu o dia) e 1 a 100. Com nulo e zero na mesma cor, quem chegou em março apareceria com quatro
  meses de licença.
- **As duas tabelas moram em `dgeo`, e não em `rpcmtec`.** "Quem esteve na Divisão e quando" é dado de
  pessoa, e o relatório é só um leitor; elas são auditadas no agregado da PESSOA.
- **O POSTO DA ÉPOCA se perde, e está aceito** (chefe). Ele vem do cadastro, e a promoção não muda quem
  esteve na Divisão em março.
- **A 6.1 sai com TRÊS colunas, e o modelo tem duas.** A terceira é o aproveitamento. Quem cola no Word
  apaga a coluna se não quiser, o que é barato; recuperar um número que não saiu não é.
- **O recorte mensal da 6.1 é QUALQUER dia do mês, e o da 7.1 é o ÚLTIMO dia dele.** As duas leem
  intervalo com fim anulável e as duas sabem o ano e o mês da edição, então a diferença não aparece
  em teste nenhum nem na tela: está registrada em "RPCMTec e relatórios", com a razão de cada uma.
  Aqui entra quem esteve na Divisão parte do mês, com o percentual dizendo quanto; lá o documento é
  uma fotografia do fim do mês.
- **O impedimento se cadastra a partir do MILITAR, e não por botão geral** (chefe): o mapa já respondeu
  "de quem". A passagem tem botão geral, porque a primeira de alguém é o caso em que a pessoa ainda
  não está no mapa.

## Capacitação

- **UMA tabela para ministrada (2.6) e recebida (6.2), e DUAS telas** (chefe). É o mesmo fato visto
  dos dois lados, e o que muda são três colunas, anuláveis por isso. Com uma tela só e um filtro de
  tipo, a pessoa escolheria de que lado estava antes de saber o que ia digitar.
- **Quem participou vem do CADASTRO, e não de um texto** (chefe). "Cap Fulano" e "Fulano" são a mesma
  pessoa e duas strings, e nenhuma responde "de quais capacitações o Fulano participou". **Quem já
  está marcado continua na lista mesmo desativado**, senão sumiria da linha de março.
- **O PAPEL não é coluna: vem do `tipo_id`.** Na ministrada quem está ligado é instrutor ou monitor;
  na recebida, foi capacitado. Uma coluna seria a mesma informação gravada duas vezes.
- **`efetivo_capacitado` não se confunde com o vínculo:** lá é gente DE FORA que nós treinamos, aqui é
  gente NOSSA, e numa ministrada o relatório pede as duas.
- **A 2.6 do documento NÃO ganhou coluna de instrutor.** Quem ministrou é informação de gestão, não do
  documento, e aparece na tela; a 6.2 preenche a coluna "Militar" a partir do vínculo.
- **A lista é regravada INTEIRA a cada salvamento, e o rastro é UM evento do PAI**
  (`sintetico: true`). Auditar linha a linha faria o histórico dizer "removeu 3, acrescentou 3" toda
  vez que alguém abrisse e salvasse.
- **`rpcmtec.capacitacao` mora no schema do RELATÓRIO, e isso não contradiz "as tabelas do relatório
  não se gravam aqui".** Aquilo vale para tabela CALCULADA, e esta é DIGITADA: reconsultar não
  recupera nada, porque não há de onde.

## RPCMTec e relatórios

- **O RPCMTec é UM gerador só, fora dos módulos.** É o relatório da
  DIVISÃO e o chefe assina uma edição só; gerado em dois lugares, alguém colava um DOCX no outro todo
  mês. Não é `verifyPerfil` porque ele traz valor de crédito, empenho e liquidação.
- **A guarda dele tem TRÊS níveis desde 2026-08-08, e não mais um** (chefe): quem é GERENTE de
  qualquer módulo LÊ o relatório inteiro (`verifyGerente`); ESCREVER uma subseção exige ser gerente
  DO MÓDULO DELA; e FECHAR, REABRIR, criar, excluir e anexar o assinado continuam de `verifyAdmin`.
  **Isto reverte o admin-only**, cuja razão escrita era que liberar por perfil de UM módulo entregaria
  o orçamento a quem só cataloga carta. A razão continua valendo, e é exatamente o que o recorte da
  escrita guarda: o gerente da mapoteca LÊ a seção 4 e não altera uma linha dela. Fechar ficou de
  fora do recorte porque a peça é UMA: um gerente de módulo congelaria também as oito seções que não
  são dele, e o documento é o que o chefe da Divisão assina.
  **O mapa subseção -> módulo é a chave `modulo` de `rpcmtec_estrutura.js`**, ao lado da origem, da
  grade e dos cabeçalhos, porque o arquivo já é a definição única de que saem o gerador, a tela, o
  PDF e o fechamento. O critério é A ORIGEM DO DADO, e não o número da seção: a 2.2, a 2.4 e a 2.7
  são do ACERVO embora morem na seção do PIT, e a 3.3 é de PRODUÇÃO embora more na da Mapoteca.
  Recortar por seção entregaria o Extra-PIT a quem atende balcão.
  **`modulo: null` é "de módulo nenhum", e fica com o administrador**: a finalidade (1.1), o
  desenvolvimento e a TI (5.1 e 5.2), a divulgação (8.1 a 8.5) e as lições do chefe (9.1 a 9.3).
  Nenhuma tem cadastro em módulo algum do SCA, e não existe módulo de TI nem de comunicação social:
  dar dono a elas por semelhança seria conceder acesso que ninguém decidiu conceder. **A 7.1 estava
  nesta lista e saiu em 2026-08-08**, quando o módulo `equipamento` lhe deu cadastro: era o caso que
  o próprio parágrafo previa ("o dia em que uma ganhar cadastro, ela ganha módulo aqui, numa
  linha"), e foi isso, uma linha.
  **São DUAS guardas encadeadas, e não uma**, porque são duas perguntas: `verifyGerente` autentica e
  pergunta "é gerente de ALGUM módulo?"; `rpcmtec/verify_modulo_subsecao.js` pergunta "é gerente
  DESTE?". Ela é middleware, e não conferência no controlador, porque o alvo está em
  `req.params.numero` e autorização mora na camada de rota: no controlador, a mesma conferência
  apareceria em quatro métodos e a quinta rota de subseção nasceria sem ela. Ela não mora em `login/`
  porque `login/` não sabe -- e não deve saber -- que "3.3" é uma subseção.
  **Onde o recorte rende mais é na marca de CONFERÊNCIA**, que vale para as três origens e alcança os
  33 blocos, e não só os 11 digitados: cada gerente carimba o que é da área dele, e o administrador
  deixa de ser o único par de olhos antes da assinatura.
- **A CAPACITAÇÃO virou DUAS rotas, `/capacitacao/ministrada` e `/capacitacao/recebida`** (1.33.0),
  e é a única parte de `/api/rpcmtec` guardada por MÓDULO. Ela mora ali por endereço, e não por
  natureza: capacitação é CADASTRO, e não relatório. A ministrada (2.6) é serviço que a Divisão presta
  e pede operador no **PIT**; a recebida (6.2) é gente nossa em curso e pede operador em
  **efetivo**.
  A frase aqui dizia "a única parte que não é `verifyAdmin`" e envelheceu em 2026-08-08, quando a
  LEITURA do relatório desceu para `verifyGerente` e a escrita de subseção passou a exigir o gerente
  DO MÓDULO dela. Hoje o `verifyAdmin` de `/api/rpcmtec` cobre 7 rotas: criar, alterar, apagar,
  fechar e reabrir a edição, e acrescentar ou remover anexo.
  A separação é a única forma possível: a permissão é por TIPO, e a guarda de rota não enxerga o corpo
  nem a query. `POST /capacitacao` criava qualquer uma das duas, porque `tipo_id` vinha no corpo.
  Agora o tipo é o CAMINHO, e quem o fixa é o servidor. É a mesma forma do par
  `/produto_versao_historica` e `/produto_versao_planejada`.
  **A LEITURA também se separou**, e não só a escrita, por três razões: `GET /capacitacao` sem
  `tipo_id` devolvia as duas (uma guarda por tipo numa rota que responde os dois não guarda nada);
  `/capacitacao/:id` respondia qualquer id; e `/capacitacao/anos` mentia (em 2026-08-06 havia
  ministrada em oito anos e recebida só em 2026, e a tela da recebida oferecia os oito).
  **O CONTROLADOR recorta por tipo, e não só a rota.** Sem isso o operador de Efetivo apagaria uma
  capacitação MINISTRADA mandando o id dela para `DELETE /capacitacao/recebida/:id`: a guarda o
  aprovaria, porque a rota é a dele. O id do outro tipo responde 404, e não 403: por aquele caminho
  ele não existe.
  A TABELA continua UMA (`rpcmtec.capacitacao`): o que se separou foi o endereço, não o dado.
- **NÃO EXISTE copiar o mês anterior, desde 2026-08-06.** Havia dois botões na edição (um por
  subseção e um geral), o serviço do cliente, a rota `POST /rpcmtec/:id/copiar-mes-anterior`, o schema
  do corpo e o controlador. Tudo saiu junto. O RPCMTec é o relatório DAQUELE mês, e o que a cópia
  produzia era pior que redigitar: ninguém relê a linha que chega pronta, e o documento assinado
  passava a afirmar sobre agosto o que aconteceu em julho. **Foi PODA, e não desativação**: o endereço
  responde 404, e a ausência é provada em `routes/rpcmtec_sem_copia.test.js` (servidor) e em
  `services/rpcmtec-service.test.js` (cliente). A tabela `rpcmtec.subsecao` não mudou: a cópia nunca
  teve dado próprio.
- **A 5.1 IMPORTA o CSV do github_dashboard, e a leitura do CSV é do SERVIDOR.** A rota é
  `POST /rpcmtec/:id/subsecao/5.1/importar`, com o número no CAMINHO: o formato é o do painel do
  GitHub, e o painel só alimenta a 5.1. Ler o CSV é regra de DADO, e é ela que decide o que se apaga.
  Posta no cliente, ela não valeria para o `pit_cli`, e a segunda implementação divergiria da
  primeira. Não houve migração: a 5.1 grava em `rpcmtec.subsecao.linhas`, que é JSONB.
- **O CSV tem três colunas e a tabela tem quatro. A importação NUNCA toca o `Resumo`.** Ela casa as
  linhas pelo nome do repositório, sem caixa, e o Resumo vem do que já está gravado. Reimportar no fim
  do mês é o uso normal: uma importação que zerasse o Resumo destruiria, calada, o único conteúdo da
  tabela que não existe em lugar nenhum mais.
- **O repositório que sumiu do CSV SAI da tabela, e sair com Resumo escrito exige
  `confirmar_remocao`.** Mantê-lo faria o documento assinado afirmar commits que o painel não conta
  mais naquele mês. Sem a confirmação a rota responde 409 NOMEANDO quem perde o texto, como o
  `ciente_revisao` do fechamento e pela mesma razão: a recusa mora no servidor, então vale para o CLI.
- **O importador RECUSA o que não entendeu, com a frase que ensina o conserto.** Sem cabeçalho, com
  coluna a mais ou a menos, com commits que não é número, com repositório repetido ou separado por
  ponto e vírgula (o CSV do Excel em português), ele não grava nada. Adivinhar o separador é o pior
  caso: o ponto e vírgula é o que separa os militares DENTRO da coluna `Efetivo`. Só o cabeçalho sem
  linha nenhuma também é recusa, e a mensagem manda usar "Sem ocorrência no mês": aceitar gravaria a
  tabela vazia, e a tabela vazia apagaria todo Resumo escrito.
- **A execução por ND do painel NÃO foi junto:** é `/api/orcamento/dashboard/execucao_nd`, com
  `verifyPerfil('consulta','orcamento')`. O painel pede números quebrados em PDR e Extra-PDR, e servir
  os dois da mesma rota faria a guarda mais fraca valer para as duas.
- **O documento tem 33 blocos, e o SCA CALCULA 21** (2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.1 a 3.4, 4.1 a
  4.7, 6.1, 6.2, 7.1 e 7.2). Os outros 12 não se calculam: 11 são DIGITADOS e um é FIXO (a 1.1).
  **Do SAP vem só a 2.3**, que lê a PRODUÇÃO: a 2.2 e a 2.4 viraram calculadas em 2026-08-05, a 7.3
  sumiu na fusão de 2026-08-08, e a 7.1 e a 2.5 viraram calculadas em 2026-08-08.
  Conte em `rpcmtec_estrutura.js` (`BLOCOS`, `NUMEROS_CALCULADOS`) antes de escrever um
  número aqui: esta linha já esteve errada por omitir a 2.2 e a 2.4 e por listar uma 7.3 que morreu.
  **As três linhas de total da 2.6 não saem**: o desenhador daqui não tem rodapé de tabela, e
  emiti-las como linha comum daria um total alinhado errado.
- **A 7.1 (Equipamento Técnico Indisponível) virou CALCULADA em 2026-08-08, e de módulo nenhum passou
  a ser do `equipamento`.** Ela não era digitada por escolha: o material permanente da Divisão vivia
  numa planilha, e a lista mensal de quem estava parado era transcrita a mão dentro do relatório. Com
  o módulo `equipamento` e a tabela `equipamento.indisponibilidade`, ela sai do banco, e o número do
  relatório deixa de poder divergir do cadastro sem nada acusar. É a mesma razão que tirou a 2.2 e a
  2.4 do 'SAP' em 2026-08-05, e a única diferença é que ali o cadastro já existia.
  **O cabeçalho e a grade NÃO mudaram, e não é sorte**: são os do modelo da Divisão, e o DDL foi
  DERIVADO deles (`data_inicio`, `motivo`, `previsao_retorno` nasceram com o nome da coluna do
  documento). Esta subseção não tem divergência deliberada nenhuma em relação ao modelo.
  **A coluna "Equipamento" é `{modelo} (Nr Patr {nr_patrimonio})`, SEMPRE** (chefe). É literalmente a
  fórmula que o gestor digitou a mão em 2026-08-06, para separar dois plotters idênticos. A regra
  condicional ("põe o patrimônio só quando o modelo repetir") faria o MESMO bem sair com nome
  diferente conforme quem mais estivesse quebrado naquele mês, e duas edições vizinhas deixariam de
  ser comparáveis linha a linha por causa de um terceiro equipamento.
  **O SCHEMA PREVIU ISTO, e é por isso que a virada custou uma migração de DADO e nenhuma de
  estrutura**: `rpcmtec.subsecao.origem_id` é gravado POR LINHA, e não lido de
  `rpcmtec_estrutura.js` na hora de desenhar. Uma subseção pode GRADUAR de digitada para calculada, e
  a edição fechada antes continua sendo o que foi -- o congelado tem de dizer o que o PDF assinado
  diz. A mesma coluna é o que torna seguro apagar o digitado órfão sem tocar em edição fechada.
  **A ORDEM DERRUBA O BOOT SE INVERTIDA**: todo `modulo` não-nulo de `rpcmtec_estrutura.js` tem de
  existir no mapa `MODULO` de `login/verify_perfil.js`, e `rpcmtec/verify_modulo_subsecao.js` confere
  isso no `require`, e não na primeira requisição. `'equipamento'` só pôde entrar na estrutura depois
  de `equipamento: 6` entrar no mapa e de `(6, 'Equipamento', 'equipamento')` entrar em
  `dominio.modulo` (1.46.0).
- **A 2.5 (Atividades de campo) virou CALCULADA em 2026-08-08, e é do módulo `pit`** (chamado
  `producao` até 2026-08-09).
  Ela era DIGITADA com `fonte: 'SAP'`: todo mês alguém abria a tela de lá e transcrevia as linhas.
  Com o schema `campo` no banco, elas saem do cadastro. É o mesmo movimento da 7.1 no mesmo dia, e o
  da 2.2 e da 2.4 em 2026-08-05.
  **O cabeçalho e a grade NÃO mudaram**: são os do modelo da Divisão (`Local`, `Data`, `Finalidade
  Campo`, `Efetivo`), e o que mudou foi de onde vem a linha.
  **O RECORTE É O MÊS INTEIRO, e DIVERGE do da 7.1 ao lado**: são `data_inicio <= <último dia> AND
  data_fim >= <primeiro dia>`. Campo é INTERVALO, e indisponibilidade é ESTADO: um campo de 28/07 a
  03/08 aconteceu em julho E em agosto, e sai nas duas edições. Somar as doze edições do ano conta
  esse campo duas vezes, e é o certo -- a pergunta da subseção é "que atividade houve no mês".
  **O CANCELADO É O ÚNICO QUE FICA DE FORA**: campo cancelado não aconteceu. O PREVISTO cujo período
  já passou CONTINUA SAINDO, e é deliberado: ele é atraso de cadastro, e escondê-lo faria o relatório
  sair silenciosamente mais curto que o trabalho.
  **O "Local" é DERIVADO da geometria**, por `limites.municipio`, no máximo quatro nomes mais "e mais
  N". Com a malha do IBGE não carregada (ela entra por carga, e `er/limites.sql` só cria a tabela) a
  coluna cai no NOME do campo: sem esse `COALESCE` ela sairia em branco em todo banco recém-instalado
  e ninguém ligaria a causa ao efeito.
  **O "Efetivo" são DUAS listas juntas**: `campo.campo_militar` (quem tem conta) mais
  `campo.militares_externos` (quem não tem). Medido no dump do SAP: dos 145 nomes distintos em 13
  anos, 59 casam com o cadastro de hoje e 86 não, porque o texto de lá guarda a patente DA ÉPOCA e
  treze anos incluem muita gente que saiu. Publicar só a primeira lista faria a 2.5 de um mês de 2019
  sair com um terço do efetivo que foi a campo.
- **O RECORTE DA 7.1 É O ÚLTIMO DIA DO MÊS, e DIVERGE do da 6.1, que recorta por qualquer dia dele**
  (chefe, 2026-08-08). São `data_inicio <= <último dia> AND (data_fim IS NULL OR data_fim >= <último
  dia>)`. A pergunta que a 7.1 responde é "o que ESTAVA parado quando o mês fechou": o documento é
  uma fotografia do fim do mês, e é assim que o gestor a digitava. A 6.1 pergunta outra coisa, "quem
  esteve na Divisão neste mês, e quanto rendeu", e por isso aceita quem passou parte do mês, com o
  percentual dizendo quanto.
  **A CONSEQUÊNCIA, para ninguém a descobrir como defeito: um equipamento parado do dia 2 ao dia 20
  NÃO sai no relatório daquele mês.** Ele existiu, foi consertado dentro do mês, e a fotografia do
  dia 31 não o mostra.
  **Está registrado porque duas subseções recortando o MESMO FORMATO de dado de jeitos diferentes é
  armadilha**, e a única defesa é o registro: as duas leem intervalo com fim anulável, as duas
  sabem o ano e o mês da edição, e a diferença não aparece em teste nenhum nem na tela. Nas duas,
  **quem recorta é a CONSULTA, e não um filtro no montador**: filtro no montador traz do banco linha
  que ninguém vai imprimir, e a próxima pessoa que usar a função acha que ela devolve tudo.
- **O digitado que sobrou nas subseções que VIRARAM calculadas foi APAGADO, com evento `D`**
  (`2026-08-08_a_71_calculada.sql`, 1.47.0): as 12 linhas da 7.1 de julho/2026, as 6 marcações de
  `sem_ocorrencia` de janeiro a junho, e as 203 células órfãs da 2.2 (8) e da 2.4 (195), estas
  desde 2026-08-05. **Deixar não era neutro**, e o preço tinha três tempos: em edição ABERTA o
  montador toma o ramo calculado e nunca lê a linha gravada, que fica dizendo uma coisa enquanto a
  tela mostra outra; no FECHAMENTO o `ON CONFLICT ... DO UPDATE` a sobrescreve **sem rastro
  próprio**, porque o `fechar` audita a EDIÇÃO e não cada subseção; e numa REABERTURA o
  `DELETE ... WHERE origem_id <> DIGITADA` a apaga de vez. Não era hipótese: era o que já acontecia
  com as 203 células. **Pelo precedente da 1.44.0, o DELETE é o único passo de migração que escreve
  em `auditoria.evento`** -- cada linha vira um evento `D` com `dados_antes` inteiro, `origem =
  'migracao'` e usuário nulo, e desfazer é ler o JSON de volta. **A edição FECHADA não é tocada**,
  por duas condições que guardam a mesma coisa por caminhos diferentes: `data_fechamento IS NULL` e
  `origem_id = 2`. **Janeiro a junho de 2026 deixam de sair "sem ocorrência" e passam a listar dez a
  doze equipamentos, e é o comportamento certo**: aquelas marcações afirmavam que não havia
  equipamento parado, e havia -- as indisponibilidades do DMT começam em 2019 e nenhuma tinha data
  de fim. O relatório dizia "não houve" onde o certo era "ninguém transcreveu".
- **O DOCX copia a FORMATAÇÃO do documento da Divisão, medida no OOXML.** As constantes de
  `rpcmtec_docx.js` são valores LIDOS do documento real, porque cada tabela tem de ser colável na
  subseção de mesmo número sem ninguém reformatar. Só saem as subseções preenchidas INTEIRAS, e o que
  fica de fora aparece na tela com o motivo.
- **Número de relatório só se prova contra PRODUÇÃO.** Três casos passavam nos testes e eram
  plausíveis na tela: a 3.3 vinda de `previsto_pit`, a porcentagem da ASC acima de 100% por contar o
  acervo inteiro, e a versão PLANEJADA entrando como produto entregue.
- **O Anuário e o RTM saem de planilha-SEMENTE, e não são redesenhados.** Montados do zero, tinham os
  números certos **sem ser** o arquivo que a DSG confere linha a linha; gerar é abrir o ZIP, trocar o
  valor das células no `content.xml` e reescrever o resto byte a byte. **TODA célula de valor é
  reescrita, inclusive as que dão zero**, senão sobra ali o número da semente num relatório de outro
  mês. Os arquivos em `rpcmtec/modelos/` têm os dados removidos, porque este repositório é público.
- **`GET /api/rpcmtec/rtm/ods` e `GET /api/mapoteca/relatorio/impressao_detalhada_ods` chamam o MESMO
  `gerarRtmOds`.** Dois caminhos para o mesmo arquivo com formatos diferentes é a divergência que a
  fusão existiu para acabar.

## Orçamento

- **A NE empenha contra uma NC OBRIGATÓRIA, e herda dela ND, PI e GND.** Empenho sem crédito de
  origem não existe no processo, e deixar os três campos livres na NE permitiria empenhar numa
  natureza de despesa que o crédito não tem; a herança é o que faz a soma das NE fechar contra a NC.
- **A LICITAÇÃO não tem vínculo com DFD.** O DFD é a demanda do ano e a licitação é o certame, e uma
  licitação atende muitos DFDs, de anos diferentes. A FK sugeriria um para um, e quem a preenchesse
  escolheria um DFD arbitrário entre os que a licitação atende.
- **A NC tem o par `(ano, numero, cod_nd)` único por UG emitente, e não o número sozinho.** A mesma
  UG emite números que se repetem entre anos, e a mesma nota chega quebrada por natureza de despesa.
- **O RECOLHIDO virou DOCUMENTO, e deixou de ser coluna.** Havia aqui, até 2026-08-08, a frase
  "`valor_recolhido` é informativo, e não desconta do saldo". A coluna não existe mais desde
  2026-08-07 (1.40.0): o recolhimento virou `orcamento.nota_credito_recolhimento`, uma linha por
  documento, e o recolhido de uma NC passou a ser a SOMA delas, lida por seis consultas. A frase
  antiga sobreviveu à própria coluna por um dia, e descrevia um campo que ninguém mais podia ler.
- **A CHAVE DO SIAFI da nota de empenho estava INERTE por 24 horas, e o conserto vale mais que a poda
  que veio junto.** `nota_empenho.ug` e `.gestao` nasceram em 2026-08-07 com backfill de 91/91 e o
  índice único `(ug, gestao, ano, numero)` nasceu junto, mas NENHUMA linha do servidor escrevia as
  duas: nem o INSERT, nem o UPDATE, nem o Joi, nem o mapa de auditoria. A prova está no rastro: os 4
  eventos de INSERT de NE posteriores àquela migração não trazem `ug` no `dados_depois`, e as duas
  colunas não aparecem em nenhum dos 171 eventos do módulo. Toda NE nascia com `ug = NULL`, **e no
  Postgres NULL não colide com NULL num índice único**: a proteção que custou a migração inteira já
  não valia, e o problema que ela existiu para resolver (38 registros em 32 números) voltaria em
  silêncio na próxima NE duplicada. O conserto de 2026-08-08 tem duas metades e uma sozinha não serve:
  o servidor passa a DERIVAR e gravar as duas, e elas viram NOT NULL. **Elas não entram no Joi de
  propósito:** ninguém digita a UG de um empenho, ela é consequência da NC representativa, e um campo
  de formulário permitiria afirmar uma UG que o crédito desmente. Colidir agora responde 409.
- **TRÊS colunas viraram DERIVADAS e continuam saindo na API com o mesmo nome, e a prova rodou dentro
  da transação que as apagou:** `dfd_item.valor_total` era igual a `quantidade * valor_unitario` em
  **31 de 31** linhas, `dfd.valor_estimado` era igual à soma dos totais dos itens em **8 de 8** DFDs, e
  `pdr_item.gnd` era igual ao GND da natureza de despesa em **36 de 36**. Zero divergências nas três.
  O que mudou é a FONTE, e não a resposta; o que elas perderam foi a DIGITAÇÃO, e mandá-las volta 400,
  porque o módulo usa o validador estrito. **`valor_estimado` e `valor_total` saíram na MESMA
  migração** de propósito: separá-las deixaria um dos dois derivando do outro que acabou de sumir. **O
  `ROUND(..., 2)` não é enfeite:** `quantidade` é `NUMERIC(15,3)` e o produto cru sai com cinco casas,
  então sem ele a API passaria a devolver `100.00000` onde a coluna dava `100.00`.
- **O NUP da licitação foi REVERTIDO em quatro dias, e isso foi ATO DO CHEFE.** `licitacao.nup` e
  `licitacao.fornecedor` nasceram em 2026-08-04, numa migração cuja justificativa era que "o chefe
  acompanha as licitações pelo número do pregão e pelo NUP". Quatro dias depois, com as duas ainda em
  **0 de 11**, ele decidiu que UM identificador basta: o `numero_pregao` fica, o NUP sai, e a
  `data_homologacao` também fica. Está escrito aqui para quem ler as duas migrações não tratar a
  remoção como esquecimento de quem leu a primeira pela metade.
- **A poda de 2026-08-08 (1.43.0) tirou outras 6 colunas que nunca tiveram dado, e
  `area_requisitante` ficou.** Saíram `dfd.justificativa`, `data_prevista_conclusao` e
  `responsavel_cpf` (0 de 8 cada, e o CPF ainda era dado pessoal num repositório público),
  `dfd.grau_prioridade_id` (1 de 8, um único código, levando `dominio.grau_prioridade` e a rota que a
  servia), `dfd.vinculo_plano_gestao` (8 de 8 com UM valor, o nome de um plano que é um só) e
  `nota_credito.marcador` (8 de 99, e já discordava do documento: 11 NCs tinham recolhimento integral
  e só 8 estavam marcadas). **`area_requisitante` é a exceção que separa isto de uma regra
  automática:** ela também tem um valor só hoje, mas é o único campo do módulo que diz DE QUEM é a
  demanda, e no dia em que outra seção do CGEO pedir um DFD ela distingue.
- **O par de carimbo sai SEMPRE junto, e só depois de conferida a auditoria.** "Mudou em 3 de agosto"
  sem quem, ou "fulano mudou" sem quando, não respondem pergunta nenhuma; a razão do chefe é usar só
  `auditoria.evento`, que guarda os dois e ainda diz O QUE mudou. As três tabelas estavam declaradas
  no mapa de auditoria e registravam na mesma transação antes de a coluna cair. **Em `dfd_item` a
  razão é estrutural:** o item é apagado e reinserido inteiro a cada salvamento, nunca sofre UPDATE, e
  as duas colunas eram 0 de 31 por construção. **`orcamento.arquivo.data_modificacao` NÃO saiu**, é o
  mesmo caso (0 de 54) e ficou: coluna que ninguém pediu para remover não se remove de carona.
- **O cabeçalho da subseção 4.1 dizia "Valor previsto (Prioridade 1)" e a consulta nunca filtrou
  prioridade nenhuma**, e `grau_prioridade_id` sequer existia em `pdr_item`. O documento assinado
  afirmava um recorte que ninguém fazia. O cabeçalho passou a "Valor previsto", que é o que a consulta
  sempre calculou, e é essa correção que liberou a poda da prioridade: sem ela, restaria um consumidor.

## Auditoria e rastreabilidade

- **`auditoria.evento` é UMA tabela para todos os módulos, e o rastro nasce no BACKEND** (chefe). O
  gatilho não conhece o usuário da sessão HTTP, porque o Postgres vê a conexão do pool. O preço é a
  rota nova que esquece de auditar, e quem cobra é um teste de varredura que lê o router de verdade.
- **`auditoria` é o único schema sem `UPDATE` e sem `DELETE` para a aplicação.** Trilha que a própria
  aplicação reescreve não prova nada. **Não há expurgo automático e a tabela não nasce particionada**,
  porque expurgo automático falharia justamente ao se perguntar sobre mudança antiga. **Pendente de
  confirmação da chefia**, e antes de a tabela crescer, porque particionar depois custa migração.
- **Escrever é `auditoriaCtrl.registrar(t, {...})`, DENTRO da transação da mudança.** Falhar ao
  auditar derruba a escrita: trilha que se perde em silêncio é pior que trilha nenhuma. `modulo`,
  `entidade` e `entidade_id` saem do mapa, e não do chamador.
- **`auditoriaCtrl.lerAntes` SUBSTITUI o `SELECT id` que só existia para o 404.** Se fosse consulta a
  mais, o rastro custaria uma ida ao banco por função.
- **`server/src/auditoria/mapa/` é a única declaração do que se audita**, um arquivo por módulo, e
  tabela auditada que não está lá é **erro em tempo de execução**. As marcas `sintetico: true` (campo
  que o controller monta e a tabela não tem) e `pseudoTabela: true` (alvo de evento de OPERAÇÃO)
  existem porque a varredura confere tudo contra os `er/*.sql`: sem elas, ou o teste reprova o caso
  legítimo, ou afrouxá-lo deixaria passar erro de digitação em nome de coluna.
- **A ORDEM é diff primeiro, sanitização depois.** Sanitizar antes apagaria a mudança, e "trocaram a
  senha de alguém" deixaria de aparecer.
- **Três coisas NUNCA entram no JSON, e quem as tira é `sanitizar.js`**: o hash da senha, o `conteudo`
  BYTEA dos anexos e valor acima de 8 kB, que vira resumo. **O teto de 8 kB está pendente de
  confirmação da chefia**: acima dele o estado anterior de uma folha de recorte irregular deixa de ser
  recuperável, e subir o teto depois não recupera o que já foi gravado resumido.
- **O DIFF SAI PRONTO DO SERVIDOR, e o cliente não traduz nada.** A tela mistura os módulos e
  precisaria de todos os catálogos, inclusive dos que a pessoa não usa. **Domínio traduz; FK para
  ENTIDADE não**, e sai o id, porque o nome de hoje ao lado de um valor antigo pode ser falso. **Campo
  não declarado NÃO some da tela**, senão o mapa esconderia o que ninguém está olhando.
- **O detalhe abre em MODAL, e não em linha que se expande.** O `createDataTable` não tem linha
  expansível, e acrescentar isso a um componente usado por dezenas de telas não é proporcional.
- **O nome não é "auditoria", e isso é deliberado.** `#/acervo/auditoria` são os invariantes, que
  medem a coerência do acervo HOJE e não dizem quem produziu a incoerência; `#/acessos` registra quem
  ENTROU, e não o que fez depois.
- **O `cliente` (`sca_web`/`sca_qgis`) é assinado no JWT.** Ele PODE entrar, ao contrário dos perfis,
  porque é imutável para aquela sessão; token antigo fica com `origem = 'desconhecido'` até expirar,
  porque adivinhar por `User-Agent` seria pior que dizer que não sabe.

## Acervo: cadastro e upload

- **O método de definir a GEOMETRIA sai da ESCALA, e não da vontade de quem cadastra.** Escala 1 a 4 é
  SCN e o quadro nasce do **MI ou do INOM**, calculado; a 5 (personalizada) não tem folha a calcular,
  e ali valem os **cantos**. Desenhar folha do SCN a mão é o que produz os defeitos que a auditoria
  persegue depois do fato (`1d`, `1e`, `1g`, `1h`, `1i`). Sem escala escolhida o editor PERGUNTA,
  senão ofereceria desenho a mão para folha sistemática.
- **INOM para polígono é FÓRMULA; MI para INOM é TABELA.** `utils/scn.js` decompõe o SCN em SEGUNDOS
  DE ARCO, porque em grau o 1/3 do nível de 1:100.000 não tem representação binária exata. Os tamanhos
  que ele produz e a regra do `1d` **são a mesma régua do invariante, e divergirem é defeito de um dos
  dois**. Folha fora do Brasil **não tem MI**: isso é RESPOSTA, não erro.
- **Os CSV de `utils/scn_dados/` vêm do DSGTools e carregam GPL-2.0, e este repositório é MIT.** As
  duas obras são da DSG, o que torna o porte decisão INTERNA; por isso moram em diretório próprio, com
  `LICENSE-DSGTOOLS` ao lado. **Pendência do chefe:** confirmar antes do próximo `push` público.
- **Os TRÊS tipos de versão entram pela web, e o que muda é o CAMINHO da gravação.** Regular nasce COM
  arquivo e vai para o assistente (o servidor não tem rota que a crie sem arquivo); Planejada e
  Registro histórico gravam direto, cada uma na sua rota. Uma rota por coisa, e não um inteiro
  escondido, porque o RPCMTec conta entrega por tipo de versão. O tipo NÃO vai no corpo: as rotas o
  fixam, e mandá-lo seria campo descartado em silêncio.
- **O subtipo da VERSÃO é filtrado pelo tipo do produto.** A lista inteira convida a gravar "Modelo
  Digital de Superfície" numa Carta Topográfica, e nada no banco impede: é o invariante `3h`. O
  subtipo já gravado continua na lista, porque o `3h` é REVISAR e há combinação legada tolerada.
- **`GET /api/produtos/folha?mi=|inom=` aceita um identificador só**, senão o servidor desempataria em
  silêncio.
- **A carga em LOTE continua sendo do plugin ou do CLI.** A tela grava uma versão por vez, e o acervo
  legado entra por dezenas de folhas.
- **Produto que JÁ ESTÁ no volume entra por `POST /api/arquivo/catalogar/product`, e o servidor mede o
  hash.** O par `prepare`/`confirm` cobrava pelo trabalho de conferir uma cópia que nunca houve, com a
  releitura DENTRO da transação, aberta por horas e sem retomada parcial. **A rota só aceita volume com
  `layout_origem = true`**, e é essa a porta que a impede de virar atalho para pular a validação de
  transferência. Junto veio `utils/caminho_volume.js`, porque `path.join` não protege contra `..`.
- **O upload web é UMA requisição, sem sessão.** O par prepare/confirm cobre a janela em que o PLUGIN
  sai para copiar bytes por conta própria; no navegador não há janela, e usá-lo deixava sessão
  abandonada pendurada e `.parcial` no volume. Perde-se reenviar só o arquivo que falhou; vale, porque
  o teto é de poucos GB (`UPLOAD_WEB_MAX_GB`, default 2).
- **Quem nomeia, mede o checksum e escolhe a extensão é o SERVIDOR: mandar qualquer um dos quatro é
  400.** O nome sai de `acervo.nome_arquivo_padrao`, a MESMA função do invariante `7a`, porque auditor
  e escritor são a mesma regra; descartar em silêncio faria o cliente acreditar ter gravado o que
  mandou.
- **O padrão dá UM nome por versão, e quem separa os arquivos é a extensão.** Dois arquivos da mesma
  versão com a mesma extensão são RECUSADOS, e não desambiguados: um `_2` faria o escritor nomear
  diferente do que o `renomear-padrao` e o `7a` esperam.
- **A escrita é atômica** (`.parcial` e `rename` no fim), com o `rename` DENTRO da transação e depois
  do INSERT: o índice único arbitra a colisão com o disco intacto. O storage do multer é próprio
  porque o `diskStorage` exigiria uma SEGUNDA leitura para o hash.
- **O teto do multer TRUNCA o fluxo, não o derruba.** Sem conferir o `truncated`, o `pipeline` termina
  normal e o arquivo entra pela metade, com checksum calculado sobre a metade e "válido" para sempre.
- **`/upload-web/arquivos` completa a versão PLANEJADA e NÃO muda o tipo dela**, porque "Planejada" e
  "Regular" dizem coisas diferentes sobre a PROMESSA, não sobre ter byte. O volume é o dos arquivos
  que a versão JÁ TEM, porque o primário pode ter mudado e a unicidade de nome vale POR VOLUME.
- **No caminho "produto e versão num passo só" o produto NÃO é gravado antes.** Gravar antes deixaria
  uma casca sem versão toda vez que alguém desistisse, e desiste, porque é no passo seguinte que o
  gatilho cobra rótulo e subtipo.
- **A ordem das partes do multipart importa:** o campo `dados` (JSON) vem ANTES dos arquivos, porque é
  dele que sai o destino de cada byte, lido enquanto o corpo ainda chega.
- **Data de versão é DIA DE CALENDÁRIO: `Joi.date().iso().raw()`, nunca `Joi.date()`.** Sem o `.raw()`
  a coluna guarda 21:00 do dia anterior em UTC-3, e a carta editada no dia 1º entra no relatório do mês
  anterior, que ninguém confere folha a folha. Sem o `.iso()`, '01/08/2026' vira 8 de JANEIRO.
- **A LÁPIDE do arquivo excluído mora num módulo só (`arquivo/arquivo_deletado.js`), e o vínculo com
  o download casa por `uuid_arquivo`, NUNCA por ordem.** Copiado em três lugares, esquecer um não dava erro: a lápide
  nasce com o campo nulo. Por ordem, funcionaria hoje e trocaria os downloads de dois arquivos no dia
  em que o plano mudasse, sem erro nenhum e com as contagens ainda batendo.
- **Modal empilhado: só o do TOPO responde ao Escape e ao Tab.** Com cada modal ouvindo o `document`,
  um Escape fechava TODOS, e nem `stopImmediatePropagation` bastaria, porque em captura responderia
  primeiro o modal de BAIXO. A saída da pilha de `modal-base.js` é por identidade, e não `pop()`, para
  ser possível fechar pelo botão um modal que não é o do topo.

## Acervo: auditoria de invariantes

- **`4a`, `4f` e `4g` filtram `tipo_arquivo_id <> 9`.** O CHECK de `er/acervo.sql` EXIGE checksum,
  tamanho e volume nulos no tileserver: sem o filtro era um DEFECT impossível de zerar. O teste que
  documenta isso impede alguém de "limpar" `4a` e `4g` achando que pararam de olhar.
- **"Planejada COM arquivo" não é defeito, e por isso o invariante é o INVERSO.** Escrito como pedido,
  ele acusaria toda folha concluída pela web e nunca zeraria. O que ficou é o `3j` REVISAR: promessa
  VENCIDA, com `data_edicao` no passado e ainda sem arquivo.
- **O `3i` mede a SÉRIE, que o `3c` e o `3d` não enxergam**, porque olham uma versão isolada e a 2ª
  Edição datada antes da 1ª passa nos dois. Particiona por SUBTIPO, porque o produto civil abrange
  séries independentes. **Conta VERSÃO, e não PAR**, senão um único registro errado viraria várias
  ocorrências num invariante cuja regra é dar zero.
- **O `4h` (par raster/PDF) nasceu REVISAR, e a promoção a DEFECT é commit próprio.** Ninguém mediu
  quantas folhas do legado têm só um dos dois, e DEFECT que não zera envenena a auditoria inteira (a
  lição do `3f` e do `1i`).
- **Abrir a tela NÃO mede nada, e o filtro de severidade é do CLIENTE.** São dezenas de consultas numa
  transação só: na montagem, um clique errado na sidebar custava uma auditoria inteira. **O último
  resultado sobrevive à troca de tela, DATADO**, porque o modo de falhar caro desta tela é mostrar a
  contagem de antes da correção. E **só pinta a linha que TEM ocorrência**, senão a tela pareceria
  cheia de problema no dia em que o acervo está limpo.
- **O teste da rota entra com token de ADMINISTRADOR, e por isso um caso prova a guarda de perfil.**
  Como o administrador passa por flag, trocar `verifyPerfil('gerente')` por `verifyAdmin` não quebraria
  os outros casos e o gerente perderia a tela em silêncio.

## Mapoteca e plugin

- **ESTOQUE E CONSUMO VIRARAM UM LIVRO SÓ** (`mapoteca.movimento_material`, 2026-08-08, decisão do
  chefe). Havia três portas mexendo no saldo e só uma guardava data: o `POST /estoque_material` era
  um upsert que REDEFINIA a quantidade, o `POST /estoque_material/transferir` eram dois UPDATEs, e
  `mapoteca.consumo_material` era a única com histórico, e mesmo assim só do consumo. O saldo era o
  único registro do que acontecera, e ele não responde "quando" nem "por quê". **Os números que
  decidiram**, medidos em 2026-08-08 contra o banco de produção: `consumo_material` com ZERO linhas e
  sequência VIRGEM em nove dias de uso real, contra cinco edições de saldo a mão em 2026-08-06, duas
  delas decrementos unitários, que é a forma exata de um consumo. A tabela do consumo não estava
  subutilizada por acaso: a Seção conta a PRATELEIRA, e não declara cada uso, e o que ela tinha a
  registrar ia parar na única porta que aceitava, a que edita saldo. **Os tipos são o que de fato
  acontece**: o material CHEGA (1 Entrada), MUDA de lugar (2 Transferência) e ACABA (3 Consumo).
  Nasceu com um quarto, a Contagem, extinta no mesmo dia (bullet abaixo). Em uma tabela por tipo, "o
  que aconteceu com este material" viraria um UNION que alguém esquece de estender no dia do próximo.
- **A CONTAGEM (tipo 4) FOI EXTINTA no mesmo 2026-08-08 em que nasceu** (decisão do chefe): o saldo
  tem de estar certo por Entrada, Transferência e Consumo, e não existe movimento cujo trabalho seja
  empurrar o saldo até o número da prateleira. Ela lançava a DIFERENÇA entre a prateleira e o
  sistema, com motivo obrigatório, e existia para separar o que a Seção GASTOU do que ela PERDEU.
  **O que isso custa, e foi aceito junto:** falta na prateleira vira Consumo e sobra vira Entrada,
  então quebra e extravio passam a ser reportados na 7.2 do RPCMTec como gasto de material da
  Divisão -- não há mais onde dizer "sumiu" em vez de "gastei". **O que NÃO era caso dela** continua
  tendo conserto, e é metade do argumento: lançamento ERRADO se corrige editando ou apagando a linha
  errada, porque os gatilhos de UPDATE e DELETE desfazem o efeito dela no saldo. Somar um ajuste em
  cima guardaria duas linhas para um evento que nunca houve.
- **O code 4 SAI do domínio, e o que mudou foi a medição, não o argumento**
  (`2026-08-08_apagar_a_contagem_do_dominio.sql`, 1.48.0). A 1.45.0 o manteve, renomeado para
  "Contagem (extinta)", por um consumidor real: `auditoria.evento` guarda o valor gravado, e quem o
  traduz é o catálogo VIVO da tabela (`auditoria/renderizar.js`), então sem a linha um evento antigo
  de movimento exibiria "Tipo de movimento: 4", cru. **O argumento continua correto; o histórico é
  que não existe.** A janela em que uma Contagem podia ser lançada foi da 1.41.0 à 1.45.0, ambas de
  2026-08-08, e nela houve zero movimentos de qualquer tipo, zero linhas de tipo 4 e zero eventos
  citando 4 -- e no dump de produção do mesmo dia `mapoteca.movimento_material` **nem estava
  criada**, porque o livro nasceu na 1.41.0, depois dele. A conversão da 1.45.0 tampouco deixa rastro
  que precise da linha: ela troca o tipo com UPDATE direto, sem escrever em `auditoria.evento`.
  Guardar um valor de domínio para um passado que não aconteceu não é prudência: é um código que só
  pode confundir quem ler a tabela. **A migração carrega as duas guardas** e levanta exceção em vez
  de apagar se achar linha do livro ou evento de auditoria com tipo 4, para que um ambiente que
  ninguém mediu pare ali em vez de descobrir isso na tela. Quem barra o lançamento novo continua
  sendo o `ELSE FALSE` do `movimento_material_forma` mais o Joi de `mapoteca_schema.js`, e agora
  também a FK -- que não é observável, porque o CHECK é avaliado antes do gatilho dela. **O piso não
  sobe:** este servidor não lê a linha 4 em lugar nenhum.
- **As linhas tipo 4 que existiam foram CONVERTIDAS, e não apagadas** (`2026-08-08_fim_da_contagem.sql`,
  1.45.0): apagar zeraria o estoque, porque a Contagem É a semente do saldo inteiro -- a 1.41.0
  semeou o saldo daquele dia como Contagem, uma por linha de estoque (26 na produção). Cada uma vira
  o tipo do que representa: com DESTINO é Entrada, com ORIGEM 1 é Consumo, e o motivo ganha o prefixo
  `[Contagem convertida]` para o livro não passar por lançado assim. **A que sai de FORA da Seção
  aborta a migração de propósito**, porque não cabe em tipo nenhum (Consumo só sai da Seção) e
  escolher entre transferir e dar baixa seria inventar um movimento. **Os gatilhos são desligados
  durante a conversão** (`DISABLE TRIGGER USER`): ela é saldo-neutra, mas o gatilho de UPDATE desfaz
  antes de refazer, e o desfazer de uma semente de 26 já consumida até sobrar 6 estouraria "Estoque
  insuficiente" por um negativo que só existe entre duas instruções. **O piso não sobe** (segue
  1.43.0): a migração só remove.
- **O saldo continua sendo TABELA, escrito por GATILHO, e sem porta própria.** A view sobre a soma do
  livro foi recusada por uma razão: são o `CHECK (quantidade >= 0)` e a `UNIQUE (tipo_material_id,
  localizacao_id)` de `estoque_material` que RECUSAM o consumo sem saldo; numa view o livro aceitaria
  a linha e o saldo ficaria negativo. E as rotas de escrita do saldo saíram inteiras (`POST`, `PUT`,
  `DELETE` e `/transferir`): uma delas sobrevivendo ao lado do livro faria a soma do livro deixar de
  bater com o saldo no primeiro uso, e aí nenhuma das duas explicaria mais nada.
- **O CONSUMO só sai da Seção** (`tipo_localizacao` code 1), e material que está em outra
  localização tem de ser TRANSFERIDO para lá antes; o trigger recusa consumo sem saldo. As quatro
  localizações são etapas da vida do material, e não prateleiras: 1 Seção (onde se usa), 2
  Almoxarifado, 3 Aquisição realizada e 4 Saldo no empenho (comprado e ainda não entregue). Deixar
  consumir de qualquer uma faria a Divisão gastar, no papel, resma que ainda está com o fornecedor.
  A regra era um IF dentro do gatilho e **subiu para um CHECK da tabela**: o gatilho recusava, e o
  banco aceitava a mesma linha por qualquer outra porta.
- **A 7.2 e a 7.3 do RPCMTec viraram UMA (a 7.2), e a 7.3 sumiu sem renumerar nada** (2026-08-08,
  chefe). O que as separava era `tipo_material.categoria_id`, uma coluna cuja única função era
  escolher em qual das duas tabelas a linha sairia: as duas tinham as MESMAS cinco colunas, a mesma
  grade e a mesma fonte, e ninguém lê "só as tintas". Uma coluna que só pode errar, e que erra calada
  no primeiro material cadastrado sem escolher, não paga uma quebra de tabela. **Custou ZERO**:
  nenhuma edição de RPCMTec fechada e nenhuma linha 7.2 ou 7.3 gravada em `rpcmtec.subsecao`.
  Entraram junto duas consequências: `tipo_material.nome` virou UNIQUE (a 7.2 casa o mês anterior
  pelo NOME, e papel e tinta passaram a dividir um espaço de nomes só) e **todo material ativo entra
  na tabela**, e não só o insumo de impressão, porque o cabeçote acaba do mesmo jeito que o cartucho.
  **Pendência conhecida e aceita:** a coluna "Estoque atual" soma ROLO e CARTUCHO, então o total dela
  não tem significado físico, e cada LINHA continua tendo. O conserto, se um dia incomodar, é a
  unidade virar dado, e não a tabela voltar a se partir.
- **Morreu a ponte impressão -> consumo, e com ela `tipo_material.tipo_midia_id` e
  `quantidade_impressa`.** O consumo do RPCMTec e do painel é o DECLARADO, e nada além. A 7.2 de
  julho saiu com "consumo 802, estoque 64": os 802 vinham da impressão, os 64 de uma contagem
  digitada, e nenhum consumo de papel fora lançado no ano inteiro. Um número media o mundo, o outro
  media o cadastro, e a subtração entre eles não significava nada. Produto impresso e rolo de papel
  são coisas separadas: sem a mídia não há como saber qual papel uma impressão gastou, e essa é
  justamente a afirmação que a ponte fazia e não podia sustentar. Zero na coluna quer dizer "ninguém
  lançou", que é diferente de errado, e é um zero que a Seção conserta lançando. Caiu junto
  `tipo_material.meta_anual`, que nunca teve leitor e estava NULA nas 34 linhas da produção.
- **A PODA DO PEDIDO foi por MEDIÇÃO, e cada coluna caiu por um número** (2026-08-08, 1.42.0):
  `situacao_pedido` code 1 ("Pré cadastramento do pedido realizado") saiu com ZERO pedidos usando, e o
  code 2 virou "Pedido Recebido" sem trocar de código, porque o rótulo antigo ("DIEx/Ofício do pedido
  recebido") nomeava o documento e não a situação. `pedido.omds` tinha 124 linhas preenchidas e **um
  único valor distinto** ("1º CGEO"), mais 42 vazias: era uma constante que o formulário mandava
  redigitar a cada pedido, e as 42 vazias são o que acontece quando se pede isso. Ela vive hoje como a
  constante `OMDS` de `relatorio_ctrl.js`, e a coluna do RTM passou a sair SEMPRE preenchida.
  `produto_pedido.quantidade_fornecida` era igual a `quantidade` em **1759 de 1759** linhas
  preenchidas, sem uma divergência: virou o fragmento `QTD_EFETIVA`, e os 795 itens de 2026 que saíam
  com a célula em branco no RTM passaram a sair com número. **Nenhum número publicado mudou para pior
  em nenhum dos dois casos: as duas podas só encheram célula que saía vazia.**
- **`tipo_midia_fornecida_id` NÃO caiu junto, e o sufixo igual é coincidência.** Ela tem **25
  divergências reais** nas mesmas 1759 linhas (item pedido em tyvek e atendido em sulfite), contra
  zero da quantidade: o `COALESCE` de `MIDIA_EFETIVA` decide de verdade, e o de `QTD_EFETIVA` não
  decidia nada. É o par que alguém poda junto por simetria de nome, e por isso está escrito aqui.
- **`QTD_EFETIVA` continua sendo FRAGMENTO, e não virou `pp.quantidade` escrito em onze consultas.**
  Ele é o lugar onde "quanto se entregou" tem UMA resposta; o dia em que ela voltar a ter partes (e o
  candidato natural é a soma de `mapoteca.impressao_item`), muda ali e muda em todas.
- **O filtro por etiqueta usa `@>`, e não `ILIKE`, e por isso casa a palavra INTEIRA e com maiúscula.**
  `GET /pedido?ano=&palavra_chave=` é o primeiro leitor do índice GIN que `pedido.palavras_chave` tinha
  desde a instalação e que não servia consulta nenhuma. `lower()` ou `ILIKE` casariam pedaço, e
  abandonariam o índice: foi medido com EXPLAIN. O filtro **soma** com o ano e não o substitui, porque
  a etiqueta se repete de um ano para o outro ('Extra-PIT', '5ª DE'). E a lista passou a MOSTRAR
  `palavras_chave`: lista que filtra por algo que não mostra deixa quem filtrou sem saber por que
  aquela linha entrou.
- **`impressao_item`, `plotter` e `manutencao_plotter` NÃO foram podadas** (chefe), embora a
  cardinalidade de hoje seja 1:1 e convide a isso. A impressão é ATO FÍSICO: um soldado imprime, pode
  levar mais de um dia, pode parar no meio, e é preciso saber quem imprimiu o quê e quando. A
  cardinalidade atual é acidente da carga inicial, e não do processo, e colapsar a tabela numa coluna
  do item trocaria o histórico por um número que só responde "quanto", nunca "quem" nem "quando".
- **A ESCALA de item de pedido nunca sai NULA, e quem garante isso é UM fragmento de SQL.** O item
  avulso não tem carta e por isso não tem escala, e a ausência vira `'Sem escala'` no `COALESCE` do
  `ESCALA_DISPLAY_ITEM`, e não em cada consulta: repetido consulta a consulta, o relatório que
  esquecesse o `COALESCE` sairia com uma linha em branco no meio de um total.
- **O plugin é cliente do MÓDULO mapoteca, e nenhuma rota dele é do acervo.** A permissão segue o
  módulo do TRABALHO, e não o do dado: quem imprime pode não ter perfil nenhum no acervo. Por isso a
  confirmação é `POST /api/mapoteca/impressao/confirmar_download`, com **o mesmo
  `acervoCtrl.confirmDownload`**, porque `acervo.download` é uma tabela só. Pela gêmea do acervo o
  operador levava 403 no fim de um download bem-sucedido, e o histórico registrava falha em toda
  impressão que dera certo.
- **A tela do plugin lê a FILA (`/pedido/em_aberto`), e não a lista de pedidos.** A lista filtra por
  ano e o plugin não tem seletor de ano: o pedido de dezembro ainda aberto em janeiro sumia sem aviso.
  A régua é `SITUACOES_EM_ABERTO` em `query_fragments.js`, e não uma constante copiada para o Python.
- **O item AVULSO não é "item sem PDF", e a resposta do prepare diz qual é qual.** O avulso nunca terá
  arquivo no acervo e se imprime do original; o item do acervo sem PDF é falta de verdade. O manifesto
  CSV lista o pedido INTEIRO, porque um manifesto só do baixado esconde as linhas que exigem atenção.
- **`core/api_client.py` é gêmeo do de `ferramentas_acervo/`, com duas diferenças deliberadas:** o
  default de `pode()` é `mapoteca`, e aqui não há o cache de `core/dominios.py`, cujas rotas são todas
  do acervo e voltariam 403.

## Interface

- **Tela de cadastro não explica o sistema** (chefe). Quem abre vem cadastrar, não estudar o modelo.
  Regra de preenchimento vira `helpText` do CAMPO que ela governa, que é onde a pessoa olha na hora de
  errar.
- **A sidebar tem CINCO seções de sistema, e nenhuma delas é módulo do `registry.js`** (chefe):
  **Produção** e **Efetivo** vêm depois dos três, nessa ordem porque a primeira fala do TRABALHO. A
  rota `#/usuarios` NÃO mudou junto com o rótulo "Efetivo", senão link guardado quebraria.
  Desde a 1.33.0 Produção e Efetivo SÃO módulos de PERMISSÃO (`dominio.modulo` 4 e 5), mas continuam
  sem manifesto e sem prefixo de rota: as telas deles são de plataforma. Por isso a visibilidade dos
  itens sai de `temPerfil(nivel, modulo)` escrito no item, e não do `podeAbrirRota` que os módulos
  usam. A `rotaRaiz` do router precisou de resposta própria pelo mesmo motivo: quem tem perfil só num
  deles entraria e cairia em /unauthorized.
- **A seção Efetivo perdeu o `admin: true` e a marca desceu para os itens.** Dashboard e Gestão são
  CONTA DE SISTEMA e continuam do administrador; o Aproveitamento e a Capacitação recebida são do
  operador do módulo Efetivo. A `home` da seção virou função pela mesma razão: o cabeçalho é um link
  para `#/acessos`, que é do administrador, e mandar o operador para lá o jogaria em /unauthorized ao
  clicar no nome da seção que é dele.
- **A troca de módulo mora na SIDEBAR, não num dropdown na navbar** (chefe), e a sidebar é montada uma
  vez e **nunca se desmonta**, senão entrar numa rota de plataforma apaga o menu do módulo.
- **O administrador global não é coluna da tabela de usuários.** Ele é propriedade da pessoa; uma
  coluna por módulo sugeriria que existe administrador de módulo, que é o que o modelo não tem.
- **A administração do acervo é UMA tela com abas (`#/acervo/administracao`).** São cadastros que se
  leem juntos, e quatro itens na sidebar dariam quatro telas de uma linha cada; só a aba ativa fica no
  DOM, senão abrir a tela dispararia as quatro cargas. **A rota é `admin: true` desde 2026-08-08**, e
  é a única exceção à régua nova de que o gerente vê tudo da área dele: administrar o acervo não é
  trabalhar no acervo. Dentro dela o servidor continua com a régua de sempre (editar é operador,
  **excluir é gerente**), porque a tela ser de administrador não afrouxa rota nenhuma.
- **O grupo "Diagnóstico" é GERENTE, e "Verificar volume" vem primeiro porque é ela que ESCREVE.** Para
  um operador seriam quatro sub-abas que só respondem 403. Sem rodar a verificação, a lista de arquivos
  com problema é a foto da última vez que alguém rodou, e a tela diz isso, porque lista vazia se leria
  como "está tudo certo".
- **A verificação contra o volume é a única ação sem progresso possível, e o que se mostra é o TEMPO.**
  Ela relê o byte de todo o acervo e só responde no fim; sem o contador, a tela parada se lê como
  travada e a pessoa aperta de novo, pagando a releitura duas vezes. A escrita vale nos DOIS sentidos:
  marca o que não bate e **limpa a marca** do que voltou a bater.
- **Paginação de SERVIDOR entrou com componente próprio, e sem busca.** O `data-table` pagina no
  cliente, o que não vale para a lápide do acervo inteiro; as listas usam `paginated: false` mais
  `components/paginacao/`, com as MESMAS classes `pagination__*`. **Sem `searchable`**, porque a busca
  do `data-table` diria "nenhum resultado" para registro que existe na página seguinte.
- **A aba "Manutenção" é a única que só o ADMINISTRADOR GLOBAL vê, e é cartão, não tabela.** Para um
  gerente seria uma aba de botões que só respondem 403, e ela nem é montada; é a última do conjunto,
  porque pô-la no caminho de quem veio conferir um volume seria convidá-la. Cada cartão diz o que faz,
  **o que NÃO faz** ("limpar downloads expirados" se lê como se apagasse arquivo) e o acompanhamento.
- **O renome padrão é o único que não é um clique, e o LAÇO é do cliente.** Uma passada inteira numa
  requisição só seguraria a conexão por dezenas de minutos. O laço para em três casos: acabou; houve
  falha (insistir repetiria o mesmo erro); ou `nesta_chamada` veio zero com `restantes` positivo, que
  seria laço infinito. Aplicar volta a desabilitar, porque o plano na tela envelheceu.
- **O `atualizar-checksum` trabalha por ID, e a tela diz de onde os ids saem.** Não existe consulta de
  "arquivos que precisam de checksum novo", porque a recompressão acontece fora do sistema.
- **As duas caixinhas de "Sim/Não" dizem na tela o que DECIDEM.** `layout_origem` é a porta do
  `catalogar/product`, e `primario` é o destino que o upload web escolhe sozinho; como colunas mudas,
  marcá-las por engano só apareceria depois, em outra tela e para outra pessoa.
- **O ano é filtro DE CADA TELA, e começa sempre no ano atual** (chefe). Um ano de contexto no
  `localStorage` fazia abrir o mapa de 2025 mudar calado a lista de pedidos. A diferença entre módulos
  é o parâmetro `permitirOutroAno`: no orçamento o ano decide **onde se cadastra**; na mapoteca ele só
  **filtra o que já aconteceu**. Ficam sem ano os **clientes** (cadastro, não movimento) e a LISTA de
  material, que mostra o saldo de hoje; a FICHA de um material tem ano, porque ali o que se lê é o
  livro de movimentos, que é histórico. Custo deliberado: o pedido de dezembro concluído em janeiro
  só aparece trocando o ano.
- **No dashboard da mapoteca existem DOIS recortes anuais, e cada aba diz na tela qual é o dela.**
  Resumo Anual e Mapa contam por data de **entrega**; Pedidos e Atendimento, por data do **pedido**. Os
  dois estão certos, e sem `.dashboard__escopo` os números pareceriam se contradizer. Janelas
  deslizantes ("últimos 6 meses") saíram, porque num ano passado continuariam terminando hoje.

## Mapa

- **`maplibre-gl` é a única dependência de mapa, e entra por `import()` dinâmico** (chefe). Ela pesa
  cerca de 1 MB minificada, contra 290 KB de todo o resto da interface. O CSS continua estático, que
  são poucos KB e evita o mapa nascer sem controles. Em teste vale `maplibre-stub.js`, porque o jsdom
  não tem WebGL.
- **Nos DOIS mapas de polígono o rótulo sai de uma fonte de PONTOS, e o preenchimento é ordenado por
  área.** Rotulando o polígono, a folha que cruza a borda de um ladrilho aparece rotulada duas vezes; o
  ponto vem por `ST_PointOnSurface`, e não `ST_Centroid`, que cai fora de uma folha em L. Sem
  `fill-sort-key` pela área negativa, a folha grande cai por cima da pequena e a engole, inclusive para
  o clique. **Consertar num mapa e não no outro é o que fez o defeito sobreviver.**
- **Polígono empilhado no mapa da mapoteca é PRODUTO diferente, nunca versão.** O empilhamento tem duas
  origens legítimas: o aninhamento por escala, e Carta Topográfica e Carta Ortoimagem da MESMA folha.
  Por isso o balão lista TODOS os produtos sob o ponteiro: mostrar um só fazia a tela parecer errada.
- **A informação do mapa da mapoteca sai num painel FIXO, não num balão que segue o ponteiro.** O balão
  é ancorado na coordenada apontada, e perto da borda saía da área visível, que é justamente onde se
  aponta. O painel nunca esvazia, senão piscaria a cada movimento do mouse.
- **Os filtros do mapa da mapoteca são do SERVIDOR, e a escala entra pelo rótulo.** O cliente não
  existe na feição, então filtrar parte na tela e parte no servidor faria as contas seguirem regras
  diferentes. Por código, 1:30.000 e 1:75.000 virariam uma opção só chamada "personalizada".

## Busca e filtros

- **As opções de filtro são FACETADAS: cada lista aplica os outros filtros, nunca o próprio** (chefe),
  senão cada lista ficaria com uma opção só. Ficam em endpoint próprio, porque o cache é por combinação
  e a tela pede as duas coisas em paralelo. Quando o cruzamento zera a escolha atual, a tela a MANTÉM
  com "(0)", senão desfaria em silêncio o que a pessoa pediu.
- **A sugestão de palavra-chave é um popover NOSSO, não `<datalist>`.** O nativo escolhe sozinho
  quantas linhas mostrar, sem CSS que o alcance, e abria cobrindo boa parte da tela. Enter aplica o
  texto como está, porque a sugestão vem limitada e o acervo tem mais etiquetas do que isso.
- **A busca do acervo lista PRODUTOS, e a ficha ordena as versões no SERVIDOR**
  (`data_edicao DESC NULLS LAST, id DESC`), porque quem lê essa rota inclui o plugin. `NULLS LAST`
  porque versão sem data de edição é registro incompleto, e não a mais nova.

## Estrutura e convenções

- **O SCA NÃO roda agendador. Toda limpeza é disparada por uma pessoa.** Não há CRON, pgAgent nem
  job em background: a rotina que fecha download e sessão de upload vencidos sai da tela de
  Manutenção, e o rastro registra quem mandou rodar. O preço é o dado vencido ficar até alguém
  varrer, e a tela mostra o tamanho da fila justamente por isso. O ganho é não ter processo
  invisível mexendo no acervo, e toda mutação ter um autor.
- **A mapoteca usa `usuario_id` (INTEGER) e o resto usa `usuario_uuid` (UUID).** Tabela nova segue a
  convenção do acervo, que é a do orçamento e a do efetivo. O preço é mais uma razão para excluir
  usuário falhar, e está certo.
- **O módulo orçamento tem o próprio `schema_validation`** (`orcamento/utils/`): o do SCA descarta
  chave desconhecida e responde 200, o do orçamento recusa com 400 e sugere a chave parecida. Unificar
  afrouxaria em silêncio as dezenas de rotas do orçamento.
- **O schema `orcamento` não tem PostGIS nem geometria.** Orçamento não tem dado espacial.

## Dependências e ambiente de teste

- **O `create_config.js` lê os `er/*.sql` SEM `minify`.** O `er/limites.sql` traz o WKT da área de
  suprimento quebrado em literais adjacentes de 72 caracteres, e o PostgreSQL só os concatena quando
  há QUEBRA DE LINHA entre eles. O `pg-minify` troca a quebra por espaço, os literais deixam de se
  juntar e a **instalação nova morria** com "erro de sintaxe" no meio de uma coordenada. Ficou
  invisível porque o `globalSetup` do Jest sempre leu o arquivo cru: a suíte de banco passava com
  `npm run config` quebrado. Ao mexer no carregamento dos `er/`, os dois caminhos leem o mesmo texto.
- **Schema de ATUALIZAÇÃO não leva `.default()`, nem em campo de ação.** O guardrail do
  `acervo_cli editar` recusa qualquer PUT cujo schema preencha por default um campo que a leitura não
  trouxe, porque num PUT de objeto inteiro isso é gravar o padrão por cima do valor real, em
  silêncio. Ele não distingue coluna de flag de ação, **e não deve**: uma lista de exceções
  apodreceria, e a exceção de hoje é a Carta Militar despinada de amanhã. O `.default(false)` de
  `migrar_subtipo_das_versoes` não mudava comportamento nenhum (o controller testa por falsidade),
  e mesmo assim TRAVOU o `editar produto` inteiro -- toda edição de produto pelo CLI, não só a do
  subtipo.
- **Feature que sai do servidor sai do registry do CLI no MESMO commit.** O CLI lê o contrato do Joi
  vivo, mas a lista de recursos é declarada, e declaração não some sozinha. Dois casos ficaram para
  trás e só apareceram quando alguém rodou `npm run test-cli`: o `pit_cli` anunciava as quatro
  rotas do de-para de mídia, apagadas na 1.29.0, e o `orcamento_cli` anunciava o CRUD do singleton de
  `orcamento.configuracao`, podado na 1.34.0. O segundo era pior que uma rota morta: o `require` do
  schema inexistente derrubava o `orcamento schema` de TODOS os recursos, e não só o dele.
- **Teste que compara data com o `CURRENT_DATE` do banco monta o dia no calendário LOCAL.** O
  `new Date(...).toISOString().slice(0, 10)` fala UTC, e o PostgreSQL fala o fuso do servidor
  (`America/Sao_Paulo`): das 21h à meia-noite as duas leituras discordam em um dia. O
  `dashboard_a_produzir.test.js` semeava "ontem" em UTC e cobrava `dias_atraso = 1`, e falhava TODA
  NOITE naquela janela de três horas, sem ninguém ter mexido em nada -- o pior tipo de teste
  vermelho, o que ensina a ignorar o vermelho. É o mesmo fuso que obriga `Joi.date().iso().raw()` nos
  dias de calendário das rotas: dia de calendário não é instante.
- **Teste que varre FONTE tem de normalizar o fim de linha.** Com `core.autocrlf` ligado (o padrão do
  Git no Windows) o arquivo chega em CRLF, e o `.` do JavaScript não casa `\r`: um `//.*$` para antes
  do fim da linha e não apaga comentário nenhum. Foi o que fez `modulo_em_toda_rota.test.js` reprovar
  a PROSA que descreve a armadilha, e `mi.test.js` acusar divergência exibindo duas linhas
  idênticas -- só na máquina de quem desenvolve no Windows.
- **`archiver` fica na 7, e os `overrides` do `server/package.json` são o que zera a auditoria. NUNCA
  rode `npm audit fix --force` aqui.** A 8 é ESM puro e não exporta mais função chamável, e quebra no
  boot. O `readdir-glob` precisa de override próprio porque o `minimatch` 5 chama `brace-expansion`
  esperando a função direta: sem ele, o `npm audit` diz "0 vulnerabilities" com o `archive.glob()`
  quebrado. Quem cobre é `acervo_zip_ctrl.test.js`, que abre o ZIP e descomprime.
- **Pacote ESM puro entra no servidor por `require()`, e no Jest por dublê mapeado. Não devolva
  `NODE_OPTIONS=--experimental-vm-modules` aos scripts de teste: ela é a causa, não a cura.** Com a
  flag, o Jest 30 quebra antes em `ERR_VM_MODULE_NOT_MODULE`; `utils/serialize_error_loader.js` tenta
  `require()` primeiro (o Node aceita ESM assim desde a 22.12) e só cai no `import()` com
  `ERR_REQUIRE_ESM`. Ao acrescentar dependência ESM pura, siga este par.
- **A suíte do servidor tem DOIS pacotes, e um banco POR WORKER do Jest.** Com um banco só não há
  paralelo, porque `cleanTestData()` faz TRUNCATE nas tabelas inteiras e dois workers apagariam os
  dados um do outro. O `globalSetup` clona de um banco-TEMPLATE, porque `CREATE DATABASE ... TEMPLATE`
  é cópia de arquivo e rodar os `er/*.sql` N vezes sairia mais caro que serializar.
- **Quem entra em qual pacote sai de LER O FONTE** (`require` de `helpers/db` ou de `helpers/app`), e
  não de uma lista, porque lista seria cópia. São os DOIS sinais porque o `getApp()` também chama
  `db.createConn()`: com um sinal só, um teste de rota caía no pacote rápido e derrubava o worker em
  vez de falhar com asserção.
- **Teste de schema prova o MOTIVO da recusa, nunca só que houve recusa.**
  `expect(error).toBeDefined()` passa quando o fixture quebra por outro campo. O helper
  `__tests__/helpers/joi.js` confere `error.details[0]`, o PRIMEIRO erro sob o `abortEarly` do Joi.
- **O que é mockado NÃO se testa de novo contra o banco, e o contrário também vale.** O mock do
  orçamento prova o mapeamento de parâmetro e nada sobre a consulta:
  `expect.stringContaining('INSERT INTO orcamento.rpnp')` passa com o SQL inteiro quebrado. O
  `integration/orcamento.test.js` cobre só o que exige banco de verdade, e Joi e 404 continuam no
  pacote mockado, que roda em milissegundos.
- **O rate limit é desligado sob `NODE_ENV=test`.** O efeito ruim não era falhar: era fazer falhar um
  teste **que não mudou**, só porque um teste novo entrou antes dele no mesmo minuto, o que faz a
  suíte depender de ordem e de relógio.
