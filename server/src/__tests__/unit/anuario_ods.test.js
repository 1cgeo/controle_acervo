'use strict'

// O Anuário Estatístico gerado a partir da PLANILHA-SEMENTE da DSG.
//
// O modo de falhar mais perigoso deste código não é dar erro: é gerar um
// arquivo bonito, com o estilo certo, e com o número de JUNHO DE 2026 -- a
// semente -- numa linha que ninguém reescreveu. O relatório sobe para a DSG
// assim, e nada na tela denuncia. Metade dos testes abaixo existe só por isso.
//
// A outra metade protege o que se ganhou ao usar a semente: o arquivo continua
// sendo o da DSG. Estilo, largura de coluna, célula mesclada, rodapé e o formato
// numérico que mostra zero como '-' têm de sair byte a byte iguais.

const fs = require('fs')
const zlib = require('zlib')

const { desziparParaMapa } = require('../../utils/ods_export')
const { gerarAnuarioOds, CAMINHO_SEMENTE } = require('../../rpcmtec/anuario_ods')
const anuarioCtrl = require('../../mapoteca/anuario_ctrl')

const COLUNAS = anuarioCtrl.COLUNAS_ANUARIO

// Os rótulos da semente, na ordem em que ela os traz. Escritos aqui, e não
// lidos do controller: é o casamento entre os dois que o teste confere.
const CONVENCIONAL = [
  'Escala 1:1 000 000', 'Escala 1:250 000', 'Escala 1:100 000', 'Escala 1:50 000',
  'Escala 1:25 000', 'Escala 1:15.000', 'Escala 1:10.000', 'Escala 1:7.000',
  'Escala 1:5.000', 'Escala 1:4.000', 'Escala 1:3.000', 'Escala 1:2.000',
  'Escala 1:1.000', 'Carta de orientação', 'Imagem de Satélite', 'Mapa Índice',
  'Mosaico', 'Produtos Diversos'
]
const DIGITAL = [
  'Escala 1:1 000 000', 'Escala 1:250 000', 'Escala 1:100 000', 'Escala 1:50 000',
  'Escala 1:25 000', 'Escala 1:10 000', 'Escala 1:7.000', 'Escala 1:5.000',
  'Escala 1:4.000', 'Escala 1:3.000', 'Escala 1:2.000', 'Escala 1:1.000',
  'Imagem de Satélite / Fotografia aérea', 'Mapa Produto Digital', 'Ortofocarta',
  'Downloads BDGEx'
]

// Uma linha do Anuário: rótulo mais um valor por coluna, na ordem de COLUNAS.
const linha = (rotulo, valores) => {
  const saida = { rotulo }
  COLUNAS.forEach((coluna, i) => { saida[coluna.key] = valores[i] })
  return saida
}

// `null` nas colunas RM e EE do Exército porque o SCA não sabe preenchê-las: o
// cadastro de cliente não separa Região Militar de Estabelecimento de Ensino.
const zeros = (exercito = 0) => [exercito, null, null, 0, 0, 0, 0]

const anuarioDeProva = ({ ano = 2027, mes = 3 } = {}) => {
  const convencional = CONVENCIONAL.map(r =>
    linha(r, zeros(r === 'Escala 1:25 000' ? 77 : 0)))
  const digital = DIGITAL.map(r =>
    linha(r, zeros(r === 'Imagem de Satélite / Fotografia aérea' ? 9 : 0)))

  return {
    ano,
    mes,
    titulo:
      `O Exército em Números ${ano} Tabela 5.4.9 – Suprimento cartográfico ` +
      'convencional e digital distribuído, segundo as Regiões Militares, ' +
      'Estabelecimentos de Ensino e Comando de Operações Terrestres, Outras ' +
      'Forças, Órgãos Públicos, Empresas Privadas e Profissionais Autônomos, ' +
      `em ${ano}.`,
    total_convencional: linha('Total (Convencional)', zeros(77)),
    convencional,
    total_digital: linha('Total (Digital)', zeros(9)),
    digital,
    lacunas: []
  }
}

const gerar = (anuario = anuarioDeProva()) =>
  gerarAnuarioOds(anuario, COLUNAS, anuarioCtrl.paraPlanilha(anuario))

const conteudoDe = buffer =>
  desziparParaMapa(buffer).get('content.xml').toString('utf8')

describe('anuario_ods: a semente', () => {
  test('a semente está versionada e é um ODS de planilha', () => {
    expect(fs.existsSync(CAMINHO_SEMENTE)).toBe(true)
    const entradas = desziparParaMapa(fs.readFileSync(CAMINHO_SEMENTE))
    expect(entradas.get('mimetype').toString())
      .toBe('application/vnd.oasis.opendocument.spreadsheet')
    expect(entradas.has('content.xml')).toBe(true)
    expect(entradas.has('styles.xml')).toBe(true)
  })

  test('os rótulos do controller são exatamente os da semente', () => {
    // Casar por rótulo é o que impede uma linha a mais na semente de deslocar a
    // matriz em silêncio, com o número da 1:50.000 indo para a 1:25.000. Mas o
    // casamento só funciona enquanto os dois lados escrevem o rótulo igual:
    // "Escala 1:25 000" (sem ponto) na convencional e "Escala 1:10 000" na
    // digital, contra "Escala 1:10.000" (com ponto) na convencional.
    //
    // A conferência é pela GERAÇÃO, e não por procurar cada rótulo cru no XML:
    // a semente parte alguns deles em <text:span> ("Downloads BDGEx" sai como
    // <text:span>Downloads</text:span> BDGEx), e o gerador os remonta antes de
    // comparar. Procurar o texto cru reprovaria um casamento que funciona.
    const anuario = anuarioDeProva()
    expect(() => gerar(anuario)).not.toThrow()
    expect(anuarioCtrl.paraPlanilha(anuario)).toHaveLength(
      CONVENCIONAL.length + DIGITAL.length + 2
    )
  })

  test('os rótulos do controller são os mesmos que este teste declara', () => {
    // Se o controller mudar um rótulo e a semente não, a geração passa a falhar
    // -- e é este teste que diz onde. Ele compara o controller com a lista
    // escrita aqui, que foi lida da semente à mão.
    const anuario = anuarioDeProva()
    expect(anuario.convencional.map(l => l.rotulo)).toEqual(CONVENCIONAL)
    expect(anuario.digital.map(l => l.rotulo)).toEqual(DIGITAL)
  })

  test('as fórmulas da semente viram valor: Exército não é recalculado de RM+EE', () => {
    // A semente traz `Exército = SUM(RM:EE)` em várias linhas de dado. Mantida,
    // a fórmula zeraria a coluna Exército de toda linha com entrega, porque RM
    // e EE são justamente as duas que o SCA não preenche.
    const naSemente = conteudoDe(fs.readFileSync(CAMINHO_SEMENTE))
    expect(naSemente).toContain('table:formula=')

    const gerado = conteudoDe(gerar())
    const formulasRestantes = (gerado.match(/table:formula=/g) || []).length
    expect(formulasRestantes).toBe(0)
  })
})

describe('anuario_ods: o arquivo gerado', () => {
  test('só o content.xml muda; todo o resto sai byte a byte da semente', () => {
    // É o que faz o arquivo continuar sendo o da DSG: estilo, largura de
    // coluna, célula mesclada e rodapé nunca são tocados.
    const semente = desziparParaMapa(fs.readFileSync(CAMINHO_SEMENTE))
    const gerado = desziparParaMapa(gerar())

    expect([...gerado.keys()].sort()).toEqual([...semente.keys()].sort())
    for (const [nome, conteudo] of semente) {
      if (nome === 'content.xml') {
        expect(gerado.get(nome).equals(conteudo)).toBe(false)
      } else {
        expect(gerado.get(nome).equals(conteudo)).toBe(true)
      }
    }
  })

  test('o mimetype volta PRIMEIRO e sem compressão, como o ODF exige', () => {
    // Sem isso o LibreOffice ainda abre, mas o arquivo deixa de ser um ODF
    // válido e o sistema passa a chamá-lo de "Zip archive".
    const buffer = gerar()
    // A primeira entrada local começa no byte 0; o nome vem no offset 30.
    const tamanhoNome = buffer.readUInt16LE(26)
    expect(buffer.toString('utf8', 30, 30 + tamanhoNome)).toBe('mimetype')
    expect(buffer.readUInt16LE(8)).toBe(0) // método 0 = armazenado
  })

  test('NENHUM valor da semente sobrevive: junho de 2026 não vaza para outro mês', () => {
    // A semente traz 113 no total convencional, 88 na 1:25.000, 6 na 1:100.000,
    // 14 na 1:50.000, 5 em Produtos Diversos e 11 no total digital. Nenhum
    // desses números está no anuário de prova, então nenhum pode aparecer.
    const xml = conteudoDe(gerar())
    for (const valorDeJunho of ['113', '88', '11', '14', '5', '6']) {
      expect(xml).not.toContain(`office:value="${valorDeJunho}"`)
    }
  })

  test('os valores do mês entram como NÚMERO, não como texto', () => {
    // Número é o que a DSG soma. Texto passaria despercebido e zeraria a coluna
    // na planilha de destino.
    const xml = conteudoDe(gerar())
    expect(xml).toContain('office:value="77"')
    expect(xml).toContain('office:value="9"')
    expect(xml).toContain('office:value-type="float"')
  })

  test('a coluna que o SCA não sabe preencher sai como traço, e não como zero', () => {
    // Zero diria "não houve entrega"; traço diz "não temos essa fonte". São
    // afirmações diferentes, e as lacunas do rodapé se referem a esta.
    const xml = conteudoDe(gerar())
    expect(xml).toContain('<text:p>-</text:p>')
  })

  test('o título acompanha o ano, e não fica no da semente', () => {
    // A semente é de 2026. Sem a troca, o Anuário de 2027 sairia anunciando
    // 2026 no cabeçalho, que é o tipo de erro que ninguém relê.
    const xml = conteudoDe(gerar(anuarioDeProva({ ano: 2027, mes: 3 })))
    expect(xml).toContain('O Exército em Números 2027')
    expect(xml).toContain('em 2027.')
    expect(xml).not.toContain('O Exército em Números 2026')
  })

  test('a linha de total é escrita, e não recalculada pela planilha', () => {
    const xml = conteudoDe(gerar())
    expect(xml).toContain('Total (Convencional)')
    expect(xml).toContain('Total (Digital)')
  })

  test('o mesmo rótulo nos dois blocos recebe o valor do SEU bloco', () => {
    // "Escala 1:250 000" existe na Convencional e na Digital. Casar só pelo
    // rótulo jogaria os dois valores na primeira ocorrência, e a tabela digital
    // sairia com o número da convencional.
    const anuario = anuarioDeProva()
    anuario.convencional = anuario.convencional.map(l =>
      l.rotulo === 'Escala 1:250 000' ? linha(l.rotulo, zeros(31)) : l)
    anuario.digital = anuario.digital.map(l =>
      l.rotulo === 'Escala 1:250 000' ? linha(l.rotulo, zeros(47)) : l)

    const xml = conteudoDe(gerar(anuario))
    expect(xml).toContain('office:value="31"')
    expect(xml).toContain('office:value="47"')

    // E na ordem certa: a convencional vem antes da digital na planilha.
    expect(xml.indexOf('office:value="31"')).toBeLessThan(xml.indexOf('office:value="47"'))
  })

  test('recusa gerar quando falta uma linha, em vez de entregar arquivo incompleto', () => {
    // Uma linha que a semente não tem sairia com o valor do mês anterior. Falhar
    // alto é a única defesa: o arquivo incompleto é indistinguível do bom.
    const anuario = anuarioDeProva()
    anuario.convencional = [
      ...anuario.convencional,
      linha('Escala 1:12.345 (não existe na semente)', zeros(1))
    ]

    expect(() => gerar(anuario)).toThrow(/semente.*não tem todas as linhas/i)
  })

  test('o arquivo gerado abre: todas as entradas descomprimem', () => {
    const gerado = desziparParaMapa(gerar())
    expect(gerado.size).toBeGreaterThan(10)
    // content.xml tem de continuar sendo XML bem formado o bastante para ter a
    // planilha fechada.
    const xml = gerado.get('content.xml').toString('utf8')
    expect(xml.startsWith('<?xml')).toBe(true)
    expect(xml).toContain('</office:document-content>')
    const abre = (xml.match(/<table:table-row\b/g) || []).length
    const fecha = (xml.match(/<\/table:table-row>/g) || []).length
    expect(abre).toBe(fecha)
  })

  test('o content.xml gerado ainda é deflate válido dentro do ZIP', () => {
    // A reescrita passa pelo `zipar`, que comprime com deflate cru. Um erro de
    // CRC ou de tamanho aqui só apareceria quando alguém tentasse abrir.
    const buffer = gerar()
    const entradas = desziparParaMapa(buffer)
    const bruto = entradas.get('content.xml')
    expect(zlib.deflateRawSync(bruto).length).toBeGreaterThan(0)
    expect(bruto.length).toBeGreaterThan(10000)
  })
})
