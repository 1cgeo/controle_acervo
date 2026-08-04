-- Migração 2026-08-04: a licitação ganha identificação, fase de domínio e anexo.
--
-- A tela de licitações guardava sete campos e nenhum deles IDENTIFICA o
-- processo. O chefe acompanha as licitações pelo número do pregão e pelo NUP, e
-- hoje precisa sair do sistema para achar qualquer uma delas. Quatro colunas
-- fecham essa lacuna, todas anuláveis: os registros existentes não têm esses
-- dados, e exigi-los agora reprovaria o cadastro que já está lá.
--
-- A FASE VIRA DOMÍNIO, E O TEXTO LIVRE FICA. `fase_atual` guarda o que o gestor
-- escreveu, e um dos registros reais tem 103 caracteres:
--
--   "Homologado. Vencedor não entregou os softwares licitados, o que implica
--    que o pregão se tornou fracassado"
--
-- Isso não é uma fase, é a história do processo. Converter esse texto em código
-- perderia a explicação, e é ela que responde por que o empenho foi anulado.
-- Por isso a migração NÃO apaga nada: `fase_id` classifica, `fase_atual`
-- narra. Quem classificar os registros antigos é o gestor, um a um, na tela.
--
-- Os valores do domínio saem do texto REAL das subseções 3.4 e 3.5 do RPCMTec
-- de 2025 e de 2026, que é a fonte de onde os registros foram carregados. Ver a
-- lista comentada no bloco 2.
--
-- O ANEXO PASSA A ACEITAR CINCO DONOS. O CHECK `arquivo_um_vinculo` só admitia
-- NC, DFD e PDR, então não havia onde guardar o edital da licitação nem o
-- demonstrativo do SIAFI do RPNP. A regra de UM vínculo só permanece: o que
-- muda é de quantos donos possíveis se escolhe um.
--
-- Aplicar com: psql --single-transaction -v ON_ERROR_STOP=1 -f <este arquivo>
-- Idempotente: reaplicar não muda nada (IF NOT EXISTS em toda coluna e o INSERT
-- do domínio tem ON CONFLICT).
--
-- LEIA A SEÇÃO 5, no fim. Ela tem um DROP que NÃO roda por padrão.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Identificação e desfecho da licitação
-- ---------------------------------------------------------------------------

-- numero_pregao: o rótulo do pregão ("90012/2026"), não o NUP. VARCHAR(20)
--   acomoda o número com o ano e o prefixo da UASG.
-- nup: Número Único de Protocolo, no formato '64286.011195/2026-94' (21
--   caracteres). VARCHAR(25) deixa folga para variação de máscara.
-- fornecedor: a empresa vencedora. Fica nulo enquanto não há vencedor, e é
--   assim que se lê licitação fracassada ou deserta.
-- data_homologacao: o dia da homologação. Emparelha com valor_final_homologado,
--   que já existia sozinho e não dizia QUANDO.
ALTER TABLE orcamento.licitacao
  ADD COLUMN IF NOT EXISTS numero_pregao VARCHAR(20),
  ADD COLUMN IF NOT EXISTS nup VARCHAR(25),
  ADD COLUMN IF NOT EXISTS fornecedor VARCHAR(255),
  ADD COLUMN IF NOT EXISTS data_homologacao DATE;

COMMENT ON COLUMN orcamento.licitacao.numero_pregao IS
    'Número do pregão. Identifica o processo para quem o acompanha fora do SCA.';

COMMENT ON COLUMN orcamento.licitacao.nup IS
    'Número Único de Protocolo do processo administrativo.';

COMMENT ON COLUMN orcamento.licitacao.fornecedor IS
    'Empresa vencedora. Nulo enquanto não há vencedor (fracassado, deserto ou em curso).';

COMMENT ON COLUMN orcamento.licitacao.data_homologacao IS
    'Dia da homologação. Par de valor_final_homologado, que sozinho não dizia quando.';

-- ---------------------------------------------------------------------------
-- 2. Domínio da fase, no padrão de dominio.tipo_licitacao
-- ---------------------------------------------------------------------------

-- De onde vem cada valor (fonte primária: RPCMTec, subseções 3.4 e 3.5):
--   1 Previsto      - o texto da maioria das linhas de 2026.
--   2 Em elaboração - MBA e ar condicionados, de fevereiro de 2026 em diante.
--   3 Homologado    - imagens satelitais, softwares, insumos, equipamentos, MBA,
--                     IA e acessórios de drone, em 2025 e 2026.
--   4 Fracassado    - softwares de TI de 2025, no texto de 103 caracteres.
--   5 Deserto       - pregão sem proponente. Ocorreu em 2025 (workstations),
--                     e o registro dessa vez ficou fora da tabela da licitação.
--   6 Anulado       - processo anulado antes do desfecho.
--
-- A lista é CURTA de propósito. Fase intermediária de tramitação ("na SALC",
-- "na AGU") não aparece em registro nenhum da tabela, e inventá-la aqui criaria
-- código que ninguém usa. Acrescente quando o gestor pedir.
CREATE TABLE IF NOT EXISTS dominio.fase_licitacao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL
);

-- Os valores saem do que a TABELA guarda hoje, e não da prosa do RPCMTec. Os
-- 11 registros de orcamento.licitacao têm quatro `fase_atual` distintos, e é
-- deles que estes quatro códigos vêm:
--   'Previsto'                          -> 1
--   'Homologado'                        -> 3
--   'Homologado. Vencedor não entregou os softwares licitados, o que implica
--    que o pregão se tornou fracassado' -> 4 (a narrativa fica em fase_atual)
--   'Renovando o contrato vigente'      -> 5
-- O código 2 fica reservado para a fase que antecede a homologação, e o chefe
-- nomeia quando aparecer o primeiro caso. Não invente fase que nenhum registro
-- exibe: domínio grande e vazio convida a classificar errado.
INSERT INTO dominio.fase_licitacao (code, nome) VALUES
(1, 'Previsto'),
(3, 'Homologado'),
(4, 'Fracassado'),
(5, 'Renovando contrato vigente')
ON CONFLICT (code) DO NOTHING;

-- `fase_id` classifica e `fase_atual` narra. Os dois convivem por decisão, e
-- nenhum backfill automático roda aqui: o texto real não se converte sozinho.
ALTER TABLE orcamento.licitacao
  ADD COLUMN IF NOT EXISTS fase_id SMALLINT REFERENCES dominio.fase_licitacao (code);

COMMENT ON COLUMN orcamento.licitacao.fase_id IS
    'Fase do domínio, para filtrar e agrupar. Não substitui fase_atual, que guarda a história do processo em texto livre.';

-- ---------------------------------------------------------------------------
-- 3. O anexo passa a aceitar licitação e RPNP
-- ---------------------------------------------------------------------------

-- ON DELETE CASCADE segue o que NC e DFD já fazem: apagar o dono apaga o anexo,
-- que sem ele não tem a quem pertencer.
ALTER TABLE orcamento.arquivo
  ADD COLUMN IF NOT EXISTS licitacao_id BIGINT REFERENCES orcamento.licitacao (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS rpnp_id BIGINT REFERENCES orcamento.rpnp (id) ON DELETE CASCADE;

-- A regra continua sendo UM vínculo. Só o número de donos possíveis muda.
ALTER TABLE orcamento.arquivo DROP CONSTRAINT IF EXISTS arquivo_um_vinculo;

ALTER TABLE orcamento.arquivo ADD CONSTRAINT arquivo_um_vinculo CHECK (
  (nota_credito_id IS NOT NULL)::int +
  (dfd_id IS NOT NULL)::int +
  (pdr_ano IS NOT NULL)::int +
  (licitacao_id IS NOT NULL)::int +
  (rpnp_id IS NOT NULL)::int = 1
);

-- Sem índice ÚNICO, ao contrário de NC e DFD. Uma licitação junta edital, ata e
-- termo de homologação, e o RPNP junta um demonstrativo do SIAFI por consulta.
-- Limitar a um anexo obrigaria a escolher qual documento guardar.
CREATE INDEX IF NOT EXISTS idx_arquivo_licitacao ON orcamento.arquivo (licitacao_id);
CREATE INDEX IF NOT EXISTS idx_arquivo_rpnp ON orcamento.arquivo (rpnp_id);

-- ---------------------------------------------------------------------------
-- 4. Versão do banco
-- ---------------------------------------------------------------------------
UPDATE public.versao SET nome = '1.25.0' WHERE code = 1;

COMMIT;

-- ###########################################################################
-- 5. SEÇÃO SEPARADA: o ano de referência da configuração acaba
-- ###########################################################################
--
-- NÃO RODA POR PADRÃO. Descomente as duas linhas abaixo para aplicar.
--
-- O seletor de ano da navbar acabou (decisão do chefe, 2026-08-04). Cada tela
-- passa a ter o seu, começa sempre no ano atual e não guarda nada. Com isso
-- `orcamento.configuracao.ano_referencia` perde a razão de existir: ela era o
-- ano PADRÃO das telas, e não há mais padrão a configurar.
--
-- O DROP fica separado porque apagar coluna perde dado e não se desfaz. O
-- código do orçamento já para de ler e de gravar essa coluna na mesma rodada,
-- então a coluna sobrevivente não faz mal nenhum. Aplique quando quiser.
--
-- CUIDADO: não é a mesma coluna de `orcamento.recebimento_material`. Aquela
-- diz em que RPCMTec o material recebido consta, alimenta a subseção 4.6 e
-- PERMANECE.
--
-- BEGIN;
-- ALTER TABLE orcamento.configuracao DROP COLUMN IF EXISTS ano_referencia;
-- COMMIT;

-- Para desfazer a migração (as seções 1 a 4):
--   ALTER TABLE orcamento.arquivo DROP CONSTRAINT arquivo_um_vinculo;
--   ALTER TABLE orcamento.arquivo ADD CONSTRAINT arquivo_um_vinculo CHECK (
--     (nota_credito_id IS NOT NULL)::int + (dfd_id IS NOT NULL)::int +
--     (pdr_ano IS NOT NULL)::int = 1);
--   DROP INDEX orcamento.idx_arquivo_licitacao, orcamento.idx_arquivo_rpnp;
--   ALTER TABLE orcamento.arquivo DROP COLUMN licitacao_id, DROP COLUMN rpnp_id;
--   ALTER TABLE orcamento.licitacao DROP COLUMN fase_id, DROP COLUMN numero_pregao,
--     DROP COLUMN nup, DROP COLUMN fornecedor, DROP COLUMN data_homologacao;
--   DROP TABLE dominio.fase_licitacao;
--   UPDATE public.versao SET nome = '1.24.0' WHERE code = 1;
-- Desfazer o CHECK depois de guardar anexo de licitação ou de RPNP FALHA, e é
-- para falhar: a linha ficaria sem dono. Apague esses anexos antes.
