'use strict'

// O RETÂNGULO ENVOLVENTE NO XML DE METADADO.
//
// O QUE ESTE ARQUIVO GUARDA é código que existia e não fazia nada. Até
// 2026-08-09 o controlador recortava a `identificationInfo` e preenchia
// `<gco:Decimal></gco:Decimal>` vazios dentro de `<gmd:westBoundLongitude>` e
// irmãos -- e nos SEIS templates o único `westBoundLongitude` está na
// `dataQualityInfo`, que vem ANTES daquele elemento. A fatia não continha bbox
// nenhum, a substituição não casava nada, e a folha saía sem extensão geográfica
// e com `erros` VAZIO, ou seja, lida como pronta para publicar. Os quatro
// `ST_Transform` do SELECT eram calculados à toa.
//
// UM XML SEM EXTENSÃO GEOGRÁFICA É PLAUSÍVEL E ERRADO: ele sobe para o BDGEx e
// nada acusa, porque o resto do documento está inteiro.
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

const fs = require('fs')
const path = require('path')

const metadadoCtrl = require('../../../metadado/metadado_ctrl')

const { SUBTIPO_PRODUTO } = metadadoCtrl._helpers

const TEMPLATES = path.resolve(__dirname, '..', '..', '..', 'metadado', 'xml_templates')

// As quatro coordenadas de uma folha qualquer, com casas decimais suficientes
// para que a comparação não passe por acaso.
const BBOX = {
  bbox_w: -51.5,
  bbox_e: -51.25,
  bbox_s: -30.125,
  bbox_n: -30
}

const versaoBase = (extra = {}) => ({
  id: 77,
  uuid_versao: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  edicao: '1ª Edição',
  lote_id: 3,
  subtipo_produto_id: SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG,
  nome: 'Porto Alegre',
  mi: null,
  // SEM INOM: é a folha NÃO-SCN, que usa o template `-especial` e é o caso que
  // o defeito atingia por inteiro.
  inom: null,
  denominador_escala: 25000,
  ...BBOX,
  ...extra
})

// O DUBLÊ DA TASK, e ele é todo o banco de que a montagem precisa: a versão, as
// informações do produto, as da edição, as fases concluídas e as palavras-chave.
// Cada consulta é reconhecida pelo que ela nomeia, e não pela ordem, porque a
// ordem é detalhe do controlador e mudaria a cada refatoração.
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

// A fatia da `identificationInfo`, que é onde o bbox deve entrar -- e só ali.
const identificacao = xml =>
  xml.slice(
    xml.indexOf('<gmd:identificationInfo>'),
    xml.indexOf('</gmd:identificationInfo>')
  )

const qualidade = xml =>
  xml.slice(
    xml.indexOf('<gmd:dataQualityInfo>'),
    xml.indexOf('</gmd:dataQualityInfo>')
  )

describe('o defeito: nenhum template tem lacuna de bbox na identificationInfo', () => {
  // ISTO É O QUE TORNAVA O CÓDIGO ANTIGO INALCANÇÁVEL, e está aqui para que a
  // premissa do conserto seja verificável em vez de acreditada. Se um template
  // um dia ganhar as tags vazias lá dentro, este caso avisa que o desenho mudou.
  const arquivos = fs.readdirSync(TEMPLATES).filter(f => f.endsWith('.xml'))

  it('são os seis templates', () => {
    expect(arquivos).toHaveLength(6)
  })

  it.each(arquivos)('%s só tem westBoundLongitude na dataQualityInfo', arquivo => {
    const bruto = fs.readFileSync(path.join(TEMPLATES, arquivo), 'utf8')
    expect(identificacao(bruto)).not.toContain('westBoundLongitude')
    expect(qualidade(bruto)).toContain('westBoundLongitude')
  })
})

describe('o XML gerado carrega as quatro coordenadas', () => {
  it('as quatro tags entram, com os valores calculados no SELECT', async () => {
    const { xml, erros } = await gerar()
    const parte = identificacao(xml)

    expect(parte).toContain('<gmd:westBoundLongitude>')
    expect(parte).toContain('<gco:Decimal>-51.5</gco:Decimal>')
    expect(parte).toContain('<gmd:eastBoundLongitude>')
    expect(parte).toContain('<gco:Decimal>-51.25</gco:Decimal>')
    expect(parte).toContain('<gmd:southBoundLatitude>')
    expect(parte).toContain('<gco:Decimal>-30.125</gco:Decimal>')
    expect(parte).toContain('<gmd:northBoundLatitude>')
    expect(parte).toContain('<gco:Decimal>-30</gco:Decimal>')

    // E o aviso de "não entrou" não pode aparecer quando ele entrou.
    expect(erros.join(' ')).not.toContain('retângulo envolvente')
  })

  // A ORDEM É A DA NORMA (oeste, leste, sul, norte), e não é decoração: um
  // leitor que confie na ordem lê a folha deslocada quando ela troca.
  it('as quatro saem na ordem da norma', async () => {
    const { xml } = await gerar()
    // O `[a-z]` inicial deixa de fora o próprio `EX_GeographicBoundingBox`, que
    // é a caixa e não um dos lados.
    const ordem = [...identificacao(xml).matchAll(/<gmd:([a-z]\w*Bound\w+)>/g)].map(m => m[1])
    expect(ordem).toEqual([
      'westBoundLongitude',
      'eastBoundLongitude',
      'southBoundLatitude',
      'northBoundLatitude'
    ])
  })

  // A FOLHA SCN TAMBÉM RECEBE, e o template dela é outro: o `-especial` é para
  // quem não tem INOM. As duas famílias passam pelo mesmo caminho de montagem.
  it('a folha SCN, com INOM, também recebe as quatro', async () => {
    const { xml } = await gerar({ inom: 'SH-22-V-D-IV-1' })
    const parte = identificacao(xml)
    expect(parte).toContain('<gco:Decimal>-51.5</gco:Decimal>')
    expect(parte).toContain('<gco:Decimal>-30</gco:Decimal>')
  })

  // AS TRÊS FAMÍLIAS DE TEMPLATE, e a de orto é a que difere na forma: lá o
  // `geographicElement` já traz um `EX_GeographicBoundingBox` sem filhos, e nas
  // de topo e de vetor ele está vazio. Uma montagem que só soubesse tratar uma
  // das duas formas deixaria a outra sem extensão, calada.
  it.each([
    ['topo', SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG],
    ['orto', SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM],
    ['vetor', SUBTIPO_PRODUTO.CDGV_ET_EDGV_30]
  ])('o template %s recebe as quatro', async (_kind, subtipo) => {
    const { xml } = await gerar({ subtipo_produto_id: subtipo })
    const parte = identificacao(xml)
    for (const valor of ['-51.5', '-51.25', '-30.125', '-30']) {
      expect(parte).toContain(`<gco:Decimal>${valor}</gco:Decimal>`)
    }
  })

  // UM SÓ `EX_GeographicBoundingBox` NA IDENTIFICAÇÃO. Nos templates de orto ele
  // já existe vazio, e uma montagem que ACRESCENTASSE em vez de SUBSTITUIR
  // deixaria dois -- o segundo, vazio, é o que um validador leria.
  it('não sobra caixa envolvente vazia na identificação', async () => {
    const { xml } = await gerar({ subtipo_produto_id: SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM })
    const parte = identificacao(xml)
    expect(parte.match(/<gmd:EX_GeographicBoundingBox>/g)).toHaveLength(1)
    expect(parte).not.toMatch(/<gco:Decimal>\s*<\/gco:Decimal>/)
  })
})

describe('o sourceExtent da dataQualityInfo continua em branco', () => {
  // REGRA DOS XML REAIS DO BDGEx, e é ela que obriga o recorte por
  // `identificationInfo`: sem o recorte, a montagem acertaria os dois lugares.
  it('as quatro tags de lá seguem com o Decimal vazio', async () => {
    const { xml } = await gerar()
    const parte = qualidade(xml)
    expect(parte).toContain('<gmd:westBoundLongitude>')
    expect(parte.match(/<gco:Decimal><\/gco:Decimal>/g)).toHaveLength(4)
  })
})

describe('a extensão que não pôde ser escrita vira erro, e não silêncio', () => {
  // O SILÊNCIO ERA METADE DO DEFEITO: o XML saía incompleto com `erros` vazio, e
  // quem o gerou não tinha como saber.
  it('produto sem retângulo envolvente é acusado', async () => {
    const { xml, erros } = await gerar({
      bbox_w: null, bbox_e: null, bbox_s: null, bbox_n: null
    })
    expect(identificacao(xml)).not.toContain('westBoundLongitude')
    expect(erros.join(' | ')).toContain('retângulo envolvente não entrou no XML')
  })

  // OS QUATRO OU NENHUM: meia extensão passa pelo validador de forma e descreve
  // uma área errada, que é pior do que extensão nenhuma.
  it('meia extensão não é escrita, e também é acusada', async () => {
    const { xml, erros } = await gerar({ bbox_n: null })
    expect(identificacao(xml)).not.toContain('westBoundLongitude')
    expect(erros.join(' | ')).toContain('retângulo envolvente não entrou no XML')
  })
})
