-- A PODA DO ORCAMENTO, e o CONSERTO que vem antes dela
--
-- Decisao do chefe em 2026-08-08, depois de medir contra o banco de producao
-- restaurado em `sca_prod_20260808` (12 tabelas, 148 colunas, 528 linhas de
-- negocio). Sao TRES coisas nesta migracao, e a primeira vale mais que as outras
-- duas juntas.
--
-- ===========================================================================
-- 1. O CONSERTO: a chave do SIAFI da nota de empenho estava INERTE
-- ===========================================================================
--
-- `orcamento.nota_empenho.ug` e `.gestao` nasceram em 2026-08-07
-- (2026-08-07_identidade_da_nota_empenho.sql), o backfill preencheu 91 de 91
-- linhas e o indice unico `uniq_nota_empenho_chave_siafi (ug, gestao, ano,
-- numero)` nasceu junto. NENHUMA LINHA DO SERVIDOR ESCREVIA AS DUAS COLUNAS: nem
-- o INSERT, nem o UPDATE, nem o Joi, nem o mapa de auditoria.
--
-- A prova pelo rastro: os 4 eventos de INSERT de NE posteriores aquela migracao
-- (2026NE000008, 000191, 000167, 000132) nao trazem o campo `ug` no
-- `dados_depois`, e `ug` e `gestao` nao aparecem em evento NENHUM dos 171 do
-- modulo.
--
-- A CONSEQUENCIA. Toda NE criada pela API a partir de 2026-08-07 nascia com
-- `ug = NULL`, e no Postgres NULL nunca colide com NULL num indice unico. A
-- protecao que custou aquela migracao inteira ja nao valia, e o problema que ela
-- existiu para resolver -- 38 registros em 32 numeros, medidos naquele dia --
-- voltaria em silencio na proxima NE duplicada. A propria migracao previu o
-- caso: "AS COLUNAS NASCEM ANULAVEIS. O NOT NULL vem quando o servidor passar a
-- exigi-las." O servidor nao passou, e por isso este arquivo comeca por aqui.
--
-- O CONSERTO tem duas metades, e uma sozinha nao serve:
--   a) o servidor passa a DERIVAR e gravar as duas (nota_empenho_ctrl.js,
--      regra em utils/domain_constants.js). Elas nao entram no Joi: ninguem
--      digita a UG de um empenho, ela e consequencia da NC representativa, e um
--      campo de formulario permitiria afirmar uma UG que o credito desmente;
--   b) as duas viram NOT NULL aqui. Sem isso, a proxima porta de escrita que
--      esquecer as colunas reabre o buraco sem nada acusar -- foi exatamente o
--      que aconteceu por 24 horas.
--
-- A REGRA DA DERIVACAO e a mesma do backfill de 2026-08-07, e sai do dado: quem
-- empenha e a UG que RECEBEU o credito, e o credito da 167382 e emitido pela UG
-- 167035, do mesmo modo que o da 160382 vem da 160035.
--
-- ===========================================================================
-- 2. O CABECALHO DA 4.1 DO RPCMTec (fora do banco, registrado aqui)
-- ===========================================================================
--
-- A coluna 2 da subsecao 4.1 se chamava "Valor previsto (Prioridade 1)", e a
-- consulta que a alimenta soma TODO `pdr_item.valor_autorizado` do ano, sem
-- filtro de prioridade nenhum -- `grau_prioridade_id` nem sequer existia em
-- `pdr_item`. O documento assinado afirmava um recorte que a consulta nunca
-- fez. Decisao do chefe: o CABECALHO passa a "Valor previsto", que e o que a
-- consulta sempre calculou. A grade de larguras nao muda, para a tabela
-- continuar colavel na subsecao de mesmo numero.
--
-- Isto e o que libera a poda de `dfd.grau_prioridade_id` logo abaixo: com o
-- cabecalho corrigido, nao ha mais nenhum consumidor de prioridade no sistema.
--
-- ===========================================================================
-- 3. A PODA: 15 colunas e uma tabela de dominio
-- ===========================================================================
--
-- Tres classes, e elas nao se confundem.
--
-- 3.1 OS DERIVAVEIS -- provados contra o dado, e a prova roda ABAIXO, dentro
--     desta transacao, ANTES do DROP. Eles NAO somem da resposta da API: quem
--     lia o campo continua lendo, agora calculado.
--
--       `dfd_item.valor_total`  = quantidade * valor_unitario   31 de 31
--       `dfd.valor_estimado`    = soma dos totais dos itens       8 de 8
--       `pdr_item.gnd`          = natureza_despesa.gnd          36 de 36
--
--     Zero divergencias nas tres. `dfd.valor_estimado` e `dfd_item.valor_total`
--     saem na MESMA migracao de proposito: separa-las deixaria um dos dois
--     derivando do outro que acabou de sumir.
--
-- 3.2 OS QUE NUNCA TIVERAM DADO, ou tiveram um valor so:
--
--       `dfd.justificativa`             0 de 8
--       `dfd.data_prevista_conclusao`   0 de 8
--       `dfd.responsavel_cpf`           0 de 8   (e dado pessoal, num
--                                                 repositorio publico que nao
--                                                 precisa dele)
--       `dfd.grau_prioridade_id`        1 de 8, um unico codigo
--       `dfd.vinculo_plano_gestao`      8 de 8, UM valor distinto
--                                       ('Plano de Gestão do 1º CGEO')
--       `nota_credito.marcador`         8 de 99, um unico valor ('RECOLH')
--       `licitacao.nup`                 0 de 11
--       `licitacao.fornecedor`          0 de 11
--
--     Nenhum DFD jamais foi editado (`data_modificacao` 0 de 8), entao nao e
--     "preencheram e apagaram": nunca se preencheu.
--
--     `dfd.area_requisitante` FICA, e e a excecao que separa esta poda de uma
--     regra automatica: ela tambem tem um valor so hoje, e e o UNICO campo do
--     modulo que diz DE QUEM e a demanda. No dia em que outra secao do CGEO
--     pedir um DFD, ela distingue; `vinculo_plano_gestao` nunca distinguira
--     nada, porque e o nome do plano, e o plano e um so.
--
--     `nota_credito.marcador` e o resto de vespera da 1.40.0. Enquanto o
--     recolhido era um numero digitado, escrever 'RECOLH' era a unica forma de
--     guardar "esta voltou inteira". Desde que cada devolucao virou DOCUMENTO em
--     `nota_credito_recolhimento`, a pergunta tem resposta exata -- e o marcador
--     ja discordava dela: medido em 2026-08-08, ONZE NCs tem recolhimento
--     integral e so OITO estao marcadas. Errava em 3 casos de 11, em silencio.
--
-- 3.3 O PAR DE CARIMBO, nas TRES tabelas em que ele sai:
--
--       `dfd.data_modificacao`      + `usuario_modificacao_uuid`
--       `dfd_item.data_modificacao` + `usuario_modificacao_uuid`
--       `pdr_item.data_modificacao` + `usuario_modificacao_uuid`
--
--     AS DUAS SAEM SEMPRE JUNTAS, e a razao e que separadas nao significam nada:
--     "mudou em 3 de agosto" sem quem, ou "fulano mudou" sem quando, nao respondem
--     pergunta nenhuma. A razao do chefe e "vamos usar so a auditoria", e ela
--     guarda os DOIS e ainda diz O QUE mudou.
--
--     CONFERIDO ANTES DE REMOVER, porque essa e a condicao inteira: as tres
--     tabelas estao declaradas em `server/src/auditoria/mapa/orcamento.js` --
--     `orcamento.dfd` e `orcamento.pdr_item` com campo a campo, e
--     `orcamento.dfd_item` como LISTA (o item e apagado e reinserido inteiro a
--     cada salvamento, entao o evento e do PAI, com o antes e o depois da lista).
--     As tres escritas ja registram na MESMA transacao. Nenhuma fica descoberta.
--
--     Em `dfd_item` a razao e ainda mais forte, e e ESTRUTURAL: o item nunca
--     sofre UPDATE, entao as duas colunas nao tinham como receber valor. 0 de 31,
--     por construcao.
--
--     `orcamento.arquivo.data_modificacao` NAO SAI. Ela e o mesmo caso estrutural
--     (0 de 54, porque nao ha UPDATE de anexo em lugar nenhum), e mesmo assim
--     fica: o chefe nao a listou, e coluna que ninguem pediu para remover nao se
--     remove de carona.
--
-- ===========================================================================
-- A DECISAO QUE REVERTE OUTRA, e esta linha existe para ninguem chamar de descuido
-- ===========================================================================
--
-- `licitacao.nup` e `licitacao.fornecedor` tinham QUATRO DIAS. Nasceram em
-- migrations/2026-08-04_licitacao_campos_fase_e_anexo.sql, cuja mensagem diz:
--
--   "A tela de licitacoes guardava sete campos e nenhum deles IDENTIFICA o
--    processo. O chefe acompanha as licitacoes pelo numero do pregao e pelo NUP,
--    e hoje precisa sair do sistema para achar qualquer uma delas."
--
-- ESTA MIGRACAO REVERTE AQUELA DECISAO, e foi ATO DO CHEFE, em 2026-08-08. Com
-- as quatro colunas ainda em 0 de 11 quatro dias depois, ele decidiu que UM
-- identificador basta: o `numero_pregao` FICA, e o NUP sai. A `data_homologacao`
-- tambem FICA, tambem por decisao dele. Quem ler isto no futuro nao deve tratar
-- a remocao como esquecimento de quem leu aquela migracao pela metade.
--
-- ===========================================================================
-- VERSAO E PISO
-- ===========================================================================
--
-- VERSAO: 1.43.0. O PISO SOBE para 1.43.0 (`MIN_DATABASE_VERSION`, em
-- server/src/config.js), e sobe por REMOCAO, como a 1.31.0 e a 1.35.0. A regra
-- diz que remover so nao sobe o piso quando o codigo nunca leu o que saiu, e
-- aqui ele lia todas: as seis colunas de negocio estavam nos SELECT, nos INSERT
-- e nos UPDATE de cinco controladores, e `grau_prioridade_id` ainda trazia um
-- JOIN em `dominio.grau_prioridade`.
--
-- Um servidor 1.42.0 contra um banco 1.43.0 quebra na ABERTURA de quatro telas
-- com "coluna nao existe", e quebra em TODA gravacao de nota de empenho, porque
-- ele nao escreve o `ug` que aqui virou NOT NULL.
--
-- ===========================================================================
-- IDEMPOTENCIA
-- ===========================================================================
--
-- Todo DROP e `IF EXISTS`, o backfill so toca linha sem UG, e `SET NOT NULL`
-- numa coluna que ja e NOT NULL nao faz nada. As GUARDAS conferem antes se a
-- coluna ainda existe, para a segunda passagem nao morrer lendo o que a primeira
-- apagou.
--
-- CUSTA ZERO EM DADO DERIVAVEL, e as guardas abaixo provam isso NA HORA DE
-- APLICAR, em vez de confiar na medicao de ontem: se um item de DFD tiver
-- ganhado um total que nao e o produto, ou um item de PDR um GND que a ND
-- desmente, a migracao PARA e diz quantos sao. Silenciar isso seria escolher
-- sozinho qual dos dois numeros e o certo.

BEGIN;

-- ===========================================================================
-- PARTE 1 -- O CONSERTO DA CHAVE DO SIAFI
-- Vem antes de qualquer DROP: e o unico item em que o sistema esta errado hoje,
-- e o unico que piora sozinho com o tempo.
-- ===========================================================================

-- 1.1 A colisao que o backfill PODE revelar, dita em portugues antes de o indice
--     dize-la em SQLSTATE. Toda NE tem `nota_credito_id` NOT NULL, entao a
--     projecao abaixo cobre a tabela inteira, e nao so as linhas sem UG.
DO $$
DECLARE
  v_repetidos TEXT;
BEGIN
  SELECT string_agg(t.rotulo, '; ')
    INTO v_repetidos
    FROM (
      SELECT p.ug || ' ' || p.ano || ' ' || p.numero ||
             ' (ids ' || string_agg(p.id::text, ', ' ORDER BY p.id) || ')' AS rotulo
        FROM (
          SELECT ne.id, ne.ano, ne.numero,
                 CASE WHEN nc.ug_emitente = '167035' THEN '167382' ELSE '160382' END AS ug
            FROM orcamento.nota_empenho AS ne
            INNER JOIN orcamento.nota_credito AS nc ON nc.id = ne.nota_credito_id
        ) AS p
       GROUP BY p.ug, p.ano, p.numero
      HAVING count(*) > 1
    ) AS t;

  IF v_repetidos IS NOT NULL THEN
    RAISE EXCEPTION
      'Há nota de empenho com número repetido na mesma UG: %. '
      'Um empenho coberto por várias notas de crédito se representa pelo RATEIO '
      '(orcamento.nota_empenho_nota_credito), e não por um registro por NC. '
      'Funda os registros antes de aplicar esta migração.',
      v_repetidos;
  END IF;
END $$;

-- 1.2 O backfill das NEs nascidas SEM UG entre 2026-08-07 e hoje, pela mesma
--     regra que o servidor passa a usar em toda gravacao.
UPDATE orcamento.nota_empenho AS ne
   SET ug = CASE WHEN nc.ug_emitente = '167035' THEN '167382' ELSE '160382' END,
       gestao = '00001'
  FROM orcamento.nota_credito AS nc
 WHERE nc.id = ne.nota_credito_id
   AND (ne.ug IS NULL OR ne.gestao IS NULL);

-- Rede: NE sem NC representativa nao deveria existir (a chave estrangeira e
-- obrigatoria), mas o NOT NULL abaixo nao pode depender disso.
UPDATE orcamento.nota_empenho SET ug = '160382' WHERE ug IS NULL;
UPDATE orcamento.nota_empenho SET gestao = '00001' WHERE gestao IS NULL;

-- 1.3 O NOT NULL que torna a protecao real. Sem ele, a proxima porta de escrita
--     que esquecer as colunas reabre o buraco sem nada acusar.
ALTER TABLE orcamento.nota_empenho ALTER COLUMN ug SET NOT NULL;
ALTER TABLE orcamento.nota_empenho ALTER COLUMN gestao SET NOT NULL;

COMMENT ON COLUMN orcamento.nota_empenho.ug IS
    'UG que emitiu o empenho (a que recebeu o crédito). Parte da chave do SIAFI, com gestão, ano e número. DERIVADA da UG emitente da NC representativa pelo servidor; não é campo de formulário. NOT NULL desde a 1.43.0.';
COMMENT ON COLUMN orcamento.nota_empenho.gestao IS
    'Gestão da UG emitente. Compõe a chave do SIAFI. Hoje só existe a 00001, e o servidor a grava fixa. NOT NULL desde a 1.43.0.';

-- ===========================================================================
-- PARTE 2 -- AS PROVAS, que rodam ANTES de todo DROP e na MESMA transacao
-- ===========================================================================

-- 2.1 `dfd_item.valor_total` = ROUND(quantidade * valor_unitario, 2)
--
-- O ROUND nao e detalhe: `quantidade` e NUMERIC(15,3) e `valor_unitario` e
-- NUMERIC(15,2), entao o produto cru tem cinco casas e a coluna tinha duas. A
-- expressao provada aqui e EXATAMENTE a que o servidor passa a usar na leitura.
DO $$
DECLARE
  v_n BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orcamento' AND table_name = 'dfd_item'
                AND column_name = 'valor_total') THEN
    EXECUTE $q$
      SELECT count(*) FROM orcamento.dfd_item
       WHERE valor_total IS DISTINCT FROM ROUND(quantidade * valor_unitario, 2)
    $q$ INTO v_n;

    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Há % item(ns) de DFD cujo valor_total NÃO é quantidade x valor_unitário. '
        'Medido em 2026-08-08 eram 0 de 31. A coluna só pode virar cálculo enquanto '
        'a igualdade for verdadeira: confira esses itens antes de aplicar.', v_n;
    END IF;
  END IF;
END $$;

-- 2.2 `dfd.valor_estimado` = soma dos totais dos itens
--
-- Roda ANTES de 2.1 sumir do banco, e usa a mesma expressao derivada, e nao a
-- coluna: o que se prova e que o valor do DFD sobrevive a poda dos DOIS lados.
DO $$
DECLARE
  v_n BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orcamento' AND table_name = 'dfd'
                AND column_name = 'valor_estimado') THEN
    EXECUTE $q$
      SELECT count(*)
        FROM orcamento.dfd AS d
       WHERE d.valor_estimado IS DISTINCT FROM (
               SELECT ROUND(SUM(i.quantidade * i.valor_unitario), 2)
                 FROM orcamento.dfd_item AS i
                WHERE i.dfd_id = d.id
             )
    $q$ INTO v_n;

    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Há % DFD(s) cujo valor_estimado NÃO é a soma dos itens. Medido em 2026-08-08 '
        'eram 0 de 8. Confira esses DFDs antes de aplicar: a poda transforma o campo '
        'em cálculo, e o número da tela mudaria em silêncio.', v_n;
    END IF;
  END IF;
END $$;

-- 2.3 `pdr_item.gnd` = `dominio.natureza_despesa.gnd`
DO $$
DECLARE
  v_n BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orcamento' AND table_name = 'pdr_item'
                AND column_name = 'gnd') THEN
    EXECUTE $q$
      SELECT count(*)
        FROM orcamento.pdr_item AS i
        INNER JOIN dominio.natureza_despesa AS nd ON nd.code = i.cod_nd
       WHERE i.gnd IS DISTINCT FROM nd.gnd
    $q$ INTO v_n;

    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Há % item(ns) de PDR com GND diferente do GND da natureza de despesa deles. '
        'Medido em 2026-08-08 eram 0 de 36. Decida qual dos dois está certo antes '
        'de aplicar: a poda escolhe o da ND para sempre.', v_n;
    END IF;
  END IF;
END $$;

-- 2.4 `nota_credito.marcador`: toda NC marcada tem recolhimento INTEGRAL
--
-- O contrario nao se cobra, e e o ponto: ha NC integral sem marcador (3 de 11
-- em 2026-08-08), e e por isso que o marcador sai. O que precisa ser verdade
-- para nada se perder e o outro lado -- que nenhuma marca afirme um fato que a
-- soma dos recolhimentos desminta.
DO $$
DECLARE
  v_n BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orcamento' AND table_name = 'nota_credito'
                AND column_name = 'marcador') THEN
    EXECUTE $q$
      SELECT count(*)
        FROM orcamento.nota_credito AS nc
       WHERE nc.marcador IS NOT NULL
         AND COALESCE((SELECT SUM(r.valor)
                         FROM orcamento.nota_credito_recolhimento AS r
                        WHERE r.nota_credito_id = nc.id), 0) <> nc.valor_nc
    $q$ INTO v_n;

    IF v_n > 0 THEN
      RAISE EXCEPTION
        'Há % nota(s) de crédito marcada(s) cujo recolhimento NÃO é integral. '
        'O marcador estaria afirmando um fato que os documentos de recolhimento '
        'desmentem, e a poda o apagaria junto com a discordância. Cadastre o '
        'documento que falta antes de aplicar.', v_n;
    END IF;
  END IF;
END $$;

-- 2.5 As colunas que a medicao encontrou VAZIAS. Se alguem preencheu alguma
--     entre a medicao e a aplicacao, a migracao PARA: apagar dado que nasceu
--     depois da decisao seria decidir por quem o escreveu.
DO $$
DECLARE
  v_achados TEXT := '';
  v_n BIGINT;
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('orcamento', 'dfd',       'justificativa'),
      ('orcamento', 'dfd',       'data_prevista_conclusao'),
      ('orcamento', 'dfd',       'responsavel_cpf'),
      ('orcamento', 'licitacao', 'nup'),
      ('orcamento', 'licitacao', 'fornecedor')
    ) AS v(esquema, tabela, coluna)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = r.esquema AND table_name = r.tabela
                  AND column_name = r.coluna) THEN
      EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I IS NOT NULL',
                     r.esquema, r.tabela, r.coluna) INTO v_n;
      IF v_n > 0 THEN
        v_achados := v_achados || format('%s.%s.%s: %s linha(s); ',
                                         r.esquema, r.tabela, r.coluna, v_n);
      END IF;
    END IF;
  END LOOP;

  IF v_achados <> '' THEN
    RAISE EXCEPTION
      'Colunas que a medição de 2026-08-08 encontrou VAZIAS agora têm dado: % '
      'Alguém as preencheu depois da decisão. Leve o caso ao chefe antes de aplicar.',
      v_achados;
  END IF;
END $$;

-- 2.6 `dfd.vinculo_plano_gestao` era UMA constante digitada oito vezes. Se ela
--     ganhou um segundo valor, ela deixou de ser constante, e a razao da poda
--     caiu.
DO $$
DECLARE
  v_n BIGINT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orcamento' AND table_name = 'dfd'
                AND column_name = 'vinculo_plano_gestao') THEN
    EXECUTE $q$
      SELECT count(DISTINCT vinculo_plano_gestao) FROM orcamento.dfd
       WHERE vinculo_plano_gestao IS NOT NULL
    $q$ INTO v_n;

    IF v_n > 1 THEN
      RAISE EXCEPTION
        'orcamento.dfd.vinculo_plano_gestao tem % valores distintos, e em 2026-08-08 '
        'tinha 1. Ela foi podada por ser CONSTANTE; com mais de um valor ela passou '
        'a distinguir alguma coisa, e a decisão precisa ser refeita.', v_n;
    END IF;
  END IF;
END $$;

-- 2.7 O par de carimbo NAO tem guarda que interrompa, e a razao esta na parte
--     3.3 do cabecalho: o que ele guardava passa a ser guardado por
--     `auditoria.evento`, nas TRES tabelas, conferido antes de escrever esta
--     linha. Isto aqui e um AVISO, para quem aplica ver o que esta descartando.
DO $$
DECLARE
  v_dfd BIGINT := 0;
  v_pdr BIGINT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orcamento' AND table_name = 'dfd'
                AND column_name = 'data_modificacao') THEN
    EXECUTE 'SELECT count(*) FROM orcamento.dfd WHERE data_modificacao IS NOT NULL'
      INTO v_dfd;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orcamento' AND table_name = 'pdr_item'
                AND column_name = 'data_modificacao') THEN
    EXECUTE 'SELECT count(*) FROM orcamento.pdr_item WHERE data_modificacao IS NOT NULL'
      INTO v_pdr;
  END IF;

  RAISE NOTICE
    'Carimbo de modificação descartado: % DFD(s) e % item(ns) de PDR o tinham. '
    'Quem passa a guardar quem mexeu e quando é auditoria.evento, onde as três '
    'tabelas estão declaradas.', v_dfd, v_pdr;
END $$;

-- ===========================================================================
-- PARTE 3 -- A PODA
-- ===========================================================================

-- 3.1 DFD
ALTER TABLE orcamento.dfd
  DROP COLUMN IF EXISTS justificativa,
  DROP COLUMN IF EXISTS grau_prioridade_id,
  DROP COLUMN IF EXISTS data_prevista_conclusao,
  DROP COLUMN IF EXISTS responsavel_cpf,
  DROP COLUMN IF EXISTS valor_estimado,
  DROP COLUMN IF EXISTS vinculo_plano_gestao,
  DROP COLUMN IF EXISTS data_modificacao,
  DROP COLUMN IF EXISTS usuario_modificacao_uuid;

COMMENT ON COLUMN orcamento.dfd.area_requisitante IS
    'De quem é a demanda. FICA, ao contrário de vinculo_plano_gestao: as duas tinham um valor só em 2026-08-08, e esta é a única que distinguirá alguma coisa no dia em que outra seção do CGEO pedir um DFD.';

-- 3.2 Item do DFD
ALTER TABLE orcamento.dfd_item
  DROP COLUMN IF EXISTS valor_total,
  DROP COLUMN IF EXISTS data_modificacao,
  DROP COLUMN IF EXISTS usuario_modificacao_uuid;

COMMENT ON COLUMN orcamento.dfd_item.quantidade IS
    'Com valor_unitario, é a fonte do total do item: o total saiu da tabela na 1.43.0 e passou a ser ROUND(quantidade * valor_unitario, 2), igual em 31 de 31 linhas.';

-- 3.3 Item do PDR
ALTER TABLE orcamento.pdr_item
  DROP COLUMN IF EXISTS gnd,
  DROP COLUMN IF EXISTS data_modificacao,
  DROP COLUMN IF EXISTS usuario_modificacao_uuid;

COMMENT ON COLUMN orcamento.pdr_item.cod_nd IS
    'Natureza de despesa do item. É também a fonte do GND: a coluna gnd saiu na 1.43.0 e o valor passa a vir de dominio.natureza_despesa por JOIN, onde já era igual em 36 de 36.';

-- 3.4 Licitação. Ver a seção "A DECISÃO QUE REVERTE OUTRA" no cabeçalho: isto é
--     ato do chefe sobre a migração de 2026-08-04, e não descuido.
ALTER TABLE orcamento.licitacao
  DROP COLUMN IF EXISTS nup,
  DROP COLUMN IF EXISTS fornecedor;

COMMENT ON COLUMN orcamento.licitacao.numero_pregao IS
    'O identificador do processo fora do SCA. FICA por decisão do chefe em 2026-08-08, e o NUP saiu na mesma decisão: um identificador basta, e o segundo só criava campo que ninguém preenchia.';

-- 3.5 Nota de crédito
ALTER TABLE orcamento.nota_credito
  DROP COLUMN IF EXISTS marcador;

-- 3.6 O domínio que ficou sem nenhum consumidor.
--
-- SEM CASCADE, de propósito: `dfd.grau_prioridade_id` era a única chave
-- estrangeira para ela em todo o sistema, e se apareceu outra este comando tem
-- de FALHAR e dizer qual, em vez de arrastá-la junto.
DROP TABLE IF EXISTS dominio.grau_prioridade;

UPDATE public.versao SET nome = '1.43.0' WHERE code = 1;

COMMIT;

-- ---------------------------------------------------------------------------
-- COMO REVERTER
--
-- O CONTEÚDO NÃO VOLTA de lugar nenhum, e é preciso dizer o que isso significa
-- em cada caso:
--   * os três DERIVÁVEIS voltam por SQL, exatos, porque a igualdade que os
--     condenou é a mesma que os reconstrói;
--   * `vinculo_plano_gestao` volta por SQL, porque era uma constante;
--   * `marcador` volta por SQL, porque marcava exatamente a NC de recolhimento
--     integral -- e volta MELHOR do que estava, sem as 3 discordâncias;
--   * `justificativa`, `data_prevista_conclusao`, `responsavel_cpf`, `nup` e
--     `fornecedor` não têm o que voltar: eram 0 linhas;
--   * `grau_prioridade_id` perde o único valor que existia (1 linha, código 1);
--   * o par de carimbo perde o que tinha, e o que tinha está em auditoria.evento.
--
--   ALTER TABLE orcamento.dfd
--     ADD COLUMN justificativa TEXT,
--     ADD COLUMN grau_prioridade_id SMALLINT,
--     ADD COLUMN data_prevista_conclusao DATE,
--     ADD COLUMN responsavel_cpf VARCHAR(14),
--     ADD COLUMN vinculo_plano_gestao VARCHAR(60),
--     ADD COLUMN valor_estimado NUMERIC(15,2),
--     ADD COLUMN data_modificacao TIMESTAMP WITH TIME ZONE,
--     ADD COLUMN usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid);
--   ALTER TABLE orcamento.dfd_item
--     ADD COLUMN valor_total NUMERIC(15,2),
--     ADD COLUMN data_modificacao TIMESTAMP WITH TIME ZONE,
--     ADD COLUMN usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid);
--   ALTER TABLE orcamento.pdr_item
--     ADD COLUMN gnd SMALLINT,
--     ADD COLUMN data_modificacao TIMESTAMP WITH TIME ZONE,
--     ADD COLUMN usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid);
--   ALTER TABLE orcamento.licitacao
--     ADD COLUMN nup VARCHAR(25),
--     ADD COLUMN fornecedor VARCHAR(255);
--   ALTER TABLE orcamento.nota_credito ADD COLUMN marcador VARCHAR(8);
--
--   CREATE TABLE dominio.grau_prioridade(
--     code SMALLINT NOT NULL PRIMARY KEY,
--     nome VARCHAR(255) NOT NULL
--   );
--   INSERT INTO dominio.grau_prioridade (code, nome) VALUES
--     (1, 'Alta'), (2, 'Normal'), (3, 'Baixa');
--   ALTER TABLE orcamento.dfd
--     ADD CONSTRAINT dfd_grau_prioridade_id_fkey
--     FOREIGN KEY (grau_prioridade_id) REFERENCES dominio.grau_prioridade (code);
--
--   -- Os deriváveis, reconstruídos:
--   UPDATE orcamento.dfd_item
--      SET valor_total = ROUND(quantidade * valor_unitario, 2);
--   UPDATE orcamento.dfd AS d
--      SET valor_estimado = (SELECT ROUND(SUM(i.quantidade * i.valor_unitario), 2)
--                              FROM orcamento.dfd_item AS i WHERE i.dfd_id = d.id);
--   UPDATE orcamento.pdr_item AS i
--      SET gnd = nd.gnd
--     FROM dominio.natureza_despesa AS nd WHERE nd.code = i.cod_nd;
--   UPDATE orcamento.nota_credito AS nc
--      SET marcador = 'RECOLH'
--    WHERE COALESCE((SELECT SUM(r.valor) FROM orcamento.nota_credito_recolhimento AS r
--                     WHERE r.nota_credito_id = nc.id), 0) = nc.valor_nc;
--
--   -- E o conserto da chave do SIAFI, que NÃO se desfaz sem desfazer o servidor:
--   ALTER TABLE orcamento.nota_empenho ALTER COLUMN ug DROP NOT NULL;
--   ALTER TABLE orcamento.nota_empenho ALTER COLUMN gestao DROP NOT NULL;
--
--   UPDATE public.versao SET nome = '1.42.0' WHERE code = 1;
-- ---------------------------------------------------------------------------
