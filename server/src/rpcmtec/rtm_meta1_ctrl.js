'use strict'

// A aba META1_DETALHADA do RTM: a produção cartográfica do PIT, uma FOLHA por
// linha, com o rastro SAP (projeto, lote, bloco) e o rastro da carga no BDGEx.
//
// O DADO SAI DAQUI E A FORMA SAI DE `rtm_ods.js`, que é o mesmo desenho da aba
// irmã META4_DETALHADA: lá a consulta mora em `mapoteca/relatorio_ctrl.js`,
// dona do dado, e só o gerador mora em `rpcmtec/`, onde ficam as sementes. A
// Meta 1 não tem módulo dono -- ela cruza `acervo` com `pit` --, e por isso a
// consulta fica no próprio `rpcmtec/`, ao lado das outras que o relatório
// mensal calcula.
//
// O GRÃO É A VERSÃO, e não o MI. Uma linha por `acervo.versao` ligada a um item
// da Meta 1, que é a mesma unidade que a grade do PIT conta: a versão vale uma
// unidade da meta (ver o comentário de `meta_pit_id` em er/acervo.sql).
//
// E ENTRA A FOLHA AINDA NÃO PRODUZIDA, que é o que separa esta aba da subseção
// 2.4 do RPCMTec: a 2.4 reporta o que foi ENTREGUE no mês, e a META1_DETALHADA
// reporta o PLANO do ano com o andamento de cada folha ao lado. No RTM de
// agosto de 2026 são 193 linhas e apenas 145 com data de carga -- as outras 48
// são folhas que ainda não ficaram prontas e aparecem assim mesmo. A conta
// inteira está no JSDoc de `buscarMeta1Detalhada`.

const { db } = require('../database')
// DE QUEM É ESTA INSTALAÇÃO, no ponto único. A coluna OMDS é PARÂMETRO e não
// coluna de banco, pelo mesmo motivo escrito no topo de
// `mapoteca/relatorio_ctrl.js`: ela é constante por instalação, e quem gera o
// relatório desta é a instituição dela.
const instituicaoCtrl = require('../instituicao/instituicao_ctrl')
const {
  domainConstants: {
    SITUACAO_CARREGAMENTO,
    TIPO_VERSAO
  }
} = require('../utils')
const {
  ESCALA_DISPLAY,
  filtroAno,
  filtroPeriodoMes
} = require('../mapoteca/query_fragments')

const controller = {}

// A Meta 1 é a da PRODUÇÃO CARTOGRÁFICA, e o número é do GRUPO
// (`pit.meta.numero_meta`), nunca do item: quem cumpre a meta é o item ('1.1',
// '1.11'), e a aba junta todos os itens do grupo 1.
const META_PRODUCAO = 1

// ---------------------------------------------------------------------------
// "Local da Carga": os seis códigos do domínio contra os dois rótulos da aba
// ---------------------------------------------------------------------------
//
// O domínio é `dominio.situacao_carregamento` (er/dominio.sql:53-59), com seis
// códigos:
//
//     (1, 'Não carregado'), (2, 'Carregado BDGEx Ostensivo'),
//     (3, 'Carregado BDGEx Operações'), (4, 'Carregado IGW'),
//     (5, 'Carregado GEDW'), (6, 'Carregado EBGeo')
//
// A aba de agosto de 2026 usa DOIS rótulos, 'BDGEX' (115 linhas) e 'Repositório
// DSG' (30), e o mapeamento honesto tem três partes:
//
//  - 2 e 3 são os que a aba chama de 'BDGEX'. O Ostensivo e o Operações são o
//    MESMO destino para quem lê o RTM, e a aba nunca os distinguiu;
//  - 4, 5 e 6 (IGW, GEDW, EBGeo) NÃO TÊM correspondente na aba. Saem com o
//    nome do destino em vez de 'BDGEX', porque escrever BDGEX num produto que
//    foi para o EBGeo é o tipo de linha plausível e falsa que sobe para a DSG
//    sem ninguém notar. Quem preenche decide o que fazer com ela;
//  - 'Repositório DSG' NÃO EXISTE NO DOMÍNIO, e NENHUM CÓDIGO O PRODUZ.
//
// O REPOSITÓRIO DSG FICA À MÃO, e é decisão do Chefe da DGEO de 2026-09-11: não
// nasce código novo em `dominio.situacao_carregamento` para ele. A célula sai em
// BRANCO e quem monta o RTM escreve o rótulo, como já faz hoje. É o mesmo
// tratamento da Data da Carga: a coluna existe, na posição certa, e sai vazia.
//
// ---------------------------------------------------------------------------
// OS DOIS BRANCOS DESTA COLUNA NÃO SÃO O MESMO BRANCO
// ---------------------------------------------------------------------------
//
// A planilha mostra os dois iguais, e a causa é diferente. Quem for mexer aqui
// precisa saber qual dos dois está olhando:
//
//  1. BRANCO POR FALTA DE CARGA: a folha não foi carregada em lugar nenhum
//     (todos os arquivos com `situacao_carregamento_id` = 1, ou nenhum arquivo,
//     que é o caso da Planejada). O banco SABE a resposta, e a resposta é
//     "ainda não". São as 48 linhas de agosto com as três colunas do fim vazias.
//  2. BRANCO POR FALTA DE CÓDIGO: a folha FOI disseminada, e o destino é o
//     Repositório DSG, que o domínio não sabe nomear. O banco NÃO sabe a
//     resposta, e a célula fica com quem preenche.
//
// E O SEGUNDO CASO NÃO SE DETECTA HOJE, o que é mais grave do que sair em
// branco. Medido na produção em 2026-09-11: as 8 folhas de CDGV ligadas à meta
// 1.5 têm `situacao_carregamento_id` = 2, isto é, o cadastro diz BDGEx
// Ostensivo, e elas saem daqui com 'BDGEX' -- enquanto a planilha de agosto
// escreve 'Repositório DSG' nas 30 linhas de CDGV COMBATER dela. São duas
// medidas do mesmo parâmetro que discordam, e nenhuma regra deste arquivo as
// concilia: ou o cadastro está errado, ou a planilha está. Derivar o destino do
// NOME do lote ('...COMBATER...') seria chute, e por isso não se faz aqui.
//
// O código 1 não entra no mapa de propósito: a consulta já o exclui, e a folha
// sem nenhum arquivo carregado cai no caso 1 acima.
const LOCAL_DA_CARGA = {
  [SITUACAO_CARREGAMENTO.CARREGADO_BDGEX_OSTENSIVO]: 'BDGEX',
  [SITUACAO_CARREGAMENTO.CARREGADO_BDGEX_OPERACOES]: 'BDGEX',
  [SITUACAO_CARREGAMENTO.CARREGADO_IGW]: 'IGW',
  [SITUACAO_CARREGAMENTO.CARREGADO_GEDW]: 'GEDW',
  [SITUACAO_CARREGAMENTO.CARREGADO_EBGEO]: 'EBGeo'
}

// A versão tem VÁRIOS arquivos, e eles podem ter ido para destinos diferentes
// (o PDF para o BDGEx Ostensivo, o mesmo produto para o Operações). A célula é
// uma só, então saem os destinos DISTINTOS, na ordem do domínio, separados por
// barra. Nas 115 linhas carregadas de agosto o destino é único e a barra nunca
// aparece; o dia em que aparecer, a aba diz a verdade em vez de escolher um.
const localDaCarga = situacoes => {
  if (!Array.isArray(situacoes) || situacoes.length === 0) return null

  const destinos = [...new Set(
    situacoes
      .map(Number)
      .sort((a, b) => a - b)
      .map(code => LOCAL_DA_CARGA[code])
      .filter(Boolean)
  )]

  return destinos.length === 0 ? null : destinos.join(' / ')
}

// A ESCALA COM PONTO DE MILHAR, que é como a aba a escreve ('1:25.000') e como
// `dominio.tipo_escala` nomeia as quatro do mapeamento sistemático.
//
// A ESCALA PERSONALIZADA (código 5) é a exceção, e ela é real: o fragmento
// ESCALA_DISPLAY monta '1:' || denominador, sem separador, e sai '1:10000'. Na
// medida de 2026 uma folha da Meta 1 usa escala personalizada, e sem este
// acerto a coluna teria DUAS grafias para a mesma coisa -- a do domínio com
// ponto e a da personalizada sem. A aba de agosto escreve '1:10.000'.
//
// O agrupamento é feito à mão, e não por `toLocaleString('pt-BR')`: o segundo
// depende do ICU que o Node do servidor tiver, e a mesma linha sairia diferente
// em duas máquinas.
const escalaDaAba = escala => {
  if (!escala) return null

  return String(escala).replace(
    /^1:(\d+)$/,
    (_, denominador) => `1:${denominador.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
  )
}

// A ORDEM DA ABA, medida nas 193 linhas de agosto: pelo ITEM da meta e, dentro
// dele, pelo MI. O item é ordenado NUMERICAMENTE, parte a parte, e não como
// texto: a aba traz 1.8, 1.9, 1.10 e 1.11 nessa ordem, e a comparação textual
// poria 1.10 e 1.11 antes de 1.2.
const partesDoItem = meta => String(meta == null ? '' : meta)
  .split('.')
  .map(parte => {
    const n = Number(parte)
    // Item não numérico ('ExtraPIT') vai para o fim, e não para o meio com um
    // NaN que faz a comparação devolver sempre false.
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
  })

const compararItem = (a, b) => {
  const pa = partesDoItem(a)
  const pb = partesDoItem(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] === undefined ? -1 : pa[i]
    const vb = pb[i] === undefined ? -1 : pb[i]
    if (va !== vb) return va - vb
  }
  return 0
}

/**
 * As folhas da Meta 1 do ano, com tudo o que a aba META1_DETALHADA pede.
 *
 * A ABA É O PLANO, E NÃO O PRONTO, e isso foi medido contra o RTM de agosto de
 * 2026: das 193 linhas, só 145 têm data de carga. As outras 48 são folhas ainda
 * não produzidas, e elas APARECEM na aba assim mesmo, com as colunas do fim
 * vazias. Uma consulta que partisse do acervo pronto devolveria 135 onde a aba
 * tem 193, e a diferença passaria por "faltou produção" quando é a régua da
 * consulta que está errada.
 *
 * ENTÃO O GRÃO É A FOLHA CADASTRADA para cumprir a meta, na mesma definição que
 * `pit_execucao_ctrl.diagnostico` usa na coluna `cadastradas`: TODA
 * `acervo.versao` ligada ao item por `meta_pit_id`, seja ela Regular (pronta),
 * Planejada (prometida) ou Registro Histórico. É por isso que não há filtro de
 * `tipo_versao_id` aqui, e a ausência dele é a correção de 2026-09-11.
 *
 * O QUE A ABA GERADA VAI SOMAR, medido na produção em 2026-09-11:
 *
 *   - 187 é o total do plano (a soma de `quantidade_prevista` dos 11 itens não
 *     cancelados da Meta 1), e é o número CERTO para a aba cheia;
 *   - 165 é o que ela devolve hoje, porque a meta 1.5 (CDGV COMBATER) promete
 *     30 folhas e tem 8 versões cadastradas. As outras dez metas batem folha a
 *     folha com a promessa. As 22 que faltam não existem no banco, e inventar
 *     linha para elas seria escrever no RTM o que ninguém cadastrou;
 *   - 193 é o que a planilha de agosto traz, e a diferença de 6 para o plano
 *     NÃO SE REPRODUZ aqui, de propósito. São +3 do item 1.8, onde o PIT R2
 *     assinado promete 4 folhas e o SAP guarda 1 (divergência declarada, por
 *     decisão do chefe em 2026-09-11), e +3 de linhas que não são da Meta 1
 *     (duas Extra-PIT e uma da Meta 2, o MGCP da DSG), acrescentadas à mão por
 *     quem preenche.
 *
 * O `mes` é OPCIONAL e ACUMULA, e o que ele recorta MUDOU com o grão: ele não
 * tira linha nenhuma, porque o plano do ano é o mesmo em março e em agosto.
 * Ele decide o que já está PRONTO: a folha que só ficou Regular depois do mês
 * pedido sai com as colunas de carga vazias, que é o que o RTM daquele mês
 * dizia. Sem `mes`, o ano inteiro. Medida na produção: 135 folhas prontas no
 * ano, 119 até agosto.
 *
 * USA A VIEW `pit.meta_vigente`, e nunca a tabela `pit.meta_item`: é na view
 * que `demandante` e `descricao` existem preenchidos, porque os dois mudaram de
 * casa para `pit.meta_item_revisao`. Pela tabela viriam NULOS, que é erro que
 * não dá erro -- dá coluna vazia no RTM. A view usa INNER JOIN LATERAL, então a
 * folha que aponta item que revisão PUBLICADA nenhuma declarou não sai: ela
 * ainda não está no plano.
 *
 * @param {number} ano
 * @param {number} [mes] - 1 a 12; acumula de janeiro até ele
 * @returns {Promise<Array<Object>>}
 */
controller.buscarMeta1Detalhada = async (ano, mes = null) => {
  const instituicao = await instituicaoCtrl.paraDocumento()

  return db.conn.any(
    `
    SELECT
      -- Parametro, e nao coluna: ver o bloco do topo deste arquivo.
      $<omds> AS omds,
      mv.demandante,
      -- O CODIGO DO ITEM ('1.1'), do proprio cadastro do PIT e nunca texto
      -- digitado. O COALESCE cobre o item sem codigo, que o DDL nao deixa
      -- acontecer hoje, e mantem a coluna preenchida se um dia deixar.
      COALESCE(mv.item, mv.numero_meta::text) AS meta,
      tp.nome AS produto,
      -- A coluna MI da aba traz o MI classico ('2833-1-NE') e tambem nome
      -- livre ('Estadio do Beira Rio'), que e o produto especial sem folha.
      -- Mesmo COALESCE da subsecao 2.4.
      COALESCE(prod.mi, prod.inom, prod.nome) AS mi,
      ${ESCALA_DISPLAY} AS escala,
      pr.nome AS projeto_sap,
      -- O NOME do lote, e nao l.pit: ver o bloco "Lote e Bloco" dentro do
      -- paraAbaMeta1. (Sem crase neste comentario: template literal.)
      l.nome AS lote_sap,
      v.uuid_versao::text AS uuid_versao,
      v.descricao AS observacao,
      carga.situacoes AS situacoes_carregamento,
      -- A FOLHA JA ESTA PRONTA no recorte? E o que separa a linha cheia da
      -- linha que para na Escala. Pronta e a versao REGULAR com data de edicao
      -- dentro do periodo: a Planejada e promessa, e a Regular editada depois
      -- do mes pedido ainda nao tinha acontecido quando aquele RTM subiu.
      (
        v.tipo_versao_id = $<versaoRegular>
        AND ${mes ? filtroPeriodoMes('v.data_edicao', { cumulativo: true }) : filtroAno('v.data_edicao')}
      ) AS pronta,
      v.data_edicao,
      -- A promessa por FOLHA, que e de onde sai o planejado do PIT. Nao e
      -- coluna da aba; viaja para quem quiser ordenar ou conferir.
      v.data_prevista
    FROM acervo.versao AS v
    JOIN acervo.produto AS prod ON prod.id = v.produto_id
    JOIN dominio.tipo_produto AS tp ON tp.code = prod.tipo_produto_id
    -- Os aliases prod e te sao os que o fragmento ESCALA_DISPLAY exige; trocar
    -- um deles da "missing FROM-entry" na primeira execucao.
    JOIN dominio.tipo_escala AS te ON te.code = prod.tipo_escala_id
    INNER JOIN pit.meta_vigente AS mv ON mv.id = v.meta_pit_id
    -- LEFT nos dois, e nao INNER: a folha SEM lote existe e e o produto
    -- especial. Sao as tres linhas do Estadio Beira Rio (metas 1.9, 1.10 e
    -- 1.11) da aba de agosto, e um INNER as apagaria do relatorio sem avisar.
    LEFT JOIN acervo.lote AS l ON l.id = v.lote_id
    LEFT JOIN acervo.projeto AS pr ON pr.id = l.projeto_id
    -- ONDE a folha foi carregada, sem o QUANDO, que nao existe no banco (ver o
    -- bloco da data da carga, no paraAbaMeta1). Agrega os DESTINOS distintos
    -- dos arquivos ja carregados; a folha pronta e nao entregue devolve NULO, e
    -- a Planejada tambem (medida na producao: 30 Planejadas, ZERO com arquivo
    -- carregado).
    LEFT JOIN LATERAL (
      SELECT array_agg(DISTINCT a.situacao_carregamento_id) AS situacoes
      FROM acervo.arquivo AS a
      WHERE a.versao_id = v.id
        AND a.situacao_carregamento_id <> $<naoCarregado>
    ) AS carga ON TRUE
    -- SEM FILTRO DE tipo_versao_id, e sem filtro de data sobre a linha: quem
    -- recorta a aba e o PLANO do ano, e nao o que ficou pronto. Ver o bloco do
    -- JSDoc acima, com a conta medida.
    WHERE mv.numero_meta = $<metaProducao>
      -- O ANO DA META e o do recorte: a meta 1.1 de 2026 e outra coisa que a
      -- meta 1.1 de 2025, e sem isto a folha de janeiro cairia na meta do ano
      -- anterior que tem o mesmo codigo.
      AND mv.ano = $<ano>
      -- O item CANCELADO sai do plano, e e o mesmo filtro que o diagnostico do
      -- PIT usa. Sao 11 itens nao cancelados na Meta 1 de 2026.
      AND mv.cancelada IS NOT TRUE
    ORDER BY mv.item, mi
    `,
    {
      ano,
      mes,
      omds: instituicao.sigla,
      versaoRegular: TIPO_VERSAO.REGULAR,
      naoCarregado: SITUACAO_CARREGAMENTO.NAO_CARREGADO,
      metaProducao: META_PRODUCAO
    }
  )
}

// ---------------------------------------------------------------------------
// A DATA DA CARGA NO BDGEx SAI SEMPRE VAZIA (decisão do Chefe da DGEO,
// 2026-09-11)
// ---------------------------------------------------------------------------
//
// Não é defeito, e não é esquecimento: A COLUNA NÃO EXISTE NO BANCO. A busca em
// `er/` inteiro por `data_carga|data_carregamento|bdgex_id|id_bdgex|
// data_publicacao` devolveu ZERO resultados. O que existe é
// `acervo.arquivo.situacao_carregamento_id`, que diz o ONDE e nunca o QUANDO.
//
// E NÃO SERVE DERIVAR. `acervo.arquivo.data_cadastramento` e `data_modificacao`
// são do REGISTRO no SCA: editar a descrição do arquivo move a segunda sem que
// carga nenhuma tenha acontecido. Usar qualquer uma das duas como data de carga
// produziria uma tela que mente, com a agravante de mentir uma data plausível.
//
// A ESCOLHA DO CHEFE, em 2026-09-11, foi deixar a célula EM BRANCO para
// preenchimento à mão, como já é hoje, em vez de criar coluna nova e mais um
// campo para alguém redigitar. A coluna continua saindo, na posição certa, para
// a aba abrir com a forma de sempre.
//
// PARA MUDAR ISSO: ou nasce `acervo.arquivo.data_carregamento`, ou nasce uma
// tabela de eventos de carga, e aí esta chave passa a ler o banco. Enquanto não
// nascer, `data_carga_bdgex` é null aqui e o gerador escreve célula vazia.

/**
 * Traduz as linhas de `buscarMeta1Detalhada` para o vocabulário da aba.
 *
 * As 13 chaves são as que `rpcmtec/rtm_ods.COLUNAS_META1` declara, na ordem das
 * 13 colunas medidas no RTM de agosto de 2026.
 *
 * O que muda em relação ao que o banco devolve, e por quê:
 *  - `data_carga_bdgex`: SEMPRE null (ver o bloco acima);
 *  - `meta`: sempre TEXTO, inclusive quando o valor é "2" (ver abaixo);
 *  - `lote_sap` e `bloco_sap`: o mesmo valor (ver abaixo);
 *  - `id_carga_bdgex`: o `uuid_versao`, e só na folha PRONTA e carregada;
 *  - `local_carga`: o destino do domínio traduzido (ver LOCAL_DA_CARGA).
 *
 * A FOLHA AINDA NÃO PRODUZIDA é o caso normal aqui, e não a exceção: ela sai
 * com meta, produto, MI, escala, projeto, lote e bloco preenchidos e as três
 * colunas do fim (data, id e local da carga) vazias. É como a aba de agosto
 * traz 48 das suas 193 linhas, e é por isso que a linha do .ods pode terminar
 * cedo. O MI dela vem do mesmo lugar que o da folha pronta -- `acervo.produto`
 * pelo `produto_id` da versão --, porque a folha existe como registro antes de
 * ficar pronta: das 30 Planejadas da Meta 1 de 2026, 28 têm MI e as duas sem
 * MI são produto especial, que cai no nome.
 *
 * @param {Array<Object>} dados - saída de buscarMeta1Detalhada
 * @returns {Array<Object>}
 */
controller.paraAbaMeta1 = dados =>
  [...dados]
    .sort((a, b) => {
      const porMeta = compararItem(a.meta, b.meta)
      if (porMeta !== 0) return porMeta
      const ma = a.mi == null ? '' : String(a.mi)
      const mb = b.mi == null ? '' : String(b.mi)
      if (ma !== mb) return ma < mb ? -1 : 1
      return 0
    })
    .map(l => {
      // A CARGA SÓ CONTA NA FOLHA PRONTA NO RECORTE. A Planejada não tem
      // arquivo carregado, e a Regular que ficou pronta DEPOIS do mês pedido
      // ainda não tinha acontecido quando aquele RTM subiu para a DSG:
      // reportá-la faria a edição de março afirmar uma carga de julho.
      const local = l.pronta ? localDaCarga(l.situacoes_carregamento) : null

      return {
        omds: l.omds || null,
        demandante: l.demandante || null,
        // TEXTO, sempre, mesmo valendo "2". No RTM de agosto uma linha saiu
        // como número float, porque alguém digitou 2 sem ponto, e o Calc passa
        // a alinhá-la à direita: a coluna deixa de casar com as outras 192.
        // O `String()` aqui é o que impede a repetição, e é por isso que ele
        // não é um `|| null` como as vizinhas.
        meta: l.meta == null || l.meta === '' ? null : String(l.meta),
        produto: l.produto || null,
        mi: l.mi || null,
        escala: escalaDaAba(l.escala),
        // O NOME DO PROJETO É O DO CADASTRO, decisão do Chefe da DGEO de
        // 2026-09-11, pela mesma razão do lote logo abaixo. A base diz
        // `Mapeamento de Interesse da Força 2026` e a planilha de agosto diz
        // `Produção de Geoinformação Nacional 2026`: quem comparar as duas vai
        // ver nomes diferentes, e isso NÃO é defeito desta consulta. Se um dos
        // dois estiver desatualizado, a correção é no cadastro do projeto.
        projeto_sap: l.projeto_sap || null,
        // LOTE E BLOCO CARREGAM O MESMO VALOR, e isso foi medido: nas 190
        // linhas preenchidas de agosto, ZERO têm Lote diferente de Bloco. O
        // "bloco" do SAP 2.3.5 não tem entidade no SAP 3.0 -- `acervo.lote` é
        // a única -- e repetir o lote é o que a planilha do chefe já faz à
        // mão. Não se inventa uma segunda fonte para uma coluna que sempre
        // repetiu a primeira.
        //
        // É `acervo.lote.nome`, e não `acervo.lote.pit`, e os dois existem: o
        // `pit` é o código curto do lote no plano ('2026-1d') e o `nome` é
        // como o lote se chama. Os 22 valores distintos da aba de agosto são
        // nomes ('1d CT 25k Parque Nacional Iguaçu', '1v COMBATER'), e não
        // códigos. A subseção 2.4 do RPCMTec usa `l.pit` na coluna que ela
        // chama de "Lote SAP", e a divergência é deliberada: são duas colunas
        // com o mesmo rótulo e conteúdos diferentes no documento de origem.
        //
        // A GRAFIA É A DO CADASTRO, decisão do Chefe da DGEO de 2026-09-11. A
        // base escreve `2026_1d_CT_Parque_Nacional_Iguacu_25k` e a planilha de
        // agosto escreve `1d CT 25k Parque Nacional Iguaçu`: mesma informação,
        // com sublinhado, sem acento e com a escala no fim. Sai o que o
        // cadastro diz, sem normalização e sem tentar reproduzir a digitação à
        // mão -- o sistema é a fonte, e reescrever para o que alguém digitou
        // criaria uma segunda verdade que ninguém consegue conferir depois.
        lote_sap: l.lote_sap || null,
        bloco_sap: l.lote_sap || null,
        // SEMPRE VAZIA. A justificativa inteira está no bloco acima deste
        // JSDoc, e ela é de 2026-09-11.
        data_carga_bdgex: null,
        // O `uuid_versao` É o identificador do BDGEx: é com ele que o produto
        // é publicado lá, e não há um segundo identificador a guardar. O repo
        // afirma isso em três lugares (`rpcmtec_estrutura.js` na 2.4,
        // `auditoria/mapa/acervo.js` no rastro da coluna, e
        // `produto/produto_ctrl.corrigeUuidVersao`, que existe justamente
        // porque quem atribui o número quando a carga vem antes da catalogação
        // é o BDGEx).
        //
        // O VÍNCULO É POR VERSÃO, E NÃO POR ARQUIVO, e isso foi investigado.
        // `acervo.arquivo.uuid_arquivo` também é UUID, mas o repositório nunca
        // o chama de identificador de publicação: ele é a chave do arquivo no
        // acervo. Carregar dois arquivos da mesma folha não gera duas cargas
        // no BDGEx, gera uma publicação com dois arquivos.
        //
        // E as células com DOIS uuid do RTM de agosto não contradizem isso.
        // Elas são 26, e são TODAS de Carta Topográfica (25) e Carta
        // Topográfica Especial (1); nas 79 de Carta Ortoimagem a célula tem um
        // só. É o par carta + CDGV do mesmo MI, que er/acervo.sql descreve
        // ("Todo lote de Carta Topografica de 2026 traz o CDGV junto, um para
        // um por MI"), colapsado à mão numa linha só. No SAP 3.0 são DUAS
        // versões, e só a que cumpre a meta entra nesta aba -- o CDGV
        // companheiro aponta outra meta ou nenhuma. A aba passa a ter uma
        // linha por versão, e a célula, um uuid.
        //
        // SÓ NA FOLHA PRONTA E CARREGADA. A coluna é o ID DA CARGA, e a folha
        // que ainda não subiu não tem carga a identificar: escrever o uuid dela
        // aqui prometeria no BDGEx um produto que ninguém encontra lá. A
        // Planejada TEM uuid desde o cadastro, e é justamente por isso que a
        // condição é `local`, e não a existência do uuid. São as 48 linhas de
        // agosto com as três colunas de carga em branco.
        id_carga_bdgex: local ? l.uuid_versao || null : null,
        local_carga: local,
        // A Observação é `acervo.versao.descricao`, a única candidata no banco.
        // O SCA guarda cadeia VAZIA onde não há descrição (135 das 165 folhas
        // da Meta 1 de 2026), e o `|| null` é o que faz a célula sair em branco
        // em vez de sair com uma cadeia de comprimento zero.
        //
        // MEDIDO EM 2026-09-11, e vai à mesa do chefe: as 30 folhas Planejadas
        // trazem aqui uma NOTA DE CADASTRO, e não uma observação do relatório
        // ("Versao PLANEJADA: a folha ainda vai ser produzida. A data de edicao
        // e a do cadastramento..."). Ela sobe para a DSG como está, porque
        // descartá-la em silêncio seria esconder o que o banco tem; se o chefe
        // não a quiser na aba, a correção é no cadastro ou numa regra dele.
        observacao: l.observacao || null
      }
    })

module.exports = controller
