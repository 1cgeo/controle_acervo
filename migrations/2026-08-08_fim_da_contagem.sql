-- O FIM DA CONTAGEM, e por que o saldo passa a se corrigir sozinho
--
-- Decisao do chefe em 2026-08-08. Em uma frase: o saldo do material tem de estar
-- certo por Entrada, Transferencia e Consumo, e nao existe mais um tipo cujo
-- trabalho e empurrar o saldo ate o numero da prateleira.
--
-- O QUE HAVIA. O tipo 4, Contagem, nasceu em 1.41.0 junto com o livro. Ele
-- lancava a DIFERENCA entre a prateleira e o sistema, com motivo obrigatorio, e
-- existia para separar o que a Secao GASTOU do que ela PERDEU: o Consumo entra
-- na 7.2 do RPCMTec, a Contagem nao entrava.
--
-- O QUE MUDA, e o que isso custa. A separacao sai, e a consequencia foi aceita
-- junto com a decisao: falta na prateleira e Consumo, sobra e Entrada, e quebra
-- e extravio passam a ser reportados como gasto de material da Divisao. Nao ha
-- mais onde dizer "sumiu" em vez de "gastei".
--
-- O QUE NAO ERA CASO DE CONTAGEM, e continua tendo conserto: lancamento ERRADO
-- se corrige editando ou apagando a linha errada do livro. Os gatilhos de UPDATE
-- e DELETE desfazem o efeito da linha no saldo, e o saldo volta exato -- sem
-- acrescentar ao livro um evento que nunca aconteceu.
--
-- O QUE ACONTECE COM AS LINHAS QUE JA EXISTEM. Elas nao sao apagadas: apagar
-- zeraria o estoque, porque a Contagem e a semente do saldo inteiro. A 1.41.0
-- semeou o saldo daquele dia como Contagem, uma por linha de estoque (26 na
-- producao), e cada uma delas E o saldo de um material numa localizacao. Cada
-- linha vira o tipo do que ela de fato representa:
--
--   com DESTINO   entrou material naquela localizacao   ->  1 Entrada
--   com ORIGEM 1  saiu material da Secao                ->  3 Consumo
--
-- A semente cai toda no primeiro caso, e o motivo dela ("Saldo inicial da
-- implantacao") continua ali, dizendo de onde o numero veio.
--
-- O TERCEIRO CASO ABORTA, de proposito: Contagem que tirou material de FORA da
-- Secao nao cabe em nenhum dos tres tipos, porque Consumo so sai da Secao. Ela e
-- rara e nao se converte sozinha sem inventar um movimento -- o passo 2 lista as
-- linhas e ensina o conserto em vez de escolher por conta propria.
--
-- O CODE 4 FICA NO DOMINIO, renomeado para "Contagem (extinta)". Ele nao pode
-- mais ser lancado: quem o recusa e o CHECK de forma, refeito no passo 4. O que
-- ele ainda serve e LER O PASSADO -- `auditoria.registro` guarda o valor gravado
-- e quem o traduz e o catalogo VIVO desta tabela (`auditoria/renderizar.js`),
-- entao apagar a linha faria todo registro de movimento de antes desta migracao
-- exibir "Tipo de movimento: 4", cru.
--
-- VERSAO: 1.45.0, e o PISO NAO SOBE (MIN_DATABASE_VERSION segue 1.43.0). Pela
-- regra do README, o piso so sobe quando a migracao ACRESCENTA schema, tabela ou
-- coluna que o codigo passa a LER, e esta so remove. Um banco 1.44.0 roda este
-- servidor sem faltar nada: o codigo novo nunca escreve tipo 4, e as linhas tipo
-- 4 que sobrarem la aparecem no livro com o nome que o dominio de la tiver.
--
-- IDEMPOTENTE. Cada passo e guardado pelo estado que ele mesmo produz, entao
-- reaplicar a migracao nao converte nada duas vezes.

BEGIN;

-- 1 -------------------------------------------------------------------------
-- As linhas tipo 4 viram o tipo do que aconteceu.
--
-- OS GATILHOS SAEM DE CENA AQUI, e a razao e aritmetica: o gatilho de UPDATE
-- DESFAZ o movimento antigo e APLICA o novo. Como a conversao mantem material,
-- lado, localizacao e quantidade, desfazer e refazer devolveria exatamente o
-- mesmo saldo -- mas o DESFAZER passa primeiro, e ele e uma SAIDA do tamanho da
-- linha inteira. Uma semente de 26 rolos ja consumida ate sobrar 6 faria o
-- gatilho recusar com "Estoque insuficiente" no meio da migracao, por um saldo
-- negativo que so existiria entre duas instrucoes.
--
-- Desligar e seguro porque a conversao e SALDO-NEUTRA por construcao: nenhuma
-- das colunas que o gatilho le muda. E a mesma razao pela qual a 1.41.0 semeou o
-- livro ANTES de criar os gatilhos.
--
-- `DISABLE TRIGGER USER` deixa os gatilhos de sistema (as FKs) no lugar.

ALTER TABLE mapoteca.movimento_material DISABLE TRIGGER USER;

-- O MOTIVO GANHA UM PREFIXO, e nao e enfeite: uma linha que foi lancada como
-- conferencia de prateleira passa a contar como consumo ou como entrada, e quem
-- ler o livro depois precisa saber que aquela linha mudou de nome por decisao, e
-- nao porque alguem a lancou assim.
UPDATE mapoteca.movimento_material
SET tipo_movimento_id = 1,
    motivo = '[Contagem convertida] ' || COALESCE(motivo, ''),
    data_atualizacao = CURRENT_TIMESTAMP
WHERE tipo_movimento_id = 4
  AND localizacao_destino_id IS NOT NULL;

UPDATE mapoteca.movimento_material
SET tipo_movimento_id = 3,
    motivo = '[Contagem convertida] ' || COALESCE(motivo, ''),
    data_atualizacao = CURRENT_TIMESTAMP
WHERE tipo_movimento_id = 4
  AND localizacao_origem_id = 1;

ALTER TABLE mapoteca.movimento_material ENABLE TRIGGER USER;

-- 2 -------------------------------------------------------------------------
-- O QUE NAO COUBE ABORTA A MIGRACAO, e a mensagem ensina o conserto.
--
-- Sobra aqui a Contagem que tirou material de fora da Secao. Converte-la em
-- Consumo violaria o CHECK ("Consumo so sai da Secao"), e escolher por conta
-- propria entre transferir e dar baixa seria inventar um movimento que ninguem
-- fez. Quem sabe o que aconteceu e a Secao.

DO $$
DECLARE
    v_restantes INTEGER;
    v_lista TEXT;
BEGIN
    SELECT COUNT(*), string_agg(
               format('id %s: %s unidades de material %s em %s, lancada em %s',
                      mm.id, mm.quantidade, mm.tipo_material_id,
                      mm.localizacao_origem_id, mm.data_movimento),
               E'\n  ' ORDER BY mm.id)
      INTO v_restantes, v_lista
    FROM mapoteca.movimento_material AS mm
    WHERE mm.tipo_movimento_id = 4;

    IF v_restantes > 0 THEN
        RAISE EXCEPTION
            E'Restaram % Contagens que sairam de fora da Secao, e elas nao se convertem sozinhas:\n  %\n\nConsumo so sai da Secao (code 1), entao cada uma precisa virar o que de fato aconteceu. Se o material saiu da casa, lance uma Transferencia dessa localizacao para a Secao e um Consumo da Secao, com a data da linha antiga. Se a linha estava errada, apague-a: o gatilho devolve o saldo. Depois reaplique esta migracao.',
            v_restantes, v_lista;
    END IF;
END $$;

-- 3 -------------------------------------------------------------------------
-- O CHECK do motivo cai. Ele so falava da Contagem, e sem ela o motivo e sempre
-- opcional: a Entrada tem nota, a Transferencia tem quem carregou e o Consumo
-- tem o trabalho que o gastou.

ALTER TABLE mapoteca.movimento_material
    DROP CONSTRAINT IF EXISTS movimento_material_contagem_exige_motivo;

-- 4 -------------------------------------------------------------------------
-- O CHECK de forma perde o ramo do tipo 4, e com isso o `ELSE FALSE` passa a
-- RECUSAR o code 4. E ele, e so ele no banco, que impede um movimento novo de
-- nascer com o tipo extinto: a linha continua no dominio, entao a FK a aceitaria.
--
-- O nome e a definicao sao os mesmos de er/mapoteca.sql, senao instalacao nova
-- divergiria da migrada e `ensaiar_migracao.cjs` reprovaria.

ALTER TABLE mapoteca.movimento_material
    DROP CONSTRAINT IF EXISTS movimento_material_forma;

ALTER TABLE mapoteca.movimento_material
    ADD CONSTRAINT movimento_material_forma CHECK (
        CASE tipo_movimento_id
            WHEN 1 THEN localizacao_origem_id IS NULL
                    AND localizacao_destino_id IS NOT NULL
            WHEN 2 THEN localizacao_origem_id IS NOT NULL
                    AND localizacao_destino_id IS NOT NULL
                    AND localizacao_origem_id <> localizacao_destino_id
            WHEN 3 THEN localizacao_origem_id = 1
                    AND localizacao_destino_id IS NULL
            ELSE FALSE
        END
    );

-- 5 -------------------------------------------------------------------------
-- O dominio marca o tipo extinto, e os comentarios passam a dizer o que a tabela
-- e hoje.

UPDATE mapoteca.tipo_movimento_material
SET nome = 'Contagem (extinta)'
WHERE code = 4;

COMMENT ON TABLE mapoteca.movimento_material IS
    'Livro de movimentos do material: Entrada, Transferência e Consumo, cada linha com data. O saldo de mapoteca.estoque_material é o acumulado deste livro, aplicado por gatilho, e não há ajuste: o saldo se corrige pelo movimento que de fato aconteceu.';
COMMENT ON COLUMN mapoteca.movimento_material.motivo IS
    'Por que o movimento aconteceu. Sempre opcional: a Entrada tem nota, a Transferência tem quem carregou e o Consumo tem o trabalho que o gastou.';

UPDATE public.versao SET nome = '1.45.0' WHERE code = 1;

COMMIT;
