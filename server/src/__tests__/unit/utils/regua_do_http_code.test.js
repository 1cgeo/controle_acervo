'use strict'

// TODA CHAVE DE `httpCode` CITADA NO SERVIDOR TEM DE EXISTIR EM
// `utils/http_code.js`.
//
// POR QUE ESTA RÉGUA EXISTE. `httpCode` é um objeto comum, e ler uma chave que
// não existe nele não é erro em JavaScript: devolve `undefined`, calado. O
// `new AppError(mensagem, httpCode.InternalServerError)` -- a chave de 500
// chama-se `InternalError` -- nasce com `statusCode` indefinido, e a resposta
// sai com o status que o `errorHandler` conseguir salvar no `||` dele, dois
// arquivos adiante. Nada acende: nem o boot, nem o lint, nem o teste da rota,
// que quase sempre afirma a MENSAGEM e não o número.
//
// A FAMÍLIA JÁ EXISTIU, e é por isso que a varredura vale mais do que um caso
// por arquivo: em 2026-09-05 havia QUATRO ocorrências de `InternalServerError`
// (`rpcmtec/rtm_ods.js`, três em `rpcmtec/anuario_ods.js`) e uma quinta em
// `equipamento/dmt_ods.js`. Foram corrigidas uma a uma, por três frentes
// diferentes. A próxima nasce no primeiro `new AppError` escrito de memória, e
// este arquivo é quem a pega no mesmo dia.
//
// O QUE ELA COBRE: `httpCode.<Chave>` em qualquer `.js` de `server/src`, fora de
// `__tests__` (que fabrica objeto de mentira) e de `build/` (que é bundle do
// client, e não fonte). Acesso por colchete (`httpCode[algo]`) fica de fora de
// propósito: ali a chave é um valor de execução, e nenhuma varredura de texto
// responde por ele.

const fs = require('fs')
const path = require('path')

const httpCode = require('../../../utils/http_code')

const SRC = path.resolve(__dirname, '..', '..', '..')

// `build/` é o bundle do client servido pelo Express, e `__tests__` monta
// dublês de `httpCode` com chaves que só existem no teste.
const PASTAS_FORA = ['__tests__', 'build']

const CHAVES = Object.keys(httpCode)

// `httpCode.Chave`, com a chave começando por letra. O `\b` da frente evita casar
// `meuHttpCode.X`, e a captura para no primeiro caractere que não é de nome.
const USO = /\bhttpCode\.([A-Za-z_$][A-Za-z0-9_$]*)/g

const relativo = arquivo => path.relative(SRC, arquivo).replace(/\\/g, '/')

const arquivosJs = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entrada => {
    const completo = path.join(dir, entrada.name)
    if (entrada.isDirectory()) {
      return PASTAS_FORA.includes(entrada.name) ? [] : arquivosJs(completo)
    }
    return entrada.name.endsWith('.js') ? [completo] : []
  })

/** Cada `httpCode.<Chave>` do arquivo, com a linha em que aparece. */
const usosDe = arquivo => {
  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r\n?|\n/)
  const achados = []
  linhas.forEach((linha, indice) => {
    USO.lastIndex = 0
    let casou
    while ((casou = USO.exec(linha)) !== null) {
      achados.push({
        arquivo: relativo(arquivo),
        linha: indice + 1,
        chave: casou[1]
      })
    }
  })
  return achados
}

describe('a régua do httpCode', () => {
  const arquivos = arquivosJs(SRC)
  const usos = arquivos.flatMap(usosDe)

  it('varre o servidor inteiro, e não um punhado de arquivos', () => {
    expect(arquivos.length).toBeGreaterThan(100)
    expect(usos.length).toBeGreaterThan(300)
  })

  it('não varre `__tests__` nem `build`', () => {
    const fora = arquivos
      .map(relativo)
      .filter(f => PASTAS_FORA.some(pasta => f.split('/').includes(pasta)))

    expect(fora).toEqual([])
  })

  // A ASSERÇÃO INTEIRA DO ARQUIVO. O que ela imprime quando falha é a lista de
  // `arquivo:linha -> chave`, que é exatamente o que se precisa para consertar.
  it('toda chave citada existe em utils/http_code.js', () => {
    const inexistentes = usos
      .filter(uso => !CHAVES.includes(uso.chave))
      .map(uso => `${uso.arquivo}:${uso.linha} -> httpCode.${uso.chave}`)

    expect(inexistentes).toEqual([])
  })

  // A régua só vale se ela souber reprovar. Sem este caso, uma expressão regular
  // que parasse de casar nada passaria verde para sempre.
  it('reprovaria a chave que não existe (a régua sabe recusar)', () => {
    const fonteDeMentira = 'throw new AppError(msg, httpCode.InternalServerError)'
    USO.lastIndex = 0
    const casou = USO.exec(fonteDeMentira)

    expect(casou[1]).toBe('InternalServerError')
    expect(CHAVES).not.toContain('InternalServerError')
  })
})
