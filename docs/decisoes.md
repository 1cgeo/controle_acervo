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

- **`/api/integracao/*` não tem autenticação.** Somente leitura, para o vault da DGEO consumir o SCA
  sem credencial; expõe cobertura, produtos concluídos no mês e o agregado da mapoteca, sem endereço,
  contato nem observação de impressão.
- **`GET /api/mapoteca/pedido/localizador/:localizador` não tem autenticação.** É o acompanhamento
  pelo próprio cliente, que não tem conta. Já foi fechada por engano numa classificação automática.
- **`/logs` não tem autenticação, e o CORS aceita qualquer origem.** O sistema roda em rede interna.
- **Credencial de banco na URI de camada do QGIS.** O plugin conecta direto no PostgreSQL; é para isso
  que existe o papel somente leitura (`DB_USER_READONLY`).
- **A grade do PIT usa `verifyGerente`, e `#/rastreabilidade` usa `verifyRastreabilidade`.** Não é
  `verifyPerfil`, que lê um módulo por vez e estas telas não são de módulo nenhum; nem `verifyLogin`,
  que lê o `administrador` do TOKEN, envelhecido até o `JWT_EXPIRACAO`. O recorte é do SERVIDOR: no
  cliente seria sugestão.
- **O rate limit é dimensionado para CLIENTE DE LOTE, não para navegador.** Um teto de tela partiria
  ao meio uma carga do `acervo_cli` com 429, deixando parte das versões migradas e parte não.

## O SCA absorve o não-produção do SAP

- **A fusão é por ADIÇÃO aqui, e não por remoção lá** (chefe). Na transição há duas cópias vivas de
  cada fato, e o banco não as reconcilia: a divergência é possível e esperada.
- **O critério para trazer uma subseção é não depender de `macrocontrole`, e não "está no SAP".** Por
  isso **a 2.5 (atividades de campo) não veio**: `controle_campo` referencia `macrocontrole.produto`.
- **A 2.1 sai INTEIRA do SCA, inclusive as metas de produção.** Meia tabela de cada sistema obrigaria
  quem a cola a descobrir todo mês quais linhas vêm de onde.
- **Os códigos dos domínios novos e as grades de coluna do DOCX são os do SAP.** A linha migrada não
  precisa de tabela de tradução, e divergir na grade faria a mesma subseção sair de dois tamanhos.
- **`pit.demanda_extra` não tem `lote_id`, ao contrário do SAP.** Lá ele evita a 2.1 contar duas
  vezes; aqui não há o que descontar, e apontar `acervo.lote` inventaria um vínculo que não existe.

## PIT e Extra-PIT

- **`pit.meta` guarda em COLUNAS o que o PIT promete, e elas nascem NULAS.** Separar o texto legado de
  `descricao` por expressão regular erra calado onde há ponto na escala e separador de milhar, e
  quantidade errada vira porcentagem errada no relatório que o chefe assina.
- **Não existe coluna de "nome da meta":** a linha de cabeçalho (`item` nulo) já é esse nome.
- **Só a meta-FOLHA recebe lançamento.** Lançar no cabeçalho contaria o total duas vezes, e as duas
  contas continuariam "certas" cada uma por si.
- **`pit.execucao` é lançamento MANUAL para toda meta, e não há coluna de origem**, porque não há o
  que calcular enquanto o SAP não entrar. **Custo aceito:** a meta 4 o SCA já sabe somar por
  `mapoteca.pedido.meta_pit_id`, e quando o digitado divergir a 2.1 e o RTM vão se contradizer.
- **O planejado é COLUNA de `pit.execucao`, e não tabela irmã.** As duas abas da planilha da Divisão
  têm as mesmas linhas e os mesmos doze meses; duas tabelas repetiriam a chave (meta, mês) e deixariam
  a comparação, que é a razão de as duas existirem, a um JOIN de distância.
- **O planejamento é MENSAL, e a soma dos doze tem de bater com a quantidade do ano.** A tela acusa
  quando não bate; `quantidade_prevista` sozinha não diz em que mês a entrega foi prometida.
- **`pit.execucao.quantidade` não tem NOT NULL.** A linha nasce com o plano, então NULO é "ninguém
  lançou" e zero é "conferi e não houve"; com NOT NULL, planejar um mês gravaria um realizado zero e a
  2.1 afirmaria que se conferiu e não houve entrega. Um CHECK recusa os quatro campos nulos.
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

- **O RPCMTec é UM gerador só, fora dos três módulos, com guarda `verifyAdmin`.** É o relatório da
  DIVISÃO e o chefe assina uma edição só; gerado em dois lugares, alguém colava um DOCX no outro todo
  mês. Não é `verifyPerfil` porque ele traz valor de crédito, empenho e liquidação.
- **A execução por ND do painel NÃO foi junto:** é `/api/orcamento/dashboard/execucao_nd`, com
  `verifyPerfil('consulta','orcamento')`. O painel pede números quebrados em PDR e Extra-PDR, e servir
  os dois da mesma rota faria a guarda mais fraca valer para as duas.
- **O SCA gera 18 subseções (2.1, 2.6, 2.7, 3.1 a 3.4, 4.1 a 4.7, 6.1, 6.2, 7.2 e 7.3);** ficam no SAP
  a 2.2 a 2.5, que leem a PRODUÇÃO. **As três linhas de total da 2.6 não saem**: o desenhador daqui
  não tem rodapé de tabela, e emiti-las como linha comum daria um total alinhado errado.
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

## Auditoria e rastreabilidade

- **`auditoria.evento` é UMA tabela para os três módulos, e o rastro nasce no BACKEND** (chefe). O
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
- **O DIFF SAI PRONTO DO SERVIDOR, e o cliente não traduz nada.** A tela mistura os três módulos e
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
- **A LÁPIDE do arquivo excluído mora num módulo só, e o vínculo com o download casa por
  `uuid_arquivo`, NUNCA por ordem.** Copiado em três lugares, esquecer um não dava erro: a lápide
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
- **A sidebar tem CINCO seções de sistema, e duas não são módulos** (chefe): **Produção** e **Efetivo**
  vêm depois dos três, nessa ordem porque a primeira fala do TRABALHO. A rota `#/usuarios` NÃO mudou
  junto com o rótulo "Efetivo", senão link guardado quebraria. **Produção não leva `admin: true` e o
  item Capacitação leva**, porque o servidor cobra administrador só na escrita das metas, e a
  capacitação inteira é `verifyAdmin`.
- **A troca de módulo mora na SIDEBAR, não num dropdown na navbar** (chefe), e a sidebar é montada uma
  vez e **nunca se desmonta**, senão entrar numa rota de plataforma apaga o menu do módulo.
- **O administrador global não é coluna da tabela de usuários.** Ele é propriedade da pessoa; uma
  coluna por módulo sugeriria que existe administrador de módulo, que é o que o modelo não tem.
- **A administração do acervo é UMA tela com abas (`#/acervo/administracao`).** São cadastros que se
  leem juntos, e quatro itens na sidebar dariam quatro telas de uma linha cada; só a aba ativa fica no
  DOM, senão abrir a tela dispararia as quatro cargas. A rota pede **operador**, porque
  `GET /volumes/volume_armazenamento` é operador no servidor e com consulta a tela abriria só para
  mostrar erro; editar é operador e **excluir é gerente**.
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
  **filtra o que já aconteceu**. Ficam sem ano os **clientes** (cadastro, não movimento) e o
  **estoque** (saldo de hoje). Custo deliberado: o pedido de dezembro concluído em janeiro só aparece
  trocando o ano.
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
