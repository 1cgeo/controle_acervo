'use strict'

const fs = require('fs')
const path = require('path')

const { normalizar: normalizarMi } = require('./mi')
const { TIPO_ESCALA } = require('./domain_constants')

/**
 * Sistema Cartográfico Nacional: INOM para polígono, e MI para INOM.
 *
 * DUAS COISAS DE NATUREZAS OPOSTAS moram aqui, e a diferença é o que explica o
 * desenho do módulo.
 *
 * A primeira é uma FÓRMULA. O INOM (índice de nomenclatura) descreve a folha por
 * construção: `SF-22-Y-D-II-4-NE` é a articulação sucessiva da folha 1:1.000.000
 * `SF-22`, e cada token que se acrescenta escolhe uma célula da subdivisão
 * seguinte. Dado o INOM, o retângulo sai por aritmética, sem consulta a nada.
 *
 * A segunda é uma TABELA, e não tem fórmula nenhuma. O MI é uma numeração
 * histórica, atribuída folha a folha pelo antigo Mapa Índice, e a única regra que
 * ela obedece é a de ter sido publicada. Folha fora do território brasileiro
 * simplesmente não tem MI, e existem folhas dentro do recorte cujo MI nunca foi
 * emitido. Por isso o par MI/INOM vem de dados portados da DSG
 * (`scn_dados/`, GPL-2.0, ver o README de lá) e não de código.
 *
 * "Esta folha não tem MI" é RESPOSTA, e não erro: `miDoInom` devolve
 * `{ sem_mi: true, motivo }`, e o chamador que tratasse isso como falha estaria
 * afirmando que toda folha do SCN tem MI, que é falso.
 *
 * O módulo é PURO: sem banco, sem rede, sem `process.env`. Os CSV são lidos do
 * disco uma única vez, na primeira consulta que precisar deles.
 *
 * CONFERIDO CONTRA O ACERVO. Os tamanhos de folha que a decomposição produz
 * (0.125°, 0.25°, 0.5° e 1.5°x1°) são exatamente os do invariante `1e` de
 * `acervo/invariantes.js`, e a profundidade em tokens mapeia para
 * `tipo_escala_id` pela mesma regra do invariante `1d`. Se um dia divergirem, um
 * dos dois está errado, e não são duas convenções conviventes.
 */

// ---------------------------------------------------------------------------
// Geometria: a decomposição
// ---------------------------------------------------------------------------

// SIRGAS 2000, o mesmo de `acervo.produto.geom`. Sair daqui com outro SRID faria
// o PostGIS RECUSAR a comparação com o acervo, que é o destino natural deste
// polígono.
const SRID = 4674

// A conta inteira roda em SEGUNDOS DE ARCO, e só o resultado vira grau.
//
// Em grau a cadeia TAMBÉM dá certo hoje, e é justamente por isso que isto merece
// comentário: ela dá certo por COINCIDÊNCIA da grade atual. A divisão por 3 do
// nível de 1:100.000 cai sobre 1.5°, e 1.5/3 = 0.5 é exato em binário; medido,
// as 1.536 folhas de 1:25.000 abaixo de uma folha de 1:1.000.000 saem sem um
// bit de erro. Basta uma subdivisão nova que não caia num múltiplo de 1/2 para a
// cadeia passar a acumular resíduo, e o sintoma seria uma coordenada com quinze
// casas decimais numa folha só, que ninguém procura.
//
// Em segundos de arco a exatidão deixa de depender de sorte: toda fronteira do
// SCN é INTEIRA (a menor é 450", os 7'30" da folha de 1:25.000), a soma é
// aritmética de inteiros, e a única divisão é a final por 3600.
const SEGUNDOS_POR_GRAU = 3600

// Folha 1:1.000.000: 6 graus de longitude por 4 de latitude.
const LARGURA_1M = 6 * SEGUNDOS_POR_GRAU
const ALTURA_1M = 4 * SEGUNDOS_POR_GRAU

// Faixas de latitude de 4 graus, contadas do Equador para o polo. A vai de 0 a
// 4 graus, B de 4 a 8, e assim por diante; V termina em 88. W em diante não
// existe porque a faixa passaria de 90.
const LETRAS_FAIXA = 'ABCDEFGHIJKLMNOPQRSTUV'

// As subdivisões, na ordem em que os tokens aparecem no INOM. Cada matriz se lê
// de CIMA para BAIXO e da ESQUERDA para a DIREITA, então o índice do token na
// lista dá a coluna (resto) e a linha (quociente) direto.
//
// O 'V' aparece nos dois primeiros níveis com significados diferentes (a folha
// noroeste de 1:500.000 e a folha do meio-de-baixo de 1:100.000). Não é
// ambiguidade: a posição no INOM diz de qual nível o token é, e por isso a busca
// é por nível e nunca numa tabela única de tokens.
const NIVEIS = [
  { nome: '1:500.000', tokens: ['V', 'X', 'Y', 'Z'], colunas: 2, linhas: 2 },
  { nome: '1:250.000', tokens: ['A', 'B', 'C', 'D'], colunas: 2, linhas: 2 },
  { nome: '1:100.000', tokens: ['I', 'II', 'III', 'IV', 'V', 'VI'], colunas: 3, linhas: 2 },
  { nome: '1:50.000', tokens: ['1', '2', '3', '4'], colunas: 2, linhas: 2 },
  { nome: '1:25.000', tokens: ['NO', 'NE', 'SO', 'SE'], colunas: 2, linhas: 2 }
]

// Profundidade do INOM em tokens para `dominio.tipo_escala.code`. A mesma regra
// do invariante `1d`, e a razão de ela ser uma tabela e não uma conta: só quatro
// das seis escalas do SCN existem como domínio no SCA. 1:1.000.000 (2 tokens) e
// 1:500.000 (3) são folhas legítimas e devolvem `null`, que não é erro, é a
// ausência de código de domínio para elas.
const ESCALA_POR_TOKENS = {
  4: TIPO_ESCALA.ESCALA_250K,
  5: TIPO_ESCALA.ESCALA_100K,
  6: TIPO_ESCALA.ESCALA_50K,
  7: TIPO_ESCALA.ESCALA_25K
}

// Separadores que o INOM ganha no caminho até aqui. Mesmo conjunto do MI (ver
// `utils/mi.js`): '/', '=', espaço, sublinhado e os três traços unicode que o
// editor de texto produz sozinho no lugar do hífen.
const SEPARADORES = /[\u2212\u2013\u2014/=\s_]+/g

const BASE_1M = /^([NS])([A-Z])$/

/**
 * Forma canônica do INOM em maiúsculas, ou null quando a gramática não casa.
 *
 * Recusar é o comportamento correto e não uma limitação: um INOM que não casa a
 * gramática não descreve folha nenhuma, e completar o que falta seria inventar
 * uma folha que o solicitante não pediu.
 */
const normalizarInom = (bruto) => {
  if (bruto === null || bruto === undefined) return null

  const limpo = String(bruto)
    .trim()
    .toUpperCase()
    .replace(SEPARADORES, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!limpo) return null

  const tokens = limpo.split('-')
  if (tokens.length < 2 || tokens.length > NIVEIS.length + 2) return null

  const base = BASE_1M.exec(tokens[0])
  if (!base) return null
  if (!LETRAS_FAIXA.includes(base[2])) return null

  if (!/^\d{1,2}$/.test(tokens[1])) return null
  const fuso = Number(tokens[1])
  if (fuso < 1 || fuso > 60) return null

  const canonicos = [`${base[1]}${base[2]}`, String(fuso).padStart(2, '0')]

  for (let i = 2; i < tokens.length; i += 1) {
    const nivel = NIVEIS[i - 2]
    if (!nivel.tokens.includes(tokens[i])) return null
    canonicos.push(tokens[i])
  }

  return canonicos.join('-')
}

/** `dominio.tipo_escala.code` da folha, ou null (INOM inválido, ou 1M/500k). */
const tipoEscalaDoInom = (inom) => {
  const canonico = normalizarInom(inom)
  if (!canonico) return null
  return ESCALA_POR_TOKENS[canonico.split('-').length] || null
}

// Grau, formatado sem lixo de ponto flutuante. Toda coordenada que sai daqui é
// múltiplo de 450 segundos de arco, logo múltiplo exato de 1/8 de grau: o
// `String` do JavaScript devolve a representação decimal curta e ela é a exata.
const grau = (segundos) => String(segundos / SEGUNDOS_POR_GRAU)

/**
 * Retângulo da folha, em graus.
 *
 * @param {string} inom
 * @returns {{ewkt: string, tipo_escala_id: number|null, bbox: Object}|null}
 *   null quando o INOM não casa a gramática.
 */
const poligonoDoInom = (inom) => {
  const canonico = normalizarInom(inom)
  if (!canonico) return null

  const tokens = canonico.split('-')
  const hemisferio = tokens[0][0]
  const indiceFaixa = LETRAS_FAIXA.indexOf(tokens[0][1])
  const fuso = Number(tokens[1])

  // O fuso 30 termina em Greenwich, então o canto oeste do fuso N fica a
  // (N - 30) * 6 graus, e a folha se estende dali para LESTE. O `- 6` põe o
  // canto no início do fuso, e não no fim: o fuso 22 vai de -54 a -48.
  let oeste = ((fuso - 30) * 6 - 6) * SEGUNDOS_POR_GRAU

  // No hemisfério sul a letra nomeia a faixa que vai de -4*(i+1) a -4*i: 'F' é
  // a sexta faixa CONTADA DO EQUADOR, e no sul isso a põe entre -24 e -20. Usar
  // -4*i como piso jogaria toda folha do sul uma faixa para o norte, e o erro
  // não apareceria em nenhuma folha do hemisfério norte.
  let norte = hemisferio === 'N'
    ? (indiceFaixa + 1) * ALTURA_1M
    : -indiceFaixa * ALTURA_1M

  let largura = LARGURA_1M
  let altura = ALTURA_1M

  for (let i = 2; i < tokens.length; i += 1) {
    const nivel = NIVEIS[i - 2]
    const indice = nivel.tokens.indexOf(tokens[i])

    largura /= nivel.colunas
    altura /= nivel.linhas

    oeste += (indice % nivel.colunas) * largura
    norte -= Math.floor(indice / nivel.colunas) * altura
  }

  const leste = oeste + largura
  const sul = norte - altura

  // O `+ 0` mata o zero NEGATIVO. A folha encostada no Equador pelo sul tem
  // norte = -0 * 14400 = -0, e `-0` sobrevive a `toEqual` e a `Object.is` ainda
  // que `-0 === 0`: uma comparação de bbox contra o valor esperado falharia com
  // "esperava 0, veio -0", que não é diferença nenhuma de geometria.
  const bbox = {
    xmin: oeste / SEGUNDOS_POR_GRAU + 0,
    ymin: sul / SEGUNDOS_POR_GRAU + 0,
    xmax: leste / SEGUNDOS_POR_GRAU + 0,
    ymax: norte / SEGUNDOS_POR_GRAU + 0
  }

  // Anel FECHADO (o primeiro vértice se repete no fim) e sentido ANTI-HORÁRIO,
  // que é a orientação de anel externo do OGC. O PostGIS aceita as duas mãos,
  // mas o GeoJSON da RFC 7946 exige esta, e a geometria daqui vai parar em
  // GeoJSON pelo caminho do mapa.
  const anel = [
    [oeste, sul], [leste, sul], [leste, norte], [oeste, norte], [oeste, sul]
  ].map(([x, y]) => `${grau(x)} ${grau(y)}`).join(', ')

  return {
    ewkt: `SRID=${SRID};POLYGON((${anel}))`,
    tipo_escala_id: ESCALA_POR_TOKENS[tokens.length] || null,
    bbox
  }
}

// ---------------------------------------------------------------------------
// Tabela: MI <-> INOM
// ---------------------------------------------------------------------------

const DIRETORIO_DADOS = path.join(__dirname, 'scn_dados')

// Carga PREGUIÇOSA e uma vez só. São ~4.900 linhas somadas, alguns poucos
// megabytes de Map, e quem só quer o polígono (que é fórmula) nunca paga por
// elas. Ler a cada consulta poria I/O de disco numa função anunciada como pura.
let tabelas = null

// O BOM (U+FEFF) abre as DUAS listas de exclusão e nenhum dos dois pares
// MI/INOM. Sem tirá-lo, o primeiro INOM de cada lista vira uma chave que nada
// casa, e o efeito é uma folha sem MI voltar a ter MI: falha silenciosa, de uma
// linha só, exatamente do tipo que ninguém confere.
const lerCsv = (arquivo) => fs
  .readFileSync(path.join(DIRETORIO_DADOS, arquivo), 'utf8')
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .slice(1)
  .map(linha => linha.trim())
  .filter(Boolean)

const carregarTabelas = () => {
  if (tabelas) return tabelas

  const parInomMi = (arquivo) => {
    const porInom = new Map()
    const porMi = new Map()
    for (const linha of lerCsv(arquivo)) {
      const [inom, mi] = linha.split(';')
      // O MI entra e sai na forma CANÔNICA (sem zero à esquerda), que é como o
      // acervo o grava: `acervo.produto.mi` guarda '2965', nunca '2965'
      // preenchido para quatro dígitos. Devolver a forma da planilha faria a
      // resposta desta rota não casar com a busca do acervo por igualdade.
      const canonico = normalizarMi(mi)
      if (!canonico) continue
      porInom.set(inom, canonico)
      porMi.set(canonico, inom)
    }
    return { porInom, porMi }
  }

  tabelas = {
    cem: parInomMi('mi_100k.csv'),
    duzentosCinquenta: parInomMi('mi_250k.csv'),
    semMi25k: new Set(lerCsv('sem_mi_25k.csv')),
    semMi50k: new Set(lerCsv('sem_mi_50k.csv'))
  }
  return tabelas
}

const pai = (canonico, tokens) => canonico.split('-').slice(0, tokens).join('-')

// Os dois jeitos de uma folha do SCN não ter MI, separados de propósito: o
// primeiro é geográfico e o segundo é histórico. Quem lê a resposta precisa
// saber qual dos dois, porque só o segundo é candidato a mudar se a DSG emitir
// a numeração um dia.
const MOTIVO_FORA_DA_TABELA =
  'Folha fora da cobertura do Mapa Índice brasileiro (o MI só existe para o território nacional).'

const MOTIVO_EXCLUIDA =
  'Folha dentro da cobertura, mas sem MI emitido (consta da lista de exclusão do Mapa Índice).'

/**
 * MI da folha, ou a declaração de que ela não tem MI.
 *
 * @param {string} inom
 * @returns {{mi: string}|{sem_mi: true, motivo: string}|null}
 *   null só quando o INOM não casa a gramática; aí não há folha sobre a qual
 *   responder.
 */
const miDoInom = (inom) => {
  const canonico = normalizarInom(inom)
  if (!canonico) return null

  const { cem, duzentosCinquenta, semMi25k, semMi50k } = carregarTabelas()
  const tokens = canonico.split('-').length

  if (tokens < 4) {
    return {
      sem_mi: true,
      motivo: 'As folhas de 1:1.000.000 e 1:500.000 não recebem MI; a numeração começa em 1:250.000.'
    }
  }

  if (tokens === 4) {
    const mi = duzentosCinquenta.porInom.get(canonico)
    return mi ? { mi } : { sem_mi: true, motivo: MOTIVO_FORA_DA_TABELA }
  }

  // De 1:100.000 para baixo o MI é COMPOSICIONAL: o número vem da folha de
  // 1:100.000 e os sufixos são os próprios tokens do INOM (o quadrante 1..4 do
  // 1:50.000 e o rumo NO/NE/SO/SE do 1:25.000). Só o número precisa de tabela.
  const mi100 = cem.porInom.get(pai(canonico, 5))
  if (!mi100) return { sem_mi: true, motivo: MOTIVO_FORA_DA_TABELA }

  if (tokens === 5) return { mi: mi100 }

  // As duas listas de exclusão são COMPLEMENTARES, e por isso as duas têm de ser
  // consultadas para a folha de 1:25.000. `sem_mi_50k` lista o quadrante inteiro
  // que ficou sem MI; `sem_mi_25k` lista a folha de 1:25.000 cujo quadrante TEM
  // MI mas que, sozinha, não recebeu. Medido nos dados portados: a interseção é
  // vazia (0 de 856), então quem consultasse só a lista de 1:25.000 devolveria
  // MI inventado para as 1.712 folhas que descem dos 428 quadrantes excluídos.
  if (semMi50k.has(pai(canonico, 6))) {
    return { sem_mi: true, motivo: MOTIVO_EXCLUIDA }
  }
  if (tokens === 7 && semMi25k.has(canonico)) {
    return { sem_mi: true, motivo: MOTIVO_EXCLUIDA }
  }

  return { mi: [mi100, ...canonico.split('-').slice(5)].join('-') }
}

/**
 * INOM da folha a partir do MI, ou null.
 *
 * O SEGUNDO ARGUMENTO EXISTE POR UMA AMBIGUIDADE REAL, e não por gosto de
 * configuração. Na planilha oficial o MI de 1:250.000 tem três dígitos ('001') e
 * o de 1:100.000 tem quatro ('0001'), então o preenchimento os separava. O
 * acervo grava o MI sem zero à esquerda (`acervo.produto.mi` = '2965', e o
 * invariante `1i` cobra essa forma), o que apaga a distinção: medido nos dados
 * portados, 549 dos 563 MIs de 1:250.000 colidem com um MI de 1:100.000 depois
 * de normalizados.
 *
 * Sem a dica, um MI nu resolve em 1:100.000 primeiro, porque é de onde vem a
 * esmagadora maioria do que se pede (o de 1:50.000 e o de 1:25.000 descem dele),
 * e só cai no 1:250.000 quando não existe folha de 1:100.000 com aquele número.
 * MI com quadrante nunca é ambíguo: 1:250.000 não tem quadrante.
 *
 * @param {string} bruto MI em qualquer forma que `utils/mi.js` normalize
 * @param {number} [tipoEscalaId] `dominio.tipo_escala.code`, para desempatar
 * @returns {string|null}
 */
const inomDoMi = (bruto, tipoEscalaId) => {
  const canonico = normalizarMi(bruto)
  if (!canonico) return null

  const { cem, duzentosCinquenta } = carregarTabelas()
  const partes = canonico.split('-')

  if (partes.length === 1) {
    if (tipoEscalaId === TIPO_ESCALA.ESCALA_250K) {
      return duzentosCinquenta.porMi.get(canonico) || null
    }
    if (tipoEscalaId === TIPO_ESCALA.ESCALA_100K) {
      return cem.porMi.get(canonico) || null
    }
    return cem.porMi.get(canonico) || duzentosCinquenta.porMi.get(canonico) || null
  }

  const inom100 = cem.porMi.get(partes[0])
  if (!inom100) return null

  const inom = [inom100, ...partes.slice(1)].join('-')

  // O caminho de volta passa pela MESMA regra de exclusão da ida. Sem isto, o
  // MI '3035-1' de um quadrante que nunca recebeu MI devolveria um INOM
  // perfeitamente formado, e as duas funções deste módulo se contradiriam:
  // `inomDoMi` afirmando que a folha tem aquele MI e `miDoInom` negando.
  const volta = miDoInom(inom)
  return volta && volta.mi ? inom : null
}

module.exports = {
  normalizarInom,
  tipoEscalaDoInom,
  poligonoDoInom,
  miDoInom,
  inomDoMi,
  SRID
}
