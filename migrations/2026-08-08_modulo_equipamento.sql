-- O CONTROLE DE EQUIPAMENTO ENTRA NO SISTEMA, E COMO MODULO PROPRIO.
--
-- O QUE HAVIA. Nada, no banco. O material permanente da Divisao, os 105 bens de
-- Classe VI e IX que o Relatorio DMT (Documento de Material Tecnico) do 1o CGEO
-- controla, vivia numa PLANILHA, e a ultima edicao dela e de 2026-08-03. O
-- sistema so conhecia dois desses bens, e por acidente: `mapoteca.plotter` e
-- `mapoteca.manutencao_plotter` guardam os plotters, porque quem os conserta e
-- quem atende a mapoteca. Estacao total, GNSS, drone, bastao e bipe nao tinham
-- lugar nenhum.
--
-- O QUE A PLANILHA NAO CONSEGUIA FAZER, medido nela mesma em 2026-08-03:
--
--   * A coluna "Situacao" trazia 94 'Disponivel' e 11 'Indisponivel', e as 11
--     'Indisponivel' eram EXATAMENTE as 11 linhas com motivo de
--     indisponibilidade preenchido. A coluna nao acrescentava um fato: ela
--     repetia, a mao, o que outra coluna ja dizia.
--   * As 11 indisponibilidades nao tinham data de FIM. O bem que voltasse a
--     funcionar so sairia da lista quando alguem apagasse a marca, e nao havia
--     como perguntar quem estava parado em JULHO. A subsecao 7.1 do RPCMTec
--     pergunta exatamente isso, todo mes.
--   * Os 2 GPS veiculares cedidos ao 3o BPE constavam 'Disponivel', porque nao
--     havia onde dizer "esta na Divisao, mas nao esta aqui".
--   * As 10 descargas solicitadas eram a palavra 'solicitado descarga' escrita
--     numa coluna de texto livre, sem estagio, sem documento e sem data.
--
-- O QUE MUDA. Esta migracao cria o schema `equipamento` inteiro, identico ao que
-- `er/equipamento.sql` produz numa instalacao nova, e acrescenta
-- `(6, 'Equipamento', 'equipamento')` em `dominio.modulo`.
--
-- As tres escolhas do schema que parecem defeito, e o porque de cada uma, estao
-- comentadas em `er/equipamento.sql`, ao lado do objeto. Em resumo:
--
--   * `equipamento.equipamento` NAO tem coluna de situacao. Quem responde e a
--     funcao `equipamento.situacao_em(dia)`, que recebe o DIA, no mesmo molde de
--     `pit.meta_em(data_ref)`. Coluna gravada so sabe hoje.
--   * A indisponibilidade e o afastamento sao INTERVALOS, com `EXCLUDE USING
--     gist` como `dgeo.efetivo_periodo`. E o `data_fim` que torna a 7.1
--     calculavel, e o EXCLUDE que impede o mesmo bem de ser contado duas vezes
--     no mesmo mes.
--   * `tipo_equipamento` e CADASTRO, com `id SERIAL`, e nao tabela de dominio.
--     Decisao do chefe em 2026-08-08: tipo novo passa a custar uma tela, e nao
--     uma migracao.
--
-- O QUE ISSO CUSTA.
--
--   1. UM MODULO A MAIS PARA CONCEDER. A tela de usuarios monta uma coluna por
--      linha de `dominio.modulo`, entao ela ganha a sexta sozinha. Ate alguem
--      conceder, quem alcanca o modulo equipamento e SO o administrador global.
--      Isto e deliberado, e esta migracao NAO concede perfil a ninguem: ela nao
--      escreve uma linha em `dgeo.usuario_perfil`. Conceder acesso e ato
--      explicito de quem administra, nunca efeito colateral de um deploy.
--   2. O CODE 6 E FIXO, e nao serial. `dgeo.usuario_perfil.modulo_id` referencia
--      `dominio.modulo.code`, e o mapa `MODULO` de
--      server/src/login/verify_perfil.js espelha este numero no codigo. Os dois
--      nascem juntos, aqui e la, no mesmo commit.
--   3. `nome_abrev` E IDENTIFICADOR, e nao rotulo. `verifyPerfil(nivel,
--      'equipamento')`, o prefixo `/api/equipamento`, a chave do mapa `perfis`
--      que o login devolve e o manifesto de modulo do client comparam a string
--      'equipamento' por igualdade. Trocar `nome` e inocente; trocar
--      `nome_abrev` derruba a autorizacao sem erro de sintaxe e sem teste
--      vermelho.
--   4. OS PLOTTERES FICAM ONDE ESTAO, POR ENQUANTO. `mapoteca.plotter` e
--      `mapoteca.manutencao_plotter` nao sao tocados aqui, e por um passo os
--      dois plotteres existem nos dois lugares. Move-los e uma fase propria, com
--      migracao propria: fazer as duas coisas no mesmo arquivo tornaria o
--      desfazer impossivel de ensaiar.
--
-- OS NOMES DE RESTRICAO SAO OS MESMOS DO `er/`, e isso nao e estetica. O
-- `migrations/ensaiar_migracao.cjs` monta dois bancos, um pelo caminho de
-- ATUALIZACAO e outro pela INSTALACAO NOVA, e compara coluna, restricao,
-- indice, funcao, gatilho e codigo de dominio. Nome de restricao divergente e
-- como um `DROP CONSTRAINT` ou um `ON CONFLICT ON CONSTRAINT` passa a funcionar
-- num banco e falhar no outro.
--
-- Para ensaiar antes de aplicar (o `--er-de` aponta para a revisao ANTERIOR a
-- este commit, porque `er/dominio.sql` e `er/versao.sql` mudam junto com este
-- arquivo, e sem ele o banco "anterior" ja nasceria com o modulo 6):
--
--   node migrations/ensaiar_migracao.cjs \
--     --migracao migrations/2026-08-08_modulo_equipamento.sql \
--     --novos er/equipamento.sql \
--     --versao-anterior 1.45.0 \
--     --versao-esperada 1.46.0 \
--     --schemas equipamento,dominio \
--     --er-de <revisao anterior>
--
-- Aditiva e idempotente, como toda migracao daqui: rodar duas vezes nao quebra.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O schema
-- ---------------------------------------------------------------------------
-- Depois de `dgeo` (de onde vem o `btree_gist` que o EXCLUDE exige) e de
-- `dominio`. Num banco existente os dois ja estao la desde a instalacao.

CREATE SCHEMA IF NOT EXISTS equipamento;

COMMENT ON SCHEMA equipamento IS
    'Material permanente da Divisão (Classe VI e IX): o bem, o que o tirou de uso, a manutenção e a transferência. A situação NÃO é gravada: ela se calcula pelo dia perguntado.';

-- A extensao ja vem de `er/dgeo.sql` na instalacao nova, e de
-- `migrations/2026-08-02_efetivo_por_intervalo.sql` no banco atualizado. Repetida
-- aqui porque este arquivo nao pode depender da ordem em que o outro rodou: sem
-- ela, o `EXCLUDE USING gist` abaixo morre em "data type integer has no default
-- operator class".
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- 2. Dominios
-- ---------------------------------------------------------------------------
-- O `code` e FIXO e semeado, nunca serial: ele e espelhado em
-- server/src/utils/domain_constants.js.

-- 6 e 9 sao os ALGARISMOS ROMANOS, e nao uma sequencia: Classe VI (102 bens) e
-- Classe IX (3 bens), medido na planilha de 2026-08-03.
CREATE TABLE IF NOT EXISTS equipamento.classe_suprimento(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.classe_suprimento (code, nome) VALUES (6, 'VI'), (9, 'IX')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS equipamento.secao_detentora(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.secao_detentora (code, nome) VALUES (1, 'Cia Lev'), (2, 'Cia Prod')
ON CONFLICT DO NOTHING;

-- Esta tabela da NOME e ORDEM aos estados, e nao e chave estrangeira de lugar
-- nenhum: nenhuma linha grava "este bem esta indisponivel". `precedencia` e o
-- desempate de quem esta afastado E em manutencao no mesmo dia, e e UNIQUE
-- porque dois estados com a mesma precedencia deixariam o desempate ao acaso.
CREATE TABLE IF NOT EXISTS equipamento.situacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  precedencia SMALLINT NOT NULL UNIQUE
);
INSERT INTO equipamento.situacao (code, nome, precedencia) VALUES
(1, 'Disponível', 10),
(2, 'Afastado', 20),
(3, 'Em manutenção', 30),
(4, 'Indisponível', 40),
(5, 'Baixado', 50)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS equipamento.situacao_transferencia(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.situacao_transferencia (code, nome) VALUES
(1, 'Solicitada'), (2, 'Autorizada'), (3, 'Concluída'), (4, 'Cancelada')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS equipamento.tipo_transferencia(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.tipo_transferencia (code, nome) VALUES
(1, 'Recebimento'), (2, 'Cessão'), (3, 'Descarga')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Tipo de equipamento: CADASTRO, e nao dominio
-- ---------------------------------------------------------------------------
-- `id SERIAL`, e nao `code` semeado: tipo novo entra pela tela. O preco esta
-- aceito e e conhecido: `id` de cadastro nao vira constante no codigo, e nenhum
-- SQL pode comparar `tipo_id` com numero literal.
--
-- `vida_util_meses`, E NAO ANOS: em anos, "18 meses" nao se escreve. O documento
-- DMT continua pedindo anos no cabecalho, e quem emite faz `meses / 12` na
-- saida. Converter na impressao e barato; converter na entrada perderia o dado.
CREATE TABLE IF NOT EXISTS equipamento.tipo_equipamento(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT,
  vida_util_meses SMALLINT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE equipamento.tipo_equipamento IS
    'Cadastro de tipo de equipamento, e não tabela de domínio: tipo novo entra pela tela, sem migração. Por isso o id é SERIAL e nunca vira constante no código.';

-- Os 9 do QDMP, os mesmos 9 que a planilha usava.
--
-- `WHERE NOT EXISTS`, e nao `ON CONFLICT DO NOTHING`: com `ON CONFLICT` a
-- sequence avanca mesmo quando a linha nao entra, entao reaplicar a migracao
-- deixaria o proximo `id` em 19 em vez de 10. O `er/` nunca produz esse buraco,
-- e migracao que diverge da instalacao nova e o defeito que este projeto persegue.
INSERT INTO equipamento.tipo_equipamento (nome, vida_util_meses)
SELECT v.nome, v.vida_util_meses
FROM (VALUES
  ('Estação Total', 120),
  ('Rastreador Satelital para Navegação (GPS) Individual', 60),
  ('Rastreador Satelital para Navegação (GPS) veicular', 60),
  ('Conjunto de Rastreamento Satelital GNSS', 120),
  ('Conjunto de Rastreamento Satelital GNSS com RTK', 120),
  ('Impressora de Grande Formato (Plotter)', 120),
  ('Aeronave Remotamente Pilotada (Drone)', 60),
  ('Bastão para topografia', 180),
  ('Bipé para Bastão', 180)
) AS v(nome, vida_util_meses)
WHERE NOT EXISTS (
  SELECT 1 FROM equipamento.tipo_equipamento AS t WHERE t.nome = v.nome
);

-- ---------------------------------------------------------------------------
-- 4. O bem
-- ---------------------------------------------------------------------------
-- `nr_patrimonio` E VARCHAR, E NAO INTEIRO. Das 105 celulas de patrimonio da
-- planilha de 2026-08-03, 88 estavam gravadas como numero e 17 como TEXTO. Lido
-- como inteiro, `104820700014462` volta como `104820700014462.0` ou em notacao
-- exponencial, e um numero com zero a esquerda perde o zero em silencio e passa
-- a ser outro bem.
--
-- `vida_util_meses` anulavel e o caso NORMAL: em branco significa "a do tipo", e
-- a leitura resolve com `COALESCE(e.vida_util_meses, t.vida_util_meses)`.
-- Copiar a vida util do tipo para dentro de cada bem faria o dia em que o tipo
-- mudasse deixar 105 linhas desatualizadas.
CREATE TABLE IF NOT EXISTS equipamento.equipamento(
  id SERIAL NOT NULL PRIMARY KEY,
  nr_patrimonio VARCHAR(30) NOT NULL UNIQUE,
  classe_id SMALLINT NOT NULL REFERENCES equipamento.classe_suprimento (code),
  tipo_id INTEGER NOT NULL REFERENCES equipamento.tipo_equipamento (id),
  modelo VARCHAR(255) NOT NULL,
  nr_serie VARCHAR(255),
  data_entrada_carga DATE,
  vida_util_meses SMALLINT,
  secao_detentora_id SMALLINT NOT NULL REFERENCES equipamento.secao_detentora (code),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE equipamento.equipamento IS
    'O bem. NÃO tem coluna de situação: ela é derivada por equipamento.situacao_em(dia). vida_util_meses nula significa "a do tipo".';

COMMENT ON COLUMN equipamento.equipamento.nr_patrimonio IS
    'Número de patrimônio. VARCHAR de propósito: não é quantidade, pode ter zero à esquerda e lido como inteiro volta com .0 ou em notação exponencial.';

CREATE INDEX IF NOT EXISTS idx_equipamento_tipo ON equipamento.equipamento (tipo_id);
CREATE INDEX IF NOT EXISTS idx_equipamento_secao ON equipamento.equipamento (secao_detentora_id);

-- ---------------------------------------------------------------------------
-- 5. Indisponibilidade: um INTERVALO, e nao uma marca
-- ---------------------------------------------------------------------------
-- Mesmo desenho de `dgeo.efetivo_periodo`. Sem `data_fim` nao existe recorte por
-- mes, e o recorte e o que torna a subsecao 7.1 do RPCMTec calculavel: "quem
-- esteve parado em julho" e uma pergunta sobre intervalos que se cruzam com
-- julho, e nao sobre o estado de hoje.
--
-- A NAO SOBREPOSICAO E DO BANCO, e nao do codigo: a regra vale para a tela, para
-- o CLI, para a carga e para o `psql` de quem vier depois. Duas
-- indisponibilidades do mesmo bem que se cruzam fariam a 7.1 contar o bem duas
-- vezes no mesmo mes. O `[]` fecha os dois lados, e `equipamento_id WITH =`
-- restringe a regra a UM bem por vez -- e e ele que exige o `btree_gist`.
CREATE TABLE IF NOT EXISTS equipamento.indisponibilidade(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  equipamento_id INTEGER NOT NULL REFERENCES equipamento.equipamento (id),
  data_inicio DATE NOT NULL,
  data_fim DATE,
  motivo TEXT NOT NULL,
  previsao_retorno DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT indisponibilidade_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_fim >= data_inicio),
  CONSTRAINT indisponibilidade_sem_sobreposicao
    EXCLUDE USING gist (
      equipamento_id WITH =,
      daterange(data_inicio, data_fim, '[]') WITH &&
    )
);

COMMENT ON TABLE equipamento.indisponibilidade IS
    'Período em que o bem não serve. data_fim NULA é "ainda parado". Intervalos do mesmo bem não se sobrepõem, e quem garante é o banco.';

CREATE INDEX IF NOT EXISTS idx_indisponibilidade_equipamento ON equipamento.indisponibilidade (equipamento_id);
CREATE INDEX IF NOT EXISTS idx_indisponibilidade_inicio ON equipamento.indisponibilidade (data_inicio);

-- ---------------------------------------------------------------------------
-- 6. Afastamento: o bem esta na Divisao, mas nao esta aqui
-- ---------------------------------------------------------------------------
-- Cessao temporaria a outra OM. O bem continua na carga do 1o CGEO, entao nao e
-- transferencia; e continua funcionando, entao nao e indisponibilidade. Sao os 2
-- GPS veiculares que estavam no 3o BPE em 2026-08-03, e que a planilha
-- registrava como 'Disponivel' por nao ter onde dizer outra coisa.
--
-- `previsao_termino` nao e `data_fim`: a previsao e o que se espera, e o fim e o
-- que aconteceu. Sem a distincao, prorrogar apagaria a promessa original.
CREATE TABLE IF NOT EXISTS equipamento.afastamento(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  equipamento_id INTEGER NOT NULL REFERENCES equipamento.equipamento (id),
  om VARCHAR(255) NOT NULL,
  motivo TEXT NOT NULL,
  data_inicio DATE NOT NULL,
  previsao_termino DATE,
  data_fim DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT afastamento_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_fim >= data_inicio),
  CONSTRAINT afastamento_sem_sobreposicao
    EXCLUDE USING gist (
      equipamento_id WITH =,
      daterange(data_inicio, data_fim, '[]') WITH &&
    )
);

COMMENT ON TABLE equipamento.afastamento IS
    'O bem está cedido a outra OM: continua na carga do 1º CGEO e continua funcionando, mas não está disponível aqui. data_fim NULA é "ainda fora".';

CREATE INDEX IF NOT EXISTS idx_afastamento_equipamento ON equipamento.afastamento (equipamento_id);

-- ---------------------------------------------------------------------------
-- 7. Manutencao
-- ---------------------------------------------------------------------------
-- `indisponibilidade_id` e anulavel de proposito: manutencao preventiva nao para
-- o equipamento. Quando ela PARA, a indisponibilidade e uma linha propria e esta
-- coluna as amarra.
--
-- AS TRES COLUNAS DE DINHEIRO respondem perguntas diferentes: `valor` e o que se
-- GASTOU, `valor_orcado` e o que se cotou antes de contratar, e `valor_pdr` e o
-- que o PDR preve para pagar.
--
-- `valor_pdr` E NUMERIC, E NAO ANO. A coluna se chamava "Previsao de recurso
-- (PDR)" na planilha, e nome assim convida a guardar o ano do PDR. A unica linha
-- real preenchida diz "Previsto em PDR R$600,00": e VALOR, e o mesmo valor do
-- orcamento previo. Guardar o ano perderia o unico numero que a Divisao
-- escreveu, e o ano se descobre pela `data_inicio`.
--
-- O CHECK e `> 0`, e nao `>= 0`: manutencao que custou zero e manutencao sem
-- valor informado, e para isso existe o NULL.
CREATE TABLE IF NOT EXISTS equipamento.manutencao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  equipamento_id INTEGER NOT NULL REFERENCES equipamento.equipamento (id),
  indisponibilidade_id BIGINT REFERENCES equipamento.indisponibilidade (id),
  data_inicio DATE NOT NULL,
  data_fim DATE,
  descricao TEXT,
  valor NUMERIC(14,2) CHECK (valor IS NULL OR valor > 0),
  valor_orcado NUMERIC(14,2) CHECK (valor_orcado IS NULL OR valor_orcado > 0),
  valor_pdr NUMERIC(14,2) CHECK (valor_pdr IS NULL OR valor_pdr > 0),
  certame VARCHAR(255),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT manutencao_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

COMMENT ON TABLE equipamento.manutencao IS
    'Conserto do bem. valor é o que se gastou, valor_orcado é o que se cotou e valor_pdr é o que o PDR prevê para pagar: os três são dinheiro, e nenhum deles é ano.';

CREATE INDEX IF NOT EXISTS idx_manutencao_equipamento ON equipamento.manutencao (equipamento_id);
CREATE INDEX IF NOT EXISTS idx_manutencao_data ON equipamento.manutencao (data_inicio);

-- ---------------------------------------------------------------------------
-- 8. Transferencia e descarga
-- ---------------------------------------------------------------------------
-- Descarga e o fim da vida do bem, e por isso ela e uma linha aqui e nao uma
-- marca no bem: ela e SOLICITADA muito antes de ser concluida, e as 10 descargas
-- da planilha de 2026-08-03 estavam todas no primeiro estagio.
--
-- QUASE TUDO E ANULAVEL, e e o retrato do que havia: das colunas de OM,
-- documento, data, SIAFI e publicacao, ZERO estavam preenchidas. Exigir OM ou
-- documento impediria de registrar a solicitacao no dia em que ela e feita, que
-- e justamente quando ainda nao ha documento nenhum.
--
-- `transferido_siafi` e `apropriado_siafi` sao dois momentos distintos e nao um
-- so: a UG que cede transfere, e a que recebe apropria.
CREATE TABLE IF NOT EXISTS equipamento.transferencia(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  equipamento_id INTEGER NOT NULL REFERENCES equipamento.equipamento (id),
  tipo_id SMALLINT NOT NULL REFERENCES equipamento.tipo_transferencia (code),
  situacao_id SMALLINT NOT NULL REFERENCES equipamento.situacao_transferencia (code),
  om VARCHAR(255),
  documento_solicitacao VARCHAR(255),
  data_solicitacao DATE,
  data_transferencia DATE,
  transferido_siafi BOOLEAN NOT NULL DEFAULT FALSE,
  apropriado_siafi BOOLEAN NOT NULL DEFAULT FALSE,
  publicacao_autorizacao VARCHAR(255),
  descricao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE equipamento.transferencia IS
    'Entrada, cessão ou descarga do bem. A descarga é um processo com estágios, e não uma marca: ela nasce Solicitada, sem OM, sem documento e sem data.';

CREATE INDEX IF NOT EXISTS idx_transferencia_equipamento ON equipamento.transferencia (equipamento_id);

-- ---------------------------------------------------------------------------
-- 9. A situacao derivada
-- ---------------------------------------------------------------------------
-- FUNCAO QUE RECEBE O DIA, e nao view que so sabe hoje. O precedente e
-- `pit.meta_em(data_ref)`, em er/pit.sql: o RPCMTec de julho tem de reportar o
-- que era verdade em julho, e uma view `situacao_atual` responderia agosto sem
-- ninguem acusar.
--
-- Vale o degrau mais alto que se aplicar, pela coluna `precedencia`. O 10 e o
-- piso: todo bem entra no `UNION ALL` com pelo menos essa linha, e por isso a
-- funcao devolve uma linha por bem, sempre.
--
-- `CREATE OR REPLACE` para a migracao ser idempotente; o `er/` usa `CREATE`. Os
-- dois produzem o MESMO `pg_get_functiondef`, que e o que o ensaio compara.
CREATE OR REPLACE FUNCTION equipamento.situacao_em(p_dia DATE)
RETURNS TABLE (equipamento_id INTEGER, situacao_id SMALLINT) AS $$
  SELECT e.id,
         (SELECT s.code FROM equipamento.situacao AS s
          WHERE s.precedencia = max(x.precedencia))::SMALLINT
  FROM equipamento.equipamento AS e
  CROSS JOIN LATERAL (
    SELECT 10 AS precedencia
    UNION ALL SELECT 20 WHERE EXISTS (
      SELECT 1 FROM equipamento.afastamento AS a
      WHERE a.equipamento_id = e.id
        AND a.data_inicio <= p_dia AND (a.data_fim IS NULL OR a.data_fim >= p_dia))
    UNION ALL SELECT 30 WHERE EXISTS (
      SELECT 1 FROM equipamento.manutencao AS m
      WHERE m.equipamento_id = e.id
        AND m.data_inicio <= p_dia AND (m.data_fim IS NULL OR m.data_fim >= p_dia))
    UNION ALL SELECT 40 WHERE EXISTS (
      SELECT 1 FROM equipamento.indisponibilidade AS i
      WHERE i.equipamento_id = e.id
        AND i.data_inicio <= p_dia AND (i.data_fim IS NULL OR i.data_fim >= p_dia))
    UNION ALL SELECT 50 WHERE e.ativo IS FALSE
  ) AS x
  GROUP BY e.id;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION equipamento.situacao_em(DATE) IS
    'A situação de cada bem NO DIA PEDIDO, pelo degrau de maior precedência que se aplicar. Recebe a data, e não olha para hoje: é o que faz o RPCMTec de um mês passado continuar certo.';

-- ---------------------------------------------------------------------------
-- 10. O modulo
-- ---------------------------------------------------------------------------
-- Idempotente pelo `code`, que e a chave primaria. Rodar duas vezes nao duplica
-- nem levanta erro.
--
-- NAO HA `INSERT` EM `dgeo.usuario_perfil` NESTE ARQUIVO, e a ausencia e a
-- regra: conceder acesso e ato explicito de quem administra. Ate alguem
-- conceder, so o administrador global alcanca o modulo.
INSERT INTO dominio.modulo (code, nome, nome_abrev) VALUES
(6, 'Equipamento', 'equipamento')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. Acesso ao schema novo
-- ---------------------------------------------------------------------------
-- O `GRANT ... ON ALL TABLES IN SCHEMA` do er/permissao.sql vale para o que
-- existia NA HORA em que ele rodou, e num banco ja instalado ele nao rodara de
-- novo. Sem este bloco o backend sobe e quebra no primeiro acesso, com
-- "permission denied for schema equipamento".
--
-- O dono do schema `dgeo` e o usuario da aplicacao: e ele que recebeu os grants
-- na instalacao. `situacao_em` precisa de EXECUTE, e nao so as tabelas.
DO $$
DECLARE
  app_user TEXT;
BEGIN
  SELECT nspowner::regrole::text INTO app_user
  FROM pg_namespace WHERE nspname = 'dgeo';

  IF app_user IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA equipamento TO %I', app_user);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA equipamento TO %I', app_user);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA equipamento TO %I', app_user);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA equipamento TO %I', app_user);
END $$;

UPDATE public.versao SET nome = '1.46.0' WHERE code = 1;

COMMIT;

-- Para desfazer:
--
--   BEGIN;
--   DELETE FROM dgeo.usuario_perfil WHERE modulo_id = 6;
--   DELETE FROM dominio.modulo WHERE code = 6;
--   DROP SCHEMA IF EXISTS equipamento CASCADE;
--   UPDATE public.versao SET nome = '1.45.0' WHERE code = 1;
--   COMMIT;
--
-- O DELETE em `dgeo.usuario_perfil` VEM PRIMEIRO, e nao e zelo: a chave
-- estrangeira `usuario_perfil.modulo_id -> dominio.modulo.code` recusaria a
-- remocao do modulo enquanto houvesse uma concessao apontando para ele.
--
-- E ELE APAGA ACESSO. Quem tiver ganhado perfil em Equipamento perde o acesso
-- aquelas telas e volta a precisar da flag global de administrador. Desfazer
-- depois de conceder exige avisar quem perdeu.
--
-- O `DROP SCHEMA ... CASCADE` LEVA OS BENS JUNTO: os equipamentos cadastrados,
-- as indisponibilidades, as manutencoes e as transferencias. Se ja houver dado,
-- exporte antes -- nao ha de onde reconstruir, porque a planilha de origem para
-- de ser atualizada no dia em que o modulo entra no ar.
