-- A PORTA QUE DEIXAVA A MESMA OM ENTRAR DUAS VEZES SE FECHA.
--
-- O QUE HAVIA. A 3.4.0, de ontem, FUNDIU as duas fichas do 3o GAC Ap e deixou a
-- porta aberta de proposito: restricao que passa a recusar cadastro na tela e
-- decisao de desenho, e decisao se conversa antes. A conversa aconteceu, e a
-- decisao esta registrada em `docs/decisoes.md`. Isto e a segunda metade.
--
-- Sem a restricao, o conserto de ontem tinha prazo de validade: bastava alguem
-- digitar o nome de novo e a segunda ficha nascia outra vez, com a contagem de
-- OM voltando a somar duas onde ha uma.
--
-- POR QUE (nome, sigla), E NAO SO O NOME. A sigla e o nome corrente da unidade
-- para quem le o RPCMTec, e duas linhas com o mesmo nome por extenso e siglas
-- diferentes sao um erro de digitacao que vale deixar visivel em vez de recusar
-- as cegas. Casar as duas colunas tambem e o que a fusao da 3.4.0 usou, entao a
-- restricao guarda exatamente o que aquela migracao normalizou.
--
-- NULLS NOT DISTINCT, e e o coracao desta migracao. `sigla` e NULA para quem nao
-- e OM -- sao seis linhas assim na producao de hoje --, e no UNIQUE comum do
-- Postgres NULO nao casa nem consigo mesmo. Um `UNIQUE (nome, sigla)` cru
-- protegeria as 173 fichas com sigla e deixaria as seis sem sigla livres para se
-- repetir, que e a metade errada: o cliente civil e justamente o que se cadastra
-- as pressas, no meio de um pedido da LAI. Exige PostgreSQL 15+; a producao esta
-- na 16.4.
--
-- O QUE ELA NAO PEGA. Grafia diferente do mesmo nome ('3o GAC Ap' e '3º GAC Ap',
-- ou um espaco a mais no fim) sao textos distintos e passam as duas. Nao se
-- normaliza com `lower(trim(...))` num indice funcional aqui, e a escolha e
-- deliberada: o ganho e pequeno (o `º` contra o `o`, que e a variacao real das
-- siglas de OM, sobrevive a lower e a trim), e o custo e uma restricao que nao
-- aparece no `\d` da tabela e cuja recusa e mais dificil de explicar na tela.
-- Ela fecha a repeticao EXATA, que e o caso medido.
--
-- APLICA LIMPO: 179 linhas em `mapoteca.cliente` na producao de 2026-08-12, e
-- zero pares repetidos por (nome, sigla) ja contando nulo como igual. Se um dia
-- nao aplicar, a recusa e o alarme certo -- duas fichas da mesma unidade ja
-- estariam partindo o historico dela.
--
-- A RECUSA TEM DE CHEGAR NA TELA COMO FRASE, e por isso esta migracao vem com
-- codigo: `mapoteca_ctrl.js` traduz o 23505 desta constraint em 409 com o motivo
-- escrito, como ja fazia com `unique_tipo_material_nome`. Sem isso, quem
-- repetisse um nome levaria um 500 dizendo "erro no servidor" para um engano que
-- a propria pessoa conserta em cinco segundos.
--
-- O PISO DO BANCO NAO SOBE, e o precedente e exatamente este caso: a 1.48.0
-- acrescentou `unique_tipo_material_nome` com a mesma traducao no controlador e
-- nao subiu o piso. O codigo nao QUEBRA num banco sem a constraint -- ele so
-- nunca ve o 23505, e o cadastro repetido continua possivel la. Cobrar a
-- migracao para subir o servico obrigaria toda instalacao a migrar por uma
-- garantia que e do dado dela, e isso e escolha de quem opera o banco. `VERSION`
-- vai a 3.5.0 e `MIN_DATABASE_VERSION` fica em 3.2.0.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_cliente_nome_sigla'
          AND conrelid = 'mapoteca.cliente'::regclass
    ) THEN
        ALTER TABLE mapoteca.cliente
            ADD CONSTRAINT unique_cliente_nome_sigla
            UNIQUE NULLS NOT DISTINCT (nome, sigla);
    END IF;
END $$;

COMMENT ON COLUMN mapoteca.cliente.nome IS
    'Nome do cliente. Único junto com a sigla, contando nulo como igual: a mesma OM cadastrada duas vezes parte o histórico dela e faz a contagem de OM atendidas somar duas onde há uma.';

UPDATE public.versao SET nome = '3.5.0' WHERE code = 1;

COMMIT;

-- PARA CONFERIR. A restricao existe e e NULLS NOT DISTINCT. A marca mora em
-- `pg_index.indnullsnotdistinct`, e NAO em `pg_constraint` -- que nao tem coluna
-- equivalente, entao o `pg_get_constraintdef` e a juncao com o indice sao os dois
-- jeitos de ver a clausula:
--
--   SELECT c.conname, i.indnullsnotdistinct, pg_get_constraintdef(c.oid)
--     FROM pg_constraint AS c
--     INNER JOIN pg_index AS i ON i.indexrelid = c.conindid
--    WHERE c.conrelid = 'mapoteca.cliente'::regclass AND c.contype = 'u';
--
-- E ela recusa de verdade, inclusive sem sigla (as duas linhas abaixo tem de
-- falhar com 23505, e o ROLLBACK desfaz a tentativa):
--
--   BEGIN;
--   INSERT INTO mapoteca.cliente (nome, tipo_cliente_id) VALUES ('Cidadão (LAI)', 9);
--   ROLLBACK;
--
-- PARA DESFAZER:
--
--   BEGIN;
--   ALTER TABLE mapoteca.cliente DROP CONSTRAINT unique_cliente_nome_sigla;
--   UPDATE public.versao SET nome = '3.4.0' WHERE code = 1;
--   COMMIT;
