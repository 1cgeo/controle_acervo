-- O LIVRO DE MOVIMENTOS DO MATERIAL, e a poda do que ele torna desnecessario
--
-- Decisao do chefe em 2026-08-08. Em uma frase: o material da mapoteca passa a
-- ter HISTORICO, e para de ser so um saldo que alguem redigita.
--
-- O QUE HAVIA. Tres portas mexiam no saldo, e so uma delas guardava data:
--
--   POST /estoque_material             upsert que REDEFINIA a quantidade. Sem
--                                      data, sem motivo, sem antes e depois.
--   POST /estoque_material/transferir  dois UPDATEs, idem.
--   mapoteca.consumo_material          a unica com data, e a unica que virava
--                                      historico -- e mesmo assim so do consumo.
--
-- O saldo era o unico registro do que acontecera, e ele nao responde "quando"
-- nem "por que". A tela de estoque mostrava um numero que ninguem sabia
-- explicar, e o RPCMTec reportava esse numero todo mes.
--
-- O QUE ENTRA. `mapoteca.movimento_material`, uma tabela so, com os quatro
-- movimentos que de fato acontecem com o material: ele CHEGA (Entrada), MUDA de
-- lugar (Transferencia), ACABA (Consumo) e e CONFERIDO na prateleira contra o
-- que o sistema diz (Contagem). Cada linha com DATA. O saldo de
-- `mapoteca.estoque_material` passa a ser o ACUMULADO do livro, aplicado por
-- gatilho, e deixa de ter porta propria de escrita.
--
-- O QUE SAI, e por que sai junto:
--
--   mapoteca.consumo_material          virou o tipo 3 do livro. Manter as duas
--                                      daria duas verdades sobre o mesmo gasto.
--   mapoteca.devolver_estoque_secao    era a metade "devolve" de tres gatilhos
--                                      que agora sao um so.
--   tipo_material.categoria_id         so decidia entre a 7.2 (Papel) e a 7.3
--                                      (Tintas) do RPCMTec, e o chefe FUNDIU as
--                                      duas na 7.2. Classificar para um recorte
--                                      que nao existe mais so pode errar.
--   dominio.categoria_material         o dominio da coluna acima.
--   tipo_material.tipo_midia_id        era a ponte impressao -> consumo, e a
--                                      ponte MORREU: produto impresso e rolo de
--                                      papel sao coisas separadas. Com ela cai o
--                                      indice `unique_material_por_midia`, o
--                                      CHECK `midia_so_para_papel` e a coluna
--                                      derivada `quantidade_impressa`.
--   tipo_material.meta_anual           sem leitor de verdade, e NULA nas 34
--                                      linhas da producao.
--
--   mapoteca.tipo_midia FICA. `produto_pedido` a referencia por duas FKs, e o
--   atendimento do pedido nao muda em nada.
--
-- O QUE ENTRA JUNTO: `UNIQUE (nome)` em `tipo_material`. Ela e NECESSARIA, e
-- nao higiene: a 7.2 fundida casa a linha do MES ANTERIOR pelo NOME (o id do
-- material nunca vai para o documento assinado), e com a fusao papel e tinta
-- passaram a dividir um espaco de nomes so. Dois homonimos fariam a coluna
-- "Estoque mes anterior" pegar o saldo do outro sem erro nenhum.
--
-- MEDIDO EM 2026-08-08, contra o banco de producao restaurado. E por isto que a
-- migracao custa ZERO em dado HOJE, e passaria a custar no primeiro lancamento:
--
--   34 tipos de material, e 34 nomes DISTINTOS (a UNIQUE aplica limpa);
--   26 linhas de estoque: 22 na Secao e 4 no Almoxarifado, ZERO nas outras duas;
--   mapoteca.consumo_material com ZERO linhas e sequencia virgem;
--   29 materiais com categoria escolhida e 6 papeis com midia ligada -- e esses
--     dois vinculos nao existem em nenhum outro lugar do banco, entao foram
--     DUMPADOS para um arquivo fora do repositorio antes deste DROP;
--   meta_anual NULA nas 34 linhas;
--   nenhuma edicao de RPCMTec fechada, e nenhuma linha 7.2 ou 7.3 em
--     rpcmtec.subsecao.
--
-- A ORDEM IMPORTA, e um passo depende do outro:
--
--   1. o dominio dos quatro tipos;
--   2. a tabela do livro, com os dois CHECK que dizem a FORMA de cada tipo;
--   3. o consumo antigo vira movimento tipo 3 (zero linhas hoje; o SQL existe
--      para a instalacao que ja tenha lancado);
--   4. o SALDO DE HOJE vira Contagem, uma por linha de estoque. SEM ISTO o livro
--      somaria zero contra um saldo real, e a primeira conferencia acusaria uma
--      diferenca que nao existe;
--   5. so entao a tabela velha e os gatilhos dela caem;
--   6. so entao nascem a funcao e os gatilhos do livro. ELES NASCEM DEPOIS DO
--      PASSO 4 DE PROPOSITO: com os gatilhos ja no lugar, semear a Contagem
--      DOBRARIA o saldo de cada uma das 26 linhas;
--   7. as tres colunas caem, e a UNIQUE do nome entra;
--   8. o dominio orfao cai.
--
-- VERSAO: 1.41.0, e o PISO SOBE JUNTO (MIN_DATABASE_VERSION em
-- server/src/config.js). Pela regra do README, o piso so sobe quando a migracao
-- ACRESCENTA schema, tabela ou coluna que o codigo passa a LER -- e e o caso:
-- `mapoteca.movimento_material` e a fonte do livro, da coluna "Consumo no mes"
-- da 7.2 e do painel de consumo. Um banco em 1.40.0 responderia 500 em toda tela
-- de material, entao deixar o piso para tras nao seria gentileza, seria adiar a
-- falha para o horario de expediente.
--
-- IDEMPOTENTE. Os passos 3 e 4 vivem num DO so, guardado por "o livro esta
-- vazio": reaplicar a migracao com o livro ja semeado nao insere nada, e por
-- isso nao dobra saldo nenhum.

BEGIN;

-- 1 -------------------------------------------------------------------------
-- Os quatro tipos de movimento. Tabela de dominio, como `tipo_localizacao` ao
-- lado dela.

CREATE TABLE IF NOT EXISTS mapoteca.tipo_movimento_material(
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_movimento_material (code, nome) VALUES
(1, 'Entrada'),
(2, 'Transferência'),
(3, 'Consumo'),
(4, 'Contagem')
ON CONFLICT (code) DO UPDATE SET nome = EXCLUDED.nome;

-- 2 -------------------------------------------------------------------------
-- O livro. Os nomes das duas constraints sao os mesmos de er/mapoteca.sql,
-- senao instalacao nova divergiria da migrada e o ensaiar_migracao.cjs
-- reprovaria.

CREATE TABLE IF NOT EXISTS mapoteca.movimento_material (
    id BIGSERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    tipo_movimento_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_movimento_material (code),
    -- SEMPRE POSITIVA, inclusive na Contagem: o sentido nao mora no sinal, mora
    -- em qual dos dois lados esta preenchido.
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    -- DIA de calendario, e nao instante, pela mesma razao de `pedido.data_pedido`.
    data_movimento DATE NOT NULL,
    localizacao_origem_id SMALLINT REFERENCES mapoteca.tipo_localizacao (code),
    localizacao_destino_id SMALLINT REFERENCES mapoteca.tipo_localizacao (code),
    motivo TEXT,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE,
    -- A FORMA de cada tipo. A regra "Consumo so da Secao" era um IF dentro do
    -- gatilho de `consumo_material`, e SOBE para ca: o gatilho recusava e o
    -- banco aceitava a linha por qualquer outra porta.
    CONSTRAINT movimento_material_forma CHECK (
        CASE tipo_movimento_id
            WHEN 1 THEN localizacao_origem_id IS NULL
                    AND localizacao_destino_id IS NOT NULL
            WHEN 2 THEN localizacao_origem_id IS NOT NULL
                    AND localizacao_destino_id IS NOT NULL
                    AND localizacao_origem_id <> localizacao_destino_id
            WHEN 3 THEN localizacao_origem_id = 1
                    AND localizacao_destino_id IS NULL
            WHEN 4 THEN num_nonnulls(localizacao_origem_id, localizacao_destino_id) = 1
            ELSE FALSE
        END
    ),
    -- A Contagem e o unico movimento que ninguem viu acontecer: sem o porque ela
    -- vira um ajuste mudo, que e o que o livro existe para acabar.
    CONSTRAINT movimento_material_contagem_exige_motivo CHECK (
        tipo_movimento_id <> 4 OR motivo IS NOT NULL
    )
);

COMMENT ON TABLE mapoteca.movimento_material IS
    'Livro de movimentos do material: Entrada, Transferência, Consumo e Contagem, cada linha com data. O saldo de mapoteca.estoque_material é o acumulado deste livro, aplicado por gatilho.';
COMMENT ON COLUMN mapoteca.movimento_material.motivo IS
    'Por que o movimento aconteceu. Obrigatório na Contagem, que é o único movimento que ninguém viu acontecer.';

CREATE INDEX IF NOT EXISTS idx_movimento_material_tipo_material
    ON mapoteca.movimento_material(tipo_material_id);
CREATE INDEX IF NOT EXISTS idx_movimento_material_data
    ON mapoteca.movimento_material(data_movimento);
CREATE INDEX IF NOT EXISTS idx_movimento_material_tipo_movimento
    ON mapoteca.movimento_material(tipo_movimento_id);

-- 3 e 4 ---------------------------------------------------------------------
-- O consumo antigo e o SALDO DE HOJE entram no livro, nesta ordem, e ANTES de
-- existir gatilho nenhum.
--
-- O guard e "o livro esta vazio". Ele nao e so idempotencia: e a garantia de que
-- reaplicar esta migracao nunca dobra o saldo de 26 linhas.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM mapoteca.movimento_material) THEN
        RETURN;
    END IF;

    -- 3. Consumo antigo -> movimento tipo 3. Ele sempre saiu da Secao (code 1),
    -- que era o que o gatilho `trg_consumo_material_insert` cobrava, e e o que o
    -- CHECK `movimento_material_forma` cobra agora.
    IF to_regclass('mapoteca.consumo_material') IS NOT NULL THEN
        INSERT INTO mapoteca.movimento_material
            (tipo_material_id, tipo_movimento_id, quantidade, data_movimento,
             localizacao_origem_id, localizacao_destino_id, motivo,
             usuario_criacao_id, usuario_atualizacao_id,
             data_criacao, data_atualizacao)
        SELECT cm.tipo_material_id, 3, cm.quantidade, cm.data_consumo,
               1, NULL, NULL,
               cm.usuario_criacao_id, cm.usuario_atualizacao_id,
               cm.data_criacao, cm.data_atualizacao
        FROM mapoteca.consumo_material AS cm
        ORDER BY cm.id;
    END IF;

    -- 4. O saldo de hoje vira Contagem, uma por linha de estoque.
    --
    -- SEM ISTO o livro somaria zero contra um saldo real, e a primeira
    -- conferencia de prateleira acusaria uma diferenca inteira que nao existe.
    -- A Contagem e o tipo certo: ela e literalmente "o que esta na prateleira
    -- hoje", que e tudo o que se sabe sobre esse saldo.
    --
    -- A DATA e o USUARIO vem do PROPRIO registro de estoque, e nao de
    -- CURRENT_DATE: o saldo foi digitado quando foi digitado, e carimbar o dia
    -- da migracao poria no livro um movimento que ninguem fez hoje. O `::date`
    -- usa o fuso da sessao, que e o dia local -- a mesma regra das outras
    -- colunas DATE do schema.
    --
    -- `quantidade > 0` porque a coluna do livro exige positivo, e uma Contagem
    -- de zero nao diria nada: o livro vazio ja soma zero.
    INSERT INTO mapoteca.movimento_material
        (tipo_material_id, tipo_movimento_id, quantidade, data_movimento,
         localizacao_origem_id, localizacao_destino_id, motivo,
         usuario_criacao_id, usuario_atualizacao_id, data_criacao)
    SELECT em.tipo_material_id, 4, em.quantidade,
           COALESCE(em.data_atualizacao, em.data_criacao)::date,
           NULL, em.localizacao_id, 'Saldo inicial da implantação',
           em.usuario_criacao_id, em.usuario_atualizacao_id,
           em.data_criacao
    FROM mapoteca.estoque_material AS em
    WHERE em.quantidade > 0
    ORDER BY em.tipo_material_id, em.localizacao_id;
END $$;

-- 5 -------------------------------------------------------------------------
-- A tabela velha e os tres gatilhos dela caem. Os gatilhos caem junto com a
-- tabela; as FUNCOES nao, e por isso vao nominalmente.

DROP TABLE IF EXISTS mapoteca.consumo_material;

DROP FUNCTION IF EXISTS mapoteca.trg_consumo_material_insert();
DROP FUNCTION IF EXISTS mapoteca.trg_consumo_material_update();
DROP FUNCTION IF EXISTS mapoteca.trg_consumo_material_delete();
DROP FUNCTION IF EXISTS mapoteca.devolver_estoque_secao(INTEGER, DECIMAL, INTEGER);

-- 6 -------------------------------------------------------------------------
-- A funcao que aplica o movimento ao saldo, e os tres gatilhos do livro.
--
-- Uma linha do livro mexe em NO MAXIMO dois saldos, e a regra e a mesma para os
-- quatro tipos: o que esta em `localizacao_origem_id` SAI, e o que esta em
-- `localizacao_destino_id` ENTRA.
--
-- `estoque_material` CONTINUA TABELA, e nao virou view sobre a soma do livro:
-- sao o `CHECK (quantidade >= 0)` e a `UNIQUE (tipo_material_id, localizacao_id)`
-- dela que RECUSAM consumo sem saldo. Numa view, o livro aceitaria a linha e o
-- saldo ficaria negativo, e a recusa migraria de volta para um IF dentro do
-- gatilho -- o lugar de onde a regra do Consumo acabou de sair.

CREATE OR REPLACE FUNCTION mapoteca.aplicar_saldo_material(
    p_tipo_material_id INTEGER,
    p_localizacao_id SMALLINT,
    p_quantidade INTEGER,
    p_entra BOOLEAN,
    p_usuario_id INTEGER
) RETURNS void AS $$
DECLARE
    v_saldo INTEGER;
    v_local TEXT;
    v_material TEXT;
BEGIN
    -- Lado ausente: a Entrada não tem origem e o Consumo não tem destino.
    IF p_localizacao_id IS NULL THEN
        RETURN;
    END IF;

    IF p_entra THEN
        -- Upsert atômico. O check-then-insert perdia estoque sob concorrência,
        -- ou violava a UNIQUE.
        INSERT INTO mapoteca.estoque_material
            (tipo_material_id, quantidade, localizacao_id,
             usuario_criacao_id, usuario_atualizacao_id)
        VALUES (p_tipo_material_id, p_quantidade, p_localizacao_id,
                p_usuario_id, p_usuario_id)
        ON CONFLICT (tipo_material_id, localizacao_id)
        DO UPDATE SET quantidade = mapoteca.estoque_material.quantidade + EXCLUDED.quantidade,
                      usuario_atualizacao_id = EXCLUDED.usuario_atualizacao_id,
                      data_atualizacao = CURRENT_TIMESTAMP;
        RETURN;
    END IF;

    -- SAÍDA. O FOR UPDATE serializa duas saídas simultâneas do mesmo saldo.
    SELECT quantidade INTO v_saldo
    FROM mapoteca.estoque_material
    WHERE tipo_material_id = p_tipo_material_id
      AND localizacao_id = p_localizacao_id
    FOR UPDATE;

    SELECT nome INTO v_local
    FROM mapoteca.tipo_localizacao WHERE code = p_localizacao_id;
    SELECT nome INTO v_material
    FROM mapoteca.tipo_material WHERE id = p_tipo_material_id;

    -- A MENSAGEM ENSINA O CONSERTO, e não só nomeia a recusa. Quem lança consumo
    -- de um material que está no Almoxarifado precisa saber que o caminho é
    -- transferir para a Seção antes, e não que "houve um erro".
    IF v_saldo IS NULL THEN
        RAISE EXCEPTION
            '% não tem estoque em %. Transfira o material para lá antes de lançar esta saída, ou lance primeiro a Entrada que o trouxe.',
            COALESCE(v_material, 'O material'), COALESCE(v_local, 'essa localização');
    END IF;

    IF v_saldo < p_quantidade THEN
        RAISE EXCEPTION
            'Estoque insuficiente de % em %. Disponível: %, solicitado: %. Transfira mais material para lá ou corrija a quantidade do movimento.',
            COALESCE(v_material, 'material'), COALESCE(v_local, 'essa localização'),
            v_saldo, p_quantidade;
    END IF;

    UPDATE mapoteca.estoque_material
    SET quantidade = quantidade - p_quantidade,
        usuario_atualizacao_id = p_usuario_id,
        data_atualizacao = CURRENT_TIMESTAMP
    WHERE tipo_material_id = p_tipo_material_id
      AND localizacao_id = p_localizacao_id;
END;
$$ LANGUAGE plpgsql;

-- UM gatilho para as três operações, e não três funções.
--
-- Alterar um movimento é DESFAZER o antigo e APLICAR o novo, nesta ordem: o
-- contrário deixa passar a alteração que aumenta o consumo além do saldo mas
-- caberia depois da devolução. Os três antigos gatilhos de `consumo_material`
-- tinham essa lógica escrita três vezes, e o de UPDATE tinha um ramo próprio só
-- para "o material mudou" -- aqui isso é o caso geral, sem ramo nenhum.
--
-- AFTER, e não BEFORE: quando o gatilho roda, os CHECKs da linha já a
-- aprovaram, então a forma do movimento (Consumo só da Seção, Contagem com um
-- lado só) nunca precisa ser reconferida aqui.
CREATE OR REPLACE FUNCTION mapoteca.trg_movimento_material()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        -- Desfaz o movimento antigo: o que tinha saído volta, e o que tinha
        -- entrado sai.
        PERFORM mapoteca.aplicar_saldo_material(
            OLD.tipo_material_id, OLD.localizacao_origem_id, OLD.quantidade,
            TRUE, OLD.usuario_criacao_id);
        PERFORM mapoteca.aplicar_saldo_material(
            OLD.tipo_material_id, OLD.localizacao_destino_id, OLD.quantidade,
            FALSE, OLD.usuario_criacao_id);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM mapoteca.aplicar_saldo_material(
            NEW.tipo_material_id, NEW.localizacao_origem_id, NEW.quantidade,
            FALSE, NEW.usuario_atualizacao_id);
        PERFORM mapoteca.aplicar_saldo_material(
            NEW.tipo_material_id, NEW.localizacao_destino_id, NEW.quantidade,
            TRUE, NEW.usuario_atualizacao_id);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_movimento_material_insert ON mapoteca.movimento_material;
CREATE TRIGGER trg_movimento_material_insert
AFTER INSERT ON mapoteca.movimento_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_movimento_material();

DROP TRIGGER IF EXISTS trg_movimento_material_update ON mapoteca.movimento_material;
CREATE TRIGGER trg_movimento_material_update
AFTER UPDATE ON mapoteca.movimento_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_movimento_material();

DROP TRIGGER IF EXISTS trg_movimento_material_delete ON mapoteca.movimento_material;
CREATE TRIGGER trg_movimento_material_delete
AFTER DELETE ON mapoteca.movimento_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_movimento_material();

-- 7 -------------------------------------------------------------------------
-- As tres colunas caem, e a UNIQUE do nome entra.
--
-- O indice e o CHECK cairiam sozinhos junto com as colunas que eles citam. Vao
-- nominalmente porque quem le a migracao tem de ver que eles morreram, e nao
-- descobrir isso pelo `pg_depend`.

DROP INDEX IF EXISTS mapoteca.unique_material_por_midia;

ALTER TABLE mapoteca.tipo_material
    DROP CONSTRAINT IF EXISTS midia_so_para_papel;

ALTER TABLE mapoteca.tipo_material
    DROP COLUMN IF EXISTS categoria_id,
    DROP COLUMN IF EXISTS tipo_midia_id,
    DROP COLUMN IF EXISTS meta_anual;

-- Aplica limpo: 34 nomes distintos em 34 linhas na producao de 2026-08-08. Se um
-- dia nao aplicar, a recusa e o alarme certo -- dois materiais homonimos ja
-- estariam se confundindo na 7.2.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_tipo_material_nome'
          AND conrelid = 'mapoteca.tipo_material'::regclass
    ) THEN
        ALTER TABLE mapoteca.tipo_material
            ADD CONSTRAINT unique_tipo_material_nome UNIQUE (nome);
    END IF;
END $$;

COMMENT ON COLUMN mapoteca.tipo_material.nome IS
    'Nome do insumo, com a UNIDADE embutida (rolo, cartucho, folha). Único: a 7.2 do RPCMTec casa o mês anterior pelo nome.';
COMMENT ON COLUMN mapoteca.tipo_material.estoque_minimo IS
    'Limiar para alertar estoque baixo na UI (badge). NULL = sem alerta. Compara-se contra Seção + Almoxarifado, e não contra o total: o que está em Aquisição realizada ou em Saldo no empenho ainda não chegou aqui.';

-- 8 -------------------------------------------------------------------------
-- O dominio orfao. So agora, porque a FK que o segurava acabou de cair.
--
-- `mapoteca.tipo_midia` NAO cai: `produto_pedido` a referencia por duas FKs
-- (midia pedida e midia fornecida), e o atendimento do pedido nao muda.

DROP TABLE IF EXISTS dominio.categoria_material;

UPDATE public.versao SET nome = '1.41.0' WHERE code = 1;

COMMIT;

-- Para desfazer (o livro se perde inteiro, e com ele a data de cada movimento;
-- a categoria e a midia voltam do dump que ficou fora do repositorio):
--   ALTER TABLE mapoteca.tipo_material DROP CONSTRAINT unique_tipo_material_nome;
--   ALTER TABLE mapoteca.tipo_material
--     ADD COLUMN categoria_id SMALLINT NOT NULL DEFAULT 3,
--     ADD COLUMN tipo_midia_id SMALLINT REFERENCES mapoteca.tipo_midia (code),
--     ADD COLUMN meta_anual INTEGER;
--   DROP TRIGGER trg_movimento_material_insert ON mapoteca.movimento_material;
--   DROP TRIGGER trg_movimento_material_update ON mapoteca.movimento_material;
--   DROP TRIGGER trg_movimento_material_delete ON mapoteca.movimento_material;
--   DROP TABLE mapoteca.movimento_material;
--   DROP TABLE mapoteca.tipo_movimento_material;
--   DROP FUNCTION mapoteca.trg_movimento_material();
--   DROP FUNCTION mapoteca.aplicar_saldo_material(INTEGER, SMALLINT, INTEGER, BOOLEAN, INTEGER);
--   UPDATE public.versao SET nome = '1.40.0' WHERE code = 1;
