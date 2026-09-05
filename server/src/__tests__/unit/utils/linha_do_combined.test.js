'use strict'

// NINGUEM ESCREVE UMA LINHA NO LOG PUBLICO.
//
// O `combined.log` e uma linha por evento, no formato `data|mensagem|JSON`, e
// `/logs` (`server/app.js`) publica os tres ultimos dias dele SEM autenticacao,
// partindo o arquivo por `\n`. Dos tres campos do `printf`, so o terceiro passa
// por `JSON.stringify`: a mensagem entra crua.
//
// Onde a mensagem carrega texto vindo do corpo da requisicao, uma quebra de
// linha deixava de ser texto e virava uma LINHA NOVA do log publico, com data e
// mensagem a escolha de quem enviou. Dois caminhos reais e conferidos:
//
//   usuario_ctrl.js               `Módulo desconhecido: ${nomeModulo}`, com o
//                                 nome vindo do `pattern(Joi.string())` de
//                                 `perfis`, que aceita qualquer chave;
//   schema_validation_estrito.js  `campo desconhecido "${caminho}"`, com o
//                                 caminho saindo do nome da chave enviada.
//
// O primeiro e de administrador; o segundo, de qualquer pessoa autenticada com
// perfil em algum modulo. Uma trilha em que o visitante escreve a linha nao e
// trilha de nada.
//
// Este arquivo exercita a MESMA funcao que o transporte usa (o logger a
// exporta), e nao uma copia.

const logger = require('../../../utils/logger')

const { linhaDoCombined } = logger

/** Os campos da linha, na ordem em que `/logs` os lê. */
const campos = linha => linha.split('|')

describe('formato do combined.log', () => {
  test('a mensagem com quebra de linha sai numa linha só', () => {
    const linha = linhaDoCombined({
      message: 'Módulo desconhecido: acervo\n2026-01-01|forjada|{}',
      status: 400
    })

    expect(linha.split('\n')).toHaveLength(1)
    expect(linha).not.toContain('\n')
  })

  test('o retorno de carro sozinho também some, e não só o \\n', () => {
    // O `\r` conta porque o arquivo é lido no Windows e no Linux, e um `\r`
    // solto ainda quebra a linha em alguns leitores.
    const linha = linhaDoCombined({ message: 'antes\rdepois' })
    expect(linha).not.toContain('\r')
    expect(campos(linha)[1]).toBe('antes depois')
  })

  test('a sequência inteira vira UM espaço, e o texto continua legível', () => {
    const linha = linhaDoCombined({ message: 'linha um\r\n\r\nlinha dois' })
    expect(campos(linha)[1]).toBe('linha um linha dois')
  })

  test('a mensagem sem quebra atravessa intacta, com os três campos', () => {
    const linha = linhaDoCombined({ message: 'Usuário atualizado', status: 200 })
    const [data, mensagem, json] = campos(linha)

    expect(mensagem).toBe('Usuário atualizado')
    expect(Number.isNaN(new Date(data).getTime())).toBe(false)
    expect(JSON.parse(json).status).toBe(200)
  })

  test('mensagem ausente não derruba o log inteiro', () => {
    // `String(undefined)` é o que salva: sem ele, o `.replace` estouraria
    // dentro do transporte e o evento sumiria do arquivo.
    expect(() => linhaDoCombined({ status: 500 })).not.toThrow()
    expect(campos(linhaDoCombined({ status: 500 }))[1]).toBe('undefined')
  })
})
