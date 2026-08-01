BEGIN;

-- Relatório de Prestação de Contas Mensal Técnico: a edição mensal.
--
-- Dado da DIVISÃO, e não de um módulo. A tabela nasceu em `orcamento` porque o
-- primeiro consumidor foi a seção do PDR, mas o RPCMTec não é artefato
-- orçamentário: a mesma edição fala de acervo, mapoteca e orçamento, e o chefe
-- assina uma só. Enquanto morava lá, quem só tinha perfil na mapoteca não
-- alcançava a edição do próprio relatório. Mudou de casa em 2026-08-01, pelo
-- mesmo critério que tirou `pit.meta` do orçamento em 2026-07-31 e `limites` do
-- acervo em 2026-07-29: dado de que nenhum módulo é dono mora fora deles.
--
-- O QUE ELA GUARDA é só o METADADO da edição: o ano, o mês, quem assina e a
-- data da assinatura. As tabelas do relatório NÃO são gravadas aqui: elas são
-- consultas, recortadas por ano e mês, e recalculá-las é o que mantém o RPCMTec
-- coerente com o banco. Uma edição gravada envelheceria em silêncio no primeiro
-- pedido corrigido depois de fechada.
--
-- PERMISSÃO. Ler e gerar é de quem administra: o RPCMTec cruza os três módulos,
-- inclusive valor de crédito e de empenho, e liberá-lo por perfil de um módulo
-- entregaria o orçamento a quem só tem acervo.

CREATE SCHEMA rpcmtec;

COMMENT ON SCHEMA rpcmtec IS
    'Relatório de Prestação de Contas Mensal Técnico: a edição mensal da Divisão. Cruza acervo, mapoteca e orçamento, e nenhum dos três é dono.';

-- UNIQUE (ano, mes): existe UMA edição por mês. Duas seriam duas verdades sobre
-- o mesmo mês, e nada diria qual foi a assinada.
CREATE TABLE rpcmtec.edicao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  assinante VARCHAR(255),
  data_assinatura DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_edicao_ano_mes UNIQUE (ano, mes)
);

COMMENT ON TABLE rpcmtec.edicao IS
    'Metadado da edição mensal do RPCMTec (quem assina, quando). As tabelas do relatório são consultas recortadas por ano e mês, nunca gravadas.';

CREATE INDEX idx_edicao_ano ON rpcmtec.edicao (ano);

COMMIT;
