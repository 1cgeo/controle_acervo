# Carga do Acervo — Progresso

Carga em massa do acervo SCA a partir de `Y:\Produtos_AAAA\`, pasta a pasta, da menor para a maior. Loader genérico: `carga/carga_2023_generico.cjs` (config `cXX_*.json` + dados `tmpXX_*.json`). Toda a pasta `carga/` está no `.gitignore` (dados e scripts), então os helpers não são versionados — restaurar via `git show <commit>:carga/X` se necessário.

**Anos 2017–2026 carregados. Total do acervo: ~2113 produtos.**

## 2024 — completo (projeto "Mapeamento de Interesse da Força 2024", salvo onde indicado)
- OK: Apiai, CI_CMS_Orto, CIGC, CIR (topo+orto+cdgv), CISM (topo+cdgv+orto 2-DSG), CIBSB (topo+cdgv+orto 2-DSG), Curitiba, MH_Orto (7 regulares + especial CIMH `CO_CIMH_50k_1dsg`), Convenio_RS_Orto (8 cartas com raster, lote `2024_Convenio_RS_Orto`).
- SISFRON_Benchmark_50k → projeto **SISFRON** (16 CT + 16 CDGV). Folhas MS fora da grade do site: molduras via DsgTools (`gera_frames.py`).
- **AMAN → projeto próprio "AMAN", lote `2024_AMAN`** (`carga/carga_2024_aman.cjs`): 21 produtos = 10 especiais (AMAN/ESA/CIGMAL, geometria do `center`+escala como quadrado em graus, lado 25k=0.125 / 50k=0.250 / 100k=0.500 / 250k=1.250) + 5 MI regulares (geometria DsgTools) + 6 CDGV (shapefiles zipados via 7-Zip, relacionados à topográfica). Escala-no-nome essencial (ex. `CO_ACADEMIA-MILITAR-DAS-AGULHAS-NEGRAS_50k_1dsg`).
- **Pulado de propósito (decisão do usuário):** `2024_Correcao_BDGEX_RAM`; em AMAN o `topo_5k` e as 4 ortoimagens de OM (sem JSON); em Convenio as **166 cartas `JSON_PADRAO` sem raster** ("pular, nunca foram feitas").

## 2025 — completo (projeto "Mapeamento de Interesse da Força 2025"; ignorar `Extra_PIT`)
- Pipeline: `gera_frames.py` (frames de todo 2025 em `tmp25_frames.json`) → `extrai_json_2022.py <lote> tmpXX grade_vazia.geojson tmp25_frames.json` → `c25_*.json` + `carga_2023_generico.cjs`. O extrator acha JSON recursivamente (robusto a `BLOCO_`/`LOTE_`/nesting). `dirCdgv="SHP"` para quase todos; `1j` usa `"CDGV"`.
- **13 lotes topo:** 1a, 1b, 1c, 1d, 1e, 1f, 1g, 1h, 1i, 1j, 1k, 1m + Generalizacao_PontaGrossa_50k (este sem CDGV). Cada um CT + CDGV (insumo) salvo o gen.
- **4 lotes de ortoimagem** (tipoProduto=3): CO_25k (84), CO_50k (101), CO_100k (2), CO_RS_25k (3). Lotes grandes têm `BLOCO_1/2/3`.
- **Pulado: `COE_CIB`** — "Carta Ortoimagem Especial 25k Campo de Instrução de Butiá", só TIF+PDF, sem JSON (sem metadados/center). Mesma regra dos especiais sem JSON do AMAN. Reavaliar se quiser carregar via footprint do TIF.
- Algumas folhas CO já existiam de outros lotes/anos — o loader é version-aware e pula/atualiza a versão repetida.

## 2026 — completo (o que estava pronto; projeto "Mapeamento de Interesse da Força 2026"; ignorar `IMAGENS` e `ExtraPIT`)
- OK: 1a_Faxinal_Soturno_25k (6 CT+CDGV), 1e_Faxinal_Soturno_50k (1), 1f_Santiago_50k (10), 1i_CO_POA_50k (2 CO), 1p_CO_POA_25k (7 CO), 1q_CO_Palmas_25k (4 CO).
- A carta **2864-3-SO "Palmas"** vinha marcada como 2-DSG no JSON, mas é **1-DSG** (confirmado pelo usuário) — carregada forçando `versao=1-DSG` (`CO_2864-3-SO_1dsg`).
- Pulados: 1o_CO_Rincao (só JSON, sem raster), 1u_CO_POA_Sul_10k (só TIF, sem JSON).
- Vazias / não prontas: 1b, 1c, 1g, 1h, 1j, 1k, 1m, 1r, 1s.

## Regra de produtos especiais (sem MI)
`nome_arquivo` inclui a escala — `nomeArquivoPadrao` em `carga/nome_arquivo.cjs` recebe `escalaCode` e gera, por exemplo, `CT_ILHA-DE-SANTA-CATARINA_25k_1dsg` e `CO_CIMH_50k_1dsg`. Para produtos com MI o identificador já codifica a escala, então ela não entra no nome.

## Mapeamento Sistemático — cartas antigas (legado `Y:\_250/_100/_50/_25`)
Projeto único **"Mapeamento Sistemático"**, lote por escala. Sequência 250k→100k→50k→25k, resolvendo tudo de uma escala (regular+histórico+variantes) + **sanity check** antes da próxima. Fontes: planilha ASC (`T250`… edição/ano/INOM) + arquivos reais (`4674/`, `PDF(_CONF)/`, `HISTORICO`) + DsgTools (MIR/MI→INOM) + imagem nos dúbios. Detalhes em `regras_carga_produtos.md` §2.10/2.11 e memória [[cartas-antigas-mapeamento-sistematico]]. Scripts em `carga/`: `plano_250.py`, `gera_frames_mir.py`, `carga_ms_250.cjs`, `recompoe_250v.py`, `aplica_250v.cjs`, `sanity_250.py`.

- **250k — COMPLETO + sanity OK:** 49 folhas (495–550 + 536A), **97 versões** (73 Regular + 24 Registro Histórico), 250k em `tipo_escala_id=4`. Edições renumeradas cronologicamente (planilha colidia/invertia em 510/521/522…); variantes **especial** = edição separada, **encartada/estendida** = edição padrão com 1 arquivo cobrindo 2 folhas (ambas cadastradas, ex. 536/536A). Documentadas-sem-raster = Registro Histórico. Trigger + Joi schema alterados p/ aceitar "Nª Edição" Regular.
- **100k — principal carregado + sanity OK:** 125 produtos, **138 versões** (109 Regular + 29 Registro Histórico), `tipo_escala_id=3`. Matching robusto (`plano_100.py`): separa legado (datum antigo/ano<2015) de **moderno SIRGAS** (≥2015 → carga por ano, **não** entra no legado); arquivo sem ano casa por flag Geotiff/PDF; 0 órfãos. Loader generalizado `carga_ms.cjs --escala 100`. **Puladas:** 98 edições modernas (carga por ano), 77 documentadas **sem ano** (data inválida), 16 arquivos modernos. **Pendente (cauda):** 19 variantes — 8 `_ESP` (especiais antigas), 3 `_estendida` (2 folhas), 3 `_trafegabilidade` (= **outro tipo de produto**, Carta de Trafegabilidade, fora do escopo topo).
- **50k — completo + sanity OK:** 883 produtos, **1466 versões** (`tipo_escala_id=2`). Chaveado por INOM (T50 tem MI corrompido p/ data; `tmp_50_geo.json` faz INOM↔MI via DsgTools). Pasta HISTORICO incluída (edições antigas viram edições anteriores, renumeração cronológica via `recompoe_50v.py`). **38 folhas recompostas**; **10 folhas NÃO recompostas de propósito** (têm versões de cargas-por-ano em outros lotes — delete-whole destruiria dados; variantes/HISTORICO delas deferidas). Data cai pro ano do arquivo quando a planilha não tem. FASE2 idempotente (pré-filtra `existing_50.json`, lotes, retry 429).
- **25k — completo + sanity OK:** 637 produtos, 670 versões (`tipo_escala_id=1`). MI do T25 limpo (`2805-2-NE`); PDFs com quadrante minúsculo (`-so`) normalizados p/ maiúsculo. 2 folhas-variante seguras recompostas.

### ✅ LEGADO COMPLETO + ULTRA SANITY (2026-06-10)
**Total: 1694 produtos · 2371 versões (1647 Regular + 724 Registro Histórico) · 3004 arquivos.** Acervo total: **3492 produtos**. Ultra sanity (plano × carregado × arquivos × site de produtos): completude OK (0 regulares ausentes — os 2 do 25k já existiam em outros lotes/Saicã), cronologia OK, 0 regular-sem-arquivo, 0 duplicados, **INOM bate com o site de produtos em 100% (1694/1694)**.
- **NÃO existe edição documentada sem ano** (as aparentes "sem ano" eram células vazias da grade, Cont_Edicao=0). Todos os históricos reais (com ano, Catálogo 84 etc.) carregados.
- Edições **modernas SIRGAS ≥2015** ficam para a carga por ano (N-DSG), fora do legado.

### ✅ FOLLOW-UPS (2026-06-11) — itens revisados pelo usuário, todos resolvidos
- **MIs com letra** (`2882A-4` 50k, `2882A-4-SE` 25k): regex barrava a letra; corrigido e carregados (Ilhas do Saltinho 1989; Balneário Lajeado Corredeiras 2012). 2882A 100k já estava recomposto.
- **`_trafegabilidade`** (3, 100k): carregadas como **Carta de Trafegabilidade** (tipo_produto 7, subtipo 15), lote `100k_Trafegabilidade`.
- **`_MIL` carta_militar** (156, 25k): eram a mesma folha/edição que já tinha "1ª Edição" — **153 Histórico-sem-arquivo atualizadas para subtipo 24 (Carta Topográfica Militar) + PDF anexado**; 3 (2991-2-SE/SO, 2991-4-NE) que tinham carta padrão receberam **versão militar separada**. Exigiu mudar `unique_version_per_product` → (produto_id, versao, **subtipo_produto_id**) e o check de duplicidade do `prepare-upload/version` (incluir subtipo). er/acervo.sql + arquivo_ctrl.js + banco.
- **12 folhas multi-lote** (variantes/HISTORICO): a maioria era o **raster 4674 que faltava** (edição só tinha PDF) — **9 rasters anexados** via prepare-upload/files (nome `_4674`); 1 edição nova antiga (2881-4/1963) e 2 ambíguas notadas.
- **CISM/CIB** (7): mapas compostos especiais dos campos de instrução (não duplicatas) — carregados como produto especial com **geometria do footprint do GeoTIFF** (gdalinfo), lote `Campos_Instrucao`. CISM (Santa Maria 50k+25k), CIB (50k+25k), CIBSB N/S/Especial.
- **Total final do legado:** 1695 produtos · 2375 versões · 3173 arquivos. Acervo: 3503 produtos.

## Convenção de `tipo_versao` (decisão 2026-06-10)
- **Registro Histórico** (`tipo_versao=2`) é reservado para edições que sabemos terem existido (por documento) mas **sem arquivo digital** — criadas pelos endpoints `POST /produtos/versao_historica` e `/produto_versao_historica`, que inserem apenas metadados (sem `arquivo`, sem upload).
- **Toda edição com arquivo** — inclusive as antigas **T34-700** ("Nª Edição") — é **Regular** (`tipo_versao=1`).
- As **538** versões que estavam como Registro Histórico (todas com arquivo) foram **reclassificadas para Regular**; hoje não há nenhum registro histórico no acervo. A reclassificação alterou só `tipo_versao_id` (o trigger `validate_version` pula a checagem quando `versao` não muda).
- **Atenção:** o trigger ainda rejeita *INSERT* de "Nª Edição" como Regular a partir de 2024. Para cadastrar uma nova T34-700 com arquivo no futuro, será preciso reavaliar o trigger.
