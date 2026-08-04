-- O RPCMTec inteiro passa a ser PREENCHIDO E GUARDADO no sistema.
--
-- O QUE MUDA, e por que isso contradiz em parte o que `er/rpcmtec.sql` dizia.
-- Até aqui a doutrina da tabela era "não gravar, recalcular": as tabelas do
-- relatório eram consultas recortadas por ano e mês, e gravá-las faria a edição
-- envelhecer em silêncio no primeiro pedido corrigido depois de fechada.
--
-- Os dois se conciliam pela ASSINATURA, e o padrão é o mesmo que `pit.revisao`
-- estreou em 2026-08-04:
--
--   edição ABERTA   (data_fechamento IS NULL)  o calculado recalcula a cada
--                                              abertura, e só o digitado
--                                              persiste;
--   edição FECHADA                             TUDO congela, inclusive o
--                                              calculado.
--
-- O congelamento não é conveniência, é o que torna a edição reproduzível. O
-- RTM de março de 2026 reportou 247 na meta 4.2 e o de julho reportou 252, e só
-- a revisão do PIT explicou a diferença. Uma edição de março regerada em agosto
-- mostraria números que ninguém leu, e nada diria qual foi o assinado.
--
-- O QUE SE CONGELA É A CÉLULA IMPRESSA, e não o dado normalizado. Regra de
-- formatação muda; o que o documento assinado disse, não.
--
-- POR QUE A LINHA GUARDA `titulo`, `secao_titulo`, `cabecalhos`, `origem_id` e
-- `ordem`, que parecem derivar da estrutura do documento: porque a estrutura
-- MUDA. Entre janeiro e julho de 2026 o RPCMTec passou de seis para nove
-- seções, e toda a numeração anterior mudou de lugar. Guardando isso, a edição
-- fechada se desenha sozinha, com a estrutura que ela teve, e não com a de hoje.
--
-- O `assinante` deixa de ser texto e vira `dgeo.usuario`. O bloco de assinatura
-- do PDF ("FELIPE DE CARVALHO DINIZ - Major") sai do cadastro, e não de um nome
-- redigitado por edição.

BEGIN;

-- ---------------------------------------------------------------------------
-- Domínio: quem preenche a subseção
-- ---------------------------------------------------------------------------

-- É propriedade do NÚMERO da subseção, não da linha, e ainda assim vai gravada
-- em cada linha: uma subseção pode GRADUAR de digitada para calculada quando o
-- SCA passar a saber calculá-la, e a edição fechada antes disso continua sendo
-- o que foi. É também o que `conferir hoje` usa para saber o que recalcular.
CREATE TABLE IF NOT EXISTS dominio.origem_subsecao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT
);

INSERT INTO dominio.origem_subsecao (code, nome, descricao) VALUES
(1, 'Calculada', 'O SCA a monta do banco. Recalcula enquanto a edição está aberta e congela no fechamento.'),
(2, 'Digitada', 'O gestor a preenche na edição do mês. É o que o SCA não sabe calcular.'),
(3, 'Fixa', 'Texto imutável do documento, igual em toda edição.')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- rpcmtec.edicao: fechamento e assinante do cadastro
-- ---------------------------------------------------------------------------

-- Instante, e não dia de calendário: fechar é um ato, e duas edições fechadas
-- no mesmo dia têm ordem. `data_assinatura` continua DATE, porque a data que o
-- documento carrega é o dia.
ALTER TABLE rpcmtec.edicao
  ADD COLUMN IF NOT EXISTS data_fechamento TIMESTAMP WITH TIME ZONE;

ALTER TABLE rpcmtec.edicao
  ADD COLUMN IF NOT EXISTS usuario_fechamento_uuid UUID REFERENCES dgeo.usuario (uuid);

ALTER TABLE rpcmtec.edicao
  ADD COLUMN IF NOT EXISTS assinante_uuid UUID REFERENCES dgeo.usuario (uuid);

COMMENT ON COLUMN rpcmtec.edicao.data_fechamento IS
    'Nula é edição ABERTA (o calculado recalcula). Preenchida é FECHADA (tudo congelado em rpcmtec.subsecao).';

-- Casa o texto que estava lá com o cadastro. Duas tentativas, e a segunda é a
-- que de fato pega em produção: as cinco edições de 2026 guardam o BLOCO DE
-- ASSINATURA inteiro ("Maj Fulano de Tal - Chefe da Divisão de
-- Geoinformação"), e não o nome. Medido em 2026-08-05: pelo nome completo, zero
-- casamentos; pelo nome de guerra contido no texto, um candidato ÚNICO nas
-- cinco.
--
-- A EXIGÊNCIA DE CANDIDATO ÚNICO é a rede. Nome de guerra curto pode aparecer
-- dentro do texto de mais de uma pessoa, e apontar a errada é pior que não
-- apontar ninguém: o que não casar fica nulo, e o fechamento cobra o assinante.
--
-- O DO guarda a leitura da coluna que vai ser apagada logo abaixo. Sem ele, a
-- segunda passada do ensaio de idempotência morre em "coluna assinante não
-- existe", porque o SQL estático é analisado mesmo quando não deve rodar.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'rpcmtec' AND table_name = 'edicao'
      AND column_name = 'assinante'
  ) THEN
    EXECUTE $sql$
      UPDATE rpcmtec.edicao AS e
      SET assinante_uuid = u.uuid
      FROM dgeo.usuario AS u
      WHERE e.assinante_uuid IS NULL
        AND e.assinante IS NOT NULL
        AND UPPER(BTRIM(u.nome)) = UPPER(BTRIM(e.assinante))
    $sql$;

    EXECUTE $sql$
      UPDATE rpcmtec.edicao AS e
      SET assinante_uuid = (
        SELECT u.uuid FROM dgeo.usuario AS u
        WHERE e.assinante ILIKE '%' || u.nome_guerra || '%'
      )
      WHERE e.assinante_uuid IS NULL
        AND e.assinante IS NOT NULL
        AND (
          SELECT count(*) FROM dgeo.usuario AS u
          WHERE e.assinante ILIKE '%' || u.nome_guerra || '%'
        ) = 1
    $sql$;
  END IF;
END $$;

ALTER TABLE rpcmtec.edicao DROP COLUMN IF EXISTS assinante;

-- ---------------------------------------------------------------------------
-- rpcmtec.subsecao: a espinha
-- ---------------------------------------------------------------------------

-- UMA linha por bloco de uma edição. Enquanto a edição está aberta só existe
-- linha para o que foi digitado; no fechamento, TODOS os blocos materializam.
--
-- A ausência de linha para uma subseção digitada É informação: quer dizer que
-- ninguém a visitou, e é o que o fechamento recusa. Vazio POR DECISÃO se marca
-- em `sem_ocorrencia`, e imprime o '-' que o modelo usa. Sem essa distinção,
-- "não houve" e "ninguém preencheu" saem iguais no documento, que é o que o
-- RPCMTec de hoje não separa.
CREATE TABLE IF NOT EXISTS rpcmtec.subsecao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  edicao_id BIGINT NOT NULL REFERENCES rpcmtec.edicao (id) ON DELETE CASCADE,
  -- '2.1', '9.3'. VARCHAR porque é rótulo do documento, não número: '2.10'
  -- viria depois de '2.9' na leitura humana e antes na numérica.
  numero VARCHAR(10) NOT NULL,
  ordem SMALLINT NOT NULL,
  secao_titulo VARCHAR(255) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  origem_id SMALLINT NOT NULL REFERENCES dominio.origem_subsecao (code),
  -- Tabela: `cabecalhos` e `linhas`. Prosa: `texto`. Nunca os dois.
  cabecalhos JSONB,
  linhas JSONB,
  texto TEXT,
  sem_ocorrencia BOOLEAN NOT NULL DEFAULT FALSE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_subsecao_por_edicao UNIQUE (edicao_id, numero),
  -- Com cabeçalho é tabela, e tabela não tem prosa. Sem cabeçalho é prosa, e
  -- prosa não tem linhas.
  CONSTRAINT tabela_ou_texto CHECK (
    (cabecalhos IS NOT NULL AND texto IS NULL) OR
    (cabecalhos IS NULL AND linhas IS NULL)
  ),
  -- "Sem ocorrência" com conteúdo dentro seriam duas respostas para a mesma
  -- pergunta, e o desenhador teria de escolher uma calado.
  CONSTRAINT sem_ocorrencia_sem_conteudo CHECK (
    NOT sem_ocorrencia OR
    (COALESCE(jsonb_array_length(linhas), 0) = 0 AND texto IS NULL)
  )
);

COMMENT ON TABLE rpcmtec.subsecao IS
    'Um bloco de uma edição do RPCMTec. Enquanto a edição está aberta guarda só o digitado; no fechamento congela o documento inteiro, inclusive o calculado.';

COMMENT ON COLUMN rpcmtec.subsecao.linhas IS
    'A célula já em TEXTO, como vai impressa. Congela-se o que o documento disse, não o dado normalizado.';

CREATE INDEX IF NOT EXISTS idx_subsecao_edicao ON rpcmtec.subsecao (edicao_id);

-- ---------------------------------------------------------------------------
-- rpcmtec.anexo_edicao: o PDF assinado
-- ---------------------------------------------------------------------------

-- Mesma forma de `pit.anexo_revisao` e de `mapoteca.anexo_pedido`: os bytes
-- vivem na linha. É o documento ASSINADO que volta para cá, e ele é a fonte
-- primária da edição: o congelado tem de dizer o que ele diz.
--
-- SEM domínio de tipo, ao contrário do anexo da revisão do PIT. Aqui só entra
-- uma coisa, o relatório assinado. Mais de uma linha atende retificação, e a
-- mais recente é a que vale.
CREATE TABLE IF NOT EXISTS rpcmtec.anexo_edicao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  edicao_id BIGINT NOT NULL REFERENCES rpcmtec.edicao (id) ON DELETE CASCADE,
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

COMMENT ON TABLE rpcmtec.anexo_edicao IS
    'O RPCMTec assinado, em PDF. Fonte primária da edição: o congelado tem de dizer o que ele diz.';

CREATE INDEX IF NOT EXISTS idx_anexo_edicao_edicao ON rpcmtec.anexo_edicao (edicao_id);

UPDATE public.versao SET nome = '1.22.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde o digitado e o congelado de toda edicao):
--   DROP TABLE rpcmtec.anexo_edicao, rpcmtec.subsecao;
--   DROP TABLE dominio.origem_subsecao;
--   ALTER TABLE rpcmtec.edicao ADD COLUMN assinante VARCHAR(255);
--   UPDATE rpcmtec.edicao e SET assinante = u.nome
--     FROM dgeo.usuario u WHERE u.uuid = e.assinante_uuid;
--   ALTER TABLE rpcmtec.edicao DROP COLUMN assinante_uuid,
--     DROP COLUMN usuario_fechamento_uuid, DROP COLUMN data_fechamento;
--   UPDATE public.versao SET nome = '1.21.0' WHERE code = 1;
