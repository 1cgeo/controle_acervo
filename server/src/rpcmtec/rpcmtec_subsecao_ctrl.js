'use strict'

// O que o GESTOR digita no RPCMTec.
//
// Catorze dos 33 blocos do documento o SCA não sabe calcular, e eles são
// preenchidos aqui, e não no Word. Onze vêm de outro
// sistema ou de fora (2.2 a 2.5 do SAP, 5.1 do painel do GitHub, 8.3 do
// doc_dgeo) e quatro não têm cadastro em lugar nenhum (5.2, 7.1, 8.1 a 8.5,
// 9.1 a 9.3).
//
// AS COLUNAS NÃO SE INVENTAM. O gestor preenche LINHAS numa grade de cabeçalho
// fixo, medido no documento da Divisão. Deixá-lo desenhar a tabela produziria
// uma coluna diferente por mês, e o RPCMTec deixaria de ser comparável consigo
// mesmo.
//
// DUAS AÇÕES cobrem o trabalho repetitivo. `sem_ocorrencia` separa "não houve"
// de "ninguém preencheu" -- distinção que o documento em Word não fazia, porque
// as duas saíam como célula vazia. E a IMPORTAÇÃO DO CSV da 5.1, que traz do
// github_dashboard o repositório, o número de commits e o efetivo, em vez de
// transcrever à mão o que a máquina já sabe. Ela preserva o Resumo já escrito.
//
// NÃO SE TRAZ CONTEÚDO DA EDIÇÃO ANTERIOR, desde 2026-08-06. Havia aqui uma
// ação que copiava as subseções digitadas do mês passado para esta edição. Ela
// saiu inteira, com a rota e o schema. O RPCMTec é o relatório DAQUELE mês, e o
// que a cópia produzia era pior que redigitar: o documento assinado afirmava
// sobre agosto o que aconteceu em julho, e a linha que chega pronta não é
// relida. Cada subseção se preenche pelo mês que ela reporta.
//
// SÓ COM A EDIÇÃO ABERTA. Fechada, o documento é o que foi assinado; para
// mudá-lo, reabre-se primeiro, e isso fica no rastro.

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')
const { auditoriaCtrl } = require('../auditoria')

const estrutura = require('./rpcmtec_estrutura')
const csvRepositorios = require('./rpcmtec_csv_repositorios')

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
 * Importa o CSV do github_dashboard para a subseção 5.1.
 *
 * POR QUE NO SERVIDOR, e não na tela que oferece o botão. Ler o CSV é REGRA DE
 * DADO, e ela decide o que se apaga: casar linha por repositório e preservar o
 * Resumo é o que separa "atualizar os commits" de "destruir o texto que alguém
 * escreveu". Posta só no cliente, a regra não valeria para o `producao_cli`, que
 * é por onde um agente com o CSV na mão faria a mesma coisa, e a segunda
 * implementação divergiria da primeira na primeira correção aplicada a uma só.
 * Aqui a leitura, o cruzamento e a gravação cabem numa transação: ninguém lê o
 * estado, pensa, e grava por cima do que mudou no meio.
 *
 * O RESUMO NÃO VEM DO CSV, e sim do que já está gravado. Ver
 * `rpcmtec_csv_repositorios.js`, que faz a conta sem tocar no banco.
 *
 * `confirmar_remocao` é o "eu li a lista". Sem ele, a rota responde 409 quando a
 * importação removeria um repositório com Resumo escrito. É a mesma forma do
 * `ciente_revisao` do fechamento, e existe pela mesma razão: a recusa mora no
 * servidor, então ela vale para o CLI também, e não só para quem passa pela
 * tela.
 */
controller.importarRepositorios = async (edicaoId, dados, usuarioUuid, contexto) => {
  const numero = csvRepositorios.NUMERO

  let leitura
  try {
    leitura = csvRepositorios.analisar(dados.csv)
  } catch (erro) {
    // A falha do arquivo é da PESSOA, e a frase já ensina o conserto: ela sobe
    // como 400 com o texto inteiro, e não vira 500 com "erro interno".
    if (erro instanceof csvRepositorios.ErroCsv) {
      throw new AppError(erro.message, httpCode.BadRequest)
    }
    throw erro
  }

  return db.conn.tx(async t => {
    const { bloco } = await conferirAlvo(t, edicaoId, numero)

    const antes = await t.oneOrNone(
      `SELECT id, edicao_id, numero, linhas, texto, sem_ocorrencia
       FROM rpcmtec.subsecao WHERE edicao_id = $<edicaoId> AND numero = $<numero>`,
      { edicaoId, numero }
    )

    const plano = csvRepositorios.planejar(
      (antes && antes.linhas) || [], leitura.repositorios
    )

    const comResumo = plano.removidos.filter(r => r.resumo)
    if (comResumo.length && !dados.confirmar_remocao) {
      throw new AppError(
        `Este CSV não traz ${comResumo.length} repositório(s) que já têm ` +
        `Resumo escrito na 5.1: ${comResumo.map(r => r.repo || '(linha sem nome)').join(', ')}. ` +
        'Importar assim apaga esse texto, que não existe em lugar nenhum mais. ' +
        'Confira o mês escolhido na exportação. Para importar mesmo assim, ' +
        'confirme a remoção.',
        httpCode.Conflict
      )
    }

    // A importação DESMARCA "sem ocorrência no mês": a tabela passa a ter
    // conteúdo, e o CHECK do banco recusa as duas coisas juntas.
    const depois = await gravarLinha(t, {
      edicaoId,
      bloco,
      linhas: conferirLinhas(bloco, plano.linhas),
      texto: null,
      semOcorrencia: false,
      usuarioUuid
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

    return {
      numero,
      total: plano.linhas.length,
      novos: plano.novos,
      atualizados: plano.atualizados,
      // O TEXTO do Resumo removido não volta na resposta: quem precisa dele é a
      // confirmação, que já o citou pelo nome do repositório.
      removidos: plano.removidos.map(r => ({
        repositorio: r.repo, tinha_resumo: Boolean(r.resumo)
      })),
      resumos_preservados: plano.resumosPreservados,
      avisos: leitura.avisos
    }
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

module.exports = controller
