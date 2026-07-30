-- Migração: o schema ponto_controle.
--
-- O plugin de ponto de controle (dsgoficial/pto_controle) trocou o banco
-- PostgreSQL por um GeoPackage por missão. O destino permanente passa a ser o
-- Controle do Acervo, e este schema é onde a missão importada fica.
--
-- Por que ponto de controle NÃO é acervo.produto: o produto tem geometria
-- POLYGON NOT NULL, e um ponto não cabe. Além disso a contagem de produtos do
-- acervo não pode ser inflada por ponto, que é objeto de outra natureza. O CHECK
-- no fim desta migração fecha essa porta. Conferido em 2026-07-28: não há
-- produto do tipo 10 cadastrado, então o CHECK sobe sem tratar dado existente.
--
-- Por que não há acervo.versao no caminho: ponto de controle não é reeditado em
-- versões, ele tem ciclo de tipo_situacao. Por isso o arquivo se pendura no
-- PONTO. É também por isso que o schema tem tabela de arquivo própria, em vez de
-- reusar acervo.arquivo, cuja FK versao_id é NOT NULL.
--
-- Por que não há entidade `missao`: a missão É um lote de um projeto maior.
-- O ponto referencia acervo.lote diretamente.
--
-- Por que a tabela de arquivo guarda caminho e não conteúdo, ao contrário de
-- mapoteca.anexo_pedido: são cerca de 3 MB por ponto. Em bytea, uma missão de
-- 100 pontos poria 300 MB no banco, e em todo backup.
--
-- O que se reusa sem tocar: acervo.projeto, acervo.lote,
-- acervo.volume_armazenamento e acervo.volume_tipo_produto (que já chaveia por
-- tipo_produto_id, então o tipo 10 funciona sem mudança) e dgeo.usuario.
--
-- As 56 colunas do ponto e os 98 códigos de domínio foram DERIVADOS do
-- new_db.sql do plugin, não redigitados. Doze colunas do plugin ficaram de fora
-- de propósito: os oito endereco_* são caminho absoluto na máquina do medidor,
-- e os quatro contadores (numero_fotos, possui_croqui, possui_monografia,
-- possui_arquivo_rastreio) são COUNT(*) sobre ponto_controle.arquivo.
--
-- Em 2026-07-30 as oito endereco_* SAÍRAM do plugin, junto com os dois
-- algoritmos que as usavam. Sobram quatro colunas de fora, as de contagem. Este
-- schema não muda por isso: ele nunca as teve, e o controller compara o
-- manifesto com as COLUNAS VIVAS da tabela, descartando e RELATANDO o que ela
-- não tem. É esse mecanismo, e não uma lista aqui, que avisa se elas voltarem.
--
-- DEPOIS desta migração, reaplique er/permissao.sql: sem os GRANTs do schema
-- novo, o serviço conecta e não enxerga as tabelas.
--
-- O corpo abaixo é gerado a partir de er/ponto_controle.sql, com as guardas de
-- idempotência acrescentadas (IF NOT EXISTS, ON CONFLICT, e o DO $$ do CHECK,
-- que o Postgres não deixa ser IF NOT EXISTS).
--
-- Conferido em 2026-07-28 por ensaio: um banco na versão 1.5.0 mais esta
-- migração fica com o MESMO schema de um banco instalado direto pelo er/
-- completo. Foram comparadas 317 colunas, 346 restrições, 206 índices e os
-- códigos de domínio, e a migração passou duas vezes seguidas.

BEGIN;

CREATE SCHEMA IF NOT EXISTS ponto_controle;



CREATE TABLE IF NOT EXISTS ponto_controle.tipo_situacao (
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

INSERT INTO ponto_controle.tipo_situacao (code, nome) VALUES
(1, 'Não medido'),
(2, 'Aguardando revisão'),
(3, 'Aprovado'),
(4, 'Reprovado'),
(9999, 'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.classificacao_ponto (
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL
);

INSERT INTO ponto_controle.classificacao_ponto (code, nome) VALUES
(0, 'Desconhecido'),
(1, 'Canto de edificação'),
(2, 'Entroncamento de estrada'),
(3, 'Cerca ou muro'),
(4, 'Elemento identificável no solo'),
(5, 'Elemento não identificável no solo'),
(6, 'Topo de vegetação'),
(7, 'Abaixo de vegetação'),
(9999, 'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.tipo_ref (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT tipo_ref_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.tipo_ref (code,code_name) VALUES
(1,'Altimétrico'),
(2,'Planimétrico'),
(3,'Planialtimétrico'),
(4,'Gravimétrico'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.sistema_geodesico (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT sistema_geodesico_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.sistema_geodesico (code,code_name) VALUES
(1,'SAD-69'),
(2,'SIRGAS2000'),
(3,'WGS-84'),
(4,'Córrego Alegre'),
(5,'Astro Chuá'),
(6,'SAD-69 (96)'),
(99,'Outra referência'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.referencial_altim (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT referencial_altim_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.referencial_altim (code,code_name) VALUES
(1,'Torres'),
(2,'Imbituba'),
(3,'Santana'),
(99,'Outra referência'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.metodo_posicionamento (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT metodo_posicionamento_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.metodo_posicionamento (code,code_name) VALUES
(1,'Posicionamento por ponto preciso (PPP)'),
(2,'Real Time Kinematic (RTK)'),
(3,'Semi-cinemático'),
(4,'Relativo Estático'),
(5,'Relativo Cinemático'),
(6,'Absoluto'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.tipo_medicao_altura (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT tipo_medicao_altura_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.tipo_medicao_altura (code,code_name) VALUES
(1,'Base de montagem'),
(2,'Altura inclinada'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.referencia_medicao_altura (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT referencia_medicao_altura_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.referencia_medicao_altura (code,code_name) VALUES
(1,'Nível do solo'),
(2,'Nível do objeto'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.orbita (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT orbita_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.orbita (code,code_name) VALUES
(1,'Ultra Rápida (predita)'),
(2,'Ultra Rápida (observada)'),
(3,'Rápida'),
(4,'Final'),
(97,'Não aplicável'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.tipo_pto_ref_geod_topo (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT tipo_pto_ref_geod_topo_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.tipo_pto_ref_geod_topo (code,code_name) VALUES
(0,'Desconhecido'),
(1,'Vértice de triangulação - VT'),
(2,'Referência de nível - RN'),
(3,'Estação gravimétrica - EG'),
(4,'Estação de poligonal - EP'),
(5,'Ponto astronômico - PA'),
(6,'Ponto barométrico - B'),
(7,'Ponto trigonométrico - RV'),
(8,'Ponto de satélite - SAT'),
(99,'Outros'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.tipo_marco_limite (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT tipo_marco_limite_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.tipo_marco_limite (code,code_name) VALUES
(3,'Municipal'),
(23,'Estadual'),
(24,'Internacional secundário'),
(25,'Internacional de referência'),
(26,'Internacional principal'),
(97,'Não aplicável'),
(99,'Outros'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.rede_referencia (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT rede_referencia_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.rede_referencia (code,code_name) VALUES
(0,'Desconhecida'),
(2,'Estadual'),
(3,'Municipal'),
(14,'Nacional'),
(15,'Privada'),
(97,'Não aplicável'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.referencial_grav (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT referencial_grav_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.referencial_grav (code,code_name) VALUES
(0,'Desconhecido'),
(1,'Potsdam 1930'),
(2,'IGSN71'),
(3,'Absoluto'),
(4,'Local'),
(5,'RGFB'),
(97,'Não aplicável'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.situacao_marco (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT situacao_marco_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.situacao_marco (code,code_name) VALUES
(0,'Desconhecida'),
(1,'Bom'),
(2,'Destruído'),
(3,'Destruído sem chapa'),
(4,'Destruí­do com chapa danificada'),
(5,'Não encontrado'),
(6,'Não visitado'),
(7,'Não construí­do'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.insumo_medicao (
    code smallint NOT NULL,
    code_name text NOT NULL,
    CONSTRAINT insumo_medicao_pk PRIMARY KEY (code)
);

INSERT INTO ponto_controle.insumo_medicao (code,code_name) VALUES
(1,'Fototriangulação'),
(2,'Carta Topográfica'),
(3,'Ortoimagem'),
(9999,'A SER PREENCHIDO')
ON CONFLICT DO NOTHING;


CREATE TABLE IF NOT EXISTS ponto_controle.tipo_arquivo (
    code SMALLINT NOT NULL PRIMARY KEY,
    nome VARCHAR(255) NOT NULL UNIQUE,
    -- Quantos arquivos deste tipo um ponto pode ter. NULL = sem limite.
    maximo_por_ponto SMALLINT
);

INSERT INTO ponto_controle.tipo_arquivo (code, nome, maximo_por_ponto) VALUES
(1, 'Foto de rastreio', 4),
(2, 'Foto aerea', 1),
(3, 'Croqui manual', 1),
(4, 'Croqui digital', 1),
(5, 'Monografia', 1),
(6, 'RINEX', NULL),
(7, 'Arquivo bruto da coletora', NULL),
(8, 'Relatorio de processamento', NULL),
(9, 'Foto auxiliar', NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS ponto_controle.ponto (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    cod_ponto VARCHAR(255) UNIQUE NOT NULL,
    lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
    data_rastreio DATE NOT NULL,
    tipo_ref SMALLINT NOT NULL REFERENCES ponto_controle.tipo_ref(code) DEFAULT 9999,
    latitude REAL,
    longitude REAL,
    norte FLOAT,
    leste FLOAT,
    altitude_ortometrica REAL,
    altitude_geometrica REAL,
    sistema_geodesico SMALLINT NOT NULL REFERENCES  ponto_controle.sistema_geodesico(code) DEFAULT 9999,
    outra_ref_plan VARCHAR(255),
    referencial_altim SMALLINT NOT NULL REFERENCES  ponto_controle.referencial_altim(code) DEFAULT 9999,
    outro_ref_alt VARCHAR(255),
    fuso VARCHAR(255),
    meridiano_central VARCHAR(255),
    tipo_situacao SMALLINT NOT NULL REFERENCES ponto_controle.tipo_situacao(code) DEFAULT 9999,
    reserva BOOLEAN NOT NULL DEFAULT FALSE,
    lote VARCHAR(255),
    latitude_planejada REAL,
    longitude_planejada REAL,
    medidor VARCHAR(255),
    inicio_rastreio TIMESTAMP WITH TIME ZONE,
    fim_rastreio TIMESTAMP WITH TIME ZONE,
    classificacao_ponto SMALLINT NOT NULL REFERENCES ponto_controle.classificacao_ponto(code) DEFAULT 9999,
    observacao VARCHAR(255),
    metodo_posicionamento SMALLINT NOT NULL REFERENCES ponto_controle.metodo_posicionamento(code) DEFAULT 9999,
    ponto_base VARCHAR(255),
    materializado BOOLEAN NOT NULL DEFAULT FALSE,
    altura_antena REAL,
    tipo_medicao_altura SMALLINT NOT NULL REFERENCES ponto_controle.tipo_medicao_altura(code) DEFAULT 9999,
    referencia_medicao_altura SMALLINT NOT NULL REFERENCES ponto_controle.referencia_medicao_altura(code) DEFAULT 9999,
    altura_objeto REAL,
    mascara_elevacao REAL,
    taxa_gravacao REAL,
    modelo_gps VARCHAR(255),
    modelo_antena VARCHAR(255),
    numero_serie_gps VARCHAR(255),
    numero_serie_antena VARCHAR(255),
    modelo_geoidal VARCHAR(255),
    precisao_horizontal_esperada REAL,
    precisao_vertical_esperada REAL,
    freq_processada VARCHAR(255),
    data_processamento DATE,
    orbita SMALLINT NOT NULL REFERENCES ponto_controle.orbita(code) DEFAULT 9999,
    orgao_executante VARCHAR(255),
    projeto VARCHAR(255),
    engenheiro_responsavel VARCHAR(255),
    crea_engenheiro_responsavel VARCHAR(255),
    cpf_engenheiro_responsavel VARCHAR(255),
    geometria_aproximada BOOLEAN NOT NULL DEFAULT FALSE,
    tipo_pto_ref_geod_topo SMALLINT NOT NULL REFERENCES ponto_controle.tipo_pto_ref_geod_topo(code) DEFAULT 9999,
    tipo_marco_limite SMALLINT NOT NULL REFERENCES ponto_controle.tipo_marco_limite(code) DEFAULT 9999,
    rede_referencia SMALLINT NOT NULL REFERENCES ponto_controle.rede_referencia(code) DEFAULT 9999,
    referencial_grav SMALLINT NOT NULL REFERENCES ponto_controle.referencial_grav(code) DEFAULT 9999,
    situacao_marco SMALLINT NOT NULL REFERENCES ponto_controle.situacao_marco(code) DEFAULT 9999,
    data_visita DATE,
    valor_gravidade REAL,
    geom geometry(POINT, 4674) NOT NULL,
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    data_modificacao TIMESTAMP WITH TIME ZONE,
    usuario_modificacao_uuid UUID REFERENCES dgeo.usuario (uuid)
);

CREATE INDEX IF NOT EXISTS ponto_geom ON ponto_controle.ponto USING gist (geom);
CREATE INDEX IF NOT EXISTS ponto_lote ON ponto_controle.ponto (lote_id);
CREATE INDEX IF NOT EXISTS ponto_situacao ON ponto_controle.ponto (tipo_situacao);

CREATE TABLE IF NOT EXISTS ponto_controle.arquivo (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    uuid_arquivo UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    ponto_id BIGINT NOT NULL REFERENCES ponto_controle.ponto (id) ON DELETE CASCADE,
    tipo_arquivo_id SMALLINT NOT NULL REFERENCES ponto_controle.tipo_arquivo (code),
    nome_arquivo TEXT NOT NULL,
    extensao VARCHAR(20),
    tamanho_mb REAL,
    checksum VARCHAR(64) NOT NULL,
    volume_armazenamento_id INTEGER NOT NULL REFERENCES acervo.volume_armazenamento (id),
    metadado JSONB,
    data_cadastramento TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    usuario_cadastramento_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid),
    CONSTRAINT unique_arquivo_por_ponto UNIQUE (checksum, ponto_id)
);

CREATE INDEX IF NOT EXISTS arquivo_ponto ON ponto_controle.arquivo (ponto_id);

CREATE TABLE IF NOT EXISTS ponto_controle.upload_session (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    uuid_session UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
    operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('importar_missao')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    lote_id BIGINT NOT NULL REFERENCES acervo.lote (id),
    substituir BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiration_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '24 hours',
    completed_at TIMESTAMP WITH TIME ZONE,
    usuario_uuid UUID NOT NULL REFERENCES dgeo.usuario (uuid)
);

CREATE TABLE IF NOT EXISTS ponto_controle.upload_ponto_temp (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES ponto_controle.upload_session (id) ON DELETE CASCADE,
    cod_ponto VARCHAR(255) NOT NULL,
    -- DOUBLE PRECISION, e não o REAL das colunas do ponto: daqui sai a geometria,
    -- e float4 perde 1 cm na sétima casa decimal.
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    atributos JSONB NOT NULL,
    ponto_id BIGINT REFERENCES ponto_controle.ponto (id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    error_message TEXT,
    CONSTRAINT unique_cod_ponto_na_sessao UNIQUE (session_id, cod_ponto)
);

CREATE TABLE IF NOT EXISTS ponto_controle.upload_arquivo_temp (
    id BIGSERIAL NOT NULL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES ponto_controle.upload_session (id) ON DELETE CASCADE,
    ponto_temp_id BIGINT NOT NULL REFERENCES ponto_controle.upload_ponto_temp (id) ON DELETE CASCADE,
    tipo_arquivo_id SMALLINT NOT NULL REFERENCES ponto_controle.tipo_arquivo (code),
    nome_arquivo TEXT NOT NULL,
    extensao VARCHAR(20),
    destination_path TEXT NOT NULL,
    volume_armazenamento_id INTEGER NOT NULL REFERENCES acervo.volume_armazenamento (id),
    tamanho_mb REAL,
    expected_checksum VARCHAR(64) NOT NULL,
    metadado JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS upload_arquivo_temp_sessao ON ponto_controle.upload_arquivo_temp (session_id);
CREATE INDEX IF NOT EXISTS upload_ponto_temp_sessao ON ponto_controle.upload_ponto_temp (session_id);

-- Postgres nao tem ADD CONSTRAINT IF NOT EXISTS, entao a guarda e explicita:
-- sem ela, reaplicar a migracao aborta a transacao inteira no 42710.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'produto_nao_e_ponto_controle'
          AND conrelid = 'acervo.produto'::regclass
    ) THEN
        ALTER TABLE acervo.produto
            ADD CONSTRAINT produto_nao_e_ponto_controle CHECK (tipo_produto_id <> 10);
    END IF;
END $$;

-- A plataforma passa a EXIGIR este schema: MIN_DATABASE_VERSION em
-- server/src/config.js sobe junto, e o servico recusa subir sem ele.
UPDATE public.versao SET nome = '1.6.0' WHERE code = 1;

COMMIT;
