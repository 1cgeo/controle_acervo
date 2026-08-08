-- A PODA DO PEDIDO, e a palavra-chave que volta a servir para alguma coisa
--
-- Decisao do chefe em 2026-08-08, depois de medir contra o banco de producao
-- restaurado (166 pedidos, 2554 itens). Sao quatro cortes e um acrescimo, e
-- cada um tem numero atras.
--
-- 1. A SITUACAO 1 SAI. 'Pre cadastramento do pedido realizado' era a primeira
--    da lista e a mais oferecida pelo formulario, e ZERO dos 166 pedidos a
--    usam. Ela prometia um estagio ("alguem avisou que vem um pedido") que a
--    mapoteca nunca trabalhou: o pedido nasce ja recebido.
--
--    O BURACO NA NUMERACAO E DELIBERADO. Renumerar as outras seis para fechar a
--    lacuna reescreveria a situacao dos 166 pedidos, e um code de dominio e
--    exatamente o que nao se renumera: ele ja esta gravado em `auditoria.evento`
--    e no historico de todo pedido que mudou de situacao.
--
-- 2. A SITUACAO 2 MUDA DE ROTULO, e nao de code. 'DIEx/Oficio do pedido
--    recebido' -> 'Pedido Recebido'. Tambem zero pedidos, mas o corte aqui
--    seria errado: o estagio existe, so estava nomeado pelo DOCUMENTO em vez do
--    fato, e o pedido de civil chega por e-mail, sem DIEx nenhum. Trocar o code
--    apagaria a distincao com o 3 (Em andamento), que e trabalho ja comecado.
--
-- 3. `mapoteca.pedido.omds` SAI. 124 linhas preenchidas e UM unico valor
--    distinto em todas elas ('1º CGEO'). E uma constante disfarcada de coluna:
--    quem preenche a coluna "OMDS" do RTM e o proprio 1º CGEO, e o formulario
--    pedia todo pedido que se redigitasse o nome da propria unidade.
--
-- 4. `mapoteca.produto_pedido.quantidade_fornecida` SAI. IGUAL a `quantidade`
--    em 1759 de 1759 linhas preenchidas, ZERO divergencias em nove meses de
--    dado. Ela prometia guardar "quanto se entregou de fato", e quem guarda
--    isso e `mapoteca.impressao_item`, uma linha por sessao de impressao, com
--    quantidade, data e autor.
--
--    A GEMEA `tipo_midia_fornecida_id` FICA, e este e o ponto que separa esta
--    poda de um erro. Ela tem 25 DIVERGENCIAS REAIS (item pedido em tyvek e
--    atendido em sulfite), medidas nas mesmas 1759 linhas. Duas colunas com o
--    mesmo sufixo, o mesmo formulario e destinos opostos: o sufixo nao e
--    argumento, a medicao e.
--
--    O fragmento `QTD_EFETIVA` (server/src/mapoteca/query_fragments.js) era
--    `COALESCE(pp.quantidade_fornecida, pp.quantidade)` e passa a ser
--    `pp.quantidade`. NENHUM numero publicado muda: onde a coluna estava nula o
--    COALESCE ja caia na prevista, e onde estava preenchida ela era a prevista.
--
-- 5. O ACRESCIMO nao e de schema: `pedido.palavras_chave` tinha 18 linhas
--    preenchidas, NENHUM leitor e um indice GIN que nao servia consulta
--    nenhuma. `GET /api/mapoteca/pedido` ganhou o filtro `palavra_chave`, que
--    casa por CONTINENCIA (`@>`) e por isso USA aquele indice. Por isso esta
--    migracao nao cria indice: ele ja existe desde a instalacao, e o que faltava
--    era a consulta.
--
-- VERSAO: 1.42.0, e O PISO NAO SOBE (MIN_DATABASE_VERSION continua 1.41.0, em
-- server/src/config.js). Pela regra do README, o piso so sobe quando a migracao
-- ACRESCENTA schema, tabela ou coluna que o codigo passa a LER, e aqui nada
-- nasce: o filtro novo le `palavras_chave`, que existe desde a instalacao, e o
-- resto so remove. Um banco em 1.41.0 continua servindo este codigo inteiro; o
-- que ele mostra a mais e a situacao 1 na caixa de selecao (o Joi ja a recusa na
-- gravacao) e o rotulo velho do 2.
--
-- IDEMPOTENTE. O DELETE e o UPDATE do dominio nao tem o que repetir, e os dois
-- DROP COLUMN sao `IF EXISTS`.
--
-- CUSTA ZERO EM DADO, e a guarda abaixo prova isso na hora de aplicar em vez de
-- confiar na medicao de ontem: se um pedido tiver aparecido na situacao 1 entre
-- a medicao e a aplicacao, a migracao PARA e diz quantos sao. Silenciar isso
-- seria escolher sozinho para onde mover o pedido de outra pessoa.

BEGIN;

-- 1 -------------------------------------------------------------------------
-- A situacao 1, e a guarda que a torna segura.

DO $$
DECLARE
    v_presos INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_presos
    FROM mapoteca.pedido WHERE situacao_pedido_id = 1;

    IF v_presos > 0 THEN
        RAISE EXCEPTION
            'Existem % pedido(s) na situação 1 (Pré cadastramento). Mova-os para a situação 2 (Pedido Recebido) ou 3 (Em andamento) antes de aplicar esta migração.',
            v_presos;
    END IF;
END $$;

DELETE FROM mapoteca.situacao_pedido WHERE code = 1;

-- 2 -------------------------------------------------------------------------
-- O rotulo do 2. O code NAO muda: ele ja esta gravado na auditoria.

UPDATE mapoteca.situacao_pedido SET nome = 'Pedido Recebido' WHERE code = 2;

-- 3 -------------------------------------------------------------------------
-- A OM Diretamente Subordinada, que era sempre a mesma.

ALTER TABLE mapoteca.pedido DROP COLUMN IF EXISTS omds;

COMMENT ON COLUMN mapoteca.pedido.palavras_chave IS
    'Etiquetas livres do pedido. Consultadas pelo filtro da lista por continência (@>), que é o que o índice GIN atende; ILIKE não o usaria.';

-- 4 -------------------------------------------------------------------------
-- A quantidade fornecida, que nunca divergiu da prevista.
--
-- O CHECK `produto_pedido_quantidade_fornecida_check` cai junto com a coluna,
-- por dependencia. A midia fornecida FICA, com as 25 divergencias dela.

ALTER TABLE mapoteca.produto_pedido DROP COLUMN IF EXISTS quantidade_fornecida;

COMMENT ON COLUMN mapoteca.produto_pedido.tipo_midia_fornecida_id IS
    'Mídia efetivamente usada, quando diverge da prevista. FICA, ao contrário da quantidade fornecida: mediu 25 divergências reais (pedido em tyvek atendido em sulfite).';

UPDATE public.versao SET nome = '1.42.0' WHERE code = 1;

COMMIT;

-- Para desfazer (o rotulo velho volta; o conteudo das duas colunas nao volta de
-- lugar nenhum, porque nao foi copiado para parte alguma -- era constante numa
-- e igual a coluna vizinha na outra):
--   INSERT INTO mapoteca.situacao_pedido (code, nome)
--     VALUES (1, 'Pré cadastramento do pedido realizado');
--   UPDATE mapoteca.situacao_pedido SET nome = 'DIEx/Ofício do pedido recebido' WHERE code = 2;
--   ALTER TABLE mapoteca.pedido ADD COLUMN omds VARCHAR(255);
--   ALTER TABLE mapoteca.produto_pedido
--     ADD COLUMN quantidade_fornecida INTEGER
--       CHECK (quantidade_fornecida IS NULL OR quantidade_fornecida >= 0);
--   UPDATE public.versao SET nome = '1.41.0' WHERE code = 1;
