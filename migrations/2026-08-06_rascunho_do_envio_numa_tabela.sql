-- O RASCUNHO DO ENVIO VIRA UM DOCUMENTO, E A LIMPEZA PASSA A APAGAR.
--
-- O QUE O BANCO FAZIA. O envio pelo plugin do QGIS abre uma sessao em
-- `acervo.upload_session` e escreve o rascunho em TRES tabelas espelho:
-- `upload_produto_temp`, `upload_versao_temp` e `upload_arquivo_temp`, que
-- repetem coluna a coluna `acervo.produto`, `acervo.versao` e `acervo.arquivo`.
-- Nada as esvaziava.
--
-- MEDIDO EM PRODUCAO EM 06/08/2026, em transacao somente leitura:
--
--   tabela                 linhas     peso      tabela real   linhas    peso
--   upload_session          2.571    584 kB
--   upload_produto_temp     6.488  1.504 kB     produto        6.309  2.224 kB
--   upload_versao_temp      7.462  3.248 kB     versao         7.572  6.088 kB
--   upload_arquivo_temp    19.315  6.856 kB     arquivo       17.499  9.896 kB
--
-- Sao 35.836 linhas e 11,9 MB de copia de trabalho, contra 17,8 MB de dado real:
-- 40% do peso do schema era entulho.
--
-- O CUSTO MAIOR NAO ERA O ESPACO, ERA O ACOPLAMENTO. Toda coluna nova de
-- `acervo.versao` tinha de ser duplicada em `upload_versao_temp`. Aconteceu em
-- 05/08/2026, quando `data_prevista` e `meta_pit_id` precisaram atravessar a
-- cadeia e obrigaram a tocar quatro INSERTs. Com o rascunho em JSONB, a coluna
-- nova atravessa sozinha.
--
-- O QUE SE PERDE, E FOI ACEITO PELO CHEFE DA DGEO: as chaves estrangeiras do
-- rascunho (`lote_id`, `tipo_versao_id`, `subtipo_produto_id`,
-- `volume_armazenamento_id`). Elas eram redundantes. O Joi valida o codigo no
-- preparo (`arquivo_schema.js`) e o INSERT real valida de novo na finalizacao,
-- contra as MESMAS tabelas de dominio. Conferido caminho a caminho: nenhuma
-- VALIDACAO existia so na FK do rascunho.
--
-- UMA COISA MUDA DE COMPORTAMENTO, e e preciso dizer.
-- `upload_versao_temp.lote_id` tinha `ON DELETE SET NULL`, e `acervo.versao`
-- nao tem. Entao um lote apagado durante as 24 h de uma sessao aberta zerava o
-- vinculo do rascunho em silencio, e a versao nascia sem lote. Agora o rascunho
-- guarda o id, e a finalizacao FALHA com violacao de chave estrangeira. Falhar
-- alto e melhor: a versao deixava de contar no lote sem ninguem saber.
--
-- A SESSAO PASSA A MORRER NA FINALIZACAO. Depois do confirm ela nao serve para
-- nada: o historico do que entrou no acervo ja esta em `auditoria.evento`, que e
-- append-only. O cancelamento tambem apaga, pela mesma razao. A tabela deixa de
-- ser arquivo e vira fila.
--
-- E A LIMPEZA PASSA A APAGAR. `acervo.cleanup_expired_uploads()` tinha dois
-- comandos, e os dois eram UPDATE: ela marcava a sessao vencida como `failed` e
-- nunca apagava linha nenhuma. Agora ela tem os dois passos que o nome promete,
-- devolve as duas contagens que ela mesma mediu, e saiu da carona da rota
-- `/cleanup-expired-downloads`: a sessao de envio tem rota propria em
-- `POST /api/arquivo/cleanup-expired-uploads`.
--
-- ESTA MIGRACAO E SEGURA EM PRODUCAO PORQUE NAO HA SESSAO PENDENTE. Das 2.571,
-- 2.555 estao `completed`, 12 `failed`, 4 `cancelled` e ZERO `pending`. Nada em
-- voo se perde. Mas OUTRA instalacao pode ter envio em curso, e por isso o passo
-- 1 ABORTA em vez de apagar por baixo de quem esta copiando bytes.
--
-- IDEMPOTENTE, E A GUARDA E A MESMA PARA OS DOIS PASSOS QUE MEXEM EM DADO: "as
-- tabelas espelho ainda existem". Numa base ja migrada elas nao existem, e o
-- bloco 1 sai sem tocar em nada. Sem essa guarda, a segunda rodada apagaria as
-- sessoes criadas DEPOIS da primeira, que e o oposto do que a migracao quer.
-- Os passos 2, 3 e 4 sao guardados por IF EXISTS / IF NOT EXISTS.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A GUARDA E A LIMPEZA DO RASCUNHO VELHO, no mesmo bloco.
--
-- 1.1 ABORTA SE HOUVER ENVIO EM CURSO. Sessao `pending` DENTRO do prazo e um
-- plugin que ja recebeu o `destination_path` e esta copiando os bytes agora.
-- Apagar o rascunho dele faria o `confirm-upload` seguinte responder "sessao nao
-- encontrada" depois de horas de copia, sem dizer por que.
--
-- Sessao `pending` VENCIDA nao segura nada: ninguem vai confirmar um envio cujo
-- prazo passou, e o `confirm-upload` a recusaria de qualquer jeito.
--
-- 1.2 AS SESSOES SAEM, todas. Nenhuma delas e lida por nada depois desta
-- migracao: o rascunho delas vive nas tabelas espelho, que caem no passo 3, e
-- sem ele nao ha como finalizar nem exibir uma sessao antiga. As linhas das tres
-- espelho saem por CASCADE das chaves estrangeiras `session_id`.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  em_curso  INTEGER;
  mais_nova TIMESTAMP WITH TIME ZONE;
  apagadas  INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'acervo' AND table_name = 'upload_arquivo_temp'
  ) THEN
    RAISE NOTICE 'As tabelas espelho ja sairam: migracao ja aplicada, nada a apagar.';
    RETURN;
  END IF;

  SELECT count(*), max(expiration_time) INTO em_curso, mais_nova
  FROM acervo.upload_session
  WHERE status = 'pending' AND expiration_time >= NOW();

  IF em_curso > 0 THEN
    RAISE EXCEPTION
      'Ha % sessao(oes) de envio EM CURSO (status pending, prazo ate %). Esta migracao apaga o rascunho delas, e o plugin que esta copiando os bytes agora perderia o envio inteiro. Espere fechar, ou cancele em POST /api/arquivo/cancel-upload, e rode de novo.',
      em_curso, mais_nova;
  END IF;

  DELETE FROM acervo.upload_session;
  GET DIAGNOSTICS apagadas = ROW_COUNT;
  RAISE NOTICE '% sessao(oes) de envio apagada(s), com o rascunho delas.', apagadas;
END $$;

-- ---------------------------------------------------------------------------
-- 2. A COLUNA DO RASCUNHO.
--
-- O rascunho vivo NAO e convertido, e nao ha o que converter: o passo 1 provou
-- que nao ha sessao em curso e apagou as encerradas.
-- ---------------------------------------------------------------------------
ALTER TABLE acervo.upload_session
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN acervo.upload_session.payload IS
    'A árvore inteira do envio: {"arquivos"|"versoes"|"produtos": [...]}, conforme o operation_type. Cada arquivo carrega status e error_message próprios.';

-- ---------------------------------------------------------------------------
-- 3. AS TRES TABELAS ESPELHO CAEM.
--
-- Sem CASCADE, de proposito: se alguma view ou restricao ainda as ler, o comando
-- falha e a migracao inteira volta atras. Falhar alto custa menos do que
-- derrubar em silencio um objeto que ninguem sabia que existia.
--
-- A ORDEM E A DA DEPENDENCIA: `upload_arquivo_temp` aponta `upload_versao_temp`,
-- que aponta `upload_produto_temp`. As sequencias `*_id_seq` caem junto (elas
-- sao OWNED BY a coluna), e os indices tambem.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS acervo.upload_arquivo_temp;
DROP TABLE IF EXISTS acervo.upload_versao_temp;
DROP TABLE IF EXISTS acervo.upload_produto_temp;

-- ---------------------------------------------------------------------------
-- 4. A LIMPEZA GANHA O DELETE QUE O NOME PROMETE.
--
-- DROP antes do CREATE porque o TIPO DE RETORNO muda: ela devolvia `void`, e um
-- `CREATE OR REPLACE` nao troca a assinatura de retorno de uma funcao.
--
-- Ela devolve as duas contagens que ELA mediu. Antes, o controller contava as
-- sessoes ANTES de chamar a funcao, entao quem conferisse o numero conferia a
-- aritmetica do JavaScript: a funcao podia parar de escrever e o numero
-- continuaria certo.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS acervo.cleanup_expired_uploads();

CREATE OR REPLACE FUNCTION acervo.cleanup_expired_uploads()
RETURNS TABLE (fechadas INTEGER, apagadas INTEGER) AS $$
BEGIN
    -- 1. A sessao PENDENTE que venceu vira `failed`. Ninguem confirmou, entao
    -- nada entrou no acervo, mas a linha FICA: ela e o unico registro do
    -- `destination_path` que o cliente ia gravar, e a tela de uploads com
    -- problema a mostra.
    UPDATE acervo.upload_session
       SET status = 'failed',
           error_message = 'Upload expired - client never confirmed completion',
           completed_at = NOW()
     WHERE status = 'pending'
       AND expiration_time < NOW();
    GET DIAGNOSTICS fechadas = ROW_COUNT;

    -- 2. A sessao ENCERRADA ha mais de 30 dias e APAGADA. O prazo conta pela
    -- `expiration_time`, que e NOT NULL, e nao pela `completed_at`, que era nula
    -- em 3 das 12 sessoes falhas de producao. Trinta dias e o teto do
    -- diagnostico: passado um mes, ninguem volta para investigar um envio que
    -- falhou.
    DELETE FROM acervo.upload_session
     WHERE status IN ('completed', 'failed', 'cancelled')
       AND expiration_time < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS apagadas = ROW_COUNT;

    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

UPDATE public.versao SET nome = '1.32.0' WHERE code = 1;

COMMIT;

-- Para desfazer. A migracao NAO e reversivel: O RASCUNHO APAGADO NAO VOLTA.
--
-- O passo 1 apaga as 2.571 sessoes e, por CASCADE, as 33.265 linhas das tres
-- tabelas espelho. Nao ha de onde recompo-las a nao ser do backup: elas nunca
-- foram copia de nada que ficou. O que entrou no acervo continua em
-- `acervo.produto`, `acervo.versao` e `acervo.arquivo`, com o rastro em
-- `auditoria.evento`; o que NAO entrou (as 12 falhas e os 4 cancelamentos) some
-- com o rascunho, e com ele o `destination_path` dos bytes que o plugin possa
-- ter copiado e nunca confirmado.
--
-- O caminho, na ordem:
--   1. Restaurar do backup as quatro tabelas de envio.
--   2. DROP FUNCTION acervo.cleanup_expired_uploads();
--      e recriar a versao antiga, `RETURNS void`, com os dois UPDATEs.
--   3. Reverter em server/src/arquivo/arquivo_ctrl.js os quatro `prepare*`, o
--      `confirmUpload`, os quatro `process*`, o `getProblemUploads` e o
--      `cancelUpload` para o desenho de tres tabelas; em
--      server/src/acervo/acervo_ctrl.js, devolver a chamada da funcao ao
--      `cleanupExpiredDownloads`; e remover a rota
--      POST /api/arquivo/cleanup-expired-uploads.
--   4. ALTER TABLE acervo.upload_session DROP COLUMN payload;
--   5. UPDATE public.versao SET nome = '1.31.0' WHERE code = 1;
