-- Poda de dois objetos que nada aciona.
--
-- 1. `acervo.cleanup_expired_downloads()`
--
-- Nenhum código a executa. Quem fecha download vencido é
-- `controller.cleanupExpiredDownloads`, em `server/src/acervo/acervo_ctrl.js`,
-- que roda o mesmo UPDATE por conta própria. Ele faz isso de propósito: a
-- função devolve void, e sem o RETURNING não há como contar as linhas que
-- mudaram. "Limpou" sem número é eco da chamada, não medida.
--
-- Ela era uma ARMADILHA enquanto existia: parecia a rotina automática de
-- expurgo, e o `er/auditoria.sql` chegou a citá-la como se ela apagasse algo
-- sozinha. Não apagava nada, porque ninguém a chamava, e nem apagaria, porque
-- ela só marca status = 'failed'.
--
-- A decisão do chefe fecha a última dúvida que restava: o SCA NÃO roda
-- agendador. Toda limpeza é disparada por uma pessoa, pela rota de manutenção.
-- Sem CRON, não há como sobrar um agendamento externo chamando a função.
--
-- 2. `orcamento.idx_nota_credito_ano`
--
-- Coberto por `uniq_nota_credito_num_nd_ug`, cuja PRIMEIRA coluna também é
-- `ano`. O Postgres usa o prefixo do índice composto, então o índice de uma
-- coluna só custa escrita e não serve a consulta nenhuma que o outro não sirva.
--
-- O PISO DO BANCO NÃO SOBE. Esta migração só REMOVE objeto que o código não
-- lê, então um banco carimbado 1.25.0 roda a versão nova sem faltar nada.
-- Subir `MIN_DATABASE_VERSION` obrigaria toda instalação a migrar para não
-- ganhar nada. O que sobe é a versão da APLICAÇÃO.

BEGIN;

DROP FUNCTION IF EXISTS acervo.cleanup_expired_downloads();

DROP INDEX IF EXISTS orcamento.idx_nota_credito_ano;

UPDATE public.versao SET nome = '1.26.0' WHERE code = 1;

COMMIT;
