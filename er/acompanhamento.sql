CREATE OR REPLACE FUNCTION acervo.criar_views_materializadas() RETURNS void AS $$
DECLARE
    tipo RECORD;
    escala RECORD;
    view_name TEXT;
    query TEXT;
BEGIN    
    FOR tipo IN SELECT code, nome FROM dominio.tipo_produto LOOP
        FOR escala IN SELECT code, nome FROM dominio.tipo_escala LOOP
            view_name := 'mv_produto_' || tipo.code || '_' || escala.code;
                        
            query := format('
                CREATE MATERIALIZED VIEW IF NOT EXISTS acervo.%I AS
                WITH ultima_versao AS (
                    SELECT DISTINCT ON (v.produto_id)
                        v.id AS versao_id,
                        v.produto_id,
                        v.nome AS nome_versao,
                        v.versao,
                        v.data_criacao,
                        v.data_edicao,
                        tv.nome AS tipo_versao,
                        sp.nome AS subtipo_produto,
                        l.nome AS nome_lote,
                        l.pit AS pit_lote,
                        pr.nome AS nome_projeto,
                        COUNT(DISTINCT a.id) AS num_arquivos_ultima,
                        COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS tamanho_total_gb_ultima
                    FROM acervo.versao v
                    LEFT JOIN dominio.tipo_versao tv ON v.tipo_versao_id = tv.code
                    LEFT JOIN dominio.subtipo_produto sp ON v.subtipo_produto_id = sp.code
                    LEFT JOIN acervo.lote l ON v.lote_id = l.id
                    LEFT JOIN acervo.projeto pr ON l.projeto_id = pr.id
                    LEFT JOIN acervo.arquivo a ON v.id = a.versao_id
                    WHERE v.produto_id IN (SELECT id FROM acervo.produto WHERE tipo_produto_id = %s AND tipo_escala_id = %s)
                    GROUP BY v.id, v.produto_id, v.versao, v.nome, tv.nome, sp.nome, l.nome, l.pit, pr.nome
                    ORDER BY v.produto_id, v.data_edicao DESC
                ),
                arquivo_tipos AS (
                    SELECT 
                        uv.versao_id,
                        ta.code AS tipo_arquivo_id,
                        ta.nome AS tipo_arquivo_nome,
                        COUNT(a.id) AS num_arquivos,
                        COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS tamanho_gb
                    FROM ultima_versao uv
                    JOIN acervo.arquivo a ON uv.versao_id = a.versao_id
                    JOIN dominio.tipo_arquivo ta ON a.tipo_arquivo_id = ta.code
                    GROUP BY uv.versao_id, ta.code, ta.nome
                ),
                arquivo_tipos_json AS (
                    SELECT 
                        versao_id,
                        COALESCE(
                            jsonb_agg(
                                jsonb_build_object(
                                    ''tipo_arquivo_id'', tipo_arquivo_id,
                                    ''tipo_arquivo_nome'', tipo_arquivo_nome,
                                    ''num_arquivos'', num_arquivos,
                                    ''tamanho_gb'', tamanho_gb
                                )
                            ),
                            ''[]''::jsonb
                        ) AS arquivo_tipos
                    FROM arquivo_tipos
                    GROUP BY versao_id
                )
                SELECT 
                    p.id, 
                    p.nome, 
                    p.mi, 
                    p.inom, 
                    te.nome AS escala,
                    p.denominador_escala_especial, 
                    p.descricao,
                    p.tipo_produto_id,
                    p.tipo_escala_id,
                    tp.nome AS tipo_produto,
                    COUNT(DISTINCT v.id) AS num_versoes,
                    ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_criacao)::integer ORDER BY EXTRACT(YEAR FROM v.data_criacao)::integer DESC) AS anos_criacao,
                    ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_edicao)::integer ORDER BY EXTRACT(YEAR FROM v.data_edicao)::integer DESC) AS anos_edicao,
                    uv.versao_id AS versao_ultima_id,
                    uv.versao AS versao_ultima,
                    uv.nome_versao AS nome_versao_ultima,
                    uv.tipo_versao AS tipo_versao_ultima,
                    uv.subtipo_produto AS subtipo_produto_ultima,
                    uv.data_criacao AS data_criacao_ultima,
                    uv.data_edicao AS data_edicao_ultima,
                    uv.num_arquivos_ultima,
                    uv.tamanho_total_gb_ultima,
                    uv.nome_lote AS nome_lote_ultima,
                    uv.pit_lote AS pit_lote_ultima,
                    uv.nome_projeto AS nome_projeto_ultima,
                    atj.arquivo_tipos AS tipos_arquivo_ultima,
                    COUNT(DISTINCT a.id) AS num_arquivos_total,
                    COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS tamanho_total_gb,
                    p.data_cadastramento, 
                    u1.nome AS usuario_cadastramento,
                    p.data_modificacao, 
                    u2.nome AS usuario_modificacao,
                    p.geom
                FROM acervo.produto p
                INNER JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
                INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
                LEFT JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
                LEFT JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
                LEFT JOIN acervo.versao v ON p.id = v.produto_id
                LEFT JOIN acervo.arquivo a ON v.id = a.versao_id
                LEFT JOIN ultima_versao uv ON p.id = uv.produto_id
                LEFT JOIN arquivo_tipos_json atj ON uv.versao_id = atj.versao_id
                WHERE p.tipo_produto_id = %s AND p.tipo_escala_id = %s
                GROUP BY p.id, tp.nome, te.nome, u1.nome, u2.nome, uv.versao_id, uv.versao, uv.nome_versao, uv.tipo_versao, uv.subtipo_produto, uv.data_criacao, uv.data_edicao, uv.nome_lote, uv.pit_lote, uv.nome_projeto, uv.num_arquivos_ultima, uv.tamanho_total_gb_ultima, atj.arquivo_tipos
                WITH DATA;
                
                CREATE UNIQUE INDEX IF NOT EXISTS %I ON acervo.%I (id);
                CREATE INDEX IF NOT EXISTS idx_%I_geom ON acervo.%I USING gist (geom);
                GRANT SELECT ON TABLE acervo.%I TO PUBLIC;
            ', view_name, tipo.code, escala.code, tipo.code, escala.code, 'idx_' || view_name, view_name, view_name, view_name, view_name);
            
            EXECUTE query;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT acervo.criar_views_materializadas();

-- Função para atualizar com base em uma lista de produtos
CREATE OR REPLACE FUNCTION acervo.atualizar_mv_por_produtos(produto_ids integer[]) RETURNS void AS $$
DECLARE
    tipo_id integer;
    escala_id integer;
    view_name TEXT;
BEGIN
    FOR tipo_id, escala_id IN 
        SELECT DISTINCT tipo_produto_id, tipo_escala_id
        FROM acervo.produto 
        WHERE id = ANY(produto_ids)
    LOOP
        view_name := 'mv_produto_' || tipo_id || '_' || escala_id;
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY acervo.%I', view_name);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Função para atualizar com base em uma lista de versões
CREATE OR REPLACE FUNCTION acervo.atualizar_mv_por_versoes(versao_ids bigint[]) RETURNS void AS $$
DECLARE
    produto_ids integer[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT produto_id) INTO produto_ids
    FROM acervo.versao
    WHERE id = ANY(versao_ids);
    
    PERFORM acervo.atualizar_mv_por_produtos(produto_ids);
END;
$$ LANGUAGE plpgsql;

-- Função para atualizar com base em uma lista de arquivos
CREATE OR REPLACE FUNCTION acervo.atualizar_mv_por_arquivos(arquivo_ids bigint[]) RETURNS void AS $$
DECLARE
    produto_ids integer[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT p.id) INTO produto_ids
    FROM acervo.arquivo a
    JOIN acervo.versao v ON v.id = a.versao_id
    JOIN acervo.produto p ON p.id = v.produto_id
    WHERE a.id = ANY(arquivo_ids);
    
    PERFORM acervo.atualizar_mv_por_produtos(produto_ids);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION acervo.refresh_all_materialized_views() RETURNS void AS $$
DECLARE
    view_name TEXT;
BEGIN
    FOR view_name IN
        SELECT matviewname
        FROM pg_matviews
        WHERE schemaname = 'acervo' AND matviewname LIKE 'mv_produto_%'
    LOOP
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY acervo.%I', view_name);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ===== Triggers para auto-refresh de views materializadas =====
-- Utilizam FOR EACH STATEMENT com transition tables para processar em lote.
-- Cada refresh é protegido por exception handler para não bloquear a operação principal.

-- Helper: refresh por tipo_produto_id/tipo_escala_id diretamente (para casos de DELETE onde o registro já foi removido)
CREATE OR REPLACE FUNCTION acervo.atualizar_mv_por_tipo_escala(p_tipo_ids integer[], p_escala_ids integer[]) RETURNS void AS $$
DECLARE
    view_name TEXT;
    i integer;
BEGIN
    FOR i IN 1..array_length(p_tipo_ids, 1) LOOP
        view_name := 'mv_produto_' || p_tipo_ids[i] || '_' || p_escala_ids[i];
        IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'acervo' AND matviewname = view_name) THEN
            EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY acervo.%I', view_name);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ===== ARQUIVO triggers =====

-- Arquivo INSERT/UPDATE: registros existem na tabela, usar atualizar_mv_por_arquivos
CREATE OR REPLACE FUNCTION acervo.trg_refresh_mv_arquivo_upsert()
RETURNS TRIGGER AS $$
DECLARE
    affected_ids bigint[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT id) INTO affected_ids FROM new_table;
    IF affected_ids IS NOT NULL THEN
        BEGIN
            PERFORM acervo.atualizar_mv_por_arquivos(affected_ids);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Falha ao atualizar views materializadas após % em arquivo: %', TG_OP, SQLERRM;
        END;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Arquivo DELETE: registros já foram removidos, usar versao_ids da old_table
CREATE OR REPLACE FUNCTION acervo.trg_refresh_mv_arquivo_delete()
RETURNS TRIGGER AS $$
DECLARE
    affected_versao_ids bigint[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT versao_id) INTO affected_versao_ids FROM old_table;
    IF affected_versao_ids IS NOT NULL THEN
        BEGIN
            PERFORM acervo.atualizar_mv_por_versoes(affected_versao_ids);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Falha ao atualizar views materializadas após DELETE em arquivo: %', SQLERRM;
        END;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_mv_arquivo_insert
AFTER INSERT ON acervo.arquivo
REFERENCING NEW TABLE AS new_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_arquivo_upsert();

CREATE TRIGGER trg_refresh_mv_arquivo_update
AFTER UPDATE ON acervo.arquivo
REFERENCING NEW TABLE AS new_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_arquivo_upsert();

CREATE TRIGGER trg_refresh_mv_arquivo_delete
AFTER DELETE ON acervo.arquivo
REFERENCING OLD TABLE AS old_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_arquivo_delete();

-- ===== VERSAO triggers =====

-- Versão INSERT/UPDATE: registros existem na tabela, usar atualizar_mv_por_versoes
CREATE OR REPLACE FUNCTION acervo.trg_refresh_mv_versao_upsert()
RETURNS TRIGGER AS $$
DECLARE
    affected_ids bigint[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT id) INTO affected_ids FROM new_table;
    IF affected_ids IS NOT NULL THEN
        BEGIN
            PERFORM acervo.atualizar_mv_por_versoes(affected_ids);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Falha ao atualizar views materializadas após % em versao: %', TG_OP, SQLERRM;
        END;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Versão DELETE: registros já foram removidos, extrair produto_ids da old_table
CREATE OR REPLACE FUNCTION acervo.trg_refresh_mv_versao_delete()
RETURNS TRIGGER AS $$
DECLARE
    affected_produto_ids integer[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT produto_id::integer) INTO affected_produto_ids FROM old_table;
    IF affected_produto_ids IS NOT NULL THEN
        BEGIN
            PERFORM acervo.atualizar_mv_por_produtos(affected_produto_ids);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Falha ao atualizar views materializadas após DELETE em versao: %', SQLERRM;
        END;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_mv_versao_insert
AFTER INSERT ON acervo.versao
REFERENCING NEW TABLE AS new_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_versao_upsert();

CREATE TRIGGER trg_refresh_mv_versao_update
AFTER UPDATE ON acervo.versao
REFERENCING NEW TABLE AS new_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_versao_upsert();

CREATE TRIGGER trg_refresh_mv_versao_delete
AFTER DELETE ON acervo.versao
REFERENCING OLD TABLE AS old_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_versao_delete();

-- ===== PRODUTO triggers =====

-- Produto INSERT/UPDATE: registros existem na tabela, usar atualizar_mv_por_produtos
CREATE OR REPLACE FUNCTION acervo.trg_refresh_mv_produto_upsert()
RETURNS TRIGGER AS $$
DECLARE
    affected_ids integer[];
BEGIN
    SELECT ARRAY_AGG(DISTINCT id::integer) INTO affected_ids FROM new_table;
    IF affected_ids IS NOT NULL THEN
        BEGIN
            PERFORM acervo.atualizar_mv_por_produtos(affected_ids);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Falha ao atualizar views materializadas após % em produto: %', TG_OP, SQLERRM;
        END;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Produto DELETE: registros já foram removidos, extrair tipo/escala da old_table para refresh direto
CREATE OR REPLACE FUNCTION acervo.trg_refresh_mv_produto_delete()
RETURNS TRIGGER AS $$
DECLARE
    tipo_ids integer[];
    escala_ids integer[];
BEGIN
    SELECT ARRAY_AGG(tipo_produto_id::integer), ARRAY_AGG(tipo_escala_id::integer)
    INTO tipo_ids, escala_ids
    FROM (SELECT DISTINCT tipo_produto_id, tipo_escala_id FROM old_table) sub;

    IF tipo_ids IS NOT NULL THEN
        BEGIN
            PERFORM acervo.atualizar_mv_por_tipo_escala(tipo_ids, escala_ids);
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Falha ao atualizar views materializadas após DELETE em produto: %', SQLERRM;
        END;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_mv_produto_insert
AFTER INSERT ON acervo.produto
REFERENCING NEW TABLE AS new_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_produto_upsert();

CREATE TRIGGER trg_refresh_mv_produto_update
AFTER UPDATE ON acervo.produto
REFERENCING NEW TABLE AS new_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_produto_upsert();

CREATE TRIGGER trg_refresh_mv_produto_delete
AFTER DELETE ON acervo.produto
REFERENCING OLD TABLE AS old_table
FOR EACH STATEMENT
EXECUTE FUNCTION acervo.trg_refresh_mv_produto_delete();