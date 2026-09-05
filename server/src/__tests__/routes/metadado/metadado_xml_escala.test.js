'use strict'

// A ESCALA AUSENTE NO XML DE METADADO.
//
// O QUE ESTE ARQUIVO GUARDA é a palavra "null" saindo impressa. `dominio.tipo_escala`
// tem o code 6 ('Sem escala'), e o `SQL_DENOMINADOR_ESCALA` do controlador devolve
// NULL para ele. Até o conserto, `ESCALA: String(escala)` virava a string 'null'
// e ia parar dentro de `<gco:Integer>` nos seis templates -- inválido contra o
// XSD do Perfil MGB -- e o título da folha SCN terminava em " - null". A lista
// `erros` ficava vazia, e a folha lia-se como pronta para publicar.
//
// A saída é a mesma da equidistância não mapeada, que o controlador já tratava
// assim: campo em branco MAIS um aviso, em vez de um valor plausível e errado.
//
// Banco mockado: nada aqui abre conexão, e por isso os casos rodam no pacote
// `rapido`.

const mockDb = {
  conn: {
    any: jest.fn(),
    one: jest.fn(),
    oneOrNone: jest.fn(),
    none: jest.fn(),
    task: jest.fn(),
    tx: jest.fn()
  }
}

jest.mock('../../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const metadadoCtrl = require('../../../metadado/metadado_ctrl')

const { SUBTIPO_PRODUTO } = metadadoCtrl._helpers

const versaoBase = (extra = {}) => ({
  id: 77,
  uuid_versao: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  edicao: '1ª Edição',
  lote_id: 3,
  subtipo_produto_id: SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG,
  nome: 'Porto Alegre',
  mi: null,
  inom: 'SH-22-Y-B',
  denominador_escala: 25000,
  bbox_w: -51.5,
  bbox_e: -51.25,
  bbox_s: -30.125,
  bbox_n: -30,
  ...extra
})

const montarTask = versao => {
  mockDb.conn.task.mockImplementation(async cb =>
    cb({
      oneOrNone: async sql => {
        if (/uuid_versao/.test(sql)) return versao
        if (/informacoes_produto/.test(sql)) {
          return {
            projeto_bdgex: 'Mapeamento Sistemático',
            datum_vertical: 'Datum de Imbituba - SC',
            especificacao: 'ET-RDG',
            responsavel: 'Fulano de Tal',
            classificacao: 'ostensivo',
            org_nome: 'Diretoria de Serviço Geográfico',
            org_site: 'https://exemplo.invalido',
            org_endereco: 'Quartel-General',
            org_telefone: '0000-0000'
          }
        }
        if (/informacoes_edicao/.test(sql)) return { data_criacao: '2024-01-15' }
        return null
      },
      any: async () => []
    })
  )
}

const gerar = async (extra = {}) => {
  const versao = versaoBase(extra)
  montarTask(versao)
  return metadadoCtrl.gerarMetadadoXmlVersao(versao.uuid_versao)
}

// O título da FOLHA é o que o marcador `{{TITULO}}` deixou no lugar dele. O
// primeiro `<gmd:title>` do template é outro: ele é o da especificação citada, e
// não muda com a folha.
const temTitulo = (xml, texto) =>
  xml.includes(`<gco:CharacterString>${texto}</gco:CharacterString>`)

describe('a folha COM escala continua saindo como sempre saiu', () => {
  it('o inteiro da escala e o título com separador de milhar', async () => {
    const { xml, erros } = await gerar()

    expect(xml).toContain('<gco:Integer>25000</gco:Integer>')
    expect(temTitulo(xml, 'Porto Alegre - SH-22-Y-B - 25.000')).toBe(true)
    expect(erros.join(' ')).not.toContain('escala não resolvida')
  })
})

describe('a folha SEM escala não imprime a palavra "null"', () => {
  it('o gco:Integer sai vazio, e não com um texto que o XSD recusa', async () => {
    const { xml } = await gerar({ denominador_escala: null })

    expect(xml).not.toContain('<gco:Integer>null</gco:Integer>')
    expect(xml).toContain('<gco:Integer></gco:Integer>')
  })

  it('o título para no INOM, sem arrastar o separador solto', async () => {
    const { xml } = await gerar({ denominador_escala: null })

    expect(temTitulo(xml, 'Porto Alegre - SH-22-Y-B')).toBe(true)
    expect(xml).not.toContain('SH-22-Y-B - </gco:CharacterString>')
    expect(xml).not.toContain('SH-22-Y-B - null')
  })

  it('e a ausência é ACUSADA, que era a outra metade do defeito', async () => {
    const { erros } = await gerar({ denominador_escala: null })

    expect(erros.join(' ')).toContain('escala não resolvida')
  })

  // A FRASE NOMEIA UMA CAUSA, e não duas. Ela oferecia também "ou a escala
  // personalizada está vazia", e esse estado o banco não deixa existir: o CHECK
  // de `acervo.produto` exige `denominador_escala_especial IS NOT NULL` quando
  // `tipo_escala_id = 5` (a personalizada) e o proíbe nos demais codes. Quem
  // lesse o erro iria conferir uma coluna que nunca é a culpada; o culpado é
  // sempre o code 6, 'Sem escala'.
  it('a frase acusa só o "Sem escala", e não a personalizada vazia', async () => {
    const { erros } = await gerar({ denominador_escala: null })

    const frase = erros.find(e => e.startsWith('escala não resolvida'))
    expect(frase).toBe(
      'escala não resolvida (acervo.produto.tipo_escala_id é "Sem escala"): ' +
      'a denominação da escala e a equidistância saem em branco no XML'
    )
    expect(erros.join(' ')).not.toContain('escala personalizada')
  })

  // O silêncio era o que fazia o XML errado passar por pronto: a equidistância
  // já era acusada, e a escala não.
  it('a equidistância continua acusada junto', async () => {
    const { erros } = await gerar({ denominador_escala: null })

    expect(erros.join(' ')).toContain('equidistância')
  })

  // O "null" saiu do XML e do título, e faltava tirá-lo do único lugar em que a
  // pessoa realmente o lia: a frase da tela. A folha sem escala SEMPRE cai na
  // condição da equidistância, porque o mapa por escala devolve vazio.
  it('e a frase da equidistância não devolve o "null" pelo texto', async () => {
    const { erros } = await gerar({ denominador_escala: null })

    const frase = erros.find(e => e.startsWith('equidistância'))
    expect(frase).toBe(
      'equidistância não pode ser resolvida sem escala: o campo de distância da curva ficou vazio'
    )
    expect(erros.join(' ')).not.toContain('null')
  })

  // Controle negativo: com escala, a frase antiga (a que nomeia o denominador)
  // continua inteira, porque ali o número ajuda quem vai preencher à mão.
  it('com escala fora do mapa, a frase continua nomeando o denominador', async () => {
    const { erros } = await gerar({ denominador_escala: 12345 })

    expect(erros.join(' ')).toContain(
      'equidistância não mapeada para a escala 12345'
    )
  })
})
