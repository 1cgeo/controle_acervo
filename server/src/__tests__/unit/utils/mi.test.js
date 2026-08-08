'use strict'

// `utils/mi.js` e `mapoteca_cli/lib/mi.js` sao GEMEOS deliberados (o CLI tem
// dependencia zero e nao enxerga o servidor). Estes casos sao os mesmos do
// `mapoteca_cli/__tests__/plano.test.js`, de proposito: quando um dos dois lados
// mudar de comportamento sem o outro, um dos dois arquivos de teste acusa.

const fs = require('fs')
const path = require('path')

const mi = require('../../../utils/mi')

describe('mi.normalizar', () => {
  it.each([
    ['forma canonica passa intacta', '2962-4-NE', '2962-4-NE'],
    ['barra como separador', '2962/4/ne', '2962-4-NE'],
    ['espaco e zero a esquerda', ' 02962 4 NE ', '2962-4-NE'],
    ['sinal de menos unicode, que o Word produz sozinho', '2962−4−NE', '2962-4-NE'],
    ['igual como separador', '2962=4=NE', '2962-4-NE'],
    ['sublinhado', '2962_4_NE', '2962-4-NE'],
    ['so o numero da folha', '2962', '2962'],
    ['so o quadrante', '2962-4', '2962-4']
  ])('%s', (_caso, entrada, esperado) => {
    expect(mi.normalizar(entrada)).toBe(esperado)
  })

  // O zero a esquerda sai SO do primeiro grupo. Nos quadrantes ele nunca ocorre,
  // e tirar de la so criaria ruido.
  it('nao mexe em zero fora do primeiro grupo', () => {
    expect(mi.normalizar('0155')).toBe('155')
    expect(mi.normalizar('0000')).toBe('0')
  })

  // O sufixo de letra e legitimo: sao 29 MIs de 100k e 13 de 250k na tabela
  // oficial da DSG, e o invariante 1i do acervo ja o declara valido. Sem ele o
  // normalizador devolvia null para folha que EXISTE.
  it('aceita o sufixo de letra do MI', () => {
    expect(mi.normalizar('2882A')).toBe('2882A')
    expect(mi.normalizar('0002A')).toBe('2A')
    expect(mi.normalizar('2882A-4-SE')).toBe('2882A-4-SE')
  })

  it.each([
    ['nome de folha', 'Cerro da Gloria'],
    ['quadrante que nao existe', '2962-9-NE'],
    ['rumo inventado', '2962-4-XX'],
    ['numero longo demais', '29625'],
    ['vazio', ''],
    ['so separador', '---'],
    ['nulo', null],
    ['indefinido', undefined]
  ])('recusa %s', (_caso, entrada) => {
    expect(mi.normalizar(entrada)).toBeNull()
  })
})

describe('mi.iguais', () => {
  it('compara pela forma canonica', () => {
    expect(mi.iguais('02962-4', '2962-4')).toBe(true)
    expect(mi.iguais('2962/4', '2962-4')).toBe(true)
  })

  it('entrada invalida nunca casa, nem consigo mesma', () => {
    expect(mi.iguais('lixo', 'lixo')).toBe(false)
    expect(mi.iguais(null, null)).toBe(false)
  })
})

describe('mi.normalizarIdentificador', () => {
  // Este e o extra do lado do servidor. Ele substituiu duas copias de tres
  // linhas (`normIdentificador`, em `acervo_ctrl` e em `integracao_ctrl`) que so
  // tiravam caixa e espaco: quem pedia a folha `0155` nao achava a gravada como
  // `155`, sem erro nenhum, so um "Nao mapeado" falso.
  it('normaliza o MI como MI', () => {
    expect(mi.normalizarIdentificador('0155')).toBe('155')
    expect(mi.normalizarIdentificador('2962/4/ne')).toBe('2962-4-NE')
  })

  it('deixa o INOM em caixa alta sem espaco, como a copia antiga fazia', () => {
    expect(mi.normalizarIdentificador('sf-22-y-d')).toBe('SF-22-Y-D')
    expect(mi.normalizarIdentificador(' SF-22 -Y ')).toBe('SF-22-Y')
  })

  // Todo INOM comeca por letra, e o PADRAO do MI exige digito no primeiro grupo:
  // nao ha entrada que possa ser lida como as duas coisas.
  it('nenhum INOM cai no ramo do MI', () => {
    for (const inom of ['SF-22', 'NB-20-Z-B-V', 'SI-22-V-C-IV-4-SE']) {
      expect(mi.normalizar(inom)).toBeNull()
      expect(mi.normalizarIdentificador(inom)).toBe(inom)
    }
  })

  it('devolve string vazia para nulo, porque o chamador usa isto como chave de Set', () => {
    expect(mi.normalizarIdentificador(null)).toBe('')
    expect(mi.normalizarIdentificador(undefined)).toBe('')
  })
})

// O gemeo nao pode ser importado daqui (o CLI vive fora de `server/` e nao entra
// no `rootDir` do Jest), entao o que se compara e o FONTE. Um gemeo que ninguem
// confere e uma copia: a divergencia tem de aparecer no commit em que nasce, e
// nao meses depois, quando um bug so reproduz por um dos dois caminhos.
//
// Compara o CODIGO, e nao o comentario. Nao e frouxidao: o comentario de cada
// lado fala do contexto DAQUELE lado (o do servidor cita `utils/scn_dados/`, que
// no CLI nao existe), e exigir prosa identica so ensinaria a proxima pessoa a
// apagar a assercao. O que nao pode divergir e a regra que roda.
describe('gemeo do mapoteca_cli', () => {
  const AQUI = path.join(__dirname, '..', '..', '..', 'utils', 'mi.js')
  const CLI = path.join(__dirname, '..', '..', '..', '..', '..', 'mapoteca_cli', 'lib', 'mi.js')

  // Do primeiro `const SEPARADORES` ate o fim de `iguais`. O que vem depois e
  // exclusivo de cada lado (aqui, `normalizarIdentificador`; la, o
  // `module.exports` mais curto).
  const MARCO_INICIAL = 'const SEPARADORES'
  const MARCO_FINAL = '/** Compara dois MIs pela forma canonica'

  const codigoCompartilhado = (arquivo) => {
    const fonte = fs.readFileSync(arquivo, 'utf8')
    const inicio = fonte.indexOf(MARCO_INICIAL)
    const fim = fonte.indexOf(MARCO_FINAL)
    expect(inicio).toBeGreaterThanOrEqual(0)
    expect(fim).toBeGreaterThan(inicio)

    // O FIM DE LINHA NAO ENTRA NA COMPARACAO. O que nao pode divergir e a REGRA
    // que roda, e com `core.autocrlf` ligado os dois arquivos chegam ao disco
    // com terminadores que dependem de como cada um entrou no repositorio: o
    // teste acusava divergencia mostrando duas linhas identicas.
    return fonte
      .slice(inicio, fim)
      .split(/\r\n?|\n/)
      .filter(linha => linha.trim() && !linha.trim().startsWith('//'))
      .join('\n')
  }

  it('a regra do MI e a mesma linha por linha nos dois arquivos', () => {
    const compartilhado = codigoCompartilhado(AQUI)

    // A assercao so vale se o trecho recortado tiver de fato as duas regras. Sem
    // isto, um marco que deixasse de casar recortaria string vazia e o teste
    // passaria comparando nada com nada.
    expect(compartilhado).toContain('const PADRAO')
    expect(compartilhado).toContain('function normalizar (bruto)')

    expect(compartilhado).toBe(codigoCompartilhado(CLI))
  })
})
