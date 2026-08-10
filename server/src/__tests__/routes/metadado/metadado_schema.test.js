'use strict'

// O CONTRATO DE ENTRADA DO METADADO, e o que ele existe para recusar.
//
// Cada caso prova o MOTIVO da recusa, e nao so que houve recusa: um corpo que
// falha por dois motivos passaria num `expect(error).toBeDefined()` mesmo depois
// de a regra do titulo ser removida.
//
// A REGRA MAIS IMPORTANTE DAQUI E O XOR. Metadado se declara em DOIS niveis --
// `lote_id` vale para tudo o que o lote entregar, `versao_id` vale para UMA
// edicao e sobrescreve o do lote --, e uma linha que nao diz a quem se aplica
// nao e metadado de nada. O Joi e o CHECK do banco cobram a mesma coisa, e os
// dois existem de proposito: aqui sai um 400 que diz o que fazer, e la fica a
// porta que nenhuma outra entrada atravessa.

const schema = require('../../../metadado/metadado_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

/**
 * Exige recusa por uma regra do OBJETO dentro de um ITEM de array.
 *
 * POR QUE NAO E O `recusaRegraDeObjeto` DE `helpers/joi.js`. Aquele prende o
 * `path` VAZIO, porque as regras de objeto que ele cobre ficam na RAIZ do corpo.
 * Aqui o XOR mora no item do array (`informacoes_produto[0]`), e o Joi devolve
 * `path = ['informacoes_produto', 0]`. Afrouxar o helper compartilhado para
 * aceitar qualquer caminho tiraria dele a assercao que ele existe para fazer, e
 * ele e usado por outros modulos.
 *
 * PRENDE TAMBEM O `tipo`, e ele nao e um so: o Joi devolve `object.xor` quando
 * as DUAS chaves vieram, e `object.missing` quando NENHUMA veio. Sao dois erros
 * de digitacao diferentes, e a mensagem que o operador recebe e outra.
 *
 * @param {{error: Object}} resultado
 * @param {string} tipo - 'object.xor' (as duas) ou 'object.missing' (nenhuma)
 * @param {Array<string>} chaves - as chaves relacionadas, na ordem do schema
 * @param {Array<string|number>} caminho - onde o item mora no corpo
 */
const recusaRegraNoItem = (resultado, tipo, chaves, caminho) => {
  const { error } = resultado
  if (!error) {
    expect('schema aceitou, e o caso exige recusa').toBe(`recusa por ${tipo}`)
    return
  }

  const detalhe = error.details[0]
  expect(`${detalhe.path.join('.')} (${detalhe.type})`)
    .toBe(`${caminho.join('.')} (${tipo})`)
  expect(detalhe.context.peers).toEqual(chaves)
}

// Um corpo minimo valido de cada tabela com XOR, para o caso mexer numa chave
// so e o resto continuar valendo.
const informacoesProdutoValida = {
  versao_id: 10,
  resumo: 'Folha de Porto Alegre',
  proposito: '',
  creditos: '',
  informacoes_complementares: '',
  limitacao_acesso_id: 8,
  limitacao_uso_id: 8,
  restricao_uso_id: 6,
  grau_sigilo_id: 1,
  organizacao_responsavel_id: 1,
  organizacao_distribuicao_id: 1,
  datum_vertical_id: 0,
  especificacao_id: 4,
  responsavel_produto_id: 3,
  declaracao_linhagem: '',
  projeto_bdgex: 'Mapeamento Sistemático'
}

const informacoesEdicaoValida = {
  lote_id: 7,
  pec_planimetrico: 'PEC-PCD A',
  pec_altimetrico: 'PEC-PCD A',
  origem_dados_altimetricos: 'MDE Copernicus',
  territorio_internacional: false,
  acesso_restrito: false,
  carta_militar: false,
  data_criacao: '2019-2021',
  epsg_mde: '4674',
  // path-ok na linha abaixo: caminho inventado. O schema so exige texto, e a
  // fixtura usa a forma que a ficha usa na pratica.
  caminho_mde: 'Y:\\mde\\folha.tif', // path-ok
  dados_terceiro: [],
  quadro_fases: { fases: [] }
}

describe('Schema do metadado: o XOR de versão e lote', () => {
  it('aceita a declaração de nível VERSÃO', () => {
    const valor = aceita(
      schema.informacoesProduto.validate({ informacoes_produto: [informacoesProdutoValida] })
    )
    expect(valor.informacoes_produto[0].versao_id).toBe(10)
  })

  it('aceita a declaração de nível LOTE', () => {
    const { versao_id: _versao, ...semVersao } = informacoesProdutoValida
    aceita(
      schema.informacoesProduto.validate({
        informacoes_produto: [{ ...semVersao, lote_id: 7 }]
      })
    )
  })

  it('recusa a declaração que traz os DOIS níveis', () => {
    recusaRegraNoItem(
      schema.informacoesProduto.validate({
        informacoes_produto: [{ ...informacoesProdutoValida, lote_id: 7 }]
      }),
      'object.xor',
      ['versao_id', 'lote_id'],
      ['informacoes_produto', 0]
    )
  })

  it('recusa a declaração que não traz nenhum dos dois', () => {
    const { versao_id: _versao, ...semNivel } = informacoesProdutoValida
    recusaRegraNoItem(
      schema.informacoesProduto.validate({ informacoes_produto: [semNivel] }),
      'object.missing',
      ['versao_id', 'lote_id'],
      ['informacoes_produto', 0]
    )
  })

  it('cobra o mesmo XOR em informações de edição', () => {
    recusaRegraNoItem(
      schema.informacoesEdicao.validate({
        informacoes_edicao: [{ ...informacoesEdicaoValida, versao_id: 3 }]
      }),
      'object.xor',
      ['versao_id', 'lote_id'],
      ['informacoes_edicao', 0]
    )
  })

  it('cobra o mesmo XOR no sensor da carta ortoimagem', () => {
    recusaRegraNoItem(
      schema.sensorCartaOrtoimagem.validate({
        sensor_carta_ortoimagem: [{
          tipo: 'Óptico', plataforma: 'Sentinel-2', nome: 'MSI',
          resolucao: '10 m', bandas: 'RGB', nivel_produto: 'L2A'
        }]
      }),
      'object.missing',
      ['versao_id', 'lote_id'],
      ['sensor_carta_ortoimagem', 0]
    )
  })
})

describe('Schema do metadado: a palavra-chave é só de nível versão', () => {
  // NAO EXISTE PALAVRA-CHAVE DE LOTE, e a ausencia e a regra: toponimo e
  // descricao sao por FOLHA, e herdar do lote faria toda folha se descrever pelo
  // mesmo lugar. Por isso aqui `versao_id` e OBRIGATORIO, e nao um dos dois.
  it('exige versao_id', () => {
    recusaPor(
      schema.palavraChaveProduto.validate({
        palavras_chave_produto: [{ nome: 'Porto Alegre', tipo_palavra_chave_id: 5 }]
      }),
      ['palavras_chave_produto', 0, 'versao_id'],
      'any.required'
    )
  })

  it('recusa lote_id, que não é campo desta tabela', () => {
    recusaPor(
      schema.palavraChaveProduto.validate({
        palavras_chave_produto: [
          { nome: 'Porto Alegre', tipo_palavra_chave_id: 5, versao_id: 10, lote_id: 7 }
        ]
      }),
      ['palavras_chave_produto', 0, 'lote_id'],
      'object.unknown'
    )
  })
})

describe('Schema do metadado: a licença do produto', () => {
  // SAO DOIS VALORES, e nao texto livre: o plugin de edicao aceita esses dois, e
  // um terceiro entraria calado no banco para sair como licenca invalida no
  // produto impresso.
  it('aceita CC-BY-NC-SA 4.0', () => {
    aceita(
      schema.informacoesEdicao.validate({
        informacoes_edicao: [{ ...informacoesEdicaoValida, licenca_produto: 'CC-BY-NC-SA 4.0' }]
      })
    )
  })

  it('recusa uma licença fora das duas', () => {
    recusaPor(
      schema.informacoesEdicao.validate({
        informacoes_edicao: [{ ...informacoesEdicaoValida, licenca_produto: 'CC-BY 4.0' }]
      }),
      ['informacoes_edicao', 0, 'licenca_produto'],
      'any.only'
    )
  })
})

describe('Schema do metadado: quadro de fases', () => {
  // ACEITA OBJETO OU ARRAY, e a origem so aceitava objeto. A coluna e JSON e o
  // leitor do JSON de edicao ja trata as duas formas.
  it('aceita o array direto', () => {
    aceita(
      schema.informacoesEdicao.validate({
        informacoes_edicao: [{ ...informacoesEdicaoValida, quadro_fases: [{ fase: 'Edição' }] }]
      })
    )
  })

  it('recusa texto no lugar do quadro', () => {
    recusaPor(
      schema.informacoesEdicao.validate({
        informacoes_edicao: [{ ...informacoesEdicaoValida, quadro_fases: 'Edição em 2026' }]
      }),
      ['informacoes_edicao', 0, 'quadro_fases'],
      'alternatives.types'
    )
  })
})

describe('Schema do metadado: o usuário é uma ASSINATURA, e não uma conta', () => {
  // `metadado.usuario.usuario_sap_id` do SAP era um SERIAL; aqui e um UUID que
  // aponta `dgeo.usuario (uuid)`, que e como todo o SCA aponta gente.
  it('exige o uuid da conta, e não um id', () => {
    recusaPor(
      schema.usuario.validate({
        usuario: [{ usuario_uuid: 42, nome: 'Fulano de Tal', funcao: 'Chefe', organizacao_id: 1 }]
      }),
      ['usuario', 0, 'usuario_uuid'],
      'string.base'
    )
  })

  it('recusa um uuid malformado', () => {
    recusaPor(
      schema.usuario.validate({
        usuario: [{ usuario_uuid: 'nao-e-uuid', nome: 'Fulano', funcao: 'Chefe', organizacao_id: 1 }]
      }),
      ['usuario', 0, 'usuario_uuid'],
      'string.guid'
    )
  })

  it('aceita a assinatura completa', () => {
    aceita(
      schema.usuario.validate({
        usuario: [{
          usuario_uuid: '3f1c2b5e-2f4a-4a3b-8d21-9c7e6a1b2c3d',
          nome: 'Fulano de Tal',
          funcao: 'Chefe da Seção de Produção',
          organizacao_id: 1
        }]
      })
    )
  })
})

describe('Schema do metadado: as listas de corpo', () => {
  // `.required().min(1)` ENTROU NA TRAVESSIA. A origem deixava
  // `informacoes_produto` sem os dois, e um corpo vazio passava pelo Joi para
  // estourar adiante no controller, com 500 onde cabia um 400.
  it('recusa o corpo sem a lista', () => {
    recusaPor(
      schema.informacoesProduto.validate({}),
      'informacoes_produto',
      'any.required'
    )
  })

  it('recusa a lista vazia', () => {
    recusaPor(
      schema.informacoesProduto.validate({ informacoes_produto: [] }),
      'informacoes_produto',
      'array.min'
    )
  })

  it('recusa o mesmo id duas vezes na atualização', () => {
    recusaPor(
      schema.creditosQptAtualizacao.validate({
        creditos_qpt: [
          { id: 1, nome: 'Equipe A', qpt: '<Layout/>' },
          { id: 1, nome: 'Equipe B', qpt: '<Layout/>' }
        ]
      }),
      ['creditos_qpt', 1],
      'array.unique'
    )
  })

  it('recusa o id repetido na lista de exclusão', () => {
    recusaPor(
      schema.creditosQptIds.validate({ creditos_qpt_ids: [1, 1] }),
      ['creditos_qpt_ids', 1],
      'array.unique'
    )
  })
})

describe('Schema do metadado: os parâmetros das rotas de saída', () => {
  // O `:uuid` E O `acervo.versao.uuid_versao`, e nao o do produto: o que se
  // publica e uma EDICAO.
  it('aceita o uuid da versão', () => {
    aceita(schema.uuidParams.validate({ uuid: '3f1c2b5e-2f4a-4a3b-8d21-9c7e6a1b2c3d' }))
  })

  it('recusa o que não é uuid', () => {
    recusaPor(schema.uuidParams.validate({ uuid: '123' }), 'uuid', 'string.guid')
  })

  it('recusa o lote que não é número', () => {
    recusaPor(schema.loteIdParams.validate({ loteId: 'abc' }), 'loteId', 'number.base')
  })
})

describe('Schema do metadado: a organização é EDIÇÃO, e não cadastro', () => {
  // Os cinco CGEO sao semeados por `er/metadado.sql`. O que a tela edita e o
  // CONTATO de cada um, e por isso o `code` e obrigatorio e nao ha POST.
  // A FIXTURE NAO E A INSTALACAO DE NINGUEM, e isso e de proposito: o Centro que
  // opera esta instalacao vira dado em `dgeo.instituicao` desde 2026-08-09, e o
  // teste que confirmasse o proprio Centro passaria igual com o valor escrito no
  // codigo. Aqui, como em `rpcmtec.test.js` e em `login_ctrl.test.js`, o exemplo
  // e outro Centro, com contato inventado.
  it('exige o code de cada organização', () => {
    recusaPor(
      schema.organizacao.validate({ organizacoes: [{ nome: '2º Centro de Geoinformação' }] }),
      ['organizacoes', 0, 'code'],
      'any.required'
    )
  })

  it('aceita o contato com sigla, endereço, telefone e site', () => {
    aceita(
      schema.organizacao.validate({
        organizacoes: [{
          code: 2,
          nome: '2º Centro de Geoinformação',
          sigla: '2º CGEO',
          endereco: 'Rua Exemplo, nº 100 - Cidade - UF',
          telefone: '(00)0000-0000',
          site: 'http://exemplo.invalid/'
        }]
      })
    )
  })
})
