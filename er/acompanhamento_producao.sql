BEGIN;

-- ---------------------------------------------------------------------------
-- Acompanhamento da PRODUCAO: as views materializadas que o QGIS abre
-- ---------------------------------------------------------------------------
--
-- LEIA ISTO ANTES DE JUNTAR ESTE ARQUIVO COM `er/acompanhamento.sql`.
--
-- Sao DOIS arquivos com nomes parecidos e assuntos diferentes, e o nome do
-- outro e que engana:
--
--   `er/acompanhamento.sql`  cria as views materializadas do ACERVO
--                            (`acervo.mv_produto_<tipo>_<escala>`) e os
--                            gatilhos que as atualizam. Nao cria schema nenhum
--                            e nao tem nada a ver com producao.
--   `er/acompanhamento_producao.sql` (este) cria o SCHEMA `acompanhamento` e as
--                            funcoes que geram, por LOTE DO ACERVO cruzado com
--                            LINHA DE PRODUCAO e por SUBFASE, as views
--                            materializadas que o gerente de producao abre no
--                            QGIS.
--
-- O schema deste arquivo continua se chamando `acompanhamento`, como no SAP. So
-- o nome do ARQUIVO ganhou o sufixo, para nao sobrescrever o que ja existia.
--
-- ---------------------------------------------------------------------------
-- `acompanhamento.login` NAO ATRAVESSOU, e nao e esquecimento
-- ---------------------------------------------------------------------------
--
-- No SAP 2.3.5 este schema tinha uma tabela, `acompanhamento.login`, com
-- `usuario_id` e `data_login`. Ela ja existe aqui, com outro nome e em outro
-- lugar: e a `dgeo.login` do SCA, que guarda a mesma coisa. Criar a segunda
-- daria dois lugares para responder "quando fulano entrou pela ultima vez", e
-- eles divergiriam no primeiro login registrado so num deles.
--
-- Quem procurar `acompanhamento.login` neste arquivo procura `dgeo.login`.
--
-- ---------------------------------------------------------------------------
-- `public.layer_styles` NAO PODE MUDAR DE NOME NEM DE SCHEMA
-- ---------------------------------------------------------------------------
--
-- Toda funcao daqui que gera uma view tambem grava o QML do estilo dela em
-- `public.layer_styles`. Esse nome e esse schema sao um CONTRATO COM O QGIS: o
-- proprio QGIS, sem plugin nenhum, procura a tabela `layer_styles` no schema
-- `public` do banco a que se conectou para descobrir como pintar cada camada.
-- Renomear a tabela ou move-la para o schema `qgis` nao quebra nada aqui
-- dentro; quebra do lado de fora, e em silencio: o gerente abre a view e ela
-- vem cinza, sem uma unica mensagem de erro.
--
-- Por isso ela e a UNICA tabela de estilo que ficou em `public`. O catalogo de
-- estilos do SAP, que era `dgeo.layer_styles`, atravessou para
-- `qgis.layer_styles`, e sao coisas diferentes: aquele e o acervo de estilos
-- que o cliente distribui, este e o que o QGIS le sozinho.
--
-- A tabela e criada em `er/versao.sql`, que carrega antes deste arquivo.
--
-- ---------------------------------------------------------------------------
-- O que mudou do SAP 2.3.5 para ca
-- ---------------------------------------------------------------------------
--
--   `macrocontrole`      -> `producao`
--   `macrocontrole.lote` -> `acervo.lote`, e `lote_id` aponta direto para ele
--   `usuario_id`         -> `usuario_uuid`, apontando `dgeo.usuario (uuid)`
--   `tipo_situacao_id`   -> `tipo_situacao_atividade_id`
--   `perfil_producao*`   -> `habilitacao*` ("perfil" aqui e autorizacao)
--   `dominio.status`     -> `dominio.tipo_status_execucao`
--   `dominio.tipo_produto` do SAP -> `dominio.subtipo_produto`
--   `macrocontrole.produto` -> `acervo.versao`, com salto para `acervo.produto`
--   `macrocontrole.projeto` -> `acervo.projeto`
--
-- O `dominio.tipo_turno` SAIU, por decisao de 2026-08-09, e com ele a coluna
-- `<etapa>_turno` das views de subfase e a juncao que a alimentava.
-- `dgeo.usuario` do SCA nao tem `tipo_turno_id`, entao a juncao antiga nem
-- compilaria.
--
-- `ALTER TABLE ... OWNER TO postgres` SAIU de todas as funcoes. Quem cria a
-- view ja e o dono dela, e fixar o nome do papel derrubava a instalacao feita
-- por qualquer outro. O `GRANT SELECT ... TO PUBLIC` ficou: e ele que deixa o
-- papel de leitura do QGIS enxergar a view.
--
-- CARREGA DEPOIS DE `dgeo`, `dominio`, `versao`, `acervo` e `producao`.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA acompanhamento;

COMMENT ON SCHEMA acompanhamento IS
    'Views materializadas do andamento da produção, geradas por lote do acervo, por linha de produção e por subfase. É o que o gerente abre no QGIS.';

-- ---------------------------------------------------------------------------
-- QUE LINHAS DE PRODUCAO UM LOTE EXECUTA, e que lotes executam uma linha
-- ---------------------------------------------------------------------------
--
-- SAO A LEITURA QUE SUBSTITUI A TABELA REMOVIDA. Ate 2026-08-09 o desenho da
-- 3.0.0 tinha uma `producao.lote_linha`, e o par (lote, linha de producao) era
-- uma linha de CADASTRO. O chefe a removeu no mesmo dia, e o par passou a ser
-- DERIVADO: um lote executa uma linha de producao quando tem ETAPA numa subfase
-- daquela linha. Nao ha o que declarar alem disso, e nao ha como o cadastro
-- discordar do fluxo.
--
-- E A ETAPA, E NAO A UNIDADE DE TRABALHO, e a escolha importa: a etapa e a
-- configuracao ("este lote executa esta subfase") e a UT e o dado. A etapa
-- existe antes de haver geometria nenhuma, que e exatamente quando a view
-- precisa nascer vazia para depois ser atualizada.
--
-- SAO `SETOF`, E NAO `RETURNS TABLE`: o nome de coluna do `RETURNS TABLE` vira
-- um identificador visivel dentro do corpo e colidiria com `linha_producao_id`
-- e `lote_id` das tabelas consultadas.
CREATE OR REPLACE FUNCTION acompanhamento.linhas_producao_do_lote(lote_ident bigint)
  RETURNS SETOF integer AS
$$
  SELECT DISTINCT f.linha_producao_id
  FROM producao.etapa AS e
  INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
  INNER JOIN producao.fase AS f ON f.id = s.fase_id
  WHERE e.lote_id = lote_ident;
$$
LANGUAGE sql STABLE;

COMMENT ON FUNCTION acompanhamento.linhas_producao_do_lote(bigint) IS
    'As linhas de produção que um lote do acervo executa, lidas das etapas dele. Substitui a producao.lote_linha, removida por decisão do chefe em 2026-08-09.';

CREATE OR REPLACE FUNCTION acompanhamento.lotes_da_linha_producao(linhaproducao_ident integer)
  RETURNS SETOF bigint AS
$$
  SELECT DISTINCT e.lote_id
  FROM producao.etapa AS e
  INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
  INNER JOIN producao.fase AS f ON f.id = s.fase_id
  WHERE f.linha_producao_id = linhaproducao_ident;
$$
LANGUAGE sql STABLE;

COMMENT ON FUNCTION acompanhamento.lotes_da_linha_producao(integer) IS
    'Os lotes do acervo que executam uma linha de produção, lidos das etapas deles. É o lado inverso de linhas_producao_do_lote.';

CREATE OR REPLACE FUNCTION acompanhamento.cria_view_acompanhamento_subfase(subfase_ident integer, lote_ident bigint)
  RETURNS void AS
$$
    DECLARE view_txt text := '';
    DECLARE jointxt text := '';
    DECLARE wheretxt text := '';
    DECLARE num integer;
    DECLARE nome_fixed text;
    DECLARE r record;
    DECLARE iterator integer := 1;
    DECLARE estilo_txt text;
    DECLARE rules_txt text := '';
    DECLARE symbols_txt text := '';
    DECLARE tipo_txt text;
    DECLARE tipo_andamento_txt text;
    DECLARE tipo_pausada_txt text;
    DECLARE etapas_concluidas_txt text := '';
    DECLARE etapas_nome text := '';
    DECLARE exec_andamento_txt text;
    DECLARE exec_pausada_txt text;
    DECLARE rev_pausada_txt text;
    DECLARE revcor_pausada_txt text;
    DECLARE cor_pausada_txt text;
    DECLARE exec_txt text;
    DECLARE rev_txt text;
    DECLARE rev_andamento_txt text;
    DECLARE cor_txt text;
    DECLARE cor_andamento_txt text;
    DECLARE revcor_andamento_txt text;
    DECLARE revcor_txt text;
  BEGIN
    SELECT count(*) INTO num FROM producao.etapa WHERE subfase_id = subfase_ident AND lote_id = lote_ident;
    IF num > 0 THEN
      view_txt := 'CREATE MATERIALIZED VIEW acompanhamento.lote_' || lote_ident || '_subfase_' || subfase_ident || '  AS 
      SELECT ut.id, ut.lote_id, ut.subfase_id, ut.disponivel, rest_pre.id IS NOT NULL AS restrito_pre, rest_exec.id IS NOT NULL AS restrito_exec, l.nome AS bloco, ut.nome, ut.dificuldade,ut.tempo_estimado_minutos, dp.configuracao_producao AS dado_producao, dp.configuracao_producao, tdp.nome AS tipo_dado_producao, ut.prioridade, ut.geom';

      exec_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"> <layer class="SimpleFill" locked="0" enabled="1" pass="0"> <prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="color" v="215,25,28,128"/> <prop k="joinstyle" v="bevel"/> <prop k="offset" v="0,0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="outline_color" v="0,0,0,255"/> <prop k="outline_style" v="solid"/> <prop k="outline_width" v="0.26"/> <prop k="outline_width_unit" v="MM"/> <prop k="style" v="solid"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol>';
      exec_andamento_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"> <layer class="SimpleFill" locked="0" enabled="1" pass="0"> <prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="color" v="215,25,28,128"/> <prop k="joinstyle" v="bevel"/> <prop k="offset" v="0,0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="outline_color" v="0,0,0,255"/> <prop k="outline_style" v="solid"/> <prop k="outline_width" v="0.26"/> <prop k="outline_width_unit" v="MM"/> <prop k="style" v="solid"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> <layer class="LinePatternFill" locked="0" enabled="1" pass="0"> <prop k="angle" v="45"/> <prop k="color" v="0,0,255,255"/> <prop k="distance" v="1"/> <prop k="distance_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="distance_unit" v="MM"/> <prop k="line_width" v="0.26"/> <prop k="line_width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="line_width_unit" v="MM"/> <prop k="offset" v="0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="outline_width_unit" v="MM"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> <symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="line" clip_to_extent="1" alpha="1"> <layer class="SimpleLine" locked="0" enabled="1" pass="0"> <prop k="capstyle" v="square"/> <prop k="customdash" v="5;2"/> <prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="customdash_unit" v="MM"/> <prop k="draw_inside_polygon" v="0"/> <prop k="joinstyle" v="bevel"/> <prop k="line_color" v="0,0,0,255"/> <prop k="line_style" v="solid"/> <prop k="line_width" v="0.26"/> <prop k="line_width_unit" v="MM"/> <prop k="offset" v="0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="ring_filter" v="0"/> <prop k="use_custom_dash" v="0"/> <prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol> </layer> </symbol>';
      exec_pausada_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" clip_to_extent="1" alpha="1" type="fill"><layer locked="0" enabled="1" pass="0" class="SimpleFill"><prop v="3x:0,0,0,0,0,0" k="border_width_map_unit_scale"/><prop v="215,25,28,128" k="color"/><prop v="bevel" k="joinstyle"/><prop v="0,0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0,0,0,255" k="outline_color"/><prop v="solid" k="outline_style"/><prop v="0.26" k="outline_width"/><prop v="MM" k="outline_width_unit"/><prop v="solid" k="style"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )&#xd;&#xa; " k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="2" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@2" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="2" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )&#xd;&#xa; " k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@3" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="0,0,0,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@4" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="0,0,0,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      rev_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"><layer class="SimpleFill" locked="0" enabled="1" pass="0"><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="253,192,134,128"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer><layer class="CentroidFill" locked="0" enabled="1" pass="0"><prop k="point_on_all_parts" v="1"/><prop k="point_on_surface" v="0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="marker" clip_to_extent="1" alpha="1"><layer class="FontMarker" locked="0" enabled="1" pass="0"><prop k="angle" v="0"/><prop k="chr" v="{{ORDEM}}"/><prop k="color" v="0,0,0,255"/><prop k="font" v="Arial Black"/><prop k="horizontal_anchor_point" v="1"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,-0.005"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MapUnit"/><prop k="outline_color" v="255,255,255,255"/><prop k="outline_width" v="0.0035"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MapUnit"/><prop k="size" v="0.045"/><prop k="size_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="size_unit" v="MapUnit"/><prop k="vertical_anchor_point" v="1"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      rev_andamento_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"><layer class="SimpleFill" locked="0" enabled="1" pass="0"><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="253,192,134,128"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer><layer class="LinePatternFill" locked="0" enabled="1" pass="0"><prop k="angle" v="45"/><prop k="color" v="0,0,255,255"/><prop k="distance" v="1"/><prop k="distance_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="distance_unit" v="MM"/><prop k="line_width" v="0.26"/><prop k="line_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MM"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="line" clip_to_extent="1" alpha="1"><layer class="SimpleLine" locked="0" enabled="1" pass="0"><prop k="capstyle" v="square"/><prop k="customdash" v="5;2"/><prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="customdash_unit" v="MM"/><prop k="draw_inside_polygon" v="0"/><prop k="joinstyle" v="bevel"/><prop k="line_color" v="0,0,0,255"/><prop k="line_style" v="solid"/><prop k="line_width" v="0.26"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="ring_filter" v="0"/><prop k="use_custom_dash" v="0"/><prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer><layer class="CentroidFill" locked="0" enabled="1" pass="0"><prop k="point_on_all_parts" v="1"/><prop k="point_on_surface" v="0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@2" type="marker" clip_to_extent="1" alpha="1"><layer class="FontMarker" locked="0" enabled="1" pass="0"><prop k="angle" v="0"/><prop k="chr" v="{{ORDEM}}"/><prop k="color" v="0,0,0,255"/><prop k="font" v="Arial Black"/><prop k="horizontal_anchor_point" v="1"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,-0.005"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MapUnit"/><prop k="outline_color" v="255,255,255,255"/><prop k="outline_width" v="0.0035"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MapUnit"/><prop k="size" v="0.045"/><prop k="size_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="size_unit" v="MapUnit"/><prop k="vertical_anchor_point" v="1"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      rev_pausada_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" clip_to_extent="1" alpha="1" type="fill"><layer locked="0" enabled="1" pass="0" class="SimpleFill"><prop v="3x:0,0,0,0,0,0" k="border_width_map_unit_scale"/><prop v="253,192,134,128" k="color"/><prop v="bevel" k="joinstyle"/><prop v="0,0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0,0,0,255" k="outline_color"/><prop v="solid" k="outline_style"/><prop v="0.26" k="outline_width"/><prop v="MM" k="outline_width_unit"/><prop v="solid" k="style"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="2" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v="intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@2" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@3" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="0,0,0,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v="intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@4" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="0,0,0,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="CentroidFill"><prop v="1" k="point_on_all_parts"/><prop v="0" k="point_on_surface"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@5" clip_to_extent="1" alpha="1" type="marker"><layer locked="0" enabled="1" pass="0" class="FontMarker"><prop v="0" k="angle"/><prop v="1" k="chr"/><prop v="0,0,0,255" k="color"/><prop v="Arial Black" k="font"/><prop v="1" k="horizontal_anchor_point"/><prop v="bevel" k="joinstyle"/><prop v="0,-0.005" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MapUnit" k="offset_unit"/><prop v="255,255,255,255" k="outline_color"/><prop v="0.0035" k="outline_width"/><prop v="3x:0,0,0,0,0,0" k="outline_width_map_unit_scale"/><prop v="MapUnit" k="outline_width_unit"/><prop v="0.045" k="size"/><prop v="3x:0,0,0,0,0,0" k="size_map_unit_scale"/><prop v="MapUnit" k="size_unit"/><prop v="1" k="vertical_anchor_point"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      cor_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"><layer class="SimpleFill" locked="0" enabled="1" pass="0"><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="255,255,153,128"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer><layer class="CentroidFill" locked="0" enabled="1" pass="0"><prop k="point_on_all_parts" v="1"/><prop k="point_on_surface" v="0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="marker" clip_to_extent="1" alpha="1"><layer class="FontMarker" locked="0" enabled="1" pass="0"><prop k="angle" v="0"/><prop k="chr" v="{{ORDEM}}"/><prop k="color" v="0,0,0,255"/><prop k="font" v="Arial Black"/><prop k="horizontal_anchor_point" v="1"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,-0.005"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MapUnit"/><prop k="outline_color" v="255,255,255,255"/><prop k="outline_width" v="0.0035"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MapUnit"/><prop k="size" v="0.045"/><prop k="size_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="size_unit" v="MapUnit"/><prop k="vertical_anchor_point" v="1"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      cor_andamento_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"><layer class="SimpleFill" locked="0" enabled="1" pass="0"><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="255,255,153,128"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer><layer class="LinePatternFill" locked="0" enabled="1" pass="0"><prop k="angle" v="45"/><prop k="color" v="0,0,255,255"/><prop k="distance" v="1"/><prop k="distance_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="distance_unit" v="MM"/><prop k="line_width" v="0.26"/><prop k="line_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MM"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="line" clip_to_extent="1" alpha="1"><layer class="SimpleLine" locked="0" enabled="1" pass="0"><prop k="capstyle" v="square"/><prop k="customdash" v="5;2"/><prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="customdash_unit" v="MM"/><prop k="draw_inside_polygon" v="0"/><prop k="joinstyle" v="bevel"/><prop k="line_color" v="0,0,0,255"/><prop k="line_style" v="solid"/><prop k="line_width" v="0.26"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="ring_filter" v="0"/><prop k="use_custom_dash" v="0"/><prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer><layer class="CentroidFill" locked="0" enabled="1" pass="0"><prop k="point_on_all_parts" v="1"/><prop k="point_on_surface" v="0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@2" type="marker" clip_to_extent="1" alpha="1"><layer class="FontMarker" locked="0" enabled="1" pass="0"><prop k="angle" v="0"/><prop k="chr" v="{{ORDEM}}"/><prop k="color" v="0,0,0,255"/><prop k="font" v="Arial Black"/><prop k="horizontal_anchor_point" v="1"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,-0.005"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MapUnit"/><prop k="outline_color" v="255,255,255,255"/><prop k="outline_width" v="0.0035"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MapUnit"/><prop k="size" v="0.045"/><prop k="size_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="size_unit" v="MapUnit"/><prop k="vertical_anchor_point" v="1"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      cor_pausada_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" clip_to_extent="1" alpha="1" type="fill"><layer locked="0" enabled="1" pass="0" class="SimpleFill"><prop v="3x:0,0,0,0,0,0" k="border_width_map_unit_scale"/><prop v="255,255,153,128" k="color"/><prop v="bevel" k="joinstyle"/><prop v="0,0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0,0,0,255" k="outline_color"/><prop v="solid" k="outline_style"/><prop v="0.26" k="outline_width"/><prop v="MM" k="outline_width_unit"/><prop v="solid" k="style"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="2" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v="intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@2" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="2" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@3" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="35,35,35,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v="intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@4" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="35,35,35,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="CentroidFill"><prop v="1" k="point_on_all_parts"/><prop v="0" k="point_on_surface"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@5" clip_to_extent="1" alpha="1" type="marker"><layer locked="0" enabled="1" pass="0" class="FontMarker"><prop v="0" k="angle"/><prop v="1" k="chr"/><prop v="0,0,0,255" k="color"/><prop v="Arial Black" k="font"/><prop v="1" k="horizontal_anchor_point"/><prop v="bevel" k="joinstyle"/><prop v="0,-0.005" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MapUnit" k="offset_unit"/><prop v="255,255,255,255" k="outline_color"/><prop v="0.0035" k="outline_width"/><prop v="3x:0,0,0,0,0,0" k="outline_width_map_unit_scale"/><prop v="MapUnit" k="outline_width_unit"/><prop v="0.045" k="size"/><prop v="3x:0,0,0,0,0,0" k="size_map_unit_scale"/><prop v="MapUnit" k="size_unit"/><prop v="1" k="vertical_anchor_point"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      revcor_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"><layer class="SimpleFill" locked="0" enabled="1" pass="0"><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="190,174,212,128"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer><layer class="CentroidFill" locked="0" enabled="1" pass="0"><prop k="point_on_all_parts" v="1"/><prop k="point_on_surface" v="0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="marker" clip_to_extent="1" alpha="1"><layer class="FontMarker" locked="0" enabled="1" pass="0"><prop k="angle" v="0"/><prop k="chr" v="{{ORDEM}}"/><prop k="color" v="0,0,0,255"/><prop k="font" v="Arial Black"/><prop k="horizontal_anchor_point" v="1"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,-0.005"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MapUnit"/><prop k="outline_color" v="255,255,255,255"/><prop k="outline_width" v="0.0035"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MapUnit"/><prop k="size" v="0.045"/><prop k="size_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="size_unit" v="MapUnit"/><prop k="vertical_anchor_point" v="1"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      revcor_andamento_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"><layer class="SimpleFill" locked="0" enabled="1" pass="0"><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="190,174,212,128"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer><layer class="LinePatternFill" locked="0" enabled="1" pass="0"><prop k="angle" v="45"/><prop k="color" v="0,0,255,255"/><prop k="distance" v="1"/><prop k="distance_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="distance_unit" v="MM"/><prop k="line_width" v="0.26"/><prop k="line_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MM"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="line" clip_to_extent="1" alpha="1"><layer class="SimpleLine" locked="0" enabled="1" pass="0"><prop k="capstyle" v="square"/><prop k="customdash" v="5;2"/><prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="customdash_unit" v="MM"/><prop k="draw_inside_polygon" v="0"/><prop k="joinstyle" v="bevel"/><prop k="line_color" v="0,0,0,255"/><prop k="line_style" v="solid"/><prop k="line_width" v="0.26"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="ring_filter" v="0"/><prop k="use_custom_dash" v="0"/><prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer><layer class="CentroidFill" locked="0" enabled="1" pass="0"><prop k="point_on_all_parts" v="1"/><prop k="point_on_surface" v="0"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@2" type="marker" clip_to_extent="1" alpha="1"><layer class="FontMarker" locked="0" enabled="1" pass="0"><prop k="angle" v="0"/><prop k="chr" v="{{ORDEM}}"/><prop k="color" v="0,0,0,255"/><prop k="font" v="Arial Black"/><prop k="horizontal_anchor_point" v="1"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,-0.005"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MapUnit"/><prop k="outline_color" v="255,255,255,255"/><prop k="outline_width" v="0.0035"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MapUnit"/><prop k="size" v="0.045"/><prop k="size_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="size_unit" v="MapUnit"/><prop k="vertical_anchor_point" v="1"/><data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties"/><Option name="type" type="QString" value="collection"/></Option></data_defined_properties></layer></symbol></layer></symbol>';
      revcor_pausada_txt := '<symbol force_rhr="0" name="{{NUMERACAO}}" clip_to_extent="1" alpha="1" type="fill"><layer locked="0" enabled="1" pass="0" class="SimpleFill"><prop v="3x:0,0,0,0,0,0" k="border_width_map_unit_scale"/><prop v="190,174,212,128" k="color"/><prop v="bevel" k="joinstyle"/><prop v="0,0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0,0,0,255" k="outline_color"/><prop v="solid" k="outline_style"/><prop v="0.26" k="outline_width"/><prop v="MM" k="outline_width_unit"/><prop v="solid" k="style"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@1" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="2" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v="intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@2" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="255,255,255,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="2" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v=" intersection( &#xd;&#xa;&#x9;make_line(&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_max(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;(y_max(bounds($geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;),&#xd;&#xa;&#x9;&#x9;make_point(&#xd;&#xa;&#x9;&#x9;&#x9;x_min(bounds($geometry )),&#xd;&#xa;&#x9;&#x9;&#x9;( y_max( bounds( $geometry )) + y_min( bounds( $geometry )))/2&#xd;&#xa;&#x9;&#x9;)&#xd;&#xa;&#x9;)&#xd;&#xa;, $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@3" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="0,0,0,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="GeometryGenerator"><prop v="Line" k="SymbolType"/><prop v="intersection( make_line(make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_max( bounds( $geometry ))) ,make_point((x_max( bounds( $geometry )) + x_min( bounds( $geometry )))/2, y_min( bounds( $geometry )))), $geometry )" k="geometryModifier"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@4" clip_to_extent="1" alpha="1" type="line"><layer locked="0" enabled="1" pass="0" class="SimpleLine"><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="0,0,0,128" k="line_color"/><prop v="solid" k="line_style"/><prop v="1" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" enabled="1" pass="0" class="CentroidFill"><prop v="1" k="point_on_all_parts"/><prop v="0" k="point_on_surface"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties><symbol force_rhr="0" name="@{{NUMERACAO}}@5" clip_to_extent="1" alpha="1" type="marker"><layer locked="0" enabled="1" pass="0" class="FontMarker"><prop v="0" k="angle"/><prop v="1" k="chr"/><prop v="0,0,0,255" k="color"/><prop v="Arial Black" k="font"/><prop v="1" k="horizontal_anchor_point"/><prop v="bevel" k="joinstyle"/><prop v="0,-0.005" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MapUnit" k="offset_unit"/><prop v="255,255,255,255" k="outline_color"/><prop v="0.0035" k="outline_width"/><prop v="3x:0,0,0,0,0,0" k="outline_width_map_unit_scale"/><prop v="MapUnit" k="outline_width_unit"/><prop v="0.045" k="size"/><prop v="3x:0,0,0,0,0,0" k="size_map_unit_scale"/><prop v="MapUnit" k="size_unit"/><prop v="1" k="vertical_anchor_point"/><data_defined_properties><Option type="Map"><Option name="name" value="" type="QString"/><Option name="properties"/><Option name="type" value="collection" type="QString"/></Option></data_defined_properties></layer></symbol></layer></symbol>';

      rules_txt := rules_txt || '<rule symbol="' ||  iterator || '" key="{' || uuid_generate_v4() ||'}" label="restrição pre" filter="restrito_pre IS TRUE"/>';
      symbols_txt := symbols_txt || replace('<symbol clip_to_extent="1" name="{{NUMERACAO}}" alpha="1" force_rhr="0" type="fill"><data_defined_properties><Option type="Map"><Option value="" name="name" type="QString"/><Option name="properties"/><Option value="collection" name="type" type="QString"/></Option></data_defined_properties><layer locked="0" pass="0" class="PointPatternFill" enabled="1"><Option type="Map"><Option value="0" name="angle" type="double"/><Option value="shape" name="clip_mode" type="QString"/><Option value="feature" name="coordinate_reference" type="QString"/><Option value="1.2" name="displacement_x" type="QString"/><Option value="3x:0,0,0,0,0,0" name="displacement_x_map_unit_scale" type="QString"/><Option value="MM" name="displacement_x_unit" type="QString"/><Option value="0" name="displacement_y" type="QString"/><Option value="3x:0,0,0,0,0,0" name="displacement_y_map_unit_scale" type="QString"/><Option value="MM" name="displacement_y_unit" type="QString"/><Option value="2.4" name="distance_x" type="QString"/><Option value="3x:0,0,0,0,0,0" name="distance_x_map_unit_scale" type="QString"/><Option value="MM" name="distance_x_unit" type="QString"/><Option value="2.4" name="distance_y" type="QString"/><Option value="3x:0,0,0,0,0,0" name="distance_y_map_unit_scale" type="QString"/><Option value="MM" name="distance_y_unit" type="QString"/><Option value="0" name="offset_x" type="QString"/><Option value="3x:0,0,0,0,0,0" name="offset_x_map_unit_scale" type="QString"/><Option value="MM" name="offset_x_unit" type="QString"/><Option value="0" name="offset_y" type="QString"/><Option value="3x:0,0,0,0,0,0" name="offset_y_map_unit_scale" type="QString"/><Option value="MM" name="offset_y_unit" type="QString"/><Option value="3x:0,0,0,0,0,0" name="outline_width_map_unit_scale" type="QString"/><Option value="MM" name="outline_width_unit" type="QString"/><Option value="0" name="random_deviation_x" type="QString"/><Option value="3x:0,0,0,0,0,0" name="random_deviation_x_map_unit_scale" type="QString"/><Option value="MM" name="random_deviation_x_unit" type="QString"/><Option value="0" name="random_deviation_y" type="QString"/><Option value="3x:0,0,0,0,0,0" name="random_deviation_y_map_unit_scale" type="QString"/><Option value="MM" name="random_deviation_y_unit" type="QString"/><Option value="930092414" name="seed" type="QString"/></Option><prop k="angle" v="0"/><prop k="clip_mode" v="shape"/><prop k="coordinate_reference" v="feature"/><prop k="displacement_x" v="1.2"/><prop k="displacement_x_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="displacement_x_unit" v="MM"/><prop k="displacement_y" v="0"/><prop k="displacement_y_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="displacement_y_unit" v="MM"/><prop k="distance_x" v="2.4"/><prop k="distance_x_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="distance_x_unit" v="MM"/><prop k="distance_y" v="2.4"/><prop k="distance_y_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="distance_y_unit" v="MM"/><prop k="offset_x" v="0"/><prop k="offset_x_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_x_unit" v="MM"/><prop k="offset_y" v="0"/><prop k="offset_y_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_y_unit" v="MM"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MM"/><prop k="random_deviation_x" v="0"/><prop k="random_deviation_x_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="random_deviation_x_unit" v="MM"/><prop k="random_deviation_y" v="0"/><prop k="random_deviation_y_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="random_deviation_y_unit" v="MM"/><prop k="seed" v="930092414"/><data_defined_properties><Option type="Map"><Option value="" name="name" type="QString"/><Option name="properties"/><Option value="collection" name="type" type="QString"/></Option></data_defined_properties><symbol clip_to_extent="1" name="@0@0" alpha="1" force_rhr="0" type="marker"><data_defined_properties><Option type="Map"><Option value="" name="name" type="QString"/><Option name="properties"/><Option value="collection" name="type" type="QString"/></Option></data_defined_properties><layer locked="0" pass="0" class="SimpleMarker" enabled="1"><Option type="Map"><Option value="0" name="angle" type="QString"/><Option value="square" name="cap_style" type="QString"/><Option value="0,0,0,255" name="color" type="QString"/><Option value="1" name="horizontal_anchor_point" type="QString"/><Option value="bevel" name="joinstyle" type="QString"/><Option value="circle" name="name" type="QString"/><Option value="0,0" name="offset" type="QString"/><Option value="3x:0,0,0,0,0,0" name="offset_map_unit_scale" type="QString"/><Option value="MM" name="offset_unit" type="QString"/><Option value="0,0,0,255" name="outline_color" type="QString"/><Option value="solid" name="outline_style" type="QString"/><Option value="0.2" name="outline_width" type="QString"/><Option value="3x:0,0,0,0,0,0" name="outline_width_map_unit_scale" type="QString"/><Option value="MM" name="outline_width_unit" type="QString"/><Option value="diameter" name="scale_method" type="QString"/><Option value="0.6" name="size" type="QString"/><Option value="3x:0,0,0,0,0,0" name="size_map_unit_scale" type="QString"/><Option value="MM" name="size_unit" type="QString"/><Option value="1" name="vertical_anchor_point" type="QString"/></Option><prop k="angle" v="0"/><prop k="cap_style" v="square"/><prop k="color" v="0,0,0,255"/><prop k="horizontal_anchor_point" v="1"/><prop k="joinstyle" v="bevel"/><prop k="name" v="circle"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.2"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MM"/><prop k="scale_method" v="diameter"/><prop k="size" v="0.6"/><prop k="size_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="size_unit" v="MM"/><prop k="vertical_anchor_point" v="1"/><data_defined_properties><Option type="Map"><Option value="" name="name" type="QString"/><Option name="properties"/><Option value="collection" name="type" type="QString"/></Option></data_defined_properties></layer></symbol></layer><layer locked="0" pass="0" class="SimpleLine" enabled="1"><Option type="Map"><Option value="0" name="align_dash_pattern" type="QString"/><Option value="square" name="capstyle" type="QString"/><Option value="5;2" name="customdash" type="QString"/><Option value="3x:0,0,0,0,0,0" name="customdash_map_unit_scale" type="QString"/><Option value="MM" name="customdash_unit" type="QString"/><Option value="0" name="dash_pattern_offset" type="QString"/><Option value="3x:0,0,0,0,0,0" name="dash_pattern_offset_map_unit_scale" type="QString"/><Option value="MM" name="dash_pattern_offset_unit" type="QString"/><Option value="0" name="draw_inside_polygon" type="QString"/><Option value="bevel" name="joinstyle" type="QString"/><Option value="0,0,0,255" name="line_color" type="QString"/><Option value="solid" name="line_style" type="QString"/><Option value="0.36" name="line_width" type="QString"/><Option value="MM" name="line_width_unit" type="QString"/><Option value="0" name="offset" type="QString"/><Option value="3x:0,0,0,0,0,0" name="offset_map_unit_scale" type="QString"/><Option value="MM" name="offset_unit" type="QString"/><Option value="0" name="ring_filter" type="QString"/><Option value="0" name="trim_distance_end" type="QString"/><Option value="3x:0,0,0,0,0,0" name="trim_distance_end_map_unit_scale" type="QString"/><Option value="MM" name="trim_distance_end_unit" type="QString"/><Option value="0" name="trim_distance_start" type="QString"/><Option value="3x:0,0,0,0,0,0" name="trim_distance_start_map_unit_scale" type="QString"/><Option value="MM" name="trim_distance_start_unit" type="QString"/><Option value="0" name="tweak_dash_pattern_on_corners" type="QString"/><Option value="0" name="use_custom_dash" type="QString"/><Option value="3x:0,0,0,0,0,0" name="width_map_unit_scale" type="QString"/></Option><prop k="align_dash_pattern" v="0"/><prop k="capstyle" v="square"/><prop k="customdash" v="5;2"/><prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="customdash_unit" v="MM"/><prop k="dash_pattern_offset" v="0"/><prop k="dash_pattern_offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="dash_pattern_offset_unit" v="MM"/><prop k="draw_inside_polygon" v="0"/><prop k="joinstyle" v="bevel"/><prop k="line_color" v="0,0,0,255"/><prop k="line_style" v="solid"/><prop k="line_width" v="0.36"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="ring_filter" v="0"/><prop k="trim_distance_end" v="0"/><prop k="trim_distance_end_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="trim_distance_end_unit" v="MM"/><prop k="trim_distance_start" v="0"/><prop k="trim_distance_start_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="trim_distance_start_unit" v="MM"/><prop k="tweak_dash_pattern_on_corners" v="0"/><prop k="use_custom_dash" v="0"/><prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/><data_defined_properties><Option type="Map"><Option value="" name="name" type="QString"/><Option name="properties"/><Option value="collection" name="type" type="QString"/></Option></data_defined_properties></layer></symbol>', '{{NUMERACAO}}', iterator::text);
      
      iterator := iterator + 1;

      rules_txt := rules_txt || '<rule symbol="' ||  iterator || '" key="{' || uuid_generate_v4() ||'}" label="restrição exec" filter="restrito_pre IS FALSE AND restrito_exec IS TRUE"/>';
      symbols_txt := symbols_txt || replace('<symbol type="fill" clip_to_extent="1" alpha="1" name="{{NUMERACAO}}" force_rhr="0"><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties><layer enabled="1" locked="0" pass="0" class="PointPatternFill"><Option type="Map"><Option type="double" name="angle" value="0"/><Option type="QString" name="clip_mode" value="shape"/><Option type="QString" name="coordinate_reference" value="feature"/><Option type="QString" name="displacement_x" value="1.2"/><Option type="QString" name="displacement_x_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="displacement_x_unit" value="MM"/><Option type="QString" name="displacement_y" value="0"/><Option type="QString" name="displacement_y_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="displacement_y_unit" value="MM"/><Option type="QString" name="distance_x" value="4"/><Option type="QString" name="distance_x_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="distance_x_unit" value="MM"/><Option type="QString" name="distance_y" value="4"/><Option type="QString" name="distance_y_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="distance_y_unit" value="MM"/><Option type="QString" name="offset_x" value="0"/><Option type="QString" name="offset_x_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_x_unit" value="MM"/><Option type="QString" name="offset_y" value="0"/><Option type="QString" name="offset_y_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_y_unit" value="MM"/><Option type="QString" name="outline_width_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="outline_width_unit" value="MM"/><Option type="QString" name="random_deviation_x" value="0"/><Option type="QString" name="random_deviation_x_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="random_deviation_x_unit" value="MM"/><Option type="QString" name="random_deviation_y" value="0"/><Option type="QString" name="random_deviation_y_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="random_deviation_y_unit" value="MM"/><Option type="QString" name="seed" value="930092414"/></Option><prop v="0" k="angle"/><prop v="shape" k="clip_mode"/><prop v="feature" k="coordinate_reference"/><prop v="1.2" k="displacement_x"/><prop v="3x:0,0,0,0,0,0" k="displacement_x_map_unit_scale"/><prop v="MM" k="displacement_x_unit"/><prop v="0" k="displacement_y"/><prop v="3x:0,0,0,0,0,0" k="displacement_y_map_unit_scale"/><prop v="MM" k="displacement_y_unit"/><prop v="4" k="distance_x"/><prop v="3x:0,0,0,0,0,0" k="distance_x_map_unit_scale"/><prop v="MM" k="distance_x_unit"/><prop v="4" k="distance_y"/><prop v="3x:0,0,0,0,0,0" k="distance_y_map_unit_scale"/><prop v="MM" k="distance_y_unit"/><prop v="0" k="offset_x"/><prop v="3x:0,0,0,0,0,0" k="offset_x_map_unit_scale"/><prop v="MM" k="offset_x_unit"/><prop v="0" k="offset_y"/><prop v="3x:0,0,0,0,0,0" k="offset_y_map_unit_scale"/><prop v="MM" k="offset_y_unit"/><prop v="3x:0,0,0,0,0,0" k="outline_width_map_unit_scale"/><prop v="MM" k="outline_width_unit"/><prop v="0" k="random_deviation_x"/><prop v="3x:0,0,0,0,0,0" k="random_deviation_x_map_unit_scale"/><prop v="MM" k="random_deviation_x_unit"/><prop v="0" k="random_deviation_y"/><prop v="3x:0,0,0,0,0,0" k="random_deviation_y_map_unit_scale"/><prop v="MM" k="random_deviation_y_unit"/><prop v="930092414" k="seed"/><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties><symbol type="marker" clip_to_extent="1" alpha="1" name="@0@0" force_rhr="0"><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties><layer enabled="1" locked="0" pass="0" class="SimpleMarker"><Option type="Map"><Option type="QString" name="angle" value="0"/><Option type="QString" name="cap_style" value="square"/><Option type="QString" name="color" value="0,0,0,255"/><Option type="QString" name="horizontal_anchor_point" value="1"/><Option type="QString" name="joinstyle" value="bevel"/><Option type="QString" name="name" value="cross2"/><Option type="QString" name="offset" value="0,0"/><Option type="QString" name="offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_unit" value="MM"/><Option type="QString" name="outline_color" value="0,0,0,255"/><Option type="QString" name="outline_style" value="solid"/><Option type="QString" name="outline_width" value="0.3"/><Option type="QString" name="outline_width_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="outline_width_unit" value="MM"/><Option type="QString" name="scale_method" value="diameter"/><Option type="QString" name="size" value="2"/><Option type="QString" name="size_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="size_unit" value="MM"/><Option type="QString" name="vertical_anchor_point" value="1"/></Option><prop v="0" k="angle"/><prop v="square" k="cap_style"/><prop v="0,0,0,255" k="color"/><prop v="1" k="horizontal_anchor_point"/><prop v="bevel" k="joinstyle"/><prop v="cross2" k="name"/><prop v="0,0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0,0,0,255" k="outline_color"/><prop v="solid" k="outline_style"/><prop v="0.3" k="outline_width"/><prop v="3x:0,0,0,0,0,0" k="outline_width_map_unit_scale"/><prop v="MM" k="outline_width_unit"/><prop v="diameter" k="scale_method"/><prop v="2" k="size"/><prop v="3x:0,0,0,0,0,0" k="size_map_unit_scale"/><prop v="MM" k="size_unit"/><prop v="1" k="vertical_anchor_point"/><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties></layer></symbol></layer><layer enabled="1" locked="0" pass="0" class="SimpleLine"><Option type="Map"><Option type="QString" name="align_dash_pattern" value="0"/><Option type="QString" name="capstyle" value="square"/><Option type="QString" name="customdash" value="5;2"/><Option type="QString" name="customdash_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="customdash_unit" value="MM"/><Option type="QString" name="dash_pattern_offset" value="0"/><Option type="QString" name="dash_pattern_offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="dash_pattern_offset_unit" value="MM"/><Option type="QString" name="draw_inside_polygon" value="0"/><Option type="QString" name="joinstyle" value="bevel"/><Option type="QString" name="line_color" value="0,0,0,255"/><Option type="QString" name="line_style" value="solid"/><Option type="QString" name="line_width" value="0.36"/><Option type="QString" name="line_width_unit" value="MM"/><Option type="QString" name="offset" value="0"/><Option type="QString" name="offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_unit" value="MM"/><Option type="QString" name="ring_filter" value="0"/><Option type="QString" name="trim_distance_end" value="0"/><Option type="QString" name="trim_distance_end_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="trim_distance_end_unit" value="MM"/><Option type="QString" name="trim_distance_start" value="0"/><Option type="QString" name="trim_distance_start_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="trim_distance_start_unit" value="MM"/><Option type="QString" name="tweak_dash_pattern_on_corners" value="0"/><Option type="QString" name="use_custom_dash" value="0"/><Option type="QString" name="width_map_unit_scale" value="3x:0,0,0,0,0,0"/></Option><prop v="0" k="align_dash_pattern"/><prop v="square" k="capstyle"/><prop v="5;2" k="customdash"/><prop v="3x:0,0,0,0,0,0" k="customdash_map_unit_scale"/><prop v="MM" k="customdash_unit"/><prop v="0" k="dash_pattern_offset"/><prop v="3x:0,0,0,0,0,0" k="dash_pattern_offset_map_unit_scale"/><prop v="MM" k="dash_pattern_offset_unit"/><prop v="0" k="draw_inside_polygon"/><prop v="bevel" k="joinstyle"/><prop v="0,0,0,255" k="line_color"/><prop v="solid" k="line_style"/><prop v="0.36" k="line_width"/><prop v="MM" k="line_width_unit"/><prop v="0" k="offset"/><prop v="3x:0,0,0,0,0,0" k="offset_map_unit_scale"/><prop v="MM" k="offset_unit"/><prop v="0" k="ring_filter"/><prop v="0" k="trim_distance_end"/><prop v="3x:0,0,0,0,0,0" k="trim_distance_end_map_unit_scale"/><prop v="MM" k="trim_distance_end_unit"/><prop v="0" k="trim_distance_start"/><prop v="3x:0,0,0,0,0,0" k="trim_distance_start_map_unit_scale"/><prop v="MM" k="trim_distance_start_unit"/><prop v="0" k="tweak_dash_pattern_on_corners"/><prop v="0" k="use_custom_dash"/><prop v="3x:0,0,0,0,0,0" k="width_map_unit_scale"/><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties></layer></symbol>', '{{NUMERACAO}}', iterator::text);


      iterator := iterator + 1;

      FOR r IN SELECT se.id, e.code AS tipo_etapa_id, e.nome, rank() OVER (PARTITION BY e.nome ORDER BY se.ordem) as numero 
      FROM (SELECT code, nome, CASE WHEN nome = 'Revisão final' THEN 'Revisão' ELSE nome END AS tipo FROM dominio.tipo_etapa) AS e 
      INNER JOIN producao.etapa AS se ON e.code = se.tipo_etapa_id
      WHERE se.subfase_id = subfase_ident AND se.lote_id = lote_ident
      ORDER BY se.ordem
      LOOP
        SELECT 's_' || iterator - 2 || '_' || replace(translate(replace(lower(r.nome),' ', '_'),  
          'àáâãäéèëêíìïîóòõöôúùüûçÇ/-|/\,.;:<>?!`{}[]()~`@#$%^&*+=''',  
          'aaaaaeeeeiiiiooooouuuucc________________________________') || '_' || r.numero, 'execucao_1', 'execucao')
          INTO nome_fixed;

        view_txt := view_txt || ', CASE WHEN ee' || iterator || '.etapa_id IS NULL THEN ''-'' ELSE  ee' || iterator || '.id::text END AS ' || nome_fixed || '_atividade_id';
        view_txt := view_txt || ', CASE WHEN ee' || iterator || '.etapa_id IS NULL THEN ''-'' ELSE  tpg' || iterator || '.nome_abrev::text || '' '' || u' || iterator || '.nome_guerra::text END AS ' || nome_fixed || '_usuario';
        view_txt := view_txt || ', CASE WHEN ee' || iterator || '.etapa_id IS NULL THEN ''-'' ELSE  ts' || iterator || '.nome::text END AS ' || nome_fixed || '_situacao';
        view_txt := view_txt || ', CASE WHEN ee' || iterator || '.etapa_id IS NULL THEN ''-'' ELSE  ee' || iterator || '.data_inicio::text END AS ' || nome_fixed || '_data_inicio';
        view_txt := view_txt || ', CASE WHEN ee' || iterator || '.etapa_id IS NULL THEN ''-'' ELSE  ee' || iterator || '.data_fim::text END AS ' || nome_fixed || '_data_fim';
        jointxt := jointxt || ' LEFT JOIN producao.atividade as ee' || iterator || ' ON ee' || iterator || '.unidade_trabalho_id = ut.id and ee' || iterator || '.etapa_id = ' || r.id;
        jointxt := jointxt || ' LEFT JOIN dominio.tipo_situacao_atividade as ts' || iterator || ' ON ts' || iterator || '.code = ee' || iterator || '.tipo_situacao_atividade_id';
        jointxt := jointxt || ' LEFT JOIN dgeo.usuario as u' || iterator || ' ON u' || iterator || '.uuid = ee' || iterator || '.usuario_uuid';
        jointxt := jointxt || ' LEFT JOIN dominio.tipo_posto_grad as tpg' || iterator || ' ON tpg' || iterator || '.code = u' || iterator || '.tipo_posto_grad_id';
        wheretxt := wheretxt || ' AND (ee' || iterator || '.tipo_situacao_atividade_id IS NULL OR ee' || iterator || '.tipo_situacao_atividade_id in (1,2,3,4))';


        rules_txt := rules_txt || '<rule symbol="' ||  (3*iterator - 3) || '" key="{' || uuid_generate_v4() ||'}" label="' || nome_fixed || ' não iniciada" filter="' || etapas_concluidas_txt || nome_fixed || '_situacao IN (''Não iniciada'') "/>';
        rules_txt := rules_txt || '<rule symbol="' ||  (3*iterator - 2) || '" key="{' || uuid_generate_v4() ||'}" label="' || nome_fixed || ' em andamento" filter="' || etapas_concluidas_txt || nome_fixed || '_situacao IN (''Em execução'') "/>';
        rules_txt := rules_txt || '<rule symbol="' ||  (3*iterator - 1) || '" key="{' || uuid_generate_v4() ||'}" label="' || nome_fixed || ' pausada" filter="' || etapas_concluidas_txt || nome_fixed || '_situacao IN (''Pausada'') "/>';
 
        IF r.tipo_etapa_id = 1 THEN
          tipo_pausada_txt := exec_pausada_txt;
          tipo_andamento_txt := exec_andamento_txt;
          tipo_txt := exec_txt;
        ELSIF r.tipo_etapa_id = 2 OR r.tipo_etapa_id = 5 THEN
          tipo_pausada_txt := replace(rev_pausada_txt, '{{ORDEM}}', r.numero::text);
          tipo_andamento_txt := replace(rev_andamento_txt, '{{ORDEM}}', r.numero::text);
          tipo_txt := replace(rev_txt, '{{ORDEM}}', r.numero::text);
        ELSIF r.tipo_etapa_id = 3 THEN
          tipo_pausada_txt := replace(cor_pausada_txt, '{{ORDEM}}', r.numero::text);
          tipo_andamento_txt := replace(cor_andamento_txt, '{{ORDEM}}', r.numero::text);
          tipo_txt := replace(cor_txt, '{{ORDEM}}', r.numero::text);
        ELSIF r.tipo_etapa_id = 4 THEN
          tipo_pausada_txt := replace(revcor_pausada_txt, '{{ORDEM}}', r.numero::text);
          tipo_andamento_txt := replace(revcor_andamento_txt, '{{ORDEM}}', r.numero::text);
          tipo_txt := replace(revcor_txt, '{{ORDEM}}', r.numero::text);
        END IF;

        symbols_txt := symbols_txt || replace(tipo_txt, '{{NUMERACAO}}', (3*iterator - 3)::text);
        symbols_txt := symbols_txt || replace(tipo_andamento_txt, '{{NUMERACAO}}', (3*iterator - 2)::text);
        symbols_txt := symbols_txt || replace(tipo_pausada_txt, '{{NUMERACAO}}', (3*iterator - 1)::text);

        etapas_concluidas_txt := etapas_concluidas_txt || nome_fixed || '_situacao IN (''Finalizada'',''Não será executada'',''-'') AND ';
        etapas_nome := etapas_nome || nome_fixed || '_situacao, ';
        iterator := iterator + 1;

      END LOOP;

      view_txt := view_txt || ' FROM producao.unidade_trabalho AS ut';
      view_txt := view_txt || jointxt;
      view_txt := view_txt || ' LEFT JOIN producao.bloco AS l ON l.id = ut.bloco_id';
      view_txt := view_txt || ' LEFT JOIN producao.dado_producao AS dp ON dp.id = ut.dado_producao_id';
      view_txt := view_txt || ' LEFT JOIN dominio.tipo_dado_producao AS tdp ON tdp.code = dp.tipo_dado_producao_id';

      view_txt := view_txt || ' LEFT JOIN (
      SELECT ut.id FROM producao.unidade_trabalho as ut
      INNER JOIN producao.atividade AS a ON a.unidade_trabalho_id = ut.id
      INNER JOIN producao.relacionamento_ut AS ut_sr ON ut_sr.ut_id = a.unidade_trabalho_id
      INNER JOIN producao.atividade AS a_re ON a_re.unidade_trabalho_id = ut_sr.ut_re_id
      WHERE (a_re.tipo_situacao_atividade_id IN (1, 2, 3) AND ut_sr.tipo_pre_requisito_id = 1)
      AND a.tipo_situacao_atividade_id = 1
      AND ut.subfase_id = ' || subfase_ident || ' AND ut.lote_id = ' || lote_ident || '
      GROUP BY ut.id) AS rest_pre ON rest_pre.id = ut.id';

      view_txt := view_txt || ' LEFT JOIN (
      SELECT ut.id FROM producao.unidade_trabalho as ut
      INNER JOIN producao.atividade AS a ON a.unidade_trabalho_id = ut.id
      INNER JOIN producao.relacionamento_ut AS ut_sr ON ut_sr.ut_id = a.unidade_trabalho_id
      INNER JOIN producao.atividade AS a_re ON a_re.unidade_trabalho_id = ut_sr.ut_re_id
      WHERE (a_re.tipo_situacao_atividade_id IN (2) AND ut_sr.tipo_pre_requisito_id = 2)
      AND a.tipo_situacao_atividade_id = 1
      AND ut.subfase_id = ' || subfase_ident || ' AND ut.lote_id = ' || lote_ident || '
      GROUP BY ut.id) AS rest_exec ON rest_exec.id = ut.id';

      view_txt := view_txt || ' WHERE ut.subfase_id = ' || subfase_ident || ' AND ut.lote_id = ' || lote_ident;
      view_txt := view_txt || wheretxt;
      view_txt := view_txt || ' ORDER BY ut.prioridade;';


      IF view_txt != '' THEN
        EXECUTE view_txt;
        EXECUTE 'GRANT SELECT ON TABLE acompanhamento.lote_' || lote_ident || '_subfase_' || subfase_ident || ' TO PUBLIC';
        EXECUTE 'CREATE INDEX lote_' || lote_ident || '_subfase_' || subfase_ident || '_geom ON acompanhamento.lote_' || lote_ident || '_subfase_' || subfase_ident || ' USING gist (geom);';
        EXECUTE 'CREATE UNIQUE INDEX lote_' || lote_ident || '_subfase_' || subfase_ident || '_id ON acompanhamento.lote_' || lote_ident || '_subfase_' || subfase_ident || ' (id);';
        EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_ident || '_subfase_' || subfase_ident;

        iterator := 3*iterator - 3;

        rules_txt := rules_txt || '<rule symbol="' ||  iterator || '" key="{' || uuid_generate_v4() ||'}" label="Concluído" filter="' || etapas_concluidas_txt || ' TRUE"/>';
        symbols_txt := symbols_txt || replace('<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="0.5"> <layer class="SimpleFill" locked="0" enabled="1" pass="0"> <prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="color" v="26,150,65,255"/> <prop k="joinstyle" v="bevel"/> <prop k="offset" v="0,0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="outline_color" v="0,0,0,255"/> <prop k="outline_style" v="solid"/> <prop k="outline_width" v="0.26"/> <prop k="outline_width_unit" v="MM"/> <prop k="style" v="solid"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol>', '{{NUMERACAO}}', iterator::text);
        iterator := iterator + 1;

        rules_txt := rules_txt || '<rule symbol="' ||  iterator || '" key="{' || uuid_generate_v4() ||'}" label="Não disponível" filter="(disponivel is not true and disponivel is not null)"/>';
        symbols_txt := symbols_txt || replace('<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"> <layer class="GeometryGenerator" locked="0" enabled="1" pass="0"> <prop k="SymbolType" v="Line"/> <prop k="geometryModifier" v=" intersection( make_line(make_point(x_max( bounds( $geometry )), y_min( bounds( $geometry ))) ,make_point(x_min( bounds( $geometry )), y_max( bounds( $geometry )))), $geometry )&#xd;&#xa; "/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> <symbol force_rhr="0" name="@{{NUMERACAO}}@0" type="line" clip_to_extent="1" alpha="1"> <layer class="SimpleLine" locked="0" enabled="1" pass="0"> <prop k="capstyle" v="square"/> <prop k="customdash" v="5;2"/> <prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="customdash_unit" v="MM"/> <prop k="draw_inside_polygon" v="0"/> <prop k="joinstyle" v="bevel"/> <prop k="line_color" v="255,255,255,255"/> <prop k="line_style" v="solid"/> <prop k="line_width" v="2"/> <prop k="line_width_unit" v="MM"/> <prop k="offset" v="0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="ring_filter" v="0"/> <prop k="use_custom_dash" v="0"/> <prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol> </layer> <layer class="GeometryGenerator" locked="0" enabled="1" pass="0"> <prop k="SymbolType" v="Line"/> <prop k="geometryModifier" v=" intersection( make_line(make_point(x_max( bounds( $geometry )), y_max( bounds( $geometry ))) ,make_point(x_min( bounds( $geometry )), y_min( bounds( $geometry )))), $geometry )&#xd;&#xa; "/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> <symbol force_rhr="0" name="@{{NUMERACAO}}@1" type="line" clip_to_extent="1" alpha="1"> <layer class="SimpleLine" locked="0" enabled="1" pass="0"> <prop k="capstyle" v="square"/> <prop k="customdash" v="5;2"/> <prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="customdash_unit" v="MM"/> <prop k="draw_inside_polygon" v="0"/> <prop k="joinstyle" v="bevel"/> <prop k="line_color" v="255,255,255,255"/> <prop k="line_style" v="solid"/> <prop k="line_width" v="2"/> <prop k="line_width_unit" v="MM"/> <prop k="offset" v="0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="ring_filter" v="0"/> <prop k="use_custom_dash" v="0"/> <prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol> </layer> <layer class="GeometryGenerator" locked="0" enabled="1" pass="0"> <prop k="SymbolType" v="Line"/> <prop k="geometryModifier" v=" intersection( make_line(make_point(x_max( bounds( $geometry )), y_min( bounds( $geometry ))) ,make_point(x_min( bounds( $geometry )), y_max( bounds( $geometry )))), $geometry )&#xd;&#xa; "/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> <symbol force_rhr="0" name="@{{NUMERACAO}}@2" type="line" clip_to_extent="1" alpha="1"> <layer class="SimpleLine" locked="0" enabled="1" pass="0"> <prop k="capstyle" v="square"/> <prop k="customdash" v="5;2"/> <prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="customdash_unit" v="MM"/> <prop k="draw_inside_polygon" v="0"/> <prop k="joinstyle" v="bevel"/> <prop k="line_color" v="251,154,153,255"/> <prop k="line_style" v="solid"/> <prop k="line_width" v="1"/> <prop k="line_width_unit" v="MM"/> <prop k="offset" v="0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="ring_filter" v="0"/> <prop k="use_custom_dash" v="0"/> <prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol> </layer> <layer class="GeometryGenerator" locked="0" enabled="1" pass="0"> <prop k="SymbolType" v="Line"/> <prop k="geometryModifier" v=" intersection( make_line(make_point(x_max( bounds( $geometry )), y_max( bounds( $geometry ))) ,make_point(x_min( bounds( $geometry )), y_min( bounds( $geometry )))), $geometry )&#xd;&#xa; "/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> <symbol force_rhr="0" name="@{{NUMERACAO}}@3" type="line" clip_to_extent="1" alpha="1"> <layer class="SimpleLine" locked="0" enabled="1" pass="0"> <prop k="capstyle" v="square"/> <prop k="customdash" v="5;2"/> <prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="customdash_unit" v="MM"/> <prop k="draw_inside_polygon" v="0"/> <prop k="joinstyle" v="bevel"/> <prop k="line_color" v="251,154,153,255"/> <prop k="line_style" v="solid"/> <prop k="line_width" v="1"/> <prop k="line_width_unit" v="MM"/> <prop k="offset" v="0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="ring_filter" v="0"/> <prop k="use_custom_dash" v="0"/> <prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol> </layer> </symbol>', '{{NUMERACAO}}', iterator::text);
        iterator := iterator + 1;
      
        rules_txt := rules_txt || '<rule symbol="' ||  iterator || '" key="{' || uuid_generate_v4() ||'}" label="ERRO" filter="ELSE"/>';
        symbols_txt := symbols_txt || replace('<symbol force_rhr="0" name="{{NUMERACAO}}" type="fill" clip_to_extent="1" alpha="1"> <layer class="SimpleFill" locked="0" enabled="1" pass="0"> <prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="color" v="25,4,250,255"/> <prop k="joinstyle" v="bevel"/> <prop k="offset" v="0,0"/> <prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/> <prop k="offset_unit" v="MM"/> <prop k="outline_color" v="0,0,0,255"/> <prop k="outline_style" v="solid"/> <prop k="outline_width" v="0.26"/> <prop k="outline_width_unit" v="MM"/> <prop k="style" v="solid"/> <data_defined_properties> <Option type="Map"> <Option name="name" type="QString" value=""/> <Option name="properties"/> <Option name="type" type="QString" value="collection"/> </Option> </data_defined_properties> </layer> </symbol>', '{{NUMERACAO}}', iterator::text);

        estilo_txt := '<!DOCTYPE qgis PUBLIC ''http://mrcc.com/qgis.dtd'' ''SYSTEM''>';
        estilo_txt := estilo_txt || '<qgis styleCategories="Symbology|Labeling" labelsEnabled="1" version="3.4.10-Madeira">';
        estilo_txt := estilo_txt || '<renderer-v2 symbollevels="0" forceraster="0" type="RuleRenderer" enableorderby="0">';
        estilo_txt := estilo_txt || '<rules key="{' || uuid_generate_v4() || '}">' || rules_txt;
        estilo_txt := estilo_txt || '</rules><symbols>' || symbols_txt;
        estilo_txt := estilo_txt || '</symbols></renderer-v2><blendMode>0</blendMode><featureBlendMode>0</featureBlendMode><layerGeometryType>2</layerGeometryType></qgis>';

        INSERT INTO public.layer_styles(f_table_catalog, f_table_schema, f_table_name, f_geometry_column, stylename, styleqml, stylesld, useasdefault, owner, ui, update_time) VALUES
        (current_database(), 'acompanhamento', 'lote_' || lote_ident || '_subfase_'|| subfase_ident, 'geom', 'acompanhamento_subfase', estilo_txt, NULL, TRUE, current_user, NULL, now());
      END IF;
    END IF;
  END;
$$
LANGUAGE plpgsql VOLATILE
  COST 100;


CREATE OR REPLACE FUNCTION acompanhamento.cria_view_acompanhamento_subfase()
  RETURNS trigger AS
$BODY$
    DECLARE subfase_ident integer;
    DECLARE lote_ident bigint;
    BEGIN

    IF TG_OP = 'DELETE' THEN
      subfase_ident := OLD.subfase_id;
      lote_ident := OLD.lote_id;
    ELSE
      subfase_ident := NEW.subfase_id;
      lote_ident := NEW.lote_id;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS acompanhamento.lote_' || OLD.lote_id || '_subfase_'|| OLD.subfase_id;
      EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS acompanhamento.lote_' || NEW.lote_id || '_subfase_'|| NEW.subfase_id;
    ELSE
      EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS acompanhamento.lote_' || lote_ident || '_subfase_'|| subfase_ident;
    END IF;


    DELETE FROM public.layer_styles
    WHERE f_table_schema = 'acompanhamento' AND f_table_name = ('lote_' || lote_ident || '_subfase_'|| subfase_ident) AND stylename = 'acompanhamento_subfase';

    PERFORM acompanhamento.cria_view_acompanhamento_subfase(subfase_ident, lote_ident);

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER cria_view_acompanhamento_subfase
AFTER UPDATE OR INSERT OR DELETE ON producao.etapa
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.cria_view_acompanhamento_subfase();

-- ---------------------------------------------------------------------------
-- A view do LOTE: uma linha por versao, uma coluna de datas por fase
-- ---------------------------------------------------------------------------
--
-- CUIDADO COM O NOME DA VIEW GERADA. Ela passou a se chamar
-- `acompanhamento.lote_<L>_linha_<P>`, com L o `acervo.lote.id` e P o
-- `producao.linha_producao.id`, e o nome do SAP (`lote_<N>`) NAO sobreviveu.
--
-- NAO E ESTETICA, e a alternativa nao existe. Esta view e uma MATRIZ DE FASES,
-- e as fases sao da linha de producao: uma coluna de data de inicio e uma de
-- fim por fase, e um estilo que pinta a folha pela fase em que ela esta. Um
-- lote do acervo atravessa linhas de producao -- 61 dos 102 lotes com versao
-- carregam mais de um subtipo, medido em 2026-08-09 --, entao uma view por
-- lote do acervo teria de misturar as fases da carta com as do CDGV. Com o
-- nome antigo, o segundo `CREATE MATERIALIZED VIEW` do mesmo lote encontraria o
-- primeiro e a criacao morreria com "already exists".
--
-- NAO HA PROJETO QGIS A QUEBRAR: a 3.0.0 nunca foi aplicada, e o N do SAP era
-- um `macrocontrole.lote.id`, que nao existe neste banco.
--
-- ESTA FUNCAO NAO E RENOME SIMPLES, e por isso esta escrita a mao. O que ela
-- listava era `macrocontrole.produto`, que nao atravessa: o produto do SAP e a
-- VERSAO do acervo. A troca leva junto quatro consequencias:
--
--   1. `p.uuid` virou `v.uuid_versao`, que e como o acervo chama a coluna.
--   2. `p.mi`, `p.inom` e `p.geom` moram em `acervo.produto`, e nao na versao:
--      entra o salto por `v.produto_id`.
--   3. `p.denominador_escala` nao existe no acervo. O que existe e
--      `tipo_escala_id`, e a view publica o NOME da escala. Quem precisa do
--      denominador de um produto especial le
--      `acervo.produto.denominador_escala_especial`.
--   4. `dominio.tipo_produto` do SAP e o `dominio.subtipo_produto` do SCA,
--      codigo a codigo. A coluna da view passa a se chamar `subtipo_produto`
--      de proposito: `dominio.tipo_produto` existe aqui e e OUTRA coisa.
--
-- O FILTRO TAMBEM MUDOU, E TEM DUAS PARTES. O SAP filtrava por `p.lote_id`, o
-- lote a que o produto pertence, e bastava porque la um lote era uma linha de
-- producao so. Aqui o recorte passa pela unidade de trabalho (entram as versoes
-- que este lote esta de fato produzindo) E pela LINHA da subfase dessa unidade
-- de trabalho. A segunda parte e obrigatoria: sem ela, a view da carta listaria
-- tambem as folhas de CDGV do mesmo lote, porque `producao.relacionamento_versao`
-- as liga a unidades de trabalho do MESMO lote, so que de outra linha.
--
-- O `INNER JOIN macrocontrole.produto ... ON p.lote_id = ut.lote_id` que havia
-- DENTRO da subconsulta de cada fase foi retirado. Ele nao filtrava nada e nao
-- alterava os agregados (multiplicava por igual o `count(*)` e o
-- `count(a.data_fim)` da comparacao), so multiplicava linhas.
CREATE OR REPLACE FUNCTION acompanhamento.cria_view_acompanhamento_lote(lote_ident bigint, linhaproducao_ident integer)
  RETURNS void AS
$$
  DECLARE view_txt text;
  DECLARE nome_view text;
  DECLARE jointxt text := '';
  DECLARE num integer;
  DECLARE nome_fixed text;
  DECLARE r record;
  DECLARE iterator integer := 1;
  DECLARE rules_txt text := '';
  DECLARE estilo_txt text := '';
  DECLARE fases_concluidas_txt text := '';
  DECLARE symbols_txt text := '';
  DECLARE tipo_txt text := '';
  DECLARE tipo_andamento_txt text := '';
  BEGIN
    SELECT count(*) INTO num FROM producao.fase WHERE linha_producao_id = linhaproducao_ident;

    IF num > 0 THEN
      nome_view := 'lote_' || lote_ident || '_linha_' || linhaproducao_ident;

      view_txt := 'CREATE MATERIALIZED VIEW acompanhamento.' || nome_view || ' AS
      SELECT v.id, v.uuid_versao AS uuid, v.nome, pr.mi, pr.inom, te.nome AS escala, sp.nome AS subtipo_produto, pr.geom';

      tipo_txt := '<symbol force_rhr="0" type="fill" name="{{NUMERACAO}}" alpha="1" clip_to_extent="1"><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties><layer class="SimpleFill" pass="0" enabled="1" locked="0"><Option type="Map"><Option type="QString" name="border_width_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="color" value="{{COR}},255"/><Option type="QString" name="joinstyle" value="bevel"/><Option type="QString" name="offset" value="0,0"/><Option type="QString" name="offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_unit" value="MM"/><Option type="QString" name="outline_color" value="0,0,0,255"/><Option type="QString" name="outline_style" value="solid"/><Option type="QString" name="outline_width" value="0.26"/><Option type="QString" name="outline_width_unit" value="MM"/><Option type="QString" name="style" value="solid"/></Option><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="{{COR}},255"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties></layer></symbol>';
      tipo_andamento_txt := '<symbol force_rhr="0" type="fill" name="{{NUMERACAO}}" alpha="1" clip_to_extent="1"><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties><layer class="SimpleFill" pass="0" enabled="1" locked="0"><Option type="Map"><Option type="QString" name="border_width_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="color" value="{{COR}},255"/><Option type="QString" name="joinstyle" value="bevel"/><Option type="QString" name="offset" value="0,0"/><Option type="QString" name="offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_unit" value="MM"/><Option type="QString" name="outline_color" value="0,0,0,255"/><Option type="QString" name="outline_style" value="solid"/><Option type="QString" name="outline_width" value="0.26"/><Option type="QString" name="outline_width_unit" value="MM"/><Option type="QString" name="style" value="solid"/></Option><prop k="border_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="color" v="{{COR}},255"/><prop k="joinstyle" v="bevel"/><prop k="offset" v="0,0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_style" v="solid"/><prop k="outline_width" v="0.26"/><prop k="outline_width_unit" v="MM"/><prop k="style" v="solid"/><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties></layer><layer class="LinePatternFill" pass="0" enabled="1" locked="0"><Option type="Map"><Option type="QString" name="angle" value="45"/><Option type="QString" name="color" value="0,0,255,255"/><Option type="QString" name="distance" value="1"/><Option type="QString" name="distance_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="distance_unit" value="MM"/><Option type="QString" name="line_width" value="0.26"/><Option type="QString" name="line_width_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="line_width_unit" value="MM"/><Option type="QString" name="offset" value="0"/><Option type="QString" name="offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_unit" value="MM"/><Option type="QString" name="outline_width_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="outline_width_unit" value="MM"/></Option><prop k="angle" v="45"/><prop k="color" v="0,0,255,255"/><prop k="distance" v="1"/><prop k="distance_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="distance_unit" v="MM"/><prop k="line_width" v="0.26"/><prop k="line_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="outline_width_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="outline_width_unit" v="MM"/><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties><symbol force_rhr="0" type="line" name="@{{NUMERACAO}}@1" alpha="1" clip_to_extent="1"><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties><layer class="SimpleLine" pass="0" enabled="1" locked="0"><Option type="Map"><Option type="QString" name="align_dash_pattern" value="0"/><Option type="QString" name="capstyle" value="square"/><Option type="QString" name="customdash" value="5;2"/><Option type="QString" name="customdash_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="customdash_unit" value="MM"/><Option type="QString" name="dash_pattern_offset" value="0"/><Option type="QString" name="dash_pattern_offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="dash_pattern_offset_unit" value="MM"/><Option type="QString" name="draw_inside_polygon" value="0"/><Option type="QString" name="joinstyle" value="bevel"/><Option type="QString" name="line_color" value="0,0,0,255"/><Option type="QString" name="line_style" value="solid"/><Option type="QString" name="line_width" value="0.26"/><Option type="QString" name="line_width_unit" value="MM"/><Option type="QString" name="offset" value="0"/><Option type="QString" name="offset_map_unit_scale" value="3x:0,0,0,0,0,0"/><Option type="QString" name="offset_unit" value="MM"/><Option type="QString" name="ring_filter" value="0"/><Option type="QString" name="tweak_dash_pattern_on_corners" value="0"/><Option type="QString" name="use_custom_dash" value="0"/><Option type="QString" name="width_map_unit_scale" value="3x:0,0,0,0,0,0"/></Option><prop k="align_dash_pattern" v="0"/><prop k="capstyle" v="square"/><prop k="customdash" v="5;2"/><prop k="customdash_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="customdash_unit" v="MM"/><prop k="dash_pattern_offset" v="0"/><prop k="dash_pattern_offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="dash_pattern_offset_unit" v="MM"/><prop k="draw_inside_polygon" v="0"/><prop k="joinstyle" v="bevel"/><prop k="line_color" v="0,0,0,255"/><prop k="line_style" v="solid"/><prop k="line_width" v="0.26"/><prop k="line_width_unit" v="MM"/><prop k="offset" v="0"/><prop k="offset_map_unit_scale" v="3x:0,0,0,0,0,0"/><prop k="offset_unit" v="MM"/><prop k="ring_filter" v="0"/><prop k="tweak_dash_pattern_on_corners" v="0"/><prop k="use_custom_dash" v="0"/><prop k="width_map_unit_scale" v="3x:0,0,0,0,0,0"/><data_defined_properties><Option type="Map"><Option type="QString" name="name" value=""/><Option name="properties"/><Option type="QString" name="type" value="collection"/></Option></data_defined_properties></layer></symbol></layer></symbol>';

      FOR r in SELECT f.id, tf.nome, tf.cor, rank() OVER (PARTITION BY tf.nome ORDER BY f.ordem) as numero FROM producao.fase AS f
      INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
      WHERE f.linha_producao_id = linhaproducao_ident
      ORDER BY f.ordem
      LOOP

        IF r.numero > 1 THEN
          nome_fixed := 'f_' || iterator || '_' || translate(replace(lower(r.nome),' ', '_'),
                'àáâãäéèëêíìïîóòõöôúùüûçÇ/-|/\,.;:<>?!`{}[]()~`@#$%^&*+=''',
                'aaaaaeeeeiiiiooooouuuucc________________________________') || '_' || r.numero;
        ELSE
          nome_fixed := 'f_' || iterator || '_' || translate(replace(lower(r.nome),' ', '_'),
                'àáâãäéèëêíìïîóòõöôúùüûçÇ/-|/\,.;:<>?!`{}[]()~`@#$%^&*+=''',
                'aaaaaeeeeiiiiooooouuuucc________________________________');
        END IF;


        view_txt := view_txt || ', (CASE WHEN min(ut' || iterator || '.id) IS NOT NULL THEN min(ut' || iterator || '.data_inicio)::text ELSE ''-'' END) AS  ' || nome_fixed || '_data_inicio';
        view_txt := view_txt || ', (CASE WHEN min(ut' || iterator || '.id) IS NOT NULL THEN (CASE WHEN count(*) - count(ut' || iterator || '.data_fim) = 0 THEN max(ut' || iterator || '.data_fim)::text ELSE NULL END) ELSE ''-'' END) AS  ' || nome_fixed || '_data_fim';

        jointxt := jointxt || ' LEFT JOIN
          (SELECT ut.id, ut.geom, min(a.data_inicio) as data_inicio,
          (CASE WHEN count(*) - count(a.data_fim) = 0 THEN max(a.data_fim) ELSE NULL END) AS data_fim
          FROM producao.unidade_trabalho AS ut
          INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
          INNER JOIN
          (select unidade_trabalho_id, data_inicio, data_fim from producao.atividade) AS a
          ON a.unidade_trabalho_id = ut.id
          WHERE s.fase_id = ' || r.id || ' AND ut.lote_id = ' || lote_ident || '
          GROUP BY ut.id) AS ut' || iterator || ' ON ut' || iterator || '.id = rp.ut_id';

        rules_txt := rules_txt || '<rule symbol="' ||  (2*iterator - 2) || '" key="{' || uuid_generate_v4() ||'}" label="' || nome_fixed || ' não iniciada" filter="' || fases_concluidas_txt || nome_fixed || '_data_inicio IS NULL "/>';
        rules_txt := rules_txt || '<rule symbol="' ||  (2*iterator - 1) || '" key="{' || uuid_generate_v4() ||'}" label="' || nome_fixed || ' em execução" filter="' || fases_concluidas_txt || nome_fixed || '_data_fim IS NULL AND ' || nome_fixed || '_data_inicio IS NOT NULL"/>';

        fases_concluidas_txt := fases_concluidas_txt || nome_fixed || '_data_fim IS NOT NULL AND ';

        symbols_txt := symbols_txt || replace(replace(tipo_txt, '{{NUMERACAO}}', (2*iterator - 2)::text), '{{COR}}', r.cor);
        symbols_txt := symbols_txt || replace(replace(tipo_andamento_txt, '{{NUMERACAO}}', (2*iterator - 1)::text), '{{COR}}', r.cor);

        iterator := iterator + 1;

      END LOOP;

      -- No SAP a coluna se chamava `rp.p_id`, de produto. Em
      -- `producao.relacionamento_versao` ela e `versao_id`, e esta linha
      -- depende disso: se aquela tabela renomear a coluna, esta juncao vai
      -- junto.
      view_txt := view_txt || ' FROM acervo.versao AS v
      INNER JOIN acervo.produto AS pr ON pr.id = v.produto_id
      INNER JOIN producao.relacionamento_versao AS rp ON rp.versao_id = v.id
      INNER JOIN producao.unidade_trabalho AS utl ON utl.id = rp.ut_id
      INNER JOIN dominio.subtipo_produto AS sp ON sp.code = v.subtipo_produto_id
      INNER JOIN dominio.tipo_escala AS te ON te.code = pr.tipo_escala_id
      INNER JOIN producao.subfase AS sfl ON sfl.id = utl.subfase_id
      INNER JOIN producao.fase AS fl ON fl.id = sfl.fase_id';
      view_txt := view_txt || jointxt;
      -- GROUP BY com as DUAS chaves primarias: o Postgres so deduz dependencia
      -- funcional a partir da PK da tabela agrupada, entao `pr.mi`, `pr.inom` e
      -- `pr.geom` precisam de `pr.id` no grupo.
      view_txt := view_txt || ' WHERE utl.lote_id = ' || lote_ident || ' AND fl.linha_producao_id = ' || linhaproducao_ident || ' GROUP BY v.id, pr.id, te.nome, sp.nome;';

      EXECUTE view_txt;
      EXECUTE 'GRANT SELECT ON TABLE acompanhamento.' || nome_view || ' TO PUBLIC';
      EXECUTE 'CREATE INDEX ' || nome_view || '_geom ON acompanhamento.' || nome_view || ' USING gist (geom);';
      EXECUTE 'CREATE UNIQUE INDEX ' || nome_view || '_id ON acompanhamento.' || nome_view || ' (id);';
      EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.' || nome_view;

      iterator := 2*iterator - 2;
      rules_txt := rules_txt || '<rule symbol="' ||  iterator || '" key="{' || uuid_generate_v4() ||'}" label="Concluído" filter="' || fases_concluidas_txt || ' TRUE"/>';
      symbols_txt := symbols_txt || replace(replace(tipo_txt, '{{NUMERACAO}}', iterator::text), '{{COR}}', '26,152,80');

      estilo_txt := '<!DOCTYPE qgis PUBLIC ''http://mrcc.com/qgis.dtd'' ''SYSTEM''>';
      estilo_txt := estilo_txt || '<qgis styleCategories="Symbology" version="3.18.3-Zürich">';
      estilo_txt := estilo_txt || '<renderer-v2 forceraster="0" enableorderby="0" type="RuleRenderer" symbollevels="0">';
      estilo_txt := estilo_txt || '<rules key="{' || uuid_generate_v4() || '}">' || rules_txt;
      estilo_txt := estilo_txt || '</rules><symbols>' || symbols_txt;
      estilo_txt := estilo_txt || '</symbols></renderer-v2><blendMode>0</blendMode><featureBlendMode>0</featureBlendMode><layerGeometryType>2</layerGeometryType></qgis>';


      INSERT INTO public.layer_styles(f_table_catalog, f_table_schema, f_table_name, f_geometry_column, stylename, styleqml, stylesld, useasdefault, owner, ui, update_time) VALUES
      (current_database(), 'acompanhamento', nome_view, 'geom', 'acompanhamento_lote', estilo_txt, NULL, TRUE, current_user, NULL, now());

    END IF;
  END;
$$
LANGUAGE plpgsql VOLATILE
  COST 100;

-- ---------------------------------------------------------------------------
-- A view do BLOCO: quantos operadores e quantas atividades cada bloco tem
-- ---------------------------------------------------------------------------
--
-- Uma coluna por HABILITACAO, e nao por perfil de autorizacao. No SAP a tabela
-- se chamava `perfil_producao`; aqui "perfil" ja e autorizacao
-- (`dominio.tipo_perfil`, consulta/operador/gerente), entao ela atravessou como
-- `producao.habilitacao`. As colunas geradas continuam levando o NOME da
-- habilitacao, que e o que o gerente le no QGIS.
--
-- ESCRITA A MAO porque duas tabelas da cadeia nao atravessam.
-- `macrocontrole.lote` e `macrocontrole.projeto` nao existem (o lote e o
-- projeto sao os do acervo) e `dominio.status` tambem nao (quem responde por
-- status de execucao aqui e `dominio.tipo_status_execucao`, o mesmo que
-- `acervo.lote` ja usa). O caminho ficou curto: bloco -> acervo.lote ->
-- acervo.projeto.
--
-- A COLUNA `lote_linha` SAIU, e nada a substitui. Ela publicava o
-- `nome_abrev` da tabela removida, que era o unico consumidor dele. O bloco
-- e um recorte de DISTRIBUICAO do lote e nao pertence a uma linha de producao:
-- as unidades de trabalho dentro dele podem ser de subfases de linhas
-- diferentes, e uma coluna de linha aqui teria de escolher uma delas.
-- Quem quiser a leitura por linha abre a view de lote, que e por par.
CREATE OR REPLACE FUNCTION acompanhamento.cria_view_acompanhamento_bloco()
  RETURNS void AS
$$
  DECLARE view_txt text;
  DECLARE jointxt text := '';
  DECLARE nome_fixed text;
  DECLARE r record;
  BEGIN
      view_txt := 'CREATE MATERIALIZED VIEW acompanhamento.bloco AS
      SELECT b.id, b.nome, b.prioridade, l.nome AS lote, st_projeto.nome AS projeto_status, st_lote.nome AS lote_status, st_bloco.nome AS bloco_status, b.geom';

      FOR r in SELECT pf.id, pf.nome FROM producao.habilitacao AS pf
      LOOP

        nome_fixed := translate(replace(lower(r.nome),' ', '_'),
              'àáâãäéèëêíìïîóòõöôúùüûçÇ/-|/\,.;:<>?!`{}[]()~`@#$%^&*+=''',
              'aaaaaeeeeiiiiooooouuuucc________________________________');

        view_txt := view_txt || ',  operadores_' || r.id || '.operadores AS  ' || nome_fixed || '_operadores';
        view_txt := view_txt || ',  atividades_' || r.id || '.atividades AS  ' || nome_fixed || '_atividades';

        jointxt := jointxt || ' INNER JOIN
            (SELECT b.id, COUNT(pbo.id) AS operadores
            FROM producao.bloco AS b
            LEFT JOIN (
              SELECT pbo.id, pbo.bloco_id
              FROM producao.habilitacao_bloco AS pbo
              INNER JOIN producao.habilitacao_usuario AS ppo ON ppo.usuario_uuid = pbo.usuario_uuid AND ppo.habilitacao_id = ' || r.id ||'
            ) AS pbo ON pbo.bloco_id = b.id
            GROUP BY b.id) AS operadores_' || r.id || ' ON operadores_' || r.id || '.id = b.id';

        jointxt := jointxt || ' INNER JOIN
            (SELECT b.id, COUNT(a.id) AS atividades
            FROM producao.bloco AS b
            LEFT JOIN producao.unidade_trabalho AS ut ON ut.bloco_id = b.id
            LEFT JOIN (
              SELECT a.id, a.unidade_trabalho_id
              FROM producao.atividade AS a
              INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
              INNER JOIN producao.habilitacao_etapa AS ppe ON ppe.subfase_id = e.subfase_id AND ppe.tipo_etapa_id = e.tipo_etapa_id
              WHERE a.tipo_situacao_atividade_id = 1 AND ppe.habilitacao_id = ' || r.id ||'
            ) AS a ON a.unidade_trabalho_id = ut.id
            GROUP BY b.id) AS atividades_' || r.id || ' ON atividades_' || r.id || '.id = b.id';

      END LOOP;

      view_txt := view_txt || ' FROM (SELECT b.id, b.nome, b.lote_id, b.prioridade, b.status_execucao_id, ST_Collect(ut.geom) as geom
                                FROM producao.bloco AS b
                                INNER JOIN producao.unidade_trabalho AS ut ON ut.bloco_id = b.id
                                GROUP BY b.id) AS b
                                INNER JOIN acervo.lote AS l ON l.id = b.lote_id
                                INNER JOIN acervo.projeto AS proj ON proj.id = l.projeto_id
                                INNER JOIN dominio.tipo_status_execucao AS st_projeto ON proj.status_execucao_id = st_projeto.code
                                INNER JOIN dominio.tipo_status_execucao AS st_lote ON l.status_execucao_id = st_lote.code
                                INNER JOIN dominio.tipo_status_execucao AS st_bloco ON b.status_execucao_id = st_bloco.code';
      view_txt := view_txt || jointxt;

      EXECUTE view_txt;
      EXECUTE 'GRANT SELECT ON TABLE acompanhamento.bloco TO PUBLIC';
      EXECUTE 'CREATE INDEX bloco_geom ON acompanhamento.bloco USING gist (geom);';
      EXECUTE 'CREATE UNIQUE INDEX bloco_id ON acompanhamento.bloco (id);';
      EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.bloco';

  END;
$$
LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE OR REPLACE FUNCTION acompanhamento.view_acompanhamento_bloco()
  RETURNS trigger AS
$BODY$
    BEGIN
    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS acompanhamento.bloco';

    PERFORM acompanhamento.cria_view_acompanhamento_bloco();

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER view_acompanhamento_bloco
AFTER UPDATE OR INSERT OR DELETE ON producao.bloco
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.view_acompanhamento_bloco();

CREATE TRIGGER view_acompanhamento_bloco_perfil
AFTER UPDATE OR INSERT OR DELETE ON producao.habilitacao
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.view_acompanhamento_bloco();


CREATE OR REPLACE FUNCTION acompanhamento.refresh_view_acompanhamento_bloco()
  RETURNS trigger AS
$BODY$
    DECLARE v_exists BOOLEAN;
    BEGIN

    SELECT EXISTS (SELECT FROM pg_matviews WHERE  schemaname = 'acompanhamento' AND matviewname  = 'bloco') INTO v_exists;

    IF v_exists THEN
      EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.bloco';
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER refresh_bloco_perfil_bloco
AFTER UPDATE OR INSERT OR DELETE ON producao.habilitacao_bloco
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();

CREATE TRIGGER refresh_bloco_habilitacao_usuario
AFTER UPDATE OR INSERT OR DELETE ON producao.habilitacao_usuario
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();

CREATE TRIGGER refresh_bloco_unidade_trabalho
AFTER UPDATE OR INSERT OR DELETE ON producao.unidade_trabalho
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();

CREATE TRIGGER refresh_bloco_atividade
AFTER UPDATE OR INSERT OR DELETE ON producao.atividade
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();

CREATE TRIGGER refresh_perfil_prod_etapa
AFTER UPDATE OR INSERT OR DELETE ON producao.habilitacao_etapa
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();

CREATE TRIGGER refresh_perfil_etapa
AFTER UPDATE OR INSERT OR DELETE ON producao.etapa
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();

-- O NOME E O STATUS DO LOTE SAO COLUNAS DESTA VIEW, entao mexer no lote a
-- desatualiza. O gatilho ficava sobre `producao.lote_linha` e mudou de tabela
-- junto com ela. Ele vive AQUI, e nao em `er/acervo.sql`, pela mesma regra dos
-- outros gatilhos que a producao poe sobre o acervo: quem depende carrega o
-- gatilho, e `er/acervo.sql` continua instalando sozinho.
CREATE TRIGGER refresh_bloco_lote
AFTER UPDATE OR INSERT OR DELETE ON acervo.lote
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();


-- A VIEW DE LOTE NASCE E MORRE COM A ETAPA, e nao mais com uma linha de
-- cadastro. Ate 2026-08-09 o gatilho ficava sobre `producao.lote_linha`:
-- inserir a linha criava a view, apagar a linha a derrubava. Sem aquela tabela,
-- quem declara que um lote executa uma linha de producao e a ETAPA, e e ela que
-- carrega o gatilho.
--
-- SAO DUAS FUNCOES AUXILIARES, e a divisao entre elas nao e enfeite. `derruba`
-- so apaga (a view e o estilo dela em `public.layer_styles`, que ficaria orfao).
-- `sincroniza` compara o que DEVE existir com o que EXISTE e mexe so na
-- diferenca: cria quando a primeira etapa do par aparece, derruba quando a
-- ultima some, e nao faz nada nas etapas do meio. Sem essa comparacao, cada
-- etapa nova de uma subfase ja configurada refaria a matriz de fases inteira
-- para nao mudar uma coluna.
CREATE OR REPLACE FUNCTION acompanhamento.derruba_view_acompanhamento_lote(lote_ident bigint, linhaproducao_ident integer)
  RETURNS void AS
$$
  DECLARE nome_view text;
  BEGIN
    IF lote_ident IS NULL OR linhaproducao_ident IS NULL THEN
      RETURN;
    END IF;

    nome_view := 'lote_' || lote_ident || '_linha_' || linhaproducao_ident;

    EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS acompanhamento.' || nome_view;

    DELETE FROM public.layer_styles
    WHERE f_table_schema = 'acompanhamento'
      AND f_table_name = nome_view
      AND stylename = 'acompanhamento_lote';
  END;
$$
LANGUAGE plpgsql VOLATILE
  COST 100;

COMMENT ON FUNCTION acompanhamento.derruba_view_acompanhamento_lote(bigint, integer) IS
    'Apaga a view de um par (lote do acervo, linha de produção) e o estilo dela em public.layer_styles, que ficaria órfão.';

CREATE OR REPLACE FUNCTION acompanhamento.sincroniza_view_acompanhamento_lote(lote_ident bigint, linhaproducao_ident integer)
  RETURNS void AS
$$
  DECLARE nome_view text;
  DECLARE deve_existir boolean;
  DECLARE existe boolean;
  BEGIN
    IF lote_ident IS NULL OR linhaproducao_ident IS NULL THEN
      RETURN;
    END IF;

    nome_view := 'lote_' || lote_ident || '_linha_' || linhaproducao_ident;

    SELECT EXISTS (
      SELECT 1 FROM acompanhamento.linhas_producao_do_lote(lote_ident) AS lp
      WHERE lp = linhaproducao_ident
    ) INTO deve_existir;

    SELECT EXISTS (
      SELECT 1 FROM pg_matviews
      WHERE schemaname = 'acompanhamento' AND matviewname = nome_view
    ) INTO existe;

    IF deve_existir AND NOT existe THEN
      PERFORM acompanhamento.cria_view_acompanhamento_lote(lote_ident, linhaproducao_ident);
    ELSIF existe AND NOT deve_existir THEN
      PERFORM acompanhamento.derruba_view_acompanhamento_lote(lote_ident, linhaproducao_ident);
    END IF;
  END;
$$
LANGUAGE plpgsql VOLATILE
  COST 100;

COMMENT ON FUNCTION acompanhamento.sincroniza_view_acompanhamento_lote(bigint, integer) IS
    'Cria a view do par (lote, linha) quando ele passa a ter etapa e a derruba quando deixa de ter. Nas etapas do meio não faz nada.';

CREATE OR REPLACE FUNCTION acompanhamento.trigger_view_acompanhamento_lote()
  RETURNS trigger AS
$BODY$
    DECLARE linha_antiga integer;
    DECLARE linha_nova integer;
    BEGIN

    -- O par ANTIGO primeiro. Num AFTER DELETE a etapa ja saiu, entao
    -- `linhas_producao_do_lote` responde sem ela e o par que perdeu a ultima
    -- etapa e derrubado aqui.
    IF TG_OP <> 'INSERT' THEN
      SELECT f.linha_producao_id INTO linha_antiga
      FROM producao.subfase AS s
      INNER JOIN producao.fase AS f ON f.id = s.fase_id
      WHERE s.id = OLD.subfase_id;

      PERFORM acompanhamento.sincroniza_view_acompanhamento_lote(OLD.lote_id, linha_antiga);
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    SELECT f.linha_producao_id INTO linha_nova
    FROM producao.subfase AS s
    INNER JOIN producao.fase AS f ON f.id = s.fase_id
    WHERE s.id = NEW.subfase_id;

    PERFORM acompanhamento.sincroniza_view_acompanhamento_lote(NEW.lote_id, linha_nova);

    RETURN NEW;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER trigger_view_acompanhamento_lote
AFTER UPDATE OR INSERT OR DELETE ON producao.etapa
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.trigger_view_acompanhamento_lote();


-- MUDOU A FASE DA LINHA DE PRODUCAO, ENTAO TODA VIEW DE LOTE DAQUELA LINHA
-- PRECISA SER REFEITA.
--
-- O SAP fazia `SELECT ... INTO lote_ident` e refazia UMA view, mesmo quando a
-- linha de producao tinha varios lotes: os outros ficavam com a fase antiga e
-- ninguem avisava. Aqui isso virou laco, e a mudanca e deliberada: uma linha de
-- producao e executada por varios lotes do acervo ao mesmo tempo.
--
-- AQUI A VIEW E DERRUBADA E REFEITA SEMPRE, ao contrario do gatilho da etapa: a
-- fase E a matriz de colunas desta view, e mexer nela muda a DEFINICAO. Nao
-- basta sincronizar a existencia.
--
-- LE A LINHA DE `OLD`/`NEW`, e nao da tabela: num AFTER DELETE a fase ja saiu, e
-- uma consulta a `producao.fase` pelo id nao acharia nada. O codigo antigo tinha
-- esse buraco, e apagar uma fase deixava a view com a coluna dela.
--
-- AS DUAS PONTAS DO UPDATE, quando a fase muda de linha de producao: a linha que
-- perdeu a fase precisa ser refeita tanto quanto a que ganhou.
CREATE OR REPLACE FUNCTION acompanhamento.trigger_view_acompanhamento_lote_fase()
  RETURNS trigger AS
$BODY$
    DECLARE linha_antiga integer;
    DECLARE linha_nova integer;
    DECLARE lote_ident bigint;
    BEGIN

    IF TG_OP <> 'INSERT' THEN
      linha_antiga := OLD.linha_producao_id;

      FOR lote_ident IN SELECT * FROM acompanhamento.lotes_da_linha_producao(linha_antiga)
      LOOP
        PERFORM acompanhamento.derruba_view_acompanhamento_lote(lote_ident, linha_antiga);
        PERFORM acompanhamento.sincroniza_view_acompanhamento_lote(lote_ident, linha_antiga);
      END LOOP;
    END IF;

    IF TG_OP <> 'DELETE' THEN
      linha_nova := NEW.linha_producao_id;

      IF linha_antiga IS NULL OR linha_nova <> linha_antiga THEN
        FOR lote_ident IN SELECT * FROM acompanhamento.lotes_da_linha_producao(linha_nova)
        LOOP
          PERFORM acompanhamento.derruba_view_acompanhamento_lote(lote_ident, linha_nova);
          PERFORM acompanhamento.sincroniza_view_acompanhamento_lote(lote_ident, linha_nova);
        END LOOP;
      END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER trigger_view_acompanhamento_lote_fase
AFTER UPDATE OR INSERT OR DELETE ON producao.fase
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.trigger_view_acompanhamento_lote_fase();


CREATE OR REPLACE FUNCTION acompanhamento.refresh_view_acompanhamento_atividade()
  RETURNS trigger AS
$BODY$
    DECLARE etapa_ident integer;
    DECLARE lote_ident bigint;
    DECLARE linhaproducao_ident integer;
    DECLARE subfase_ident integer;
    DECLARE r record;
    DECLARE v_exists BOOLEAN;
    BEGIN

    IF TG_OP = 'DELETE' THEN
      etapa_ident := OLD.etapa_id;
    ELSE
      etapa_ident := NEW.etapa_id;
    END IF;

    SELECT e.lote_id, e.subfase_id, f.linha_producao_id
              INTO lote_ident, subfase_ident, linhaproducao_ident
              FROM producao.etapa AS e
              INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
              INNER JOIN producao.fase AS f ON f.id = s.fase_id
              WHERE e.id = etapa_ident;

    IF lote_ident IS NOT NULL AND subfase_ident IS NOT NULL THEN

    EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_ident || '_linha_' || linhaproducao_ident;
    EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_ident || '_subfase_' || subfase_ident;

    FOR r in SELECT prs.subfase_posterior_id FROM producao.pre_requisito_subfase AS prs
    WHERE prs.subfase_anterior_id = subfase_ident
    LOOP
      SELECT EXISTS (SELECT FROM pg_matviews WHERE  schemaname = 'acompanhamento' AND matviewname  = 'lote_'|| lote_ident || '_subfase_' || r.subfase_posterior_id) INTO v_exists;
      IF v_exists THEN
        EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_ident || '_subfase_' || r.subfase_posterior_id;
      END IF;
    END LOOP;

    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER refresh_view_acompanhamento_atividade
AFTER UPDATE OR INSERT OR DELETE ON producao.atividade
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_atividade();

CREATE OR REPLACE FUNCTION acompanhamento.refresh_view_acompanhamento_ut_etapa()
  RETURNS trigger AS
$BODY$
    DECLARE subfase_ident integer;
    DECLARE lote_ident bigint;
    DECLARE linhaproducao_ident integer;
    DECLARE v_exists_1 BOOLEAN;
    DECLARE v_exists_2 BOOLEAN;

    BEGIN

    IF TG_OP = 'DELETE' THEN
      subfase_ident := OLD.subfase_id;
      lote_ident := OLD.lote_id;
    ELSE
      subfase_ident := NEW.subfase_id;
      lote_ident := NEW.lote_id;
    END IF;

    -- A LINHA DE PRODUCAO SAI DA SUBFASE, e nao do lote: o lote e o do acervo e
    -- atravessa linhas.
    SELECT f.linha_producao_id INTO linhaproducao_ident
    FROM producao.subfase AS s
    INNER JOIN producao.fase AS f ON f.id = s.fase_id
    WHERE s.id = subfase_ident;

    SELECT EXISTS (SELECT FROM pg_matviews WHERE  schemaname = 'acompanhamento' AND matviewname  = 'lote_'|| lote_ident || '_linha_' || linhaproducao_ident) INTO v_exists_1;
    IF v_exists_1 THEN
      EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_ident || '_linha_' || linhaproducao_ident;
    END IF;

    SELECT EXISTS (SELECT FROM pg_matviews WHERE  schemaname = 'acompanhamento' AND matviewname  = 'lote_'|| lote_ident || '_subfase_' || subfase_ident) INTO v_exists_2;
    IF v_exists_2 THEN
      EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_ident || '_subfase_' || subfase_ident;
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER refresh_view_acompanhamento_ut
AFTER UPDATE OR INSERT OR DELETE ON producao.unidade_trabalho
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_ut_etapa();

CREATE TRIGGER refresh_view_acompanhamento_etapa
AFTER UPDATE OR INSERT OR DELETE ON producao.etapa
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_ut_etapa();

-- MUDOU A SUBFASE, ENTAO A VIEW DE LOTE QUE A CONTEM PRECISA SER ATUALIZADA.
--
-- Mesmo laco da funcao anterior, e pelo mesmo motivo: a subfase pertence a uma
-- linha de producao, e uma linha de producao e executada por varios lotes. A
-- guarda de existencia foi acrescentada porque a view de um lote recem-criado
-- pode ainda nao ter sido gerada, e um REFRESH em view inexistente derruba a
-- escrita que disparou o gatilho.
--
-- A FASE VEM DE `OLD`/`NEW`, e nao de uma consulta a `producao.subfase` pelo id:
-- num AFTER DELETE a subfase ja saiu, e o laco antigo ficava vazio justamente no
-- caso em que a view precisava ser atualizada.
CREATE OR REPLACE FUNCTION acompanhamento.refresh_view_acompanhamento_subfase()
  RETURNS trigger AS
$BODY$
    DECLARE fase_ident integer;
    DECLARE linhaproducao_ident integer;
    DECLARE lote_ident bigint;
    DECLARE v_exists BOOLEAN;
    BEGIN

    IF TG_OP = 'DELETE' THEN
      fase_ident := OLD.fase_id;
    ELSE
      fase_ident := NEW.fase_id;
    END IF;

    SELECT f.linha_producao_id INTO linhaproducao_ident
    FROM producao.fase AS f
    WHERE f.id = fase_ident;

    FOR lote_ident IN SELECT * FROM acompanhamento.lotes_da_linha_producao(linhaproducao_ident)
    LOOP
      SELECT EXISTS (SELECT FROM pg_matviews WHERE  schemaname = 'acompanhamento' AND matviewname  = 'lote_'|| lote_ident || '_linha_' || linhaproducao_ident) INTO v_exists;
      IF v_exists THEN
        EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_ident || '_linha_' || linhaproducao_ident;
      END IF;
    END LOOP;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER refresh_view_acompanhamento_subfase
AFTER UPDATE OR INSERT OR DELETE ON producao.subfase
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_subfase();

-- MUDOU A VERSAO DO ACERVO, ENTAO A VIEW DE LOTE QUE A LISTA PRECISA SER
-- ATUALIZADA.
--
-- O NOME DA FUNCAO CONTINUA `..._produto` E O GATILHO MUDOU DE TABELA. No SAP
-- ele vivia em `macrocontrole.produto`; aqui o produto do SAP e a VERSAO do
-- acervo, entao o gatilho passa a `acervo.versao`. O nome ficou para nao
-- quebrar quem procura a funcao pelo nome antigo.
--
-- E LACO, e nao um refresh so, porque o lote do acervo atravessa linhas de
-- producao e tem uma view por linha que executa. `lote_id` e ANULAVEL na versao
-- (registro historico e produto fora de lote), e nesse caso nao ha view nenhuma
-- a atualizar.
CREATE OR REPLACE FUNCTION acompanhamento.refresh_view_acompanhamento_produto()
  RETURNS trigger AS
$BODY$
    DECLARE lote_acervo_ident bigint;
    DECLARE linhaproducao_ident integer;
    DECLARE v_exists BOOLEAN;
    BEGIN

    IF TG_OP = 'DELETE' THEN
      lote_acervo_ident := OLD.lote_id;
    ELSE
      lote_acervo_ident := NEW.lote_id;
    END IF;

    IF lote_acervo_ident IS NOT NULL THEN
      FOR linhaproducao_ident IN SELECT * FROM acompanhamento.linhas_producao_do_lote(lote_acervo_ident)
      LOOP
        SELECT EXISTS (SELECT FROM pg_matviews WHERE  schemaname = 'acompanhamento' AND matviewname  = 'lote_'|| lote_acervo_ident || '_linha_' || linhaproducao_ident) INTO v_exists;
        IF v_exists THEN
          EXECUTE 'REFRESH MATERIALIZED VIEW CONCURRENTLY acompanhamento.lote_'|| lote_acervo_ident || '_linha_' || linhaproducao_ident;
        END IF;
      END LOOP;
    END IF;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;

    END;
$BODY$
  LANGUAGE plpgsql VOLATILE
  COST 100;

CREATE TRIGGER refresh_view_acompanhamento_produto
AFTER UPDATE OR INSERT OR DELETE ON acervo.versao
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_produto();
COMMIT;
