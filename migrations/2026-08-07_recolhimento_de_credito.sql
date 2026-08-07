-- O RECOLHIMENTO DE CREDITO VIRA DOCUMENTO, E DEIXA DE SER UM NUMERO DIGITADO.
--
-- A DECISAO e do chefe da DGEO, em 2026-08-07, depois de o SAG (espelho do
-- SIAFI) mostrar o que a coluna escondia.
--
-- O QUE O BANCO FAZIA. `orcamento.nota_credito.valor_recolhido` era um NUMERO
-- que alguem digitava na propria NC, para dizer quanto daquele credito foi
-- devolvido. O documento que produziu a devolucao nao existia em lugar nenhum:
-- nem o numero da NC de recolhimento, nem a data, nem o historico, nem o PDF.
--
-- O QUE FOI MEDIDO EM PRODUCAO (2026-08-07, contra o SAG, exercicio 2026, acao
-- 20XE). O ano teve 23 notas de credito de anulacao e recolhimento, ND 339000 e
-- 449000, somando R$ 81.910,10. O texto de cada uma diz qual NC ela abate, e as
-- 23 casaram em 17 NCs alvo, fechando o total no centavo. No SCA, 11 alvos
-- tinham o valor certo, 5 estavam com 0,00 e 1 nao existia. As 5 foram
-- corrigidas a mao no mesmo dia; nada impedia que voltassem a divergir, porque
-- a fonte do numero era a memoria de quem digitou.
--
-- O DESENHO NOVO. Uma linha por documento de recolhimento, apontando a NC que
-- ela abate. `valor_recolhido` SAI da nota de credito e passa a ser a SOMA
-- destas linhas. Some um campo manual, entra a rastreabilidade, e a aritmetica
-- da Secao 4 do RPCMTec nao muda: onde antes se lia a coluna, le-se a soma.
--
-- POR QUE NAO CADASTRAR O RECOLHIMENTO COMO UMA NC COMUM, com classificacao
-- propria. Porque ele nao e credito recebido, e toda consulta que soma
-- `valor_nc` teria de aprender a excluir uma classificacao. A 4.1, a 4.2 e a 4.7
-- somam recebido; um recolhimento entrando ali como linha positiva estragaria as
-- tres, e a protecao seria um filtro repetido em cada consulta, que e
-- exatamente o tipo de regra que se esquece na quarta.
--
-- ============================================================================
-- ORDEM DE APLICACAO. Esta migracao TRAVA se os dados nao estiverem prontos:
-- o indice unico de `nota_empenho` nao nasce com numero repetido. Resolva os
-- duplicados ANTES (ver o bloco DO abaixo, que lista quais sao).
-- ============================================================================
--
-- O QUE MUDA NO CODIGO, e sem isto a aplicacao quebra:
--   server/src/orcamento/nota_credito/nota_credito_ctrl.js  (listar e obter
--     passam a somar da tabela nova; criar e atualizar param de gravar a coluna)
--   server/src/orcamento/nota_credito/nota_credito_schema.js (tira o campo)
--   server/src/orcamento/nota_empenho/nota_empenho_ctrl.js  (saldo da NC)
--   server/src/orcamento/dashboard/dashboard_ctrl.js
--   server/src/rpcmtec/rpcmtec_ctrl.js                      (4.1, 4.2 e 4.7)
--   server/src/auditoria/mapa/orcamento.js                  (entidade nova)
--   client: notas-credito/list.js, nota-credito-dialog.js, notas-empenho/*
--   orcamento_cli: lib/recursos.js e lib/regras.js
--
-- COMO REVERTER: ver o rodape.

BEGIN;

-- ---------------------------------------------------------------------------
-- 2. O documento de recolhimento.
-- ---------------------------------------------------------------------------
-- Uma linha por NC de recolhimento QUE ABATE uma NC nossa. O vinculo e
-- obrigatorio: recolhimento que nao abate credito nenhum nao e deste modulo.
--
-- `numero` NAO e unico sozinho: uma unica NC de recolhimento pode abater DUAS
-- NCs nossas, e nesse caso ela entra uma vez por alvo, com o valor rateado. Foi
-- medido: a 2026NC401316 recolhe R$ 0,98 da 400224 e R$ 0,99 da 400937, e o
-- proprio texto do SIAFI traz o rateio. A unicidade e o par (numero, alvo).
CREATE TABLE IF NOT EXISTS orcamento.nota_credito_recolhimento(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nota_credito_id BIGINT NOT NULL REFERENCES orcamento.nota_credito (id) ON DELETE CASCADE,
  numero VARCHAR(20) NOT NULL,
  ano SMALLINT NOT NULL,
  data_emissao DATE,
  -- A ND do documento de recolhimento (339000, 449000) e a da ANULACAO, e nao a
  -- da NC alvo. Fica aqui porque e o que o extrato mostra, e sem ela o
  -- documento nao se acha no SIAFI.
  cod_nd VARCHAR(6) REFERENCES dominio.natureza_despesa (code),
  ug_emitente VARCHAR(10) REFERENCES dominio.ug (code),
  valor NUMERIC(15,2) NOT NULL CHECK (valor > 0),
  finalidade_historico TEXT,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT uniq_recolhimento_por_alvo UNIQUE (ano, numero, nota_credito_id)
);

COMMENT ON TABLE orcamento.nota_credito_recolhimento IS
    'Documento de recolhimento ou anulacao de credito, apontando a nota de credito que ele abate. A soma por NC substitui a coluna valor_recolhido.';

CREATE INDEX IF NOT EXISTS idx_recolhimento_nc ON orcamento.nota_credito_recolhimento (nota_credito_id);
CREATE INDEX IF NOT EXISTS idx_recolhimento_ano ON orcamento.nota_credito_recolhimento (ano);

-- ---------------------------------------------------------------------------
-- 3. O PDF do recolhimento ganha casa.
-- ---------------------------------------------------------------------------
-- O `arquivo` do modulo e polimorfico com CHECK de vinculo unico. Entra o sexto
-- dono. Multiplo, como licitacao e RPNP: o extrato do SIAFI e o DIEx que pede a
-- devolucao sao dois documentos, e limitar a um obrigaria a escolher.
ALTER TABLE orcamento.arquivo
  ADD COLUMN IF NOT EXISTS recolhimento_id BIGINT REFERENCES orcamento.nota_credito_recolhimento (id) ON DELETE CASCADE;

ALTER TABLE orcamento.arquivo DROP CONSTRAINT IF EXISTS arquivo_um_vinculo;
ALTER TABLE orcamento.arquivo ADD CONSTRAINT arquivo_um_vinculo CHECK (
  (nota_credito_id IS NOT NULL)::int +
  (dfd_id IS NOT NULL)::int +
  (pdr_ano IS NOT NULL)::int +
  (licitacao_id IS NOT NULL)::int +
  (rpnp_id IS NOT NULL)::int +
  (recolhimento_id IS NOT NULL)::int = 1
);

CREATE INDEX IF NOT EXISTS idx_arquivo_recolhimento ON orcamento.arquivo (recolhimento_id);

-- ---------------------------------------------------------------------------
-- 4. Preserva o que a coluna ja afirmava, antes de apaga-la.
-- ---------------------------------------------------------------------------
-- Cada NC com valor_recolhido > 0 vira UMA linha de recolhimento, marcada como
-- carga. Ela nao tem numero de documento, porque a coluna nunca guardou um: o
-- numero fica com o prefixo CARGA- para que ninguem o confunda com um documento
-- do SIAFI, e a observacao diz de onde veio.
--
-- SEM ISTO A MIGRACAO PERDERIA DADO: sao R$ 80.208,27 em 16 NCs de 2026 na
-- medicao de 2026-08-07, e o total do recolhido cairia a zero no relatorio.
-- A CARGA E A QUEDA DA COLUNA SO ACONTECEM NA PRIMEIRA PASSADA, e o bloco e
-- condicional por isto: o repositorio promete migracao idempotente, e na segunda
-- passada a coluna ja nao existe. Sem o IF, a reaplicacao morre no SELECT.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'orcamento'
       AND table_name = 'nota_credito'
       AND column_name = 'valor_recolhido'
  ) THEN
    INSERT INTO orcamento.nota_credito_recolhimento(
      nota_credito_id, numero, ano, data_emissao, cod_nd, ug_emitente, valor,
      finalidade_historico, observacao, usuario_cadastramento_uuid
    )
    SELECT
      nc.id,
      'CARGA-' || nc.numero,
      nc.ano,
      NULL, NULL, NULL,
      nc.valor_recolhido,
      NULL,
      'Carga da coluna valor_recolhido na migracao 1.40.0. O documento de origem '
        || 'nao foi registrado; substitua por ele quando o extrato do SIAFI estiver a mao.',
      nc.usuario_cadastramento_uuid
    FROM orcamento.nota_credito AS nc
    WHERE nc.valor_recolhido > 0
    ON CONFLICT ON CONSTRAINT uniq_recolhimento_por_alvo DO NOTHING;

    ALTER TABLE orcamento.nota_credito DROP COLUMN valor_recolhido;
  END IF;
END $$;

UPDATE public.versao SET nome = '1.40.0' WHERE code = 1;

COMMIT;

-- ---------------------------------------------------------------------------
-- COMO REVERTER
-- ---------------------------------------------------------------------------
--   1. ALTER TABLE orcamento.nota_credito
--        ADD COLUMN valor_recolhido NUMERIC(15,2) NOT NULL DEFAULT 0;
--   2. UPDATE orcamento.nota_credito nc
--        SET valor_recolhido = COALESCE((
--          SELECT SUM(r.valor) FROM orcamento.nota_credito_recolhimento r
--           WHERE r.nota_credito_id = nc.id), 0);
--      (Isto recompoe a coluna INCLUSIVE com os recolhimentos cadastrados depois
--      da migracao, o que e mais do que ela tinha antes. Nada se perde.)
--   4. ALTER TABLE orcamento.arquivo DROP COLUMN recolhimento_id;
--      (Refaca o CHECK arquivo_um_vinculo sem a sexta parcela.)
--   5. DROP TABLE orcamento.nota_credito_recolhimento;
--   6. UPDATE public.versao SET nome = '1.39.0' WHERE code = 1;
--   7. Reverter as mudancas de codigo listadas no cabecalho.
