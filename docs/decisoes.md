# Decisões de design deliberadas

Cada uma destas **parece defeito e não é**. Não "conserte" nenhuma sem falar com o chefe.

Este arquivo é o ARQUIVO da decisão: o que foi decidido, quando, e o que custou a alternativa. Ele
não é leitura obrigatória para escrever código. O que muda uma decisão no dia a dia está resumido em
uma linha no [`CLAUDE.md`](../CLAUDE.md), e o porquê completo mora no comentário do próprio arquivo
que implementa a coisa, que é o lugar em que ninguém deixa de ler.

Entrou aqui em 2026-08-02, quando o `CLAUDE.md` passou de 640 linhas: instrução de trabalho e
histórico de decisão são leituras diferentes, com frequências diferentes, e juntá-las fazia a
primeira ser lida pela metade.

## O SCA absorve o não-produção do SAP (2026-08-02)

O [SAP](https://github.com/1cgeo/sap) controla a produção cartográfica e gera parte do RPCMTec. Cinco
subseções que o SCA listava como "ficam de fora" tinham dono lá, e o critério para trazê-las **não
foi "está lá"**: foi que nenhuma delas depende de `macrocontrole`. Extra-PIT, meta não calculada,
efetivo do mês e capacitação se **cadastram à mão**. É o mesmo teste que tirou `limites` do acervo
(2026-07-29), `pit.meta` do orçamento (2026-07-31) e o RPCMTec dos módulos (2026-08-01), aplicado
entre SISTEMAS.

- **Nada saiu do SAP, e essa é a decisão do chefe.** A fusão é por ADIÇÃO aqui, e não por remoção lá.
  Durante a transição existem duas cópias vivas de cada fato, e o banco não tem como reconciliá-las:
  o que impede as duas de brigarem é o SCA passar a ser quem **gera** essas subseções, e as telas de
  lá deixarem de ser usadas. Quem mexer nisto precisa saber que a divergência é possível e esperada.
- **A 2.5 (atividades de campo) NÃO veio**, e é a única das cinco que ficou. `controle_campo`
  referencia `macrocontrole.produto`; trazê-la seria trazer a produção junto.
- **A 2.1 sai INTEIRA do SCA, inclusive as metas de produção.** Elas só têm número se alguém lançar à
  mão. Metade da tabela vinda de um sistema e metade de outro obrigaria quem a cola a descobrir todo
  mês quais linhas vêm de onde, e a 2.1 é UMA tabela.
- **As grades de coluna do DOCX são as MESMAS do gerador do SAP**, e não uma escolha nova: as duas
  foram medidas no mesmo documento da Divisão. Divergirem seria a mesma subseção saindo de dois
  tamanhos conforme quem a gerou. O teste `rpcmtec_docx.test.js` cobra a lista inteira.
- **Os códigos dos domínios novos são os do SAP** (`situacao_extra_pit`, `tipo_capacitacao`,
  `situacao_capacitacao`). Na fusão, a linha migrada não precisa de tabela de tradução.
- **`pit.meta` ganhou o que o PIT PROMETE** (`quantidade_prevista`, `unidade`, `demandante`,
  `prazo`), e é isso que destravou a 2.1. Até aqui os três primeiros viviam DENTRO de `descricao`,
  em texto: `'Carta Topográfica 1:25.000. COTER/DECEX, 24'`. **A migração não quebra esse texto**:
  a separação por expressão regular acerta quase tudo e erra calada onde há ponto na escala e
  separador de milhar na quantidade ('4.200'), e uma quantidade errada aqui vira uma porcentagem
  errada no relatório que o chefe assina. As colunas nascem NULAS e o preenchimento é ato de
  cadastro, conferido contra o PIT assinado.
- **Não existe coluna de "nome da meta".** No SAP ela é repetida em toda linha da mesma meta; aqui a
  linha de cabeçalho (`item` nulo) JÁ é esse nome.
- **`pit.execucao` é lançamento MANUAL para toda meta, e não há coluna de origem.** No SAP a régua é
  `lote_id IS NULL`; aqui não existe régua porque não há o que calcular enquanto o SAP não entrar.
  A coluna nasce quando ele entrar, e inventá-la agora seria campo antes da hora. **O custo está
  aceito e é conhecido:** a meta 4 (impressão) o SCA JÁ sabe somar por `mapoteca.pedido.meta_pit_id`,
  e é disso que sai o `META4_DETALHADA` do RTM. O número digitado e o calculado podem divergir, e
  quando divergirem a 2.1 e o RTM do mesmo mês vão se contradizer.
- **Só a meta-FOLHA recebe lançamento.** A meta subdividida tem cabeçalho e itens, e quem entrega é o
  item; lançar no cabeçalho contaria o total duas vezes, e as duas contas continuariam "certas" cada
  uma por si. O servidor recusa com a frase que diz o que fazer, e a tela nem oferece a linha.
- **`pit.demanda_extra` não tem `lote_id`, ao contrário do SAP.** Lá ele serve para a 2.1 não contar
  duas vezes; aqui não há o que descontar, porque a 2.1 soma `pit.execucao` e o Extra-PIT não é
  lançado lá. Apontar `acervo.lote` seria inventar um vínculo: o lote do acervo não é o lote de
  produção do SAP. E `documento_autorizacao` é **NOT NULL**, porque é ele que distingue a exceção
  AUTORIZADA de trabalho fora do plano -- derivar a 3.3 de `previsto_pit` dava 23 linhas onde a
  edição real de julho/2026 traz 1.
- **`rpcmtec.aproveitamento_mes` e `rpcmtec.capacitacao` moram no schema do RELATÓRIO**, e isso não
  contradiz o "as tabelas do relatório não se gravam aqui" de `er/rpcmtec.sql`: aquilo vale para
  tabela CALCULADA, e estas são DIGITADAS. São entrada, e não saída; reconsultar não recupera nada,
  porque não há de onde. O retrato do efetivo guarda o posto DA ÉPOCA de propósito: lendo o cadastro
  de hoje, a edição de março se reescreveria sozinha na primeira promoção de julho.
- **A capacitação é UMA tabela para ministrada (2.6) e recebida (6.2), e DUAS telas.** A linha é o
  mesmo fato visto dos dois lados; o que muda são três colunas, anuláveis por isso. O servidor
  **não** recusa a coluna do outro tipo: quem decide o que aparece é o formulário, e quem decide o
  que sai é o gerador. A tela, ao contrário da tabela, é uma por tipo (chefe, 2026-08-02):
  **ministrada em Produção** (é serviço que a Divisão presta) e **recebida em Efetivo** (é gente
  nossa em curso). Com uma tela só e um filtro de tipo, a pessoa tinha de escolher de que lado
  estava antes de saber o que ia digitar, e a coluna da direita ficava vazia em metade das linhas.
  O `tipo_id` deixou de ser campo do formulário e passa a vir da tela: trocá-lo no meio do cadastro
  limparia três campos já preenchidos.
- **`usuario_uuid` no efetivo, e não `usuario_id` como no SAP.** É a convenção de tabela nova aqui. O
  preço é mais uma tabela apontando `dgeo.usuario`, ou seja, mais uma razão para excluir usuário
  falhar -- e está certo, porque desativar não apaga o retrato dos meses em que a pessoa esteve.
- **O lançamento em massa do efetivo NÃO gera `lote_id` próprio.** `montarContexto` já emite um por
  REQUISIÇÃO, e cada partida rápida é uma requisição. Um segundo mecanismo faria a tela agrupar
  errado no dia em que os dois divergissem.

## Autenticação dentro do SCA (2026-08-02)

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

## Autenticação e superfície pública

- **`/api/integracao/*` não tem autenticação.** GET públicos e somente leitura, para o vault do chefe da DGEO consumir o SCA sem credencial. Expõem só cobertura do acervo, produtos concluídos no mês (por `acervo.versao.data_edicao`) e o agregado da mapoteca que o RPCMTec exige, sem endereço, contato ou observação de impressão.
- **`GET /api/mapoteca/pedido/localizador/:localizador` não tem autenticação.** É o acompanhamento do pedido pelo próprio cliente, que não tem conta. Já foi fechada por engano uma vez, numa classificação automática de rotas.
- **`/logs` não tem autenticação, e o CORS aceita qualquer origem.** O sistema roda em rede interna.
- **Credencial de banco na URI de camada do QGIS.** O plugin conecta direto no PostgreSQL para carregar camada. Aceitável em rede interna.

## Estrutura e convenções que parecem inconsistência

- **A mapoteca usa `usuario_id` (INTEGER) e o acervo usa `usuario_uuid` (UUID).** `dgeo.usuario` tem os dois. Tabela nova segue a convenção do acervo (UUID), que é a do orçamento também.
- **O módulo orçamento tem o próprio `schema_validation`** (`orcamento/utils/`). O do SCA descarta chave desconhecida e responde 200; o do orçamento recusa com 400 e sugere a chave parecida. São contratos diferentes de propósito: unificar afrouxaria em silêncio as 67 rotas do orçamento. `orcamento/utils/index.js` reexporta o `utils/` do SCA com essa única substituição.
- **O schema `orcamento` não tem PostGIS nem geometria.** Orçamento não tem dado espacial.

## Interface

- **Tela de cadastro não explica o sistema** (chefe, 2026-08-02). As quatro telas novas nasceram com
  um parágrafo de aviso no topo, contando de que subseção do RPCMTec elas saíam e o que uma coluna
  zerada queria dizer. Saíram todos. Quem abre a tela vem cadastrar, não estudar o modelo, e o texto
  que se lê uma vez e se ignora para sempre ocupa o lugar do que interessa. O que é regra de
  preenchimento virou `helpText` do CAMPO que ela governa, que é onde a pessoa está olhando na hora
  de errar; o que é decisão de desenho mora aqui.
- **A sidebar tem CINCO seções de sistema, e duas delas não são módulos** (chefe, 2026-08-02).
  Depois de acervo, mapoteca e orçamento vêm **Produção** (Metas do PIT, Execução do PIT, Extra-PIT,
  Capacitação ministrada) e **Efetivo** (Dashboard, Gestão, Aproveitamento, Capacitação recebida). Produção antes de Efetivo porque é
  a que fala do TRABALHO, e Efetivo é quem o faz. "Usuários" virou "Efetivo" porque o grupo deixou
  de ser sobre CONTA de sistema quando o aproveitamento mensal entrou nele; a rota `#/usuarios` NÃO
  mudou de nome junto com o rótulo, senão link guardado quebraria. "Metas do PIT" saiu do menu solto
  de plataforma e virou a primeira tela de Produção: as quatro se leem juntas, e a execução não faz
  sentido sem a meta. **A seção Produção não leva `admin: true` e o item Capacitação leva**, e não é
  descuido: metas e execução são `authLoader` (o servidor cobra o administrador só na escrita), e a
  capacitação é entrada do RPCMTec, guardada com `verifyAdmin`.
- **A troca de módulo mora na SIDEBAR, não num dropdown na navbar.** Cada módulo é uma seção colapsável, e o cabeçalho dela leva para a home do módulo. O dropdown existiu por algumas horas em 2026-07-27 e foi recusado pelo chefe. Junto veio a regra que o desenho anterior violava: a sidebar é montada uma vez e **nunca se desmonta**, senão entrar numa rota de plataforma (`#/usuarios`) apaga o menu do módulo.
- **O administrador global não é coluna da tabela de usuários.** Ele é propriedade da pessoa, então aparece como marca ao lado do nome. Repetir "Administrador" numa coluna por módulo sugere que existe administrador de módulo, que é justamente o que o modelo não tem.
- **A administração do acervo é UMA tela com abas (`#/acervo/administracao`, 2026-08-02), e não um item de menu por cadastro.** Volume de armazenamento, volume × tipo de produto, projeto e lote só existiam no plugin do QGIS (`ManageVolumesDialog` e irmãos), o que exigia QGIS instalado para uma tarefa sem nada de espacial; as rotas (`/volumes`, `/projetos`) sempre estiveram no servidor. São cadastros que se leem JUNTOS — a associação volume × tipo não se confere sem a lista de volumes, e lote não existe sem projeto —, então quatro itens soltos na sidebar dariam quatro telas de uma linha cada. Abas em dois níveis, e só a ativa no DOM: abrir a tela não dispara as quatro cargas. A rota pede **operador**, e não consulta, porque o próprio `GET /volumes/volume_armazenamento` é operador no servidor: com consulta a tela abriria só para mostrar erro. Dentro dela, editar é operador e **excluir é gerente**, e cada aba esconde o botão que aquele perfil levaria 403 ao usar.
- **O grupo "Diagnóstico" é GERENTE, um nível acima do que a página pede, e "Verificar volume" vem
  primeiro porque é ela que ESCREVE.** As quatro rotas (`/gerencia/verificar_inconsistencias`,
  `/arquivos_incorretos`, `/arquivos_deletados`, `/downloads_deletados`) são `verifyPerfil('gerente')`,
  então para um operador o grupo seria quatro sub-abas que só sabem responder 403. Dentro dele, a
  ordem não é alfabética: "Verificar volume" é a única que muda dado, e é ela que grava o status que
  as outras três leem — sem rodá-la, a lista de arquivos com problema é a foto da última vez que
  alguém rodou, e não do acervo de hoje. A tela diz isso, porque lista vazia ali se leria como "está
  tudo certo".
- **A verificação contra o volume é a única ação sem progresso possível, e o que se mostra é o TEMPO.**
  Ela relê o byte de todo o acervo para conferir o SHA-256, leva horas em acervo grande e a rota só
  responde no fim — não existe "40%" a exibir. O contador de tempo decorrido é o acompanhamento
  honesto: sem ele, uma tela parada por vinte minutos se lê como travada e a pessoa aperta de novo,
  pagando a releitura duas vezes. A tela também avisa que sair dela não cancela nada no servidor, só
  perde o resultado. E que a escrita vale nos DOIS sentidos: marca com erro o que não bate e **limpa
  a marca** do que voltou a bater, o que ninguém espera de algo chamado "verificar".
- **Paginação de SERVIDOR entrou com componente próprio, e sem busca.** O `data-table` pagina no
  cliente: recebe a lista inteira e fatia. Isso vale para tudo o que cabe numa resposta e não vale
  para a lápide do acervo inteiro, então as três listas de diagnóstico usam `paginated: false` (senão
  a tabela pagina de novo em cima das 20 linhas que o servidor já paginou) mais
  `components/paginacao/`, que desenha o rodapé com as MESMAS classes `pagination__*` — é o mesmo
  controle, e duas aparências na mesma tela leriam como coisas diferentes. **Sem `searchable`**: a
  busca do `data-table` filtra as linhas que ele tem, e sobre uma página de 20 diria "nenhum
  resultado" para um registro que existe na página 7. O envelope chega por `apiGetPaginado`, função
  separada porque `pagination` vem ao LADO de `dados` e o `apiGet` o descarta; um parâmetro no
  `apiGet` mudaria a forma de retorno de dezenas de chamadas existentes. As três telas compartilham
  `pages/administracao/lista-paginada.js` pelo mesmo motivo que a lápide virou um módulo só no
  servidor: a terceira cópia do laço é onde a divergência nasce.
- **A aba "Manutenção" é a única que só o ADMINISTRADOR GLOBAL vê, e é cartão, não tabela.** As quatro
  rotas dela são `verifyAdmin` e nenhuma é trabalho de módulo: duas mexem no banco inteiro (as visões
  materializadas), uma renomeia arquivo no VOLUME e uma relê byte para remedir checksum. Para um
  gerente seria uma aba de quatro botões que só sabem responder 403, então ela nem é montada. É a
  última do conjunto de propósito: pô-la no caminho de quem veio conferir um volume seria convidá-la.
  Cartão em vez de tabela porque não são registros que se leem, são operações que se disparam, e cada
  uma tem três partes na tela — o que faz, **o que NÃO faz** (onde mora o susto: "limpar downloads
  expirados" se lê como se apagasse arquivo) e o acompanhamento, sem o qual uma ação de minutos
  parece travada e a pessoa aperta de novo.
- **O renome padrão é o único que não é um clique, e o LAÇO é do cliente.** `POST /arquivo/renomear-padrao`
  trabalha por lote de propósito — uma passada inteira numa requisição só seguraria a conexão por
  dezenas de minutos —, então a tela começa em SIMULAÇÃO (mostra de que nome para qual, sem mudar
  nada) e depois chama em laço até `restantes` zerar, somando o progresso na tela. O laço para em três
  casos, e cada um por uma razão: acabou; **houve falha** (insistir repetiria o mesmo erro até o teto
  de 5.000, e o servidor já interrompe em 20); ou `nesta_chamada` veio zero com `restantes` positivo,
  que é lote que não anda e seria laço infinito. O botão Aplicar volta a desabilitar depois de rodar:
  o plano na tela envelheceu, e aplicar de novo sem simular repetiria uma contagem que já não vale.
  É o mesmo desenho do `NomePadraoDialog` do plugin, pelas mesmas razões.
- **O `atualizar-checksum` trabalha por ID, e a tela diz de onde os ids saem.** Não existe consulta
  de "arquivos que precisam de checksum novo": a recompressão acontece fora do sistema. Os ids vêm da
  amostra dos invariantes `4a` e `4f` da tela de Auditoria, ou de quem recomprimiu, e o campo aceita
  vírgula, espaço ou quebra de linha para colar de qualquer lugar. O teto de 500 do schema é cobrado
  na tela: colada uma lista longa, o 400 chegaria com a mensagem crua do Joi.
- **Nessa tela, as duas caixinhas de "Sim/Não" dizem na tela o que DECIDEM.** `layout_origem` é a porta do `POST /arquivo/catalogar/product`, a única rota que registra arquivo já no disco sem validação de transferência; `primario` é o destino que o upload web escolhe sozinho para aquele tipo de produto. Como colunas mudas, as duas pareceriam preferência de organização, e marcá-las por engano só apareceria depois, em outra tela e para outra pessoa. Por isso o formulário traz a frase e a exclusão do primário avisa que o tipo fica sem destino — o servidor só recusa esse caso quando já **existe** produto do tipo, e com o catálogo vazio a exclusão passa.
- **O ano de referência é contexto de MÓDULO, e mora na navbar.** Pela fábrica `@store/year-store.js`: chave de `localStorage` e evento são namespaced por módulo (`@sca-mapoteca-ano`, `anochange:mapoteca`), senão escolher 2025 num módulo mudaria o outro sob os pés de quem troca pela sidebar. O seletor é o mesmo componente; a diferença é de política: no orçamento o ano também decide **onde se cadastra**, e por isso ele oferece "+ Outro ano…"; na mapoteca o ano só **filtra o que já aconteceu**. Na mapoteca vale para o dashboard inteiro, pedidos, consumo, RPCMTec e detalhe do material; fica de fora só a lista de **clientes**, que é cadastro e não movimento. Pedidos esteve fora por algumas horas em 2026-07-28 e o chefe reverteu no mesmo dia. O custo, deliberado: o pedido de dezembro concluído em janeiro só aparece trocando o ano na navbar.
- **No dashboard da mapoteca existem DOIS recortes anuais, e cada aba diz na tela qual é o dela.** Resumo Anual e Mapa contam por data de **entrega** (`FILTRO_ENTREGUE_ANO`); Pedidos e Atendimento, por data do **pedido** (`FILTRO_ANO_PEDIDO`). O pedido de dezembro de 2025 entregue em janeiro de 2026 cai em anos diferentes nos dois, e os dois estão certos. Sem a linha de escopo na tela (`.dashboard__escopo`) os números pareceriam se contradizer. A aba Materiais é meio a meio e também avisa: o consumo é do ano, mas o **estoque é o saldo de hoje** e ignora o seletor, porque "estoque de 2025" não existe; a rota dele é a única do dashboard que não aceita `ano`. As janelas deslizantes ("últimos 6 meses") saíram junto: em 2025 elas continuariam terminando hoje.

## Mapa

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

## Busca e filtros

- **As opções de filtro são FACETADAS: cada lista aplica os outros filtros, nunca o próprio.** Pedido do chefe em 2026-07-28 ("um filtro deve filtrar o quantitativo do outro"). Aplicar também o próprio filtro deixaria cada lista com uma opção só. Elas ficam em endpoint próprio (`/dashboard/entregas_filtros`, `/acervo/busca/facetas`), e não junto das feições, porque o cache é por combinação e a tela pede as duas coisas em paralelo. Quando o cruzamento zera a escolha atual, a tela a MANTÉM com "(0)" em vez de descartá-la: descartar desfaria em silêncio o que a pessoa pediu. Duas exceções: a troca de ano, onde a opção some porque não existe mesmo; e, na busca do acervo, o subtipo que não pertence ao tipo recém-escolhido, que é DESCARTADO porque não cruzou a zero, deixou de fazer sentido. As contagens saem do MESMO `montarFiltrosBusca` da lista e da camada do mapa, então nenhuma pode divergir do resultado.
- **A sugestão de palavra-chave da busca é um popover NOSSO, não `<datalist>`.** O nativo escolhe sozinho quantas linhas mostrar, sem CSS que o alcance, e com as vinte etiquetas que a rota devolve abria cobrindo boa parte da tela. Junto vieram três coisas que o datalist não dava: a contagem de usos como texto de verdade, setas e Enter iguais em todo navegador, e a lista refeita a cada tecla contra o servidor. Enter com o campo digitado aplica o texto como está, de propósito: a sugestão vem limitada a 20 e o acervo tem mais etiquetas do que isso.
- **A busca do acervo lista PRODUTOS, e a ficha lista as versões da mais nova para a mais antiga.** O cartão anuncia a última edição (`ORDER BY v.data_edicao DESC LIMIT 1`) e a contagem de versões; a ficha traz todas, ordenadas no SERVIDOR por `data_edicao DESC NULLS LAST, id DESC`. Ordenar na tela não serviria: quem lê essa rota inclui o plugin. `NULLS LAST` porque versão sem data de edição é registro incompleto, e não a mais nova.

## RPCMTec e relatórios

- **O RPCMTec do SCA gera 18 subseções, e o SAP gera as que leem a PRODUÇÃO.** Desde 2026-08-02 saem
  daqui a 2.1, 2.6, 2.7, 3.1 a 3.4, 4.1 a 4.7, 6.1, 6.2, 7.2 e 7.3. Ficam no SAP a 2.2, a 2.3, a 2.4
  e a 2.5. **As três linhas de total da 2.6 não saem**: no modelo elas ficam abaixo da tabela com o
  rótulo em três colunas mescladas, e o desenhador daqui não tem rodapé de tabela -- emiti-las como
  linha comum daria um total alinhado errado, que é pior do que não ter.
- **O RPCMTec é UM gerador só, fora dos três módulos.** Ele é o relatório mensal da DIVISÃO: a mesma edição fala de acervo, mapoteca e orçamento, e o chefe assina uma só. Até 2026-08-01 era gerado em DOIS lugares que não se conheciam, cada um com a própria numeração de seção e o próprio DOCX; quem montava a edição colava um arquivo no outro, no Word, todo mês. Hoje é `server/src/rpcmtec/` sob `/api/rpcmtec`, com tela em `#/rpcmtec` e a edição mensal em `rpcmtec.edicao`. A guarda é **`verifyAdmin`**, e não `verifyPerfil`: o relatório traz valor de crédito, de empenho e de liquidação, e não existe "perfil de RPCMTec" porque não existe módulo RPCMTec. O que NÃO foi junto é a execução por ND que alimenta as abas do painel do orçamento: virou `/api/orcamento/dashboard/execucao_nd`, com `verifyPerfil('consulta','orcamento')`, porque o painel pede NÚMEROS quebrados em PDR e Extra-PDR e o relatório pede a visão do PDR já formatada. Servir os dois da mesma rota obrigaria a guarda mais fraca a valer para as duas.
- **O DOCX do RPCMTec copia a FORMATAÇÃO do documento da Divisão, medida no OOXML.** As constantes de `rpcmtec/rpcmtec_docx.js` (Calibri, 12pt no título e no cabeçalho e 10pt no corpo, preenchimento `DDD9C4`, borda de 1pt, recuo `-141`, página Letter com margem superior de 990) são valores LIDOS do documento real, não escolhas nossas: cada tabela tem de ser colável na subseção de mesmo número sem ninguém reformatar. Cada subseção tem GRADE DE COLUNA própria, porque elas não são proporcionais entre si. Só saem as subseções que o SCA preenche INTEIRAS; o que fica de fora está listado com o motivo no cabeçalho de `rpcmtec_ctrl.js` e aparece na tela, para ninguém procurar o que não existe.
- **Três números do RPCMTec só se provaram errados contra PRODUÇÃO, e a lição é essa.** Os três passavam nos testes e eram plausíveis na tela. (1) A **3.3 Extra-PIT** saiu do gerador: ela vinha de `previsto_pit = false`, que é FALSE por default na maioria dos pedidos. O Extra-PIT do RPCMTec é a exceção AUTORIZADA, e o SCA não guarda o que a distingue. (2) A **% da ASC passava de 100%** porque o numerador era o acervo inteiro, que tem folha de fora da área; hoje é recortado por `limites.area_suprimento`. (3) A **versão PLANEJADA entrava como produto entregue**: ela é promessa de produção e sua `data_edicao` é a data do cadastro. Corrigido em `integracaoCtrl.getProdutosFinalizados`, o que conserta junto a rota pública do vault da DGEO.
- **O Anuário Estatístico e o RTM saem de planilha-SEMENTE, e não são redesenhados.** Os arquivos reais estão versionados em `rpcmtec/modelos/`, com os dados removidos (no RTM, 1.628 linhas: elas traziam nome de OM e quantidade entregue, e este repositório é público). Gerar é abrir o ZIP, trocar só o valor das células dentro do `content.xml` e reescrever o resto byte a byte. Antes eram montados do zero e tinham os números certos **sem ser** o arquivo que a DSG confere linha a linha. No Anuário, TODA célula de valor é reescrita, inclusive as que dão zero: deixar de escrever uma deixaria ali o número da semente num relatório de outro mês, que é o modo de falhar mais perigoso desse arquivo. O casamento é por RÓTULO com contagem conferida (falha alto), e as fórmulas da semente viram valor de propósito: ela traz `Exército = SUM(RM:EE)`, e RM e EE são justamente as duas colunas que o SCA não sabe preencher. `utils/ods_export.js` ficou só com o ZIP (abrir e reescrever); o construtor de `.ods` do zero saiu em 2026-08-01 junto com o último chamador.
- **`GET /api/rpcmtec/rtm/ods` e `GET /api/mapoteca/relatorio/impressao_detalhada_ods` chamam o MESMO `gerarRtmOds`** e produzem arquivo idêntico (provado por hash): dois caminhos para o mesmo arquivo com formatos diferentes é a divergência que a fusão do RPCMTec existiu para acabar. O módulo do gerador só importa `utils`, então não há ciclo entre mapoteca e rpcmtec.

## Acervo

- **Produto que JÁ ESTÁ no volume entra por `POST /api/arquivo/catalogar/product`, e o servidor mede o hash.** Passar por `prepare-upload`/`confirm-upload` cobrava por um trabalho que não acontece: o cliente lia o arquivo inteiro para declarar o checksum e o `confirm-upload` lia tudo de novo para conferir uma cópia que nunca houve (362 GB relidos no LOTE_1 do Convênio RS, de 1h20 a 3h), **com essa releitura dentro da transação**, aberta por horas e sem retomada parcial. Agora o servidor lê UMA vez, fora de transação, e grava o checksum e o tamanho que ele mesmo mediu; o cliente não declara nenhum dos dois, e mandá-los é 400, porque descartado em silêncio ele acreditaria ter gravado o que mandou. É a mesma política do `/atualizar-checksum`. O `volume_armazenamento_id` vem no CORPO: no upload o volume é o primário do tipo de produto, porque o servidor escolhe para onde copiar, e aqui é onde o arquivo já está. **A rota só aceita volume com `layout_origem = true`**, e essa é a porta que a impede de virar atalho para pular a validação de transferência no acervo comum. Unicidade física, identidade do produto, sequência de versão e existência do arquivo continuam valendo. Junto veio a validação de travessia de caminho (`utils/caminho_volume.js`), que **não existia**: `path.join` não protege contra `..`. Só cobre produto novo; versão e arquivo avulsos continuam no `prepare-upload`.

- **A LÁPIDE do arquivo excluído mora num módulo só, e o vínculo com o download casa por `uuid_arquivo`, nunca por ordem.** Excluir no acervo copia o arquivo para `acervo.arquivo_deletado` e leva os downloads dele junto. Esse bloco de ~55 linhas, com 21 colunas escritas à mão, estava copiado em TRÊS lugares (`deleteArquivos`, `deleteVersoes`, `deleteProdutos`), e só o primeiro tinha teste — por uma rota, que provava a contagem e não as colunas. Acrescentar coluna a `acervo.arquivo` exigia lembrar dos três, e esquecer um não dá erro: a lápide nasce com o campo nulo e a falta só aparece quando alguém for procurar o dado. Hoje é `arquivo/arquivo_deletado.js`, na feature dona de `acervo.arquivo`, pelo mesmo desenho de `mapoteca/query_fragments.js`. Como todo dado da lápide sai da PRÓPRIA `acervo.arquivo`, virou `INSERT ... SELECT` com CTE: apagar um produto com 400 arquivos era **2.000 idas ao banco dentro de uma transação, e passou a 4**, independente da quantidade. O pareamento download → lápide usa `RETURNING id, uuid_arquivo` casado com `acervo.arquivo.uuid_arquivo` (que é UNIQUE), e **não** a ordem em que o banco devolve os ids: por ordem funcionaria hoje e trocaria os downloads de dois arquivos no dia em que o plano mudasse, sem erro nenhum e com as contagens ainda batendo. É o caso que `__tests__/integration/exclusao_acervo.test.js` guarda, com quantidades diferentes de download por arquivo justamente para que a troca apareça.

## Rastreabilidade das alterações (2026-08-02)

O que muda uma decisão de quem escreve código (o resto vive nos comentários de `er/auditoria.sql` e
de `server/src/auditoria/`, que são o lugar em que ninguém deixa de ler):

- **`auditoria.evento` é UMA tabela para os três módulos, e o rastro nasce no BACKEND.** Decisão do
  chefe, repetida em 2026-07-30 e 2026-08-02: o gatilho não conhece o usuário da sessão HTTP, porque
  o Postgres vê a conexão do pool. Substitui `mapoteca.pedido_auditoria`, cujo `pedido_id NOT NULL`
  amarrava o histórico ao pedido. O preço de não ter gatilho é a rota nova que esquece de auditar, e
  quem cobra é um teste de varredura por módulo, que lê o router de verdade.
- **`auditoria` é o único schema sem `UPDATE` e sem `DELETE` para o usuário da aplicação.** Uma
  trilha que a própria aplicação reescreve não prova nada. O preço é que expurgo, se um dia for
  decidido, exige o dono do banco em vez de uma rota. **Não há expurgo automático e a tabela não
  nasce particionada**: expurgo automático falharia exatamente quando o rastro é procurado, que é ao
  perguntar sobre mudança antiga. **Pendente de confirmação da chefia**, e a resposta precisa vir
  antes de a tabela crescer, porque particionar depois custa migração de dados.
- **Escrever é `auditoriaCtrl.registrar(t, {...})`, DENTRO da transação da mudança.** Falhar ao
  auditar derruba a escrita, e é deliberado: trilha que se perde em silêncio é pior do que trilha
  nenhuma, porque quem a lê acredita nela. `modulo`, `entidade` e `entidade_id` **não** são passados
  pelo chamador, saem do mapa: dois controllers escrevendo na mesma tabela com entidades diferentes
  seria divergência que nada acusa.
- **`auditoriaCtrl.lerAntes` SUBSTITUI o `SELECT id` que só existia para o 404**, e lança o mesmo
  `AppError`. Não é uma consulta a mais: se fosse, o rastro custaria uma ida ao banco em cada uma das
  ~20 funções que seguem esse padrão.
- **`server/src/auditoria/mapa/` é a única declaração de o que se audita**, um arquivo por módulo
  (são ~60 tabelas, e um arquivo só faria dois trabalhos paralelos colidirem). Tabela auditada que
  não está lá é **erro em tempo de execução**, e não evento com módulo vazio. Duas marcas existem
  porque a varredura confere tudo contra os `er/*.sql`: **`sintetico: true`** no campo que o
  controller monta e a tabela não tem (a lista de itens do DFD, o rateio da NE), e
  **`pseudoTabela: true`** na entrada que é alvo de evento de OPERAÇÃO e não descreve linha nenhuma
  (visões materializadas, verificação de volume). Sem as marcas, ou o teste reprova o caso legítimo,
  ou afrouxá-lo deixaria passar o erro de digitação num nome de coluna, que é o que ele pega.
- **A ORDEM é diff primeiro, sanitização depois.** É o que faz a troca de senha aparecer como
  `campos_alterados: ['senha']` com os dois valores nulos. Sanitizar antes apagaria a mudança
  (nulo comparado a nulo não acusa nada), e "trocaram a senha de alguém" deixaria de aparecer.
- **Três coisas NUNCA entram no JSON, e quem as tira é `sanitizar.js`, não o chamador**: o hash da
  senha (declarado em `omitir`, senão haveria uma segunda cópia da credencial numa tabela que ninguém
  pensa como guardadora de senha), o `conteudo` BYTEA dos anexos (que dobraria o armazenamento a cada
  anexo trocado) e valor acima do teto de 8 kB, que vira resumo. Quem esquece de excluir uma vez
  vaza para sempre, e o vazamento só aparece quando alguém abrir a tela. **O teto de 8 kB está
  pendente de confirmação da chefia**: acima dele o estado anterior de uma folha de recorte irregular
  deixa de ser recuperável, e subir o teto depois não recupera o que já foi gravado resumido.
- **O DIFF SAI PRONTO DO SERVIDOR, e o cliente não traduz nada.** São ~60 tabelas auditadas e ~25
  domínios; a tela de rastreabilidade mistura os três módulos numa página só, e precisaria de todos
  os catálogos, inclusive dos módulos que a pessoa não usa (o orçamento não guarda catálogo nenhum no
  cliente). `renderizar.js` devolve `mudancas` com rótulo em português e os dois valores em texto.
  **Domínio traduz; FK para ENTIDADE não**, e sai o id: o nome do cliente pode ter mudado depois do
  evento, e mostrar o nome de hoje ao lado de um valor de um ano atrás afirma algo que pode ser falso.
- **Campo não declarado NÃO some da tela**: aparece com o nome de coluna e marcado. Um mapa que
  silencia o desconhecido esconde justamente o campo que ninguém está olhando.
- **O que corrigiu o defeito que originou o trabalho**: a tela do pedido mostrava
  `campos_alterados.join(', ')`, ou seja o nome da coluna do banco, enquanto `dados_antes` e
  `dados_depois` chegavam na resposta e eram jogados fora. Hoje a linha diz
  `Situação: Em produção → Concluído`, sem clique. O componente é `components/historico/`, usado por
  todas as fichas; o `NOME_TABELA` que vivia na tela do pedido morreu junto, porque o `resumo` vem do
  servidor, que conhece as dezenas de tabelas auditadas, e não de um mapa de quatro chaves.
- **O detalhe abre em MODAL, e não em linha que se expande.** O `createDataTable` não tem linha
  expansível nem `onRowClick`, e acrescentar isso a um componente usado por dezenas de telas não é
  proporcional. Na ficha do produto, que já é modal, a LISTA é seção e só o DETALHE empilha.
- **`services/rastreabilidade-service.js` é próprio, e não um bloco em `plataforma-service.js`.** São
  três funções consumidas por seis fichas de módulos diferentes; a fábrica de mock do
  `plataforma-service` já lista dezenas de nomes, e toda tela que mostrasse histórico teria de
  mantê-la em dia por causa dessas três.
- **`#/rastreabilidade` tem guarda PRÓPRIA (`verifyRastreabilidade`), e não é `verifyPerfil` nem
  `verifyAdmin`.** O `verifyPerfil` lê um módulo por vez, e esta tela mistura os três; o
  `verifyLogin` lê `administrador` do TOKEN, que envelhece por até 8 horas, e esta é justamente a
  tela que mostra quem promoveu quem. O recorte (administrador vê tudo, gerente vê o módulo dele) é do
  SERVIDOR: recorte de cliente seria sugestão.
- **O nome não é "auditoria", e isso é deliberado.** `#/acervo/auditoria` já existe e quer dizer
  outra coisa: os invariantes, que medem a coerência do acervo HOJE e não dizem quem produziu a
  incoerência. Nem é `#/acessos`, que registra quem ENTROU e não o que a pessoa fez depois.
- **O `cliente` (`sca_web`/`sca_qgis`) passou a ser assinado no JWT**, e é o que dá a coluna `origem`.
  Ele PODE entrar, ao contrário dos perfis, porque é imutável para aquele token. Token anterior à
  mudança fica com `origem = 'desconhecido'` por até o `JWT_EXPIRACAO`: adivinhar por `User-Agent`
  seria pior do que dizer que não se sabe.

## Auditoria dos invariantes na web (2026-08-02)

O motor é o de sempre (`acervo/invariantes.js`, `GET /api/acervo/auditoria`, `verifyPerfil('gerente')`).
O que entrou foi a TERCEIRA porta para ele: `#/acervo/auditoria`. As outras duas, o CLI
(`acervo auditar`) e o diálogo do QGIS, exigem instalar alguma coisa, e gerente que só usa o
navegador não tinha como ver o estado do acervo.

- **`4a`, `4f` e `4g` acusavam DEFECT em TODO tileserver, e nada acusava isso.** `er/acervo.sql`
  EXIGE por CHECK que `tipo_arquivo_id = 9` tenha `checksum`, `tamanho_mb` e `volume_armazenamento_id`
  nulos — era um DEFECT impossível de zerar, porque zerá-lo violaria o schema. O `7a` e o `7b` já
  traziam o `<> 9`; os três vieram do script do vault sem ele. Depois do filtro, `4a` e `4g` vivem em
  ZERO como o `3c` (o CHECK impede o caso real), e o teste que documenta isso é o que impede alguém
  de "limpar" os dois achando que pararam de olhar. O `4f` continua provocável: o CHECK só exige
  `tamanho_mb` NOT NULL, e zero passa por ele.
- **"Planejada COM arquivo" não é defeito, e por isso o invariante é o INVERSO.** Dar arquivo a uma
  Planejada é o caminho de conclusão de `POST /api/arquivo/upload-web/arquivos`, que **não muda o tipo
  da versão** de propósito. Um invariante escrito como pedido ("planejada com arquivo") acusaria toda
  folha concluída pela web e nunca zeraria. O que ficou é `3j` REVISAR: promessa VENCIDA, com
  `data_edicao` no passado e ainda sem arquivo nenhum.
- **O `3i` mede a SÉRIE, que é o que o `3c` e o `3d` não enxergam.** Os dois olham uma versão isolada;
  a 2ª Edição datada antes da 1ª passa nos dois. O ordinal é o inteiro à esquerda do rótulo, e serve
  aos dois formatos que `acervo.validate_version` aceita. Particiona por SUBTIPO porque o produto
  civil abrange T34-700(2) e ET-RDG(12) nas versões: são duas séries no mesmo registro, e compará-las
  entre si acusaria erro onde há duas numerações independentes. **Conta VERSÃO, e não PAR**: o
  auto-join produz uma linha por (maior, menor), então uma 1ª Edição com a data errada acusava uma
  vez para CADA edição posterior, e um único registro errado virava "3 ocorrências" num invariante
  cuja regra é dar zero. O `distinct on (maior.id)` com `order by menor.data_edicao desc` deixa uma
  linha por versão, trazendo o pior infrator. O `versao_id` é o da MAIOR e nem sempre é o registro
  errado (quando a menor está no futuro, a maior só denuncia): por isso as duas edições e as duas
  datas saem no resultado, e quem tria decide qual corrigir.
- **O `4h` (par raster/PDF da carta) nasceu REVISAR, e a promoção a DEFECT é commit próprio.** Ninguém
  mediu quantas folhas do acervo legado têm só um dos dois, e DEFECT que não zera envenena a auditoria
  inteira (a lição do `3f` e do `1i`). Só conta `tipo_arquivo_id` 1 e 2: um PDF cadastrado como
  Documentos(6) contaria como se o PDF da carta existisse, e a falta sumiria.
- **Abrir a tela NÃO mede nada, e o filtro de severidade é do CLIENTE.** São dezenas de consultas numa
  transação só, o controller materializa TODAS as linhas de cada invariante para depois fatiar a
  amostra, e o `7a` deriva o nome padrão de cada arquivo do acervo. Rodando na montagem, um clique
  errado na sidebar custava uma auditoria inteira e voltar de outra tela custava outra; hoje só o
  botão mede. O servidor aceita `?severidade=`, e a tela não usa, porque de lá o custo é pago de novo
  a cada clique no combo. **O último resultado sobrevive à troca de tela, DATADO** ("Medido às
  10:52"): guardar não é cachear, e a hora ao lado do número é o que impede o modo de falhar caro
  desta tela, que é mostrar a contagem de antes da correção para quem acabou de corrigir. E **só
  pinta a linha que TEM ocorrência**: um DEFECT com zero é boa notícia, e pintá-lo faria a tela
  parecer cheia de problema no dia em que o acervo está limpo. As colunas da amostra saem do PRÓPRIO
  resultado, como no diálogo do plugin: uma tabela fixa esconderia justamente a coluna que explica a
  ocorrência.
- **O teste da rota entra com token de ADMINISTRADOR, e por isso um caso prova a guarda de perfil.**
  A rota é `verifyPerfil('gerente')`; o administrador global passa em qualquer módulo pela flag, então
  trocá-la para `verifyAdmin` não quebraria nenhum dos outros 40 casos, e o gerente perderia a tela
  em silêncio. É a mesma classe de defeito do 403 da mapoteca: o usuário da semente tinha perfil
  demais e o caso real nunca aparecia. O caso troca o perfil do `test_user` no acervo e o devolve,
  provando os dois lados — operador leva 403, gerente entra.

## Escrita do acervo pela interface web (2026-08-01)

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

## Plugin da mapoteca

- **O plugin é um cliente do MÓDULO mapoteca, e nenhuma rota dele é do acervo.** A permissão segue o módulo do TRABALHO, e não o do dado: quem imprime tem operador na mapoteca e pode não ter perfil nenhum no acervo. O par prepare/confirm do download fechava em `POST /api/acervo/confirm-download`, que é `verifyPerfil('consulta')` sem módulo — ou seja, consulta no ACERVO. Esse usuário chegava ao fim de um download bem-sucedido e levava 403: os PDFs ficavam na pasta, os tokens ficavam `pending` e `acervo.cleanup_expired_downloads()` os marcava como `failed` 24h depois, então o histórico registrava falha em toda impressão que dera certo. Hoje é `POST /api/mapoteca/impressao/confirmar_download`, com `verifyPerfil('operador','mapoteca')` e **o mesmo `acervoCtrl.confirmDownload`**: `acervo.download` é uma tabela só, e duas implementações de "confirmar download" divergiriam na primeira coluna nova. O teste guarda o 403 da rota gêmea de propósito — o `test_user` da semente tem perfil nos dois módulos, e por isso o caso real nunca aparecia.
- **A tela lê a FILA (`/pedido/em_aberto`), e não a lista de pedidos.** `GET /api/mapoteca/pedido` passou a filtrar pelo ano de contexto do módulo (o `ano` da query cai no ano corrente quando não vem), e o plugin não tem seletor de ano: pelo caminho antigo, o pedido de dezembro ainda aberto em janeiro sumia da tela sem aviso nenhum. Junto saiu a constante `SITUACOES_INATIVAS = {5, 6}` que vivia em Python: a régua do que é trabalho de quem imprime é `SITUACOES_EM_ABERTO` em `query_fragments.js`, e a cópia já estava dois commits atrás (mostrava Remetido e Aguardando produção, tirados da fila em 2026-07-31 e 2026-07-30).
- **O item AVULSO não é "item sem PDF", e a resposta do prepare diz qual é qual.** Os dois chegam em `itens_sem_pdf`, e o operador os trata de formas opostas: o avulso (papel quadriculado, carta de outro CGEO) nunca terá arquivo no acervo e se imprime do original; o item do acervo sem PDF é uma falta de verdade, que alguém tem de carregar. Anunciados com a mesma frase, mandavam procurar o que não existe. Por isso `item_avulso` e `avulso_descricao` saem no `map()` de `prepareDownloadImpressao`, e o manifesto CSV lista o pedido INTEIRO, e não só o que veio por download — um manifesto que só mostra o baixado esconde justamente as linhas que exigem atenção.
- **`core/api_client.py` é gêmeo do arquivo de mesmo nome em `ferramentas_acervo/`, com duas diferenças deliberadas:** o default de `pode()` é `mapoteca`, e aqui não existe o cache de `core/dominios.py`, cujas rotas são todas do acervo (`gerencia/dominio/*`, `projetos/*`, `volumes/*`) e voltariam 403 para este usuário. Correção de comportamento (thread da mensagem de erro, re-login, timeout) vale para os dois — o guarda de thread do `show_error` já esteve só num deles.

## Dependências e ambiente de teste

- **Pacote ESM puro entra no servidor por `require()`, e no Jest por dublê mapeado.** O servidor é CommonJS, e `serialize-error` (usado por `utils/app_error.js`, ou seja, por quase tudo) é ESM puro desde a versão 9. Ele era carregado por `import()` dinâmico, e isso **impedia a suíte inteira do servidor de rodar**: dentro do contexto de VM do Jest o `import()` exige `NODE_OPTIONS=--experimental-vm-modules`, e com essa flag o Jest 30 no Node 24 quebra antes, em `ERR_VM_MODULE_NOT_MODULE`. Hoje `utils/serialize_error_loader.js` tenta `require()` primeiro (o Node aceita `require()` de ESM sem flag desde a 22.12) e só cai no `import()` se der `ERR_REQUIRE_ESM`. No Jest, `moduleNameMapper` aponta para um dublê CJS em `__tests__/helpers/`. **Não devolva a flag aos scripts de teste**: ela é a causa, não a cura. Ao acrescentar dependência ESM pura, siga este par.
- **A suíte do servidor tem DOIS pacotes, e um banco POR WORKER do Jest.** Até 2026-08-01 era `jest --runInBand`: 366 segundos para qualquer mudança, porque os 28 arquivos que usam PostgreSQL compartilhavam um `sca_test` só e o `cleanTestData()` faz TRUNCATE nas tabelas inteiras — dois workers em paralelo apagariam os dados um do outro, com falha intermitente em arquivo que ninguém tocou. Hoje o `globalSetup` monta um banco-TEMPLATE e clona `sca_test_1..N` dele (`CREATE DATABASE ... TEMPLATE` é cópia de arquivo; rodar os `er/*.sql` N vezes sairia mais caro que serializar), e `worker_db.js` escolhe o banco de cada worker por `JEST_WORKER_ID`, antes de qualquer `require` do config. Resultado: `test:rapido` 3s, `test:banco` 181s. **Quem entra em qual pacote sai de LER O FONTE** (`require` de `helpers/db` ou de `helpers/app`), e não de uma lista: lista seria cópia. São os DOIS sinais porque o `getApp()` de `helpers/app` também chama `db.createConn()` — `routes/auth.test.js` usa só o segundo, e com um sinal só ele caiu no pacote rápido e derrubou o worker em vez de falhar com asserção. O piso hoje é o `routes/mapoteca.test.js`, que sozinho leva 179s.
- **Teste de schema prova o MOTIVO da recusa, nunca só que houve recusa.** `expect(error).toBeDefined()` passa quando o fixture quebra por outro campo, então a regra do título deixa de ser guardada sem ninguém notar: medido no schema de arquivo em 2026-08-01, onde o caso do tileserver passava igual com o `nome` quebrado. O helper é `__tests__/helpers/joi.js` (`recusaPor(resultado, campo, tipo)` / `aceita(resultado)`), e ele confere `error.details[0]`, que com o `abortEarly` do Joi é o PRIMEIRO erro — é isso que separa "recusou pela regra" de "recusou por acidente". Na conversão, 177 casos viraram 116, e o reforço achou três coisas que ninguém sabia: `arquivos_ids: []` é recusado por `array.includesRequiredUnknowns` e não pelo `.min(1)` que está no schema; `versaoRelacionamento` usa a outra construção e dá `array.min`; e a UNIQUE da NC responde 409, não 400.
- **O que é mockado NÃO se testa de novo contra o banco.** O módulo orçamento roda contra `helpers/orcamento/mockDb`, e isso prova o mapeamento de parâmetro (`nota_empenho_id` → `notaEmpenhoId`, bug real com o `$<param>` do pg-promise) e nada sobre a consulta: `expect.stringContaining('INSERT INTO orcamento.rpnp')` passa com o SQL inteiro quebrado. Até 2026-08-01 nenhum SQL do módulo era executado em teste nenhum. O `integration/orcamento.test.js` fecha a lacuna cobrindo **só o que exige banco de verdade**: as regras que vivem dentro de `db.conn.tx` com agregação lida do banco (o teto da liquidação, a soma das alocações da NE), a tradução de UNIQUE e FK do PostgreSQL para status legível, e o encadeamento NC → NE → liquidação. Validação Joi e 404 de id inexistente continuam no pacote mockado, que roda em milissegundos: repetir ali só deixaria a suíte lenta.
- **O rate limit é desligado sob `NODE_ENV=test`.** São 200 requisições por minuto, e a suíte passa disso no meio do arquivo de rotas da mapoteca. O efeito ruim não era falhar, era fazer falhar um teste **que não mudou**, só porque um teste novo entrou antes dele no mesmo minuto: a suíte passava a depender de ordem e de relógio.
- **`archiver` fica na 7, e os `overrides` do `server/package.json` são o que zera a auditoria.** NUNCA rode `npm audit fix --force` aqui. Ele sobe o `archiver` para 8, que é **ESM puro e não exporta mais função chamável**: as classes `Archiver`/`ZipArchive` substituíram `archiver('zip', ...)`, e as duas exportações em ZIP quebram no boot. Medido em 2026-07-27. As 7 vulnerabilidades da subárvore vinham todas de `brace-expansion`, então os `overrides` corrigem a raiz sem tocar na API. O `readdir-glob` precisa de override próprio (`minimatch` ^10.2.5) porque o `minimatch` 5 faz `require('brace-expansion')` esperando a função direta, e a versão 5 exporta `{ expand }` nomeado: sem esse segundo override, o `npm audit` diz "0 vulnerabilities" com o `archive.glob()` quebrado. Quem cobre isso é `acervo_zip_ctrl.test.js`, que abre o ZIP e descomprime, em vez de conferir o tipo do retorno.

