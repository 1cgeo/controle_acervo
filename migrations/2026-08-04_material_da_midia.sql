-- O papel que cada mídia consome, para o consumo de impressão deixar de ser zero.
--
-- O DEFEITO QUE ISTO CONSERTA foi medido em produção em 2026-08-04. As
-- subseções 7.2 e 7.3 do RPCMTec saem marcadas "Calculada", com a fonte
-- declarada, e imprimem "Consumo no mês = 0" nas dezessete linhas -- enquanto
-- `mapoteca.impressao_item` guarda 1.753 impressões e 6.493 exemplares. O
-- número não estava faltando: estava ERRADO, com cara de dado apurado.
--
-- A causa é que o consumo saía só de `mapoteca.consumo_material`, que tem ZERO
-- linhas, e nada ligava a impressão ao insumo. Havia dois catálogos sem
-- ponte: oito mídias (o que se imprime) e cinco papéis (o que se gasta).
--
-- POR QUE UMA COLUNA, e não uma tabela de ligação: a relação é UM para UM. Uma
-- mídia gasta um papel, e um papel serve a uma mídia. Uma tabela de ligação
-- admitiria dois papéis para a mesma mídia, e nada diria qual deles baixar.
--
-- POR QUE NO MATERIAL, e não na mídia: `mapoteca.tipo_midia` é domínio (code,
-- nome), e `tipo_material` é cadastro, com estoque, mínimo e meta anual. A
-- coluna que aponta o outro lado mora em quem se administra.
--
-- SÓ PARA PAPEL, e é o limite honesto desta migração. Tinta NÃO se deriva de
-- folha impressa: quanto de cartucho uma folha gasta depende do que está
-- desenhado nela. O consumo de tinta continua vindo de `consumo_material`, que
-- é onde alguém declara a troca do cartucho -- e continua zerado enquanto
-- ninguém declarar. A diferença é que ali o número está VAZIO, e não errado.

BEGIN;

ALTER TABLE mapoteca.tipo_material
  ADD COLUMN IF NOT EXISTS tipo_midia_id SMALLINT REFERENCES mapoteca.tipo_midia (code);

COMMENT ON COLUMN mapoteca.tipo_material.tipo_midia_id IS
    'A mídia cuja impressão gasta este material. Só papel: tinta não se deriva de folha impressa.';

-- UM material por mídia. Duas linhas apontando a mesma mídia fariam a mesma
-- folha baixar dois estoques.
CREATE UNIQUE INDEX IF NOT EXISTS unique_material_por_midia
  ON mapoteca.tipo_material (tipo_midia_id)
  WHERE tipo_midia_id IS NOT NULL;

-- O de-para, casado pelo NOME, conferido linha a linha contra os dois catálogos
-- de produção em 2026-08-04. Cinco dos cinco papéis têm mídia; das oito mídias,
-- Couchê e Vergê não têm papel cadastrado e Digital não gasta nenhum (é
-- arquivo, não impressão).
--
-- Casa por nome EXATO do material, e não por semelhança: 'Papel Sulfite 120g'
-- e 'Sulfite 120g' são a mesma coisa escrita nos dois catálogos, e escrever o
-- par à mão é mais seguro que uma regra que amanhã case 'Papel Glossy' com
-- 'Glossy Premium'.
UPDATE mapoteca.tipo_material tm
SET tipo_midia_id = midia.code
FROM (VALUES
  ('Banner (tecido)',    'Banner (tecido)'),
  ('Papel Glossy',       'Glossy'),
  ('Papel Sulfite 90g',  'Sulfite 90g'),
  ('Papel Sulfite 120g', 'Sulfite 120g'),
  ('Tyvek',              'Tyvek')
) AS par(material, midia_nome)
JOIN mapoteca.tipo_midia midia ON BTRIM(midia.nome) = par.midia_nome
WHERE BTRIM(tm.nome) = par.material
  AND tm.tipo_midia_id IS NULL;

-- SÓ PAPEL aponta mídia. Sem esta guarda, um cartucho poderia reivindicar
-- 'Sulfite 120g' e o consumo de tinta passaria a ser derivado de folha
-- impressa, que é exatamente o que o comentário acima diz que não se faz.
-- Categoria 1 é Papel, em dominio.categoria_material.
ALTER TABLE mapoteca.tipo_material
  DROP CONSTRAINT IF EXISTS midia_so_para_papel;
ALTER TABLE mapoteca.tipo_material
  ADD CONSTRAINT midia_so_para_papel
  CHECK (tipo_midia_id IS NULL OR categoria_id = 1);

UPDATE public.versao SET nome = '1.23.0' WHERE code = 1;

COMMIT;

-- Para desfazer:
--   ALTER TABLE mapoteca.tipo_material DROP CONSTRAINT midia_so_para_papel;
--   DROP INDEX mapoteca.unique_material_por_midia;
--   ALTER TABLE mapoteca.tipo_material DROP COLUMN tipo_midia_id;
--   UPDATE public.versao SET nome = '1.22.0' WHERE code = 1;
