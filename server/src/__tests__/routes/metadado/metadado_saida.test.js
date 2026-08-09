'use strict'

// A SAIDA DO METADADO: o JSON de edicao e o XML, sem tocar o banco.
//
// O QUE ESTE ARQUIVO PROTEGE nao e a consulta, e a REGRA: qual template a folha
// recebe, que licenca o produto carrega, que tipo o plugin vai ler e o que a
// porta de QA cobra antes de deixar o JSON sair. Errar qualquer uma produz um
// arquivo plausivel e errado, que sobe para o BDGEx ou vai para a moldura sem
// que nada acuse -- e a moldura ja estara impressa quando alguem perceber.
//
// Banco mockado: nada aqui abre conexao, e por isso os casos rodam no pacote
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

const {
  escapeXml,
  fmtEscala,
  isoData,
  normalizaCaminhoRede,
  resolveLicenca,
  resolveTipoVersao,
  validarJsonEdicao,
  SUBTIPO_PRODUTO,
  XML_KIND_POR_SUBTIPO,
  LINHAGEM_FASE,
  EQUIDISTANCIA_POR_ESCALA
} = metadadoCtrl._helpers

const { TIPO_FASE } = require('../../../utils/domain_constants')

const TEMPLATES = path.resolve(__dirname, '..', '..', '..', 'metadado', 'xml_templates')

describe('A escolha do template de XML sai do SUBTIPO do produto', () => {
  // `tipo_produto_id` do SAP virou `subtipo_produto_id` aqui, e os codes sao os
  // mesmos: 22 dos 23 identicos ate no nome, e so o 19 difere de ROTULO (la
  // Carta Ortoimagem OM, aqui Carta Ortoimagem de SARP).
  it('a carta topográfica, nas duas especificações, vai para o template topo', () => {
    expect(XML_KIND_POR_SUBTIPO[SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_T34_700]).toBe('topo')
    expect(XML_KIND_POR_SUBTIPO[SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG]).toBe('topo')
  })

  it('a carta ortoimagem vai para o template orto', () => {
    expect(XML_KIND_POR_SUBTIPO[SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM]).toBe('orto')
    expect(XML_KIND_POR_SUBTIPO[SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM_SARP]).toBe('orto')
  })

  it('os CDGV vetoriais vão para o template vetor', () => {
    for (const code of [
      SUBTIPO_PRODUTO.CDGV_ET_EDGV_213,
      SUBTIPO_PRODUTO.CDGV_ET_EDGV_30,
      SUBTIPO_PRODUTO.CDGV_MGCP,
      SUBTIPO_PRODUTO.CDGV_MUVD,
      SUBTIPO_PRODUTO.CDGV_ORTOIMAGEM_ET_EDGV_30,
      SUBTIPO_PRODUTO.CDGV_TRAFEGABILIDADE
    ]) {
      expect(XML_KIND_POR_SUBTIPO[code]).toBe('vetor')
    }
  })

  // A ORTOIMAGEM CRUA NAO PUBLICA XML DE METADADO, e a ausencia e a regra: ela
  // nao e carta nem CDGV. Um default aqui faria a imagem sair com a moldura de
  // uma carta que ela nao e.
  it('a ortoimagem crua não tem template, e a ausência é deliberada', () => {
    expect(XML_KIND_POR_SUBTIPO[SUBTIPO_PRODUTO.ORTOIMAGEM]).toBeUndefined()
  })

  it('os seis templates que o mapa aponta existem em disco', () => {
    const nomes = new Set(fs.readdirSync(TEMPLATES))
    for (const kind of new Set(Object.values(XML_KIND_POR_SUBTIPO))) {
      expect(nomes.has(`metadados-${kind}.xml`)).toBe(true)
      // A folha nao-SCN (sem INOM) usa o `-especial`: titulo so o NOME, e sem
      // identificador SCN.
      expect(nomes.has(`metadados-${kind}-especial.xml`)).toBe(true)
    }
  })
})

describe('Todo marcador dos templates é preenchido pelo controlador', () => {
  // O CONTROLADOR JA ACUSA MARCADOR NAO PREENCHIDO em tempo de execucao (o
  // campo `erros` lista o que sobrou). Este caso pega a mesma falha ANTES, na
  // hora de acrescentar um marcador ao template: la o aviso so aparece quando
  // alguem gera o XML de uma folha de verdade.
  const marcadoresDosTemplates = () => {
    const achados = new Set()
    for (const nome of fs.readdirSync(TEMPLATES).filter(f => f.endsWith('.xml'))) {
      const s = fs.readFileSync(path.join(TEMPLATES, nome), 'utf8')
      for (const m of s.matchAll(/\{\{([A-Z_]+)\}\}/g)) achados.add(m[1])
    }
    return achados
  }

  // Os que o controlador preenche: as chaves do objeto `valores` (substituidas
  // em bloco) mais os dois fragmentos compostos, trocados por nome.
  const marcadoresDoControlador = () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'metadado', 'metadado_ctrl.js'), 'utf8'
    )
    const inicio = fonte.indexOf('const valores = {')
    const fim = fonte.indexOf('\n  }', inicio)
    const bloco = fonte.slice(inicio, fim)

    const achados = new Set(
      [...bloco.matchAll(/^\s{4}([A-Z_]+):/gm)].map(m => m[1])
    )
    for (const m of fonte.matchAll(/split\('\{\{([A-Z_]+)\}\}'\)/g)) achados.add(m[1])
    return achados
  }

  it('as duas varreduras acham alguma coisa', () => {
    expect(marcadoresDosTemplates().size).toBeGreaterThanOrEqual(15)
    expect(marcadoresDoControlador().size).toBeGreaterThanOrEqual(15)
  })

  it('nenhum marcador do template fica sem quem o preencha', () => {
    const preenchidos = marcadoresDoControlador()
    const orfaos = [...marcadoresDosTemplates()].filter(m => !preenchidos.has(m))
    expect(orfaos).toEqual([])
  })
})

describe('A licença do produto é CONTAMINADA pela origem da altimetria', () => {
  // REGRA DO CHEFE, herdada do SAP: FABDEM e FathomDEM sao nao comerciais e
  // OBRIGAM CC-BY-NC-SA, mesmo que alguem tenha gravado o valor comercial por
  // engano. O selo impresso na moldura sai daqui.
  it('FABDEM obriga a licença não comercial', () => {
    expect(resolveLicenca({ origem_dados_altimetricos: 'MDE FABDEM 2023' }))
      .toBe('CC-BY-NC-SA 4.0')
  })

  it('FathomDEM obriga a mesma licença, em qualquer caixa', () => {
    expect(resolveLicenca({ origem_dados_altimetricos: 'fathomdem v1' }))
      .toBe('CC-BY-NC-SA 4.0')
  })

  it('a origem não comercial vence o valor comercial gravado por engano', () => {
    expect(resolveLicenca({
      origem_dados_altimetricos: 'FABDEM',
      licenca_produto: 'CC-BY-SA 4.0'
    })).toBe('CC-BY-NC-SA 4.0')
  })

  it('fora disso, respeita o valor explícito', () => {
    expect(resolveLicenca({
      origem_dados_altimetricos: 'Restituição fotogramétrica',
      licenca_produto: 'CC-BY-NC-SA 4.0'
    })).toBe('CC-BY-NC-SA 4.0')
  })

  it('sem valor explícito, a licença padrão é a comercial', () => {
    expect(resolveLicenca({ origem_dados_altimetricos: 'Copernicus' }))
      .toBe('CC-BY-SA 4.0')
  })
})

describe('O tipo e a versão do produto que o plugin vai ler', () => {
  const orto = { subtipo_produto_id: SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM }
  const topo = { subtipo_produto_id: SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG }
  const sarp = { subtipo_produto_id: SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM_SARP }

  it('deriva o tipo do subtipo quando não há valor explícito', () => {
    expect(resolveTipoVersao({}, topo).tipo).toBe('Carta Topográfica')
    expect(resolveTipoVersao({}, orto).tipo).toBe('Carta Ortoimagem')
  })

  it('a carta militar muda o tipo, e a de SARP é a exceção', () => {
    expect(resolveTipoVersao({ carta_militar: true }, topo).tipo)
      .toBe('Carta Topográfica Militar')
    expect(resolveTipoVersao({ carta_militar: true }, orto).tipo)
      .toBe('Carta Ortoimagem Militar')
    // A de SARP tem tipo proprio, e a marca de carta militar nao o troca.
    expect(resolveTipoVersao({ carta_militar: true }, sarp).tipo)
      .toBe('Carta Ortoimagem OM')
  })

  it('o valor explícito vence a derivação', () => {
    expect(resolveTipoVersao({ tipo_produto: 'Carta Ortoimagem' }, topo).tipo)
      .toBe('Carta Ortoimagem')
  })

  // SUBTIPO FORA DO MAPA FICA INDEFINIDO DE PROPOSITO, e o validador acusa. Um
  // default de 'Carta Topográfica' sairia silenciosamente errado.
  it('subtipo sem mapeamento não ganha tipo por default', () => {
    expect(resolveTipoVersao({}, { subtipo_produto_id: SUBTIPO_PRODUTO.ORTOIMAGEM }).tipo)
      .toBeUndefined()
  })

  it('a versão padrão do produto sai do tipo da carta', () => {
    expect(resolveTipoVersao({}, topo).versao).toBe('2.0')
    expect(resolveTipoVersao({}, orto).versao).toBe('3.0')
    expect(resolveTipoVersao({}, sarp).versao).toBe('1.0')
  })
})

describe('A porta de QA do JSON de edição', () => {
  const jsonMinimo = () => ({
    tipo_produto: 'Carta Topográfica',
    versao_produto: '2.0',
    nome: 'Porto Alegre',
    inom: 'SH-22-V-D-IV-1',
    banco: { servidor: 'servidor', porta: '5432', nome: 'edicao' },
    // path-ok na linha abaixo: caminho inventado, e o que a fixtura exercita
    // e a FORMA do caminho. Nenhum volume real aparece neste arquivo.
    mde_diagrama_elevacao: { caminho_mde: 'Y:\\mde\\folha.tif', epsg: '4674' }, // path-ok
    fases: [{ fase: 'Edição' }],
    info_tecnica: {
      data_criacao: '2019-2021',
      pec_planimetrico: 'PEC-PCD A',
      pec_altimetrico: 'PEC-PCD A',
      datum_vertical: 'Datum de Imbituba - SC',
      origem_dados_altimetricos: 'Copernicus',
      dados_terceiros: []
    }
  })

  it('o JSON completo passa sem nenhum erro', () => {
    expect(validarJsonEdicao(jsonMinimo())).toEqual([])
  })

  it('acusa o banco de edição não resolvido', () => {
    const json = { ...jsonMinimo(), banco: {} }
    expect(validarJsonEdicao(json)).toContain(
      'banco de edição (servidor/porta/nome) não resolvido a partir das unidades de trabalho da fase de Edição'
    )
  })

  // ESPACO NO CAMINHO DERRUBA A EXPORTACAO, e o erro aparece longe: a folha sai
  // sem PDF e ninguem liga uma coisa a outra.
  it('acusa o espaço no caminho do MDE', () => {
    const json = jsonMinimo()
    json.mde_diagrama_elevacao.caminho_mde = 'Y:\\mde da folha\\x.tif'
    expect(validarJsonEdicao(json)).toContain('caminho_mde contém espaço (a exportação falha)')
  })

  it('acusa o caminho de rede com uma barra invertida só', () => {
    const json = jsonMinimo()
    json.mde_diagrama_elevacao.caminho_mde = '\\rede\\mde\\x.tif' // path-ok
    expect(validarJsonEdicao(json)).toContain(
      'caminho_mde é caminho de rede quebrado (uma barra invertida inicial em vez de duas; a exportação falha)'
    )
  })

  // A CARTA ORTOIMAGEM PRECISA DE IMAGEM E DE SENSOR, e a topografica nao.
  it('a carta ortoimagem sem imagem e sem sensor é acusada', () => {
    const json = { ...jsonMinimo(), tipo_produto: 'Carta Ortoimagem', versao_produto: '3.0' }
    const erros = validarJsonEdicao(json)
    expect(erros).toContain('imagens ausente (carta ortoimagem)')
    expect(erros).toContain('sensores ausente (carta ortoimagem)')
  })

  it('a carta topográfica não é cobrada por imagem nem por sensor', () => {
    expect(validarJsonEdicao(jsonMinimo())).toEqual([])
  })

  // A FOLHA NAO-SCN NAO TEM INOM, e o centro entra no lugar dele.
  it('aceita a folha sem INOM quando há centro', () => {
    const { inom: _inom, ...semInom } = jsonMinimo()
    semInom.center = { latitude: -30.1, longitude: -51.2 }
    expect(validarJsonEdicao(semInom)).toEqual([])
  })

  it('acusa a folha sem INOM e sem centro', () => {
    const { inom: _inom, ...semInom } = jsonMinimo()
    expect(validarJsonEdicao(semInom)).toContain(
      'inom (ou center, na carta não-SCN) ausente'
    )
  })
})

describe('O conserto do caminho de rede quebrado', () => {
  // SO MEXE NUM CASO: a barra invertida inicial sozinha. Caminho de rede valido,
  // caminho com letra de unidade e caminho POSIX ficam intactos.
  //
  // OS MARCADORES `path-ok` DESTE BLOCO sao o uso legitimo do escape do guarda
  // anti-vazamento: a linha E o exemplo da propria regra, e o que ela prova e
  // como a funcao trata a FORMA do caminho. Nenhum caminho real aparece aqui.
  it('dobra a barra invertida inicial solitária', () => {
    expect(normalizaCaminhoRede('\\maquina\\pasta\\x.tif')).toBe('\\\\maquina\\pasta\\x.tif') // path-ok
  })

  it('não mexe no caminho de rede já correto', () => {
    expect(normalizaCaminhoRede('\\\\maquina\\pasta\\x.tif')).toBe('\\\\maquina\\pasta\\x.tif') // path-ok
  })

  it('não mexe em caminho com letra de unidade nem em caminho POSIX', () => {
    expect(normalizaCaminhoRede('Y:\\pasta\\x.tif')).toBe('Y:\\pasta\\x.tif') // path-ok
    expect(normalizaCaminhoRede('/dados/x.tif')).toBe('/dados/x.tif')
  })

  it('devolve nulo e vazio intactos', () => {
    expect(normalizaCaminhoRede(null)).toBeNull()
    expect(normalizaCaminhoRede('')).toBe('')
  })
})

describe('Formatação de data e de escala no XML', () => {
  // USA OS COMPONENTES LOCAIS, e nao `toISOString`: aquele e UTC e rolaria o dia
  // para tras em atividade concluida a noite no fuso de Brasilia.
  it('a data do banco vira AAAA-MM-DD pelo calendário local', () => {
    const d = new Date(2026, 7, 9, 22, 30) // 9 de agosto de 2026, 22h30 local
    expect(isoData(d)).toBe('2026-08-09')
  })

  it('aceita a data digitada em DD/MM/AAAA', () => {
    expect(isoData('09/08/2026')).toBe('2026-08-09')
  })

  it('devolve texto vazio quando não há data', () => {
    expect(isoData(null)).toBe('')
  })

  it('a escala sai com separador de milhar', () => {
    expect(fmtEscala(25000)).toBe('25.000')
    expect(fmtEscala(250000)).toBe('250.000')
  })

  it('o XML escapa os três caracteres que quebram o documento', () => {
    expect(escapeXml('Mapa & Cia <teste>')).toBe('Mapa &amp; Cia &lt;teste&gt;')
  })

  it('a equidistância é declarada para as escalas da articulação', () => {
    expect(EQUIDISTANCIA_POR_ESCALA[25000]).toBe('10')
    expect(EQUIDISTANCIA_POR_ESCALA[250000]).toBe('100')
    // ESCALA NAO MAPEADA SAI VAZIA, E O VALIDADOR ACUSA. Um numero plausivel e
    // errado na equidistância da curva vai impresso na moldura.
    expect(EQUIDISTANCIA_POR_ESCALA[123456]).toBeUndefined()
  })
})

describe('A linhagem é chaveada pelo CODE da fase, e não pelo nome', () => {
  // O NOME E ROTULO e muda sem aviso: trocar 'Extração' por 'Extração de
  // feições' em `dominio.tipo_fase` derrubaria a linhagem inteira sem erro
  // nenhum, e a mudanca pareceria inocente. A origem chaveava pelo nome.
  it('as quatro fases que entram na linhagem estão pelo code', () => {
    expect(LINHAGEM_FASE[TIPO_FASE.PREPARO].desc).toBe('PreparoCDG')
    expect(LINHAGEM_FASE[TIPO_FASE.EXTRACAO].desc).toBe('DigitalizaçãoTela')
    expect(LINHAGEM_FASE[TIPO_FASE.VALIDACAO].desc).toBe('ValidaçãoQGIS')
    expect(LINHAGEM_FASE[TIPO_FASE.EDICAO].desc).toBe('Edição')
  })

  // FASE SEM MAPEAMENTO NAO ENTRA NA LINHAGEM, e a ausencia e a regra: a
  // Disseminacao nao e um passo de producao do dado.
  it('a disseminação não entra na linhagem', () => {
    expect(LINHAGEM_FASE[TIPO_FASE.DISSEMINACAO]).toBeUndefined()
  })
})
