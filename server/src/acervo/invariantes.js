// Path: acervo\invariantes.js
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
    // Hoje o banco JÁ impede: acervo.versao tem CHECK (data_edicao >=
    // data_criacao), er/acervo.sql:116. Este invariante nunca dispara, e fica
    // de propósito: ele é a rede que sobra se a constraint cair numa migração
    // futura, e custa uma consulta trivial. Descoberto em 2026-07-25, ao
    // trazer os invariantes do vault para cá: no script antigo ninguém sabia
    // que ele era redundante, porque nunca houve um teste que tentasse violá-lo.
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

  // ---- P4: arquivo ----
  {
    codigo: '4a',
    severidade: 'DEFECT',
    titulo: 'arquivo com checksum NULL',
    sql: 'select id,nome_arquivo,versao_id from acervo.arquivo where checksum is null'
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
    sql: 'select id,nome_arquivo,tamanho_mb from acervo.arquivo where tamanho_mb is null or tamanho_mb<=0'
  },
  {
    codigo: '4g',
    severidade: 'DEFECT',
    titulo: 'arquivo sem volume_armazenamento_id',
    sql: 'select id,nome_arquivo,versao_id from acervo.arquivo where volume_armazenamento_id is null'
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
    titulo: 'nome fisico divergente do padrao derivado dos metadados',
    sql: `select a.id,a.nome_arquivo,a.extensao,
            acervo.nome_arquivo_padrao(p.tipo_produto_id,v.subtipo_produto_id,p.mi,p.inom,
              p.nome,p.tipo_escala_id,p.denominador_escala_especial,v.versao) as esperado,
            v.id versao_id,v.versao,p.id produto_id,p.nome produto
          from acervo.arquivo a
          join acervo.versao v on v.id=a.versao_id
          join acervo.produto p on p.id=v.produto_id
          where a.tipo_arquivo_id<>9
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
