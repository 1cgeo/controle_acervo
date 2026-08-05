BEGIN;

-- Plano Interno de Trabalho (PIT): o plano anual da Divisão.
--
-- Dado de REFERÊNCIA, e não orçamento. A tabela nasceu em `orcamento` porque o
-- primeiro consumidor foi o PDR, mas o PIT não é artefato orçamentário: é o que
-- a Divisão se comprometeu a entregar no ano, e todo módulo tem trabalho que
-- atende uma meta dele. O orçamento amarra a NC e o item do PDR à meta que
-- financiam; a mapoteca amarra o pedido de impressão à meta que ele cumpre.
-- Nenhum dos dois é dono. Mesmo critério do schema `limites`.
--
-- Dentro de `orcamento`, a mapoteca não a alcançaria, e o pedido guardaria o
-- código da meta como texto livre: duas verdades sobre a mesma coisa, e o banco
-- sem cobrar nenhuma.
--
-- PERMISSÃO. Ler é de qualquer pessoa logada, porque todo módulo precisa
-- oferecer a lista. Escrever é do administrador global: o PIT muda uma vez por
-- ano e errar nele contamina os três módulos.
--
-- A META NÃO É SÓ UM RÓTULO: ela guarda o que o PIT promete (quantidade,
-- unidade, demandante, prazo), e ao lado dela vivem a execução mensal e a
-- demanda Extra-PIT. As três vieram do SAP porque nenhuma depende da produção:
-- são cadastro à
-- mão. Com elas o SCA passa a gerar a subseção 2.1 do RPCMTec, que até então
-- ficava de fora justamente por falta de quantidade prevista e de prazo.
--
-- Nada saiu do SAP: a fusão é por ADIÇÃO aqui, e
-- não por remoção lá. Enquanto os dois existirem há duas cópias vivas do mesmo
-- fato, e o que as impede de brigar não é o banco: é o SCA passar a ser quem
-- gera essas subseções do relatório.

CREATE SCHEMA pit;

COMMENT ON SCHEMA pit IS
    'Plano Interno de Trabalho: o plano anual da Divisão. Dado de referência que orçamento, mapoteca e acervo consomem, e do qual nenhum é dono.';

-- O ANO do PIT. Existe para o ano deixar de ser um SMALLINT solto
-- em quatro tabelas, e para o encerramento do exercício ser um ATO: em ano
-- Encerrado o servidor recusa lançamento, e hoje nada impede alguém corrigir
-- 2025 em 2027.
--
-- `rpcmtec.capacitacao.ano` NÃO aponta para cá, e foi medido: ela tem 2013,
-- 2018, 2019, 2022, 2023, 2024, 2025 e 2026, e o PIT só tem 2025 e 2026.
-- Capacitação existe fora do PIT, e o modelo continua dizendo isso.
CREATE TABLE pit.exercicio(
  ano SMALLINT NOT NULL PRIMARY KEY,
  situacao_id SMALLINT NOT NULL DEFAULT 2 REFERENCES dominio.situacao_exercicio (code),
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE pit.exercicio IS
    'O ano do PIT. Existe para o ano deixar de ser um SMALLINT solto e para o encerramento ser um ato.';

-- Meta do ano. `numero_meta` é a meta (1 a 7 em 2026) e `item` é o sub-item
-- quando ela se subdivide ('4.1'). A meta indivisa fica com `item` NULO. O '-'
-- que aparece na tela e no CLI é como eles IMPRIMEM o nulo, não o valor gravado.
--
-- A numeração NÃO é estável entre anos: o PIT é reescrito todo ano e a Meta 4 de
-- 2026 (impressão) pode ser outra coisa em 2027. Por isso `ano` entra na chave
-- única e todo consumidor guarda o `id`, nunca o código.
-- NÃO existe coluna de "nome da meta". No SAP ela é repetida em toda linha da
-- mesma meta; aqui a linha de cabeçalho (a de `item` nulo) JÁ é esse nome, e é
-- dela que a 2.1 tira o texto que abre o bloco. Duas colunas para a mesma frase
-- divergiriam na primeira correção de português.
CREATE TABLE pit.meta(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL REFERENCES pit.exercicio (ano),
  numero_meta SMALLINT NOT NULL,
  item VARCHAR(20),
  -- A DESCRIÇÃO, A QUANTIDADE, O PRAZO E O DEMANDANTE NÃO MORAM AQUI.
  -- Eles são o que a DSG DECLARA, e a DSG revisa o PIT durante a
  -- execução: o R0 de 2026 avisa que "o EM/DSG realizará a revisão do PIT nos
  -- meses de ABR e AGO 26". Os quatro vivem em `pit.meta_revisao`, uma linha
  -- por revisão que os mudou.
  --
  -- O QUE FICA AQUI é o que o SCA decide (unidade e origem) mais o que revisão
  -- nenhuma muda (ano, número, item). É por isso que o id é ESTÁVEL, e é nele
  -- que os seis vínculos de outros schemas se penduram.
  --
  -- O QUE A META CONTA. Domínio FECHADO: em texto livre viram treze valores
  -- para cinco coisas ('carta' e 'folha' para a mesma) e itens sem unidade
  -- nenhuma. A grade assume que uma versão do acervo vale UMA unidade da meta, e
  -- o domínio é quem declara isso.
  --
  -- ANULÁVEL só para a linha de cabeçalho: o que ela agrupa é que conta.
  unidade_id SMALLINT REFERENCES dominio.unidade_meta (code),
  -- DE ONDE VEM O NÚMERO desta meta. Manual é o lançamento à mão em
  -- `pit.execucao`, e é o padrão: toda meta nasce assim, inclusive as que já
  -- existiam. As outras três são calculadas na LEITURA, e a gravação nelas é
  -- recusada com 400.
  --
  -- A DIVISÃO É PERMANENTE, e não uma fase de transição. Das 42 folhas do PIT de
  -- 2026, no máximo 17 têm de onde calcular (as metas 1, 4 e 5). As metas 6
  -- (Programa Memória) e 7 (TI) são catalogação, digitalização e marco: não
  -- existe entidade no SCA para contar, e nunca vai existir só por causa disto.
  -- É por isso que a origem se declara na meta, em vez de ser adivinhada.
  --
  -- SÓ A FOLHA pode ser automática. A linha de cabeçalho de uma meta subdividida
  -- não recebe lançamento, e deixá-la calcular somaria o mesmo trabalho duas
  -- vezes, uma nos itens e outra nela. Quem cobra isso é o controlador: o CHECK
  -- não enxerga "tem item abaixo", que é outra linha desta mesma tabela.
  origem_id SMALLINT NOT NULL DEFAULT 1 REFERENCES dominio.origem_meta (code),
  -- NÃO HÁ `situacao_id`. Ela existiu por um dia, com quatro
  -- estados. Dos quatro, só 'Cancelada' era ato da DSG, e por isso virou
  -- `pit.meta_revisao.cancelada`; 'Em andamento' e 'Concluída' a grade calcula
  -- do que foi lançado, e status digitado ao lado de status calculado é a
  -- segunda verdade que este schema vem eliminando.
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (ano, numero_meta, item)
);

COMMENT ON TABLE pit.meta IS
    'Meta do PIT do ano. `item` guarda o sub-item quando a meta se subdivide (ex.: 4.1), e é NULO quando a meta é indivisa.';

CREATE INDEX idx_meta_ano ON pit.meta (ano);

-- ---------------------------------------------------------------------------
-- A REVISÃO do PIT, e a meta como cada uma a declara.
--
-- POR QUE ELA EXISTE. A DSG revisa o PIT durante a execução, e o próprio R0 de
-- 2026 avisa disso. Com uma linha por meta, a revisão ou SOBRESCREVIA a promessa
-- (e o relatório de março deixava de ser reproduzível) ou criava meta nova (e os
-- seis vínculos que apontam para `pit.meta` ficavam órfãos). Os dois estão
-- errados, e é o que motivou separar identidade de declaração.
--
-- ALTERAR O PIT É CANCELAR, ALTERAR E ADICIONAR META. Só
-- isso, e uma forma só cobre as três: adicionar é a primeira linha da meta em
-- `meta_revisao`; alterar é uma linha nova com o número novo; cancelar é uma
-- linha nova com `cancelada`. Nenhum caso especial, e nenhum DELETE.
--
-- NÃO HÁ RENUMERAÇÃO de item, e é por isso que `item` pode
-- ficar na identidade.
-- ---------------------------------------------------------------------------

CREATE TABLE pit.revisao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL REFERENCES pit.exercicio (ano),
  -- O código é o da DSG: 'R0' é o plano original e 'R1' a primeira revisão.
  codigo VARCHAR(20) NOT NULL,
  -- A data do fecho do documento, que NÃO é a da assinatura digital: o R1 de
  -- 2026 traz "Brasília-DF, 11 de maio de 2026" e o Diretor assinou em 14/05.
  data_documento DATE,
  data_assinatura DATE,
  assinante VARCHAR(255),
  -- A PARTIR DE QUANDO ESTA REVISÃO MANDA. Nulo é RASCUNHO: a revisão está
  -- cadastrada, o arquivo anexado, e ela ainda não rege nada. Publicar é
  -- preencher esta data.
  --
  -- Substitui com vantagem um enum Recebida/Vigente/Superada: "superada" se
  -- deduz de existir outra depois, e a janela entre receber a revisão e passar a
  -- executá-la vira o que ela é, uma data futura.
  data_vigencia DATE,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_revisao_por_ano UNIQUE (ano, codigo)
);

COMMENT ON TABLE pit.revisao IS
    'Uma versão assinada do PIT do ano (R0, R1, R2). O arquivo dela vive em pit.anexo_revisao, e data_vigencia nula significa rascunho.';

-- UM RASCUNHO POR ANO. Com duas revisões abertas ao mesmo tempo, a alteração de
-- uma meta cairia na errada sem ninguém perceber.
CREATE UNIQUE INDEX unique_rascunho_por_ano
  ON pit.revisao (ano) WHERE data_vigencia IS NULL;

CREATE INDEX idx_revisao_ano ON pit.revisao (ano);

CREATE TABLE pit.tipo_anexo_revisao(
  code SMALLINT NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO pit.tipo_anexo_revisao (code, nome) VALUES
(1, 'PIT assinado'),
(2, 'PIT de impressão'),
(3, 'Documento de encaminhamento (DIEx/Ofício)'),
(4, 'Outros');

-- Mesma forma de `mapoteca.anexo_pedido`, que guarda o conteúdo na própria
-- linha, sem volume e sem checksum. Já provado em 255 anexos, e o PIT assinado
-- tem 300 KB.
CREATE TABLE pit.anexo_revisao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  revisao_id BIGINT NOT NULL REFERENCES pit.revisao (id) ON DELETE CASCADE,
  tipo_anexo_id SMALLINT NOT NULL DEFAULT 4 REFERENCES pit.tipo_anexo_revisao (code),
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

CREATE INDEX idx_anexo_revisao_revisao ON pit.anexo_revisao (revisao_id);

-- A meta como uma revisão a declara.
--
-- ESPARSA, E POR ISSO ELA É O HISTÓRICO. Só se grava linha quando algo muda,
-- então as linhas de uma revisão SÃO as alterações dela, sem diff e sem cálculo,
-- e "em que revisão a meta 4.2 mudou" é a lista de revisões em que ela tem
-- linha. Medido no R0 e no R1 assinados de 2026: cinco mudanças em 38 itens (a
-- 4.2 de 247 para 252, a 6.8 de 73 para 61, a 6.9 aparecendo, a 5.2 e a 5.3
-- canceladas). Um instantâneo por revisão gravaria 49 linhas para registrar as
-- cinco, e convidaria as 44 cópias a divergirem.
CREATE TABLE pit.meta_revisao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  meta_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  revisao_id BIGINT NOT NULL REFERENCES pit.revisao (id) ON DELETE CASCADE,
  -- A frase da DSG. Ela JÁ contém o demandante e a quantidade ("Carta
  -- Topográfica 1:25.000. COTER, 24"), e por isso desce junto com os dois: se
  -- ficasse na identidade, uma revisão que mudasse o número deixaria o texto
  -- mentindo.
  descricao TEXT NOT NULL,
  -- ANULÁVEL para a linha de cabeçalho, que não promete quantidade: o que ela
  -- agrupa é que promete.
  quantidade_prevista INTEGER CHECK (quantidade_prevista IS NULL OR quantidade_prevista >= 0),
  -- Previsão de término. DATA, e não texto: o documento escreve 'AGO 26' e
  -- '1º trim 2026', e quem formata é o gerador.
  prazo DATE,
  -- Quem pediu ('COTER/DECEX', 'APHC/DSG'). Texto, e não tabela de OM: o
  -- demandante do PIT é sigla composta escrita no documento assinado, e casá-la
  -- com o catálogo de clientes da mapoteca acertaria alguns e inventaria outros.
  demandante VARCHAR(255),
  -- O ÚNICO ato de situação que é da DSG. O andamento e a conclusão a grade
  -- calcula do que foi lançado.
  cancelada BOOLEAN NOT NULL DEFAULT FALSE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_meta_por_revisao UNIQUE (meta_id, revisao_id)
);

COMMENT ON TABLE pit.meta_revisao IS
    'A meta como uma revisão do PIT a declara. ESPARSA: só há linha quando a revisão muda alguma coisa, e por isso as linhas de uma revisão SÃO as alterações dela.';

CREATE INDEX idx_meta_revisao_meta ON pit.meta_revisao (meta_id);
CREATE INDEX idx_meta_revisao_revisao ON pit.meta_revisao (revisao_id);

-- A meta com a promessa EM VIGOR.
--
-- Devolve os MESMOS nomes de coluna que `pit.meta` tinha, para quem lia a tabela
-- trocar uma palavra e não vinte. `revisao` vai junto porque a tela precisa
-- dizer de onde o número veio: "24 folhas, pelo R1".
CREATE OR REPLACE VIEW pit.meta_vigente AS
SELECT m.id, m.ano, m.numero_meta, m.item, m.unidade_id, m.origem_id,
       u.nome AS unidade,
       mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
       mr.cancelada, mr.revisao_id, r.codigo AS revisao,
       m.data_cadastramento, m.usuario_cadastramento_uuid,
       m.data_modificacao, m.usuario_modificacao_uuid
FROM pit.meta m
LEFT JOIN dominio.unidade_meta u ON u.code = m.unidade_id
LEFT JOIN LATERAL (
  SELECT x.* FROM pit.meta_revisao x
  INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
  WHERE x.meta_id = m.id AND rr.data_vigencia IS NOT NULL
  ORDER BY rr.data_vigencia DESC, rr.id DESC
  LIMIT 1
) mr ON TRUE
LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;

COMMENT ON VIEW pit.meta_vigente IS
    'A meta com a promessa da revisão em vigor hoje. Rascunho (data_vigencia nula) não entra: ele ainda não rege nada.';

-- A mesma coisa NUMA DATA, que é o que o RPCMTec de um mês precisa: a edição de
-- março reporta contra a revisão que vigia em março, e não contra a de hoje. É
-- o que faz a revisão retroativa não reescrever o passado por acidente.
CREATE OR REPLACE FUNCTION pit.meta_em(data_ref DATE)
RETURNS TABLE (
  id BIGINT, ano SMALLINT, numero_meta SMALLINT, item VARCHAR,
  unidade_id SMALLINT, origem_id SMALLINT, unidade VARCHAR,
  descricao TEXT, quantidade_prevista INTEGER, prazo DATE,
  demandante VARCHAR, cancelada BOOLEAN, revisao_id BIGINT, revisao VARCHAR
) AS $$
  SELECT m.id, m.ano, m.numero_meta, m.item, m.unidade_id, m.origem_id,
         u.nome, mr.descricao, mr.quantidade_prevista, mr.prazo, mr.demandante,
         mr.cancelada, mr.revisao_id, r.codigo
  FROM pit.meta m
  LEFT JOIN dominio.unidade_meta u ON u.code = m.unidade_id
  LEFT JOIN LATERAL (
    SELECT x.* FROM pit.meta_revisao x
    INNER JOIN pit.revisao rr ON rr.id = x.revisao_id
    WHERE x.meta_id = m.id
      AND rr.data_vigencia IS NOT NULL
      AND rr.data_vigencia <= data_ref
    ORDER BY rr.data_vigencia DESC, rr.id DESC
    LIMIT 1
  ) mr ON TRUE
  LEFT JOIN pit.revisao r ON r.id = mr.revisao_id;
$$ LANGUAGE SQL STABLE;

COMMENT ON FUNCTION pit.meta_em(DATE) IS
    'A meta com a promessa que vigia na data pedida. A meta ainda não declarada naquela data sai com quantidade nula.';

-- O MÊS de uma meta: o que ela PLANEJOU entregar e o que ENTREGOU.
--
-- DOIS NÚMEROS NA MESMA LINHA, e não duas tabelas. A
-- planilha que a Divisão preenche tem duas abas, PLANEJ_PIT e EXEC_PIT, com as
-- MESMAS linhas, as mesmas doze colunas de mês e a mesma quantidade anual: a
-- única diferença entre elas é qual dos dois números a célula guarda. Duas
-- tabelas repetiriam a chave (meta, mês) e deixariam a comparação, que é a
-- razão de as duas existirem, a um JOIN de distância.
--
-- O PLANEJAMENTO É MENSAL, e isso é o que `pit.meta.quantidade_prevista`
-- sozinha não dizia: a meta 1.1 promete 24 no ano, distribuídos em abril 4,
-- maio 1, julho 16 e agosto 3. A soma do planejado TEM de bater com a
-- quantidade prevista, e é a tela que confere -- na planilha essa conferência é
-- a coluna "Total" ao lado da "Qnt", feita com o olho.
--
-- OS DOIS SÃO ANULÁVEIS, e o nulo é uma afirmação: "ninguém lançou" é diferente
-- de "conferi e não houve", que é o zero. Enquanto a linha só existia para o
-- realizado, a ausência DA LINHA dizia isso; agora que ela também guarda o
-- plano, a linha existe desde o começo do ano e o nulo é quem carrega o
-- recado. O CHECK do fim recusa a linha que não diz nada: quando os quatro
-- campos ficam nulos, o controlador apaga a linha em vez de guardá-la vazia.
--
-- O REALIZADO PODE PASSAR DO PLANEJADO, e passa: a meta 4.1 de 2026 planejou
-- 327 e já entregou mais de cinco mil. Não há teto em lugar nenhum.
--
-- LANÇAMENTO À MÃO, para TODA meta. No SAP a régua era
-- `lote_id IS NULL`: meta de produção tinha o realizado calculado das
-- atividades, e só o resto se digitava. Aqui não existe essa régua, porque
-- enquanto o SAP não for absorvido não há de onde calcular.
--
-- O CUSTO ESTÁ ACEITO, e vale escrever: a meta 4 (impressão) o SCA JÁ sabe
-- somar, porque `mapoteca.pedido.meta_pit_id` liga o pedido à meta e é disso
-- que sai o META4_DETALHADA do RTM. O número digitado aqui e o número calculado
-- lá podem divergir, e quando divergirem a 2.1 e o RTM do mesmo mês vão se
-- contradizer.
--
-- O NOME `execucao` FICA, embora a tabela guarde as duas coisas. Renomeá-la
-- orfanaria o rastro: `auditoria.evento` guarda o nome da
-- tabela em cada linha, e o schema `auditoria` não tem UPDATE nem DELETE para a
-- aplicação, de propósito. O nome imperfeito custa menos do que uma trilha que
-- deixa de casar com o mapa de entidades.
--
-- SEM COLUNA `ano`: ele vem da meta. Uma cópia aqui permitiria lançar 2025 numa
-- meta de 2026, e nada acusaria.
CREATE TABLE pit.execucao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  meta_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  quantidade_planejada INTEGER CHECK (quantidade_planejada IS NULL OR quantidade_planejada >= 0),
  quantidade INTEGER CHECK (quantidade IS NULL OR quantidade >= 0),
  -- A data em que aquilo ficou pronto, quando a meta se cumpre num ato só
  -- (entregar um relatório) em vez de por quantidade acumulada.
  data_conclusao DATE,
  observacao TEXT,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  -- Uma linha por meta por mês. Duas seriam duas verdades sobre o mesmo mês, e
  -- a soma do ano contaria as duas.
  UNIQUE (meta_id, mes),
  CONSTRAINT execucao_diz_alguma_coisa CHECK (
    quantidade_planejada IS NOT NULL
    OR quantidade IS NOT NULL
    OR data_conclusao IS NOT NULL
    OR observacao IS NOT NULL
  )
);

COMMENT ON TABLE pit.execucao IS
    'O mês de uma meta do PIT: o que ela planejou entregar e o que entregou. Uma linha por (meta, mês); o ano vem da meta.';

CREATE INDEX idx_execucao_meta ON pit.execucao (meta_id);

-- Demanda Extra-PIT: a subseção 3.3 do RPCMTec.
--
-- MORA AQUI, e não num schema próprio, porque ela é a EXCEÇÃO ao PIT e só se lê
-- ao lado dele. O que o relatório chama de Extra-PIT não é "trabalho fora do
-- plano": é a exceção AUTORIZADA, e é por isso que `documento_autorizacao` é
-- NOT NULL. Foi essa obrigatoriedade que faltou quando o SCA tentou derivar a
-- 3.3 de `mapoteca.pedido.previsto_pit`: aquele campo é falso por omissão, e a
-- conta deu 23 linhas onde a edição real de julho/2026 traz 1.
--
-- O EXTRA-PIT É PRODUÇÃO: "se fosse só entrega entraria na
-- mapoteca". Por isso a demanda materializa, e o vínculo vive em
-- `acervo.versao.demanda_extra_id`, exclusivo com `meta_pit_id`. Essa exclusão
-- é o que impede a contagem dupla, e é a mesma regra que no SAP vivia em
-- `extra_pit.lote_id`.
--
-- SEM VÍNCULO COM LOTE, e isso foi medido. O lote `2026_1a_CT_Faxinal_Soturno_25k`
-- tem seis cartas topográficas: quatro cumprem a meta 1.1 e duas (2966-1-NE e
-- 2966-1-SE) são as demandas do CMS para a Op. Arandu. A produção Extra-PIT
-- mora DENTRO de um lote do PIT, saiu na mesma corrida e na mesma data de
-- edição. Só a versão tem a granularidade que separa as duas.
--
-- SEM VÍNCULO COM PEDIDO, pela mesma régua. O pedido é entrega, e a entrega é a
-- mapoteca. Do pedido até a autorização já há caminho: item, versão, demanda.
-- Uma chave estrangeira direta seria um segundo caminho para a mesma verdade.
--
-- `tipo_produto` é TEXTO, e não `dominio.tipo_produto`. A demanda Extra-PIT é
-- justamente a que não cabe no catálogo (super-resolução de imagem, carta
-- especial de uma vez só); uma chave estrangeira recusaria a exceção, que é a
-- única coisa que esta tabela guarda.
CREATE TABLE pit.demanda_extra(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL REFERENCES pit.exercicio (ano),
  demandante VARCHAR(255) NOT NULL,
  tipo_produto VARCHAR(255) NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  situacao_id SMALLINT NOT NULL REFERENCES dominio.situacao_extra_pit (code),
  -- De onde vem a PROVA desta linha. Reusa `dominio.origem_meta` e
  -- aceita só Manual (1) e Produção (3): um domínio próprio criaria um segundo
  -- código chamado 'Produção', diferente do da meta, e quem lesse os dois lados
  -- teria de traduzir. A pergunta é a mesma que a meta responde.
  --
  -- Manual é para a exceção que não gera produto de acervo, e ela existe: a
  -- 'Exposição do Dia do Exército' e a 'Pista de orientação com Chefe do DCT'
  -- de 2026 nunca vão ter versão nenhuma. É o padrão, então a demanda só passa
  -- a exigir materialização depois que alguém declara a origem.
  origem_id SMALLINT NOT NULL DEFAULT 1 REFERENCES dominio.origem_meta (code),
  documento_autorizacao VARCHAR(255) NOT NULL,
  descricao TEXT,
  data_entrega DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT demanda_extra_origem_manual_ou_producao CHECK (origem_id IN (1, 3))
);

COMMENT ON TABLE pit.demanda_extra IS
    'Demanda Extra-PIT: a exceção AUTORIZADA ao plano anual (3.3 do RPCMTec). O documento de autorização é obrigatório, e é o que a distingue de trabalho fora do plano.';

CREATE INDEX idx_demanda_extra_ano ON pit.demanda_extra (ano);

COMMIT;
