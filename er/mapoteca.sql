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

-- O CODE 1 NAO EXISTE MAIS, e o buraco na numeracao e deliberado: ele era o
-- 'Pre cadastramento do pedido realizado', usado por ZERO dos 166 pedidos da
-- producao em 2026-08-08. Renumerar as outras seis reescreveria a situacao de
-- 166 pedidos para fechar uma lacuna que ninguem le, e o code de dominio e
-- justamente o que nao se renumera.
--
-- O 2 mudou de ROTULO em 2026-08-08 e nao de code: 'DIEx/Oficio do pedido
-- recebido' nomeava o documento em vez do fato, e o pedido de civil chega por
-- e-mail, sem DIEx nenhum.
INSERT INTO mapoteca.situacao_pedido (code, nome) VALUES
(2, 'Pedido Recebido'),
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
(8, 'Tyvek'),
(9, 'Sulfite 75g');

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
	tipo_cliente_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_cliente (code),

    -- A MESMA OM NAO SE CADASTRA DUAS VEZES.
    --
    -- Ate 2026-08-11 nada impedia, e a producao tinha o caso: o 3o GAC Ap em
    -- duas linhas, com um pedido concluido em cada. Nada dava erro. O que
    -- quebrava era calado -- a contagem de "OM distintas atendidas" respondia 68
    -- onde a resposta era 67, o historico da unidade aparecia partido em duas
    -- fichas, e o endereco da proxima entrega dependia de qual das duas o
    -- operador escolhesse numa lista onde as duas se chamam igual.
    --
    -- NULLS NOT DISTINCT, e e o que faz a restricao valer para TODO cliente.
    -- `sigla` e NULA para quem nao e OM (orgao publico, cidadao da LAI), e no
    -- UNIQUE comum do Postgres NULO nao casa nem consigo mesmo: sem esta
    -- clausula, dois cadastros identicos de orgao civil passariam direto e a
    -- restricao so protegeria quem tem sigla. Exige PostgreSQL 15 ou mais novo.
    --
    -- O QUE ELA NAO PEGA, e e preciso dizer: grafia diferente do mesmo nome
    -- ('3o GAC Ap' e '3º GAC Ap') sao dois textos distintos e passam as duas.
    -- Ela fecha a repeticao EXATA, que e o caso que aconteceu; o quase-homonimo
    -- continua sendo trabalho de quem cadastra.
    --
    -- Nome explicito, e nao o que o Postgres geraria: a migracao cria a
    -- constraint com o MESMO nome, senao instalacao nova divergiria da migrada
    -- e o ensaiar_migracao.cjs reprovaria.
    CONSTRAINT unique_cliente_nome_sigla UNIQUE NULLS NOT DISTINCT (nome, sigla)
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
    -- O contato DELES: o oficial da OM que pediu, e por quem a mapoteca liga
    -- para destravar uma entrega.
    ponto_contato VARCHAR(255),
    -- O contato NOSSO, para o solicitante tirar duvida. E PUBLICO: sai na
    -- consulta por localizador, sem login, e por isso anotacao interna continua
    -- em observacao_interna.
    -- E por PEDIDO, e nao em dgeo.instituicao, porque quem atende MUDA: um
    -- pedido de junho respondido em setembro tem de continuar apontando para
    -- quem o atendeu, e campo global reescreveria a historia de todos a cada
    -- troca de funcao. Instalacao existente chega aqui pela migracao
    -- 2026-08-19_a_quem_o_solicitante_pergunta.sql.
    contato_mapoteca VARCHAR(255),
    documento_solicitacao VARCHAR(255),
    documento_solicitacao_nup VARCHAR(255),
	endereco_entrega TEXT,
    -- Como o material saiu daqui. E do PEDIDO, e nao do item: o pedido inteiro
    -- sai numa remessa so, e item com forma propria e caso raro.
    -- Item entregue por outra forma se anota em observacao_envio, que o cliente
    -- le. Instalacao existente chega aqui pela migracao
    -- 2026-07-30_entrega_no_pedido.sql, que aplica a maioria por contagem.
    forma_entrega_id SMALLINT REFERENCES mapoteca.forma_entrega (code),
    -- ETIQUETAS do pedido, e o filtro de busca da lista casa por elas.
    -- VARCHAR[] com indice GIN (idx_pedido_palavras_chave, no fim deste
    -- arquivo), entao a busca e por CONTINENCIA de elemento (`@>`) e nunca por
    -- ILIKE: o opclass `array_ops` so responde a `@>`, `<@`, `&&` e `=`, e um
    -- ILIKE sobre unnest varreria a tabela inteira com o indice ao lado.
    palavras_chave VARCHAR[] NOT NULL DEFAULT '{}',
    operacao TEXT,
    prazo DATE,
    demandante VARCHAR(255),
    -- SEM `omds`. A coluna existiu ate 2026-08-08 e guardava a OM Diretamente
    -- Subordinada responsavel pelo atendimento; media 124 linhas preenchidas e
    -- UM unico valor distinto em todas ('1º CGEO'), ou seja, uma constante
    -- disfarcada de coluna. Quem preenche a coluna "OMDS" do RTM e o proprio
    -- 1º CGEO, e isso nao e dado de pedido.
    previsto_pit BOOLEAN NOT NULL DEFAULT FALSE,
    -- Item do PIT que o pedido atende, por chave estrangeira para
    -- `pit.meta_item` e nunca por codigo digitado a mao ('4.1'). NAO se deriva
    -- do material: a correlacao entre midia e meta vale num ano e o PIT e
    -- reescrito todo ano e a numeracao muda com ele.
    --
    -- O ITEM, e nao o grupo: o pedido cumpre a 4.1 ou a 4.2, e a Meta 4
    -- sozinha nao diz em que papel nem quanto.
    meta_pit_id BIGINT REFERENCES pit.meta_item (id),
    -- O MES EM QUE ESTE PEDIDO PROMETE SER IMPRESSO, e de onde sai o PLANEJADO
    -- da meta 4 do PIT: a soma de `produto_pedido.quantidade` dos pedidos
    -- ligados a meta, agrupada pelo mes daqui.
    --
    -- OS DOIS NUMEROS SAEM DAQUI, e a midia nao roteia nada. O prometido e o
    -- entregue estao os dois no ITEM deste pedido, e a unica diferenca e a data:
    -- `data_prevista` da o mes do planejado e `data_atendimento` da o do
    -- realizado. E a mesma regra da producao e da capacitacao.
    --
    -- HOUVE UM DE-PARA DE MIDIA fazendo o papel do realizado, e ele foi removido
    -- em 2026-08-05 por MEDICAO: ele contava o TIPO DE PAPEL, e nao a meta. A
    -- 4.1 de 2026 recebia 6.493 folhas contra 327 prometidas, porque todo
    -- sulfite entrava ali, inclusive o de pedido que nada tem a ver com o PIT. E
    -- a 4.2 recebia ZERO, porque nenhuma folha saiu em tyvek e as dela foram
    -- atendidas em sulfite, indo parar na 4.1.
    --
    -- NAO E `prazo`, que e o limite imposto pelo CLIENTE. Medido em 2026-08-05:
    -- `prazo` esta preenchido em 33 dos 164 pedidos e em NENHUM dos 16 ligados a
    -- meta. A promessa que a DGEO faz e a exigencia que o cliente impoe sao
    -- coisas diferentes, e uma nao serve de substituta da outra.
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
COMMENT ON COLUMN mapoteca.pedido.palavras_chave IS
    'Etiquetas do pedido, para agrupar pedidos do mesmo assunto quando NENHUMA outra coluna já o faz. Consultadas pelo filtro da lista por continência (@>), que é o que o índice GIN atende; ILIKE não o usaria, e por isso a busca casa a etiqueta inteira e diferencia maiúscula. O cadastro sugere as etiquetas já usadas (GET /pedido/palavras_chave) e etiqueta nova nasce pela tela. NÃO etiquete o que já tem coluna: cliente, documento, operacao, previsto_pit e o lugar, que mora na observação. Podada em 2026-08-11 de 34 grafias para uma (excedente).';
COMMENT ON COLUMN mapoteca.pedido.previsto_pit IS
    'Pedido previsto no Plano Interno de Trabalho (PIT vs Extra-PIT).';
COMMENT ON COLUMN mapoteca.pedido.meta_pit_id IS
    'Item do PIT que o pedido atende (pit.meta_item). Obrigatório quando previsto_pit é verdadeiro, nulo caso contrário. NÃO se deriva do material: a correlação valeu só em 2026.';
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
    -- SEM `quantidade_fornecida`. A coluna existiu ate 2026-08-08 e prometia
    -- guardar "quanto se entregou de fato"; medida na producao, era IGUAL a
    -- `quantidade` em 1759 de 1759 linhas preenchidas, ZERO divergencias. Quem
    -- guarda o que de fato saiu da impressora e `mapoteca.impressao_item`, com
    -- data e autor de cada sessao.
    --
    -- ATENCAO: a gemea abaixo NAO caiu junto, e o sufixo igual e coincidencia.
    tipo_midia_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_midia (code),
    -- A midia FICA, e e o contrario da quantidade: 25 itens foram pedidos numa
    -- midia e atendidos noutra (tyvek pedido, sulfite entregue). Divergencia
    -- real, medida, que so esta coluna registra.
    tipo_midia_fornecida_id SMALLINT REFERENCES mapoteca.tipo_midia (code),
    -- A meta do PIT que ESTE item cumpre, quando difere da declarada no pedido.
    --
    --     NULL       -> o item cumpre a meta do pedido;
    --     preenchida -> o item cumpre esta, e nao a do pedido.
    --
    -- O NULL nunca e ambiguo, porque quem diz se o pedido e do PIT continua
    -- sendo `pedido.previsto_pit`. Quem le usa
    -- COALESCE(pp.meta_pit_id, p.meta_pit_id).
    --
    -- POR QUE O ITEM PRECISA DISTO. A Meta 4 de 2026 se divide por MATERIAL
    -- (sulfite 327 na 4.1, tyvek 247 na 4.2, glossy 36 na 4.3), e o material e
    -- `tipo_midia_id`, que e do item. Dos 16 pedidos ligados a Meta 4, dois sao
    -- MISTOS: o 140 tem 8 folhas em tyvek e 32 em sulfite, e o 154 tem 4 e 20.
    -- Com a meta so no pedido, as 12 folhas de tyvek caiam na 4.1.
    --
    -- NAO SE DERIVA DO MATERIAL, e a distincao importa: o de-para de midia para
    -- meta existiu e foi removido em 2026-08-05 por medicao (contava o TIPO DE
    -- PAPEL, e jogava na 4.1 todo sulfite do ano). O vinculo continua
    -- DECLARADO; o material so explica por que ele cabe no item.
    meta_pit_id BIGINT REFERENCES pit.meta_item (id),
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

COMMENT ON COLUMN mapoteca.produto_pedido.meta_pit_id IS
    'Item do PIT que ESTE item cumpre, quando difere do declarado no pedido (pit.meta_item). NULL significa "o mesmo do pedido", e não "fora do PIT": quem diz isso é pedido.previsto_pit. Existe porque a Meta 4 se divide por material e o material é do item: o pedido 140 tem 8 folhas em tyvek (4.2) e 32 em sulfite (4.1).';

-- A leitura da execução do PIT filtra por esta coluna em toda consulta da
-- impressão (planejado, realizado e diagnóstico do cadastro).
CREATE INDEX idx_produto_pedido_meta_pit ON mapoteca.produto_pedido(meta_pit_id);
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

-- AQUI NAO HA PLOTTER, E ELE NAO FOI ESQUECIDO.
--
-- `mapoteca.plotter` e `mapoteca.manutencao_plotter` existiram ate 2026-08-13, e
-- sairam vazias: zero linhas em cada uma na producao, e zero eventos em
-- `auditoria.evento` desde que a auditoria existe. Elas nasceram porque quem
-- conserta o plotter e quem atende a mapoteca, numa epoca em que a Divisao nao
-- tinha onde guardar bem nenhum.
--
-- O plotter e EQUIPAMENTO, e mora em `er/equipamento.sql`: 5 dos 105 bens, do
-- tipo 'Impressora de Grande Formato (Plotter)', com numero de patrimonio,
-- classe de suprimento e secao detentora que aqui nao havia onde escrever. A
-- manutencao dele e `equipamento.manutencao`, que guarda `data_fim`,
-- `valor_orcado`, `valor_pdr` e o vinculo com a indisponibilidade da subsecao
-- 7.1 do RPCMTec.
--
-- O que a mapoteca guarda de impressao continua aqui, e e outra coisa: os
-- INSUMOS (cartucho, papel, cabecote) em `tipo_material` e no livro de
-- movimentos, e o que saiu da impressora em `impressao_item`.

CREATE TABLE mapoteca.tipo_material (
    id SERIAL PRIMARY KEY,
    -- A UNIDADE VAI NO NOME ("Papel Sulfite 120g" sao rolos de 50 m, e
    -- "Cartucho MK - T730" e unidade avulsa). NAO existe coluna `unidade`, e a
    -- decisao e do chefe: uma coluna a mais so para rotular nao paga o preco de
    -- ser preenchida em 34 linhas e de rotular errado na primeira que ninguem
    -- revisar.
    --
    -- PENDENCIA CONHECIDA, e ela nasceu com a fusao das tabelas 7.2 e 7.3: a
    -- 7.2 do RPCMTec agora soma ROLO e CARTUCHO na mesma coluna "Estoque
    -- atual". O numero total daquela coluna nao tem significado fisico, e cada
    -- LINHA continua tendo. Se um dia isso incomodar, o conserto e a unidade
    -- virar dado, e nao a tabela voltar a se partir em duas.
    --
    -- UNICO, e nao so por higiene: a 7.2 casa a linha do MES ANTERIOR pelo
    -- NOME (o id do material nunca vai para o documento assinado, e nao
    -- deveria ir). Com a fusao, papel e tinta passaram a dividir um espaco de
    -- nomes so, e dois materiais homonimos fariam a coluna "Estoque mes
    -- anterior" pegar o saldo do outro sem erro nenhum.
    nome VARCHAR(100) NOT NULL,
    descricao TEXT,
    -- INTEIRO: e quantidade do MESMO material contado em unidade, entao segue a
    -- regra do estoque e do livro de movimentos.
    estoque_minimo INTEGER,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    -- Nome explicito, e nao o que o Postgres geraria: a migracao cria a
    -- constraint com o MESMO nome, senao instalacao nova divergiria da migrada
    -- e o ensaiar_migracao.cjs reprovaria.
    CONSTRAINT unique_tipo_material_nome UNIQUE (nome)
);

-- NAO EXISTEM MAIS `categoria_id`, `tipo_midia_id` e `meta_anual`, desde
-- 2026-08-08 (ver migrations/2026-08-08_livro_de_movimentos.sql):
--
--   categoria_id   so decidia entre a 7.2 (Papel) e a 7.3 (Tintas) do RPCMTec,
--                  e o chefe fundiu as duas na 7.2. Classificar para um recorte
--                  que nao existe mais e trabalho que so pode errar.
--   tipo_midia_id  era a ponte impressao -> consumo, e a ponte MORREU: produto
--                  impresso e rolo de papel sao coisas separadas. Com ela caiu
--                  `quantidade_impressa`, o numero de conferencia que so
--                  existia porque a ponte existira.
--   meta_anual     nunca teve leitor de verdade e estava NULA nas 34 linhas da
--                  producao em 2026-08-08.
--
-- Caiu junto o CHECK `midia_so_para_papel` e o indice `unique_material_por_midia`,
-- que so faziam sentido enquanto as duas colunas existiam.

COMMENT ON COLUMN mapoteca.tipo_material.nome IS
    'Nome do insumo, com a UNIDADE embutida (rolo, cartucho, folha). Único: a 7.2 do RPCMTec casa o mês anterior pelo nome.';
COMMENT ON COLUMN mapoteca.tipo_material.estoque_minimo IS
    'Limiar para alertar estoque baixo na UI (badge). NULL = sem alerta. Compara-se contra Seção + Almoxarifado, e não contra o total: o que está em Aquisição realizada ou em Saldo no empenho ainda não chegou aqui.';

-- Seed do controle de material de impressão (referência: planilha "Controle de
-- Material de Impressão" da Seção; dados de implantação no CLAUDE.md raiz).
--
-- SEM CATEGORIA E SEM MIDIA: as duas colunas sairam em 2026-08-08. A ordem e a
-- do catálogo real, e não a de nenhum agrupamento: a 7.2 fundida lista TODO
-- material ativo, em ordem de nome.

-- Cartuchos Plotter T730
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
('Cartucho CY - T730',         'Cartucho Ciano para plotter HP T730 (P2V62A)'),
('Cartucho MG - T730',         'Cartucho Magenta para plotter HP T730 (P2V63A)'),
('Cartucho Y - T730',          'Cartucho Yellow para plotter HP T730 (P2V64A)'),
('Cartucho MK - T730',         'Cartucho Matte Black 130ml para plotter HP T730 (P2V65A)'),
('Cartucho MK - T730 300ml',   'Cartucho Matte Black 300ml para plotter HP T730'),
('Cartucho GR - T730',         'Cartucho Gray para plotter HP T730 (P2V66A)'),
('Cartucho GR - T730 300ml',   'Cartucho Gray 300ml para plotter HP T730'),
('Cartucho PK - T730',         'Cartucho Photo Black para plotter HP T730 (P2V67A)');

-- Cartuchos HP M470
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
('Cartucho Black - HP M470',   'Cartucho Black para impressora HP M470 (W2020XC)'),
('Cartucho Ciano - HP M470',   'Cartucho Ciano para impressora HP M470 (W2021XC)'),
('Cartucho Magenta - HP M470', 'Cartucho Magenta para impressora HP M470 (W2023XC)'),
('Cartucho Yellow - HP M470',  'Cartucho Yellow para impressora HP M470 (W2022XC)');

-- Cabeçotes: são peça de reposição do plotter, e não insumo de impressão. Eles
-- SAEM na 7.2 desde a fusão, porque a decisão do chefe é que a tabela liste todo
-- material ativo: o que se controla ali é o estoque da Seção, e o cabeçote
-- acaba do mesmo jeito que o cartucho.
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
('Cabeçote Universal',   'Cabeçote Universal novo (P2V27A, ficha C2982)'),
('Cabeçote MK/Y usado',  'Cabeçote MK/Y reutilizado'),
('Cabeçote CY/MG usado', 'Cabeçote CY/MG reutilizado'),
('Cabeçote G/PK usado',  'Cabeçote G/PK reutilizado');

-- Papéis. O banner de tecido entra aqui: o RPCMTec o lista como "Papel Tecido",
-- porque o que se controla é a MÍDIA em que se imprime, e não a fibra.
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
('Papel Sulfite 75g',   'Papel sulfite 75g/m² para plotter'),
('Papel Sulfite 90g',   'Papel sulfite 90g/m² para plotter'),
('Papel Sulfite 120g',  'Papel sulfite 120g/m² para plotter (rolo de 50 m)'),
('Papel Glossy',        'Papel glossy para plotter'),
('Banner (tecido)',     'Banner em tecido'),
('Tyvek',               'Papel sintético Tyvek para plotter');

-- O LIVRO DE MOVIMENTOS do material, e por que ele é UMA tabela
--
-- Até 2026-08-07 havia três portas mexendo no saldo, e nenhuma delas guardava
-- data: `POST /estoque_material` (upsert que REDEFINIA a quantidade),
-- `POST /estoque_material/transferir` (dois UPDATEs) e `mapoteca.consumo_material`
-- (a única com data, e a única que virava histórico). O saldo era o único
-- registro do que acontecera, e ele não responde "quando" nem "por quê".
--
-- Os TRÊS tipos são as três coisas que de fato acontecem com o material: ele
-- CHEGA (Entrada), MUDA de lugar (Transferência) e ACABA (Consumo).
--
-- NÃO EXISTE AJUSTE DE SALDO, e a ausência é a regra (decisão do chefe em
-- 2026-08-08). Houve um quarto tipo, Contagem, que lançava a diferença entre a
-- prateleira e o sistema, e ele saiu: o saldo tem de estar certo por Entrada,
-- Transferência e Consumo, e nada mais. O que se contava como Contagem passa a
-- ter o tipo do que de fato aconteceu -- faltou na prateleira é Consumo, sobrou
-- é Entrada -- e a consequência foi aceita junto com a decisão: quebra e
-- extravio entram na 7.2 do RPCMTec como gasto, porque não há mais onde separar
-- um do outro.
--
-- Erro de LANÇAMENTO não é caso disto: ele se conserta editando ou apagando a
-- linha errada do livro, e os gatilhos de UPDATE e DELETE desfazem o efeito
-- dela no saldo. Somar um ajuste em cima seria guardar duas linhas para um
-- evento que nunca houve.
--
-- UMA TABELA, e não três: o que se pergunta é "o que aconteceu com este
-- material", em ordem de data. Em três tabelas essa pergunta vira um UNION
-- que alguém esquece de estender no dia em que nascer o quarto tipo.
CREATE TABLE mapoteca.tipo_movimento_material(
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

-- SÃO TRÊS, e o code 4 NÃO EXISTE. Ele foi a Contagem, extinta em 2026-08-08, e
-- por algumas horas ele sobreviveu aqui como "Contagem (extinta)" para que a
-- auditoria antiga se traduzisse. Esse histórico foi MEDIDO no mesmo dia e não
-- existe: zero linhas de tipo 4 em `movimento_material`, zero eventos citando 4
-- em `auditoria.evento`, e no dump de produção de 2026-08-08 a tabela do livro
-- nem estava criada (o livro nasceu na 1.41.0, depois dele). A conversão feita
-- pela `2026-08-08_fim_da_contagem.sql` também não escreve evento: ela troca o
-- tipo direto, com UPDATE.
--
-- Uma linha de domínio guardada para um passado que não chegou a acontecer não
-- é prudência: é um valor que só pode confundir quem ler a tabela. Quem recusa
-- lançar continua sendo o CHECK de forma logo abaixo, mais o Joi de
-- `mapoteca_schema.js` -- e agora a FK também, porque não há para onde apontar.
INSERT INTO mapoteca.tipo_movimento_material (code, nome) VALUES
(1, 'Entrada'),
(2, 'Transferência'),
(3, 'Consumo');

CREATE TABLE mapoteca.movimento_material (
    id BIGSERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    tipo_movimento_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_movimento_material (code),
    -- INTEGER de proposito: material da mapoteca conta-se em UNIDADE (folha,
    -- cartucho, rolo), e meia folha nao existe. Em DECIMAL, a tela exibe
    -- "150,00" onde a pessoa escreveu 150 e sobra saldo de 0,01 que nunca fecha.
    --
    -- SEMPRE POSITIVA: o SENTIDO nao mora no sinal, mora em qual dos dois lados
    -- esta preenchido. Quantidade negativa e um segundo jeito de dizer a mesma
    -- coisa, e dois jeitos e o que faz duas consultas discordarem.
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    -- DIA de calendário, e não instante: quem lança escolhe o dia em que o
    -- material entrou ou saiu, e todo consumidor exibe o dia. Em TIMESTAMPTZ a
    -- data atravessaria o fuso da sessão e decidiria o MÊS do RPCMTec pelo fuso.
    data_movimento DATE NOT NULL,
    -- DE ONDE o material saiu, e PARA ONDE foi. Nulo quer dizer "de fora" ou
    -- "para fora" do controle: a Entrada vem de fora e o Consumo vai para fora.
    localizacao_origem_id SMALLINT REFERENCES mapoteca.tipo_localizacao (code),
    localizacao_destino_id SMALLINT REFERENCES mapoteca.tipo_localizacao (code),
    motivo TEXT,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE,
    -- A FORMA DE CADA TIPO, num CHECK só, porque as três regras são a mesma
    -- pergunta: quais lados esta linha tem de ter.
    --
    --   Entrada        o material CHEGA: não tem origem, e tem destino.
    --   Transferência  MUDA de lugar: tem os dois, e eles têm de diferir. Sem o
    --                  `<>`, uma transferência de A para A somaria e subtrairia
    --                  o mesmo saldo e passaria por lançamento válido.
    --   Consumo        SÓ DA SEÇÃO (code 1) e para fora. Era um IF dentro do
    --                  gatilho, e subiu para cá: o gatilho recusava e o banco
    --                  aceitava a linha em qualquer outra porta. As localizações
    --                  são ETAPAS da vida do material, e não prateleiras --
    --                  consumir de "Saldo no empenho" seria gastar, no papel, o
    --                  que ainda está com o fornecedor.
    --
    -- O `ELSE FALSE` RECUSA O CODE 4, e ele não é sobra de escrita.
    --
    -- A frase aqui dizia que "a linha da Contagem continua no domínio, então a
    -- FK a aceitaria". Isso valeu por algumas horas, na 1.45.0. Em 2026-08-08 a
    -- linha SAIU do domínio (1.48.0), e desde então a FK também a recusa: hoje
    -- são DUAS trancas, e não uma. O CHECK continua sendo a que se lê no erro,
    -- porque ele é avaliado durante o INSERT e o gatilho da FK só depois.
    --
    -- O nome e o mesmo da migracao, senao instalacao nova divergiria da migrada.
    CONSTRAINT movimento_material_forma CHECK (
        CASE tipo_movimento_id
            WHEN 1 THEN localizacao_origem_id IS NULL
                    AND localizacao_destino_id IS NOT NULL
            WHEN 2 THEN localizacao_origem_id IS NOT NULL
                    AND localizacao_destino_id IS NOT NULL
                    AND localizacao_origem_id <> localizacao_destino_id
            WHEN 3 THEN localizacao_origem_id = 1
                    AND localizacao_destino_id IS NULL
            ELSE FALSE
        END
    )
);

COMMENT ON TABLE mapoteca.movimento_material IS
    'Livro de movimentos do material: Entrada, Transferência e Consumo, cada linha com data. O saldo de mapoteca.estoque_material é o acumulado deste livro, aplicado por gatilho, e não há ajuste: o saldo se corrige pelo movimento que de fato aconteceu.';
COMMENT ON COLUMN mapoteca.movimento_material.motivo IS
    'Por que o movimento aconteceu. Sempre opcional: a Entrada tem nota, a Transferência tem quem carregou e o Consumo tem o trabalho que o gastou.';

CREATE INDEX idx_movimento_material_tipo_material ON mapoteca.movimento_material(tipo_material_id);
CREATE INDEX idx_movimento_material_data ON mapoteca.movimento_material(data_movimento);
CREATE INDEX idx_movimento_material_tipo_movimento ON mapoteca.movimento_material(tipo_movimento_id);

-- O SALDO, e por que ele continua sendo TABELA e não virou VIEW
--
-- Desde 2026-08-08 esta tabela é DERIVADA: quem a escreve é o gatilho do livro
-- de movimentos, e não mais três rotas. A tentação óbvia era transformá-la numa
-- view sobre a soma do livro, e ela foi recusada por uma razão: são o
-- `CHECK (quantidade >= 0)` e a `UNIQUE (tipo_material_id, localizacao_id)`
-- desta tabela que RECUSAM o consumo sem saldo. Numa view, o livro aceitaria a
-- linha e o saldo simplesmente ficaria negativo -- a recusa migraria para um
-- IF dentro do gatilho, que é justamente o lugar de onde a regra do Consumo
-- acabou de sair.
CREATE TABLE mapoteca.estoque_material (
    id SERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    -- INTEGER pela mesma razao do livro. Aceita zero: o estoque pode zerar.
    --
    -- O CHECK e a ULTIMA guarda, e nao a primeira: o gatilho do livro confere o
    -- saldo com FOR UPDATE e recusa com uma frase que ensina o conserto. Sob
    -- corrida, duas transacoes podem passar pela conferencia e so uma pelo
    -- CHECK, e e assim que tem de ser.
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
-- historico ao pedido, e cliente, tipo de material, produto do acervo,
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
-- GIN com o opclass default de VARCHAR[] (`array_ops`), que responde a `@>`,
-- `<@`, `&&` e `=`. E o que o filtro `palavra_chave` de GET /pedido usa, e a
-- razao de aquele filtro ser por etiqueta INTEIRA e nao por pedaco de palavra:
-- um ILIKE sobre unnest(palavras_chave) leria a tabela toda com o indice aqui
-- do lado, sem tocar nele.
CREATE INDEX idx_pedido_palavras_chave ON mapoteca.pedido USING GIN (palavras_chave);
CREATE INDEX idx_produto_pedido_pedido ON mapoteca.produto_pedido(pedido_id);
CREATE INDEX idx_produto_pedido_uuid_versao ON mapoteca.produto_pedido(uuid_versao);
CREATE INDEX idx_estoque_material_tipo ON mapoteca.estoque_material(tipo_material_id);
CREATE INDEX idx_estoque_material_localizacao ON mapoteca.estoque_material(localizacao_id);

-- O SALDO É O ACUMULADO DO LIVRO, e quem o aplica é o gatilho
--
-- Uma linha do livro mexe em NO MÁXIMO dois saldos, e a regra é a mesma para os
-- três tipos: o que está em `localizacao_origem_id` SAI, e o que está em
-- `localizacao_destino_id` ENTRA. É por isso que o sentido não mora no sinal da
-- quantidade -- com três tipos e um sinal, haveria seis combinações a
-- interpretar, e só três delas fariam sentido.
--
-- NÃO EXISTE MAIS `mapoteca.consumo_material` nem
-- `mapoteca.devolver_estoque_secao`. A primeira virou o tipo 3 do livro; a
-- segunda era a metade "devolve" de três gatilhos que agora são um só.

CREATE OR REPLACE FUNCTION mapoteca.aplicar_saldo_material(
    p_tipo_material_id INTEGER,
    p_localizacao_id SMALLINT,
    p_quantidade INTEGER,
    p_entra BOOLEAN,
    p_usuario_id INTEGER
) RETURNS void AS $$
DECLARE
    v_saldo INTEGER;
    v_local TEXT;
    v_material TEXT;
BEGIN
    -- Lado ausente: a Entrada não tem origem e o Consumo não tem destino.
    IF p_localizacao_id IS NULL THEN
        RETURN;
    END IF;

    IF p_entra THEN
        -- Upsert atômico. O check-then-insert perdia estoque sob concorrência,
        -- ou violava a UNIQUE.
        INSERT INTO mapoteca.estoque_material
            (tipo_material_id, quantidade, localizacao_id,
             usuario_criacao_id, usuario_atualizacao_id)
        VALUES (p_tipo_material_id, p_quantidade, p_localizacao_id,
                p_usuario_id, p_usuario_id)
        ON CONFLICT (tipo_material_id, localizacao_id)
        DO UPDATE SET quantidade = mapoteca.estoque_material.quantidade + EXCLUDED.quantidade,
                      usuario_atualizacao_id = EXCLUDED.usuario_atualizacao_id,
                      data_atualizacao = CURRENT_TIMESTAMP;
        RETURN;
    END IF;

    -- SAÍDA. O FOR UPDATE serializa duas saídas simultâneas do mesmo saldo.
    SELECT quantidade INTO v_saldo
    FROM mapoteca.estoque_material
    WHERE tipo_material_id = p_tipo_material_id
      AND localizacao_id = p_localizacao_id
    FOR UPDATE;

    SELECT nome INTO v_local
    FROM mapoteca.tipo_localizacao WHERE code = p_localizacao_id;
    SELECT nome INTO v_material
    FROM mapoteca.tipo_material WHERE id = p_tipo_material_id;

    -- A MENSAGEM ENSINA O CONSERTO, e não só nomeia a recusa. Quem lança consumo
    -- de um material que está no Almoxarifado precisa saber que o caminho é
    -- transferir para a Seção antes, e não que "houve um erro".
    IF v_saldo IS NULL THEN
        RAISE EXCEPTION
            '% não tem estoque em %. Transfira o material para lá antes de lançar esta saída, ou lance primeiro a Entrada que o trouxe.',
            COALESCE(v_material, 'O material'), COALESCE(v_local, 'essa localização');
    END IF;

    IF v_saldo < p_quantidade THEN
        RAISE EXCEPTION
            'Estoque insuficiente de % em %. Disponível: %, solicitado: %. Transfira mais material para lá ou corrija a quantidade do movimento.',
            COALESCE(v_material, 'material'), COALESCE(v_local, 'essa localização'),
            v_saldo, p_quantidade;
    END IF;

    UPDATE mapoteca.estoque_material
    SET quantidade = quantidade - p_quantidade,
        usuario_atualizacao_id = p_usuario_id,
        data_atualizacao = CURRENT_TIMESTAMP
    WHERE tipo_material_id = p_tipo_material_id
      AND localizacao_id = p_localizacao_id;
END;
$$ LANGUAGE plpgsql;

-- UM gatilho para as três operações, e não três funções.
--
-- Alterar um movimento é DESFAZER o antigo e APLICAR o novo, nesta ordem: o
-- contrário deixa passar a alteração que aumenta o consumo além do saldo mas
-- caberia depois da devolução. Os três antigos gatilhos de `consumo_material`
-- tinham essa lógica escrita três vezes, e o de UPDATE tinha um ramo próprio só
-- para "o material mudou" -- aqui isso é o caso geral, sem ramo nenhum.
--
-- AFTER, e não BEFORE: quando o gatilho roda, os CHECKs da linha já a
-- aprovaram, então a forma do movimento (Consumo só da Seção, Transferência com
-- os dois lados diferentes) nunca precisa ser reconferida aqui.
--
-- O DESFAZER É O QUE CONSERTA LANÇAMENTO ERRADO, e é a razão de não haver tipo
-- de ajuste no livro: corrigir a linha errada devolve o saldo exato, e não
-- acrescenta ao livro um evento que nunca aconteceu.
CREATE OR REPLACE FUNCTION mapoteca.trg_movimento_material()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        -- Desfaz o movimento antigo: o que tinha saído volta, e o que tinha
        -- entrado sai.
        PERFORM mapoteca.aplicar_saldo_material(
            OLD.tipo_material_id, OLD.localizacao_origem_id, OLD.quantidade,
            TRUE, OLD.usuario_criacao_id);
        PERFORM mapoteca.aplicar_saldo_material(
            OLD.tipo_material_id, OLD.localizacao_destino_id, OLD.quantidade,
            FALSE, OLD.usuario_criacao_id);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM mapoteca.aplicar_saldo_material(
            NEW.tipo_material_id, NEW.localizacao_origem_id, NEW.quantidade,
            FALSE, NEW.usuario_atualizacao_id);
        PERFORM mapoteca.aplicar_saldo_material(
            NEW.tipo_material_id, NEW.localizacao_destino_id, NEW.quantidade,
            TRUE, NEW.usuario_atualizacao_id);
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_movimento_material_insert
AFTER INSERT ON mapoteca.movimento_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_movimento_material();

CREATE TRIGGER trg_movimento_material_update
AFTER UPDATE ON mapoteca.movimento_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_movimento_material();

CREATE TRIGGER trg_movimento_material_delete
AFTER DELETE ON mapoteca.movimento_material
FOR EACH ROW
EXECUTE FUNCTION mapoteca.trg_movimento_material();

COMMIT;
