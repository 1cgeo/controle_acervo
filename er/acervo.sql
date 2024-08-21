BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA acervo;

CREATE TABLE acervo.volume_armazenamento(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	volume VARCHAR(255) NOT NULL,
	capacidade_mb FLOAT NOT NULL
);

CREATE TABLE acervo.volume_tipo_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	tipo_produto_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto (code),
	volume_armazenamento_id SMALLINT NOT NULL REFERENCES acervo.volume_armazenamento (id),
	primario BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX idx_unique_primario ON acervo.volume_tipo_produto(tipo_produto_id) WHERE primario = TRUE;

CREATE TABLE acervo.projeto (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    data_inicio DATE NOT NULL,
    data_fim DATE,
    status_execucao SMALLINT NOT NULL REFERENCES dominio.tipo_status_execucao (code),
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_id SMALLINT REFERENCES dgeo.usuario (id)
);

CREATE TABLE acervo.lote (
    id BIGSERIAL NOT NULL PRIMARY KEY,
	projeto_id INTEGER NOT NULL REFERENCES acervo.projeto (id),
	pit VARCHAR(4) NOT NULL,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    data_inicio DATE NOT NULL,
    data_fim DATE,
    status_execucao SMALLINT NOT NULL REFERENCES dominio.tipotipo_status_execucao_status (code),
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_id SMALLINT REFERENCES dgeo.usuario (id)
);

CREATE TABLE acervo.produto(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	uuid_produto UUID UNIQUE NOT NULL,
	mi VARCHAR(255),
	inom VARCHAR(255),
	denominador_escala INTEGER NOT NULL,
	tipo_produto_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto (code),
	descricao TEXT,
	data_cadastramento timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	usuario_cadastramento_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_id SMALLINT REFERENCES dgeo.usuario (id),
	geom geometry(POLYGON, 4674) NOT NULL	
);

CREATE INDEX produto_geom
    ON acervo.produto USING gist
    (geom)
    TABLESPACE pg_default;

CREATE TABLE acervo.versao(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	uuid_versao UUID UNIQUE NOT NULL,
	versao VARCHAR(255) NOT NULL,
	produto_id BIGINT NOT NULL REFERENCES acervo.produto (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	descricao TEXT,
	data_criacao TIMESTAMP WITH TIME ZONE NOT NULL,
	data_edicao TIMESTAMP WITH TIME ZONE NOT NULL,
	data_cadastramento timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	usuario_cadastramento_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_id SMALLINT REFERENCES dgeo.usuario (id)
);

CREATE TABLE acervo.arquivo(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	uuid_arquivo UUID UNIQUE NOT NULL,
	nome VARCHAR(255) NOT NULL,
	nome_arquivo VARCHAR(255) NOT NULL,
	versao_id BIGINT NOT NULL REFERENCES acervo.versao (id),
	tipo_arquivo_id SMALLINT NOT NULL REFERENCES dominio.tipo_arquivo (code);
	volume_armazenamento_id SMALLINT NOT NULL REFERENCES acervo.volume_armazenamento (id),
	extensao VARCHAR(255) NOT NULL,
	tamanho_mb REAL NOT NULL,
    checksum VARCHAR(64) NOT NULL,
	metadata JSONB,
	tipo_status_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_arquivo (code),
	situacao_bdgex_id SMALLINT NOT NULL REFERENCES dominio.situacao_bdgex (code),
	orgao_produtor VARCHAR(255) NOT NULL,
	descricao TEXT,
	data_cadastramento timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	usuario_cadastramento_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_id SMALLINT REFERENCES dgeo.usuario (id)
);

CREATE INDEX idx_arquivo_metadata ON acervo.arquivo USING GIN (metadata);


CREATE TABLE acervo.arquivo_deletado(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	uuid_arquivo UUID,
	nome VARCHAR(255),
	nome_arquivo VARCHAR(255) NOT NULL,
	motivo_exclusao TEXT,
	versao_id BIGINT REFERENCES acervo.versao (id) ON DELETE SET NULL,
	tipo_arquivo_id SMALLINT NOT NULL REFERENCES dominio.tipo_arquivo (code);
	volume_armazenamento_id SMALLINT REFERENCES acervo.volume_armazenamento (id) ON DELETE SET NULL,
	extensao VARCHAR(255),
	tamanho_mb REAL,
    checksum VARCHAR(64),
	metadata JSONB,
	tipo_status_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_arquivo (code),
	situacao_bdgex_id SMALLINT NOT NULL REFERENCES dominio.situacao_bdgex (code),
	orgao_produtor VARCHAR(255),
	descricao TEXT,
	data_cadastramento timestamp with time zone,
	usuario_cadastramento_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_id SMALLINT REFERENCES dgeo.usuario (id),
	data_delete  timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	usuario_delete_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id)
);

CREATE TABLE acervo.download(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	arquivo_id BIGINT NOT NULL REFERENCES acervo.arquivo (id),
	usuario_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
    data_download TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE acervo.download_deletado(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	arquivo_deletado_id BIGINT NOT NULL REFERENCES acervo.arquivo_deletado (id),
	usuario_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id),
    data_download TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE acervo.versao_relacionamento(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    versao_id_1 BIGINT NOT NULL REFERENCES acervo.versao (id),
    versao_id_2 BIGINT NOT NULL REFERENCES acervo.versao (id),
    tipo_relacionamento_id SMALLINT NOT NULL REFERENCES dominio.tipo_relacionamento (code);
    data_relacionamento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_relacionamento_id SMALLINT NOT NULL REFERENCES dgeo.usuario (id)
);

COMMIT;