'use strict'

// A EDIÇÃO mensal do RPCMTec: o metadado, o documento montado, o fechamento e o
// anexo assinado.
//
// A REGRA QUE GOVERNA TUDO AQUI é a assinatura:
//
//   ABERTA   (data_fechamento IS NULL)  as subseções CALCULADAS saem do banco a
//                                       cada abertura, e só o DIGITADO persiste;
//   FECHADA                             tudo vem de `rpcmtec.subsecao`,
//                                       congelado no instante do fechamento.
//
// O CONGELAMENTO SÓ ACONTECE NO FECHAMENTO, e nunca antes: gravada cedo, a
// edição envelheceria em silêncio no primeiro pedido corrigido. Antes do
// fechamento o banco manda; depois dele manda o que foi assinado. Sem congelar,
// uma edição antiga regerada hoje mostraria um número que ninguém leu, e nada
// diria qual foi o assinado.
//
// `conferirHoje` é o contrapeso: numa edição fechada ele recalcula as subseções
// calculadas e mostra a diferença contra o congelado. Sem ele, congelar seria
// esquecer.

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')
const { auditoriaCtrl } = require('../auditoria')

const rpcmtecCtrl = require('./rpcmtec_ctrl')
const estrutura = require('./rpcmtec_estrutura')

const controller = {}

// SQLSTATE de violação de UNIQUE. Traduz o erro cru de unique_edicao_ano_mes
// numa mensagem que diz o que houve.
const UNIQUE_VIOLATION = '23505'

const tratarErroEdicao = err => {
  if (err && err.code === UNIQUE_VIOLATION) {
    throw new AppError(
      'Já existe uma edição do RPCMTec para este ano e mês',
      httpCode.Conflict,
      err
    )
  }
  throw err
}

// O assinante sai do CADASTRO, e não de um nome redigitado a cada edição. O
// bloco de assinatura do PDF é montado destes três campos.
const CAMPOS = `e.id, e.ano, e.mes, e.assinante_uuid, e.data_assinatura,
                e.data_fechamento, e.usuario_fechamento_uuid,
                u.nome AS assinante_nome, pg.nome_abrev AS assinante_posto,
                -- O posto por EXTENSO é o que o bloco de assinatura imprime
                -- ("FELIPE DE CARVALHO DINIZ - Major"); o abreviado serve à
                -- tela, que tem menos espaço.
                pg.nome AS assinante_posto_extenso,
                e.data_cadastramento, e.usuario_cadastramento_uuid,
                e.data_modificacao, e.usuario_modificacao_uuid,
                (e.data_fechamento IS NOT NULL) AS fechada,
                (SELECT count(*)::int FROM rpcmtec.anexo_edicao a
                  WHERE a.edicao_id = e.id) AS anexos`

const DE_EDICAO = `FROM rpcmtec.edicao AS e
                   LEFT JOIN dgeo.usuario AS u ON u.uuid = e.assinante_uuid
                   LEFT JOIN dominio.tipo_posto_grad AS pg
                     ON pg.code = u.tipo_posto_grad_id`

controller.listar = async (filtros = {}) => {
  return db.conn.any(
    `SELECT ${CAMPOS} ${DE_EDICAO}
     WHERE ($<ano> IS NULL OR e.ano = $<ano>)
     ORDER BY e.ano DESC, e.mes DESC`,
    { ano: filtros.ano != null ? filtros.ano : null }
  )
}

controller.getPorId = async id => {
  const edicao = await db.conn.oneOrNone(
    `SELECT ${CAMPOS} ${DE_EDICAO} WHERE e.id = $<id>`, { id }
  )
  if (!edicao) {
    throw new AppError('Edição do RPCMTec não encontrada', httpCode.NotFound)
  }
  return edicao
}

// Anos que já têm edição, para o seletor da tela não oferecer ano vazio.
controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM rpcmtec.edicao ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

// ---------------------------------------------------------------------------
// Montagem do documento
// ---------------------------------------------------------------------------

// As linhas gravadas de uma edição, indexadas pelo número da subseção.
const lerSubsecoes = async (conexao, edicaoId) => {
  const linhas = await conexao.any(
    `SELECT s.numero, s.ordem, s.secao_titulo, s.titulo, s.origem_id,
            o.nome AS origem, s.cabecalhos, s.linhas, s.texto, s.sem_ocorrencia
     FROM rpcmtec.subsecao AS s
     INNER JOIN dominio.origem_subsecao AS o ON o.code = s.origem_id
     WHERE s.edicao_id = $<edicaoId>
     ORDER BY s.ordem`,
    { edicaoId }
  )
  return new Map(linhas.map(l => [l.numero, l]))
}

// A grade de coluna NÃO é gravada, e a razão é que ela é apresentação pura: o
// que a edição fechada precisa provar é o que o documento DISSE, não com que
// largura. Ela sai da estrutura de hoje quando o número de colunas bate, e cai
// na divisão por igual quando não bate -- que é o caso de uma edição fechada
// numa estrutura antiga, em que a subseção tinha outro número de colunas.
const gradeDe = (numero, cabecalhos) => {
  const b = estrutura.bloco(numero)
  if (b && b.grade && cabecalhos && b.grade.length === cabecalhos.length) {
    return b.grade
  }
  return null
}

// Uma subseção DIGITADA está preenchida quando alguém a visitou: gravou linha,
// escreveu prosa ou declarou que não houve ocorrência. A AUSÊNCIA é
// informação, e é o que o fechamento recusa.
const foiPreenchida = gravada =>
  Boolean(gravada) &&
  (gravada.sem_ocorrencia ||
    (Array.isArray(gravada.linhas) && gravada.linhas.length > 0) ||
    (gravada.texto != null && gravada.texto !== ''))

/**
 * Monta o documento inteiro de uma edição.
 *
 * Aberta: o calculado vem do banco agora, o digitado vem de `rpcmtec.subsecao`,
 * o fixo vem da estrutura. Fechada: TUDO vem de `rpcmtec.subsecao`, e a
 * estrutura só é consultada para a grade de coluna.
 *
 * @param {number} id
 * @returns {Promise<Object>} { ...edicao, pendentes, secoes }
 */
controller.montar = async id => {
  const edicao = await controller.getPorId(id)
  const gravadas = await lerSubsecoes(db.conn, id)

  // Só calcula quando a edição está ABERTA. Numa fechada, recalcular seria
  // trabalho jogado fora e, pior, convidaria alguém a comparar sem perceber
  // que está olhando dois números diferentes.
  const calculadas = edicao.fechada
    ? {}
    : await rpcmtecCtrl.calcular({ ano: edicao.ano, mes: edicao.mes })

  // A edição FECHADA se desenha com a estrutura QUE ELA TEVE, e não com a de
  // hoje: entre janeiro e julho de 2026 o RPCMTec passou de seis para nove
  // seções, e toda a numeração anterior mudou de lugar.
  const blocos = edicao.fechada
    ? [...gravadas.values()].map(g => ({
        numero: g.numero,
        ordem: g.ordem,
        secaoTitulo: g.secao_titulo,
        titulo: g.titulo,
        origem: g.origem_id,
        origemNome: g.origem,
        cabecalhos: g.cabecalhos,
        linhas: g.linhas,
        texto: g.texto,
        semOcorrencia: g.sem_ocorrencia,
        // Uma fechada não tem pendência: o fechamento não deixa fechar com
        // buraco.
        preenchida: true
      }))
    : estrutura.BLOCOS.map(b => {
        const gravada = gravadas.get(b.numero)

        if (b.origem === estrutura.ORIGEM.FIXA) {
          return { ...paraSaida(b), texto: b.conteudo, preenchida: true }
        }

        if (b.origem === estrutura.ORIGEM.CALCULADA) {
          const semGerador = calculadas[b.numero] === undefined
          const linhas = calculadas[b.numero] || []

          return {
            ...paraSaida(b),
            linhas,
            // Subseção declarada calculada sem implementação no gerador é
            // lacuna, e aparece como tal em vez de sair como tabela vazia.
            semGerador,
            // O GERADOR RODOU E NÃO ACHOU NADA. É a outra lacuna, e tem de
            // aparecer como lacuna: tabela vazia num documento assinado AFIRMA
            // "não houve", quando o que houve foi ninguém ter cadastrado.
            //
            // As duas causas ficam SEPARADAS: sem gerador, não há tabela vazia
            // a reportar, porque a causa já está dita e o conserto é outro
            // (implementar o gerador, e não cadastrar o dado).
            semLinhas: !semGerador && linhas.length === 0,
            // `preenchida` NÃO muda de sentido, e é deliberado. Ela responde
            // "alguém visitou esta subseção?", pergunta que só a DIGITADA
            // aceita: uma calculada não se preenche à mão, então marcá-la
            // pendente travaria o fechamento sem saída nenhuma. A lacuna sai
            // nos campos acima e em `lacunasCalculadas`.
            preenchida: true
          }
        }

        return {
          ...paraSaida(b),
          linhas: gravada ? gravada.linhas : null,
          texto: gravada ? gravada.texto : null,
          semOcorrencia: gravada ? gravada.sem_ocorrencia : false,
          preenchida: foiPreenchida(gravada)
        }
      })

  const pendentes = blocos.filter(b => !b.preenchida).map(b => b.numero)

  // AS DUAS LISTAS SÃO DIFERENTES, e a diferença é quem conserta.
  //
  //   `pendentes`          o gestor preenche, e o fechamento RECUSA sem isso;
  //   `lacunasCalculadas`  o banco preenche, e o fechamento AVISA.
  //
  // Recusar aqui travaria a edição: quem vê a 6.1 vazia não tem botão nenhum
  // que a preencha. Calar seria pior, que é o defeito de origem. Numa edição
  // FECHADA a lista sai vazia: o congelado é o que foi assinado, e o que o
  // banco diria hoje é assunto do `conferirHoje`.
  const lacunasCalculadas = blocos
    .filter(b => b.semGerador || b.semLinhas)
    .map(b => b.numero)

  return {
    ...edicao,
    pendentes,
    lacunasCalculadas,
    secoes: agruparPorSecao(blocos)
  }
}

// Os campos que a estrutura empresta a um bloco em construção.
const paraSaida = b => ({
  numero: b.numero,
  ordem: b.ordem,
  secaoTitulo: b.secaoTitulo,
  titulo: b.titulo,
  origem: b.origem,
  fonte: b.fonte || null,
  cabecalhos: b.cabecalhos || null,
  ehTexto: Boolean(b.texto)
})

// Agrupa a lista plana em seções, preservando a ordem. A grade entra aqui, uma
// vez por subseção, para o PDF não ter de consultar a estrutura de novo.
const agruparPorSecao = blocos => {
  const secoes = []
  let atual = null

  for (const b of [...blocos].sort((x, y) => x.ordem - y.ordem)) {
    if (!atual || atual.titulo !== b.secaoTitulo) {
      atual = { titulo: b.secaoTitulo, subsecoes: [] }
      secoes.push(atual)
    }
    atual.subsecoes.push({ ...b, grade: gradeDe(b.numero, b.cabecalhos) })
  }

  return secoes
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const criada = await t
      .one(
        `INSERT INTO rpcmtec.edicao
           (ano, mes, assinante_uuid, data_assinatura, usuario_cadastramento_uuid)
         VALUES ($<ano>, $<mes>, $<assinanteUuid>, $<dataAssinatura>, $<usuarioUuid>)
         RETURNING *`,
        {
          ano: dados.ano,
          mes: dados.mes,
          assinanteUuid: dados.assinante_uuid || null,
          dataAssinatura: dados.data_assinatura || null,
          usuarioUuid
        }
      )
      .catch(tratarErroEdicao)

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

// Muda só o metadado. O CONTEÚDO nunca passa por aqui: subseção se grava em
// `rpcmtec_subsecao_ctrl`, e edição fechada se reabre antes de mudar de ideia.
//
// O assinante e a data de assinatura CONTINUAM editáveis com a edição fechada,
// e é deliberado: o documento é assinado DEPOIS de fechado, e é justamente aí
// que essas duas informações chegam. O que o fechamento congela é o que o
// relatório afirma, não quem o assinou.
controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.edicao', id, 'Edição do RPCMTec'
    )

    const depois = await t
      .one(
        `UPDATE rpcmtec.edicao SET
           ano = $<ano>, mes = $<mes>, assinante_uuid = $<assinanteUuid>,
           data_assinatura = $<dataAssinatura>,
           data_modificacao = $<dataModificacao>,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id,
          ano: dados.ano,
          mes: dados.mes,
          assinanteUuid: dados.assinante_uuid || null,
          dataAssinatura: dados.data_assinatura || null,
          dataModificacao: new Date(),
          usuarioUuid
        }
      )
      .catch(tratarErroEdicao)

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
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

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.edicao', id, 'Edição do RPCMTec'
    )

    // Apagar uma edição FECHADA apaga o documento que foi assinado, e o anexo
    // junto (o CASCADE leva subseção e anexo). Reabrir primeiro é um gesto
    // explícito, e é o que se quer exigir de quem vai fazer isso.
    if (antes.data_fechamento) {
      throw new AppError(
        'Edição fechada não pode ser excluída. Reabra-a primeiro.',
        httpCode.BadRequest
      )
    }

    await t.none('DELETE FROM rpcmtec.edicao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

// ---------------------------------------------------------------------------
// Fechamento e reabertura
// ---------------------------------------------------------------------------

/**
 * Congela a edição.
 *
 * Materializa os 34 blocos em `rpcmtec.subsecao`, inclusive os calculados, e
 * carimba `data_fechamento`. A partir daí o documento não muda quando o banco
 * mudar.
 *
 * RECUSA com subseção digitada por visitar. Preencher ou declarar "sem
 * ocorrência" são as duas saídas, e a diferença entre elas é o que separa "não
 * houve" de "ninguém preencheu".
 *
 * AVISA da subseção calculada que saiu vazia, em `lacunas`, sem recusar por
 * causa dela: o gestor não tem como preenchê-la à mão, e o conserto é cadastrar
 * o dado na origem.
 */
controller.fechar = async (id, usuarioUuid, contexto) => {
  const montada = await controller.montar(id)

  if (montada.fechada) {
    throw new AppError('A edição já está fechada', httpCode.BadRequest)
  }

  if (montada.pendentes.length > 0) {
    throw new AppError(
      'Faltam subseções por preencher: ' + montada.pendentes.join(', ') +
      '. Preencha cada uma ou marque "sem ocorrência no mês".',
      httpCode.BadRequest
    )
  }

  // Sem assinante, o PDF sairia com o bloco de assinatura em branco. Quem vai
  // assinar se sabe antes de fechar.
  if (!montada.assinante_uuid) {
    throw new AppError(
      'Informe o assinante da edição antes de fechá-la',
      httpCode.BadRequest
    )
  }

  const blocos = montada.secoes.flatMap(s => s.subsecoes)

  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.edicao', id, 'Edição do RPCMTec'
    )

    // A RECLAMAÇÃO DO FECHAMENTO, e ela vem PRIMEIRO.
    //
    // As conferências acima (fechada, pendentes, assinante) rodam FORA desta
    // transação, porque `montar` faz cálculo pesado (18 consultas) e segurar a
    // conexão por todo ele seria pior. O preço era um TOCTOU: dois pedidos
    // simultâneos passavam os dois pela conferência, e o `ON CONFLICT DO UPDATE`
    // abaixo escondia o estrago (a segunda regravava o mesmo). O que NÃO se
    // escondia era o rastro: nasciam DOIS eventos de fechamento para um
    // fechamento só, e o histórico passava a mentir sobre quem fechou.
    //
    // O `AND data_fechamento IS NULL` fecha o buraco sem mover o cálculo. Ele
    // trava a LINHA: o segundo pedido espera o primeiro terminar, relê a linha e
    // não casa mais nenhuma. `oneOrNone` devolve nulo, o erro sobe e a transação
    // inteira volta atrás, inclusive as subseções que ela já tinha gravado.
    const depois = await t.oneOrNone(
      `UPDATE rpcmtec.edicao
       SET data_fechamento = now(), usuario_fechamento_uuid = $<usuarioUuid>
       WHERE id = $<id> AND data_fechamento IS NULL
       RETURNING *`,
      { id, usuarioUuid }
    )

    if (!depois) {
      throw new AppError('A edição já está fechada', httpCode.BadRequest)
    }

    for (const b of blocos) {
      await t.none(
        `INSERT INTO rpcmtec.subsecao
           (edicao_id, numero, ordem, secao_titulo, titulo, origem_id,
            cabecalhos, linhas, texto, sem_ocorrencia,
            usuario_cadastramento_uuid)
         VALUES ($<edicaoId>, $<numero>, $<ordem>, $<secaoTitulo>, $<titulo>,
                 $<origem>, $<cabecalhos>, $<linhas>, $<texto>,
                 $<semOcorrencia>, $<usuarioUuid>)
         ON CONFLICT (edicao_id, numero) DO UPDATE SET
           ordem = EXCLUDED.ordem,
           secao_titulo = EXCLUDED.secao_titulo,
           titulo = EXCLUDED.titulo,
           origem_id = EXCLUDED.origem_id,
           cabecalhos = EXCLUDED.cabecalhos,
           linhas = EXCLUDED.linhas,
           texto = EXCLUDED.texto,
           sem_ocorrencia = EXCLUDED.sem_ocorrencia,
           data_modificacao = now(),
           usuario_modificacao_uuid = $<usuarioUuid>`,
        {
          edicaoId: id,
          numero: b.numero,
          ordem: b.ordem,
          secaoTitulo: b.secaoTitulo,
          // O título da 1.1 é nulo na estrutura (lá ela é o próprio
          // parágrafo), e a coluna é NOT NULL: o número serve de rótulo.
          titulo: b.titulo || b.numero,
          origem: b.origem,
          cabecalhos: b.cabecalhos ? JSON.stringify(b.cabecalhos) : null,
          linhas: b.cabecalhos ? JSON.stringify(b.linhas || []) : null,
          texto: b.cabecalhos ? null : (b.texto || null),
          semOcorrencia: Boolean(b.semOcorrencia),
          usuarioUuid
        }
      )
    }

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    // As lacunas VÃO NO RETORNO, e não param o fechamento. Quem congela tem de
    // saber que a 6.1 foi congelada vazia: o documento assinado passa a
    // afirmar isso, e depois do fechamento só a reabertura desfaz.
    return { id, subsecoes: blocos.length, lacunas: montada.lacunasCalculadas }
  })
}

/**
 * Descongela a edição.
 *
 * Apaga as subseções CALCULADAS e a FIXA, e preserva as DIGITADAS: elas são o
 * trabalho do gestor, e reabrir para corrigir um número do banco não é razão
 * para ele redigitar as quinze. O calculado volta a sair do banco.
 */
controller.reabrir = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'rpcmtec.edicao', id, 'Edição do RPCMTec'
    )

    if (!antes.data_fechamento) {
      throw new AppError('A edição já está aberta', httpCode.BadRequest)
    }

    await t.none(
      `DELETE FROM rpcmtec.subsecao
       WHERE edicao_id = $<id> AND origem_id <> $<digitada>`,
      { id, digitada: estrutura.ORIGEM.DIGITADA }
    )

    // `AND data_fechamento IS NOT NULL`, o espelho da guarda de `fechar`. O
    // `lerAntes` acima é um SELECT simples e não trava a linha: duas reaberturas
    // simultâneas passavam as duas pelo `if`, e a segunda gerava um segundo
    // evento de reabertura para uma reabertura só. A condição no UPDATE trava a
    // linha e desempata no banco.
    const depois = await t.oneOrNone(
      `UPDATE rpcmtec.edicao
       SET data_fechamento = NULL, usuario_fechamento_uuid = NULL,
           data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id> AND data_fechamento IS NOT NULL
       RETURNING *`,
      { id, usuarioUuid }
    )

    if (!depois) {
      throw new AppError('A edição já está aberta', httpCode.BadRequest)
    }

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.edicao',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id }
  })
}

/**
 * O que o banco diria HOJE, ao lado do que a edição fechada diz.
 *
 * É o contrapeso do congelamento. Um pedido de março corrigido em agosto não
 * muda a edição de março, e está certo: ela é o que foi assinado. Mas a
 * divergência ficaria invisível, e é isso que esta comparação desfaz. É o mesmo
 * instrumento do diff entre revisões do PIT.
 *
 * SÓ AS CALCULADAS entram: as digitadas não têm com que comparar, porque o
 * banco não as produz.
 */
controller.conferirHoje = async id => {
  const edicao = await controller.getPorId(id)

  if (!edicao.fechada) {
    throw new AppError(
      'A conferência compara o congelado com o banco, e só existe em edição fechada',
      httpCode.BadRequest
    )
  }

  const gravadas = await lerSubsecoes(db.conn, id)
  const hoje = await rpcmtecCtrl.calcular({ ano: edicao.ano, mes: edicao.mes })

  const comparadas = []
  for (const numero of estrutura.NUMEROS_CALCULADOS) {
    const congelada = gravadas.get(numero)
    if (!congelada) continue

    const linhasHoje = hoje[numero] || []
    const linhasAntes = congelada.linhas || []

    comparadas.push({
      numero,
      titulo: congelada.titulo,
      cabecalhos: congelada.cabecalhos,
      igual: JSON.stringify(linhasAntes) === JSON.stringify(linhasHoje),
      congelado: linhasAntes,
      hoje: linhasHoje
    })
  }

  return {
    id,
    ano: edicao.ano,
    mes: edicao.mes,
    data_fechamento: edicao.data_fechamento,
    divergentes: comparadas.filter(c => !c.igual).map(c => c.numero),
    subsecoes: comparadas
  }
}

// ---------------------------------------------------------------------------
// Anexo: o RPCMTec assinado
// ---------------------------------------------------------------------------

// Mesma forma do anexo da revisão do PIT: os bytes vivem na linha, e a lista
// nunca os traz. `conteudo` só sai no download.
const COLUNAS_ANEXO = `a.id, a.edicao_id, a.nome_original, a.extensao,
                       a.mimetype, a.tamanho_bytes, a.descricao,
                       a.data_cadastramento, a.usuario_cadastramento_uuid`

controller.listarAnexos = async edicaoId => {
  return db.conn.any(
    `SELECT ${COLUNAS_ANEXO} FROM rpcmtec.anexo_edicao AS a
     WHERE a.edicao_id = $<edicaoId> ORDER BY a.id DESC`,
    { edicaoId }
  )
}

controller.criarAnexo = async (edicaoId, arquivo, dados, usuarioUuid, contexto) => {
  if (!arquivo) {
    throw new AppError('Envie o arquivo do RPCMTec assinado', httpCode.BadRequest)
  }

  return db.conn.tx(async t => {
    const existe = await t.oneOrNone(
      'SELECT id FROM rpcmtec.edicao WHERE id = $<edicaoId>', { edicaoId }
    )
    if (!existe) {
      throw new AppError('Edição do RPCMTec não encontrada', httpCode.NotFound)
    }

    const extensao = (arquivo.originalname.match(/\.[^.]+$/) || [''])[0].toLowerCase()

    const criado = await t.one(
      `INSERT INTO rpcmtec.anexo_edicao
         (edicao_id, nome_original, extensao, mimetype, tamanho_bytes,
          conteudo, descricao, usuario_cadastramento_uuid)
       VALUES ($<edicaoId>, $<nome>, $<extensao>, $<mimetype>, $<tamanho>,
               $<conteudo>, $<descricao>, $<usuarioUuid>)
       RETURNING id, edicao_id, nome_original, extensao, mimetype,
                 tamanho_bytes, descricao`,
      {
        edicaoId,
        nome: arquivo.originalname,
        extensao,
        mimetype: arquivo.mimetype || null,
        tamanho: arquivo.size,
        conteudo: arquivo.buffer,
        descricao: dados.descricao || null,
        usuarioUuid
      }
    )

    // O rastro NÃO leva `conteudo`: o RETURNING acima já o omite. Um evento de
    // auditoria com o PDF dentro guardaria o arquivo duas vezes, e o que
    // interessa é que o anexo entrou.
    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.anexo_edicao',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })

    return { id: criado.id }
  })
}

controller.getAnexoParaDownload = async id => {
  const anexo = await db.conn.oneOrNone(
    `SELECT nome_original, extensao, mimetype, tamanho_bytes, conteudo
     FROM rpcmtec.anexo_edicao WHERE id = $<id>`,
    { id }
  )
  if (!anexo) {
    throw new AppError('Anexo não encontrado', httpCode.NotFound)
  }
  return anexo
}

controller.deletarAnexo = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await t.oneOrNone(
      `SELECT id, edicao_id, nome_original, extensao, mimetype, tamanho_bytes,
              descricao
       FROM rpcmtec.anexo_edicao WHERE id = $<id>`,
      { id }
    )
    if (!antes) {
      throw new AppError('Anexo não encontrado', httpCode.NotFound)
    }

    await t.none('DELETE FROM rpcmtec.anexo_edicao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.anexo_edicao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
