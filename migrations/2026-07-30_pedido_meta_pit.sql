-- Coluna nova em mapoteca.pedido: meta_pit.
--
-- POR QUE. O pedido ja diz SE e previsto no PIT (previsto_pit, booleano), mas
-- nao diz QUAL meta ele atende. A aba "Detalhado" da planilha de controle tem a
-- coluna "Meta" desde sempre, com o codigo do item do PIT ('4.1', '4.2'), e o
-- exportador do SCA a emitia vazia porque o dado nao existia no banco. Ate
-- 2026-07-29 essa coluna chegou a trazer p.prazo, ou seja, uma DATA sob o
-- rotulo "Meta".
--
-- POR QUE NAO SE DERIVA DO MATERIAL. Em 2026 o codigo da meta e funcao do
-- material previsto, sem uma excecao nas 107 linhas do ano: 4.1 e sulfite, 4.2
-- e tyvek, 4.3 e glossy. Isso acontece porque a Meta 4 do PIT 2026 e
-- "Impressao" e os sub-itens dela sao o material. E acidente do ano, nao regra:
-- o PIT e reescrito todo ano e a numeracao das metas muda com ele. Derivar o
-- codigo do material amarraria no schema uma coincidencia de 2026 e quebraria
-- calado em 2027. Decisao do chefe, 2026-07-30: a meta e um dado proprio.
--
-- ONDE MORA. No PEDIDO, nao no item. Decisao do chefe, 2026-07-30. Um pedido
-- atende uma meta; se um dia precisar de duas, sao dois pedidos.
--
-- O CHECK e a rede: previsto_pit verdadeiro exige meta_pit. A regra tambem vive
-- no Joi (erro 400 limpo), e o CHECK garante que nenhuma outra porta grave a
-- combinacao invalida. Nenhuma linha existente reprova: em 2026-07-30 os 117
-- pedidos tinham previsto_pit = false.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS mais um DO que so cria o CHECK se ele
-- ainda nao existe. Reaplicar nao faz nada.

BEGIN;

ALTER TABLE mapoteca.pedido
    ADD COLUMN IF NOT EXISTS meta_pit VARCHAR(10);

COMMENT ON COLUMN mapoteca.pedido.meta_pit IS
    'Código do item da meta do PIT que o pedido atende (ex.: 4.1). Obrigatório quando previsto_pit é verdadeiro, nulo caso contrário. NÃO se deriva do material: a correlação valeu só em 2026.';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pedido_meta_pit_exige_previsto'
          AND conrelid = 'mapoteca.pedido'::regclass
    ) THEN
        ALTER TABLE mapoteca.pedido
            ADD CONSTRAINT pedido_meta_pit_exige_previsto
            CHECK (NOT previsto_pit OR meta_pit IS NOT NULL);
    END IF;
END
$$;

COMMIT;

-- Para desfazer:
--   ALTER TABLE mapoteca.pedido DROP CONSTRAINT IF EXISTS pedido_meta_pit_exige_previsto;
--   ALTER TABLE mapoteca.pedido DROP COLUMN IF EXISTS meta_pit;
