'use strict'

const { db } = require('../database')

const controller = {}

// `ponto_controle.tipo_situacao`, code 3 = 'Aprovado' (er/ponto_controle.sql).
// Fica com nome porque `tipo_situacao = 3` no meio do SQL não se lê, e o número
// solto é o que faz um domínio mudar sem ninguém achar quem o usava.
const SITUACAO_APROVADO = 3

/**
 * Números do ponto de controle para a aba do dashboard do acervo.
 *
 * Uma chamada só, e não sete: a aba pinta tudo de uma vez, e sete requisições
 * para sete quadros do mesmo assunto pagariam sete vezes o custo de rede sem
 * ganhar nada. O dashboard do acervo divide por endpoint porque cada aba dele é
 * um assunto diferente; aqui é um assunto só.
 */
controller.getResumo = async () => {
  return db.conn.task(async t => {
    const totais = await t.one(`
      SELECT
        (SELECT COUNT(*)::int FROM ponto_controle.ponto) AS total_pontos,
        (SELECT COUNT(*)::int FROM ponto_controle.arquivo) AS total_arquivos,
        (SELECT COALESCE(ROUND(SUM(tamanho_mb)::numeric / 1024, 2), 0)
           FROM ponto_controle.arquivo) AS total_gb,
        (SELECT COUNT(DISTINCT lote_id)::int FROM ponto_controle.ponto) AS total_missoes,
        (SELECT COUNT(*)::int FROM ponto_controle.upload_session
          WHERE status = 'pending') AS sessoes_abertas
    `)

    const porTipoArquivo = await t.any(`
      SELECT tp.nome, COUNT(a.id)::int AS arquivos,
             COALESCE(ROUND(SUM(a.tamanho_mb)::numeric, 1), 0) AS mb
      FROM ponto_controle.tipo_arquivo AS tp
      LEFT JOIN ponto_controle.arquivo AS a ON a.tipo_arquivo_id = tp.code
      GROUP BY tp.code, tp.nome
      HAVING COUNT(a.id) > 0
      ORDER BY COUNT(a.id) DESC
    `)

    // Missão é o LOTE. As com mais pontos primeiro, que é a pergunta que se faz
    // olhando um acervo de apoio de campo.
    const porMissao = await t.any(`
      SELECT l.id AS lote_id, l.nome AS lote, l.pit, pr.nome AS projeto,
             COUNT(p.id)::int AS pontos,
             COUNT(*) FILTER (WHERE p.tipo_situacao = ${SITUACAO_APROVADO})::int AS aprovados,
             MIN(p.data_rastreio) AS primeiro_rastreio,
             MAX(p.data_rastreio) AS ultimo_rastreio
      FROM ponto_controle.ponto AS p
      INNER JOIN acervo.lote AS l ON l.id = p.lote_id
      INNER JOIN acervo.projeto AS pr ON pr.id = l.projeto_id
      GROUP BY l.id, l.nome, l.pit, pr.nome
      ORDER BY COUNT(p.id) DESC
      LIMIT 15
    `)

    // Por mês de RASTREIO, e não de cadastramento: a pergunta é quando o campo
    // mediu, não quando alguém importou.
    const porMes = await t.any(`
      SELECT to_char(date_trunc('month', data_rastreio), 'YYYY-MM') AS mes,
             COUNT(*)::int AS pontos
      FROM ponto_controle.ponto
      WHERE data_rastreio >= date_trunc('month', NOW()) - INTERVAL '11 months'
      GROUP BY 1
      ORDER BY 1
    `)

    const ultimasImportacoes = await t.any(`
      SELECT s.uuid_session, s.status, s.completed_at, s.error_message,
             l.nome AS lote, u.nome_guerra AS usuario,
             (SELECT COUNT(*)::int FROM ponto_controle.upload_ponto_temp pt
               WHERE pt.session_id = s.id) AS pontos
      FROM ponto_controle.upload_session AS s
      INNER JOIN acervo.lote AS l ON l.id = s.lote_id
      LEFT JOIN dgeo.usuario AS u ON u.uuid = s.usuario_uuid
      ORDER BY s.created_at DESC
      LIMIT 10
    `)

    return {
      ...totais,
      total_gb: Number(totais.total_gb),
      por_tipo_arquivo: porTipoArquivo,
      por_missao: porMissao,
      por_mes: porMes,
      ultimas_importacoes: ultimasImportacoes
    }
  })
}

module.exports = controller
