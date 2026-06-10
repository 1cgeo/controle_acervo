# Regras de Carga de Produtos no SCA — 1º CGEO

Documento de referência para a carga do acervo de produtos no Sistema de Controle do Acervo (SCA).
Atualizado em 2026-06-10.

## 1. Fontes de dados e autoridade

### 1.1 Planilha ASC (`Controle do Acervo - ASC 1° CGEO.ods`)

Controle manual da Seção de Acervo. **Fonte autoritativa para os detalhes de cada edição.**

- Abas por escala/tipo: `T25`, `O25`, `T50`, `O50`, `T100`, `O100`, `T250`, `O250`
  (T = Carta Topográfica, O = Carta Ortoimagem; uma **linha por edição** de cada carta).
- Aba `Enquad_Especial`: produtos de enquadramento especial (Copa do Mundo 1:2.000/1:10.000,
  COVID etc.) — no SCA viram escala personalizada (tipo 5 + denominador).
- Colunas relevantes e mapeamento para o SCA:

| Coluna | Campo SCA | Observação |
|---|---|---|
| `Cont_Edicao` | número da edição | Base do nome da versão ("Nª Edição") |
| `MI` / `INOM` | `produto.mi` / `produto.inom` | |
| `Tipo_Produto` | `produto.tipo_produto_id` | `C. Topo`=2, `C. Orto`=3, `C. Temática`=7 |
| `Nome` | `versao.nome` | **O nome muda entre edições** (ex.: 2962-4-NE: "ITAPEVI - NE" em 1980, "CERRO DA GLÓRIA" a partir de 2007). `produto.nome` = nome da edição mais recente carregada |
| `Orgao_Produtor` | `versao.orgao_produtor` | DSG, 1º CGEO, IBGE... |
| `EPSG` | `arquivo.crs_original` | EPSG **original da carta**; pode ser "Não Consta" |
| `Ano_Dados` | `versao.data_criacao` | Se vazio, usar `Ano_Edicao` |
| `Ano_Edicao` | `versao.data_edicao` | Preferir a **data exata das informações marginais** da carta quando o PDF existir (seção 1.3) |
| `PDF` / `Geotiff` / `Acervo` | — | Flags de existência de arquivo digital / acervo físico |

### 1.2 Site de produtos (`D:\desenvolvimento\produtos\data\`)

GeoJSONs do site público de produtos concluídos do 1º CGEO.

- **Correto quanto à EXISTÊNCIA das versões** de Carta Topográfica e Carta Ortoimagem.
- **Pode errar nas datas exatas**: contabilizou o **ano de edição** em vez do **ano do dado**.
- `situacao-geral-ct-{25k,50k,100k,250k}.geojson` — por célula da grade: `identificadorMI`,
  `identificadorINOM`, geometria `Polygon` (moldura), `edicoes_topo[]`, `edicoes_orto[]`.
  **Fonte da geometria dos produtos** (prefixar `SRID=4674;` no EWKT).
- Arquivos anuais `ct-AAAA-esc.geojson` / `co-AAAA-esc.geojson`: produtos concluídos por ano.
- Inconsistências conhecidas (cross-check de 2026-06-10): ~280 anos de edição presentes nos
  anuais mas ausentes da situacao-geral; 22 MIs dos anuais ausentes da grade; arquivos
  `aman_esa_*` sem identificador preenchido.

### 1.3 A própria carta (informações marginais)

**Autoridade final para os dados da edição.** Os PDFs são vetoriais com camada de texto —
as informações marginais são extraíveis por script (pypdf). Verificado no piloto:

- **Data exata da edição**: "Última edição em 29 de junho de 2017" → `versao.data_edicao`
  com dia/mês (as demais fontes só têm o ano).
- **MI** ("MI: 2962−4−NE") — atenção: o PDF usa o sinal U+2212 (−) no lugar do hífen;
  normalizar antes de comparar.
- **Nome da carta**, datum horizontal/vertical, projeção.
- **Etapas de produção com anos** (imageamento, apoio de campo, aerotriangulação,
  restituição, reambulação, validação, edição) → base do "ano do dado"
  (`data_criacao` = mais recente entre reambulação/apoio/imagem, conforme a regra da
  planilha) e candidatas ao `versao.metadado` (JSONB).
- O **número ordinal da edição não é impresso** no leiaute T34-700 de 2017 — o número
  da edição continua vindo da planilha (`Cont_Edicao`).

Uso no pipeline: validação automática (MI do nome do arquivo × MI impresso) e
enriquecimento (data exata, etapas no metadado).

### 1.4 Arquivos reais

- **`Y:\` — fonte primária dos produtos digitais do 1º CGEO**:
  - `Y:\Produtos_AAAA\<PROJETO>_<ESCALA>\{pdf,tif}` — produção por ano/projeto
    (ex.: `Y:\Produtos_2017\2017_SAICA_25K`). TIF georreferenciado em EPSG:4674
    (`MI_4674_AAAA.tif`) e PDF de impressão (`MI_AAAA.pdf`).
  - `Y:\_25`, `_50`, `_100`, `_250` — acervo legado por escala (subpastas `4674`,
    `DATUM_ORIGINAL`, `HISTORICA`, `PDF_CONF`, `RECORTADO`).
  - `Y:\_Especiais` — produtos especiais (COVID, Copa do Mundo, trafegabilidade...).
- **`D:\ftp_dsg\FTP\`** — espelho do FTP da DSG, PDFs nomeados `MI ESCALA cgeo.pdf`
  (~1.965 PDFs, inclui 2º–5º CGEO; `CARTAS SEM MI` = campos de instrução sem MI).
  Fonte complementar.

## 2. Convenções de modelagem

### 2.1 Nome da versão (edição)

- **T34-700** (cartas até ~2021): versão = **"Nª Edição"** com N = `Cont_Edicao` da planilha,
  cadastrada como **registro histórico** (`tipo_versao_id = 2`).
  Ex.: a edição 2017 da MI 2962-4-NE é a **"4ª Edição"**.
- **ET-RDG** (produção nova): versão = **"N-DSG"**.
  Ex.: a edição 2024 da MI 2962-4-NE será **"1-DSG"** (primeira edição na ET-RDG).
- A numeração "N-SIGLA" reinicia na transição para a ET-RDG; os dois formatos convivem no
  mesmo produto.

### 2.2 Subtipo de produto (Carta Topográfica)

- Edições **antes de 2022**: em geral **T34-700** (subtipo 2). Há exceções em 2021 —
  confirmar caso a caso.
- Edições na **ET-RDG**: subtipo 12.
- Pasta `CARTAS MILITARES` (ftp_dsg): **Carta Topográfica Militar** (subtipo 24).

### 2.3 Arquivos

- GeoTIFF (EPSG:4674) = **Arquivo Principal** (`tipo_arquivo_id = 1`),
  `crs_original = 4674`.
- PDF de impressão = **Formato Alternativo** (`tipo_arquivo_id = 2`),
  `crs_original` = EPSG original da planilha (quando houver).
- `nome_arquivo` segue o nome físico sem extensão (ex.: `2962-4-NE_4674_2017`).

### 2.4 Produtos

- Mesma MI pode gerar **produtos distintos por tipo**: CT, CO e Temática são produtos
  separados (ex.: 2980-1-SO tem cartas temáticas de 1980 além da topográfica).
- Geometria: moldura `Polygon` da situacao-geral, EWKT com `SRID=4674;`.
- **Atenção a acentos nos nomes** — usar a grafia correta da planilha
  (ex.: **"Saicã"**, não "SAICA"). Nomes de pasta/arquivo não são fonte de
  nome de produto.
- **Títulos em title case respeitando o português**: primeira letra de cada
  palavra maiúscula, partículas minúsculas (de, da, do, das, dos, e, em...),
  sufixos direcionais (N, S, L, O, NE, NO, SE, SO) e numerais romanos em
  maiúsculas. Ex.: "CERRO DA GLÓRIA" → **"Cerro da Glória"**;
  "ROSÁRIO DO SUL-N" → **"Rosário do Sul-N"**.
  Implementação de referência: `carga/title_case.cjs` (`titleCasePt`).

## 3. Ordem de carga (regra de ouro)

1. **Carregar primeiro tudo que tem arquivo real** (produto + versão + arquivos juntos,
   via fluxo de upload com checksum). Fontes: `Y:\Produtos_AAAA`, depois legado
   `Y:\_25/_50/_100/_250`, `Y:\_Especiais` e `ftp_dsg`.
2. **Só depois** de esgotada a carga de produtos reais, registrar as **versões históricas
   sem arquivo** (edições que constam na planilha/site mas não têm digital), via
   `POST /api/produtos/produto_versao_historica` ou `versao_historica`.
   Motivo: evitar registrar como "sem arquivo" uma edição cujo arquivo ainda será
   encontrado em outra fonte.
3. Validar contagens contra a planilha e o site após cada lote.

## 4. Infraestrutura

- **Volume de armazenamento**: `W:` (37 TB livres). Cadastrado no SCA como
  `W:/sca_acervo` (subpasta obrigatória — caminho "W:" puro quebra a montagem
  de caminhos no servidor).
- Volume primário por tipo de produto em `volume_tipo_produto`.
- Projetos/lotes do SCA espelham os projetos de produção
  (ex.: projeto "Saicã", lote "2017_SAICA_25K" PIT 2017).

## 5. Piloto

`Y:\Produtos_2017\2017_SAICA_25K` — 8 cartas CT 25k (TIF+PDF, ~0,73 GB):

1. Criar volume `W:/sca_acervo` + associação primária para CT.
2. Criar projeto "Saicã" + lote 2017.
3. Para cada carta: produto (MI/INOM/geometria/subtipo T34-700) + versão
   **"4ª Edição"** ("5ª" para 2962-4-SE e 2980-1-SO, conforme `Cont_Edicao` da planilha),
   `tipo_versao_id = 2`, nome/órgão da planilha, `data_edicao = 2017-06-29` (informações
   marginais), etapas de produção no `metadado` + TIF (principal) + PDF (alternativo)
   via `prepare-upload/product` → cópia → `confirm-upload`.
4. Criar views materializadas e validar (dashboard, plugin QGIS, download).
5. A edição **2024 (1-DSG)** dessas cartas será carregada com `Y:\Produtos_2024`.
6. As edições antigas (1ª–3ª) ficam para a fase de versões históricas (regra da seção 3).

## 6. Pendências conhecidas

- Reconciliar planilha × site: site lista edição 2024 das cartas do Saicã que não consta
  na planilha (planilha vai até 2017 nessas MIs).
- `CARTAS SEM MI` (campos de instrução): produtos com escala personalizada e geometria
  manual — cadastro via plugin.
- `aman_esa_*.geojson` sem identificadores — enriquecer antes de usar.
- Linhas da planilha com `Ano_Edicao = "Não Consta"` (3 casos em T50) — tratar na fase
  de versões históricas.
- Cartas de 2º–5º CGEO (ftp_dsg) fora da grade do site: moldura calculável a partir do
  MI/INOM (grade sistemática).
