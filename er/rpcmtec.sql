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
-- AS DUAS TABELAS DE 2026-08-02 NÃO CONTRADIZEM O PARÁGRAFO ACIMA, e a
-- diferença é a que separa entrada de saída. `aproveitamento_mes` e
-- `capacitacao` não são recalculáveis: ninguém as deriva do banco, alguém as
-- DIGITA. Reconsultar não recupera nada, porque não há de onde. São a matéria
-- prima das subseções 2.6, 6.1 e 6.2, e moram aqui porque não existem por outra
-- razão que não o relatório. Se um dia alguém as consultar fora dele, é sinal de
-- que mudaram de natureza e devem mudar de casa.
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

-- Aproveitamento do efetivo: a subseção 6.1 ("Militar | Atividades").
--
-- É um RETRATO MENSAL CONGELADO, e é essa a razão de a tabela existir em vez de
-- a 6.1 sair de `dgeo.usuario` na hora. Guarda-se o posto DA ÉPOCA, porque a
-- edição de março não pode mudar quando alguém for promovido em julho, e o
-- efetivo de março não pode encolher quando alguém for transferido. Lendo o
-- cadastro de hoje, toda edição antiga se reescreveria sozinha a cada mudança
-- de gente, e ninguém veria acontecer.
--
-- `usuario_uuid`, e não `usuario_id`. O SAP usa o serial; aqui a convenção de
-- tabela nova é o UUID (a mesma do acervo e do orçamento), e é ele que as
-- dezenas de tabelas dos três módulos referenciam. O preço é conhecido e
-- aceito: mais uma tabela apontando `dgeo.usuario`, ou seja, mais uma razão
-- para excluir usuário falhar. Quem já trabalhou aqui se DESATIVA, e desativar
-- não apaga o retrato dos meses em que a pessoa esteve.
--
-- `atividades` é TEXTO LIVRE, e vazio é resposta: quem só produziu no mês não
-- tem encargo a declarar, e a coluna sai em branco no documento.
CREATE TABLE rpcmtec.aproveitamento_mes(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  tipo_posto_grad_id SMALLINT NOT NULL REFERENCES dominio.tipo_posto_grad (code),
  atividades TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (ano, mes, usuario_uuid)
);

COMMENT ON TABLE rpcmtec.aproveitamento_mes IS
    'Retrato mensal do efetivo (6.1 do RPCMTec): uma linha por pessoa por mês, com o posto da época. Congelado de propósito, para a edição assinada não mudar depois.';

CREATE INDEX idx_aproveitamento_ano_mes ON rpcmtec.aproveitamento_mes (ano, mes);

-- Capacitação: MINISTRADA alimenta a 2.6 e RECEBIDA alimenta a 6.2.
--
-- UMA tabela para as duas, com `tipo_id` separando, porque a linha é o mesmo
-- fato visto dos dois lados: um curso tem nome, instituição, local e período em
-- qualquer dos casos. O que muda são três colunas, e elas são anuláveis por
-- isso: `efetivo_capacitado` só faz sentido na ministrada (quantos de fora nós
-- treinamos), `militares` e `plano_codigo` só na recebida (quem foi, e sob que
-- Plano/Código, ex.: 'C25/DCT003 PCE-EECN'). Duas tabelas com dez colunas
-- iguais divergiriam na primeira que fosse acrescentada a uma só.
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
  militares TEXT,
  plano_codigo VARCHAR(255),
  documento VARCHAR(255),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);

COMMENT ON TABLE rpcmtec.capacitacao IS
    'Capacitação ministrada (2.6 do RPCMTec) ou recebida (6.2). O tipo decide quais colunas a linha preenche.';

CREATE INDEX idx_capacitacao_ano ON rpcmtec.capacitacao (ano);

COMMIT;
