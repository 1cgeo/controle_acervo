BEGIN;

-- ---------------------------------------------------------------------------
-- Produção: o fluxo que leva uma folha do insumo ao produto pronto
-- ---------------------------------------------------------------------------
--
-- É O `macrocontrole` DO SAP 2.3.5, e a travessia é de 39 tabelas, TODAS vindas
-- de lá: desde 2026-08-09 este schema não tem nenhuma tabela que o SAP não
-- tivesse. O SAP 2.3.5 é aposentado por ela: nada fica lá.
--
-- O QUE NÃO ATRAVESSOU, e por quê. `macrocontrole.projeto`, `macrocontrole.lote`
-- e `macrocontrole.produto` ficaram de fora porque o SCA já tem os três, em
-- `acervo.projeto`, `acervo.lote` e `acervo.produto`/`acervo.versao`, e dois
-- cadastros do mesmo projeto no mesmo banco é exatamente a segunda verdade que
-- esta fusão vem eliminando. `macrocontrole.pit` também não veio: lá ela é a
-- META, e aqui a meta é `pit.meta` (a `pit.pit` daqui é o ANO, e o homônimo está
-- registrado em `docs/decisoes.md`). Com ela saíram `pit_execucao_manual`,
-- `situacao_extra_pit` e `extra_pit`, cujo lugar aqui é `pit.execucao` e
-- `pit.demanda_extra`.
--
-- O LOTE É O DO ACERVO, E SÓ ELE. Todo `lote_id` do `macrocontrole` passou a
-- apontar `acervo.lote (id)`, por decisão do chefe em 2026-08-09. Não existe
-- lote de produção neste banco, e não existe tabela que case lote com linha de
-- produção: houve uma no desenho, `producao.lote_linha`, e a MESMA decisão a
-- removeu antes de ela chegar a banco nenhum. O que ela custava está em
-- `docs/decisoes.md`, e é para lá que vai quem pensar em propô-la de novo.
--
-- O AVISO QUE ELA DEIXOU CONTINUA VALENDO, e foi medido: 61 dos 102 lotes do
-- acervo com versão carregam MAIS DE UM subtipo de produto. O lote `2026_1a` tem
-- carta topográfica e CDGV, que são duas linhas de produção distintas, com fases
-- distintas e etapas distintas. Um lote, portanto, ATRAVESSA linhas de produção,
-- e dentro dele a unidade de trabalho da carta e a versão de CDGV ocupam o MESMO
-- polígono. Quem cruzar produção com acervo POR LOTE, sem filtrar o subtipo, faz
-- a UT da carta reivindicar a versão do CDGV, e a contagem de produção mente sem
-- levantar erro. O filtro é obrigatório, está em `producao.relacionamento_versao`
-- e sai do caminho
-- `unidade_trabalho -> subfase -> fase -> linha_producao.subtipo_produto_id`.
--
-- ISSO É TRANSITÓRIO, E A SAÍDA É CORRIGIR O DADO. O chefe decidiu em 2026-08-09
-- que os lotes do acervo serão SEPARADOS POR TIPO DE PRODUTO, e o alvo é um
-- lote, uma linha de produção. É PENDÊNCIA: a separação ainda não foi feita, e
-- os 61 lotes continuam misturados hoje.
--
-- O FILTRO DE SUBTIPO NÃO DEVE SER REMOVIDO quando os lotes forem separados. Ali
-- ele deixa de ser necessário e passa a ser guarda barata contra o lote que
-- voltar a misturar subtipos. Está escrito com estas letras de propósito: sem
-- isso, alguém o apaga por "não ser mais necessário".
--
-- SRID 4674 EM TODA GEOMETRIA. O SAP usa 4326, e o SCA inteiro usa 4674
-- (SIRGAS 2000), que é o datum oficial brasileiro e o que `acervo.produto`,
-- `campo.campo` e `limites` já guardam. Duas geometrias em datums diferentes no
-- mesmo banco fazem `st_relate` responder errado sem levantar erro, e é
-- `st_relate` que decide qual unidade de trabalho cobre qual versão.
--
-- USUÁRIO É UUID, e não o `id` inteiro do SAP. Toda coluna `usuario_id` de lá
-- virou `usuario_uuid UUID REFERENCES dgeo.usuario (uuid)`, que é como o SCA
-- inteiro referencia gente.
--
-- `tipo_turno` NÃO EXISTE, e o code 3 de `dominio.tipo_restricao` ("Operadores
-- no mesmo turno") saiu junto. Medido no dump de produção de 2026-08-09:
-- `restricao_etapa` tem 98 linhas e ZERO delas do tipo 3.
--
-- CARREGA DEPOIS DE `er/dominio.sql`, `er/dgeo.sql`, `er/acervo.sql` e
-- `er/qgis.sql`: as onze tabelas de perfil apontam para o catálogo do QGIS, a
-- etapa, o bloco e a unidade de trabalho apontam `acervo.lote`, o
-- `relacionamento_versao` aponta `acervo.versao` e toda coluna de auditoria
-- aponta `dgeo.usuario`.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA producao;

COMMENT ON SCHEMA producao IS
    'O fluxo de produção cartográfica: linha, fase, subfase, etapa, unidade de trabalho e atividade. Veio do macrocontrole do SAP 2.3.5, e o lote dele é o acervo.lote.';

-- ---------------------------------------------------------------------------
-- A LINHA DE PRODUÇÃO, e o que ela produz
-- ---------------------------------------------------------------------------
--
-- `subtipo_produto_id` APONTA `dominio.subtipo_produto`, e não a
-- `dominio.tipo_produto` daqui. O `dominio.tipo_produto` do SAP é, código a
-- código, o `dominio.subtipo_produto` do SCA (22 dos 23 idênticos até no nome;
-- só o 19 difere de rótulo), e o `dominio.tipo_produto` do SCA é OUTRA coisa,
-- mais grossa: 'Carta Topográfica' é tipo, e 'Carta Topográfica - T34-700' é
-- subtipo. Apontar o tipo faria a linha de produção deixar de saber qual
-- especificação técnica ela executa, que é a única coisa que esta coluna diz.
--
-- O `UNIQUE(nome)` REPETIDO DO SAP NÃO VEIO: lá a coluna era declarada
-- `NOT NULL UNIQUE` e havia um `UNIQUE(nome)` de tabela logo abaixo, criando
-- dois índices idênticos sobre a mesma coluna.
CREATE TABLE producao.linha_producao(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  nome_abrev VARCHAR(255) NOT NULL UNIQUE,
  subtipo_produto_id SMALLINT NOT NULL REFERENCES dominio.subtipo_produto (code),
  descricao TEXT,
  -- Linha indisponível não aparece para quem cadastra lote novo, e continua
  -- valendo para os lotes que já a usam. É aposentadoria, e não exclusão.
  disponivel BOOLEAN NOT NULL DEFAULT TRUE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE producao.linha_producao IS
    'A linha de produção: a sequência de fases e subfases que produz UM subtipo de produto. Aponta dominio.subtipo_produto, que é o dominio.tipo_produto do SAP.';

CREATE INDEX idx_linha_producao_subtipo ON producao.linha_producao (subtipo_produto_id);

-- ---------------------------------------------------------------------------
-- NÃO HÁ TABELA DE LOTE NESTE SCHEMA, e a ausência é a decisão
-- ---------------------------------------------------------------------------
--
-- QUEM PROCURA `producao.lote` OU `producao.lote_linha` PROCURA `acervo.lote`.
-- Existiu no desenho, por algumas horas de 2026-08-09, uma `producao.lote_linha`
-- que casava o lote do acervo com UMA linha de produção. O chefe a removeu no
-- mesmo dia, antes de a 3.0.0 ser aplicada em banco nenhum: a produção liga
-- DIRETO em `acervo.lote`, e o lote é um só na plataforma inteira. Ninguém deve
-- propô-la de novo.
--
-- O QUE MORREU COM ELA, e onde cada coisa foi parar:
--
--   `denominador_escala` NÃO TEM SUCESSOR, e não vai para `acervo.lote`. A
--   escala já mora em `acervo.produto.tipo_escala_id` (mais
--   `denominador_escala_especial`, para o produto de escala fora do domínio), e
--   ela é propriedade da FOLHA, não do lote: o mesmo lote produz a carta
--   1:25.000 e o CDGV que a alimenta, e uma escala única no lote teria de
--   mentir sobre um dos dois. Uma cópia no lote seria a segunda verdade, e era
--   exatamente para impedir duas cópias divergirem que o SAP mantinha o gatilho
--   `chk_scale`, que também não atravessou (o bloco sobre ele está mais abaixo).
--
--   `nome_abrev` NÃO TEM SUCESSOR. O nome legível do lote é `acervo.lote.nome`,
--   e repeti-lo aqui criaria a segunda verdade -- o que já estava escrito no
--   comentário da tabela removida. O único consumidor dele era a coluna
--   `lote_linha` da view `acompanhamento.bloco`, que passou a publicar
--   `acervo.lote.nome`.
--
--   `status_execucao_id` JÁ EXISTE EM `acervo.lote`, apontando o mesmo
--   `dominio.tipo_status_execucao` (1 Não iniciado, 2 Em execução, 3 Concluído,
--   4 Concluído parcialmente, 5 Pausado). Os gatilhos de status lá embaixo
--   passaram a lê-lo de lá, e "encerrado" continua sendo `IN (3, 4)`.
--
-- ---------------------------------------------------------------------------
-- FASE, SUBFASE e o pré-requisito entre subfases
-- ---------------------------------------------------------------------------
--
-- A FASE SÓ AGRUPA. Ela não tem nome próprio: o nome vem de
-- `dominio.tipo_fase`, que corresponde às fases do RTM e às do metadado do
-- BDGEx. O que a fase acrescenta é a ORDEM dentro de uma linha de produção.
CREATE TABLE producao.fase(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_fase_id SMALLINT NOT NULL REFERENCES dominio.tipo_fase (code),
  linha_producao_id INTEGER NOT NULL REFERENCES producao.linha_producao (id),
  ordem INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (linha_producao_id, ordem)
);

COMMENT ON TABLE producao.fase IS
    'Agrupa subfases dentro de uma linha de produção. O nome vem de dominio.tipo_fase; o que a fase acrescenta é a ordem.';

CREATE INDEX idx_fase_tipo ON producao.fase (tipo_fase_id);

-- A SUBFASE é onde o trabalho de fato acontece: é ela que tem camadas, insumos,
-- unidades de trabalho e perfis de configuração do QGIS.
CREATE TABLE producao.subfase(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  fase_id INTEGER NOT NULL REFERENCES producao.fase (id),
  ordem INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (nome, fase_id)
);

COMMENT ON TABLE producao.subfase IS
    'Onde o trabalho acontece: a subfase é que tem camadas, insumos, unidades de trabalho e perfil de configuração do QGIS.';

CREATE INDEX idx_subfase_fase ON producao.subfase (fase_id);

-- O QUE UMA SUBFASE EXIGE DE OUTRA, espacialmente. Não é "a subfase B começa
-- depois da A": é "a REGIÃO que B vai trabalhar precisa estar concluída em A"
-- (tipo 1) ou "não pode estar em execução em A" (tipo 2). O gatilho
-- `a_relacionamento_pre_requisito_subfase` materializa isso par a par em
-- `producao.relacionamento_ut`, e é dali que a distribuição lê.
CREATE TABLE producao.pre_requisito_subfase(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_pre_requisito_id SMALLINT NOT NULL REFERENCES dominio.tipo_pre_requisito (code),
  subfase_anterior_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  subfase_posterior_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (subfase_anterior_id, subfase_posterior_id)
);

COMMENT ON TABLE producao.pre_requisito_subfase IS
    'Pré-requisito ESPACIAL entre subfases. O gatilho materializa par a par em producao.relacionamento_ut.';

CREATE INDEX idx_pre_requisito_subfase_tipo ON producao.pre_requisito_subfase (tipo_pre_requisito_id);
CREATE INDEX idx_pre_requisito_subfase_posterior ON producao.pre_requisito_subfase (subfase_posterior_id);

-- ---------------------------------------------------------------------------
-- A ETAPA: a subfase de um lote, na ordem em que se executa
-- ---------------------------------------------------------------------------
--
-- A MESMA SUBFASE TEM ETAPAS DIFERENTES EM LOTES DIFERENTES, e é isso que a
-- chave (subfase, lote, ordem) diz: um lote pode pedir Execução, Revisão e
-- Correção, e outro só Execução. É por isso que a etapa aponta o lote e a
-- subfase não.
--
-- A ETAPA É QUEM DECLARA QUE UM LOTE EXECUTA UMA LINHA DE PRODUÇÃO, e passou a
-- ser desde que o lote é o do acervo: a subfase pertence a uma fase, a fase a
-- uma linha, e um lote com etapas em subfases de duas linhas executa as duas.
-- É dessa leitura que o schema `acompanhamento` tira o par (lote, linha) para
-- gerar as views, e não de uma tabela de cadastro.
--
-- O CHECK obriga a Execução (tipo 1) a ser sempre a primeira: uma revisão que
-- venha antes do trabalho revisaria o nada.
CREATE TABLE producao.etapa(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_etapa_id SMALLINT NOT NULL REFERENCES dominio.tipo_etapa (code),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  ordem INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT etapa_execucao_e_primeira CHECK (
    tipo_etapa_id <> 1 OR ordem = 1
  ),
  UNIQUE (subfase_id, lote_id, ordem)
);

COMMENT ON TABLE producao.etapa IS
    'A subfase de um lote do acervo, na ordem em que se executa. A mesma subfase tem etapas diferentes em lotes diferentes.';

CREATE INDEX idx_etapa_tipo ON producao.etapa (tipo_etapa_id);
CREATE INDEX idx_etapa_lote ON producao.etapa (lote_id);

-- QUEM PODE (OU NÃO) REPETIR ENTRE DUAS ETAPAS. Tipo 1 exige operadores
-- distintos (quem executou não revisa), tipo 2 exige o mesmo operador (quem
-- executou é quem corrige).
--
-- O TIPO 3 DO SAP ("Operadores no mesmo turno") NÃO EXISTE MAIS, e a ausência é
-- a regra: ele dependia de `dgeo.usuario.tipo_turno_id`, que não atravessou.
-- Medido no dump de produção de 2026-08-09: das 98 linhas desta tabela, ZERO
-- eram do tipo 3. Ressuscitá-lo é decisão, e decisão se registra em
-- `docs/decisoes.md`.
CREATE TABLE producao.restricao_etapa(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_restricao_id SMALLINT NOT NULL REFERENCES dominio.tipo_restricao (code),
  etapa_anterior_id INTEGER NOT NULL REFERENCES producao.etapa (id),
  etapa_posterior_id INTEGER NOT NULL REFERENCES producao.etapa (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (etapa_anterior_id, etapa_posterior_id)
);

COMMENT ON TABLE producao.restricao_etapa IS
    'Restrição de operador entre duas etapas: distintos ou iguais. O tipo 3 do SAP (mesmo turno) não existe, porque tipo_turno não atravessou.';

CREATE INDEX idx_restricao_etapa_tipo ON producao.restricao_etapa (tipo_restricao_id);
CREATE INDEX idx_restricao_etapa_posterior ON producao.restricao_etapa (etapa_posterior_id);

-- ---------------------------------------------------------------------------
-- AS CAMADAS que a subfase edita
-- ---------------------------------------------------------------------------

CREATE TABLE producao.camada(
  id SERIAL NOT NULL PRIMARY KEY,
  schema VARCHAR(255) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (schema, nome)
);

COMMENT ON TABLE producao.camada IS
    'Camada do banco de produção, identificada por schema e nome. As propriedades dela POR SUBFASE ficam em producao.propriedades_camada.';

-- COMO ESTA CAMADA SE COMPORTA NESTA SUBFASE. A mesma camada é comum numa
-- subfase e incomum noutra, e é de apontamento só onde a revisão acontece.
--
-- O CHECK amarra os três campos de apontamento: camada de apontamento sem os
-- atributos de situação e de justificativa não tem como registrar o apontamento,
-- e camada comum com esses atributos preenchidos afirma o que ela não é. É tudo
-- ou nada, e o banco cobra.
CREATE TABLE producao.propriedades_camada(
  id SERIAL NOT NULL PRIMARY KEY,
  camada_id INTEGER NOT NULL REFERENCES producao.camada (id),
  camada_incomum BOOLEAN NOT NULL DEFAULT FALSE,
  atributo_filtro_subfase VARCHAR(255),
  camada_apontamento BOOLEAN NOT NULL DEFAULT FALSE,
  atributo_situacao_correcao VARCHAR(255),
  atributo_justificativa_apontamento VARCHAR(255),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT propriedades_camada_apontamento_completo CHECK (
    (camada_apontamento IS TRUE AND atributo_situacao_correcao IS NOT NULL AND atributo_justificativa_apontamento IS NOT NULL) OR
    (camada_apontamento IS FALSE AND atributo_situacao_correcao IS NULL AND atributo_justificativa_apontamento IS NULL)
  ),
  UNIQUE (camada_id, subfase_id)
);

COMMENT ON TABLE producao.propriedades_camada IS
    'Como uma camada se comporta numa subfase. Camada de apontamento é tudo ou nada: sem os dois atributos ela não registra apontamento nenhum.';

CREATE INDEX idx_propriedades_camada_subfase ON producao.propriedades_camada (subfase_id);

-- ---------------------------------------------------------------------------
-- O DADO DE PRODUÇÃO: onde a unidade de trabalho é editada
-- ---------------------------------------------------------------------------
--
-- `configuracao_producao` GUARDA `servidor:porta/banco`, e essa é a forma que o
-- código lê. Foi MEDIDO no dump de produção do SAP 2.3.5 em 2026-08-09: as 19
-- linhas de `macrocontrole.dado_producao` estão nesse formato, sem exceção.
--
-- ESTE COMENTÁRIO AFIRMAVA O CONTRÁRIO até 2026-08-09 ("é o nome do banco, e
-- nunca o endereço"), e a afirmação era perigosa, não só errada: quem a lesse
-- poderia "consertar" o subsistema de permissão tirando o endereço, e ele deixa
-- de achar o banco onde conceder.
--
-- E NÃO HÁ CONFLITO COM A REGRA DO REPOSITÓRIO PÚBLICO, que é sobre ARQUIVO
-- VERSIONADO. Aqui o endereço é DADO, digitado por quem cadastra o dado de
-- produção, e vive no banco. O que a regra proíbe é escrevê-lo em código, em
-- teste, em comentário ou em exemplo -- e é por isso que ele também NÃO SAI em
-- resposta de API nem em log: `permissoes_producao` recebe `dado_producao_id`, e
-- resolve o endereço por dentro.
CREATE TABLE producao.dado_producao(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_dado_producao_id SMALLINT NOT NULL REFERENCES dominio.tipo_dado_producao (code),
  configuracao_producao VARCHAR(255),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE producao.dado_producao IS
    'Onde a unidade de trabalho é editada. configuracao_producao guarda servidor:porta/banco, medido no dump do SAP 2.3.5 em 2026-08-09, e esse endereço é DADO: ele não sai em resposta de API nem em log, e permissoes_producao o resolve por dentro a partir do dado_producao_id.';

CREATE INDEX idx_dado_producao_tipo ON producao.dado_producao (tipo_dado_producao_id);

-- ---------------------------------------------------------------------------
-- O BLOCO: o recorte de distribuição dentro do lote
-- ---------------------------------------------------------------------------
--
-- É O QUE HABILITA O OPERADOR (`producao.habilitacao_bloco`): quem trabalha no
-- bloco Sul não recebe atividade do bloco Norte. `prioridade` é a ordem entre
-- blocos do mesmo lote quando a distribuição escolhe.
CREATE TABLE producao.bloco(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  prioridade INTEGER NOT NULL,
  status_execucao_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_execucao (code),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (nome, lote_id)
);

COMMENT ON TABLE producao.bloco IS
    'Recorte de distribuição dentro do lote do acervo. É a ele que o operador é habilitado.';

CREATE INDEX idx_bloco_lote ON producao.bloco (lote_id);
CREATE INDEX idx_bloco_status ON producao.bloco (status_execucao_id);

-- ---------------------------------------------------------------------------
-- A UNIDADE DE TRABALHO: o pedaço de mapa que uma pessoa recebe
-- ---------------------------------------------------------------------------
--
-- É A LINHA MAIS NUMEROSA DESTE SCHEMA, e a que a distribuição consulta a cada
-- pedido de atividade. Daí os índices por subfase e o GiST da geometria.
--
-- `disponivel` NASCE FALSO, ao contrário de `linha_producao.disponivel`: a
-- unidade de trabalho é criada em lote, antes de o insumo estar associado, e
-- liberá-la cedo entregaria trabalho sem os dados para fazê-lo.
--
-- `epsg` É TEXTO DE CINCO CARACTERES e não é o SRID da coluna `geom`. A geometria
-- de controle é sempre 4674; `epsg` é a projeção em que a EDIÇÃO acontece (uma
-- UTM local), e é o que o cliente usa para abrir o projeto do QGIS.
--
-- `dificuldade` e `tempo_estimado_minutos` alimentam a distribuição por perfil
-- de dificuldade (`producao.habilitacao_dificuldade`). Zero é o padrão e
-- significa "não calibrado", e não "fácil".
CREATE TABLE producao.unidade_trabalho(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255),
  epsg VARCHAR(5) NOT NULL,
  dado_producao_id INTEGER NOT NULL REFERENCES producao.dado_producao (id),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  bloco_id INTEGER NOT NULL REFERENCES producao.bloco (id),
  disponivel BOOLEAN NOT NULL DEFAULT FALSE,
  dificuldade INTEGER NOT NULL DEFAULT 0,
  tempo_estimado_minutos INTEGER NOT NULL DEFAULT 0,
  prioridade INTEGER NOT NULL,
  observacao TEXT,
  geom geometry(POLYGON, 4674) NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unidade_trabalho_dificuldade CHECK (dificuldade >= 0),
  CONSTRAINT unidade_trabalho_tempo_estimado CHECK (tempo_estimado_minutos >= 0)
);

COMMENT ON TABLE producao.unidade_trabalho IS
    'O pedaço de mapa que uma pessoa recebe. A geometria é 4674 e o epsg da coluna ao lado é a projeção de EDIÇÃO, que é outra coisa.';

CREATE INDEX idx_unidade_trabalho_subfase ON producao.unidade_trabalho (subfase_id);
CREATE INDEX idx_unidade_trabalho_lote ON producao.unidade_trabalho (lote_id);
CREATE INDEX idx_unidade_trabalho_bloco ON producao.unidade_trabalho (bloco_id);
CREATE INDEX idx_unidade_trabalho_dado_producao ON producao.unidade_trabalho (dado_producao_id);
CREATE INDEX idx_unidade_trabalho_geom ON producao.unidade_trabalho USING gist (geom);

-- ---------------------------------------------------------------------------
-- O INSUMO: o que a unidade de trabalho consome
-- ---------------------------------------------------------------------------
--
-- `insumo.geom` É ANULÁVEL, e a ausência é uma afirmação: insumo NÃO ESPACIAL
-- (uma tabela, um serviço, um documento) não tem recorte, e vale para toda a
-- área. É por isso que ele não pode ser NOT NULL como `campo.campo.geom`.
--
-- `caminho` É COLUNA E NASCE SEM VALOR NENHUM: é uma pasta de rede da
-- instalação, e este repositório é público.
CREATE TABLE producao.grupo_insumo(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  disponivel BOOLEAN NOT NULL DEFAULT TRUE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE producao.grupo_insumo IS
    'Agrupa insumos que entram juntos numa carga (uma cobertura de imagem, um conjunto de cartas antigas).';

CREATE TABLE producao.insumo(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  caminho VARCHAR(255) NOT NULL,
  epsg VARCHAR(5),
  tipo_insumo_id SMALLINT NOT NULL REFERENCES dominio.tipo_insumo (code),
  grupo_insumo_id INTEGER NOT NULL REFERENCES producao.grupo_insumo (id),
  -- Nula quando o insumo não é espacial. Ver o comentário do bloco acima.
  geom geometry(POLYGON, 4674),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE producao.insumo IS
    'O que a unidade de trabalho consome. Geometria nula significa insumo NÃO ESPACIAL, que vale para toda a área.';

CREATE INDEX idx_insumo_grupo ON producao.insumo (grupo_insumo_id);
CREATE INDEX idx_insumo_tipo ON producao.insumo (tipo_insumo_id);
CREATE INDEX idx_insumo_geom ON producao.insumo USING gist (geom);

-- A ASSOCIAÇÃO, que é DERIVADA da estratégia escolhida na carga
-- (`dominio.tipo_estrategia_associacao`) e por isso NÃO tem colunas de
-- auditoria: quem responde por ela é o insumo e a unidade de trabalho, cada um
-- com as suas.
CREATE TABLE producao.insumo_unidade_trabalho(
  id SERIAL NOT NULL PRIMARY KEY,
  unidade_trabalho_id INTEGER NOT NULL REFERENCES producao.unidade_trabalho (id),
  insumo_id INTEGER NOT NULL REFERENCES producao.insumo (id),
  caminho_padrao VARCHAR(255),
  UNIQUE (unidade_trabalho_id, insumo_id)
);

COMMENT ON TABLE producao.insumo_unidade_trabalho IS
    'Qual insumo alimenta qual unidade de trabalho. É derivada da estratégia de associação, e por isso não tem auditoria própria.';

CREATE INDEX idx_insumo_unidade_trabalho_insumo ON producao.insumo_unidade_trabalho (insumo_id);

-- ---------------------------------------------------------------------------
-- A ATIVIDADE: uma etapa executada sobre uma unidade de trabalho
-- ---------------------------------------------------------------------------
--
-- SEM COLUNAS DE AUDITORIA, e é deliberado: ela É o registro de execução. Quem
-- fez está em `usuario_uuid`, quando começou e quando acabou em `data_inicio` e
-- `data_fim`, e o que aconteceu no meio na trilha de `auditoria.evento`. Um par
-- `usuario_cadastramento_uuid`/`data_cadastramento` ao lado seria uma segunda
-- resposta para "quem" e "quando".
--
-- `usuario_uuid` É ANULÁVEL porque a atividade existe ANTES de ser distribuída:
-- ela nasce Não iniciada, sem dono, e a distribuição é quem escreve o nome.
--
-- `tipo_situacao_atividade_id` aponta `dominio.tipo_situacao_atividade`, que no
-- SAP se chamava `dominio.tipo_situacao`. O nome ganhou o sufixo porque aqui o
-- `dominio` serve sete módulos e "tipo_situacao" sozinho não diz situação DE
-- QUÊ.
--
-- O ÍNDICE ÚNICO PARCIAL é a regra mais importante desta tabela: pode haver
-- muitas atividades Não finalizadas (code 5) para o mesmo par (etapa, unidade de
-- trabalho), porque cada tentativa abandonada vira uma, mas VIVA só pode haver
-- uma. Sem ele, dois operadores receberiam a mesma etapa da mesma unidade.
CREATE TABLE producao.atividade(
  id SERIAL NOT NULL PRIMARY KEY,
  etapa_id INTEGER NOT NULL REFERENCES producao.etapa (id),
  unidade_trabalho_id INTEGER NOT NULL REFERENCES producao.unidade_trabalho (id),
  usuario_uuid UUID REFERENCES dgeo.usuario (uuid),
  tipo_situacao_atividade_id SMALLINT NOT NULL REFERENCES dominio.tipo_situacao_atividade (code),
  data_inicio TIMESTAMP WITH TIME ZONE,
  data_fim TIMESTAMP WITH TIME ZONE,
  observacao TEXT
);

COMMENT ON TABLE producao.atividade IS
    'Uma etapa executada sobre uma unidade de trabalho. É registro de execução, e por isso não tem colunas de auditoria: quem e quando já são colunas dela.';

CREATE INDEX idx_atividade_etapa ON producao.atividade (etapa_id);
CREATE INDEX idx_atividade_unidade_trabalho ON producao.atividade (unidade_trabalho_id);
CREATE INDEX idx_atividade_tipo_situacao ON producao.atividade (tipo_situacao_atividade_id);
CREATE INDEX idx_atividade_usuario ON producao.atividade (usuario_uuid);

-- Uma atividade VIVA por (etapa, unidade de trabalho). O code 5 ('Não
-- finalizada') fica de fora porque ele é justamente o registro das tentativas
-- que não vingaram, e pode haver várias.
CREATE UNIQUE INDEX atividade_unique_index
  ON producao.atividade (etapa_id, unidade_trabalho_id)
  WHERE tipo_situacao_atividade_id IN (1, 2, 3, 4);

-- ---------------------------------------------------------------------------
-- A HABILITAÇÃO: o que cada pessoa está autorizada a receber
-- ---------------------------------------------------------------------------
--
-- SE CHAMAVA `perfil_producao` NO SAP, e as quatro tabelas ao redor se chamavam
-- `perfil_producao_etapa`, `perfil_producao_operador`, `perfil_bloco_operador` e
-- `perfil_dificuldade_operador`. O nome mudou porque no SCA "perfil" já quer
-- dizer OUTRA coisa, e uma coisa só: `dominio.tipo_perfil` (1 consulta, 2
-- operador, 3 gerente), que é AUTORIZAÇÃO e é lida pelo `verifyPerfil` a cada
-- requisição. Duas palavras iguais para autorização e para distribuição de
-- trabalho no mesmo banco fariam toda leitura de código ter de adivinhar qual
-- das duas.
--
-- NÃO SUBSTITUEM O `verifyPerfil`, e é a distinção que interessa: quem barra a
-- ESCRITA é o perfil do módulo `producao` em `dgeo.usuario_perfil`. Estas
-- tabelas dizem QUE TRABALHO a distribuição pode entregar a quem já está
-- autorizado a operar.
CREATE TABLE producao.habilitacao(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE producao.habilitacao IS
    'Grupo de trabalho da distribuição (era perfil_producao no SAP). NÃO é autorização: quem barra escrita é dgeo.usuario_perfil pelo verifyPerfil.';

-- QUE TIPO DE ETAPA DE QUE SUBFASE esta habilitação recebe, e com que
-- prioridade. É o que faz um restituidor receber Execução de restituição e um
-- revisor receber a Revisão da mesma subfase.
CREATE TABLE producao.habilitacao_etapa(
  id SERIAL NOT NULL PRIMARY KEY,
  habilitacao_id INTEGER NOT NULL REFERENCES producao.habilitacao (id),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  tipo_etapa_id SMALLINT NOT NULL REFERENCES dominio.tipo_etapa (code),
  prioridade INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (habilitacao_id, subfase_id, tipo_etapa_id)
);

COMMENT ON TABLE producao.habilitacao_etapa IS
    'Que tipo de etapa de que subfase uma habilitação recebe, e com que prioridade.';

CREATE INDEX idx_habilitacao_etapa_subfase ON producao.habilitacao_etapa (subfase_id);
CREATE INDEX idx_habilitacao_etapa_tipo ON producao.habilitacao_etapa (tipo_etapa_id);

-- UMA HABILITAÇÃO POR PESSOA, e o UNIQUE em `usuario_uuid` é quem cobra. Uma
-- pessoa em dois grupos receberia trabalho por dois caminhos com prioridades
-- diferentes, e a distribuição não teria como desempatar.
CREATE TABLE producao.habilitacao_usuario(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  habilitacao_id INTEGER NOT NULL REFERENCES producao.habilitacao (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (usuario_uuid)
);

COMMENT ON TABLE producao.habilitacao_usuario IS
    'Quem pertence a qual habilitação. UMA por pessoa: em duas, a distribuição não teria como desempatar a prioridade.';

CREATE INDEX idx_habilitacao_usuario_habilitacao ON producao.habilitacao_usuario (habilitacao_id);

-- EM QUE BLOCOS A PESSOA TRABALHA. Sem UNIQUE de propósito: trabalhar em dois
-- blocos é o caso comum, e o SAP também não o tinha.
CREATE TABLE producao.habilitacao_bloco(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  bloco_id INTEGER NOT NULL REFERENCES producao.bloco (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE producao.habilitacao_bloco IS
    'Em que blocos a pessoa trabalha. Sem UNIQUE: dois blocos é o caso comum.';

CREATE INDEX idx_habilitacao_bloco_usuario ON producao.habilitacao_bloco (usuario_uuid);
CREATE INDEX idx_habilitacao_bloco_bloco ON producao.habilitacao_bloco (bloco_id);

-- QUE DIFICULDADE ENTREGAR A ESTA PESSOA, nesta subfase deste lote. É o que
-- permite mandar o trabalho difícil para quem tem prática e o fácil para quem
-- está aprendendo, sem tirar ninguém da fila.
CREATE TABLE producao.habilitacao_dificuldade(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  tipo_perfil_dificuldade_id SMALLINT NOT NULL REFERENCES dominio.tipo_perfil_dificuldade (code),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (usuario_uuid, subfase_id, lote_id)
);

COMMENT ON TABLE producao.habilitacao_dificuldade IS
    'Que dificuldade entregar a esta pessoa, nesta subfase deste lote.';

CREATE INDEX idx_habilitacao_dificuldade_subfase ON producao.habilitacao_dificuldade (subfase_id);
CREATE INDEX idx_habilitacao_dificuldade_lote ON producao.habilitacao_dificuldade (lote_id);
CREATE INDEX idx_habilitacao_dificuldade_tipo ON producao.habilitacao_dificuldade (tipo_perfil_dificuldade_id);

-- ---------------------------------------------------------------------------
-- A FILA PRIORITÁRIA: o furo de fila, declarado
-- ---------------------------------------------------------------------------
--
-- QUEM PEDE A PRÓXIMA ATIVIDADE RECEBE ESTA, e não a que a ordem natural daria.
-- Existe porque o gerente às vezes precisa que uma folha específica saia antes,
-- e a alternativa era mexer na prioridade da unidade de trabalho, que afeta
-- todo mundo.
--
-- TÊM AUDITORIA, ao contrário de `atividade`: o furo de fila é um ATO de quem
-- gerencia, e `usuario_uuid` aqui é o BENEFICIÁRIO, não o autor. Sem
-- `usuario_cadastramento_uuid` não haveria como responder quem furou a fila.
CREATE TABLE producao.fila_prioritaria(
  id SERIAL NOT NULL PRIMARY KEY,
  atividade_id INTEGER NOT NULL REFERENCES producao.atividade (id),
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  prioridade INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (atividade_id, usuario_uuid)
);

COMMENT ON TABLE producao.fila_prioritaria IS
    'Furo de fila para UMA pessoa. usuario_uuid é o beneficiário; quem furou está em usuario_cadastramento_uuid.';

CREATE INDEX idx_fila_prioritaria_usuario ON producao.fila_prioritaria (usuario_uuid);

-- O mesmo furo de fila, para um GRUPO inteiro.
CREATE TABLE producao.fila_prioritaria_grupo(
  id SERIAL NOT NULL PRIMARY KEY,
  atividade_id INTEGER NOT NULL REFERENCES producao.atividade (id),
  habilitacao_id INTEGER NOT NULL REFERENCES producao.habilitacao (id),
  prioridade INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (atividade_id, habilitacao_id)
);

COMMENT ON TABLE producao.fila_prioritaria_grupo IS
    'Furo de fila para uma habilitação inteira.';

CREATE INDEX idx_fila_prioritaria_grupo_habilitacao ON producao.fila_prioritaria_grupo (habilitacao_id);

-- ---------------------------------------------------------------------------
-- O QUE DEU ERRADO: problema e alteração de fluxo
-- ---------------------------------------------------------------------------
--
-- AS DUAS SÃO REGISTRO DE EXECUÇÃO e NÃO ganham as quatro colunas de auditoria
-- do SCA. Não é esquecimento: `usuario_uuid` e `data` já respondem quem e
-- quando, e são as colunas que a tela e o relatório leem. O par
-- `usuario_cadastramento_uuid`/`data_cadastramento` ao lado seria uma segunda
-- resposta para a mesma pergunta, e nada garantiria que as duas concordassem.
--
-- `tipo_problema_atividade_id` se chamava `tipo_problema_id` no SAP, e o domínio
-- se chamava `dominio.tipo_problema`. Ganhou o sufixo pelo mesmo motivo de
-- `tipo_situacao_atividade`: aqui o `dominio` serve sete módulos.
--
-- A GEOMETRIA É OBRIGATÓRIA nas duas, e é o que as torna úteis: "há um problema
-- nesta folha" não ajuda ninguém, e "há um problema NESTE polígono" manda o
-- revisor direto ao lugar.
CREATE TABLE producao.problema_atividade(
  id SERIAL NOT NULL PRIMARY KEY,
  atividade_id INTEGER NOT NULL REFERENCES producao.atividade (id),
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  tipo_problema_atividade_id SMALLINT NOT NULL REFERENCES dominio.tipo_problema_atividade (code),
  descricao TEXT NOT NULL,
  data TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolvido BOOLEAN NOT NULL DEFAULT FALSE,
  geom geometry(POLYGON, 4674) NOT NULL
);

COMMENT ON TABLE producao.problema_atividade IS
    'Problema apontado durante a execução, com o polígono de onde ele está. Sem auditoria própria: usuario_uuid e data já são o quem e o quando.';

CREATE INDEX idx_problema_atividade_atividade ON producao.problema_atividade (atividade_id);
CREATE INDEX idx_problema_atividade_usuario ON producao.problema_atividade (usuario_uuid);
CREATE INDEX idx_problema_atividade_tipo ON producao.problema_atividade (tipo_problema_atividade_id);
CREATE INDEX idx_problema_atividade_geom ON producao.problema_atividade USING gist (geom);

-- A ALTERAÇÃO DE FLUXO é o problema que exige refazer alguma coisa: ela não tem
-- tipo, porque o que ela guarda é a decisão de quem gerencia, escrita à mão.
CREATE TABLE producao.alteracao_fluxo(
  id SERIAL NOT NULL PRIMARY KEY,
  atividade_id INTEGER NOT NULL REFERENCES producao.atividade (id),
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  descricao TEXT NOT NULL,
  data TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolvido BOOLEAN NOT NULL DEFAULT FALSE,
  geom geometry(POLYGON, 4674) NOT NULL
);

COMMENT ON TABLE producao.alteracao_fluxo IS
    'Decisão de alterar o fluxo por causa de um problema, com o polígono da área afetada.';

CREATE INDEX idx_alteracao_fluxo_atividade ON producao.alteracao_fluxo (atividade_id);
CREATE INDEX idx_alteracao_fluxo_usuario ON producao.alteracao_fluxo (usuario_uuid);
CREATE INDEX idx_alteracao_fluxo_geom ON producao.alteracao_fluxo USING gist (geom);

-- O DIÁRIO DE MUDANÇAS DO FLUXO, em texto. Derivada de nada e apontando para
-- nada: é o que o gerente escreve quando muda a linha de produção no meio do
-- caminho, e o que a tela de acompanhamento mostra como histórico.
CREATE TABLE producao.relatorio_alteracao(
  id SERIAL NOT NULL PRIMARY KEY,
  data TIMESTAMP WITH TIME ZONE NOT NULL,
  descricao TEXT NOT NULL
);

COMMENT ON TABLE producao.relatorio_alteracao IS
    'Diário em texto das mudanças de fluxo. Sem auditoria própria: a data é a coluna dela.';

-- ---------------------------------------------------------------------------
-- O PERFIL DA SUBFASE NO LOTE: como o QGIS abre para este trabalho
-- ---------------------------------------------------------------------------
--
-- SÃO ONZE TABELAS COM A MESMA FORMA: (alguma coisa do schema `qgis`, subfase,
-- lote do acervo), única nos três. Elas respondem "quando alguém abrir a
-- subfase X do lote Y, carregue este menu, este tema, este estilo, estas regras,
-- estes modelos e estes atalhos".
--
-- O PREFIXO `perfil_` FICA, e aqui ele NÃO quer dizer autorização: é perfil de
-- CONFIGURAÇÃO, no sentido de "perfil do QGIS". A ambiguidade com
-- `dominio.tipo_perfil` foi resolvida do outro lado, renomeando o
-- `perfil_producao` do SAP para `producao.habilitacao`, que era onde ela doía:
-- lá se falava de PESSOAS. Aqui se fala de janela do QGIS, e o nome do SAP é o
-- que o SAP Gerente e o plugin já usam.
--
-- TODAS APONTAM O LOTE, e é a razão de existirem onze e não uma: a mesma subfase
-- é configurada diferente em lotes diferentes. É por isso também que o índice
-- por `lote_id` aparece em todas: apagar um lote varre as onze.
-- ---------------------------------------------------------------------------

-- O que o operador tem de confirmar à mão antes de finalizar. Texto puro, na
-- ordem em que aparece.
CREATE TABLE producao.perfil_requisito_finalizacao(
  id SERIAL NOT NULL PRIMARY KEY,
  descricao VARCHAR(255) NOT NULL,
  ordem INTEGER NOT NULL,
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (descricao, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_requisito_finalizacao IS
    'O que o operador confirma à mão antes de finalizar a atividade nesta subfase deste lote.';

CREATE INDEX idx_perfil_requisito_finalizacao_subfase ON producao.perfil_requisito_finalizacao (subfase_id);
CREATE INDEX idx_perfil_requisito_finalizacao_lote ON producao.perfil_requisito_finalizacao (lote_id);

-- As rotinas FME que rodam nesta subfase deste lote.
--
-- `requisito_finalizacao` TRUE faz a rotina BARRAR a finalização quando acusa
-- erro; FALSE a deixa informativa. `tipo_rotina_id` diz se ela aceita falso
-- positivo.
CREATE TABLE producao.perfil_fme(
  id SERIAL NOT NULL PRIMARY KEY,
  gerenciador_fme_id INTEGER NOT NULL REFERENCES qgis.gerenciador_fme (id),
  rotina VARCHAR(255) NOT NULL,
  requisito_finalizacao BOOLEAN NOT NULL DEFAULT TRUE,
  tipo_rotina_id SMALLINT NOT NULL REFERENCES dominio.tipo_rotina (code),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  ordem INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (gerenciador_fme_id, rotina, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_fme IS
    'Rotinas FME desta subfase neste lote. requisito_finalizacao TRUE barra a finalização quando a rotina acusa erro.';

CREATE INDEX idx_perfil_fme_subfase ON producao.perfil_fme (subfase_id);
CREATE INDEX idx_perfil_fme_lote ON producao.perfil_fme (lote_id);
CREATE INDEX idx_perfil_fme_tipo_rotina ON producao.perfil_fme (tipo_rotina_id);

-- Como as ferramentas do DSGTools nascem configuradas.
CREATE TABLE producao.perfil_configuracao_qgis(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_configuracao_id SMALLINT NOT NULL REFERENCES dominio.tipo_configuracao (code),
  parametros TEXT,
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (tipo_configuracao_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_configuracao_qgis IS
    'Como as ferramentas do DSGTools nascem configuradas nesta subfase deste lote.';

CREATE INDEX idx_perfil_configuracao_qgis_subfase ON producao.perfil_configuracao_qgis (subfase_id);
CREATE INDEX idx_perfil_configuracao_qgis_lote ON producao.perfil_configuracao_qgis (lote_id);

-- O grupo de estilos que as camadas recebem.
CREATE TABLE producao.perfil_estilo(
  id SERIAL NOT NULL PRIMARY KEY,
  grupo_estilo_id INTEGER NOT NULL REFERENCES qgis.group_styles (id),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (grupo_estilo_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_estilo IS
    'O grupo de estilos (qgis.group_styles) que as camadas recebem nesta subfase deste lote.';

CREATE INDEX idx_perfil_estilo_subfase ON producao.perfil_estilo (subfase_id);
CREATE INDEX idx_perfil_estilo_lote ON producao.perfil_estilo (lote_id);

-- As regras de atributo que o DSGTools cobra.
CREATE TABLE producao.perfil_regras(
  id SERIAL NOT NULL PRIMARY KEY,
  layer_rules_id INTEGER NOT NULL REFERENCES qgis.layer_rules (id),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (layer_rules_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_regras IS
    'As regras de atributo (qgis.layer_rules) cobradas nesta subfase deste lote.';

CREATE INDEX idx_perfil_regras_subfase ON producao.perfil_regras (subfase_id);
CREATE INDEX idx_perfil_regras_lote ON producao.perfil_regras (lote_id);

-- O menu customizado. `menu_revisao` marca o menu que só aparece nas etapas de
-- revisão, e é por isso que o mesmo lote pode ter dois menus para a mesma
-- subfase.
CREATE TABLE producao.perfil_menu(
  id SERIAL NOT NULL PRIMARY KEY,
  menu_id INTEGER NOT NULL REFERENCES qgis.qgis_menus (id),
  menu_revisao BOOLEAN NOT NULL DEFAULT FALSE,
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (menu_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_menu IS
    'O menu customizado do QGIS nesta subfase deste lote. menu_revisao marca o que só aparece nas etapas de revisão.';

CREATE INDEX idx_perfil_menu_subfase ON producao.perfil_menu (subfase_id);
CREATE INDEX idx_perfil_menu_lote ON producao.perfil_menu (lote_id);

-- O tema de camadas.
CREATE TABLE producao.perfil_tema(
  id SERIAL NOT NULL PRIMARY KEY,
  tema_id INTEGER NOT NULL REFERENCES qgis.qgis_themes (id),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (tema_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_tema IS
    'O tema de camadas (qgis.qgis_themes) desta subfase deste lote.';

CREATE INDEX idx_perfil_tema_subfase ON producao.perfil_tema (subfase_id);
CREATE INDEX idx_perfil_tema_lote ON producao.perfil_tema (lote_id);

-- Os modelos de processamento do QGIS, na ordem em que rodam.
CREATE TABLE producao.perfil_model_qgis(
  id SERIAL NOT NULL PRIMARY KEY,
  qgis_model_id INTEGER NOT NULL REFERENCES qgis.qgis_models (id),
  parametros TEXT,
  requisito_finalizacao BOOLEAN NOT NULL DEFAULT TRUE,
  tipo_rotina_id SMALLINT NOT NULL REFERENCES dominio.tipo_rotina (code),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  ordem INTEGER NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (qgis_model_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_model_qgis IS
    'Os modelos de processamento do QGIS desta subfase deste lote, na ordem em que rodam.';

CREATE INDEX idx_perfil_model_qgis_subfase ON producao.perfil_model_qgis (subfase_id);
CREATE INDEX idx_perfil_model_qgis_lote ON producao.perfil_model_qgis (lote_id);
CREATE INDEX idx_perfil_model_qgis_tipo_rotina ON producao.perfil_model_qgis (tipo_rotina_id);

-- QUANTO DA LINHAGEM O OPERADOR VÊ. É a única tabela deste bloco com UNIQUE
-- (subfase, lote) sem terceiro campo: a resposta é uma só por subfase de lote.
--
-- Ela existe porque mostrar quem executou a etapa anterior enviesa a revisão, e
-- esconder sempre impede o revisor de saber com quem falar. `dominio.tipo_exibicao`
-- é quem declara o meio-termo (só revisores veem).
CREATE TABLE producao.perfil_linhagem(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_exibicao_id SMALLINT NOT NULL REFERENCES dominio.tipo_exibicao (code),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_linhagem IS
    'Quanto da linhagem o operador vê nesta subfase deste lote. Mostrar sempre enviesa a revisão; esconder sempre impede o revisor de saber com quem falar.';

CREATE INDEX idx_perfil_linhagem_lote ON producao.perfil_linhagem (lote_id);
CREATE INDEX idx_perfil_linhagem_tipo_exibicao ON producao.perfil_linhagem (tipo_exibicao_id);

-- O workflow do DSGTools.
CREATE TABLE producao.perfil_workflow_dsgtools(
  id SERIAL NOT NULL PRIMARY KEY,
  workflow_dsgtools_id INTEGER NOT NULL REFERENCES qgis.workflow_dsgtools (id),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  requisito_finalizacao BOOLEAN NOT NULL DEFAULT TRUE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (workflow_dsgtools_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_workflow_dsgtools IS
    'O workflow do DSGTools desta subfase deste lote.';

CREATE INDEX idx_perfil_workflow_dsgtools_subfase ON producao.perfil_workflow_dsgtools (subfase_id);
CREATE INDEX idx_perfil_workflow_dsgtools_lote ON producao.perfil_workflow_dsgtools (lote_id);

-- O apelido dos campos das camadas.
CREATE TABLE producao.perfil_alias(
  id SERIAL NOT NULL PRIMARY KEY,
  alias_id INTEGER NOT NULL REFERENCES qgis.layer_alias (id),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (alias_id, subfase_id, lote_id)
);

COMMENT ON TABLE producao.perfil_alias IS
    'O apelido dos campos das camadas (qgis.layer_alias) nesta subfase deste lote.';

CREATE INDEX idx_perfil_alias_subfase ON producao.perfil_alias (subfase_id);
CREATE INDEX idx_perfil_alias_lote ON producao.perfil_alias (lote_id);

-- ---------------------------------------------------------------------------
-- O LOGIN TEMPORÁRIO no banco de produção
-- ---------------------------------------------------------------------------
--
-- ERA `dgeo.login_temporario` NO SAP, e mudou de schema porque não é gente: é
-- ACESSO AO BANCO DE PRODUÇÃO. Quando o dado de produção é PostGIS com controle
-- de permissões (`dominio.tipo_dado_producao` code 2), o SAP cria um papel
-- efêmero no banco de edição para aquela pessoa naquele banco, e é esse par que
-- fica aqui.
--
-- ESTA `senha` NÃO É A SENHA DA CONTA DO SCA, e a distinção não é detalhe. A
-- senha da pessoa vive em `dgeo.usuario.senha`, é hash bcrypt, o único lugar que
-- a gera e confere é `login/senha.js`, e nenhuma rota a devolve. A daqui é a
-- credencial de um papel do PostgreSQL criado e destruído pelo próprio SAP, que
-- ele precisa poder ENTREGAR ao cliente para o QGIS abrir a conexão de edição.
-- Ela nunca dá acesso ao SCA, e nunca é a mesma coisa.
--
-- NASCE VAZIA, e nenhum valor entra por arquivo versionado.
CREATE TABLE producao.login_temporario(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  configuracao VARCHAR(255) NOT NULL,
  login VARCHAR(255) NOT NULL,
  senha VARCHAR(255) NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (login, configuracao)
);

COMMENT ON TABLE producao.login_temporario IS
    'Credencial efêmera de acesso ao BANCO de produção. Não é a senha da conta do SCA, que é hash bcrypt em dgeo.usuario.senha.';

CREATE INDEX idx_login_temporario_usuario ON producao.login_temporario (usuario_uuid);

-- ---------------------------------------------------------------------------
-- AS TABELAS DERIVADAS, e os gatilhos que as mantêm
-- ---------------------------------------------------------------------------
--
-- AS DUAS SÃO CACHE ESPACIAL, e nenhuma tem porta de escrita: quem as preenche
-- são os gatilhos abaixo, a partir de `st_relate`. Abrir uma porta faz o cache
-- deixar de bater com a geometria no primeiro uso, exatamente como
-- `mapoteca.estoque_material` faz com o livro de movimento.
--
-- NENHUMA DAS DUAS TEM CHAVE ESTRANGEIRA, e é assim desde o SAP. Não é
-- descuido: são recalculadas por inteiro a cada mudança das pontas, e o gatilho
-- de DELETE de cada ponta limpa a sua parte ANTES de a linha sumir. Uma FK
-- obrigaria a ordenar as limpezas e não acrescentaria garantia nenhuma sobre
-- linha que o gatilho já apagou.
-- ---------------------------------------------------------------------------

-- QUE UNIDADE DE TRABALHO DEPENDE DE QUAL, por sobreposição de área dentro do
-- mesmo lote do acervo. `tipo_pre_requisito_id` vem da subfase, e diz se a
-- dependência é "estar concluída" ou "não estar em execução".
CREATE TABLE producao.relacionamento_ut(
  ut_id INTEGER NOT NULL,
  ut_re_id INTEGER NOT NULL,
  tipo_pre_requisito_id INTEGER NOT NULL,
  PRIMARY KEY (ut_id, ut_re_id)
);

COMMENT ON TABLE producao.relacionamento_ut IS
    'Cache espacial: que unidade de trabalho depende de qual, dentro do mesmo lote do acervo. Sem porta de escrita, sem FK: os gatilhos a mantêm.';

-- `ut_id` é a primeira coluna da chave primária e já tem índice por ela; o lado
-- `ut_re_id` precisa do seu, porque o gatilho de DELETE varre pelos dois.
CREATE INDEX idx_relacionamento_ut_re ON producao.relacionamento_ut (ut_re_id);

-- QUE VERSÃO DO ACERVO CADA UNIDADE DE TRABALHO PRODUZ.
--
-- SE CHAMAVA `relacionamento_produto` NO SAP, e a ponta mudou de tabela: lá ela
-- apontava `macrocontrole.produto`, que era um produto POR LOTE (a folha daquele
-- lote). Aqui o produto do acervo (`acervo.produto`) é a folha ETERNA, a mesma
-- em todas as edições dela, e o que uma corrida de produção entrega é uma
-- VERSÃO. Apontar `acervo.produto` faria a unidade de trabalho da edição de 2026
-- responder pela de 2019.
--
-- A GEOMETRIA VEM DO PRODUTO, e não da versão: `acervo.versao` não tem `geom`, e
-- não precisa ter, porque a área de uma edição é a área da folha. A função
-- abaixo faz o `JOIN` até lá para cruzar com `unidade_trabalho.geom`.
--
-- O SUBTIPO ENTRA NO CRUZAMENTO, E É OBRIGATÓRIO. No SAP bastava
-- `ut.lote_id = p.lote_id`, porque lá um lote era uma linha de produção só.
-- Aqui o lote é o do ACERVO e tem carta E CDGV na mesma área -- 61 dos 102
-- lotes com versão, medido em 2026-08-09 --, então a unidade de trabalho da
-- carta e a versão do CDGV ocupam o MESMO polígono do MESMO lote. Sem o filtro,
-- a UT da carta reivindica a versão do CDGV e a contagem de produção mente sem
-- levantar erro.
--
-- O SUBTIPO DA UT NÃO É COLUNA, e sai do caminho
-- `unidade_trabalho -> subfase -> fase -> linha_producao.subtipo_produto_id`,
-- comparado com `acervo.versao.subtipo_produto_id`. É a linha de produção que
-- declara o subtipo que fabrica, e é por isso que o caminho passa por ela.
--
-- NÃO REMOVA ESTE FILTRO quando os lotes do acervo forem separados por tipo de
-- produto (pendência do chefe, 2026-08-09, e o cabeçalho deste arquivo a
-- registra). Ali ele deixa de ser necessário e passa a ser guarda barata contra
-- o lote que voltar a misturar subtipos.
CREATE TABLE producao.relacionamento_versao(
  versao_id BIGINT NOT NULL,
  ut_id INTEGER NOT NULL,
  PRIMARY KEY (versao_id, ut_id)
);

COMMENT ON TABLE producao.relacionamento_versao IS
    'Cache espacial: que versão do acervo cada unidade de trabalho produz. Era relacionamento_produto no SAP, e a ponta virou acervo.versao.';

CREATE INDEX idx_relacionamento_versao_ut ON producao.relacionamento_versao (ut_id);

-- ---------------------------------------------------------------------------
-- `chk_subfase_lote_linha` SAIU, e a ausência é a decisão
-- ---------------------------------------------------------------------------
--
-- ELA COBRAVA QUE A SUBFASE E O LOTE FOSSEM DA MESMA LINHA DE PRODUÇÃO, com um
-- gatilho sobre `etapa` e outro sobre `unidade_trabalho` (os `chk_lote` e
-- `chk_lote_ut` do SAP, que aqui tinham virado uma função só porque os corpos
-- eram idênticos letra por letra).
--
-- SEM LINHA NO LOTE, NÃO HÁ O QUE COBRAR. A checagem lia a linha de produção do
-- LOTE e a comparava com a da subfase. No SAP o lote tinha
-- `linha_producao_id`; no desenho de 2026-08-09 quem tinha era a
-- `producao.lote_linha`. `acervo.lote` não tem, e não vai ter: é justamente o
-- fato de um lote atravessar linhas de produção que a decisão do chefe
-- reconheceu. Um lote com carta e CDGV tem etapas nas duas linhas, e a regra
-- antiga recusaria a segunda.
--
-- O QUE NÃO SE PERDEU: a etapa e a unidade de trabalho de uma MESMA atividade
-- continuam tendo de concordar em subfase e em lote, e quem cobra é
-- `producao.atividade_verifica_subfase`, logo abaixo. O que deixou de ser
-- cobrado é o lote concordar com a linha, que agora é uma pergunta sem sentido.
--
-- Ressuscitá-la é decisão, e decisão se registra em `docs/decisoes.md`.

-- A ATIVIDADE LIGA UMA ETAPA A UMA UNIDADE DE TRABALHO, e as duas já têm subfase
-- e lote. Se elas discordarem, a atividade estaria mandando executar a etapa de
-- um lote sobre a área de outro.
--
-- A LÓGICA FOI ENDIREITADA. No SAP a função perguntava "NÃO EXISTE linha em que
-- eles DIFIRAM? então aceite; senão recuse", com o RETURN dentro do IF e a
-- exceção no ELSE. Faz a mesma coisa que o teste direto abaixo, e obriga quem lê
-- a inverter duas negações para descobrir isso.
CREATE OR REPLACE FUNCTION producao.atividade_verifica_subfase() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM producao.etapa AS e
    INNER JOIN producao.unidade_trabalho AS ut ON ut.id = NEW.unidade_trabalho_id
    WHERE e.id = NEW.etapa_id
      AND (e.subfase_id <> ut.subfase_id OR e.lote_id <> ut.lote_id)
  ) THEN
    RAISE EXCEPTION 'A etapa % e a unidade de trabalho % não são da mesma subfase e do mesmo lote', NEW.etapa_id, NEW.unidade_trabalho_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.atividade_verifica_subfase() IS
    'Cobra que a etapa e a unidade de trabalho da atividade sejam da mesma subfase e do mesmo lote do acervo.';

CREATE TRIGGER chk_subfase_lote_consistency
  BEFORE INSERT OR UPDATE ON producao.atividade
  FOR EACH ROW EXECUTE PROCEDURE producao.atividade_verifica_subfase();

-- ---------------------------------------------------------------------------
-- `chk_scale` NÃO ATRAVESSOU, e a ausência é decidida
-- ---------------------------------------------------------------------------
--
-- NO SAP ela era um gatilho sobre `macrocontrole.produto` que recusava produto
-- cujo `denominador_escala` diferisse do `denominador_escala` do lote dele. Ela
-- existia porque LÁ o produto tinha uma cópia da escala ao lado da do lote, e o
-- gatilho era o que impedia as duas cópias de divergirem.
--
-- AQUI NÃO HÁ AS DUAS CÓPIAS. O produto é `acervo.produto`, e a escala dele é
-- `tipo_escala_id` mais `denominador_escala_especial` (um domínio, e não um
-- inteiro solto); ele é a folha ETERNA, e não pertence a lote nenhum. Quem
-- pertence a lote é `acervo.versao`, que não tem escala: a escala da edição é a
-- escala da folha. Não sobrou par para comparar.
--
-- NADA SOBROU DELA, nem o CHECK. Entre 2026-08-09 e 2026-08-09 este bloco
-- terminava dizendo que o resto dela era o CHECK `lote_linha_escala_positiva`,
-- sobre o `denominador_escala` da `producao.lote_linha`. Aquela tabela e aquela
-- coluna saíram na mesma decisão do chefe: não há escala do lado da produção,
-- e por isso não há o que checar. A escala mora em
-- `acervo.produto.tipo_escala_id`, e é da FOLHA.
--
-- Ressuscitá-la como gatilho é decisão, e decisão se registra em
-- `docs/decisoes.md`.

-- ---------------------------------------------------------------------------
-- A manutenção do cache espacial
-- ---------------------------------------------------------------------------
--
-- SÃO SETE ROTINAS, e a divisão entre elas é a do SAP: um par de funções que
-- faz o trabalho sobre um ARRAY de ids (e que o servidor pode chamar para
-- recalcular em massa depois de uma carga), e uma função de gatilho por tabela,
-- que só embrulha a linha em um array de um elemento.
--
-- MEXER NA UNIDADE DE TRABALHO REFAZ OS DOIS CACHES, porque a geometria dela é
-- ponta dos dois.
CREATE OR REPLACE FUNCTION producao.handle_relacionamento_ut_insert_update(ut_ids INTEGER[])
RETURNS VOID AS $$
BEGIN
  DELETE FROM producao.relacionamento_ut
  WHERE ut_id = ANY(ut_ids) OR ut_re_id = ANY(ut_ids);

  DELETE FROM producao.relacionamento_versao
  WHERE ut_id = ANY(ut_ids);

  INSERT INTO producao.relacionamento_ut (ut_id, ut_re_id, tipo_pre_requisito_id)
  SELECT ut.id AS ut_id, ut_re.id AS ut_re_id, prs.tipo_pre_requisito_id
  FROM producao.unidade_trabalho AS ut
  INNER JOIN producao.pre_requisito_subfase AS prs ON prs.subfase_posterior_id = ut.subfase_id
  INNER JOIN producao.unidade_trabalho AS ut_re
    ON ut_re.subfase_id = prs.subfase_anterior_id AND ut.lote_id = ut_re.lote_id
  WHERE (ut.id = ANY(ut_ids) OR ut_re.id = ANY(ut_ids))
    AND ut.id <> ut_re.id
    -- O `&&` usa o índice GiST e descarta o que nem se toca; o `st_relate` com a
    -- máscara '2********' é quem exige INTERIOR com INTERIOR em área, ou seja,
    -- sobreposição de verdade e não encostar de borda.
    AND ut.geom && ut_re.geom
    AND st_relate(ut.geom, ut_re.geom, '2********');

  INSERT INTO producao.relacionamento_versao (versao_id, ut_id)
  SELECT v.id AS versao_id, ut.id AS ut_id
  FROM acervo.versao AS v
  INNER JOIN acervo.produto AS p ON p.id = v.produto_id
  INNER JOIN producao.unidade_trabalho AS ut
    ON ut.lote_id = v.lote_id AND p.geom && ut.geom AND st_relate(p.geom, ut.geom, '2********')
  -- O FILTRO POR SUBTIPO É OBRIGATÓRIO, e é o que impede a unidade de trabalho
  -- da carta de reivindicar a versão do CDGV que ocupa o mesmo polígono do
  -- mesmo lote. O lote é o do ACERVO e atravessa linhas de produção; o subtipo
  -- da UT sai da linha da subfase dela, e é ele que tem de bater com o
  -- `subtipo_produto_id` da versão.
  INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
  INNER JOIN producao.fase AS f ON f.id = s.fase_id
  INNER JOIN producao.linha_producao AS lp
    ON lp.id = f.linha_producao_id AND lp.subtipo_produto_id = v.subtipo_produto_id
  WHERE ut.id = ANY(ut_ids);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.handle_relacionamento_ut_insert_update(INTEGER[]) IS
    'Refaz os dois caches espaciais para as unidades de trabalho informadas. Aceita array para o servidor recalcular em massa depois de uma carga.';

CREATE OR REPLACE FUNCTION producao.handle_relacionamento_ut_delete(ut_ids INTEGER[])
RETURNS VOID AS $$
BEGIN
  DELETE FROM producao.relacionamento_ut
  WHERE ut_id = ANY(ut_ids) OR ut_re_id = ANY(ut_ids);

  DELETE FROM producao.relacionamento_versao
  WHERE ut_id = ANY(ut_ids);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.handle_relacionamento_ut_delete(INTEGER[]) IS
    'Limpa os dois caches espaciais das unidades de trabalho informadas. É o que roda ANTES de a linha sumir, e é por isso que as tabelas de cache não têm FK.';

CREATE OR REPLACE FUNCTION producao.update_relacionamento_ut()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM producao.handle_relacionamento_ut_insert_update(ARRAY[NEW.id]);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM producao.handle_relacionamento_ut_delete(ARRAY[OLD.id]);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.update_relacionamento_ut() IS
    'Gatilho da unidade de trabalho: embrulha a linha num array e chama a função de massa.';

CREATE TRIGGER a_relacionamento_unidade_trabalho
  AFTER INSERT OR UPDATE OR DELETE ON producao.unidade_trabalho
  FOR EACH ROW EXECUTE PROCEDURE producao.update_relacionamento_ut();

-- MUDAR O PRÉ-REQUISITO ENTRE SUBFASES muda o cache de TODAS as unidades de
-- trabalho das duas subfases de uma vez, e por isso esta função não passa por
-- array de ids: ela apaga e reinsere o par de subfases inteiro.
--
-- ELA NÃO VOLTA A `pre_requisito_subfase`, E ISSO É O CONSERTO DE 2026-08-09.
-- A versão herdada do SAP 2.3.5 procurava o par de subfases rejuntando a própria
-- tabela que disparou o gatilho, e o gatilho é AFTER: no DELETE a linha já não
-- estava lá, e no UPDATE ela já tinha os valores NOVOS. A subconsulta devolvia
-- ZERO linhas e o `DELETE` não apagava nada. Apagar um pré-requisito deixava os
-- pares em `producao.relacionamento_ut` para sempre, `calcula_fila.sql` seguia
-- exigindo a subfase anterior concluída por uma regra que já não existia, e o
-- conserto só vinha chamando
-- `producao.handle_relacionamento_ut_insert_update()` à mão. Nada disso
-- levantava exceção: o cache simplesmente mentia.
--
-- OS DOIS RAMOS AGORA LEEM SÓ `OLD` E `NEW`, que existem nos três `TG_OP`, e a
-- função deixou de depender do que está visível na tabela. `AFTER` continua
-- certo justamente porque ela não pergunta mais nada a `pre_requisito_subfase`.
--
-- A LIMPEZA NÃO REPETE O TESTE DE GEOMETRIA, e a ausência é deliberada: o cache
-- tem de sair pelo PAR DE SUBFASES inteiro, e refiltrar por sobreposição
-- deixaria para trás a linha cuja unidade de trabalho mudou de polígono depois
-- de o par ter sido gravado. Apagar por esse par não alcança o cache de outro
-- pré-requisito porque `relacionamento_ut` tem `PRIMARY KEY (ut_id, ut_re_id)` e
-- `pre_requisito_subfase` tem `UNIQUE (subfase_anterior_id,
-- subfase_posterior_id)`: cada par de unidades de trabalho nasce de um par de
-- subfases só.
CREATE OR REPLACE FUNCTION producao.update_relacionamento_ut_prs()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    DELETE FROM producao.relacionamento_ut AS ru
    USING producao.unidade_trabalho AS ut,
          producao.unidade_trabalho AS ut_re
    WHERE ru.ut_id = ut.id
      AND ru.ut_re_id = ut_re.id
      AND ut.subfase_id = OLD.subfase_posterior_id
      AND ut_re.subfase_id = OLD.subfase_anterior_id
      AND ut.lote_id = ut_re.lote_id;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO producao.relacionamento_ut (ut_id, ut_re_id, tipo_pre_requisito_id)
    SELECT ut.id AS ut_id, ut_re.id AS ut_re_id, NEW.tipo_pre_requisito_id
    FROM producao.unidade_trabalho AS ut
    INNER JOIN producao.unidade_trabalho AS ut_re
      ON ut_re.subfase_id = NEW.subfase_anterior_id AND ut.lote_id = ut_re.lote_id
    WHERE ut.subfase_id = NEW.subfase_posterior_id
      AND ut.geom && ut_re.geom
      AND st_relate(ut.geom, ut_re.geom, '2********');

    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.update_relacionamento_ut_prs() IS
    'Gatilho do pré-requisito entre subfases: refaz o cache do par de subfases inteiro, e não de uma unidade de trabalho. Lê só OLD e NEW, e por isso a limpeza funciona no DELETE e no UPDATE.';

CREATE TRIGGER a_relacionamento_pre_requisito_subfase
  AFTER INSERT OR UPDATE OR DELETE ON producao.pre_requisito_subfase
  FOR EACH ROW EXECUTE PROCEDURE producao.update_relacionamento_ut_prs();

-- ---------------------------------------------------------------------------
-- O outro lado do cache: a versão do acervo
-- ---------------------------------------------------------------------------
--
-- O GATILHO FICA SOBRE `acervo.versao`, QUE É DE OUTRO MÓDULO, e a escolha
-- merece explicação. No SAP ele ficava sobre `macrocontrole.produto`, tabela do
-- próprio schema. Aqui a ponta é `acervo.versao`, e quem depende dela é a
-- produção: sem o gatilho, apagar uma versão deixaria linha órfã no cache, e
-- criar uma não a ligaria a unidade de trabalho nenhuma até alguém mexer na
-- geometria do outro lado.
--
-- QUEM DEPENDE CARREGA O GATILHO, e é por isso que ele é criado AQUI e não em
-- `er/acervo.sql`: aquele arquivo instala sozinho, sem saber que a produção
-- existe, e continua instalando. Este arquivo carrega depois dele e acrescenta o
-- que a produção precisa. Apagar o schema `producao` leva o gatilho junto.
--
-- O QUE ELE NÃO COBRE, e é uma lacuna conhecida: a geometria mora em
-- `acervo.produto`, e não na versão. Mudar o polígono de uma folha NÃO recalcula
-- o cache das versões dela. No SAP o problema não existia porque geometria e
-- lote eram colunas da MESMA linha que carregava o gatilho. Um segundo gatilho
-- sobre `acervo.produto` resolveria, e não foi posto: seria uma segunda
-- imposição da produção sobre uma tabela de outro módulo, por um evento que na
-- prática não acontece (a folha é recorte do mapa-índice, e não se redesenha).
-- Quem precisar recalcular chama
-- `producao.handle_relacionamento_versao_insert_update()` com as versões da
-- folha alterada.
CREATE OR REPLACE FUNCTION producao.handle_relacionamento_versao_insert_update(versao_ids BIGINT[])
RETURNS VOID AS $$
BEGIN
  DELETE FROM producao.relacionamento_versao
  WHERE versao_id = ANY(versao_ids);

  -- O MESMO FILTRO DE SUBTIPO DA FUNÇÃO ACIMA, e pelo mesmo motivo: as duas
  -- alimentam a mesma tabela, por pontas opostas, e uma que filtrasse e outra
  -- que não faria o cache depender de qual lado foi mexido por último.
  INSERT INTO producao.relacionamento_versao (versao_id, ut_id)
  SELECT v.id AS versao_id, ut.id AS ut_id
  FROM acervo.versao AS v
  INNER JOIN acervo.produto AS p ON p.id = v.produto_id
  INNER JOIN producao.unidade_trabalho AS ut
    ON ut.lote_id = v.lote_id AND p.geom && ut.geom AND st_relate(p.geom, ut.geom, '2********')
  INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
  INNER JOIN producao.fase AS f ON f.id = s.fase_id
  INNER JOIN producao.linha_producao AS lp
    ON lp.id = f.linha_producao_id AND lp.subtipo_produto_id = v.subtipo_produto_id
  WHERE v.id = ANY(versao_ids);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.handle_relacionamento_versao_insert_update(BIGINT[]) IS
    'Refaz o cache versão/unidade de trabalho para as versões informadas. É o que se chama à mão quando a geometria da folha muda.';

CREATE OR REPLACE FUNCTION producao.handle_relacionamento_versao_delete(versao_ids BIGINT[])
RETURNS VOID AS $$
BEGIN
  DELETE FROM producao.relacionamento_versao
  WHERE versao_id = ANY(versao_ids);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.handle_relacionamento_versao_delete(BIGINT[]) IS
    'Limpa o cache versão/unidade de trabalho das versões informadas.';

CREATE OR REPLACE FUNCTION producao.update_relacionamento_versao()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    PERFORM producao.handle_relacionamento_versao_insert_update(ARRAY[NEW.id]);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM producao.handle_relacionamento_versao_delete(ARRAY[OLD.id]);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.update_relacionamento_versao() IS
    'Gatilho de acervo.versao mantido pela produção. Vive aqui, e não em er/acervo.sql, porque quem depende do cache é quem carrega o gatilho.';

CREATE TRIGGER a_relacionamento_versao
  AFTER INSERT OR UPDATE OR DELETE ON acervo.versao
  FOR EACH ROW EXECUTE PROCEDURE producao.update_relacionamento_versao();

-- ---------------------------------------------------------------------------
-- Os gatilhos de status: não se encerra o pai com o filho andando
-- ---------------------------------------------------------------------------
--
-- SÃO TRÊS, e eram três no SAP. A escada era projeto -> lote -> bloco lá, e é
-- `acervo.projeto` -> `acervo.lote` -> `producao.bloco` aqui: os mesmos três
-- degraus, com o lote sendo o do ACERVO. O degrau intermediário que a
-- `producao.lote_linha` teria acrescentado não existe mais, e com ele sumiu a
-- explicação de por que ele ficava sem gatilho.
--
-- DOIS DELES MORAM SOBRE `acervo.lote` E `acervo.projeto`, e é a mesma regra do
-- gatilho de `acervo.versao` mais acima: quem depende da consistência é a
-- produção, e é ela que carrega o gatilho. `er/acervo.sql` continua instalando
-- sozinho, sem saber que a produção existe.
--
-- OS CÓDIGOS MUDARAM DE DOMÍNIO. No SAP, `dominio.status` tinha três valores e
-- "em andamento" era exatamente `status_id = 1`. Aqui é
-- `dominio.tipo_status_execucao`, com cinco: 1 Não iniciado, 2 Em execução, 3
-- Concluído, 4 Concluído parcialmente e 5 Pausado. "Encerrado" passou a ser
-- `IN (3, 4)` e "em andamento" a ser `NOT IN (3, 4)`. Um Pausado NÃO é
-- encerrado: pausar é justamente dizer que o trabalho volta.
--
-- ELE SÓ OLHA A TRANSIÇÃO, e nunca o estado, pela mesma razão de
-- `chk_projeto_status` lá embaixo: cobrar de `NEW` sozinho CONGELARIA o lote
-- que já nasceu fora da regra, e um `UPDATE` que só mexesse no nome dele
-- releria o status encerrado, encontraria bloco aberto e recusaria para sempre.
-- O lote do acervo tem vida própria fora da produção -- ele existe para versões
-- carregadas de fora, para registro histórico e para o que a Divisão recebeu
-- pronto --, e um lote assim não tem bloco nenhum: `EXISTS` sobre zero blocos é
-- falso, e encerrá-lo continua livre.
CREATE OR REPLACE FUNCTION producao.chk_lote_status() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status_execucao_id IN (3, 4)
     AND (TG_OP = 'INSERT' OR OLD.status_execucao_id IS DISTINCT FROM NEW.status_execucao_id)
  THEN
    IF EXISTS (
      SELECT 1
      FROM producao.bloco
      WHERE lote_id = NEW.id
        AND status_execucao_id NOT IN (3, 4)
    ) THEN
      RAISE EXCEPTION 'Não é possível encerrar o lote enquanto houver bloco em andamento';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.chk_lote_status() IS
    'Recusa encerrar o lote do acervo enquanto algum bloco de produção dele não estiver Concluído ou Concluído parcialmente. É a produção que traz a regra consigo.';

CREATE TRIGGER chk_lote_status_consistency
  BEFORE INSERT OR UPDATE ON acervo.lote
  FOR EACH ROW EXECUTE PROCEDURE producao.chk_lote_status();

-- O ESPELHO DO ANTERIOR, pelo lado do bloco: bloco de lote encerrado não muda de
-- status e não nasce em andamento. Sem ele, encerrar o lote com todos os blocos
-- prontos e abrir um bloco novo depois seria trabalho fora de qualquer lote
-- aberto.
--
-- É AQUI QUE O `status_execucao_id` DA `lote_linha` FOI PARAR: a pergunta é a
-- mesma, e quem a responde passou a ser `acervo.lote.status_execucao_id`, que
-- já existia e aponta o mesmo domínio.
--
-- ELE SÓ OLHA A TRANSIÇÃO, e a guarda entrou em 2026-08-09, pela MESMA razão de
-- `chk_lote_status` acima e de `chk_projeto_status` abaixo. Sem ela, a função
-- cobrava do ESTADO e CONGELAVA a linha: um `UPDATE producao.bloco SET nome =
-- ...` ou `SET prioridade = ...` num bloco de lote encerrado relia o lote,
-- encontrava-o encerrado e recusava, com a mensagem "não é possível alterar o
-- status" -- que nem descrevia o que a pessoa tinha tentado fazer. Renomear ou
-- repriorizar um bloco de lote encerrado passou a ser possível, e é o que se
-- espera: o que a regra proíbe é MEXER NO STATUS, e não editar o bloco.
--
-- NO `INSERT` A GUARDA É SEMPRE VERDADEIRA, e por isso nascer dentro de lote
-- encerrado continua recusado exatamente como antes. O que mudou é só o
-- `UPDATE` que não toca em `status_execucao_id`.
CREATE OR REPLACE FUNCTION producao.chk_bloco_status() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR OLD.status_execucao_id IS DISTINCT FROM NEW.status_execucao_id)
     AND EXISTS (
       SELECT 1
       FROM acervo.lote
       WHERE id = NEW.lote_id
         AND status_execucao_id IN (3, 4)
     )
  THEN
    IF NEW.status_execucao_id NOT IN (3, 4) THEN
      RAISE EXCEPTION 'Não é possível criar ou reabrir bloco em andamento num lote já encerrado';
    ELSE
      RAISE EXCEPTION 'Não é possível alterar o status de bloco de lote já encerrado';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.chk_bloco_status() IS
    'Recusa criar, reabrir ou mudar o status de bloco cujo lote do acervo já está encerrado. Só olha a transição: editar nome ou prioridade do bloco continua livre.';

CREATE TRIGGER chk_bloco_status_consistency
  BEFORE INSERT OR UPDATE ON producao.bloco
  FOR EACH ROW EXECUTE PROCEDURE producao.chk_bloco_status();

-- O DEGRAU DE CIMA, e o único que cai inteiro dentro do `acervo`: projeto não se
-- encerra com lote andando.
--
-- É O `chk_projeto_status` DO SAP, e a regra é a mesma; o que mudou é que as
-- duas tabelas dela agora são `acervo.projeto` e `acervo.lote`. Ele é criado
-- AQUI pela mesma razão do gatilho de `acervo.versao`: `er/acervo.sql` instala
-- sozinho e continua instalando, e é a produção que traz a regra consigo. Quem
-- discordar de a produção impor isso ao acervo apaga UM gatilho, e o resto do
-- schema não se mexe.
--
-- ELE SÓ OLHA A TRANSIÇÃO, e nunca o estado. Cobrar de `NEW` sozinho CONGELA a
-- linha que já nasceu fora da regra: um `UPDATE` que só mexe no nome relê o
-- status encerrado, encontra lote aberto e recusa, e o projeto passa a não poder
-- ser editado nunca mais.
--
-- NÃO É HIPÓTESE. Medido no dump de produção de 2026-08-08: o projeto 12,
-- "Mapeamento de Interesse da Força 2026", está Concluído com CINCO lotes ainda
-- Não iniciados. Ele é 1 de 18 projetos, e a regra que o SAP aplica ao lote dele
-- nunca foi a do acervo -- por isso a linha existe. Com a guarda de transição,
-- encerrar de novo continua sendo recusado e editar continua possível.
CREATE OR REPLACE FUNCTION producao.chk_projeto_status() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status_execucao_id IN (3, 4)
     AND (TG_OP = 'INSERT' OR OLD.status_execucao_id IS DISTINCT FROM NEW.status_execucao_id)
  THEN
    IF EXISTS (
      SELECT 1
      FROM acervo.lote
      WHERE projeto_id = NEW.id
        AND status_execucao_id NOT IN (3, 4)
    ) THEN
      RAISE EXCEPTION 'Não é possível encerrar o projeto enquanto houver lote em andamento';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION producao.chk_projeto_status() IS
    'Recusa encerrar o projeto do acervo enquanto algum lote dele não estiver encerrado. É a regra do SAP, e a produção a traz consigo.';

CREATE TRIGGER chk_projeto_status_consistency
  BEFORE INSERT OR UPDATE ON acervo.projeto
  FOR EACH ROW EXECUTE PROCEDURE producao.chk_projeto_status();

COMMIT;
