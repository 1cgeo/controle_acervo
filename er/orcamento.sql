BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA orcamento;

-- ---------------------------------------------------------------------------
-- Configuracao geral (linha unica). UASG e CODOM. Substitui o que antes morava
-- no exercicio. A linha id=1 e criada aqui; o backend so faz UPDATE.
--
-- NAO ha mais `ano_referencia` aqui. Ela era o ano PADRAO das telas, e o
-- seletor de ano global acabou: cada tela tem o
-- seu filtro, comeca no ano atual e nao guarda nada. Em banco ja instalado a
-- coluna sai pela secao 5 de
-- migrations/2026-08-04_licitacao_campos_fase_e_anexo.sql, que o chefe aplica
-- quando quiser. Nao confunda com `recebimento_material.ano_referencia`, que
-- diz em que RPCMTec o material recebido consta e PERMANECE.
-- ---------------------------------------------------------------------------
CREATE TABLE orcamento.configuracao(
  id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1,
  uasg VARCHAR(10),
  codom VARCHAR(10),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT configuracao_singleton CHECK (id = 1)
);

INSERT INTO orcamento.configuracao (id, uasg, codom) VALUES (1, '160382', '048215');

-- ---------------------------------------------------------------------------
-- Tudo e amarrado no ANO (SMALLINT simples, sem FK; nao ha mais entidade
-- exercicio). O par de auditoria segue em toda tabela de negocio.
-- ---------------------------------------------------------------------------

-- A meta do PIT que o credito financia mora em `pit.meta`, e nao aqui: o PIT e
-- o plano anual da Divisao, que a mapoteca tambem consome, e nao um artefato
-- orcamentario. Ver er/pit.sql.
-- O orcamento continua sendo consumidor, por UMA chave estrangeira so:
-- `pdr_item.meta_pit_id`. A nota de credito perdeu a dela na 1.31.0 e chega ao
-- PIT pelo item do PDR, porque em orcamento a ligacao com o PIT e o PDR.

-- DFD: documento de formalizacao da demanda, amarrado no ano. Nao ha mais
-- entidade PCA: o "PCA do ano" e o conjunto de DFDs daquele ano. consta_pca
-- distingue a demanda no PCA da superveniente (ex.: DFD de IA).
CREATE TABLE orcamento.dfd(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  numero VARCHAR(20) NOT NULL,
  ano SMALLINT NOT NULL,
  rotulo VARCHAR(120),
  objeto TEXT,
  justificativa TEXT,
  area_requisitante VARCHAR(255),
  grau_prioridade_id SMALLINT REFERENCES dominio.grau_prioridade (code),
  data_prevista_conclusao DATE,
  responsavel_cpf VARCHAR(14),
  vinculo_plano_gestao VARCHAR(60),
  consta_pca BOOLEAN NOT NULL DEFAULT TRUE,
  valor_estimado NUMERIC(15,2),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

CREATE TABLE orcamento.dfd_item(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  dfd_id BIGINT NOT NULL REFERENCES orcamento.dfd (id),
  tipo_item_id SMALLINT NOT NULL REFERENCES dominio.tipo_item_dfd (code),
  cod_catmat_catser VARCHAR(30),
  descricao TEXT NOT NULL,
  quantidade NUMERIC(15,3),
  valor_unitario NUMERIC(15,2),
  valor_total NUMERIC(15,2),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- Licitacao (4.4 GCALC DSG / 4.5 demais). Antes de nota_empenho (FK).
-- Os TRES tipos saem no RPCMTec: o tipo 1 (GCALC DSG) alimenta a subsecao 4.4,
-- e os tipos 2 (Propria) e 3 (Participante) alimentam a 4.5. Uma licitacao pode
-- cobrir varios DFDs, entao nao guardamos um
-- vinculo direto com um DFD unico aqui.
--
-- `fase_atual` e `fase_id` convivem por decisao. O codigo classifica (filtra e
-- agrupa) e o texto livre narra: um registro real guarda 103 caracteres
-- explicando que o vencedor nao entregou e o pregao se tornou fracassado.
-- Converter esse texto em codigo perderia a explicacao.
CREATE TABLE orcamento.licitacao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  tipo_id SMALLINT NOT NULL REFERENCES dominio.tipo_licitacao (code),
  objeto TEXT NOT NULL,
  -- Identificacao do processo, para achar a licitacao fora do SCA.
  numero_pregao VARCHAR(20),
  -- Numero Unico de Protocolo, formato '64286.011195/2026-94' (21 caracteres).
  nup VARCHAR(25),
  fase_id SMALLINT REFERENCES dominio.fase_licitacao (code),
  fase_atual TEXT,
  valor_total_estimado NUMERIC(15,2),
  valor_final_homologado NUMERIC(15,2),
  -- Dia da homologacao. Par de valor_final_homologado, que sozinho nao dizia quando.
  data_homologacao DATE,
  -- Empresa vencedora. Nulo enquanto nao ha vencedor (fracassado ou deserto).
  fornecedor VARCHAR(255),
  om_gestora VARCHAR(60),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- PDR: o credito autorizado e o conjunto dos seus itens, amarrados no ano. Nao
-- ha entidade "PDR" de cabeçalho: os totais (solicitado/autorizado por GND) sao
-- calculados a partir dos itens. Cada item carrega a ND, a meta do PIT, o GND
-- (3 custeio / 4 capital) e os valores solicitado e autorizado.
CREATE TABLE orcamento.pdr_item(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  cod_nd VARCHAR(6) NOT NULL REFERENCES dominio.natureza_despesa (code),
  -- ESTE E O UNICO ELO ENTRE O ORCAMENTO E O PIT. A nota de credito NAO aponta
  -- meta: ela aponta o item do PDR daqui, e a meta dela se le por este campo.
  -- Ver o comentario de `nota_credito.pdr_item_id`.
  --
  -- A META, E NAO O ITEM DELA, e a medicao de 2026-08-06 fecha a questao pela
  -- CONTAGEM. O item do PDR e uma linha de despesa por ND, e nao um recorte do
  -- trabalho:
  --
  --   meta   itens do PDR   itens do PIT
  --      1              5             11
  --      3              6              2
  --      4              1              3
  --      5              5              3
  --
  -- Nas metas 3 e 5 os itens do PDR SOBRAM sobre os do PIT, entao eles nao
  -- podem ser um detalhamento deles. O que eles detalham e a ND: a Meta 1 tem
  -- diarias (339015), passagens (339033), manutencao de viatura (339039) e
  -- pecas (339030), cada uma uma linha. A descricao gravada diz isso na letra:
  -- 'Producao de Geoinformacao (diarias)' e o NOME DO GRUPO mais a natureza da
  -- despesa. Qual dos 11 itens da Meta 1 a diaria financiou nao esta no
  -- documento, e por isso nao esta aqui.
  --
  -- `acervo.versao`, `mapoteca.pedido` e `rpcmtec.capacitacao` apontam
  -- `pit.meta_item`, porque essas tres sao TRABALHO, e trabalho cumpre item.
  meta_pit_id BIGINT REFERENCES pit.meta (id),
  item_label VARCHAR(10),
  descricao TEXT,
  gnd SMALLINT,
  valor_solicitado NUMERIC(15,2),
  valor_autorizado NUMERIC(15,2),
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- Credito recebido (NC) e execucao (NE / liquidacao). Uma NC pode trazer mais de
-- uma ND: nesse caso o mesmo numero e cadastrado uma vez por ND. A chave unica
-- tem QUATRO campos, e nao tres: (ano, numero, cod_nd, COALESCE(ug_emitente,''))
-- -- ver uniq_nota_credito_num_nd_ug no fim do arquivo. A numeracao do SIAFI e
-- por emitente, entao duas UGs emitem o mesmo numero no mesmo ano (caso real:
-- 2026NC400412 pelas UGs 160035 e 167035). Escolher a NC por "numero - ND", sem
-- a UG, e sorteio.
CREATE TABLE orcamento.nota_credito(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  numero VARCHAR(20) NOT NULL,
  ano SMALLINT NOT NULL,
  data_emissao DATE,
  cod_nd VARCHAR(6) NOT NULL REFERENCES dominio.natureza_despesa (code),
  ptres VARCHAR(10),
  fonte VARCHAR(15),
  cod_pi VARCHAR(20) REFERENCES dominio.plano_interno (code),
  ug_emitente VARCHAR(10) REFERENCES dominio.ug (code),
  finalidade_historico TEXT,
  -- NAO HA `meta_pit_id` AQUI, e a ausencia e a modelagem. Ate a 1.30.0 a NC
  -- apontava `pit.meta` em PARALELO ao item do PDR, e as duas afirmacoes podiam
  -- discordar sem nada acusar. Discordavam: medido em 2026-08-06, das 29 NCs que
  -- tinham os dois campos preenchidos, 4 diziam uma meta que o item de PDR delas
  -- nao financia (a 2026NC400706 dizia Meta 1 e o item 28 diz Meta 3; a
  -- 2026NC400412 e a 2026NC401277 diziam Meta 4 e o item 16, Correios, nao tem
  -- meta nenhuma; a 2026NC401276 dizia Meta 1 e o item 14 tambem nao tem).
  --
  -- A CADEIA E `nota_credito -> pdr_item -> pit.meta`. Em orcamento a ligacao com
  -- o PIT e o PDR: o credito chega para executar o que o PDR previu, e a meta que
  -- ele financia e a meta daquela previsao. Com um caminho so, a NC nao tem como
  -- afirmar meta que o seu item de PDR nao afirma.
  -- valor_nc = valor recebido; NUNCA muda por devolucao (a devolucao corta empenhado/liquidado)
  valor_nc NUMERIC(15,2) NOT NULL,
  -- valor_recolhido = parte do credito recebido que foi devolvida/recolhida (informada na NC).
  -- Informativo: NAO altera valor_nc (o recebido continua cheio). Default 0.
  valor_recolhido NUMERIC(15,2) NOT NULL DEFAULT 0,
  doc_ro VARCHAR(20),
  prazo_empenho DATE,
  -- classificacao = regra de negocio (previsto no PDR autorizado?), nao a celula orcamentaria
  classificacao_id SMALLINT NOT NULL REFERENCES dominio.classificacao_nc (code),
  -- O ITEM DO PDR QUE ESTE CREDITO EXECUTA, e desde a 1.31.0 tambem o unico
  -- caminho ate a meta do PIT: quem quer a meta da NC le
  -- `pdr_item.meta_pit_id` por JOIN daqui.
  --
  -- ANULAVEL, E O NULO E HONESTO. Duas situacoes legitimas o produzem, e as duas
  -- foram medidas em 2026-08-06:
  --   1. A NC Extra-PDR (classificacao 2). Ela e, por definicao, o credito que o
  --      PDR nao previu, entao nao ha item para apontar. Sao 34 em producao. Sem
  --      item ela nao tem meta, e isso e o que o dado diz: o vinculo dela com o
  --      PIT nunca passou pelo PDR.
  --   2. A NC de um ano cujo PDR foi transcrito sem vinculo com o PIT. Os 8
  --      itens do PDR de 2025 tem `meta_pit_id` nulo, entao as 17 NCs de 2025
  --      que apontam item nenhum ganham item pela ND e continuam sem meta.
  -- O invariante "so classificacao = PDR (1) tem item" vive no schema Joi e no
  -- controlador, e nao num CHECK: `classificacao_id` e editavel, e um CHECK
  -- recusaria a correcao de uma NC mal classificada em vez de acompanha-la.
  pdr_item_id BIGINT REFERENCES orcamento.pdr_item (id),
  nc_complementada_id BIGINT REFERENCES orcamento.nota_credito (id),
  marcador VARCHAR(8),
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
  -- Unicidade: ver o indice uniq_nota_credito_num_nd_ug abaixo (numero por UG
  -- emitente; a numeracao da NC no SIAFI e por UG emitente, entao o mesmo numero
  -- pode existir para UGs emitentes diferentes).
);

-- Nota de empenho: empenha contra uma NC (obrigatoria). A ND, o PI e o GND sao
-- herdados da NC, entao a NE nao guarda esses campos nem licitacao.
CREATE TABLE orcamento.nota_empenho(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  numero VARCHAR(20) NOT NULL,
  ano SMALLINT NOT NULL,
  data_empenho DATE,
  nota_credito_id BIGINT NOT NULL REFERENCES orcamento.nota_credito (id),
  finalidade TEXT,
  valor_empenhado NUMERIC(15,2) NOT NULL,
  valor_anulado NUMERIC(15,2) NOT NULL DEFAULT 0,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- Vinculo NE <-> NC com valor por NC. Uma NE pode ser coberta por mais de uma
-- NC; o valor empenhado e dividido entre elas (a soma = nota_empenho.valor_empenhado).
-- Por regra de negocio todas as NCs de uma mesma NE tem a mesma ND e a mesma
-- classificacao (validado no ctrl). A NE mantem nota_credito_id como NC
-- representativa (dirige ND/PI/classificacao e a 3.1); esta tabela so detalha o
-- rateio do valor, usado pela 3.2/3.7. ON DELETE CASCADE: apagar a NE limpa o rateio.
CREATE TABLE orcamento.nota_empenho_nota_credito(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_empenho_id BIGINT NOT NULL REFERENCES orcamento.nota_empenho (id) ON DELETE CASCADE,
  nota_credito_id BIGINT NOT NULL REFERENCES orcamento.nota_credito (id),
  valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
  UNIQUE (nota_empenho_id, nota_credito_id)
);

CREATE TABLE orcamento.liquidacao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_empenho_id BIGINT NOT NULL REFERENCES orcamento.nota_empenho (id),
  valor_liquidado NUMERIC(15,2) NOT NULL,
  data DATE,
  documento_ns VARCHAR(20),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

CREATE TABLE orcamento.recebimento_material(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_empenho_id BIGINT NOT NULL REFERENCES orcamento.nota_empenho (id),
  material TEXT NOT NULL,
  prazo_entrega VARCHAR(60),
  situacao TEXT,
  -- Ano em que o material foi recebido, ou seja, em que RPCMTec (3.6) deve constar.
  -- Quando NULL, a 3.6 cai no ano da NE (ne.ano). Permite que um item de RPNP
  -- (empenho de ano anterior) recebido neste ano apareca na 3.6 do ano corrente.
  ano_referencia SMALLINT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- RPNP (4.3): restos a pagar nao processados carregados para o ano.
CREATE TABLE orcamento.rpnp(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  nota_empenho_id BIGINT REFERENCES orcamento.nota_empenho (id),
  empenho_label VARCHAR(60),
  finalidade TEXT,
  valor_empenhado NUMERIC(15,2),
  valor_a_liquidar NUMERIC(15,2),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- A edicao mensal do RPCMTec NAO mora aqui, e sim em `rpcmtec.edicao` (ver
-- er/rpcmtec.sql): o relatorio e da Divisao inteira, e neste schema quem so tem
-- perfil na mapoteca nao alcancaria a edicao do proprio relatorio. O orcamento
-- continua sendo FONTE das subsecoes 4.1 a 4.7, e nao dono do relatorio.

-- Arquivos anexados (documentos originais). Vinculo polimorfico: cada arquivo
-- pertence a EXATAMENTE um de CINCO donos: uma NC (PDF do SIAFI), um DFD (PDF),
-- o PDR de um ano (XLSX/PDF; o PDR nao tem tabela, e o conjunto dos itens do
-- ano, entao o vinculo e o proprio ano), uma licitacao (edital, ata, termo de
-- homologacao) ou um RPNP (demonstrativo do SIAFI). NC e DFD admitem no maximo
-- 1 anexo (reenviar substitui); PDR, licitacao e RPNP admitem varios, porque
-- cada um junta mais de um documento e limitar a um obrigaria a escolher qual
-- guardar. Os bytes do arquivo ficam no proprio banco (coluna conteudo BYTEA);
-- aqui guardamos tambem os metadados.
CREATE TABLE orcamento.arquivo(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_credito_id BIGINT REFERENCES orcamento.nota_credito (id) ON DELETE CASCADE,
  dfd_id BIGINT REFERENCES orcamento.dfd (id) ON DELETE CASCADE,
  pdr_ano SMALLINT,
  licitacao_id BIGINT REFERENCES orcamento.licitacao (id) ON DELETE CASCADE,
  rpnp_id BIGINT REFERENCES orcamento.rpnp (id) ON DELETE CASCADE,
  nome_original VARCHAR(255) NOT NULL,
  extensao VARCHAR(10) NOT NULL,
  mimetype VARCHAR(150),
  tamanho_bytes BIGINT,
  conteudo BYTEA NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT arquivo_um_vinculo CHECK (
    (nota_credito_id IS NOT NULL)::int +
    (dfd_id IS NOT NULL)::int +
    (pdr_ano IS NOT NULL)::int +
    (licitacao_id IS NOT NULL)::int +
    (rpnp_id IS NOT NULL)::int = 1
  )
);

-- NC e DFD: no maximo 1 anexo cada (a regra "reenviar substitui" tambem e
-- garantida no banco). PDR, licitacao e RPNP admitem varios, entao ficam so
-- indices comuns.
CREATE UNIQUE INDEX uniq_arquivo_nc ON orcamento.arquivo (nota_credito_id) WHERE nota_credito_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_arquivo_dfd ON orcamento.arquivo (dfd_id) WHERE dfd_id IS NOT NULL;
CREATE INDEX idx_arquivo_pdr_ano ON orcamento.arquivo (pdr_ano);
CREATE INDEX idx_arquivo_licitacao ON orcamento.arquivo (licitacao_id);
CREATE INDEX idx_arquivo_rpnp ON orcamento.arquivo (rpnp_id);

-- Unicidade da NC: (ano, numero, ND) POR UG emitente. A numeracao do SIAFI e por
-- UG emitente, logo o mesmo numero+ND pode ocorrer para emitentes distintos.
-- COALESCE trata ug_emitente nulo como um unico grupo (nao permite duplicar quando
-- o emitente nao foi informado).
CREATE UNIQUE INDEX uniq_nota_credito_num_nd_ug
  ON orcamento.nota_credito (ano, numero, cod_nd, COALESCE(ug_emitente, ''));

-- Indices uteis para as agregacoes do relatorio
CREATE INDEX idx_nota_credito_nd ON orcamento.nota_credito (cod_nd);
CREATE INDEX idx_nota_credito_classificacao ON orcamento.nota_credito (classificacao_id);
-- A meta de toda NC passa por aqui desde a 1.31.0: a grade do PIT soma
-- `credito_nc` juntando nota_credito -> pdr_item -> pit.meta, e sem indice a
-- soma varre a tabela inteira uma vez por meta.
CREATE INDEX idx_nota_credito_pdr_item ON orcamento.nota_credito (pdr_item_id);
CREATE INDEX idx_nota_empenho_nc ON orcamento.nota_empenho (nota_credito_id);
CREATE INDEX idx_liquidacao_ne ON orcamento.liquidacao (nota_empenho_id);
CREATE INDEX idx_pdr_item_nd ON orcamento.pdr_item (cod_nd);
CREATE INDEX idx_pdr_item_ano ON orcamento.pdr_item (ano);
CREATE INDEX idx_dfd_ano ON orcamento.dfd (ano);

COMMIT;
