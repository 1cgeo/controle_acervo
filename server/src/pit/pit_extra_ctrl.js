'use strict'

// Demanda Extra-PIT: a subseção 3.3 do RPCMTec.
//
// O QUE ELA É, e o que ela não é. O relatório não chama de Extra-PIT todo
// trabalho fora do plano: chama a exceção AUTORIZADA, e o modelo tem uma coluna
// "Documento autorização" para provar. Por isso `documento_autorizacao` é
// obrigatório aqui, e por isso a 3.3 NÃO se deriva de
// `mapoteca.pedido.previsto_pit`, que é falso por omissão.
//
// MORA NO SCHEMA `pit` porque é a exceção AO PIT, e só se lê ao lado dele.
//
// SEM `lote_id`: a 2.1 do SCA soma o que foi lançado em `pit.execucao`, e o
// Extra-PIT não é lançado lá, então não há o que descontar.

// A MATERIALIZAÇÃO. O Extra-PIT é PRODUÇÃO, e não entrega: a demanda de origem
// Produção só fecha quando existe versão no acervo apontando para ela.
//
// O vínculo mora em `acervo.versao.demanda_extra_id`, exclusivo com
// `meta_pit_id`, e NÃO no lote: a produção Extra-PIT mora dentro de um lote do
// PIT, ao lado das versões que cumprem meta.

const { db } = require('../database')

const {
  AppError,
  httpCode,
  domainConstants: { SITUACAO_EXTRA_PIT }
} = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

// Situações que AFIRMAM que a demanda saiu. Vêm de `utils/domain_constants`, e
// não repetidas como número aqui: `dominio.situacao_extra_pit` é o mesmo domínio
// que a tela e o relatório leem, e uma segunda cópia dos códigos divergiria da
// primeira que fosse corrigida.
const SITUACOES_QUE_AFIRMAM_ENTREGA = [
  SITUACAO_EXTRA_PIT.ENVIADO,
  SITUACAO_EXTRA_PIT.CONCLUIDO
]

// `dominio.origem_meta`, reusado pela demanda extra (só Manual e Produção; o
// CHECK `demanda_extra_origem_manual_ou_producao` cobra o mesmo no banco).
const ORIGEM_PRODUCAO = 3

// CALCULADA NA LEITURA, nunca gravada. Mesma doutrina da grade do PIT: número
// derivado que se grava vira segunda verdade no primeiro que editar a cópia à
// mão. Sai zero para a demanda Manual, e é o que se espera dela.
const QUANTIDADE_MATERIALIZADA = `(
    SELECT count(*)::int FROM acervo.versao AS v
    WHERE v.demanda_extra_id = d.id
  ) AS quantidade_materializada`

const colunas = `d.id, d.ano, d.demandante, d.tipo_produto, d.quantidade,
  d.situacao_id, s.nome AS situacao, d.origem_id, o.nome AS origem,
  d.documento_autorizacao, d.descricao,
  d.data_entrega::text AS data_entrega,
  ${QUANTIDADE_MATERIALIZADA},
  d.data_cadastramento, d.usuario_cadastramento_uuid,
  d.data_modificacao, d.usuario_modificacao_uuid`

// A situação sai por JOIN, e não traduzida no cliente: a mesma lista serve à
// tela, ao RPCMTec e ao CLI, e três traduções do mesmo código divergiriam. A
// origem reusa `dominio.origem_meta` pela mesma razão: um domínio próprio
// criaria um segundo código chamado 'Produção'.
const de = `FROM pit.demanda_extra AS d
  INNER JOIN dominio.situacao_extra_pit AS s ON s.code = d.situacao_id
  INNER JOIN dominio.origem_meta AS o ON o.code = d.origem_id`

/**
 * As demandas Extra-PIT ENTREGUES num mês. É o que a 3.3 do RPCMTec reporta.
 *
 * SÓ O MÊS, e é por isso que ela não é `listar(ano)`. A 3.3 estava saindo com o
 * ano inteiro em toda edição, então a de agosto repetia tudo o que a de julho já
 * havia reportado, e quem somasse as doze edições contaria cada demanda doze
 * vezes. É o mesmo recorte que a 3.4 já usava (`filtroPeriodoMes` sobre
 * `mapoteca.pedido.data_pedido`), e as duas são irmãs no documento.
 *
 * O MÊS É O DA ENTREGA, e não o do cadastro. `data_entrega` é quando a exceção
 * autorizada se cumpriu, e é isso que o relatório do mês afirma ter acontecido.
 * A demanda sem `data_entrega` não entra em mês nenhum: ela ainda não aconteceu,
 * e reportá-la seria dizer que a Divisão entregou o que não entregou.
 *
 * @param {number} ano
 * @param {number} mes - 1 a 12
 */
controller.listarDoMes = async (ano, mes) => {
  return db.conn.any(
    `SELECT ${colunas} ${de}
     WHERE d.ano = $<ano>
       AND d.data_entrega >= make_date($<ano>, $<mes>, 1)
       AND d.data_entrega < (make_date($<ano>, $<mes>, 1) + interval '1 month')
     ORDER BY d.data_entrega, d.demandante, d.tipo_produto`,
    { ano, mes }
  )
}

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas} ${de}
       WHERE d.ano = $<ano>
       ORDER BY d.demandante, d.tipo_produto`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas} ${de}
     ORDER BY d.ano DESC, d.demandante, d.tipo_produto`
  )
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas} ${de} WHERE d.id = $<id>`,
    { id }
  )
}

// Os anos com demanda cadastrada, para a tela montar o filtro sem adivinhar um
// intervalo. Mesmo desenho de `pitCtrl.anos`.
controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM pit.demanda_extra ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

// --- As versões que materializam a demanda -----------------------------------
//
// O VÍNCULO MORA NA VERSÃO (acervo.versao.demanda_extra_id, er/acervo.sql:148) e
// é EXCLUSIVO com meta_pit_id, pelo CHECK versao_plano_ou_excecao
// (er/acervo.sql:163). A folha cumpre o plano OU é a exceção autorizada, nunca
// as duas, e essa exclusão é o que impede a contagem dupla.
//
// POR QUE NÃO PELO LOTE: a produção Extra-PIT mora DENTRO de um lote do PIT. O
// lote 2026-1a tem seis cartas, quatro da meta 1.1 e duas do CMS para a Op.
// Arandu. Só a versão tem a granularidade que separa as duas.
//
// ATÉ AQUI SÓ EXISTIA A CONTAGEM. `quantidade_materializada` dizia QUANTAS
// versões apontam para a demanda, e nunca QUAIS: a única forma de ver as folhas
// era SQL direto, e a única forma de ligar uma era o PUT /produtos/versao, que
// exige o corpo inteiro da versão. A mensagem de `conferirMaterializacao` manda
// "ligue as versões que a cumprem" e não havia onde.

// A IDENTIDADE HUMANA DA FOLHA. MI e INOM antes do nome, que é como a folha do
// SCN é chamada; o nome só identifica o produto especial, que é o que não tem
// MI. Mesma ordem do resumo de auditoria (auditoria/mapa/acervo.js:65).
const colunasVersao = `v.id::integer AS id, v.versao, v.nome,
  v.data_edicao::text AS data_edicao,
  v.produto_id::integer AS produto_id,
  p.mi, p.inom, p.nome AS produto,
  l.nome AS lote,
  v.meta_pit_id,
  g.ano AS meta_ano, g.numero_meta AS meta_numero, mi.item AS meta_item`

const deVersao = `FROM acervo.versao AS v
  INNER JOIN acervo.produto AS p ON p.id = v.produto_id
  LEFT JOIN acervo.lote AS l ON l.id = v.lote_id
  LEFT JOIN pit.meta_item AS mi ON mi.id = v.meta_pit_id
  LEFT JOIN pit.meta AS g ON g.id = mi.meta_id`

controller.listarVersoes = async id => {
  return db.conn.any(
    `SELECT ${colunasVersao} ${deVersao}
     WHERE v.demanda_extra_id = $<id>
     ORDER BY p.mi NULLS LAST, p.nome, v.versao`,
    { id }
  )
}

// AS CANDIDATAS A LIGAR, com o motivo do bloqueio JUNTO.
//
// A versão que já cumpre meta do PIT vem na lista, e não some dela: some-a e a
// pessoa procuraria para sempre uma folha que existe. Ela vem com
// `bloqueio` preenchido, e a tela recusa antes de chamar o servidor. Sem isso o
// CHECK do banco responderia com "violates check constraint
// versao_plano_ou_excecao", que não diz a ninguém o que fazer.
//
// TETO DE 50 LINHAS: o acervo tem folha demais para uma lista de escolha, e uma
// busca sem teto viraria despejo. Quem não achou refina o termo.
const LIMITE_CANDIDATAS = 50

controller.listarVersoesCandidatas = async (id, termo) => {
  const busca = termo ? `%${termo}%` : null

  return db.conn.any(
    `SELECT ${colunasVersao},
       v.demanda_extra_id::integer AS demanda_extra_id
     ${deVersao}
     WHERE (v.demanda_extra_id IS NULL OR v.demanda_extra_id <> $<id>)
       AND ($<busca> IS NULL OR
            p.mi ILIKE $<busca> OR p.inom ILIKE $<busca> OR
            p.nome ILIKE $<busca> OR v.nome ILIKE $<busca> OR
            l.nome ILIKE $<busca>)
     ORDER BY p.mi NULLS LAST, p.nome, v.versao
     LIMIT ${LIMITE_CANDIDATAS}`,
    { id, busca }
  )
}

// A frase que a tela e o servidor usam quando a folha já cumpre meta do PIT. Uma
// só, porque a tela recusa antes de chamar e o servidor recusa de novo: duas
// redações da mesma regra divergiriam na primeira que fosse corrigida.
const RECUSA_META_PIT =
  'A versão já cumpre uma meta do PIT, e a mesma folha não conta nos dois ' +
  'lugares. Desligue a meta na tela do produto antes de ligá-la à demanda ' +
  'Extra-PIT.'

// O portão da demanda: as duas escritas confirmam que ela existe antes de mexer
// na versão. Sem isto, ligar a uma demanda apagada tomaria erro de chave
// estrangeira, que nomeia a constraint e não o problema.
const exigirDemanda = async (t, id) => {
  const demanda = await t.oneOrNone(
    'SELECT id FROM pit.demanda_extra WHERE id = $<id>',
    { id }
  )
  if (!demanda) {
    throw new AppError('Demanda Extra-PIT não encontrada', httpCode.NotFound)
  }
  return demanda
}

// LIGAR uma versão à demanda.
//
// IDEMPOTENTE: ligar de novo o que já está ligado devolve OK sem gravar. Dois
// cliques na mesma linha são acidente comum, e o segundo não é erro.
controller.associarVersao = async (id, versaoId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await exigirDemanda(t, id)

    const antes = await auditoriaCtrl.lerAntes(
      t, 'acervo.versao', versaoId, 'Versão do acervo'
    )

    if (antes.demanda_extra_id !== null && Number(antes.demanda_extra_id) === Number(id)) {
      return { id: Number(versaoId), jaEstava: true }
    }

    // A ordem importa: o CHECK do banco recusaria as duas juntas, e a mensagem
    // dele nomeia a constraint. Aqui a recusa diz o que fazer.
    if (antes.meta_pit_id !== null) {
      throw new AppError(RECUSA_META_PIT, httpCode.BadRequest)
    }

    if (antes.demanda_extra_id !== null) {
      throw new AppError(
        'A versão já materializa outra demanda Extra-PIT. Desligue-a de lá ' +
        'antes de ligá-la a esta.',
        httpCode.BadRequest
      )
    }

    const depois = await t.one(
      `UPDATE acervo.versao
       SET demanda_extra_id = $<id>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<versaoId>
       RETURNING *`,
      { id, versaoId, usuarioUuid, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.versao',
      registroId: depois.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: Number(versaoId), jaEstava: false }
  })
}

// DESLIGAR a versão da demanda.
//
// Só desliga a versão que aponta para ESTA demanda. Sem a conferência, um id
// errado apagaria em silêncio o vínculo de outra demanda, e o UPDATE devolveria
// sucesso do mesmo jeito.
controller.desassociarVersao = async (id, versaoId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await exigirDemanda(t, id)

    const antes = await auditoriaCtrl.lerAntes(
      t, 'acervo.versao', versaoId, 'Versão do acervo'
    )

    if (antes.demanda_extra_id === null ||
        Number(antes.demanda_extra_id) !== Number(id)) {
      throw new AppError(
        'A versão não materializa esta demanda Extra-PIT.',
        httpCode.BadRequest
      )
    }

    const depois = await t.one(
      `UPDATE acervo.versao
       SET demanda_extra_id = NULL,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<versaoId>
       RETURNING *`,
      { versaoId, usuarioUuid, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.versao',
      registroId: depois.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: Number(versaoId) }
  })
}

const paraBanco = (dados, usuarioUuid) => ({
  ano: dados.ano,
  demandante: dados.demandante,
  tipoProduto: dados.tipo_produto,
  quantidade: dados.quantidade,
  situacaoId: dados.situacao_id,
  // Ausente vira Manual, que é o DEFAULT da coluna e o comportamento de sempre.
  // Assim o cliente que ainda não conhece o campo não muda nada ao editar.
  origemId: dados.origem_id === undefined ? 1 : dados.origem_id,
  documentoAutorizacao: dados.documento_autorizacao,
  descricao: dados.descricao === undefined ? null : dados.descricao,
  dataEntrega: dados.data_entrega === undefined ? null : dados.data_entrega,
  usuarioUuid
})

// A demanda de PRODUÇÃO não fecha sem materializar, e a regra vale para Enviado
// e para Concluído: as duas afirmam que alguma coisa saiu daqui.
//
// A régua é "pelo menos uma versão", e NÃO `materializada >= quantidade`. A
// `quantidade` da 3.3 muda de unidade por linha (uma demanda pode prometer as
// MIs cobertas por um mosaico), e a exigência de igualdade travaria um
// fechamento legítimo. A tela mostra o par, e quem lê decide.
//
// LÊ DO BANCO, e não do corpo: o número de versões é a única prova que existe, e
// ela não vem de quem está editando.
const conferirMaterializacao = async (t, dados, id) => {
  if (dados.origemId !== ORIGEM_PRODUCAO) return
  if (!SITUACOES_QUE_AFIRMAM_ENTREGA.includes(dados.situacaoId)) return

  const { materializada } = await t.one(
    `SELECT count(*)::int AS materializada FROM acervo.versao
     WHERE demanda_extra_id = $<id>`,
    { id: id === undefined ? null : id }
  )

  if (materializada > 0) return

  throw new AppError(
    'A demanda tem origem Produção, e nenhuma versão do acervo aponta para ' +
    'ela. O Extra-PIT é produção: cadastre a demanda como Previsto ou Em ' +
    'produção, ligue as versões que a cumprem e só então feche.',
    httpCode.BadRequest
  )
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const linha = paraBanco(dados, usuarioUuid)

    // Na criação a conta dá zero sempre, porque não há id para as versões
    // apontarem ainda. É deliberado: nascer Concluída em origem Produção seria
    // afirmar entrega sem nenhuma prova. O caminho é criar, ligar, fechar.
    await conferirMaterializacao(t, linha, undefined)

    const criada = await t.one(
      `INSERT INTO pit.demanda_extra
         (ano, demandante, tipo_produto, quantidade, situacao_id, origem_id,
          documento_autorizacao, descricao, data_entrega, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<demandante>, $<tipoProduto>, $<quantidade>, $<situacaoId>,
               $<origemId>, $<documentoAutorizacao>, $<descricao>, $<dataEntrega>,
               $<usuarioUuid>)
       RETURNING *`,
      linha
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.demanda_extra', id, 'Demanda Extra-PIT'
    )

    const linha = paraBanco(dados, usuarioUuid)

    await conferirMaterializacao(t, linha, id)

    const depois = await t.one(
      `UPDATE pit.demanda_extra
       SET ano = $<ano>, demandante = $<demandante>, tipo_produto = $<tipoProduto>,
           quantidade = $<quantidade>, situacao_id = $<situacaoId>,
           origem_id = $<origemId>,
           documento_autorizacao = $<documentoAutorizacao>, descricao = $<descricao>,
           data_entrega = $<dataEntrega>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      { ...linha, id, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: depois.id }
  })
}

// Excluível de propósito: a demanda cancelada tem situação própria
// ('Cancelado'), e o DELETE fica para o cadastro errado.
//
// `acervo.versao.demanda_extra_id` aponta para cá, e o DELETE esbarra nele. NÃO
// cascateia: apagar a demanda não pode apagar a versão, que é o produto. A
// mensagem diz quantas folhas seguram.
controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.demanda_extra', id, 'Demanda Extra-PIT'
    )

    const { presas } = await t.one(
      `SELECT count(*)::int AS presas FROM acervo.versao
       WHERE demanda_extra_id = $<id>`,
      { id }
    )
    if (presas > 0) {
      throw new AppError(
        `${presas} versão(ões) do acervo materializam esta demanda e seriam ` +
        'deixadas sem origem. Desligue-as antes, ou cancele a demanda em vez ' +
        'de excluir.',
        httpCode.BadRequest
      )
    }

    await t.none('DELETE FROM pit.demanda_extra WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
