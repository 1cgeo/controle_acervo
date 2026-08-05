'use strict'

// TODO PONTO DE ENTRADA DE ARQUIVO DISPARA A MINIATURA.
//
// Ate 2026-08-04 quem gerava era um cron de meia em meia hora, e ele nao
// precisava saber por onde a versao entrou: varria a fila inteira. Sem cron, o
// disparo mora em cada ponto de entrada, e esquecer um e o modo de falhar que
// nao da erro: a versao entra no acervo e a ficha dela fica sem imagem, calada.
//
// Sao TRES pontos, e o comentario de `registrarArquivoCriado` os enumera: o
// envio pela web, a catalogacao in-place e o confirm-upload. Este teste varre o
// arquivo e cobra que os tres chamem `dispararMiniatura`. Ponto novo que insira
// arquivo sem disparar cai aqui.

const fs = require('fs')
const path = require('path')

const FONTE = path.join(__dirname, '..', '..', '..', 'arquivo', 'arquivo_ctrl.js')
const codigo = fs.readFileSync(FONTE, 'utf8')

/** As linhas de `controller.<nome> = ` do arquivo, com o numero da linha. */
const entradasDoControlador = () => {
  const mapa = []
  codigo.split('\n').forEach((linha, i) => {
    const m = linha.match(/^controller\.([a-zA-Z]+) = /)
    if (m) mapa.push({ nome: m[1], linha: i + 1 })
  })
  return mapa
}

/** A que funcao do controlador pertence a linha informada. */
const funcaoDaLinha = (linhaAlvo) => {
  const entradas = entradasDoControlador()
  let atual = null
  for (const e of entradas) {
    if (e.linha <= linhaAlvo) atual = e.nome
    else break
  }
  return atual
}

const linhasQueCasam = (regex) => {
  const achadas = []
  codigo.split('\n').forEach((linha, i) => {
    if (regex.test(linha)) achadas.push(i + 1)
  })
  return achadas
}

describe('miniatura: todo ponto que insere arquivo dispara a geracao', () => {
  it('os pontos de entrada que INSEREM arquivo sao os tres conhecidos', () => {
    // O USO da constante, e nao a definicao dela. As chamadas aparecem em duas
    // formas no arquivo (`t.one(SQL_INSERT_ARQUIVO, [` numa linha, ou a
    // constante sozinha na linha seguinte ao `t.one(`), entao o criterio e
    // "cita a constante e nao e a declaracao".
    const inserem = new Set(
      linhasQueCasam(/SQL_INSERT_ARQUIVO/)
        .filter(l => !/^const SQL_INSERT_ARQUIVO/.test(codigo.split('\n')[l - 1]))
        .map(funcaoDaLinha)
        .filter(Boolean)
    )

    // Se este expect falhar, apareceu (ou sumiu) um ponto de entrada. Nao
    // conserte o numero: descubra se o ponto novo dispara a miniatura.
    expect([...inserem].sort()).toEqual(['catalogarProduto', 'confirmUpload', 'enviarWeb'])
  })

  it('os tres pontos chamam dispararMiniatura', () => {
    const disparam = new Set(
      linhasQueCasam(/^\s*dispararMiniatura\(/).map(funcaoDaLinha).filter(Boolean)
    )

    expect([...disparam].sort()).toEqual(['catalogarProduto', 'confirmUpload', 'enviarWeb'])
  })

  it('o disparo NUNCA e aguardado: `await dispararMiniatura` nao existe', () => {
    // Renderizar custa segundos e roda processo externo. Aguardar faria quem
    // enviou o arquivo esperar a imagem, que e exatamente o motivo de a
    // geracao nao viver dentro do confirmUpload.
    expect(linhasQueCasam(/await\s+dispararMiniatura/)).toEqual([])
  })

  it('o disparo trata a rejeicao, senao derruba o processo', () => {
    // A promessa nao volta para o caminho da requisicao: sem `.catch`, uma
    // rejeicao vira `unhandledRejection`.
    const corpo = codigo.slice(
      codigo.indexOf('const dispararMiniatura'),
      codigo.indexOf('const registrarArquivoCriado')
    )
    expect(corpo).toMatch(/\.catch\(/)
  })
})
