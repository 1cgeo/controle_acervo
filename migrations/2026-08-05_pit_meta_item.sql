-- A META DO PIT VIRA GRUPO, E O ITEM VIRA A UNIDADE DE TRABALHO.
--
-- O QUE O DOCUMENTO ASSINADO DIZ. O PIT nao e uma lista plana. Ele tem metas
-- numeradas com NOME ("Meta 1 - Producao de Geoinformacao") e, dentro de cada
-- uma, uma tabela cujas linhas sao o trabalho ("1.1. Carta Topografica
-- 1:25.000. | COTER/DECEX | 24"). Sao dois niveis, e so o segundo promete.
--
-- O QUE O BANCO FAZIA. Achatava os dois numa tabela so. A linha de cabecalho
-- entrava como se fosse uma meta, com `item` NULO, e o NOME do grupo ia parar na
-- `descricao` de uma declaracao de revisao. Dai vinham tres defeitos:
--
--   1. Todo consumidor tinha de saber excluir o cabecalho sozinho. A constante
--      EH_FOLHA existia so para isso, repetida em tres consultas.
--   2. O nome do grupo so existia se alguma revisao o declarasse, e ele nao
--      muda por revisao: ele e identidade.
--   3. Os vinculos de outros schemas podiam apontar o cabecalho, e a diferenca
--      entre "aponta a Meta 4" e "aponta a 4.1" nao era representavel.
--
-- O DESENHO NOVO, em tres tabelas:
--
--   pit.meta              o grupo numerado, com NOME. 7 linhas em 2026.
--   pit.meta_item         a unidade de trabalho. 42 linhas em 2026.
--   pit.meta_item_revisao o que cada revisao declara SOBRE O ITEM. Esparsa.
--
-- OS IDS SAO PRESERVADOS, e e isso que torna a migracao segura. A linha de item
-- leva o seu proprio `id` para `pit.meta_item`, e a de cabecalho fica em
-- `pit.meta` com o `id` que ja tinha. Os dois conjuntos sao disjuntos, entao
-- NENHUM `meta_pit_id` gravado precisa ser traduzido: o que muda e o ALVO da
-- chave estrangeira, nao o numero. Traduzir id em massa e onde o erro silencioso
-- moraria.
--
-- ONDE CADA VINCULO PASSA A APONTAR, E ISSO FOI MEDIDO EM PRODUCAO (2026-08-05,
-- em transacao somente leitura). A medicao dividiu os vinculos em dois grupos
-- exatos, sem uma unica excecao dos dois lados:
--
--   tabela                     vinculos   apontam ITEM   apontam a META
--   acervo.versao                   115            115                0
--   mapoteca.pedido                  16             16                0
--   rpcmtec.capacitacao               1              1                0
--   pit.execucao                    109            109                0
--   orcamento.pdr_item               17              0               17
--   orcamento.nota_credito           50              0               50
--
-- O TRABALHO APONTA O ITEM; O DINHEIRO APONTA A META. 100% contra 0% nos dois
-- grupos nao e ruido, e o dominio: o credito e o item do PDR sao autorizados
-- para a meta inteira, e ninguem jamais os amarrou a um item. Por isso as duas
-- colunas do `orcamento` FICAM apontando `pit.meta`, que continua existindo e
-- agora tem `nome` proprio. Move-las exigiria escolher, para cada uma das 67
-- linhas, qual dos 11 itens da Meta 1 aquele credito financiou. Essa informacao
-- nao esta no banco, e uma migracao que a inventasse gravaria numero plausivel e
-- falso. Fica para decisao do chefe, com os dados na mesa.
--
-- 2025 NAO PERDE NADA. Os 7 registros de 2025 tem `item` NULO e nenhum item
-- abaixo: o PIT de 2025 foi transcrito so pelos NOMES das metas, sem quantidade,
-- sem prazo e sem demandante. No desenho novo isso e exatamente 7 `pit.meta` com
-- `nome` e zero `pit.meta_item`, que e a leitura fiel do que existe. As 21 notas
-- de credito de 2025 seguem apontando as mesmas linhas de `pit.meta`.
--
-- IDEMPOTENTE. O transporte de dados inteiro vive num DO guardado por "a coluna
-- `pit.meta.item` ainda existe?". O plpgsql so planeja o comando quando o ramo
-- executa, entao na segunda rodada nada dentro dele e sequer analisado. O resto
-- usa IF NOT EXISTS, IF EXISTS e guarda por catalogo.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. O PRE-REQUISITO QUE NAO PODE PASSAR EM SILENCIO.
--
-- `mapoteca.midia_meta_pit` aponta `pit.meta` com ON DELETE CASCADE, e as linhas
-- dela apontam ITENS (sulfite/4.1, tyvek/4.2, glossy/4.3). Ao tirar as linhas de
-- item de `pit.meta`, o banco APAGARIA essas tres sem avisar. A migracao 1.29.0
-- (2026-08-05_meta4_conta_pelo_pedido.sql) ja remove a tabela; se ela ainda
-- estiver de pe, a ordem de aplicacao esta errada e parar aqui custa menos.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('mapoteca.midia_meta_pit') IS NOT NULL THEN
    RAISE EXCEPTION
      'mapoteca.midia_meta_pit ainda existe. Aplique as migracoes 1.27.0, 1.28.0 e 1.29.0 antes desta.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. A VIEW E A FUNCAO SAEM PRIMEIRO.
--
-- As duas leem `pit.meta.item`, `unidade_id` e `origem_id`, e as tres colunas
-- serao removidas. DROP, e nao CREATE OR REPLACE: a lista de colunas muda, e o
-- REPLACE so aceita acrescentar coluna no fim.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS pit.meta_vigente;
DROP FUNCTION IF EXISTS pit.meta_em(DATE);

-- ---------------------------------------------------------------------------
-- 2. O NOME DO GRUPO, E A TABELA DO ITEM.
-- ---------------------------------------------------------------------------

-- Anulavel AGORA, NOT NULL no passo 6: a coluna nasce vazia e so depois de
-- copiado o nome de cada grupo e que a restricao pode valer.
ALTER TABLE pit.meta ADD COLUMN IF NOT EXISTS nome VARCHAR(255);

COMMENT ON COLUMN pit.meta.nome IS
    'O nome do grupo, como o documento assinado o escreve ("Produção de Geoinformação"). É IDENTIDADE, e não declaração: revisão nenhuma o menciona na tabela de itens.';

CREATE TABLE IF NOT EXISTS pit.meta_item(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  meta_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  -- O codigo do documento ('1.1', '4.2'). TEXTO, e nao dois inteiros: o
  -- documento escreve '1.10' depois de '1.9', e a ordenacao de tela ja trata
  -- isso onde precisa.
  item VARCHAR(20) NOT NULL,
  -- NOT NULL, e a medicao sustenta: os 42 itens de 2026 tem unidade. Enquanto o
  -- cabecalho morava nesta tabela a coluna PRECISAVA ser anulavel, porque grupo
  -- nao conta nada. Sem ele, a excecao acaba.
  unidade_id SMALLINT NOT NULL REFERENCES dominio.unidade_meta (code),
  -- De onde vem o NUMERO deste item. Manual e o padrao: as origens calculadas
  -- (Capacitacao, Producao, Impressao) contam da entidade ligada, na leitura.
  origem_id SMALLINT NOT NULL DEFAULT 1 REFERENCES dominio.origem_meta (code),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_item_por_meta UNIQUE (meta_id, item)
);

COMMENT ON TABLE pit.meta_item IS
    'A unidade de trabalho do PIT: uma linha da tabela que o documento traz dentro de cada meta. É o alvo dos vínculos de trabalho (versão, pedido, capacitação) e da execução mensal.';

CREATE INDEX IF NOT EXISTS idx_meta_item_meta ON pit.meta_item (meta_id);

-- ---------------------------------------------------------------------------
-- 3. O TRANSPORTE DOS DADOS.
--
-- Guardado por "a coluna `item` ainda existe em `pit.meta`". Na segunda rodada o
-- ramo nao executa e o plpgsql nao chega a analisar nada la dentro, que e o que
-- torna o bloco idempotente mesmo referenciando colunas que ele mesmo removeu.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  orfaos INTEGER;
  sem_nome INTEGER;
  itens INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'pit' AND table_name = 'meta' AND column_name = 'item'
  ) THEN
    RAISE NOTICE 'pit.meta.item ja foi removida: transporte de dados ja aplicado.';
    RETURN;
  END IF;

  -- 3.1 O ITEM SEM GRUPO PARA ONDE IR. Nao existe hoje (medido), e se existisse
  -- o INNER JOIN abaixo o descartaria em silencio, que e o modo de falhar que
  -- esta migracao nao pode ter.
  SELECT count(*) INTO orfaos
  FROM pit.meta f
  WHERE f.item IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pit.meta c
      WHERE c.ano = f.ano AND c.numero_meta = f.numero_meta AND c.item IS NULL
    );
  IF orfaos > 0 THEN
    RAISE EXCEPTION
      '% item(ns) do PIT nao tem linha de cabecalho na mesma (ano, numero_meta). Crie o cabecalho antes de migrar.', orfaos;
  END IF;

  -- 3.2 O NOME DO GRUPO sai da declaracao do cabecalho. Um cabecalho tem uma
  -- declaracao so (medido: 7 em 2026 e 7 em 2025, todas no R0), e mesmo assim a
  -- ordem e explicita: vale a revisao publicada mais recente.
  -- Subconsulta correlacionada, e nao LATERAL: o UPDATE nao deixa o FROM
  -- referenciar a propria tabela alvo.
  UPDATE pit.meta c
  SET nome = (
    SELECT x.descricao
    FROM pit.meta_revisao x
    INNER JOIN pit.revisao r ON r.id = x.revisao_id
    WHERE x.meta_id = c.id
    ORDER BY (r.data_vigencia IS NULL), r.data_vigencia DESC, r.id DESC
    LIMIT 1
  )
  WHERE c.item IS NULL AND c.nome IS NULL;

  -- 3.3 O GRUPO SEM NOME. A coluna vira NOT NULL adiante, e a falha da restricao
  -- chegaria como erro cru sem dizer QUAL linha.
  SELECT count(*) INTO sem_nome FROM pit.meta WHERE item IS NULL AND nome IS NULL;
  IF sem_nome > 0 THEN
    RAISE EXCEPTION
      '% meta(s) de cabecalho sem declaracao nenhuma, e por isso sem nome. Declare-as antes de migrar.', sem_nome;
  END IF;

  -- 3.4 OS ITENS, COM O ID PRESERVADO. E o que dispensa traduzir `meta_pit_id`.
  INSERT INTO pit.meta_item (
    id, meta_id, item, unidade_id, origem_id,
    data_cadastramento, usuario_cadastramento_uuid,
    data_modificacao, usuario_modificacao_uuid
  )
  SELECT f.id, c.id, f.item,
         -- COALESCE para Folha (1) so por seguranca: medido, os 42 itens de 2026
         -- tem unidade. Sem ele, um item sem unidade quebraria o NOT NULL com
         -- erro que nao diz de quem e.
         COALESCE(f.unidade_id, 1),
         COALESCE(f.origem_id, 1),
         f.data_cadastramento, f.usuario_cadastramento_uuid,
         f.data_modificacao, f.usuario_modificacao_uuid
  FROM pit.meta f
  INNER JOIN pit.meta c
    ON c.ano = f.ano AND c.numero_meta = f.numero_meta AND c.item IS NULL
  WHERE f.item IS NOT NULL
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO itens FROM pit.meta_item;
  RAISE NOTICE 'pit.meta_item povoada com % item(ns).', itens;

  -- A sequencia passa a andar depois do maior id copiado, senao o proximo item
  -- cadastrado colidiria com um id que ja existe.
  PERFORM setval(
    pg_get_serial_sequence('pit.meta_item', 'id'),
    GREATEST((SELECT COALESCE(max(id), 0) FROM pit.meta_item), 1)
  );

  -- 3.5 A DECLARACAO DO CABECALHO SAI. O unico dado dela era a `descricao`, que
  -- acabou de virar `pit.meta.nome`; quantidade, prazo e demandante sempre foram
  -- nulos ali (medido), porque grupo nao promete.
  DELETE FROM pit.meta_revisao mr
  USING pit.meta m
  WHERE m.id = mr.meta_id AND m.item IS NULL;

  -- AS LINHAS DE ITEM AINDA NAO SAEM DE `pit.meta`, e a ordem aqui e o ponto
  -- delicado da migracao inteira. Sete chaves estrangeiras ainda apontam essas
  -- linhas, e duas delas (`pit.meta_revisao` e `pit.execucao`) sao ON DELETE
  -- CASCADE: apagar agora levaria junto as 47 declaracoes de item e os 109
  -- lancamentos mensais, em silencio, porque quem apaga e o banco. Primeiro os
  -- vinculos trocam de alvo (passos 4 e 5), e so entao a linha velha sai
  -- (passo 6).
END $$;

-- ---------------------------------------------------------------------------
-- 4. A DECLARACAO PASSA A SER DO ITEM.
--
-- RENOMEIA, e nao cria e copia: `auditoria.evento` guarda o nome da tabela em
-- cada linha e o schema nao aceita UPDATE da aplicacao, mas o id da linha
-- continua o mesmo e a ficha da meta continua achando o rastro.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('pit.meta_revisao') IS NOT NULL
     AND to_regclass('pit.meta_item_revisao') IS NULL THEN
    ALTER TABLE pit.meta_revisao RENAME TO meta_item_revisao;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'pit' AND table_name = 'meta_item_revisao'
      AND column_name = 'meta_id'
  ) THEN
    ALTER TABLE pit.meta_item_revisao RENAME COLUMN meta_id TO meta_item_id;
  END IF;
END $$;

ALTER INDEX IF EXISTS pit.idx_meta_revisao_meta RENAME TO idx_meta_item_revisao_item;
ALTER INDEX IF EXISTS pit.idx_meta_revisao_revisao RENAME TO idx_meta_item_revisao_revisao;

-- O QUE O RENAME NAO LEVA JUNTO: a sequencia, a chave primaria, o CHECK e as
-- tres chaves estrangeiras guardam o nome ANTIGO. Funciona assim mesmo, e por
-- isso e facil deixar passar; o que nao funciona e a promessa do README, que diz
-- que `er/` e a instalacao nova e `migrations/` a atualizacao, e que as duas
-- terminam no MESMO schema. Sem estas linhas o banco migrado fica com
-- `meta_revisao_pkey` e o novo com `meta_item_revisao_pkey`, e quem for
-- comparar os dois acha divergencia onde nao ha diferenca de comportamento.
-- Quem reprovou isto foi `migrations/ensaiar_migracao.cjs`.
DO $$
DECLARE
  r RECORD;
BEGIN
  IF to_regclass('pit.meta_item_revisao') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('pit.meta_revisao_id_seq') IS NOT NULL THEN
    ALTER SEQUENCE pit.meta_revisao_id_seq RENAME TO meta_item_revisao_id_seq;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('meta_revisao_pkey',                            'meta_item_revisao_pkey'),
      ('meta_revisao_quantidade_prevista_check',       'meta_item_revisao_quantidade_prevista_check'),
      ('meta_revisao_revisao_id_fkey',                 'meta_item_revisao_revisao_id_fkey'),
      ('meta_revisao_usuario_cadastramento_uuid_fkey', 'meta_item_revisao_usuario_cadastramento_uuid_fkey'),
      ('meta_revisao_usuario_modificacao_uuid_fkey',   'meta_item_revisao_usuario_modificacao_uuid_fkey')
    ) AS v(antigo, novo)
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'pit.meta_item_revisao'::regclass AND conname = r.antigo
    );
    EXECUTE format(
      'ALTER TABLE pit.meta_item_revisao RENAME CONSTRAINT %I TO %I', r.antigo, r.novo
    );
  END LOOP;
END $$;

COMMENT ON TABLE pit.meta_item_revisao IS
    'O item do PIT como uma revisão o declara. ESPARSA: só há linha quando a revisão muda alguma coisa, e por isso as linhas de uma revisão SÃO as alterações dela.';

-- ---------------------------------------------------------------------------
-- 5. OS VINCULOS TROCAM DE ALVO.
--
-- Nenhum valor muda: os ids foram preservados no passo 3.4. O que muda e para
-- qual tabela a chave estrangeira aponta. Se um id gravado NAO estiver em
-- `pit.meta_item`, o proprio ADD CONSTRAINT recusa, e e essa recusa que prova
-- que a traducao esta certa. Nao ha ON DELETE em quatro delas, de proposito: a
-- meta com trabalho ligado nao se apaga, e quem explica isso e o controlador.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  alvo REGCLASS := 'pit.meta_item'::regclass;
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('acervo.versao',          'meta_pit_id', 'versao_meta_pit_id_fkey',      ''),
      ('mapoteca.pedido',        'meta_pit_id', 'pedido_meta_pit_id_fkey',      ''),
      ('rpcmtec.capacitacao',    'meta_pit_id', 'capacitacao_meta_pit_id_fkey', ''),
      ('pit.execucao',           'meta_id',     'execucao_meta_id_fkey',        ' ON DELETE CASCADE'),
      ('acervo.upload_versao_temp', 'meta_pit_id', 'upload_versao_temp_meta_pit_id_fkey', ' ON DELETE SET NULL')
    ) AS v(tabela, coluna, restricao, acao)
  LOOP
    -- A tabela pode nao existir, e a coluna tambem nao: `upload_versao_temp`
    -- ganhou `meta_pit_id` em er/acervo.sql sem migracao que a acrescentasse, e
    -- por isso ela existe na instalacao nova e nao no banco de producao.
    CONTINUE WHEN to_regclass(r.tabela) IS NULL;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = r.tabela::regclass AND attname = r.coluna AND attnum > 0 AND NOT attisdropped
    );
    -- Ja aponta o alvo novo: nada a fazer.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = r.tabela::regclass AND confrelid = alvo
        AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                            WHERE attrelid = r.tabela::regclass AND attname = r.coluna)]
    );

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tabela, r.restricao);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES pit.meta_item (id)%s',
      r.tabela, r.restricao, r.coluna, r.acao
    );
  END LOOP;
END $$;

-- A declaracao aponta o ITEM. Mesma troca de alvo, e o id tambem nao muda.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pit.meta_item_revisao'::regclass
      AND confrelid = 'pit.meta_item'::regclass
  ) THEN
    ALTER TABLE pit.meta_item_revisao DROP CONSTRAINT IF EXISTS meta_revisao_meta_id_fkey;
    ALTER TABLE pit.meta_item_revisao
      ADD CONSTRAINT meta_item_revisao_meta_item_id_fkey
      FOREIGN KEY (meta_item_id) REFERENCES pit.meta_item (id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pit.meta_item_revisao'::regclass AND conname = 'unique_meta_por_revisao'
  ) THEN
    ALTER TABLE pit.meta_item_revisao RENAME CONSTRAINT unique_meta_por_revisao TO unique_item_por_revisao;
  END IF;
END $$;

-- `orcamento.pdr_item` e `orcamento.nota_credito` NAO entram na lista acima, e
-- isso e deliberado. Ver o cabecalho: 67 de 67 vinculos deles apontam a META, e
-- nenhum aponta item. Eles continuam em `pit.meta`, que segue existindo.

-- ---------------------------------------------------------------------------
-- 6. SO AGORA A LINHA VELHA SAI DE `pit.meta`.
--
-- Nenhuma chave estrangeira aponta mais as linhas de item: as cinco de trabalho
-- e a da declaracao foram para `pit.meta_item` nos passos 4 e 5, e as duas do
-- orcamento apontam cabecalho, que nao se apaga aqui. O DELETE agora nao
-- cascateia nada.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  apagadas INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'pit' AND table_name = 'meta' AND column_name = 'item'
  ) THEN
    RETURN;
  END IF;

  DELETE FROM pit.meta WHERE item IS NOT NULL;
  GET DIAGNOSTICS apagadas = ROW_COUNT;
  RAISE NOTICE '% linha(s) de item removidas de pit.meta (viraram pit.meta_item).', apagadas;

  -- A IDENTIDADE ANTIGA SAI. `item` foi para `pit.meta_item.item`; `unidade` e
  -- `origem` sao propriedade do item, e nunca foram do grupo (medido: nenhum
  -- cabecalho tinha unidade, e todos tinham origem Manual por omissao).
  ALTER TABLE pit.meta DROP CONSTRAINT IF EXISTS meta_ano_numero_meta_item_key;
  ALTER TABLE pit.meta DROP COLUMN IF EXISTS item;
  ALTER TABLE pit.meta DROP COLUMN IF EXISTS unidade_id;
  ALTER TABLE pit.meta DROP COLUMN IF EXISTS origem_id;
END $$;

-- Uma meta por numero por ano. Antes o `item` entrava na chave, e era ele que
-- deixava sete linhas conviverem sob a Meta 1.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pit.meta'::regclass AND conname = 'unique_meta_por_ano'
  ) THEN
    ALTER TABLE pit.meta ADD CONSTRAINT unique_meta_por_ano UNIQUE (ano, numero_meta);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. A LIMPEZA DO TEXTO.
--
-- `descricao` guardava TRES colunas do documento coladas numa frase:
--
--     "Carta Topografica 1:25.000. COTER/DECEX, 24"
--      \_____ Produto ou Servico ___/ \_Solicitante_/ \Qnt/
--
-- O sufixo sai e o Solicitante vai para `demandante`, que existia e ninguem
-- preenchia: os 42 itens tinham `demandante` NULO justamente porque o valor
-- estava colado no texto.
--
-- O PADRAO EXIGE O PONTO antes do solicitante, e por isso ele nao morde a
-- descricao que ja esta limpa. Medido nas 61 linhas de producao: 44 casam, 14
-- sao nome de grupo (sem sufixo) e 3 sao as declaracoes da R2 (1.9, 1.10 e 1.11)
-- que ja nasceram limpas e com demandante preenchido. Zero linhas inexplicadas.
--
-- O PARENTESE FICA NA DESCRICAO. "Capacitacao em Geoinformacao (Santa
-- Maria-RS). CMS/COTER, 0" perde so o ". CMS/COTER, 0".
--
-- `quantidade_prevista` NAO SE TOCA. O numero do texto e transcricao e o campo e
-- o dado; em 7 linhas os dois ja divergem em producao (a 4.2 da R0 diz 252 no
-- texto e guarda 247, que e o numero que o R0 assinado traz), e sobrescrever o
-- campo pelo texto apagaria o valor certo.
--
-- Sem barra invertida no padrao: classes entre colchetes atravessam qualquer
-- nivel de aspas sem se perder.
--
-- IDEMPOTENTE por construcao: depois da primeira rodada a frase nao tem mais
-- sufixo, e o padrao deixa de casar.
-- ---------------------------------------------------------------------------
UPDATE pit.meta_item_revisao mr
SET descricao = p.g[1],
    demandante = p.g[2]
FROM (
  SELECT id,
         regexp_match(descricao, '^(.*[.])[[:space:]]+([^.,]+),[[:space:]]*([0-9][0-9.]*)$') AS g
  FROM pit.meta_item_revisao
) AS p
WHERE p.id = mr.id AND p.g IS NOT NULL;

-- O nome do grupo so agora vira obrigatorio: no passo 3.2 ele acabou de ser
-- preenchido, e o passo 3.3 ja provou que nao sobrou nenhum vazio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'pit' AND table_name = 'meta'
      AND column_name = 'nome' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE pit.meta ALTER COLUMN nome SET NOT NULL;
  END IF;
END $$;

COMMENT ON TABLE pit.meta IS
    'Meta do PIT do ano: o GRUPO numerado que o documento assinado nomeia. O trabalho que ela promete vive em pit.meta_item.';

-- ---------------------------------------------------------------------------
-- 8. A VIEW E A FUNCAO, AGORA DO ITEM.
--
-- Devolvem `numero_meta` e `nome` por JOIN com `pit.meta`, entao quem lia a
-- meta continua achando as duas colunas no mesmo lugar.
--
-- O INNER JOIN LATERAL FICA. Meta que revisao PUBLICADA nenhuma declarou nao
-- esta no plano: com LEFT ela saia com tudo nulo, uma linha em branco no PIT do
-- ano. Foi o caso dos itens 1.9, 1.10 e 1.11 de 2026, que sairam da R0 e foram
-- para o rascunho da R2. Decidido e provado em 2026-08-05, nao desfazer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW pit.meta_vigente AS
SELECT mi.id, m.ano, m.numero_meta, m.nome, mi.meta_id, mi.item,
       mi.unidade_id, mi.origem_id,
       u.nome AS unidade,
       mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
       mr.cancelada, mr.revisao_id, r.codigo AS revisao,
       mi.data_cadastramento, mi.usuario_cadastramento_uuid,
       mi.data_modificacao, mi.usuario_modificacao_uuid
FROM pit.meta_item mi
INNER JOIN pit.meta m ON m.id = mi.meta_id
LEFT JOIN dominio.unidade_meta u ON u.code = mi.unidade_id
INNER JOIN LATERAL (
  SELECT x.* FROM pit.meta_item_revisao x
  INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
  WHERE x.meta_item_id = mi.id AND rr.data_vigencia IS NOT NULL
  ORDER BY rr.data_vigencia DESC, rr.id DESC
  LIMIT 1
) mr ON TRUE
LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;

COMMENT ON VIEW pit.meta_vigente IS
    'O item do PIT com a promessa da revisão em vigor hoje. Rascunho não entra, e item que revisão publicada nenhuma declarou também não: ele ainda não está no plano.';

CREATE OR REPLACE FUNCTION pit.meta_em(data_ref DATE)
RETURNS TABLE (
  id BIGINT, ano SMALLINT, numero_meta SMALLINT, nome VARCHAR,
  meta_id BIGINT, item VARCHAR,
  unidade_id SMALLINT, origem_id SMALLINT, unidade VARCHAR,
  descricao TEXT, quantidade_prevista INTEGER, prazo DATE,
  demandante VARCHAR, cancelada BOOLEAN, revisao_id BIGINT, revisao VARCHAR
) AS $$
  SELECT mi.id, m.ano, m.numero_meta, m.nome, mi.meta_id, mi.item,
         mi.unidade_id, mi.origem_id, u.nome,
         mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
         mr.cancelada, mr.revisao_id, r.codigo
  FROM pit.meta_item mi
  INNER JOIN pit.meta m ON m.id = mi.meta_id
  LEFT JOIN dominio.unidade_meta u ON u.code = mi.unidade_id
  -- INNER pela mesma razao da view acima: o item que nao havia sido declarado
  -- NAQUELA data nao disse nada, e o relatorio daquele mes nao pode reporta-lo.
  INNER JOIN LATERAL (
    SELECT x.* FROM pit.meta_item_revisao x
    INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
    WHERE x.meta_item_id = mi.id
      AND rr.data_vigencia IS NOT NULL
      AND rr.data_vigencia <= data_ref
    ORDER BY rr.data_vigencia DESC, rr.id DESC
    LIMIT 1
  ) mr ON TRUE
  LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION pit.meta_em(DATE) IS
    'O item do PIT com a promessa que vigia na data pedida. O item ainda não declarado por revisão publicada naquela data NÃO sai: ele não estava no plano.';

-- ---------------------------------------------------------------------------
-- 9. O RASTRO ANTIGO APONTA A TABELA CERTA.
--
-- `auditoria.evento` guarda o nome da tabela em cada linha. Os eventos gravados
-- como 'pit.meta' cujo registro virou item passam a dizer 'pit.meta_item', e os
-- de 'pit.meta_revisao' passam a dizer 'pit.meta_item_revisao'. Sem isso a ficha
-- do item nao acha o proprio historico, e o mapa de auditoria tenta resolver o
-- id numa tabela onde ele nao esta mais.
-- ---------------------------------------------------------------------------
-- `registro_id` e `entidade_id` sao VARCHAR nesta tabela, e nao BIGINT: o rastro
-- guarda a chave de qualquer entidade, e algumas tem chave que nao e numero (o
-- exercicio e o ano, o perfil e um par). Dai o cast explicito.
UPDATE auditoria.evento e
SET tabela = 'pit.meta_item'
WHERE e.tabela = 'pit.meta'
  AND EXISTS (SELECT 1 FROM pit.meta_item mi WHERE mi.id::text = e.registro_id);

UPDATE auditoria.evento
SET tabela = 'pit.meta_item_revisao'
WHERE tabela = 'pit.meta_revisao';

UPDATE public.versao SET nome = '1.30.0' WHERE code = 1;

COMMIT;

-- Para desfazer (a migracao NAO e reversivel sem perda: o sufixo ". SOLICITANTE,
-- N" que saiu de `descricao` so volta se for reescrito a partir de `demandante` e
-- do documento assinado). O caminho, na ordem:
--   1. ALTER TABLE pit.meta_item_revisao RENAME TO meta_revisao;
--      ALTER TABLE pit.meta_revisao RENAME COLUMN meta_item_id TO meta_id;
--   2. ALTER TABLE pit.meta ADD COLUMN item VARCHAR(20),
--        ADD COLUMN unidade_id SMALLINT REFERENCES dominio.unidade_meta (code),
--        ADD COLUMN origem_id SMALLINT NOT NULL DEFAULT 1
--          REFERENCES dominio.origem_meta (code);
--   3. INSERT INTO pit.meta (id, ano, numero_meta, item, unidade_id, origem_id, ...)
--        SELECT mi.id, m.ano, m.numero_meta, mi.item, mi.unidade_id, mi.origem_id, ...
--        FROM pit.meta_item mi INNER JOIN pit.meta m ON m.id = mi.meta_id;
--   4. INSERT INTO pit.meta_revisao (meta_id, revisao_id, descricao, ...) uma
--      linha por cabecalho, com descricao = pit.meta.nome e a revisao mais
--      antiga do ano.
--   5. Reapontar as chaves estrangeiras de volta para pit.meta (id).
--   6. DROP TABLE pit.meta_item; ALTER TABLE pit.meta DROP COLUMN nome;
--   7. Recriar pit.meta_vigente e pit.meta_em como estavam em er/pit.sql 1.29.0.
--   8. UPDATE public.versao SET nome = '1.29.0' WHERE code = 1;
