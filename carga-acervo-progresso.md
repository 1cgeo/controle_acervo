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
