BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

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
(6, 'Cancelado');

CREATE TABLE mapoteca.tipo_disponibilizacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_disponibilizacao (code, nome) VALUES
(1, 'Impresso'),
(2, 'Digital'),
(3, 'Impresso e Digital');

CREATE TABLE mapoteca.tipo_papel(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_papel (code, nome) VALUES
(1, 'Banner (tecido)'),
(2, 'Glossy'),
(3, 'Couchê'),
(4, 'Vergê'),
(5, 'Sulfite 90g'),
(6, 'Sulfite 120g');

CREATE TABLE mapoteca.tipo_localizacao(
	code SMALLINT NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL
);

INSERT INTO mapoteca.tipo_localizacao (code, nome) VALUES
(1, 'Seção'),
(2, 'Almoxarifado'),
(3, 'Aquisição realizada'),
(4, 'Saldo no empenho');

CREATE TABLE mapoteca.cliente(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
    ponto_contato_principal VARCHAR(255),
    endereco_entrega_principal VARCHAR(255),
	tipo_cliente_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_cliente (code)
);

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
    observacao TEXT,
    localizador_envio TEXT,
    motivo_cancelamento TEXT,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

CREATE TABLE mapoteca.produto_pedido(
	id BIGSERIAL NOT NULL PRIMARY KEY,
    uuid_versao UUID NOT NULL REFERENCES acervo.versao (uuid_versao),
	pedido_id BIGINT NOT NULL REFERENCES mapoteca.pedido (id),
    tipo_disponibilizacao_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_disponibilizacao (code),
    quantidade INTEGER NOT NULL,
    tipo_papel_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_papel (code),
    producao_especifica BOOLEAN NOT NULL DEFAULT FALSE,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

CREATE TABLE mapoteca.plotter(
	id SERIAL NOT NULL PRIMARY KEY,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
	nr_serie VARCHAR(255) NOT NULL,
    modelo VARCHAR(255) NOT NULL
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

CREATE TABLE mapoteca.tipo_material (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT
);

CREATE TABLE mapoteca.consumo_material (
    id SERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    quantidade DECIMAL(10, 2) NOT NULL,
    data_consumo DATE NOT NULL,
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

CREATE TABLE mapoteca.estoque_material (
    id SERIAL PRIMARY KEY,
    tipo_material_id INTEGER NOT NULL REFERENCES mapoteca.tipo_material(id),
    quantidade DECIMAL(10, 2) NOT NULL,
    localizacao_id SMALLINT NOT NULL REFERENCES mapoteca.tipo_localizacao (code),
    usuario_criacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    usuario_atualizacao_id INTEGER NOT NULL REFERENCES dgeo.usuario(id),
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    data_atualizacao TIMESTAMP WITH TIME ZONE
);

COMMIT;