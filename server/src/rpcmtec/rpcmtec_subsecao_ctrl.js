'use strict'

// O que o GESTOR digita no RPCMTec.
//
// Quinze dos 34 blocos do documento o SCA não sabe calcular, e desde
// 2026-08-05 eles são preenchidos aqui, e não no Word. Onze vêm de outro
// sistema ou de fora (2.2 a 2.5 do SAP, 5.1 do painel do GitHub, 8.3 do
// doc_dgeo) e quatro não têm cadastro em lugar nenhum (5.2, 7.1, 8.1 a 8.5,
// 9.1 a 9.3).
//
// AS COLUNAS NÃO SE INVENTAM. O gestor preenche LINHAS numa grade de cabeçalho
// fixo, medido no documento da Divisão. Deixá-lo desenhar a tabela produziria
// uma coluna diferente por mês, e o RPCMTec deixaria de ser comparável consigo
// mesmo.
//
// DUAS AÇÕES cobrem o trabalho repetitivo, e existem por medição no documento
// real: `copiarDoMesAnterior` (a edição de julho/2026 traz um GPS indisponível
// desde 26/07/2023, redigitado mês a mês) e `sem_ocorrencia`, que separa "não
// houve" de "ninguém preencheu" -- distinção que o documento em Word não fazia,
// porque as duas saíam como célula vazia.
//
// SÓ COM A EDIÇÃO ABERTA. Fechada, o documento é o que foi assinado; para
// mudá-lo, reabre-se primeiro, e isso fica no rastro.

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')
const { auditoriaCtrl } = require('../auditoria')

const estrutura = require('./rpcmtec_estrutura')

const controller = {}

// A edição, com o bloco da estrutura ao lado, conferindo as duas coisas que
// toda escrita aqui exige: que a edição esteja aberta e que o número seja de
// uma subseção que o gestor preenche.
const conferirAlvo = async (conexao, edicaoId, numero) => {
  const edicao = await conexao.oneOrNone(
    'SELECT id, ano, mes, data_fechamento FROM rpcmtec.edicao WHERE id = $<edicaoId>',
    { edicaoId }
  )
  if (!edicao) {
    throw new AppError('Edição do RPCMTec não encontrada', httpCode.NotFound)
  }
  if (edicao.data_fechamento) {
    throw new AppError(
      'A edição está fechada. Reabra-a para alterar o conteúdo.',
      httpCode.BadRequest
    )
  }

  const bloco = estrutura.bloco(numero)
  if (!bloco) {
    throw new AppError(
      `A subseção ${numero} não existe no RPCMTec`, httpCode.NotFound
    )
  }
  if (bloco.origem !== estrutura.ORIGEM.DIGITADA) {
    throw new AppError(
      `A subseção ${numero} é ${bloco.origem === estrutura.ORIGEM.FIXA ? 'texto fixo' : 'calculada pelo sistema'} ` +
      'e não se preenche à mão',
      httpCode.BadRequest
    )
  }

  return { edicao, bloco }
}

// A grade tem cabeçalho fixo, então toda linha tem o mesmo número de células.
// Sem esta conferência, uma linha curta sairia com célula faltando no PDF e o
// desenhador escolheria por conta o que fazer com a coluna sobrando.
const conferirLinhas = (bloco, linhas) => {
  if (!Array.isArray(linhas)) {
    throw new AppError('As linhas devem ser uma lista', httpCode.BadRequest)
  }

  const esperado = bloco.cabecalhos.length
  linhas.forEach((linha, i) => {
    if (!Array.isArray(linha) || linha.length !== esperado) {
      throw new AppError(
        `A linha ${i + 1} da subseção ${bloco.numero} tem ` +
        `${Array.isArray(linha) ? linha.length : 0} células, e a tabela tem ${esperado} colunas`,
        httpCode.BadRequest
      )
    }
  })

  // Célula sempre em TEXTO, como o cálculo também as entrega. Número cru aqui
  // faria a mesma coluna sair formatada de um jeito quando calculada e de
  // outro quando digitada.
  return linhas.map(linha =>
    linha.map(celula => (celula == null ? '' : String(celula)))
  )
}

// Grava a linha na `rpcmtec.subsecao`, dentro de uma transação já aberta.
const gravarLinha = async (t, { edicaoId, bloco, linhas, texto, semOcorrencia, usuarioUuid }) =>
  t.one(
    `INSERT INTO rpcmtec.subsecao
       (edicao_id, numero, ordem, secao_titulo, titulo, origem_id,
        cabecalhos, linhas, texto, sem_ocorrencia, usuario_cadastramento_uuid)
     VALUES ($<edicaoId>, $<numero>, $<ordem>, $<secaoTitulo>, $<titulo>,
             $<origem>, $<cabecalhos>, $<linhas>, $<texto>, $<semOcorrencia>,
             $<usuarioUuid>)
     ON CONFLICT (edicao_id, numero) DO UPDATE SET
       ordem = EXCLUDED.ordem,
       secao_titulo = EXCLUDED.secao_titulo,
       titulo = EXCLUDED.titulo,
       cabecalhos = EXCLUDED.cabecalhos,
       linhas = EXCLUDED.linhas,
       texto = EXCLUDED.texto,
       sem_ocorrencia = EXCLUDED.sem_ocorrencia,
       data_modificacao = now(),
       usuario_modificacao_uuid = $<usuarioUuid>
     RETURNING id, edicao_id, numero, linhas, texto, sem_ocorrencia`,
    {
      edicaoId,
      numero: bloco.numero,
      ordem: bloco.ordem,
      secaoTitulo: bloco.secaoTitulo,
      titulo: bloco.titulo || bloco.numero,
      origem: estrutura.ORIGEM.DIGITADA,
      cabecalhos: bloco.cabecalhos ? JSON.stringify(bloco.cabecalhos) : null,
      linhas: bloco.cabecalhos ? JSON.stringify(linhas || []) : null,
      texto: bloco.cabecalhos ? null : (texto || null),
      semOcorrencia: Boolean(semOcorrencia),
      usuarioUuid
    }
  )

/**
 * Grava o conteúdo de uma subseção digitada.
 *
 * Tabela recebe `linhas`; prosa recebe `texto`. `sem_ocorrencia` declara o
 * vazio POR DECISÃO, e o CHECK do banco recusa marcá-lo com conteúdo dentro.
 */
controller.gravar = async (edicaoId, numero, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const { bloco } = await conferirAlvo(t, edicaoId, numero)

    const semOcorrencia = Boolean(dados.sem_ocorrencia)
    const linhas = bloco.cabecalhos && !semOcorrencia
      ? conferirLinhas(bloco, dados.linhas || [])
      : []
    const texto = semOcorrencia ? null : (dados.texto || null)

    const antes = await t.oneOrNone(
      `SELECT id, edicao_id, numero, linhas, texto, sem_ocorrencia
       FROM rpcmtec.subsecao WHERE edicao_id = $<edicaoId> AND numero = $<numero>`,
      { edicaoId, numero }
    )

    const depois = await gravarLinha(t, {
      edicaoId, bloco, linhas, texto, semOcorrencia, usuarioUuid
    })

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.subsecao',
      registroId: depois.id,
      operacao: antes ? 'U' : 'I',
      antes: antes || undefined,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: depois.id, numero }
  })
}

/**
 * Apaga o conteúdo digitado de uma subseção.
 *
 * A subseção volta a NÃO EXISTIR, que não é o mesmo que ficar vazia: sem linha,
 * ela conta como não visitada e o fechamento a cobra. É a saída para quem
 * marcou "sem ocorrência" por engano num mês em que houve.
 */
controller.limpar = async (edicaoId, numero, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await conferirAlvo(t, edicaoId, numero)

    const antes = await t.oneOrNone(
      `SELECT id, edicao_id, numero, linhas, texto, sem_ocorrencia
       FROM rpcmtec.subsecao WHERE edicao_id = $<edicaoId> AND numero = $<numero>`,
      { edicaoId, numero }
    )
    if (!antes) return { numero, removida: false }

    await t.none(
      'DELETE FROM rpcmtec.subsecao WHERE id = $<id>', { id: antes.id }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'rpcmtec.subsecao',
      registroId: antes.id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })

    return { numero, removida: true }
  })
}

// O mês anterior ao da edição, virando o ano em janeiro.
const mesAnterior = ({ ano, mes }) =>
  mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 }

/**
 * Copia o digitado da edição do mês anterior.
 *
 * Com `numero`, copia só aquela subseção; sem ele, copia todas as digitadas que
 * o mês anterior tinha. NÃO sobrescreve o que já foi preenchido nesta edição:
 * quem já digitou a 7.1 de agosto não quer a de julho por cima.
 *
 * O QUE ISTO RESOLVE é redigitação, não cadastro. As linhas que atravessam
 * meses (o equipamento parado, os itens de backup, os lotes em produção)
 * chegam prontas e se corrige o que mudou. Uma subseção cujo conteúdo é sempre
 * o mesmo é candidata a virar cadastro e GRADUAR para calculada, e a espinha
 * deixa isso ser uma mudança de `origem_id` mais tarde.
 */
controller.copiarDoMesAnterior = async (edicaoId, numero, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const edicao = await t.oneOrNone(
      'SELECT id, ano, mes, data_fechamento FROM rpcmtec.edicao WHERE id = $<edicaoId>',
      { edicaoId }
    )
    if (!edicao) {
      throw new AppError('Edição do RPCMTec não encontrada', httpCode.NotFound)
    }
    if (edicao.data_fechamento) {
      throw new AppError(
        'A edição está fechada. Reabra-a para alterar o conteúdo.',
        httpCode.BadRequest
      )
    }

    const anterior = mesAnterior(edicao)
    const origem = await t.oneOrNone(
      'SELECT id FROM rpcmtec.edicao WHERE ano = $<ano> AND mes = $<mes>',
      anterior
    )
    if (!origem) {
      throw new AppError(
        `Não existe edição de ${String(anterior.mes).padStart(2, '0')}/${anterior.ano} para copiar`,
        httpCode.NotFound
      )
    }

    const alvos = numero
      ? [numero]
      : estrutura.NUMEROS_DIGITADOS

    const jaPreenchidas = new Set(
      (await t.any(
        'SELECT numero FROM rpcmtec.subsecao WHERE edicao_id = $<edicaoId>',
        { edicaoId }
      )).map(l => l.numero)
    )

    const copiadas = []
    for (const alvo of alvos) {
      const bloco = estrutura.bloco(alvo)
      if (!bloco || bloco.origem !== estrutura.ORIGEM.DIGITADA) continue
      if (jaPreenchidas.has(alvo)) continue

      const fonte = await t.oneOrNone(
        `SELECT linhas, texto, sem_ocorrencia FROM rpcmtec.subsecao
         WHERE edicao_id = $<origemId> AND numero = $<alvo>`,
        { origemId: origem.id, alvo }
      )
      if (!fonte) continue

      const depois = await gravarLinha(t, {
        edicaoId,
        bloco,
        // Reconferido contra a estrutura de HOJE: a subseção pode ter ganhado
        // coluna desde o mês passado, e copiar linha curta gravaria no banco o
        // que a grade de agora não sabe desenhar.
        linhas: bloco.cabecalhos ? conferirLinhas(bloco, fonte.linhas || []) : [],
        texto: fonte.texto,
        semOcorrencia: fonte.sem_ocorrencia,
        usuarioUuid
      })

      await auditoriaCtrl.registrar(t, {
        tabela: 'rpcmtec.subsecao',
        registroId: depois.id,
        operacao: 'I',
        depois,
        usuarioUuid,
        contexto
      })

      copiadas.push(alvo)
    }

    return {
      de: `${String(anterior.mes).padStart(2, '0')}/${anterior.ano}`,
      copiadas,
      // Quem já estava preenchida NÃO foi tocada, e dizer isso evita que
      // alguém conclua que a cópia falhou.
      preservadas: alvos.filter(a => jaPreenchidas.has(a))
    }
  })
}

module.exports = controller
