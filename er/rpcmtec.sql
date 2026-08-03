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
-- `capacitacao` NÃO CONTRADIZ O PARÁGRAFO ACIMA, e a diferença é a que separa
-- entrada de saída. Ela não é recalculável: ninguém a deriva do banco, alguém a
-- DIGITA. Reconsultar não recupera nada, porque não há de onde. É a matéria
-- prima das subseções 2.6 e 6.2, e mora aqui porque não existe por outra razão
-- que não o relatório.
--
-- `aproveitamento_mes` morou aqui por algumas horas em 2026-08-02 e saiu no
-- mesmo dia: ela media a coisa errada, e virou `dgeo.efetivo_periodo` mais
-- `dgeo.impedimento`. A razão está escrita em er/dgeo.sql.
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

-- Capacitação: MINISTRADA alimenta a 2.6 e RECEBIDA alimenta a 6.2.
--
-- UMA tabela para as duas, com `tipo_id` separando, porque a linha é o mesmo
-- fato visto dos dois lados: um curso tem nome, instituição, local e período em
-- qualquer dos casos. O que muda são três colunas, e elas são anuláveis por
-- isso: `efetivo_capacitado` só faz sentido na ministrada (quantos de fora nós
-- treinamos) e `plano_codigo` só na recebida (sob que Plano/Código, ex.:
-- 'C25/DCT003 PCE-EECN'). Duas tabelas com dez colunas iguais divergiriam na
-- primeira que fosse acrescentada a uma só.
--
-- QUEM da Divisão participou sai de `rpcmtec.capacitacao_militar`, e não de um
-- texto: ver o comentário dela, abaixo.
--
-- O ANO é coluna, e não derivado de `data_inicio`: capacitação PREVISTA para o
-- ano ainda não tem data, e é justamente ela que precisa aparecer na lista do
-- ano.
--
-- DATA, e não TIMESTAMP como no SAP. Início e fim de curso são dia de
-- calendário, e é o padrão da casa desde 2026-08-01: com timestamp, o Joi
-- converteria 'AAAA-MM-DD' em meia-noite UTC e a coluna guardaria 21:00 do dia
-- anterior em UTC-3.
CREATE TABLE rpcmtec.capacitacao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  nome VARCHAR(255) NOT NULL,
  tipo_id SMALLINT NOT NULL REFERENCES dominio.tipo_capacitacao (code),
  situacao_id SMALLINT NOT NULL REFERENCES dominio.situacao_capacitacao (code),
  instituicoes TEXT,
  -- `local` é palavra do SQL e sobrevive como nome de coluna, mas obriga quem
  -- lê a parar para conferir. O nome inteiro custa nada.
  local_realizacao VARCHAR(255),
  data_inicio DATE,
  data_fim DATE,
  efetivo_capacitado INTEGER CHECK (efetivo_capacitado IS NULL OR efetivo_capacitado >= 0),
  plano_codigo VARCHAR(255),
  documento VARCHAR(255),
  -- Meta do PIT que esta capacitação cumpre (2026-08-03). Quando a meta declara
  -- origem Capacitação, é daqui que sai o número da grade: Prevista e Em
  -- execução alimentam o planejado, Concluída alimenta o realizado, e o mês vem
  -- de `data_fim`. Cancelada não entra em nenhum dos dois.
  --
  -- ANULÁVEL, e a maioria fica nula. Em 2026 o PIT só promete capacitação
  -- MINISTRADA (a meta 5): as Recebidas (pós-graduação, curso de SARP, ISO 9001)
  -- não têm meta que as prometa, e forçar uma inventaria compromisso.
  meta_pit_id BIGINT REFERENCES pit.meta (id),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);

COMMENT ON TABLE rpcmtec.capacitacao IS
    'Capacitação ministrada (2.6 do RPCMTec) ou recebida (6.2). O tipo decide quais colunas a linha preenche.';

CREATE INDEX idx_capacitacao_ano ON rpcmtec.capacitacao (ano);
CREATE INDEX idx_capacitacao_meta_pit ON rpcmtec.capacitacao (meta_pit_id);

-- Quem da DIVISÃO participou da capacitação, ligado ao cadastro (chefe,
-- 2026-08-02). Era um `militares TEXT` até então, e texto livre não casa com
-- pessoa: "Cap Fulano" e "Fulano" são a mesma pessoa e duas strings, e nenhuma
-- das duas responde "de quais capacitações o Fulano participou".
--
-- O PAPEL NÃO É COLUNA: ele vem do `tipo_id` da capacitação. Na MINISTRADA quem
-- está aqui é instrutor ou monitor (nós ensinamos); na RECEBIDA é quem foi
-- capacitado (nós aprendemos). Uma coluna de papel seria a mesma informação
-- gravada duas vezes, e nada impediria as duas de divergirem.
--
-- `efetivo_capacitado` continua existindo e NÃO se confunde com esta tabela: lá
-- é a contagem de gente DE FORA que nós treinamos, e aqui é gente NOSSA. Numa
-- capacitação ministrada as duas coisas coexistem, e o relatório pede as duas.
--
-- ON DELETE CASCADE: vínculo sem capacitação não é histórico de nada. É a mesma
-- razão do `dgeo.usuario_perfil`.
CREATE TABLE rpcmtec.capacitacao_militar(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  capacitacao_id BIGINT NOT NULL REFERENCES rpcmtec.capacitacao (id) ON DELETE CASCADE,
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  UNIQUE (capacitacao_id, usuario_uuid)
);

COMMENT ON TABLE rpcmtec.capacitacao_militar IS
    'Quem da Divisão participou da capacitação. O papel vem do tipo dela: instrutor na ministrada, capacitado na recebida.';

CREATE INDEX idx_capacitacao_militar_usuario
    ON rpcmtec.capacitacao_militar (usuario_uuid);

COMMIT;
