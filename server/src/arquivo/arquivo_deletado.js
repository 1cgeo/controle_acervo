'use strict'

const { domainConstants: { STATUS_ARQUIVO } } = require('../utils')
const { auditoriaCtrl } = require('../auditoria')

// A LÁPIDE do arquivo.
//
// Excluir no acervo não apaga: copia o arquivo para `acervo.arquivo_deletado`
// com as suas colunas, leva os downloads dele para `acervo.download_deletado` e
// só então remove o original. É o que responde "quem baixou o quê, antes de ser
// excluído".
//
// POR QUE ISTO É UM MÓDULO, e não código dentro de cada controller: o mesmo
// bloco de ~55 linhas estava copiado em TRÊS lugares (deleteArquivos em
// arquivo_ctrl, deleteVersoes e deleteProdutos em produto_ctrl). Eram 21 colunas
// escritas à mão em cada cópia, e acrescentar uma coluna a `acervo.arquivo`
// exigia lembrar dos três. Esquecer um é o modo de falhar que não dá erro: a
// lápide nasce com o campo nulo e a falta só aparece no dia em que alguém for
// procurar o dado. Mora aqui, na feature que é dona de `acervo.arquivo`, pelo
// mesmo desenho de `mapoteca/query_fragments.js`.
//
// POR QUE EM TRÊS COMANDOS, e não num laço: as cópias faziam um SELECT e um
// INSERT POR ARQUIVO, dentro da transação. Apagar um produto com 400 arquivos
// eram 1.600 idas ao banco numa transação só. Aqui os dados da lápide saem da
// PRÓPRIA `acervo.arquivo` (`INSERT ... SELECT`), então o custo não depende mais
// da quantidade de arquivos.
//
// O VÍNCULO download → lápide não depende de ordem, e isso é deliberado: o
// `RETURNING` casa pelo `uuid_arquivo`, que é UNIQUE em `acervo.arquivo`. Fazer
// o pareamento pela ordem em que o banco devolve os ids funcionaria hoje e
// trocaria os downloads de dois arquivos no dia em que o plano mudasse, sem
// erro nenhum e com as contagens ainda batendo. É o caso que o
// `__tests__/integration/exclusao_acervo.test.js` guarda.
//
// O EVENTO DE RASTREABILIDADE SAI DAQUI, e da própria lápide. A auditoria
// precisa do `dados_antes` de cada arquivo apagado, e essa é exatamente a linha
// que a lápide copia: os dados NUNCA passam pelo JavaScript neste comando, e
// lê-los de novo só para auditar desfaria a otimização que levou 2.000 idas ao
// banco para 4. Por isso o `pares` passou a trazer `a.*` e o comando terminar
// num `SELECT`: o INSERT em `download_deletado` virou CTE (o PostgreSQL executa
// CTE que escreve exatamente uma vez e até o fim, seja ou não lida), e os
// mesmos bytes que iam para a lápide voltam para o JS de graça.
//
// As colunas vêm de `acervo.arquivo`, e não da lápide recém-escrita, porque o
// `tipo_status_id` dela é sobrescrito por EXCLUÍDO: `dados_antes` tem de dizer
// qual era o status ANTES, e não o que a exclusão gravou.

const SQL_ARQUIVAR = `
  WITH lapides AS (
    INSERT INTO acervo.arquivo_deletado (
      uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, tipo_arquivo_id,
      volume_armazenamento_id, extensao, tamanho_mb, checksum, metadado,
      tipo_status_id, situacao_carregamento_id, descricao, crs_original,
      data_cadastramento, usuario_cadastramento_uuid, data_modificacao,
      usuario_modificacao_uuid, data_delete, usuario_delete_uuid
    )
    SELECT
      a.uuid_arquivo, a.nome, a.nome_arquivo, $<motivo>, a.versao_id, a.tipo_arquivo_id,
      a.volume_armazenamento_id, a.extensao, a.tamanho_mb, a.checksum, a.metadado,
      $<statusExcluido>, a.situacao_carregamento_id, a.descricao, a.crs_original,
      a.data_cadastramento, a.usuario_cadastramento_uuid, a.data_modificacao,
      a.usuario_modificacao_uuid, $<dataDelete>, $<usuarioDeleteUuid>
    FROM acervo.arquivo a
    WHERE a.id IN ($<ids:csv>)
    RETURNING id, uuid_arquivo
  ),
  pares AS (
    SELECT l.id AS lapide_id, a.*
    FROM lapides l
    JOIN acervo.arquivo a ON a.uuid_arquivo = l.uuid_arquivo
  ),
  downloads AS (
    INSERT INTO acervo.download_deletado (arquivo_deletado_id, usuario_uuid, data_download)
    SELECT p.lapide_id, d.usuario_uuid, d.data_download
    FROM acervo.download d
    JOIN pares p ON p.id = d.arquivo_id
    RETURNING id
  )
  SELECT * FROM pares`

/**
 * Arquiva os arquivos indicados: grava a lápide, move os downloads, registra o
 * rastro de cada exclusão e apaga os originais (o arquivo e o download).
 *
 * Roda DENTRO da transação de quem chama (`t`), porque quem chama continua
 * apagando a versão ou o produto depois e as duas coisas têm de valer juntas.
 *
 * @param {Object} t          transação do pg-promise
 * @param {Array<number>} ids ids de acervo.arquivo; lista vazia é no-op
 * @param {{motivo: string, dataDelete: Date, usuarioDeleteUuid: string, contexto: object}} exclusao
 */
const arquivarArquivos = async (t, ids, { motivo, dataDelete, usuarioDeleteUuid, contexto }) => {
  if (!ids || ids.length === 0) return

  const arquivados = await t.any(SQL_ARQUIVAR, {
    ids,
    motivo,
    dataDelete,
    usuarioDeleteUuid,
    statusExcluido: STATUS_ARQUIVO.EXCLUIDO
  })

  // O agregado dono é resolvido de UMA vez, e não pela função `agregado` do mapa
  // (que faz um SELECT por linha): apagar um produto com 400 arquivos custaria
  // 400 consultas idênticas, que é a mesma conta que este módulo existiu para acabar.
  // O `registrar` aceita `entidadeId` pronto exatamente para este caso.
  //
  // A resolução acontece AQUI e não depois dos DELETEs porque ela lê
  // `acervo.versao`, e quem apaga produto apaga a versão logo em seguida.
  const versaoIds = [...new Set(arquivados.map(a => Number(a.versao_id)))]
  const produtoPorVersao = new Map(
    (versaoIds.length
      ? await t.any('SELECT id, produto_id FROM acervo.versao WHERE id IN ($<versaoIds:csv>)', { versaoIds })
      : []
    ).map(v => [String(v.id), v.produto_id])
  )

  for (const linha of arquivados) {
    // `lapide_id` é da lápide, não de `acervo.arquivo`: ele serve ao pareamento
    // do download e não descreve o arquivo, então fica fora do `dados_antes`.
    const { lapide_id: lapideId, ...arquivo } = linha

    await auditoriaCtrl.registrar(t, {
      tabela: 'acervo.arquivo',
      registroId: arquivo.id,
      operacao: 'D',
      antes: arquivo,
      usuarioUuid: usuarioDeleteUuid,
      contexto,
      // O motivo já ia para a lápide e parava ali. Agora ele também é do rastro,
      // que é o único lugar onde o motivo da exclusão do PRODUTO e da VERSÃO
      // aparece: as duas cobram o campo e nenhuma tinha onde guardá-lo.
      motivo,
      entidadeId: produtoPorVersao.get(String(arquivo.versao_id))
    })
  }

  // Os downloads saem ANTES do arquivo: `download.arquivo_id` tem FK para
  // `acervo.arquivo`, então a ordem inversa esbarraria nela.
  await t.none('DELETE FROM acervo.download WHERE arquivo_id IN ($<ids:csv>)', { ids })
  await t.none('DELETE FROM acervo.arquivo WHERE id IN ($<ids:csv>)', { ids })
}

/** Os ids dos arquivos de um conjunto de versões, para alimentar o arquivar. */
const idsDosArquivosDasVersoes = async (t, versaoIds) => {
  if (!versaoIds || versaoIds.length === 0) return []
  const linhas = await t.any(
    'SELECT id FROM acervo.arquivo WHERE versao_id IN ($<versaoIds:csv>)',
    { versaoIds }
  )
  return linhas.map(l => Number(l.id))
}

module.exports = { arquivarArquivos, idsDosArquivosDasVersoes }
