-- O CORE DE PRODUCAO DO SAP 2.3.5 ATRAVESSA: NASCEM `producao`, `qgis`,
-- `metadado`, `acompanhamento` E `microcontrole`.
--
-- POR QUE ESTE ARQUIVO EXISTE, E O QUE ELE CONSERTA. O `er/` ganhou em
-- 2026-08-09 cinco arquivos (`producao.sql`, `qgis.sql`, `metadado.sql`,
-- `acompanhamento_producao.sql`, `microcontrole.sql`), o `er/dominio.sql` ganhou
-- 15 dominios e o modulo 7, e o `er/permissao.sql` ganhou os GRANTs dos cinco
-- schemas. Nada disso tinha migracao. Uma INSTALACAO NOVA nascia completa e um banco em
-- 1.50.0 ATUALIZADO ficava carimbado 3.0.0 sem um unico objeto de producao: com
-- `MIN_DATABASE_VERSION` em 3.0.0 o servico subiria contra ele sem reclamar, e
-- a falha so apareceria na primeira consulta, como "relation producao.etapa
-- does not exist", longe de onde nasceu. E exatamente a divergencia entre `er/`
-- e `migrations/` que o `ensaiar_migracao.cjs` existe para nao deixar passar.
--
-- O QUE ENTRA, NA ORDEM EM QUE O `create_config.js` DECLARA
--
--   1. `dominio`: o modulo (7, 'Produção', 'producao') e 15 tabelas de codigo
--      que o schema `producao` referencia. Elas moram em `dominio` porque esse
--      schema e unico na plataforma, pela mesma regra que ja trouxe para ca os
--      dominios do orcamento e os do PIT.
--   2. `qgis`: 13 tabelas com a configuracao que o operador recebe no cliente,
--      mais as sementes que vieram do SAP 2.3.5 (128 atalhos de teclado, a
--      versao minima do QGIS e o caminho VAZIO do plugin).
--   3. `producao`: 39 tabelas e 11 funcoes. E o core: linha de producao, fase,
--      subfase, etapa, unidade de trabalho, atividade, insumo, fila prioritaria
--      e os perfis de configuracao do cliente. O LOTE NAO ESTA NESSA LISTA: e o
--      `acervo.lote`, e a tabela de lote de producao que este arquivo chegou a
--      declarar foi removida por decisao do chefe em 2026-08-09, antes de a
--      migracao ser aplicada em lugar nenhum.
--   4. `metadado`: 16 tabelas que alimentam a ficha ET-PCDG e a geracao do XML.
--   5. `acompanhamento`: as funcoes que EMITEM DDL em tempo de execucao, para
--      gerar uma view materializada por par (lote do acervo, linha de
--      producao) e outra por (lote, subfase).
--   6. `microcontrole`: 2 tabelas com o PERFIL de monitoramento (qual subfase
--      de qual lote e monitorada, e como). Ele entrou neste arquivo em
--      2026-08-09, DEPOIS de o resto estar escrito e ANTES de a migracao ser
--      aplicada em lugar nenhum: a primeira leva o deixou de fora e o chefe
--      revogou aquela decisao no mesmo dia. NAO HA UMA SEGUNDA MIGRACAO, pelo
--      mesmo motivo que este arquivo carimba 3.0.0 de novo -- ver "A VERSAO".
--      As outras TRES tabelas do microcontrole (a telemetria em si) vivem num
--      BANCO SEPARADO, com instalacao propria em `er_microcontrole/`, e este
--      arquivo nao as toca: aquele banco e opcional, nasce vazio e nao tem
--      migracao nenhuma para receber.
--   7. Os GRANTs dos cinco schemas: CRUD para o usuario da aplicacao, e
--      LEITURA de `producao` e de `acompanhamento` para o usuario somente
--      leitura das URIs de camada do QGIS. Ver o bloco 7, que e onde essa
--      decisao esta explicada, inclusive como cada papel e descoberto sem que o
--      nome dele apareca neste arquivo. `microcontrole` NAO entra na leitura:
--      ele nao e camada que se abra no QGIS.
--
-- CINCO GATILHOS MORAM SOBRE TABELAS DO `acervo`, E ISSO E DELIBERADO. Quem
-- depende do cache e quem carrega o gatilho, entao eles vem nestes arquivos e
-- nao em `er/acervo.sql`. Sao eles, e esta migracao cria os cinco:
--
--   a_relacionamento_versao              em acervo.versao
--   refresh_view_acompanhamento_produto  em acervo.versao
--   chk_projeto_status_consistency       em acervo.projeto
--   chk_lote_status_consistency          em acervo.lote
--   refresh_bloco_lote                   em acervo.lote
--
-- OS DOIS ULTIMOS NASCERAM DA REMOCAO DA `producao.lote_linha`, em 2026-08-09:
-- o status do lote de producao e o nome que a view de bloco publicava passaram
-- a ser perguntados a `acervo.lote`.
--
-- Esquecer qualquer um deles deixaria `producao.relacionamento_versao` e as
-- views de acompanhamento paradas no tempo, sem erro nenhum: o gatilho ausente
-- nao levanta excecao, ele so deixa de acontecer.
--
-- A VERSAO: POR QUE ESTA MIGRACAO CARIMBA 3.0.0 DE NOVO
--
-- `2026-08-09_o_sca_vira_sap_3.sql` ja carimbou 3.0.0, e o cabecalho dela
-- prometia que cada migracao de schema do core carimbaria "a sua versao 3.x".
-- A promessa nao se cumpre, e a razao e o teste: `er/versao.sql` carimba 3.0.0
-- e `__tests__/unit/versao_do_servico.test.js` cobra que o servico nunca fique
-- abaixo do que a instalacao nova carimba. Uma segunda versao aqui (3.1.0)
-- obrigaria `er/versao.sql`, `VERSION` e `MIN_DATABASE_VERSION` a subir junto,
-- e o `ensaiar_migracao.cjs` compararia um banco migrado em 3.1.0 com um banco
-- novo em 3.0.0. AS DUAS MIGRACOES SAO UMA ENTREGA SO: a renomeacao de produto
-- e a chegada do core do SAP 2.3.5 sao o mesmo release, e um release tem um
-- numero.
--
-- O `UPDATE` DAQUI E INCONDICIONAL, e nao um incremento. Ele leva a 3.0.0 tanto
-- um banco em 1.50.0 (esta migracao aplicada sozinha) quanto um banco que ja
-- passou pela renomeacao. Isso e o que permite ensaiar as duas em cadeia, que e
-- como elas rodam em producao, e e o que impede a ordem de aplicacao de mudar o
-- numero final.
--
-- O QUE ISSO CUSTA, E ESTA MEDIDO: aplicar SO a renomeacao deixa o banco
-- dizendo 3.0.0 sem os schemas, que e o defeito descrito la em cima. As duas
-- vao juntas, na mesma janela, e a CONFERENCIA no fim deste arquivo e o que
-- prova que a segunda chegou ao fim. Um banco que responda 3.0.0 e nao tenha
-- `producao.etapa` esta pela metade, e o jeito de sair disso e reaplicar
-- este arquivo, que e idempotente.
--
-- O QUE ESTA MIGRACAO NAO FAZ
--
--   1. NAO CARREGA DADO do SAP 2.3.5. Ela cria os schemas VAZIOS, com as
--      sementes que o `er/` tambem cria (dominios, atalhos do QGIS, organizacao,
--      especificacao, classes complementares). A carga do dump de producao e
--      outro trabalho, e ela precisa que estes objetos ja existam.
--   2. NAO CRIA ROTA nem tela. O modulo 7 nasce sem nada que o consuma, e o
--      mapa `MODULO` de `login/verify_perfil.js` so o ganha quando as rotas
--      entrarem.
--   3. NAO TOCA em `dgeo.usuario_perfil`. Ninguem ganha nem perde acesso, e
--      conceder perfil no modulo 7 continua sendo ato explicito do
--      administrador.
--
-- IDEMPOTENTE, e o `ensaiar_migracao.cjs` aplica duas vezes para cobrar isso:
-- `CREATE SCHEMA IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF
-- NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` antes de
-- cada `CREATE TRIGGER` e `ON CONFLICT (code) DO NOTHING` em toda semente com
-- chave. As duas semeaduras SEM chave natural (`qgis.qgis_shortcuts`, com 128
-- linhas de `id SERIAL`, e `metadado.classes_complementares_orto`) vao dentro
-- de um `DO` guardado por tabela vazia: um `ON CONFLICT` nelas nao teria em que
-- conflitar e a segunda passada duplicaria as linhas em silencio, porque o
-- ensaio compara tabela de codigo e essas duas nao tem coluna `code`.
--
-- Para ensaiar antes de aplicar, em cadeia com a renomeacao, que e como as duas
-- rodam em producao:
--
--   node migrations/ensaiar_migracao.cjs \
--     --migracao migrations/2026-08-09_o_sca_vira_sap_3.sql,migrations/2026-08-09_o_core_de_producao_atravessa.sql \
--     --novos er/producao.sql,er/qgis.sql,er/metadado.sql,er/acompanhamento_producao.sql,er/microcontrole.sql \
--     --versao-anterior 1.50.0 --versao-esperada 3.0.0 \
--     --schemas producao,qgis,metadado,acompanhamento,microcontrole,dominio,acervo \
--     --er-de <revisao anterior a chegada do core>
--
-- O `--er-de` NAO E OPCIONAL AQUI: esta migracao muda o CONTEUDO de
-- `er/dominio.sql` (15 dominios e o modulo 7). Sem ele, o banco "anterior" ja
-- nasceria com os dominios e o ensaio aprovaria sem exercitar a parte que mais
-- importa.

BEGIN;

-- --------------------------------------------------------------------------
-- 1. O modulo 7 e os dominios do core de producao
-- --------------------------------------------------------------------------

-- O MODULO 7 e o modulo PRODUCAO de verdade, e nasce aqui. O code 4 devolveu o
-- nome "producao" em 2026-08-09, na migracao imediatamente anterior a esta, e
-- foi para este INSERT que ele o devolveu. `nome_abrev` e IDENTIFICADOR: o
-- `verifyPerfil`, o mapa `MODULO`, o prefixo de rota e a chave dos `perfis`
-- comparam a string por igualdade.
--
-- O MODULO NASCE SEM ROTA, e e deliberado. O DDL vem primeiro porque
-- `dgeo.usuario_perfil.modulo_id` e chave estrangeira: sem a linha do modulo,
-- a primeira concessao seria recusada. Conceder perfil num modulo sem tela e
-- linha morta, e ninguem perde nada por esperar.
INSERT INTO dominio.modulo (code, nome, nome_abrev) VALUES
(7, 'Produção', 'producao')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Domínios do módulo PRODUÇÃO (code 7), absorvidos do SAP 2.3.5 em 2026-08-09.
--
-- São os domínios que o schema `producao` referencia. Eles moram aqui, e não em
-- producao.sql, porque o schema `dominio` é único na plataforma: é a mesma
-- regra que já trouxe para cá os domínios do orçamento e os do PIT.
--
-- OS CÓDIGOS SÃO OS MESMOS DO SAP, code a code, e isso é deliberado: o dump de
-- produção do SAP 2.3.5 é o que vai popular estes schemas, e linha migrada não
-- pode precisar de tradução de código. Renumerar custaria um de-para em toda a
-- carga para não ganhar nada.
--
-- DOIS NOMES FORAM QUALIFICADOS. `tipo_situacao` e `tipo_problema` eram nomes
-- bons num banco que só falava de produção, e são genéricos demais num
-- `dominio` de sete módulos: aqui situação já é a do pedido da mapoteca, a da
-- capacitação, a do Extra-PIT e a do exercício do PIT. Entram como
-- `tipo_situacao_atividade` e `tipo_problema_atividade`, que é do que eles
-- sempre falaram: da atividade de `producao.atividade`.
--
-- QUATRO DOMÍNIOS DO SAP NÃO ATRAVESSARAM. Quem vier procurar por eles lê aqui
-- o porquê, porque procurar e não achar é o que faz alguém recriá-los:
--
--   `dominio.status` do SAP (Previsto / Em Execução, Finalizado, Abandonado)
--   duplicaria `dominio.tipo_status_execucao`, que já existe, e que o
--   `acervo.projeto` e o `acervo.lote` já usam. Toda coluna que apontava para
--   ela passa a apontar `dominio.tipo_status_execucao (code)`. Dois catálogos
--   para a mesma pergunta é a segunda verdade que este banco vem eliminando.
--
--   `dominio.tipo_posto_grad` do SAP já existe aqui, em `er/dominio.sql`, e é
--   IDÊNTICA: os mesmos 19 códigos, o mesmo `nome` e a mesma `nome_abrev`,
--   conferidos linha a linha em 2026-08-09. Não há o que trazer.
--
--   `dominio.tipo_produto` do SAP é o `dominio.subtipo_produto` daqui, código a
--   código: 22 dos 23 batem até no nome, e só o 19 difere de rótulo ('Carta
--   ortoimagem de OM' lá, 'Carta Ortoimagem de SARP' aqui). Toda coluna que no
--   SAP apontava `dominio.tipo_produto` passa a apontar
--   `dominio.subtipo_produto (code)`. CUIDADO com o homônimo: o
--   `dominio.tipo_produto` que este banco já tem é outra coisa, um nível acima do
--   subtipo, e apontar para ele daria a granularidade errada sem erro nenhum.
--
--   `dominio.tipo_turno` (Manhã, Tarde, Integral) foi REMOVIDA por decisão do
--   chefe em 2026-08-09. Ela tinha dois consumidores no SAP, e nenhum dos dois
--   atravessa: `dgeo.usuario.tipo_turno_id`, e usuário aqui é o do SCA (que
--   nunca teve turno), e o code 3 de `tipo_restricao`, que sai junto. Leia o
--   comentário daquela tabela, que é onde está a medição.
-- ---------------------------------------------------------------------------

-- Fase agrupa subfases, e corresponde às fases do RTM e às do metadado do
-- BDGEx. A `cor` (R,G,B em texto) não é enfeite: as funções do schema
-- `acompanhamento` a injetam no estilo das views que o QGIS abre, e por isso
-- ela viaja no domínio e não no client.
CREATE TABLE IF NOT EXISTS dominio.tipo_fase(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  cor VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_fase (code, nome, cor) VALUES
(1, 'Extração', '252,141,89'),
(2, 'Reambulação', '254,224,139'),
(3, 'Validação', '255,255,191'),
(4, 'Edição', '217,239,139'),
(5, 'Disseminação', '145,207,96'),
(6, 'Vetorização', '222,119,174'),
(7, 'Avaliação', '175,141,195'),
(8, 'Generalização', '224,243,248'),
(9, 'Fototriangulação', '44,127,184'),
(10, 'Restituição', '186,186,186'),
(11, 'Processamento Digital de Imagens', '215,48,39'),
(12, 'Medição de pontos de controle', '0,0,0'),
(13, 'Geração de ortoimagem', '128,205,193'),
(14, 'Geração de MDE', '191,129,45'),
(15, 'Levantamento topográfico', '37,52,148'),
(16, 'Preparo', '175,141,195')
ON CONFLICT (code) DO NOTHING;


-- O que uma subfase exige da subfase anterior para liberar a distribuição.
CREATE TABLE IF NOT EXISTS dominio.tipo_pre_requisito(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_pre_requisito (code, nome) VALUES
(1, 'Região concluída'),
(2, 'Região não estar em execução')
ON CONFLICT (code) DO NOTHING;


-- O papel da etapa dentro da subfase. É o que distingue quem produz de quem
-- confere, e é sobre ele que a restrição de operador é escrita.
CREATE TABLE IF NOT EXISTS dominio.tipo_etapa(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_etapa (code, nome) VALUES
(1, 'Execução'),
(2, 'Revisão'),
(3, 'Correção'),
(4, 'Revisão/Correção'),
(5, 'Revisão final')
ON CONFLICT (code) DO NOTHING;


-- Quanto da linhagem o operador vê. Quem revisa precisa saber quem executou;
-- quem executa nem sempre precisa saber quem revisou.
CREATE TABLE IF NOT EXISTS dominio.tipo_exibicao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_exibicao (code, nome) VALUES
(1, 'Não exibir usuários na linhagem'),
(2, 'Exibir usuários na linhagem somente para revisores'),
(3, 'Sempre exibir usuários na linhagem')
ON CONFLICT (code) DO NOTHING;


-- Restrição entre duas etapas da MESMA unidade de trabalho: quem fez uma não
-- pode (ou tem de) fazer a outra. É o que impede o operador de revisar o
-- próprio trabalho.
--
-- SÃO DOIS CÓDIGOS, E NÃO TRÊS. O code 3 era 'Operadores no mesmo turno' e não
-- atravessou: ele dependia de `dominio.tipo_turno`, removida por decisão do
-- chefe em 2026-08-09. A ausência foi MEDIDA antes de decidir, no dump de
-- produção do SAP em 2026-08-09: `restricao_etapa` tem 98 linhas, 49 do tipo 1
-- e 49 do tipo 2, e ZERO do tipo 3. Ressuscitá-lo é decisão, e decisão se
-- registra em docs/decisoes.md.
CREATE TABLE IF NOT EXISTS dominio.tipo_restricao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_restricao (code, nome) VALUES
(1, 'Operadores distintos'),
(2, 'Operadores iguais')
ON CONFLICT (code) DO NOTHING;


-- COMO o insumo chega ao operador. Não é o que o insumo É: é o caminho que o
-- QGIS percorre para abri-lo, e por isso 'cópia via rede' e 'aberto via rede'
-- são dois códigos para o mesmo arquivo.
CREATE TABLE IF NOT EXISTS dominio.tipo_insumo(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_insumo (code, nome) VALUES
(1, 'Arquivo (cópia via rede)'),
(2, 'Arquivo (aberto via rede)'),
(3, 'Banco de dados PostGIS'),
(4, 'Insumo físico'),
(5, 'URL'),
(6, 'Serviço WMS'),
(7, 'Serviço WFS'),
(8, 'XYZ Tiles'),
(9, 'Download via HTTP'),
(10, 'ArcGis MapServer')
ON CONFLICT (code) DO NOTHING;


-- Quanto o sistema manda no dado que a subfase produz. O code 2 é o único em
-- que ele concede e revoga permissão no banco de produção a cada distribuição.
CREATE TABLE IF NOT EXISTS dominio.tipo_dado_producao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_dado_producao (code, nome) VALUES
(1, 'Dado não controlado pelo SAP'),
(2, 'Banco de dados PostGIS com controle de permissões'),
(3, 'Banco de dados PostGIS')
ON CONFLICT (code) DO NOTHING;


-- O ESTADO DE UMA ATIVIDADE, e o coração da distribuição. Chamava-se
-- `dominio.tipo_situacao` no SAP.
--
-- 'Não finalizada' (5) NÃO é 'Pausada' (3), e confundi-las mente na estatística
-- de produção: pausada é a que volta para a mesma mão, e não finalizada é a que
-- foi interrompida por fora e não volta. É o que o SAP grava quando o gerente
-- interrompe a atividade em execução e quando unidades de trabalho são fundidas
-- ou redivididas por baixo dela (conferido no código do SAP 2.3.5 em
-- 2026-08-09).
CREATE TABLE IF NOT EXISTS dominio.tipo_situacao_atividade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_situacao_atividade (code, nome) VALUES
(1, 'Não iniciada'),
(2, 'Em execução'),
(3, 'Pausada'),
(4, 'Finalizada'),
(5, 'Não finalizada')
ON CONFLICT (code) DO NOTHING;


-- Ferramenta de aquisição do DSGTools que o perfil de configuração liga.
CREATE TABLE IF NOT EXISTS dominio.tipo_configuracao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_configuracao (code, nome) VALUES
(1, 'DSGTools - Centroide'),
(2, 'DSGTools - Mão livre'),
(3, 'DSGTools - Seletor Genérico'),
(4, 'DSGTools - Ângulo Reto')
ON CONFLICT (code) DO NOTHING;


-- Como a fila prioritária escolhe entre as unidades de trabalho disponíveis
-- para um operador, dada a dificuldade delas.
CREATE TABLE IF NOT EXISTS dominio.tipo_perfil_dificuldade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_perfil_dificuldade (code, nome) VALUES
(1, 'Distribuir atividades mais fáceis'),
(2, 'Distribuir atividades mais difíceis'),
(3, 'Distribuir de forma balanceada')
ON CONFLICT (code) DO NOTHING;


-- Quanto controle de qualidade a rotina de criação de fluxo põe nas subfases.
-- NÃO é coluna de tabela nenhuma: é argumento da criação em massa, e por isso
-- não tem chave estrangeira apontando para cá.
CREATE TABLE IF NOT EXISTS dominio.tipo_controle_qualidade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_controle_qualidade (code, nome) VALUES
(1, 'Sem controle de qualidade nas subfases'),
(2, 'Uma Revisão/Correção em todas as subfases'),
(3, 'Uma Revisão em todas as subfases')
ON CONFLICT (code) DO NOTHING;


-- Em que pedaço o produto vira unidade de trabalho. Também é argumento de
-- rotina de criação em massa, e não coluna.
CREATE TABLE IF NOT EXISTS dominio.tipo_criacao_unidade_trabalho(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_criacao_unidade_trabalho (code, nome) VALUES
(1, 'Produto'),
(2, '1/4 de produto'),
(3, '1/9 de produto'),
(4, 'Bloco'),
(5, '1/4 de bloco'),
(6, '1/9 de bloco')
ON CONFLICT (code) DO NOTHING;


-- O QUE O OPERADOR RECLAMOU. Chamava-se `dominio.tipo_problema` no SAP.
--
-- O 99 É 'Outros', e não 8: a lacuna deixa o catálogo crescer pelo fim sem que
-- 'Outros' deixe de ser o último da lista e sem renumerar linha já gravada.
CREATE TABLE IF NOT EXISTS dominio.tipo_problema_atividade(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_problema_atividade (code, nome) VALUES
(1, 'Insumo não é suficiente para execução da atividade'),
(2, 'Problema em etapa anterior, necessita ser refeita'),
(3, 'Erro durante execução da atividade atual'),
(4, 'Problema em unidade de trabalho vizinha'),
(5, 'Grande quantidade de objetos na unidade de trabalho, necessita ser dividida'),
(6, 'Problema nas rotinas'),
(7, 'Finalizei a atividade incorretamente'),
(99, 'Outros')
ON CONFLICT (code) DO NOTHING;


-- A regra espacial que casa um insumo com as unidades de trabalho. Argumento
-- da rotina de associação, e não coluna.
CREATE TABLE IF NOT EXISTS dominio.tipo_estrategia_associacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_estrategia_associacao (code, nome) VALUES
(1, 'Centroide da unidade de trabalho contido no insumo'),
(2, 'Centroide do insumo contido na unidade de trabalho'),
(3, 'Interseção entre insumo e unidade de trabalho'),
(4, 'Sobreposição entre insumo e unidade de trabalho'),
(5, 'Associar insumo a todas as unidades de trabalho')
ON CONFLICT (code) DO NOTHING;


-- Para que serve a rotina que o perfil de requisito de finalização exige. A
-- diferença entre 1 e 2 é se o operador pode marcar apontamento como falso
-- positivo e finalizar assim mesmo.
CREATE TABLE IF NOT EXISTS dominio.tipo_rotina(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);


INSERT INTO dominio.tipo_rotina (code, nome) VALUES
(1, 'Controle de qualidade sem falso positivo'),
(2, 'Controle de qualidade com falso positivo'),
(3, 'Auxiliar')
ON CONFLICT (code) DO NOTHING;

-- --------------------------------------------------------------------------
-- 2. O schema `qgis`: a configuracao que o operador recebe
-- --------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- QGIS: a configuração que o cliente de produção baixa do banco
-- ---------------------------------------------------------------------------
--
-- VEIO DO `dgeo` DO SAP 2.3.5, e o motivo da mudança de schema é de uma palavra
-- só: aqui `dgeo` é GENTE. Ele guarda `usuario`, `usuario_perfil`, `login`,
-- `efetivo_periodo` e `impedimento`, e nada mais. No SAP o mesmo nome carregava
-- a pessoa E o catálogo de estilos, menus, temas, atalhos e modelos do QGIS, que
-- é configuração de FERRAMENTA e não tem relação nenhuma com quem opera.
--
-- SÃO 13 TABELAS, as mesmas do SAP e com os mesmos nomes: `plugin`,
-- `versao_qgis`, `qgis_shortcuts`, `gerenciador_fme`, `qgis_menus`,
-- `qgis_themes`, `layer_alias`, `group_styles`, `layer_styles`, `layer_rules`,
-- `qgis_models`, `workflow_dsgtools` e `plugin_path`.
--
-- `public.layer_styles` NÃO ESTÁ AQUI, e a ausência é a regra. Ela mora em
-- `er/versao.sql`, no schema `public`, porque quem a lê é o PRÓPRIO QGIS: o
-- gerenciador de estilos do QGIS abre uma conexão ao banco e procura
-- `public.layer_styles` por nome e por schema, sem passar pela API do SAP. Mudar
-- o nome dela ou o schema dela não quebra nada no servidor e quebra tudo no
-- cliente, em silêncio. `qgis.layer_styles` abaixo é OUTRA coisa: é o CATÁLOGO
-- do SAP, agrupado por `qgis.group_styles`, que o SAP Gerente publica e o SAP
-- distribui por subfase e por lote (`producao.perfil_estilo`).
--
-- `owner` E `update_time` FICAM COMO ESTAVAM, e não viram o par
-- `usuario_cadastramento_uuid`/`data_cadastramento` do resto do SCA. Não é
-- esquecimento: estas colunas são LIDAS PELO NOME pelo plugin do QGIS e pelo SAP
-- Gerente, que são clientes compilados fora deste repositório. Renomeá-las
-- obrigaria a soltar uma versão nova dos dois no mesmo dia da migração de banco,
-- para ganhar uma coluna de auditoria num catálogo que a auditoria do SCA
-- (`auditoria.evento`) já cobre pela rota. `owner` é o LOGIN de quem publicou,
-- texto e não chave estrangeira, pelo mesmo motivo.
--
-- CARREGA ANTES DE `er/producao.sql`: onze tabelas de perfil de lá apontam para
-- cá (`perfil_fme` para `gerenciador_fme`, `perfil_estilo` para `group_styles`,
-- `perfil_menu` para `qgis_menus`, e assim por diante).
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS qgis;


COMMENT ON SCHEMA qgis IS
    'Configuração da ferramenta QGIS que o cliente de produção baixa do banco: estilos, menus, temas, atalhos, modelos e regras. Saiu de dgeo porque dgeo é gente.';

-- ---------------------------------------------------------------------------
-- O que o cliente precisa ter instalado
-- ---------------------------------------------------------------------------

-- A versão MÍNIMA do plugin do SAP. O cliente compara a sua com esta e se recusa
-- a trabalhar se estiver atrás: o plugin velho grava atividade com contrato
-- velho, e o estrago só aparece depois.
--
-- O CHECK do formato fica: 'versao_minima' é comparada por parte numérica no
-- cliente, e um '3.22-beta' escrito à mão faria a comparação decidir errado sem
-- erro nenhum.
CREATE TABLE IF NOT EXISTS qgis.plugin(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  versao_minima TEXT,
  CHECK (versao_minima ~ '^\d+(\.\d+){0,2}$')
);


COMMENT ON TABLE qgis.plugin IS
    'Versão mínima exigida de cada plugin do cliente de produção. O cliente atrás desta versão é recusado no login.';

-- A versão MÍNIMA do próprio QGIS. UMA linha, e a chave é `code` justamente para
-- não haver duas: a pergunta "qual o QGIS mínimo" tem uma resposta só.
CREATE TABLE IF NOT EXISTS qgis.versao_qgis(
  code SMALLINT NOT NULL PRIMARY KEY,
  versao_minima TEXT,
  CHECK (versao_minima ~ '^\d+(\.\d+){0,2}$')
);


INSERT INTO qgis.versao_qgis (code, versao_minima) VALUES
(1, '3.22.2')
ON CONFLICT (code) DO NOTHING;


COMMENT ON TABLE qgis.versao_qgis IS
    'Versão mínima do QGIS aceita pelo SAP. Uma linha só, e o code existe para garantir isso.';

-- Onde o cliente procura o plugin para se atualizar sozinho.
--
-- NASCE VAZIA (texto vazio, não nulo), e é deliberado: o valor é uma pasta de
-- rede DA INSTALAÇÃO, e este repositório é público. Quem instala preenche pelo
-- SAP Gerente. O CHECK `code = 1` é o que impede uma segunda linha.
CREATE TABLE IF NOT EXISTS qgis.plugin_path(
  code SMALLINT NOT NULL PRIMARY KEY,
  path TEXT,
  CHECK (code = 1)
);


INSERT INTO qgis.plugin_path (code, path) VALUES
(1, '')
ON CONFLICT (code) DO NOTHING;


COMMENT ON TABLE qgis.plugin_path IS
    'Caminho de onde o cliente baixa o plugin. Nasce vazia: o valor é da instalação e se preenche pelo SAP Gerente.';

-- ---------------------------------------------------------------------------
-- Os atalhos de teclado
-- ---------------------------------------------------------------------------
--
-- A FERRAMENTA É IDENTIFICADA PELO RÓTULO TRADUZIDO, e é por isso que `idioma`
-- existe e que a mesma tecla aparece duas vezes ('Mesclar feições selecionadas'
-- e 'Merge Selected Features' são a MESMA ação com a mesma tecla M). O QGIS não
-- expõe um identificador estável da ação para quem configura de fora: o que ele
-- expõe é o texto do menu, que muda com o idioma da instalação. Casar por texto
-- é frágil, e é o que existe.
--
-- SEMEADA COM O PADRÃO DA DIVISÃO, e as linhas abaixo são as do SAP 2.3.5, sem
-- corte. Elas não são exemplo: um operador que entra hoje espera o teclado que
-- ele já usa, e um banco novo sem elas obrigaria a redigitar 128 linhas.
CREATE TABLE IF NOT EXISTS qgis.qgis_shortcuts(
  id SERIAL NOT NULL PRIMARY KEY,
  ferramenta VARCHAR(255) NOT NULL,
  idioma VARCHAR(255) NOT NULL,
  atalho VARCHAR(255),
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);


COMMENT ON TABLE qgis.qgis_shortcuts IS
    'Atalho de teclado por ferramenta do QGIS. A ferramenta é identificada pelo RÓTULO TRADUZIDO, e por isso a mesma ação aparece uma vez por idioma.';

DO $semeia_qgis_shortcuts$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM qgis.qgis_shortcuts) THEN
    INSERT INTO qgis.qgis_shortcuts (ferramenta, idioma, atalho, owner) VALUES
    ('Sair do QGIS','português','', 'sap'),
    ('Exit QGIS','inglês','', 'sap'),
    ('Mesclar feições selecionadas','português','M', 'sap'),
    ('Merge Selected Features','inglês','M', 'sap'),
    ('Quebrar Feições','português','C', 'sap'),
    ('Split Features','inglês','C', 'sap'),
    ('Identificar feições','português','I', 'sap'),
    ('Identify Features','inglês','I', 'sap'),
    ('Adicionar Polígono','português','A', 'sap'),
    ('Add Polygon','inglês','A', 'sap'),
    ('Desfazer seleção de feições em todas as camadas','português','D', 'sap'),
    ('Deselect Features from All Layers','inglês','D', 'sap'),
    ('Ferramenta Vértice (Todas as Camadas)','português','N', 'sap'),
    ('Vertex Tool (All Layers)','inglês','N', 'sap'),
    ('Salvar para todas as camadas','português','Ctrl+S', 'sap'),
    ('Save for All Layers','inglês','Ctrl+S', 'sap'),
    ('Habilitar traçar','português','T', 'sap'),
    ('Enable Tracing','inglês','T', 'sap'),
    ('Remodelar feições','português','R', 'sap'),
    ('Reshape Features','inglês','R', 'sap'),
    ('Área','português','Z', 'sap'),
    ('Measure Area','inglês','Z', 'sap'),
    ('Linha','português','X', 'sap'),
    ('Measure Line','inglês','X', 'sap'),
    ('DSGTools: Seletor Genérico','português','S', 'sap'),
    ('DSGTools: Generic Selector','inglês','S', 'sap'),
    ('DSGTools: Ferramenta de aquisição com ângulos retos','português','E', 'sap'),
    ('DSGTools: Right Degree Angle Digitizing','inglês','E', 'sap'),
    ('Edição Topológica','português','H', 'sap'),
    ('Topological Editing','inglês','H', 'sap'),
    ('Salvar','português','', 'sap'),
    ('Save','inglês','', 'sap'),
    ('Select Feature(s)','inglês','V', 'sap'),
    ('Feição(s)','português','V', 'sap'),
    ('DSGTools: Inspecionar anterior','português','Q', 'sap'),
    ('DSGTools: Back Inspect','inglês','Q', 'sap'),
    ('DSGTools: Inspecionar próximo','português','W', 'sap'),
    ('DSGTools: Next Inspect','inglês','W', 'sap'),
    ('DSGTools: Desenhar Forma','português','G', 'sap'),
    ('DSGTools: Draw Shape','inglês','G', 'sap'),
    ('Desfazer','português','', 'sap'),
    ('Undo','inglês','', 'sap'),
    ('Mostrar camadas selecionadas','português','', 'sap'),
    ('Show Selected Layers','inglês','', 'sap'),
    ('Esconder camadas selecionadas','português','', 'sap'),
    ('Hide Selected Layers','inglês','', 'sap'),
    ('Alternar Aderência','português','', 'sap'),
    ('Toggle Snapping','inglês','', 'sap'),
    ('DSGTools: Alterna a visibilidade de todos os textos','português','L', 'sap'),
    ('DSGTools: Toggle all labels visibility','inglês','L', 'sap'),
    ('DSGTools: Ferramenta de Aquisição à Mão Livre','português','F', 'sap'),
    ('DSGTools: Free Hand Acquisition','inglês','F', 'sap'),
    ('DSGTools: Ferramenta de remodelagem à mão livre','português','Shift+R', 'sap'),
    ('DSGTools: Free Hand Reshape','inglês','Shift+R', 'sap'),
    ('Mostrar/Esconder marcadores para feições selecionadas','português','B', 'sap'),
    ('Mostrar/Esconder marcadores para feições selecionadas','inglês','B', 'sap'),
    ('DSGTools: Active Layer Visibility','português','Y', 'sap'),
    ('DSGTools: Active Layer Visibility','inglês','Y', 'sap'),
    ('Próximo estilo','português','Shift+W', 'sap'),
    ('Próximo estilo','inglês','Shift+W', 'sap'),
    ('Último estilo','português','Shift+Q', 'sap'),
    ('Último estilo','inglês','Shift+Q', 'sap'),
    ('DSGTools: Select Raster','português',E'\'', 'sap'),
    ('DSGTools: Select Raster','inglês',E'\'', 'sap'),
    ('Remover camada/grupo','português','Ctrl+D', 'sap'),
    ('Remove Layer/Group','inglês','Ctrl+D', 'sap'),
    ('Adicionar Linha','português','A', 'sap'),
    ('Add Line','inglês','A', 'sap'),
    ('Adicionar Ponto','português','A', 'sap'),
    ('Add Point','inglês','A', 'sap'),
    ('DSGTools: Go to next tile','inglês','Shift+S', 'sap'),
    ('DSGTools: Go to previous tile','inglês','Shift+A', 'sap'),
    ('DSGTools: Mark tile as done','inglês','Shift+D', 'sap'),
    ('DSGTools: Go to next tile','português','Shift+S', 'sap'),
    ('DSGTools: Go to previous tile','português','Shift+A', 'sap'),
    ('DSGTools: Mark tile as done','português','Shift+D', 'sap');
  END IF;
END
$semeia_qgis_shortcuts$;


-- ---------------------------------------------------------------------------
-- As rotinas que rodam fora do QGIS
-- ---------------------------------------------------------------------------
--
-- O SERVIDOR FME de onde as rotinas de validação são chamadas.
--
-- `url` É COLUNA, E NASCE SEM LINHA NENHUMA. O endereço do servidor é da
-- instalação e este repositório é público: quem instala cadastra o dele pelo SAP
-- Gerente. O UNIQUE existe porque dois cadastros do mesmo servidor fariam a
-- mesma rotina aparecer duas vezes na lista da subfase.
CREATE TABLE IF NOT EXISTS qgis.gerenciador_fme(
  id SERIAL NOT NULL PRIMARY KEY,
  url VARCHAR(255) NOT NULL,
  UNIQUE(url)
);


COMMENT ON TABLE qgis.gerenciador_fme IS
    'Servidor FME de onde as rotinas de validação são chamadas. Nasce vazia: o endereço é da instalação.';

-- ---------------------------------------------------------------------------
-- O catálogo que o SAP Gerente publica
-- ---------------------------------------------------------------------------
--
-- AS SEIS TABELAS ABAIXO NASCEM VAZIAS, e nenhuma delas tem semente aqui. O
-- conteúdo é XML e JSON de dezenas de KB por linha (um QML de estilo tem
-- centenas de linhas), produzido dentro do QGIS e enviado pelo SAP Gerente. O
-- `er/` do SAP 2.3.5 trazia dois estilos de exemplo colados dentro de INSERTs,
-- o que fazia um arquivo de instalação de 1.380 linhas em que 1.350 eram
-- exemplo. Aqui não vêm: instalação nova é ESTRUTURA, e conteúdo se carrega.
--
-- `nome` É A CHAVE DE NEGÓCIO em todas elas, e por isso é UNIQUE: o cliente pede
-- o menu, o tema e o alias PELO NOME.

-- O menu customizado do QGIS (a definição inteira em texto).
CREATE TABLE IF NOT EXISTS qgis.qgis_menus(
  id SERIAL NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL,
  definicao_menu TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_menus UNIQUE (nome)
);


COMMENT ON TABLE qgis.qgis_menus IS
    'Menu customizado do QGIS. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O tema de camadas (quais camadas ficam visíveis em cada contexto).
CREATE TABLE IF NOT EXISTS qgis.qgis_themes(
  id SERIAL NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL,
  definicao_tema TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_themes UNIQUE (nome)
);


COMMENT ON TABLE qgis.qgis_themes IS
    'Tema de camadas do QGIS. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O apelido de cada campo de cada camada, para o formulário de aquisição não
-- mostrar o nome cru da coluna.
CREATE TABLE IF NOT EXISTS qgis.layer_alias(
  id SERIAL NOT NULL PRIMARY KEY,
  nome TEXT NOT NULL,
  definicao_alias TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_alias UNIQUE (nome)
);


COMMENT ON TABLE qgis.layer_alias IS
    'Apelido dos campos das camadas de aquisição. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O GRUPO de estilos. É ele, e não o estilo, que a subfase escolhe: uma linha de
-- produção usa "o estilo de restituição", que são dezenas de QMLs, um por
-- camada.
CREATE TABLE IF NOT EXISTS qgis.group_styles(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  UNIQUE(nome)
);


COMMENT ON TABLE qgis.group_styles IS
    'Grupo de estilos. É o grupo, e não o estilo camada a camada, que producao.perfil_estilo aponta.';

-- O ESTILO DE UMA CAMADA DENTRO DE UM GRUPO.
--
-- NÃO CONFUNDIR COM `public.layer_styles`, que vive em `er/versao.sql`: aquela é
-- lida pelo GERENCIADOR DE ESTILOS DO PRÓPRIO QGIS, direto do banco, sem passar
-- pela API, e por isso não pode mudar de nome nem de schema. Esta aqui é o
-- catálogo do SAP, agrupado, versionado por `owner`/`update_time` e distribuído
-- por subfase e lote. As duas guardam QML e as duas existem de propósito.
--
-- A identidade é (schema, tabela, grupo), e NÃO inclui a coluna de geometria:
-- uma camada com duas geometrias teria dois estilos indistinguíveis pela chave,
-- e isso nunca aconteceu na produção da Divisão. É a chave do SAP 2.3.5, mantida
-- para o catálogo publicado de lá entrar aqui sem tradução.
CREATE TABLE IF NOT EXISTS qgis.layer_styles(
  id SERIAL NOT NULL PRIMARY KEY,
  f_table_schema VARCHAR(255) NOT NULL,
  f_table_name VARCHAR(255) NOT NULL,
  f_geometry_column VARCHAR(255) NOT NULL,
  grupo_estilo_id INTEGER NOT NULL REFERENCES qgis.group_styles (id),
  styleqml TEXT,
  stylesld TEXT,
  ui TEXT,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_styles UNIQUE (f_table_schema, f_table_name, grupo_estilo_id)
);


COMMENT ON TABLE qgis.layer_styles IS
    'Estilo de uma camada dentro de um grupo. É o CATÁLOGO do SAP, e não a public.layer_styles que o próprio QGIS lê.';

-- `grupo_estilo_id` é o terceiro campo do UNIQUE, então não tem índice próprio
-- por ele. Apagar um grupo varre a tabela inteira sem este índice.
CREATE INDEX IF NOT EXISTS idx_layer_styles_grupo ON qgis.layer_styles (grupo_estilo_id);


-- As regras de atributo que o DSGTools cobra durante a aquisição.
CREATE TABLE IF NOT EXISTS qgis.layer_rules(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  regra TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(nome)
);


COMMENT ON TABLE qgis.layer_rules IS
    'Regra de atributo cobrada durante a aquisição. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O modelo de processamento do QGIS (o .model3 exportado como XML).
CREATE TABLE IF NOT EXISTS qgis.qgis_models(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  model_xml TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);


COMMENT ON TABLE qgis.qgis_models IS
    'Modelo de processamento do QGIS. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- O workflow do DSGTools (a sequência de modelos com os seus parâmetros).
CREATE TABLE IF NOT EXISTS qgis.workflow_dsgtools(
  id SERIAL NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE,
  descricao TEXT NOT NULL,
  workflow_json TEXT NOT NULL,
  owner VARCHAR(255) NOT NULL,
  update_time TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
);


COMMENT ON TABLE qgis.workflow_dsgtools IS
    'Workflow do DSGTools. Nasce vazia: o conteúdo é publicado pelo SAP Gerente.';

-- --------------------------------------------------------------------------
-- 3. O schema `producao`: o core que veio do SAP 2.3.5
-- --------------------------------------------------------------------------

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
-- `er/qgis.sql`: as onze tabelas de perfil apontam para o catálogo do QGIS, o
-- etapa, o bloco e a unidade de trabalho apontam `acervo.lote`, o
-- `relacionamento_versao` aponta `acervo.versao` e toda coluna de auditoria
-- aponta `dgeo.usuario`.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS producao;


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
CREATE TABLE IF NOT EXISTS producao.linha_producao(
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

CREATE INDEX IF NOT EXISTS idx_linha_producao_subtipo ON producao.linha_producao (subtipo_produto_id);


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


-- ---------------------------------------------------------------------------
-- FASE, SUBFASE e o pré-requisito entre subfases
-- ---------------------------------------------------------------------------
--
-- A FASE SÓ AGRUPA. Ela não tem nome próprio: o nome vem de
-- `dominio.tipo_fase`, que corresponde às fases do RTM e às do metadado do
-- BDGEx. O que a fase acrescenta é a ORDEM dentro de uma linha de produção.
CREATE TABLE IF NOT EXISTS producao.fase(
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

CREATE INDEX IF NOT EXISTS idx_fase_tipo ON producao.fase (tipo_fase_id);


-- A SUBFASE é onde o trabalho de fato acontece: é ela que tem camadas, insumos,
-- unidades de trabalho e perfis de configuração do QGIS.
CREATE TABLE IF NOT EXISTS producao.subfase(
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

CREATE INDEX IF NOT EXISTS idx_subfase_fase ON producao.subfase (fase_id);


-- O QUE UMA SUBFASE EXIGE DE OUTRA, espacialmente. Não é "a subfase B começa
-- depois da A": é "a REGIÃO que B vai trabalhar precisa estar concluída em A"
-- (tipo 1) ou "não pode estar em execução em A" (tipo 2). O gatilho
-- `a_relacionamento_pre_requisito_subfase` materializa isso par a par em
-- `producao.relacionamento_ut`, e é dali que a distribuição lê.
CREATE TABLE IF NOT EXISTS producao.pre_requisito_subfase(
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

CREATE INDEX IF NOT EXISTS idx_pre_requisito_subfase_tipo ON producao.pre_requisito_subfase (tipo_pre_requisito_id);
CREATE INDEX IF NOT EXISTS idx_pre_requisito_subfase_posterior ON producao.pre_requisito_subfase (subfase_posterior_id);


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
CREATE TABLE IF NOT EXISTS producao.etapa(
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

CREATE INDEX IF NOT EXISTS idx_etapa_tipo ON producao.etapa (tipo_etapa_id);
CREATE INDEX IF NOT EXISTS idx_etapa_lote ON producao.etapa (lote_id);


-- QUEM PODE (OU NÃO) REPETIR ENTRE DUAS ETAPAS. Tipo 1 exige operadores
-- distintos (quem executou não revisa), tipo 2 exige o mesmo operador (quem
-- executou é quem corrige).
--
-- O TIPO 3 DO SAP ("Operadores no mesmo turno") NÃO EXISTE MAIS, e a ausência é
-- a regra: ele dependia de `dgeo.usuario.tipo_turno_id`, que não atravessou.
-- Medido no dump de produção de 2026-08-09: das 98 linhas desta tabela, ZERO
-- eram do tipo 3. Ressuscitá-lo é decisão, e decisão se registra em
-- `docs/decisoes.md`.
CREATE TABLE IF NOT EXISTS producao.restricao_etapa(
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

CREATE INDEX IF NOT EXISTS idx_restricao_etapa_tipo ON producao.restricao_etapa (tipo_restricao_id);
CREATE INDEX IF NOT EXISTS idx_restricao_etapa_posterior ON producao.restricao_etapa (etapa_posterior_id);


-- ---------------------------------------------------------------------------
-- AS CAMADAS que a subfase edita
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS producao.camada(
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
CREATE TABLE IF NOT EXISTS producao.propriedades_camada(
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

CREATE INDEX IF NOT EXISTS idx_propriedades_camada_subfase ON producao.propriedades_camada (subfase_id);


-- ---------------------------------------------------------------------------
-- O DADO DE PRODUÇÃO: onde a unidade de trabalho é editada
-- ---------------------------------------------------------------------------
--
-- `configuracao_producao` É O NOME DO BANCO de produção, e nunca o endereço
-- dele. O servidor e a porta vêm da conexão que o cliente já tem, e este
-- repositório é público: nenhum valor aqui.
CREATE TABLE IF NOT EXISTS producao.dado_producao(
  id SERIAL NOT NULL PRIMARY KEY,
  tipo_dado_producao_id SMALLINT NOT NULL REFERENCES dominio.tipo_dado_producao (code),
  configuracao_producao VARCHAR(255),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);


COMMENT ON TABLE producao.dado_producao IS
    'Onde a unidade de trabalho é editada. Guarda o NOME do banco de produção, nunca o endereço dele.';

CREATE INDEX IF NOT EXISTS idx_dado_producao_tipo ON producao.dado_producao (tipo_dado_producao_id);


-- ---------------------------------------------------------------------------
-- O BLOCO: o recorte de distribuição dentro do lote
-- ---------------------------------------------------------------------------
--
-- É O QUE HABILITA O OPERADOR (`producao.habilitacao_bloco`): quem trabalha no
-- bloco Sul não recebe atividade do bloco Norte. `prioridade` é a ordem entre
-- blocos do mesmo lote quando a distribuição escolhe.
CREATE TABLE IF NOT EXISTS producao.bloco(
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

CREATE INDEX IF NOT EXISTS idx_bloco_lote ON producao.bloco (lote_id);
CREATE INDEX IF NOT EXISTS idx_bloco_status ON producao.bloco (status_execucao_id);


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
CREATE TABLE IF NOT EXISTS producao.unidade_trabalho(
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

CREATE INDEX IF NOT EXISTS idx_unidade_trabalho_subfase ON producao.unidade_trabalho (subfase_id);
CREATE INDEX IF NOT EXISTS idx_unidade_trabalho_lote ON producao.unidade_trabalho (lote_id);
CREATE INDEX IF NOT EXISTS idx_unidade_trabalho_bloco ON producao.unidade_trabalho (bloco_id);
CREATE INDEX IF NOT EXISTS idx_unidade_trabalho_dado_producao ON producao.unidade_trabalho (dado_producao_id);
CREATE INDEX IF NOT EXISTS idx_unidade_trabalho_geom ON producao.unidade_trabalho USING gist (geom);


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
CREATE TABLE IF NOT EXISTS producao.grupo_insumo(
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

CREATE TABLE IF NOT EXISTS producao.insumo(
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

CREATE INDEX IF NOT EXISTS idx_insumo_grupo ON producao.insumo (grupo_insumo_id);
CREATE INDEX IF NOT EXISTS idx_insumo_tipo ON producao.insumo (tipo_insumo_id);
CREATE INDEX IF NOT EXISTS idx_insumo_geom ON producao.insumo USING gist (geom);


-- A ASSOCIAÇÃO, que é DERIVADA da estratégia escolhida na carga
-- (`dominio.tipo_estrategia_associacao`) e por isso NÃO tem colunas de
-- auditoria: quem responde por ela é o insumo e a unidade de trabalho, cada um
-- com as suas.
CREATE TABLE IF NOT EXISTS producao.insumo_unidade_trabalho(
  id SERIAL NOT NULL PRIMARY KEY,
  unidade_trabalho_id INTEGER NOT NULL REFERENCES producao.unidade_trabalho (id),
  insumo_id INTEGER NOT NULL REFERENCES producao.insumo (id),
  caminho_padrao VARCHAR(255),
  UNIQUE (unidade_trabalho_id, insumo_id)
);


COMMENT ON TABLE producao.insumo_unidade_trabalho IS
    'Qual insumo alimenta qual unidade de trabalho. É derivada da estratégia de associação, e por isso não tem auditoria própria.';

CREATE INDEX IF NOT EXISTS idx_insumo_unidade_trabalho_insumo ON producao.insumo_unidade_trabalho (insumo_id);


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
CREATE TABLE IF NOT EXISTS producao.atividade(
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

CREATE INDEX IF NOT EXISTS idx_atividade_etapa ON producao.atividade (etapa_id);
CREATE INDEX IF NOT EXISTS idx_atividade_unidade_trabalho ON producao.atividade (unidade_trabalho_id);
CREATE INDEX IF NOT EXISTS idx_atividade_tipo_situacao ON producao.atividade (tipo_situacao_atividade_id);
CREATE INDEX IF NOT EXISTS idx_atividade_usuario ON producao.atividade (usuario_uuid);


-- Uma atividade VIVA por (etapa, unidade de trabalho). O code 5 ('Não
-- finalizada') fica de fora porque ele é justamente o registro das tentativas
-- que não vingaram, e pode haver várias.
CREATE UNIQUE INDEX IF NOT EXISTS atividade_unique_index
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
CREATE TABLE IF NOT EXISTS producao.habilitacao(
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
CREATE TABLE IF NOT EXISTS producao.habilitacao_etapa(
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

CREATE INDEX IF NOT EXISTS idx_habilitacao_etapa_subfase ON producao.habilitacao_etapa (subfase_id);
CREATE INDEX IF NOT EXISTS idx_habilitacao_etapa_tipo ON producao.habilitacao_etapa (tipo_etapa_id);


-- UMA HABILITAÇÃO POR PESSOA, e o UNIQUE em `usuario_uuid` é quem cobra. Uma
-- pessoa em dois grupos receberia trabalho por dois caminhos com prioridades
-- diferentes, e a distribuição não teria como desempatar.
CREATE TABLE IF NOT EXISTS producao.habilitacao_usuario(
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

CREATE INDEX IF NOT EXISTS idx_habilitacao_usuario_habilitacao ON producao.habilitacao_usuario (habilitacao_id);


-- EM QUE BLOCOS A PESSOA TRABALHA. Sem UNIQUE de propósito: trabalhar em dois
-- blocos é o caso comum, e o SAP também não o tinha.
CREATE TABLE IF NOT EXISTS producao.habilitacao_bloco(
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

CREATE INDEX IF NOT EXISTS idx_habilitacao_bloco_usuario ON producao.habilitacao_bloco (usuario_uuid);
CREATE INDEX IF NOT EXISTS idx_habilitacao_bloco_bloco ON producao.habilitacao_bloco (bloco_id);


-- QUE DIFICULDADE ENTREGAR A ESTA PESSOA, nesta subfase deste lote. É o que
-- permite mandar o trabalho difícil para quem tem prática e o fácil para quem
-- está aprendendo, sem tirar ninguém da fila.
CREATE TABLE IF NOT EXISTS producao.habilitacao_dificuldade(
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

CREATE INDEX IF NOT EXISTS idx_habilitacao_dificuldade_subfase ON producao.habilitacao_dificuldade (subfase_id);
CREATE INDEX IF NOT EXISTS idx_habilitacao_dificuldade_lote ON producao.habilitacao_dificuldade (lote_id);
CREATE INDEX IF NOT EXISTS idx_habilitacao_dificuldade_tipo ON producao.habilitacao_dificuldade (tipo_perfil_dificuldade_id);


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
CREATE TABLE IF NOT EXISTS producao.fila_prioritaria(
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

CREATE INDEX IF NOT EXISTS idx_fila_prioritaria_usuario ON producao.fila_prioritaria (usuario_uuid);


-- O mesmo furo de fila, para um GRUPO inteiro.
CREATE TABLE IF NOT EXISTS producao.fila_prioritaria_grupo(
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

CREATE INDEX IF NOT EXISTS idx_fila_prioritaria_grupo_habilitacao ON producao.fila_prioritaria_grupo (habilitacao_id);


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
CREATE TABLE IF NOT EXISTS producao.problema_atividade(
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

CREATE INDEX IF NOT EXISTS idx_problema_atividade_atividade ON producao.problema_atividade (atividade_id);
CREATE INDEX IF NOT EXISTS idx_problema_atividade_usuario ON producao.problema_atividade (usuario_uuid);
CREATE INDEX IF NOT EXISTS idx_problema_atividade_tipo ON producao.problema_atividade (tipo_problema_atividade_id);
CREATE INDEX IF NOT EXISTS idx_problema_atividade_geom ON producao.problema_atividade USING gist (geom);


-- A ALTERAÇÃO DE FLUXO é o problema que exige refazer alguma coisa: ela não tem
-- tipo, porque o que ela guarda é a decisão de quem gerencia, escrita à mão.
CREATE TABLE IF NOT EXISTS producao.alteracao_fluxo(
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

CREATE INDEX IF NOT EXISTS idx_alteracao_fluxo_atividade ON producao.alteracao_fluxo (atividade_id);
CREATE INDEX IF NOT EXISTS idx_alteracao_fluxo_usuario ON producao.alteracao_fluxo (usuario_uuid);
CREATE INDEX IF NOT EXISTS idx_alteracao_fluxo_geom ON producao.alteracao_fluxo USING gist (geom);


-- O DIÁRIO DE MUDANÇAS DO FLUXO, em texto. Derivada de nada e apontando para
-- nada: é o que o gerente escreve quando muda a linha de produção no meio do
-- caminho, e o que a tela de acompanhamento mostra como histórico.
CREATE TABLE IF NOT EXISTS producao.relatorio_alteracao(
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
CREATE TABLE IF NOT EXISTS producao.perfil_requisito_finalizacao(
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

CREATE INDEX IF NOT EXISTS idx_perfil_requisito_finalizacao_subfase ON producao.perfil_requisito_finalizacao (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_requisito_finalizacao_lote ON producao.perfil_requisito_finalizacao (lote_id);


-- As rotinas FME que rodam nesta subfase deste lote.
--
-- `requisito_finalizacao` TRUE faz a rotina BARRAR a finalização quando acusa
-- erro; FALSE a deixa informativa. `tipo_rotina_id` diz se ela aceita falso
-- positivo.
CREATE TABLE IF NOT EXISTS producao.perfil_fme(
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

CREATE INDEX IF NOT EXISTS idx_perfil_fme_subfase ON producao.perfil_fme (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_fme_lote ON producao.perfil_fme (lote_id);
CREATE INDEX IF NOT EXISTS idx_perfil_fme_tipo_rotina ON producao.perfil_fme (tipo_rotina_id);


-- Como as ferramentas do DSGTools nascem configuradas.
CREATE TABLE IF NOT EXISTS producao.perfil_configuracao_qgis(
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

CREATE INDEX IF NOT EXISTS idx_perfil_configuracao_qgis_subfase ON producao.perfil_configuracao_qgis (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_configuracao_qgis_lote ON producao.perfil_configuracao_qgis (lote_id);


-- O grupo de estilos que as camadas recebem.
CREATE TABLE IF NOT EXISTS producao.perfil_estilo(
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

CREATE INDEX IF NOT EXISTS idx_perfil_estilo_subfase ON producao.perfil_estilo (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_estilo_lote ON producao.perfil_estilo (lote_id);


-- As regras de atributo que o DSGTools cobra.
CREATE TABLE IF NOT EXISTS producao.perfil_regras(
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

CREATE INDEX IF NOT EXISTS idx_perfil_regras_subfase ON producao.perfil_regras (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_regras_lote ON producao.perfil_regras (lote_id);


-- O menu customizado. `menu_revisao` marca o menu que só aparece nas etapas de
-- revisão, e é por isso que o mesmo lote pode ter dois menus para a mesma
-- subfase.
CREATE TABLE IF NOT EXISTS producao.perfil_menu(
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

CREATE INDEX IF NOT EXISTS idx_perfil_menu_subfase ON producao.perfil_menu (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_menu_lote ON producao.perfil_menu (lote_id);


-- O tema de camadas.
CREATE TABLE IF NOT EXISTS producao.perfil_tema(
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

CREATE INDEX IF NOT EXISTS idx_perfil_tema_subfase ON producao.perfil_tema (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_tema_lote ON producao.perfil_tema (lote_id);


-- Os modelos de processamento do QGIS, na ordem em que rodam.
CREATE TABLE IF NOT EXISTS producao.perfil_model_qgis(
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

CREATE INDEX IF NOT EXISTS idx_perfil_model_qgis_subfase ON producao.perfil_model_qgis (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_model_qgis_lote ON producao.perfil_model_qgis (lote_id);
CREATE INDEX IF NOT EXISTS idx_perfil_model_qgis_tipo_rotina ON producao.perfil_model_qgis (tipo_rotina_id);


-- QUANTO DA LINHAGEM O OPERADOR VÊ. É a única tabela deste bloco com UNIQUE
-- (subfase, lote) sem terceiro campo: a resposta é uma só por subfase de lote.
--
-- Ela existe porque mostrar quem executou a etapa anterior enviesa a revisão, e
-- esconder sempre impede o revisor de saber com quem falar. `dominio.tipo_exibicao`
-- é quem declara o meio-termo (só revisores veem).
CREATE TABLE IF NOT EXISTS producao.perfil_linhagem(
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

CREATE INDEX IF NOT EXISTS idx_perfil_linhagem_lote ON producao.perfil_linhagem (lote_id);
CREATE INDEX IF NOT EXISTS idx_perfil_linhagem_tipo_exibicao ON producao.perfil_linhagem (tipo_exibicao_id);


-- O workflow do DSGTools.
CREATE TABLE IF NOT EXISTS producao.perfil_workflow_dsgtools(
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

CREATE INDEX IF NOT EXISTS idx_perfil_workflow_dsgtools_subfase ON producao.perfil_workflow_dsgtools (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_workflow_dsgtools_lote ON producao.perfil_workflow_dsgtools (lote_id);


-- O apelido dos campos das camadas.
CREATE TABLE IF NOT EXISTS producao.perfil_alias(
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

CREATE INDEX IF NOT EXISTS idx_perfil_alias_subfase ON producao.perfil_alias (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_alias_lote ON producao.perfil_alias (lote_id);


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
CREATE TABLE IF NOT EXISTS producao.login_temporario(
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

CREATE INDEX IF NOT EXISTS idx_login_temporario_usuario ON producao.login_temporario (usuario_uuid);


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
CREATE TABLE IF NOT EXISTS producao.relacionamento_ut(
  ut_id INTEGER NOT NULL,
  ut_re_id INTEGER NOT NULL,
  tipo_pre_requisito_id INTEGER NOT NULL,
  PRIMARY KEY (ut_id, ut_re_id)
);


COMMENT ON TABLE producao.relacionamento_ut IS
    'Cache espacial: que unidade de trabalho depende de qual, dentro do mesmo lote do acervo. Sem porta de escrita, sem FK: os gatilhos a mantêm.';

-- `ut_id` é a primeira coluna da chave primária e já tem índice por ela; o lado
-- `ut_re_id` precisa do seu, porque o gatilho de DELETE varre pelos dois.
CREATE INDEX IF NOT EXISTS idx_relacionamento_ut_re ON producao.relacionamento_ut (ut_re_id);


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
CREATE TABLE IF NOT EXISTS producao.relacionamento_versao(
  versao_id BIGINT NOT NULL,
  ut_id INTEGER NOT NULL,
  PRIMARY KEY (versao_id, ut_id)
);


COMMENT ON TABLE producao.relacionamento_versao IS
    'Cache espacial: que versão do acervo cada unidade de trabalho produz. Era relacionamento_produto no SAP, e a ponta virou acervo.versao.';

CREATE INDEX IF NOT EXISTS idx_relacionamento_versao_ut ON producao.relacionamento_versao (ut_id);


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

DROP TRIGGER IF EXISTS chk_subfase_lote_consistency ON producao.atividade;

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

DROP TRIGGER IF EXISTS a_relacionamento_unidade_trabalho ON producao.unidade_trabalho;

CREATE TRIGGER a_relacionamento_unidade_trabalho
  AFTER INSERT OR UPDATE OR DELETE ON producao.unidade_trabalho
  FOR EACH ROW EXECUTE PROCEDURE producao.update_relacionamento_ut();


-- MUDAR O PRÉ-REQUISITO ENTRE SUBFASES muda o cache de TODAS as unidades de
-- trabalho das duas subfases de uma vez, e por isso esta função não passa por
-- array de ids: ela apaga e reinsere o par de subfases inteiro.
CREATE OR REPLACE FUNCTION producao.update_relacionamento_ut_prs()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    DELETE FROM producao.relacionamento_ut AS ru
    WHERE EXISTS (
      SELECT 1
      FROM producao.unidade_trabalho AS ut
      INNER JOIN producao.pre_requisito_subfase AS prs ON prs.subfase_posterior_id = ut.subfase_id
      INNER JOIN producao.unidade_trabalho AS ut_re
        ON ut_re.subfase_id = prs.subfase_anterior_id AND ut.lote_id = ut_re.lote_id
      WHERE prs.subfase_anterior_id = OLD.subfase_anterior_id
        AND prs.subfase_posterior_id = OLD.subfase_posterior_id
        AND ut.geom && ut_re.geom
        AND st_relate(ut.geom, ut_re.geom, '2********')
        AND ru.ut_id = ut.id AND ru.ut_re_id = ut_re.id
    );
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO producao.relacionamento_ut (ut_id, ut_re_id, tipo_pre_requisito_id)
    SELECT ut.id AS ut_id, ut_re.id AS ut_re_id, prs.tipo_pre_requisito_id
    FROM producao.unidade_trabalho AS ut
    INNER JOIN producao.pre_requisito_subfase AS prs ON prs.subfase_posterior_id = ut.subfase_id
    INNER JOIN producao.unidade_trabalho AS ut_re
      ON ut_re.subfase_id = prs.subfase_anterior_id AND ut.lote_id = ut_re.lote_id
    WHERE prs.subfase_anterior_id = NEW.subfase_anterior_id
      AND prs.subfase_posterior_id = NEW.subfase_posterior_id
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
    'Gatilho do pré-requisito entre subfases: refaz o cache do par de subfases inteiro, e não de uma unidade de trabalho.';

DROP TRIGGER IF EXISTS a_relacionamento_pre_requisito_subfase ON producao.pre_requisito_subfase;

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

DROP TRIGGER IF EXISTS a_relacionamento_versao ON acervo.versao;

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

DROP TRIGGER IF EXISTS chk_lote_status_consistency ON acervo.lote;

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
CREATE OR REPLACE FUNCTION producao.chk_bloco_status() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM acervo.lote
    WHERE id = NEW.lote_id
      AND status_execucao_id IN (3, 4)
  ) THEN
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
    'Recusa criar, reabrir ou alterar o status de bloco cujo lote do acervo já está encerrado.';

DROP TRIGGER IF EXISTS chk_bloco_status_consistency ON producao.bloco;

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

DROP TRIGGER IF EXISTS chk_projeto_status_consistency ON acervo.projeto;

CREATE TRIGGER chk_projeto_status_consistency
  BEFORE INSERT OR UPDATE ON acervo.projeto
  FOR EACH ROW EXECUTE PROCEDURE producao.chk_projeto_status();

-- --------------------------------------------------------------------------
-- 4. O schema `metadado`: a ficha ET-PCDG
-- --------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Metadado: o que a ficha ET-PCDG imprime e o que o XML de metadado publica
-- ---------------------------------------------------------------------------
--
-- Este schema nao guarda producao nem acervo. Ele guarda o que a NORMA exige
-- que acompanhe o dado quando ele sai da Divisao: resumo, proposito, creditos,
-- grau de sigilo, restricao de uso, datum vertical, especificacao tecnica,
-- responsavel por cada fase, PEC planimetrico e altimetrico, sensor da
-- ortoimagem. Nada disso e derivavel do acervo, e nada disso e opinional: sao
-- os campos da ISO19115 na perfilagem da PCDG.
--
-- Duas saidas leem daqui, e so elas:
--   1. A FICHA ET-PCDG, o quadro impresso na moldura da carta.
--   2. O XML DE METADADO que viaja junto com o produto entregue.
--
-- VEIO DO SAP 2.3.5 (schema `metadado`, 16 tabelas), na travessia de
-- 2026-08-09. A adaptacao tem tres cortes, e todos vem do contrato do SAP 3.0:
--
--   1. `produto_id`, que apontava `macrocontrole.produto`, virou `versao_id`
--      apontando `acervo.versao (id)`. O produto do SAP e a VERSAO do acervo,
--      e nao o produto do acervo: metadado descreve uma EDICAO especifica, e a
--      mesma folha reeditada em outro ano tem outro resumo, outra data de
--      criacao e outro responsavel. Decisao do chefe, 2026-08-09.
--   2. `lote_id`, que apontava `macrocontrole.lote`, aponta `acervo.lote (id)`.
--      Decisao do chefe, 2026-08-09: a producao liga direto no lote do acervo,
--      e a `producao.lote_linha` que este arquivo apontou por algumas horas foi
--      removida pela mesma decisao, antes de chegar a banco nenhum.
--
--      O QUE ISSO CUSTA E O AVISO DESTE SCHEMA: um lote do acervo carrega mais
--      de uma linha de producao (carta e CDGV no mesmo lote, em 61 dos 102
--      lotes com versao, medido em 2026-08-09), e o metadado de nivel LOTE
--      passou a valer para as duas. Quando a ficha da carta e a do CDGV
--      divergirem -- e elas divergem em especificacao, em PEC e em datum
--      vertical --, declare no nivel da VERSAO, que sobrescreve o do lote. O
--      XOR de `versao_id` e `lote_id`, explicado mais abaixo, e o que torna
--      isso possivel, e passou a ser a unica saida para essa diferenca.
--   3. `metadado.usuario.usuario_sap_id` virou
--      `usuario_uuid UUID REFERENCES dgeo.usuario (uuid)`, que e como todo o
--      SCA aponta gente.
--
-- NAO HA GEOMETRIA NESTE SCHEMA, e por isso a regra do SRID 4674 nao tem onde
-- morder aqui. A extensao de um produto sai de `acervo.produto.geom`, que ja
-- esta em 4674.
--
-- CARREGA DEPOIS DE `dgeo`, DE `acervo` E DE `producao`: aponta
-- `dgeo.usuario (uuid)`, `acervo.versao (id)`, `acervo.lote (id)` e
-- `producao.fase (id)`.
--
-- TIPO DAS CHAVES: onde o SAP declarava INTEGER apontando uma coluna SMALLINT
-- de dominio, aqui a coluna e SMALLINT. O Postgres aceita a chave estrangeira
-- entre os dois, mas a divergencia so serve para confundir quem le e para
-- gastar dois bytes por linha sem motivo.
CREATE SCHEMA IF NOT EXISTS metadado;


COMMENT ON SCHEMA metadado IS
    'Metadado ISO19115 na perfilagem da PCDG. É a fonte da ficha ET-PCDG e do XML que viaja com o produto entregue.';

-- ---------------------------------------------------------------------------
-- Dominios da norma. Nao sao rotulos de tela.
-- ---------------------------------------------------------------------------
--
-- ATENCAO AO `nome` DESTAS QUATRO TABELAS: ele NAO e texto de interface, e nao
-- se traduz nem se acentua. O valor sai LITERAL para dentro do XML, onde a
-- ISO19115 espera exatamente 'ultraSecreto', 'intellectualPropertyRights' e
-- 'otherRestrictions', em camelCase e em ingles onde a norma assim os nomeia.
-- Trocar 'ostensivo' por 'Ostensivo' quebra o consumidor do XML sem quebrar
-- nada aqui dentro, e o erro so aparece do lado de quem recebe o produto.
--
-- Os codigos sao os do SAP, e essa e a regra da travessia inteira: linha
-- migrada nao precisa de tabela de traducao.

-- Tipos de palavra chave previstos na ISO19115 / PCDG.
CREATE TABLE IF NOT EXISTS metadado.tipo_palavra_chave(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);


INSERT INTO metadado.tipo_palavra_chave (code, nome) VALUES
(1, 'disciplinar'),
(2, 'geologica'),
(3, 'tematica'),
(4, 'temporal'),
(5, 'toponimica')
ON CONFLICT (code) DO NOTHING;


-- MD_ClassificationCode. O grau de sigilo do produto.
CREATE TABLE IF NOT EXISTS metadado.codigo_classificacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);


INSERT INTO metadado.codigo_classificacao (code, nome) VALUES
(1, 'ostensivo'),
(2, 'reservado'),
(3, 'confidencial'),
(4, 'secreto'),
(5, 'ultraSecreto')
ON CONFLICT (code) DO NOTHING;


-- MD_RestrictionCode. Serve a TRES colunas diferentes de `informacoes_produto`
-- (limitacao de acesso, limitacao de uso e restricao de uso), que a norma
-- separa e que a ficha imprime em linhas distintas.
CREATE TABLE IF NOT EXISTS metadado.codigo_restricao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);


INSERT INTO metadado.codigo_restricao (code, nome) VALUES
(1, 'copyright'),
(2, 'patent'),
(3, 'patentPending'),
(4, 'trademark'),
(5, 'license'),
(6, 'intellectualPropertyRights'),
(7, 'restricted'),
(8, 'otherRestrictions')
ON CONFLICT (code) DO NOTHING;


-- O referencial ALTIMETRICO do produto, que nao e o mesmo do horizontal.
--
-- O CODE 0 EXISTE E E LEGITIMO: produto sem altimetria (uma carta imagem, um
-- dado vetorial planimetrico) declara 'Sem datum vertical' em vez de mentir um
-- maregrafo. Por isso a coluna que o aponta e NOT NULL: a ausencia de datum
-- vertical e um valor, e nao um nulo.
CREATE TABLE IF NOT EXISTS metadado.datum_vertical(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);


INSERT INTO metadado.datum_vertical (code, nome) VALUES
(0, 'Sem datum vertical'),
(1, 'Datum de Imbituba - SC'),
(2, 'Datum de Santana - AP'),
(3, 'Marégrafo de Torres - RS')
ON CONFLICT (code) DO NOTHING;


-- A ESPECIFICACAO TECNICA que o produto cumpre, e nao o formato do arquivo.
--
-- E o que responde "contra qual regra este dado foi conferido". Nao confundir
-- com `dominio.subtipo_produto` do SCA, que tambem cita ET-EDGV e T34-700: la
-- e a natureza do produto no acervo, aqui e a norma declarada no metadado. As
-- duas coincidem quase sempre e nao sao a mesma coisa.
CREATE TABLE IF NOT EXISTS metadado.especificacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);


INSERT INTO metadado.especificacao (code, nome) VALUES
(1, 'ET-EDGV 2.1.3'),
(2, 'ET-EDGV 3.0'),
(3, 'T34-700'),
(4, 'ET-RDG')
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Quem responde pelo dado
-- ---------------------------------------------------------------------------

-- A ORGANIZACAO que aparece como responsavel e como distribuidora no XML.
--
-- SAO OS CINCO CGEO, e a tabela existe justamente porque o responsavel nem
-- sempre e o distribuidor: um produto levantado aqui pode ser distribuido por
-- outro Centro, e o XML exige os dois contatos completos, com endereco,
-- telefone e site.
--
-- ENDERECO POSTAL E SITE PUBLICO, e nao endereco de servidor: e o contato
-- institucional que a norma manda publicar junto com o dado, o mesmo que esta
-- na porta de cada Centro.
CREATE TABLE IF NOT EXISTS metadado.organizacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	sigla VARCHAR(255),
	endereco VARCHAR(255),
	telefone VARCHAR(255),
	site VARCHAR(255)
);


INSERT INTO metadado.organizacao (code, nome, sigla, endereco, telefone, site) VALUES
(1, '1º Centro de Geoinformação', '1º CGEO', 'Rua Cleveland, nº 250 Morro Menino de Deus - CEP:90.850-240 - Porto Alegre - RS', '(51)3232-0749', 'http://www.1cgeo.eb.mil.br/'),
(2, '2º Centro de Geoinformação', '2º CGEO', 'EPCT DF 001 - Km 4,5 Setor Habitacional Taquari - CEP:71.559-901 - Brasília - DF', '(61)3415-3853', 'http://www.2cgeo.eb.mil.br/'),
(3, '3º Centro de Geoinformação', '3º CGEO', 'Avenida Doutor Joaquim Nabuco, 1687 - CEP:53.240-650 - Olinda - PE', '(81)3439-3033', 'https://3cgeo.eb.mil.br/'),
(4, '4º Centro de Geoinformação', '4º CGEO', 'Avenida Marechal Bittencourt, 97 Santo Antônio - CEP:69.029-160 - Manaus - AM', '(92)3625-1461', 'https://4cgeo.eb.mil.br/'),
(5, '5º Centro de Geoinformação', '5º CGEO', 'Rua Major Daemon, 81 Centro - CEP:20.081-190 - Rio de Janeiro - RJ', '(21)2223-2177', 'http://www.5cgeo.eb.mil.br/')
ON CONFLICT (code) DO NOTHING;


COMMENT ON TABLE metadado.organizacao IS
    'Os cinco CGEO, com o contato que o XML publica. Responsável e distribuidor são colunas distintas em informacoes_produto porque nem sempre são a mesma OM.';

-- A IDENTIDADE PUBLICA DE UMA PESSOA NO METADADO, e nao uma segunda conta.
--
-- NAO E DUPLICATA DE `dgeo.usuario`, e a diferenca importa. `dgeo.usuario`
-- responde "quem entra no sistema": login, hash, posto, nome de guerra. Esta
-- tabela responde "que nome, que funcao e que OM saem impressos no XML" para
-- essa mesma pessoa. O nome aqui e o nome COMPLETO da assinatura, e a funcao
-- e o cargo declarado na ficha ('Chefe da Seção de Produção'), que muda sem
-- que a conta mude.
--
-- SEM UNIQUE em `usuario_uuid`, e e deliberado: a mesma pessoa pode assinar
-- como duas funcoes diferentes em produtos de anos diferentes, e o metadado
-- antigo tem de continuar dizendo o que dizia.
--
-- O `usuario_uuid` aponta `dgeo.usuario (uuid)` porque no SCA gente e UUID.
-- No SAP esta coluna se chamava `usuario_sap_id` e apontava um SERIAL.
CREATE TABLE IF NOT EXISTS metadado.usuario(
  id SERIAL NOT NULL PRIMARY KEY,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  nome VARCHAR(255) NOT NULL,
  funcao VARCHAR(255) NOT NULL,
  organizacao_id SMALLINT NOT NULL REFERENCES metadado.organizacao (code)
);


COMMENT ON TABLE metadado.usuario IS
    'O nome, a função e a OM que uma pessoa assina no metadado. Não é uma conta: a conta é dgeo.usuario, apontada por usuario_uuid.';

CREATE INDEX IF NOT EXISTS idx_metadado_usuario_usuario ON metadado.usuario (usuario_uuid);


-- QUEM RESPONDE POR CADA FASE DA PRODUCAO, no XML.
--
-- O XML nao pede um responsavel so: ele pede o responsavel da aquisicao, o da
-- restituicao, o da validacao. Uma linha aqui por fase.
--
-- O XOR ABAIXO E O MECANISMO CENTRAL DE TODO ESTE SCHEMA, e se repete em cinco
-- tabelas. Metadado se declara em DOIS niveis:
--   `lote_id` preenchido = vale para tudo o que aquele lote do acervo
--   entregar, em QUALQUER linha de producao dele. E o caso comum, e e o que
--   evita digitar a mesma ficha 60 vezes.
--   `versao_id` preenchido = vale para UMA edicao especifica, e sobrescreve o
--   nivel do lote.
-- O NIVEL DO LOTE ATRAVESSA LINHAS DE PRODUCAO, e e o aviso do cabecalho: o
-- mesmo lote entrega carta e CDGV, e a ficha dos dois nao e a mesma. Quando
-- divergirem, a declaracao desce para a versao.
-- O CHECK proibe os dois juntos e proibe os dois nulos: uma linha que nao diz
-- a quem se aplica nao e metadado de nada.
CREATE TABLE IF NOT EXISTS metadado.responsavel_fase_produto(
  id SERIAL NOT NULL PRIMARY KEY,
  -- `usuario_id` CONTINUA SENDO `usuario_id`, e continua INTEGER. A regra da
  -- travessia que troca `usuario_id` por `usuario_uuid` vale para quem aponta
  -- `dgeo.usuario`; esta coluna aponta `metadado.usuario`, que e a identidade
  -- publicada e nao a conta. Quem "consertar" isto quebra a assinatura da
  -- ficha.
  usuario_id INTEGER NOT NULL REFERENCES metadado.usuario (id),
  fase_id INTEGER NOT NULL REFERENCES producao.fase (id),
  versao_id BIGINT REFERENCES acervo.versao (id),
  lote_id BIGINT REFERENCES acervo.lote (id),
  CONSTRAINT responsavel_fase_produto_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL))
);


COMMENT ON TABLE metadado.responsavel_fase_produto IS
    'Responsável por uma fase, declarado por versão OU por lote do acervo, nunca pelos dois. O nome da tabela guarda "produto" por herança do SAP: o que ela aponta é acervo.versao.';

CREATE INDEX IF NOT EXISTS idx_responsavel_fase_versao ON metadado.responsavel_fase_produto (versao_id);
CREATE INDEX IF NOT EXISTS idx_responsavel_fase_lote ON metadado.responsavel_fase_produto (lote_id);


-- ---------------------------------------------------------------------------
-- O corpo do metadado
-- ---------------------------------------------------------------------------

-- A PALAVRA CHAVE, e ela e EXCLUSIVAMENTE de nivel versao.
--
-- E a unica tabela deste schema sem o XOR: nao existe palavra chave de lote, e
-- a ausencia e a regra. Toponimo e descricao sao por FOLHA, e o nome do
-- produto entra aqui como toponimo. Herdar a palavra chave do lote faria toda
-- folha do lote se descrever pelo mesmo lugar.
CREATE TABLE IF NOT EXISTS metadado.palavra_chave_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	tipo_palavra_chave_id SMALLINT NOT NULL REFERENCES metadado.tipo_palavra_chave (code),
	versao_id BIGINT NOT NULL REFERENCES acervo.versao (id)
);


COMMENT ON TABLE metadado.palavra_chave_produto IS
    'Palavra-chave do produto. Só existe no nível da versão: toponímia é por folha, e não por lote.';

CREATE INDEX IF NOT EXISTS idx_palavra_chave_versao ON metadado.palavra_chave_produto (versao_id);


-- O QUE O PRODUTO E, PARA QUE SERVE E DE QUEM E. E o bloco de identificacao do
-- XML e a parte de cima da ficha ET-PCDG.
--
-- `declaracao_linhagem` e o texto que conta COMO o dado foi feito, e e o campo
-- mais longo da ficha. Ele nao se calcula do fluxo de producao: e redigido.
--
-- `projeto_bdgex` e NOT NULL porque o XML sem ele nao e aceito na carga do
-- BDGEx, que e o destino de todo produto que sai daqui.
--
-- `responsavel_produto_id` e o responsavel GERAL, e nao substitui
-- `responsavel_fase_produto`: no XML sao papeis distintos.
CREATE TABLE IF NOT EXISTS metadado.informacoes_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT informacoes_produto_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	resumo TEXT,
	proposito TEXT,
	creditos TEXT,
	informacoes_complementares TEXT,
	limitacao_acesso_id SMALLINT NOT NULL REFERENCES metadado.codigo_restricao (code),
	limitacao_uso_id SMALLINT NOT NULL REFERENCES metadado.codigo_restricao (code),
	restricao_uso_id SMALLINT NOT NULL REFERENCES metadado.codigo_restricao (code),
	grau_sigilo_id SMALLINT NOT NULL REFERENCES metadado.codigo_classificacao (code),
	organizacao_responsavel_id SMALLINT NOT NULL REFERENCES metadado.organizacao (code),
	organizacao_distribuicao_id SMALLINT NOT NULL REFERENCES metadado.organizacao (code),
	datum_vertical_id SMALLINT NOT NULL REFERENCES metadado.datum_vertical (code),
	especificacao_id SMALLINT NOT NULL REFERENCES metadado.especificacao (code),
	responsavel_produto_id INTEGER NOT NULL REFERENCES metadado.usuario (id),
	declaracao_linhagem TEXT,
	projeto_bdgex VARCHAR(255) NOT NULL
);


COMMENT ON TABLE metadado.informacoes_produto IS
    'Bloco de identificação do XML: resumo, propósito, créditos, sigilo, restrições, datum vertical, especificação e linhagem. Por versão OU por lote do acervo.';

CREATE INDEX IF NOT EXISTS idx_informacoes_produto_versao ON metadado.informacoes_produto (versao_id);
CREATE INDEX IF NOT EXISTS idx_informacoes_produto_lote ON metadado.informacoes_produto (lote_id);


-- O QUADRO DE CREDITOS DA MOLDURA, guardado como QPT.
--
-- QPT e o arquivo de composicao de impressao do QGIS. O texto inteiro vive na
-- coluna `qpt` porque o credito nao e uma lista de nomes: e um LAYOUT, com
-- posicao, fonte e quebra de linha, e quem o desenha e o QGIS.
--
-- E CATALOGO, e nao linha por produto: um mesmo quadro de creditos serve a
-- todos os produtos que a mesma equipe assinou, e `informacoes_edicao` o
-- aponta.
CREATE TABLE IF NOT EXISTS metadado.creditos_qpt(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	qpt TEXT NOT NULL
);


COMMENT ON TABLE metadado.creditos_qpt IS
    'O quadro de créditos da moldura, em QPT do QGIS. É catálogo reaproveitável, e não uma linha por produto.';

-- OS NUMEROS DA EDICAO, e e daqui que sai quase toda a ficha ET-PCDG.
--
-- `pec_planimetrico` e `pec_altimetrico` sao VARCHAR e nao numero: o que se
-- publica e a CLASSE ('A', 'B') junto do padrao, e nao um erro medido.
--
-- `data_criacao` e VARCHAR pelo mesmo motivo, e vem assim do SAP: o que a
-- ficha imprime as vezes e um ANO, as vezes um intervalo ('2019-2021'), e
-- nunca um dia de calendario. Guardar DATE obrigaria a inventar mes e dia.
-- Ficou como pendencia declarada, e nao como descuido.
--
-- `quadro_fases` e JSON porque o quadro impresso e uma matriz de fase por
-- data, com numero de colunas que varia com a linha de producao. Modelar isso
-- em tabela custaria mais do que se ganha: nada aqui e consultado por SQL, e
-- tudo e lido de uma vez para desenhar a moldura.
--
-- `caminho_mde` e `epsg_mde` descrevem o modelo digital de elevacao usado na
-- edicao. Sao o CAMINHO no volume de producao, gravado como dado da linha, e
-- nao um endereco escrito neste arquivo.
CREATE TABLE IF NOT EXISTS metadado.informacoes_edicao(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT informacoes_edicao_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	pec_planimetrico VARCHAR(255) NOT NULL,
	pec_altimetrico VARCHAR(255) NOT NULL,
	origem_dados_altimetricos VARCHAR(255) NOT NULL,
	territorio_internacional BOOLEAN NOT NULL,
	acesso_restrito BOOLEAN NOT NULL,
	carta_militar BOOLEAN NOT NULL,
	data_criacao VARCHAR(255) NOT NULL,
	-- INTEGER, e nao o SMALLINT do SAP: `creditos_qpt.id` e SERIAL. A chave
	-- estrangeira entre os dois tipos funciona e nao deveria existir.
	creditos_id INTEGER REFERENCES metadado.creditos_qpt (id),
	epsg_mde VARCHAR(255) NOT NULL,
	caminho_mde VARCHAR(255) NOT NULL,
	dados_terceiro TEXT ARRAY,
	quadro_fases JSON NOT NULL,
	tipo_produto VARCHAR(255),
	versao_produto VARCHAR(255),
	licenca_produto VARCHAR(255),
	observacoes TEXT ARRAY,
	dpi INTEGER NOT NULL DEFAULT 300
);


COMMENT ON TABLE metadado.informacoes_edicao IS
    'Os números da edição que a ficha ET-PCDG imprime: PEC, origem da altimetria, quadro de fases, DPI e o MDE usado. Por versão OU por lote do acervo.';

CREATE INDEX IF NOT EXISTS idx_informacoes_edicao_versao ON metadado.informacoes_edicao (versao_id);
CREATE INDEX IF NOT EXISTS idx_informacoes_edicao_lote ON metadado.informacoes_edicao (lote_id);


-- ---------------------------------------------------------------------------
-- O que so a carta ortoimagem tem
-- ---------------------------------------------------------------------------
--
-- As tres tabelas abaixo nao se aplicam a carta topografica, e ficam vazias
-- para ela. Nao ha CHECK que cobre isso, e nao ha como haver: o tipo do
-- produto mora em `acervo.produto`, dois saltos acima, e a regra e da geracao
-- do XML.

-- OS SENSORES QUE PRODUZIRAM A IMAGEM. Alimenta o array "sensores" do JSON de
-- edicao. Mais de uma linha por produto e o caso normal: um mosaico costura
-- imagens de plataformas diferentes, e a ficha lista todas.
CREATE TABLE IF NOT EXISTS metadado.sensor_carta_ortoimagem(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT sensor_carta_ortoimagem_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	tipo VARCHAR(255) NOT NULL,
	plataforma VARCHAR(255) NOT NULL,
	nome VARCHAR(255) NOT NULL,
	resolucao VARCHAR(255) NOT NULL,
	bandas VARCHAR(255) NOT NULL,
	nivel_produto VARCHAR(255) NOT NULL
);


COMMENT ON TABLE metadado.sensor_carta_ortoimagem IS
    'Sensores da carta ortoimagem. A carta topográfica não usa esta tabela.';

CREATE INDEX IF NOT EXISTS idx_sensor_orto_versao ON metadado.sensor_carta_ortoimagem (versao_id);
CREATE INDEX IF NOT EXISTS idx_sensor_orto_lote ON metadado.sensor_carta_ortoimagem (lote_id);


-- AS IMAGENS QUE ENTRAM NA MOLDURA, com o estilo de cada uma.
--
-- `caminho_imagem` e `caminho_estilo` sao caminhos no volume de producao,
-- gravados como dado da linha. O estilo e anulavel porque imagem em cor
-- natural nao precisa de um.
CREATE TABLE IF NOT EXISTS metadado.imagens_carta_ortoimagem(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	CONSTRAINT imagens_carta_ortoimagem_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL)),
	caminho_imagem VARCHAR(255) NOT NULL,
	caminho_estilo VARCHAR(255),
	epsg VARCHAR(255) NOT NULL
);


COMMENT ON TABLE metadado.imagens_carta_ortoimagem IS
    'As imagens que entram na moldura da carta ortoimagem, com o estilo de cada uma.';

CREATE INDEX IF NOT EXISTS idx_imagens_orto_versao ON metadado.imagens_carta_ortoimagem (versao_id);
CREATE INDEX IF NOT EXISTS idx_imagens_orto_lote ON metadado.imagens_carta_ortoimagem (lote_id);


-- AS CLASSES VETORIAIS QUE SE DESENHAM POR CIMA DA ORTOIMAGEM.
--
-- A ortoimagem nao vem sozinha na moldura: curva de nivel, ponto cotado,
-- toponimo e limite continuam sendo desenhados. Esta tabela e o CATALOGO
-- dessas listas, e `perfil_classes_complementares_orto` e quem escolhe qual
-- lista vale para qual produto.
--
-- O ARRAY DE TEXTO E DELIBERADO, e nao uma tabela filha: o nome da classe e o
-- nome da camada na EDGV, ele nao tem chave estrangeira nenhuma para apontar
-- neste banco, e a lista e lida inteira de uma vez.
CREATE TABLE IF NOT EXISTS metadado.classes_complementares_orto(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	classes TEXT ARRAY NOT NULL
);


COMMENT ON TABLE metadado.classes_complementares_orto IS
    'Catálogo de listas de classes vetoriais desenhadas sobre a ortoimagem. Os nomes são camadas da EDGV, e por isso são texto.';

DO $semeia_classes_complementares_orto$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM metadado.classes_complementares_orto) THEN
    INSERT INTO metadado.classes_complementares_orto (nome, classes)
    VALUES ('Padrão DSG', ARRAY [
    	'llp_unidade_federacao_a',
    	'elemnat_curva_nivel_l',
    	'elemnat_ponto_cotado_p',
    	'infra_pista_pouso_p',
    	'infra_pista_pouso_l',
    	'infra_pista_pouso_a',
    	'elemnat_toponimo_fisiografico_natural_p',
    	'elemnat_toponimo_fisiografico_natural_l',
    	'elemnat_ilha_p',
    	'elemnat_ilha_a',
    	'llp_aglomerado_rural_p',
    	'llp_area_pub_militar_a',
    	'infra_elemento_energia_p',
    	'infra_elemento_energia_l',
    	'infra_elemento_energia_a',
    	'constr_extracao_mineral_p',
    	'constr_extracao_mineral_a',
    	'llp_nome_local_p',
    	'infra_elemento_infraestrutura_p',
    	'infra_elemento_infraestrutura_l',
    	'infra_elemento_infraestrutura_a',
    	'elemnat_elemento_hidrografico_p',
    	'elemnat_elemento_hidrografico_l',
    	'elemnat_elemento_hidrografico_a'
    ]);
  END IF;
END
$semeia_classes_complementares_orto$;


-- QUAL LISTA DE CLASSES COMPLEMENTARES VALE PARA QUAL PRODUTO.
--
-- Mesmo XOR das outras: por versao OU por lote do acervo.
CREATE TABLE IF NOT EXISTS metadado.perfil_classes_complementares_orto(
	id SERIAL NOT NULL PRIMARY KEY,
	versao_id BIGINT REFERENCES acervo.versao (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	classes_complementares_orto_id INTEGER NOT NULL REFERENCES metadado.classes_complementares_orto (id),
	CONSTRAINT perfil_classes_complementares_orto_xor_lote CHECK ((versao_id IS NOT NULL AND lote_id IS NULL) OR (versao_id IS NULL AND lote_id IS NOT NULL))
);


COMMENT ON TABLE metadado.perfil_classes_complementares_orto IS
    'Escolhe a lista de classes complementares de uma versão ou de um lote do acervo. "perfil" aqui é herança do SAP e não tem relação com dominio.tipo_perfil.';

CREATE INDEX IF NOT EXISTS idx_perfil_classes_orto_versao ON metadado.perfil_classes_complementares_orto (versao_id);
CREATE INDEX IF NOT EXISTS idx_perfil_classes_orto_lote ON metadado.perfil_classes_complementares_orto (lote_id);

-- --------------------------------------------------------------------------
-- 5. O schema `acompanhamento`: as views que o gerente abre no QGIS
-- --------------------------------------------------------------------------

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

CREATE SCHEMA IF NOT EXISTS acompanhamento;


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

DROP TRIGGER IF EXISTS cria_view_acompanhamento_subfase ON producao.etapa;

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

DROP TRIGGER IF EXISTS view_acompanhamento_bloco ON producao.bloco;

CREATE TRIGGER view_acompanhamento_bloco
AFTER UPDATE OR INSERT OR DELETE ON producao.bloco
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.view_acompanhamento_bloco();


DROP TRIGGER IF EXISTS view_acompanhamento_bloco_perfil ON producao.habilitacao;

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

DROP TRIGGER IF EXISTS refresh_bloco_perfil_bloco ON producao.habilitacao_bloco;

CREATE TRIGGER refresh_bloco_perfil_bloco
AFTER UPDATE OR INSERT OR DELETE ON producao.habilitacao_bloco
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();


DROP TRIGGER IF EXISTS refresh_bloco_habilitacao_usuario ON producao.habilitacao_usuario;

CREATE TRIGGER refresh_bloco_habilitacao_usuario
AFTER UPDATE OR INSERT OR DELETE ON producao.habilitacao_usuario
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();


DROP TRIGGER IF EXISTS refresh_bloco_unidade_trabalho ON producao.unidade_trabalho;

CREATE TRIGGER refresh_bloco_unidade_trabalho
AFTER UPDATE OR INSERT OR DELETE ON producao.unidade_trabalho
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();


DROP TRIGGER IF EXISTS refresh_bloco_atividade ON producao.atividade;

CREATE TRIGGER refresh_bloco_atividade
AFTER UPDATE OR INSERT OR DELETE ON producao.atividade
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();


DROP TRIGGER IF EXISTS refresh_perfil_prod_etapa ON producao.habilitacao_etapa;

CREATE TRIGGER refresh_perfil_prod_etapa
AFTER UPDATE OR INSERT OR DELETE ON producao.habilitacao_etapa
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();


DROP TRIGGER IF EXISTS refresh_perfil_etapa ON producao.etapa;

CREATE TRIGGER refresh_perfil_etapa
AFTER UPDATE OR INSERT OR DELETE ON producao.etapa
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_bloco();


DROP TRIGGER IF EXISTS refresh_bloco_lote ON acervo.lote;

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

DROP TRIGGER IF EXISTS trigger_view_acompanhamento_lote ON producao.etapa;

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

DROP TRIGGER IF EXISTS trigger_view_acompanhamento_lote_fase ON producao.fase;

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

DROP TRIGGER IF EXISTS refresh_view_acompanhamento_atividade ON producao.atividade;

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

DROP TRIGGER IF EXISTS refresh_view_acompanhamento_ut ON producao.unidade_trabalho;

CREATE TRIGGER refresh_view_acompanhamento_ut
AFTER UPDATE OR INSERT OR DELETE ON producao.unidade_trabalho
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_ut_etapa();


DROP TRIGGER IF EXISTS refresh_view_acompanhamento_etapa ON producao.etapa;

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

DROP TRIGGER IF EXISTS refresh_view_acompanhamento_subfase ON producao.subfase;

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

DROP TRIGGER IF EXISTS refresh_view_acompanhamento_produto ON acervo.versao;

CREATE TRIGGER refresh_view_acompanhamento_produto
AFTER UPDATE OR INSERT OR DELETE ON acervo.versao
FOR EACH ROW EXECUTE PROCEDURE acompanhamento.refresh_view_acompanhamento_produto();

-- --------------------------------------------------------------------------
-- 6. O schema `microcontrole`: o que se MONITORA
-- --------------------------------------------------------------------------
--
-- ELE ENTROU NESTE ARQUIVO EM 2026-08-09, DEPOIS de ele ja estar escrito e ANTES
-- de ele ser aplicado em lugar nenhum. A primeira leva deixou o microcontrole de
-- fora e registrou a ausencia em `docs/decisoes.md`; o chefe REVOGOU aquela
-- decisao no mesmo dia, e o registro de la diz isso. NAO HA UMA SEGUNDA
-- MIGRACAO: a renomeacao de produto e a chegada do core do SAP 2.3.5 sao um
-- release so, e o microcontrole faz parte do core.
--
-- SAO DUAS TABELAS AQUI, E OUTRAS TRES NUM BANCO SEPARADO. Estas duas guardam o
-- PERFIL (qual subfase de qual lote e monitorada, e como); as tres de la guardam
-- a TELEMETRIA capturada pelo plugin, que chega em milhares de linhas por turno
-- e por pessoa. O banco de la NAO E MIGRADO POR ESTE ARQUIVO nem por nenhum
-- outro: ele e instalacao propria, em `er_microcontrole/`, e nasce vazio. Uma
-- instalacao que nunca ligou telemetria simplesmente nao o tem, e o servico sobe
-- do mesmo jeito.
--
-- `lote_id` APONTA `acervo.lote`, e nao um lote de producao: `producao.lote` nao
-- existe neste banco (a `producao.lote_linha` foi removida em 2026-08-09, antes
-- de esta migracao chegar a banco nenhum). Por isso a coluna e BIGINT, e no SAP
-- era INTEGER.
--
-- ELE VEM DEPOIS DO BLOCO 3, e nao por gosto: `perfil_monitoramento` referencia
-- `producao.subfase`, que nasce la. Referencia tambem `acervo.lote` e
-- `dgeo.usuario`, que ja existiam antes desta migracao.

CREATE SCHEMA IF NOT EXISTS microcontrole;

COMMENT ON SCHEMA microcontrole IS
    'O que se monitora do trabalho no QGIS: qual subfase de qual lote, e como. A telemetria capturada mora num banco separado, instalado por er_microcontrole/.';

-- A TABELA DE CODIGO NAO FOI PARA `dominio`, e e a unica do core que nao foi. A
-- razao esta no cabecalho de `er/microcontrole.sql`: ela tem uma GEMEA no outro
-- banco (`microcontrole.tipo_operacao`), onde nao existe `dominio` nenhum, e
-- separar o par faria as duas metades do mesmo subsistema parecerem coisas sem
-- relacao.
CREATE TABLE IF NOT EXISTS microcontrole.tipo_monitoramento(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

INSERT INTO microcontrole.tipo_monitoramento (code, nome) VALUES
(1, 'Monitoramento de feição'),
(2, 'Monitoramento de tela')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE microcontrole.tipo_monitoramento IS
    'O que o plugin captura: 1 feição (o que foi desenhado) e 2 tela (por onde o trabalho passou). Não são níveis, e a mesma subfase pode ter os dois.';

-- O DECIMO SEGUNDO PERFIL DE CONFIGURACAO DO LOTE. A forma e a mesma dos onze
-- `producao.perfil_*` -- (alguma coisa, subfase, lote) mais as quatro colunas de
-- auditoria da casa --, e e isso que faz a copia de configuracao entre lotes
-- (`POST /api/producao/configuracao/lote/copiar`) trata-lo pela MESMA fabrica,
-- sem caso especial.
--
-- AS COLUNAS DE AUDITORIA ENTRAM AQUI E NAO ENTRAM NA TELEMETRIA: isto e
-- CADASTRO (alguem decidiu monitorar, num dia, e responde por isso), e la e
-- MEDICAO (a linha e o proprio registro, e ninguem a edita).
CREATE TABLE IF NOT EXISTS microcontrole.perfil_monitoramento(
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

CREATE INDEX IF NOT EXISTS idx_perfil_monitoramento_subfase ON microcontrole.perfil_monitoramento (subfase_id);
CREATE INDEX IF NOT EXISTS idx_perfil_monitoramento_lote ON microcontrole.perfil_monitoramento (lote_id);

-- --------------------------------------------------------------------------
-- 7. As permissoes dos cinco schemas novos
-- --------------------------------------------------------------------------
--
-- O PROBLEMA. `er/permissao.sql` roda no fim da INSTALACAO NOVA, recebendo o
-- nome do papel da aplicacao como parametro (`$1:name`, que o `create_config.js`
-- preenche com `DB_USER`). Num banco que ja existe ninguem o roda de novo: a
-- migracao entra por psql, sem parametro, e um schema criado sem GRANT fica
-- invisivel para o servico. O sintoma seria "permission denied for schema
-- producao" na primeira consulta, e nao no boot.
--
-- A DECISAO: O PAPEL SE DESCOBRE, NAO SE ESCREVE. Este arquivo e versionado e o
-- repositorio e PUBLICO, entao o nome do usuario do banco nao pode aparecer
-- aqui; e mesmo que pudesse, ele muda de instalacao para instalacao e um nome
-- fixo faria a migracao conceder para o papel errado ou para nenhum. O bloco
-- abaixo le do PROPRIO banco quem ja tem cada um dos dois papeis e repete para
-- os schemas novos exatamente os GRANTs que `er/permissao.sql` e
-- `er/permissao_readonly.sql` declaram.
--
-- SAO DOIS PAPEIS, E ELES SE DISTINGUEM PELO QUE JA TEM
--
--   APLICACAO (`DB_USER`): quem tem INSERT em tabela de `dgeo`. `dgeo` guarda
--   usuario, login e sessao, e e o schema que o papel de leitura NUNCA recebe.
--   Exigir INSERT ali deixa de fora, de uma vez, o somente leitura e qualquer
--   papel de consulta criado a mao.
--
--   LEITURA (`DB_USER_READONLY`): quem tem SELECT em tabela de `acervo` e NAO
--   e da lista acima. E o usuario das URIs de camada do QGIS, e o criterio e o
--   proprio `er/permissao_readonly.sql`, que concede `public`, `dominio`,
--   `acervo` e `limites`.
--
-- O DONO DAS TABELAS APARECE NA PRIMEIRA LISTA, e nao e engano:
-- `er/permissao.sql` concede ao proprio `DB_USER`, que e quem instalou e quem e
-- dono, e um GRANT para o dono e materializado na ACL. Conceder de novo para ele
-- nao muda nada.
--
-- SE UMA LISTA VIER VAZIA a migracao NAO falha, e avisa. E o caso do banco de
-- ensaio, montado por superusuario e sem `permissao.sql` nenhum, e o caso de
-- quem instalou de um jeito proprio. O aviso diz o que rodar a mao.
--
-- O `CREATE` EM `acompanhamento` NAO E DESCUIDO. As funcoes daquele schema
-- emitem DDL em tempo de execucao: cada par (lote do acervo, linha de producao)
-- e cada (lote, subfase) viram uma view materializada criada na hora. Sem `CREATE` no schema, abrir um lote
-- falha na criacao da view, e a falha aparece longe de onde nasceu. As mesmas
-- funcoes escrevem em `public.layer_styles` para o QGIS saber pintar o que elas
-- geram, e por isso o INSERT, o UPDATE e o DELETE daquela tabela vem
-- nominalmente, em vez de abrir o schema `public` inteiro para escrita.
--
-- O PAPEL DE LEITURA GANHA `acompanhamento` E `producao`, E SO LEITURA. As
-- views de acompanhamento nascem com `GRANT SELECT ... TO PUBLIC` dentro da
-- propria funcao que as cria, e sem `USAGE` no SCHEMA esse grant e INERTE: o
-- Postgres cobra os dois, e a camada abriria no QGIS com erro de permissao sem
-- que nada parecesse errado. `producao` entra porque o gerente abre tambem a
-- `unidade_trabalho` sobre o mapa. `qgis` e `metadado` NAO entram, e a razao
-- esta em `er/permissao_readonly.sql`: um e configuracao de ferramenta, e o
-- outro guarda nome e identificacao de pessoa em `metadado.usuario`, o mesmo
-- criterio que ja deixou `ponto_controle` de fora.
--
-- O `ALTER DEFAULT PRIVILEGES` E O QUE COBRE A VIEW QUE AINDA NAO EXISTE. Um
-- `GRANT ... ON ALL TABLES` so alcanca o que ja esta la, e as views de
-- `acompanhamento` sao criadas em tempo de execucao, uma por lote e por subfase.
-- Sem o default, cada lote novo nasceria invisivel para o QGIS.
DO $concede$
DECLARE
  papel text;
  leitor text;
  dono text;
  achou boolean := false;
  achou_leitor boolean := false;
BEGIN
  FOR papel IN
    SELECT DISTINCT pg_get_userbyid(a.grantee)
      FROM pg_class AS c
     INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL aclexplode(c.relacl) AS a
     WHERE n.nspname = 'dgeo'
       AND c.relkind = 'r'
       AND a.privilege_type = 'INSERT'
       AND a.grantee <> 0
     ORDER BY 1
  LOOP
    achou := true;

    EXECUTE format('GRANT USAGE ON SCHEMA producao TO %I', papel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA producao TO %I', papel);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA producao TO %I', papel);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA producao TO %I', papel);

    EXECUTE format('GRANT USAGE ON SCHEMA qgis TO %I', papel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA qgis TO %I', papel);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA qgis TO %I', papel);

    EXECUTE format('GRANT USAGE ON SCHEMA metadado TO %I', papel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA metadado TO %I', papel);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA metadado TO %I', papel);

    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA acompanhamento TO %I', papel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA acompanhamento TO %I', papel);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA acompanhamento TO %I', papel);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA acompanhamento TO %I', papel);

    -- `microcontrole` e CRUD como os outros, e SEM EXECUTE: nao ha funcao neste
    -- schema. O cruzamento entre o perfil daqui e a amostra do outro banco e
    -- feito em JavaScript, porque nao existe juncao entre bancos.
    EXECUTE format('GRANT USAGE ON SCHEMA microcontrole TO %I', papel);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA microcontrole TO %I', papel);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA microcontrole TO %I', papel);

    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.layer_styles TO %I', papel);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.layer_styles_id_seq TO %I', papel);

    RAISE NOTICE 'permissoes dos schemas producao, qgis, metadado, acompanhamento e microcontrole concedidas a %', papel;
  END LOOP;

  IF NOT achou THEN
    RAISE WARNING 'nenhum papel com INSERT em dgeo foi encontrado: os schemas novos ficaram SEM GRANT para a aplicacao. Rode er/permissao.sql com o papel da aplicacao, ou repita a mao os GRANTs do bloco 7 deste arquivo.';
  END IF;

  -- O papel de LEITURA, o das URIs de camada do QGIS.
  FOR leitor IN
    SELECT DISTINCT pg_get_userbyid(a.grantee)
      FROM pg_class AS c
     INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL aclexplode(c.relacl) AS a
     WHERE n.nspname = 'acervo'
       AND c.relkind = 'r'
       AND a.privilege_type = 'SELECT'
       AND a.grantee <> 0
       AND pg_get_userbyid(a.grantee) NOT IN (
         SELECT DISTINCT pg_get_userbyid(a2.grantee)
           FROM pg_class AS c2
          INNER JOIN pg_namespace AS n2 ON n2.oid = c2.relnamespace
          CROSS JOIN LATERAL aclexplode(c2.relacl) AS a2
          WHERE n2.nspname = 'dgeo'
            AND c2.relkind = 'r'
            AND a2.privilege_type = 'INSERT'
            AND a2.grantee <> 0
       )
     ORDER BY 1
  LOOP
    achou_leitor := true;

    EXECUTE format('GRANT USAGE ON SCHEMA acompanhamento TO %I', leitor);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA acompanhamento TO %I', leitor);

    EXECUTE format('GRANT USAGE ON SCHEMA producao TO %I', leitor);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA producao TO %I', leitor);

    -- As views de acompanhamento sao criadas em tempo de execucao pelo papel da
    -- aplicacao, que e o dono delas: o default privilege se declara POR DONO, e
    -- por isso ele mora dentro do laco de leitores e percorre os donos.
    FOR dono IN
      SELECT DISTINCT pg_get_userbyid(a.grantee)
        FROM pg_class AS c
       INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) AS a
       WHERE n.nspname = 'dgeo'
         AND c.relkind = 'r'
         AND a.privilege_type = 'INSERT'
         AND a.grantee <> 0
       ORDER BY 1
    LOOP
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA acompanhamento GRANT SELECT ON TABLES TO %I',
        dono, leitor
      );
    END LOOP;

    RAISE NOTICE 'leitura de producao e acompanhamento concedida a %', leitor;
  END LOOP;

  IF NOT achou_leitor THEN
    RAISE WARNING 'nenhum papel somente leitura foi encontrado: as views de acompanhamento nao abrem no QGIS por URI de camada. Rode er/permissao_readonly.sql, ou repita a mao os GRANTs de leitura do bloco 7 deste arquivo.';
  END IF;
END
$concede$;

-- --------------------------------------------------------------------------
-- 8. A conferencia
-- --------------------------------------------------------------------------
--
-- ELA VEM ANTES DO CARIMBO, de proposito. `public.versao` e o que
-- `MIN_DATABASE_VERSION` compara no boot: carimbar 3.0.0 num banco que ficou
-- pela metade e a mentira que esta migracao veio consertar. Se qualquer peca
-- faltar, a transacao inteira volta e o numero nao sobe.
--
-- O QUE ELA MEDE E O CONTORNO, e nao cada objeto: os cinco schemas, a contagem
-- de tabelas de cada um, o modulo 7, os 15 dominios e os TRES gatilhos que moram
-- em tabelas do `acervo`, que sao os que mais facilmente passariam despercebidos.
-- Objeto a objeto quem confere e o `ensaiar_migracao.cjs`, comparando com um
-- banco instalado pelo `er/`.
DO $confere$
DECLARE
  n integer;
BEGIN
  IF to_regnamespace('producao') IS NULL THEN
    RAISE EXCEPTION 'o schema producao nao existe depois da migracao';
  END IF;
  IF to_regnamespace('qgis') IS NULL THEN
    RAISE EXCEPTION 'o schema qgis nao existe depois da migracao';
  END IF;
  IF to_regnamespace('metadado') IS NULL THEN
    RAISE EXCEPTION 'o schema metadado nao existe depois da migracao';
  END IF;
  IF to_regnamespace('acompanhamento') IS NULL THEN
    RAISE EXCEPTION 'o schema acompanhamento nao existe depois da migracao';
  END IF;
  IF to_regnamespace('microcontrole') IS NULL THEN
    RAISE EXCEPTION 'o schema microcontrole nao existe depois da migracao';
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'producao' AND table_type = 'BASE TABLE';
  IF n <> 39 THEN
    RAISE EXCEPTION 'producao ficou com % tabelas, e nao 39', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'qgis' AND table_type = 'BASE TABLE';
  IF n <> 13 THEN
    RAISE EXCEPTION 'qgis ficou com % tabelas, e nao 13', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'metadado' AND table_type = 'BASE TABLE';
  IF n <> 16 THEN
    RAISE EXCEPTION 'metadado ficou com % tabelas, e nao 16', n;
  END IF;

  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'microcontrole' AND table_type = 'BASE TABLE';
  IF n <> 2 THEN
    RAISE EXCEPTION 'microcontrole ficou com % tabelas, e nao 2', n;
  END IF;

  -- A SEMENTE DO TIPO DE MONITORAMENTO, e nao so a tabela: sem os dois codigos,
  -- o perfil de monitoramento nao teria o que apontar e a tela nasceria com a
  -- lista vazia -- que se le como "nao da para monitorar nada".
  IF (SELECT count(*) FROM microcontrole.tipo_monitoramento) <> 2 THEN
    RAISE EXCEPTION 'microcontrole.tipo_monitoramento nao ficou com os 2 codigos';
  END IF;

  SELECT count(*) INTO n
    FROM pg_proc AS p
   INNER JOIN pg_namespace AS ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'acompanhamento';
  IF n <> 16 THEN
    RAISE EXCEPTION 'acompanhamento ficou com % funcoes, e nao 16', n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM dominio.modulo WHERE code = 7 AND nome_abrev = 'producao'
  ) THEN
    RAISE EXCEPTION 'o modulo 7 nao ficou com nome_abrev = producao';
  END IF;

  -- Os 15 dominios do core, pelo nome. Uma tabela criada e nao semeada passaria
  -- na contagem de tabelas e deixaria a tela sem opcao nenhuma.
  SELECT count(*) INTO n
    FROM information_schema.tables
   WHERE table_schema = 'dominio'
     AND table_name IN (
       'tipo_fase', 'tipo_pre_requisito', 'tipo_etapa', 'tipo_exibicao',
       'tipo_restricao', 'tipo_insumo', 'tipo_dado_producao',
       'tipo_situacao_atividade', 'tipo_configuracao', 'tipo_perfil_dificuldade',
       'tipo_controle_qualidade', 'tipo_criacao_unidade_trabalho',
       'tipo_problema_atividade', 'tipo_estrategia_associacao', 'tipo_rotina'
     );
  IF n <> 15 THEN
    RAISE EXCEPTION 'faltam dominios do core de producao: achei % de 15', n;
  END IF;

  IF (SELECT count(*) FROM dominio.tipo_situacao_atividade) <> 5 THEN
    RAISE EXCEPTION 'dominio.tipo_situacao_atividade nao ficou com os 5 codigos';
  END IF;
  IF (SELECT count(*) FROM dominio.tipo_fase) <> 16 THEN
    RAISE EXCEPTION 'dominio.tipo_fase nao ficou com os 16 codigos';
  END IF;

  -- Os CINCO gatilhos que moram em tabelas do `acervo`. Eram tres ate
  -- 2026-08-09; os dois novos vieram com a remocao da `producao.lote_linha`,
  -- que levava consigo o status do lote de producao e o nome que a view de
  -- bloco publicava: as duas perguntas passaram a ser feitas a `acervo.lote`.
  --
  -- O `DISTINCT` nao e enfeite: `information_schema.triggers` devolve UMA linha
  -- por evento, entao um gatilho de INSERT OR UPDATE OR DELETE aparece tres
  -- vezes e a contagem crua nao diria quantos gatilhos existem.
  SELECT count(DISTINCT trigger_name) INTO n
    FROM information_schema.triggers
   WHERE event_object_schema = 'acervo'
     AND trigger_name IN (
       'a_relacionamento_versao',
       'refresh_view_acompanhamento_produto',
       'chk_projeto_status_consistency',
       'chk_lote_status_consistency',
       'refresh_bloco_lote'
     );
  IF n <> 5 THEN
    RAISE EXCEPTION 'achei % dos 5 gatilhos de producao sobre tabelas do acervo', n;
  END IF;

  RAISE NOTICE 'core de producao no lugar: 5 schemas, 70 tabelas novas e 15 dominios';
END
$confere$;

-- --- O carimbo --------------------------------------------------------------
--
-- INCONDICIONAL, e nao um incremento: ele leva a 3.0.0 tanto o banco em 1.50.0
-- quanto o que ja passou por `2026-08-09_o_sca_vira_sap_3.sql`. O motivo esta no
-- cabecalho, sob "A VERSAO".
UPDATE public.versao SET nome = '3.0.0' WHERE code = 1;

COMMIT;

-- PARA DESFAZER:
--
--   BEGIN;
--
--   -- Os tres gatilhos que moram em tabelas do `acervo` saem primeiro. O
--   -- CASCADE dos DROP SCHEMA abaixo ja os levaria junto, porque eles dependem
--   -- de funcoes de `producao` e de `acompanhamento`; estao listados aqui para
--   -- o desfazer dizer em voz alta o que toca fora dos schemas novos.
--   DROP TRIGGER IF EXISTS a_relacionamento_versao ON acervo.versao;
--   DROP TRIGGER IF EXISTS refresh_view_acompanhamento_produto ON acervo.versao;
--   DROP TRIGGER IF EXISTS chk_projeto_status_consistency ON acervo.projeto;
--   DROP TRIGGER IF EXISTS chk_lote_status_consistency ON acervo.lote;
--   DROP TRIGGER IF EXISTS refresh_bloco_lote ON acervo.lote;
--
--   -- O default privilege de leitura em `acompanhamento` sai ANTES do schema:
--   -- ele e uma linha de `pg_default_acl` que aponta o namespace, e desfazer
--   -- pela mesma frase que o criou e o unico jeito de nao deixar entulho.
--   -- Troque os dois nomes pelos papeis da instalacao (`DB_USER` e
--   -- `DB_USER_READONLY` de `server/config.env`), que sao os mesmos que o bloco
--   -- 6 descobriu.
--   ALTER DEFAULT PRIVILEGES FOR ROLE <DB_USER> IN SCHEMA acompanhamento
--     REVOKE SELECT ON TABLES FROM <DB_USER_READONLY>;
--
--   -- `microcontrole` SAI ANTES DE `producao`, e a ordem importa: o
--   -- `perfil_monitoramento` referencia `producao.subfase`, e o CASCADE do
--   -- DROP de `producao` levaria a chave estrangeira junto, deixando a tabela
--   -- de pe sem a referencia. Aqui ela sai inteira.
--   --
--   -- O BANCO DA TELEMETRIA NAO ENTRA NO DESFAZER, porque ele nunca entrou no
--   -- fazer: ele e outro banco, com instalacao propria (`er_microcontrole/`).
--   -- Se a intencao for desligar a telemetria, apague as chaves MICRO_DB_* de
--   -- `server/config.env`; se for apagar o banco, e um `DROP DATABASE` na mao,
--   -- e ele leva TODA a medicao ja capturada.
--   DROP SCHEMA microcontrole CASCADE;
--
--   DROP SCHEMA acompanhamento CASCADE;
--   DROP SCHEMA metadado CASCADE;
--   DROP SCHEMA producao CASCADE;
--   DROP SCHEMA qgis CASCADE;
--
--   -- As views materializadas que as funcoes de `acompanhamento` geraram em
--   -- tempo de execucao moram DENTRO daquele schema, e saem com ele. O que nao
--   -- sai sozinho e a linha de estilo que elas escreveram em public.layer_styles.
--   DELETE FROM public.layer_styles WHERE f_table_schema = 'acompanhamento';
--
--   DELETE FROM dgeo.usuario_perfil WHERE modulo_id = 7;
--   DELETE FROM dominio.modulo WHERE code = 7;
--
--   DROP TABLE dominio.tipo_rotina;
--   DROP TABLE dominio.tipo_estrategia_associacao;
--   DROP TABLE dominio.tipo_problema_atividade;
--   DROP TABLE dominio.tipo_criacao_unidade_trabalho;
--   DROP TABLE dominio.tipo_controle_qualidade;
--   DROP TABLE dominio.tipo_perfil_dificuldade;
--   DROP TABLE dominio.tipo_configuracao;
--   DROP TABLE dominio.tipo_situacao_atividade;
--   DROP TABLE dominio.tipo_dado_producao;
--   DROP TABLE dominio.tipo_insumo;
--   DROP TABLE dominio.tipo_restricao;
--   DROP TABLE dominio.tipo_exibicao;
--   DROP TABLE dominio.tipo_etapa;
--   DROP TABLE dominio.tipo_pre_requisito;
--   DROP TABLE dominio.tipo_fase;
--
--   UPDATE public.versao SET nome = '1.50.0' WHERE code = 1;
--   COMMIT;
--
-- O DESFAZER PERDE DADO, e este e o primeiro desta serie em que perde: os
-- cinco `DROP SCHEMA ... CASCADE` levam tudo que tiver sido produzido ou
-- carregado neles, e nao ha para onde voltar sem restaurar backup. Ele so faz
-- sentido enquanto os schemas ainda estiverem vazios, isto e, ANTES da carga do
-- dump do SAP 2.3.5. Depois dela, desfazer e restaurar backup, e nao rodar isto.
--
-- O `DELETE FROM dgeo.usuario_perfil WHERE modulo_id = 7` vem antes do DELETE do
-- modulo porque a chave estrangeira o exige, e ele apaga CONCESSAO: se alguem ja
-- tiver recebido perfil no modulo 7, ela nao volta.
--
-- O DESFAZER EXIGE VOLTAR O CODIGO JUNTO: `VERSION` e `MIN_DATABASE_VERSION` de
-- `server/src/config.js`, o `INSERT` de `er/versao.sql` e os cinco arquivos de
-- `er/` voltam ao estado anterior, senao a proxima instalacao nova nasce com o
-- que este desfazer acabou de tirar. Se a intencao for so voltar a renomeacao de
-- produto, o desfazer e o de `2026-08-09_o_sca_vira_sap_3.sql`, e nao este.
