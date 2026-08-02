'use strict'

// Invariantes lógicos do acervo: as regras que o schema NÃO consegue exprimir
// (checagem entre tabelas, coerência entre geometria e escala, formato de
// rótulo, integridade de relacionamento).
//
// Por que moram aqui e não no vault do Chefe da DGEO, onde nasceram: eles são
// afirmações sobre o modelo de dados DESTE sistema. Fora dele, apodrecem em
// silêncio a cada migração (um `subtipo_produto_id` novo, uma escala nova) e
// exigem credencial de banco em outra máquina. Aqui, o mesmo commit que muda o
// schema pode mudar o invariante, e o teste acusa quando não muda.
//
// Severidade:
//   DEFECT  - tem de dar zero. Qualquer linha é um dado errado no acervo.
//   REVISAR - lente larga, para triagem humana. Achado NÃO é necessariamente erro.
//   INFO    - estatística de cobertura; nunca é erro.
//
// Nenhum destes escreve. São todos SELECT, e a rota que os expõe é de leitura.

const INVARIANTES = [
  // ---- P1: escala x geometria x INOM ----
  {
    codigo: '1a',
    severidade: 'DEFECT',
    titulo: 'escala personalizada(5) SEM denominador',
    sql: 'select id,nome from acervo.produto where tipo_escala_id=5 and denominador_escala_especial is null'
  },
  {
    codigo: '1b',
    severidade: 'DEFECT',
    titulo: 'escala padrao(1-4) COM denominador',
    sql: 'select id,nome,tipo_escala_id from acervo.produto where tipo_escala_id<>5 and denominador_escala_especial is not null'
  },
  {
    codigo: '1c',
    severidade: 'DEFECT',
    titulo: 'INOM presente mas escala=personalizada',
    sql: 'select id,nome,inom from acervo.produto where inom is not null and tipo_escala_id=5'
  },
  {
    codigo: '1d',
    severidade: 'DEFECT',
    titulo: 'profundidade do INOM diverge do tipo_escala_id',
    sql: `with p as (select id,nome,inom,tipo_escala_id,
             array_length(string_to_array(upper(regexp_replace(inom,'\\s','','g')),'-'),1) tk
       from acervo.produto where inom is not null)
     select id,nome,inom,tipo_escala_id,tk from p
     where case tk when 4 then 4 when 5 then 3 when 6 then 2 when 7 then 1 else null end
           is distinct from tipo_escala_id`
  },
  {
    codigo: '1e',
    severidade: 'DEFECT',
    titulo: 'MISLABEL: bbox casa LIMPO com outra escala SCN',
    sql: `with p as (select id,nome,inom,tipo_escala_id,
             st_xmax(geom)-st_xmin(geom) w, st_ymax(geom)-st_ymin(geom) h
       from acervo.produto where inom is not null and tipo_escala_id between 1 and 4),
     g as (select *, case
             when w between 0.106 and 0.144 and h between 0.106 and 0.144 then 1
             when w between 0.212 and 0.288 and h between 0.212 and 0.288 then 2
             when w between 0.425 and 0.575 and h between 0.425 and 0.575 then 3
             when w between 1.275 and 1.725 and h between 0.85 and 1.15 then 4
             else 0 end esc_geom from p)
     select id,nome,inom,tipo_escala_id,esc_geom,round(w::numeric,4) w,round(h::numeric,4) h
     from g where esc_geom<>0 and esc_geom<>tipo_escala_id`
  },
  {
    codigo: '1e_info',
    severidade: 'INFO',
    titulo: 'geom SCN irregular/recortada (bbox nao casa nenhuma escala)',
    sql: `with p as (select id,tipo_escala_id,
             st_xmax(geom)-st_xmin(geom) w, st_ymax(geom)-st_ymin(geom) h
       from acervo.produto where inom is not null and tipo_escala_id between 1 and 4)
     select count(*) n from p where not (
       (tipo_escala_id=1 and w between 0.106 and 0.144 and h between 0.106 and 0.144) or
       (tipo_escala_id=2 and w between 0.212 and 0.288 and h between 0.212 and 0.288) or
       (tipo_escala_id=3 and w between 0.425 and 0.575 and h between 0.425 and 0.575) or
       (tipo_escala_id=4 and w between 1.275 and 1.725 and h between 0.85 and 1.15))`
  },
  {
    codigo: '1f',
    severidade: 'DEFECT',
    titulo: 'geometria invalida / vazia / SRID != 4674',
    sql: 'select id,nome,st_srid(geom) srid from acervo.produto where not st_isvalid(geom) or st_isempty(geom) or st_srid(geom)<>4674'
  },
  {
    codigo: '1g',
    severidade: 'REVISAR',
    titulo: 'MI e INOM inconsistentes (um presente, outro ausente)',
    sql: 'select id,nome,mi,inom,tipo_produto_id from acervo.produto where (mi is null) <> (inom is null)'
  },
  {
    codigo: '1h',
    severidade: 'DEFECT',
    titulo: 'MI preenchido com INOM',
    // Achado em 2026-07-30, ao atualizar o site de produtos: 29 produtos tinham
    // no `mi` uma COPIA literal do `inom` (`mi` = `inom`, string por string).
    // O 1g nao pega, porque os dois campos estao preenchidos.
    //
    // Nenhum invariante que compare produto com produto pega, tampouco: cada um
    // desses 29 e o UNICO produto da sua folha, entao nao ha vizinho com o MI
    // certo para divergir. Foi preciso uma grade externa para achar. Este teste
    // e de FORMA, e por isso independe de vizinho.
    //
    // Custa caro em duas frentes: a folha aparece duas vezes no mapa de
    // cobertura (uma na celula da grade, outra como celula solta), e o nome
    // fisico do arquivo, que e DERIVADO por coalesce(mi, inom), sai com o INOM
    // no lugar do MI. Corrigir o `mi` arrasta renome (invariante 7a).
    sql: "select id,nome,mi,inom,tipo_escala_id,tipo_produto_id from acervo.produto where upper(btrim(mi)) ~ '^[A-Z]{2}-'"
  },
  {
    codigo: '1i',
    severidade: 'DEFECT',
    titulo: 'MI fora da forma da escala',
    // A forma do MI e composicional: 250k e 100k so o numero da folha, 50k com
    // o quadrante (1..4), 25k com o quadrante e o rumo (NE/NO/SE/SO).
    //
    // O sufixo de LETRA no numero e legitimo e tem de passar (`2882A`, `536A`,
    // e as folhas `2882A-4` e `2882A-4-SE` que descem dele). Um teste sem essa
    // folga acusa 8 falsos DEFECT no acervo de 07/2026, e invariante DEFECT que
    // nao da zero envenena a auditoria inteira (ver a nota do 3f).
    //
    // Escala personalizada (5) fica fora: folha nao-SCN nao tem MI, e o 1c ja
    // trata o INOM nesse caso.
    sql: `select id,nome,mi,inom,tipo_escala_id from acervo.produto
       where mi is not null and tipo_escala_id between 1 and 4
         and upper(btrim(mi)) !~ '^[A-Z]{2}-'
         and btrim(mi) !~ case tipo_escala_id
               when 1 then '^[0-9]+[A-Z]?-[1-4]-(NE|NO|SE|SO)$'
               when 2 then '^[0-9]+[A-Z]?-[1-4]$'
               else '^[0-9]+[A-Z]?$' end`
  },

  // ---- P2: identidade e unicidade ----
  {
    codigo: '2a',
    severidade: 'DEFECT',
    titulo: 'produtos SCN duplicados (inom,escala,tipo,subtipo)',
    sql: `select inom,tipo_escala_id,tipo_produto_id,coalesce(subtipo_produto_id,0) sub,count(*) n,array_agg(id) ids
       from acervo.produto where inom is not null group by 1,2,3,4 having count(*)>1`
  },
  {
    codigo: '2b',
    severidade: 'REVISAR',
    titulo: 'produtos Nao-SCN mesmo (nome,escala,tipo,subtipo)',
    sql: `select nome,tipo_escala_id,tipo_produto_id,coalesce(subtipo_produto_id,0) sub,count(*) n,array_agg(id) ids
       from acervo.produto where inom is null group by 1,2,3,4 having count(*)>1`
  },
  {
    codigo: '2c',
    severidade: 'DEFECT',
    titulo: 'produto SEM nenhuma versao (orfao)',
    sql: 'select p.id,p.nome from acervo.produto p where not exists(select 1 from acervo.versao v where v.produto_id=p.id)'
  },
  {
    codigo: '2d',
    severidade: 'DEFECT',
    titulo: 'produto pinado (subtipo) com versao divergente',
    sql: `select p.id,p.nome,p.subtipo_produto_id psub,array_agg(distinct v.subtipo_produto_id) vsubs
       from acervo.produto p join acervo.versao v on v.produto_id=p.id
       where p.subtipo_produto_id is not null and v.subtipo_produto_id<>p.subtipo_produto_id group by 1,2,3`
  },
  // Subtipo que DEFINE produto (hoje só o 24, Carta Topográfica Militar) morando
  // como versão de um produto de outra identidade. Vive em zero, igual ao 3c: o
  // gatilho acervo.validate_version já recusa na escrita, nos dois sentidos
  // (produto pinado divergente, e define_produto sem produto próprio).
  //
  // Fica como REDE, e por duas razões que o 3c não tem: `define_produto` é dado,
  // e não código -- um UPDATE em dominio.subtipo_produto marcando outro subtipo
  // não revalida as versões que já existem. E o 2d só enxerga o produto PINADO,
  // então o caso que importa (produto com subtipo_produto_id NULO recebendo uma
  // versão militar) escapa dele por construção.
  {
    codigo: '2e',
    severidade: 'DEFECT',
    titulo: 'versao de subtipo que EXIGE produto proprio em produto de outra identidade',
    sql: `select v.id versao_id,v.versao,v.subtipo_produto_id,
            p.id produto_id,p.nome,p.subtipo_produto_id produto_subtipo
       from acervo.versao v
       join acervo.produto p on p.id=v.produto_id
       join dominio.subtipo_produto s on s.code=v.subtipo_produto_id
       where s.define_produto and p.subtipo_produto_id is distinct from v.subtipo_produto_id`
  },

  // ---- P3: versao (tipo x arquivo x datas x rotulo) ----
  {
    codigo: '3a',
    severidade: 'DEFECT',
    titulo: 'Registro Historico (tipo2) COM arquivo',
    sql: `select v.id,v.versao,p.nome from acervo.versao v join acervo.produto p on p.id=v.produto_id
       where v.tipo_versao_id=2 and exists(select 1 from acervo.arquivo a where a.versao_id=v.id)`
  },
  {
    codigo: '3b',
    severidade: 'DEFECT',
    titulo: 'Regular (tipo1) SEM arquivo',
    sql: `select v.id,v.versao,p.nome from acervo.versao v join acervo.produto p on p.id=v.produto_id
       where v.tipo_versao_id=1 and not exists(select 1 from acervo.arquivo a where a.versao_id=v.id)`
  },
  {
    codigo: '3c',
    severidade: 'DEFECT',
    titulo: 'data_edicao < data_criacao',
    // Hoje o banco JÁ impede: acervo.versao nasce com CHECK (data_edicao >=
    // data_criacao) no er/acervo.sql. Este invariante nunca dispara, e fica de
    // propósito: ele é a rede que sobra se a constraint cair numa migração
    // futura, e custa uma consulta trivial. Descoberto em 2026-07-25, ao trazer
    // os invariantes do vault para cá: no script antigo ninguém sabia que ele
    // era redundante, porque nunca houve um teste que tentasse violá-lo.
    sql: 'select id,versao,data_criacao,data_edicao from acervo.versao where data_edicao<data_criacao'
  },
  {
    codigo: '3d',
    severidade: 'DEFECT',
    titulo: 'datas absurdas (futuro ou ano<1900)',
    sql: `select id,versao,data_criacao,data_edicao from acervo.versao
       where data_edicao>current_date or data_criacao>current_date
          or extract(year from data_criacao)<1900 or extract(year from data_edicao)<1900`
  },
  {
    codigo: '3e',
    severidade: 'DEFECT',
    titulo: 'rotulo fora do padrao (Nª Edicao / N-XXXXX)',
    sql: "select id,versao,produto_id from acervo.versao where versao !~ '^[0-9]+ª Edição' and versao !~ '^[0-9]+-'"
  },
  {
    codigo: '3f',
    severidade: 'DEFECT',
    titulo: 'colisao: 2+ versoes REGULARES com mesmo rotulo E mesmo subtipo no produto',
    // O subtipo entra no GROUP BY porque entrou na IDENTIDADE em 2026-07-06
    // (migration 2026-07-06_produto_subtipo_identidade.sql). A restricao do banco
    // e unique_version_per_product sobre (produto_id, versao, subtipo_produto_id):
    // a Carta Ortoimagem (3) e a Ortoimagem Especial (27) da mesma folha podem
    // ambas ser "1ª Edição" porque sao produtos distintos dentro do mesmo registro.
    // Sem o subtipo aqui, o invariante afirmava uma unicidade que o banco nao exige
    // e acusava 18 falsos DEFECT. Um invariante DEFECT tem de dar zero: se ele mede
    // regra diferente da que o schema aplica, envenena a auditoria inteira.
    sql: 'select produto_id,versao,subtipo_produto_id,count(*) n,array_agg(id) ids from acervo.versao where tipo_versao_id=1 group by 1,2,3 having count(*)>1'
  },
  {
    codigo: '3h',
    severidade: 'REVISAR',
    titulo: 'subtipo da versao fora do esperado para o tipo_produto',
    sql: `select p.tipo_produto_id tp,v.subtipo_produto_id sub,count(*) n,array_agg(v.id) ids
       from acervo.versao v join acervo.produto p on p.id=v.produto_id
       where (p.tipo_produto_id=1 and v.subtipo_produto_id not in (1,7,8,20,22,23))
          or (p.tipo_produto_id=2 and v.subtipo_produto_id not in (2,12,24,28))
          or (p.tipo_produto_id=3 and v.subtipo_produto_id not in (3,19,27))
          or (p.tipo_produto_id=7 and v.subtipo_produto_id not in (13,14,15,16,17,29))
       group by 1,2`
  },
  // A SÉRIE, e não a linha. O 3c e o 3d olham uma versão isolada (data invertida
  // dentro dela, data absurda); nenhum dos dois enxerga a 2ª Edição datada ANTES
  // da 1ª, que é o erro de digitação comum ao recadastrar acervo legado.
  //
  // O ordinal é o inteiro à esquerda do rótulo, e ele serve aos DOIS formatos que
  // acervo.validate_version aceita ('Nª Edição' e 'N-XXXXX'). Rótulo fora de
  // forma não entra aqui: quem cobra isso é o 3e, e tentar ordenar o que não tem
  // ordinal produziria achado que não diz nada.
  //
  // Particiona por SUBTIPO porque o produto civil abrange T34-700(2) e ET-RDG(12)
  // nas versões (ver o comentário de acervo.produto.subtipo_produto_id): são duas
  // séries de edição dentro do mesmo registro, e compará-las entre si acusaria
  // erro onde há só duas numerações independentes.
  //
  // Compara por DIA de calendário, e não por instante, pela mesma razão que o 5i:
  // data de versão é dia, e duas edições cadastradas no mesmo dia em horas
  // diferentes não são incoerência nenhuma.
  //
  // O `distinct on` conta VERSÃO, e não PAR, e isso não é cosmético. O auto-join
  // produz uma linha por par (maior, menor): um produto cuja 1ª Edição ficou com
  // a data errada acusa uma vez para CADA edição posterior, e um único registro
  // errado vira "3 ocorrências" num invariante cuja regra é dar zero. O `order
  // by menor.data_edicao desc` faz a linha que sobra trazer o pior infrator, que
  // é a data que empurra a série inteira para fora de ordem.
  //
  // O `versao_id` continua sendo o da MAIOR, e ele nem sempre é o registro
  // errado: quando quem está errada é a menor (data no futuro), a maior é só
  // quem denuncia. Por isso as duas edições saem no resultado, com as duas
  // datas -- quem tria decide qual das duas corrigir, e a tela mostra as
  // colunas que o invariante devolveu.
  {
    codigo: '3i',
    severidade: 'DEFECT',
    titulo: 'serie de edicao incoerente (edicao maior com data_edicao ANTERIOR a de uma menor)',
    sql: `with s as (
            select v.id,v.produto_id,v.versao,v.data_edicao,v.subtipo_produto_id,
                   (substring(btrim(v.versao) from '^[0-9]+'))::int ord
              from acervo.versao v
             where v.data_edicao is not null and btrim(v.versao) ~ '^[0-9]+')
          select distinct on (maior.id)
                 maior.id versao_id,maior.produto_id,p.nome produto,
                 maior.versao versao_maior,maior.data_edicao data_maior,
                 menor.versao versao_menor,menor.data_edicao data_menor
            from s maior
            join s menor
              on menor.produto_id=maior.produto_id
             and menor.subtipo_produto_id is not distinct from maior.subtipo_produto_id
             and menor.ord<maior.ord
            join acervo.produto p on p.id=maior.produto_id
           where date_trunc('day',maior.data_edicao)<date_trunc('day',menor.data_edicao)
           order by maior.id,menor.data_edicao desc`
  },
  // A promessa VENCIDA. Planejada (tipo 3) nasce sem arquivo de propósito, para o
  // item do pedido poder apontar para ela, e recebe o arquivo na MESMA versão
  // quando a produção termina -- por isso "Planejada COM arquivo" não é defeito
  // nenhum, é o caminho de conclusão de POST /api/arquivo/upload-web/arquivos, e
  // um invariante que a acusasse nunca zeraria. O sinal útil é o inverso: a data
  // de edição já passou e o arquivo não chegou.
  //
  // REVISAR, e não DEFECT: atraso de produção é fato administrativo, não dado
  // errado. Quem lê a lista decide se cobra a produção ou se corrige a data.
  {
    codigo: '3j',
    severidade: 'REVISAR',
    titulo: 'versao Planejada VENCIDA (data_edicao ja passou e continua sem arquivo)',
    sql: `select v.id versao_id,v.versao,v.data_edicao,p.id produto_id,p.nome produto
       from acervo.versao v join acervo.produto p on p.id=v.produto_id
       where v.tipo_versao_id=3 and v.data_edicao<current_date
         and not exists(select 1 from acervo.arquivo a where a.versao_id=v.id)`
  },

  // ---- P4: arquivo ----
  //
  // O TILESERVER (tipo_arquivo_id = 9) fica de fora de 4a, 4f e 4g. Ele não é
  // byte no volume, é URL: `er/acervo.sql` EXIGE dele `checksum`, `tamanho_mb` e
  // `volume_armazenamento_id` nulos, por CHECK. Sem o filtro, os três acusavam
  // DEFECT em todo tileserver do acervo -- um DEFECT que não pode zerar, porque
  // zerá-lo violaria o schema. Achado em 2026-08-02, ao levar a auditoria para a
  // web. O 7a e o 7b já traziam o mesmo `<> 9` desde que nasceram; estes três
  // vieram do script do vault sem ele, e nada acusava porque ninguém tinha uma
  // tela onde a contagem ficasse na cara.
  {
    codigo: '4a',
    severidade: 'DEFECT',
    titulo: 'arquivo com checksum NULL',
    sql: 'select id,nome_arquivo,versao_id from acervo.arquivo where checksum is null and tipo_arquivo_id<>9'
  },
  {
    codigo: '4b',
    severidade: 'DEFECT',
    titulo: 'checksum mal formado (nao 64 hex)',
    sql: "select id,nome_arquivo,checksum from acervo.arquivo where checksum is not null and checksum !~ '^[0-9a-fA-F]{64}$'"
  },
  {
    codigo: '4c',
    severidade: 'REVISAR',
    titulo: 'checksum compartilhado entre versoes diferentes',
    sql: `select lower(checksum) ck,count(distinct versao_id) nv,array_agg(distinct versao_id) versoes
       from acervo.arquivo where checksum is not null group by 1 having count(distinct versao_id)>1`
  },
  {
    codigo: '4d',
    severidade: 'REVISAR',
    titulo: 'extensao do principal incoerente com tipo_produto',
    sql: `select a.id,a.nome_arquivo,a.extensao,p.tipo_produto_id from acervo.arquivo a
       join acervo.versao v on v.id=a.versao_id join acervo.produto p on p.id=v.produto_id
       where a.tipo_arquivo_id=1 and (
         (p.tipo_produto_id=1 and lower(a.extensao) not in ('zip','gpkg','7z','sqlite')) or
         (p.tipo_produto_id in (2,3) and lower(a.extensao) not in ('tif','tiff','pdf')))`
  },
  {
    codigo: '4e',
    severidade: 'DEFECT',
    titulo: 'versao Regular COM arquivos mas SEM arquivo principal(1)',
    sql: `select v.id,v.versao,p.nome from acervo.versao v join acervo.produto p on p.id=v.produto_id
       where v.tipo_versao_id=1 and exists(select 1 from acervo.arquivo a where a.versao_id=v.id)
         and not exists(select 1 from acervo.arquivo a where a.versao_id=v.id and a.tipo_arquivo_id=1)`
  },
  {
    codigo: '4f',
    severidade: 'DEFECT',
    titulo: 'arquivo com tamanho_mb null ou <=0',
    sql: 'select id,nome_arquivo,tamanho_mb from acervo.arquivo where tipo_arquivo_id<>9 and (tamanho_mb is null or tamanho_mb<=0)'
  },
  {
    codigo: '4g',
    severidade: 'DEFECT',
    titulo: 'arquivo sem volume_armazenamento_id',
    sql: 'select id,nome_arquivo,versao_id from acervo.arquivo where volume_armazenamento_id is null and tipo_arquivo_id<>9'
  },
  // A LACUNA do par: nos produtos que se entregam em raster E em PDF, a versão
  // com um só dos dois é entrega pela metade. O 4d não pega: ele confere se a
  // extensão do PRINCIPAL está no conjunto aceito, e um PDF sozinho passa nele.
  //
  // Nasce REVISAR e não DEFECT de propósito (decisão de 2026-08-02): ninguém
  // mediu ainda quantas folhas do acervo legado têm só um dos dois, e DEFECT que
  // não zera envenena a auditoria inteira (ver a nota do 3f). Promover a DEFECT
  // é commit próprio, depois de rodar contra produção.
  //
  // Só entra `tipo_arquivo_id` 1 (principal) e 2 (formato alternativo), que é
  // onde a entrega vive: um PDF que fosse Documentos(6) ou Insumo(3) contaria
  // como se o PDF da carta existisse, e a falta some.
  //
  // Tipos 2 (Carta Topográfica) e 3 (Carta Ortoimagem) são o mesmo conjunto que o
  // 4d já trata como raster-ou-PDF. Ortoimagem pura (4) fica de fora: ela é
  // imagem, e não carta, e não se espera PDF dela.
  {
    codigo: '4h',
    severidade: 'REVISAR',
    titulo: 'versao Regular de carta com raster SEM PDF, ou PDF SEM raster',
    sql: `with e as (
            select v.id versao_id,v.versao,p.id produto_id,p.nome,p.tipo_produto_id,
                   bool_or(lower(a.extensao) in ('tif','tiff')) tem_raster,
                   bool_or(lower(a.extensao)='pdf') tem_pdf
              from acervo.versao v
              join acervo.produto p on p.id=v.produto_id
              join acervo.arquivo a on a.versao_id=v.id and a.tipo_arquivo_id in (1,2)
             where p.tipo_produto_id in (2,3) and v.tipo_versao_id=1
             group by 1,2,3,4,5)
          select versao_id,versao,produto_id,nome,tipo_produto_id,
                 case when tem_raster then 'falta o PDF' else 'falta o raster (tif/tiff)' end falta
            from e where tem_raster <> tem_pdf`
  },

  // ---- P5: relacionamento ----
  {
    codigo: '5a',
    severidade: 'DEFECT',
    titulo: 'self-loop (versao_id_1 = versao_id_2)',
    sql: 'select id from acervo.versao_relacionamento where versao_id_1=versao_id_2'
  },
  {
    codigo: '5b',
    severidade: 'DEFECT',
    titulo: 'relacionamento duplicado (par nao-ordenado + tipo)',
    sql: `select least(versao_id_1,versao_id_2) a,greatest(versao_id_1,versao_id_2) b,tipo_relacionamento_id t,
            count(*) n,array_agg(id) ids from acervo.versao_relacionamento group by 1,2,3 having count(*)>1`
  },
  {
    codigo: '5c',
    severidade: 'DEFECT',
    titulo: 'relacionamento apontando versao inexistente',
    sql: `select r.id from acervo.versao_relacionamento r
       where not exists(select 1 from acervo.versao v where v.id=r.versao_id_1)
          or not exists(select 1 from acervo.versao v where v.id=r.versao_id_2)`
  },
  {
    codigo: '5d',
    severidade: 'REVISAR',
    titulo: 'Insumo entre escalas SCN diferentes (exclui personalizada)',
    sql: `select r.id,p1.tipo_escala_id e1,p2.tipo_escala_id e2,p1.inom i1,p2.inom i2
       from acervo.versao_relacionamento r
       join acervo.versao v1 on v1.id=r.versao_id_1 join acervo.produto p1 on p1.id=v1.produto_id
       join acervo.versao v2 on v2.id=r.versao_id_2 join acervo.produto p2 on p2.id=v2.produto_id
       where r.tipo_relacionamento_id=1 and p1.tipo_escala_id<>p2.tipo_escala_id
         and p1.tipo_escala_id<>5 and p2.tipo_escala_id<>5`
  },
  {
    codigo: '5f',
    severidade: 'REVISAR',
    titulo: 'Insumo entre FOLHAS (INOM) diferentes',
    sql: `select r.id,p1.inom i1,p2.inom i2,p1.nome n1,p2.nome n2 from acervo.versao_relacionamento r
       join acervo.versao v1 on v1.id=r.versao_id_1 join acervo.produto p1 on p1.id=v1.produto_id
       join acervo.versao v2 on v2.id=r.versao_id_2 join acervo.produto p2 on p2.id=v2.produto_id
       where r.tipo_relacionamento_id=1 and p1.inom is not null and p2.inom is not null and upper(p1.inom)<>upper(p2.inom)`
  },

  // Insumo (tipo 1) é 1:1 entre a Carta Topográfica e o CDGV daquela folha.
  // Uma ponta ligada a duas é sinal de pareamento errado, e o pareamento errado
  // se propaga (a data e o rótulo do vetor seguem os da carta).
  {
    codigo: '5g',
    severidade: 'DEFECT',
    titulo: 'Insumo 1:N (a mesma versao ligada a mais de uma)',
    sql: `select 'versao_id_1' ponta,versao_id_1 versao_id,count(*) n,array_agg(id) ids
       from acervo.versao_relacionamento where tipo_relacionamento_id=1 group by 1,2 having count(*)>1
     union all
     select 'versao_id_2',versao_id_2,count(*),array_agg(id)
       from acervo.versao_relacionamento where tipo_relacionamento_id=1 group by 1,2 having count(*)>1`
  },
  // A LACUNA, e não o erro: carta e vetor da mesma folha, escala e LOTE que
  // deveriam estar ligados e não estão. O lote é a chave (mesma produção),
  // nunca o rótulo ordinal, que carta e vetor podem discordar.
  {
    codigo: '5h',
    severidade: 'REVISAR',
    titulo: 'par Carta-CDGV do MESMO lote sem relacionamento de Insumo',
    sql: `with ctv as (select v.id vid,p.inom,p.tipo_escala_id esc,v.lote_id
             from acervo.versao v join acervo.produto p on p.id=v.produto_id
             where p.tipo_produto_id=2 and p.inom is not null and v.lote_id is not null),
       cdv as (select v.id vid,p.inom,p.tipo_escala_id esc,v.lote_id
             from acervo.versao v join acervo.produto p on p.id=v.produto_id
             where p.tipo_produto_id=1 and p.inom is not null and v.lote_id is not null),
       pares as (select ctv.vid carta,cdv.vid cdgv,ctv.inom,ctv.esc,ctv.lote_id
             from ctv join cdv on cdv.inom=ctv.inom and cdv.esc=ctv.esc and cdv.lote_id=ctv.lote_id),
       rel as (select versao_id_1,versao_id_2 from acervo.versao_relacionamento where tipo_relacionamento_id=1)
     select pares.carta,pares.cdgv,pares.inom,pares.esc,pares.lote_id
     from pares left join rel r on r.versao_id_1=pares.carta and r.versao_id_2=pares.cdgv
     where r.versao_id_1 is null`
  },
  // Mesma edição com data ou rótulo divergente entre carta e vetor. Não é erro
  // de ligação, é desalinhamento a corrigir: a carta manda, o vetor segue
  // (decisão do chefe, 2026-07-04).
  {
    codigo: '5i',
    severidade: 'REVISAR',
    titulo: 'Insumo ligado mas com data_edicao ou rotulo divergente (alinhar o VETOR a CARTA)',
    sql: `select vr.id,v1.id carta,v2.id cdgv,v1.versao versao_carta,v2.versao versao_cdgv,
            v1.data_edicao data_carta,v2.data_edicao data_cdgv
       from acervo.versao_relacionamento vr
       join acervo.versao v1 on v1.id=vr.versao_id_1
       join acervo.versao v2 on v2.id=vr.versao_id_2
       where vr.tipo_relacionamento_id=1
         and (date_trunc('day',v1.data_edicao)<>date_trunc('day',v2.data_edicao) or v1.versao<>v2.versao)`
  },

  // ---- P6: cobertura (analise, nunca erro) ----
  {
    codigo: '6a',
    severidade: 'DEFECT',
    titulo: 'CDGV SCN (vetor) sem NENHUM relacionamento',
    sql: `select p.id,p.nome,p.inom from acervo.produto p where p.tipo_produto_id=1 and p.inom is not null
       and not exists(select 1 from acervo.versao v join acervo.versao_relacionamento r
                      on (r.versao_id_1=v.id or r.versao_id_2=v.id) where v.produto_id=p.id)`
  },
  {
    codigo: '6b',
    severidade: 'INFO',
    titulo: 'Carta Topografica SCN sem CDGV na mesma folha (cobertura)',
    sql: `select count(*) n from acervo.produto p where p.tipo_produto_id=2 and p.inom is not null
       and not exists(select 1 from acervo.produto q where q.tipo_produto_id=1
                      and upper(q.inom)=upper(p.inom) and q.tipo_escala_id=p.tipo_escala_id)`
  },

  // ---- P7: nome fisico x metadados ----
  //
  // O nome fisico e DERIVADO (tipo, subtipo, MI/INOM, escala, edicao). Derivado
  // envelhece: renumerar uma edicao ou corrigir um subtipo muda o nome esperado e
  // NAO mexe no arquivo. Sem estes tres, a divergencia so apareceria no dia em que
  // alguem fosse baixar. A regra vive em acervo.nome_arquivo_padrao (migration
  // 2026-07-29_nome_arquivo_padrao.sql), a MESMA que a rota de renome usa: auditor
  // e escritor nao podem divergir porque sao a mesma funcao.
  {
    codigo: '7a',
    severidade: 'DEFECT',
    // Volume com layout_origem fica de FORA. Ele guarda a entrega no layout do
    // fornecedor por decisao (Convenio RS, 2026-07-31), e o nome fisico ali e o
    // caminho relativo de origem. Sem o filtro este invariante acusaria milhares
    // de DEFECT permanentes, e DEFECT que nunca zera apaga o valor de sinal do
    // auditor. O renomear-padrao aplica o MESMO filtro: auditor e escritor nao
    // podem divergir. Ver migrations/2026-07-31_volume_layout_origem.sql.
    titulo: 'nome fisico divergente do padrao derivado dos metadados',
    sql: `select a.id,a.nome_arquivo,a.extensao,
            acervo.nome_arquivo_padrao(p.tipo_produto_id,v.subtipo_produto_id,p.mi,p.inom,
              p.nome,p.tipo_escala_id,p.denominador_escala_especial,v.versao) as esperado,
            v.id versao_id,v.versao,p.id produto_id,p.nome produto
          from acervo.arquivo a
          join acervo.versao v on v.id=a.versao_id
          join acervo.produto p on p.id=v.produto_id
          left join acervo.volume_armazenamento vol on vol.id=a.volume_armazenamento_id
          where a.tipo_arquivo_id<>9
            and coalesce(vol.layout_origem,false)=false
            and a.nome_arquivo is distinct from acervo.nome_arquivo_padrao(
              p.tipo_produto_id,v.subtipo_produto_id,p.mi,p.inom,p.nome,
              p.tipo_escala_id,p.denominador_escala_especial,v.versao)`
  },
  {
    codigo: '7b',
    severidade: 'DEFECT',
    titulo: 'nome fisico NAO computavel (rotulo de versao ou nome de produto fora do padrao)',
    sql: `select a.id,a.nome_arquivo,v.versao,p.nome produto,p.mi,p.inom
          from acervo.arquivo a
          join acervo.versao v on v.id=a.versao_id
          join acervo.produto p on p.id=v.produto_id
          where a.tipo_arquivo_id<>9
            and acervo.nome_arquivo_padrao(p.tipo_produto_id,v.subtipo_produto_id,p.mi,p.inom,
              p.nome,p.tipo_escala_id,p.denominador_escala_especial,v.versao) is null`
  },
  {
    codigo: '7c',
    severidade: 'REVISAR',
    titulo: 'arquivo VIVO com o mesmo nome fisico de um arquivo DELETADO (lapide aponta para byte existente)',
    sql: `select d.id deletado_id,d.nome_arquivo,d.extensao,a.id vivo_id,a.versao_id
          from acervo.arquivo_deletado d
          join acervo.arquivo a
            on a.volume_armazenamento_id=d.volume_armazenamento_id
           and lower(a.nome_arquivo)=lower(d.nome_arquivo)
           and lower(a.extensao)=lower(d.extensao)`
  }
]

const SEVERIDADES = ['DEFECT', 'REVISAR', 'INFO']

module.exports = { INVARIANTES, SEVERIDADES }
