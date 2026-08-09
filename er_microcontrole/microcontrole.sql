BEGIN;

-- ---------------------------------------------------------------------------
-- O BANCO DA TELEMETRIA. É OUTRO BANCO, e não outro schema.
-- ---------------------------------------------------------------------------
--
-- ESTE ARQUIVO NÃO RODA NO BANCO DO SAP. Ele instala um banco PRÓPRIO, com
-- `public.versao` própria (`er_microcontrole/versao.sql`) e GRANTs próprios
-- (`er_microcontrole/permissao.sql`). Quem o cria é `node create_config.js`,
-- quando se responde que sim à pergunta do microcontrole, e o endereço dele vai
-- para as chaves `MICRO_DB_*` de `server/config.env`.
--
-- POR QUE OUTRO BANCO. As três tabelas abaixo recebem MILHARES DE LINHAS POR
-- TURNO E POR PESSOA: uma por lote de feições desenhadas e uma por quadro de
-- tela amostrado, em rajada, do plugin. Elas crescem numa ordem de grandeza que
-- não é a do banco de trabalho, onde a maior tabela é o acervo. Juntas ali,
-- elas fariam o dump diário, o VACUUM e o índice do banco de PRODUÇÃO
-- responderem pelo peso de um dado que ninguém edita e quase ninguém lê. É a
-- mesma separação do SAP 2.3.5, e ela atravessou intacta.
--
-- `atividade_id` E `usuario_uuid` NÃO TÊM CHAVE ESTRANGEIRA, E ISSO PARECE
-- DEFEITO. Não é: as duas coisas que eles apontam (`producao.atividade` e
-- `dgeo.usuario`) moram NO OUTRO BANCO, e o PostgreSQL não tem chave
-- estrangeira entre bancos. Não há `REFERENCES` a escrever aqui, e não existe
-- gatilho nem CHECK que substitua -- qualquer conferência exigiria abrir uma
-- conexão de saída de dentro do banco (dblink, postgres_fdw), que é justamente
-- o acoplamento que a separação existe para não ter.
--
-- O QUE ISSO CUSTA, MEDIDO: uma amostra pode citar uma atividade que foi
-- apagada, ou um UUID de conta que já não existe, e o banco aceita. Quem lê
-- trata: `microcontrole_ctrl.js` resolve os nomes no banco principal e, para o
-- que não achar, mostra "Operador não identificado" em vez de sumir com a
-- linha. Apagar telemetria órfã é decisão de quem opera, e não regra de schema:
-- a amostra é a prova de que o trabalho aconteceu, e ela vale mesmo depois de
-- o registro que a originou sair.
--
-- `usuario_uuid` É UUID, e no SAP 2.3.5 era `usuario_id INTEGER`. Aqui a
-- identidade da pessoa é o UUID de `dgeo.usuario`, que é o que atravessa as
-- rotas (`req.usuarioUuid`) e o que as tabelas do outro banco guardam. Como não
-- há chave estrangeira para cobrar coerência, o tipo é a única coisa que impede
-- gravar o identificador errado -- um INTEGER aceitaria em silêncio o id de
-- qualquer outra coisa.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA microcontrole;

COMMENT ON SCHEMA microcontrole IS
    'A telemetria que o plugin do QGIS captura enquanto a pessoa trabalha. O perfil que diz o que monitorar mora no OUTRO banco, no schema de mesmo nome.';

-- ---------------------------------------------------------------------------
-- As quatro operações que o plugin sabe contar
-- ---------------------------------------------------------------------------
--
-- OS NOMES FICAM EM INGLÊS, e é a única exceção da casa à regra do português.
-- Eles não são texto de interface: são os rótulos que o plugin já instalado em
-- cada máquina manda e compara, e traduzi-los aqui faria o número de operação
-- deixar de casar com o que a origem gravou, sem erro nenhum. A tela do SAP
-- traduz na leitura, que é onde a tradução pertence.
CREATE TABLE microcontrole.tipo_operacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO microcontrole.tipo_operacao (code, nome) VALUES
(1, 'INSERT'),
(2, 'DELETE'),
(3, 'UPDATE ATRIBUTE'),
(4, 'UPDATE GEOM');

COMMENT ON TABLE microcontrole.tipo_operacao IS
    'A operação que o plugin contou: 1 inserção, 2 exclusão, 3 alteração de atributo, 4 alteração de geometria. Os nomes são os do plugin, e não texto de tela.';

-- ---------------------------------------------------------------------------
-- O que foi desenhado
-- ---------------------------------------------------------------------------
--
-- UMA LINHA POR (camada, operação) DE CADA ENVIO, e não por feição: o plugin
-- agrupa antes de mandar, e `quantidade` é o tamanho do grupo. `comprimento` e
-- `vertices` só fazem sentido na inserção, e por isso nascem em 0 nas outras
-- três (o Joi da rota os exige só quando `tipo_operacao_id = 1`).
--
-- SEM COLUNAS DE AUDITORIA, e a ausência é a regra deste banco inteiro: a linha
-- É o registro do que aconteceu, com quem e quando dentro dela. Ninguém a
-- edita e ninguém a apaga pela rota -- não existe PUT nem DELETE de telemetria.
-- Uma trilha de `auditoria.evento` por amostra faria a auditoria crescer mais
-- rápido que o dado que ela descreve, e ela descreveria um INSERT que ninguém
-- jamais vai contestar.
CREATE TABLE microcontrole.monitoramento_feicao(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_operacao_id SMALLINT NOT NULL REFERENCES microcontrole.tipo_operacao (code),
  camada VARCHAR(255) NOT NULL,
  quantidade INTEGER NOT NULL,
  comprimento REAL NOT NULL,
  vertices INTEGER NOT NULL,
  data TIMESTAMP WITH TIME ZONE NOT NULL,
  -- SEM `REFERENCES`: `producao.atividade` e `dgeo.usuario` estão no OUTRO
  -- banco. Ver o cabeçalho, sob "não têm chave estrangeira".
  atividade_id INTEGER NOT NULL,
  usuario_uuid UUID NOT NULL
);

COMMENT ON TABLE microcontrole.monitoramento_feicao IS
    'Quantas feições foram criadas, apagadas e alteradas, por camada e por operação. Uma linha por grupo enviado pelo plugin, não por feição.';

-- A leitura agregada é sempre por JANELA DE TEMPO, e é o `data DESC` que a
-- serve. Os outros dois filtros (atividade e usuário) entram depois, sobre um
-- conjunto já recortado pelo período.
CREATE INDEX monitoramento_feicao_idx
    ON microcontrole.monitoramento_feicao USING btree (data DESC);

CREATE INDEX monitoramento_feicao_atividade_idx
    ON microcontrole.monitoramento_feicao (atividade_id);

CREATE INDEX monitoramento_feicao_usuario_idx
    ON microcontrole.monitoramento_feicao (usuario_uuid);

-- ---------------------------------------------------------------------------
-- Por onde o trabalho passou
-- ---------------------------------------------------------------------------
--
-- UMA AMOSTRA POR QUADRO DE TELA: a `geom` é o RETÂNGULO que estava visível no
-- QGIS naquele instante (a envelope da extensão, montada com `ST_MakeEnvelope`
-- na rota), e `zoom` é a escala em que se estava olhando. É esta tabela que
-- responde "a pessoa estava trabalhando ou a tela ficou parada", pela distância
-- entre amostras consecutivas.
--
-- 4326 E NÃO 4674, ao contrário de `producao.unidade_trabalho`. A extensão vem
-- do canvas do QGIS já em coordenadas geográficas WGS 84, que é o que o plugin
-- manda; converter aqui exigiria saber a projeção de edição de cada atividade,
-- que é dado do outro banco. É o SRID do SAP 2.3.5, e mudá-lo obrigaria a soltar
-- plugin novo no mesmo dia.
CREATE TABLE microcontrole.monitoramento_tela(
  id SERIAL NOT NULL PRIMARY KEY,
  data TIMESTAMP WITH TIME ZONE NOT NULL,
  zoom REAL NOT NULL,
  -- SEM `REFERENCES`, pelo mesmo motivo da tabela acima.
  atividade_id INTEGER NOT NULL,
  usuario_uuid UUID NOT NULL,
  geom geometry(POLYGON, 4326) NOT NULL
);

COMMENT ON TABLE microcontrole.monitoramento_tela IS
    'O retângulo visível na tela do QGIS a cada amostra, com o zoom e o instante. É daqui que sai o aproveitamento por dia.';

CREATE INDEX monitoramento_tela_geom
    ON microcontrole.monitoramento_tela USING gist (geom);

CREATE INDEX monitoramento_tela_idx
    ON microcontrole.monitoramento_tela USING btree (data DESC);

-- BRIN além do btree, e os dois de propósito: a tabela cresce sempre pelo fim
-- (o `data` de uma linha nova nunca é menor que o das anteriores), e o BRIN
-- responde à varredura de mês inteiro ocupando alguns blocos, onde o btree
-- ocuparia uma fração da tabela. O btree continua para a janela estreita.
CREATE INDEX monitoramento_tela_data_idx
    ON microcontrole.monitoramento_tela USING BRIN (data) WITH (pages_per_range = 128);

CREATE INDEX monitoramento_tela_atividade_id_idx
    ON microcontrole.monitoramento_tela (atividade_id);

CREATE INDEX monitoramento_tela_usuario_idx
    ON microcontrole.monitoramento_tela (usuario_uuid);

COMMIT;
