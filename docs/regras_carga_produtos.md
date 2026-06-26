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
| `Cont_Edicao` | número da edição | Base do nome da versão ("Nª Edição"). **No legado (`Y:\_250` etc.) a planilha às vezes colide ou inverte** o número entre edições da mesma folha (ex.: 521/522 numeraram 2003 como ed1 e 1981 como ed2). Quando inconsistente, **reordenar cronologicamente por `Ano_Edicao`** (ver seção 2.10) |
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

- **T34-700** (cartas até ~2021): versão = **"Nª Edição"** com N = `Cont_Edicao` da planilha.
  **`tipo_versao_id` depende de haver arquivo digital** (decisão 2026-06-10, ver seção 2.10):
  edição **com** TIF/PDF → **Regular** (`tipo_versao_id = 1`); edição apenas **documentada,
  sem arquivo digital** → **Registro Histórico** (`tipo_versao_id = 2`, via endpoints
  `/produtos/produto_versao_historica` ou `/versao_historica`).
  Ex.: a edição 2017 da MI 2962-4-NE (com arquivo) é a **"4ª Edição" Regular**.
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
- **Quando a versão possui apenas o PDF, o PDF é o Arquivo Principal**
  (`tipo_arquivo_id = 1`), com `crs_original` = EPSG original da planilha.

#### Nome físico padronizado (chave única no volume)

O servidor reconstrói o caminho de download como `<volume>/<nome_arquivo>.<extensao>`
(`server/src/acervo/acervo_ctrl.js`) — **não há coluna de caminho físico**. Portanto
`nome_arquivo` é a chave física do arquivo no volume e **precisa ser globalmente único**,
ou edições/anos/escalas diferentes com o mesmo nome base se sobrescrevem silenciosamente.

- **Padrão**: `{TIPOPROD}_{MI|slug}_{EDICAO}` (sem extensão).
  - `TIPOPROD`: `CT` (topográfica), `CO` (ortoimagem), `CTM` (militar), `TEM` (temática),
    `CDGV`, ... (ver `carga/nome_arquivo.cjs`, `TIPO_PROD_SLUG`).
  - `MI`: o identificador **já codifica a escala** pelo número de componentes —
    `2753` → 1:100.000, `2753-1` → 1:50.000, `2753-1-NE` → 1:25.000 (1:250.000 usa
    INOM/MIR, de formato distinto). Logo **a escala não entra no nome**. Sem MI
    (especiais), usar o slug do nome do produto.
  - `EDICAO`: T34-700 → `edN` (N = `Cont_Edicao`); ET-RDG → `Ndsg`.
  - Ex.: `CT_2962-4-NE_ed4`, `CT_2753_ed1`, `CT_2753-1_1dsg`, `CO_2962-4-NE_ed1`.
- O **TIF (principal) e o PDF (alternativo) de uma versão compartilham o mesmo nome base**
  e diferem só pela extensão — sem colisão, pois a chave física é `(nome_arquivo, extensao)`.
- Implementação de referência: `carga/nome_arquivo.cjs` (`nomeArquivoPadrao`).
- **Trava no servidor**: o `prepare-upload` recusa (HTTP 409) se o trio
  `(volume, nome_arquivo, extensao)` já existir no acervo ou se repetir dentro do mesmo
  envio — impede sobrescrita silenciosa (`assertNomeFisicoLivre` em `arquivo_ctrl.js`).

### 2.4 Produtos

- Mesma MI pode gerar **produtos distintos por tipo**: CT, CO, CDGV e Temática são
  produtos separados (ex.: 2980-1-SO tem cartas temáticas de 1980 além da topográfica;
  cada CT 1:100.000 do SISFRON tem o CDGV de mesma folha). A unicidade de INOM é por
  **(INOM, tipo_produto)** — o servidor recusa duplicado só dentro do mesmo tipo
  (`arquivo_ctrl.js`, prepare-upload/product). O INOM já codifica a escala.
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

### 2.5 Datas (`data_criacao` / `data_edicao`)

`acervo.versao.data_criacao` e `data_edicao` são `timestamp with time zone` e o
servidor roda em `America/Sao_Paulo` (-03). Enviar só `"YYYY-MM-DD"` é interpretado
como 00:00 **UTC** e, em horário local, cai no **dia anterior** (errando inclusive o
ano em `EXTRACT(YEAR ...)`, base dos anos das views materializadas). **Enviar sempre
ao meio-dia local**: `"YYYY-MM-DDT12:00:00-03:00"` (helper `diaLocal` nos loaders).

- `data_criacao` = data do último insumo (reambulação > apoio de campo > imagem).
- `data_edicao` = data exata das informações marginais.

### 2.6 CDGV (Conjunto de Dados Geoespaciais Vetoriais)

Quando a pasta de produção traz, ao lado da carta, o **CDGV** (`CDGV/{MI}.zip`):

- É um **produto à parte** (`tipo_produto_id = 1`, CDGV), com a **mesma MI/INOM/
  geometria/escala** da carta correspondente.
- **Subtipo** = a especificação ET-EDGV usada (ET-EDGV 2.1.3 = `subtipo 1`,
  ET-EDGV 3.0 = `subtipo 7`). **Confirmar inspecionando os nomes das classes (.shp)
  dentro do zip**: classes `ADM_`, `ASB_`, `ECO_`… (CamelCase) = **2.1.3**;
  classes `CBGE_` = **3.0**. A versão varia por lote — ex.: as generalizações
  100k/50k (SISFRON, SC, RS) são 2.1.3; o Conv RS 25k (`Versao_DSG`) é 3.0.
- O **arquivo é o próprio `.zip`** (camadas SHP dentro) = **Arquivo Principal**
  (`tipo_arquivo_id = 1`), `crs_original` lido dos `.prj` (ex.: 4674).
- **A edição do CDGV é a mesma da carta correspondente** (foi produzido na mesma
  edição). Ex.: se a CT 2799 é "4ª Edição", o CDGV 2799 também é "4ª Edição"
  (e `nome_arquivo` = `CDGV_2799_ed4`), ainda que seja o primeiro CDGV daquela folha.
- **Relacionamento com a carta**: a versão da CT tem o CDGV como **Insumo**
  (`versao_relacionamento`: `versao_id_1 = versão da CT`, `versao_id_2 = versão do
  CDGV`, `tipo_relacionamento_id = 1`). A direção (id_1 → id_2) significa "id_1 tem
  id_2 como insumo"; o tipo Insumo é checado contra ciclos no servidor.
- O `tipo_produto` CDGV precisa de associação em `volume_tipo_produto` (criada na
  carga se ausente). Referência: `carga/carga_2021_sisfron_100k_cdgv.cjs`.

### 2.7 Metadados (XML ISO 19115)

Quando a pasta traz um `.xml` por carta (ex.: `CT/{MI}.xml`, padrão `MD_Metadata`
ISO 19115), ele é carregado como arquivo **Metadados** (`tipo_arquivo_id = 4`) na
versão da carta, mesmo `nome_arquivo` base (difere só pela extensão `.xml`),
`crs_original = null`. Referência: `carga/carga_rs_2021_100k.cjs`.

### 2.8 Projetos (taxonomia)

- **Programas/convênios nomeados** têm projeto próprio: ex.: `SISFRON`,
  `Mapeamento de Santa Catarina`, `Mapeamento do Rio Grande do Sul`, Uraricoera.
- **Mapeamento genérico** (a maioria) vai para o projeto anual
  **`Mapeamento de Interesse da Força {ANO}`** (ex.: o Saicã 2017 está em
  `Mapeamento de Interesse da Força 2017`).
- O **lote** mantém o nome da pasta de produção (ex.: `2017_SAICA_25K`,
  `2021_RS_GovRS_Generalizacao_100k`) e o PIT (ano da pasta).
- **Acervo legado** (cartas antigas de `Y:\_250/_100/_50/_25`): projeto único
  **`Mapeamento Sistemático`**, lote por escala (`250k`, `100k`, `50k`, `25k`). Ver seção 2.10.

### 2.9 Acervo 2022 em diante (ET-RDG / EDGV 3.0)

A partir de 2022 a produção é **ET-RDG** (CT) e **ET-EDGV 3.0** (CDGV):

- **CT**: versão **"N-DSG"** (subtipo 12), `tipo_versao_id = 1` (Regular — é produção
  atual, não histórico). 2022 = primeira edição ET-RDG → **"1-DSG"**. O trigger
  `validate_version` aceita "1-DSG" Regular (formato N-SIGLA, N=1 sem exigir anterior).
- **CDGV**: ET-EDGV 3.0 (subtipo 7), **mesma versão da CT** ("1-DSG").
- **PDFs sem camada de texto** — os metadados vêm do **JSON de edição** por carta
  (`Json/{MI}_NNNdpi.json`, BOM utf-8-sig): `nome`, `inom`, `fases` (datas de
  produção → `data_criacao` = reambulação; `data_edicao` = fase Edição, MM/AAAA → dia 01),
  `info_tecnica.datum_vertical`. Geometria pela grade do site; zona UTM do PDF pelo INOM.
  Extrator: `carga/extrai_json_2022.py`. Loader de referência: `carga/carga_2022_uruguaiana.cjs`.
- O **JSON de edição** é carregado como arquivo **"JSON Edição"** (`tipo_arquivo_id = 5`) na CT.
- **NÃO são cadastrados**: MDE/MDT (modelos de elevação) e a **ortoimagem bruta**
  (apenas a **Carta Ortoimagem**, quando houver) — decisão do usuário.
- **Carta Ortoimagem** (ex.: lote Itaipu): `tipo_produto = 3`, `subtipo = 3`
  ("Carta Ortoimagem"), versão "N-DSG", **sem CDGV**. O raster da carta está em
  `Geotiff/orthoMap_{MI}.tif`. Como ortoimagem não tem reambulação, `data_criacao`
  = imageamento. Loader: `carga/carga_2022_itaipu.cjs`.
- **Geometria fora da grade do site**: cartas ausentes da `situacao-geral-*`
  (ex.: 16 folhas de Itaipu, Roraima) têm a moldura calculada pelo INOM via
  **DsgTools** (`carga/gera_frames_itaipu.py`, QGIS 4 + `map_index`). O
  `extrai_json_2022.py` aceita um arquivo de molduras como fallback (4º argumento).

### 2.10 Acervo legado — cartas antigas (projeto "Mapeamento Sistemático")

Carga das cartas topográficas antigas (T34-700) de `Y:\_250`, `Y:\_100`, `Y:\_50`, `Y:\_25`.
Tudo num **projeto único "Mapeamento Sistemático"**, **um lote por escala** (`250k`, `100k`,
`50k`, `25k`). Resolver **toda uma escala** (regular + histórico + variantes) **antes** da
próxima, com **sanity check ao fim de cada escala** (planilha + site de produtos + imagem nos
dúbios). Sequência: 250k → 100k → 50k → 25k. Loaders de referência (pasta `carga/`, gitignored):
`plano_250.py` (gera `carga_250.json`), `gera_frames_mir.py` (molduras), `carga_ms_250.cjs`
(`--fase1` regulares / `--fase2` históricas; idempotente — pula versão já existente; lê
`mi_id_250.json` gerado via psql entre fases, pois o `prepare-upload` não devolve o id do
produto criado).

**Por que a planilha é indispensável aqui:** os nomes de arquivo do legado são insuficientes —
o ano às vezes é `XXXX`, a edição não aparece, e o ano do TIF difere do PDF. A planilha ASC
(abas `T250`/`T100`/`T50`/`T25`) é a fonte da edição, ano, INOM, nome e órgão. A própria carta
**raramente** traz o número ordinal da edição, então a planilha vence (mas ver a ressalva de
colisão na seção 1.1). A caixa "EXECUÇÃO DAS FASES" do PDF é legível e serve de conferência nos
casos dúbios (Compilação/Atualização/Edição/Impressão por ano).

**Pastas em cada `Y:\_NNN`:**
- **Usar**: `4674/` (GeoTIFF EPSG:4674 — principal), `PDF/` (no 250k) ou `PDF_CONF/` (demais),
  `HISTORICO`/`HISTORICA` (edições mais antigas, só PDF — úteis).
- **Ignorar**: `DATUM_ORIGINAL`, `RECORTADA`/`RECORTADO` (recorte), `compare`, `_old`,
  `GRID_*` (grade local — usar DsgTools), e sufixo de arquivo `_recortada`.

**Nomes de arquivo do legado** (a ordem dos campos varia, parsear por valor):
- TIF: `MI_4674_ano[_variante].tif` (ex.: `538_250k_4674_2002.tif`, `2753-1_4674_2016.tif`).
- PDF: `MI_escala_ano_epsg[_variante].pdf` (ex.: `538_250k_29191_2001.pdf`).
- **TIF usa `Ano_Edicao`; PDF usa `Ano_Dados`** → casar arquivo↔edição por
  (MI, ano ∈ {`Ano_Edicao`, `Ano_Dados`}), com tolerância de ±2 anos para órfãos.

**Geometria** (não usar a grade local nem `Enquad_Especial` para folhas com MI): o número da
folha **é o MI** (no 250k chama-se **MIR**). DsgTools converte direto:
`getINomenFromMIR(mir)` (250k) / `getINomenFromMI(mi)` (100k/50k/25k) →
`getQgsPolygonFrame(inom, 1, 1)` → EWKT `SRID=4674;POLYGON(...)`.
Script: `carga/gera_frames_mir.py` (Python do QGIS 4, `map_index` em
`D:\desenvolvimento\DsgTools\...\FrameTools`). O INOM gerado bate com o da planilha (cross-check).

**Edições com / sem arquivo:**
- Edição **com** TIF/PDF → **Regular** ("Nª Edição", subtipo 2 T34-700). TIF principal (4674) +
  PDF alternativo; se só PDF, PDF principal.
- Edição **documentada sem raster** (linhas "Catálogo 84" / "Carta Física" sem flag de arquivo)
  → **Registro Histórico** (`tipo_versao_id = 2`, metadata-only). É o uso legítimo do Registro
  Histórico (não há nenhum no acervo atual fora desses).
- Produto **find-or-create por (mi, tipo_produto, escala)** — ex.: a folha 539 (São Gabriel) já
  existia; as edições antigas entram como versões adicionais no mesmo produto.

**Variantes (sufixos no nome do arquivo):**
- **`especial`** = **edição separada** (ex.: `522_..._2003_especial.pdf` = Erechim 2003, uma
  edição a mais) → carregar como "Nª Edição" Regular adicional, **renumerada cronologicamente**.
- **`encartada` / `estendida`** = **a edição padrão**, mas **um único arquivo cobre 2 MIs
  distintos** (impressos juntos para economizar; ex.: `536_536A_..._estendida.tif`). **São duas
  folhas** — cada MI vira seu produto/versão e **recebe o raster** (o mesmo físico é cadastrado
  nas duas, cada uma com seu `nome_arquivo`).

### 2.11 Validação de versão: "Nª Edição" como Regular (alteração 2026-06-10)

Para o legado ser cadastrado como Regular, foram relaxadas **duas camadas** de validação
(antes só aceitavam "Nª Edição" para `tipo_versao_id = 2`):
- **Trigger `acervo.validate_version`** (`er/acervo.sql`): o formato "Xª Edição" passou a ser
  aceito como Regular sem restrição de ano e sem exigir a edição anterior (carga parcial).
- **Schema Joi `versaoSchema`** (`server/src/arquivo/arquivo_schema.js`): ambos os tipos
  aceitam agora "X-YYYYY" **ou** "Xª Edição". O check sequencial só se aplica a "X-YYYYY".
- Strings de versão **customizadas** ("2ª Edição Especial" etc.) **não passam** na validação —
  por isso variantes são modeladas como edição/produto e não como sufixo na string da versão.

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

- **Volume de armazenamento**: `\\10.25.163.8\sca\sca_acervo` (37 TB livres).
  Usar sempre o **caminho UNC**, nunca mapeamentos de unidade (`W:` etc.) —
  mapeamentos são locais de cada máquina e os caminhos gravados no SCA
  precisam funcionar para qualquer cliente da rede.
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
