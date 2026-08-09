-- O CONTROLE DO ACERVO (SCA) PASSA A SE CHAMAR SAP 3.0.
--
-- A DECISAO E DO CHEFE, de 2026-08-09: o Sistema de Controle do Acervo passa a
-- se chamar Sistema de Apoio a Producao, versao 3.0, e o SAP 2.3.5, que hoje
-- roda em outro repositorio, sera aposentado. Todo o conteudo dele entra aqui.
--
-- POR QUE O NUMERO E 3.0.0, E NAO 2.0.0. Ele nao abre uma serie nova: ele
-- CONTINUA a numeracao do sistema aposentado. O que estava em 1.50.0 era a
-- numeracao do Controle do Acervo, e mante-la faria "SAP 3.0" no menu conviver
-- com `1.51.0` na resposta da API e no `public.versao`, que e exatamente o tipo
-- de descompasso que `__tests__/unit/versao_do_servico.test.js` existe para
-- pegar. Depois desta migracao ha um numero so.
--
-- ESTA MIGRACAO NAO MUDA SCHEMA NENHUM. Ela nao cria, nao apaga e nao renomeia
-- tabela, coluna, indice, restricao nem linha de dominio: ela SO carimba
-- `public.versao`. A renomeacao e de PRODUTO, e vive no codigo e nas telas.
--
-- AS MIGRACOES DE SCHEMA DO CORE DE PRODUCAO VEM DEPOIS DESTA. Os schemas
-- `producao`, `qgis`, `metadado`, `acompanhamento` e `microcontrole`, o modulo 7
-- em `dominio.modulo` e os dominios novos entram em arquivos proprios, cada um
-- carimbando a sua versao 3.x. Esta aqui e o marco zero da serie, e roda antes
-- de todos eles.
--
-- O QUE NAO MUDA, E A LISTA E DELIBERADA
--
--   1. O SCHEMA `acervo` continua `acervo`, e as rotas continuam `/api/acervo/*`.
--      O acervo nao era o sistema inteiro: ele e UMA parte do SAP 3.0, e a maior
--      delas. Renomear o schema custaria toda FK, todo SQL e todo CLI para nao
--      dizer nada de novo.
--   2. O MODULO `acervo` de `dominio.modulo` (code 1, nome 'Controle do Acervo',
--      nome_abrev 'acervo') continua igual. `nome_abrev` e IDENTIFICADOR: o
--      `verifyPerfil`, o mapa `MODULO`, o prefixo de rota e a chave dos `perfis`
--      o comparam por igualdade de string. E o `nome` e o rotulo do MODULO na
--      tela de usuarios, e nao o nome do sistema.
--   3. OS CLIENTES DE LOGIN JA EMITIDOS. `dgeo.login.cliente` guarda 'sca_web' e
--      'sca_qgis' em toda linha do historico de acesso, e os dois continuam
--      aceitos pelo Joi de `login/login_schema.js`. Recusa-los aqui derrubaria a
--      interface e os plugins que ja estao no ar no segundo do deploy, e
--      reescrever a coluna seria a aplicacao apagando o proprio historico. Os
--      nomes novos ('sap_web', 'sap_fp', 'sap_fg') entram AO LADO deles.
--   4. O NOME DO BANCO, as chaves de `server/config.env` (`DB_*`, `SCA_URL`,
--      `SCA_USER`) e o cache de sessao dos CLIs em `~/.sca`. Sao identificadores
--      de ambiente e de disco: trocar cada um obriga toda maquina instalada a
--      reconfigurar, e nenhuma pessoa os le.
--   5. O NOME DO PROCESSO PM2 (`controle-acervo`) e o `name` dos `package.json`.
--      O primeiro esta gravado no `pm2 save` de quem ja implantou, e o segundo e
--      identificador de pacote.
--
-- ESTA MIGRACAO NAO CARIMBA A VERSAO, E A AUSENCIA E O PONTO.
--
-- Ela carimbava 3.0.0 ate 2026-08-09, e isso abria um buraco: quem aplicasse SO
-- ela ficaria com `public.versao` dizendo 3.0.0 e SEM os schemas do core de
-- producao. Como `MIN_DATABASE_VERSION` tambem e 3.0.0, o servidor subiria
-- satisfeito contra esse banco, e a falta so apareceria na primeira consulta a
-- `producao`, longe daqui.
--
-- QUEM CARIMBA E `2026-08-09_o_core_de_producao_atravessa.sql`, que e quem CRIA
-- os schemas. As duas sao UMA entrega, e o numero so sobe quando o banco tem de
-- fato o que o numero promete. Aplicar esta sozinha deixa o banco em 1.50.0, o
-- servidor recusa subir por piso, e a mensagem diz que falta migrar: e o
-- comportamento desejado, e nao um efeito colateral.
--
-- Para ensaiar, ensaie AS DUAS EM CADEIA, que e como elas se aplicam:
--
--   node migrations/ensaiar_migracao.cjs \
--     --migracao migrations/2026-08-09_o_sca_vira_sap_3.sql,migrations/2026-08-09_o_core_de_producao_atravessa.sql \
--     --novos er/qgis.sql,er/producao.sql,er/metadado.sql,er/acompanhamento_producao.sql \
--     --versao-anterior 1.50.0 --versao-esperada 3.0.0 \
--     --schemas producao,qgis,metadado,acompanhamento,dominio,acervo
--
-- IDEMPOTENTE por construcao: sobrou so a conferencia abaixo, que nao escreve.

BEGIN;

-- --- A conferencia do que NAO mudou ----------------------------------------
--
-- Ela vem antes do carimbo de proposito. Se alguem, um dia, resolver renomear o
-- modulo 1 junto com o produto, esta migracao para e diz por que.
DO $confere$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM dominio.modulo WHERE code = 1 AND nome_abrev = 'acervo'
  ) THEN
    RAISE EXCEPTION
      'o modulo 1 deixou de ter nome_abrev = acervo: o acervo continua sendo um MODULO do SAP 3.0, e nome_abrev e identificador';
  END IF;
END
$confere$;

-- --- Sem carimbo, e o paragrafo do cabecalho diz por que ---------------------
--
-- O `UPDATE public.versao` morava aqui e saiu em 2026-08-09. Quem carimba 3.0.0 e
-- `2026-08-09_o_core_de_producao_atravessa.sql`, que e quem cria os schemas.

COMMIT;

-- PARA DESFAZER:
--
--   Nada. Esta migracao nao escreve linha nenhuma: o que sobrou dela e uma
--   conferencia. Desfazer a RENOMEACAO e desfazer o CODIGO (`VERSION` e
--   `MIN_DATABASE_VERSION` de `server/src/config.js`, o `INSERT` de
--   `er/versao.sql`) e, se o core ja tiver sido aplicado, a migracao dele.
--
-- O DESFAZER NAO PERDE DADO, porque esta migracao nao escreve dado nenhum.
