-- A AREA SOB COORDENACAO PASSA A SER DA INSTITUICAO CONFIGURADA, E O BOOLEANO SAI.
--
-- O QUE HAVIA. `limites.area_suprimento` tinha uma coluna `e_1cgeo BOOLEAN`, e a
-- subsecao 2.7 do RPCMTec ("Estado do Acervo") recortava o acervo pelo poligono
-- da linha marcada com ela. O nome da coluna dizia o problema em voz alta: uma
-- COLUNA chamada "e o 1o CGEO" tranca a instalacao num Centro. Outro Centro que
-- quisesse instalar o SAP 3.0 teria de editar DDL para dizer que a area dele e a
-- dele.
--
-- O QUE MUDA, por decisao do chefe de 2026-08-09. Quem responde "de quem e esta
-- instalacao" passa a ser `dgeo.instituicao`, criada na mesma leva e alteravel
-- por `PUT /api/instituicao`. A 2.7 casa `area_suprimento.cgeo` com
-- `instituicao.nome`, e o booleano deixa de existir.
--
-- ESTA MIGRACAO E O SEGUNDO PASSO DE UMA ENTREGA DE DOIS.
-- `2026-08-09_a_instituicao.sql` cria a tabela e semeia a linha; esta aqui tira
-- o booleano e amarra a area ao nome configurado. Ela RECUSA rodar antes da outra,
-- e a conferencia abaixo e o que faz a recusa: sem a tabela de identidade,
-- apagar `e_1cgeo` deixaria a 2.7 sem nenhum jeito de saber qual das areas e a
-- nossa.
--
-- A ARMADILHA, E ELA E O MOTIVO DA CONFERENCIA MAIS LONGA DESTE ARQUIVO.
--
-- O comentario da coluna antiga dizia que comparar texto "quebra calado", e ele
-- estava CERTO: o `cgeo` vem da fonte externa `asc_insumos`, e um acento a
-- menos, um 'º' virando 'o' ou um espaco a mais fazem a comparacao devolver ZERO
-- linhas, sem erro nenhum. O relatorio sairia com a 2.7 zerada, assinado pelo
-- chefe, e ninguem saberia.
--
-- A saida nao foi manter o booleano: foi fazer o ZERO DOER, em dois lugares.
--
--   1. AQUI. Esta migracao CONFERE, antes de apagar coluna nenhuma, que o nome
--      configurado em `dgeo.instituicao` casa com alguma linha de
--      `limites.area_suprimento`. Se nao casar, ela PARA e mostra os dois textos
--      lado a lado. Um banco em que a 2.7 sairia zerada nao migra.
--   2. EM `server/src/rpcmtec/rpcmtec_ctrl.js`. `areaDoCentro` levanta
--      `AppError` quando nenhuma linha casa, dizendo o nome procurado, os `cgeo`
--      que existem e onde configurar, e derruba a geracao inteira do relatorio.
--      Ele cobre o que a conferencia daqui nao alcanca: a carga que reescreve
--      `cgeo` depois da migracao, e o `PUT /api/instituicao` que troca o nome
--      para um que nao existe.
--      O teste e `server/src/__tests__/unit/rpcmtec_area_do_centro.test.js`.
--
-- A COMPARACAO E EXATA, e nao normalizada (sem `unaccent`, sem
-- `btrim(lower(...))`). O porque completo esta em `er/limites.sql`, ao lado da
-- coluna; em uma linha: normalizar ANULA o `UNIQUE (cgeo)` que esta migracao
-- acrescenta, porque duas linhas distintas por texto viram uma so depois de
-- normalizadas, as duas casam, e a 2.7 conta a area em dobro -- que e o
-- silencio que a restricao existe para impedir.
--
-- O INDICE PARCIAL SAI, E A RESTRICAO ENTRA. `area_suprimento_1cgeo_idx` era
-- unico sobre `e_1cgeo` onde ele fosse verdadeiro: existia UMA "nossa area", e a
-- 2.7 a le sem LIMIT. Com o booleano fora, quem garante o mesmo e
-- `UNIQUE (cgeo)`: duas linhas com o mesmo nome de Centro dobrariam a contagem.
--
-- O QUE ISSO CUSTA. Nada de dado: `e_1cgeo` era derivavel do `cgeo` em toda
-- instalacao existente (uma linha semeada, marcada TRUE, chamada
-- '1º Centro de Geoinformação'), e e por isso que a conferencia consegue provar
-- a equivalencia antes de apagar. O que se perde e a capacidade de marcar como
-- "nossa" uma area cujo nome DIVERGE do nome da instituicao, e a perda e o
-- ponto: divergencia ali era exatamente o que passava despercebido.
--
-- Para ensaiar, ensaie A CADEIA INTEIRA de 2026-08-09, que e como as cinco se
-- aplicam. Ensaiar esta sozinha reprova na conferencia acima, e reprovar e o
-- comportamento certo: sem `dgeo.instituicao` ela nao tem o que comparar.
--
--   node migrations/ensaiar_migracao.cjs \
--     --migracao migrations/2026-08-09_o_pit_devolve_o_nome_producao.sql,migrations/2026-08-09_a_instituicao.sql,migrations/2026-08-09_a_area_e_de_quem_configurou.sql,migrations/2026-08-09_o_sca_vira_sap_3.sql,migrations/2026-08-09_o_core_de_producao_atravessa.sql \
--     --novos er/producao.sql,er/qgis.sql,er/metadado.sql,er/acompanhamento_producao.sql,er/microcontrole.sql \
--     --versao-anterior 1.50.0 --versao-esperada 3.0.0 \
--     --schemas limites,dgeo,dominio,pit,producao,qgis,metadado,acompanhamento,microcontrole \
--     --er-de <revisao anterior a chegada do core>
--
-- IDEMPOTENTE: `DROP ... IF EXISTS` nos dois lados, a restricao so entra se
-- ainda nao existir, e a conferencia nao escreve.

BEGIN;

-- --- 1. A conferencia, e ela vem ANTES de qualquer DDL -----------------------
--
-- Ela roda com `e_1cgeo` ainda de pe na primeira aplicacao, e sem ele na
-- segunda: por isso a leitura da linha marcada e dinamica, e so acontece quando
-- a coluna existe. Sem isso a migracao deixaria de ser idempotente logo na
-- mensagem de erro.
DO $confere$
DECLARE
  v_nome     TEXT;
  v_total    BIGINT;
  v_casam    BIGINT;
  v_marcada  TEXT;
  v_lista    TEXT;
BEGIN
  IF to_regclass('dgeo.instituicao') IS NULL THEN
    RAISE EXCEPTION 'dgeo.instituicao nao existe: aplique ANTES a migracao que cria a identidade da instalacao. Sem o nome configurado, apagar limites.area_suprimento.e_1cgeo deixaria a subsecao 2.7 do RPCMTec sem saber de quem e a area.';
  END IF;

  SELECT nome INTO v_nome FROM dgeo.instituicao WHERE id = 1;

  IF v_nome IS NULL THEN
    RAISE EXCEPTION 'dgeo.instituicao esta sem a linha 1: a instalacao nao declarou de quem ela e, e a subsecao 2.7 do RPCMTec nao teria por onde achar a propria area. Configure por PUT /api/instituicao antes de migrar.';
  END IF;

  SELECT count(*) INTO v_total FROM limites.area_suprimento;

  IF v_total = 0 THEN
    -- Banco sem area nenhuma carregada. A 2.7 ja saia zerada aqui ANTES desta
    -- migracao, e travar a atualizacao nao consertaria isso: quem cobra e a
    -- mensagem de erro da 2.7, na primeira geracao do relatorio.
    RAISE NOTICE 'limites.area_suprimento esta vazia: a subsecao 2.7 do RPCMTec vai FALHAR pedindo a carga da area de %, e isso e deliberado.', v_nome;
  ELSE
    SELECT count(*) INTO v_casam
      FROM limites.area_suprimento WHERE cgeo = v_nome;

    IF v_casam = 0 THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'limites'
           AND table_name = 'area_suprimento'
           AND column_name = 'e_1cgeo'
      ) THEN
        EXECUTE 'SELECT cgeo FROM limites.area_suprimento WHERE e_1cgeo LIMIT 1'
          INTO v_marcada;
      END IF;

      SELECT string_agg(quote_literal(cgeo), ', ' ORDER BY cgeo)
        INTO v_lista FROM limites.area_suprimento;

      RAISE EXCEPTION
        'nenhuma linha de limites.area_suprimento tem cgeo igual ao nome configurado em dgeo.instituicao (%). A area marcada por e_1cgeo era %. Os cgeo existentes sao: %. A comparacao e EXATA, entao um acento, um 0xBA no lugar de um o ou um espaco sobrando ja bastam: acerte um dos dois textos (PUT /api/instituicao ou a carga de limites.area_suprimento) e migre de novo.',
        quote_literal(v_nome), coalesce(quote_literal(v_marcada), 'NENHUMA'), v_lista;
    END IF;
  END IF;
END
$confere$;

-- --- 2. A unicidade que o indice parcial garantia ----------------------------
--
-- O nome da restricao e o que o `er/` produz para `cgeo VARCHAR(255) NOT NULL
-- UNIQUE`, e nao um nome escolhido aqui: e assim que o ensaio de migracao acha
-- os dois bancos identicos.
DO $unico$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'limites.area_suprimento'::regclass
       AND conname = 'area_suprimento_cgeo_key'
  ) THEN
    ALTER TABLE limites.area_suprimento
      ADD CONSTRAINT area_suprimento_cgeo_key UNIQUE (cgeo);
  END IF;
END
$unico$;

-- --- 3. O booleano e o indice dele saem --------------------------------------
--
-- O DROP COLUMN ja levaria o indice junto; o DROP INDEX explicito esta aqui para
-- que a intencao apareca no arquivo, e nao como efeito colateral.
DROP INDEX IF EXISTS limites.area_suprimento_1cgeo_idx;

ALTER TABLE limites.area_suprimento DROP COLUMN IF EXISTS e_1cgeo;

-- --- 4. Versao ---------------------------------------------------------------
--
-- 1.52.0, E NAO 3.1.0, e o numero merece o paragrafo. Esta migracao entra ANTES
-- da renumeracao: `2026-08-09_a_instituicao.sql` carimbou 1.51.0,
-- `2026-08-09_o_sca_vira_sap_3.sql` nao carimba nada, e quem fecha a serie e
-- `2026-08-09_o_core_de_producao_atravessa.sql`, com 3.0.0. A cadeia de hoje
-- sobe 1.50.0 -> 1.51.0 -> 1.52.0 -> 3.0.0, e o estado final e exatamente o que
-- `er/versao.sql` carimba numa instalacao nova. Carimbar 3.1.0 aqui obrigaria a
-- mover o `er/versao.sql` e as duas constantes de `server/src/config.js` para um
-- numero que nenhuma outra migracao alcanca.
UPDATE public.versao SET nome = '1.52.0' WHERE code = 1;

COMMIT;

-- PARA DESFAZER:
--
--   BEGIN;
--   ALTER TABLE limites.area_suprimento
--     ADD COLUMN IF NOT EXISTS e_1cgeo BOOLEAN NOT NULL DEFAULT FALSE;
--   -- Reconstroi o booleano a partir do nome configurado, que e de onde ele
--   -- passou a sair. Se a conferencia da subida aprovou, esta linha marca
--   -- exatamente a mesma area que estava marcada antes.
--   UPDATE limites.area_suprimento a SET e_1cgeo = TRUE
--     FROM dgeo.instituicao i WHERE i.id = 1 AND a.cgeo = i.nome;
--   CREATE UNIQUE INDEX IF NOT EXISTS area_suprimento_1cgeo_idx
--     ON limites.area_suprimento (e_1cgeo) WHERE e_1cgeo;
--   ALTER TABLE limites.area_suprimento
--     DROP CONSTRAINT IF EXISTS area_suprimento_cgeo_key;
--   UPDATE public.versao SET nome = '1.51.0' WHERE code = 1;
--   COMMIT;
--
--   E desfazer o CODIGO junto: `buscarEstadoAcervo`, de
--   `server/src/rpcmtec/rpcmtec_ctrl.js`, volta a filtrar por `WHERE e_1cgeo`.
--
-- O DESFAZER NAO PERDE DADO: o unico dado apagado na subida (`e_1cgeo`) e
-- derivavel do `cgeo`, e o UPDATE acima o deriva. O que ele NAO recupera e uma
-- marcacao que DIVERGISSE do nome configurado -- e a subida nao deixa nenhuma
-- passar, porque a conferencia para antes.
