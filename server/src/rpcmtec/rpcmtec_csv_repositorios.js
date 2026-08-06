'use strict'

// O CSV do github_dashboard virando as linhas da subseção 5.1.
//
// A 5.1 lista os repositórios trabalhados no mês. O número de commits e o
// efetivo saem prontos do painel (https://1cgeo.github.io/github_dashboard/),
// pelo botão "Dados Consolidados" ou pelo `dashboard_cli --formato csv`.
// Digitá-los à mão, um a um, é transcrever o que a máquina já sabe.
//
// O CSV TEM TRÊS COLUNAS E A TABELA TEM QUATRO. O `Resumo` descreve o que foi
// feito no repositório, e isso só uma pessoa escreve. A importação preenche as
// três primeiras e deixa o Resumo como está.
//
// REIMPORTAR É O USO NORMAL, e não a exceção: no fim do mês os commits mudaram,
// e a pessoa importa de novo. Por isso o casamento é pelo NOME DO REPOSITÓRIO, e
// o Resumo já escrito sobrevive. Uma importação que zerasse o Resumo destruiria,
// calada, o único conteúdo da tabela que não existe em lugar nenhum mais.
//
// O REPOSITÓRIO QUE SUMIU DO CSV SAI DA TABELA. A 5.1 reporta o que foi
// trabalhado NAQUELE período: manter a linha antiga faria o documento assinado
// afirmar commits que o painel não conta mais naquele mês. Sair calado seria o
// outro erro, então quem sai é NOMEADO, e o controlador exige confirmação quando
// a linha que sai tem Resumo escrito.
//
// ESTE MÓDULO NÃO TOCA O BANCO NEM O EXPRESS. Ele recebe texto e devolve
// matriz, para a regra do dado ter um lugar só e um teste que roda em segundos.

/** Falha que a pessoa conserta no arquivo. O controlador a traduz para 400. */
class ErroCsv extends Error {
  constructor (mensagem) {
    super(mensagem)
    this.name = 'ErroCsv'
  }
}

// A subseção que este importador serve. Ele não é genérico de propósito: o
// formato é o do github_dashboard, e o github_dashboard só alimenta a 5.1.
const NUMERO = '5.1'

// Posição de cada coluna na linha GRAVADA (rpcmtec_estrutura, subseção 5.1).
const COL = { REPO: 0, COMMITS: 1, EFETIVO: 2, RESUMO: 3 }

const CABECALHO_ESPERADO = 'Repositório,Número de commits,Efetivo'

// Como se pede o arquivo certo. Repetida em várias mensagens de recusa porque a
// mensagem que só diz o que está errado deixa a pessoa parada.
const ONDE_PEGAR =
  'Baixe "Dados Consolidados" na tela do github_dashboard, ou rode ' +
  '`dashboard_cli --formato csv`.'

/** Sem acento, sem caixa, sem espaço dobrado. É como se comparam rótulos. */
const chave = valor =>
  String(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

/**
 * Qual das três colunas este rótulo é, ou null.
 *
 * O CABEÇALHO DO CSV NÃO É O DA TABELA: o painel escreve "Número de commits" e
 * a 5.1 escreve "Número de commits no período". Exigir igualdade recusaria o
 * arquivo que o próprio sistema mandou gerar. Aceitam-se os dois, com e sem
 * acento, e a ordem das colunas não importa (o mapa é por nome).
 */
const colunaDe = rotulo => {
  const k = chave(rotulo)
  if (k === 'repositorio' || k === 'repo') return 'repo'
  if (k === 'commits' || k.startsWith('numero de commits')) return 'commits'
  if (k === 'efetivo') return 'efetivo'
  return null
}

/**
 * Uma linha de CSV em células, respeitando aspas.
 *
 * O gerador nunca põe aspas: ele une o efetivo por ponto e vírgula justamente
 * para não precisar delas. As aspas aparecem quando o arquivo passa pelo Excel,
 * que reescreve `Fulano, Beltrano` como `"Fulano, Beltrano"`.
 *
 * NÃO APARA aqui: o chamador decide, porque a última coluna às vezes é
 * remontada a partir das células sobrando, e aparar antes comeria o espaço que
 * vinha depois da vírgula.
 */
const celulas = linha => {
  const saida = []
  let atual = ''
  let dentro = false

  for (let i = 0; i < linha.length; i++) {
    const c = linha[i]
    if (dentro) {
      if (c !== '"') { atual += c } else if (linha[i + 1] === '"') { atual += '"'; i++ } else { dentro = false }
      continue
    }
    // Aspas só ABREM campo no começo dele. No meio de um texto elas são
    // literais, e tratá-las como delimitador engoliria o resto da linha.
    if (c === '"' && atual.trim() === '') { atual = ''; dentro = true; continue }
    if (c === ',') { saida.push(atual); atual = ''; continue }
    atual += c
  }
  saida.push(atual)
  return saida
}

/**
 * Quebra o texto em linhas úteis, guardando o número de cada uma.
 *
 * TRÊS SUJEIRAS SE LIMPAM SEM AVISAR, porque nenhuma delas carrega informação
 * que se possa perder: o BOM que o Excel escreve no início do arquivo, o fim de
 * linha CRLF do Windows e a linha em branco (que todo arquivo tem no fim).
 *
 * O número da linha é o do ARQUIVO, e não o da lista filtrada: ele existe para
 * a pessoa achar o erro no editor dela.
 */
const linhasUteis = texto => {
  const limpo = String(texto).replace(/^\uFEFF/, '')
  return limpo
    .split(/\r\n|\n|\r/)
    .map((conteudo, i) => ({ n: i + 1, conteudo }))
    .filter(l => l.conteudo.trim() !== '')
}

/** O começo da linha, para citá-la numa mensagem sem despejar o arquivo. */
const trecho = (conteudo, teto = 60) =>
  conteudo.length > teto ? `${conteudo.slice(0, teto)}...` : conteudo

/**
 * Lê o cabeçalho e devolve em que posição está cada coluna.
 *
 * RECUSA, em vez de adivinhar. Um cabeçalho que não se entende tem duas leituras
 * possíveis (é dado, ou é um cabeçalho diferente), e as duas perdem uma linha em
 * silêncio: tratá-lo como dado gravaria "Repositório" como nome de repositório,
 * e ignorá-lo jogaria fora um repositório de verdade.
 */
const lerCabecalho = ({ n, conteudo }) => {
  const cabecalhos = celulas(conteudo).map(c => c.trim())

  // O EXCEL EM PORTUGUÊS SALVA COM PONTO E VÍRGULA, e aqui isso é fatal: o ponto
  // e vírgula é o que separa os militares DENTRO da coluna Efetivo. Adivinhar o
  // separador partiria `Cap Fulano;Maj Beltrano` em duas colunas. Recusa-se.
  if (cabecalhos.length === 1 && conteudo.split(';').length >= 3) {
    throw new ErroCsv(
      'O arquivo separa as colunas por ponto e vírgula, e não por vírgula. ' +
      'É o que o Excel em português salva. No Excel, use "Salvar como" e ' +
      'escolha "CSV (separado por vírgulas)"; ou cole o texto do ' +
      '`dashboard_cli --formato csv`, que já sai certo. ' +
      'Aqui o ponto e vírgula separa os militares dentro da coluna Efetivo, ' +
      'então usá-lo como separador de coluna partiria o efetivo ao meio.'
    )
  }

  const posicao = {}
  const desconhecidas = []
  cabecalhos.forEach((rotulo, i) => {
    const coluna = colunaDe(rotulo)
    if (!coluna) { desconhecidas.push(rotulo || '(vazio)'); return }
    if (posicao[coluna] !== undefined) {
      throw new ErroCsv(
        `O cabeçalho repete a coluna "${rotulo}" (posições ` +
        `${posicao[coluna] + 1} e ${i + 1}). Cada coluna aparece uma vez. ` +
        `O cabeçalho esperado é: ${CABECALHO_ESPERADO}`
      )
    }
    posicao[coluna] = i
  })

  const achadas = Object.keys(posicao).length

  // NENHUMA coluna reconhecida: quase sempre é o arquivo sem cabeçalho, e não um
  // cabeçalho errado. A mensagem cita a linha para a pessoa ver o que ela mandou.
  if (achadas === 0) {
    throw new ErroCsv(
      `A linha ${n} deveria ser o cabeçalho, e não foi reconhecida: ` +
      `"${trecho(conteudo)}". A primeira linha do CSV é ` +
      `${CABECALHO_ESPERADO}. ${ONDE_PEGAR}`
    )
  }

  const faltando = ['repo', 'commits', 'efetivo']
    .filter(c => posicao[c] === undefined)
    .map(c => ({ repo: 'Repositório', commits: 'Número de commits', efetivo: 'Efetivo' }[c]))

  if (faltando.length) {
    throw new ErroCsv(
      `Falta no cabeçalho a coluna ${faltando.join(' e a coluna ')}.` +
      (desconhecidas.length
        ? ` Veio ${desconhecidas.map(d => `"${d}"`).join(' e ')}, que não é ` +
          'coluna desta tabela.'
        : '') +
      ` O cabeçalho esperado é: ${CABECALHO_ESPERADO}`
    )
  }

  if (desconhecidas.length) {
    throw new ErroCsv(
      `O cabeçalho traz ${desconhecidas.map(d => `"${d}"`).join(' e ')}, que ` +
      'não é coluna desta importação. O Resumo da 5.1 NÃO se importa: ele é ' +
      'escrito por pessoa, e a importação o preserva. ' +
      `O cabeçalho esperado é: ${CABECALHO_ESPERADO}`
    )
  }

  return { posicao, largura: cabecalhos.length }
}

/**
 * Lê o CSV do github_dashboard.
 *
 * @param {string} texto - o arquivo escolhido ou o texto colado
 * @returns {{repositorios: Array<{repo:string, commits:string, efetivo:string}>,
 *            avisos: Array<string>}}
 * @throws {ErroCsv} com a frase que ensina o conserto
 */
const analisar = texto => {
  const linhas = linhasUteis(texto)

  if (!linhas.length) {
    throw new ErroCsv(`O CSV está vazio. ${ONDE_PEGAR}`)
  }

  const { posicao, largura } = lerCabecalho(linhas[0])
  const dados = linhas.slice(1)

  // SÓ O CABEÇALHO. Aceitar isto gravaria a tabela vazia, e a tabela vazia
  // apagaria todo Resumo já escrito. Quem quer declarar que não houve trabalho
  // no mês tem o botão que existe para isso, e ele diz outra coisa: "não houve"
  // em vez de "ninguém preencheu".
  if (!dados.length) {
    throw new ErroCsv(
      'O CSV tem só o cabeçalho, e nenhum repositório. Confira o mês ' +
      'escolhido na exportação. Para declarar que não houve trabalho no mês, ' +
      'use "Sem ocorrência no mês", que é o que o documento sabe ler.'
    )
  }

  // O efetivo é texto livre, e é a única coluna onde uma vírgula a mais faz
  // sentido. Remontá-lo a partir das células sobrando só vale se ele for a
  // ÚLTIMA coluna; no meio da linha, não há como saber onde ele termina.
  const efetivoNoFim = posicao.efetivo === largura - 1

  const avisos = []
  const repositorios = []
  const vistos = new Map()

  for (const { n, conteudo } of dados) {
    const brutas = celulas(conteudo)

    if (brutas.length < largura) {
      throw new ErroCsv(
        `A linha ${n} tem ${brutas.length} coluna(s) e o cabeçalho tem ` +
        `${largura}: "${trecho(conteudo)}". Toda linha traz repositório, ` +
        'número de commits e efetivo.'
      )
    }

    if (brutas.length > largura && !efetivoNoFim) {
      throw new ErroCsv(
        `A linha ${n} tem ${brutas.length} colunas e o cabeçalho tem ` +
        `${largura}: "${trecho(conteudo)}". Sobrou vírgula, e com a coluna ` +
        'Efetivo fora do fim da linha não dá para saber a qual coluna ela ' +
        'pertence. Ponha Efetivo como última coluna, ou tire a vírgula.'
      )
    }

    const repo = brutas[posicao.repo].trim()
    const commitsCru = brutas[posicao.commits].trim()
    // A cauda volta para o efetivo com a vírgula original, e não com ", ":
    // recompor o texto é devolvê-lo como estava, não reformatá-lo.
    const efetivo = (brutas.length > largura
      ? brutas.slice(posicao.efetivo).join(',')
      : brutas[posicao.efetivo]).trim()

    if (brutas.length > largura) {
      avisos.push(
        `Linha ${n}: havia ${brutas.length - largura} vírgula(s) a mais, e ` +
        `elas foram lidas como parte do Efetivo ("${efetivo}"). Confira.`
      )
    }

    if (!repo) {
      throw new ErroCsv(
        `A linha ${n} está sem o nome do repositório: "${trecho(conteudo)}".`
      )
    }

    // COMMITS É NÚMERO. Texto aqui não daria erro nenhum: ele iria para a
    // tabela e o documento assinado sairia afirmando "quarenta e dois commits"
    // numa coluna que se soma com o olho.
    if (!/^\d+$/.test(commitsCru)) {
      throw new ErroCsv(
        `A linha ${n} traz ${commitsCru ? `"${commitsCru}"` : 'nada'} em ` +
        'Número de commits, e ali só entra número inteiro. ' +
        `Repositório: "${repo}".`
      )
    }

    // REPETIDO É RECUSA, e não "o último vence". O painel agrupa por
    // repositório e nunca repete: repetição quer dizer dois períodos colados um
    // no outro, e escolher um deles em silêncio gravaria metade de um mês.
    const k = repo.toLowerCase()
    if (vistos.has(k)) {
      throw new ErroCsv(
        `O repositório "${repo}" aparece duas vezes, nas linhas ` +
        `${vistos.get(k)} e ${n}. O CSV do github_dashboard traz cada ` +
        'repositório uma vez. Junte o período no painel antes de exportar, em ' +
        'vez de colar duas exportações.'
      )
    }
    vistos.set(k, n)

    if (!efetivo) {
      avisos.push(
        `O repositório "${repo}" veio sem efetivo (linha ${n}). A linha entra ` +
        'com a coluna vazia; preencha à mão se houver quem citar.'
      )
    }

    repositorios.push({ repo, commits: commitsCru, efetivo })
  }

  return { repositorios, avisos }
}

/** Célula gravada, sempre em texto e sem espaço nas pontas. */
const texto = valor => (valor == null ? '' : String(valor)).trim()

/**
 * Cruza o que veio do CSV com o que já está gravado.
 *
 * O CASAMENTO É PELO NOME DO REPOSITÓRIO, sem caixa: `DsgTools` e `dsgtools`
 * são o mesmo repositório, e tratá-los como dois faria a reimportação perder o
 * Resumo por causa de uma letra maiúscula. O nome gravado passa a ser o do CSV,
 * que é o do GitHub.
 *
 * @param {Array<Array<string>>} linhasAtuais - as linhas da 5.1 já gravadas
 * @param {Array<{repo:string, commits:string, efetivo:string}>} repositorios
 * @returns {{linhas: Array<Array<string>>, novos: string[], atualizados: string[],
 *            removidos: Array<{repo:string, resumo:string}>, resumosPreservados: number}}
 */
const planejar = (linhasAtuais, repositorios) => {
  const guardados = new Map()
  const semNome = []

  for (const linha of (linhasAtuais || [])) {
    const repo = texto(linha && linha[COL.REPO])
    const resumo = texto(linha && linha[COL.RESUMO])

    // Linha gravada sem nome de repositório não casa com nada e não sobrevive à
    // importação. Ela conta como REMOVIDA, e não some de fininho: se alguém
    // escreveu um Resumo nela, esse Resumo entra na confirmação como os outros.
    if (!repo) { semNome.push({ repo: '', resumo }); continue }

    const k = repo.toLowerCase()
    const anterior = guardados.get(k)
    // Repetido na tabela (digitado à mão duas vezes): fica o que tem Resumo.
    if (!anterior) { guardados.set(k, { repo, resumo }) } else if (!anterior.resumo && resumo) { guardados.set(k, { repo, resumo }) }
  }

  const linhas = []
  const novos = []
  const atualizados = []
  const usados = new Set()
  let resumosPreservados = 0

  // A ORDEM É A DO CSV, que o painel já entrega do mais trabalhado para o menos.
  for (const { repo, commits, efetivo } of repositorios) {
    const k = repo.toLowerCase()
    usados.add(k)
    const guardado = guardados.get(k)
    const resumo = guardado ? guardado.resumo : ''

    if (guardado) {
      atualizados.push(repo)
      if (resumo) resumosPreservados++
    } else {
      novos.push(repo)
    }

    linhas.push([repo, commits, efetivo, resumo])
  }

  const removidos = [
    ...semNome,
    ...[...guardados.entries()]
      .filter(([k]) => !usados.has(k))
      .map(([, v]) => ({ repo: v.repo, resumo: v.resumo }))
  ]

  return { linhas, novos, atualizados, removidos, resumosPreservados }
}

module.exports = {
  ErroCsv,
  NUMERO,
  COL,
  CABECALHO_ESPERADO,
  analisar,
  planejar
}
