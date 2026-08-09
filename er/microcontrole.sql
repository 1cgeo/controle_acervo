BEGIN;

-- ---------------------------------------------------------------------------
-- MICROCONTROLE: o que se MONITORA. A telemetria em si mora noutro banco.
-- ---------------------------------------------------------------------------
--
-- SÃO CINCO TABELAS EM DOIS BANCOS, e este arquivo cria só as DUAS do banco
-- principal. As outras três (`tipo_operacao`, `monitoramento_feicao` e
-- `monitoramento_tela`) estão em `er_microcontrole/`, que é a instalação de um
-- banco SEPARADO e não roda junto com esta: ver o cabeçalho de
-- `er_microcontrole/microcontrole.sql`.
--
-- A DIVISÃO NÃO É ARBITRÁRIA, e é ela que explica por que o schema tem o mesmo
-- nome nos dois lugares:
--
--   AQUI mora o PERFIL, que é cadastro: qual subfase de qual lote é monitorada
--   e de que jeito. São dezenas de linhas, escritas pelo gerente numa tela, e
--   elas apontam `producao.subfase` e `acervo.lote`, que só existem aqui.
--
--   LÁ mora a AMOSTRA, que é medição: uma linha por feição desenhada e uma por
--   quadro de tela, em rajada, do plugin. São milhares por turno e por pessoa,
--   e é justamente esse volume que as põe noutro banco -- ele cresce numa
--   ordem de grandeza que não é a do banco de trabalho, e um VACUUM dele não
--   tem por que travar o cadastro do resto do sistema.
--
-- NÃO EXISTE JUNÇÃO ENTRE OS DOIS BANCOS, e não é limitação a contornar: é o
-- preço da separação, pago de propósito. Quem cruza perfil com amostra é
-- JavaScript, em `server/src/microcontrole/microcontrole_ctrl.js`, que resolve
-- as atividades de um lote e os nomes dos operadores aqui e leva os
-- identificadores prontos para a consulta de lá.
--
-- O SERVIÇO SOBE COM O BANCO DA TELEMETRIA FORA DO AR. As cinco rotas que este
-- arquivo serve não tocam a segunda conexão; as seis de lá respondem 503. Ver
-- `server/src/database/db.js`.
--
-- POR QUE `tipo_monitoramento` NÃO FOI PARA `dominio`. A regra da casa manda
-- toda tabela de código para `dominio`, que é único na plataforma, e foi assim
-- que os 15 domínios do core de produção entraram na 3.0.0. Esta fica de fora
-- porque ela tem uma GÊMEA no outro banco (`microcontrole.tipo_operacao`), que
-- não tem como morar em `dominio` -- lá não existe `dominio` nenhum. Separar o
-- par, com um código em `dominio` e o outro num banco que ninguém enxerga
-- daqui, faria as duas metades do mesmo subsistema parecerem coisas sem
-- relação. As duas ficam onde o plugin as procura: no schema `microcontrole`
-- do banco em que cada uma vive.
--
-- CARREGA DEPOIS DE `er/producao.sql`: `perfil_monitoramento` aponta
-- `producao.subfase`. E depois de `er/acervo.sql` e de `er/dgeo.sql`, pelo lote
-- e pela autoria.
-- ---------------------------------------------------------------------------

CREATE SCHEMA microcontrole;

COMMENT ON SCHEMA microcontrole IS
    'O que se monitora do trabalho no QGIS: qual subfase de qual lote, e como. A telemetria capturada mora num banco separado, instalado por er_microcontrole/.';

-- ---------------------------------------------------------------------------
-- O que dá para monitorar
-- ---------------------------------------------------------------------------
--
-- DOIS CÓDIGOS, e eles não são níveis: são coisas diferentes que o plugin
-- captura. FEIÇÃO conta o que a pessoa desenhou, apagou e alterou, camada por
-- camada; TELA guarda por onde ela andou dentro da carta, em amostras de
-- tempo. Um lote pode ter os dois na mesma subfase, e é por isso que o UNIQUE
-- de `perfil_monitoramento` inclui o tipo.
--
-- SEMEADA, e os códigos são os do SAP 2.3.5, sem tradução: o plugin já
-- instalado em cada máquina lê o pacote da atividade e arma o que o número diz.
CREATE TABLE microcontrole.tipo_monitoramento(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO microcontrole.tipo_monitoramento (code, nome) VALUES
(1, 'Monitoramento de feição'),
(2, 'Monitoramento de tela');

COMMENT ON TABLE microcontrole.tipo_monitoramento IS
    'O que o plugin captura: 1 feição (o que foi desenhado) e 2 tela (por onde o trabalho passou). Não são níveis, e a mesma subfase pode ter os dois.';

-- ---------------------------------------------------------------------------
-- O perfil: qual subfase de qual lote é monitorada
-- ---------------------------------------------------------------------------
--
-- É ESTA TABELA QUE LIGA O PLUGIN. Sem linha aqui para a subfase e o lote da
-- atividade, o pacote de `GET /api/distribuicao/dados_producao` sai com
-- `monitoramento: []` e o plugin não grava nada -- não existe telemetria "por
-- padrão", e a ausência de linha é a resposta "não monitore".
--
-- O MOLDE É `producao.perfil_tema`, e de propósito: as onze tabelas de perfil
-- do core de produção são todas (alguma_coisa_id, subfase_id, lote_id) com as
-- quatro colunas de auditoria da casa, e é o que faz a cópia de configuração
-- entre lotes (`POST /api/producao/configuracao/lote/copiar`) tratar as doze
-- pela MESMA fábrica, sem caso especial para esta.
--
-- `lote_id` APONTA `acervo.lote`, e não um lote de produção: `producao.lote`
-- não existe neste banco. A `producao.lote_linha` do SAP foi removida em
-- 2026-08-09, antes de a migração do core ser aplicada em lugar nenhum, e o
-- lote da casa é um só. Por isso a coluna é BIGINT, e não INTEGER como no SAP.
--
-- AS COLUNAS DE AUDITORIA ENTRAM AQUI E NÃO ENTRAM NA TELEMETRIA, e a
-- assimetria é a mesma que separa os dois bancos: isto é CADASTRO (alguém
-- decidiu monitorar, num dia, e responde por isso), e lá é MEDIÇÃO (a linha é o
-- próprio registro do que aconteceu, e ninguém a edita). A trilha de
-- `auditoria.evento` cobre esta tabela pela rota, como cobre todo o resto.
CREATE TABLE microcontrole.perfil_monitoramento(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_monitoramento_id SMALLINT NOT NULL REFERENCES microcontrole.tipo_monitoramento (code),
  subfase_id INTEGER NOT NULL REFERENCES producao.subfase (id),
  lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (tipo_monitoramento_id, subfase_id, lote_id)
);

COMMENT ON TABLE microcontrole.perfil_monitoramento IS
    'Qual subfase de qual lote é monitorada, e como. Sem linha aqui o plugin não captura nada: não há telemetria por padrão.';

-- O UNIQUE começa pelo TIPO, então ele não serve de índice para a pergunta que
-- o pacote da atividade faz ("o que monitorar nesta subfase deste lote?").
-- Estes dois servem, e o de lote serve também ao DELETE de lote.
CREATE INDEX idx_perfil_monitoramento_subfase ON microcontrole.perfil_monitoramento (subfase_id);
CREATE INDEX idx_perfil_monitoramento_lote ON microcontrole.perfil_monitoramento (lote_id);

COMMIT;
