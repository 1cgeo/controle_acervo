-- Quantidade de material passa de DECIMAL(10,2) para INTEGER.
--
-- POR QUE. Material da mapoteca conta-se em UNIDADE: folha de
-- sulfite, cartucho, rolo. Meia folha e meio cartucho nao existem, e a casa
-- decimal so criava tres problemas: o estoque exibia "150,00" onde a pessoa
-- escreveu 150, o formulario aceitava 1,5 sem reclamar, e a soma de fracoes
-- deixava saldo como 0,01 que nunca fecha.
--
-- SEM RISCO DE DADO: as duas tabelas estao VAZIAS na producao (conferido em
-- 2026-07-30, zero linhas em consumo_material e em estoque_material). Nao ha
-- valor para arredondar. Se algum dia houver, confira ANTES:
--   SELECT count(*) FROM mapoteca.consumo_material WHERE quantidade <> trunc(quantidade);
--   SELECT count(*) FROM mapoteca.estoque_material  WHERE quantidade <> trunc(quantidade);
-- Linha com fracao exige decisao (arredondar para cima? para baixo?), e nao um
-- cast silencioso: o USING abaixo arredonda, o que perderia a fracao sem aviso.
--
-- Os CHECK continuam como estao (consumo > 0, estoque >= 0): eles nao dependem do
-- tipo, e o ALTER TYPE os preserva.
--
-- Idempotente: converte so se o tipo ainda nao for integer. Reaplicar nao faz
-- nada.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'consumo_material'
          AND column_name = 'quantidade' AND data_type <> 'integer'
    ) THEN
        ALTER TABLE mapoteca.consumo_material
            ALTER COLUMN quantidade TYPE INTEGER USING round(quantidade)::integer;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'estoque_material'
          AND column_name = 'quantidade' AND data_type <> 'integer'
    ) THEN
        ALTER TABLE mapoteca.estoque_material
            ALTER COLUMN quantidade TYPE INTEGER USING round(quantidade)::integer;
    END IF;

    -- O limiar de alerta e a meta anual contam o MESMO material, em unidade:
    -- seguem juntos. Na producao os 21 tipos de material tem os dois NULOS
    -- (conferido em 2026-07-30), entao aqui tambem nao ha valor para arredondar.
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'tipo_material'
          AND column_name = 'estoque_minimo' AND data_type <> 'integer'
    ) THEN
        ALTER TABLE mapoteca.tipo_material
            ALTER COLUMN estoque_minimo TYPE INTEGER USING round(estoque_minimo)::integer;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'tipo_material'
          AND column_name = 'meta_anual' AND data_type <> 'integer'
    ) THEN
        ALTER TABLE mapoteca.tipo_material
            ALTER COLUMN meta_anual TYPE INTEGER USING round(meta_anual)::integer;
    END IF;
END $$;

-- Os CHECK são REESCRITOS, e não só herdados.
--
-- O ALTER TYPE preserva a restrição, mas na forma antiga: ela fica
-- `((quantidade)::numeric > (0)::numeric)`, com o cast que existia quando a
-- coluna era DECIMAL. Instalação nova pelo er/ nasce com `(quantidade > 0)`. As
-- duas valem o mesmo, e ainda assim o banco migrado deixaria de ser igual ao
-- novo, o que é justamente o que o ensaiar_migracao.cjs cobra (e cobrou: quatro
-- divergências na primeira tentativa, em 2026-07-30).
--
-- Drop seguido de add é idempotente: reaplicar termina no mesmo estado.
ALTER TABLE mapoteca.consumo_material
    DROP CONSTRAINT IF EXISTS consumo_material_quantidade_check;
ALTER TABLE mapoteca.consumo_material
    ADD CONSTRAINT consumo_material_quantidade_check CHECK (quantidade > 0);

ALTER TABLE mapoteca.estoque_material
    DROP CONSTRAINT IF EXISTS estoque_material_quantidade_check;
ALTER TABLE mapoteca.estoque_material
    ADD CONSTRAINT estoque_material_quantidade_check CHECK (quantidade >= 0);

COMMENT ON COLUMN mapoteca.consumo_material.quantidade IS
    'Unidades consumidas. INTEGER de propósito: material da mapoteca conta-se em unidade, e meia folha não existe.';
COMMENT ON COLUMN mapoteca.estoque_material.quantidade IS
    'Unidades em estoque na localização. INTEGER de propósito: ver consumo_material.quantidade.';

COMMIT;

-- Para desfazer:
--   ALTER TABLE mapoteca.consumo_material ALTER COLUMN quantidade TYPE DECIMAL(10,2);
--   ALTER TABLE mapoteca.estoque_material  ALTER COLUMN quantidade TYPE DECIMAL(10,2);
--   ALTER TABLE mapoteca.tipo_material ALTER COLUMN estoque_minimo TYPE DECIMAL(10,2);
--   ALTER TABLE mapoteca.tipo_material ALTER COLUMN meta_anual TYPE DECIMAL(10,2);
