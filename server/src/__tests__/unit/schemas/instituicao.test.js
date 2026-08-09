'use strict'

// O CONTRATO DE ESCRITA DA INSTITUICAO, e ele e curto de proposito: tres campos.
//
// O QUE ESTE ARQUIVO GUARDA, e o que ele NAO guarda. Ele nao existe para
// exercitar o `.required()` do Joi. Ele guarda as tres decisoes que uma leitura
// rapida do schema desfaria sem perceber:
//
//   1. `ug_code` e TEXTO, e nao numero. `dominio.ug.code` e VARCHAR(10), e um
//      codigo que virasse inteiro perderia zero a esquerda no dia em que uma UG
//      tiver um.
//   2. `ug_code` aceita NULO, porque a instalacao que nao usa o modulo orcamento
//      nao tem Unidade Gestora.
//   3. NAO HA `id` no corpo. A linha e unica pelo CHECK `(id = 1)` do DDL, e
//      aceitar `id` daria a impressao de que existe uma segunda para escolher.
//
// Todo caso de recusa prova o MOTIVO pelo `recusaPor`, e nao so que houve
// recusa: sem isso, um schema quebrado em outro campo deixaria o arquivo verde.

const instituicaoSchema = require('../../../instituicao/instituicao_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const COMPLETO = {
  nome: '1º Centro de Geoinformação',
  sigla: '1º CGEO',
  ug_code: '160382'
}

describe('Schema da instituição: o que o PUT aceita', () => {
  it('aceita os três campos do 1º CGEO', () => {
    const valor = aceita(instituicaoSchema.atualizar.validate(COMPLETO))
    expect(valor.ug_code).toBe('160382')
  })

  it('aceita a instalação SEM Unidade Gestora, que é quem não usa o orçamento', () => {
    const valor = aceita(
      instituicaoSchema.atualizar.validate({ ...COMPLETO, ug_code: null })
    )
    expect(valor.ug_code).toBeNull()
  })

  it('a UG ausente vira null, e não `undefined`, para o SQL não quebrar', () => {
    const { nome, sigla } = COMPLETO
    const valor = aceita(instituicaoSchema.atualizar.validate({ nome, sigla }))
    expect(valor.ug_code).toBeNull()
  })

  // O `.trim()` do nome nao e enfeite: e por ele que a subsecao 2.7 do RPCMTec
  // acha a area de suprimento, comparando com `limites.area_suprimento.cgeo`.
  // Espaco sobrando no fim e invisivel na tela e fatal na comparacao.
  it('apara o espaço em volta do nome, que a comparação com a área de suprimento não perdoa', () => {
    const valor = aceita(
      instituicaoSchema.atualizar.validate({
        ...COMPLETO,
        nome: '  1º Centro de Geoinformação  '
      })
    )
    expect(valor.nome).toBe('1º Centro de Geoinformação')
  })

  it('recusa o corpo sem nome, que é o campo com que o sistema se identifica', () => {
    const { nome, ...semNome } = COMPLETO
    recusaPor(instituicaoSchema.atualizar.validate(semNome), 'nome', 'any.required')
  })

  it('recusa o corpo sem sigla', () => {
    const { sigla, ...semSigla } = COMPLETO
    recusaPor(instituicaoSchema.atualizar.validate(semSigla), 'sigla', 'any.required')
  })

  it('recusa nome maior que a coluna VARCHAR(255)', () => {
    recusaPor(
      instituicaoSchema.atualizar.validate({ ...COMPLETO, nome: 'x'.repeat(256) }),
      'nome',
      'string.max'
    )
  })

  it('recusa sigla maior que a coluna VARCHAR(50)', () => {
    recusaPor(
      instituicaoSchema.atualizar.validate({ ...COMPLETO, sigla: 'x'.repeat(51) }),
      'sigla',
      'string.max'
    )
  })

  it('recusa UG maior que a coluna VARCHAR(10)', () => {
    recusaPor(
      instituicaoSchema.atualizar.validate({ ...COMPLETO, ug_code: '1'.repeat(11) }),
      'ug_code',
      'string.max'
    )
  })

  // A UG chega como NUMERO quando alguem monta o corpo em JS sem aspas. O Joi
  // recusa em vez de converter: aceitar o numero apagaria um zero a esquerda no
  // caminho, e o codigo gravado deixaria de casar com `dominio.ug`.
  it('recusa a UG como número, porque o código da UG é texto', () => {
    recusaPor(
      instituicaoSchema.atualizar.validate({ ...COMPLETO, ug_code: 160382 }),
      'ug_code',
      'string.base'
    )
  })

  // A cadeia vazia e o campo de UG APAGADO na tela, e ela passa pelo schema: e o
  // controlador que a transforma em NULL antes do SQL, porque gravar '' em
  // `ug_code` levaria 23503 (cadeia vazia nao e codigo de UG nenhum).
  it('aceita a UG como cadeia vazia, que é o campo apagado na tela', () => {
    const valor = aceita(
      instituicaoSchema.atualizar.validate({ ...COMPLETO, ug_code: '' })
    )
    expect(valor.ug_code).toBe('')
  })

  // O SCHEMA nao declara `id`, e e isso que este caso prende. Na ROTA o corpo
  // passa pelo validador TOLERANTE, que descarta a chave desconhecida e avisa no
  // envelope em vez de responder 400 -- a escolha esta no cabecalho de
  // `instituicao_route.js`, e existe para ler-mudar-reenviar funcionar. O que
  // nao pode acontecer, nos dois caminhos, e `id` chegar ao SQL.
  it('não declara `id`: a linha é única e não se escolhe', () => {
    recusaPor(
      instituicaoSchema.atualizar.validate({ ...COMPLETO, id: 2 }),
      'id',
      'object.unknown'
    )
  })
})
