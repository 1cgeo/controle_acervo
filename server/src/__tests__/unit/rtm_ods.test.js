'use strict'

// A aba META4_DETALHADA do RTM, gerada a partir da planilha-semente.
//
// O que este arquivo protege é o mesmo do Anuário: que o arquivo entregue
// continue sendo O ARQUIVO DA ABA. Ele é colado num RTM que já existe, e o
// envelope importa tanto quanto o conteúdo -- a largura de coluna, o painel
// congelado (`settings.xml`) e os estilos vêm da semente, e uma mudança que os
// perca não quebra nada, não dá erro, e chega ao chefe como uma aba que abre
// diferente de todo mês.
//
// Os valores esperados foram medidos em "META4_DETALHADA.ods".

const fs = require('fs')

const { desziparParaMapa } = require('../../utils/ods_export')
const { gerarRtmOds, CAMINHO_SEMENTE, COLUNAS } = require('../../rpcmtec/rtm_ods')

const LINHA_DE_PROVA = {
  omds: '1º CGEO',
  demandante: 'CMS',
  om_destino: '13º BIB',
  previsto_pit: 'sim',
  meta: '4.1',
  produto: 'Carta Topográfica',
  mi: '2840-2',
  escala: '1:50.000',
  quantidade_prevista: 4,
  material_previsto: 'sulfite',
  quantidade_fornecida: 4,
  material_fornecido: 'sulfite',
  data_entrega: '2026-02-10',
  forma_entrega: 'Correios',
  observacao: null
}

const conteudoDe = buffer =>
  desziparParaMapa(buffer).get('content.xml').toString('utf8')

describe('rtm_ods: a semente', () => {
  test('está versionada, é um ODS e traz só a linha de cabeçalho', () => {
    expect(fs.existsSync(CAMINHO_SEMENTE)).toBe(true)
    const entradas = desziparParaMapa(fs.readFileSync(CAMINHO_SEMENTE))

    expect(entradas.get('mimetype').toString())
      .toBe('application/vnd.oasis.opendocument.spreadsheet')

    const xml = entradas.get('content.xml').toString('utf8')
    // Uma linha só: o cabeçalho. As de dados foram removidas ao montar a
    // semente, o que também tirou nome de OM e quantidade entregue de um
    // arquivo que vai para repositório PÚBLICO.
    expect((xml.match(/<table:table-row/g) || [])).toHaveLength(1)
    expect(xml).toContain('META4_DETALHADA')
  })

  test('guarda o que faz a aba abrir igual: estilos e configuração de janela', () => {
    const entradas = desziparParaMapa(fs.readFileSync(CAMINHO_SEMENTE))
    // `settings.xml` é o painel congelado, o zoom e o cursor; `styles.xml` é a
    // largura de coluna e a fonte. Foi a falta dos dois que motivou a semente:
    // o gerador anterior montava o arquivo do zero e não tinha nenhum deles.
    expect(entradas.has('settings.xml')).toBe(true)
    expect(entradas.has('styles.xml')).toBe(true)
    expect(entradas.get('settings.xml').length).toBeGreaterThan(1000)
  })

  test('os 15 cabeçalhos do modelo estão na semente, na ordem', () => {
    const xml = desziparParaMapa(fs.readFileSync(CAMINHO_SEMENTE))
      .get('content.xml').toString('utf8')

    // A leitura é por CÉLULA, e não por procurar cada rótulo solto no XML.
    // "Mat Previsto" está partido em dois `<text:p>` na semente, então quem
    // procura o texto cru não o acha e sai da lista sem ninguém notar: era o
    // que fazia esta conferência pular a 10ª coluna, e com ela a checagem de
    // ordem entre a 9ª e a 11ª.
    const cabecalho = xml.match(/<table:table-row[\s\S]*?<\/table:table-row>/)[0]
    const celulas = [...cabecalho.matchAll(/<table:table-cell[\s\S]*?(?:\/>|<\/table:table-cell>)/g)]
      .map(([celula]) =>
        [...celula.matchAll(/<text:p>([^<]*)<\/text:p>/g)].map(m => m[1]).join(' '))
      .filter(texto => texto !== '')

    expect(celulas).toEqual([
      'OMDS', 'Demandante', 'OM Destino', 'Previsto no PIT', 'Meta', 'Produto',
      'MI', 'Escala', 'Qnt Prevista', 'Mat Previsto', 'Qnt Fornecida',
      'Material Fornecido', 'Data da Entrega', 'Forma da Entrega', 'Observações'
    ])
    // E o gerador escreve UMA célula por cabeçalho: sobrando ou faltando uma, a
    // linha de dado sai deslocada em relação ao título.
    expect(COLUNAS).toHaveLength(celulas.length)
  })
})

describe('rtm_ods: o arquivo gerado', () => {
  test('só o content.xml muda; o resto sai byte a byte da semente', () => {
    const semente = desziparParaMapa(fs.readFileSync(CAMINHO_SEMENTE))
    const gerado = desziparParaMapa(gerarRtmOds([LINHA_DE_PROVA]))

    expect([...gerado.keys()].sort()).toEqual([...semente.keys()].sort())
    for (const [nome, conteudo] of semente) {
      // O `content.xml` tem de MUDAR: pular a comparação dele deixava o caso
      // verde também no dia em que o gerador devolvesse a semente intocada,
      // que é o oposto do que o nome promete.
      expect(gerado.get(nome).equals(conteudo)).toBe(nome !== 'content.xml')
    }
  })

  test('a linha entra com os estilos que o modelo usa', () => {
    // ro2 na linha, ce130 no texto e no numero, ce156 na data, ce134 na
    // observacao. Nao sao escolha nossa: foram lidos do modelo, e sao o que faz
    // a linha gerada ficar igual as que ja estao na aba.
    const xml = conteudoDe(gerarRtmOds([LINHA_DE_PROVA]))
    expect(xml).toContain('table:style-name="ro2"')
    expect(xml).toContain('table:style-name="ce130"')
    expect(xml).toContain('table:style-name="ce156"')
    expect(xml).toContain('table:style-name="ce134"')
  })

  test('quantidade entra como NÚMERO, não como texto', () => {
    // Numero e o que a planilha de destino soma; texto zeraria a coluna no RTM.
    const xml = conteudoDe(gerarRtmOds([LINHA_DE_PROVA]))
    expect(xml).toContain('office:value-type="float" office:value="4"')
  })

  test('a data entra como DATA, com o valor ISO e o texto em DD/MM/AA', () => {
    // Sem o `office:date-value` o Calc reinterpreta a string com a localidade de
    // quem abre, e 10/02/26 vira outubro para quem usa MM/DD.
    const xml = conteudoDe(gerarRtmOds([LINHA_DE_PROVA]))
    expect(xml).toContain('office:date-value="2026-02-10"')
    expect(xml).toContain('<text:p>10/02/26</text:p>')
  })

  test('a data não anda para trás quando vem como Date', () => {
    // A coluna e DATE, mas quem chama pode passar um Date. Ler os componentes
    // locais (e nao o ISO em UTC) e o que impede o D-1 em UTC-3.
    const xml = conteudoDe(gerarRtmOds([
      { ...LINHA_DE_PROVA, data_entrega: new Date(2026, 1, 10) }
    ]))
    expect(xml).toContain('office:date-value="2026-02-10"')
  })

  test('observação vazia sai como célula SEM tipo, como no modelo', () => {
    const xml = conteudoDe(gerarRtmOds([LINHA_DE_PROVA]))
    expect(xml).toContain('<table:table-cell table:style-name="ce134"/>')
  })

  test('cada linha tem as 15 colunas mais o preenchimento do modelo', () => {
    const xml = conteudoDe(gerarRtmOds([LINHA_DE_PROVA]))
    // O modelo fecha a linha com uma celula repetida ate o fim da planilha; sem
    // ela a linha gerada tem largura diferente das que ja estao na aba.
    expect(xml).toContain('table:number-columns-repeated="1007"')
  })

  test('lista vazia gera o arquivo com o cabeçalho e nenhuma linha de dados', () => {
    const xml = conteudoDe(gerarRtmOds([]))
    expect((xml.match(/<table:table-row/g) || [])).toHaveLength(1)
  })

  test('escapa o que quebraria o XML', () => {
    const xml = conteudoDe(gerarRtmOds([
      { ...LINHA_DE_PROVA, demandante: 'Cia & Cia <teste>', observacao: 'a > b' }
    ]))
    expect(xml).toContain('Cia &amp; Cia &lt;teste&gt;')
    expect(xml).not.toContain('<teste>')
  })

  test('o arquivo abre: entradas descomprimem e a planilha fecha', () => {
    const gerado = desziparParaMapa(gerarRtmOds([LINHA_DE_PROVA, LINHA_DE_PROVA]))
    const xml = gerado.get('content.xml').toString('utf8')
    expect(xml.startsWith('<?xml')).toBe(true)
    expect(xml).toContain('</office:document-content>')

    const abre = (xml.match(/<table:table-row/g) || []).length
    const fecha = (xml.match(/<\/table:table-row>/g) || []).length
    expect(abre).toBe(fecha)
    // Cabeçalho mais as duas linhas.
    expect(abre).toBe(3)
  })
})
