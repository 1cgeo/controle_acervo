-- A versao PLANEJADA: a folha que o acervo ainda vai produzir para atender um
-- pedido da mapoteca.
--
-- O PROBLEMA. O DIEx 4425 do 30o BI Mec pede 16 folhas 1:25.000 das familias
-- 2758 e 2784 (Arapongas, Londrina, Apucarana, Tamarana) em Carta Ortoimagem,
-- 240 copias. Nenhuma existe: nao ha NENHUM produto 1:25.000 nessas duas
-- familias, em tipo nenhum. Nao e lacuna de catalogacao, e producao a fazer.
--
-- POR QUE NAO DEIXAR NA OBSERVACAO do item, que foi a primeira ideia. Porque a
-- observacao e prosa: o MI nao vira campo, o cruzamento mapoteca x SCA nao
-- enxerga a folha, o relatorio nao conta as 240 copias, e "o que falta produzir"
-- vira planilha paralela. O SCA passa a mentir por omissao no proprio numero.
--
-- POR QUE NAO O ITEM AVULSO. Avulso e o que NAO e nosso produto (papel
-- quadriculado, impresso de ocasiao). Estas folhas SAO nossas: so ainda nao
-- existem. Usar avulso aqui esconderia justamente a lacuna que se quer ver.
--
-- O QUE JA EXISTIA e este tipo so torna explicito: 408 versoes do acervo hoje
-- nao tem nenhum arquivo, e 17 itens de pedido ja apontam para uma delas. O
-- estado "produto e versao cadastrados, arquivo ainda nao" e normal aqui. O que
-- faltava era DIZER a diferenca entre "nao tem arquivo porque e registro
-- historico" e "nao tem arquivo porque ainda vamos produzir".
--
-- COMO O CICLO FECHA. Quando a producao terminar, o arquivo entra NA MESMA
-- versao. O item do pedido nao muda, o pedido nao muda, e a folha passa sozinha
-- de "sem arquivo" para imprimivel na fila de impressao, que ja trata
-- uuid_arquivo nulo e ja publica o contador itens_sem_arquivo.
--
-- LIMITE CONHECIDO, registrado de proposito: acervo.versao exige data_edicao, e
-- uma folha nao produzida nao tem data de edicao. Grava-se a data do
-- cadastramento. Quem carrega a verdade e o tipo_versao_id = 3 mais a ausencia
-- de arquivo, nunca a data. Ao concluir a producao, corrija a data_edicao junto
-- com a entrada do arquivo.

BEGIN;

INSERT INTO dominio.tipo_versao (code, nome) VALUES (3, 'Planejada')
    ON CONFLICT (code) DO NOTHING;

-- O gatilho so era permissivo para o tipo 2, e o caminho estrito exige o ano
-- corrente e a versao sequencial anterior. Versao planejada nao cumpre nem faz
-- sentido cumprir: ela e uma promessa, nao uma edicao. A condicao passa a ser
-- "nao e Regular", que e o que a regra sempre quis dizer.
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
    -- Coerencia produto<->subtipo (identidade do produto pelo subtipo, chefe 2026-07-06).
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

COMMIT;

-- Para desfazer: apagar as versoes de tipo 3, devolver o gatilho a condicao
-- "NEW.tipo_versao_id = 2" e remover o code 3 do dominio.
