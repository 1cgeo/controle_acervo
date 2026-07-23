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
	data_pedido TIMESTAMP WITH TIME ZONE NOT NULL,
    data_atendimento TIMESTAMP WITH TIME ZONE,
	cliente_id BIGINT NOT NULL REFERENCES mapoteca.cliente (id),
	situacao_pedido_id SMALLINT NOT NULL REFERENCES mapoteca.situacao_pedido (code),
    ponto_contato VARCHAR(255),
    documento_solicitacao VARCHAR(255),
    documento_solicitacao_nup VARCHAR(255),
	endereco_entrega TEXT,
    palavras_chave VARCHAR[] NOT NULL DEFAULT '{}',
    operacao TEXT,
    prazo DATE,
    demandante VARCHAR(255),
    omds VARCHAR(255),
    previsto_pit BOOLEAN NOT NULL DEFAULT FALSE,
    -- Campos de pedido de CIVIL (LAI/órgão/empresa/pessoa); NULL para OM.
    canal_recebimento_id SMALLINT REFERENCES mapoteca.canal_recebimento (code),
    municipio VARCHAR(255),
    qtd_imagens INTEGER CHECK (qtd_imagens IS NULL OR qtd_imagens >= 0),
    observacao TEXT,
    observacao_envio TEXT,
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
        CHECK (situacao_pedido_id <> 5 OR data_atendimento IS NOT NULL)
);

COMMENT ON COLUMN mapoteca.pedido.demandante IS
    'Quem encaminhou o pedido (ex: CMS encaminhando pedido do 18º BI Mtz).';
COMMENT ON COLUMN mapoteca.pedido.omds IS
    'OM Diretamente Subordinada responsável pelo atendimento (ex: 1º CGEO).';
COMMENT ON COLUMN mapoteca.pedido.previsto_pit IS
    'Pedido previsto no Plano Interno de Trabalho (PIT vs Extra-PIT).';

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
    uuid_versao UUID NOT NULL REFERENCES acervo.versao (uuid_versao),
	pedido_id BIGINT NOT NULL REFERENCES mapoteca.pedido (id),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    quantidade_fornecida INTEGER
        CHECK (quantidade_fornecida IS NULL OR quantidade_fornecida >= 0),
    tipo_midia_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_midia (code),
    tipo_midia_fornecida_id SMALLINT REFERENCES mapoteca.tipo_midia (code),
    forma_entrega_id SMALLINT REFERENCES mapoteca.forma_entrega (code),
    data_entrega DATE,
    observacao TEXT,
    producao_especifica BOOLEAN NOT NULL DEFAULT FALSE,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

COMMENT ON COLUMN mapoteca.produto_pedido.quantidade_fornecida IS
    'Quantidade efetivamente entregue, quando diverge da prevista.';
COMMENT ON COLUMN mapoteca.produto_pedido.tipo_midia_fornecida_id IS
    'Mídia efetivamente usada, quando diverge da prevista.';
COMMENT ON COLUMN mapoteca.produto_pedido.data_entrega IS
    'Entrega efetiva por item — um mesmo pedido pode ter remessas em datas distintas.';

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
    estoque_minimo DECIMAL(10, 2),
    meta_anual DECIMAL(10, 2),
    ativo BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON COLUMN mapoteca.tipo_material.estoque_minimo IS
    'Limiar para alertar estoque baixo na UI (badge). NULL = sem alerta.';
COMMENT ON COLUMN mapoteca.tipo_material.meta_anual IS
    'Consumo anual previsto. Usado em relatório Consumo × Necessário × Pendente.';

-- Seed do controle de material de impressão (referência: planilha "Controle de
-- Material de Impressão" da Seção; dados de implantação no CLAUDE.md raiz)

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

-- Cabeçotes
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
('Cabeçote Universal',   'Cabeçote Universal novo (P2V27A, ficha C2982)'),
('Cabeçote MK/Y usado',  'Cabeçote MK/Y reutilizado'),
('Cabeçote CY/MG usado', 'Cabeçote CY/MG reutilizado'),
('Cabeçote G/PK usado',  'Cabeçote G/PK reutilizado');

-- Papéis
INSERT INTO mapoteca.tipo_material (nome, descricao) VALUES
('Papel Sulfite 90g',   'Papel sulfite 90g/m² para plotter'),
('Papel Sulfite 120g',  'Papel sulfite 120g/m² para plotter'),
('Papel Glossy',        'Papel glossy para plotter'),
('Banner (tecido)',     'Banner em tecido'),
('Tyvek',               'Papel sintético Tyvek para plotter');

CREATE TABLE mapoteca.consumo_material (
    id SERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    quantidade DECIMAL(10, 2) NOT NULL CHECK (quantidade > 0),
    data_consumo DATE NOT NULL,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

CREATE TABLE mapoteca.estoque_material (
    id SERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    quantidade DECIMAL(10, 2) NOT NULL CHECK (quantidade >= 0),
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

-- Indexes para mapoteca
CREATE INDEX idx_pedido_situacao ON mapoteca.pedido(situacao_pedido_id);
CREATE INDEX idx_pedido_cliente ON mapoteca.pedido(cliente_id);
CREATE INDEX idx_pedido_data_pedido ON mapoteca.pedido(data_pedido);
CREATE INDEX idx_pedido_data_atendimento ON mapoteca.pedido(data_atendimento);
CREATE INDEX idx_pedido_operacao ON mapoteca.pedido(operacao) WHERE operacao IS NOT NULL;
CREATE INDEX idx_pedido_palavras_chave ON mapoteca.pedido USING GIN (palavras_chave);
CREATE INDEX idx_produto_pedido_pedido ON mapoteca.produto_pedido(pedido_id);
CREATE INDEX idx_produto_pedido_uuid_versao ON mapoteca.produto_pedido(uuid_versao);
CREATE INDEX idx_produto_pedido_data_entrega ON mapoteca.produto_pedido(data_entrega);
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
-- existir (upsert atômico — sem o check-then-insert que perdia estoque ou
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
        -- Devolver estoque do material antigo (upsert — idem acima)
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
