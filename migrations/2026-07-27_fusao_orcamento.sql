-- Migração: absorção do Controle Orçamentário (SCO) pelo banco do SCA.
-- O SCO deixa de ter banco próprio e vira o MÓDULO 3 da plataforma, ao lado do
-- acervo (1) e da mapoteca (2). Esta migração traz a ESTRUTURA: o schema
-- orcamento inteiro (14 tabelas), as tabelas de domínio que só existiam no SCO
-- e a linha do módulo. Os DADOS vêm depois, por script de carga separado.
--
-- Por que o módulo é o código 3, e não 1: no banco do SCO o orçamento era o
-- único módulo, logo o código 1. Aqui o 1 já é o acervo e o 2 é a mapoteca.
-- A carga de dados troca modulo_id de 1 para 3 ao trazer dgeo.usuario_perfil.
--
-- Por que dgeo.usuario e dominio.tipo_posto_grad não aparecem aqui: existem
-- iguais nos dois lados, criadas pelo DDL base do SCA. A migração não as toca.
--
-- Por que o vínculo com o usuário é por uuid, e não por id: as 25 chaves
-- estrangeiras do schema orcamento apontam para dgeo.usuario (uuid), que vem do
-- serviço de autenticação e é o mesmo nos dois bancos. O id é local de cada
-- banco e não sobrevive à fusão.
--
-- Roda num banco do SCA já na versão 1.1.0 (migração 2026-07-25_perfil_acesso).
-- Aditiva e idempotente (IF NOT EXISTS / ON CONFLICT). Não altera nem apaga
-- nada que já exista.

BEGIN;

-- uuid-ossp: o DDL do SCO a exige. O SCA já a tem; a linha está aqui para a
-- migração não depender disso.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE SCHEMA IF NOT EXISTS orcamento;

-- ---------------------------------------------------------------------------
-- 1) Domínios que só existiam no SCO.
-- Os valores abaixo são a semente do DDL. Estas tabelas têm CRUD no aplicativo
-- (rota /dominio), então a produção pode ter linhas a mais: o script de carga
-- copia o conteúdo real do SCO por cima, com ON CONFLICT.
-- ---------------------------------------------------------------------------

-- Natureza de Despesa (ND). code = ND sem pontos (ex.: 339015).
-- gnd: 3 custeio, 4 capital.
CREATE TABLE IF NOT EXISTS dominio.natureza_despesa(
  code VARCHAR(6) NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  gnd SMALLINT NOT NULL,
  grupo VARCHAR(20) NOT NULL
);

INSERT INTO dominio.natureza_despesa (code, nome, gnd, grupo) VALUES
  ('339014', 'Diárias - pessoal civil', 3, 'custeio'),
  ('339015', 'Diárias - pessoal militar', 3, 'custeio'),
  ('339030', 'Material de consumo', 3, 'custeio'),
  ('339033', 'Passagens e despesas com locomoção', 3, 'custeio'),
  ('339039', 'Serviços de terceiros - pessoa jurídica', 3, 'custeio'),
  ('339040', 'Serviços de TIC - pessoa jurídica', 3, 'custeio'),
  ('339047', 'Obrigações tributárias e contributivas', 3, 'custeio'),
  ('339139', 'Publicações oficiais', 3, 'custeio'),
  ('449040', 'Serviços de TIC (capital)', 4, 'capital'),
  ('449052', 'Equipamentos e material permanente', 4, 'capital')
ON CONFLICT (code) DO NOTHING;

-- Plano Interno (PI)
CREATE TABLE IF NOT EXISTS dominio.plano_interno(
  code VARCHAR(20) NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  alinea CHAR(1)
);

INSERT INTO dominio.plano_interno (code, nome, alinea) VALUES
  ('K4CAIFGDIAR', 'Diárias', 'a'),
  ('K4CAIFGPASS', 'Passagens', 'b'),
  ('K4CAIFGPRCA', 'Serviços, materiais e capital', 'c')
ON CONFLICT (code) DO NOTHING;

-- Unidade Gestora emitente da NC
CREATE TABLE IF NOT EXISTS dominio.ug(
  code VARCHAR(10) NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.ug (code, nome) VALUES
  ('160035', 'Departamento de Ciencia e Tecnologia'),
  ('167035', 'Departamento de Ciencia e Tecnologia - Gestor'),
  ('160089', 'DSG - Diretoria de Serviço Geográfico'),
  ('160382', '1 CGEO - Primeiro Centro de Geoinformação'),
  ('160507', 'EME - Estado-Maior do Exército')
ON CONFLICT (code) DO NOTHING;

-- Tipo de licitação (3.4 GCALC DSG / 3.5 própria)
CREATE TABLE IF NOT EXISTS dominio.tipo_licitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_licitacao (code, nome) VALUES
  (1, 'GCALC DSG'),
  (2, 'Própria'),
  (3, 'Participante')
ON CONFLICT (code) DO NOTHING;

-- Classificação da NC (3.2 PDR / 3.7 Extra-PDR)
CREATE TABLE IF NOT EXISTS dominio.classificacao_nc(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.classificacao_nc (code, nome) VALUES
  (1, 'PDR'),
  (2, 'Extra-PDR')
ON CONFLICT (code) DO NOTHING;

-- Tipo de item do DFD (material / serviço)
CREATE TABLE IF NOT EXISTS dominio.tipo_item_dfd(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.tipo_item_dfd (code, nome) VALUES
  (1, 'Material'),
  (2, 'Serviço')
ON CONFLICT (code) DO NOTHING;

-- Grau de prioridade do DFD
CREATE TABLE IF NOT EXISTS dominio.grau_prioridade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.grau_prioridade (code, nome) VALUES
  (1, 'Alta'),
  (2, 'Normal'),
  (3, 'Baixa')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) O orçamento como terceiro módulo da plataforma.
-- ---------------------------------------------------------------------------
INSERT INTO dominio.modulo (code, nome, nome_abrev) VALUES
  (3, 'Controle Orçamentário', 'orcamento')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Schema orcamento. A ordem segue a dependência das chaves estrangeiras.
-- ---------------------------------------------------------------------------

-- Configuração geral (linha única). UASG, CODOM e o ano de referência (default
-- das telas). A linha id=1 é criada aqui; o backend só faz UPDATE.
CREATE TABLE IF NOT EXISTS orcamento.configuracao(
  id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1,
  uasg VARCHAR(10),
  codom VARCHAR(10),
  ano_referencia SMALLINT,
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT configuracao_singleton CHECK (id = 1)
);

INSERT INTO orcamento.configuracao (id, uasg, codom) VALUES (1, '160382', '048215')
ON CONFLICT (id) DO NOTHING;

-- Meta do PIT que o crédito financia (rastreabilidade do gasto à produção).
CREATE TABLE IF NOT EXISTS orcamento.meta_pit(
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

-- DFD: documento de formalização da demanda, amarrado no ano. O "PCA do ano" é
-- o conjunto de DFDs daquele ano. consta_pca distingue a demanda no PCA da
-- superveniente (ex.: DFD de IA).
CREATE TABLE IF NOT EXISTS orcamento.dfd(
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

CREATE TABLE IF NOT EXISTS orcamento.dfd_item(
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

-- Licitação (3.4 GCALC DSG / 3.5 própria). Uma licitação pode cobrir vários
-- DFDs, então não há vínculo direto com um DFD único aqui.
CREATE TABLE IF NOT EXISTS orcamento.licitacao(
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

-- PDR: o crédito autorizado é o conjunto dos seus itens, amarrados no ano. Não
-- há entidade "PDR" de cabeçalho: os totais por GND saem dos itens.
CREATE TABLE IF NOT EXISTS orcamento.pdr_item(
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

-- Crédito recebido (NC). Uma NC pode trazer mais de uma ND: nesse caso o mesmo
-- número é cadastrado uma vez por ND.
-- valor_nc = valor recebido; NUNCA muda por devolução.
-- valor_recolhido = parte do crédito devolvida. Informativo, não altera valor_nc.
CREATE TABLE IF NOT EXISTS orcamento.nota_credito(
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
  valor_nc NUMERIC(15,2) NOT NULL,
  valor_recolhido NUMERIC(15,2) NOT NULL DEFAULT 0,
  doc_ro VARCHAR(20),
  prazo_empenho DATE,
  classificacao_id SMALLINT NOT NULL REFERENCES dominio.classificacao_nc (code),
  pdr_item_id BIGINT REFERENCES orcamento.pdr_item (id),
  nc_complementada_id BIGINT REFERENCES orcamento.nota_credito (id),
  marcador VARCHAR(8),
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- Nota de empenho: empenha contra uma NC (obrigatória). A ND, o PI e o GND são
-- herdados da NC, então a NE não guarda esses campos.
CREATE TABLE IF NOT EXISTS orcamento.nota_empenho(
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

-- Vínculo NE <-> NC com valor por NC. Uma NE pode ser coberta por mais de uma
-- NC; a soma do rateio é igual a nota_empenho.valor_empenhado. A NE mantém
-- nota_credito_id como NC representativa. ON DELETE CASCADE: apagar a NE limpa
-- o rateio.
CREATE TABLE IF NOT EXISTS orcamento.nota_empenho_nota_credito(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_empenho_id BIGINT NOT NULL REFERENCES orcamento.nota_empenho (id) ON DELETE CASCADE,
  nota_credito_id BIGINT NOT NULL REFERENCES orcamento.nota_credito (id),
  valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
  UNIQUE (nota_empenho_id, nota_credito_id)
);

CREATE TABLE IF NOT EXISTS orcamento.liquidacao(
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

-- ano_referencia: ano em que o material foi recebido, ou seja, em que RPCMTec
-- (3.6) deve constar. Quando NULL, a 3.6 cai no ano da NE.
CREATE TABLE IF NOT EXISTS orcamento.recebimento_material(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_empenho_id BIGINT NOT NULL REFERENCES orcamento.nota_empenho (id),
  material TEXT NOT NULL,
  prazo_entrega VARCHAR(60),
  situacao TEXT,
  ano_referencia SMALLINT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

-- RPNP (3.3): restos a pagar não processados carregados para o ano.
CREATE TABLE IF NOT EXISTS orcamento.rpnp(
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

-- Edição mensal do RPCMTec (metadados; as tabelas 3.1-3.7 são consultas
-- geradas pela feature relatório, recortadas por ano e mês cumulativo).
CREATE TABLE IF NOT EXISTS orcamento.relatorio_rpcmtec(
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

-- Arquivos anexados. Vínculo polimórfico: cada arquivo pertence a EXATAMENTE um
-- dono, uma NC, um DFD ou o PDR de um ano. Os bytes ficam no próprio banco
-- (conteudo BYTEA), como em mapoteca.anexo_pedido.
CREATE TABLE IF NOT EXISTS orcamento.arquivo(
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

-- ---------------------------------------------------------------------------
-- 4) Índices.
-- NC e DFD admitem no máximo 1 anexo cada (a regra "reenviar substitui" também
-- vale no banco). O PDR admite vários, então fica só um índice comum.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_arquivo_nc ON orcamento.arquivo (nota_credito_id) WHERE nota_credito_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_arquivo_dfd ON orcamento.arquivo (dfd_id) WHERE dfd_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_arquivo_pdr_ano ON orcamento.arquivo (pdr_ano);

-- Unicidade da NC: (ano, número, ND) POR UG emitente. A numeração do SIAFI é
-- por UG emitente, logo o mesmo número+ND pode ocorrer para emitentes
-- distintos. COALESCE trata ug_emitente nulo como um único grupo.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_nota_credito_num_nd_ug
  ON orcamento.nota_credito (ano, numero, cod_nd, COALESCE(ug_emitente, ''));

-- Índices úteis para as agregações do relatório
CREATE INDEX IF NOT EXISTS idx_nota_credito_ano ON orcamento.nota_credito (ano);
CREATE INDEX IF NOT EXISTS idx_nota_credito_nd ON orcamento.nota_credito (cod_nd);
CREATE INDEX IF NOT EXISTS idx_nota_credito_classificacao ON orcamento.nota_credito (classificacao_id);
CREATE INDEX IF NOT EXISTS idx_nota_empenho_nc ON orcamento.nota_empenho (nota_credito_id);
CREATE INDEX IF NOT EXISTS idx_liquidacao_ne ON orcamento.liquidacao (nota_empenho_id);
CREATE INDEX IF NOT EXISTS idx_pdr_item_nd ON orcamento.pdr_item (cod_nd);
CREATE INDEX IF NOT EXISTS idx_pdr_item_ano ON orcamento.pdr_item (ano);
CREATE INDEX IF NOT EXISTS idx_meta_pit_ano ON orcamento.meta_pit (ano);
CREATE INDEX IF NOT EXISTS idx_dfd_ano ON orcamento.dfd (ano);

-- ---------------------------------------------------------------------------
-- 5) Versão do banco. O chefe decidiu versão única para a plataforma fundida:
-- 1.5.0, o número que o SCO já usava, à frente do 1.1.0 do SCA.
-- ---------------------------------------------------------------------------
UPDATE public.versao SET nome = '1.5.0' WHERE code = 1;

COMMIT;
