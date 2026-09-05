'use strict'

// A FORMA DO UUID NA PORTA DO CADASTRO DE USUARIOS.
//
// POR QUE ESTE ARQUIVO EXISTE. `Joi.string().guid()` aceita QUATRO grafias do
// mesmo identificador e nao normaliza nenhuma:
//
//   3f2504e0-4f89-11d3-9a0c-0305e82c3301   canonica, a que o Postgres devolve
//   3F2504E0-4F89-11D3-9A0C-0305E82C3301   maiuscula
//   {3f2504e0-4f89-11d3-9a0c-0305e82c3301} entre chaves
//   3f2504e04f8911d39a0c0305e82c3301       sem hifen
//
// O tipo `uuid` do PostgreSQL aceita as quatro TAMBEM, e devolve sempre a
// primeira. Enquanto as duas pontas so conversassem por SQL isso seria
// inofensivo; o problema e que o controller compara as duas strings em
// JavaScript, e ai as quatro deixam de ser o mesmo valor:
//
//   - `atualizaUsuarioLista` acha a linha, GRAVA o UPDATE em massa, e so entao
//     procura `antesPorUuid.get('3F25...')` num mapa indexado pela canonica. O
//     `undefined` chega na auditoria, o agregado estoura, e a rota responde 500
//     desfazendo tudo -- sem que nada na mensagem diga o motivo.
//   - `resetaSenhas` responde "Usuários não encontrados" para um uuid que esta
//     bem ali na lista da tela.
//
// A recusa na porta e o unico conserto que vale para os dois, e vale uma vez
// so: as TRES ocorrencias do schema usam o mesmo `uuidCanonico`. Cada caso
// abaixo prova o MOTIVO da recusa pelo `recusaPor`, e nao so que houve recusa.

const usuarioSchema = require('../../../usuario/usuario_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const CANONICO = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

// As tres grafias que o `guid()` aceitava e o banco tambem aceita.
const NAO_CANONICAS = [
  ['MAIÚSCULA', '3F2504E0-4F89-11D3-9A0C-0305E82C3301'],
  ['entre chaves', '{3f2504e0-4f89-11d3-9a0c-0305e82c3301}'],
  ['sem hífen', '3f2504e04f8911d39a0c0305e82c3301']
]

const linhaDaLista = uuid => ({ uuid, administrador: false, ativo: true })

describe('uuid de rota (uuidParams): DELETE e PUT /usuarios/:uuid', () => {
  it('aceita a forma canônica, que é a que o Postgres devolve', () => {
    const valor = aceita(usuarioSchema.uuidParams.validate({ uuid: CANONICO }))
    expect(valor.uuid).toBe(CANONICO)
  })

  it.each(NAO_CANONICAS)('recusa o uuid em %s', (_forma, uuid) => {
    recusaPor(
      usuarioSchema.uuidParams.validate({ uuid }),
      'uuid',
      'string.pattern.base'
    )
  })

  // A mensagem de recusa vai para o `combined.log`, que `/logs` publica sem
  // guarda. A do `pattern` padrao do Joi ecoa o valor recebido; esta nao.
  it('a mensagem diz qual é a forma esperada e NÃO ecoa o valor recebido', () => {
    const bagunca = '3F2504E0-4F89-11D3-9A0C-0305E82C3301'
    const { error } = usuarioSchema.uuidParams.validate({ uuid: bagunca })

    expect(error.details[0].message).toBe(
      '"uuid" deve ser um UUID em minúsculas, com hífen e sem chaves'
    )
    expect(error.details[0].message).not.toContain(bagunca)
  })

  // O `.guid()` continua no schema ao lado do `pattern`, e separa dois enganos
  // diferentes: "isto nem parece um uuid" e "e um uuid, na grafia errada". E
  // tambem por ele que o `efetivo_cli`, que le o Joi VIVO, segue anunciando o
  // campo como `uuid` em vez de imprimir a expressao regular na ajuda.
  it('o que nem parece uuid recusa por `string.guid`, e em português', () => {
    recusaPor(
      usuarioSchema.uuidParams.validate({ uuid: 'nao-e-uuid' }),
      'uuid',
      'string.guid'
    )

    const { error } = usuarioSchema.uuidParams.validate({ uuid: 'nao-e-uuid' })
    expect(error.details[0].message).toBe('"uuid" deve ser um UUID')
  })
})

describe('lista de uuids (listaUsuario): POST /usuarios/senha/reset', () => {
  it('aceita a lista de formas canônicas', () => {
    const valor = aceita(
      usuarioSchema.listaUsuario.validate({ usuarios: [CANONICO] })
    )
    expect(valor.usuarios).toEqual([CANONICO])
  })

  it.each(NAO_CANONICAS)(
    'recusa a lista com um uuid em %s, e a recusa é no ITEM',
    (_forma, uuid) => {
      recusaPor(
        usuarioSchema.listaUsuario.validate({ usuarios: [uuid] }),
        ['usuarios', 0],
        'string.pattern.base'
      )
    }
  )
})

describe('lote de alteração (updateUsuarioLista): PUT /usuarios', () => {
  it('aceita a linha com uuid canônico', () => {
    const valor = aceita(
      usuarioSchema.updateUsuarioLista.validate({
        usuarios: [linhaDaLista(CANONICO)]
      })
    )
    expect(valor.usuarios[0].uuid).toBe(CANONICO)
  })

  // Esta e a ocorrencia que produzia o 500 DEPOIS de gravar. As outras duas
  // recusavam sem escrever nada.
  it.each(NAO_CANONICAS)(
    'recusa o lote com um uuid em %s, ANTES de qualquer escrita',
    (_forma, uuid) => {
      recusaPor(
        usuarioSchema.updateUsuarioLista.validate({
          usuarios: [linhaDaLista(uuid)]
        }),
        ['usuarios', 0, 'uuid'],
        'string.pattern.base'
      )
    }
  )
})
