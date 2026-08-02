-- O SCA absorve o que o SAP guardava de NAO-PRODUCAO: a execucao das metas do
-- PIT, o Extra-PIT, o efetivo do mes e a capacitacao.
--
-- POR QUE. O cabecalho de server/src/rpcmtec/rpcmtec_ctrl.js lista as subsecoes
-- que o gerador nao sabia preencher, e cinco delas (2.1, 2.6, 3.3, 6.1 e 6.2)
-- tinham dono no SAP. O criterio para trazer nao foi "esta la": foi que nenhuma
-- delas depende de `macrocontrole`. Extra-PIT, meta nao calculada e retrato do
-- efetivo se CADASTRAM a mao, e o unico vinculo do Extra-PIT com a producao era
-- um `lote_id` opcional. O mesmo teste que tirou `limites` do acervo em
-- 2026-07-29, `pit.meta` do orcamento em 2026-07-31 e o RPCMTec dos modulos em
-- 2026-08-01, aplicado entre SISTEMAS.
--
-- NADA SAI DO SAP (decisao do chefe, 2026-08-02). A fusao e por ADICAO aqui, e
-- nao por remocao la. Durante a transicao ha duas copias vivas de cada um
-- desses fatos, e o banco nao tem como reconcilia-las: o que impede as duas de
-- brigarem e o SCA passar a ser quem GERA essas subsecoes do relatorio.
--
-- O QUE NAO VEIO, e por que: 2.1 na parte de PRODUCAO, 2.2, 2.3, 2.4 e 2.5.
-- Todas leem `macrocontrole` ou `controle_campo`, que le `macrocontrole`.
--
-- O QUE ESTA MIGRACAO NAO FAZ. Ela nao quebra o `descricao` das metas de 2026
-- nas colunas novas. Hoje a linha do banco e
-- 'Carta Topografica 1:25.000. COTER/DECEX, 24': produto, demandante e
-- quantidade num texto so. A quebra por expressao regular acerta quase tudo e
-- erra calada onde ha ponto na escala e separador de milhar na quantidade
-- ('4.200'), e uma quantidade errada aqui vira uma porcentagem errada no
-- relatorio que o chefe assina. As colunas nascem NULAS e o preenchimento e
-- ato de cadastro, conferido contra o PIT assinado.
--
-- Idempotente: IF NOT EXISTS e ON CONFLICT DO NOTHING em tudo. Reaplicar nao faz
-- nada.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Dominios
-- ---------------------------------------------------------------------------
-- Os codigos sao os MESMOS do SAP, de proposito: na fusao, a linha migrada nao
-- precisa de tabela de traducao. O que mudou foi o nome das tabelas, para caber
-- na convencao do schema `dominio`, que e unico na plataforma.

CREATE TABLE IF NOT EXISTS dominio.situacao_extra_pit(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.situacao_extra_pit (code, nome) VALUES
(1, 'Previsto'),
(2, 'Em produção'),
(3, 'Enviado'),
(4, 'Concluído'),
(5, 'Cancelado')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS dominio.tipo_capacitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.tipo_capacitacao (code, nome) VALUES
(1, 'Ministrada'),
(2, 'Recebida')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS dominio.situacao_capacitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.situacao_capacitacao (code, nome) VALUES
(1, 'Prevista'),
(2, 'Em execução'),
(3, 'Concluída'),
(4, 'Cancelada')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. A meta do PIT passa a guardar o que ela PROMETE
-- ---------------------------------------------------------------------------
-- Sem estas quatro colunas a subsecao 2.1 nao tem como sair: ela pede
-- "Quantidade" e "Previsao de termino", e ate aqui a tabela so sabia o rotulo e
-- a descricao. Todas anulaveis, porque a linha de cabecalho da meta (item nulo)
-- nao promete quantidade nenhuma, e porque o PIT de 2025 foi cadastrado so no
-- nivel da meta.

ALTER TABLE pit.meta
    ADD COLUMN IF NOT EXISTS quantidade_prevista INTEGER,
    ADD COLUMN IF NOT EXISTS unidade VARCHAR(50),
    ADD COLUMN IF NOT EXISTS demandante VARCHAR(255),
    ADD COLUMN IF NOT EXISTS prazo DATE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'meta_quantidade_prevista_check'
          AND conrelid = 'pit.meta'::regclass
    ) THEN
        ALTER TABLE pit.meta
            ADD CONSTRAINT meta_quantidade_prevista_check
            CHECK (quantidade_prevista IS NULL OR quantidade_prevista >= 0);
    END IF;
END
$$;

COMMENT ON COLUMN pit.meta.quantidade_prevista IS
    'Quantidade que o PIT promete no item. Nula na linha de cabeçalho da meta, que não promete: quem promete são os itens que ela agrupa.';
COMMENT ON COLUMN pit.meta.unidade IS
    'Unidade da quantidade (carta, folha, ano). Varia por item dentro da mesma meta.';
COMMENT ON COLUMN pit.meta.demandante IS
    'Quem pediu (COTER/DECEX, APHC/DSG). Texto, e não FK: a sigla do documento assinado não casa com o catálogo de clientes da mapoteca.';
COMMENT ON COLUMN pit.meta.prazo IS
    'Previsão de término. DATA, e não a frase do documento (AGO 26): quem formata é o gerador.';

-- ---------------------------------------------------------------------------
-- 3. Execucao mensal
-- ---------------------------------------------------------------------------
-- Lancamento a MAO para toda meta (chefe, 2026-08-02). No SAP a regua e
-- `lote_id IS NULL`, porque la a meta de producao tem o realizado calculado das
-- atividades. Aqui nao existe essa regua, e nem teria de onde: enquanto o SAP
-- nao for absorvido nao ha o que calcular. Quando ele entrar, e aqui que nasce
-- a coluna que diz qual meta deixa de ser digitada.
--
-- Sem coluna `ano`: ele vem da meta. Uma copia permitiria lancar 2025 numa meta
-- de 2026, e nada acusaria.

CREATE TABLE IF NOT EXISTS pit.execucao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  meta_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  quantidade INTEGER NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  data_conclusao DATE,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (meta_id, mes)
);

COMMENT ON TABLE pit.execucao IS
    'Execução mensal lançada à mão para uma meta do PIT. Uma linha por (meta, mês); o ano vem da meta.';

CREATE INDEX IF NOT EXISTS idx_execucao_meta ON pit.execucao (meta_id);

-- ---------------------------------------------------------------------------
-- 4. Demanda Extra-PIT
-- ---------------------------------------------------------------------------
-- O que o RPCMTec chama de Extra-PIT e a excecao AUTORIZADA, e por isso
-- `documento_autorizacao` e NOT NULL. Foi essa obrigatoriedade que faltou
-- quando o SCA tentou derivar a 3.3 de `mapoteca.pedido.previsto_pit`: aquele
-- campo e falso por omissao, e a conta deu 23 linhas onde a edicao real de
-- julho/2026 traz 1.
--
-- SEM `lote_id`, ao contrario do SAP. La ele serve para a 2.1 nao contar duas
-- vezes o mesmo trabalho; aqui nao ha o que descontar, porque a 2.1 do SCA soma
-- o que foi lancado em `pit.execucao` e o Extra-PIT nao e lancado la. Apontar
-- `acervo.lote` seria inventar um vinculo: o lote do acervo nao e o lote de
-- producao do SAP.

CREATE TABLE IF NOT EXISTS pit.demanda_extra(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  demandante VARCHAR(255) NOT NULL,
  tipo_produto VARCHAR(255) NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  situacao_id SMALLINT NOT NULL REFERENCES dominio.situacao_extra_pit (code),
  documento_autorizacao VARCHAR(255) NOT NULL,
  descricao TEXT,
  data_entrega DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE pit.demanda_extra IS
    'Demanda Extra-PIT: a exceção AUTORIZADA ao plano anual (3.3 do RPCMTec). O documento de autorização é obrigatório, e é o que a distingue de trabalho fora do plano.';

CREATE INDEX IF NOT EXISTS idx_demanda_extra_ano ON pit.demanda_extra (ano);

-- ---------------------------------------------------------------------------
-- 5. Retrato mensal do efetivo
-- ---------------------------------------------------------------------------
-- E tabela, e nao consulta a `dgeo.usuario`, porque guarda o posto DA EPOCA:
-- lendo o cadastro de hoje, a edicao de marco se reescreveria sozinha na
-- primeira promocao de julho, e ninguem veria acontecer.
--
-- `usuario_uuid`, e nao `usuario_id` como no SAP: e a convencao de tabela nova
-- aqui. O preco e mais uma tabela apontando `dgeo.usuario`, ou seja, mais uma
-- razao para excluir usuario falhar. Quem ja trabalhou aqui se DESATIVA, e
-- desativar nao apaga o retrato dos meses em que a pessoa esteve.

CREATE TABLE IF NOT EXISTS rpcmtec.aproveitamento_mes(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  tipo_posto_grad_id SMALLINT NOT NULL REFERENCES dominio.tipo_posto_grad (code),
  atividades TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (ano, mes, usuario_uuid)
);

COMMENT ON TABLE rpcmtec.aproveitamento_mes IS
    'Retrato mensal do efetivo (6.1 do RPCMTec): uma linha por pessoa por mês, com o posto da época. Congelado de propósito, para a edição assinada não mudar depois.';

CREATE INDEX IF NOT EXISTS idx_aproveitamento_ano_mes
    ON rpcmtec.aproveitamento_mes (ano, mes);

-- ---------------------------------------------------------------------------
-- 6. Capacitacao
-- ---------------------------------------------------------------------------
-- UMA tabela para ministrada (2.6) e recebida (6.2), com `tipo_id` separando: a
-- linha e o mesmo fato visto dos dois lados, e o que muda sao tres colunas.
-- Duas tabelas com dez colunas iguais divergiriam na primeira que fosse
-- acrescentada a uma so.
--
-- DATA, e nao TIMESTAMP como no SAP. Inicio e fim de curso sao dia de
-- calendario, e e o padrao da casa desde 2026-08-01.

CREATE TABLE IF NOT EXISTS rpcmtec.capacitacao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  tipo_id SMALLINT NOT NULL REFERENCES dominio.tipo_capacitacao (code),
  situacao_id SMALLINT NOT NULL REFERENCES dominio.situacao_capacitacao (code),
  instituicoes TEXT,
  local_realizacao VARCHAR(255),
  data_inicio DATE,
  data_fim DATE,
  efetivo_capacitado INTEGER CHECK (efetivo_capacitado IS NULL OR efetivo_capacitado >= 0),
  militares TEXT,
  plano_codigo VARCHAR(255),
  documento VARCHAR(255),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);

COMMENT ON TABLE rpcmtec.capacitacao IS
    'Capacitação ministrada (2.6 do RPCMTec) ou recebida (6.2). O tipo decide quais colunas a linha preenche.';

CREATE INDEX IF NOT EXISTS idx_capacitacao_ano ON rpcmtec.capacitacao (ano);

-- ---------------------------------------------------------------------------
-- 7. Acesso as tabelas novas
-- ---------------------------------------------------------------------------
-- O `GRANT ... ON ALL TABLES IN SCHEMA` do er/permissao.sql vale para o que
-- existia NA HORA em que ele rodou. Os schemas `pit`, `rpcmtec` e `dominio` ja
-- tem o USAGE, mas as tabelas criadas aqui nasceriam sem permissao nenhuma, e a
-- primeira escrita depois da migracao falharia com "permission denied".
--
-- `dominio` e SELECT apenas, como no er/permissao.sql: tabela de dominio se
-- carrega por DDL, e nao por tela.
--
-- O usuario da aplicacao e identificado como o dono do schema `dgeo`, mesmo
-- criterio de 2026-08-02_autenticacao_local.sql e de 2026-08-02_rastreabilidade.sql.
DO $$
DECLARE
  app_user TEXT;
BEGIN
  SELECT nspowner::regrole::text INTO app_user
  FROM pg_namespace WHERE nspname = 'dgeo';

  IF app_user IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'GRANT SELECT ON dominio.situacao_extra_pit, dominio.tipo_capacitacao, dominio.situacao_capacitacao TO %I',
    app_user);

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON pit.execucao, pit.demanda_extra TO %I',
    app_user);
  EXECUTE format(
    'GRANT USAGE, SELECT ON SEQUENCE pit.execucao_id_seq, pit.demanda_extra_id_seq TO %I',
    app_user);

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON rpcmtec.aproveitamento_mes, rpcmtec.capacitacao TO %I',
    app_user);
  EXECUTE format(
    'GRANT USAGE, SELECT ON SEQUENCE rpcmtec.aproveitamento_mes_id_seq, rpcmtec.capacitacao_id_seq TO %I',
    app_user);
END $$;

UPDATE public.versao SET nome = '1.15.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde os lancamentos, o Extra-PIT, o efetivo e a capacitacao):
--   DROP TABLE IF EXISTS rpcmtec.capacitacao;
--   DROP TABLE IF EXISTS rpcmtec.aproveitamento_mes;
--   DROP TABLE IF EXISTS pit.demanda_extra;
--   DROP TABLE IF EXISTS pit.execucao;
--   ALTER TABLE pit.meta
--     DROP CONSTRAINT IF EXISTS meta_quantidade_prevista_check,
--     DROP COLUMN IF EXISTS quantidade_prevista,
--     DROP COLUMN IF EXISTS unidade,
--     DROP COLUMN IF EXISTS demandante,
--     DROP COLUMN IF EXISTS prazo;
--   DROP TABLE IF EXISTS dominio.situacao_capacitacao;
--   DROP TABLE IF EXISTS dominio.tipo_capacitacao;
--   DROP TABLE IF EXISTS dominio.situacao_extra_pit;
--   UPDATE public.versao SET nome = '1.14.0' WHERE code = 1;
