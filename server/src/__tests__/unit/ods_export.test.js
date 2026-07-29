'use strict'

const zlib = require('zlib')
const { criarOds, letraColuna, partesData } = require('../../utils/ods_export')

// Lê de volta as entradas do ZIP que criarOds escreveu. Existe para o teste
// PROVAR o arquivo, e não a intenção: sem descompactar, todo teste aqui
// afirmaria só que a função devolveu bytes.
const lerZip = (buffer) => {
  const entradas = {}
  let i = 0
  while (buffer.readUInt32LE(i) === 0x04034b50) {
    const metodo = buffer.readUInt16LE(i + 8)
    const tamanhoComprimido = buffer.readUInt32LE(i + 18)
    const tamanhoNome = buffer.readUInt16LE(i + 26)
    const tamanhoExtra = buffer.readUInt16LE(i + 28)
    const nome = buffer.slice(i + 30, i + 30 + tamanhoNome).toString('utf8')
    const inicio = i + 30 + tamanhoNome + tamanhoExtra
    const dados = buffer.slice(inicio, inicio + tamanhoComprimido)
    entradas[nome] = {
      metodo,
      conteudo: metodo === 0 ? dados : zlib.inflateRawSync(dados)
    }
    i = inicio + tamanhoComprimido
  }
  return entradas
}

const COLUNAS = [
  { key: 'om', label: 'OM Destino', largura: '2.805cm' },
  { key: 'qtd', label: 'Qnt Prevista', tipo: 'numero' },
  { key: 'material', label: 'Mat\nPrevisto' },
  { key: 'entrega', label: 'Data da Entrega', tipo: 'data' }
]

const LINHAS = [
  { om: '18º BI Mtz', qtd: 4, material: 'sulfite', entrega: '2026-02-10' },
  { om: '6º RCB', qtd: 12, material: 'tyvek', entrega: null }
]

const gerar = (opts = {}) => lerZip(criarOds({
  aba: 'META4_DETALHADA',
  colunas: COLUNAS,
  linhas: LINHAS,
  ...opts
}))

describe('ods_export', () => {
  describe('estrutura do pacote ODF', () => {
    it('mimetype é a PRIMEIRA entrada e vai SEM compressão', () => {
      const buffer = criarOds({ aba: 'A', colunas: COLUNAS, linhas: LINHAS })
      const entradas = lerZip(buffer)
      const nomes = Object.keys(entradas)

      expect(nomes[0]).toBe('mimetype')
      // Método 0 = store. É exigência do ODF: o descompactador identifica o tipo
      // do documento lendo esses bytes crus, sem abrir o XML.
      expect(entradas.mimetype.metodo).toBe(0)
      expect(entradas.mimetype.conteudo.toString()).toBe(
        'application/vnd.oasis.opendocument.spreadsheet'
      )
      // E por ir cru, a assinatura aparece no arquivo inteiro (é o que o teste
      // de rota usa para conferir o download).
      expect(buffer.slice(0, 2).toString('binary')).toBe('PK')
    })

    it('traz manifest, styles, meta e content', () => {
      const entradas = gerar()
      expect(Object.keys(entradas).sort()).toEqual([
        'META-INF/manifest.xml', 'content.xml', 'meta.xml', 'mimetype', 'styles.xml'
      ])
    })
  })

  // O erro que este teste guarda: com a URI errada o LibreOffice abre o arquivo
  // sem reclamar e IGNORA todo atributo fo:*, então a planilha sai sem borda,
  // sem fundo no cabeçalho e sem negrito. Medido em 2026-07-29.
  it('declara o namespace fo do ODF (xsl-fo-compatible), senão o estilo é ignorado em silêncio', () => {
    const content = gerar()['content.xml'].conteudo.toString('utf8')
    expect(content).toContain('xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"')
    expect(content).toContain('fo:border="0.74pt solid #000000"')
    expect(content).toContain('fo:background-color="#fff5ce"')
  })

  describe('cabeçalho', () => {
    it('usa o estilo de cabeçalho e quebra o rótulo com \\n em dois parágrafos', () => {
      const content = gerar()['content.xml'].conteudo.toString('utf8')
      expect(content).toContain('<text:p>OM Destino</text:p>')
      expect(content).toContain('<text:p>Mat</text:p><text:p>Previsto</text:p>')
      expect(content).toContain('table:style-name="ceCab"')
    })

    it('declara uma coluna por definição, com a largura pedida', () => {
      const content = gerar()['content.xml'].conteudo.toString('utf8')
      expect(content).toContain('style:column-width="2.805cm"')
      expect((content.match(/<table:table-column /g) || [])).toHaveLength(4)
    })
  })

  describe('células', () => {
    it('número vira float, com o valor no atributo', () => {
      const content = gerar()['content.xml'].conteudo.toString('utf8')
      expect(content).toContain('office:value-type="float" office:value="4"')
    })

    // O ponto da coluna de data: o Calc precisa receber DATA, não texto, senão
    // ordenar e filtrar por período param de funcionar na aba de destino.
    it('data vira date, com ISO no atributo e DD/MM/AA na exibição', () => {
      const content = gerar()['content.xml'].conteudo.toString('utf8')
      expect(content).toContain(
        '<table:table-cell table:style-name="ceData" office:value-type="date" office:date-value="2026-02-10"><text:p>10/02/26</text:p></table:table-cell>'
      )
    })

    it('célula vazia sai vazia, e não como texto "null"', () => {
      const content = gerar()['content.xml'].conteudo.toString('utf8')
      expect(content).not.toContain('null')
      expect(content).toContain('<table:table-cell table:style-name="ceData"/>')
    })

    it('escapa o que quebraria o XML e descarta caractere de controle', () => {
      const entradas = gerar({
        linhas: [{ om: 'S3 & S2 <"teste">', qtd: 1, material: 'a\u0001b', entrega: null }]
      })
      const content = entradas['content.xml'].conteudo.toString('utf8')
      expect(content).toContain('S3 &amp; S2 &lt;&quot;teste&quot;&gt;')
      expect(content).toContain('<text:p>ab</text:p>')
      expect(content).not.toContain('\u0001')
    })
  })

  it('o filtro cobre da primeira à última célula com dado', () => {
    const content = gerar()['content.xml'].conteudo.toString('utf8')
    // 4 colunas (A..D) e 2 linhas de dado + cabeçalho = 3
    expect(content).toContain('table:target-range-address="META4_DETALHADA.A1:META4_DETALHADA.D3"')
  })

  it('sem linha nenhuma, gera o arquivo com só o cabeçalho', () => {
    const content = gerar({ linhas: [] })['content.xml'].conteudo.toString('utf8')
    expect(content).toContain('<text:p>OM Destino</text:p>')
    expect(content).toContain('META4_DETALHADA.A1:META4_DETALHADA.D1')
  })

  it('recusa aba sem nome e relatório sem coluna', () => {
    expect(() => criarOds({ colunas: COLUNAS })).toThrow(/aba/)
    expect(() => criarOds({ aba: 'X', colunas: [] })).toThrow(/colunas/)
  })

  describe('partesData', () => {
    // Uma coluna DATE chega como string do banco (type parser em database/db.js)
    // e como Date de outros caminhos. Os dois têm de dar o MESMO dia: passar a
    // string por new Date() a interpretaria em UTC e, em UTC-3, voltaria um dia.
    it('trata string AAAA-MM-DD e Date pelo mesmo dia', () => {
      expect(partesData('2026-01-01')).toEqual({ iso: '2026-01-01', exibicao: '01/01/26' })
      expect(partesData(new Date(2026, 0, 1))).toEqual({ iso: '2026-01-01', exibicao: '01/01/26' })
    })

    it('aceita timestamp ISO e devolve só o dia', () => {
      expect(partesData('2026-12-31T00:00:00.000Z').iso).toBe('2026-12-31')
    })

    it('devolve null no que não é data', () => {
      expect(partesData('a combinar')).toBeNull()
    })
  })

  describe('letraColuna', () => {
    it('numera como a planilha (A, Z, AA)', () => {
      expect(letraColuna(0)).toBe('A')
      expect(letraColuna(14)).toBe('O')
      expect(letraColuna(25)).toBe('Z')
      expect(letraColuna(26)).toBe('AA')
    })
  })
})
