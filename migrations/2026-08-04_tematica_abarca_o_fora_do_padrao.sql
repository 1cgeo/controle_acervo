-- Migracao 2026-08-04: Carta tematica passa a abarcar o que foge do padrao.
--
-- Decisao do chefe (2026-08-04). O tipo de produto passa a nomear a LINHA DE
-- PRODUCAO padrao, e o tipo 7 (Carta tematica) vira a prateleira do que nao cabe
-- nela. Tres movimentos:
--
--   1. Carta Ortoimagem (tipo 3) fica SO com folha do SCN. Os dois subtipos que
--      nao sao folha (19 e 27) mudam de tipo para o 7.
--   2. O subtipo 19 passa a se chamar pelo SENSOR e nao pelo alvo: era "Carta
--      ortoimagem de OM", vira "Carta Ortoimagem de SARP". A prova esta na
--      prancha: o bloco INFORMACOES TECNICAS DA ORTOIMAGEM lista o sensor
--      "CMOS 1'', plataforma RPA, 0,03 m" nos dois subtipos. O que os separava
--      era o ALVO (OM contra area), e nao a origem da imagem.
--   3. Nasce o subtipo 30 "CDGV Especial" sob CDGV tematico (tipo 8), para o
--      vetor que nao segue modelagem de mapeamento sistematico.
--
-- A Carta Topografica Nao-SCN (subtipo 28) NAO acompanha, por decisao do chefe:
-- ela e carta topografica de area, e o tipo dela descreve bem o que ela e.
--
-- Tres classes de dado se reclassificam junto, e as tres foram provadas na
-- fonte primaria (prancha e selo), nunca no nome do registro:
--
--   G1 (26 produtos) - ortoimagem de folha do SCN cadastrada como "Especial".
--     Lote 2026_ExtraPIT_COesp_14BdaInfMtz, todas com MI e INOM. Defeito de
--     carga: voltam ao subtipo 3 e PERMANECEM no tipo 3.
--   G2 (44 produtos) - carta imagem sobre folha do SCN. 42 sao "MOSAICO
--     SEMICONTROLADO DE RADAR" do PROJETO RADAMBRASIL (Ministerio das Minas e
--     Energia / DNPM, executado pela LASA, radar GEMS 1000 banda X, 1976) e 2
--     sao "CARTA IMAGEM SATELITE PRELIMINAR" da DSG (Landsat-5, 1995). Nao sao
--     ortoimagem, e 42 delas nem sao produto nosso. Seguem no subtipo 27.
--   G3 (45 produtos) - carta de SARP cadastrada como "Especial". Mesma producao
--     das do subtipo 19, muda so o alvo. Passam ao subtipo 19.
--
-- Aplicar com: psql --single-transaction -v ON_ERROR_STOP=1 -f <este arquivo>
-- Idempotente: reaplicar nao muda nada (todo UPDATE e condicionado ao estado
-- de origem, e o INSERT do subtipo tem ON CONFLICT).

-- ---------------------------------------------------------------------------
-- 1. Dominio
-- ---------------------------------------------------------------------------

-- 1a. O subtipo 19 muda de nome e de tipo.
UPDATE dominio.subtipo_produto
   SET nome = 'Carta Ortoimagem de SARP', tipo_id = 7
 WHERE code = 19;

-- 1b. O subtipo 27 muda de tipo.
UPDATE dominio.subtipo_produto
   SET tipo_id = 7
 WHERE code = 27;

-- 1c. Subtipo novo para o vetor fora do padrao, sob CDGV tematico.
INSERT INTO dominio.subtipo_produto (code, nome, tipo_id, define_produto)
VALUES (30, 'CDGV Especial', 8, false)
ON CONFLICT (code) DO NOTHING;

-- 1d. Roteamento de volume para o tipo 8, que ate agora nao tinha produto.
-- Sem ele o CDGV Especial nao tem volume primario, e a carga futura falha na
-- hora de resolver o destino. Volume 1 e o mesmo dos tipos 1, 2, 3 e 7.
-- O SELECT sai de acervo.volume_tipo_produto e nao de um id fixo: num banco
-- recem-instalado (o que o ensaiar_migracao.cjs monta) nao ha volume nenhum, e
-- um INSERT com id literal quebraria na chave estrangeira.
INSERT INTO acervo.volume_tipo_produto (tipo_produto_id, volume_armazenamento_id, primario)
SELECT 8, vtp.volume_armazenamento_id, true
  FROM acervo.volume_tipo_produto vtp
 WHERE vtp.tipo_produto_id = 7 AND vtp.primario
   AND NOT EXISTS (SELECT 1 FROM acervo.volume_tipo_produto WHERE tipo_produto_id = 8);

-- ---------------------------------------------------------------------------
-- 2. G1: ortoimagem de folha do SCN volta ao subtipo padrao (segue no tipo 3)
-- ---------------------------------------------------------------------------
UPDATE acervo.versao v
   SET subtipo_produto_id = 3
  FROM acervo.produto p
 WHERE p.id = v.produto_id
   AND v.subtipo_produto_id = 27
   AND p.id IN (6053,6054,6055,6056,6057,6058,6059,6060,6061,6062,6063,6064,6065,
                6066,6067,6068,6069,6070,6071,6072,6073,6074,6075,6076,6077,6078);

-- ---------------------------------------------------------------------------
-- 3. G3: carta de SARP cadastrada como Especial passa ao subtipo 19
-- ---------------------------------------------------------------------------
-- Nenhum destes tem produto.subtipo_produto_id preenchido (conferido em
-- 2026-08-04), entao o trigger validate_version nao bloqueia a troca.
UPDATE acervo.versao
   SET subtipo_produto_id = 19
 WHERE subtipo_produto_id = 27
   AND produto_id IN (4111,4112,4113,4114,4115,4116,4117,4121,4122,4125,4126,4127,
                      4128,4129,4130,4131,4132,4133,4134,4135,4136,4137,4138,4139,
                      4140,4141,4154,4155,4156,4157,4158,4159,4160,4161,4162,4164,
                      4166,4167,4168,4169,4170,4171,4172,4173,4194);

-- ---------------------------------------------------------------------------
-- 3b. Nome de folha errado em dois produtos de carta imagem
-- ---------------------------------------------------------------------------
-- Vem ANTES do split (3c) de proposito: o produto novo copia o nome do antigo,
-- e corrigir depois deixaria a metade nova com o nome errado.
--
-- Tres testemunhas independentes contra o nome gravado, nos dois casos: o
-- alternateTitle do XML de metadados que veio com o produto, e outros DOIS
-- produtos do acervo na MESMA folha (a carta topografica e o CDGV).
UPDATE acervo.produto SET nome = 'Guaíra'
 WHERE id = 5189 AND inom = 'SG-21-X-B' AND nome = 'Marechal Cândido Rondon';

UPDATE acervo.produto SET nome = 'Pedro Osório'
 WHERE id = 5201 AND inom = 'SH-22-Y-C' AND nome = 'Canguçu';

-- ---------------------------------------------------------------------------
-- 3c. Split: 19 produtos empilham DUAS naturezas na mesma folha
-- ---------------------------------------------------------------------------
-- Achado no ensaio da migracao sobre o dado real (2026-08-04). Estes 19
-- produtos tem DUAS versoes, ambas rotuladas "1ª Edição", que nao sao edicoes
-- uma da outra:
--   - subtipo 3, Carta Ortoimagem de verdade (backfill do BDGEx ostensivo de
--     2020, e no produto 638 a producao 1-DSG de 2023);
--   - subtipo 27, a carta imagem de radar de 1976 ou de satelite de 1995.
-- Elas coexistem no mesmo produto porque unique_version_per_product inclui o
-- subtipo. Sao produtos distintos sobre a mesma folha, e e o subtipo que os
-- distingue (regra do chefe de 2026-07-06).
--
-- O produto ORIGINAL fica com a ortoimagem e permanece no tipo 3. A carta
-- imagem vai para um produto NOVO, no tipo 7 e com o subtipo 27 pinado, igual
-- aos outros 25 do mesmo grupo, que ja nascem puros.
--
-- Idempotente por construcao: depois do split o original nao tem mais versao de
-- subtipo 27, entao o laco nao acha nada na segunda rodada.
DO $$
DECLARE r RECORD; novo_id BIGINT;
BEGIN
  FOR r IN
    SELECT p.* FROM acervo.produto p
     WHERE p.tipo_produto_id = 3
       AND p.subtipo_produto_id IS NULL
       AND EXISTS (SELECT 1 FROM acervo.versao v WHERE v.produto_id = p.id AND v.subtipo_produto_id = 27)
       AND EXISTS (SELECT 1 FROM acervo.versao v WHERE v.produto_id = p.id AND v.subtipo_produto_id = 3)
  LOOP
    INSERT INTO acervo.produto
      (nome, mi, inom, tipo_escala_id, denominador_escala_especial, tipo_produto_id,
       descricao, geom, subtipo_produto_id, data_cadastramento, usuario_cadastramento_uuid)
    VALUES
      (r.nome, r.mi, r.inom, r.tipo_escala_id, r.denominador_escala_especial, 7,
       r.descricao, r.geom, 27, now(), r.usuario_cadastramento_uuid)
    RETURNING id INTO novo_id;

    UPDATE acervo.versao SET produto_id = novo_id
     WHERE produto_id = r.id AND subtipo_produto_id = 27;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Os produtos dos subtipos 19 e 27 passam ao tipo 7 (Carta tematica)
-- ---------------------------------------------------------------------------
-- Depois do passo 2, nenhum produto do tipo 3 com versao de subtipo 19 ou 27 e
-- folha do SCN de ortoimagem. A condicao resolve pelo ESTADO, e nao por lista,
-- justamente para nao divergir dos passos acima se a lista mudar.
UPDATE acervo.produto p
   SET tipo_produto_id = 7
 WHERE p.tipo_produto_id = 3
   AND EXISTS (SELECT 1 FROM acervo.versao v
                WHERE v.produto_id = p.id AND v.subtipo_produto_id IN (19, 27));

-- ---------------------------------------------------------------------------
-- 5. CDGV das Organizacoes Militares vai para CDGV tematico
-- ---------------------------------------------------------------------------
-- Produto 5581. E o par vetorial da familia "Mapa de unidades" (subtipo 14), e
-- o proprio metadado da carga ja dizia que a modelagem e "EDGV Defesa F Ter",
-- e nao a ET-EDGV 2.1.3 com que foi cadastrado. O nome ganha o acento.
UPDATE acervo.versao SET subtipo_produto_id = 30
 WHERE produto_id = 5581 AND subtipo_produto_id = 1;

UPDATE acervo.produto
   SET tipo_produto_id = 8, nome = 'Unidades do Exército Brasileiro 2019'
 WHERE id = 5581 AND tipo_produto_id = 1;

-- ---------------------------------------------------------------------------
-- 6. Produtos de operacao e exercicio saem de Nao-SCN para Carta Tematica
-- ---------------------------------------------------------------------------
-- 4189 Tramandatai - Area da Operacao, 4191 SESI - 8a Bda Inf Mtz, e os quatro
-- de Carana (exercicio da EAOP), que ja tem uma irma cadastrada como Carta
-- Aeronautica (produto 6101). Os dois mosaicos do mesmo lote de carga (4190 e
-- 4192) FICAM em Nao-SCN, por decisao do chefe: sao mosaico topografico.
UPDATE acervo.versao SET subtipo_produto_id = 13
 WHERE subtipo_produto_id = 28 AND produto_id IN (4189, 4191, 6102, 6103, 6104, 6105);

UPDATE acervo.produto SET tipo_produto_id = 7
 WHERE tipo_produto_id = 2 AND id IN (4189, 4191, 6102, 6103, 6104, 6105);

-- ---------------------------------------------------------------------------
-- 7. Os quatro produtos de Carana estavam sem lote e sem projeto
-- ---------------------------------------------------------------------------
-- data_inicio e data_fim saem das data_edicao das quatro versoes (2026-04-17 a
-- 2026-05-29). status_execucao_id = 3, o mesmo dos demais lotes do projeto.
INSERT INTO acervo.lote (nome, pit, descricao, projeto_id, data_inicio, data_fim,
                         status_execucao_id, data_cadastramento, usuario_cadastramento_uuid)
SELECT 'Carana (EAOP)', 'carana-eaop',
       'Cartas do pais ficticio de Carana, usadas nos exercicios da EAOP.',
       pr.id, DATE '2026-04-17', DATE '2026-05-29', 3, now(), pr.usuario_cadastramento_uuid
  FROM acervo.projeto pr
 WHERE pr.nome = 'Cartas Especiais e Tematicas'
   AND NOT EXISTS (SELECT 1 FROM acervo.lote WHERE nome = 'Carana (EAOP)');

UPDATE acervo.versao v
   SET lote_id = (SELECT id FROM acervo.lote WHERE nome = 'Carana (EAOP)')
 WHERE v.produto_id IN (6102, 6103, 6104, 6105) AND v.lote_id IS NULL;

-- ---------------------------------------------------------------------------
-- 8. O lote que carrega o nome antigo do subtipo acompanha o renome
-- ---------------------------------------------------------------------------
UPDATE acervo.lote SET nome = 'Carta Ortoimagem de SARP', pit = 'carta-ortoimagem-de-sarp'
 WHERE nome = 'Carta Ortoimagem de OM';

-- ---------------------------------------------------------------------------
-- 9. Versao do banco
-- ---------------------------------------------------------------------------
UPDATE public.versao SET nome = '1.24.0' WHERE code = 1;

-- Para desfazer (o renome fisico dos arquivos NAO se desfaz por aqui: rode o
-- POST /api/arquivo/renomear-padrao de novo depois de reverter os metadados):
--   UPDATE dominio.subtipo_produto SET nome='Carta ortoimagem de OM', tipo_id=3 WHERE code=19;
--   UPDATE dominio.subtipo_produto SET tipo_id=3 WHERE code=27;
--   UPDATE acervo.versao SET subtipo_produto_id=27 WHERE subtipo_produto_id=19
--     AND produto_id NOT IN (4107,4108,4109,4110,4118,4119,4120,4123,4124,4142,4143,
--       4144,4145,4146,4147,4148,4149,4150,4151,4152,4153,4163,4165,4174,4175,4176,
--       4177,4178,4179,4180,4181,4182,4183,4184,4185,4186,5582);
--   UPDATE acervo.versao SET subtipo_produto_id=27 WHERE subtipo_produto_id=3
--     AND produto_id BETWEEN 6053 AND 6078;
--   UPDATE acervo.produto SET tipo_produto_id=3 WHERE tipo_produto_id=7 AND EXISTS
--     (SELECT 1 FROM acervo.versao v WHERE v.produto_id=acervo.produto.id
--        AND v.subtipo_produto_id IN (19,27));
--   UPDATE acervo.versao SET subtipo_produto_id=1 WHERE produto_id=5581;
--   UPDATE acervo.produto SET tipo_produto_id=1, nome='Unidades do Exercito Brasileiro 2019' WHERE id=5581;
--   UPDATE acervo.versao SET subtipo_produto_id=28 WHERE produto_id IN (4189,4191,6102,6103,6104,6105);
--   UPDATE acervo.produto SET tipo_produto_id=2 WHERE id IN (4189,4191,6102,6103,6104,6105);
--   -- desfazer o split dos 19 (devolve a versao ao produto original e apaga o novo):
--   UPDATE acervo.versao v SET produto_id = orig.id FROM acervo.produto novo, acervo.produto orig
--     WHERE v.produto_id = novo.id AND novo.subtipo_produto_id = 27 AND novo.mi IS NOT NULL
--       AND orig.mi = novo.mi AND orig.tipo_escala_id = novo.tipo_escala_id
--       AND orig.tipo_produto_id = 3 AND orig.subtipo_produto_id IS NULL AND orig.id <> novo.id;
--   DELETE FROM acervo.produto p WHERE p.subtipo_produto_id = 27
--     AND NOT EXISTS (SELECT 1 FROM acervo.versao v WHERE v.produto_id = p.id);
--   DELETE FROM dominio.subtipo_produto WHERE code=30;
--   UPDATE public.versao SET nome = '1.23.0' WHERE code = 1;
-- O backup completo do dia esta em backups_sca (dump de acervo+dominio e o JSON
-- linha a linha dos 178 produtos, 199 versoes e 356 arquivos do escopo).
