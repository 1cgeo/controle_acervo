-- Migracao 2026-07-06: identidade do produto refinada pelo SUBTIPO.
-- Decisao do chefe (Opcao A): carta militar e um PRODUTO distinto da carta civil,
-- e a chave para distinguir e o SUBTIPO (nao o tipo_produto). No modelo, o produto
-- civil (Carta Topografica) abrange subtipos 2 (T34-700) e 12 (ET-RDG) na mesma linha,
-- entao a chave nao pode ser o subtipo cru: acervo.produto.subtipo_produto_id fica
-- NULL para o produto civil e recebe o subtipo quando ELE define a identidade
-- (ex.: 24 = Carta Topografica Militar). dominio.subtipo_produto.define_produto marca
-- quais subtipos exigem produto proprio (militar). Ver DECISIONS 2026-07-06.
-- Aplicar com: psql --single-transaction -v ON_ERROR_STOP=1 -f <este arquivo>

-- 1. Dominio: flag "este subtipo define seu proprio produto"
ALTER TABLE dominio.subtipo_produto
  ADD COLUMN IF NOT EXISTS define_produto BOOLEAN NOT NULL DEFAULT false;
UPDATE dominio.subtipo_produto SET define_produto = true WHERE code = 24; -- Carta Topografica Militar

-- 2. Produto: subtipo que refina a identidade (NULL = identidade so por (mi,escala,tipo))
ALTER TABLE acervo.produto
  ADD COLUMN IF NOT EXISTS subtipo_produto_id SMALLINT REFERENCES dominio.subtipo_produto (code);

-- 3a. Backfill: produtos militar-PURO (todas as versoes subtipo 24) viram produto militar
UPDATE acervo.produto p SET subtipo_produto_id = 24
 WHERE EXISTS (SELECT 1 FROM acervo.versao v WHERE v.produto_id = p.id AND v.subtipo_produto_id = 24)
   AND NOT EXISTS (SELECT 1 FROM acervo.versao v WHERE v.produto_id = p.id AND v.subtipo_produto_id <> 24);

-- 3b. Split: produtos MISTOS (militar + civil na mesma linha) -> separa o militar num
-- produto proprio (mesma folha/geom/nome), movendo as versoes subtipo 24 para ele.
-- A linha original fica com as versoes civis e subtipo_produto_id = NULL.
DO $$
DECLARE r RECORD; new_id BIGINT;
BEGIN
  FOR r IN
    SELECT p.* FROM acervo.produto p
     WHERE EXISTS (SELECT 1 FROM acervo.versao v WHERE v.produto_id = p.id AND v.subtipo_produto_id = 24)
       AND EXISTS (SELECT 1 FROM acervo.versao v WHERE v.produto_id = p.id AND v.subtipo_produto_id <> 24)
  LOOP
    INSERT INTO acervo.produto
      (nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id,
       descricao, geom, subtipo_produto_id, data_cadastramento, usuario_cadastramento_uuid)
    VALUES
      (r.nome, r.mi, r.inom, r.tipo_escala_id, r.denominador_escala_especial, r.tipo_produto_id,
       r.descricao, r.geom, 24, now(), r.usuario_cadastramento_uuid)
    RETURNING id INTO new_id;

    UPDATE acervo.versao SET produto_id = new_id
     WHERE produto_id = r.id AND subtipo_produto_id = 24;
  END LOOP;
END $$;

-- 4. Unicidade nova: (mi, escala, tipo, subtipo). COALESCE(...,0) mantem o civil (NULL)
-- unico e deixa o militar (24) coexistir. Parcial WHERE mi IS NOT NULL: especiais/campos
-- de instrucao (mi NULL, bbox propria) ficam de fora, como ja era.
CREATE UNIQUE INDEX IF NOT EXISTS unique_produto_identidade
  ON acervo.produto (mi, tipo_escala_id, tipo_produto_id, COALESCE(subtipo_produto_id, 0))
  WHERE mi IS NOT NULL;

-- 5. Trigger: coerencia versao <-> produto.
--    - se o produto tem subtipo setado, toda versao dele deve ter esse subtipo;
--    - subtipo que "define_produto" (militar) so pode viver em produto proprio.
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
    -- Coerencia produto<->subtipo (identidade do produto pelo subtipo). Antes do
    -- early-return para valer inclusive quando so muda produto_id (mover versao).
    SELECT subtipo_produto_id INTO prod_subtipo FROM acervo.produto WHERE id = NEW.produto_id;
    SELECT define_produto INTO subtipo_exige_proprio FROM dominio.subtipo_produto WHERE code = NEW.subtipo_produto_id;

    IF prod_subtipo IS NOT NULL AND NEW.subtipo_produto_id <> prod_subtipo THEN
        RAISE EXCEPTION 'Versao (subtipo %) incompativel com o produto, que e do subtipo %', NEW.subtipo_produto_id, prod_subtipo;
    END IF;
    IF subtipo_exige_proprio AND (prod_subtipo IS NULL OR prod_subtipo <> NEW.subtipo_produto_id) THEN
        RAISE EXCEPTION 'Subtipo % exige produto proprio (produto.subtipo_produto_id = %); nao pode ser versao de um produto de outro subtipo', NEW.subtipo_produto_id, NEW.subtipo_produto_id;
    END IF;

    -- Em UPDATE, validar o formato da versao apenas quando o campo versao mudou — senao
    -- registros legados ("Xª Edição") ficam imutaveis apos 2024 (qualquer UPDATE falharia)
    IF TG_OP = 'UPDATE' AND NEW.versao IS NOT DISTINCT FROM OLD.versao THEN
        RETURN NEW;
    END IF;

    -- Registros historicos (tipo_versao_id = 2) carregam acervo legado:
    -- aceitam o formato antigo "Xª Edição" independentemente do ano e nao
    -- exigem a versao sequencial anterior (a carga pode ser parcial)
    IF NEW.tipo_versao_id = 2 THEN
        IF NEW.versao !~ '^[0-9]+ª Edição$' AND NEW.versao !~ '^[0-9]+-[A-Z]{1,5}$' THEN
            RAISE EXCEPTION 'Formato inválido para versão: %', NEW.versao;
        END IF;
        RETURN NEW;
    END IF;

    -- Get the current year
    current_year := EXTRACT(YEAR FROM CURRENT_DATE);

    -- Check for old standard: "Xª Edição"
    IF NEW.versao ~ '^[0-9]+ª Edição$' THEN
        RETURN NEW;
    -- Check for new standard: "X-YYYYY" where X is a number and YYYYY is 1-5 uppercase letters
    ELSIF NEW.versao ~ '^[0-9]+-[A-Z]{1,5}$' THEN
        version_number := (regexp_matches(NEW.versao, '^([0-9]+)-([A-Z]{1,5})$'))[1]::INTEGER;
        acronym := (regexp_matches(NEW.versao, '^([0-9]+)-([A-Z]{1,5})$'))[2];

        IF version_number > 1 THEN
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
