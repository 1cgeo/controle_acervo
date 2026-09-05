'use strict'

const { gerarMiniatura } = require('./miniatura')
const { caminhoNoVolume } = require('./caminho_volume')
const { STATUS_ARQUIVO } = require('./domain_constants')

/**
 * A fila de miniaturas: quem falta, e o que fazer com cada um.
 *
 * Existe para o LOTE (`scripts/gerar_miniaturas.cjs`, a carga do acervo antigo)
 * e a VARREDURA (`miniatura_varredura.js`, que gera apos o upload e tem a rota
 * manual de reforco) rodarem a mesma
 * politica. Duplicar a consulta faria os dois divergirem no dia em que um
 * mudasse, e a divergencia seria silenciosa: nenhum dos dois quebra, eles so
 * passam a escolher arquivos diferentes.
 *
 * Os dois falam com o banco por drivers diferentes (o lote usa `pg` cru, o
 * servidor usa `pg-promise`), entao aqui ficam o SQL e o preparo dos valores, e
 * cada um executa com o seu.
 *
 * POR QUE NAO NO confirm-upload. Renderizar custa segundos e roda um processo
 * externo; o `confirmUpload` acontece dentro de UMA transacao que ja valida
 * checksum de todos os arquivos do envio. Gerar a miniatura ali seguraria a
 * transacao aberta pelo tempo da renderizacao, e uma falha de imagem derrubaria
 * um upload que deu certo. Fora disso, o confirm-upload nao e o unico caminho
 * que cria versao (ha carga direta e o plugin), entao o gancho ali cobriria
 * menos do que parece. Varrer a fila cobre TODOS os caminhos, e o preco e a
 * miniatura aparecer com ate uma hora de atraso.
 */

// DISTINCT ON escolhe UM arquivo por versao. A ordem dentro do grupo e a
// politica, e cada degrau tem uma razao:
//
//   PDF primeiro, porque ja e a pagina montada (mapa, legenda, articulacao) e
//   ler 15 MB pela rede custa uma fracao de um raster de centenas de MB.
//
//   TIF depois, que e o GeoTIFF da carta e do modelo de elevacao.
//
//   IMG por ultimo, que e o ERDAS da Ortoimagem. A preferencia explicita
//   existe porque o driver de ECW e proprietario e nem sempre esta presente.
//
//   O menor entre os iguais, e o id so para desempatar de forma estavel. Sem o
//   desempate, duas execucoes poderiam escolher arquivos diferentes e refazer a
//   mesma miniatura para sempre.
//
// O `.tif.ovr` (piramide do GDAL) NAO entra: ele e cadastrado como arquivo
// proprio, e a extensao dele nao casa com nenhuma da lista. O GDAL o encontra
// sozinho ao lado do `.tif`, que e justamente o que torna o MDS/MDT rapido.
const SQL_CANDIDATOS = `
WITH candidato AS (
  SELECT DISTINCT ON (v.id)
    v.id            AS versao_id,
    a.id            AS arquivo_id,
    a.checksum      AS checksum,
    a.extensao      AS extensao,
    a.nome_arquivo  AS nome_arquivo,
    vol.volume      AS volume
  FROM acervo.versao v
  JOIN acervo.arquivo a ON a.versao_id = v.id
  JOIN acervo.volume_armazenamento vol ON vol.id = a.volume_armazenamento_id
  WHERE lower(a.extensao) IN ('pdf', 'tif', 'tiff', 'img', 'ecw')
    -- O code sai de utils/domain_constants.js, e nao escrito a mao: um "1"
    -- solto aqui se le como qualquer um dos quatro status de arquivo, e este
    -- SQL e texto para os DOIS drivers (o lote em pg cru e o servidor em
    -- pg-promise), entao ninguem o confere.
    AND a.tipo_status_id = ${STATUS_ARQUIVO.CARREGADO}
  ORDER BY
    v.id,
    CASE lower(a.extensao)
      WHEN 'pdf' THEN 0
      WHEN 'tif' THEN 1
      WHEN 'tiff' THEN 1
      WHEN 'img' THEN 2
      ELSE 3
    END,
    a.tamanho_mb NULLS LAST,
    a.id
)
SELECT c.*
FROM candidato c
LEFT JOIN acervo.miniatura_versao m ON m.versao_id = c.versao_id
WHERE ($1::bigint IS NULL OR c.versao_id = $1::bigint)
  AND (
    m.versao_id IS NULL
    OR m.checksum_origem IS DISTINCT FROM c.checksum
    OR ($2::boolean AND m.erro IS NOT NULL)
  )
ORDER BY c.versao_id
`

// O checksum viaja tambem na linha de ERRO: e ele que impede a proxima passada
// de tentar de novo o mesmo arquivo quebrado.
const SQL_GRAVAR = `
INSERT INTO acervo.miniatura_versao
  (versao_id, arquivo_id, checksum_origem, formato, largura, altura, conteudo, erro, data_geracao)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
ON CONFLICT (versao_id) DO UPDATE SET
  arquivo_id      = EXCLUDED.arquivo_id,
  checksum_origem = EXCLUDED.checksum_origem,
  formato         = EXCLUDED.formato,
  largura         = EXCLUDED.largura,
  altura          = EXCLUDED.altura,
  conteudo        = EXCLUDED.conteudo,
  erro            = EXCLUDED.erro,
  data_geracao    = CURRENT_TIMESTAMP
`

/**
 * Renderiza a miniatura de um candidato. NUNCA lanca: a falha e um desfecho
 * previsto (arquivo ausente no volume, PDF corrompido) e vira linha de erro.
 * @param {Object} candidato linha de SQL_CANDIDATOS
 * @returns {Promise<{resultado: Object|null, erro: string|null, duracao: number}>}
 */
const processar = async (candidato) => {
  const caminho = caminhoNoVolume(
    candidato.volume,
    `${candidato.nome_arquivo}.${candidato.extensao}`
  )

  const inicio = Date.now()

  try {
    const resultado = await gerarMiniatura(caminho, candidato.extensao)
    return { resultado, erro: null, duracao: Date.now() - inicio }
  } catch (e) {
    return {
      resultado: null,
      erro: (e && e.message) || String(e),
      duracao: Date.now() - inicio
    }
  }
}

/** Valores de SQL_GRAVAR, na ordem. Fonte unica da ordem dos campos. */
const valoresParaGravar = (candidato, resultado, erro) => ([
  candidato.versao_id,
  candidato.arquivo_id,
  candidato.checksum,
  resultado ? resultado.formato : null,
  resultado ? resultado.largura : null,
  resultado ? resultado.altura : null,
  resultado ? resultado.conteudo : null,
  erro
])

/**
 * Falha de AMBIENTE, e nao do arquivo: o binario nao esta instalado ou nao esta
 * no caminho. Quem varre a fila para a passada inteira quando ve isto, porque
 * insistir gravaria erro em toda versao do acervo por um problema que e de
 * configuracao da maquina.
 */
const ehFalhaDeAmbiente = (erro) =>
  typeof erro === 'string' && erro.startsWith('Binario nao encontrado')

module.exports = {
  SQL_CANDIDATOS,
  SQL_GRAVAR,
  processar,
  valoresParaGravar,
  ehFalhaDeAmbiente
}
