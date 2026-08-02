-- O aproveitamento do efetivo deixa de ser retrato MENSAL e vira INTERVALO.
--
-- O QUE ESTAVA ERRADO. `rpcmtec.aproveitamento_mes` nasceu horas antes, na
-- 1.15.0, copiando o formato que o SAP copiou do RPCMTec de 2026: uma linha por
-- pessoa por mes, com um texto livre de atividades. Ela media a coisa errada.
--
-- A prova esta no proprio documento. Ate 2025 a subsecao 6.1 tinha QUATRO
-- colunas (Servicos, Funcoes Administrativas, Dias nao apresentado), e em 2026
-- elas viraram duas (Militar, Atividades). A tabela deixou de medir, e nos
-- herdamos a versao que perdeu a conta. O numero, porem, continua sendo usado: o
-- fechamento de 2025 registra "2o Sgt Barreto (17%, funcoes fora da DGEO desde
-- 06 MAR)", que e 2 meses de 12.
--
-- Texto livre nao soma, nao compara entre meses e nao responde "por que 70%". E
-- retrato mensal nao sabe dizer o que aconteceu no dia 06 de marco.
--
-- A SAIDA (chefe, 2026-08-02): dois intervalos. `dgeo.efetivo_periodo` diz
-- quando a pessoa esteve na Divisao, e `dgeo.impedimento` diz o que a tirou do
-- trabalho sem tira-la da Divisao, e quanto. O mes deixa de ser DADO e vira
-- CONSULTA: o aproveitamento de qualquer recorte sai de uma conta de dias.
--
-- POR QUE EM `dgeo`, e nao em `rpcmtec`. "Quem esteve na Divisao e quando" nao
-- existe por causa do relatorio: o relatorio e um leitor. E dado de pessoa, e
-- mora junto de `dgeo.usuario`.
--
-- O QUE SE PERDE, e esta aceito: o congelamento do posto. A linha do mes
-- guardava o posto da epoca, e agora ele vem do cadastro. Decisao do chefe: o
-- que importa e a associacao com a PESSOA, e a promocao nao muda quem esteve na
-- Divisao em marco.
--
-- A TABELA ANTIGA E APAGADA, e nao migrada. Ela nasceu e morreu no mesmo dia,
-- nunca teve linha em producao, e converter "atividades" em texto livre para
-- intervalo com percentual exigiria adivinhar as datas e o peso de cada uma. A
-- guarda abaixo aborta a migracao se houver dado, para o caso de alguem ter
-- preenchido entre uma versao e outra.
--
-- Idempotente: IF NOT EXISTS e DO blocks que conferem antes de agir.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Guarda: nao apagar dado de ninguem em silencio
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    linhas INTEGER;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables
        WHERE schemaname = 'rpcmtec' AND tablename = 'aproveitamento_mes'
    ) THEN
        EXECUTE 'SELECT COUNT(*) FROM rpcmtec.aproveitamento_mes' INTO linhas;
        IF linhas > 0 THEN
            RAISE EXCEPTION
                'Migracao abortada: rpcmtec.aproveitamento_mes tem % linha(s). Ela seria apagada, e a conversao para intervalo exigiria adivinhar datas. Exporte antes e reaplique.',
                linhas;
        END IF;
    END IF;
END
$$;

DROP TABLE IF EXISTS rpcmtec.aproveitamento_mes;

-- ---------------------------------------------------------------------------
-- 2. Extensao do EXCLUDE
-- ---------------------------------------------------------------------------
-- O indice GiST nao sabe comparar UUID por igualdade sem ela, e e essa igualdade
-- que restringe a nao sobreposicao a UMA pessoa por vez. Vem com o PostgreSQL.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 3. Passagem pela DGEO
-- ---------------------------------------------------------------------------
-- Uma linha por passagem, e a mesma pessoa pode ter varias: quem sai e volta tem
-- duas, e o intervalo entre elas diz que ela nao estava. `data_fim` NULA e "sem
-- previsao de saida", que e o caso comum.
CREATE TABLE IF NOT EXISTS dgeo.efetivo_periodo(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_inicio DATE NOT NULL,
  data_fim DATE,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT efetivo_periodo_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_fim >= data_inicio),
  -- A NAO SOBREPOSICAO E DO BANCO, e nao do codigo: a regra vale para a tela,
  -- para o CLI, para a carga e para o `psql` de quem vier depois. O `[]` fecha os
  -- dois lados, entao sair no dia 30 e voltar no dia 30 e sobreposicao, e nao
  -- continuidade.
  CONSTRAINT efetivo_periodo_sem_sobreposicao
    EXCLUDE USING gist (
      usuario_uuid WITH =,
      daterange(data_inicio, data_fim, '[]') WITH &&
    )
);

COMMENT ON TABLE dgeo.efetivo_periodo IS
    'Passagem de uma pessoa pela DGEO. data_fim NULA é "sem previsão de saída". Intervalos da mesma pessoa não se sobrepõem, e quem garante é o banco.';

CREATE INDEX IF NOT EXISTS idx_efetivo_periodo_usuario
    ON dgeo.efetivo_periodo (usuario_uuid);
CREATE INDEX IF NOT EXISTS idx_efetivo_periodo_inicio
    ON dgeo.efetivo_periodo (data_inicio);

-- ---------------------------------------------------------------------------
-- 4. Impedimento
-- ---------------------------------------------------------------------------
-- O que tira a pessoa do trabalho da Divisao sem tira-la da Divisao: funcao
-- acumulada fora da DGEO, licenca de saude, curso, ferias, missao.
--
-- A DESCRICAO E TEXTO LIVRE, sem catalogo de tipo (chefe, 2026-08-02). Um
-- catalogo obrigaria a classificar antes de escrever, e a lista de motivos nao
-- fecha.
--
-- SEM EXCLUDE aqui, ao contrario da passagem: impedimentos PODEM se sobrepor, e
-- e o caso real. O 1o Ten Raul Magno estava em LTSP E chefiando o S5. Os
-- percentuais somam, e a soma e truncada em 100% na leitura.
CREATE TABLE IF NOT EXISTS dgeo.impedimento(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  descricao VARCHAR(255) NOT NULL,
  percentual SMALLINT NOT NULL CHECK (percentual BETWEEN 1 AND 100),
  data_inicio DATE NOT NULL,
  data_fim DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT impedimento_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

COMMENT ON TABLE dgeo.impedimento IS
    'O que tira a pessoa do trabalho da Divisão sem tirá-la da Divisão. data_fim NULA é "sem previsão de término". Impedimentos da mesma pessoa PODEM se sobrepor, e os percentuais somam.';

CREATE INDEX IF NOT EXISTS idx_impedimento_usuario ON dgeo.impedimento (usuario_uuid);
CREATE INDEX IF NOT EXISTS idx_impedimento_inicio ON dgeo.impedimento (data_inicio);

-- ---------------------------------------------------------------------------
-- 5. Acesso as tabelas novas
-- ---------------------------------------------------------------------------
-- O `GRANT ... ON ALL TABLES IN SCHEMA` do er/permissao.sql vale para o que
-- existia NA HORA em que ele rodou. O schema `dgeo` ja tem o USAGE, mas as
-- tabelas criadas aqui nasceriam sem permissao nenhuma.
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
    'GRANT SELECT, INSERT, UPDATE, DELETE ON dgeo.efetivo_periodo, dgeo.impedimento TO %I',
    app_user);
  EXECUTE format(
    'GRANT USAGE, SELECT ON SEQUENCE dgeo.efetivo_periodo_id_seq, dgeo.impedimento_id_seq TO %I',
    app_user);
END $$;

UPDATE public.versao SET nome = '1.16.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde as passagens e os impedimentos):
--   DROP TABLE IF EXISTS dgeo.impedimento;
--   DROP TABLE IF EXISTS dgeo.efetivo_periodo;
--   -- a tabela antiga volta vazia, que e como ela estava:
--   CREATE TABLE rpcmtec.aproveitamento_mes(
--     id BIGSERIAL NOT NULL PRIMARY KEY,
--     ano SMALLINT NOT NULL,
--     mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
--     usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
--     tipo_posto_grad_id SMALLINT NOT NULL REFERENCES dominio.tipo_posto_grad (code),
--     atividades TEXT,
--     data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
--     usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
--     data_modificacao TIMESTAMP WITH TIME ZONE,
--     usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
--     UNIQUE (ano, mes, usuario_uuid));
--   UPDATE public.versao SET nome = '1.15.0' WHERE code = 1;
