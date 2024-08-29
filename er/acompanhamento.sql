CREATE OR REPLACE FUNCTION acervo.criar_views_materializadas() RETURNS void AS $$
DECLARE
    tipo RECORD;
    view_name TEXT;
    query TEXT;
BEGIN
    FOR tipo IN SELECT code, nome FROM dominio.tipo_produto LOOP
        view_name := 'mv_produto_' || tipo.code;
        
        query := format('
            CREATE MATERIALIZED VIEW IF NOT EXISTS acervo.%I AS
            SELECT p.id, p.nome, p.mi, p.inom, p.denominador_escala, p.descricao,
                   p.geom, %L AS tipo_produto,
                   p.data_cadastramento, u1.nome AS usuario_cadastramento,
                   p.data_modificacao, u2.nome AS usuario_modificacao,
                   COUNT(DISTINCT v.id) AS num_versoes,
                   MAX(v.data_criacao) AS data_criacao_recente,
                   MAX(v.data_edicao) AS data_edicao_recente,
					ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_criacao)::integer ORDER BY EXTRACT(YEAR FROM v.data_criacao)::integer DESC) AS anos_criacao,
                   ARRAY_AGG(DISTINCT EXTRACT(YEAR FROM v.data_edicao)::integer ORDER BY EXTRACT(YEAR FROM v.data_edicao)::integer DESC) AS anos_edicao,
                   COUNT(DISTINCT a.id) AS num_arquivos,
                   COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS tamanho_total_gb
            FROM acervo.produto p
            INNER JOIN dgeo.usuario AS u1 ON u1.uuid = p.usuario_cadastramento_uuid
            INNER JOIN dgeo.usuario AS u2 ON u2.uuid = p.usuario_modificacao_uuid
            LEFT JOIN acervo.versao v ON p.id = v.produto_id
            LEFT JOIN acervo.arquivo a ON v.id = a.versao_id
			WHERE p.tipo_produto_id = %s
            GROUP BY p.id, u1.nome, u2.nome
            WITH DATA;
            
            CREATE UNIQUE INDEX IF NOT EXISTS %I ON acervo.%I (id);
            CREATE INDEX IF NOT EXISTS idx_%I_geom ON acervo.%I USING gist (geom);
            GRANT SELECT ON TABLE acervo.%I TO PUBLIC;
        ', view_name, tipo.nome, tipo.code, 'idx_' || view_name, view_name, view_name, view_name, view_name);
        
        EXECUTE query;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT acervo.criar_views_materializadas();

-- Função para atualizar com base em uma lista de produtos
CREATE OR REPLACE FUNCTION acervo.atualizar_mv_por_produtos(produto_ids integer[]) RETURNS void AS $$
DECLARE
    tipo_id integer;
    view_name TEXT;
BEGIN
    FOR tipo_id IN 
        SELECT DISTINCT tipo_produto_id 
        FROM acervo.produto 
        WHERE id = ANY(produto_ids)
    LOOP
        view_name := 'acervo.mv_produto_' || tipo_id;
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', view_name);
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