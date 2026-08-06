-- A `orcamento.configuracao` sai inteira: ela nao guardava nada que alguem lesse.
--
-- O QUE ELA TINHA. Duas colunas de negocio, `uasg` (o codigo SIAFI da propria
-- unidade) e `codom` (o Codigo de Organizacao Militar), mais o proprio carimbo
-- de alteracao. Um `ano_referencia` ja havia ficado orfao na migracao de
-- 2026-08-04.
--
-- POR QUE ELAS EXISTIAM, e a resposta explica a poda. Elas vieram do sistema de
-- orcamento absorvido em 2026-07-27. La eram atributo da tabela `exercicio` e
-- chave de agrupamento do `pca`, com a cardinalidade "1 ano : 1 pca por UASG".
-- O commit que apagou aquelas duas entidades REALOCOU as colunas para esta
-- tabela e nao realocou consumidor nenhum, porque nao havia. O `codom` nunca
-- teve leitor, em nenhum dos dois sistemas.
--
-- MEDIDO EM PRODUCAO EM 2026-08-06, e o ponto e que elas NAO estao vazias:
--
--   uasg  = '160382'   (o 1º CGEO, e o valor esta correto)
--   codom = '048215'   (idem)
--   escritas uma vez, em 15/06, pelo usuario de carga
--
-- Elas estao PREENCHIDAS E SEM LEITOR, que e diferente de vazias. O unico codigo
-- que as le e `controller.get`, e o unico chamador dele e a propria tela de
-- configuracao. Nao ha terceiro consumidor:
--
--   0 views, 0 funcoes e 0 chaves estrangeiras apontando para a tabela;
--   0 eventos em `auditoria.evento`, contra 4.994 no total (ninguem abriu a
--     tela para salvar desde a fusao);
--   0 ocorrencias nos dois modelos ODS, conferido no XML interno deles;
--   0 nos CLIs e nos plugins QGIS.
--
-- O RPCMTec, unico documento oficial que o sistema gera, identifica a OM por
-- TEXTO FIXO no gerador do PDF, e nao por CODOM.
--
-- NAO CONFUNDIR COM `dominio.ug`, que fica. Aquela lista as unidades gestoras e
-- alimenta `nota_credito.ug_emitente`, que e quem EMITE o credito para nos.
-- Medido: das 95 notas, o emitente e 160035 (DCT) em 31, 167035 em 10, 160507
-- em 3, e nulo em 51. O 160382 NUNCA aparece como emitente, e e coerente: o
-- credito vem de fora. `dominio.ug` decide alguma coisa, por chave estrangeira
-- e indice unico; a `configuracao.uasg` nao decidia nada.
--
-- A ROTA `/api/orcamento/configuracao/anos` NAO DEPENDE DESTA TABELA e FICA. Ela
-- le o `ano` das tabelas de negocio e alimenta o seletor de ano de TODAS as
-- telas do modulo. Some a tabela, fica o caminho com o nome dela.
--
-- Idempotente: DROP TABLE IF EXISTS.

BEGIN;

DROP TABLE IF EXISTS orcamento.configuracao;

UPDATE public.versao SET nome = '1.34.0' WHERE code = 1;

COMMIT;

-- Para desfazer (a linha unica nao volta, e nenhum dado de negocio se perde):
--   CREATE TABLE orcamento.configuracao(
--     id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1,
--     uasg VARCHAR(10),
--     codom VARCHAR(10),
--     data_modificacao TIMESTAMP WITH TIME ZONE,
--     usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
--     CONSTRAINT configuracao_singleton CHECK (id = 1)
--   );
--   INSERT INTO orcamento.configuracao (id, uasg, codom) VALUES (1, '160382', '048215');
--   UPDATE public.versao SET nome = '1.33.0' WHERE code = 1;
