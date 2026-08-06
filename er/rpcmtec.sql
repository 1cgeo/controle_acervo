BEGIN;

-- Relatório de Prestação de Contas Mensal Técnico: a edição mensal.
--
-- Dado da DIVISÃO, e não de um módulo. O RPCMTec não é artefato orçamentário: a
-- mesma edição fala de acervo, mapoteca e orçamento, e o chefe assina uma só.
-- Dentro do orçamento, quem só tem perfil na mapoteca não alcançaria a edição do
-- próprio relatório. Mesmo critério de `pit.meta` e de `limites`: dado de que
-- nenhum módulo é dono mora fora deles.
--
-- O QUE ELA GUARDA é o metadado da edição (ano, mês, quem assina, quando
-- assinou) e o ESTADO dela: aberta ou fechada. O conteúdo do relatório vive em
-- `rpcmtec.subsecao`, e a regra que rege os dois é a ASSINATURA:
--
--   ABERTA   (data_fechamento IS NULL)  o calculado recalcula a cada abertura,
--                                       e só o digitado persiste;
--   FECHADA                             tudo congela, inclusive o calculado.
--
-- O CONGELAMENTO SÓ ACONTECE NO FECHAMENTO, e nunca antes: gravada cedo, a
-- edição envelhece em silêncio no primeiro pedido corrigido. Antes do
-- fechamento o banco manda; depois dele manda o que foi assinado. Sem congelar,
-- uma edição antiga regerada hoje mostraria um número que ninguém leu.
--
-- `capacitacao` NÃO CONTRADIZ O PARÁGRAFO ACIMA, e a diferença é a que separa
-- entrada de saída. Ela não é recalculável: ninguém a deriva do banco, alguém a
-- DIGITA. Reconsultar não recupera nada, porque não há de onde. É a matéria
-- prima das subseções 2.6 e 6.2, e mora aqui porque não existe por outra razão
-- que não o relatório.
--
-- NÃO EXISTE `aproveitamento_mes` aqui: retrato mensal mede a coisa errada, e o
-- aproveitamento é `dgeo.efetivo_periodo` mais `dgeo.impedimento`. A razão está
-- escrita em er/dgeo.sql.
--
-- PERMISSÃO. Ler e gerar é de quem administra: o RPCMTec cruza os três módulos,
-- inclusive valor de crédito e de empenho, e liberá-lo por perfil de um módulo
-- entregaria o orçamento a quem só tem acervo.

CREATE SCHEMA rpcmtec;

COMMENT ON SCHEMA rpcmtec IS
    'Relatório de Prestação de Contas Mensal Técnico: a edição mensal da Divisão. Cruza acervo, mapoteca e orçamento, e nenhum dos três é dono.';

-- UNIQUE (ano, mes): existe UMA edição por mês. Duas seriam duas verdades sobre
-- o mesmo mês, e nada diria qual foi a assinada.
-- O ASSINANTE é `dgeo.usuario`, e não texto. O bloco de assinatura do PDF
-- ("FELIPE DE CARVALHO DINIZ - Major") sai do cadastro, e não de um nome
-- redigitado a cada edição.
--
-- `data_fechamento` é INSTANTE e `data_assinatura` é DIA, de propósito: fechar
-- é um ato do sistema, e duas edições fechadas no mesmo dia têm ordem; a data
-- que o documento carrega é o dia.
CREATE TABLE rpcmtec.edicao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  assinante_uuid UUID REFERENCES dgeo.usuario (uuid),
  data_assinatura DATE,
  data_fechamento TIMESTAMP WITH TIME ZONE,
  usuario_fechamento_uuid UUID REFERENCES dgeo.usuario (uuid),
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_edicao_ano_mes UNIQUE (ano, mes)
);

COMMENT ON TABLE rpcmtec.edicao IS
    'A edição mensal do RPCMTec: quem assina, quando, e se está aberta ou fechada. O conteúdo vive em rpcmtec.subsecao.';

COMMENT ON COLUMN rpcmtec.edicao.data_fechamento IS
    'Nula é edição ABERTA (o calculado recalcula). Preenchida é FECHADA (tudo congelado em rpcmtec.subsecao).';

CREATE INDEX idx_edicao_ano ON rpcmtec.edicao (ano);

-- ---------------------------------------------------------------------------
-- rpcmtec.subsecao: a espinha do relatório
-- ---------------------------------------------------------------------------

-- UMA linha por bloco de uma edição. Enquanto a edição está aberta só existe
-- linha para o que foi digitado; no fechamento, TODOS os blocos materializam.
--
-- A AUSÊNCIA de linha para uma subseção digitada É informação: quer dizer que
-- ninguém a visitou, e é o que o fechamento recusa. Vazio POR DECISÃO se marca
-- em `sem_ocorrencia`, e imprime o '-' que o modelo usa. Sem essa distinção,
-- "não houve" e "ninguém preencheu" saem iguais no documento.
--
-- POR QUE A LINHA REPETE `titulo`, `secao_titulo`, `cabecalhos` e `ordem`, que
-- a estrutura do documento já sabe: porque a estrutura MUDA. Entre janeiro e
-- julho de 2026 o RPCMTec passou de seis para nove seções, e toda a numeração
-- anterior mudou de lugar. Guardando isso, a edição fechada se desenha sozinha,
-- com a estrutura que ela teve, e não com a de hoje.
CREATE TABLE rpcmtec.subsecao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  edicao_id BIGINT NOT NULL REFERENCES rpcmtec.edicao (id) ON DELETE CASCADE,
  -- '2.1', '9.3'. VARCHAR porque é rótulo do documento, não número: '2.10'
  -- viria depois de '2.9' na leitura humana e antes na numérica.
  numero VARCHAR(10) NOT NULL,
  ordem SMALLINT NOT NULL,
  secao_titulo VARCHAR(255) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  origem_id SMALLINT NOT NULL REFERENCES dominio.origem_subsecao (code),
  -- Tabela: `cabecalhos` e `linhas`. Prosa: `texto`. Nunca os dois.
  cabecalhos JSONB,
  linhas JSONB,
  texto TEXT,
  sem_ocorrencia BOOLEAN NOT NULL DEFAULT FALSE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_subsecao_por_edicao UNIQUE (edicao_id, numero),
  -- Com cabeçalho é tabela, e tabela não tem prosa. Sem cabeçalho é prosa, e
  -- prosa não tem linhas.
  CONSTRAINT tabela_ou_texto CHECK (
    (cabecalhos IS NOT NULL AND texto IS NULL) OR
    (cabecalhos IS NULL AND linhas IS NULL)
  ),
  -- "Sem ocorrência" com conteúdo dentro seriam duas respostas para a mesma
  -- pergunta, e o desenhador teria de escolher uma calado.
  CONSTRAINT sem_ocorrencia_sem_conteudo CHECK (
    NOT sem_ocorrencia OR
    (COALESCE(jsonb_array_length(linhas), 0) = 0 AND texto IS NULL)
  )
);

COMMENT ON TABLE rpcmtec.subsecao IS
    'Um bloco de uma edição do RPCMTec. Enquanto a edição está aberta guarda só o digitado; no fechamento congela o documento inteiro, inclusive o calculado.';

COMMENT ON COLUMN rpcmtec.subsecao.linhas IS
    'A célula já em TEXTO, como vai impressa. Congela-se o que o documento disse, não o dado normalizado.';

CREATE INDEX idx_subsecao_edicao ON rpcmtec.subsecao (edicao_id);

-- ---------------------------------------------------------------------------
-- rpcmtec.anexo_edicao: o PDF assinado
-- ---------------------------------------------------------------------------

-- Mesma forma de `pit.anexo_revisao` e de `mapoteca.anexo_pedido`: os bytes
-- vivem na linha. É o documento ASSINADO que volta para cá, e ele é a fonte
-- primária da edição: o congelado tem de dizer o que ele diz.
--
-- SEM domínio de tipo, ao contrário do anexo da revisão do PIT. Aqui só entra
-- uma coisa, o relatório assinado. Mais de uma linha atende retificação, e a
-- mais recente é a que vale.
CREATE TABLE rpcmtec.anexo_edicao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  edicao_id BIGINT NOT NULL REFERENCES rpcmtec.edicao (id) ON DELETE CASCADE,
  nome_original VARCHAR(255) NOT NULL,
  extensao VARCHAR(20) NOT NULL,
  mimetype VARCHAR(150),
  tamanho_bytes BIGINT,
  conteudo BYTEA NOT NULL,
  descricao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE rpcmtec.anexo_edicao IS
    'O RPCMTec assinado, em PDF. Fonte primária da edição: o congelado tem de dizer o que ele diz.';

CREATE INDEX idx_anexo_edicao_edicao ON rpcmtec.anexo_edicao (edicao_id);

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
-- calendário, e é o padrão da casa: com timestamp, o Joi
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
  -- Item do PIT que esta capacitação cumpre (a 5.1, e não a Meta 5). Quando o
  -- item declara origem Capacitação, é daqui que sai o número da grade: Prevista e Em
  -- execução alimentam o planejado, Concluída alimenta o realizado, e o mês vem
  -- de `data_fim`. Cancelada não entra em nenhum dos dois.
  --
  -- ANULÁVEL, e a maioria fica nula. Em 2026 o PIT só promete capacitação
  -- MINISTRADA (a meta 5): as Recebidas (pós-graduação, curso de SARP, ISO 9001)
  -- não têm meta que as prometa, e forçar uma inventaria compromisso.
  meta_pit_id BIGINT REFERENCES pit.meta_item (id),
  -- O MES EM QUE ESTA CAPACITACAO PROMETE TERMINAR, e de onde sai o PLANEJADO
  -- do PIT.
  --
  -- COLUNA PROPRIA, e nao `data_fim`. Enquanto os dois numeros saiam da mesma
  -- data, concluir com atraso MOVIA o mes que a capacitacao havia planejado: o
  -- plano seguia o fato, que e o contrario do que um plano faz.
  --
  -- ANULAVEL: capacitacao que nao cumpre meta nao promete mes. Na que cumpre, a
  -- ausencia e erro de cadastro do PIT, e GET /pit/execucao/diagnostico acusa.
  data_prevista DATE,
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

-- Quem da DIVISÃO participou da capacitação, ligado ao cadastro. Texto livre
-- não casa com pessoa: "Cap Fulano" e "Fulano" são a mesma pessoa e duas
-- strings, e nenhuma das duas responde "de quais capacitações o Fulano
-- participou".
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
