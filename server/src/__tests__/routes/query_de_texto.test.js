'use strict'

// TODA QUERY E TODO PARÂMETRO DE CAMINHO CHEGAM COMO TEXTO, e este arquivo é a
// varredura que cobra isso dos sete módulos herdados do SAP 2.3.5.
//
// O DEFEITO QUE ELE GUARDA é mudo. O Express não converte nada, e
// `utils/schema_validation.js` valida `req.query` e `req.params` CRUS: um
// `Joi.number().strict()` num schema de query recusa a coerção e responde 400
// '"x" must be a number' para TODO valor, sempre. A rota fica inalcançável sem
// erro de sintaxe, sem teste vermelho e sem nada no log -- e é exatamente o que
// acontecia com `producao/trabalho_schema.js :: unidadeTrabalhoQuery.lote_id`
// até 2026-08-09.
//
// A VARREDURA EXECUTA O JOI VIVO, e não lê o fonte à procura de `.strict()`. É a
// mesma disciplina dos CLIs da casa: o contrato é o schema em tempo de execução,
// e um `.strict()` escondido dentro de um helper compartilhado (que foi o caso)
// não aparece numa busca de texto.
//
// RODA NO PACOTE `rapido`: nada aqui abre conexão.

const fs = require('fs')
const path = require('path')

// Os sete módulos que atravessaram do SAP 2.3.5 na 3.0.0. O `acervo` e os
// demais módulos antigos ficam de fora de propósito: a convenção deles já está
// assentada, e esta varredura existe para a travessia.
const MODULOS = [
  'producao',
  'gerencia_producao',
  'distribuicao',
  'acompanhamento_producao',
  'metadado',
  'microcontrole',
  'perigo'
]

const RAIZ = path.resolve(__dirname, '..', '..')

// O que o Express entrega para cada tipo: texto, e nada além de texto.
const AMOSTRA = {
  number: '12',
  boolean: 'true',
  date: '2026-08-09'
}

const campos = () => {
  const achados = []
  for (const modulo of MODULOS) {
    const dir = path.join(RAIZ, modulo)
    for (const arquivo of fs.readdirSync(dir)) {
      if (!arquivo.endsWith('_schema.js')) continue
      const models = require(path.join(dir, arquivo))
      for (const nome of Object.keys(models)) {
        // A convenção de nome é o que liga o schema à porta: `schemaValidation`
        // só recebe `query:` e `params:` de chaves assim.
        if (!/query$|params$/i.test(nome)) continue
        const schema = models[nome]
        if (!schema || typeof schema.describe !== 'function') continue
        const descricao = schema.describe()
        if (!descricao.keys) continue
        for (const chave of Object.keys(descricao.keys)) {
          const tipo = descricao.keys[chave].type
          if (!AMOSTRA[tipo]) continue
          achados.push({
            rotulo: `${modulo}/${arquivo} :: ${nome}.${chave} (${tipo})`,
            schema,
            chave,
            valor: AMOSTRA[tipo]
          })
        }
      }
    }
  }
  return achados
}

const CAMPOS = campos()

describe('nenhum schema de query ou de params recusa o texto do Express', () => {
  // CONTROLE DE VACUIDADE: sem ele, um erro de caminho ou de convenção de nome
  // deixaria a varredura sem nada a olhar, e o caso abaixo passaria por não ter
  // encontrado defeito nenhum -- nem schema nenhum.
  it('a varredura encontra campos para examinar', () => {
    expect(CAMPOS.length).toBeGreaterThanOrEqual(15)
  })

  it('todos aceitam o valor em texto', () => {
    const recusados = []
    for (const { rotulo, schema, chave, valor } of CAMPOS) {
      const { error } = schema.validate({ [chave]: valor })
      const detalhe = error && error.details.find(d => d.path[0] === chave)
      // SÓ `*.base` CONTA. Um `number.min` diz que a coerção FUNCIONOU e o valor
      // é que está fora da faixa (o ano de `acompanhamento_producao` recusa '12'
      // por ser menor que 1900, e está certo).
      if (detalhe && /\.base$/.test(detalhe.type)) {
        recusados.push(`${rotulo} -> ${detalhe.type}: ${detalhe.message}`)
      }
    }
    expect(recusados).toEqual([])
  })
})
