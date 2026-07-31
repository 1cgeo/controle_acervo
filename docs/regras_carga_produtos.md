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
| `Cont_Edicao` | número da edição | Base do nome da versão ("Nª Edição"). **No legado (`$ACERVO_FONTE_LEGADO/_250` etc.) a planilha às vezes colide ou inverte** o número entre edições da mesma folha (ex.: 521/522 numeraram 2003 como ed1 e 1981 como ed2). Quando inconsistente, **reordenar cronologicamente por `Ano_Edicao`** (ver seção 2.10) |
| `MI` / `INOM` | `produto.mi` / `produto.inom` | |
| `Tipo_Produto` | `produto.tipo_produto_id` | `C. Topo`=2, `C. Orto`=3, `C. Temática`=7 |
| `Nome` | `versao.nome` | **O nome muda entre edições** (ex.: 2962-4-NE: "ITAPEVI - NE" em 1980, "CERRO DA GLÓRIA" a partir de 2007). `produto.nome` = nome da edição mais recente carregada |
| `Orgao_Produtor` | `versao.orgao_produtor` | DSG, 1º CGEO, IBGE... |
| `EPSG` | `arquivo.crs_original` | EPSG **original da carta**; pode ser "Não Consta" |
| `Ano_Dados` | `versao.data_criacao` | Se vazio, usar `Ano_Edicao` |
| `Ano_Edicao` | `versao.data_edicao` | Preferir a **data exata das informações marginais** da carta quando o PDF existir (seção 1.3) |
| `PDF` / `Geotiff` / `Acervo` | — | Flags de existência de arquivo digital / acervo físico |

### 1.2 Site de produtos (`$ACERVO_FONTE_SITE_PRODUTOS`)

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

Este repositório é público, então as pastas aparecem aqui pela **chave do `.env`**, nunca
pelo caminho. O catálogo comentado está em `.env.example`; os valores, no `.env` local de
cada máquina. Letra de unidade mapeada é local de cada estação, então ela nem descreveria a
mesma pasta para quem lê.

- **`$ACERVO_FONTE_PRODUCAO` — fonte primária dos produtos digitais do 1º CGEO**:
  - `$ACERVO_FONTE_PRODUCAO/Produtos_AAAA/<PROJETO>_<ESCALA>/{pdf,tif}` — produção por
    ano/projeto (ex.: `Produtos_2017/2017_SAICA_25K`). TIF georreferenciado em EPSG:4674
    (`MI_4674_AAAA.tif`) e PDF de impressão (`MI_AAAA.pdf`).
  - `$ACERVO_FONTE_LEGADO/_25`, `_50`, `_100`, `_250` — acervo legado por escala (subpastas
    `4674`, `DATUM_ORIGINAL`, `HISTORICA`, `PDF_CONF`, `RECORTADO`).
  - `$ACERVO_FONTE_LEGADO/_Especiais` — produtos especiais (COVID, Copa do Mundo,
    trafegabilidade...).
- **`$ACERVO_FONTE_FTP_DSG`** — espelho do FTP da DSG, PDFs nomeados `MI ESCALA cgeo.pdf`
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

- **Padrão** (desde 2026-07-29, com o SUBTIPO no nome):

  ```
  {TIPOPROD}_s{NN}_{MI ou INOM}_{EDICAO}
  {TIPOPROD}_s{NN}_{SLUG-DO-NOME}_{ESCALA}_{EDICAO}   sem MI e sem INOM
  ```

  - `TIPOPROD`: `CT` (topográfica), `CO` (ortoimagem), `CDGV`, `TEM` (temática), ...
    Vem de `tipo_produto_id`.
  - `sNN`: o `subtipo_produto_id` com dois dígitos. **Numérico e não mnemônico de
    propósito**: sai do domínio, então subtipo novo nunca exige inventar sigla nem
    lembrar de atualizar uma tabela. É ele que separa a Carta Militar (`s24`) da civil
    (`s02`, `s12`) na mesma folha e com o mesmo rótulo de edição.
  - Identificador: `COALESCE(mi, inom)`. O MI **já codifica a escala** pelo número de
    componentes — `2753` → 1:100.000, `2753-1` → 1:50.000, `2753-1-NE` → 1:25.000.
    Logo a escala só entra no nome quando não há MI nem INOM.
  - `EDICAO`: só as duas formas que o trigger `acervo.validate_version` admite.
    `Nª Edição` → `edN`; `N-SIGLA` → `Nsigla` (minúsculo). Rótulo fora delas **aborta**,
    porque nome improvisado colide em silêncio.
  - Ex.: `CT_s02_2962-4-NE_ed4`, `CT_s24_2823-1-SE_1dsg`, `CDGV_s07_2952-4-SE_ed1`,
    `CO_s27_ESTRELA-2_e2800_ed1`, `TEM_s15_2979_ed1`.
- O **TIF (principal) e o PDF (alternativo) de uma versão compartilham o mesmo nome base**
  e diferem só pela extensão — sem colisão, pois a chave física é `(nome_arquivo, extensao)`.
- **Fonte ÚNICA da regra**: a função `acervo.nome_arquivo_padrao` no banco
  (`migrations/2026-07-29_nome_arquivo_padrao.sql`), usada tanto por quem ESCREVE quanto
  pelo invariante que AUDITA (`7a`). Duas implementações da mesma regra divergem com o
  tempo, e a divergência entre auditor e escritor é justo o defeito que o `7a` existe
  para pegar.
- **Travas no banco** (`migrations/2026-07-29_nome_fisico_unico.sql`): índices únicos
  parciais sobre `(volume, nome_arquivo, extensao)` e sobre a versão em `lower()`,
  excluindo Tileserver. O segundo não é redundância: o Postgres distingue caixa e o SMB
  do volume não, então dois registros que só diferem por caixa disputariam um arquivo.
- **Trava na aplicação**: o `prepare-upload` recusa (HTTP 409) se o trio já existir ou se
  repetir dentro do mesmo envio (`assertNomeFisicoLivre` em `arquivo_ctrl.js`). Ela NÃO
  cobre UPDATE direto, e foi por isso que os índices acima passaram a existir.
- **Renomear em massa**: `POST /api/arquivo/renomear-padrao` (admin). O cliente não manda
  nome; o servidor o deriva da função. Existe em vez do `prepare-upload` porque aquele
  caminho transfere BYTES e renomear não move byte nenhum.

#### A exceção: volume que guarda o layout do fornecedor (2026-07-31)

`acervo.volume_armazenamento.layout_origem = true` declara que o volume guarda a entrega
**no layout de quem a produziu**. Nele o `nome_arquivo` é o caminho relativo de origem
(subpasta inclusa, com barra normal) e o padrão derivado **não se aplica**. O invariante
`7a` e o `renomear-padrao` ignoram o volume, e o `renomear-padrao` continua ignorando
mesmo quando o arquivo é pedido por `arquivo_ids`.

Existe por dois motivos que renomear não resolve:

1. **Formato com sidecar por NOME.** Um `.img` do ERDAS guarda dentro de si o nome do
   `.ige`, onde estão TODOS os pixels (o `.img` tem 34 KB e o `.ige` tem 8 GB), e os
   nomes das 30 entradas do `.rrd`. Renomear o conjunto quebra a referência interna e o
   produto para de abrir. Nenhuma auditoria posterior pega isso.
2. **Volume que já contém a entrega.** Achatar a árvore do fornecedor na raiz do volume
   ou duplicar o acervo inteiro são os dois únicos caminhos, e nenhum se justifica.

A marca é do VOLUME, nunca do produto ou do arquivo: um volume guarda o padrão do acervo
ou o layout de quem entregou, nunca os dois. Marca por arquivo viraria escape para nome
improvisado, que é o que o `7a` existe para impedir.

O que a marca **não** afeta: a unicidade física `(volume, nome_arquivo, extensao)`
continua valendo, o `confirm-upload` continua conferindo o sha256 do byte no volume, e os
invariantes `7b` e `7c` continuam medindo o que mediam.

Primeiro caso: as entregas do Convênio RS (MDS, MDT e Ortoimagem), já gravadas no volume
em `LOTE_1..LOTE_5`. Ali o `prepare-upload` serve só para abrir a sessão e declarar o
checksum; nada se copia, e o `confirm-upload` valida o byte onde ele já está.

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
- **Acervo legado** (cartas antigas de `$ACERVO_FONTE_LEGADO/_250`, `_100`, `_50` e `_25`): projeto único
  **`Mapeamento Sistemático`**, lote por escala (`SCN 1:250.000`, `SCN 1:100.000`,
  `SCN 1:50.000`, `SCN 1:25.000`). Ver seção 2.10.

#### O nome descreve o DADO, nunca a campanha de carga (2026-07-29)

Projeto e lote são **taxonomia do acervo**, não diário de operação. Um projeto
chamado `Backfill BDGEx` diz de onde o dado veio, e isso não ajuda quem procura
carta. Em 2026-07-29 três projetos assim foram dissolvidos, com 1.938 versões
redistribuídas por família.

- **Projeto** = o programa que produziu ou adquiriu o dado (`SISFRON`, `PDDMT 2023`,
  `AMAN`, `Mapeamento de Interesse da Força 2026`), ou a família, quando não há
  programa que o explique (`Mapeamento Sistemático`, `Cartas Militares`,
  `Cartas Especiais e Temáticas`).
- **Lote** = o recorte dentro do projeto: `{ano}_{item do PIT}_{tipo}_{área}_{escala}`
  na produção corrente (`2026_1b_CT_Tubarao_25k`), ou a família e a escala no legado
  (`SCN 1:50.000`, `Carta Aeronáutica`, `Carta Militar 1:25.000`).
- **Produto com programa fica no programa.** A Carta Militar do SISFRON pertence ao
  SISFRON, não a `Cartas Militares`. Só vai para o projeto de família o que não tem
  programa que o explique.
- **Datas de projeto e lote derivam das edições** que eles de fato guardam, nunca de
  um valor fixo no carregador. O `carga_2026_novos.cjs` tinha 2023 embutido e o
  propagou para 45 lotes e 9 projetos.

#### CUIDADO: projeto e lote são COMPARTILHADOS entre os módulos

Desde a convergência dos sistemas, `acervo.lote.id` é referenciado por **quatro
tabelas em dois schemas**: `acervo.versao`, `acervo.upload_versao_temp`,
`ponto_controle.ponto` e `ponto_controle.upload_session`.

Um lote **sem nenhuma versão no acervo** pode guardar centenas de pontos de
controle. Em 2026-07-29, quatro projetos que pareciam vazios tinham 3.490 pontos,
e o `GOV-RS SDP Nr 8155-BR` sozinho tinha 3.222 em cinco lotes.

Antes de apagar projeto ou lote, **consulte o schema** por quem referencia a
entidade, em vez de olhar só a tabela do assunto em que se está trabalhando:

```sql
SELECT table_schema, table_name FROM information_schema.columns
WHERE column_name = 'lote_id' AND table_schema NOT IN ('information_schema','pg_catalog');
```

`ponto_controle` é bloqueio duro. `upload_versao_temp` não bloqueia: a chave
estrangeira é `ON DELETE SET NULL` e são linhas de rascunho de sessões concluídas.

#### Palavras-chave: só o que NENHUMA coluna carrega

O campo `versao.palavras_chave` foi **esvaziado em 2026-07-29**, por decisão do
chefe. Eram 1.805 termos distintos em 19.648 ocorrências, e **94% das distintas
duplicavam uma coluna**: 1.705 eram código de folha (que `mi` e `inom` já indexam),
23 eram tipo ou subtipo, 6 eram escala.

Etiqueta que repete coluna é pior que nada: é texto livre, não tem índice e mente
quando o dado muda. Se o campo voltar a ser usado, que carregue só o que nenhuma
coluna carrega (programa, área, tema, cliente) e como vocabulário controlado.

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

Carga das cartas topográficas antigas (T34-700) de `$ACERVO_FONTE_LEGADO`, subpastas `_250`, `_100`, `_50` e `_25`.
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

**Pastas em cada `$ACERVO_FONTE_LEGADO/_NNN`:**
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
`map_index` do DsgTools, em `core/GeometricTools/FrameTools`). O INOM gerado bate com o da planilha (cross-check).

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
   via fluxo de upload com checksum). Fontes: `$ACERVO_FONTE_PRODUCAO/Produtos_AAAA`, depois o
   legado `$ACERVO_FONTE_LEGADO` (`_25`, `_50`, `_100`, `_250`, `_Especiais`) e por fim
   `$ACERVO_FONTE_FTP_DSG`.
2. **Só depois** de esgotada a carga de produtos reais, registrar as **versões históricas
   sem arquivo** (edições que constam na planilha/site mas não têm digital), via
   `POST /api/produtos/produto_versao_historica` ou `versao_historica`.
   Motivo: evitar registrar como "sem arquivo" uma edição cujo arquivo ainda será
   encontrado em outra fonte.
3. Validar contagens contra a planilha e o site após cada lote.

## 4. Infraestrutura

- **Volume de armazenamento**: compartilhamento de rede com 37 TB, citado pela chave
  `$ACERVO_VOLUME`. O valor **canônico** não está aqui nem no `.env`: está na coluna
  `acervo.volume_armazenamento.volume`, no banco, porque é dela que o servidor monta o
  caminho com `path.join(volume, nome_arquivo + '.' + extensao)`.
  Nunca gravar mapeamento de unidade (`W:` etc.) nessa coluna: mapeamento é local de cada
  máquina, e o caminho gravado no SCA precisa funcionar para qualquer cliente da rede.
- **Armadilha do servidor Linux (medida em 2026-07-27, no banco de produção).** Caminho UNC
  do Windows (`\\servidor\share`) **não resolve em Linux**: lá a contrabarra é caractere
  comum de nome de pasta, e o `path.join` junta com barra normal, produzindo um caminho
  relativo que não existe. A prova está em `acervo.upload_arquivo_temp`: das 17.155 linhas,
  as 15.506 concluídas foram gravadas por processo **Windows** (separador `\`), e as únicas
  4 de processo **Linux** (separador `/`) terminaram em `failed` ou `cancelled`, com
  "Arquivo não encontrado". Em servidor Linux, monte o compartilhamento por CIFS e grave o
  **ponto de montagem** naquela coluna. Montar e atualizar a coluna são a **mesma** mudança:
  separadas, o `confirm-upload` para de validar checksum.
- Volume primário por tipo de produto em `volume_tipo_produto`.
- Projetos/lotes do SCA espelham os projetos de produção
  (ex.: projeto "Saicã", lote "2017_SAICA_25K" PIT 2017).

## 5. Piloto

`$ACERVO_FONTE_PRODUCAO/Produtos_2017/2017_SAICA_25K` — 8 cartas CT 25k (TIF+PDF, ~0,73 GB):

1. Criar volume (valor em `$ACERVO_VOLUME`) + associação primária para CT.
2. Criar projeto "Saicã" + lote 2017.
3. Para cada carta: produto (MI/INOM/geometria/subtipo T34-700) + versão
   **"4ª Edição"** ("5ª" para 2962-4-SE e 2980-1-SO, conforme `Cont_Edicao` da planilha),
   `tipo_versao_id = 2`, nome/órgão da planilha, `data_edicao = 2017-06-29` (informações
   marginais), etapas de produção no `metadado` + TIF (principal) + PDF (alternativo)
   via `prepare-upload/product` → cópia → `confirm-upload`.
4. Criar views materializadas e validar (dashboard, plugin QGIS, download).
5. A edição **2024 (1-DSG)** dessas cartas será carregada de `$ACERVO_FONTE_PRODUCAO/Produtos_2024`.
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
