'use strict'

// O que estes testes guardam é a ARITMÉTICA da articulação do SCN, e ela tem uma
// propriedade traiçoeira: quase toda troca errada continua produzindo um
// retângulo plausível. Trocar a ordem de leitura de uma matriz, ou usar `-4*i`
// em vez de `-4*(i+1)` no hemisfério sul, devolve uma folha do tamanho certo, no
// país certo, deslocada por uma célula ou por uma faixa inteira. Nada disso
// aparece "quebrado" numa tela.
//
// Por isso os casos abaixo trazem a bbox CONFERIDA À MÃO, e não recalculada pelo
// próprio módulo, e por isso três deles são folhas de cidade conhecida: se o
// centro do Rio de Janeiro deixar de cair na folha do Rio de Janeiro, a conta
// está errada, e isso um teste que só compara larguras nunca acusaria.

const scn = require('../../../utils/scn')
const { INVARIANTES } = require('../../../acervo/invariantes')

describe('scn: decomposição do INOM', () => {
  // Um caso por NÍVEL, do 1:1.000.000 ao 1:25.000, sobre a mesma linhagem, para
  // que um erro num nível apareça em tudo que desce dele.
  const LINHAGEM = [
    { inom: 'SF-22', escala: null, bbox: { xmin: -54, ymin: -24, xmax: -48, ymax: -20 } },
    { inom: 'SF-22-Y', escala: null, bbox: { xmin: -54, ymin: -24, xmax: -51, ymax: -22 } },
    { inom: 'SF-22-Y-D', escala: 4, bbox: { xmin: -52.5, ymin: -24, xmax: -51, ymax: -23 } },
    { inom: 'SF-22-Y-D-II', escala: 3, bbox: { xmin: -52, ymin: -23.5, xmax: -51.5, ymax: -23 } },
    { inom: 'SF-22-Y-D-II-4', escala: 2, bbox: { xmin: -51.75, ymin: -23.5, xmax: -51.5, ymax: -23.25 } },
    { inom: 'SF-22-Y-D-II-4-NE', escala: 1, bbox: { xmin: -51.625, ymin: -23.375, xmax: -51.5, ymax: -23.25 } }
  ]

  it.each(LINHAGEM)('$inom cai na bbox conferida à mão', ({ inom, escala, bbox }) => {
    const r = scn.poligonoDoInom(inom)
    expect(r.bbox).toEqual(bbox)
    expect(r.tipo_escala_id).toBe(escala)
  })

  // A folha SF-22 é a raiz da linhagem acima. Ela cobre de -54 a -48 porque o
  // fuso 22 começa em (22-30)*6-6 = -54, e de -24 a -20 porque no hemisfério sul
  // a letra F (sexta faixa contada do Equador) vai de -24 a -20. Com o piso em
  // -4*i a folha inteira subiria para -20/-16, e todos os filhos junto.
  it('a faixa do hemisfério sul vai de -4*(i+1) a -4*i, e não o contrário', () => {
    expect(scn.poligonoDoInom('SA-22').bbox).toEqual({ xmin: -54, ymin: -4, xmax: -48, ymax: 0 })
    expect(scn.poligonoDoInom('NA-22').bbox).toEqual({ xmin: -54, ymin: 0, xmax: -48, ymax: 4 })
    expect(scn.poligonoDoInom('SF-22').bbox.ymax).toBe(-20)
    expect(scn.poligonoDoInom('NF-22').bbox.ymin).toBe(20)
  })

  // As matrizes se leem de cima para baixo e da esquerda para a direita. Testado
  // no nível de 1:100.000, que é o único com três colunas e o único onde uma
  // troca de linha por coluna não se disfarça de simetria.
  it('a matriz de 1:100.000 é 3x2 lida de cima para baixo e da esquerda para a direita', () => {
    const canto = t => {
      const b = scn.poligonoDoInom(`SF-22-Y-D-${t}`).bbox
      return [b.xmin, b.ymax]
    }
    // SF-22-Y-D vai de -52.5 a -51 e de -24 a -23; cada célula mede 0.5 x 0.5.
    expect(canto('I')).toEqual([-52.5, -23])
    expect(canto('II')).toEqual([-52, -23])
    expect(canto('III')).toEqual([-51.5, -23])
    expect(canto('IV')).toEqual([-52.5, -23.5])
    expect(canto('V')).toEqual([-52, -23.5])
    expect(canto('VI')).toEqual([-51.5, -23.5])
  })

  it('o quadrante de 1:50.000 e o rumo de 1:25.000 também se leem em Z', () => {
    const q = t => scn.poligonoDoInom(`SF-22-Y-D-II-${t}`).bbox
    expect([q('1').xmin, q('1').ymax]).toEqual([-52, -23])
    expect([q('2').xmin, q('2').ymax]).toEqual([-51.75, -23])
    expect([q('3').xmin, q('3').ymax]).toEqual([-52, -23.25])
    expect([q('4').xmin, q('4').ymax]).toEqual([-51.75, -23.25])

    const r = t => scn.poligonoDoInom(`SF-22-Y-D-II-4-${t}`).bbox
    expect([r('NO').xmin, r('NO').ymax]).toEqual([-51.75, -23.25])
    expect([r('NE').xmin, r('NE').ymax]).toEqual([-51.625, -23.25])
    expect([r('SO').xmin, r('SO').ymax]).toEqual([-51.75, -23.375])
    expect([r('SE').xmin, r('SE').ymax]).toEqual([-51.5 - 0.125, -23.375])
  })

  // Prova independente da conta: três cidades cujo par (folha, coordenada) é
  // conhecido fora deste sistema.
  it.each([
    ['SF-23-Z-B-IV', 'Rio de Janeiro', -43.17, -22.91],
    ['SF-23-Y-C-VI-2', 'São Paulo', -46.63, -23.55],
    ['SD-23-Y-C-IV-3', 'Brasília', -47.88, -15.79]
  ])('a folha %s contém %s', (inom, _cidade, lon, lat) => {
    const { bbox } = scn.poligonoDoInom(inom)
    expect(lon).toBeGreaterThan(bbox.xmin)
    expect(lon).toBeLessThan(bbox.xmax)
    expect(lat).toBeGreaterThan(bbox.ymin)
    expect(lat).toBeLessThan(bbox.ymax)
  })
})

describe('scn: o EWKT', () => {
  it('sai fechado, anti-horário e em SIRGAS 2000', () => {
    expect(scn.poligonoDoInom('SF-22-Y-D-II-4-NE').ewkt).toBe(
      'SRID=4674;POLYGON((-51.625 -23.375, -51.5 -23.375, -51.5 -23.25, -51.625 -23.25, -51.625 -23.375))'
    )
  })

  // A cadeia de divisões passa por 1/3 (o nível de 1:100.000 tem três colunas).
  // O módulo a faz em segundos de arco justamente para a exatidão não depender
  // de a grade atual cair sempre em múltiplos de 1/2. O teste procura a
  // ASSINATURA do resíduo (casas decimais demais) e varre as 96 combinações
  // abaixo de uma folha de 1:250.000, porque um erro desses não aparece em toda
  // coluna: comparar uma folha só passaria verde com a conta trocada.
  it('nenhuma coordenada carrega lixo de ponto flutuante', () => {
    for (const t of ['I', 'II', 'III', 'IV', 'V', 'VI']) {
      for (const q of ['1', '2', '3', '4']) {
        for (const r of ['NO', 'NE', 'SO', 'SE']) {
          const ewkt = scn.poligonoDoInom(`SF-22-Y-D-${t}-${q}-${r}`).ewkt
          for (const n of ewkt.match(/-?\d+(\.\d+)?/g)) {
            expect(n).not.toMatch(/\.\d{4,}/)
          }
        }
      }
    }
  })
})

// O invariante `1e` de `acervo/invariantes.js` classifica a escala de um produto
// pelo TAMANHO da bbox, com faixas de tolerância. Ele é DEFECT: acusa quando o
// tamanho da geometria casa limpo com uma escala diferente da declarada.
//
// Se este módulo produzisse folha de tamanho diferente do que aquele invariante
// espera, todo produto cadastrado com geometria daqui viraria DEFECT no
// auditor, ou (pior) passaria pelo auditor com o tamanho errado. Por isso o
// teste lê as faixas do PRÓPRIO invariante, e não uma cópia: copiá-las aqui
// deixaria os dois livres para divergir em silêncio, que é justamente o que o
// invariante existe para impedir.
describe('scn x invariante 1e do acervo', () => {
  const FAIXAS = (() => {
    const sql = INVARIANTES.find(i => i.codigo === '1e').sql
    const encontradas = {}
    const re = /when w between ([\d.]+) and ([\d.]+) and h between ([\d.]+) and ([\d.]+) then (\d)/g
    let m
    while ((m = re.exec(sql)) !== null) {
      encontradas[Number(m[5])] = {
        wMin: Number(m[1]), wMax: Number(m[2]), hMin: Number(m[3]), hMax: Number(m[4])
      }
    }
    return encontradas
  })()

  it('o invariante declara faixa para as quatro escalas do SCN', () => {
    expect(Object.keys(FAIXAS).sort()).toEqual(['1', '2', '3', '4'])
  })

  it.each([
    ['SF-22-Y-D-II-4-NE', 1, 0.125, 0.125],
    ['SF-22-Y-D-II-4', 2, 0.25, 0.25],
    ['SF-22-Y-D-II', 3, 0.5, 0.5],
    ['SF-22-Y-D', 4, 1.5, 1]
  ])('%s mede %s x %s e cai na faixa do invariante', (inom, escala, largura, altura) => {
    const { bbox, tipo_escala_id: tipoEscalaId } = scn.poligonoDoInom(inom)
    const w = bbox.xmax - bbox.xmin
    const h = bbox.ymax - bbox.ymin

    expect(tipoEscalaId).toBe(escala)
    expect(w).toBe(largura)
    expect(h).toBe(altura)

    const faixa = FAIXAS[escala]
    expect(w).toBeGreaterThanOrEqual(faixa.wMin)
    expect(w).toBeLessThanOrEqual(faixa.wMax)
    expect(h).toBeGreaterThanOrEqual(faixa.hMin)
    expect(h).toBeLessThanOrEqual(faixa.hMax)
  })

  // O invariante `1d` mapeia profundidade do INOM em tokens para tipo_escala_id.
  // A regra vive lá num CASE de SQL e aqui numa tabela de JavaScript, e as duas
  // têm de dizer a mesma coisa: divergindo, todo produto cadastrado por esta
  // rota nasce como DEFECT do auditor.
  it.each([[4, 4], [5, 3], [6, 2], [7, 1]])(
    'INOM de %i tokens é tipo_escala_id %i, como no invariante 1d',
    (tokens, escala) => {
      const inom = 'SF-22-Y-D-II-4-NE'.split('-').slice(0, tokens).join('-')
      expect(scn.tipoEscalaDoInom(inom)).toBe(escala)
    }
  )

  it('1:1.000.000 e 1:500.000 não têm tipo_escala_id, porque não são domínio do SCA', () => {
    expect(scn.tipoEscalaDoInom('SF-22')).toBeNull()
    expect(scn.tipoEscalaDoInom('SF-22-Y')).toBeNull()
  })
})

describe('scn: gramática do INOM', () => {
  it.each([
    ['vazio', ''],
    ['nulo', null],
    ['indefinido', undefined],
    ['só a faixa, sem fuso', 'SF'],
    ['hemisfério que não existe', 'XF-22'],
    ['letra de faixa fora do alfabeto (W passaria de 90 graus)', 'SW-22'],
    ['fuso zero', 'SF-0'],
    ['fuso acima de 60', 'SF-61'],
    ['fuso que não é número', 'SF-2A'],
    ['token de 1:500.000 inexistente', 'SF-22-Q'],
    ['algarismo romano acima de VI', 'SF-22-Y-D-VII'],
    ['quadrante 5 em 1:50.000', 'SF-22-Y-D-II-5'],
    ['rumo inventado', 'SF-22-Y-D-II-4-XX'],
    ['fundo além de 1:25.000', 'SF-22-Y-D-II-4-NE-1'],
    ['um MI no lugar do INOM', '2965'],
    ['texto qualquer', 'Cerro da Gloria']
  ])('recusa %s', (_caso, entrada) => {
    expect(scn.normalizarInom(entrada)).toBeNull()
    expect(scn.poligonoDoInom(entrada)).toBeNull()
    expect(scn.tipoEscalaDoInom(entrada)).toBeNull()
    expect(scn.miDoInom(entrada)).toBeNull()
  })

  // O token de 1:500.000 usa V, X, Y, Z, e o de 1:100.000 usa I..VI. O 'V'
  // pertence aos dois com significados diferentes, e é a POSIÇÃO que decide.
  // Uma tabela única de tokens aceitaria 'SF-22-I' e 'SF-22-Y-D-Z'.
  it('o mesmo token em posição errada é recusado', () => {
    expect(scn.normalizarInom('SF-22-I')).toBeNull()
    expect(scn.normalizarInom('SF-22-Y-D-Z')).toBeNull()
    expect(scn.normalizarInom('SF-22-V')).toBe('SF-22-V')
    expect(scn.normalizarInom('SF-22-Y-D-V')).toBe('SF-22-Y-D-V')
  })

  it.each([
    ['minúsculas e espaços', 'sf 22 y d ii 4 ne'],
    ['barra como separador', 'SF/22/Y/D/II/4/NE'],
    ['sublinhado', 'SF_22_Y_D_II_4_NE'],
    ['sinal de menos unicode, que o Word produz sozinho', 'SF−22−Y−D−II−4−NE'],
    ['espaço em volta', '  SF-22-Y-D-II-4-NE  ']
  ])('normaliza %s', (_caso, entrada) => {
    expect(scn.normalizarInom(entrada)).toBe('SF-22-Y-D-II-4-NE')
  })
})

describe('scn: MI x INOM', () => {
  it('resolve o MI da folha em cada escala que tem MI', () => {
    expect(scn.miDoInom('SF-22-Y-D-II-4-NE')).toEqual({ mi: '2757-4-NE' })
    expect(scn.miDoInom('SF-22-Y-D-II-4')).toEqual({ mi: '2757-4' })
    expect(scn.miDoInom('SF-22-Y-D-II')).toEqual({ mi: '2757' })
    expect(scn.miDoInom('SF-22-Y-D')).toEqual({ mi: '496' })
  })

  it('devolve o MI sem zero à esquerda, que é como o acervo o grava', () => {
    // Na planilha da DSG este MI está como '0001'. O invariante 1i cobra a forma
    // sem preenchimento, e devolver '0001' faria a resposta desta rota não casar
    // com a busca do acervo por igualdade de string.
    expect(scn.miDoInom('NB-20-Z-B-V')).toEqual({ mi: '1' })
  })

  it('ida e volta MI -> INOM -> MI nas quatro escalas', () => {
    for (const inom of ['SF-22-Y-D', 'SF-22-Y-D-II', 'SF-22-Y-D-II-4', 'SF-22-Y-D-II-4-NE']) {
      const { mi } = scn.miDoInom(inom)
      const escala = scn.tipoEscalaDoInom(inom)
      expect(scn.inomDoMi(mi, escala)).toBe(inom)
      expect(scn.miDoInom(scn.inomDoMi(mi, escala))).toEqual({ mi })
    }
  })

  it('aceita o MI escrito como o solicitante escreve', () => {
    expect(scn.inomDoMi('2757/4/ne')).toBe('SF-22-Y-D-II-4-NE')
    expect(scn.inomDoMi(' 02757 4 NE ')).toBe('SF-22-Y-D-II-4-NE')
  })

  // O sufixo de letra é legítimo (invariante 1i), e sem ele o normalizador de MI
  // devolvia null para 42 folhas que existem.
  it('resolve MI com sufixo de letra', () => {
    expect(scn.inomDoMi('2A')).toBe('NB-21-Y-A-IV')
    expect(scn.inomDoMi('0002A')).toBe('NB-21-Y-A-IV')
    expect(scn.miDoInom('NB-21-Y-A-IV')).toEqual({ mi: '2A' })
  })

  it('MI que não existe no Mapa Índice devolve null', () => {
    expect(scn.inomDoMi('9999')).toBeNull()
    expect(scn.inomDoMi('9999-1-NE')).toBeNull()
    expect(scn.inomDoMi('não é um MI')).toBeNull()
  })
})

describe('scn: folha sem MI é resposta, e não erro', () => {
  it('1:1.000.000 e 1:500.000 nunca recebem MI', () => {
    for (const inom of ['SF-22', 'SF-22-Y']) {
      const r = scn.miDoInom(inom)
      expect(r.sem_mi).toBe(true)
      expect(r.mi).toBeUndefined()
      expect(r.motivo).toMatch(/1:1\.000\.000/)
    }
  })

  // SF-32 fica na costa da África: INOM impecável, folha real, sem MI nenhum.
  // Sem a tabela, qualquer conta inventaria um número para ela.
  it('folha fora do território brasileiro não tem MI', () => {
    const r = scn.miDoInom('SF-32-Y-D')
    expect(r.sem_mi).toBe(true)
    expect(r.motivo).toMatch(/território nacional/)
    // E continua tendo geometria: o SCN cobre o mundo, o Mapa Índice não.
    expect(scn.poligonoDoInom('SF-32-Y-D').bbox).toEqual({ xmin: 7.5, ymin: -24, xmax: 9, ymax: -23 })
  })

  // As duas listas de exclusão do DSGTools são COMPLEMENTARES, e a interseção
  // entre elas é vazia (medido: 0 de 856). Quem consultasse só a de 1:25.000
  // devolveria MI inventado para as 1.712 folhas que descem dos 428 quadrantes
  // excluídos, e o número sairia perfeitamente formado.
  it('folha de 1:50.000 da lista de exclusão não tem MI, e os quatro filhos também não', () => {
    const r = scn.miDoInom('NA-19-X-C-VI-1')
    expect(r.sem_mi).toBe(true)
    expect(r.motivo).toMatch(/exclusão/)

    for (const rumo of ['NO', 'NE', 'SO', 'SE']) {
      const filho = scn.miDoInom(`NA-19-X-C-VI-1-${rumo}`)
      expect(filho.sem_mi).toBe(true)
    }
  })

  it('folha de 1:25.000 da lista de exclusão não tem MI, mesmo com o quadrante tendo', () => {
    // O quadrante NA-19-X-C-VI-3 TEM MI; só três das quatro folhas dele é que
    // não têm. É este caso que uma lista aninhada não pegaria.
    expect(scn.miDoInom('NA-19-X-C-VI-3').mi).toBeDefined()
    expect(scn.miDoInom('NA-19-X-C-VI-3-NE').sem_mi).toBe(true)
    expect(scn.miDoInom('NA-19-X-C-VI-3-SE')).toEqual({ mi: scn.miDoInom('NA-19-X-C-VI-3').mi + '-SE' })
  })

  // O caminho de volta obedece à MESMA exclusão da ida. Sem isso as duas funções
  // do módulo se contradiriam: uma afirmando que a folha tem aquele MI, e a
  // outra negando.
  it('inomDoMi não devolve folha cujo MI a tabela nega', () => {
    const semMi = scn.miDoInom('NA-19-X-C-VI-1')
    expect(semMi.sem_mi).toBe(true)
    const mi100 = scn.miDoInom('NA-19-X-C-VI').mi
    expect(scn.inomDoMi(`${mi100}-1`)).toBeNull()
  })
})

describe('scn: a ambiguidade do MI nu', () => {
  // Na planilha o MI de 1:250.000 tem três dígitos e o de 1:100.000 tem quatro,
  // e o preenchimento os separava. O acervo grava sem o preenchimento, e a
  // distinção some. Isto não é bug a consertar: é a razão de existir o segundo
  // argumento, e o teste prende o comportamento dos dois lados.
  it('sem a dica, o MI nu resolve em 1:100.000', () => {
    expect(scn.inomDoMi('1')).toBe('NB-20-Z-B-V')
    expect(scn.tipoEscalaDoInom(scn.inomDoMi('1'))).toBe(3)
  })

  it('com a dica, alcança a folha de 1:250.000', () => {
    expect(scn.inomDoMi('1', 4)).toBe('NB-20-Z-B')
    expect(scn.tipoEscalaDoInom(scn.inomDoMi('1', 4))).toBe(4)
  })

  it('MI com quadrante nunca é ambíguo, porque 1:250.000 não tem quadrante', () => {
    expect(scn.inomDoMi('2757-4')).toBe('SF-22-Y-D-II-4')
    expect(scn.inomDoMi('2757-4', 4)).toBe('SF-22-Y-D-II-4')
  })
})
