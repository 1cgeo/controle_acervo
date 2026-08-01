-- O material de impressao passa a DIZER se e papel ou tinta.
--
-- O PROBLEMA. O RPCMTec separa o estoque em duas tabelas, "Insumos de Impressao
-- - Papel" (7.2) e "- Tintas" (7.3), e o SCA nao tinha como saber de que lado
-- cada material cai: `mapoteca.tipo_material` tem nome, descricao, estoque
-- minimo e meta anual, e mais nada.
--
-- POR QUE NAO DERIVAR DO NOME, que foi a primeira ideia. "Comeca com Cartucho"
-- acerta o catalogo de hoje inteiro e cai calado no primeiro "Tinta preta
-- 300ml" ou "Refil ciano": o material vai para a tabela errada, sem erro nenhum,
-- e o relatorio que o chefe assina mente sem avisar. Regra sobre texto livre nao
-- e regra, e um palpite que ninguem revisa.
--
-- O DEFAULT E 'Outro' (3), e nao 'Papel', de proposito: material sem categoria
-- escolhida nao aparece em NENHUMA das duas tabelas. Faltar de uma tabela e
-- visivel; aparecer na errada, nao.
--
-- A CARGA INICIAL abaixo classifica o catalogo semeado em er/mapoteca.sql pelo
-- nome, e so ela: e a unica vez em que a regra sobre texto e aceitavel, porque
-- os nomes sao conhecidos, finitos e estao a vista aqui. Dai em diante quem
-- classifica e quem cadastra, pela tela.
--
-- Aditiva e idempotente.
--
-- Para desfazer: ALTER TABLE mapoteca.tipo_material DROP COLUMN categoria_id;
--                DROP TABLE dominio.categoria_material;

BEGIN;

CREATE TABLE IF NOT EXISTS dominio.categoria_material(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO dominio.categoria_material (code, nome) VALUES
(1, 'Papel'),
(2, 'Tinta'),
(3, 'Outro')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE mapoteca.tipo_material
  ADD COLUMN IF NOT EXISTS categoria_id SMALLINT NOT NULL DEFAULT 3
  REFERENCES dominio.categoria_material (code);

COMMENT ON COLUMN mapoteca.tipo_material.categoria_id IS
    'Papel (7.2 do RPCMTec), Tinta (7.3) ou Outro (fora das duas). Dado, e nao regra sobre o nome.';

-- Carga inicial: so mexe em quem ainda esta no default (3). Rodar de novo depois
-- de alguem reclassificar a mao NAO desfaz a correcao dessa pessoa.
UPDATE mapoteca.tipo_material SET categoria_id = 2
WHERE categoria_id = 3
  AND (nome ILIKE 'Cartucho%' OR nome ILIKE 'Tinta%');

UPDATE mapoteca.tipo_material SET categoria_id = 1
WHERE categoria_id = 3
  AND (nome ILIKE 'Papel%' OR nome ILIKE 'Tyvek%' OR nome ILIKE 'Banner%');

-- Cabecote fica em 'Outro' (3): e peca de reposicao do plotter, nao insumo de
-- impressao, e nao sai em nenhuma das duas tabelas do RPCMTec. Fica explicito
-- aqui para ninguem achar que a carga o esqueceu.

COMMIT;
