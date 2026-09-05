'use strict'

/**
 * Quem mais já reservou este nome físico, além de `acervo.arquivo`.
 *
 * O `prepare-upload` NÃO reservava coisa nenhuma: ele conferia o trio
 * (volume, nome_arquivo, extensao) contra `acervo.arquivo` e contra o Set do
 * próprio lote, e nunca contra as sessões ainda abertas. Dois operadores
 * preparando o MESMO arquivo, cada um pela sua janela, recebiam 200 com o MESMO
 * `destination_path`, copiavam por SMB para o mesmo caminho, e o segundo
 * sobrescrevia os bytes do primeiro sem aviso -- quem confirmasse primeiro
 * gravaria um checksum que o byte do volume podia não ter. O mesmo valia entre
 * uma sessão do plugin e um `upload-web` concorrente.
 *
 * ESTA CONSULTA é a reserva possível sem DDL: ela lê o rascunho das sessões
 * `pending` e ainda no prazo. Não é uma trava (duas requisições exatamente
 * simultâneas ainda podem passar juntas); é o que fecha a janela de horas ou
 * dias que a sessão de upload abre por desenho. A trava de verdade seria uma
 * tabela de reserva com índice único sobre
 * `(volume_armazenamento_id, lower(nome_arquivo), lower(extensao))` viva
 * enquanto a sessão vive, e isso é DECISÃO, porque pede migração.
 *
 * O rascunho tem três formas, e são as mesmas de `arquivosDoRascunho` em
 * `arquivo_ctrl.js`: `{arquivos:[]}` (add_files, replace_files),
 * `{versoes:[{arquivos:[]}]}` (add_version) e
 * `{produtos:[{versoes:[{arquivos:[]}]}]}` (add_product). O `jsonb_typeof`
 * antes de cada `jsonb_array_elements` existe porque a função ERRA em valor que
 * não seja array, e um erro aqui derrubaria o prepare inteiro com 500.
 *
 * A comparação IGNORA CAIXA, pelo mesmo motivo do índice
 * `unique_nome_fisico_por_volume_ci`: o SMB do volume não distingue caixa.
 *
 * @param {object} t          executor pg-promise (`db.conn` ou transação)
 * @param {number} volumeId   volume_armazenamento_id
 * @param {string} nomeArquivo nome físico sem extensão
 * @param {string} extensao   extensão sem o ponto
 * @returns {Promise<string|null>} o `uuid_session` que já reservou, ou null
 */
const SQL_SESSAO_QUE_RESERVOU = `
  WITH abertas AS (
    SELECT us.uuid_session, us.payload
      FROM acervo.upload_session us
     WHERE us.status = 'pending'
       AND (us.expiration_time IS NULL OR us.expiration_time > NOW())
  ),
  reservados AS (
    SELECT a.uuid_session, arq AS arquivo
      FROM abertas a
      CROSS JOIN LATERAL (
        SELECT jsonb_array_elements(
                 CASE WHEN jsonb_typeof(a.payload->'arquivos') = 'array'
                      THEN a.payload->'arquivos' ELSE '[]'::jsonb END) AS arq
        UNION ALL
        SELECT jsonb_array_elements(
                 CASE WHEN jsonb_typeof(v->'arquivos') = 'array'
                      THEN v->'arquivos' ELSE '[]'::jsonb END)
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(a.payload->'versoes') = 'array'
                      THEN a.payload->'versoes' ELSE '[]'::jsonb END) v
        UNION ALL
        SELECT jsonb_array_elements(
                 CASE WHEN jsonb_typeof(v->'arquivos') = 'array'
                      THEN v->'arquivos' ELSE '[]'::jsonb END)
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(a.payload->'produtos') = 'array'
                      THEN a.payload->'produtos' ELSE '[]'::jsonb END) p,
               jsonb_array_elements(
                 CASE WHEN jsonb_typeof(p->'versoes') = 'array'
                      THEN p->'versoes' ELSE '[]'::jsonb END) v
      ) s
  )
  SELECT r.uuid_session
    FROM reservados r
   WHERE (r.arquivo->>'volume_armazenamento_id')::bigint = $<volumeId>
     AND lower(r.arquivo->>'nome_arquivo') = lower($<nomeArquivo>)
     AND lower(r.arquivo->>'extensao') = lower($<extensao>)
   LIMIT 1`

const sessaoQueReservou = async (t, volumeId, nomeArquivo, extensao) => {
  if (volumeId === null || volumeId === undefined) return null
  if (!extensao) return null

  const linha = await t.oneOrNone(SQL_SESSAO_QUE_RESERVOU, {
    volumeId, nomeArquivo, extensao
  })
  return linha ? linha.uuid_session : null
}

module.exports = { sessaoQueReservou }
