-- O produto avulso deixa de ser um CATALOGO e passa a ser descrito no proprio
-- item do pedido. A tabela mapoteca.produto_avulso sai.
--
-- POR QUE DESFAZER, tres horas depois de criar. A tabela nasceu de um argumento
-- de reuso: "CIBSB, CISM e CIHM se repetem em nove pedidos, com catalogo da para
-- ver a repeticao e promover ao acervo". Fui verificar e os tres ESTAO no
-- acervo, como "Campo de Instrucao - Cibsb" e "Campo de Instrucao de Santa
-- Maria". O exemplo que justificava o catalogo nao era do dominio dele.
--
-- Depois de ler todos os documentos de 2026, o que restou de avulso foi UM
-- produto (papel quadriculado) em DOIS itens, no ano inteiro. Catalogo, CRUD,
-- cinco rotas, tela e item de menu para isso.
--
-- E ha uma contradicao no conceito: avulso e, por definicao, impresso de
-- OCASIAO. Um catalogo de coisas que nao valem catalogacao se contradiz. O
-- corte do chefe e de POSSE: se um impresso passa a merecer cadastro, nome
-- estavel e reuso, ele ja nao e ocasiao, e produto, e o lugar dele e o acervo.
-- O catalogo empurrava na direcao contraria ao corte.
--
-- O QUE NAO MUDA, e e o essencial: o item continua apontando EXATAMENTE UM
-- produto identificado, agora acervo OU descricao avulsa. Pedido pode ter item
-- de acervo, item avulso, ou os dois misturados, porque a escolha e de cada
-- ITEM. O CHECK, o JOIN_PRODUTO_ITEM e as ~30 consultas
-- revisadas seguem valendo; muda so de onde sai o nome.
--
-- Sem colunas de mi, tipo e escala no avulso: acrescentar campo "por via das
-- duvidas" foi o que produziu o catalogo. O que precisar dizer cabe no nome e na
-- descricao, e o que merecer campo proprio merece estar no acervo.
--
-- Os dois itens que ja existiam sao migrados: o nome e a descricao do catalogo
-- passam para dentro do item, antes de a tabela cair.

BEGIN;

ALTER TABLE mapoteca.produto_pedido
    ADD COLUMN IF NOT EXISTS nome_avulso VARCHAR(255),
    ADD COLUMN IF NOT EXISTS descricao_avulso TEXT;

COMMENT ON COLUMN mapoteca.produto_pedido.nome_avulso IS
    'Nome do impresso que NÃO é produto do acervo (papel quadriculado, impresso de ocasião). Preenchido em vez de uuid_versao, nunca junto.';
COMMENT ON COLUMN mapoteca.produto_pedido.descricao_avulso IS
    'Descrição física do impresso avulso ("80 x 68 cm, quadrícula de 4 x 4 cm"). SAI na consulta pública por localizador.';

-- Traz para o item o que estava no catalogo, antes de perder a tabela.
UPDATE mapoteca.produto_pedido pp
   SET nome_avulso = pa.nome,
       descricao_avulso = pa.descricao
  FROM mapoteca.produto_avulso pa
 WHERE pp.produto_avulso_id = pa.id;

-- O CHECK velho cita produto_avulso_id e tem de sair antes da coluna.
ALTER TABLE mapoteca.produto_pedido
    DROP CONSTRAINT IF EXISTS produto_pedido_um_destino;

DROP INDEX IF EXISTS mapoteca.produto_pedido_produto_avulso_id_idx;

ALTER TABLE mapoteca.produto_pedido
    DROP COLUMN IF EXISTS produto_avulso_id;

DROP TABLE IF EXISTS mapoteca.produto_avulso;

-- A RN08 na forma que vale desde hoje: todo item aponta EXATAMENTE UM produto
-- identificado. Mesmo nome de constraint da migracao anterior, porque e a mesma
-- regra: o que mudou foi o segundo destino.
ALTER TABLE mapoteca.produto_pedido
    ADD CONSTRAINT produto_pedido_um_destino
    CHECK ((uuid_versao IS NOT NULL) <> (nome_avulso IS NOT NULL));

COMMIT;

-- Para desfazer NAO ha caminho automatico: a tabela produto_avulso e as linhas
-- dela nao voltam. O backup de 2026-07-30 (sca_producao_2026-07-30_pre_avulso)
-- e anterior a tudo isto.
