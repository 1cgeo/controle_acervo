-- mapoteca.pedido_auditoria muda de casa: vira linha de auditoria.evento.
--
-- POR QUE. A tabela de 2026-07-30 respondia as quatro perguntas ("o que mudou,
-- quando, por quem, e qual era o estado anterior") para UM agregado so, e o
-- desenho dizia isso na coluna: `pedido_id BIGINT NOT NULL`. Cliente, plotter,
-- tipo de material, produto do acervo, nota de empenho e usuario nao tem pedido
-- nenhum, entao a tabela nao tinha como crescer para os tres modulos sem essa
-- coluna virar mentira. `auditoria.evento` (migracao anterior,
-- 2026-08-02_rastreabilidade.sql) troca o pedido por (modulo, entidade,
-- entidade_id), e o pedido passa a ser UM agregado entre outros.
--
-- O QUE SE PERDE, e e deliberado:
--
--   1. A `origem` do que ja estava gravado. O evento antigo pode ter vindo da
--      web ou do plugin do QGIS, e a tabela nao guardava por onde entrou. Quem
--      tem usuario vira 'desconhecido', e NAO 'web': afirmar a porta seria
--      inventar um dado que ninguem mediu, e o rastro perde o sentido no dia em
--      que o valor plausivel for tomado por verdade. Quem nao tem usuario vira
--      'migracao', que e o que a linha sempre foi.
--   2. A chave estrangeira `usuario_uuid REFERENCES dgeo.usuario`. A tabela
--      nova nao tem nenhuma, de proposito: o rastro do que a pessoa fez nao
--      pode cair junto com a pessoa apagada. Nada nas linhas migradas muda --
--      elas passaram pela FK quando nasceram --, o que se perde e a garantia
--      dali para a frente, e ela e o preco de o rastro sobreviver.
--   3. `rota`, `lote_id` e `motivo` ficam NULOS no que veio de la. Nao havia
--      coluna para eles, e preenche-los por deducao seria o mesmo erro do
--      item 1.
--
-- O `tabela` ganha o schema ('pedido' -> 'mapoteca.pedido'), porque a chave do
-- mapa de entidades do servidor e sempre `schema.tabela`: 'arquivo' sozinho e
-- ambiguo entre acervo, orcamento e ponto_controle, e a tabela nova serve os
-- tres modulos.
--
-- `entidade_id` e `registro_id` viram TEXTO porque o sistema identifica
-- registro por id inteiro, por uuid e por code de dominio.
--
-- A URL nao muda: `GET /api/mapoteca/pedido/:id/auditoria` continua existindo,
-- com a mesma guarda e a mesma forma de resposta, servida pelo controller novo.
-- Uma coisa por vez -- a tela do pedido nao se mexe neste commit.
--
-- Idempotente: o bloco so roda enquanto a tabela antiga existir. Na segunda
-- passada ela ja foi derrubada e nada acontece.
--
-- Ensaio (a CADEIA das duas, e nao uma de cada vez):
--   node migrations/ensaiar_migracao.cjs
--     --migracao migrations/2026-08-02_rastreabilidade.sql,migrations/2026-08-02_rastreabilidade_pedido.sql
--     --novos er/auditoria.sql
--     --versao-anterior 1.12.0 --versao-esperada 1.14.0
--     --schemas auditoria,mapoteca --er-de HEAD
--
-- POR QUE AS DUAS JUNTAS. A primeira sozinha para em 1.13.0 e o er/ ja esta em
-- 1.14.0, entao o ensaio dela reprovaria na versao; e a segunda sozinha nao
-- provaria a SEQUENCIA, que e o que roda em producao. O ensaiar_migracao.cjs
-- passou a aceitar cadeia separada por virgula por causa deste par.
--
-- O `--er-de HEAD` e obrigatorio porque a segunda REMOVE do er/ uma tabela que o
-- banco anterior tinha: sem ele o "banco de ontem" nasce sem ela, a migracao de
-- dados nao acha nada para migrar e vira um no-op disfarcado de sucesso.
--
-- Ensaiado em 2026-08-02: 148 colunas, 69 restricoes e 42 indices conferidos, o
-- banco MIGRADO e o NOVO com o mesmo schema, e a cadeia passou duas vezes.

BEGIN;

DO $$
DECLARE
  migradas BIGINT;
BEGIN
  IF to_regclass('mapoteca.pedido_auditoria') IS NULL THEN
    RAISE NOTICE 'mapoteca.pedido_auditoria nao existe; nada a migrar.';
    RETURN;
  END IF;

  INSERT INTO auditoria.evento
    (modulo, entidade, entidade_id, tabela, registro_id, operacao,
     dados_antes, dados_depois, campos_alterados, usuario_uuid, data_evento,
     origem)
  SELECT 'mapoteca',
         'pedido',
         pa.pedido_id::text,
         'mapoteca.' || pa.tabela,
         pa.registro_id::text,
         pa.operacao,
         pa.dados_antes,
         pa.dados_depois,
         pa.campos_alterados,
         pa.usuario_uuid,
         pa.data_evento,
         CASE WHEN pa.usuario_uuid IS NULL THEN 'migracao' ELSE 'desconhecido' END
    FROM mapoteca.pedido_auditoria AS pa
   ORDER BY pa.id;

  GET DIAGNOSTICS migradas = ROW_COUNT;

  -- Em producao, CONFIRA esta contagem contra a da tabela antiga antes de
  -- deixar o COMMIT passar. O DROP e irreversivel, e o INSERT ... SELECT nao
  -- reclama de nada quando copia zero linha.
  RAISE NOTICE 'Eventos migrados de mapoteca.pedido_auditoria: %', migradas;

  DROP TABLE mapoteca.pedido_auditoria;
END $$;

UPDATE public.versao SET nome = '1.14.0' WHERE code = 1;

COMMIT;

-- Para desfazer (recria a tabela vazia e devolve o que veio dela; o que nasceu
-- depois, na tabela nova, fica onde esta):
--   CREATE TABLE mapoteca.pedido_auditoria(
--       id BIGSERIAL PRIMARY KEY,
--       pedido_id BIGINT NOT NULL,
--       tabela VARCHAR(50) NOT NULL,
--       registro_id BIGINT,
--       operacao CHAR(1) NOT NULL CHECK (operacao IN ('I','U','D')),
--       dados_antes JSONB,
--       dados_depois JSONB,
--       campos_alterados TEXT[],
--       usuario_uuid UUID REFERENCES dgeo.usuario (uuid),
--       data_evento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
--   );
--   CREATE INDEX idx_pedido_auditoria_pedido
--       ON mapoteca.pedido_auditoria(pedido_id, data_evento DESC);
--   INSERT INTO mapoteca.pedido_auditoria
--     (pedido_id, tabela, registro_id, operacao, dados_antes, dados_depois,
--      campos_alterados, usuario_uuid, data_evento)
--   SELECT entidade_id::bigint, replace(tabela, 'mapoteca.', ''),
--          registro_id::bigint, operacao, dados_antes, dados_depois,
--          campos_alterados, usuario_uuid, data_evento
--     FROM auditoria.evento
--    WHERE modulo = 'mapoteca' AND entidade = 'pedido';
--   UPDATE public.versao SET nome = '1.13.0' WHERE code = 1;
