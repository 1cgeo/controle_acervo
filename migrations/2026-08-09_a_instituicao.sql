-- A INSTITUICAO QUE OPERA ESTA INSTALACAO VIRA DADO, E DEIXA DE SER CONSTANTE.
--
-- POR QUE AGORA. O "1o CGEO" esta escrito em texto de tela, em semente de
-- dominio e, o pior, numa COLUNA: `limites.area_suprimento.e_1cgeo`. Enquanto
-- for assim, nenhum outro Centro instala este sistema sem editar codigo, e a
-- pergunta "de quem e esta instalacao" nao tem onde ser respondida -- ela esta
-- espalhada em dezenas de literais que ninguem consegue listar.
--
-- Esta migracao cria o lugar da resposta. Ela NAO mexe em `limites`: a remocao
-- do `e_1cgeo` e a comparacao direta com o `nome` daqui vem em arquivo proprio,
-- que depende deste e nao o contrario.
--
-- O QUE ELA FAZ
--
--   1. Cria `dgeo.instituicao`, de LINHA UNICA.
--   2. Semeia a linha com os valores de HOJE: 1o Centro de Geoinformacao,
--      1o CGEO, UG 160382.
--
-- POR QUE EM `dgeo`, E NAO EM OUTRO SCHEMA. Aquele schema guarda a camada de
-- IDENTIDADE da instalacao: quem entra, quem tem perfil em que modulo, quem
-- acessou. "De quem e esta instalacao" e a mesma pergunta, um degrau acima da
-- pessoa. Nao vai em `dominio`, que e tabela de CODIGO lida por chave
-- estrangeira; nao vai em `metadado`, que instala DEPOIS de `dgeo` e e do core
-- de producao herdado do SAP 2.3.5; e nao vai em `public`, que aqui guarda o que
-- e do PostgreSQL e do QGIS. O `er/dgeo.sql` traz o mesmo paragrafo, mais longo.
--
-- SEM CHAVE ESTRANGEIRA PARA `metadado.organizacao`, apesar de aquela tabela ter
-- os cinco Centros: `metadado` instala depois de `dgeo`, e a FK inverteria a
-- ordem da instalacao nova.
--
-- POR QUE A LINHA E UNICA, E O QUE ISSO CUSTA. Uma instalacao serve UM Centro. O
-- CHECK `(id = 1)` com DEFAULT 1 fecha os dois caminhos: quem omite o `id` bate
-- na chave primaria (o default repete o 1) e quem informa outro valor bate no
-- CHECK. O custo esta declarado: se um dia uma instalacao tiver de servir dois
-- Centros, isto NAO se resolve inserindo linha -- resolve-se com decisao de
-- escopo registrada em `docs/decisoes.md`, porque todo leitor da tabela hoje
-- pergunta "qual e o Centro" e nao "quais sao".
--
-- O TIPO DE `ug_code` E VARCHAR(10), E NAO INTEIRO. `dominio.ug.code` e
-- VARCHAR(10), e e assim que `orcamento.nota_credito.ug_emitente` e
-- `orcamento.nota_empenho.ug_emitente` ja apontam para la. Um INTEIRO aqui nem
-- chegaria a existir: o PostgreSQL recusa chave estrangeira entre tipos
-- incompativeis, e a migracao morreria na criacao da tabela.
--
-- `ug_code` E ANULAVEL porque nem toda instalacao usa o modulo orcamento. A
-- SEMENTE, porem, traz 160382 sem rede: o codigo existe em `dominio.ug` desde
-- `2026-07-27_fusao_orcamento.sql`, e um banco que nao o tenha nao e um banco do
-- 1o CGEO. Preferimos a chave estrangeira FALHAR alto a gravar nulo em silencio
-- e deixar a UG sumir de um banco que a tinha.
--
-- SEM `data_cadastramento` E SEM `usuario_cadastramento_uuid`, ao contrario do
-- resto do sistema: a linha nao e cadastrada por ninguem. Aqui quem a escreve e
-- esta migracao, que nao tem autor; na instalacao nova quem a escreve e o
-- `er/dgeo.sql`, antes de existir o primeiro usuario. Coluna obrigatoria sem
-- valor honesto vira UUID inventado.
--
-- A VERSAO: POR QUE 1.51.0, E NAO 3.0.0
--
-- Esta e a QUARTA migracao de 2026-08-09, e as tres anteriores ja desenharam a
-- serie: `o_pit_devolve_o_nome_producao` carimba 1.50.0, `o_sca_vira_sap_3` NAO
-- carimba, e `o_core_de_producao_atravessa` carimba 3.0.0. O estado final tem de
-- ser 3.0.0, que e o que `er/versao.sql` carimba e o que
-- `__tests__/unit/versao_do_servico.test.js` cobra.
--
-- Restavam duas saidas, e a escolhida e a de baixo:
--
--   (a) carimbar 3.0.0 tambem, como parte do mesmo release. Recusada. O
--       `UPDATE` do core e INCONDICIONAL, entao a versao final nao mudaria; o
--       problema e outro. Quem aplicasse SO esta migracao ficaria com
--       `public.versao` dizendo 3.0.0 e SEM os schemas do core de producao, e
--       como `MIN_DATABASE_VERSION` tambem e 3.0.0 o servico subiria satisfeito
--       contra esse banco. E exatamente o buraco que fez
--       `o_sca_vira_sap_3.sql` PERDER o carimbo dela, e reabri-lo aqui, numa
--       tabela de tres colunas, seria pagar caro por nada.
--
--   (b) carimbar 1.51.0, continuando a serie do estado ANTERIOR a travessia.
--       Esta migracao nao depende de nada que o core traga (ela precisa de
--       `dgeo.usuario` e de `dominio.ug`, que existem desde a 1.x) e o core nao
--       depende dela. Ela e, legitimamente, a ultima do "antes".
--
-- A CONSEQUENCIA DE (b) E DESEJADA: um banco que pare aqui responde 1.51.0,
-- fica abaixo do piso, e o servico RECUSA subir dizendo que falta migrar. Meia
-- janela de manutencao aparece como falha de boot, e nao como consulta vazia em
-- producao tres dias depois.
--
-- A ORDEM DE APLICACAO E A DA VERSAO CARIMBADA, e nao a do nome do arquivo (ver
-- o README). Por 1.51.0 esta migracao entra DEPOIS de
-- `2026-08-09_o_pit_devolve_o_nome_producao.sql` e ANTES do par que leva a
-- 3.0.0. O cabecalho de `o_sca_vira_sap_3.sql` diz que aplicar aquela sozinha
-- deixa o banco em 1.50.0; com esta no meio, deixa em 1.51.0. A frase de la fica
-- como esta -- migracao e registro historico, e nao se reescreve.
--
-- O QUE ESTA MIGRACAO NAO FAZ
--
--   1. NAO toca em `limites.area_suprimento`. O `e_1cgeo` sai em arquivo
--      proprio, que le o `nome` desta tabela.
--   2. NAO cria chave de ambiente. A instituicao e DADO e mora no banco,
--      justamente para poder ser trocada pela tela sem reiniciar o servico.
--      `.env.example` nao ganha linha nenhuma.
--   3. NAO concede permissao nova: `er/permissao.sql` ja da
--      SELECT/INSERT/UPDATE/DELETE em ALL TABLES IN SCHEMA dgeo, e a tabela
--      nasce coberta.
--
-- IDEMPOTENTE, e o `ensaiar_migracao.cjs` aplica duas vezes para cobrar isso:
-- `CREATE TABLE IF NOT EXISTS` e `ON CONFLICT (id) DO NOTHING` na semente. A
-- segunda passada NAO reescreve o nome, a sigla nem a UG: quem ja tiver trocado
-- os tres pela tela nao os perde ao reaplicar.
--
-- PARA ENSAIAR, O COMANDO E UM SO, E ELE NAO ESTA AQUI: esta no cabecalho de
-- `migrations/2026-08-09_o_core_de_producao_atravessa.sql`, sob "O COMANDO
-- CANONICO DE ENSAIO DE 2026-08-09". Ele leva AS CINCO migracoes do dia em
-- cadeia (esta e a segunda), os CINCO `er/` novos e os DEZ schemas que a entrega
-- toca, `dgeo` entre eles. Ensaiar esta sozinha nao prova nada: o que interessa
-- e que a SEQUENCIA chegue onde a instalacao nova chega.
--
-- O `--er-de` daquele comando NAO E OPCIONAL para esta migracao em particular:
-- ela muda o CONTEUDO de `er/dgeo.sql` (a tabela e a semente). Sem ele, o banco
-- "anterior" ja nasceria com a tabela, a migracao viraria no-op e o ensaio
-- aprovaria sem exercitar nada.

BEGIN;

-- --- 1. A tabela -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS dgeo.instituicao(
  id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome VARCHAR(255) NOT NULL,
  sigla VARCHAR(50) NOT NULL,
  ug_code VARCHAR(10) REFERENCES dominio.ug (code),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE dgeo.instituicao IS
    'A instituição que opera esta instalação: nome, sigla e Unidade Gestora. LINHA ÚNICA, garantida pelo CHECK (id = 1); uma instalação serve UM Centro.';

-- --- 2. A linha, com os valores de HOJE -------------------------------------
--
-- `ON CONFLICT (id) DO NOTHING` e nao `DO UPDATE`: reaplicar a migracao nao pode
-- desfazer a edicao que alguem fez pela tela. Numa instalacao que ja trocou o
-- nome, o `DO UPDATE` devolveria o 1o CGEO em silencio.
INSERT INTO dgeo.instituicao (id, nome, sigla, ug_code) VALUES
(1, '1º Centro de Geoinformação', '1º CGEO', '160382')
ON CONFLICT (id) DO NOTHING;

-- --- 3. A conferencia -------------------------------------------------------
--
-- Ela existe porque a falha desta migracao seria SILENCIOSA de um jeito
-- especifico: com a tabela criada e a linha ausente, `GET /api/instituicao`
-- responderia 404 e o rodape do relatorio ficaria sem Centro, sem que nada aqui
-- tivesse dado erro.
DO $confere$
DECLARE
  n bigint;
  quem text;
BEGIN
  SELECT count(*) INTO n FROM dgeo.instituicao;
  IF n <> 1 THEN
    RAISE EXCEPTION
      'dgeo.instituicao ficou com % linha(s), e ela e de linha UNICA', n;
  END IF;

  SELECT nome INTO quem FROM dgeo.instituicao WHERE id = 1;
  RAISE NOTICE 'instituicao desta instalacao: %', quem;
END
$confere$;

UPDATE public.versao SET nome = '1.51.0' WHERE code = 1;

COMMIT;

-- PARA DESFAZER:
--
--   BEGIN;
--   DROP TABLE IF EXISTS dgeo.instituicao;
--   UPDATE public.versao SET nome = '1.50.0' WHERE code = 1;
--   COMMIT;
--
-- O DESFAZER PERDE DADO, e o desfazer so e seguro ENQUANTO a remocao do
-- `e_1cgeo` de `limites.area_suprimento` nao tiver sido aplicada: depois dela, a
-- consulta da subsecao 2.7 procura o Centro pelo `nome` desta tabela, e sem a
-- tabela ela nao tem com o que comparar. O que se perde e o nome, a sigla e a UG
-- que alguem tenha editado pela tela; o desfazer devolve o sistema a ter o 1o
-- CGEO escrito em codigo, que e o defeito que esta migracao existe para acabar.
