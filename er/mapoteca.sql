BEGIN;

CREATE SCHEMA mapoteca;

CREATE TABLE mapoteca.tipo_cliente(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_cliente (code, nome) VALUES
(1, 'OM EB'),
(2, 'OM Aeronáutica'),
(3, 'OM Marinha'),
(4, 'Órgão Publico Federal'),
(5, 'Órgão Publico Estadual'),
(6, 'Órgão Publico Municipal'),
(7, 'Pessoa Jurídica'),
(8, 'Pessoa Física'),
(9, 'Lei de Acesso à Informação (LAI)');

CREATE TABLE mapoteca.situacao_pedido(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.situacao_pedido (code, nome) VALUES
(1, 'Pré cadastramento do pedido realizado'),
(2, 'DIEx/Ofício do pedido recebido'),
(3, 'Em andamento'),
(4, 'Remetido'),
(5, 'Concluído'),
(6, 'Cancelado'),
(7, 'Aguardando produção');

CREATE TABLE mapoteca.tipo_midia(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_midia (code, nome) VALUES
(1, 'Banner (tecido)'),
(2, 'Glossy'),
(3, 'Couchê'),
(4, 'Vergê'),
(5, 'Sulfite 90g'),
(6, 'Sulfite 120g'),
(7, 'Digital'),
(8, 'Tyvek');

-- De-para da MIDIA impressa para a meta do PIT, por ano. E a fonte
-- da meta 4 quando ela declara origem Impressao: o realizado do mes e a soma do
-- fornecido, agrupada pela midia entregue e mapeada aqui.
--
-- POR QUE NAO PELO PEDIDO. `mapoteca.pedido.meta_pit_id` responde outra
-- pergunta: "este pedido estava previsto no PIT, sob esta meta". O CHECK
-- `pedido_meta_pit_id_exige_previsto` diz isso, e so a minoria dos pedidos o
-- preenche.
--
-- A meta 4 conta o que SAIU, e o que saiu esta no ITEM (midia entregue,
-- quantidade fornecida). Somando pelo campo do pedido, 2026 daria 253 folhas na
-- 4.1 onde o RTM publica 5.664. Pior: a 4.2 (Tyvek) receberia 199, e em 2026
-- nenhuma folha saiu em tyvek -- aqueles pedidos foram planejados como tyvek e
-- atendidos em sulfite, que e o padrao da casa quando falta material. Os dois
-- campos nao se substituem: um guarda o prometido, o outro o entregue.
--
-- POR QUE NAO UMA COLUNA EM `tipo_midia`. A numeracao do PIT e reescrita todo
-- ano, e a meta 4.1 de 2026 pode ser outra coisa em 2027. Uma coluna na midia
-- amarraria a um ano so, e o de-para do ano seguinte apagaria o do anterior.
--
-- O `ano` ESTA AQUI e tambem na meta, e a duplicata e deliberada: a restricao
-- unica precisa impedir que a mesma midia aponte duas metas no MESMO ano, e
-- restricao nao enxerga coluna de outra tabela. O controlador confere que este
-- ano casa com o da meta.
--
-- CORRELACAO MEDIDA EM 2026: sulfite na 4.1, tyvek na 4.2, glossy na 4.3. Ela
-- NAO se deduz do nome nem se fixa no codigo, pelo mesmo motivo do paragrafo
-- acima.
CREATE TABLE mapoteca.midia_meta_pit(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  ano SMALLINT NOT NULL,
  tipo_midia_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_midia (code),
  meta_pit_id BIGINT NOT NULL REFERENCES pit.meta (id) ON DELETE CASCADE,
  data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
  data_modificacao TIMESTAMP WITH TIME ZONE,
  usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
  CONSTRAINT unique_midia_por_ano UNIQUE (ano, tipo_midia_id)
);

COMMENT ON TABLE mapoteca.midia_meta_pit IS
    'De-para da mídia impressa para a meta do PIT, por ano. Fonte da meta 4 quando ela é automática; o ano está na chave porque a numeração do PIT muda todo ano.';

CREATE INDEX idx_midia_meta_pit_meta ON mapoteca.midia_meta_pit (meta_pit_id);

CREATE TABLE mapoteca.forma_entrega(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.forma_entrega (code, nome) VALUES
(1, 'Correios'),
(2, 'Entrega em mãos'),
(3, 'Retirado no CGEO'),
(4, 'E-mail'),
(5, 'Outros');

CREATE TABLE mapoteca.tipo_localizacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_localizacao (code, nome) VALUES
(1, 'Seção'),
(2, 'Almoxarifado'),
(3, 'Aquisição realizada'),
(4, 'Saldo no empenho');

-- Canal por onde a demanda de CIVIL chega (LAI/ouvidoria, e-mail, ofício).
CREATE TABLE mapoteca.canal_recebimento(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.canal_recebimento (code, nome) VALUES
(1, 'Ouvidoria (Fala.BR) - LAI'),
(2, 'E-mail'),
(3, 'Ofício'),
(4, 'Outro');

CREATE TABLE mapoteca.cliente(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	-- Sigla da OM (ex.: '10º B Log'). E o nome corrente da unidade para quem le
	-- o RPCMTec, e o que cabe na coluna de solicitante. NULA para quem nao e OM
	-- (orgao publico, cidadao da LAI): quem exibe cai no `nome`. Ver
	-- migrations/2026-07-31_cliente_sigla.sql.
	sigla VARCHAR(50),
    ponto_contato_principal VARCHAR(255),
    endereco_entrega_principal VARCHAR(255),
	tipo_cliente_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_cliente (code)
);

-- Cliente padrão para demanda de civil anônima / LAI de cidadão: distingue-se
-- pelo NUP, sem gravar dado pessoal do requerente (LGPD). Demanda de órgão/
-- empresa deve ter cliente nomeado próprio.
INSERT INTO mapoteca.cliente (nome, tipo_cliente_id) VALUES
('Cidadão (LAI)', 9);

CREATE TABLE mapoteca.pedido(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	-- Datas de CALENDARIO, nao instantes: o formulario so oferece o dia, e
	-- todo consumidor so exibe o dia. Em TIMESTAMPTZ elas atravessavam o fuso
	-- da sessao do banco (D-1 na tela) e decidiam o ano do relatorio pelo
	-- fuso. Instalacao nova ja nasce em DATE; banco existente chega la pela
	-- migracao 2026-07-26_pedido_datas_calendario.sql. Os dois caminhos TEM
	-- de terminar no mesmo tipo, senao instalacao nova diverge de migrada.
	data_pedido DATE NOT NULL,
    -- Dia em que o pedido FECHOU, e na pratica o dia em que o material saiu
    -- daqui: em 51 de 52 pedidos concluidos com item datado ela e igual a maior
    -- data_entrega dos itens. Por isso NAO
    -- existe coluna "data_envio", e a consulta publica mostra esta data como
    -- "envio/entrega". Coluna separada nasceria duplicada, porque a mapoteca
    -- fecha o pedido no dia da postagem e nunca usa a situacao 4 (Remetido).
    data_atendimento DATE,
	cliente_id BIGINT NOT NULL REFERENCES mapoteca.cliente (id),
	situacao_pedido_id SMALLINT NOT NULL REFERENCES mapoteca.situacao_pedido (code),
    ponto_contato VARCHAR(255),
    documento_solicitacao VARCHAR(255),
    documento_solicitacao_nup VARCHAR(255),
	endereco_entrega TEXT,
    -- Como o material saiu daqui. E do PEDIDO, e nao do item: o pedido inteiro
    -- sai numa remessa so, e item com forma propria e caso raro.
    -- Item entregue por outra forma se anota em observacao_envio, que o cliente
    -- le. Instalacao existente chega aqui pela migracao
    -- 2026-07-30_entrega_no_pedido.sql, que aplica a maioria por contagem.
    forma_entrega_id SMALLINT REFERENCES mapoteca.forma_entrega (code),
    palavras_chave VARCHAR[] NOT NULL DEFAULT '{}',
    operacao TEXT,
    prazo DATE,
    demandante VARCHAR(255),
    omds VARCHAR(255),
    previsto_pit BOOLEAN NOT NULL DEFAULT FALSE,
    -- Meta do PIT que o pedido atende, por chave estrangeira para `pit.meta` e
    -- nunca por codigo digitado a mao ('4.1'). NAO se deriva do material: a
    -- correlacao entre midia e meta vale num ano e o PIT e reescrito todo ano
    -- e a numeracao muda com ele.
    meta_pit_id BIGINT REFERENCES pit.meta (id),
    -- O MES EM QUE ESTE PEDIDO PROMETE SER IMPRESSO, e de onde sai o PLANEJADO
    -- da meta 4 do PIT: a soma de `produto_pedido.quantidade` dos pedidos
    -- ligados a meta, agrupada pelo mes daqui.
    --
    -- O PLANEJADO E O PEDIDO E O REALIZADO E A MIDIA, e as duas fontes convivem
    -- de proposito. O prometido esta no ITEM do pedido; o entregue esta na midia
    -- que SAIU, pelo de-para de `mapoteca.midia_meta_pit`. Somar o realizado
    -- pelo pedido derrubaria a 4.1 de 5.664 folhas para 253.
    --
    -- NAO E `prazo`, que e o limite imposto pelo CLIENTE. Medido em 2026-08-05:
    -- `prazo` esta preenchido em 33 dos 164 pedidos e em NENHUM dos 16 ligados a
    -- meta. Mesma razao pela qual `lote.data_fim_prevista` nasceu separada de
    -- `data_fim`.
    data_prevista DATE,
    -- Campos de pedido de CIVIL (LAI/órgão/empresa/pessoa); NULL para OM.
    canal_recebimento_id SMALLINT REFERENCES mapoteca.canal_recebimento (code),
    municipio VARCHAR(255),
    qtd_imagens INTEGER CHECK (qtd_imagens IS NULL OR qtd_imagens >= 0),
    observacao TEXT,
    observacao_envio TEXT,
    -- Anotacao da equipe, que NAO sai na consulta publica por localizador
    -- (quem levou aos Correios, com quem esta o cartao de envio). As outras
    -- duas observacoes SAEM naquela rota, e por isso esta existe.
    observacao_interna TEXT,
    localizador_envio TEXT,
    localizador_pedido VARCHAR(14) UNIQUE
        CHECK (localizador_pedido IS NULL OR localizador_pedido ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
    motivo_cancelamento TEXT,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE,
    CHECK (data_atendimento IS NULL OR data_atendimento >= data_pedido),
    CONSTRAINT check_pedido_cancelamento
        CHECK (situacao_pedido_id <> 6 OR motivo_cancelamento IS NOT NULL),
    CONSTRAINT check_pedido_conclusao
        CHECK (situacao_pedido_id <> 5 OR data_atendimento IS NOT NULL),
    -- Previsto no PIT exige dizer QUAL meta. A regra tambem vive no Joi (erro
    -- 400 limpo); o CHECK garante que nenhuma outra porta grave a combinacao
    -- invalida. O nome e o mesmo da migracao, senao instalacao nova divergiria
    -- da migrada e o ensaiar_migracao.cjs reprovaria.
    CONSTRAINT pedido_meta_pit_id_exige_previsto
        CHECK (NOT previsto_pit OR meta_pit_id IS NOT NULL)
);

COMMENT ON COLUMN mapoteca.pedido.demandante IS
    'Quem encaminhou o pedido (ex: CMS encaminhando pedido do 18º BI Mtz).';
COMMENT ON COLUMN mapoteca.pedido.omds IS
    'OM Diretamente Subordinada responsável pelo atendimento (ex: 1º CGEO).';
COMMENT ON COLUMN mapoteca.pedido.previsto_pit IS
    'Pedido previsto no Plano Interno de Trabalho (PIT vs Extra-PIT).';
COMMENT ON COLUMN mapoteca.pedido.meta_pit_id IS
    'Meta do PIT que o pedido atende (pit.meta). Obrigatória quando previsto_pit é verdadeiro, nula caso contrário. NÃO se deriva do material: a correlação valeu só em 2026.';
COMMENT ON COLUMN mapoteca.pedido.observacao_interna IS
    'Anotação da equipe. NUNCA sai na consulta pública por localizador; ao contrário de observacao e observacao_envio, que saem.';
COMMENT ON COLUMN mapoteca.pedido.forma_entrega_id IS
    'Como o material do pedido saiu (Correios, em mãos, retirado). É do PEDIDO desde 2026-07-30: item com forma própria era exceção de 1 pedido em 91. Item entregue por outra forma se anota em observacao_envio.';

-- RN04: localizador_pedido é imutável após definido
CREATE OR REPLACE FUNCTION mapoteca.trg_localizador_imutavel()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.localizador_pedido IS NOT NULL
       AND NEW.localizador_pedido IS DISTINCT FROM OLD.localizador_pedido THEN
        RAISE EXCEPTION 'O localizador do pedido é imutável';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_localizador_imutavel
BEFORE UPDATE ON mapoteca.pedido
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_localizador_imutavel();

-- Todo item de pedido referencia uma versão do acervo (RN08): a mapoteca só
-- entrega produtos previstos no controle do acervo. Cartas especiais, mapas
-- temáticos e imagens devem ser cadastrados no acervo antes do pedido.
CREATE TABLE mapoteca.produto_pedido(
	id BIGSERIAL NOT NULL PRIMARY KEY,
    -- RN08: todo item aponta EXATAMENTE UM produto identificado. O destino pode
    -- ser o acervo OU um impresso avulso descrito aqui mesmo
    -- (papel quadriculado, impresso de ocasiao). Quem garante o "um" e o CHECK
    -- produto_pedido_um_destino, no fim desta tabela.
    --
    -- O avulso e descrito no ITEM, e nao num catalogo proprio: avulso e, por
    -- definicao, impresso de OCASIAO, e catalogo de coisa que nao vale
    -- catalogacao se contradiz. O que merecer cadastro estavel merece estar no
    -- acervo. Pedido pode misturar item de acervo e item avulso a vontade,
    -- porque a escolha e de cada item.
    -- ON UPDATE CASCADE: o uuid_versao e o MESMO identificador com que o produto
    -- e publicado no BDGEx, e quando a carga la acontece antes da catalogacao e
    -- o acervo que se acerta (ver POST /api/produtos/versao/uuid). O item do
    -- pedido segue a versao para onde ela for. Sem cascata no DELETE, de
    -- proposito: apagar versao nao pode apagar o historico de quem a recebeu.
    uuid_versao UUID REFERENCES acervo.versao (uuid_versao) ON UPDATE CASCADE,
    nome_avulso VARCHAR(255),
    descricao_avulso TEXT,
	pedido_id BIGINT NOT NULL REFERENCES mapoteca.pedido (id),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    quantidade_fornecida INTEGER
        CHECK (quantidade_fornecida IS NULL OR quantidade_fornecida >= 0),
    tipo_midia_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_midia (code),
    tipo_midia_fornecida_id SMALLINT REFERENCES mapoteca.tipo_midia (code),
    -- SEM forma_entrega_id e SEM data_entrega: as duas sao do PEDIDO (ver
    -- mapoteca.pedido.forma_entrega_id e data_atendimento). No item elas
    -- prometeriam remessa por item, e o pedido inteiro sai numa remessa so.
    observacao TEXT,
    producao_especifica BOOLEAN NOT NULL DEFAULT FALSE,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE,
    -- O nome e o mesmo da migracao 2026-07-30_produto_avulso_no_item.sql,
    -- senao
    -- instalacao nova divergiria da migrada e o ensaiar_migracao reprovaria.
    CONSTRAINT produto_pedido_um_destino
        CHECK ((uuid_versao IS NOT NULL) <> (nome_avulso IS NOT NULL))
);

COMMENT ON COLUMN mapoteca.produto_pedido.quantidade_fornecida IS
    'Quantidade efetivamente entregue, quando diverge da prevista.';
COMMENT ON COLUMN mapoteca.produto_pedido.tipo_midia_fornecida_id IS
    'Mídia efetivamente usada, quando diverge da prevista.';

-- Histórico de impressão por item de pedido: cada registro é uma sessão de
-- impressão (quem imprimiu, quando e quantas cópias). O total impresso e o
-- restante são derivados por soma; o item está concluído quando a soma
-- atinge a quantidade pedida. Permite que operadores diferentes continuem
-- a impressão de um pedido em dias distintos.
-- Segue a convenção do acervo para tabelas novas: usuario por UUID.
CREATE TABLE mapoteca.impressao_item(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    produto_pedido_id BIGINT NOT NULL REFERENCES mapoteca.produto_pedido (id) ON DELETE CASCADE,
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    observacao TEXT,
    usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_impressao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_impressao_item_produto_pedido ON mapoteca.impressao_item(produto_pedido_id);

CREATE TABLE mapoteca.plotter(
	id SERIAL NOT NULL PRIMARY KEY,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
	nr_serie VARCHAR(255) NOT NULL,
    modelo VARCHAR(255) NOT NULL,
    data_aquisicao DATE,
    vida_util INTEGER
);

CREATE TABLE mapoteca.manutencao_plotter (
    id SERIAL PRIMARY KEY,
    plotter_id INTEGER NOT NULL REFERENCES mapoteca.plotter(id),
    data_manutencao DATE NOT NULL,
    valor DECIMAL(10, 2) NOT NULL,
    descricao TEXT,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_manutencao_plotter_plotter ON mapoteca.manutencao_plotter(plotter_id);

CREATE TABLE mapoteca.tipo_material (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    -- Papel, tinta ou outro. E o que separa as tabelas 7.2 e 7.3 do RPCMTec, e
    -- por isso e COLUNA e nao regra sobre o nome: "comeca com Cartucho" acerta
    -- o catalogo de hoje e erra calado no primeiro "Tinta preta 300ml". Default
    -- 3 (Outro) para que material novo entre sem categoria errada -- quem nao
    -- escolheu nao aparece em nenhuma das duas tabelas, que e melhor do que
    -- aparecer na errada.
    categoria_id SMALLINT NOT NULL DEFAULT 3 REFERENCES dominio.categoria_material (code),
    -- INTEIROS: sao quantidades do MESMO material contado em unidade, entao
    -- seguem a regra do estoque e do consumo.
    estoque_minimo INTEGER,
    meta_anual INTEGER,
    -- A MIDIA cuja impressao gasta este material. Existe porque o
    -- consumo saia so de `consumo_material`, que ninguem preenche, e as
    -- subsecoes 7.2 e 7.3 do RPCMTec reportavam "Consumo no mes = 0" nas
    -- dezessete linhas enquanto havia 1.753 impressoes registradas: o numero
    -- nao faltava, estava ERRADO, com etiqueta de calculado.
    --
    -- UM PARA UM, e por isso e coluna e nao tabela de ligacao: uma midia gasta
    -- um papel, e um papel serve a uma midia. Ligacao admitiria dois papeis
    -- para a mesma midia, e nada diria qual baixar.
    --
    -- SO PAPEL. Tinta nao se deriva de folha impressa: quanto de cartucho uma
    -- folha gasta depende do que esta desenhado nela. O consumo de tinta
    -- continua vindo de `consumo_material`, onde alguem declara a troca.
    tipo_midia_id SMALLINT REFERENCES mapoteca.tipo_midia (code),
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    -- SO PAPEL aponta midia (categoria 1). Sem isto, um cartucho poderia
    -- reivindicar 'Sulfite 120g' e o consumo de tinta passaria a ser derivado
    -- de folha impressa, que e o que nao se faz.
    CONSTRAINT midia_so_para_papel CHECK (tipo_midia_id IS NULL OR categoria_id = 1)
);

-- UM material por midia: duas linhas apontando a mesma midia fariam a mesma
-- folha baixar dois estoques.
CREATE UNIQUE INDEX unique_material_por_midia
  ON mapoteca.tipo_material (tipo_midia_id)
  WHERE tipo_midia_id IS NOT NULL;

COMMENT ON COLUMN mapoteca.tipo_material.categoria_id IS
    'Papel (7.2 do RPCMTec), Tinta (7.3) ou Outro (fora das duas). Dado, e nao regra sobre o nome.';

COMMENT ON COLUMN mapoteca.tipo_material.estoque_minimo IS
    'Limiar para alertar estoque baixo na UI (badge). NULL = sem alerta.';
COMMENT ON COLUMN mapoteca.tipo_material.meta_anual IS
    'Consumo anual previsto. Usado em relatório Consumo × Necessário × Pendente.';
COMMENT ON COLUMN mapoteca.tipo_material.tipo_midia_id IS
    'A mídia cuja impressão gasta este material. Só papel: tinta não se deriva de folha impressa.';

-- Seed do controle de material de impressão (referência: planilha "Controle de
-- Material de Impressão" da Seção; dados de implantação no CLAUDE.md raiz)

-- Cartuchos Plotter T730 (categoria 2 = Tinta, tabela 7.3 do RPCMTec)
INSERT INTO mapoteca.tipo_material (nome, descricao, categoria_id) VALUES
('Cartucho CY - T730',         'Cartucho Ciano para plotter HP T730 (P2V62A)', 2),
('Cartucho MG - T730',         'Cartucho Magenta para plotter HP T730 (P2V63A)', 2),
('Cartucho Y - T730',          'Cartucho Yellow para plotter HP T730 (P2V64A)', 2),
('Cartucho MK - T730',         'Cartucho Matte Black 130ml para plotter HP T730 (P2V65A)', 2),
('Cartucho MK - T730 300ml',   'Cartucho Matte Black 300ml para plotter HP T730', 2),
('Cartucho GR - T730',         'Cartucho Gray para plotter HP T730 (P2V66A)', 2),
('Cartucho GR - T730 300ml',   'Cartucho Gray 300ml para plotter HP T730', 2),
('Cartucho PK - T730',         'Cartucho Photo Black para plotter HP T730 (P2V67A)', 2);

-- Cartuchos HP M470 (categoria 2 = Tinta)
INSERT INTO mapoteca.tipo_material (nome, descricao, categoria_id) VALUES
('Cartucho Black - HP M470',   'Cartucho Black para impressora HP M470 (W2020XC)', 2),
('Cartucho Ciano - HP M470',   'Cartucho Ciano para impressora HP M470 (W2021XC)', 2),
('Cartucho Magenta - HP M470', 'Cartucho Magenta para impressora HP M470 (W2023XC)', 2),
('Cartucho Yellow - HP M470',  'Cartucho Yellow para impressora HP M470 (W2022XC)', 2);

-- Cabeçotes (categoria 3 = Outro): são peça de reposição do plotter, não insumo
-- de impressão. Não saem nem na 7.2 nem na 7.3.
INSERT INTO mapoteca.tipo_material (nome, descricao, categoria_id) VALUES
('Cabeçote Universal',   'Cabeçote Universal novo (P2V27A, ficha C2982)', 3),
('Cabeçote MK/Y usado',  'Cabeçote MK/Y reutilizado', 3),
('Cabeçote CY/MG usado', 'Cabeçote CY/MG reutilizado', 3),
('Cabeçote G/PK usado',  'Cabeçote G/PK reutilizado', 3);

-- Papéis (categoria 1 = Papel, tabela 7.2 do RPCMTec). O banner de tecido entra
-- aqui: o RPCMTec o lista como "Papel Tecido" na mesma tabela, porque o que ela
-- controla é a MÍDIA em que se imprime, e não a fibra.
INSERT INTO mapoteca.tipo_material (nome, descricao, categoria_id) VALUES
('Papel Sulfite 90g',   'Papel sulfite 90g/m² para plotter', 1),
('Papel Sulfite 120g',  'Papel sulfite 120g/m² para plotter', 1),
('Papel Glossy',        'Papel glossy para plotter', 1),
('Banner (tecido)',     'Banner em tecido', 1),
('Tyvek',               'Papel sintético Tyvek para plotter', 1);

CREATE TABLE mapoteca.consumo_material (
    id SERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    -- INTEGER de proposito: material da mapoteca conta-se em UNIDADE (folha,
    -- cartucho, rolo), e meia folha nao existe. Em DECIMAL, a tela exibe
    -- "150,00" onde a pessoa escreveu 150 e sobra saldo de 0,01 que nunca fecha.
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    data_consumo DATE NOT NULL,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

CREATE TABLE mapoteca.estoque_material (
    id SERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    -- INTEGER pela mesma razao do consumo. Aceita zero: o estoque pode zerar.
    quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
    localizacao_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_localizacao (code),
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE,
    CONSTRAINT unique_material_por_localizacao UNIQUE (tipo_material_id, localizacao_id)
);

-- Anexos de arquivo do pedido: guarda o DOCUMENTO que originou a demanda
-- (DIEx/Ofício) e seus arquivos. Os bytes ficam no PRÓPRIO banco (coluna
-- conteudo BYTEA), seguindo o padrão do controle orçamentário (orcamento.arquivo);
-- a listagem devolve só os metadados, os bytes saem apenas no download. Um pedido
-- admite vários anexos. Usuario por UUID (convenção do acervo para tabelas novas).
CREATE TABLE mapoteca.tipo_anexo_pedido(
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_anexo_pedido (code, nome) VALUES
(1, 'Documento de solicitação (DIEx/Ofício)'),
(2, 'Anexo do documento de solicitação'),
(3, 'Comprovante de entrega/remessa'),
(4, 'Outros');

CREATE TABLE mapoteca.anexo_pedido(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    pedido_id BIGINT NOT NULL REFERENCES mapoteca.pedido (id) ON DELETE CASCADE,
    tipo_anexo_id SMALLINT NOT NULL DEFAULT 4 REFERENCES mapoteca.tipo_anexo_pedido (code),
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

CREATE INDEX idx_anexo_pedido_pedido ON mapoteca.anexo_pedido(pedido_id);

-- Etiqueta de envio por Correios do pedido, agora SALVA.
--
-- Etiqueta descartavel (montar o endereco a partir do pedido, imprimir e
-- esquecer a correcao digitada) faz quem tira a segunda via redigitar o mesmo
-- conserto, e nada prova o que foi colado no pacote.
--
-- UMA etiqueta por pedido (UNIQUE em pedido_id): ela e o endereco corrigido
-- daquele envio, e nao um historico de tentativas. Quem mudou o que, e quando,
-- sai de auditoria.evento com tabela = 'mapoteca.etiqueta_envio'.
--
-- Nao copia o endereco para o pedido de proposito: o pedido guarda o endereco
-- que veio no DIEx, e a etiqueta guarda o que foi para o pacote. Sobrescrever o
-- primeiro apagaria a prova do que o cliente pediu.
--
-- endereco e TEXT porque a etiqueta imprime uma linha por linha digitada.
-- Usuario por UUID, a convencao das tabelas novas (igual a anexo_pedido).
CREATE TABLE mapoteca.etiqueta_envio(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    pedido_id BIGINT NOT NULL REFERENCES mapoteca.pedido (id) ON DELETE CASCADE,
    destinatario VARCHAR(255) NOT NULL,
    aos_cuidados VARCHAR(255),
    endereco TEXT,
    cep VARCHAR(9),
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
    -- Nome explicito, e nao o que o Postgres geraria: o ON CONFLICT do upsert o
    -- cita, e a migracao tem de criar a constraint com o MESMO nome, senao
    -- instalacao nova diverge da migrada.
    CONSTRAINT unique_etiqueta_por_pedido UNIQUE (pedido_id)
);

-- NAO EXISTE `mapoteca.pedido_auditoria`. O rastro do pedido e `auditoria.evento`
-- (er/auditoria.sql, schema proprio).
--
-- A razao esta na coluna que ela teria: `pedido_id BIGINT NOT NULL` amarra o
-- historico ao pedido, e cliente, plotter, tipo de material, produto do acervo,
-- nota de empenho e usuario nao tem pedido nenhum. A tabela comum troca o pedido
-- por (modulo, entidade, entidade_id), e o pedido e um agregado entre outros --
-- o historico dele traz item, impressao e etiqueta juntos, pelo mapa de
-- `server/src/auditoria/mapa/mapoteca.js`.
--
-- A linha nasce no BACKEND, nunca em gatilho de banco, e quem cobra o
-- esquecimento e o teste de varredura mapoteca_auditoria.test.js.

-- Indexes para mapoteca
CREATE INDEX idx_pedido_situacao ON mapoteca.pedido(situacao_pedido_id);
CREATE INDEX idx_pedido_cliente ON mapoteca.pedido(cliente_id);
CREATE INDEX idx_pedido_data_pedido ON mapoteca.pedido(data_pedido);
CREATE INDEX idx_pedido_data_atendimento ON mapoteca.pedido(data_atendimento);
CREATE INDEX idx_pedido_meta_pit ON mapoteca.pedido(meta_pit_id);
CREATE INDEX idx_pedido_operacao ON mapoteca.pedido(operacao) WHERE operacao IS NOT NULL;
CREATE INDEX idx_pedido_palavras_chave ON mapoteca.pedido USING GIN (palavras_chave);
CREATE INDEX idx_produto_pedido_pedido ON mapoteca.produto_pedido(pedido_id);
CREATE INDEX idx_produto_pedido_uuid_versao ON mapoteca.produto_pedido(uuid_versao);
CREATE INDEX idx_consumo_material_tipo ON mapoteca.consumo_material(tipo_material_id);
CREATE INDEX idx_consumo_material_data ON mapoteca.consumo_material(data_consumo);
CREATE INDEX idx_estoque_material_tipo ON mapoteca.estoque_material(tipo_material_id);
CREATE INDEX idx_estoque_material_localizacao ON mapoteca.estoque_material(localizacao_id);

-- Trigger: consumo de material só pode ocorrer a partir do estoque na Seção (localizacao_id = 1)
-- Na inserção, decrementa o estoque da Seção; na deleção, restaura.
CREATE OR REPLACE FUNCTION mapoteca.trg_consumo_material_insert()
RETURNS TRIGGER AS $$
DECLARE
    estoque_atual DECIMAL(10, 2);
BEGIN
    -- Verificar se existe estoque na Seção para este tipo de material
    SELECT quantidade INTO estoque_atual
    FROM mapoteca.estoque_material
    WHERE tipo_material_id = NEW.tipo_material_id
      AND localizacao_id = 1  -- 1 = Seção
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Não há estoque na Seção para o material informado. O material deve primeiro ser transferido para a Seção antes de ser consumido.';
    END IF;

    IF estoque_atual < NEW.quantidade THEN
        RAISE EXCEPTION 'Estoque insuficiente na Seção. Disponível: %, Solicitado: %', estoque_atual, NEW.quantidade;
    END IF;

    -- Decrementar estoque na Seção
    UPDATE mapoteca.estoque_material
    SET quantidade = quantidade - NEW.quantidade,
        data_atualizacao = CURRENT_TIMESTAMP
    WHERE tipo_material_id = NEW.tipo_material_id
      AND localizacao_id = 1;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper: devolve quantidade ao estoque da Seção, criando a linha se não
-- existir (upsert atômico, sem o check-then-insert que perdia estoque ou
-- violava a UNIQUE sob concorrência)
CREATE OR REPLACE FUNCTION mapoteca.devolver_estoque_secao(
    p_tipo_material_id INTEGER,
    p_quantidade DECIMAL(10, 2),
    p_usuario_id INTEGER
) RETURNS void AS $$
BEGIN
    INSERT INTO mapoteca.estoque_material
        (tipo_material_id, quantidade, localizacao_id, usuario_criacao_id, usuario_atualizacao_id)
    VALUES (p_tipo_material_id, p_quantidade, 1, p_usuario_id, p_usuario_id)
    ON CONFLICT (tipo_material_id, localizacao_id)
    DO UPDATE SET quantidade = mapoteca.estoque_material.quantidade + EXCLUDED.quantidade,
                  data_atualizacao = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mapoteca.trg_consumo_material_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- Restaurar o estoque na Seção ao deletar um registro de consumo
    PERFORM mapoteca.devolver_estoque_secao(OLD.tipo_material_id, OLD.quantidade, OLD.usuario_criacao_id);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mapoteca.trg_consumo_material_update()
RETURNS TRIGGER AS $$
DECLARE
    estoque_atual DECIMAL(10, 2);
    diferenca DECIMAL(10, 2);
BEGIN
    -- Calcular a diferença (positiva = consumiu mais, negativa = consumiu menos)
    diferenca := NEW.quantidade - OLD.quantidade;

    -- Se a quantidade não mudou ou o tipo de material não mudou, verificar se precisa atualizar
    IF OLD.tipo_material_id = NEW.tipo_material_id THEN
        IF diferenca > 0 THEN
            -- Consumiu mais: verificar se há estoque suficiente na Seção
            SELECT quantidade INTO estoque_atual
            FROM mapoteca.estoque_material
            WHERE tipo_material_id = NEW.tipo_material_id
              AND localizacao_id = 1
            FOR UPDATE;

            IF NOT FOUND OR estoque_atual < diferenca THEN
                RAISE EXCEPTION 'Estoque insuficiente na Seção para atualizar o consumo. Disponível: %, Necessário adicionalmente: %', COALESCE(estoque_atual, 0), diferenca;
            END IF;

            UPDATE mapoteca.estoque_material
            SET quantidade = quantidade - diferenca,
                data_atualizacao = CURRENT_TIMESTAMP
            WHERE tipo_material_id = NEW.tipo_material_id
              AND localizacao_id = 1;
        ELSIF diferenca < 0 THEN
            -- Consumiu menos: devolver a diferença ao estoque da Seção
            -- (upsert: cria a linha se não existir, senão a devolução se perderia)
            PERFORM mapoteca.devolver_estoque_secao(NEW.tipo_material_id, ABS(diferenca), NEW.usuario_atualizacao_id);
        END IF;
    ELSE
        -- Tipo de material mudou: devolver o antigo e consumir o novo
        -- Devolver estoque do material antigo (upsert, idem acima)
        PERFORM mapoteca.devolver_estoque_secao(OLD.tipo_material_id, OLD.quantidade, NEW.usuario_atualizacao_id);

        -- Verificar e consumir do novo material
        SELECT quantidade INTO estoque_atual
        FROM mapoteca.estoque_material
        WHERE tipo_material_id = NEW.tipo_material_id
          AND localizacao_id = 1
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Não há estoque na Seção para o novo material informado.';
        END IF;

        IF estoque_atual < NEW.quantidade THEN
            RAISE EXCEPTION 'Estoque insuficiente na Seção para o novo material. Disponível: %, Solicitado: %', estoque_atual, NEW.quantidade;
        END IF;

        UPDATE mapoteca.estoque_material
        SET quantidade = quantidade - NEW.quantidade,
            data_atualizacao = CURRENT_TIMESTAMP
        WHERE tipo_material_id = NEW.tipo_material_id
          AND localizacao_id = 1;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consumo_material_insert
BEFORE INSERT ON mapoteca.consumo_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_consumo_material_insert();

CREATE TRIGGER trg_consumo_material_update
BEFORE UPDATE ON mapoteca.consumo_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_consumo_material_update();

CREATE TRIGGER trg_consumo_material_delete
AFTER DELETE ON mapoteca.consumo_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_consumo_material_delete();

COMMIT;
