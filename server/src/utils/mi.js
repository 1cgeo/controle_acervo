'use strict'

// Normalizacao do MI (indice de nomenclatura da carta) tal como ele chega num
// documento de solicitacao, que raramente e como ele esta gravado no acervo.
//
// GEMEO DELIBERADO de `mapoteca_cli/lib/mi.js`, e nao um `require` dele.
//
// O CLI tem DEPENDENCIA ZERO por contrato (ver `mapoteca_cli/README.md`): ele
// roda a partir da pasta dele, sem `npm install` e sem enxergar `server/`.
// Importar daqui obrigaria o CLI a carregar a arvore do servidor, e publicar
// isto como pacote so para duas dezenas de linhas cobraria versionamento e
// release a cada correcao de regex. Pelo mesmo motivo de `core/api_client.py`
// em `ferramentas_acervo/` e `ferramentas_mapoteca/`: correcao de COMPORTAMENTO
// (separador novo, forma nova de MI) vale para os dois, e quem mexer num tem de
// mexer no outro no MESMO commit.
//
// A UNICA divergencia permitida e o extra deste lado: `normalizarIdentificador`,
// que trata MI **ou** INOM porque o servidor tem rota que aceita os dois na
// mesma lista. O CLI nunca ve INOM.
//
// O separador vem como '/', '=', espaco, ou o sinal de menos unicode (U+2212,
// que o Word produz sozinho), e o solicitante escreve zero a esquerda. Sem
// normalizar, o casamento exato contra o acervo falha em folha que existe, e o
// agente conclui erradamente que a carta nao esta catalogada.

// U+2212 (menos), U+2013 (en dash) e U+2014 (em dash) entram escapados para o
// arquivo continuar ASCII puro, como o gemeo.
const SEPARADORES = /[\u2212\u2013\u2014\/=\s_]+/g

// Forma canonica: 2962-4-NE (folha 25k), 2962-4 (quadrante 50k), 2962 (100k ou
// 250k).
//
// O sufixo de LETRA no numero e legitimo e tem de passar. Ele nao e ruido de
// digitacao: sao 29 MIs de 100k (`0002A`, `2882A`, ate `...C`) e 13 de 250k
// (`001A`, `536A`) na tabela oficial da DSG portada em `utils/scn_dados/`, e o
// invariante 1i de `acervo/invariantes.js` ja o declara valido. Sem o `[A-Z]?`
// esta funcao devolvia null para folha que EXISTE, e quem chamou concluia que a
// carta nao esta catalogada, que e o erro que ela foi escrita para evitar.
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

/**
 * Normaliza um identificador de folha que pode ser MI **ou** INOM.
 *
 * Existe porque a situacao geral do acervo (`acervo_ctrl.getSituacaoGeralCells`
 * e a rota publica de integracao) recebe as duas coisas na MESMA lista e
 * compara por igualdade de string. Ate 2026-08-01 cada uma tinha a propria
 * copia de tres linhas (`normIdentificador`), que so tirava caixa e espaco:
 * quem escrevia `0155` nao achava a folha gravada como `155`, sem erro nenhum,
 * so uma resposta "nao mapeado" falsa.
 *
 * O MI vem primeiro porque so ele tem forma canonica. Nao casando o MI, cai no
 * tratamento antigo (caixa alta sem espaco), que e o que o INOM precisa: `SF-22`
 * e `sf 22` viram a mesma chave, e nenhum INOM casa o PADRAO do MI (todo INOM
 * comeca por letra), entao nao ha como um virar o outro por acidente.
 *
 * Devolve string vazia para nulo, e nao null, porque o chamador usa o resultado
 * como chave de Set.
 */
function normalizarIdentificador (bruto) {
  if (bruto === null || bruto === undefined) return ''
  return normalizar(bruto) || String(bruto).trim().toUpperCase().replace(/\s+/g, '')
}

module.exports = { normalizar, iguais, normalizarIdentificador, PADRAO }
