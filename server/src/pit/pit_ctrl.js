'use strict'

// O item do PIT, separado entre IDENTIDADE e DECLARAÇÃO.
//
// A DSG revisa o PIT durante a execução, e alterar o PIT é cancelar, alterar e
// adicionar item. Só isso, e as três são atos DELA.
//
//   pit.meta               o GRUPO numerado, com nome. Não promete nada, e por
//                          isso não tem declaração.
//   pit.meta_item          o que o SCA decide (unidade, origem) e o que revisão
//                          nenhuma muda (o código do item). Id ESTÁVEL, e é nele
//                          que os vínculos de TRABALHO de outros schemas se
//                          penduram.
//   pit.meta_item_revisao  o que a DSG declara. Uma linha por revisão que mudou
//                          algo.
//
// O QUE ESTE CONTROLADOR CHAMA DE "META" É O ITEM, e é deliberado. A rota, o CLI
// e a tela sempre chamaram assim a linha que promete, e o `id` que eles guardam
// continua sendo o mesmo número. O GRUPO aparece como `numero_meta` e `nome`,
// que é como o documento assinado o apresenta.
//
// A LEITURA sai de `pit.meta_vigente`, que devolve os nomes de coluna de sempre
// com a promessa em vigor.
//
// A ESCRITA DA DECLARAÇÃO EXIGE REVISÃO ABERTA. É o que faz o histórico ficar
// completo POR CONSTRUÇÃO: não dá para mudar o que o PIT promete sem dizer qual
// documento autorizou. Corrigir erro de digitação é outro ato, com rota própria.
//
// O TEXTO ASSINADO É O REI, e o que está aqui é TRANSCRIÇÃO dele. É a decisão
// do chefe, e dela decorre todo o resto:
//
//   `criar`             acrescenta meta DENTRO de uma revisão.
//   `declararNaRevisao` altera e cancela DENTRO de uma revisão.
//   `deletar`           apaga a meta a partir da revisão que a CRIOU.
//
// UMA PORTA SÓ, E ELA É A REVISÃO. Acrescentar, alterar e cancelar entram pela
// revisão escolhida por quem chama, e nunca por uma revisão que o servidor
// adivinha. A tela mostra o consolidado e faz o ato dentro da revisão.
//
// A REVISÃO PUBLICADA ACEITA EDIÇÃO, e isso NÃO é mudar o PIT. O texto assinado
// é o rei: quando a nossa cópia diverge dele, o conserto é da CÓPIA, e a revisão
// que a declarou continua sendo a mesma. Por isso a edição de revisão publicada
// exige MOTIVO, e o motivo desce para o rastro. Sem essa porta, quem transcreveu
// 53 onde o documento diz 35 inventaria uma revisão que a DSG não emitiu.
//
// APAGAR A META SÓ VALE NA REVISÃO QUE A CRIOU. A meta pode ter nascido errada,
// e o documento assinado talvez nem a tenha. Tendo mais de uma declaração, a
// meta já entrou na história do plano: aí só resta CANCELAR.
//
// `atualizar` NÃO é uma delas: ela só mexe na IDENTIDADE (ano, número, item,
// unidade, origem), que é classificação nossa e revisão nenhuma menciona. A tela
// não a oferece mais como botão próprio: a identidade se corrige no mesmo
// formulário da declaração, dentro da revisão. A rota fica de pé para o
// pit_cli, que a mapeia como `meta atualizar`.

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

// As metas do ano alimentam o RPCMTec e sao apontadas pelo PDR, pela NC e pelo
// pedido de impressao: mudar uma meta muda o que os módulos contam.
const { auditoriaCtrl } = require('../auditoria')

const controller = {}

// `declaracoes` e `revisao_criadora_id` existem para a tela saber quando APAGAR
// a meta ainda é possível. A regra do chefe: a primeira criação pode ser
// apagada, porque a meta pode ter nascido errada e o documento assinado talvez
// nem a tenha; a partir da segunda declaração só resta CANCELAR.
//
// `revisao_criadora_id` é a revisão da declaração MAIS ANTIGA, e não a
// `revisao_id` da view: aquela é a revisão em VIGOR, que ignora rascunho. A meta
// recém-acrescentada a um rascunho tem `revisao_id` nulo e mesmo assim precisa
// poder ser apagada de lá.
const colunas = `id, ano, numero_meta, nome, meta_id, item, descricao,
  quantidade_prevista, unidade_id, unidade, demandante, prazo::text AS prazo,
  cancelada, revisao_id, revisao,
  origem_id,
  (SELECT nome FROM dominio.origem_meta WHERE code = pit.meta_vigente.origem_id) AS origem,
  (SELECT count(*)::int FROM pit.meta_item_revisao d WHERE d.meta_item_id = pit.meta_vigente.id) AS declaracoes,
  (SELECT d.revisao_id FROM pit.meta_item_revisao d
    WHERE d.meta_item_id = pit.meta_vigente.id ORDER BY d.id LIMIT 1) AS revisao_criadora_id,
  data_cadastramento, usuario_cadastramento_uuid, data_modificacao, usuario_modificacao_uuid`

// A unidade que cada origem SABE contar. É o que impede virar automática uma
// meta cuja unidade não é a que o cálculo produz: a origem Produção conta versão
// do acervo, e uma versão é uma FOLHA.
const UNIDADE_EXIGIDA = {
  2: { unidade: 3, nome: 'Capacitação' },
  3: { unidade: 1, nome: 'Folha' },
  4: { unidade: 1, nome: 'Folha' }
}

const conferirCoerencia = (origemId, unidadeId) => {
  const exigida = UNIDADE_EXIGIDA[origemId]
  if (!exigida) return
  if (unidadeId === exigida.unidade) return
  throw new AppError(
    `A meta calcula pela origem escolhida, e essa origem conta em ` +
    `${exigida.nome}. Ajuste a unidade da meta ou volte a origem para Manual.`,
    httpCode.BadRequest
  )
}

// A revisão em que a alteração vai cair. Nula não serve: sem ela a mudança não
// teria documento que a autorize, e o histórico nasceria com buraco.
const revisaoAberta = async (t, ano) => {
  const aberta = await t.oneOrNone(
    `SELECT id, ano, codigo, data_vigencia FROM pit.revisao
     WHERE ano = $<ano> AND data_vigencia IS NULL`,
    { ano }
  )
  if (aberta) return aberta

  throw new AppError(
    `Para mexer nas metas do PIT de ${ano} é preciso escolher a revisão que ` +
    'declara a mudança. Cadastre a revisão (o R0, o R1), faça as alterações ' +
    'dentro dela e publique. Para consertar a cópia de um documento que já foi ' +
    'assinado, abra a revisão dele e edite a meta lá, com o motivo.',
    httpCode.BadRequest
  )
}

// A revisão ESCOLHIDA por quem chama, e não a que o servidor adivinha.
//
// Sem `revisaoId` cai no rascunho do ano, que é o caminho do CLI e da carga.
// Com ele, a revisão é a que a tela mostra: quem está olhando o R0 publicado e
// conserta um número vê a correção cair no R0, e não no rascunho seguinte.
const revisaoEscolhida = async (t, ano, revisaoId) => {
  if (revisaoId === undefined || revisaoId === null) return revisaoAberta(t, ano)

  const revisao = await t.oneOrNone(
    `SELECT id, ano, codigo, data_vigencia
     FROM pit.revisao WHERE id = $<revisaoId>`,
    { revisaoId }
  )
  if (!revisao) {
    throw new AppError('Revisão do PIT não encontrada', httpCode.NotFound)
  }
  if (Number(revisao.ano) !== Number(ano)) {
    throw new AppError(
      `A meta é de ${ano} e a revisão ${revisao.codigo} é de ${revisao.ano}. ` +
      'A revisão de um ano só declara meta daquele ano.',
      httpCode.BadRequest
    )
  }
  return revisao
}

// O MOTIVO, quando a revisão já foi publicada.
//
// Editar uma revisão publicada NÃO é mudar o PIT: o texto assinado é o rei, e o
// que está aqui é a transcrição dele. O que se conserta é a CÓPIA, e a revisão
// continua a mesma, com a mesma vigência.
//
// O motivo é o que separa "transcrevi errado" de "a DSG mudou". Sem ele a porta
// viraria o caminho fácil para reescrever o passado sem deixar rastro do porquê.
// Devolve o motivo limpo para o rastro, ou nulo quando a revisão é rascunho.
const { motivoDaCorrecao } = require('./motivo_correcao')

// O GRUPO a que o item pertence, achado por (ano, número) ou CRIADO na hora.
//
// POR QUE ELE É RESOLVIDO AQUI, e não numa rota própria. Quem cadastra o PIT
// transcreve o documento linha a linha, e a linha traz "1.1" junto com "Meta 1 -
// Produção de Geoinformação": exigir dois passos faria a tela pedir o grupo
// antes do item, e o CLI teria de descobrir sozinho se ele já existe. O corpo é
// o mesmo de sempre (`ano` e `numero_meta`), mais um `nome` que só é OBRIGATÓRIO
// quando o grupo ainda não existe.
//
// O NOME NÃO SE SOBRESCREVE quando o grupo já existe. Corrigir o nome da Meta 1
// é ato próprio, e fazê-lo de carona no cadastro de um item deixaria a última
// linha digitada mandando no nome do bloco inteiro.
const resolverMeta = async (t, { ano, numeroMeta, nome, usuarioUuid, contexto }) => {
  const existente = await t.oneOrNone(
    `SELECT * FROM pit.meta WHERE ano = $<ano> AND numero_meta = $<numeroMeta>`,
    { ano, numeroMeta }
  )
  if (existente) return existente

  const texto = nome === undefined || nome === null ? '' : String(nome).trim()
  if (texto.length === 0) {
    throw new AppError(
      `A Meta ${numeroMeta} de ${ano} ainda não existe, e toda meta do PIT tem ` +
      'nome no documento assinado ("Produção de Geoinformação"). Mande o nome ' +
      'da meta junto para criá-la, ou escolha uma meta que já exista.',
      httpCode.BadRequest
    )
  }

  const criada = await t.one(
    `INSERT INTO pit.meta (ano, numero_meta, nome, usuario_cadastramento_uuid)
     VALUES ($<ano>, $<numeroMeta>, $<nome>, $<usuarioUuid>)
     RETURNING *`,
    { ano, numeroMeta, nome: texto, usuarioUuid }
  )

  await auditoriaCtrl.registrar(t, {
    tabela: 'pit.meta',
    registroId: criada.id,
    operacao: 'I',
    depois: criada,
    usuarioUuid,
    contexto
  })

  return criada
}

// Recusa mexer em ano fechado. O exercício encerrado é um ato do chefe, e é o
// que impede alguém corrigir 2025 em 2027.
const conferirExercicio = async (t, ano) => {
  const e = await t.oneOrNone(
    'SELECT situacao_id FROM pit.pit WHERE ano = $<ano>', { ano }
  )
  if (!e) {
    throw new AppError(
      `O exercício de ${ano} não existe. Crie o ano antes de cadastrar meta.`,
      httpCode.BadRequest
    )
  }
  if (e.situacao_id === 3) {
    throw new AppError(
      `O exercício de ${ano} está encerrado e não aceita alteração.`,
      httpCode.BadRequest
    )
  }
}

// O que a DSG declara, e que vai para a linha da revisão. `undefined` vira nulo:
// a revisão pode declarar só o cancelamento, e o PIT de 2025 foi cadastrado sem
// nenhum deles.
const declaracao = dados => ({
  descricao: dados.descricao,
  quantidade_prevista: dados.quantidade_prevista === undefined ? null : dados.quantidade_prevista,
  demandante: dados.demandante === undefined ? null : dados.demandante,
  prazo: dados.prazo === undefined ? null : dados.prazo,
  cancelada: dados.cancelada === undefined ? false : dados.cancelada
})

// Grava a declaração NA revisão escolhida. Upsert porque o gerente pode voltar à
// mesma meta duas vezes antes de publicar, e a revisão guarda o estado final
// dela, não cada tentativa (o rastro de cada tentativa é a auditoria).
//
// O RASTRO DIZ QUAL DOS DOIS ATOS FOI. Lê a linha ANTES do upsert: sem isso todo
// evento saía como inserção, e a correção da transcrição de uma revisão
// publicada, que é o caso que mais precisa ser lido depois, se registrava com o
// `dados_antes` vazio. Com o `antes` na mão, a auditoria guarda os dois lados.
const gravarDeclaracao = async (
  t, { metaId, revisaoId, dados, usuarioUuid, contexto, motivo = null }
) => {
  const antes = await t.oneOrNone(
    `SELECT * FROM pit.meta_item_revisao
     WHERE meta_item_id = $<metaId> AND revisao_id = $<revisaoId>`,
    { metaId, revisaoId }
  )

  const linha = await t.one(
    `INSERT INTO pit.meta_item_revisao
       (meta_item_id, revisao_id, descricao, quantidade_prevista, prazo, demandante,
        cancelada, usuario_cadastramento_uuid)
     VALUES ($<metaId>, $<revisaoId>, $<descricao>, $<quantidade_prevista>,
             $<prazo>, $<demandante>, $<cancelada>, $<usuarioUuid>)
     ON CONFLICT (meta_item_id, revisao_id) DO UPDATE
       SET descricao = EXCLUDED.descricao,
           quantidade_prevista = EXCLUDED.quantidade_prevista,
           prazo = EXCLUDED.prazo,
           demandante = EXCLUDED.demandante,
           cancelada = EXCLUDED.cancelada,
           data_modificacao = now(),
           usuario_modificacao_uuid = EXCLUDED.usuario_cadastramento_uuid
     RETURNING *`,
    { metaId, revisaoId, ...declaracao(dados), usuarioUuid }
  )

  await auditoriaCtrl.registrar(t, {
    tabela: 'pit.meta_item_revisao',
    registroId: linha.id,
    operacao: antes ? 'U' : 'I',
    antes: antes || undefined,
    depois: linha,
    usuarioUuid,
    contexto,
    motivo: motivo || undefined
  })

  return linha
}

// O CAMINHO DE VOLTA do orcamento para o PIT: quanto credito cada meta recebeu.
// O item do PDR aponta a meta, e sem isto a tela diria o que a Divisao promete
// sem dizer o que financia a promessa.
//
// O CREDITO CHEGA PELO ITEM DO PDR, E NAO POR COLUNA DA NC. Ate a 1.30.0 a NC
// tinha `meta_pit_id` propria, e a soma daqui a lia direto. Eram duas afirmacoes
// paralelas sobre a mesma coisa, e elas discordavam: medido em 2026-08-06, 4 das
// 29 NCs que tinham os dois campos apontavam meta diferente da do seu item de
// PDR. A coluna saiu, e agora ha um caminho so, o que o chefe da DGEO fixou: em
// orcamento a ligacao com o PIT e o PDR.
//
// O CREDITO E DA META, E NAO DO ITEM DO PIT, e por isso a soma casa por
// `meta_id` e nao por `id`. O item do PDR e uma linha por ND ('diarias',
// 'passagens'), e nao um recorte do trabalho: nas metas 3 e 5 de 2026 ele SOBRA
// sobre os itens do PIT (6 contra 2, e 5 contra 3), entao nao pode ser um
// detalhamento deles.
//
// A CONSEQUENCIA NA TELA e que os 11 itens da Meta 1 mostram o MESMO credito, e
// isso e o que o dado diz. Somar por item exigiria ratear, e rateio inventado
// vira numero plausivel e falso.
//
// SUBSELECT, e nao JOIN: a meta SEM credito tem de continuar na lista, e um
// INNER JOIN a apagaria. Sao essas as metas que interessam ao chefe. O JOIN com
// `pdr_item` mora DENTRO do subselect pela mesma razao.
//
// `credito_nc` leva COALESCE para zero porque `valor_nc` e NOT NULL: nenhuma NC
// chegando a meta significa credito zero, e isso e fato. `pdr_autorizado` NAO
// leva COALESCE: `valor_autorizado` e anulavel, e a soma nula quer dizer "nao
// informado", que a tela pinta como '-'. Afirmar zero ali seria mentir.
const agregadosDoOrcamento = `
  COALESCE((SELECT SUM(nc.valor_nc)
              FROM orcamento.nota_credito AS nc
              INNER JOIN orcamento.pdr_item AS pin ON pin.id = nc.pdr_item_id
             WHERE pin.meta_pit_id = pit.meta_vigente.meta_id), 0) AS credito_nc,
  (SELECT SUM(pi.valor_autorizado) FROM orcamento.pdr_item AS pi
    WHERE pi.meta_pit_id = pit.meta_vigente.meta_id) AS pdr_autorizado`

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas},
       ${agregadosDoOrcamento}
       FROM pit.meta_vigente
       WHERE ano = $<ano>
       ORDER BY numero_meta, item`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas},
     ${agregadosDoOrcamento}
     FROM pit.meta_vigente
     ORDER BY ano DESC, numero_meta, item`
  )
}

// Os anos do PIT: os EXERCÍCIOS abertos, mais os anos que têm meta.
//
// A UNIÃO É O CONSERTO DE UM BECO SEM SAÍDA. A lista saía de
// `SELECT DISTINCT ano FROM pit.meta`, e o exercício recém-aberto não tem meta
// nenhuma: o PIT de 2027, criado em 2026 para virar vigente em 2026, não
// aparecia no filtro de ano, e sem o filtro não havia como chegar nele para
// cadastrar as primeiras metas. Galinha e ovo.
//
// O ANO É ONDE SE COMEÇA, e não um filtro do que já aconteceu. O exercício é o
// primeiro passo do fluxo, e ele nasce vazio por construção.
//
// A meta continua na união porque o histórico é anterior a `pit.pit`: um
// ano com meta e sem linha de exercício sumiria da lista.
controller.anos = async () => {
  const linhas = await db.conn.any(
    `SELECT ano FROM pit.pit
     UNION
     SELECT ano FROM pit.meta
     ORDER BY ano DESC`
  )
  return linhas.map(l => l.ano)
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas}
     FROM pit.meta_vigente
     WHERE id = $<id>`,
    { id }
  )
}

// O HISTÓRICO da meta: em que revisão ela mudou, e para quanto. É a resposta
// direta da tabela esparsa, sem diff nem cálculo.
controller.historico = async id => {
  return db.conn.any(
    `SELECT mr.revisao_id, r.codigo AS revisao, r.data_vigencia::text AS data_vigencia,
            r.assinante, mr.descricao, mr.quantidade_prevista,
            mr.prazo::text AS prazo, mr.demandante, mr.cancelada,
            mr.data_cadastramento, mr.usuario_cadastramento_uuid
     FROM pit.meta_item_revisao mr
     INNER JOIN pit.revisao r ON r.id = mr.revisao_id
     WHERE mr.meta_item_id = $<id>
     ORDER BY r.data_vigencia NULLS LAST, r.id`,
    { id }
  )
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // A coerência entre origem e unidade só olha o CORPO, então vem antes de
    // qualquer ida ao banco: corpo incoerente não merece consulta nenhuma.
    conferirCoerencia(
      dados.origem_id === undefined ? 1 : dados.origem_id,
      dados.unidade_id
    )
    await conferirExercicio(t, dados.ano)
    // Acrescentar meta é ato da DSG, como alterar e cancelar: entra pela revisão
    // que a declara. Omitir `revisao_id` cai no rascunho do ano, que é o
    // caminho do CLI; a tela manda a revisão que está aberta nela.
    const revisao = await revisaoEscolhida(t, dados.ano, dados.revisao_id)
    // A revisão publicada aceita a meta que a nossa cópia esqueceu de
    // transcrever, e o motivo é o que diz que foi disso que se tratou.
    const motivo = motivoDaCorrecao(revisao, dados.motivo)

    // O GRUPO PRIMEIRO. Ele pode já existir (o caso comum: acrescentar a 1.12 à
    // Meta 1) ou nascer aqui, com o nome que veio no corpo.
    const meta = await resolverMeta(t, {
      ano: dados.ano,
      numeroMeta: dados.numero_meta,
      nome: dados.nome,
      usuarioUuid,
      contexto
    })

    // RETURNING *, e nao `RETURNING id`: a linha gravada e o `dados_depois`, e o
    // que se audita e o que o banco GRAVOU.
    const criada = await t.one(
      `INSERT INTO pit.meta_item
         (meta_id, item, unidade_id, origem_id, usuario_cadastramento_uuid)
       VALUES ($<metaId>, $<item>, $<unidade_id>, $<origem_id>, $<usuarioUuid>)
       RETURNING *`,
      {
        metaId: meta.id,
        item: dados.item,
        unidade_id: dados.unidade_id,
        origem_id: dados.origem_id === undefined ? 1 : dados.origem_id,
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta_item',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto,
      motivo: motivo || undefined
    })

    await gravarDeclaracao(t, {
      metaId: criada.id, revisaoId: revisao.id, dados, usuarioUuid, contexto, motivo
    })

    // A rota continua devolvendo so o id, como antes: o RETURNING * e do rastro.
    return { id: criada.id }
  })
}

// SÓ A IDENTIDADE. Ano, número, item, unidade e origem são classificação NOSSA,
// e revisão nenhuma as menciona: por isso mudam sem revisão.
//
// MUDAR `ano` OU `numero_meta` É MUDAR O ITEM DE GRUPO, e é o que `resolverMeta`
// resolve: a 1.5 que vira 2.2 passa a pendurar na Meta 2. O grupo antigo NÃO é
// apagado quando fica vazio, de propósito: ele continua sendo o que o documento
// nomeia, e apagá-lo levaria junto os créditos do orçamento que o apontam.
//
// O QUE ELA NÃO FAZ MAIS: gravar declaração. Ela gravava, e era a segunda porta
// para mudar o que a DSG promete, ao lado da revisão. Duas portas para o mesmo
// ato é o que a tela não conseguia explicar, e o que o chefe não conseguiu
// distinguir. Agora quem altera a promessa é `declararNaRevisao`, e o schema Joi
// recusa os cinco campos da declaração aqui, com mensagem que diz para onde ir.
controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Substitui o `SELECT id`, que existia so para o 404: a linha inteira sai
    // pela mesma ida ao banco e vira o `dados_antes`.
    const antes = await auditoriaCtrl.lerAntes(t, 'pit.meta_item', id, 'Item do PIT')

    // OMITIR `origem_id` É "NÃO MEXER", e não "vira Manual". A regra anterior
    // zerava para Manual toda vez que alguém salvasse o formulário, que não tem
    // campo de origem nenhum: um item que contava sozinho voltava a exigir
    // lançamento à mão, em silêncio.
    const origemAtual = antes.origem_id == null ? 1 : antes.origem_id
    const origemId = dados.origem_id === undefined ? origemAtual : dados.origem_id
    const unidadeId = dados.unidade_id === undefined ? antes.unidade_id : dados.unidade_id

    conferirCoerencia(origemId, unidadeId)
    await conferirExercicio(t, dados.ano)

    const meta = await resolverMeta(t, {
      ano: dados.ano,
      numeroMeta: dados.numero_meta,
      nome: dados.nome,
      usuarioUuid,
      contexto
    })

    const depois = await t.one(
      `UPDATE pit.meta_item
       SET meta_id = $<metaId>, item = $<item>,
           unidade_id = $<unidade_id>, origem_id = $<origem_id>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      {
        id,
        metaId: meta.id,
        item: dados.item,
        unidade_id: unidadeId,
        origem_id: origemId,
        dataModificacao: new Date(),
        usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta_item',
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

// ALTERAR A META DENTRO DE UMA REVISÃO. É a porta que faltava, e é a que a tela
// de revisões usa.
//
// POR QUE ELA EXISTE COM OS DOIS IDS NO CAMINHO. Antes, a alteração entrava pela
// meta (`PUT /metas/:id`) e o servidor descobria SOZINHO em que revisão gravar,
// procurando o rascunho do ano. Quem estivesse olhando o R0 publicado e mudasse
// um número via a mudança cair no R1, sem nada dizer. Aqui a revisão é
// escolhida por quem chama.
//
// UPSERT, pelo mesmo motivo de `criar`: o gerente volta à mesma meta duas vezes
// antes de publicar, e a revisão guarda o estado final dela. Cada tentativa fica
// na auditoria.
//
// AS TRÊS OPERAÇÕES CABEM AQUI, porque a tabela é esparsa: acrescentar é a
// primeira linha da meta, alterar é a linha com o número novo, cancelar é a
// linha com `cancelada`. Tirar a meta da revisão é o DELETE, que já existe.
//
// A REVISÃO PUBLICADA ACEITA A EDIÇÃO, com MOTIVO. É a regra do chefe, e ela
// decorre do princípio: o texto assinado é o rei, e o que está aqui é a
// transcrição dele. Editar o R0 publicado não muda o PIT nem move a vigência:
// conserta a nossa cópia do documento que a DSG assinou. O motivo é o que separa
// esse conserto de uma mudança de plano, e ele desce para a auditoria.
//
// A IDENTIDADE VIAJA JUNTO, e é opcional. Número, item, unidade e origem são
// classificação NOSSA, e revisão nenhuma as menciona; mas quem corrige a meta
// tem as duas coisas na frente, e separá-las em dois botões foi o que ninguém
// entendeu. Aqui as duas gravam na MESMA transação: ou a meta sai inteira certa,
// ou nada sai.
controller.declararNaRevisao = async (revisaoId, metaId, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const revisao = await t.oneOrNone(
      `SELECT id, ano, codigo, data_vigencia
       FROM pit.revisao WHERE id = $<revisaoId>`,
      { revisaoId }
    )
    if (!revisao) {
      throw new AppError('Revisão do PIT não encontrada', httpCode.NotFound)
    }

    const motivo = motivoDaCorrecao(revisao, dados.motivo)

    // O ITEM COM O ANO JUNTO. O ano é do GRUPO, e o item sozinho não o tem: sem
    // o JOIN a guarda abaixo compararia `undefined` com o ano da revisão e
    // deixaria passar tudo.
    const meta = await t.oneOrNone(
      `SELECT mi.*, m.ano, m.numero_meta
       FROM pit.meta_item mi
       INNER JOIN pit.meta m ON m.id = mi.meta_id
       WHERE mi.id = $<metaId>`,
      { metaId }
    )
    if (!meta) {
      throw new AppError('Item do PIT não encontrado', httpCode.NotFound)
    }
    // A revisão de um ano só declara item DAQUELE ano. Sem esta guarda, a
    // restrição UNIQUE (meta_item_id, revisao_id) aceitaria o item de 2025
    // dentro da revisão de 2026, e `pit.meta_vigente` passaria a mostrá-lo.
    if (Number(meta.ano) !== Number(revisao.ano)) {
      throw new AppError(
        `O item é de ${meta.ano} e a revisão ${revisao.codigo} é de ${revisao.ano}. ` +
        'A revisão de um ano só declara item daquele ano.',
        httpCode.BadRequest
      )
    }

    await conferirExercicio(t, revisao.ano)

    // A CLASSIFICAÇÃO SÓ ENTRA SE VIER. Omitir os quatro campos é "não mexer", e
    // é o que o CLI e a carga fazem. `numero_meta` presente é o sinal de que
    // quem chamou mandou o bloco inteiro da identidade.
    if (dados.numero_meta !== undefined) {
      const origemId = dados.origem_id === undefined
        ? (meta.origem_id == null ? 1 : meta.origem_id)
        : dados.origem_id
      const unidadeId = dados.unidade_id === undefined ? meta.unidade_id : dados.unidade_id

      conferirCoerencia(origemId, unidadeId)

      // Trocar `numero_meta` move o item de grupo. O grupo de destino tem de
      // existir, ou vir com nome: ver `resolverMeta`.
      const grupo = await resolverMeta(t, {
        ano: meta.ano,
        numeroMeta: dados.numero_meta,
        nome: dados.nome,
        usuarioUuid,
        contexto
      })

      const identidade = await t.one(
        `UPDATE pit.meta_item
         SET meta_id = $<grupoId>, item = $<item>,
             unidade_id = $<unidade_id>, origem_id = $<origem_id>,
             data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<metaId>
         RETURNING *`,
        {
          metaId,
          grupoId: grupo.id,
          item: dados.item === undefined ? meta.item : dados.item,
          unidade_id: unidadeId,
          origem_id: origemId,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'pit.meta_item',
        registroId: metaId,
        operacao: 'U',
        // `meta` traz `ano` e `numero_meta` do JOIN, que nao sao colunas de
        // pit.meta_item: o diff da auditoria as ignora porque o mapa de campos
        // so declara as da tabela.
        antes: meta,
        depois: identidade,
        usuarioUuid,
        contexto,
        motivo: motivo || undefined
      })
    }

    const linha = await gravarDeclaracao(t, {
      metaId, revisaoId, dados, usuarioUuid, contexto, motivo
    })

    return { id: linha.id, meta_id: linha.meta_item_id, revisao_id: linha.revisao_id }
  })
}

// CORRIGIR TRANSCRIÇÃO, e não alterar o PIT.
//
// O gerente digitou 53 e o documento diz 35. Isso não é revisão da DSG, é
// conserto de quem transcreveu. Se a única porta fosse "abrir revisão", ele
// inventaria uma revisão que não existe, e o histórico passaria a mentir na
// direção oposta.
//
// Edita a linha da revisão EM VIGOR, exige motivo, e o rastro vai para a
// auditoria com o motivo junto.
controller.corrigirTranscricao = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const vigente = await t.oneOrNone(
      'SELECT revisao_id, ano FROM pit.meta_vigente WHERE id = $<id>', { id }
    )
    if (!vigente || !vigente.revisao_id) {
      throw new AppError(
        'O item não tem declaração em revisão nenhuma, então não há transcrição a corrigir.',
        httpCode.BadRequest
      )
    }
    await conferirExercicio(t, vigente.ano)

    const antes = await t.one(
      `SELECT * FROM pit.meta_item_revisao
       WHERE meta_item_id = $<id> AND revisao_id = $<revisaoId>`,
      { id, revisaoId: vigente.revisao_id }
    )

    const depois = await t.one(
      `UPDATE pit.meta_item_revisao
       SET descricao = $<descricao>, quantidade_prevista = $<quantidade_prevista>,
           prazo = $<prazo>, demandante = $<demandante>, cancelada = $<cancelada>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE meta_item_id = $<id> AND revisao_id = $<revisaoId>
       RETURNING *`,
      {
        id, revisaoId: vigente.revisao_id, ...declaracao(dados),
        dataModificacao: new Date(), usuarioUuid
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta_item_revisao',
      registroId: depois.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto,
      motivo: dados.motivo
    })

    return { id: depois.id }
  })
}

// Ganhou TRANSACAO, e nao so por causa do rastro: eram tres comandos em tres
// conexoes diferentes (o `SELECT id`, a contagem de dependentes e o DELETE), e
// entre a contagem e o DELETE cabia o cadastro de um pedido apontando esta meta.
//
// EXCLUIR NÃO É CANCELAR. A meta que a DSG cancelou continua existindo, com
// `cancelada` na revisão que a cancelou; o DELETE fica para o cadastro errado.
//
// SÓ A PARTIR DA REVISÃO QUE A CRIOU, e é a regra do chefe. A primeira criação
// pode ser apagada, porque a meta pode ter nascido errada e o documento assinado
// talvez nem a tenha. Da SEGUNDA declaração em diante ela já entrou na história
// do plano (o relatório de um mês reportou o que ela prometia), e aí só resta
// CANCELAR.
//
// `revisaoId` é a revisão de onde a tela está apagando. Omiti-lo cobra só a
// primeira metade da regra, que é o suficiente para o CLI: com uma declaração
// só, a revisão que a criou é única e não há como estar "na outra".
controller.deletar = async (id, revisaoId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(t, 'pit.meta_item', id, 'Item do PIT')

    // O ANO vem do GRUPO: `pit.meta_item` não o guarda, de propósito, e uma
    // cópia aqui deixaria lançar 2025 num item de 2026 sem nada acusar.
    //
    // `oneOrNone`, e não `one`: o grupo existe sempre (a chave estrangeira o
    // exige), e a leitura só precisa do ano. Usar `one` aqui misturaria esta ida
    // ao banco com as duas CONTAGENS abaixo, que também são `one`.
    const grupo = await t.oneOrNone(
      'SELECT ano FROM pit.meta WHERE id = $<metaId>', { metaId: antes.meta_id }
    )
    await conferirExercicio(t, grupo ? grupo.ano : null)

    // AS DECLARAÇÕES DO ITEM, que são as revisões em que ele aparece. A tabela é
    // esparsa: cada linha aqui é uma revisão que disse alguma coisa sobre ele.
    const declaracoes = await t.any(
      `SELECT mr.revisao_id, r.codigo
       FROM pit.meta_item_revisao mr
       INNER JOIN pit.revisao r ON r.id = mr.revisao_id
       WHERE mr.meta_item_id = $<id>
       ORDER BY mr.id`,
      { id }
    )

    if (declaracoes.length > 1) {
      const codigos = declaracoes.map(d => d.codigo).join(', ')
      throw new AppError(
        `O item é declarado por ${declaracoes.length} revisões (${codigos}), e por ` +
        'isso não se apaga: apagá-lo reescreveria o que o relatório dos meses ' +
        'anteriores reportou. Para tirá-lo do plano, CANCELE o item na revisão ' +
        'que autoriza o cancelamento.',
        httpCode.Conflict
      )
    }

    const criadora = declaracoes[0] || null

    if (revisaoId !== undefined && revisaoId !== null && criadora &&
        Number(criadora.revisao_id) !== Number(revisaoId)) {
      throw new AppError(
        `O item foi criado pela revisão ${criadora.codigo}, e só de lá ele se ` +
        'apaga. Nesta revisão o que cabe é CANCELAR o item.',
        httpCode.BadRequest
      )
    }

    // Bloqueia a exclusao quando algum consumidor aponta para este item. Os tres
    // vivem em schemas diferentes, e a lista cresce quando um modulo novo passar a
    // amarrar trabalho ao PIT. Sem isto o erro chegaria como 500 do banco (FK).
    //
    // O ORCAMENTO SAIU DA LISTA, e nao por descuido: a NC e o item do PDR apontam
    // a META (`pit.meta`), e nao o item. Apagar a 1.1 nao os deixa orfaos, porque
    // eles nunca apontaram para ela.
    //
    // O ITEM DO PEDIDO ENTRA NA LISTA desde 2026-08-06, quando ele passou a poder
    // declarar meta propria. Sem esta linha, apagar a 4.2 passaria pela guarda
    // (nenhum PEDIDO aponta a 4.2) e so estouraria depois, como 500 da chave
    // estrangeira das 6 linhas de itens que apontam.
    const dependentes = await t.one(
      `SELECT
         (SELECT COUNT(*) FROM mapoteca.pedido WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM acervo.versao WHERE meta_pit_id = $<id>) +
         (SELECT COUNT(*) FROM rpcmtec.capacitacao WHERE meta_pit_id = $<id>) AS n`,
      { id }
    )
    if (parseInt(dependentes.n, 10) > 0) {
      throw new AppError(
        'Item do PIT possui registros vinculados e não pode ser excluído',
        httpCode.Conflict
      )
    }

    // Lançamento de execução é caso à parte, e por isso tem mensagem própria.
    // A chave estrangeira é ON DELETE CASCADE -- e é isso que torna a guarda
    // necessária, não dispensável: sem ela, apagar o item levaria junto os doze
    // meses lançados, em silêncio e SEM evento de auditoria para eles, porque
    // quem apaga é o banco. O remédio aqui é do alcance de quem chamou (apagar
    // os lançamentos), ao contrário do pedido de impressão.
    const { lancamentos } = await t.one(
      'SELECT COUNT(*)::int AS lancamentos FROM pit.execucao WHERE meta_id = $<id>',
      { id }
    )
    if (lancamentos > 0) {
      throw new AppError(
        `Item do PIT possui ${lancamentos} lançamento(s) de execução. Exclua os lançamentos antes de excluir o item.`,
        httpCode.Conflict
      )
    }

    await t.none('DELETE FROM pit.meta_item WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.meta_item',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto,
      motivo: criadora
        ? `Apagado a partir da revisão ${criadora.codigo}, a única que o declara.`
        : 'Apagado: revisão nenhuma o declara.'
    })
  })
}

module.exports = controller
