'use strict'

// O CÁLCULO das subseções do RPCMTec que o SCA sabe montar do banco.
//
// POR QUE FORA DOS MÓDULOS. O RPCMTec é o relatório mensal da DIVISÃO, e não de
// acervo, mapoteca ou orçamento: a mesma edição fala das três coisas, e o chefe
// assina uma só. Mesmo critério de `pit.meta`: dado de que nenhum módulo é dono
// mora fora deles.
//
// O QUE ESTE ARQUIVO É. Ele calcula LINHAS, e só. Quais subseções existem, com
// que título, cabeçalho e ordem, é o que `rpcmtec_estrutura.js` diz; quem junta
// o calculado com o que o gestor digitou é `rpcmtec_edicao_ctrl.js`.
//
// AS VINTE QUE SAEM DAQUI estão declaradas em `NUMEROS_CALCULADOS`, com a fonte
// de cada uma ao lado. As dez restantes são digitadas na própria tela.
//
// A 2.2 e a 2.4 entraram em 2026-08-05: elas reportam a produção do mês, que o
// acervo sabe contar, e estavam digitadas com fonte 'SAP' sem precisar. A 2.3
// (lote) e a 2.5 (campo) continuam digitadas, e a diferença é real: aquelas duas
// são do SAP e não têm entidade no SCA que as prove.
//
// A 2.1 sai INTEIRA daqui, inclusive as metas de produção, que hoje só têm
// número se alguém lançar à mão. Uma tabela montada metade de um sistema e
// metade de outro obrigaria quem a lê a descobrir todo mês quais linhas vêm de
// onde.
//
// AS TRÊS LINHAS DE TOTAL DA 2.6 não saem. No modelo elas ficam abaixo da
// tabela, com o rótulo ocupando três colunas mescladas, e o desenhador não tem
// rodapé de tabela. Emiti-las como linha comum daria um total alinhado errado,
// que é pior do que não ter: quem confere veria a tabela como se estivesse
// formatada, e ela não estaria.
//
// A CÉLULA SAI EM TEXTO, já formatada, e é assim que a tela e o PDF a recebem.
// Com a tela lendo número cru e o arquivo formatando por conta, as duas divergem
// no arredondamento. É também o que se congela no fechamento: o que o documento
// DISSE.

const { db } = require('../database')
const acervoCtrl = require('../acervo/acervo_ctrl')
const mapotecaCtrl = require('../mapoteca/mapoteca_ctrl')
// O PIT é dado de PLATAFORMA, e não de módulo: o gerador o lê como lê o acervo e
// a mapoteca. Sem ciclo, porque `pit/` não conhece o RPCMTec.
const pitExecucaoCtrl = require('../pit/pit_execucao_ctrl')
const pitExtraCtrl = require('../pit/pit_extra_ctrl')
const efetivoCtrl = require('../efetivo/efetivo_ctrl')
const capacitacaoCtrl = require('./rpcmtec_capacitacao_ctrl')
const {
  domainConstants: {
    SITUACAO_PEDIDO,
    TIPO_CLIENTE,
    TIPO_LICITACAO,
    TIPO_PRODUTO,
    TIPO_VERSAO,
    CLASSIFICACAO_NC,
    CATEGORIA_MATERIAL,
    TIPO_CAPACITACAO
  }
} = require('../utils')
const {
  QTD_EFETIVA, JOIN_PRODUTO_ITEM, filtroPeriodoMes, filtroAno
} = require('../mapoteca/query_fragments')
// O mês anterior, virando o ano em janeiro. Mora em periodo.js porque a mesma
// regra vale para rpcmtec_subsecao_ctrl, e duas cópias divergiram uma vez.
const { mesAnterior } = require('./periodo')

const controller = {}

// Cliente militar (3.1 e 3.2) contra civil, órgão público e LAI (3.4).
const TIPOS_CLIENTE_MILITAR = [
  TIPO_CLIENTE.OM_EB,
  TIPO_CLIENTE.OM_AERONAUTICA,
  TIPO_CLIENTE.OM_MARINHA
]

// Situações que já foram entregues. Cancelado não é nem entregue nem pendente:
// não há mais nada a cobrar, então ele sai das duas contas.
const SITUACOES_ENTREGUE = [SITUACAO_PEDIDO.REMETIDO, SITUACAO_PEDIDO.CONCLUIDO]

// Universo de folhas da ASC (Área Sob Coordenação do 1º CGEO, 694.301 km²) por
// escala, o DENOMINADOR da 2.7. Fonte: RT 11/2025 (proposta de base contínua),
// com a correção do chefe da DGEO para a 1:100.000, que o RT registrava como
// 250 e são 249.
//
// O numerador vem de `limites.area_suprimento` (ver `buscarEstadoAcervo`): os
// dois TÊM de falar da mesma área, senão a fração não quer dizer nada.
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

// Os dois tipos que a 2.7 conta, na ordem do documento. O nome é o de
// `dominio.tipo_produto`, e é por ele que a consulta agrupa.
const TIPOS_ESTADO_ACERVO = [
  { nome: 'Carta Topográfica', tipoId: TIPO_PRODUTO.CARTA_TOPOGRAFICA },
  { nome: 'Carta Ortoimagem', tipoId: TIPO_PRODUTO.CARTA_ORTOIMAGEM }
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

// A 2.2 e a 2.4 PASSARAM A SAIR DAQUI em 2026-08-05. Elas eram digitadas com
// `fonte: 'SAP'`, e não precisavam ser: as duas reportam a versão REGULAR que
// ficou pronta no mês, e isso o acervo sabe sozinho. Ver as consultas logo
// abaixo de `buscarEstadoAcervo`.
//
// 2.7: folhas catalogadas DENTRO DA ASC, por escala x tipo de produto.
//
// O RECORTE PELA ASC é o que faz a coluna "% da ASC" dizer a verdade. Sem ele o
// numerador é o acervo INTEIRO, que guarda folha de fora da nossa área, e a
// conta passa de 100. Com o recorte, a 1:50.000 e a 1:250.000 fecham EXATAMENTE
// com o universo do RT 11/2025, e é essa coincidência que prova que o polígono
// está certo.
//
// ST_Intersects, e não "centro dentro da área": pelo centro
// (`ST_PointOnSurface`) a folha de borda fica de fora e a contagem não fecha.
// Folha que TOCA a ASC é folha da ASC.
//
// "Catalogado" exige versão REGULAR, o mesmo critério da cobertura do acervo: o
// Registro Histórico documenta que uma edição existiu e por definição não tem
// arquivo, e contá-lo pintaria de pronta uma folha que ninguém pode baixar.
//
// A CONTAGEM DO MÊS usa o MESMO recorte: numa linha cujo total é da ASC, um "no
// mês" que contasse folha de fora não fecharia com a coluna ao lado.
const buscarEstadoAcervo = async ({ ano, mes }) => {
  return db.conn.any(
    `
    WITH area AS (
      SELECT geom FROM limites.area_suprimento WHERE e_1cgeo
    )
    SELECT
      te.nome AS escala,
      tp.nome AS tipo_produto,
      COUNT(DISTINCT prod.mi)::int AS catalogado,
      COUNT(DISTINCT prod.mi) FILTER (
        WHERE ${filtroPeriodoMes('v.data_edicao', { cumulativo: false })}
      )::int AS no_mes
    FROM acervo.produto prod
    JOIN acervo.versao v ON v.produto_id = prod.id AND v.tipo_versao_id = $<versaoRegular>
    JOIN dominio.tipo_escala te ON te.code = prod.tipo_escala_id
    JOIN dominio.tipo_produto tp ON tp.code = prod.tipo_produto_id
    WHERE prod.mi IS NOT NULL
      AND prod.tipo_escala_id IN ($<escalas:csv>)
      AND prod.tipo_produto_id IN ($<tipos:csv>)
      AND EXISTS (SELECT 1 FROM area a WHERE ST_Intersects(prod.geom, a.geom))
    GROUP BY te.nome, tp.nome
    `,
    {
      ano,
      mes,
      versaoRegular: TIPO_VERSAO.REGULAR,
      escalas: acervoCtrl.SITUACAO_GERAL_ESCALAS.map(e => e.id),
      tipos: TIPOS_ESTADO_ACERVO.map(t => t.tipoId)
    }
  )
}

// ---------------------------------------------------------------------------
// 2.2 e 2.4: a produção do mês, do ACERVO e não do SAP.
//
// AS DUAS ERAM DIGITADAS, com `fonte: 'SAP'`, e não precisavam ser: o que elas
// reportam é a versão REGULAR que ficou pronta no mês, e isso o acervo sabe
// sozinho desde sempre. Enquanto foram digitadas, o número do relatório e o do
// acervo podiam divergir sem nada acusar, que é o mesmo defeito que a grade do
// PIT tinha antes das origens calculadas.
//
// O CRITÉRIO É O MESMO DA 2.7 e o mesmo do PIT: versão REGULAR, no mês de
// `data_edicao`. O Registro Histórico documenta que uma edição existiu e por
// definição não tem arquivo; contá-lo pintaria de pronta uma folha que ninguém
// baixa. A versão Planejada, pela mesma razão, também fica de fora.
//
// A 2.3 e a 2.5 CONTINUAM DIGITADAS, e a diferença é real: lote e atividade de
// campo são do SAP e não têm entidade no SCA que as prove.

// 2.2: quantos produtos de cada tipo ficaram prontos no mês e no ano.
const buscarTotaisProducao = async ({ ano, mes }) => {
  return db.conn.any(
    `SELECT tp.nome AS tipo_produto,
            count(*) FILTER (
              WHERE ${filtroPeriodoMes('v.data_edicao', { cumulativo: false })}
            )::int AS no_mes,
            count(*)::int AS no_ano
     FROM acervo.versao AS v
     JOIN acervo.produto AS p ON p.id = v.produto_id
     JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
     WHERE v.tipo_versao_id = $<versaoRegular>
       AND ${filtroAno('v.data_edicao')}
     GROUP BY tp.nome
     ORDER BY tp.nome`,
    { ano, mes, versaoRegular: TIPO_VERSAO.REGULAR }
  )
}

const montarTotaisProducao = ({ totais }) =>
  totais.map(t => [t.tipo_produto, numero(t.no_mes), numero(t.no_ano)])

// 2.4: uma linha por folha entregue no mês, com o identificador que o BDGEx usa.
//
// O `uuid_versao` É O MESMO com que o produto é publicado no BDGEx, e por isso a
// coluna se chama "UUID BDGEx": não há um segundo identificador a guardar.
//
// A META sai do vínculo da versão, e nunca de código digitado. Vem em branco na
// folha que não cumpre meta (registro fora do plano, produção Extra-PIT), e isso
// é uma afirmação: o relatório distingue o que estava no plano do que não estava.
const buscarEntregasDetalhadas = async ({ ano, mes }) => {
  return db.conn.any(
    `SELECT tp.nome AS tipo_produto, te.nome AS escala,
            v.uuid_versao::text AS uuid_versao,
            COALESCE(p.mi, p.inom, p.nome) AS identificador,
            -- O CODIGO DO ITEM ('1.1'). O NULLIF para '-' era defesa contra um
            -- sentinela textual que o cadastro antigo gravava; pit.meta_item
            -- exige item NOT NULL, entao o COALESCE so cobre a versao SEM meta.
            -- (Sem crase neste comentario: template literal.)
            COALESCE(m.item, g.numero_meta::text) AS meta,
            l.pit AS lote
     FROM acervo.versao AS v
     JOIN acervo.produto AS p ON p.id = v.produto_id
     JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
     JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
     LEFT JOIN pit.meta_item AS m ON m.id = v.meta_pit_id
     LEFT JOIN pit.meta AS g ON g.id = m.meta_id
     LEFT JOIN acervo.lote AS l ON l.id = v.lote_id
     WHERE v.tipo_versao_id = $<versaoRegular>
       AND ${filtroPeriodoMes('v.data_edicao', { cumulativo: false })}
     ORDER BY tp.nome, te.code, identificador`,
    { ano, mes, versaoRegular: TIPO_VERSAO.REGULAR }
  )
}

const montarEntregasDetalhadas = ({ entregas }) =>
  entregas.map(e => [
    e.tipo_produto,
    // Sem o "1:", como o modelo escreve.
    String(e.escala || '').replace('1:', ''),
    e.uuid_versao,
    e.identificador || '-',
    e.meta || '-',
    e.lote || '-'
  ])

// O modelo escreve a escala sem o "1:" ("25.000"), e a ordem é tipo x escala:
// as quatro escalas da Carta Topográfica e depois as quatro da Carta Ortoimagem.
const montarEstadoAcervo = ({ estadoAcervo }) => {
  const linhas = []

  for (const tipo of TIPOS_ESTADO_ACERVO) {
    for (const escala of acervoCtrl.SITUACAO_GERAL_ESCALAS) {
      const escalaNome = ESCALA_NOME[escala.name]
      const achado = estadoAcervo.find(
        l => l.escala === escalaNome && l.tipo_produto === tipo.nome)

      const catalogado = achado ? achado.catalogado : 0
      const noMes = achado ? achado.no_mes : 0

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
// que a rota de integração de atendimentos, que só traz pedido já entregue,
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

// 3.1: os cinco indicadores que o SCA sabe apurar, na ordem do modelo.
//
// AS DUAS LINHAS DE EXTRA-PIT DO MODELO NÃO SAEM DAQUI. Derivá-las de
// `previsto_pit = false` dá número ERRADO: FALSE é o default da coluna e quase
// ninguém a preenche, então quase todo pedido contaria como Extra-PIT.
//
// O Extra-PIT do RPCMTec é a exceção AUTORIZADA (o modelo tem coluna "Documento
// autorização"), e quem a guarda é `pit.demanda_extra`. A subseção 3.3 sai de
// lá, e não daqui.
const montarTotaisMapoteca = ({ pedidosMes, pedidosAno }) => {
  const grupo = (pedidos, filtro) => totaisDoGrupo(pedidos.filter(filtro))

  const militar = p => ehMilitar(p)
  const civil = p => !ehMilitar(p)

  const mesMil = grupo(pedidosMes, militar)
  const anoMil = grupo(pedidosAno, militar)
  const mesCiv = grupo(pedidosMes, civil)
  const anoCiv = grupo(pedidosAno, civil)

  return [
    ['Mapoteca - produtos entregues', numero(mesMil.produtos), numero(anoMil.produtos)],
    ['Mapoteca - quantidade de pedidos', numero(mesMil.pedidos), numero(anoMil.pedidos)],
    ['Mapoteca - OM atendidas', numero(mesMil.solicitantes), numero(anoMil.solicitantes)],
    ['LAI e órgãos públicos - produtos entregues', numero(mesCiv.produtos), numero(anoCiv.produtos)],
    ['LAI e órgãos públicos - quantidade de pedidos', numero(mesCiv.pedidos), numero(anoCiv.pedidos)]
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

// 3.4: cliente civil, órgão público e LAI. SEM coluna de quantidade, como o
// modelo: o que se acompanha aqui é o atendimento, não o volume impresso.
//
// AS COLUNAS DIVERGEM DO MODELO, por decisão: saiu o "Documento de solicitação"
// e entraram o código da LAI e a descrição.
//
//   Código da LAI  o NUP do Fala.BR, que identifica a manifestação na Ouvidoria
//                  e é por onde se responde ao cidadão. Vive em
//                  `documento_solicitacao_nup`, separado do DIEx da DSG que
//                  encaminhou o pedido. Quem chegou por outro canal (e-mail,
//                  ofício) sai '-'.
//   Descrição      o que a pessoa pediu, de `pedido.observacao`.
//
// O DIEx saiu porque ele é o encaminhamento interno da DSG, e não identifica a
// manifestação: dois pedidos diferentes podem vir no mesmo DIEx, e é o NUP que
// os separa.
const montarLai = ({ pedidosMes }) =>
  pedidosMes.filter(p => !ehMilitar(p)).map(p => [
    texto(p.solicitante),
    texto(p.documento_solicitacao_nup),
    texto(p.observacao),
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
// `tipos` e uma LISTA: a 4.5 ("Demais Licitacoes da atividade-fim") recebe a
// propria E a participante. Participante nao tem subsecao propria, e sem ela na
// lista a licitacao participante cadastrada some do relatorio em silencio.
//
// A FASE SAI PELA MESMA REGRA DA TELA DE LICITACOES: o nome do codigo
// (`fase_id`) quando ele existe, e o texto livre (`fase_atual`) quando nao.
// `licitacao_ctrl.listar` devolve os dois e `licitacoes/list.js` escolhe assim.
//
// Ler so o `fase_atual` fazia a 4.4 contradizer a tela. Medicao de 2026-08-06
// na producao: a licitacao id 1 (2026, GCALC DSG, "licenciamento e fornecimento
// de imagens satelitais") tem `fase_id = 3` (Homologado) e `fase_atual =
// 'Renovando o contrato vigente'`. A tela mostrava "Homologado" e a 4.4
// mostrava "Renovando o contrato vigente", para a MESMA licitacao.
const gerarLicitacoes = async (ano, tipos) => {
  const linhas = await db.conn.any(
    `SELECT l.objeto,
            COALESCE(fl.nome, l.fase_atual) AS fase,
            l.valor_total_estimado, l.valor_final_homologado
     FROM orcamento.licitacao AS l
     LEFT JOIN dominio.fase_licitacao AS fl ON fl.code = l.fase_id
     WHERE l.ano = $<ano> AND l.tipo_id IN ($<tipos:csv>)
     ORDER BY l.id`,
    { ano, tipos }
  )

  return linhas.map(l => [
    texto(l.objeto),
    texto(l.fase),
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
// nenhum.
//
// O CONSUMO DO PAPEL sai da IMPRESSÃO, somado ao que for declarado à mão. Só de
// `mapoteca.consumo_material`, que quase ninguém preenche, a coluna sai zerada
// mesmo havendo milhares de exemplares impressos. Ver
// `getConsumoMensalPorTipo`, que soma as duas fontes.
//
// A TINTA continua vindo só do declarado, e é deliberado: quanto de cartucho
// uma folha gasta depende do que está desenhado nela. Zero ali quer dizer
// "ninguém declarou troca", que é diferente de errado.
//
// AS DUAS COLUNAS QUE PARECEM PEDIR TABELA NOVA, e não pedem:
//
//   "Estoque mês anterior"  vem da EDIÇÃO FECHADA do mês anterior, que
//                           congelou a própria 7.2. `estoque_material` guarda
//                           só o saldo de hoje, e derivá-lo de "atual mais
//                           consumo" ignoraria as ENTRADAS (compra,
//                           transferência) e erraria calado todo mês com
//                           reposição.
//   "Previsão de falta"     vem do ritmo dos meses JÁ FECHADOS.
//
// As duas continuam saindo '-' quando não há base: mês anterior não fechado, ou
// menos de três meses com consumo. Traço é a resposta honesta; número inventado
// a partir do saldo de hoje pareceria apurado e não seria.

/**
 * O ESTOQUE que a edição do mês anterior reportou, por nome de insumo.
 *
 * Ele NÃO sai de `mapoteca.estoque_material`, e não tem como sair: aquela
 * tabela guarda o saldo de HOJE, atualizado no lugar, e o saldo de maio é
 * irrecuperável de lá. Também não se deriva de "estoque atual mais consumo do
 * mês": a conta ignora as ENTRADAS (compra, transferência do almoxarifado) e
 * erraria em silêncio todo mês em que houve reposição.
 *
 * A resposta vem da EDIÇÃO FECHADA do mês anterior, que congelou a própria 7.2
 * no instante do fechamento. É a comparação que o relatório quer: "o que
 * reportamos no mês passado", e não "o que o banco acha que era".
 *
 * Sem edição fechada no mês anterior, devolve vazio e a coluna sai '-'. Isso é
 * deliberado e tem de continuar visível: inventar o número a partir do saldo de
 * hoje daria uma coluna que parece apurada e não é.
 */
const buscarEstoqueDoMesAnterior = async ({ ano, mes, numero }) => {
  const anterior = mesAnterior({ ano, mes })

  const gravada = await db.conn.oneOrNone(
    `SELECT s.linhas
     FROM rpcmtec.subsecao AS s
     INNER JOIN rpcmtec.edicao AS e ON e.id = s.edicao_id
     WHERE e.ano = $<ano> AND e.mes = $<mes>
       AND e.data_fechamento IS NOT NULL
       AND s.numero = $<numero>`,
    { ...anterior, numero }
  )

  const mapa = new Map()
  for (const linha of (gravada && gravada.linhas) || []) {
    // A linha congelada é [insumo, estoque atual, mês anterior, consumo,
    // previsão]. Casa-se pelo NOME porque é o que a linha guarda: o id do
    // material não vai para o documento, e não deveria ir.
    if (Array.isArray(linha) && linha.length >= 2) mapa.set(linha[0], linha[1])
  }
  return mapa
}

// Quantos meses COM CONSUMO bastam para projetar. Abaixo disso a média diz mais
// sobre o acaso do que sobre o ritmo, e a coluna sai '-'.
const MESES_MINIMOS_PARA_PROJETAR = 3

/**
 * Quando o estoque acaba, no ritmo dos últimos meses.
 *
 * Média dos meses que TIVERAM consumo, e não dos doze: dividir por doze num
 * ano que começou em março afundaria a média e empurraria a falta para longe.
 *
 * Devolve o mês no formato do documento ('NOV 26'), 'Sem estoque' quando já
 * zerou com consumo acontecendo, e '-' quando não há série que sustente a
 * conta.
 */
const projetarFalta = ({ estoque, consumoPorMes, ano, mes }) => {
  // Só os meses JÁ FECHADOS até o corte: o mês corrente ainda está andando, e
  // entrar com ele pela metade puxa a média para baixo.
  const meses = consumoPorMes
    .filter(l => Number(l.mes) < Number(mes) && Number(l.quantidade) > 0)
    .map(l => Number(l.quantidade))

  if (meses.length < MESES_MINIMOS_PARA_PROJETAR) return '-'

  const media = meses.reduce((soma, q) => soma + q, 0) / meses.length
  if (media <= 0) return '-'
  if (estoque <= 0) return 'Sem estoque'

  const mesesQueRestam = Math.floor(estoque / media)
  const alvo = new Date(ano, mes - 1 + mesesQueRestam, 1)
  return `${MESES_ABREV[alvo.getMonth()]} ${String(alvo.getFullYear()).slice(-2)}`
}

const montarInsumos = ({ tiposMaterial, consumoAno, mes, ano, categoria, estoqueAnterior }) => {
  const consumoDoMes = consumoAno.reduce((mapa, linha) => {
    if (Number(linha.mes) === Number(mes)) {
      mapa[linha.tipo_material_id] = Number(linha.quantidade)
    }
    return mapa
  }, {})

  return tiposMaterial
    .filter(tm => tm.ativo && tm.categoria_id === categoria)
    .map(tm => {
      const estoque = Number(tm.estoque_total)
      const doMaterial = consumoAno.filter(l => l.tipo_material_id === tm.id)

      return [
        texto(tm.nome),
        numero(estoque),
        // O que a edição fechada do mês anterior reportou. '-' quando aquele
        // mês não foi fechado.
        texto(estoqueAnterior.get(tm.nome)),
        numero(consumoDoMes[tm.id] || 0),
        projetarFalta({ estoque, consumoPorMes: doMaterial, ano, mes })
      ]
    })
}

// ---------------------------------------------------------------------------
// 2.1 Estado Atual do PIT
//
// A tabela sai INTEIRA daqui, inclusive as metas de produção. Elas hoje só têm
// número se alguém lançar à mão, porque o SCA não calcula produção -- e é essa a
// decisão do chefe enquanto o SAP não for absorvido. Metade da tabela vinda de
// um sistema e metade de outro seria pior: a 2.1 é UMA tabela, e quem a monta
// não deveria descobrir todo mês quais linhas colar de onde.
// ---------------------------------------------------------------------------

const MESES_ABREV = [
  'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'
]

// 'AGO 26', como o modelo escreve a previsão de término. O documento também traz
// '1º trim 2026' e 'Mensal' em algumas linhas, que são texto escrito à mão lá; o
// SCA guarda uma DATA, e é ela que sai.
//
// A string chega como 'AAAA-MM-DD' (o `prazo::text` da consulta), e é fatiada em
// vez de passada por `new Date()`: só-data parseada assim vira meia-noite UTC, e
// em UTC-3 o mês vira o anterior no dia 1º.
const formatPrazo = valor => {
  if (!valor) return '-'
  const [ano, mes] = String(valor).slice(0, 10).split('-')
  const indice = parseInt(mes, 10) - 1
  if (!MESES_ABREV[indice]) return '-'
  return `${MESES_ABREV[indice]} ${String(ano).slice(-2)}`
}

/**
 * Uma linha por ITEM do PIT, agrupada por meta.
 *
 * O rótulo da meta é escrito só na PRIMEIRA linha do bloco, como o documento
 * faz: repeti-lo em todas encheria a coluna mais estreita da tabela com o mesmo
 * texto.
 *
 * O RÓTULO SAI DE `nome`, e não mais de uma linha de cabeçalho. Enquanto o nome
 * do grupo era a `descricao` de uma linha de meta com `item` nulo, esta função
 * tinha de achar essa linha, separar os itens dela e ainda distinguir a meta
 * indivisa (que era a própria folha). Com `pit.meta.nome` os três casos viram
 * um: toda linha é um item, e o nome do grupo viaja nela.
 *
 * A `unidade` da meta NÃO sai. O modelo tem uma coluna "Quantidade" e nenhuma de
 * unidade, e enfiar 'carta' dentro do número faria a coluna deixar de ser
 * numérica. Ela existe para qualificar o número na TELA.
 */
const montarEstadoPit = ({ metas }) => {
  const porNumero = new Map()
  for (const m of metas) {
    if (!porNumero.has(m.numero_meta)) porNumero.set(m.numero_meta, [])
    porNumero.get(m.numero_meta).push(m)
  }

  const linhas = []
  const numerosOrdenados = [...porNumero.keys()].sort((a, b) => a - b)

  for (const numeroMeta of numerosOrdenados) {
    const daTabela = porNumero.get(numeroMeta)
    const nome = daTabela.length > 0 ? daTabela[0].nome : null

    const rotulo = nome ? `Meta ${numeroMeta} - ${nome}` : `Meta ${numeroMeta}`

    daTabela.forEach((m, i) => {
      linhas.push([
        i === 0 ? rotulo : '',
        texto(m.item),
        texto(m.descricao),
        numero(m.quantidade_prevista),
        numero(m.realizado_mes),
        numero(m.realizado),
        formatPrazo(m.prazo)
      ])
    })
  }

  return linhas
}

// ---------------------------------------------------------------------------
// 2.6 e 6.2: capacitação ministrada e recebida
// ---------------------------------------------------------------------------

// 'de 06/07/2026 a 10/07/2026', ou só a data quando não há término. Igual ao
// `prazo`, a string vem como 'AAAA-MM-DD' e é fatiada, sem passar por Date.
const formatDia = valor => {
  if (!valor) return null
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

const formatPeriodo = (inicio, fim) => {
  const a = formatDia(inicio)
  const b = formatDia(fim)
  if (!a) return '-'
  if (!b || b === a) return a
  return `de ${a} a ${b}`
}

const montarCapacitacaoMinistrada = ({ capacitacoes }) =>
  capacitacoes.map(c => [
    texto(c.nome),
    formatPeriodo(c.data_inicio, c.data_fim),
    texto(c.instituicoes),
    numero(c.efetivo_capacitado)
  ])

// 'Cap Fulano, 2º Sgt Beltrano'. Os nomes vêm do CADASTRO, e não de um texto
// digitado: `rpcmtec.capacitacao_militar` liga a capacitação a `dgeo.usuario`, e
// a coluna "Militar" do modelo é montada aqui.
//
// A 2.6 (ministrada) NÃO ganhou coluna de instrutor, embora o vínculo exista
// para ela também. O modelo tem quatro colunas naquela subseção, e quem
// ministrou é informação de gestão, não do documento: ela aparece na tela.
const nomesDosMilitares = c =>
  (c.militares || [])
    .map(m => `${m.posto_abrev} ${m.nome_guerra}`.trim())
    .join(', ')

const montarCapacitacaoRecebida = ({ capacitacoes }) =>
  capacitacoes.map(c => [
    texto(c.plano_codigo),
    texto(c.nome),
    texto(c.instituicoes),
    texto(nomesDosMilitares(c))
  ])

// ---------------------------------------------------------------------------
// 3.3 Extra-PIT
//
// É do ANO, e não do mês, ao contrário das vizinhas 3.1, 3.2 e 3.4. A demanda
// Extra-PIT é uma autorização que atravessa o ano e muda de situação; a edição
// de agosto que só mostrasse a autorizada em agosto esconderia as sete que
// continuam em produção.
// ---------------------------------------------------------------------------

const montarExtraPit = ({ demandas }) =>
  demandas.map(d => [
    texto(d.demandante),
    texto(d.tipo_produto),
    numero(d.quantidade),
    texto(d.situacao),
    texto(d.documento_autorizacao),
    texto(d.descricao)
  ])

// ---------------------------------------------------------------------------
// 6.1 Aproveitamento do efetivo
//
// A coluna "Atividades" é DERIVADA dos impedimentos, e não digitada: em texto
// livre a subseção não sabe dizer quanto do efetivo esteve disponível, que é a
// pergunta que ela existe para responder.
//
// A COLUNA DE PERCENTUAL É NOSSA, e não do modelo de 2026, que tem duas: uma
// tabela de aproveitamento sem o aproveitamento não responde nada. Quem cola no
// Word apaga a coluna se não quiser, o que é barato; recuperar um número que não
// saiu não é.
// ---------------------------------------------------------------------------

// 'Cap claude', que é como o documento nomeia a pessoa: posto abreviado mais
// nome de guerra.
const nomeMilitar = e => `${e.posto_abrev} ${e.nome_guerra}`.trim()

// 'Chefe do S5 (50%), LTSP (100%)'. Sem impedimento nenhum, a célula fica com o
// '-' do modelo, que é como ele escreve "não houve" -- e não vazia, que se lê
// como "ainda não preenchi".
const montarAproveitamento = ({ efetivo }) =>
  efetivo.map(e => {
    const impedimentos = (e.impedimentos || [])
      .map(i => `${i.descricao} (${i.percentual}%)`)
      .join(', ')

    // Quem passou o mês inteiro fora da Divisão não entra: a 6.1 é a lista de
    // quem esteve nela. Quem esteve parte do mês entra, com o percentual
    // dizendo quanto. QUEM RECORTA É A CONSULTA (`efetivoCtrl.resumoMensal` só
    // devolve quem tem passagem cruzando o mês), e não um filtro aqui.
    return [
      nomeMilitar(e),
      texto(impedimentos),
      `${Number(e.aproveitamento).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    ]
  })

// ---------------------------------------------------------------------------
// Orquestrador
// ---------------------------------------------------------------------------

/**
 * Calcula as subseções que o SCA monta do banco.
 *
 * Devolve um MAPA de número para linhas, e não o documento: quem sabe o título,
 * o cabeçalho e a ordem é `rpcmtec_estrutura.js`, e quem junta isto com o que o
 * gestor digitou é `rpcmtec_edicao_ctrl.js`.
 *
 * @param {Object} params
 * @param {number} params.ano
 * @param {number} params.mes - 1 a 12
 * @returns {Promise<Object>} { '2.1': [[celula, ...], ...], ... }
 */
controller.calcular = async ({ ano, mes }) => {
  const { inicio, cutoff } = recorteDoAno(ano, mes)

  const [
    estadoAcervo,
    totaisProducao,
    entregasDetalhadas,
    metasPit,
    capacitacaoMinistrada,
    pedidosMes,
    pedidosAno,
    demandasExtra,
    tiposMaterial,
    consumoAno,
    execucaoPorNd,
    creditosPdr,
    rpnp,
    licitacoesGcalc,
    licitacoesProprias,
    recebimentoMaterial,
    creditosExtraPdr,
    efetivo,
    capacitacaoRecebida,
    estoqueAnteriorPapel,
    estoqueAnteriorTinta
  ] = await Promise.all([
    buscarEstadoAcervo({ ano, mes }),
    // A 2.2 e a 2.4 saem do ACERVO desde 2026-08-05, e nao mais do SAP: as duas
    // reportam a versao Regular que ficou pronta no mes, que o acervo ja sabe.
    buscarTotaisProducao({ ano, mes }),
    buscarEntregasDetalhadas({ ano, mes }),
    // O `mes` recorta o acumulado: `realizado` vira janeiro até aqui, e
    // `realizado_mes`, só este mês. São as duas colunas da 2.1.
    pitExecucaoCtrl.resumoDoAno(ano, mes),
    capacitacaoCtrl.listarDoMes(ano, mes, TIPO_CAPACITACAO.MINISTRADA),
    buscarPedidos({ ano, mes, cumulativo: false }),
    buscarPedidos({ ano, mes, cumulativo: true }),
    // SÓ O MÊS, como a 3.4 ao lado. Enquanto era `listar(ano)`, a 3.3 de agosto
    // repetia tudo o que a de julho já reportara, e somar as doze edições
    // contaria cada demanda doze vezes.
    pitExtraCtrl.listarDoMes(ano, mes),
    mapotecaCtrl.getTiposMaterial(),
    mapotecaCtrl.getConsumoMensalPorTipo(ano),
    gerarExecucaoPorNd(ano, inicio, cutoff),
    gerarCreditosRecebidos(ano, inicio, cutoff, CLASSIFICACAO_NC.PDR),
    gerarRpnp(ano),
    gerarLicitacoes(ano, [TIPO_LICITACAO.GCALC_DSG]),
    gerarLicitacoes(ano, [TIPO_LICITACAO.PROPRIA, TIPO_LICITACAO.PARTICIPANTE]),
    gerarRecebimentoMaterial(ano),
    gerarCreditosRecebidos(ano, inicio, cutoff, CLASSIFICACAO_NC.EXTRA_PDR),
    efetivoCtrl.resumoMensal(ano, mes),
    capacitacaoCtrl.listarDoMes(ano, mes, TIPO_CAPACITACAO.RECEBIDA),
    // O estoque que a edição FECHADA do mês anterior reportou. É a única fonte
    // possível: `mapoteca.estoque_material` guarda o saldo de hoje, e o de maio
    // não existe mais lá.
    buscarEstoqueDoMesAnterior({ ano, mes, numero: '7.2' }),
    buscarEstoqueDoMesAnterior({ ano, mes, numero: '7.3' })
  ])

  return {
    '2.1': montarEstadoPit({ metas: metasPit }),
    '2.2': montarTotaisProducao({ totais: totaisProducao }),
    '2.4': montarEntregasDetalhadas({ entregas: entregasDetalhadas }),
    '2.6': montarCapacitacaoMinistrada({ capacitacoes: capacitacaoMinistrada }),
    '2.7': montarEstadoAcervo({ estadoAcervo }),
    '3.1': montarTotaisMapoteca({ pedidosMes, pedidosAno }),
    '3.2': montarEntregasMapoteca({ pedidosMes }),
    // A 3.3 sai de `pit.demanda_extra`, e nunca de `mapoteca.pedido`: o que o
    // relatório chama de Extra-PIT é a exceção AUTORIZADA, e o documento é
    // obrigatório na origem.
    '3.3': montarExtraPit({ demandas: demandasExtra }),
    '3.4': montarLai({ pedidosMes }),
    '4.1': execucaoPorNd,
    '4.2': creditosPdr,
    '4.3': rpnp,
    '4.4': licitacoesGcalc,
    '4.5': licitacoesProprias,
    '4.6': recebimentoMaterial,
    '4.7': creditosExtraPdr,
    '6.1': montarAproveitamento({ efetivo }),
    '6.2': montarCapacitacaoRecebida({ capacitacoes: capacitacaoRecebida }),
    '7.2': montarInsumos({
      tiposMaterial, consumoAno, mes, ano,
      categoria: CATEGORIA_MATERIAL.PAPEL,
      estoqueAnterior: estoqueAnteriorPapel
    }),
    '7.3': montarInsumos({
      tiposMaterial, consumoAno, mes, ano,
      categoria: CATEGORIA_MATERIAL.TINTA,
      estoqueAnterior: estoqueAnteriorTinta
    })
  }
}

module.exports = controller
