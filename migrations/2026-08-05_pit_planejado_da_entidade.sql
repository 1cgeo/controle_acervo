-- O PLANEJADO do PIT passa a sair da ENTIDADE PLANEJADA, e nao da data do fato.
--
-- O PROBLEMA, MEDIDO EM PRODUCAO EM 2026-08-05. O planejado da producao vinha de
-- `acervo.lote.data_fim_prevista`, e nos 19 lotes que a tem ela e IGUAL a
-- `data_fim`. Variancia zero: a previsao vinha sendo preenchida no fim, junto
-- com o fato. O efeito na grade da meta 1.3 e que o PIT prometia 48 folhas em
-- agosto e 1 em outubro, e a tela mostrava 49 em JUNHO, porque o lote
-- 2026_1j_CO_PR_25k terminou em junho. O plano nao foi apagado, foi REESCRITO
-- pelo fato, que e o pior dos casos porque parece certo.
--
-- A capacitacao tinha o mesmo defeito por outro caminho: planejado e realizado
-- saiam os dois de `data_fim`, entao concluir com atraso MOVIA o mes que ela
-- havia planejado.
--
-- A impressao nao tinha planejado nenhum calculado: ele era digitado da
-- PLANEJ_PIT, sob o argumento de que a mapoteca nao planeja.
--
-- O DESENHO. Cada entidade que cumpre meta ganha a sua propria data de PROMESSA,
-- separada da data do fato. Uma regra so, nas tres origens calculadas:
--
--   Producao     `acervo.versao.data_prevista`      contra `data_edicao`
--   Capacitacao  `rpcmtec.capacitacao.data_prevista` contra `data_fim`
--   Impressao    `mapoteca.pedido.data_prevista`     contra `data_atendimento`
--
-- O PLANEJADO DA IMPRESSAO E O PEDIDO, E O REALIZADO CONTINUA SENDO A MIDIA.
-- Sao duas perguntas e duas fontes. O prometido esta no ITEM do pedido ligado a
-- meta (`mapoteca.pedido.meta_pit_id` mais `produto_pedido.quantidade`); o
-- entregue esta na midia que SAIU, pelo de-para de `mapoteca.midia_meta_pit`.
-- Trocar o realizado para o pedido derrubaria a 4.1 de 5.664 folhas para 253, e
-- daria 199 folhas de tyvek na 4.2 num ano em que nenhuma saiu em tyvek.
--
-- A medicao que sustenta o pedido como plano: somando os itens dos pedidos ja
-- ligados a cada meta de 2026 da 325 na 4.1 contra 327 prometidas, 229 na 4.2
-- contra 252 e 36 na 4.3 contra 36. O pedido JA e o plano, cadastrado a mao. E
-- da para ver onde a data faltou: 9 dos 16 pedidos ligados tem `data_pedido` em
-- 2026-01-01, que e marcador de "nao houve pedido de cliente, isto e plano".
--
-- POR QUE NAO REUSAR `mapoteca.pedido.prazo`. Ele e o prazo que o CLIENTE impos,
-- e nao o mes em que a Divisao planeja imprimir. Medido: esta preenchido em 33
-- dos 164 pedidos e em NENHUM dos 16 ligados a meta. Mesma razao pela qual
-- `lote.data_fim_prevista` nasceu separada de `data_fim`.
--
-- SEM BACKFILL, DE PROPOSITO, e esta e a decisao que mais custa explicar. Toda
-- fonte disponivel para preencher a data prevista e hoje uma COPIA DO FATO:
-- `lote.data_fim_prevista` e igual a `data_fim` nos 19 lotes, `capacitacao.
-- data_fim` e a conclusao, e `pedido.data_pedido` e 2026-01-01 nos nove
-- planejados. Preencher a partir de qualquer uma delas importaria a mentira e a
-- tornaria invisivel, que e exatamente o defeito que esta migracao conserta.
--
-- A CONSEQUENCIA E VISIVEL E ESPERADA: no dia do deploy o planejado calculado
-- das metas 1.3 e 1.4 vai a zero, porque nenhuma das 74 versoes ligadas tem data
-- prevista. Isso nao e regressao, e o buraco aparecendo. Quem o mostra e o
-- diagnostico de `GET /pit/execucao/diagnostico`, que compara a
-- `quantidade_prevista` da meta com as entidades planejadas ligadas e diz o que
-- falta cadastrar.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS nas tres.

BEGIN;

-- A data em que esta versao PROMETE ficar pronta.
ALTER TABLE acervo.versao
  ADD COLUMN IF NOT EXISTS data_prevista DATE;

COMMENT ON COLUMN acervo.versao.data_prevista IS
    'Mês em que esta versão promete ficar pronta, e de onde sai o PLANEJADO do PIT. Distinta de data_edicao, que é o fato, e NÃO é sobrescrita quando a versão vira Regular: é isso que impede o plano de ser reescrito pelo que aconteceu.';

CREATE INDEX IF NOT EXISTS idx_versao_data_prevista
  ON acervo.versao (data_prevista) WHERE data_prevista IS NOT NULL;

-- A ESCADA DO ENVIO. `acervo.upload_versao_temp` e o rascunho da versao entre o
-- preparo e a finalizacao do envio, e sem as duas colunas aqui a meta escolhida
-- no formulario se perde NO MEIO do caminho: o schema aceita, o rascunho nao
-- guarda, e a versao final nasce sem vinculo. Tabela de passagem, sem comentario
-- de coluna: quem explica as duas e a tabela de destino.
ALTER TABLE acervo.upload_versao_temp
  ADD COLUMN IF NOT EXISTS meta_pit_id BIGINT REFERENCES pit.meta (id) ON DELETE SET NULL;

ALTER TABLE acervo.upload_versao_temp
  ADD COLUMN IF NOT EXISTS data_prevista DATE;

-- A data em que esta capacitacao PROMETE terminar.
ALTER TABLE rpcmtec.capacitacao
  ADD COLUMN IF NOT EXISTS data_prevista DATE;

COMMENT ON COLUMN rpcmtec.capacitacao.data_prevista IS
    'Mês em que esta capacitação promete terminar, e de onde sai o PLANEJADO do PIT. Antes o planejado saía de data_fim, e concluir com atraso movia o mês que ela havia planejado.';

CREATE INDEX IF NOT EXISTS idx_capacitacao_data_prevista
  ON rpcmtec.capacitacao (data_prevista) WHERE data_prevista IS NOT NULL;

-- A data em que este pedido PROMETE ser impresso.
ALTER TABLE mapoteca.pedido
  ADD COLUMN IF NOT EXISTS data_prevista DATE;

COMMENT ON COLUMN mapoteca.pedido.data_prevista IS
    'Mês em que este pedido promete ser impresso, e de onde sai o PLANEJADO da meta 4 do PIT. NÃO é prazo, que é o limite imposto pelo cliente: medido em 2026-08-05, prazo está preenchido em 33 dos 164 pedidos e em nenhum dos 16 ligados a meta.';

CREATE INDEX IF NOT EXISTS idx_pedido_data_prevista
  ON mapoteca.pedido (data_prevista) WHERE data_prevista IS NOT NULL;

UPDATE public.versao SET nome = '1.27.0' WHERE code = 1;

COMMIT;

-- Para desfazer (perde toda data prevista cadastrada, e o planejado das metas
-- automaticas volta a sair da data do fato):
--   DROP INDEX IF EXISTS acervo.idx_versao_data_prevista;
--   DROP INDEX IF EXISTS rpcmtec.idx_capacitacao_data_prevista;
--   DROP INDEX IF EXISTS mapoteca.idx_pedido_data_prevista;
--   ALTER TABLE acervo.versao DROP COLUMN data_prevista;
--   ALTER TABLE rpcmtec.capacitacao DROP COLUMN data_prevista;
--   ALTER TABLE mapoteca.pedido DROP COLUMN data_prevista;
--   UPDATE public.versao SET nome = '1.26.0' WHERE code = 1;
