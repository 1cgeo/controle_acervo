BEGIN;

-- ---------------------------------------------------------------------------
-- Campo: a atividade que a Divisao executa FORA dela
-- ---------------------------------------------------------------------------
--
-- Reambulacao, voo de drone, levantamento de ponto de controle, modelo 3D e
-- panoramica 360. E o que a subsecao 2.5 do RPCMTec ("Atividades de campo")
-- pedia DIGITADO ate 2026-08-08, transcrito a mao do SAP para dentro do
-- relatorio: a partir daqui ela se calcula, e o numero do relatorio deixa de
-- poder divergir do cadastro sem nada acusar. E o mesmo movimento que tirou a
-- 2.2 e a 2.4 da digitacao em 2026-08-05, e a 3.x com o modulo `equipamento`.
--
-- VEIO DO SAP (`controle_campo`), e a travessia tem tres cortes deliberados,
-- todos medidos no dump de producao de 2026-08-08 (54 campos, 2013 a 2026):
--
--   1. `orgao` NAO veio. Era '1o CGEO' em 54 linhas de 54, uma coluna que so
--      sabia repetir de quem e o banco.
--   2. `relacionamento_campo_produto` apontava `macrocontrole.produto`, que nao
--      existe aqui. Virou `campo_versao`, apontando `acervo.versao`, e continua
--      OPCIONAL: dos 54 campos, 3 tinham vinculo (20 folhas ao todo), e viagem
--      internacional nao gera produto nenhum para apontar.
--   3. `militares` era UM texto com a lista inteira. Virou `campo_militar`,
--      espelhando `rpcmtec.capacitacao_militar`, que ja resolveu este mesmo
--      problema quando a capacitacao atravessou.
--
-- CARREGA DEPOIS DE `pit` E DE `acervo`: o ano aponta `pit.pit` e o
-- vinculo aponta `acervo.versao`. O PostGIS e declarado aqui porque toda a
-- geometria deste arquivo depende dele e a ordem de `create_config.js` nao
-- garante que outro ja o declarou (mesma convencao de `er/limites.sql`).
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA campo;

COMMENT ON SCHEMA campo IS
    'Atividade de campo da Divisão: onde foi, quando, para quê, com quem e com qual viatura. É a fonte da subseção 2.5 do RPCMTec.';

-- ---------------------------------------------------------------------------
-- Dominios. O `code` e FIXO e semeado, nunca serial: ele e espelhado em
-- server/src/utils/domain_constants.js, e dois lugares com o mesmo numero
-- escrito a mao divergem no primeiro que alguem renumerar.
-- ---------------------------------------------------------------------------

-- OS CODIGOS SAO OS DO SAP, que e a regra da fusao de 2026-08-08: a linha
-- migrada nao precisa de tabela de traducao.
CREATE TABLE campo.situacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO campo.situacao (code, nome) VALUES
(1, 'Previsto'),
(2, 'Em execução'),
(3, 'Finalizado'),
(4, 'Cancelado');

-- A FINALIDADE do campo, e a coluna "Finalidade Campo" da 2.5.
--
-- AQUI OS CODIGOS SAO NOVOS, e e a unica divergencia deliberada de codigo desta
-- travessia: no SAP isto era um `ENUM` do Postgres (`categoria_campo`), que nao
-- tem numero nenhum a herdar. A ordem abaixo e a da declaracao do ENUM de la, e
-- nao a de frequencia.
--
-- CAPACITACAO NAO ESTA AQUI, e nao e esquecimento: ela deixou de ser categoria
-- de campo antes deste dump, e no SCA ela ja tem casa propria em
-- `rpcmtec.capacitacao`. Medido: zero campos com essa categoria nos 54.
CREATE TABLE campo.categoria(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO campo.categoria (code, nome) VALUES
(1, 'Reambulação'),
(2, 'Modelos 3D'),
(3, 'Imagens Panorâmicas em 360º'),
(4, 'Pontos de Controle'),
(5, 'Ortoimagens de Drone');

-- ---------------------------------------------------------------------------
-- O campo
-- ---------------------------------------------------------------------------
--
-- `ano` APONTA `pit.pit`, e isso e uma decisao do chefe de 2026-08-08,
-- tomada CONTRA o precedente ao lado: `rpcmtec.capacitacao.ano` e um SMALLINT
-- solto justamente porque a capacitacao tem anos que o PIT nao tem. Campo esta
-- na mesma situacao de fato (os 54 do dump vao de 2013 a 2026, e o PIT so tem
-- 2025 e 2026) e a saida escolhida foi a OUTRA: criar os exercicios que
-- faltam, Encerrados, para que o ano do campo seja o ano do plano de verdade e
-- nao um numero digitado que so por acaso coincide. Quem os cria e a migracao
-- 2026-08-08_campo.sql, e sem eles a carga do SAP e recusada pela FK -- que e
-- exatamente o ponto.
--
-- `data_inicio` e `data_fim` sao DIA DE CALENDARIO, e nao o
-- `timestamp with time zone` do SAP. Campo comeca num dia e acaba noutro; a
-- hora nunca foi perguntada por ninguem, e guardar fuso obriga toda leitura a
-- decidir em qual deles o dia vira. As duas sao NOT NULL porque nos 54 do dump
-- nao ha uma linha sem elas.
--
-- `geom` e NOT NULL por decisao do chefe de 2026-08-08. No dump 7 dos 54 estao
-- sem, e sao TODOS os voos de drone de 2026 -- pratica de hoje, e nao dado
-- velho mal preenchido. A carga NAO os inventa: ela para e cobra o poligono,
-- que e o que faz a coluna valer alguma coisa.
--
-- MULTIPOLYGON, e nao POLYGON: um campo pode cobrir areas separadas (o
-- "Exercicio Arandu 2026" cobre seis folhas nao contiguas), e um POLYGON
-- obrigaria a inventar uma ponte entre elas.
CREATE TABLE campo.campo(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT,
  ano SMALLINT NOT NULL REFERENCES pit.pit (ano),
  situacao_id SMALLINT NOT NULL REFERENCES campo.situacao (code),
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  -- A placa da viatura empregada. Texto, e nao FK para `equipamento`: viatura
  -- nao e material tecnico da Divisao, ela vem da guarnicao e nao esta no QDMP.
  placas_vtr VARCHAR(255),
  -- QUEM FOI A CAMPO E `campo_militar`, E NAO ESTA COLUNA.
  --
  -- Aqui fica so quem NAO tem conta no SCA: gente de outra OM, motorista da
  -- guarnicao, e principalmente quem ja saiu. Medido no dump: dos 145 nomes
  -- distintos em 13 anos de campo, 37 casam com `dgeo.usuario` por posto mais
  -- nome de guerra e 59 casam so pelo nome de guerra -- `militares` guardava a
  -- patente DA EPOCA ('ST Ferraz' hoje era '1o Sgt Ferraz' antes), e os outros
  -- 86 sao gente que nao esta mais na Divisao.
  --
  -- Sem esta coluna a carga perderia o efetivo dos campos antigos em silencio,
  -- e a 2.5 de um mes de 2019 sairia com menos gente do que foi. Ela e o
  -- mesmo recurso que `dgeo.impedimento.descricao` usa: texto onde a taxonomia
  -- nao fecha.
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

CREATE INDEX idx_campo_ano ON campo.campo (ano);
CREATE INDEX idx_campo_situacao ON campo.campo (situacao_id);
CREATE INDEX idx_campo_data_inicio ON campo.campo (data_inicio);
CREATE INDEX idx_campo_geom ON campo.campo USING gist (geom);

-- A FINALIDADE E LISTA, e nao coluna: dos 54 campos do dump, a soma das
-- categorias da 90, entao a maioria tem mais de uma. No SAP isto era um ARRAY
-- de ENUM, que nao tem chave estrangeira: um valor removido do dominio
-- sobrevivia dentro do array de quem ja o usava, sem nada reclamar.
CREATE TABLE campo.campo_categoria(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  categoria_id SMALLINT NOT NULL REFERENCES campo.categoria (code),
  UNIQUE (campo_id, categoria_id)
);

COMMENT ON TABLE campo.campo_categoria IS
    'Para que o campo serviu. Mais de uma por campo é o caso comum, não a exceção.';

CREATE INDEX idx_campo_categoria_campo ON campo.campo_categoria (campo_id);

-- QUEM DA DIVISAO FOI A CAMPO.
--
-- Espelha `rpcmtec.capacitacao_militar` de proposito, inclusive no
-- ON DELETE CASCADE: vinculo sem campo nao e historico de nada.
--
-- E o que torna a coluna "Efetivo" da 2.5 CONTADA em vez de digitada, e o que
-- deixa responder "onde o 3o Sgt Caio Sabadin esteve em 2026" sem ler texto.
CREATE TABLE campo.campo_militar(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  UNIQUE (campo_id, usuario_uuid)
);

COMMENT ON TABLE campo.campo_militar IS
    'Quem da Divisão foi a campo. Quem não tem conta aqui fica em campo.militares_externos.';

CREATE INDEX idx_campo_militar_usuario ON campo.campo_militar (usuario_uuid);

-- O QUE O CAMPO ATENDEU, e NAO E OBRIGATORIO.
--
-- Aponta `acervo.versao`, e nao `acervo.produto`: o que o campo alimenta e uma
-- EDICAO especifica, e a mesma folha reambulada duas vezes em anos diferentes
-- sao duas versoes e um produto so.
--
-- A AUSENCIA E O CASO COMUM, e e deliberada: viagem internacional, exercicio e
-- apoio a outra OM nao geram produto nenhum a apontar. No dump, 3 campos de 54
-- tinham vinculo. Exigir um obrigaria a inventar folha para os outros 51.
CREATE TABLE campo.campo_versao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  versao_id BIGINT NOT NULL REFERENCES acervo.versao (id),
  UNIQUE (campo_id, versao_id)
);

COMMENT ON TABLE campo.campo_versao IS
    'Versão do acervo que este campo atendeu. OPCIONAL: viagem internacional e exercício não geram produto.';

CREATE INDEX idx_campo_versao_versao ON campo.campo_versao (versao_id);

-- ---------------------------------------------------------------------------
-- O registro visual do campo
-- ---------------------------------------------------------------------------
--
-- OS BYTES FICAM NO BANCO (coluna `conteudo BYTEA`), que e o que `orcamento`,
-- `mapoteca`, `pit` e `rpcmtec` ja fazem com anexo. O que nao tem precedente
-- aqui e o TAMANHO: no dump sao 137 fotos somando 35 MB e 6 videos somando
-- 144 MB, com um video de 37 MB. E por isso que `conteudo` nunca sai numa
-- listagem: quem quer os bytes pede a rota do arquivo, uma imagem por vez.
--
-- `mime_type` E ANULAVEL porque 133 das 143 linhas do dump estao sem ele, e
-- inventar 'image/jpeg' para todas seria gravar um palpite. A carga sniffa o
-- numero magico do arquivo; o que ela nao reconhecer entra nulo, e a rota
-- responde com o tipo generico.
CREATE TABLE campo.imagem(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  campo_id BIGINT NOT NULL REFERENCES campo.campo (id) ON DELETE CASCADE,
  descricao TEXT,
  data_imagem DATE,
  -- Dois valores, e um CHECK em vez de tabela de dominio: 'foto' e 'video' nao
  -- sao um catalogo que cresce, sao os dois jeitos de um arquivo ser visual, e
  -- o SAP ja os guardava assim.
  tipo VARCHAR(10) NOT NULL DEFAULT 'foto' CHECK (tipo IN ('foto', 'video')),
  mime_type VARCHAR(100),
  conteudo BYTEA NOT NULL,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE campo.imagem IS
    'Foto ou vídeo do campo. Os bytes ficam aqui, como todo anexo do SCA, e nunca saem numa listagem.';

CREATE INDEX idx_imagem_campo ON campo.imagem (campo_id);

-- ---------------------------------------------------------------------------
-- O trajeto da viatura
-- ---------------------------------------------------------------------------
--
-- Um track e UM DIA de UMA viatura, com quem a chefiou e quem a dirigiu. No
-- dump sao 76 tracks para 12 campos de 54: a maioria dos campos nao tem
-- trajeto nenhum, e a tela precisa saber viver sem.
CREATE TABLE campo.track(
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

CREATE INDEX idx_track_campo ON campo.track (campo_id);

-- OS PONTOS DO GPS. 491.325 deles no dump, 97 MB.
--
-- `x_ll` E `y_ll` DO SAP NAO VIERAM: eram a longitude e a latitude do MESMO
-- ponto que `geom` ja guarda, gravadas ao lado. Duas copias de uma coordenada
-- nao tem como as duas estarem certas depois da primeira correcao.
--
-- `momento` e `timestamp with time zone` e NAO e dia de calendario: aqui a
-- hora e o dado, ela e o que ordena o trajeto e o que diz quanto tempo a
-- viatura levou entre dois pontos.
CREATE TABLE campo.track_ponto(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  track_id BIGINT NOT NULL REFERENCES campo.track (id) ON DELETE CASCADE,
  geom geometry(POINT, 4674) NOT NULL,
  elevacao REAL,
  momento TIMESTAMP WITH TIME ZONE
);

COMMENT ON TABLE campo.track_ponto IS
    'Ponto do GPS. A ordem do trajeto vem de momento; sem hora, da ordem de inserção (id).';

CREATE INDEX idx_track_ponto_track ON campo.track_ponto (track_id);
CREATE INDEX idx_track_ponto_geom ON campo.track_ponto USING gist (geom);

-- A LINHA DO TRAJETO, COSTURADA NA LEITURA.
--
-- VIEW COMUM, e nao MATERIALIZADA como no SAP. Materializar obrigaria alguem a
-- lembrar de atualizar depois de cada importacao de GPX, e uma linha velha e
-- pior que uma linha lenta: ela mente sem avisar. O custo real e pequeno --
-- sao 76 tracks, e a tela pede o trajeto de UM campo por vez.
--
-- `LineStringM`: o M carrega o instante de cada vertice, entao a linha sozinha
-- ja responde "onde a viatura estava as 14h" sem voltar aos pontos.
--
-- O HAVING NAO E DETALHE: `ST_MakeLine` com um ponto so devolve um ponto, e a
-- coluna se declara LineString. Track com um vertice unico simplesmente nao
-- tem linha, e some daqui em vez de derrubar a consulta.
--
-- O TRACK SEM HORA TAMBEM SE DESENHA, desde 2026-09-05.
--
-- Ate aqui a view filtrava `WHERE p.momento IS NOT NULL` e costurava
-- `ORDER BY p.momento`, entao um trajeto importado de GeoJSON -- onde TODO
-- ponto entra com `momento` nulo, porque GeoJSON de linha nao carrega hora --
-- nao produzia linha NENHUMA. O servidor respondia "Trajeto importado com 6.500
-- pontos", a lista mostrava os 6.500 e ao lado "sem linha para desenhar", e o
-- trajeto nunca aparecia no mapa. A hora e o que ORDENA melhor, e nao o que
-- autoriza a existir.
--
-- A ORDEM PASSA A SER `momento NULLS LAST, id`: quem tem hora ordena pela hora,
-- e quem nao tem cai para o fim na ordem de INSERCAO, que e a ordem do arquivo
-- (os pontos entram num INSERT unico, na ordem em que foram lidos). Num track
-- misto o trecho cronometrado vem primeiro e o resto segue atras, que e o
-- melhor que se pode afirmar sem inventar hora.
--
-- O `NaN` NO M NAO E ENFEITE, e sem ele nada disto funciona: `ST_MakePointM` e
-- STRICT, entao `momento` nulo devolvia PONTO NULO, e `ST_MakeLine` PULA os
-- nulos -- um track todo sem hora virava uma linha de zero vertices, isto e,
-- NULL. Um zero no lugar do `NaN` seria pior que a falta: ele afirmaria
-- 1970-01-01T00:00:00Z em cada vertice, e quem lesse o M acreditaria. `NaN` diz
-- "nao ha hora aqui", e some no `ST_Force2D` que o servidor aplica antes de
-- serializar para o mapa.
--
-- O `WHERE` sobrou como guarda de geometria: `geom` e NOT NULL na tabela, e a
-- condicao existe para que uma linha sem ponto nunca chegue ao `ST_MakeLine`.
CREATE VIEW campo.track_linha AS
SELECT
  p.track_id,
  min(p.momento) AS momento_inicio,
  max(p.momento) AS momento_fim,
  count(*) AS pontos,
  ST_MakeLine(
    ST_SetSRID(
      ST_MakePointM(
        ST_X(p.geom), ST_Y(p.geom),
        COALESCE(extract(epoch FROM p.momento), 'NaN'::double precision)
      ),
      4674
    ) ORDER BY p.momento NULLS LAST, p.id
  )::geometry(LineStringM, 4674) AS geom
FROM campo.track_ponto p
WHERE p.geom IS NOT NULL
GROUP BY p.track_id
HAVING count(*) > 1;

COMMENT ON VIEW campo.track_linha IS
    'O trajeto costurado dos pontos, na leitura. View comum e não materializada: linha velha mente sem avisar.';

COMMIT;
