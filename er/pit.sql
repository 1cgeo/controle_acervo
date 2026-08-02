BEGIN;

-- Plano Interno de Trabalho (PIT): o plano anual da Divisão.
--
-- Dado de REFERÊNCIA, e não orçamento. A tabela nasceu em `orcamento` porque o
-- primeiro consumidor foi o PDR, mas o PIT não é artefato orçamentário: é o que
-- a Divisão se comprometeu a entregar no ano, e todo módulo tem trabalho que
-- atende uma meta dele. O orçamento amarra a NC e o item do PDR à meta que
-- financiam; a mapoteca amarra o pedido de impressão à meta que ele cumpre.
-- Nenhum dos dois é dono. Mesmo critério do schema `limites` (2026-07-29).
--
-- Enquanto morava em `orcamento`, a mapoteca não podia usá-la: em 2026-07-30 o
-- pedido ganhou um `meta_pit VARCHAR(10)` de texto livre, com o código digitado
-- à mão. Duas verdades sobre a mesma coisa, e o banco não cobrava nenhuma.
-- Mudou de casa em 2026-07-31, por decisão do chefe.
--
-- PERMISSÃO. Ler é de qualquer pessoa logada, porque todo módulo precisa
-- oferecer a lista. Escrever é do administrador global: o PIT muda uma vez por
-- ano e errar nele contamina os três módulos.
--
-- O QUE ENTROU EM 2026-08-02. A meta deixou de ser só um rótulo e passou a
-- guardar o que o PIT promete (quantidade, unidade, demandante, prazo), e
-- nasceram a execução mensal e a demanda Extra-PIT. As três coisas existiam no
-- SAP e vieram para cá porque nenhuma delas depende da produção: são cadastro à
-- mão. Com elas o SCA passa a gerar a subseção 2.1 do RPCMTec, que até então
-- ficava de fora justamente por falta de quantidade prevista e de prazo.
--
-- Nada saiu do SAP (decisão do chefe, 2026-08-02): a fusão é por ADIÇÃO aqui, e
-- não por remoção lá. Enquanto os dois existirem há duas cópias vivas do mesmo
-- fato, e o que as impede de brigar não é o banco: é o SCA passar a ser quem
-- gera essas subseções do relatório.

CREATE SCHEMA pit;

COMMENT ON SCHEMA pit IS
    'Plano Interno de Trabalho: o plano anual da Divisão. Dado de referência que orçamento, mapoteca e acervo consomem, e do qual nenhum é dono.';

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
  ano SMALLINT NOT NULL,
  numero_meta SMALLINT NOT NULL,
  item VARCHAR(20),
  descricao TEXT,
  -- O que o PIT PROMETE naquele item, e o que a 2.1 do RPCMTec cobra
  -- (2026-08-02). Os quatro são ANULÁVEIS, e por dois motivos que não se
  -- confundem: a linha de cabeçalho da meta não promete quantidade nenhuma (o
  -- que ela agrupa é que promete), e o PIT de 2025 foi cadastrado só no nível
  -- da meta, sem item.
  --
  -- Até esta data os três primeiros viviam DENTRO de `descricao`, em texto:
  -- 'Carta Topográfica 1:25.000. COTER/DECEX, 24'. Servia para ler na tela e
  -- não servia para somar, que é o que a coluna "Quantidade" do relatório pede.
  quantidade_prevista INTEGER CHECK (quantidade_prevista IS NULL OR quantidade_prevista >= 0),
  -- 'carta', 'folha', 'ano', 'relatório'. O documento imprime o nome da unidade
  -- ao lado do número, e ele varia por item na mesma meta.
  unidade VARCHAR(50),
  -- Quem pediu ('COTER/DECEX', 'APHC/DSG'). Texto, e não uma tabela de OM: o
  -- demandante do PIT é escrito no documento assinado como sigla composta, e
  -- casá-la com o catálogo de clientes da mapoteca acertaria alguns e
  -- inventaria os outros.
  demandante VARCHAR(255),
  -- Previsão de término. DATA, e não texto: o documento escreve 'AGO 26' e
  -- '1º trim 2026', e quem formata é o gerador. Guardar a frase impediria
  -- ordenar e comparar com o mês da edição.
  prazo DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  UNIQUE (ano, numero_meta, item)
);

COMMENT ON TABLE pit.meta IS
    'Meta do PIT do ano. `item` guarda o sub-item quando a meta se subdivide (ex.: 4.1), e é NULO quando a meta é indivisa.';

CREATE INDEX idx_meta_ano ON pit.meta (ano);

-- Execução MENSAL de uma meta: o "Prontos no mês" da 2.1.
--
-- LANÇAMENTO À MÃO, para TODA meta (chefe, 2026-08-02). No SAP a régua era
-- `lote_id IS NULL`: meta de produção tinha o realizado calculado das
-- atividades, e só o resto se digitava. Aqui não existe essa régua, porque
-- enquanto o SAP não for absorvido não há de onde calcular. Quando ele entrar,
-- é aqui que nasce a coluna que diz qual meta deixa de ser digitada.
--
-- O CUSTO ESTÁ ACEITO, e vale escrever: a meta 4 (impressão) o SCA JÁ sabe
-- somar, porque `mapoteca.pedido.meta_pit_id` liga o pedido à meta e é disso
-- que sai o META4_DETALHADA do RTM. O número digitado aqui e o número calculado
-- lá podem divergir, e quando divergirem a 2.1 e o RTM do mesmo mês vão se
-- contradizer.
--
-- SEM COLUNA `ano`: ele vem da meta. Uma cópia aqui permitiria lançar 2025 numa
-- meta de 2026, e nada acusaria.
CREATE TABLE pit.execucao(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  meta_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  mes SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  quantidade INTEGER NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
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
  UNIQUE (meta_id, mes)
);

COMMENT ON TABLE pit.execucao IS
    'Execução mensal lançada à mão para uma meta do PIT. Uma linha por (meta, mês); o ano vem da meta.';

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
-- SEM VÍNCULO COM LOTE. No SAP existe `lote_id`, que serve para a 2.1 não
-- contar duas vezes o mesmo trabalho. Aqui não há o que descontar: a 2.1 do SCA
-- soma o que foi lançado em `pit.execucao`, e o Extra-PIT não é lançado lá.
-- Apontar para `acervo.lote` seria inventar um vínculo, porque o lote do acervo
-- não é o lote de produção do SAP.
--
-- `tipo_produto` é TEXTO, e não `dominio.tipo_produto`. A demanda Extra-PIT é
-- justamente a que não cabe no catálogo (super-resolução de imagem, carta
-- especial de uma vez só); uma chave estrangeira recusaria a exceção, que é a
-- única coisa que esta tabela guarda.
CREATE TABLE pit.demanda_extra(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  demandante VARCHAR(255) NOT NULL,
  tipo_produto VARCHAR(255) NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  situacao_id SMALLINT NOT NULL REFERENCES dominio.situacao_extra_pit (code),
  documento_autorizacao VARCHAR(255) NOT NULL,
  descricao TEXT,
  data_entrega DATE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

COMMENT ON TABLE pit.demanda_extra IS
    'Demanda Extra-PIT: a exceção AUTORIZADA ao plano anual (3.3 do RPCMTec). O documento de autorização é obrigatório, e é o que a distingue de trabalho fora do plano.';

CREATE INDEX idx_demanda_extra_ano ON pit.demanda_extra (ano);

COMMIT;
