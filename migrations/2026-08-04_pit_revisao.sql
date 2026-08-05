-- O PIT passa a ter REVISOES, e a meta se separa entre identidade e declaracao.
--
-- O PROBLEMA. A DSG revisa o PIT durante a execucao, e o proprio documento diz
-- isso: o R0 de 2026 avisa que "o EM/DSG realizara a revisao do PIT nos meses de
-- ABR e AGO 26". Ate aqui o SCA tinha UMA linha por meta, entao a revisao ou
-- sobrescrevia a promessa (e o relatorio de marco deixava de ser reproduzivel)
-- ou criava meta nova (e os seis vinculos que apontam para `pit.meta` ficavam
-- orfaos). Os dois caminhos estao errados.
--
-- O DESENHO. Alterar o PIT e cancelar, alterar e adicionar
-- meta. So isso. Essas tres operacoes tem um dono unico, a DSG, e isso divide a
-- meta em duas naturezas:
--
--   pit.meta          o que o SCA decide: unidade e origem do numero. Id
--                     ESTAVEL, e e nele que os seis vinculos se penduram.
--   pit.meta_revisao  o que a DSG declara: descricao, quantidade, prazo,
--                     demandante e o cancelamento.
--
-- UMA FORMA COBRE AS TRES OPERACOES. Adicionar e a primeira linha da meta em
-- `meta_revisao`. Alterar e uma linha nova com o numero novo. Cancelar e uma
-- linha nova com `cancelada`. Nenhum caso especial, nenhum DELETE.
--
-- ESPARSA, E POR ISSO ELA E O HISTORICO. So se grava linha quando algo muda. As
-- linhas de uma revisao SAO as alteracoes dela, sem diff nem calculo, e "em que
-- revisao a meta 4.2 mudou" e a lista de revisoes em que ela tem linha. Um
-- instantaneo por revisao gravaria 49 linhas para registrar 5 mudancas.
--
-- MEDIDO NO R0 E NO R1 ASSINADOS de 2026, que sao a prova de que a forma serve:
--   4.2 de 247 para 252   altera
--   6.8 de 73 para 61     altera
--   6.9 aparece           adiciona
--   5.2 e 5.3 somem       cancela
-- Cinco mudancas em 38 itens. O resto e identico.
--
-- `situacao_id` DA META SAI, e vira `cancelada` na revisao. Dos quatro estados
-- de `dominio.situacao_meta` so 'Cancelada' era ato da DSG; 'Em andamento' e
-- 'Concluida' a grade calcula do que foi lancado, e um status digitado ao lado
-- de um calculado e a segunda verdade que este banco vem eliminando.
--
-- `unidade` VIRA DOMINIO. Era texto livre com 13 valores, 'carta' e 'folha' para
-- a mesma coisa, e 12 itens SEM unidade nenhuma, incluindo as duas metas que ja
-- calculam sozinhas (a 1.3 e a 1.4). A grade assume em silencio que uma versao
-- do acervo vale uma unidade da meta, e nada declarava isso.
--
-- A LEITURA NAO PRECISA SABER DISSO. `pit.meta_vigente` e `pit.meta_em(data)`
-- devolvem a meta com a promessa em vigor, com os MESMOS nomes de coluna de
-- antes. Quem lia `FROM pit.meta` troca uma palavra.
--
-- Idempotente: IF NOT EXISTS em tudo, e DO block com guarda em cada restricao.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Dominios novos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dominio.unidade_meta(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.unidade_meta (code, nome) VALUES
(1, 'Folha'),
(2, 'Marco'),
(3, 'Capacitação'),
(4, 'Item de acervo'),
(5, 'Atividade')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE dominio.unidade_meta IS
    'O que a meta CONTA. Folha absorve carta e CDGV; Marco é entregável único; Item de acervo é o que a APHC cataloga ou digitaliza; Atividade é o que se repete no ano.';

CREATE TABLE IF NOT EXISTS dominio.situacao_exercicio(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO dominio.situacao_exercicio (code, nome) VALUES
(1, 'Em elaboração'),
(2, 'Vigente'),
(3, 'Encerrado')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) O exercicio: o ano deixa de ser um inteiro solto
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pit.exercicio(
  ano SMALLINT NOT NULL PRIMARY KEY,
  situacao_id SMALLINT NOT NULL DEFAULT 2 REFERENCES dominio.situacao_exercicio (code),
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE pit.exercicio IS
    'O ano do PIT. Existe para o ano deixar de ser um SMALLINT solto e para o encerramento ser um ato: em ano Encerrado o servidor recusa lançamento.';

-- Nasce dos anos que ja existem, com o primeiro usuario como autor. Nao ha de
-- onde tirar autoria melhor: estes anos foram cadastrados antes de haver
-- exercicio.
INSERT INTO pit.exercicio (ano, situacao_id, usuario_cadastramento_uuid, observacao)
SELECT DISTINCT m.ano, 2, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1),
       'Criado pela migração 1.21.0 a partir das metas que já existiam.'
FROM pit.meta m
ON CONFLICT (ano) DO NOTHING;

INSERT INTO pit.exercicio (ano, situacao_id, usuario_cadastramento_uuid, observacao)
SELECT DISTINCT d.ano, 2, (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1),
       'Criado pela migração 1.21.0 a partir das demandas Extra-PIT.'
FROM pit.demanda_extra d
ON CONFLICT (ano) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_ano_fkey'
      AND conrelid = 'pit.meta'::regclass
  ) THEN
    ALTER TABLE pit.meta
      ADD CONSTRAINT meta_ano_fkey FOREIGN KEY (ano) REFERENCES pit.exercicio (ano);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'demanda_extra_ano_fkey'
      AND conrelid = 'pit.demanda_extra'::regclass
  ) THEN
    ALTER TABLE pit.demanda_extra
      ADD CONSTRAINT demanda_extra_ano_fkey FOREIGN KEY (ano) REFERENCES pit.exercicio (ano);
  END IF;
END $$;

-- `rpcmtec.capacitacao.ano` NAO entra nesta chave, e foi medido: ela tem 2013,
-- 2018, 2019, 2022, 2023, 2024, 2025 e 2026, e o PIT so tem 2025 e 2026.
-- Capacitacao existe fora do PIT, e o modelo continua dizendo isso.

-- ---------------------------------------------------------------------------
-- 3) A revisao, e o arquivo assinado dela
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pit.revisao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL REFERENCES pit.exercicio (ano),
  -- O codigo e o da DSG: 'R0' e o plano original, 'R1' a primeira revisao.
  codigo VARCHAR(20) NOT NULL,
  -- A data que o documento traz no fecho, que nao e a da assinatura digital.
  data_documento DATE,
  data_assinatura DATE,
  assinante VARCHAR(255),
  -- A PARTIR DE QUANDO ESTA REVISAO MANDA. Nulo e rascunho: a revisao esta
  -- cadastrada, o arquivo anexado, e ela ainda nao rege nada. Publicar e
  -- preencher esta data.
  --
  -- Substitui com vantagem um enum Recebida/Vigente/Superada: "superada" se
  -- deduz de existir outra depois, e a janela entre receber e executar vira o
  -- que ela e, uma data futura.
  data_vigencia DATE,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_revisao_por_ano UNIQUE (ano, codigo)
);

COMMENT ON TABLE pit.revisao IS
    'Uma versão assinada do PIT do ano (R0, R1, R2). O arquivo dela vive em pit.anexo_revisao, e data_vigencia nula significa rascunho.';

-- UM RASCUNHO POR ANO. Duas revisoes abertas ao mesmo tempo fariam a alteracao
-- de uma meta cair na errada, sem ninguem perceber.
CREATE UNIQUE INDEX IF NOT EXISTS unique_rascunho_por_ano
  ON pit.revisao (ano) WHERE data_vigencia IS NULL;

CREATE INDEX IF NOT EXISTS idx_revisao_ano ON pit.revisao (ano);

CREATE TABLE IF NOT EXISTS pit.tipo_anexo_revisao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO pit.tipo_anexo_revisao (code, nome) VALUES
(1, 'PIT assinado'),
(2, 'PIT de impressão'),
(3, 'Documento de encaminhamento (DIEx/Ofício)'),
(4, 'Outros')
ON CONFLICT (code) DO NOTHING;

-- Mesma forma de `mapoteca.anexo_pedido`, que guarda o conteudo na propria
-- linha: sem volume e sem checksum. Ja provado em 255 anexos, e o PIT assinado
-- tem 300 KB.
CREATE TABLE IF NOT EXISTS pit.anexo_revisao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  revisao_id BIGINT NOT NULL REFERENCES pit.revisao (id) ON DELETE CASCADE,
  tipo_anexo_id SMALLINT NOT NULL DEFAULT 4 REFERENCES pit.tipo_anexo_revisao (code),
  nome_original VARCHAR(255) NOT NULL,
  extensao VARCHAR(20) NOT NULL,
  mimetype VARCHAR(150),
  tamanho_bytes BIGINT,
  conteudo BYTEA NOT NULL,
  descricao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

CREATE INDEX IF NOT EXISTS idx_anexo_revisao_revisao
  ON pit.anexo_revisao (revisao_id);

-- ---------------------------------------------------------------------------
-- 4) A meta declarada por uma revisao
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pit.meta_revisao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  meta_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  revisao_id BIGINT NOT NULL REFERENCES pit.revisao (id) ON DELETE CASCADE,
  -- A frase da DSG. Ela ja contem o demandante e a quantidade ("Carta
  -- Topografica 1:25.000. COTER, 24"), e por isso desce junto com os dois: se
  -- ficasse na identidade, uma revisao que mudasse o numero deixaria o texto
  -- mentindo.
  descricao TEXT NOT NULL,
  quantidade_prevista INTEGER CHECK (quantidade_prevista IS NULL OR quantidade_prevista >= 0),
  prazo DATE,
  demandante VARCHAR(255),
  -- O UNICO ato de situacao que e da DSG. O andamento e a conclusao a grade
  -- calcula do que foi lancado.
  cancelada BOOLEAN NOT NULL DEFAULT FALSE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_meta_por_revisao UNIQUE (meta_id, revisao_id)
);

COMMENT ON TABLE pit.meta_revisao IS
    'A meta como uma revisão do PIT a declara. ESPARSA: só há linha quando a revisão muda alguma coisa, e por isso as linhas de uma revisão SÃO as alterações dela.';

CREATE INDEX IF NOT EXISTS idx_meta_revisao_meta ON pit.meta_revisao (meta_id);
CREATE INDEX IF NOT EXISTS idx_meta_revisao_revisao ON pit.meta_revisao (revisao_id);

-- ---------------------------------------------------------------------------
-- 5) A unidade vira dominio
-- ---------------------------------------------------------------------------

ALTER TABLE pit.meta
  ADD COLUMN IF NOT EXISTS unidade_id SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_unidade_id_fkey'
      AND conrelid = 'pit.meta'::regclass
  ) THEN
    ALTER TABLE pit.meta
      ADD CONSTRAINT meta_unidade_id_fkey
      FOREIGN KEY (unidade_id) REFERENCES dominio.unidade_meta (code);
  END IF;
END $$;

-- Carga do texto livre. As 12 metas sem unidade sao TODAS de producao (a 1 e a
-- 2), e por isso caem em Folha junto com as demais.
--
-- DENTRO DE UM DO COM GUARDA porque a coluna `unidade` e APAGADA no passo 8: na
-- segunda passada ela nao existe mais, e SQL estatico referenciando-a abortaria
-- a migracao inteira. O corpo do DO so e analisado quando executa.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'pit' AND table_name = 'meta' AND column_name = 'unidade'
  ) THEN
    EXECUTE $sql$
      UPDATE pit.meta SET unidade_id = CASE
          WHEN unidade IN ('carta', 'folha') THEN 1
          WHEN unidade = 'marco' THEN 2
          WHEN unidade = 'capacitação' THEN 3
          WHEN unidade IN ('documento', 'fotografia', 'mídia', 'ano') THEN 4
          WHEN unidade IN ('relatório', 'levantamento', 'autoavaliação',
                           'atualização', 'entrevista') THEN 5
          WHEN unidade IS NULL AND item IS NOT NULL THEN 1
          ELSE NULL
        END
      WHERE unidade_id IS NULL
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6) A promessa MUDA DE CASA, e nada se perde
-- ---------------------------------------------------------------------------

-- Uma revisao R0 por ano, mecanica. As datas e o assinante de verdade entram
-- depois, pela API, lendo o documento assinado: aqui nao ha de onde tira-los.
INSERT INTO pit.revisao (ano, codigo, data_vigencia, usuario_cadastramento_uuid, observacao)
SELECT e.ano, 'R0', make_date(e.ano, 1, 1),
       (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1),
       'Criada pela migração 1.21.0 com o estado que as metas tinham. As datas e o assinante saem do documento assinado.'
FROM pit.exercicio e
WHERE EXISTS (SELECT 1 FROM pit.meta m WHERE m.ano = e.ano)
ON CONFLICT (ano, codigo) DO NOTHING;

-- Mesma guarda da unidade, e pelo mesmo motivo: as cinco colunas lidas aqui sao
-- apagadas no passo 8.
--
-- `descricao` e NOT NULL na tabela nova e ANULAVEL na velha. A meta sem
-- descricao vira o rotulo do item, que e o que a tela ja imprimia.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'pit' AND table_name = 'meta' AND column_name = 'quantidade_prevista'
  ) THEN
    EXECUTE $sql$
      INSERT INTO pit.meta_revisao
        (meta_id, revisao_id, descricao, quantidade_prevista, prazo, demandante,
         cancelada, usuario_cadastramento_uuid)
      SELECT m.id, r.id,
             COALESCE(m.descricao, 'Meta ' || COALESCE(m.item, m.numero_meta::text)),
             m.quantidade_prevista, m.prazo, m.demandante,
             COALESCE(m.situacao_id = 4, FALSE),
             (SELECT uuid FROM dgeo.usuario ORDER BY id LIMIT 1)
      FROM pit.meta m
      INNER JOIN pit.revisao r ON r.ano = m.ano AND r.codigo = 'R0'
      ON CONFLICT (meta_id, revisao_id) DO NOTHING
    $sql$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7) A leitura: a meta com a promessa em vigor
-- ---------------------------------------------------------------------------

-- Devolve os MESMOS nomes de coluna que `pit.meta` tinha, para quem lia a
-- tabela trocar uma palavra e nao vinte.
--
-- `revisao_id` e `revisao` vao junto porque a tela precisa dizer de onde o
-- numero veio: "24 folhas, pelo R1".
CREATE OR REPLACE VIEW pit.meta_vigente AS
SELECT m.id, m.ano, m.numero_meta, m.item, m.unidade_id, m.origem_id,
       u.nome AS unidade,
       mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
       mr.cancelada, mr.revisao_id, r.codigo AS revisao,
       m.data_cadastramento, m.usuario_cadastramento_uuid,
       m.data_modificacao, m.usuario_modificacao_uuid
FROM pit.meta m
LEFT JOIN dominio.unidade_meta u ON u.code = m.unidade_id
LEFT JOIN LATERAL (
  SELECT x.* FROM pit.meta_revisao x
  INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
  WHERE x.meta_id = m.id AND rr.data_vigencia IS NOT NULL
  ORDER BY rr.data_vigencia DESC, rr.id DESC
  LIMIT 1
) mr ON TRUE
LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;

COMMENT ON VIEW pit.meta_vigente IS
    'A meta com a promessa da revisão em vigor hoje. Rascunho (data_vigencia nula) não entra: ele ainda não rege nada.';

-- A mesma coisa numa DATA, que e o que o RPCMTec de um mes precisa: a edicao de
-- marco reporta contra a revisao que vigia em marco, e nao contra a de hoje.
CREATE OR REPLACE FUNCTION pit.meta_em(data_ref DATE)
RETURNS TABLE (
  id BIGINT, ano SMALLINT, numero_meta SMALLINT, item VARCHAR,
  unidade_id SMALLINT, origem_id SMALLINT, unidade VARCHAR,
  descricao TEXT, quantidade_prevista INTEGER, prazo DATE,
  demandante VARCHAR, cancelada BOOLEAN, revisao_id BIGINT, revisao VARCHAR
) AS $$
  SELECT m.id, m.ano, m.numero_meta, m.item, m.unidade_id, m.origem_id,
         u.nome, mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
         mr.cancelada, mr.revisao_id, r.codigo
  FROM pit.meta m
  LEFT JOIN dominio.unidade_meta u ON u.code = m.unidade_id
  LEFT JOIN LATERAL (
    SELECT x.* FROM pit.meta_revisao x
    INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
    WHERE x.meta_id = m.id
      AND rr.data_vigencia IS NOT NULL
      AND rr.data_vigencia <= data_ref
    ORDER BY rr.data_vigencia DESC, rr.id DESC
    LIMIT 1
  ) mr ON TRUE
  LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION pit.meta_em(DATE) IS
    'A meta com a promessa que vigia na data pedida. A meta ainda não declarada naquela data sai com quantidade nula.';

-- ---------------------------------------------------------------------------
-- 8) As colunas que mudaram de casa saem da meta
-- ---------------------------------------------------------------------------

ALTER TABLE pit.meta DROP COLUMN IF EXISTS descricao;
ALTER TABLE pit.meta DROP COLUMN IF EXISTS quantidade_prevista;
ALTER TABLE pit.meta DROP COLUMN IF EXISTS unidade;
ALTER TABLE pit.meta DROP COLUMN IF EXISTS demandante;
ALTER TABLE pit.meta DROP COLUMN IF EXISTS prazo;
ALTER TABLE pit.meta DROP COLUMN IF EXISTS situacao_id;

DROP TABLE IF EXISTS dominio.situacao_meta;

COMMENT ON TABLE pit.meta IS
    'A IDENTIDADE da meta do PIT: o que o SCA decide (unidade e origem do número) e o que a revisão não muda (ano, número, item). O que a DSG declara vive em pit.meta_revisao.';

UPDATE public.versao SET nome = '1.21.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde o historico de revisao):
--   as colunas voltam de pit.meta_revisao da revisao vigente;
--   DROP FUNCTION pit.meta_em(DATE);
--   DROP VIEW pit.meta_vigente;
--   DROP TABLE pit.meta_revisao, pit.anexo_revisao, pit.tipo_anexo_revisao, pit.revisao;
--   ALTER TABLE pit.meta DROP COLUMN unidade_id;
--   ALTER TABLE pit.demanda_extra DROP CONSTRAINT demanda_extra_ano_fkey;
--   ALTER TABLE pit.meta DROP CONSTRAINT meta_ano_fkey;
--   DROP TABLE pit.exercicio;
--   DROP TABLE dominio.unidade_meta, dominio.situacao_exercicio;
--   UPDATE public.versao SET nome = '1.20.0' WHERE code = 1;
