BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA orcamento;

-- ---------------------------------------------------------------------------
-- Configuracao geral (linha unica). UASG, CODOM e o ano de referencia (default
-- das telas). Substitui o que antes morava no exercicio. A linha id=1 e criada
-- aqui; o backend so faz UPDATE.
-- ---------------------------------------------------------------------------
CREATE TABLE orcamento.configuracao(
  id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1,
  uasg VARCHAR(10),
  codom VARCHAR(10),
  ano_referencia SMALLINT,
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT configuracao_singleton CHECK (id = 1)
);

INSERT INTO orcamento.configuracao (id, uasg, codom) VALUES (1, '160382', '048215');

-- ---------------------------------------------------------------------------
-- Tudo e amarrado no ANO (SMALLINT simples, sem FK; nao ha mais entidade
-- exercicio). O par de auditoria segue em toda tabela de negocio.
-- ---------------------------------------------------------------------------

-- Meta do PIT que o credito financia (rastreabilidade do gasto a producao).
CREATE TABLE orcamento.meta_pit(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  numero_meta SMALLINT NOT NULL,
  item VARCHAR(20),
  descricao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (ano, numero_meta, item)
);

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

-- Licitacao (3.4 GCALC DSG / 3.5 propria). Antes de nota_empenho (FK).
-- Licitacao: uma licitacao pode cobrir varios DFDs, entao nao guardamos um
-- vinculo direto com um DFD unico aqui.
CREATE TABLE orcamento.licitacao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  tipo_id SMALLINT NOT NULL REFERENCES dominio.tipo_licitacao (code),
  objeto TEXT NOT NULL,
  fase_atual TEXT,
  valor_total_estimado NUMERIC(15,2),
  valor_final_homologado NUMERIC(15,2),
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
  meta_pit_id BIGINT REFERENCES orcamento.meta_pit (id),
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
-- uma ND: nesse caso o mesmo numero e cadastrado uma vez por ND, e o par
-- (ano, numero, cod_nd) e unico (no uso, escolhe-se a NC olhando "numero - ND").
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
  meta_pit_id BIGINT REFERENCES orcamento.meta_pit (id),
  -- valor_nc = valor recebido; NUNCA muda por devolucao (a devolucao corta empenhado/liquidado)
  valor_nc NUMERIC(15,2) NOT NULL,
  -- valor_recolhido = parte do credito recebido que foi devolvida/recolhida (informada na NC).
  -- Informativo: NAO altera valor_nc (o recebido continua cheio). Default 0.
  valor_recolhido NUMERIC(15,2) NOT NULL DEFAULT 0,
  doc_ro VARCHAR(20),
  prazo_empenho DATE,
  -- classificacao = regra de negocio (previsto no PDR autorizado?), nao a celula orcamentaria
  classificacao_id SMALLINT NOT NULL REFERENCES dominio.classificacao_nc (code),
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

-- RPNP (3.3): restos a pagar nao processados carregados para o ano.
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

-- Edicao mensal do RPCMTec (metadados; as tabelas 3.1-3.7 sao consultas geradas
-- pela feature relatorio, recortadas por ano e mes cumulativo)
CREATE TABLE orcamento.relatorio_rpcmtec(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  mes SMALLINT NOT NULL,
  assinante VARCHAR(255),
  data_assinatura DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (ano, mes)
);

-- Arquivos anexados (documentos originais). Vinculo polimorfico: cada arquivo
-- pertence a EXATAMENTE um dono: uma NC (PDF do SIAFI), um DFD (PDF) ou o PDR de
-- um ano (XLSX/PDF; o PDR nao tem tabela, e o conjunto dos itens do ano, entao o
-- vinculo e o proprio ano). NC e DFD admitem no maximo 1 anexo (reenviar
-- substitui); o PDR admite varios. Os bytes do arquivo ficam no proprio banco
-- (coluna conteudo BYTEA); aqui guardamos tambem os metadados.
CREATE TABLE orcamento.arquivo(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_credito_id BIGINT REFERENCES orcamento.nota_credito (id) ON DELETE CASCADE,
  dfd_id BIGINT REFERENCES orcamento.dfd (id) ON DELETE CASCADE,
  pdr_ano SMALLINT,
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
    (pdr_ano IS NOT NULL)::int = 1
  )
);

-- NC e DFD: no maximo 1 anexo cada (a regra "reenviar substitui" tambem e
-- garantida no banco). O PDR (pdr_ano) admite varios, entao fica so um indice comum.
CREATE UNIQUE INDEX uniq_arquivo_nc ON orcamento.arquivo (nota_credito_id) WHERE nota_credito_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_arquivo_dfd ON orcamento.arquivo (dfd_id) WHERE dfd_id IS NOT NULL;
CREATE INDEX idx_arquivo_pdr_ano ON orcamento.arquivo (pdr_ano);

-- Unicidade da NC: (ano, numero, ND) POR UG emitente. A numeracao do SIAFI e por
-- UG emitente, logo o mesmo numero+ND pode ocorrer para emitentes distintos.
-- COALESCE trata ug_emitente nulo como um unico grupo (nao permite duplicar quando
-- o emitente nao foi informado).
CREATE UNIQUE INDEX uniq_nota_credito_num_nd_ug
  ON orcamento.nota_credito (ano, numero, cod_nd, COALESCE(ug_emitente, ''));

-- Indices uteis para as agregacoes do relatorio
CREATE INDEX idx_nota_credito_ano ON orcamento.nota_credito (ano);
CREATE INDEX idx_nota_credito_nd ON orcamento.nota_credito (cod_nd);
CREATE INDEX idx_nota_credito_classificacao ON orcamento.nota_credito (classificacao_id);
CREATE INDEX idx_nota_empenho_nc ON orcamento.nota_empenho (nota_credito_id);
CREATE INDEX idx_liquidacao_ne ON orcamento.liquidacao (nota_empenho_id);
CREATE INDEX idx_pdr_item_nd ON orcamento.pdr_item (cod_nd);
CREATE INDEX idx_pdr_item_ano ON orcamento.pdr_item (ano);
CREATE INDEX idx_meta_pit_ano ON orcamento.meta_pit (ano);
CREATE INDEX idx_dfd_ano ON orcamento.dfd (ano);

COMMIT;
