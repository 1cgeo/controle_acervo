BEGIN;

-- ---------------------------------------------------------------------------
-- Equipamento: o material permanente que a Divisao emprega
-- ---------------------------------------------------------------------------
--
-- O que este schema guarda e o que o Relatorio DMT (Documento de Material
-- Tecnico) do 1o CGEO controlava numa planilha: 105 bens de Classe VI e IX,
-- estacao total, GNSS, drone, bastao e plotter, com quem os detem, o que os
-- tirou de uso, o que se gastou para conserta-los e para onde foram.
--
-- CARREGA DEPOIS DE `dgeo` E DE `dominio`. De `dgeo` vem a extensao
-- `btree_gist` (er/dgeo.sql), sem a qual o `EXCLUDE USING gist` deste arquivo
-- nao sabe comparar `equipamento_id` por igualdade; de `dominio` vem a linha
-- `(6, 'Equipamento', 'equipamento')` de `dominio.modulo`, que e o que
-- `verifyPerfil(nivel, 'equipamento')` cobra a cada requisicao.

CREATE SCHEMA equipamento;

COMMENT ON SCHEMA equipamento IS
    'Material permanente da Divisão (Classe VI e IX): o bem, o que o tirou de uso, a manutenção e a transferência. A situação NÃO é gravada: ela se calcula pelo dia perguntado.';

-- ---------------------------------------------------------------------------
-- Dominios. O `code` e FIXO e semeado, nunca serial: ele e espelhado em
-- server/src/utils/domain_constants.js, e dois lugares com o mesmo numero
-- escrito a mao divergem no primeiro que alguem renumerar.
-- ---------------------------------------------------------------------------

-- 6 e 9 SAO OS ALGARISMOS ROMANOS, e nao uma sequencia. A Classe VI e a IX sao
-- as duas classes de suprimento que a Divisao movimenta (VI, 102 bens, e IX, 3
-- bens, medido na planilha de 2026-08-03), e no dia em que aparecer a VII o code
-- dela e 7, sem renumerar nada.
CREATE TABLE equipamento.classe_suprimento(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.classe_suprimento (code, nome) VALUES (6, 'VI'), (9, 'IX');

-- Quem DETEM o bem hoje. Duas secoes, e nao a estrutura inteira da Divisao: a
-- planilha so distingue quem guarda o equipamento de levantamento de quem guarda
-- o de producao.
CREATE TABLE equipamento.secao_detentora(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.secao_detentora (code, nome) VALUES (1, 'Cia Lev'), (2, 'Cia Prod');

-- ---------------------------------------------------------------------------
-- A SITUACAO E DOMINIO, MAS NAO E COLUNA DE `equipamento.equipamento`
-- ---------------------------------------------------------------------------
--
-- Esta tabela existe para dar NOME e ORDEM aos estados; ela nao e chave
-- estrangeira de lugar nenhum. Nenhuma linha do sistema grava "este bem esta
-- indisponivel": quem responde isso e a funcao `equipamento.situacao_em(dia)`,
-- no fim deste arquivo.
--
-- POR QUE DERIVADA, E A PLANILHA E A PROVA. Na planilha de 2026-08-03 a coluna
-- "Situacao" trazia 94 'Disponivel' e 11 'Indisponivel'. As 11 'Indisponivel'
-- sao EXATAMENTE as 11 linhas que tem motivo de indisponibilidade preenchido:
-- a coluna nao acrescentava um unico fato, ela repetia o que as colunas de
-- motivo e data ja diziam. Uma coluna gravada e uma coluna que se pode esquecer
-- de atualizar, e no dia em que ela discordasse do motivo nao haveria como saber
-- qual das duas mente.
--
-- E, pior, ela so sabe HOJE. O RPCMTec de julho pergunta quem estava parado em
-- JULHO, e coluna gravada responde com o estado de agora.
--
-- `precedencia` e o desempate: um bem pode estar afastado E em manutencao no
-- mesmo dia, e vale o degrau mais alto que se aplicar. UNIQUE porque dois
-- estados com a mesma precedencia deixariam o desempate ao acaso.
CREATE TABLE equipamento.situacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  precedencia SMALLINT NOT NULL UNIQUE
);
INSERT INTO equipamento.situacao (code, nome, precedencia) VALUES
(1, 'Disponível', 10),
(2, 'Afastado', 20),
(3, 'Em manutenção', 30),
(4, 'Indisponível', 40),
(5, 'Baixado', 50);

CREATE TABLE equipamento.situacao_transferencia(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.situacao_transferencia (code, nome) VALUES
(1, 'Solicitada'), (2, 'Autorizada'), (3, 'Concluída'), (4, 'Cancelada');

CREATE TABLE equipamento.tipo_transferencia(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);
INSERT INTO equipamento.tipo_transferencia (code, nome) VALUES
(1, 'Recebimento'), (2, 'Cessão'), (3, 'Descarga');

-- ---------------------------------------------------------------------------
-- TIPO DE EQUIPAMENTO E CADASTRO, E NAO DOMINIO
-- ---------------------------------------------------------------------------
--
-- Repare que esta tabela tem `id SERIAL`, e nao `code SMALLINT` semeado: ela e a
-- unica deste arquivo que nao e dominio. Decisao do chefe, em 2026-08-08:
-- equipamento novo entra na Divisao sem avisar, e ate aqui cadastrar um tipo
-- custaria uma MIGRACAO, um deploy e um agente. Agora custa uma tela.
--
-- O preco esta aceito e e conhecido: `id` de cadastro NAO vira constante em
-- server/src/utils/domain_constants.js, e nenhum SQL pode comparar `tipo_id` com
-- numero literal. Quem precisar de um tipo especifico o procura pelo nome.
--
-- As 9 linhas semeadas sao as do QDMP, as mesmas 9 que a planilha usava.
--
-- `vida_util_meses`, E NAO ANOS. Decisao do chefe no mesmo dia. Em anos, "18
-- meses" nao se escreve, e a planilha ja carregava a vida util como inteiro de
-- anos justamente porque nao havia onde por meio ano. O documento DMT continua
-- pedindo ANOS no cabecalho, e quem emite faz `meses / 12` na saida: converter
-- na IMPRESSAO e barato, e converter na ENTRADA perderia o dado.
--
-- `ativo` desliga o tipo sem apaga-lo: bem antigo continua apontando para o tipo
-- que saiu de linha, e um DELETE quebraria a chave estrangeira ou reescreveria a
-- historia.
CREATE TABLE equipamento.tipo_equipamento(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT,
  vida_util_meses SMALLINT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE equipamento.tipo_equipamento IS
    'Cadastro de tipo de equipamento, e não tabela de domínio: tipo novo entra pela tela, sem migração. Por isso o id é SERIAL e nunca vira constante no código.';

INSERT INTO equipamento.tipo_equipamento (nome, vida_util_meses) VALUES
('Estação Total', 120),
('Rastreador Satelital para Navegação (GPS) Individual', 60),
('Rastreador Satelital para Navegação (GPS) veicular', 60),
('Conjunto de Rastreamento Satelital GNSS', 120),
('Conjunto de Rastreamento Satelital GNSS com RTK', 120),
('Impressora de Grande Formato (Plotter)', 120),
('Aeronave Remotamente Pilotada (Drone)', 60),
('Bastão para topografia', 180),
('Bipé para Bastão', 180);

-- ---------------------------------------------------------------------------
-- O BEM
-- ---------------------------------------------------------------------------
--
-- `nr_patrimonio` E VARCHAR, E NAO INTEIRO, e isso nao e desleixo. O numero de
-- patrimonio nao e quantidade: nao se soma, nao se ordena por grandeza e pode
-- comecar com zero. A prova esta na planilha de 2026-08-03: das 105 celulas de
-- patrimonio, 88 estavam gravadas como numero e 17 como TEXTO. Lido como
-- inteiro, `104820700014462` volta como `104820700014462.0` ou em notacao
-- exponencial, e um numero com zero a esquerda perde o zero em silencio, sem
-- erro nenhum, e passa a ser outro bem. UNIQUE porque o patrimonio e a
-- identidade do bem no SIAFI.
--
-- `vida_util_meses` ANULAVEL, e a nulidade e o caso NORMAL: em branco significa
-- "a do tipo". A leitura resolve com
-- `COALESCE(e.vida_util_meses, t.vida_util_meses)` e ainda diz de onde o numero
-- veio. Copiar a vida util do tipo para dentro de cada bem no cadastro faria o
-- dia em que o tipo mudasse deixar 105 linhas desatualizadas.
--
-- `ativo` FALSE e o bem BAIXADO, o degrau 50 da situacao. Ele nao sai da tabela:
-- a manutencao, a indisponibilidade e a transferencia dele continuam sendo
-- historia da Divisao, e o RPCMTec de um mes passado ainda o conta.
CREATE TABLE equipamento.equipamento(
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

CREATE INDEX idx_equipamento_tipo ON equipamento.equipamento (tipo_id);
CREATE INDEX idx_equipamento_secao ON equipamento.equipamento (secao_detentora_id);

-- ---------------------------------------------------------------------------
-- INDISPONIBILIDADE: um INTERVALO, e nao uma marca
-- ---------------------------------------------------------------------------
--
-- Mesmo desenho de `dgeo.efetivo_periodo` (er/dgeo.sql), e pela mesma razao. A
-- planilha marcava o bem como 'Indisponivel' e guardava a data de inicio; nao
-- havia data de FIM, entao o bem que voltou a funcionar so deixava de aparecer
-- quando alguem apagasse a marca. Sem `data_fim` nao existe RECORTE POR MES, e o
-- recorte e o que torna a subsecao 7.1 do RPCMTec calculavel: "quem esteve
-- parado em julho" e uma pergunta sobre intervalos que se cruzam com julho, e
-- nao sobre o estado de hoje.
--
-- `data_fim` NULA e "ainda parado", e e o caso comum: as 11 indisponibilidades
-- da planilha de 2026-08-03 estavam todas abertas.
--
-- A NAO SOBREPOSICAO E DO BANCO, e nao do codigo, porque a regra tem de valer
-- para a tela, para o CLI, para a carga e para o `psql` de quem vier depois.
-- Duas indisponibilidades do MESMO bem que se cruzam nem entram: elas fariam a
-- 7.1 contar o mesmo bem duas vezes no mesmo mes. O `[]` fecha os dois lados,
-- entao voltar no dia 30 e parar de novo no dia 30 e sobreposicao, e nao
-- continuidade. `equipamento_id WITH =` e o que restringe a regra a UM bem por
-- vez, e e ele que exige o `btree_gist`.
CREATE TABLE equipamento.indisponibilidade(
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

CREATE INDEX idx_indisponibilidade_equipamento ON equipamento.indisponibilidade (equipamento_id);
CREATE INDEX idx_indisponibilidade_inicio ON equipamento.indisponibilidade (data_inicio);

-- ---------------------------------------------------------------------------
-- AFASTAMENTO: o bem esta na Divisao, mas nao esta aqui
-- ---------------------------------------------------------------------------
--
-- Cessao temporaria a outra OM. O bem continua na carga do 1o CGEO, entao ele
-- nao e transferencia; e continua funcionando, entao ele nao e
-- indisponibilidade. Ele so nao esta disponivel PARA NOS. Sao os 2 GPS
-- veiculares que estavam no 3o BPE em 2026-08-03, e que a planilha registrava
-- como 'Disponivel' por nao ter onde dizer outra coisa.
--
-- INTERVALO com `EXCLUDE`, pela mesma razao da indisponibilidade: sem `data_fim`
-- nao ha como perguntar "onde este bem estava em julho", e dois afastamentos do
-- mesmo bem que se cruzam afirmam que ele estava em duas OM ao mesmo tempo.
--
-- `previsao_termino` NAO e `data_fim`, e as duas convivem: a previsao e o que se
-- espera, e o fim e o que aconteceu. Sem a distincao, prorrogar um afastamento
-- apagaria a promessa original.
CREATE TABLE equipamento.afastamento(
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

CREATE INDEX idx_afastamento_equipamento ON equipamento.afastamento (equipamento_id);

-- ---------------------------------------------------------------------------
-- MANUTENCAO
-- ---------------------------------------------------------------------------
--
-- `indisponibilidade_id` E ANULAVEL de proposito: manutencao preventiva, ou a
-- que se faz com o bem ainda em uso, nao para o equipamento. Quando ela PARA, a
-- indisponibilidade e uma linha propria e esta coluna as amarra, para a ficha do
-- bem contar uma historia so.
--
-- AS TRES COLUNAS DE DINHEIRO sao as colunas 16, 17 e 18 do Relatorio DMT, e
-- respondem perguntas diferentes: `valor` e o que se GASTOU, `valor_orcado` e o
-- que o fornecedor cobrou antes de contratar, e `valor_pdr` e o que esta
-- previsto no PDR para pagar.
--
-- `valor_pdr` E NUMERIC, E NAO ANO. A coluna se chamava "Previsao de recurso
-- (PDR)" na planilha, e nome assim convida a guardar o ano do PDR. A unica linha
-- real preenchida (o plotter `...16510`) diz "Previsto em PDR R$600,00": e
-- VALOR, e o mesmo valor do orcamento previo. Guardar o ano ali perderia o unico
-- numero que a Divisao escreveu, e o ano se descobre pela `data_inicio`.
--
-- O CHECK e `> 0`, e nao `>= 0`: manutencao que custou zero e manutencao sem
-- valor informado, e para isso existe o NULL.
CREATE TABLE equipamento.manutencao(
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

CREATE INDEX idx_manutencao_equipamento ON equipamento.manutencao (equipamento_id);
CREATE INDEX idx_manutencao_data ON equipamento.manutencao (data_inicio);

-- ---------------------------------------------------------------------------
-- TRANSFERENCIA E DESCARGA
-- ---------------------------------------------------------------------------
--
-- O bem SAI da carga, ou entra nela. As tres formas estao em
-- `tipo_transferencia`: Recebimento, Cessao e Descarga. Descarga e o fim da vida
-- do bem, e por isso ela e uma linha aqui e nao uma marca no bem: ela e
-- SOLICITADA muito antes de ser concluida, e as 10 descargas que a planilha de
-- 2026-08-03 trazia estavam todas no primeiro estagio, sem OM, sem documento e
-- sem data.
--
-- QUASE TUDO E ANULAVEL, e e o retrato do que a planilha tinha: das colunas 19 a
-- 25 (OM, documento, data, SIAFI, publicacao), ZERO estavam preenchidas em
-- 2026-08-03. Exigir OM ou documento no cadastro impediria de registrar a
-- solicitacao no dia em que ela e feita, que e justamente quando ainda nao ha
-- documento nenhum.
--
-- `transferido_siafi` e `apropriado_siafi` sao dois momentos distintos do SIAFI
-- e nao um so: a UG que cede transfere, e a que recebe apropria. Enquanto os
-- dois nao forem verdade, o bem esta em transito contabil.
CREATE TABLE equipamento.transferencia(
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

CREATE INDEX idx_transferencia_equipamento ON equipamento.transferencia (equipamento_id);

-- ---------------------------------------------------------------------------
-- A SITUACAO DERIVADA
-- ---------------------------------------------------------------------------
--
-- FUNCAO QUE RECEBE O DIA, e nao view que so sabe hoje. O precedente e
-- `pit.meta_em(data_ref)`, em er/pit.sql, e a razao e a mesma: o RPCMTec de
-- julho tem de reportar o que era verdade em julho. Uma view `situacao_atual`
-- responderia agosto para a pergunta de julho, e ninguem acusaria.
--
-- Vale o DEGRAU MAIS ALTO que se aplicar no dia perguntado, pela coluna
-- `precedencia` de `equipamento.situacao`. Um bem baixado que ainda tem uma
-- indisponibilidade aberta sai como Baixado, e nao como Indisponivel.
--
-- O 10 e o piso: todo bem entra no `UNION ALL` com pelo menos essa linha, e por
-- isso a funcao devolve UMA linha por bem, sempre, e nunca deixa um bem de fora
-- por nao ter nenhum evento.
--
-- STABLE, e nao VOLATILE: ela so le, e o planejador pode chama-la uma vez por
-- consulta. Sem isso, um JOIN com ela a reexecutaria por linha.
CREATE FUNCTION equipamento.situacao_em(p_dia DATE)
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

COMMIT;
