-- O PRODUTO QUE NAO TEM ESCALA PASSA A PODER DIZER ISSO.
--
-- POR QUE. `acervo.produto.tipo_escala_id` e NOT NULL, e o dominio so oferecia
-- quatro escalas do mapeamento sistematico mais a personalizada. Um modelo 3D
-- (tipo_produto 9) e uma panoramica 360 nao tem denominador nenhum: a escala de
-- um tileset varia com a distancia da camera. Sem esta linha, cadastra-los
-- obrigaria a escolher `Escala personalizada` (code 5) e inventar um
-- denominador, que o CHECK exige NOT NULL nesse caso. A tela passaria a mostrar
-- "1:1.000" num modelo tridimensional, e o numero seria mentira gravada.
--
-- POR QUE NAO MUDA O CHECK. O CHECK de `acervo.produto` ja diz
-- `(tipo_escala_id = 5 AND denominador IS NOT NULL) OR (tipo_escala_id != 5 AND
-- denominador IS NULL)`. O code 6 cai no segundo ramo e exige denominador NULL,
-- que e exatamente o desejado. Nenhuma restricao muda.
--
-- POR QUE NAO MUDA CODIGO. Nenhum ponto do `server/` traz a lista de escalas
-- embutida: o Joi valida `tipo_escala_id` como inteiro e as consultas fazem
-- JOIN em `dominio.tipo_escala`. `acervo.nome_arquivo_padrao` ja degrada para o
-- sufixo `esp` em qualquer escala fora de 1 a 4, porque o ELSE dela e
-- `coalesce('e' || denominador, 'esp')` e aqui o denominador e NULL.
--
-- POR QUE CHAMA `criar_views_materializadas`. O `er/acompanhamento.sql` cria uma
-- view materializada `acervo.mv_produto_<tipo>_<escala>` para CADA par de
-- codigos, com dois indices e um GRANT. Escala nova sem essa chamada deixaria a
-- instalacao ATUALIZADA com 13 views a menos do que a instalacao NOVA, e foi
-- exatamente isso que o `ensaiar_migracao.cjs` reprovou na primeira volta: 26
-- indices so no banco novo. A funcao usa IF NOT EXISTS em tudo, entao nao toca
-- nas views que ja existem.
--
-- IDEMPOTENTE pelo ON CONFLICT e pelo IF NOT EXISTS das views: reaplicar nao
-- duplica nem falha.

BEGIN;

INSERT INTO dominio.tipo_escala (code, nome) VALUES
(6, 'Sem escala')
ON CONFLICT (code) DO NOTHING;

-- As 13 views materializadas da escala nova, uma por tipo de produto, com os
-- dois indices e o GRANT de cada uma.
SELECT acervo.criar_views_materializadas();

UPDATE public.versao SET nome = '3.10.0' WHERE code = 1;

COMMIT;

-- COMO DESFAZER
--
-- So e reversivel enquanto nenhum produto usar o code 6. O DELETE abaixo falha
-- pela FK se ja houver, e falhar e o certo: apagar a escala de um produto vivo
-- deixaria a linha orfa.
--
--   BEGIN;
--   DO $$ DECLARE t RECORD; BEGIN
--     FOR t IN SELECT code FROM dominio.tipo_produto LOOP
--       EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS acervo.mv_produto_%s_6', t.code);
--     END LOOP;
--   END $$;
--   DELETE FROM dominio.tipo_escala WHERE code = 6;
--   UPDATE public.versao SET nome = '3.9.0' WHERE code = 1;
--   COMMIT;
