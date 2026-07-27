-- Migração: data_pedido e data_atendimento passam de TIMESTAMPTZ para DATE.
--
-- POR QUE. As duas são datas de calendário, não instantes. O formulário só
-- oferece o dia (<input type="date">), e nenhum consumidor mostra hora. Numa
-- coluna TIMESTAMPTZ o valor atravessava dois fusos:
--   1. Na GRAVAÇÃO, o Postgres interpretava 'AAAA-MM-DD' no fuso da SESSÃO.
--   2. Na LEITURA, o driver devolvia um Date e o res.json serializava em UTC,
--      então o navegador em UTC-3 podia exibir o dia anterior (D-1).
-- Havia ainda um terceiro efeito, silencioso: filtroAno/filtroPeriodoMes
-- comparam a coluna com make_date(), e a conversão DATE -> TIMESTAMPTZ usava o
-- fuso da sessão. Um pedido de 1º de janeiro podia cair no ano errado do
-- relatório. Em DATE não sobra fuso nenhum no caminho.
--
-- O CAST. Usa AT TIME ZONE 'UTC' de propósito, em vez do fuso da sessão. Ele
-- recupera o dia certo nos dois modos em que as linhas existentes podem ter
-- sido gravadas:
--   - sessão em UTC:   guardado 00:00Z -> dia correto.
--   - sessão em UTC-3: guardado 03:00Z -> dia correto.
-- Casting no fuso local erraria o primeiro caso (viraria D-1).
--
-- ANTES DE APLICAR EM PRODUÇÃO, confira uma amostra (só leitura):
--   SELECT id, data_pedido,
--          (data_pedido AT TIME ZONE 'UTC')::date AS virara,
--          (data_pedido AT TIME ZONE 'UTC')::time AS hora_guardada
--   FROM mapoteca.pedido ORDER BY id LIMIT 20;
-- Toda hora_guardada deve ser 00:00:00. Linha com hora diferente de zero é
-- registro que carregava um instante de verdade, e merece decisão antes do
-- cast. Faça backup da tabela antes. Idempotente: reaplicar não faz nada.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'pedido'
          AND column_name = 'data_pedido' AND data_type <> 'date'
    ) THEN
        ALTER TABLE mapoteca.pedido
            ALTER COLUMN data_pedido TYPE DATE
                USING (data_pedido AT TIME ZONE 'UTC')::date;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'mapoteca' AND table_name = 'pedido'
          AND column_name = 'data_atendimento' AND data_type <> 'date'
    ) THEN
        ALTER TABLE mapoteca.pedido
            ALTER COLUMN data_atendimento TYPE DATE
                USING (data_atendimento AT TIME ZONE 'UTC')::date;
    END IF;
END $$;

COMMENT ON COLUMN mapoteca.pedido.data_pedido IS
    'Data de calendário do pedido. DATE de propósito: sem hora, sem fuso.';
COMMENT ON COLUMN mapoteca.pedido.data_atendimento IS
    'Data de calendário do fechamento do pedido. DATE de propósito: sem hora, sem fuso.';

COMMIT;
