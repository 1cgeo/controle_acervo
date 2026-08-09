-- A ATIVIDADE DE CAMPO ATRAVESSA DO SAP, E A SUBSECAO 2.5 DEIXA DE SER DIGITADA.
--
-- O QUE HAVIA. Nada, no banco. O que a Divisao faz fora dela -- reambulacao, voo
-- de drone, ponto de controle, modelo 3D, panoramica 360 -- vivia no schema
-- `controle_campo` do SAP, e chegava ao RPCMTec por TRANSCRICAO: a subsecao 2.5
-- ("Atividades de campo") estava marcada `ORIGEM.DIGITADA`, com
-- `fonte: 'SAP'` escrito em `server/src/rpcmtec/rpcmtec_estrutura.js`. Todo mes
-- alguem lia a tela de la e digitava as linhas aqui.
--
-- POR QUE ELA NAO TINHA VINDO NA FUSAO DE 2026-08-08. A regra registrada em
-- `docs/decisoes.md` era "o criterio para trazer uma subsecao e nao depender de
-- `macrocontrole`", e `controle_campo` referenciava `macrocontrole.produto`. A
-- regra estava certa; o que estava errado era o TAMANHO que se supunha do
-- acoplamento. Medido no codigo do SAP: o que aponta `macrocontrole` e UMA
-- tabela de juncao (`relacionamento_campo_produto`) e UMA rota de apoio
-- (`GET /produtos/:lote_id`). O nucleo -- `campo`, `imagem`, `track`,
-- `track_p` -- nao o toca em lugar nenhum.
--
-- O QUE FOI MEDIDO, no dump de producao do SAP de 2026-08-08:
--
--   * 54 campos, de 2013 a 2026. 51 Finalizado, 1 Previsto, 1 Em Execucao,
--     1 Cancelado.
--   * 143 imagens: 137 fotos somando 35 MB e 6 videos somando 144 MB, com um
--     video de 37 MB. 40 dos 54 campos tem imagem. 133 das 143 estao com
--     `mime_type` NULO.
--   * 76 tracks e 491.325 pontos de GPS (97 MB), mas so 12 dos 54 campos tem
--     trajeto.
--   * 20 vinculos com produto, concentrados em 3 campos (Bage 2025, Arandu 2026
--     e Santiago 2026).
--   * `orgao` era '1o CGEO' em 54 linhas de 54.
--   * 145 nomes distintos na coluna de texto `militares`.
--   * 7 campos sem geometria, e sao TODOS os voos de drone de 2026.
--
-- O QUE MUDA. Esta migracao cria o schema `campo` inteiro, identico ao que
-- `er/campo.sql` produz numa instalacao nova. Ela NAO carrega dado nenhum: a
-- travessia dos 54 campos e do `scripts/carregar_campo_sap.py`, que roda depois
-- e por ato explicito.
--
-- ELA TAMBEM NAO CRIA MODULO NOVO. `dominio.modulo` continua com seis linhas. A
-- tela de campo mora na secao PIT e cobra `verifyPerfil(nivel, 'producao')`,
-- que e o modulo code 4, ja existente. Foi decisao do chefe em 2026-08-08:
-- campo e o trabalho que o PIT promete, e nao uma area propria a conceder.
--
-- AS QUATRO ESCOLHAS DO SCHEMA QUE PARECEM DEFEITO estao comentadas em
-- `er/campo.sql`, ao lado do objeto. Em resumo:
--
--   1. `campo.ano` REFERENCIA `pit.exercicio`, e isso contraria o precedente ao
--      lado. `rpcmtec.capacitacao.ano` e um SMALLINT SOLTO, e o comentario dela
--      diz por que: capacitacao tem 2013, 2018, 2019 e mais, e o PIT so tem
--      2025 e 2026. Campo esta no mesmo caso de fato, e a decisao do chefe em
--      2026-08-08 foi a saida OPOSTA -- criar os exercicios que faltam, em vez
--      de deixar o ano ser um numero digitado que so por acaso coincide com o
--      plano. Quem os cria e a CARGA, e nao esta migracao: um banco que nunca
--      vai receber dado do SAP nao ganha doze exercicios inventados.
--      A consequencia pratica: sem os exercicios de 2013 a 2024, a carga e
--      recusada pela chave estrangeira. E o comportamento desejado.
--   2. `campo.geom` e NOT NULL. Os 7 campos sem geometria do dump nao entram
--      ate alguem desenhar o poligono. A carga PARA e cobra, e nao inventa um
--      ponto no meio do municipio.
--   3. `campo_versao` aponta `acervo.versao` (a EDICAO), e nao `acervo.produto`.
--      E e OPCIONAL: viagem internacional, exercicio e apoio a outra OM nao
--      geram produto a apontar, e exigir um obrigaria a inventar folha para 51
--      dos 54 campos.
--   4. `campo.militares_externos` e TEXTO ao lado da juncao `campo_militar`.
--      Nao e preguica: dos 145 nomes distintos do dump, 37 casam com
--      `dgeo.usuario` por posto mais nome de guerra e 59 casam so pelo nome de
--      guerra. `militares` guardava a patente DA EPOCA ('ST Ferraz' hoje era
--      '1o Sgt Ferraz' antes) e treze anos de campo incluem muita gente que ja
--      saiu. Sem a coluna de texto, o efetivo dos campos antigos se perderia em
--      silencio e a 2.5 de um mes de 2019 sairia com menos gente do que foi.
--
-- O QUE ISSO CUSTA.
--
--   1. ATE 283 MB NO BANCO, quando a carga rodar: 179 MB de foto e video e
--      97 MB de ponto de GPS. Os bytes ficam em `bytea`, que e o que
--      `orcamento`, `mapoteca`, `pit` e `rpcmtec` ja fazem com anexo -- o que
--      nao tem precedente aqui e o tamanho. Backup e restore ficam mais lentos
--      na mesma proporcao.
--   2. DUAS COPIAS VIVAS, enquanto o SAP nao desligar a tela de la. E a mesma
--      condicao da fusao de 2026-08-08: "a fusao e por ADICAO aqui, e nao por
--      remocao la", e o banco nao reconcilia as duas. Divergencia e possivel e
--      esperada.
--   3. A 2.5 PASSA A SER CALCULADA, e o numero dela deixa de poder ser corrigido
--      a mao no relatorio. Edicao FECHADA antes desta migracao continua sendo o
--      que foi: `rpcmtec.subsecao` grava a origem em cada linha, exatamente para
--      que uma subsecao possa GRADUAR sem reescrever o passado.
--
-- OS NOMES DE RESTRICAO SAO OS MESMOS DO `er/`, e isso nao e estetica. O
-- `migrations/ensaiar_migracao.cjs` monta dois bancos, um pelo caminho de
-- ATUALIZACAO e outro pela INSTALACAO NOVA, e compara coluna, restricao,
-- indice, view, funcao, gatilho e codigo de dominio. Nome de restricao
-- divergente e como um `DROP CONSTRAINT` passa a funcionar num banco e falhar
-- no outro.
--
-- Para ensaiar antes de aplicar (o `--er-de` aponta para a revisao ANTERIOR a
-- este commit, que e onde `er/` ainda nao tem o schema `campo`):
--
--   node migrations/ensaiar_migracao.cjs --er-de HEAD~1 \
--     --migracao migrations/2026-08-08_campo.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS campo;

COMMENT ON SCHEMA campo IS
    'Atividade de campo da Divisão: onde foi, quando, para quê, com quem e com qual viatura. É a fonte da subseção 2.5 do RPCMTec.';

CREATE TABLE IF NOT EXISTS campo.situacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO campo.situacao (code, nome) VALUES
(1, 'Previsto'),
(2, 'Em execução'),
(3, 'Finalizado'),
(4, 'Cancelado')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS campo.categoria(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO campo.categoria (code, nome) VALUES
(1, 'Reambulação'),
(2, 'Modelos 3D'),
(3, 'Imagens Panorâmicas em 360º'),
(4, 'Pontos de Controle'),
(5, 'Ortoimagens de Drone')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS campo.campo(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT,
  ano SMALLINT NOT NULL REFERENCES pit.exercicio (ano),
  situacao_id SMALLINT NOT NULL REFERENCES campo.situacao (code),
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  placas_vtr VARCHAR(255),
  militares_externos TEXT,
  geom geometry(MULTIPOLYGON, 4674) NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT campo_fim_apos_inicio CHECK (data_fim >= data_inicio)
);

COMMENT ON TABLE campo.campo IS
    'Atividade de campo. O ano aponta o exercício do PIT de verdade, e a geometria é obrigatória: campo sem onde não responde a pergunta que a tela de mapa faz.';

CREATE INDEX IF NOT EXISTS idx_campo_ano ON campo.campo (ano);
CREATE INDEX IF NOT EXISTS idx_campo_situacao ON campo.campo (situacao_id);
CREATE INDEX IF NOT EXISTS idx_campo_data_inicio ON campo.campo (data_inicio);
CREATE INDEX IF NOT EXISTS idx_campo_geom ON campo.campo USING gist (geom);

CREATE TABLE IF NOT EXISTS campo.campo_categoria(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  categoria_id SMALLINT NOT NULL REFERENCES campo.categoria (code),
  UNIQUE (campo_id, categoria_id)
);

COMMENT ON TABLE campo.campo_categoria IS
    'Para que o campo serviu. Mais de uma por campo é o caso comum, não a exceção.';

CREATE INDEX IF NOT EXISTS idx_campo_categoria_campo ON campo.campo_categoria (campo_id);

CREATE TABLE IF NOT EXISTS campo.campo_militar(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  UNIQUE (campo_id, usuario_uuid)
);

COMMENT ON TABLE campo.campo_militar IS
    'Quem da Divisão foi a campo. Quem não tem conta aqui fica em campo.militares_externos.';

CREATE INDEX IF NOT EXISTS idx_campo_militar_usuario ON campo.campo_militar (usuario_uuid);

CREATE TABLE IF NOT EXISTS campo.campo_versao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  versao_id BIGINT NOT NULL REFERENCES acervo.versao (id),
  UNIQUE (campo_id, versao_id)
);

COMMENT ON TABLE campo.campo_versao IS
    'Versão do acervo que este campo atendeu. OPCIONAL: viagem internacional e exercício não geram produto.';

CREATE INDEX IF NOT EXISTS idx_campo_versao_versao ON campo.campo_versao (versao_id);

CREATE TABLE IF NOT EXISTS campo.imagem(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  descricao TEXT,
  data_imagem DATE,
  tipo VARCHAR(10) NOT NULL DEFAULT 'foto' CHECK (tipo IN ('foto', 'video')),
  mime_type VARCHAR(100),
  conteudo BYTEA NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE campo.imagem IS
    'Foto ou vídeo do campo. Os bytes ficam aqui, como todo anexo do SCA, e nunca saem numa listagem.';

CREATE INDEX IF NOT EXISTS idx_imagem_campo ON campo.imagem (campo_id);

CREATE TABLE IF NOT EXISTS campo.track(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  chefe_vtr VARCHAR(255) NOT NULL,
  motorista VARCHAR(255) NOT NULL,
  placa_vtr VARCHAR(255) NOT NULL,
  dia DATE NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE campo.track IS
    'Um dia de uma viatura em campo. A linha do trajeto não se guarda: ela se costura dos pontos.';

CREATE INDEX IF NOT EXISTS idx_track_campo ON campo.track (campo_id);

CREATE TABLE IF NOT EXISTS campo.track_ponto(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  track_id BIGINT NOT NULL REFERENCES campo.track (id) ON DELETE CASCADE,
  geom geometry(POINT, 4674) NOT NULL,
  elevacao REAL,
  momento TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE campo.track_ponto IS
    'Ponto do GPS. A ordem do trajeto vem de momento, e não de uma coluna de sequência.';

CREATE INDEX IF NOT EXISTS idx_track_ponto_track ON campo.track_ponto (track_id);
CREATE INDEX IF NOT EXISTS idx_track_ponto_geom ON campo.track_ponto USING gist (geom);

CREATE OR REPLACE VIEW campo.track_linha AS
SELECT
  p.track_id,
  min(p.momento) AS momento_inicio,
  max(p.momento) AS momento_fim,
  count(*) AS pontos,
  ST_MakeLine(
    ST_SetSRID(
      ST_MakePointM(ST_X(p.geom), ST_Y(p.geom), extract(epoch FROM p.momento)),
      4674
    ) ORDER BY p.momento
  )::geometry(LineStringM, 4674) AS geom
FROM campo.track_ponto p
WHERE p.momento IS NOT NULL
GROUP BY p.track_id
HAVING count(*) > 1;

COMMENT ON VIEW campo.track_linha IS
    'O trajeto costurado dos pontos, na leitura. View comum e não materializada: linha velha mente sem avisar.';

-- As permissoes do schema novo. Numa instalacao nova quem faz isto e
-- `er/permissao.sql`, que roda depois de todo o `er/`; numa atualizacao o
-- schema nasce aqui, depois daquele arquivo ja ter rodado, e sem estas linhas o
-- usuario da aplicacao ve o schema e nao alcanca uma tabela sequer.
--
-- O `current_user` e o dono da conexao que aplica a migracao, que e o
-- DB_USER do servico -- o mesmo papel que `er/permissao.sql` recebe por
-- parametro numa instalacao nova.
DO $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA campo TO %I', current_user);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA campo TO %I', current_user);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA campo TO %I', current_user);
END $$;

UPDATE public.versao SET nome = '1.49.0' WHERE code = 1;

COMMIT;

-- PARA DESFAZER:
--
--   BEGIN;
--   DROP SCHEMA IF EXISTS campo CASCADE;
--   UPDATE public.versao SET nome = '1.48.0' WHERE code = 1;
--   COMMIT;
--
-- O `DROP SCHEMA ... CASCADE` LEVA TUDO JUNTO: os campos cadastrados, as fotos,
-- os videos, os tracks e os pontos de GPS. Se a carga do SAP ja tiver rodado,
-- os bytes das 143 imagens so existem aqui e no dump de origem -- exporte antes,
-- ou tenha o dump a mao.
--
-- O QUE O DESFAZER NAO DESFAZ: os exercicios de 2013 a 2024 que a carga criou
-- em `pit.exercicio`. Eles ficam, Encerrados e vazios. Apaga-los e ato separado,
-- e so e seguro se nada mais tiver passado a apontar para eles:
--
--   DELETE FROM pit.exercicio WHERE ano BETWEEN 2013 AND 2024;
--
-- Este DELETE e recusado pela chave estrangeira se alguma meta, revisao ou
-- execucao do PIT tiver sido cadastrada nesses anos no meio tempo, e a recusa e
-- a protecao: nesse caso o exercicio deixou de ser um artefato da carga.
