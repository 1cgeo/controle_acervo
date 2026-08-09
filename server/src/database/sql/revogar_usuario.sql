/*
    O SQL QUE REVOGA TUDO DE UM PAPEL, GERADO PELO PROPRIO BANCO DE PRODUCAO.

    Ela NAO revoga nada: ela DEVOLVE, na coluna `revoke_query`, o texto de um
    lote de REVOKE montado a partir dos catalogos do banco em que roda. Quem o
    executa e `permissoes_producao.js`, na mesma conexao.

    POR QUE GERAR EM VEZ DE ESCREVER. As permissoes foram concedidas camada a
    camada, e as camadas mudam de subfase para subfase e de lote para lote: um
    REVOKE escrito a mao envelheceria na primeira camada nova, e o efeito de
    envelhecer aqui e permissao que sobra num banco de edicao -- exatamente o
    que este subsistema existe para impedir. O catalogo do banco e a unica fonte
    que sabe o que aquele papel tem HOJE.

    VEIO DE `database/sql/revoke.sql` DO SAP 2.3.5, com tres mudancas:

    1. `grantee = $<login>` E NAO `grantee ~* $1`. La a comparacao era uma
       EXPRESSAO REGULAR sem ancora, e o login entrava nela cru: o papel
       `sap_ana` casaria com `sap_ana_maria`, e a revogacao de uma pessoa levaria
       junto a permissao da outra. Igualdade e o que se queria dizer.

    2. TODO IDENTIFICADOR SAI POR `quote_ident`. O texto gerado aqui vira DDL, e
       ali entram nomes vindos de tabela (schema, tabela, sequencia, papel). Sem
       o quote, um nome com maiuscula ou com espaco produz DDL invalido, e o lote
       inteiro falha -- uma revogacao que nao revoga e pior do que uma que
       estoura, porque ela responde sucesso.

    3. O PARAMETRO E POR NOME (`$<login>`), e nao posicional. E a convencao da
       casa, e e o que permite a mesma chave aparecer cinco vezes aqui sem
       repetir o valor na chamada. A origem usava `PreparedStatement`, que so
       aceita `$1`.

    AS SEQUENCIAS E OS SCHEMAS SAO VARRIDOS SEM FILTRO DE GRANTEE, e e de
    proposito: `information_schema` nao expoe privilegio de sequencia nem de
    schema por beneficiario de forma confiavel. REVOKE de permissao que o papel
    nao tem e no-op no PostgreSQL, entao varrer custa texto e nao custa efeito.
*/
SELECT string_agg(query, ' ') AS revoke_query FROM (
    SELECT DISTINCT 'REVOKE ALL ON TABLE ' || quote_ident(table_schema) || '.' ||
        quote_ident(table_name) || ' FROM ' || quote_ident($<login>) || ';' AS query
    FROM information_schema.table_privileges
    WHERE grantee = $<login>
      AND table_schema NOT IN ('information_schema')
      AND table_schema !~ '^pg_'
    UNION ALL
    SELECT DISTINCT 'REVOKE ALL ON FUNCTION ' || quote_ident(routine_schema) || '.' ||
        quote_ident(routine_name) || '(' ||
        pg_get_function_identity_arguments(
            (regexp_matches(specific_name, '.*_([0-9]+)'))[1]::oid) ||
        ') FROM ' || quote_ident($<login>) || ';' AS query
    FROM information_schema.routine_privileges
    WHERE grantee = $<login>
      AND routine_schema != 'pg_catalog'
    UNION ALL
    SELECT 'REVOKE ALL ON SEQUENCE ' || quote_ident(sequence_schema) || '.' ||
        quote_ident(sequence_name) || ' FROM ' || quote_ident($<login>) || ';' AS query
    FROM information_schema.sequences
    UNION ALL
    SELECT 'REVOKE ALL ON SCHEMA ' || quote_ident(schema_name) || ' FROM ' ||
        quote_ident($<login>) || ';' AS query
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('information_schema')
      AND schema_name !~ '^pg_'
    UNION ALL
    SELECT 'REVOKE CONNECT ON DATABASE ' || quote_ident(current_database()) ||
        ' FROM ' || quote_ident($<login>) || ';' AS query
) AS foo;
