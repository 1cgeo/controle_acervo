-- O MODULO 4 DEVOLVE O NOME "PRODUCAO", E A TABELA DO ANO VIRA `pit.pit`.
--
-- POR QUE AGORA. O core de producao do SAP (`macrocontrole`, 45 tabelas) vai
-- entrar num modulo, e esse modulo se chama Producao. O nome estava ocupado por
-- quem NAO e producao: o code 4 guarda o PIT -- a execucao do plano, o
-- Extra-PIT, a capacitacao ministrada e as atividades de campo.
--
-- O DESCOMPASSO JA EXISTIA, e era visivel. O menu diz "PIT" desde que a secao
-- nasceu, e o `nome_abrev` dizia 'producao'; o CLAUDE.md carregava um paragrafo
-- so para avisar que o rotulo do MENU e uma terceira coisa. Agora o rotulo, o
-- identificador e o conteudo dizem a mesma palavra.
--
-- O QUE MUDA
--
--   1. `dominio.modulo` code 4: ('Produção','producao') vira ('PIT','pit').
--   2. `pit.exercicio` vira `pit.pit`, com as quatro restricoes renomeadas.
--
-- POR QUE `pit.pit` E NAO OUTRA COISA. O PIT e o documento do ANO. `pit.pit` e a
-- linha do documento, e `pit.meta` e o que ele promete. O nome antigo obrigava a
-- ler "exercicio" como sinonimo de PIT em toda consulta.
--
-- O HOMONIMO DO SAP E REAL, e fica registrado aqui: `macrocontrole.pit`, la, e a
-- META, e corresponde ao `pit.meta` daqui. Quando o core atravessar, duas
-- tabelas chamadas `pit` vao existir no mesmo banco querendo dizer coisas
-- diferentes. Isso foi medido e aceito antes da troca.
--
-- O QUE ISSO CUSTA
--
--   1. `nome_abrev` E IDENTIFICADOR, e nao rotulo. `verifyPerfil(nivel, modulo)`,
--      o mapa `MODULO` de `login/verify_perfil.js`, o `modulo` de cada subsecao
--      em `rpcmtec_estrutura.js`, o `visivel` da sidebar e o `perfilLoader` do
--      client comparam a string por IGUALDADE. Foram 94 ocorrencias de codigo em
--      22 arquivos, e um servidor velho contra este banco recusa toda concessao
--      do modulo 4: ele procura 'producao' e o banco so tem 'pit'.
--   2. AS CONCESSOES NAO SE PERDEM. `dgeo.usuario_perfil.modulo_id` referencia o
--      `code`, que continua 4. Ninguem perde acesso, e nenhuma linha de perfil e
--      tocada.
--   3. A ENTIDADE DE AUDITORIA NAO ACOMPANHA A TABELA. `auditoria.evento` guarda
--      `entidade` como TEXTO, e a trilha e append-only: medido no dump de
--      producao de 2026-08-08, ha 15 eventos com 'exercicio' e ZERO com o modulo
--      'producao' (o `pit` sempre foi auditado sob 'plataforma'). O mapa continua
--      declarando `entidade: 'exercicio'` para a tabela `pit.pit`, e nenhum
--      evento fica orfao. Reescrever a trilha seria a aplicacao corrigindo a
--      propria prova.
--
-- PARA ENSAIAR, O COMANDO E UM SO, E ELE NAO ESTA AQUI: esta no cabecalho de
-- `migrations/2026-08-09_o_core_de_producao_atravessa.sql`, sob "O COMANDO
-- CANONICO DE ENSAIO DE 2026-08-09". Esta migracao e a PRIMEIRA da cadeia, e e
-- dela que sai o `--versao-anterior 1.49.0` de la; `pit` e `dominio` estao entre
-- os dez schemas comparados.
--
-- O COMANDO SOZINHO QUE MORAVA AQUI RODAVA E NAO PROVAVA NADA, e e por isso que
-- ele saiu: sem `--er-de`, o banco "anterior" nascia com o `er/pit.sql` de HOJE,
-- que ja tem a tabela renomeada. A renomeacao virava no-op, e o ensaio comparava
-- dois bancos identicos por construcao. O comando canonico traz o `--er-de`, e
-- ele e o que faz o banco "anterior" nascer com `pit.exercicio` de verdade.

BEGIN;

-- --- 1. O modulo -----------------------------------------------------------

UPDATE dominio.modulo
   SET nome = 'PIT', nome_abrev = 'pit'
 WHERE code = 4;

-- --- 2. A tabela do ano ----------------------------------------------------
--
-- `ALTER TABLE ... RENAME TO` NAO renomeia restricao nem indice: eles ficam com
-- o nome antigo, e o `ensaiar_migracao.cjs` compara nome de restricao entre o
-- banco MIGRADO e o banco NOVO. Sem as quatro linhas abaixo o ensaio reprova, e
-- com razao: um `DROP CONSTRAINT exercicio_pkey` passaria a funcionar num banco
-- e a falhar no outro.
--
-- AS FK QUE APONTAM PARA CA nao se renomeiam, e nao e esquecimento: elas se
-- chamam pelo nome da tabela que as CONTEM (`meta_ano_fkey`, `revisao_ano_fkey`,
-- `demanda_extra_ano_fkey`, `campo_ano_fkey`), e nenhuma delas mudou de nome.
--
-- IDEMPOTENTE pelo `to_regclass`: rodar duas vezes nao quebra, que e a promessa
-- de toda migracao daqui.
DO $renomeia$
BEGIN
  IF to_regclass('pit.exercicio') IS NOT NULL THEN
    ALTER TABLE pit.exercicio RENAME TO pit;
    ALTER TABLE pit.pit RENAME CONSTRAINT exercicio_pkey TO pit_pkey;
    ALTER TABLE pit.pit RENAME CONSTRAINT exercicio_situacao_id_fkey
      TO pit_situacao_id_fkey;
    ALTER TABLE pit.pit RENAME CONSTRAINT exercicio_usuario_cadastramento_uuid_fkey
      TO pit_usuario_cadastramento_uuid_fkey;
    ALTER TABLE pit.pit RENAME CONSTRAINT exercicio_usuario_modificacao_uuid_fkey
      TO pit_usuario_modificacao_uuid_fkey;
  END IF;
END
$renomeia$;

COMMENT ON TABLE pit.pit IS
    'O ano do PIT. Existe para o ano deixar de ser um SMALLINT solto e para o encerramento ser um ato.';

-- --- 3. A chave do mapa de auditoria ---------------------------------------
--
-- `auditoria.evento` NAO guarda o nome da tabela: ele guarda `modulo` e
-- `entidade`, e os dois continuam iguais ('plataforma' e 'exercicio'). Por isso
-- esta migracao NAO toca na trilha, e a linha abaixo e so a conferencia disso.
DO $confere$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('pit.pit') IS NULL THEN
    RAISE EXCEPTION 'pit.pit nao existe depois do renome';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM dominio.modulo WHERE code = 4 AND nome_abrev = 'pit') THEN
    RAISE EXCEPTION 'o modulo 4 nao ficou com nome_abrev = pit';
  END IF;
  -- As concessoes do modulo 4 continuam de pe: elas apontam o `code`, e ele nao
  -- mudou. Este numero e informativo, e nao uma condicao -- num banco novo ele e
  -- zero, e isso e correto.
  SELECT count(*) INTO n FROM dgeo.usuario_perfil WHERE modulo_id = 4;
  RAISE NOTICE 'concessoes preservadas no modulo 4 (PIT): %', n;
END
$confere$;

UPDATE public.versao SET nome = '1.50.0' WHERE code = 1;

COMMIT;

-- PARA DESFAZER:
--
--   BEGIN;
--   ALTER TABLE pit.pit RENAME TO exercicio;
--   ALTER TABLE pit.exercicio RENAME CONSTRAINT pit_pkey TO exercicio_pkey;
--   ALTER TABLE pit.exercicio RENAME CONSTRAINT pit_situacao_id_fkey
--     TO exercicio_situacao_id_fkey;
--   ALTER TABLE pit.exercicio RENAME CONSTRAINT pit_usuario_cadastramento_uuid_fkey
--     TO exercicio_usuario_cadastramento_uuid_fkey;
--   ALTER TABLE pit.exercicio RENAME CONSTRAINT pit_usuario_modificacao_uuid_fkey
--     TO exercicio_usuario_modificacao_uuid_fkey;
--   UPDATE dominio.modulo SET nome = 'Produção', nome_abrev = 'producao' WHERE code = 4;
--   UPDATE public.versao SET nome = '1.49.0' WHERE code = 1;
--   COMMIT;
--
-- O DESFAZER NAO PERDE DADO: os dois sao renomes, e nenhuma linha e apagada. O
-- que ele exige e voltar o CODIGO junto, pela razao do item 1 acima.
