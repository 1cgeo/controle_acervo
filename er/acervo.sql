BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA acervo;

CREATE TABLE acervo.volume_armazenamento(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	volume VARCHAR(255) NOT NULL,
	capacidade_gb FLOAT NOT NULL
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
    status_execucao_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_execucao (code),
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

CREATE TABLE acervo.lote (
    id BIGSERIAL NOT NULL PRIMARY KEY,
	projeto_id INTEGER NOT NULL REFERENCES acervo.projeto (id),
	pit VARCHAR(255) NOT NULL,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    data_inicio DATE NOT NULL,
    data_fim DATE,
    status_execucao_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_execucao (code),
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

CREATE TABLE acervo.produto(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255),
	mi VARCHAR(255),
	inom VARCHAR(255),
    tipo_escala_id SMALLINT NOT NULL REFERENCES dominio.tipo_escala (code),
	denominador_escala_especial INTEGER NOT NULL,
	tipo_produto_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto (code),
	descricao TEXT,
	data_cadastramento timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
	geom geometry(POLYGON, 4674) NOT NULL,
    CHECK (
        (tipo_escala_id = 5 AND denominador_escala_especial IS NOT NULL) OR
        (tipo_escala_id != 5 AND denominador_escala_especial IS NULL)
    );
);

CREATE INDEX produto_geom
    ON acervo.produto USING gist
    (geom)
    TABLESPACE pg_default;

CREATE TABLE acervo.versao(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	uuid_versao UUID UNIQUE NOT NULL,
	nome VARCHAR(255),
	versao VARCHAR(255) NOT NULL,
	tipo_versao_id SMALLINT NOT NULL REFERENCES dominio.tipo_versao (code),
	produto_id BIGINT NOT NULL REFERENCES acervo.produto (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	metadado JSONB,
	descricao TEXT,
	data_criacao TIMESTAMP WITH TIME ZONE NOT NULL,
	data_edicao TIMESTAMP WITH TIME ZONE NOT NULL,
	data_cadastramento timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
    CONSTRAINT unique_version_per_product UNIQUE (produto_id, versao)
);

CREATE INDEX idx_versao_metadata ON acervo.versao USING GIN (metadado);

CREATE OR REPLACE FUNCTION acervo.validate_version()
RETURNS TRIGGER AS $$
DECLARE
    version_number INTEGER;
    acronym TEXT;
    previous_version TEXT;
    current_year INTEGER;
BEGIN
    -- Get the current year
    current_year := EXTRACT(YEAR FROM CURRENT_DATE);

    -- Check for old standard: "Xª Edição"
    IF NEW.versao ~ '^[0-9]+ª Edição$' THEN
        -- Only allow old standard for years before 2024
        IF current_year >= 2024 THEN
            RAISE EXCEPTION 'A partir de 2024 versões devem utilizar o formato "X-YYYYY"';
        END IF;
        RETURN NEW;
    -- Check for new standard: "X-YYYYY" where X is a number and YYYYY is 1-5 uppercase letters
    ELSIF NEW.versao ~ '^[0-9]+-[A-Z]{1,5}$' THEN
        -- Extract version number and acronym
        version_number := (regexp_matches(NEW.versao, '^([0-9]+)-([A-Z]{1,5})$'))[1]::INTEGER;
        acronym := (regexp_matches(NEW.versao, '^([0-9]+)-([A-Z]{1,5})$'))[2];
        
        -- Skip sequential check for version 1
        IF version_number > 1 THEN
            -- Check if previous version exists
            previous_version := (version_number - 1) || '-' || acronym;
            
            IF NOT EXISTS (
                SELECT 1 FROM acervo.versao 
                WHERE produto_id = NEW.produto_id AND versao = previous_version
            ) THEN
                RAISE EXCEPTION 'Não existe a versão anterior % para este produto', previous_version;
            END IF;
        END IF;
        
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'Formato inválido para versão: %', NEW.versao;
    END IF;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER validate_version_trigger
BEFORE INSERT OR UPDATE ON acervo.versao
FOR EACH ROW
EXECUTE FUNCTION acervo.validate_version();

CREATE TABLE acervo.arquivo(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    uuid_arquivo UUID UNIQUE NOT NULL,
    nome VARCHAR(255) NOT NULL,
    nome_arquivo TEXT NOT NULL CHECK (
        tipo_arquivo_id != 9 OR nome_arquivo ~ '^https?://'
    ),
    versao_id BIGINT NOT NULL REFERENCES acervo.versao (id),
    tipo_arquivo_id SMALLINT NOT NULL REFERENCES dominio.tipo_arquivo (code),
    volume_armazenamento_id SMALLINT REFERENCES acervo.volume_armazenamento (id),
    extensao VARCHAR(255),
    tamanho_mb REAL,
    checksum VARCHAR(64),
    metadado JSONB,
    tipo_status_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_arquivo (code),
    situacao_bdgex_id SMALLINT NOT NULL REFERENCES dominio.situacao_bdgex (code),
    orgao_produtor VARCHAR(255) NOT NULL,
    descricao TEXT,
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
    CONSTRAINT unique_file_per_version UNIQUE (checksum, versao_id),
    CHECK (
        (tipo_arquivo_id != 9 AND volume_armazenamento_id IS NOT NULL) OR
        (tipo_arquivo_id = 9 AND volume_armazenamento_id IS NULL)
    ),
    CHECK (
        (tipo_arquivo_id != 9 AND extensao IS NOT NULL) OR
        (tipo_arquivo_id = 9 AND extensao IS NULL)
    ),
    CHECK (
        (tipo_arquivo_id != 9 AND tamanho_mb IS NOT NULL) OR
        (tipo_arquivo_id = 9 AND tamanho_mb IS NULL)
    ),
    CHECK (
        (tipo_arquivo_id != 9 AND checksum IS NOT NULL) OR
        (tipo_arquivo_id = 9 AND checksum IS NULL)
    )
);
CREATE INDEX idx_arquivo_metadata ON acervo.arquivo USING GIN (metadado);
CREATE INDEX idx_arquivo_tipo_arquivo ON acervo.arquivo(tipo_arquivo_id);

CREATE TABLE acervo.arquivo_deletado(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	uuid_arquivo UUID,
	nome VARCHAR(255),
	nome_arquivo TEXT NOT NULL,
	motivo_exclusao TEXT,
	versao_id BIGINT REFERENCES acervo.versao (id) ON DELETE SET NULL,
	tipo_arquivo_id SMALLINT NOT NULL REFERENCES dominio.tipo_arquivo (code),
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
	usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
	data_delete  timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	usuario_delete_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

CREATE TABLE acervo.download(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	arquivo_id BIGINT NOT NULL REFERENCES acervo.arquivo (id),
	usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_download TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE acervo.download_deletado(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	arquivo_deletado_id BIGINT NOT NULL REFERENCES acervo.arquivo_deletado (id),
	usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_download TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE acervo.versao_relacionamento(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    versao_id_1 BIGINT NOT NULL REFERENCES acervo.versao (id),
    versao_id_2 BIGINT NOT NULL REFERENCES acervo.versao (id),
    tipo_relacionamento_id SMALLINT NOT NULL REFERENCES dominio.tipo_relacionamento (code),
    data_relacionamento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_relacionamento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

COMMIT;