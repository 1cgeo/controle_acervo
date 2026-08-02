-- O PIT passa a guardar o que cada mes PLANEJOU, e nao so o que ele entregou.
--
-- O QUE FALTAVA. `pit.meta.quantidade_prevista` guarda o compromisso do ANO, e
-- `pit.execucao` guardava o realizado por mes. Faltava a metade do meio: o
-- planejamento tambem e MENSAL. A meta 1.1 de 2026 promete 24 no ano,
-- distribuidos em abril 4, maio 1, julho 16 e agosto 3, e sem isso nao ha como
-- dizer se ela esta atrasada em junho -- so se ela fechou o ano.
--
-- A FONTE e a planilha que a Divisao preenche, com duas abas: PLANEJ_PIT e
-- EXEC_PIT. Elas tem as MESMAS linhas, as mesmas doze colunas de mes e a mesma
-- quantidade anual. A unica diferenca entre as duas e qual dos dois numeros a
-- celula guarda -- ou seja, elas nao sao duas coisas, sao a mesma grade com dois
-- numeros por celula. Por isso a coluna entra na tabela que ja existe, e nao
-- numa tabela irma: duas tabelas repetiriam a chave (meta, mes) e deixariam a
-- comparacao, que e a razao de as duas existirem, a um JOIN de distancia.
--
-- `quantidade` PERDE O NOT NULL, e isso e o ponto mais delicado desta migracao.
-- Enquanto a linha so existia para o realizado, a AUSENCIA DELA dizia "ninguem
-- lancou" e o zero dizia "conferi e nao houve". Agora a linha nasce no comeco do
-- ano para guardar o plano, entao a ausencia deixou de carregar esse recado e
-- quem o carrega e o nulo. Sem tirar o NOT NULL, planejar um mes gravaria um
-- realizado ZERO que ninguem lancou, e a 2.1 do relatorio passaria a afirmar que
-- se conferiu e nao houve entrega.
--
-- O CHECK NOVO recusa a linha que nao diz nada. Quando os quatro campos ficam
-- nulos, o controlador APAGA a linha em vez de guardar uma vazia.
--
-- O NOME DA TABELA FICOU `execucao`, embora ela guarde as duas coisas agora.
-- Renomea-la orfanaria o rastro: `auditoria.evento` guarda o nome da tabela em
-- cada linha, e o schema `auditoria` nao tem UPDATE nem DELETE para a aplicacao,
-- de proposito. O nome imperfeito custa menos do que uma trilha que deixa de
-- casar com o mapa de entidades.
--
-- Idempotente: IF NOT EXISTS, DROP NOT NULL repetivel e DO block com guarda.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O planejado do mes
-- ---------------------------------------------------------------------------
ALTER TABLE pit.execucao
    ADD COLUMN IF NOT EXISTS quantidade_planejada INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'execucao_quantidade_planejada_check'
          AND conrelid = 'pit.execucao'::regclass
    ) THEN
        ALTER TABLE pit.execucao
            ADD CONSTRAINT execucao_quantidade_planejada_check
            CHECK (quantidade_planejada IS NULL OR quantidade_planejada >= 0);
    END IF;
END
$$;

COMMENT ON COLUMN pit.execucao.quantidade_planejada IS
    'Quanto a meta planejou entregar NESTE mês. A soma dos doze tem de bater com pit.meta.quantidade_prevista, e é a tela que confere.';

-- ---------------------------------------------------------------------------
-- 2. O realizado passa a ser ANULAVEL
-- ---------------------------------------------------------------------------
-- Ver o cabecalho: sem isto, planejar um mes gravaria um realizado zero que
-- ninguem lancou. O default tambem sai, senao um INSERT que so traz o plano
-- continuaria produzindo o mesmo zero.
ALTER TABLE pit.execucao ALTER COLUMN quantidade DROP NOT NULL;
ALTER TABLE pit.execucao ALTER COLUMN quantidade DROP DEFAULT;

-- O CHECK antigo era `quantidade >= 0` sobre coluna NOT NULL. Com ela anulavel,
-- o mesmo predicado continua valendo (NULL nao viola CHECK), mas o nome muda de
-- forma entre a instalacao nova e a atualizada se nao for refeito aqui. Refazer
-- e barato e mantem `er/` e `migrations/` convergindo.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'execucao_quantidade_check'
          AND conrelid = 'pit.execucao'::regclass
    ) THEN
        ALTER TABLE pit.execucao DROP CONSTRAINT execucao_quantidade_check;
    END IF;

    ALTER TABLE pit.execucao
        ADD CONSTRAINT execucao_quantidade_check
        CHECK (quantidade IS NULL OR quantidade >= 0);
EXCEPTION
    -- Reaplicacao: a restricao ja foi recriada com o predicado novo.
    WHEN duplicate_object THEN NULL;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Linha que nao diz nada nao existe
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'execucao_diz_alguma_coisa'
          AND conrelid = 'pit.execucao'::regclass
    ) THEN
        -- Apaga primeiro o que ja estiver vazio, senao o ALTER falha validando
        -- a restricao contra a linha que ela existe para impedir.
        DELETE FROM pit.execucao
        WHERE quantidade_planejada IS NULL
          AND quantidade IS NULL
          AND data_conclusao IS NULL
          AND observacao IS NULL;

        ALTER TABLE pit.execucao
            ADD CONSTRAINT execucao_diz_alguma_coisa CHECK (
              quantidade_planejada IS NOT NULL
              OR quantidade IS NOT NULL
              OR data_conclusao IS NOT NULL
              OR observacao IS NOT NULL
            );
    END IF;
END
$$;

COMMENT ON TABLE pit.execucao IS
    'O mês de uma meta do PIT: o que ela planejou entregar e o que entregou. Uma linha por (meta, mês); o ano vem da meta.';

UPDATE public.versao SET nome = '1.18.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde o planejamento mensal):
--   ALTER TABLE pit.execucao DROP CONSTRAINT execucao_diz_alguma_coisa;
--   DELETE FROM pit.execucao WHERE quantidade IS NULL;
--   ALTER TABLE pit.execucao ALTER COLUMN quantidade SET DEFAULT 0;
--   UPDATE pit.execucao SET quantidade = 0 WHERE quantidade IS NULL;
--   ALTER TABLE pit.execucao ALTER COLUMN quantidade SET NOT NULL;
--   ALTER TABLE pit.execucao DROP COLUMN quantidade_planejada;
--   UPDATE public.versao SET nome = '1.17.0' WHERE code = 1;
