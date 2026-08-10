BEGIN;

-- ---------------------------------------------------------------------------
-- Metadado: o que a ficha ET-PCDG imprime e o que o XML de metadado publica
-- ---------------------------------------------------------------------------
--
-- Este schema nao guarda producao nem acervo. Ele guarda o que a NORMA exige
-- que acompanhe o dado quando ele sai da Divisao: resumo, proposito, creditos,
-- grau de sigilo, restricao de uso, datum vertical, especificacao tecnica,
-- responsavel por cada fase, PEC planimetrico e altimetrico, sensor da
-- ortoimagem. Nada disso e derivavel do acervo, e nada disso e opinional: sao
-- os campos da ISO19115 na perfilagem da PCDG.
--
-- Duas saidas leem daqui, e so elas:
--   1. A FICHA ET-PCDG, o quadro impresso na moldura da carta.
--   2. O XML DE METADADO que viaja junto com o produto entregue.
--
-- VEIO DO SAP 2.3.5 (schema `metadado`, 16 tabelas), na travessia de
-- 2026-08-09. A adaptacao tem tres cortes, e todos vem do contrato daqui:
--
--   1. `produto_id`, que apontava `macrocontrole.produto`, virou `versao_id`
--      apontando `acervo.versao (id)`. O produto do SAP e a VERSAO do acervo,
--      e nao o produto do acervo: metadado descreve uma EDICAO especifica, e a
--      mesma folha reeditada em outro ano tem outro resumo, outra data de
--      criacao e outro responsavel. Decisao do chefe, 2026-08-09.
--   2. `lote_id`, que apontava `macrocontrole.lote`, aponta `acervo.lote (id)`.
--      Decisao do chefe, 2026-08-09: a producao liga direto no lote do acervo,
--      e a `producao.lote_linha` que este arquivo apontou por algumas horas foi
--      removida pela mesma decisao, antes de chegar a banco nenhum.
--
--      O QUE ISSO CUSTA E O AVISO DESTE SCHEMA: um lote do acervo carrega mais
--      de uma linha de producao (carta e CDGV no mesmo lote, em 61 dos 102
--      lotes com versao, medido em 2026-08-09), e o metadado de nivel LOTE
--      passou a valer para as duas. Quando a ficha da carta e a do CDGV
--      divergirem -- e elas divergem em especificacao, em PEC e em datum
--      vertical --, declare no nivel da VERSAO, que sobrescreve o do lote. O
--      XOR de `versao_id` e `lote_id`, explicado mais abaixo, e o que torna
--      isso possivel, e passou a ser a unica saida para essa diferenca.
--   3. `metadado.usuario.usuario_sap_id` virou
--      `usuario_uuid UUID REFERENCES dgeo.usuario (uuid)`, que e como todo o
--      SCA aponta gente.
--
-- NAO HA GEOMETRIA NESTE SCHEMA, e por isso a regra do SRID 4674 nao tem onde
-- morder aqui. A extensao de um produto sai de `acervo.produto.geom`, que ja
-- esta em 4674.
--
-- CARREGA DEPOIS DE `dgeo`, DE `acervo` E DE `producao`: aponta
-- `dgeo.usuario (uuid)`, `acervo.versao (id)`, `acervo.lote (id)` e
-- `producao.fase (id)`.
--
-- TIPO DAS CHAVES: onde o SAP declarava INTEGER apontando uma coluna SMALLINT
-- de dominio, aqui a coluna e SMALLINT. O Postgres aceita a chave estrangeira
-- entre os dois, mas a divergencia so serve para confundir quem le e para
-- gastar dois bytes por linha sem motivo.
CREATE SCHEMA metadado;

COMMENT ON SCHEMA metadado IS
    'Metadado ISO19115 na perfilagem da PCDG. É a fonte da ficha ET-PCDG e do XML que viaja com o produto entregue.';

-- ---------------------------------------------------------------------------
-- Dominios da norma. Nao sao rotulos de tela.
-- ---------------------------------------------------------------------------
--
-- ATENCAO AO `nome` DESTAS QUATRO TABELAS: ele NAO e texto de interface, e nao
-- se traduz nem se acentua. O valor sai LITERAL para dentro do XML, onde a
-- ISO19115 espera exatamente 'ultraSecreto', 'intellectualPropertyRights' e
-- 'otherRestrictions', em camelCase e em ingles onde a norma assim os nomeia.
-- Trocar 'ostensivo' por 'Ostensivo' quebra o consumidor do XML sem quebrar
-- nada aqui dentro, e o erro so aparece do lado de quem recebe o produto.
--
-- Os codigos sao os do SAP, e essa e a regra da travessia inteira: linha
-- migrada nao precisa de tabela de traducao.

-- Tipos de palavra chave previstos na ISO19115 / PCDG.
CREATE TABLE metadado.tipo_palavra_chave(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO metadado.tipo_palavra_chave (code, nome) VALUES
(1, 'disciplinar'),
(2, 'geologica'),
(3, 'tematica'),
(4, 'temporal'),
(5, 'toponimica');

-- MD_ClassificationCode. O grau de sigilo do produto.
CREATE TABLE metadado.codigo_classificacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO metadado.codigo_classificacao (code, nome) VALUES
(1, 'ostensivo'),
(2, 'reservado'),
(3, 'confidencial'),
(4, 'secreto'),
(5, 'ultraSecreto');

-- MD_RestrictionCode. Serve a TRES colunas diferentes de `informacoes_produto`
-- (limitacao de acesso, limitacao de uso e restricao de uso), que a norma
-- separa e que a ficha imprime em linhas distintas.
CREATE TABLE metadado.codigo_restricao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO metadado.codigo_restricao (code, nome) VALUES
(1, 'copyright'),
(2, 'patent'),
(3, 'patentPending'),
(4, 'trademark'),
(5, 'license'),
(6, 'intellectualPropertyRights'),
(7, 'restricted'),
(8, 'otherRestrictions');

-- O referencial ALTIMETRICO do produto, que nao e o mesmo do horizontal.
--
-- O CODE 0 EXISTE E E LEGITIMO: produto sem altimetria (uma carta imagem, um
-- dado vetorial planimetrico) declara 'Sem datum vertical' em vez de mentir um
-- maregrafo. Por isso a coluna que o aponta e NOT NULL: a ausencia de datum
-- vertical e um valor, e nao um nulo.
CREATE TABLE metadado.datum_vertical(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO metadado.datum_vertical (code, nome) VALUES
(0, 'Sem datum vertical'),
(1, 'Datum de Imbituba - SC'),
(2, 'Datum de Santana - AP'),
(3, 'Marégrafo de Torres - RS');

-- A ESPECIFICACAO TECNICA que o produto cumpre, e nao o formato do arquivo.
--
-- E o que responde "contra qual regra este dado foi conferido". Nao confundir
-- com `dominio.subtipo_produto` do SCA, que tambem cita ET-EDGV e T34-700: la
-- e a natureza do produto no acervo, aqui e a norma declarada no metadado. As
-- duas coincidem quase sempre e nao sao a mesma coisa.
CREATE TABLE metadado.especificacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO metadado.especificacao (code, nome) VALUES
(1, 'ET-EDGV 2.1.3'),
(2, 'ET-EDGV 3.0'),
(3, 'T34-700'),
(4, 'ET-RDG');

-- ---------------------------------------------------------------------------
-- Quem responde pelo dado
-- ---------------------------------------------------------------------------

-- A ORGANIZACAO que aparece como responsavel e como distribuidora no XML.
--
-- SAO OS CINCO CGEO, e a tabela existe justamente porque o responsavel nem
-- sempre e o distribuidor: um produto levantado aqui pode ser distribuido por
-- outro Centro, e o XML exige os dois contatos completos, com endereco,
-- telefone e site.
--
-- ENDERECO POSTAL E SITE PUBLICO, e nao endereco de servidor: e o contato
-- institucional que a norma manda publicar junto com o dado, o mesmo que esta
-- na porta de cada Centro.
CREATE TABLE metadado.organizacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	sigla VARCHAR(255),
	endereco VARCHAR(255),
	telefone VARCHAR(255),
	site VARCHAR(255)
);

INSERT INTO metadado.organizacao (code, nome, sigla, endereco, telefone, site) VALUES
(1, '1º Centro de Geoinformação', '1º CGEO', 'Rua Cleveland, nº 250 Morro Menino de Deus - CEP:90.850-240 - Porto Alegre - RS', '(51)3232-0749', 'http://www.1cgeo.eb.mil.br/'),
(2, '2º Centro de Geoinformação', '2º CGEO', 'EPCT DF 001 - Km 4,5 Setor Habitacional Taquari - CEP:71.559-901 - Brasília - DF', '(61)3415-3853', 'http://www.2cgeo.eb.mil.br/'),
(3, '3º Centro de Geoinformação', '3º CGEO', 'Avenida Doutor Joaquim Nabuco, 1687 - CEP:53.240-650 - Olinda - PE', '(81)3439-3033', 'https://3cgeo.eb.mil.br/'),
(4, '4º Centro de Geoinformação', '4º CGEO', 'Avenida Marechal Bittencourt, 97 Santo Antônio - CEP:69.029-160 - Manaus - AM', '(92)3625-1461', 'https://4cgeo.eb.mil.br/'),
(5, '5º Centro de Geoinformação', '5º CGEO', 'Rua Major Daemon, 81 Centro - CEP:20.081-190 - Rio de Janeiro - RJ', '(21)2223-2177', 'http://www.5cgeo.eb.mil.br/');

COMMENT ON TABLE metadado.organizacao IS
    'Os cinco CGEO, com o contato que o XML publica. Responsável e distribuidor são colunas distintas em informacoes_produto porque nem sempre são a mesma OM.';

-- A IDENTIDADE PUBLICA DE UMA PESSOA NO METADADO, e nao uma segunda conta.
--
-- NAO E DUPLICATA DE `dgeo.usuario`, e a diferenca importa. `dgeo.usuario`
-- responde "quem entra no sistema": login, hash, posto, nome de guerra. Esta
-- tabela responde "que nome, que funcao e que OM saem impressos no XML" para
-- essa mesma pessoa. O nome aqui e o nome COMPLETO da assinatura, e a funcao
-- e o cargo declarado na ficha ('Chefe da Seção de Produção'), que muda sem
-- que a conta mude.
--
-- SEM UNIQUE em `usuario_uuid`, e e deliberado: a mesma pessoa pode assinar
-- como duas funcoes diferentes em produtos de anos diferentes, e o metadado
-- antigo tem de continuar dizendo o que dizia.
--
-- O `usuario_uuid` aponta `dgeo.usuario (uuid)` porque no SCA gente e UUID.
-- No SAP esta coluna se chamava `usuario_sap_id` e apontava um SERIAL.
CREATE TABLE metadado.usuario(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  nome VARCHAR(255) NOT NULL,
  funcao VARCHAR(255) NOT NULL,
  organizacao_id SMALLINT NOT NULL REFERENCES metadado.organizacao (code)
);

COMMENT ON TABLE metadado.usuario IS
    'O nome, a função e a OM que uma pessoa assina no metadado. Não é uma conta: a conta é dgeo.usuario, apontada por usuario_uuid.';

CREATE INDEX idx_metadado_usuario_usuario ON metadado.usuario (usuario_uuid);

-- QUEM RESPONDE POR CADA FASE DA PRODUCAO, no XML.
--
-- O XML nao pede um responsavel so: ele pede o responsavel da aquisicao, o da
-- restituicao, o da validacao. Uma linha aqui por fase.
--
-- O XOR ABAIXO E O MECANISMO CENTRAL DE TODO ESTE SCHEMA, e se repete em cinco
-- tabelas. Metadado se declara em DOIS niveis:
--   `lote_id` preenchido = vale para tudo o que aquele lote do acervo
--   entregar, em QUALQUER linha de producao dele. E o caso comum, e e o que
--   evita digitar a mesma ficha 60 vezes.
--   `versao_id` preenchido = vale para UMA edicao especifica, e sobrescreve o
--   nivel do lote.
-- O NIVEL DO LOTE ATRAVESSA LINHAS DE PRODUCAO, e e o aviso do cabecalho: o
-- mesmo lote entrega carta e CDGV, e a ficha dos dois nao e a mesma. Quando
-- divergirem, a declaracao desce para a versao.
-- O CHECK proibe os dois juntos e proibe os dois nulos: uma linha que nao diz
-- a quem se aplica nao e metadado de nada.
CREATE TABLE metadado.responsavel_fase_produto(
  id SERIAL NOT NULL PRIMARY KEY,
  -- `usuario_id` CONTINUA SENDO `usuario_id`, e continua INTEGER. A regra da
  -- travessia que troca `usuario_id` por `usuario_uuid` vale para quem aponta
  -- `dgeo.usuario`; esta coluna aponta `metadado.usuario`, que e a identidade
  -- publicada e nao a conta. Quem "consertar" isto quebra a assinatura da
  -- ficha.
  usuario_id INTEGER NOT NULL REFERENCES metadado.usuario (id),
  fase_id INTEGER NOT NULL REFERENCES producao.fase (id),
  versao_id BIGINT REFERENCES acervo.versao (id),
  lote_id BIGINT REFERENCES acervo.lote (id),
  CONSTRAINT responsavel_fase_produto_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL))
);

COMMENT ON TABLE metadado.responsavel_fase_produto IS
    'Responsável por uma fase, declarado por versão OU por lote do acervo, nunca pelos dois. O nome da tabela guarda "produto" por herança do SAP: o que ela aponta é acervo.versao.';

CREATE INDEX idx_responsavel_fase_versao ON metadado.responsavel_fase_produto (versao_id);
CREATE INDEX idx_responsavel_fase_lote ON metadado.responsavel_fase_produto (lote_id);

-- ---------------------------------------------------------------------------
-- O corpo do metadado
-- ---------------------------------------------------------------------------

-- A PALAVRA CHAVE, e ela e EXCLUSIVAMENTE de nivel versao.
--
-- E a unica tabela deste schema sem o XOR: nao existe palavra chave de lote, e
-- a ausencia e a regra. Toponimo e descricao sao por FOLHA, e o nome do
-- produto entra aqui como toponimo. Herdar a palavra chave do lote faria toda
-- folha do lote se descrever pelo mesmo lugar.
CREATE TABLE metadado.palavra_chave_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	tipo_palavra_chave_id SMALLINT NOT NULL REFERENCES metadado.tipo_palavra_chave (code),
	versao_id BIGINT NOT NULL REFERENCES acervo.versao (id)
);

COMMENT ON TABLE metadado.palavra_chave_produto IS
    'Palavra-chave do produto. Só existe no nível da versão: toponímia é por folha, e não por lote.';

CREATE INDEX idx_palavra_chave_versao ON metadado.palavra_chave_produto (versao_id);

-- O QUE O PRODUTO E, PARA QUE SERVE E DE QUEM E. E o bloco de identificacao do
-- XML e a parte de cima da ficha ET-PCDG.
--
-- `declaracao_linhagem` e o texto que conta COMO o dado foi feito, e e o campo
-- mais longo da ficha. Ele nao se calcula do fluxo de producao: e redigido.
--
-- `projeto_bdgex` e NOT NULL porque o XML sem ele nao e aceito na carga do
-- BDGEx, que e o destino de todo produto que sai daqui.
--
-- `responsavel_produto_id` e o responsavel GERAL, e nao substitui
-- `responsavel_fase_produto`: no XML sao papeis distintos.
CREATE TABLE metadado.informacoes_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT informacoes_produto_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	resumo TEXT,
	proposito TEXT,
	creditos TEXT,
	informacoes_complementares TEXT,
	limitacao_acesso_id SMALLINT NOT NULL REFERENCES metadado.codigo_restricao (code),
	limitacao_uso_id SMALLINT NOT NULL REFERENCES metadado.codigo_restricao (code),
	restricao_uso_id SMALLINT NOT NULL REFERENCES metadado.codigo_restricao (code),
	grau_sigilo_id SMALLINT NOT NULL REFERENCES metadado.codigo_classificacao (code),
	organizacao_responsavel_id SMALLINT NOT NULL REFERENCES metadado.organizacao (code),
	organizacao_distribuicao_id SMALLINT NOT NULL REFERENCES metadado.organizacao (code),
	datum_vertical_id SMALLINT NOT NULL REFERENCES metadado.datum_vertical (code),
	especificacao_id SMALLINT NOT NULL REFERENCES metadado.especificacao (code),
	responsavel_produto_id INTEGER NOT NULL REFERENCES metadado.usuario (id),
	declaracao_linhagem TEXT,
	projeto_bdgex VARCHAR(255) NOT NULL
);

COMMENT ON TABLE metadado.informacoes_produto IS
    'Bloco de identificação do XML: resumo, propósito, créditos, sigilo, restrições, datum vertical, especificação e linhagem. Por versão OU por lote do acervo.';

-- UNICO, E NAO SO INDICE. O `xor_lote` acima garante que cada linha aponta UMA
-- versao ou UM lote; o que faltava era impedir a SEGUNDA linha para o mesmo
-- alvo. Sem isto, dois POST para o mesmo lote faziam `oneOrNone` em
-- `metadado_ctrl.js` estourar `Multiple rows were not expected`, e o XML e o JSON
-- de edicao de TODA versao daquele lote passavam a responder 500 -- com a causa
-- mascarada, porque o envelope do 500 troca a mensagem por "Erro no servidor".
-- Uma linha a mais numa tabela de configuracao derrubava a saida do lote inteiro.
--
-- NULL NAO CONFLITA COM NULL no indice unico do PostgreSQL, entao a coluna que o
-- `xor_lote` deixa vazia nao atrapalha: as linhas por lote tem `versao_id` nulo e
-- convivem todas no indice de versao, e vice-versa.
CREATE UNIQUE INDEX idx_informacoes_produto_versao ON metadado.informacoes_produto (versao_id);
CREATE UNIQUE INDEX idx_informacoes_produto_lote ON metadado.informacoes_produto (lote_id);

-- O QUADRO DE CREDITOS DA MOLDURA, guardado como QPT.
--
-- QPT e o arquivo de composicao de impressao do QGIS. O texto inteiro vive na
-- coluna `qpt` porque o credito nao e uma lista de nomes: e um LAYOUT, com
-- posicao, fonte e quebra de linha, e quem o desenha e o QGIS.
--
-- E CATALOGO, e nao linha por produto: um mesmo quadro de creditos serve a
-- todos os produtos que a mesma equipe assinou, e `informacoes_edicao` o
-- aponta.
CREATE TABLE metadado.creditos_qpt(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	qpt TEXT NOT NULL
);

COMMENT ON TABLE metadado.creditos_qpt IS
    'O quadro de créditos da moldura, em QPT do QGIS. É catálogo reaproveitável, e não uma linha por produto.';

-- OS NUMEROS DA EDICAO, e e daqui que sai quase toda a ficha ET-PCDG.
--
-- `pec_planimetrico` e `pec_altimetrico` sao VARCHAR e nao numero: o que se
-- publica e a CLASSE ('A', 'B') junto do padrao, e nao um erro medido.
--
-- `data_criacao` e VARCHAR pelo mesmo motivo, e vem assim do SAP: o que a
-- ficha imprime as vezes e um ANO, as vezes um intervalo ('2019-2021'), e
-- nunca um dia de calendario. Guardar DATE obrigaria a inventar mes e dia.
-- Ficou como pendencia declarada, e nao como descuido.
--
-- `quadro_fases` e JSON porque o quadro impresso e uma matriz de fase por
-- data, com numero de colunas que varia com a linha de producao. Modelar isso
-- em tabela custaria mais do que se ganha: nada aqui e consultado por SQL, e
-- tudo e lido de uma vez para desenhar a moldura.
--
-- `caminho_mde` e `epsg_mde` descrevem o modelo digital de elevacao usado na
-- edicao. Sao o CAMINHO no volume de producao, gravado como dado da linha, e
-- nao um endereco escrito neste arquivo.
CREATE TABLE metadado.informacoes_edicao(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT informacoes_edicao_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	pec_planimetrico VARCHAR(255) NOT NULL,
	pec_altimetrico VARCHAR(255) NOT NULL,
	origem_dados_altimetricos VARCHAR(255) NOT NULL,
	territorio_internacional BOOLEAN NOT NULL,
	acesso_restrito BOOLEAN NOT NULL,
	carta_militar BOOLEAN NOT NULL,
	data_criacao VARCHAR(255) NOT NULL,
	-- INTEGER, e nao o SMALLINT do SAP: `creditos_qpt.id` e SERIAL. A chave
	-- estrangeira entre os dois tipos funciona e nao deveria existir.
	creditos_id INTEGER REFERENCES metadado.creditos_qpt (id),
	epsg_mde VARCHAR(255) NOT NULL,
	caminho_mde VARCHAR(255) NOT NULL,
	dados_terceiro TEXT ARRAY,
	quadro_fases JSON NOT NULL,
	tipo_produto VARCHAR(255),
	versao_produto VARCHAR(255),
	licenca_produto VARCHAR(255),
	observacoes TEXT ARRAY,
	dpi INTEGER NOT NULL DEFAULT 300
);

COMMENT ON TABLE metadado.informacoes_edicao IS
    'Os números da edição que a ficha ET-PCDG imprime: PEC, origem da altimetria, quadro de fases, DPI e o MDE usado. Por versão OU por lote do acervo.';

-- UNICO pelo mesmo motivo da irma `informacoes_produto`, e com o mesmo efeito
-- quando faltava: a segunda linha para o mesmo lote derrubava a ficha ET-PCDG de
-- todas as versoes dele.
CREATE UNIQUE INDEX idx_informacoes_edicao_versao ON metadado.informacoes_edicao (versao_id);
CREATE UNIQUE INDEX idx_informacoes_edicao_lote ON metadado.informacoes_edicao (lote_id);

-- ---------------------------------------------------------------------------
-- O que so a carta ortoimagem tem
-- ---------------------------------------------------------------------------
--
-- As tres tabelas abaixo nao se aplicam a carta topografica, e ficam vazias
-- para ela. Nao ha CHECK que cobre isso, e nao ha como haver: o tipo do
-- produto mora em `acervo.produto`, dois saltos acima, e a regra e da geracao
-- do XML.

-- OS SENSORES QUE PRODUZIRAM A IMAGEM. Alimenta o array "sensores" do JSON de
-- edicao. Mais de uma linha por produto e o caso normal: um mosaico costura
-- imagens de plataformas diferentes, e a ficha lista todas.
CREATE TABLE metadado.sensor_carta_ortoimagem(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT sensor_carta_ortoimagem_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	tipo VARCHAR(255) NOT NULL,
	plataforma VARCHAR(255) NOT NULL,
	nome VARCHAR(255) NOT NULL,
	resolucao VARCHAR(255) NOT NULL,
	bandas VARCHAR(255) NOT NULL,
	nivel_produto VARCHAR(255) NOT NULL
);

COMMENT ON TABLE metadado.sensor_carta_ortoimagem IS
    'Sensores da carta ortoimagem. A carta topográfica não usa esta tabela.';

CREATE INDEX idx_sensor_orto_versao ON metadado.sensor_carta_ortoimagem (versao_id);
CREATE INDEX idx_sensor_orto_lote ON metadado.sensor_carta_ortoimagem (lote_id);

-- AS IMAGENS QUE ENTRAM NA MOLDURA, com o estilo de cada uma.
--
-- `caminho_imagem` e `caminho_estilo` sao caminhos no volume de producao,
-- gravados como dado da linha. O estilo e anulavel porque imagem em cor
-- natural nao precisa de um.
CREATE TABLE metadado.imagens_carta_ortoimagem(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT imagens_carta_ortoimagem_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	caminho_imagem VARCHAR(255) NOT NULL,
	caminho_estilo VARCHAR(255),
	epsg VARCHAR(255) NOT NULL
);

COMMENT ON TABLE metadado.imagens_carta_ortoimagem IS
    'As imagens que entram na moldura da carta ortoimagem, com o estilo de cada uma.';

CREATE INDEX idx_imagens_orto_versao ON metadado.imagens_carta_ortoimagem (versao_id);
CREATE INDEX idx_imagens_orto_lote ON metadado.imagens_carta_ortoimagem (lote_id);

-- AS CLASSES VETORIAIS QUE SE DESENHAM POR CIMA DA ORTOIMAGEM.
--
-- A ortoimagem nao vem sozinha na moldura: curva de nivel, ponto cotado,
-- toponimo e limite continuam sendo desenhados. Esta tabela e o CATALOGO
-- dessas listas, e `perfil_classes_complementares_orto` e quem escolhe qual
-- lista vale para qual produto.
--
-- O ARRAY DE TEXTO E DELIBERADO, e nao uma tabela filha: o nome da classe e o
-- nome da camada na EDGV, ele nao tem chave estrangeira nenhuma para apontar
-- neste banco, e a lista e lida inteira de uma vez.
CREATE TABLE metadado.classes_complementares_orto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	classes TEXT ARRAY NOT NULL
);

COMMENT ON TABLE metadado.classes_complementares_orto IS
    'Catálogo de listas de classes vetoriais desenhadas sobre a ortoimagem. Os nomes são camadas da EDGV, e por isso são texto.';

INSERT INTO metadado.classes_complementares_orto (nome, classes)
VALUES ('Padrão DSG', ARRAY [
	'llp_unidade_federacao_a',
	'elemnat_curva_nivel_l',
	'elemnat_ponto_cotado_p',
	'infra_pista_pouso_p',
	'infra_pista_pouso_l',
	'infra_pista_pouso_a',
	'elemnat_toponimo_fisiografico_natural_p',
	'elemnat_toponimo_fisiografico_natural_l',
	'elemnat_ilha_p',
	'elemnat_ilha_a',
	'llp_aglomerado_rural_p',
	'llp_area_pub_militar_a',
	'infra_elemento_energia_p',
	'infra_elemento_energia_l',
	'infra_elemento_energia_a',
	'constr_extracao_mineral_p',
	'constr_extracao_mineral_a',
	'llp_nome_local_p',
	'infra_elemento_infraestrutura_p',
	'infra_elemento_infraestrutura_l',
	'infra_elemento_infraestrutura_a',
	'elemnat_elemento_hidrografico_p',
	'elemnat_elemento_hidrografico_l',
	'elemnat_elemento_hidrografico_a'
]);

-- QUAL LISTA DE CLASSES COMPLEMENTARES VALE PARA QUAL PRODUTO.
--
-- Mesmo XOR das outras: por versao OU por lote do acervo.
CREATE TABLE metadado.perfil_classes_complementares_orto(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	classes_complementares_orto_id INTEGER NOT NULL REFERENCES metadado.classes_complementares_orto (id),
	CONSTRAINT perfil_classes_complementares_orto_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL))
);

COMMENT ON TABLE metadado.perfil_classes_complementares_orto IS
    'Escolhe a lista de classes complementares de uma versão ou de um lote do acervo. "perfil" aqui é herança do SAP e não tem relação com dominio.tipo_perfil.';

CREATE INDEX idx_perfil_classes_orto_versao ON metadado.perfil_classes_complementares_orto (versao_id);
CREATE INDEX idx_perfil_classes_orto_lote ON metadado.perfil_classes_complementares_orto (lote_id);

COMMIT;
