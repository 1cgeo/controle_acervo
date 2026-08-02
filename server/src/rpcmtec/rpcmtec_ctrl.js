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
//   2.1  Estado Atual do PIT             pit.meta e pit.execucao
//   2.6  Capacitações externas           rpcmtec.capacitacao, tipo Ministrada
//   2.7  Estado do Acervo                cobertura da ASC por escala x tipo
//   3.1  Totais do Mês e do Ano          mapoteca.pedido
//   3.2  Entregas da mapoteca            idem, uma linha por pedido militar
//   3.3  Extra-PIT                       pit.demanda_extra
//   3.4  LAI e órgãos públicos           idem, cliente civil
//   4.1  Execução por ND                 orçamento, classificação PDR
//   4.2  Situação dos créditos           idem
//   4.3  Situação RPNP                   orcamento.rpnp
//   4.4  GCALC DSG                       orcamento.licitacao, tipo 1
//   4.5  Demais licitações               idem, tipo 2
//   4.6  Recebimento de material         orcamento.recebimento_material
//   4.7  Créditos Extra-PDR              orçamento, classificação Extra-PDR
//   6.1  Aproveitamento do efetivo      dgeo.efetivo_periodo e dgeo.impedimento
//   6.2  Capacitação do efetivo         rpcmtec.capacitacao, tipo Recebida
//   7.2  Insumos de impressão, papel     mapoteca.tipo_material
//   7.3  Insumos de impressão, tintas    idem
//
// O QUE ENTROU EM 2026-08-02, e por quê. A 2.1, a 2.6, a 3.3, a 6.1 e a 6.2
// tinham dono no SAP, num dado que NÃO depende da produção: Extra-PIT, meta não
// calculada, efetivo e capacitação se cadastram à mão, e nenhum deles lê
// `macrocontrole`. É o critério que tirou `limites` do acervo em 2026-07-29 e
// `pit.meta` do orçamento em 2026-07-31, aplicado entre SISTEMAS. Nada saiu do
// SAP (decisão do chefe): lá as tabelas continuam, e o que impede as duas
// cópias de brigarem é o SCA passar a ser quem GERA estas subseções.
//
// A 2.1 sai INTEIRA daqui, inclusive as metas de produção, que hoje só têm
// número se alguém lançar à mão. Uma tabela montada metade de um sistema e
// metade de outro obrigaria quem a cola a descobrir todo mês quais linhas vêm
// de onde.
//
// FICAM DE FORA, com o motivo, para ninguém procurar o que não existe:
//   2.2  Totais do Mês e do Ano  decisão do chefe em 2026-08-01: por enquanto
//                                não vem do SCA.
//   2.4  Entregas detalhada      idem.
//   2.3  Execução por Lote       o SCA conta os produtos do lote, mas não tem
//                                operador nem percentual concluído.
//   2.5  Atividades de campo     não há tabela de atividade de campo. É a única
//                                das cinco do SAP que não veio junto, porque
//                                `controle_campo` aponta `macrocontrole.produto`.
//   5.   Desenvolvimento e TI    vem do painel do GitHub e do backup.
//   7.1  Equipamento indisponível  não há cadastro de equipamento técnico.
//   8.   Divulgação              não há cadastro de publicação em BI.
//   9.   Boas práticas           é texto do chefe, não dado.
//
// AS TRÊS LINHAS DE TOTAL DA 2.6 não saem. No modelo elas ficam abaixo da
// tabela, com o rótulo ocupando três colunas mescladas, e o desenhador daqui
// não tem rodapé de tabela. Emiti-las como linha comum daria um total alinhado
// errado, que é pior do que não ter: quem confere veria a tabela como se
// estivesse formatada, e ela não estaria.
//
// O MESMO OBJETO alimenta a tela e o arquivo. `gerar()` devolve as subseções já
// com as células em texto, e o DOCX só as desenha. Foi assim de propósito: com
// a tela lendo números crus e o arquivo formatando por conta, as duas divergiam
// no arredondamento, e quem conferia o DOCX contra a tela via diferença onde
// não havia.

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
const { QTD_EFETIVA, JOIN_PRODUTO_ITEM, filtroPeriodoMes } = require('../mapoteca/query_fragments')

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
// confirmado pelo chefe da DGEO em 2026-07-01 (o RT registrava 250 para
// 1:100.000; o valor correto é 249).
//
// O numerador vem de `limites.area_suprimento` (ver buscarEstadoAcervo): os dois
// TÊM de falar da mesma área, senão a fração não quer dizer nada. Que falam está
// medido -- a 1:50.000 e a 1:250.000 dão exatamente 927 e 49, os números desta
// tabela.
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

// A 2.2 (Totais do Mês e do Ano) e a 2.4 (Entregas detalhada de produtos
// finais) NÃO saem daqui, por decisão do chefe em 2026-08-01: por enquanto elas
// não vêm do SCA. Elas chegaram a existir, e mediam `acervo.versao` por
// `data_edicao`; o que as tirou foi o escopo, não defeito.
//
// 2.7: folhas catalogadas DENTRO DA ASC, por escala x tipo de produto.
//
// O RECORTE PELA ASC é o que faz a coluna "% da ASC" dizer a verdade. Sem ele o
// numerador era o acervo INTEIRO, que guarda folha de fora da nossa área, e a
// conta passava de 100: medido em 2026-08-01 contra produção, a 1:50.000 Carta
// Topográfica dava 943 sobre 927, ou seja 101,7%. Com o recorte ela dá 927 sobre
// 927 e a 1:250.000 dá 49 sobre 49 -- os dois fecham EXATAMENTE com o universo
// do RT 11/2025, e é essa coincidência que prova que o polígono está certo.
//
// ST_Intersects, e não "centro dentro da área": medido, o centro
// (ST_PointOnSurface) devolve 43 na 1:250.000 contra as 49 do universo, porque a
// folha de borda tem o centro fora. Folha que TOCA a ASC é folha da ASC.
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
// AS DUAS LINHAS DE EXTRA-PIT DO MODELO NÃO SAEM DAQUI, e a subseção 3.3
// (Extra-PIT) também não. Elas existiram por algumas horas em 2026-08-01,
// derivadas de `previsto_pit = false`, e estavam ERRADAS: medido contra
// produção, 142 dos 158 pedidos têm esse campo falso, porque FALSE é o default
// da coluna e quase ninguém o preenche. A 3.3 saía com 23 pedidos em julho
// onde a edição real traz 1, e esta tabela dizia 485 produtos Extra-PIT onde a
// real diz 0.
//
// O Extra-PIT do RPCMTec é uma exceção autorizada -- o modelo tem coluna
// "Documento autorização" --, e o SCA não guarda o que a distingue de um pedido
// comum fora do PIT. Enquanto não guardar, a 3.3 continua sendo escrita à mão, e
// a tela declara isso na lista de lacunas. Decisão do chefe em 2026-08-01.
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
// AS COLUNAS SÃO AS DO CHEFE (2026-08-01), e não as três do modelo. Saiu o
// "Documento de solicitação" e entraram o código da LAI e a descrição:
//
//   Código da LAI  o NUP do Fala.BR ('60143.003284/2026-31'), que identifica a
//                  manifestação na Ouvidoria e é por onde se responde ao
//                  cidadão. Vive em `documento_solicitacao_nup`, separado do
//                  DIEx da DSG que encaminhou o pedido. Em produção, 27 dos 33
//                  pedidos civis o têm; quem chegou por outro canal (e-mail,
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
// 2.1 Estado Atual do PIT
//
// Entrou em 2026-08-02, quando `pit.meta` passou a guardar o que o PIT PROMETE
// (quantidade e prazo) e nasceu `pit.execucao`. Até então esta subseção ficava
// de fora por falta das duas coisas, e não por falta de tabela.
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
 * Uma linha por meta-FOLHA, agrupada por meta.
 *
 * O rótulo da meta é escrito só na PRIMEIRA linha do bloco, como o documento
 * faz: repeti-lo em todas encheria a coluna mais estreita da tabela com o mesmo
 * texto.
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
    const doGrupo = porNumero.get(numeroMeta)
    const cabecalho = doGrupo.find(m => m.item === null)
    const itens = doGrupo.filter(m => m.item !== null)

    // Meta subdividida: as linhas são os ITENS, e o nome da meta vira o rótulo
    // do bloco. Meta indivisa: a própria linha de cabeçalho é a folha, e a
    // descrição dela é o produto -- pô-la também no rótulo a escreveria duas
    // vezes na mesma linha.
    const subdividida = itens.length > 0
    const daTabela = subdividida ? itens : doGrupo.filter(m => m.folha)

    const rotulo = subdividida && cabecalho && cabecalho.descricao
      ? `Meta ${numeroMeta} - ${cabecalho.descricao}`
      : `Meta ${numeroMeta}`

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

const montarCapacitacaoRecebida = ({ capacitacoes }) =>
  capacitacoes.map(c => [
    texto(c.plano_codigo),
    texto(c.nome),
    texto(c.instituicoes),
    texto(c.militares)
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
// A coluna "Atividades" do modelo de 2026 é DERIVADA dos impedimentos, e não
// digitada. Ela existia como texto livre até 2026-08-02, e era isso que impedia
// a subseção de dizer quanto do efetivo esteve disponível -- que é a pergunta
// que ela existe para responder, e que o modelo de 2025 respondia com três
// colunas de número.
//
// A COLUNA DE PERCENTUAL É NOSSA, e não do modelo de 2026. Ele tem duas colunas;
// nós emitimos três, porque uma tabela de aproveitamento sem o aproveitamento é
// a tabela que o documento tinha e que o chefe pediu para desfazer. Quem cola no
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
    // dizendo quanto.
    return [
      nomeMilitar(e),
      texto(impedimentos),
      `${Number(e.aproveitamento).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
    ]
  }).filter(Boolean)

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
    estadoAcervo,
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
    capacitacaoRecebida
  ] = await Promise.all([
    buscarEstadoAcervo({ ano, mes }),
    // O `mes` recorta o acumulado: `realizado` vira janeiro até aqui, e
    // `realizado_mes`, só este mês. São as duas colunas da 2.1.
    pitExecucaoCtrl.resumoDoAno(ano, mes),
    capacitacaoCtrl.listarDoMes(ano, mes, TIPO_CAPACITACAO.MINISTRADA),
    buscarPedidos({ ano, mes, cumulativo: false }),
    buscarPedidos({ ano, mes, cumulativo: true }),
    pitExtraCtrl.listar(ano),
    mapotecaCtrl.getTiposMaterial(),
    mapotecaCtrl.getConsumoMensalPorTipo(ano),
    gerarExecucaoPorNd(ano, inicio, cutoff),
    gerarCreditosRecebidos(ano, inicio, cutoff, CLASSIFICACAO_NC.PDR),
    gerarRpnp(ano),
    gerarLicitacoes(ano, TIPO_LICITACAO.GCALC_DSG),
    gerarLicitacoes(ano, TIPO_LICITACAO.PROPRIA),
    gerarRecebimentoMaterial(ano),
    gerarCreditosRecebidos(ano, inicio, cutoff, CLASSIFICACAO_NC.EXTRA_PDR),
    efetivoCtrl.resumoMensal(ano, mes),
    capacitacaoCtrl.listarDoMes(ano, mes, TIPO_CAPACITACAO.RECEBIDA)
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
          numero: '2.1',
          titulo: 'Estado Atual do PIT',
          cabecalhos: ['Meta', 'Item', 'Produto ou serviço', 'Quantidade',
            'Prontos no mês', 'Prontos', 'Previsão de término'],
          linhas: montarEstadoPit({ metas: metasPit })
        },
        {
          numero: '2.6',
          titulo: 'Capacitações externas',
          cabecalhos: ['Capacitação', 'Período', 'Instituições participantes',
            'Efetivo capacitado'],
          linhas: montarCapacitacaoMinistrada({ capacitacoes: capacitacaoMinistrada })
        },
        {
          numero: '2.7',
          titulo: 'Estado do Acervo',
          cabecalhos: ['Escala', 'Tipo de produto', 'Total catalogado',
            'Catalogo no mês', 'Universo da ASC', '% da ASC'],
          linhas: montarEstadoAcervo({ estadoAcervo })
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
        // A 3.3 saiu de `mapoteca.pedido` e virou `pit.demanda_extra` em
        // 2026-08-02. A tentativa antiga derivava a tabela de `previsto_pit` e
        // dava 23 linhas onde a edição real de julho/2026 traz 1: aquele campo é
        // falso por omissão, e o que o relatório chama de Extra-PIT é a exceção
        // AUTORIZADA, com documento. Agora o documento é obrigatório na origem.
        {
          numero: '3.3',
          titulo: 'Extra-PIT',
          cabecalhos: ['Demandante', 'Tipo de produto', 'Qtd', 'Situação',
            'Documento autorização', 'Descrição'],
          linhas: montarExtraPit({ demandas: demandasExtra })
        },
        {
          numero: '3.4',
          titulo: 'LAI e atendimento à órgãos públicos',
          cabecalhos: ['Solicitante', 'Código da LAI (NUP)', 'Descrição',
            'Situação'],
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
      titulo: '6. RECURSOS HUMANOS',
      subsecoes: [
        {
          numero: '6.1',
          titulo: 'Aproveitamento do efetivo',
          cabecalhos: ['Militar', 'Atividades', 'Aproveitamento'],
          linhas: montarAproveitamento({ efetivo })
        },
        {
          numero: '6.2',
          titulo: 'Capacitação do efetivo',
          cabecalhos: ['Plano / Código', 'Capacitação', 'Instituição', 'Militar'],
          linhas: montarCapacitacaoRecebida({ capacitacoes: capacitacaoRecebida })
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
