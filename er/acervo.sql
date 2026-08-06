BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA acervo;

CREATE TABLE acervo.volume_armazenamento(
	id SERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255) NOT NULL,
	volume VARCHAR(255) NOT NULL UNIQUE,
	capacidade_gb FLOAT NOT NULL,
	-- true = o volume guarda a entrega no LAYOUT DO FORNECEDOR. O nome fisico e o
	-- caminho relativo de origem (subpasta inclusa), o padrao derivado
	-- (acervo.nome_arquivo_padrao) nao se aplica, e o invariante 7a e o
	-- renomear-padrao ignoram o volume. Existe porque formato com sidecar por nome
	-- (o .ige de um .img do ERDAS) nao sobrevive a renome. Ver
	-- migrations/2026-07-31_volume_layout_origem.sql.
	layout_origem BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE acervo.volume_tipo_produto(
	id SERIAL NOT NULL PRIMARY KEY,
	tipo_produto_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto (code),
	volume_armazenamento_id INTEGER NOT NULL REFERENCES acervo.volume_armazenamento (id),
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
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
    CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

CREATE TABLE acervo.lote (
    id BIGSERIAL NOT NULL PRIMARY KEY,
	projeto_id BIGINT NOT NULL REFERENCES acervo.projeto (id),
	pit VARCHAR(255) NOT NULL,
    nome VARCHAR(255) NOT NULL,
    descricao TEXT,
    data_inicio DATE NOT NULL,
    data_fim DATE,
    -- Quando o LOTE promete terminar. Coluna propria, e nao `data_fim`, porque
    -- as duas dizem coisas diferentes: esta e a promessa e aquela e o que
    -- aconteceu.
    --
    -- JA NAO E A FONTE DO PLANEJADO DO PIT, e a troca vale escrever porque a
    -- razao dela foi medida. Ate 2026-08-05 o mes do planejado saia daqui, e nos
    -- 19 lotes que tinham a coluna ela era IGUAL a `data_fim`: a previsao vinha
    -- sendo preenchida no fim, junto com o fato consumado. A meta 1.3 prometia
    -- 48 folhas em agosto e a grade mostrava 49 em junho, porque foi em junho
    -- que o lote acabou. Alem disso o lote e a granularidade errada: a meta 1.1
    -- promete 4 em abril, 1 em maio, 16 em julho e 3 em agosto, e uma data de
    -- lote nao expressa quatro meses. Hoje o planejado sai de
    -- `acervo.versao.data_prevista`, uma promessa por folha.
    --
    -- A coluna FICA, porque a promessa do lote continua sendo um fato do lote, e
    -- e o que a tela de projetos mostra.
    data_fim_prevista DATE,
    status_execucao_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_execucao (code),
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
    CHECK (data_fim IS NULL OR data_fim >= data_inicio),
    CONSTRAINT lote_data_fim_prevista_check
        CHECK (data_fim_prevista IS NULL OR data_fim_prevista >= data_inicio),
    CONSTRAINT unique_pit_per_project UNIQUE (projeto_id, pit)
);

CREATE TABLE acervo.produto(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	nome VARCHAR(255),
	mi VARCHAR(255),
	inom VARCHAR(255),
    tipo_escala_id SMALLINT NOT NULL REFERENCES dominio.tipo_escala (code),
	denominador_escala_especial INTEGER,
	tipo_produto_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto (code),
	-- Refina a identidade do produto pelo SUBTIPO. NULL = identidade
	-- so por (mi, escala, tipo): e o caso do produto civil, que abrange subtipos 2
	-- (T34-700) e 12 (ET-RDG) nas versoes. Preenchido quando o subtipo define o produto
	-- (ex.: 24 = Carta Topografica Militar), tornando-o distinto do civil no mesmo MI.
	subtipo_produto_id SMALLINT REFERENCES dominio.subtipo_produto (code),
	descricao TEXT,
	data_cadastramento timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
	geom geometry(POLYGON, 4674) NOT NULL,
    CHECK (
        (tipo_escala_id = 5 AND denominador_escala_especial IS NOT NULL) OR
        (tipo_escala_id != 5 AND denominador_escala_especial IS NULL)
    )
);

CREATE INDEX produto_geom
    ON acervo.produto USING gist
    (geom)
    TABLESPACE pg_default;

-- Identidade do produto: (mi, escala, tipo, subtipo). COALESCE(...,0) mantem o produto
-- civil (subtipo NULL) unico e deixa o militar (subtipo 24) coexistir no mesmo MI.
-- Parcial WHERE mi IS NOT NULL: especiais/campos de instrucao (mi NULL, bbox propria)
-- ficam de fora, como ja era.
CREATE UNIQUE INDEX unique_produto_identidade
    ON acervo.produto (mi, tipo_escala_id, tipo_produto_id, COALESCE(subtipo_produto_id, 0))
    WHERE mi IS NOT NULL;

CREATE TABLE acervo.versao(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	uuid_versao UUID UNIQUE NOT NULL,
	nome VARCHAR(255),
	versao VARCHAR(255) NOT NULL,
	tipo_versao_id SMALLINT NOT NULL REFERENCES dominio.tipo_versao (code),
	subtipo_produto_id SMALLINT NOT NULL REFERENCES dominio.subtipo_produto (code),
	produto_id BIGINT NOT NULL REFERENCES acervo.produto (id),
	lote_id BIGINT REFERENCES acervo.lote (id),
	-- Meta do PIT que esta versao cumpre. E o vinculo que CONTA na
	-- grade do PIT: a versao vale uma unidade da meta quando vira Regular.
	--
	-- FICA NA VERSAO, E NAO NO LOTE, e isso foi medido antes de decidir. Todo
	-- lote de Carta Topografica de 2026 traz o CDGV junto, um para um por MI: o
	-- lote 2026-1a tem 6 cartas e 6 CDGV, 12 versoes, e a meta 1.1 promete 24
	-- FOLHAS e nao 48. Com o vinculo no lote seria preciso filtrar por tipo e
	-- escala dentro dele; aqui a versao de carta aponta a 1.1, a de CDGV aponta
	-- outra meta ou nenhuma, e filtro nenhum precisa existir.
	--
	-- ANULAVEL, e a maioria fica nula: registro historico, lote Extra-PIT e
	-- produto de fora do plano nao cumprem meta. Sem esta coluna, contar por
	-- tipo e escala engoliria 22 Carta Ortoimagem 1:25.000 do lote Extra-PIT de
	-- 2026 e mais 16 sem lote nenhum, todas na meta 1.3.
	-- Aponta o ITEM (pit.meta_item), e nao o grupo: quem cumpre a 1.1 e a
	-- versao, e a Meta 1 sozinha nao promete folha nenhuma.
	meta_pit_id BIGINT REFERENCES pit.meta_item (id),
	-- Demanda Extra-PIT que esta versao materializa. O Extra-PIT e
	-- PRODUCAO, e nao entrega: a demanda so fecha quando a versao existe.
	--
	-- EXCLUSIVA COM meta_pit_id, pelo CHECK abaixo. A folha cumpre o plano OU e
	-- a excecao autorizada, nunca as duas, e essa exclusao e o que impede a
	-- contagem dupla. No SAP a mesma regra vivia em `extra_pit.lote_id`.
	--
	-- O lote nao serve de vinculo, e isso foi medido: o lote 2026-1a tem seis
	-- cartas topograficas, quatro da meta 1.1 e duas do CMS para a Op. Arandu.
	-- A producao Extra-PIT mora DENTRO de um lote do PIT.
	demanda_extra_id BIGINT REFERENCES pit.demanda_extra (id),
	metadado JSONB,
	descricao TEXT,
    orgao_produtor VARCHAR(255) NOT NULL,
    palavras_chave TEXT[],
	data_criacao TIMESTAMP WITH TIME ZONE NOT NULL,
	data_edicao TIMESTAMP WITH TIME ZONE NOT NULL,
	-- O MES EM QUE ESTA VERSAO PROMETE FICAR PRONTA, e de onde sai o PLANEJADO
	-- do PIT.
	--
	-- COLUNA PROPRIA, e nao `data_edicao`. A versao Planejada guardava a data
	-- prevista no proprio `data_edicao`, e esse valor e SOBRESCRITO quando ela
	-- vira Regular: o plano desaparecia no instante em que se cumpria.
	--
	-- E NAO E `lote.data_fim_prevista`, que foi a primeira tentativa e falhou
	-- por duas razoes medidas em 2026-08-05. A primeira: nos 19 lotes que a tem,
	-- ela e IGUAL a `data_fim`, ou seja, a previsao vinha sendo preenchida no
	-- fim junto com o fato, e o planejado da grade era uma copia do realizado. A
	-- segunda: o lote e a granularidade errada, porque a meta 1.1 promete 4 em
	-- abril, 1 em maio, 16 em julho e 3 em agosto, e uma data de lote nao
	-- expressa quatro meses.
	--
	-- ANULAVEL, e a maioria fica nula: registro historico e produto de fora do
	-- plano nao prometem mes nenhum. Na versao que cumpre meta, a ausencia dela e
	-- erro de cadastro do PIT, e quem acusa e GET /pit/execucao/diagnostico.
	data_prevista DATE,
	data_cadastramento timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
	usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
    -- Inclui subtipo por robustez historica. A Carta Topografica Militar
    -- (subtipo 24) vive num PRODUTO proprio (acervo.produto.subtipo_produto_id = 24), entao
    -- o cenario "1ª Edição civil e militar" ocorre entre DOIS produtos, nao dentro de um.
    CONSTRAINT unique_version_per_product UNIQUE (produto_id, versao, subtipo_produto_id),
    CONSTRAINT versao_plano_ou_excecao CHECK (meta_pit_id IS NULL OR demanda_extra_id IS NULL),
    CHECK (data_edicao >= data_criacao)
);

CREATE INDEX idx_versao_metadato ON acervo.versao USING GIN (metadado);

CREATE OR REPLACE FUNCTION acervo.validate_version()
RETURNS TRIGGER AS $$
DECLARE
    version_number INTEGER;
    acronym TEXT;
    previous_version TEXT;
    current_year INTEGER;
    prod_subtipo SMALLINT;
    subtipo_exige_proprio BOOLEAN;
BEGIN
    -- Coerencia produto<->subtipo (identidade do produto pelo subtipo).
    -- Antes do early-return para valer inclusive quando so muda produto_id (mover versao).
    SELECT subtipo_produto_id INTO prod_subtipo FROM acervo.produto WHERE id = NEW.produto_id;
    SELECT define_produto INTO subtipo_exige_proprio FROM dominio.subtipo_produto WHERE code = NEW.subtipo_produto_id;

    IF prod_subtipo IS NOT NULL AND NEW.subtipo_produto_id <> prod_subtipo THEN
        RAISE EXCEPTION 'Versao (subtipo %) incompativel com o produto, que e do subtipo %', NEW.subtipo_produto_id, prod_subtipo;
    END IF;
    IF subtipo_exige_proprio AND (prod_subtipo IS NULL OR prod_subtipo <> NEW.subtipo_produto_id) THEN
        RAISE EXCEPTION 'Subtipo % exige produto proprio (produto.subtipo_produto_id = %); nao pode ser versao de um produto de outro subtipo', NEW.subtipo_produto_id, NEW.subtipo_produto_id;
    END IF;

    -- Em UPDATE, validar o formato da versao apenas quando o campo versao mudou, senão
    -- registros legados ("Xª Edição") ficam imutáveis após 2024 (qualquer UPDATE falharia)
    IF TG_OP = 'UPDATE' AND NEW.versao IS NOT DISTINCT FROM OLD.versao THEN
        RETURN NEW;
    END IF;

    -- Versões que NÃO são Regular carregam registro histórico (tipo 2, acervo
    -- legado) ou promessa de produção (tipo 3, planejada): aceitam o formato
    -- antigo "Xª Edição" independentemente do ano e não exigem a versão
    -- sequencial anterior (a carga é parcial por natureza nos dois casos).
    IF NEW.tipo_versao_id <> 1 THEN
        IF NEW.versao !~ '^[0-9]+ª Edição$' AND NEW.versao !~ '^[0-9]+-[A-Z]{1,5}$' THEN
            RAISE EXCEPTION 'Formato inválido para versão: %', NEW.versao;
        END IF;
        RETURN NEW;
    END IF;

    -- Get the current year
    current_year := EXTRACT(YEAR FROM CURRENT_DATE);

    -- Check for old standard: "Xª Edição"
    IF NEW.versao ~ '^[0-9]+ª Edição$' THEN
        -- Acervo legado: cartas antigas usam "Xª Edição" e são cadastradas como
        -- versões Regular (tipo_versao_id = 1). A carga pode ser parcial, então
        -- não se exige a edição sequencial anterior nem há restrição de ano.
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
    volume_armazenamento_id INTEGER REFERENCES acervo.volume_armazenamento (id),
    extensao VARCHAR(255),
    tamanho_mb REAL,
    checksum VARCHAR(64),
    metadado JSONB,
    tipo_status_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_arquivo (code),
    situacao_carregamento_id SMALLINT NOT NULL REFERENCES dominio.situacao_carregamento (code),
    descricao TEXT,
    crs_original VARCHAR(10),
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
CREATE INDEX idx_arquivo_metadato ON acervo.arquivo USING GIN (metadado);
CREATE INDEX idx_arquivo_tipo_arquivo ON acervo.arquivo(tipo_arquivo_id);
CREATE INDEX idx_arquivo_versao ON acervo.arquivo(versao_id);

-- Unicidade do NOME FISICO. O servidor monta o download como
-- <volume>/<nome_arquivo>.<extensao>, entao o trio e a chave fisica: dois
-- registros com o mesmo trio apontam para o MESMO byte no disco, e um
-- sobrescreve o outro em silencio.
--
-- SAO DOIS indices, e o segundo nao e redundancia. O Postgres distingue caixa e
-- o SMB do volume NAO: sem o indice em lower(), "CT_s02_2834-1_ed1.tif" e
-- "ct_s02_2834-1_ed1.TIF" passam como duas linhas e disputam UM arquivo.
--
-- Tileserver (tipo_arquivo_id = 9) fica de fora: ali nome_arquivo e uma URL e
-- volume_armazenamento_id e NULL, por arquivo_check1.
--
-- Vem da migracao 2026-07-29_nome_fisico_unico.sql, e TEM de estar aqui: sem
-- eles, o banco ATUALIZADO os tem e a INSTALACAO NOVA nasce sem.
CREATE UNIQUE INDEX unique_nome_fisico_por_volume
  ON acervo.arquivo (volume_armazenamento_id, nome_arquivo, extensao)
  WHERE tipo_arquivo_id <> 9;

CREATE UNIQUE INDEX unique_nome_fisico_por_volume_ci
  ON acervo.arquivo (volume_armazenamento_id, lower(nome_arquivo), lower(extensao))
  WHERE tipo_arquivo_id <> 9;
CREATE INDEX idx_lote_projeto ON acervo.lote(projeto_id);
CREATE INDEX idx_versao_lote ON acervo.versao(lote_id);
CREATE INDEX idx_versao_meta_pit ON acervo.versao(meta_pit_id);
CREATE INDEX idx_versao_demanda_extra ON acervo.versao(demanda_extra_id);

-- Miniatura da versao: a imagem que a ficha do produto mostra, derivada do PDF
-- (ou do TIF, quando nao ha PDF) que ja esta no volume. Tabela propria, e nao
-- coluna em `versao`, por duas razoes: `SELECT v.*` aparece em varias consultas
-- e passaria a arrastar o BYTEA para nada; e a miniatura tem PROCEDENCIA (de
-- qual arquivo saiu, com que checksum, quando), que a versao nao tem onde
-- guardar. Sem procedencia nao da para saber se a miniatura envelheceu.
--
-- A linha existe em dois estados, e o CHECK garante que sao mutuamente
-- exclusivos: ou tem `conteudo`, ou tem `erro`. Registrar a falha e o que
-- impede a carga de tentar de novo, a cada execucao, o mesmo arquivo ausente ou
-- corrompido. A rota que serve a imagem responde 404 quando so ha `erro`.
--
-- Os dois ON DELETE CASCADE existem porque miniatura e dado DERIVADO. Sem eles,
-- o caminho de exclusao que ja existe (apagar versao, apagar arquivo) passaria
-- a falhar por violacao de restricao. Fonte que sumiu deixa a miniatura
-- mentindo, entao ela morre junto.
--
-- Produto so vetorial (zip/sqlite) nao tem raster para renderizar, e por isso
-- simplesmente nao tem linha aqui.
CREATE TABLE acervo.miniatura_versao(
    versao_id BIGINT NOT NULL PRIMARY KEY REFERENCES acervo.versao (id) ON DELETE CASCADE,
    arquivo_id BIGINT REFERENCES acervo.arquivo (id) ON DELETE CASCADE,
    checksum_origem VARCHAR(64),
    formato VARCHAR(10),
    -- Largura e altura viajam com a imagem para a tela reservar o espaco antes
    -- de decodificar. Sem elas a ficha pula quando a miniatura chega.
    largura INTEGER,
    altura INTEGER,
    conteudo BYTEA,
    erro TEXT,
    data_geracao TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT miniatura_conteudo_ou_erro CHECK (
        (conteudo IS NOT NULL AND erro IS NULL
         AND formato IS NOT NULL AND largura IS NOT NULL AND altura IS NOT NULL)
        OR
        (conteudo IS NULL AND erro IS NOT NULL)
    )
);

COMMENT ON TABLE acervo.miniatura_versao IS
  'Miniatura derivada do PDF (ou do TIF) da versao, servida pela ficha do produto. Linha com erro registra a falha para a carga nao repetir o arquivo quebrado.';

-- A carga pergunta "que versoes ainda nao tem miniatura" por anti-join na PK, e
-- "quais falharam para eu reprocessar" por este indice parcial, que so indexa a
-- minoria com erro.
CREATE INDEX idx_miniatura_versao_erro
  ON acervo.miniatura_versao (versao_id) WHERE erro IS NOT NULL;

CREATE TABLE acervo.arquivo_deletado(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	uuid_arquivo UUID,
	nome VARCHAR(255),
	nome_arquivo TEXT NOT NULL,
	motivo_exclusao TEXT,
	versao_id BIGINT REFERENCES acervo.versao (id) ON DELETE SET NULL,
	tipo_arquivo_id SMALLINT NOT NULL REFERENCES dominio.tipo_arquivo (code),
	volume_armazenamento_id INTEGER REFERENCES acervo.volume_armazenamento (id) ON DELETE SET NULL,
	extensao VARCHAR(255),
	tamanho_mb REAL,
    checksum VARCHAR(64),
	metadado JSONB,
	tipo_status_id SMALLINT NOT NULL REFERENCES dominio.tipo_status_arquivo (code),
	situacao_carregamento_id SMALLINT NOT NULL REFERENCES dominio.situacao_carregamento (code),
	descricao TEXT,
    crs_original VARCHAR(10),
	data_cadastramento timestamp with time zone,
	usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
	data_modificacao  timestamp with time zone,
	usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid),
	data_delete  timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
	usuario_delete_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

-- FK alvo de ON DELETE SET NULL em deleções de versão
CREATE INDEX idx_arquivo_deletado_versao ON acervo.arquivo_deletado(versao_id);

CREATE TABLE acervo.download(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	arquivo_id BIGINT NOT NULL REFERENCES acervo.arquivo (id),
	usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
    download_token UUID NOT NULL DEFAULT uuid_generate_v4(),
    expiration_time TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    data_download TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_download_token ON acervo.download(download_token);
CREATE INDEX idx_download_arquivo ON acervo.download(arquivo_id);

CREATE TABLE acervo.download_deletado(
	id BIGSERIAL NOT NULL PRIMARY KEY,
	arquivo_deletado_id BIGINT NOT NULL REFERENCES acervo.arquivo_deletado (id),
	usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_download TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_download_deletado_arquivo ON acervo.download_deletado(arquivo_deletado_id);

CREATE TABLE acervo.versao_relacionamento(
    id BIGSERIAL NOT NULL PRIMARY KEY,
    versao_id_1 BIGINT NOT NULL REFERENCES acervo.versao (id),
    versao_id_2 BIGINT NOT NULL REFERENCES acervo.versao (id),
    tipo_relacionamento_id SMALLINT NOT NULL REFERENCES dominio.tipo_relacionamento (code),
    data_relacionamento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_relacionamento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    CHECK (versao_id_1 != versao_id_2),
    CONSTRAINT unique_versao_relacionamento UNIQUE (versao_id_1, versao_id_2, tipo_relacionamento_id)
);

-- versao_id_1 é coberto pela UNIQUE acima; versao_id_2 precisa de índice próprio
-- para os DELETEs por versão (WHERE versao_id_1 = X OR versao_id_2 = X)
CREATE INDEX idx_versao_relacionamento_versao2 ON acervo.versao_relacionamento(versao_id_2);

-- Main upload session table
CREATE TABLE acervo.upload_session (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    uuid_session UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('add_files', 'add_version', 'add_product', 'replace_files')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiration_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours',
    completed_at TIMESTAMP WITH TIME ZONE,
    usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

-- Temporary product metadata
CREATE TABLE acervo.upload_produto_temp (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES acervo.upload_session (id) ON DELETE CASCADE,
    nome VARCHAR(255),
    mi VARCHAR(255),
    inom VARCHAR(255),
    tipo_escala_id SMALLINT NOT NULL REFERENCES dominio.tipo_escala (code),
    denominador_escala_especial INTEGER,
    tipo_produto_id SMALLINT NOT NULL REFERENCES dominio.tipo_produto (code),
    -- Subtipo que define a identidade do produto (ex.: 24 = Carta Topografica
    -- Militar); NULL = produto comum. Espelha acervo.produto.subtipo_produto_id.
    subtipo_produto_id SMALLINT REFERENCES dominio.subtipo_produto (code),
    descricao TEXT,
    geom TEXT NOT NULL -- Store as text to avoid geometry validation during prep
);

-- Temporary version metadata
CREATE TABLE acervo.upload_versao_temp (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES acervo.upload_session (id) ON DELETE CASCADE,
    uuid_versao UUID NOT NULL,
    versao VARCHAR(255) NOT NULL,
    nome VARCHAR(255),
    tipo_versao_id SMALLINT NOT NULL REFERENCES dominio.tipo_versao (code),
    subtipo_produto_id SMALLINT NOT NULL REFERENCES dominio.subtipo_produto (code),
    lote_id BIGINT REFERENCES acervo.lote (id) ON DELETE SET NULL,
    metadado JSONB,
    descricao TEXT,
    orgao_produtor VARCHAR(255) NOT NULL,
    palavras_chave TEXT[],
    data_criacao TIMESTAMP WITH TIME ZONE NOT NULL,
    data_edicao TIMESTAMP WITH TIME ZONE NOT NULL,
    produto_id BIGINT, -- Used for add_version scenario (acervo.produto.id é BIGSERIAL)
    produto_temp_id BIGINT REFERENCES acervo.upload_produto_temp (id) ON DELETE CASCADE, -- Used for add_product scenario
    -- O VINCULO COM O PIT atravessa o envio. Sem as duas aqui, a meta escolhida
    -- no formulario morre entre o preparo e a finalizacao: o schema aceita, o
    -- rascunho nao guarda, e a versao final nasce fora da conta do plano.
    meta_pit_id BIGINT REFERENCES pit.meta_item (id) ON DELETE SET NULL,
    data_prevista DATE
);

CREATE INDEX idx_upload_versao_temp_produto_temp ON acervo.upload_versao_temp(produto_temp_id);

-- Temporary file metadata
CREATE TABLE acervo.upload_arquivo_temp (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES acervo.upload_session (id) ON DELETE CASCADE,
    nome VARCHAR(255) NOT NULL,
    nome_arquivo TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    tipo_arquivo_id SMALLINT NOT NULL REFERENCES dominio.tipo_arquivo (code),
    volume_armazenamento_id INTEGER,
    extensao VARCHAR(255),
    tamanho_mb REAL,
    expected_checksum VARCHAR(64),
    metadado JSONB,
    situacao_carregamento_id SMALLINT NOT NULL REFERENCES dominio.situacao_carregamento (code),
    descricao TEXT,
    crs_original VARCHAR(10),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    versao_id BIGINT, -- Used for add_files scenario (acervo.versao.id é BIGSERIAL)
    versao_temp_id BIGINT REFERENCES acervo.upload_versao_temp (id) ON DELETE CASCADE -- Used for add_version and add_product scenarios
);

CREATE INDEX idx_upload_arquivo_temp_versao_temp ON acervo.upload_arquivo_temp(versao_temp_id);

-- Create indexes
CREATE INDEX idx_upload_session_status ON acervo.upload_session(status);
CREATE INDEX idx_upload_session_expiration ON acervo.upload_session(expiration_time) WHERE status = 'pending';
CREATE INDEX idx_upload_arquivo_temp_session ON acervo.upload_arquivo_temp(session_id);
CREATE INDEX idx_upload_versao_temp_session ON acervo.upload_versao_temp(session_id);

-- Create cleanup function
CREATE OR REPLACE FUNCTION acervo.cleanup_expired_uploads() RETURNS void AS $$
BEGIN
    -- Mark expired pending uploads as failed
    UPDATE acervo.upload_session 
    SET status = 'failed', 
        error_message = 'Upload expired - client never confirmed completion'
    WHERE status = 'pending' 
    AND expiration_time < NOW();
    
    -- Also update file statuses
    UPDATE acervo.upload_arquivo_temp
    SET status = 'failed',
        error_message = 'Upload session expired'
    WHERE status = 'pending'
    AND session_id IN (
        SELECT id FROM acervo.upload_session 
        WHERE status = 'failed' 
        AND error_message = 'Upload expired - client never confirmed completion'
    );
END;
$$ LANGUAGE plpgsql;


-- Nome fisico padrao do arquivo.
--
-- Vive NO BANCO, e nao no JavaScript, porque duas coisas dependem dela e nao se
-- conhecem: a rota que renomeia e o invariante 7a da auditoria. Regra em dois
-- lugares diverge, e o auditor passaria a aprovar o que o renomeador escreve,
-- qualquer coisa que ele escreva.
--
-- Fica em er/ ao lado da migration 2026-07-29_nome_arquivo_padrao.sql: a
-- migration atualiza o banco que existe e este arquivo instala o novo. Estar so
-- na migration deixava a INSTALACAO NOVA sem a funcao, e a auditoria quebrava
-- num banco recem-criado.

CREATE OR REPLACE FUNCTION acervo.slug_nome(p_texto text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT upper(btrim(regexp_replace(
    translate(coalesce(p_texto, ''),
      'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'),
    '[^A-Za-z0-9]+', '-', 'g'), '-'));
$$;

COMMENT ON FUNCTION acervo.slug_nome(text) IS
  'Normaliza texto para uso em nome fisico: sem acento, so [A-Z0-9-], maiusculo.';

-- Slug da edicao. Regex ANCORADA de proposito: as duas formas abaixo sao as
-- unicas que o trigger acervo.validate_version admite. Sem ancora, "1-DSG" e
-- "1-DSGE" colapsam no mesmo slug (a sigla vai de 1 a 5 letras).
CREATE OR REPLACE FUNCTION acervo.edicao_slug(p_versao text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_versao ~ '^[0-9]+ª Edição$'
      THEN 'ed' || (regexp_match(p_versao, '^([0-9]+)ª Edição$'))[1]
    WHEN p_versao ~ '^[0-9]+-[A-Z]{1,5}$'
      THEN (regexp_match(p_versao, '^([0-9]+)-([A-Z]{1,5})$'))[1]
        || lower((regexp_match(p_versao, '^([0-9]+)-([A-Z]{1,5})$'))[2])
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION acervo.edicao_slug(text) IS
  'Slug da edicao a partir do rotulo. NULL quando o rotulo foge das duas formas canonicas.';

CREATE OR REPLACE FUNCTION acervo.nome_arquivo_padrao(
  p_tipo_produto_id     smallint,
  p_subtipo_produto_id  smallint,
  p_mi                  varchar,
  p_inom                varchar,
  p_produto_nome        varchar,
  p_tipo_escala_id      smallint,
  p_denominador         integer,
  p_versao              varchar
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  WITH partes AS (
    SELECT
      CASE p_tipo_produto_id
        WHEN 1 THEN 'CDGV'   WHEN 2 THEN 'CT'      WHEN 3 THEN 'CO'
        WHEN 4 THEN 'ORTO'   WHEN 5 THEN 'MDS'     WHEN 6 THEN 'MDT'
        WHEN 7 THEN 'TEM'    WHEN 8 THEN 'CDGVTEM' WHEN 9 THEN 'M3D'
        WHEN 10 THEN 'PC'    WHEN 11 THEN 'CDGVCO' WHEN 12 THEN 'INSUMO'
        WHEN 13 THEN 'LEVTOPO'
        ELSE 'TP' || p_tipo_produto_id::text
      END AS tp,
      's' || lpad(p_subtipo_produto_id::text, 2, '0') AS sub,
      acervo.edicao_slug(p_versao) AS ed,
      -- COALESCE(mi, inom): o INOM identifica a folha tao bem quanto o MI, e o
      -- schema admite produto com um sem o outro.
      coalesce(nullif(btrim(p_mi), ''), nullif(btrim(p_inom), '')) AS ident,
      CASE p_tipo_escala_id
        WHEN 1 THEN '25k' WHEN 2 THEN '50k' WHEN 3 THEN '100k' WHEN 4 THEN '250k'
        ELSE coalesce('e' || p_denominador::text, 'esp')
      END AS esc
  )
  SELECT CASE
    WHEN ed IS NULL THEN NULL
    WHEN ident IS NOT NULL THEN tp || '_' || sub || '_' || acervo.slug_nome(ident) || '_' || ed
    WHEN nullif(btrim(coalesce(p_produto_nome, '')), '') IS NULL THEN NULL
    ELSE tp || '_' || sub || '_' || acervo.slug_nome(p_produto_nome) || '_' || esc || '_' || ed
  END
  FROM partes;
$$;

COMMENT ON FUNCTION acervo.nome_arquivo_padrao(smallint, smallint, varchar, varchar, varchar, smallint, integer, varchar) IS
  'Nome fisico padrao do arquivo. Fonte unica: usada pela rota de renome e pelo invariante 7a. NULL = nao computavel, o que e defeito.';

COMMIT;