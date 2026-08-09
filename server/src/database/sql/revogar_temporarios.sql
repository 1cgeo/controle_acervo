/*
    O MESMO DE `revogar_usuario.sql`, PARA TODOS OS PAPEIS TEMPORARIOS DE UMA VEZ.

    Devolve em `revoke_query` o lote de REVOKE de TODO papel cujo nome comeca
    pelo prefixo dos papeis efemeros deste subsistema. Quem executa o texto e
    `permissoes_producao.js`, na mesma conexao.

    ELA NAO VARRE O BANCO INTEIRO, E ESSA E A DIVERGENCIA QUE MAIS IMPORTA em
    relacao a `database/sql/revoke_all_users.sql` do SAP 2.3.5. La o lote saia
    com `FROM ... grantee` SEM FILTRO NENHUM: uma rota de web revogava tudo de
    TODO beneficiario do banco de edicao, inclusive do papel da aplicacao que
    escreve nele e do papel de leitura que alimenta os mapas. O efeito nao
    aparece na resposta -- ela diz "revogado com sucesso" -- e sim na proxima vez
    que alguem tenta usar o banco.

    O QUE ESTE SUBSISTEMA CRIOU E O QUE ELE PODE DESTRUIR. Os papeis efemeros
    nascem todos com o mesmo prefixo, declarado UMA vez em
    `permissoes_producao.js` e passado aqui como `$<prefixo>`; nenhum outro papel
    do banco de producao e alcancado. Quem precisa mexer nos papeis proprios do
    banco de edicao faz isso pelo DBA dele, e nao por uma rota deste servico.

    `left(grantee, length($<prefixo>)) = $<prefixo>` E NAO `LIKE`: o prefixo tem
    um `_`, que em LIKE e curinga de um caractere. Com LIKE, `sap_` casaria
    tambem `sapX`, e o filtro que existe para estreitar passaria a alargar.

    A LISTA DE PAPEIS SAI DE `pg_roles`, E NAO DE `role_table_grants`. A segunda
    so conhece quem tem grant em TABELA: o papel que ficou apenas com CONNECT no
    banco e USAGE num schema -- que e exatamente o estado de quem ja teve as
    tabelas revogadas uma vez -- nao apareceria ali, e a revogacao em massa o
    deixaria conectando. `pg_roles` conhece TODO papel do cluster, e o filtro de
    prefixo continua sendo o que limita o alcance.

    O RESTO E `revogar_usuario.sql`: os identificadores saem por `quote_ident`,
    e as sequencias e schemas sao varridos sem filtro de beneficiario pelo mesmo
    motivo escrito la.
*/
WITH temporarios AS (
    SELECT rolname AS grantee
    FROM pg_catalog.pg_roles
    WHERE left(rolname, length($<prefixo>)) = $<prefixo>
)
SELECT string_agg(query, ' ') AS revoke_query FROM (
    SELECT DISTINCT 'REVOKE ALL ON TABLE ' || quote_ident(tp.table_schema) || '.' ||
        quote_ident(tp.table_name) || ' FROM ' || quote_ident(tp.grantee) || ';' AS query
    FROM information_schema.table_privileges AS tp
    INNER JOIN temporarios AS t ON t.grantee = tp.grantee
    WHERE tp.table_schema NOT IN ('information_schema')
      AND tp.table_schema !~ '^pg_'
    UNION ALL
    SELECT DISTINCT 'REVOKE ALL ON FUNCTION ' || quote_ident(rp.routine_schema) || '.' ||
        quote_ident(rp.routine_name) || '(' ||
        pg_get_function_identity_arguments(
            (regexp_matches(rp.specific_name, '.*_([0-9]+)'))[1]::oid) ||
        ') FROM ' || quote_ident(rp.grantee) || ';' AS query
    FROM information_schema.routine_privileges AS rp
    INNER JOIN temporarios AS t ON t.grantee = rp.grantee
    WHERE rp.routine_schema != 'pg_catalog'
    UNION ALL
    SELECT 'REVOKE ALL ON SEQUENCE ' || quote_ident(ss.sequence_schema) || '.' ||
        quote_ident(ss.sequence_name) || ' FROM ' || quote_ident(t.grantee) || ';' AS query
    FROM information_schema.sequences AS ss CROSS JOIN temporarios AS t
    UNION ALL
    SELECT 'REVOKE ALL ON SCHEMA ' || quote_ident(sc.schema_name) || ' FROM ' ||
        quote_ident(t.grantee) || ';' AS query
    FROM information_schema.schemata AS sc CROSS JOIN temporarios AS t
    WHERE sc.schema_name NOT IN ('information_schema')
      AND sc.schema_name !~ '^pg_'
    UNION ALL
    SELECT 'REVOKE CONNECT ON DATABASE ' || quote_ident(current_database()) ||
        ' FROM ' || quote_ident(t.grantee) || ';' AS query
    FROM temporarios AS t
) AS foo;
