// Path: rpcmtec\rpcmtec_ctrl.js
'use strict'

// O RPCMTec, inteiro, num gerador só.
//
// POR QUE FORA DOS MÓDULOS. O RPCMTec é o relatório mensal da DIVISÃO, e não de
// acervo, mapoteca ou orçamento: a mesma edição fala das três coisas, e o chefe
// assina uma só. Até 2026-08-01 ele era gerado em DOIS lugares que não se
// conheciam (`server/src/relatorio/`, com acervo e mapoteca, e
// `server/src/orcamento/relatorio/`, com o PDR), cada um com a própria
// numeração de seção e o próprio DOCX, e quem montava a edição juntava os dois
// arquivos à mão. Os dois foram substituídos por este. Mesmo critério que tirou
// `pit.meta` de dentro do orçamento em 2026-07-31: dado de que nenhum módulo é
// dono mora fora deles.
//
// O QUE ELE GERA, e o que deliberadamente NÃO gera. A numeração é a do
// documento que a Divisão usa (medida em "RPCM Técnico Julho_2026.docx"), para
// que cada tabela seja colável na subseção de mesmo número. Só saem as
// subseções que o SCA sabe preencher INTEIRAS:
//
//   2.2  Totais do Mês e do Ano          acervo.versao por data_edicao
//   2.4  Entregas detalhada de produtos  idem, uma linha por versão
//   2.7  Estado do Acervo                cobertura por escala x tipo
//   3.1  Totais do Mês e do Ano          mapoteca.pedido
//   3.2  Entregas da mapoteca            idem, uma linha por pedido militar
//   3.3  Extra-PIT                       idem, previsto_pit = false
//   3.4  LAI e órgãos públicos           idem, cliente civil
//   4.1  Execução por ND                 orçamento, classificação PDR
//   4.2  Situação dos créditos           idem
//   4.3  Situação RPNP                   orcamento.rpnp
//   4.4  GCALC DSG                       orcamento.licitacao, tipo 1
//   4.5  Demais licitações               idem, tipo 2
//   4.6  Recebimento de material         orcamento.recebimento_material
//   4.7  Créditos Extra-PDR              orçamento, classificação Extra-PDR
//   7.2  Insumos de impressão, papel     mapoteca.tipo_material
//   7.3  Insumos de impressão, tintas    idem
//
// FICAM DE FORA, com o motivo, para ninguém procurar o que não existe:
//   2.1  Estado Atual do PIT     `pit.meta` não tem quantidade prevista nem
//                                previsão de término, e nenhuma versão do
//                                acervo aponta para uma meta.
//   2.3  Execução por Lote       o SCA conta os produtos do lote, mas não tem
//                                operador nem percentual concluído.
//   2.5  Atividades de campo     não há tabela de atividade de campo.
//   2.6  Capacitações externas   não há tabela de capacitação.
//   5.   Desenvolvimento e TI    vem do painel do GitHub e do backup.
//   6.   Recursos Humanos        o efetivo é do Auth Server, sem atividade.
//   7.1  Equipamento indisponível  não há cadastro de equipamento técnico.
//   8.   Divulgação              não há cadastro de publicação em BI.
//   9.   Boas práticas           é texto do chefe, não dado.
//
// O MESMO OBJETO alimenta a tela e o arquivo. `gerar()` devolve as subseções já
// com as células em texto, e o DOCX só as desenha. Foi assim de propósito: com
// a tela lendo números crus e o arquivo formatando por conta, as duas divergiam
// no arredondamento, e quem conferia o DOCX contra a tela via diferença onde
// não havia.

const { db } = require('../database')
const acervoCtrl = require('../acervo/acervo_ctrl')
const integracaoCtrl = require('../integracao/integracao_ctrl')
const mapotecaCtrl = require('../mapoteca/mapoteca_ctrl')
const {
  domainConstants: {
    SITUACAO_PEDIDO,
    TIPO_CLIENTE,
    TIPO_LICITACAO,
    CLASSIFICACAO_NC,
    CATEGORIA_MATERIAL
  }
} = require('../utils')
const { QTD_EFETIVA, JOIN_PRODUTO_ITEM, filtroPeriodoMes } = require('../mapoteca/query_fragments')

const controller = {}

// Cliente militar (3.1/3.2/3.3) contra civil, órgão público e LAI (3.4).
const TIPOS_CLIENTE_MILITAR = [
  TIPO_CLIENTE.OM_EB,
  TIPO_CLIENTE.OM_AERONAUTICA,
  TIPO_CLIENTE.OM_MARINHA
]

// Situações que já foram entregues. Cancelado não é nem entregue nem pendente:
// não há mais nada a cobrar, então ele sai das duas contas.
const SITUACOES_ENTREGUE = [SITUACAO_PEDIDO.REMETIDO, SITUACAO_PEDIDO.CONCLUIDO]

// Universo de folhas da ASC (Área de Suprimento Cartográfico, 576.000 km²) por
// escala, para a % de cobertura da 2.7. Fonte: RT 11/2025 (proposta de base
// contínua), confirmado pelo chefe da DGEO em 2026-07-01 (o RT registrava 250
// para 1:100.000; o valor correto é 249).
const UNIVERSO_ASC = {
  '1:25.000': 3556,
  '1:50.000': 927,
  '1:100.000': 249,
  '1:250.000': 49
}

// O "name" curto de SITUACAO_GERAL_ESCALAS ('25k') para o nome de exibição da
// escala, que é o mesmo valor que `produtos_finalizados` devolve em
// `resumo[].escala` (igual a dominio.tipo_escala.nome).
const ESCALA_NOME = {
  '25k': '1:25.000',
  '50k': '1:50.000',
  '100k': '1:100.000',
  '250k': '1:250.000'
}

const NAO_MAPEADO = 'Não mapeado'

// Os dois tipos que a 2.7 conta, com a propriedade da célula que diz se aquela
// folha está coberta naquele tipo. A cobertura vem de getSituacaoGeralCells,
// que já mescla Carta Topográfica e Carta Ortoimagem da mesma MI (no SCA são
// produtos distintos) numa célula só.
const TIPOS_ESTADO_ACERVO = [
  { nome: 'Carta Topográfica', propriedade: 'situacao_topo' },
  { nome: 'Carta Ortoimagem', propriedade: 'situacao_orto' }
]

// ---------------------------------------------------------------------------
// Formatação de célula
// ---------------------------------------------------------------------------

// Nulo e vazio viram '-', que é como o modelo escreve "não há". Zero é ZERO, e
// não '-': "entregamos nada" é uma informação, "não sabemos" é outra.
const texto = valor => (valor == null || valor === '' ? '-' : String(valor))

const numero = valor => (valor == null ? '-' : String(valor))

// '94.830,00', como a 4.1 e a 4.2 do modelo escrevem (sem o símbolo).
const formatadorDecimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

// 'R$ 65.996,85', como a 4.3, a 4.4 e a 4.5 do modelo escrevem (com o símbolo).
const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
})

// NULO é '-' e não 'R$ 0,00', e a diferença é de propósito: na 4.1 do modelo o
// '-' quer dizer "não houve documento nenhum nesta ND", e '0,00' quer dizer
// "houve, e a soma deu zero". As consultas abaixo somam SEM COALESCE justamente
// para preservar essa distinção.
const decimal = valor => (valor == null ? '-' : formatadorDecimal.format(Number(valor)))
const moeda = valor => (valor == null ? '-' : formatadorMoeda.format(Number(valor)))

// ---------------------------------------------------------------------------
// 2.2 / 2.4 / 2.7 - acervo
// ---------------------------------------------------------------------------

// 2.2: uma linha por tipo de produto entregue, mais "Total geral". Os rótulos
// saem de `dominio.tipo_produto`, e não da lista fixa do modelo ("CDGV EDGV
// 3.0", "Carta Militar (BDGEx Op)"): aqueles misturam tipo com subtipo e com
// destino de carga, e o SCA não tem de onde derivá-los sem inventar mapeamento.
const montarTotaisPorTipo = ({ produtosMes, produtosAno }) => {
  const porTipo = resumo => resumo.reduce((mapa, r) => {
    mapa[r.tipo_produto] = (mapa[r.tipo_produto] || 0) + r.quantidade
    return mapa
  }, {})

  const mes = porTipo(produtosMes.resumo)
  const ano = porTipo(produtosAno.resumo)
  const tipos = [...new Set([...Object.keys(mes), ...Object.keys(ano)])].sort()

  return [
    ...tipos.map(tipo => [texto(tipo), numero(mes[tipo] || 0), numero(ano[tipo] || 0)]),
    ['Total geral', numero(produtosMes.total), numero(produtosAno.total)]
  ]
}

// 2.4: uma linha por versão finalizada NO MÊS (não cumulativo, como o título da
// subseção diz). O "UUID BDGEx" é `acervo.versao.uuid_versao`: é o mesmo
// identificador com que o produto é publicado lá, e não um código nosso.
const montarEntregasDetalhadas = ({ produtosMes }) =>
  produtosMes.produtos.map(p => [
    texto(p.tipo_produto),
    texto(p.escala),
    texto(p.uuid_versao),
    texto(p.mi || p.inom),
    texto(p.pit),
    texto(p.lote)
  ])

// 2.7: escala x tipo de produto. O modelo escreve a escala sem o "1:" ("25.000").
const montarEstadoAcervo = ({ situacaoGeral, produtosMes }) => {
  const linhas = []

  for (const tipo of TIPOS_ESTADO_ACERVO) {
    for (const escala of acervoCtrl.SITUACAO_GERAL_ESCALAS) {
      const escalaNome = ESCALA_NOME[escala.name]
      const celulas = situacaoGeral[escala.name] || []

      const catalogado = celulas
        .filter(c => c.properties[tipo.propriedade] !== NAO_MAPEADO).length

      const noMes = produtosMes.resumo
        .filter(r => r.escala === escalaNome && r.tipo_produto === tipo.nome)
        .reduce((s, r) => s + r.quantidade, 0)

      const universo = UNIVERSO_ASC[escalaNome] || null
      const percentual = universo
        ? `${Math.round((catalogado / universo) * 1000) / 10}%`
        : '-'

      linhas.push([
        escalaNome.replace('1:', ''),
        tipo.nome,
        numero(catalogado),
        numero(noMes),
        numero(universo),
        percentual
      ])
    }
  }

  return linhas
}

// ---------------------------------------------------------------------------
// 3.1 a 3.4 - mapoteca
// ---------------------------------------------------------------------------

// Pedidos do período, por DATA DE CRIAÇÃO (data_pedido) e em QUALQUER situação.
// É a mesma fonte que o RPCMTec histórico sempre mostrou nas 3.2 e 3.4, onde
// convivem "Pendente" e "Concluído" no mesmo mês -- e por isso ela é mais ampla
// que `integracaoCtrl.getMapotecaAtendimentos`, que só traz pedido já entregue,
// pela data de atendimento.
//
// Os LEFT JOIN de JOIN_PRODUTO_ITEM são o que impede o item AVULSO (papel
// quadriculado, impresso de ocasião) de sumir calado da contagem: ele tem
// `uuid_versao` nulo, e um INNER JOIN o apagaria sem erro nenhum, só com número
// menor.
const buscarPedidos = async ({ ano, mes, cumulativo }) => {
  return db.conn.any(
    `
    SELECT
      ped.id,
      -- A SIGLA da OM é o nome corrente para quem lê o RPCMTec, e o que cabe na
      -- coluna: "10º B Log" no lugar de "10º Batalhão Logístico". Cai no nome
      -- quando não há sigla, que é o caso de quem não é OM (órgão público,
      -- cidadão da LAI). NULLIF cobre a sigla gravada como string vazia.
      COALESCE(NULLIF(BTRIM(c.sigla), ''), c.nome) AS solicitante,
      c.tipo_cliente_id,
      ped.situacao_pedido_id,
      sp.nome AS situacao,
      ped.documento_solicitacao,
      ped.documento_solicitacao_nup,
      ped.previsto_pit,
      ped.demandante,
      ped.observacao,
      COALESCE(SUM(${QTD_EFETIVA}), 0)::int AS quantidade,
      -- Os tipos de produto DISTINTOS do pedido, para a coluna "Tipo de
      -- produto" da 3.3. FILTER descarta o nulo do item avulso, que não tem
      -- tipo; o pedido só de avulso sai com a lista vazia.
      COALESCE(
        ARRAY_AGG(DISTINCT tp.nome) FILTER (WHERE tp.nome IS NOT NULL),
        ARRAY[]::varchar[]
      ) AS tipos_produto
    FROM mapoteca.pedido ped
    JOIN mapoteca.cliente c ON c.id = ped.cliente_id
    JOIN mapoteca.situacao_pedido sp ON sp.code = ped.situacao_pedido_id
    LEFT JOIN mapoteca.produto_pedido pp ON pp.pedido_id = ped.id
    ${JOIN_PRODUTO_ITEM}
    WHERE ${filtroPeriodoMes('ped.data_pedido', { cumulativo })}
    GROUP BY ped.id, c.sigla, c.nome, c.tipo_cliente_id, ped.situacao_pedido_id,
      sp.nome, ped.documento_solicitacao, ped.documento_solicitacao_nup,
      ped.previsto_pit, ped.demandante, ped.observacao
    ORDER BY ped.data_pedido, ped.id
    `,
    { ano, mes }
  )
}

const ehMilitar = pedido => TIPOS_CLIENTE_MILITAR.includes(pedido.tipo_cliente_id)
const foiEntregue = pedido => SITUACOES_ENTREGUE.includes(pedido.situacao_pedido_id)
const foiCancelado = pedido => pedido.situacao_pedido_id === SITUACAO_PEDIDO.CANCELADO

// "Documento de solicitação" como o RPCMTec o exibe: o documento informado
// (DIEx/Ofício) ou o NUP; na falta dos dois, "PIT"/"Extra-PIT", derivado de
// previsto_pit. É o que a edição de julho/2026 mostra na 3.2.
const documentoExibicao = pedido => {
  if (pedido.documento_solicitacao) return pedido.documento_solicitacao
  if (pedido.documento_solicitacao_nup) return pedido.documento_solicitacao_nup
  if (pedido.previsto_pit === true) return 'PIT'
  if (pedido.previsto_pit === false) return 'Extra-PIT'
  return '-'
}

// Os três números que a 3.1 pede de cada grupo.
//
//   produtos entregues  soma das quantidades dos pedidos JÁ ENTREGUES
//   quantidade de pedidos  todos os do período, menos os cancelados
//   solicitantes  quantos solicitantes distintos, entre os entregues
//
// Os recortes são diferentes de propósito: quem pergunta "quantos produtos
// entregamos" quer o que saiu daqui, e quem pergunta "quantos pedidos" quer o
// movimento do mês, inclusive o que ainda está na fila. Cancelado sai dos dois.
const totaisDoGrupo = pedidos => {
  const entregues = pedidos.filter(foiEntregue)
  const vivos = pedidos.filter(p => !foiCancelado(p))
  return {
    produtos: entregues.reduce((s, p) => s + p.quantidade, 0),
    pedidos: vivos.length,
    solicitantes: new Set(entregues.map(p => p.solicitante)).size
  }
}

// 3.1: as sete linhas do modelo, na ordem dele.
//
// As duas linhas de Extra-PIT são um SUBCONJUNTO das de Mapoteca (pedido
// militar com previsto_pit = false), e não um terceiro grupo a somar. É assim
// no modelo também: em julho/2026 a Mapoteca soma 476 produtos e o Extra-PIT
// aparece com 0, dentro daqueles 476.
const montarTotaisMapoteca = ({ pedidosMes, pedidosAno }) => {
  const grupo = (pedidos, filtro) => totaisDoGrupo(pedidos.filter(filtro))

  const militar = p => ehMilitar(p)
  const civil = p => !ehMilitar(p)
  const extraPit = p => ehMilitar(p) && p.previsto_pit === false

  const mesMil = grupo(pedidosMes, militar)
  const anoMil = grupo(pedidosAno, militar)
  const mesCiv = grupo(pedidosMes, civil)
  const anoCiv = grupo(pedidosAno, civil)
  const mesExtra = grupo(pedidosMes, extraPit)
  const anoExtra = grupo(pedidosAno, extraPit)

  return [
    ['Mapoteca - produtos entregues', numero(mesMil.produtos), numero(anoMil.produtos)],
    ['Mapoteca - quantidade de pedidos', numero(mesMil.pedidos), numero(anoMil.pedidos)],
    ['Mapoteca - OM atendidas', numero(mesMil.solicitantes), numero(anoMil.solicitantes)],
    ['LAI e órgãos públicos - produtos entregues', numero(mesCiv.produtos), numero(anoCiv.produtos)],
    ['LAI e órgãos públicos - quantidade de pedidos', numero(mesCiv.pedidos), numero(anoCiv.pedidos)],
    ['Extra-PIT - produtos entregues', numero(mesExtra.produtos), numero(anoExtra.produtos)],
    ['Extra-PIT - número de solicitações', numero(mesExtra.pedidos), numero(anoExtra.pedidos)]
  ]
}

// 3.2: uma linha por pedido militar do mês.
const montarEntregasMapoteca = ({ pedidosMes }) =>
  pedidosMes.filter(ehMilitar).map(p => [
    texto(p.solicitante),
    texto(documentoExibicao(p)),
    numero(p.quantidade),
    texto(p.situacao)
  ])

// 3.3: o pedido militar fora do PIT. O "Demandante" é quem ENCAMINHOU (o CMS
// encaminhando pedido do 18º BI Mtz), e cai no solicitante quando não há.
const montarExtraPit = ({ pedidosMes }) =>
  pedidosMes
    .filter(p => ehMilitar(p) && p.previsto_pit === false)
    .map(p => [
      texto(p.demandante || p.solicitante),
      texto(p.tipos_produto.join(', ')),
      numero(p.quantidade),
      texto(p.situacao),
      texto(p.documento_solicitacao || p.documento_solicitacao_nup),
      texto(p.observacao)
    ])

// 3.4: cliente civil, órgão público e LAI. SEM coluna de quantidade, como o
// modelo: o que se acompanha aqui é o atendimento, não o volume impresso.
const montarLai = ({ pedidosMes }) =>
  pedidosMes.filter(p => !ehMilitar(p)).map(p => [
    texto(p.solicitante),
    texto(documentoExibicao(p)),
    texto(p.situacao)
  ])

// ---------------------------------------------------------------------------
// 4.1 a 4.7 - orçamento
// ---------------------------------------------------------------------------

// Primeiro e último dia do recorte, em ISO 'YYYY-MM-DD', montados a partir dos
// componentes numéricos (sem objeto Date) para não escorregar de fuso. O
// RPCMTec do orçamento é sempre ACUMULADO no ano até o mês de corte: a pergunta
// é "quanto do crédito do ano já foi executado", e não "quanto se moveu em
// julho".
const recorteDoAno = (ano, mes) => {
  const ultimoDia = new Date(ano, mes, 0).getDate()
  const dois = n => String(n).padStart(2, '0')
  return { inicio: `${ano}-01-01`, cutoff: `${ano}-${dois(mes)}-${dois(ultimoDia)}` }
}

// 4.1: uma linha por natureza de despesa do domínio, na ordem do código.
//
// TODAS as colunas são da classificação PDR: o Extra-PDR tem subseção própria
// (4.7), e misturar os dois aqui faria o "recebido" desta tabela não fechar com
// a soma da 4.2. O previsto vem do PDR autorizado do ano (`pdr_item`), fora do
// recorte de data porque ele é do exercício inteiro.
//
// SUM sem COALESCE nas colunas de fluxo, e é deliberado: NULO quer dizer "não
// há documento nenhum nesta ND", e sai '-'; 0 quer dizer "há, e somam zero", e
// sai '0,00'. É a distinção que o modelo faz na 4.1 de julho/2026, onde a ND
// 339040 aparece com '-' e a 339047 com '0,00'.
const gerarExecucaoPorNd = async (ano, inicio, cutoff) => {
  const linhas = await db.conn.any(
    `SELECT
       nd.code AS cod_nd,
       COALESCE((
         SELECT SUM(pi.valor_autorizado)
         FROM orcamento.pdr_item AS pi
         WHERE pi.ano = $<ano> AND pi.cod_nd = nd.code
       ), 0) AS previsto,
       (
         SELECT SUM(nc.valor_nc)
         FROM orcamento.nota_credito AS nc
         WHERE nc.ano = $<ano> AND nc.classificacao_id = $<pdr> AND nc.cod_nd = nd.code
           AND (nc.data_emissao IS NULL
                OR (nc.data_emissao >= $<inicio> AND nc.data_emissao <= $<cutoff>))
       ) AS recebido,
       (
         SELECT SUM(ne.valor_empenhado - ne.valor_anulado)
         FROM orcamento.nota_empenho AS ne
         INNER JOIN orcamento.nota_credito AS ncne ON ncne.id = ne.nota_credito_id
         WHERE ncne.cod_nd = nd.code AND ncne.classificacao_id = $<pdr> AND ne.ano = $<ano>
           AND (ne.data_empenho IS NULL
                OR (ne.data_empenho >= $<inicio> AND ne.data_empenho <= $<cutoff>))
       ) AS empenhado,
       (
         SELECT SUM(lq.valor_liquidado)
         FROM orcamento.liquidacao AS lq
         INNER JOIN orcamento.nota_empenho AS ne ON ne.id = lq.nota_empenho_id
         INNER JOIN orcamento.nota_credito AS ncne ON ncne.id = ne.nota_credito_id
         WHERE ncne.cod_nd = nd.code AND ncne.classificacao_id = $<pdr> AND ne.ano = $<ano>
           AND (lq.data IS NULL OR (lq.data >= $<inicio> AND lq.data <= $<cutoff>))
       ) AS liquidado,
       (
         SELECT SUM(nc.valor_recolhido)
         FROM orcamento.nota_credito AS nc
         WHERE nc.ano = $<ano> AND nc.classificacao_id = $<pdr> AND nc.cod_nd = nd.code
           AND (nc.data_emissao IS NULL
                OR (nc.data_emissao >= $<inicio> AND nc.data_emissao <= $<cutoff>))
       ) AS recolhido
     FROM dominio.natureza_despesa AS nd
     ORDER BY nd.code`,
    { ano, inicio, cutoff, pdr: CLASSIFICACAO_NC.PDR }
  )

  return linhas.map(l => [
    texto(l.cod_nd),
    decimal(l.previsto),
    decimal(l.recebido),
    decimal(l.empenhado),
    decimal(l.liquidado),
    decimal(l.recolhido)
  ])
}

// 4.2 (PDR) e 4.7 (Extra-PDR): mesma consulta, mudando só a classificação.
//
// Empenhado e liquidado por NC saem da junção NE-NC
// (`orcamento.nota_empenho_nota_credito`): uma NE pode ser coberta por várias
// NCs, e o valor empenhado é dividido entre elas. Como a liquidação é por NE
// (total), aqui ela é RATEADA por NC na proporção da alocação
// (enc.valor / ne.valor_empenhado); o anulado também. Para NE de uma NC só o
// rateio é a identidade.
const gerarCreditosRecebidos = async (ano, inicio, cutoff, classificacaoId) => {
  const linhas = await db.conn.any(
    `SELECT
       nc.numero AS nc,
       (
         SELECT STRING_AGG(ne.numero, ', ' ORDER BY ne.numero)
         FROM orcamento.nota_empenho_nota_credito AS enc
         INNER JOIN orcamento.nota_empenho AS ne ON ne.id = enc.nota_empenho_id
         WHERE enc.nota_credito_id = nc.id
       ) AS ne,
       nc.cod_nd,
       nc.finalidade_historico AS finalidade,
       nc.valor_nc,
       nc.valor_recolhido,
       ROUND(COALESCE((
         SELECT SUM(enc.valor * (ne.valor_empenhado - ne.valor_anulado) / ne.valor_empenhado)
         FROM orcamento.nota_empenho_nota_credito AS enc
         INNER JOIN orcamento.nota_empenho AS ne ON ne.id = enc.nota_empenho_id
         WHERE enc.nota_credito_id = nc.id
           AND (ne.data_empenho IS NULL
                OR (ne.data_empenho >= $<inicio> AND ne.data_empenho <= $<cutoff>))
       ), 0), 2) AS valor_empenhado,
       ROUND(COALESCE((
         SELECT SUM(
           (enc.valor / ne.valor_empenhado) * COALESCE((
             SELECT SUM(lq.valor_liquidado)
             FROM orcamento.liquidacao AS lq
             WHERE lq.nota_empenho_id = ne.id
               AND (lq.data IS NULL OR (lq.data >= $<inicio> AND lq.data <= $<cutoff>))
           ), 0)
         )
         FROM orcamento.nota_empenho_nota_credito AS enc
         INNER JOIN orcamento.nota_empenho AS ne ON ne.id = enc.nota_empenho_id
         WHERE enc.nota_credito_id = nc.id
       ), 0), 2) AS valor_liquidado
     FROM orcamento.nota_credito AS nc
     WHERE nc.ano = $<ano>
       AND nc.classificacao_id = $<classificacaoId>
       AND (nc.data_emissao IS NULL
            OR (nc.data_emissao >= $<inicio> AND nc.data_emissao <= $<cutoff>))
     ORDER BY nc.data_emissao, nc.numero`,
    { ano, inicio, cutoff, classificacaoId }
  )

  // A ordem das colunas é a do modelo: o recolhido vem POR ÚLTIMO, depois do
  // liquidado, e não logo após o valor da NC.
  return linhas.map(l => [
    texto(l.nc),
    texto(l.ne),
    texto(l.cod_nd),
    texto(l.finalidade),
    decimal(l.valor_nc),
    decimal(l.valor_empenhado),
    decimal(l.valor_liquidado),
    decimal(l.valor_recolhido)
  ])
}

// 4.3: restos a pagar não processados carregados para o ano. O empenho é o
// rótulo gravado ("2025NE000001 (Secundária)"), com queda no número da NE.
const gerarRpnp = async ano => {
  const linhas = await db.conn.any(
    `SELECT
       COALESCE(r.empenho_label, ne.numero) AS empenho,
       r.finalidade,
       r.valor_empenhado,
       r.valor_a_liquidar
     FROM orcamento.rpnp AS r
     LEFT JOIN orcamento.nota_empenho AS ne ON ne.id = r.nota_empenho_id
     WHERE r.ano = $<ano>
     ORDER BY r.id`,
    { ano }
  )

  return linhas.map(l => [
    texto(l.empenho),
    texto(l.finalidade),
    moeda(l.valor_empenhado),
    moeda(l.valor_a_liquidar)
  ])
}

// 4.4 (GCALC DSG) e 4.5 (demais licitações da atividade-fim).
const gerarLicitacoes = async (ano, tipoId) => {
  const linhas = await db.conn.any(
    `SELECT l.objeto, l.fase_atual, l.valor_total_estimado, l.valor_final_homologado
     FROM orcamento.licitacao AS l
     WHERE l.ano = $<ano> AND l.tipo_id = $<tipoId>
     ORDER BY l.id`,
    { ano, tipoId }
  )

  return linhas.map(l => [
    texto(l.objeto),
    texto(l.fase_atual),
    moeda(l.valor_total_estimado),
    moeda(l.valor_final_homologado)
  ])
}

// 4.6: o ano é o `ano_referencia` do recebimento (quando o material chegou),
// com queda no ano da NE. Assim, item de RPNP (empenho de ano anterior) recebido
// neste ano consta na 4.6 do ano do RECEBIMENTO, e não do empenho.
const gerarRecebimentoMaterial = async ano => {
  const linhas = await db.conn.any(
    `SELECT ne.numero AS empenho, rm.material, rm.prazo_entrega, rm.situacao
     FROM orcamento.recebimento_material AS rm
     INNER JOIN orcamento.nota_empenho AS ne ON ne.id = rm.nota_empenho_id
     WHERE COALESCE(rm.ano_referencia, ne.ano) = $<ano>
     ORDER BY rm.id`,
    { ano }
  )

  return linhas.map(l => [
    texto(l.empenho),
    texto(l.material),
    texto(l.prazo_entrega),
    texto(l.situacao)
  ])
}

// ---------------------------------------------------------------------------
// 7.2 e 7.3 - insumos de impressão
// ---------------------------------------------------------------------------

// A separação entre papel (7.2) e tinta (7.3) sai de
// `mapoteca.tipo_material.categoria`, uma COLUNA, e não do nome do material.
// Derivar de "começa com Cartucho" funcionaria hoje e quebraria calado no dia em
// que alguém cadastrar "Tinta preta 300ml": a tabela erraria de lado sem erro
// nenhum. Ver migrations/2026-08-01_material_categoria.sql.
//
// LACUNA CONHECIDA, e é do SCA, não desta tela: "Estoque mês anterior" sai '-'
// porque `mapoteca.estoque_material` guarda só o saldo de HOJE, sem histórico.
// Ele NÃO é derivável de estoque atual + consumo do mês: a conta ignora as
// entradas (compra, transferência do almoxarifado), e erraria em silêncio todo
// mês em que houve reposição. "Previsão de falta de estoque" sai '-' pelo mesmo
// motivo: sem série histórica não há ritmo de consumo para projetar.
const montarInsumos = ({ tiposMaterial, consumoAno, mes, categoria }) => {
  const consumoDoMes = consumoAno.reduce((mapa, linha) => {
    if (Number(linha.mes) === Number(mes)) {
      mapa[linha.tipo_material_id] = Number(linha.quantidade)
    }
    return mapa
  }, {})

  return tiposMaterial
    .filter(tm => tm.ativo && tm.categoria_id === categoria)
    .map(tm => [
      texto(tm.nome),
      numero(Number(tm.estoque_total)),
      '-',
      numero(consumoDoMes[tm.id] || 0),
      '-'
    ])
}

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

/**
 * Monta o RPCMTec do mês, seção a seção.
 *
 * @param {Object} params
 * @param {number} params.ano
 * @param {number} params.mes - 1 a 12
 * @returns {Promise<Object>} { ano, mes, secoes: [{ titulo, subsecoes: [...] }] }
 */
controller.gerar = async ({ ano, mes }) => {
  const { inicio, cutoff } = recorteDoAno(ano, mes)

  const [
    situacaoGeral,
    produtosMes,
    produtosAno,
    pedidosMes,
    pedidosAno,
    tiposMaterial,
    consumoAno,
    execucaoPorNd,
    creditosPdr,
    rpnp,
    licitacoesGcalc,
    licitacoesProprias,
    recebimentoMaterial,
    creditosExtraPdr
  ] = await Promise.all([
    integracaoCtrl.getSituacaoGeral({}),
    integracaoCtrl.getProdutosFinalizados({ ano, mes, cumulativo: false }),
    integracaoCtrl.getProdutosFinalizados({ ano, mes, cumulativo: true }),
    buscarPedidos({ ano, mes, cumulativo: false }),
    buscarPedidos({ ano, mes, cumulativo: true }),
    mapotecaCtrl.getTiposMaterial(),
    mapotecaCtrl.getConsumoMensalPorTipo(ano),
    gerarExecucaoPorNd(ano, inicio, cutoff),
    gerarCreditosRecebidos(ano, inicio, cutoff, CLASSIFICACAO_NC.PDR),
    gerarRpnp(ano),
    gerarLicitacoes(ano, TIPO_LICITACAO.GCALC_DSG),
    gerarLicitacoes(ano, TIPO_LICITACAO.PROPRIA),
    gerarRecebimentoMaterial(ano),
    gerarCreditosRecebidos(ano, inicio, cutoff, CLASSIFICACAO_NC.EXTRA_PDR)
  ])

  const colunasCredito = ['NC', 'NE', 'ND', 'Finalidade', 'Valor NC',
    'Valor Empenhado', 'Valor Liquidado', 'Valor Recolhido']
  const colunasLicitacao = ['Objeto da Licitação', 'Fase Atual',
    'Valor Total Estimado da Licitação', 'Valor Final Homologado']
  const colunasInsumo = ['Insumo', 'Estoque atual', 'Estoque mês anterior',
    'Consumo no mês', 'Previsão de falta de estoque']

  const secoes = [
    {
      titulo: '2. EXECUÇÃO DO PIT',
      subsecoes: [
        {
          numero: '2.2',
          titulo: 'Totais do Mês e do Ano',
          cabecalhos: ['Tipo de produto', 'Quantidade no mês', 'Quantidade no ano'],
          linhas: montarTotaisPorTipo({ produtosMes, produtosAno })
        },
        {
          numero: '2.4',
          titulo: 'Entregas detalhada de produtos finais (BDGEx, IGW, EBGeo) no mês',
          cabecalhos: ['Tipo produto', 'Escala', 'UUID BDGEx', 'Identificador',
            'Meta PIT', 'Lote SAP'],
          linhas: montarEntregasDetalhadas({ produtosMes })
        },
        {
          numero: '2.7',
          titulo: 'Estado do Acervo',
          cabecalhos: ['Escala', 'Tipo de produto', 'Total catalogado',
            'Catalogo no mês', 'Universo da ASC', '% da ASC'],
          linhas: montarEstadoAcervo({ situacaoGeral, produtosMes })
        }
      ]
    },
    {
      titulo: '3. MAPOTECA',
      subsecoes: [
        {
          numero: '3.1',
          titulo: 'Totais do Mês e do Ano',
          cabecalhos: ['Indicador', 'Total no mês', 'Total no ano'],
          linhas: montarTotaisMapoteca({ pedidosMes, pedidosAno })
        },
        {
          numero: '3.2',
          titulo: 'Entregas da mapoteca',
          cabecalhos: ['Solicitante', 'Documento de solicitação', 'Quantidade', 'Situação'],
          linhas: montarEntregasMapoteca({ pedidosMes })
        },
        {
          numero: '3.3',
          titulo: 'Extra-PIT',
          cabecalhos: ['Demandante', 'Tipo de produto', 'Qtd', 'Situação',
            'Documento autorização', 'Descrição'],
          linhas: montarExtraPit({ pedidosMes })
        },
        {
          numero: '3.4',
          titulo: 'LAI e atendimento à órgãos públicos',
          cabecalhos: ['Solicitante', 'Documento de solicitação', 'Situação'],
          linhas: montarLai({ pedidosMes })
        }
      ]
    },
    {
      titulo: '4. EXECUÇÃO DO PDR',
      subsecoes: [
        {
          numero: '4.1',
          titulo: 'Execução por ND',
          cabecalhos: ['ND', 'Valor previsto (Prioridade 1)', 'Valor recebido',
            'Valor empenhado', 'Valor liquidado total', 'Valor Recolhido'],
          linhas: execucaoPorNd
        },
        {
          numero: '4.2',
          titulo: 'Situação dos créditos recebidos',
          cabecalhos: colunasCredito,
          linhas: creditosPdr
        },
        {
          numero: '4.3',
          titulo: 'Situação RPNP',
          cabecalhos: ['Empenho', 'Finalidade', 'Valor Empenhado', 'Valor a liquidar'],
          linhas: rpnp
        },
        {
          numero: '4.4',
          titulo: 'GCALC DSG',
          cabecalhos: colunasLicitacao,
          linhas: licitacoesGcalc
        },
        {
          numero: '4.5',
          titulo: 'Demais Licitações da atividade-fim',
          cabecalhos: colunasLicitacao,
          linhas: licitacoesProprias
        },
        {
          numero: '4.6',
          titulo: 'Recebimento de material',
          cabecalhos: ['Empenho', 'Material', 'Prazo de entrega', 'Situação'],
          linhas: recebimentoMaterial
        },
        {
          numero: '4.7',
          titulo: 'Situação de créditos Extra-PDR',
          cabecalhos: colunasCredito,
          linhas: creditosExtraPdr
        }
      ]
    },
    {
      titulo: '7. EQUIPAMENTO E MATERIAL',
      subsecoes: [
        {
          numero: '7.2',
          titulo: 'Estoque de Insumos de Impressão - Papel',
          cabecalhos: colunasInsumo,
          linhas: montarInsumos({
            tiposMaterial, consumoAno, mes, categoria: CATEGORIA_MATERIAL.PAPEL
          })
        },
        {
          numero: '7.3',
          titulo: 'Estoque de Insumos de Impressão - Tintas',
          cabecalhos: colunasInsumo,
          linhas: montarInsumos({
            tiposMaterial, consumoAno, mes, categoria: CATEGORIA_MATERIAL.TINTA
          })
        }
      ]
    }
  ]

  return { ano, mes, secoes }
}

module.exports = controller
