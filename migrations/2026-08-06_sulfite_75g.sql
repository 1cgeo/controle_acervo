-- Sulfite 75g entra no catalogo de midia, e o papel dele no de material.
--
-- O QUE FALTAVA. O catalogo tinha Sulfite 90g (code 5) e Sulfite 120g (code 6),
-- e nao o 75g, que e o papel que a mapoteca usa. Sem ele o item do pedido nao
-- tinha como dizer em que papel a folha saiu, e quem cadastrava escolhia o 90g
-- por falta de opcao: o registro passava a mentir sobre o material.
--
-- OS DOIS LADOS, e nao so um. `mapoteca.tipo_midia` diz em que se imprime, e
-- `mapoteca.tipo_material` diz que estoque a impressao baixa. Os dois se ligam
-- por `tipo_material.tipo_midia_id`, um para um (indice unique_material_por_midia).
-- Midia sem material da folha impressa que nao baixa estoque nenhum, em silencio,
-- que e o defeito que este projeto documenta contra em varios lugares.
--
-- O CODE E EXPLICITO (9), e nao um SERIAL: `tipo_midia` e dominio, os codigos
-- entram no Joi (`TIPO_MIDIA` em utils/domain_constants.js) e uma instalacao
-- nova tem de dar exatamente os mesmos numeros que uma migrada.
--
-- Idempotente: ON CONFLICT DO NOTHING nos dois, e o de-para so preenche o que
-- estiver NULL.

BEGIN;

INSERT INTO mapoteca.tipo_midia (code, nome) VALUES
(9, 'Sulfite 75g')
ON CONFLICT (code) DO NOTHING;

INSERT INTO mapoteca.tipo_material (nome, descricao, categoria_id, tipo_midia_id)
SELECT 'Papel Sulfite 75g', 'Papel sulfite 75g/m² para plotter', 1, 9
WHERE NOT EXISTS (
    SELECT 1 FROM mapoteca.tipo_material WHERE BTRIM(nome) = 'Papel Sulfite 75g'
);

-- INSTALACAO NOVA DIVERGIA DA MIGRADA, e isto fecha a divergencia.
--
-- O seed de `er/mapoteca.sql` inseria os cinco papeis SEM `tipo_midia_id`, e
-- quem os ligava era a migracao 2026-08-04_material_da_midia.sql. Resultado
-- medido em 2026-08-06: banco migrado tinha os cinco papeis com midia, e banco
-- recem-instalado tinha os cinco com NULL. O `ensaiar_migracao.cjs` compara DDL
-- e nao compara DADO, entao a divergencia passava por ele sem alarme.
--
-- O seed do `er/` passou a trazer a midia na propria linha. Este bloco cobre a
-- instalacao que ja existia com os papeis soltos, e nao toca em quem ja esta
-- ligado (o `IS NULL` no fim). Repete o de-para por nome EXATO da migracao de
-- 2026-08-04, pela mesma razao dela: regra por semelhanca casaria 'Papel Glossy'
-- com um 'Glossy Premium' que amanha exista.
UPDATE mapoteca.tipo_material tm
SET tipo_midia_id = midia.code
FROM (VALUES
  ('Banner (tecido)',    'Banner (tecido)'),
  ('Papel Glossy',       'Glossy'),
  ('Papel Sulfite 75g',  'Sulfite 75g'),
  ('Papel Sulfite 90g',  'Sulfite 90g'),
  ('Papel Sulfite 120g', 'Sulfite 120g'),
  ('Tyvek',              'Tyvek')
) AS par(material, midia_nome)
JOIN mapoteca.tipo_midia midia ON BTRIM(midia.nome) = par.midia_nome
WHERE BTRIM(tm.nome) = par.material
  AND tm.tipo_midia_id IS NULL;

UPDATE public.versao SET nome = '1.38.0' WHERE code = 1;

COMMIT;

-- Para desfazer (so funciona enquanto nenhum item de pedido usar a midia 9; se
-- algum usar, a chave estrangeira recusa, e recusar e o certo):
--   DELETE FROM mapoteca.tipo_material WHERE BTRIM(nome) = 'Papel Sulfite 75g';
--   DELETE FROM mapoteca.tipo_midia WHERE code = 9;
--   UPDATE public.versao SET nome = '1.37.0' WHERE code = 1;
