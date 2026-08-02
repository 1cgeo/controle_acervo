'use strict'

// Normalizacao do MI (indice de nomenclatura da carta) tal como ele chega num
// documento de solicitacao, que raramente e como ele esta gravado no acervo.
//
// O separador vem como '/', '=', espaco, ou o sinal de menos unicode (U+2212,
// que o Word produz sozinho), e o solicitante escreve zero a esquerda. Sem
// normalizar, o casamento exato contra o acervo falha em folha que existe, e o
// agente conclui erradamente que a carta nao esta catalogada.
//
// GEMEO DELIBERADO de `server/src/utils/mi.js`, e nao um `require` dele.
//
// Este CLI tem DEPENDENCIA ZERO por contrato: roda a partir desta pasta, sem
// `npm install` e sem enxergar `server/`. Importar do servidor arrastaria a
// arvore dele para ca, e publicar duas dezenas de linhas como pacote cobraria
// versionamento e release a cada correcao de regex. Mesmo desenho de
// `core/api_client.py` em `ferramentas_acervo/` e `ferramentas_mapoteca/`:
// correcao de COMPORTAMENTO (separador novo, forma nova de MI) vale para os
// dois, e quem mexer num tem de mexer no outro no MESMO commit. O lado do
// servidor tem UM extra que nao cabe aqui, `normalizarIdentificador`, porque
// o CLI nunca ve INOM.

// U+2212 (menos), U+2013 (en dash) e U+2014 (em dash) entram escapados para o
// arquivo continuar ASCII puro, como o resto do CLI.
const SEPARADORES = /[\u2212\u2013\u2014\/=\s_]+/g

// Forma canonica: 2962-4-NE (folha 25k), 2962-4 (quadrante 50k), 2962 (100k ou
// 250k).
//
// O sufixo de LETRA no numero e legitimo e tem de passar. Ele nao e ruido de
// digitacao: sao 29 MIs de 100k (`0002A`, `2882A`, ate `...C`) e 13 de 250k
// (`001A`, `536A`) na tabela oficial da DSG, e o invariante 1i do servidor
// (`acervo/invariantes.js`) ja o declara valido. Sem o `[A-Z]?` esta funcao
// devolvia null para folha que EXISTE, e quem chamou concluia que a carta nao
// esta catalogada, que e o erro que ela foi escrita para evitar.
const PADRAO = /^\d{1,4}[A-Z]?(-[1-4](-(NE|NO|SE|SO))?)?$/

/**
 * Devolve o MI na forma canonica, ou null quando a entrada nao parece um MI.
 * Nao inventa quadrante nem completa folha: se nao casar o padrao, devolve null
 * e quem chamou decide o que fazer (em geral, avisar em vez de adivinhar).
 */
function normalizar (bruto) {
  if (bruto === null || bruto === undefined) return null

  const limpo = String(bruto)
    .trim()
    .toUpperCase()
    .replace(SEPARADORES, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!limpo) return null

  const partes = limpo.split('-')
  // Zero a esquerda so sai do primeiro grupo (o numero da folha 100k); nos
  // quadrantes ele nunca ocorre e mexer ali so criaria ruido.
  partes[0] = partes[0].replace(/^0+(?=\d)/, '')

  const canonico = partes.join('-')
  return PADRAO.test(canonico) ? canonico : null
}

/** Compara dois MIs pela forma canonica. Entrada invalida nunca casa. */
function iguais (a, b) {
  const na = normalizar(a)
  const nb = normalizar(b)
  return !!na && na === nb
}

module.exports = { normalizar, iguais, PADRAO }
