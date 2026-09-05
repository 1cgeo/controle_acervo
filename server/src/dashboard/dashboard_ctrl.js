'use strict'

const { db } = require('../database')
const {
  domainConstants: { STATUS_ARQUIVO, TIPO_VERSAO }
} = require('../utils')
const { ARQUIVOS_DO_ACERVO } = require('../utils/arquivos_do_acervo')

const controller = {}

// A soma das DUAS tabelas de arquivo mora em `utils/arquivos_do_acervo.js`, e
// não mais aqui: as três checagens de espaço do `prepare-upload` usavam a
// própria conta, que olhava só `acervo.arquivo`, e o par divergia sem que nada
// acusasse. O motivo por escrito está no módulo.

controller.getTotalProdutos = async () => {
  return db.conn.one('SELECT COUNT(*) AS total_produtos FROM acervo.produto');
}

controller.getTotalArquivosGb = async () => {
  return db.conn.one(
    `SELECT SUM(tamanho_mb) / 1024 AS total_gb FROM (${ARQUIVOS_DO_ACERVO}) AS a`
  );
}

controller.getProdutosPorTipo = async () => {
  return db.conn.any(`
    SELECT p.tipo_produto_id, tp.nome AS tipo_produto, COUNT(*) AS quantidade 
    FROM acervo.produto AS p
    INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
    GROUP BY p.tipo_produto_id, tp.nome`
  );
}

controller.getGbPorTipoProduto = async () => {
  return db.conn.any(`
    SELECT p.tipo_produto_id, tp.nome AS tipo_produto, SUM(a.tamanho_mb) / 1024 AS total_gb 
    FROM acervo.produto p 
    INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
    INNER JOIN acervo.versao AS v ON v.produto_id = p.id
    INNER JOIN acervo.arquivo a ON v.id = a.versao_id 
    GROUP BY p.tipo_produto_id, tp.nome
  `);
}

controller.getTotalUsuarios = async () => {
  return db.conn.one('SELECT COUNT(*) AS total_usuarios FROM dgeo.usuario');
}

controller.getArquivosPorDia = async () => {
  return db.conn.any(`
    SELECT DATE(data_cadastramento) AS dia, COUNT(*) AS quantidade
    FROM acervo.arquivo
    WHERE data_cadastramento > NOW() - INTERVAL '30 days'
    GROUP BY dia ORDER BY dia`
  );
}

controller.getDownloadsPorDia = async () => {
  return db.conn.any(`
    SELECT DATE(data_download) AS dia, COUNT(*) AS quantidade
    FROM acervo.download
    WHERE data_download > NOW() - INTERVAL '30 days'
    GROUP BY dia ORDER BY dia`
  );
}

controller.getGbPorVolume = async () => {
  return db.conn.any(`
    SELECT a.volume_armazenamento_id, va.nome AS nome_volume, va.volume,
    va.capacidade_gb AS capacidade_gb_volume, SUM(a.tamanho_mb) / 1024 AS total_gb
    FROM (${ARQUIVOS_DO_ACERVO}) AS a
    INNER JOIN acervo.volume_armazenamento AS va ON va.id = a.volume_armazenamento_id
    GROUP BY a.volume_armazenamento_id, va.nome, va.volume, va.capacidade_gb`
  );
}

controller.getUltimosCarregamentos = async (total = 10) => {
  return db.conn.any(`
    SELECT 
      a.id, a.uuid_arquivo, a.nome, a.nome_arquivo, a.versao_id, a.tipo_arquivo_id,
      a.volume_armazenamento_id, a.extensao, a.tamanho_mb, a.checksum, a.metadado,
      a.tipo_status_id, a.situacao_carregamento_id, a.crs_original, a.descricao,
      a.data_cadastramento, a.usuario_cadastramento_uuid, a.data_modificacao, 
      a.usuario_modificacao_uuid,
      v.orgao_produtor
    FROM acervo.arquivo a
    LEFT JOIN acervo.versao v ON a.versao_id = v.id
    ORDER BY a.data_cadastramento DESC
    LIMIT $<total>`, { total });
};

controller.getUltimasModificacoes = async (total = 10) => {
  return db.conn.any(`
    SELECT 
      a.id, a.uuid_arquivo, a.nome, a.nome_arquivo, a.versao_id, a.tipo_arquivo_id,
      a.volume_armazenamento_id, a.extensao, a.tamanho_mb, a.checksum, a.metadado,
      a.tipo_status_id, a.situacao_carregamento_id, a.crs_original, a.descricao,
      a.data_cadastramento, a.usuario_cadastramento_uuid, a.data_modificacao, 
      a.usuario_modificacao_uuid,
      v.orgao_produtor
    FROM acervo.arquivo a
    LEFT JOIN acervo.versao v ON a.versao_id = v.id
    WHERE a.data_modificacao IS NOT NULL 
    ORDER BY a.data_modificacao DESC
    LIMIT $<total>`,
    { total }
  );
};

controller.getUltimosDeletes = async (total = 10) => {
  return db.conn.any(`
    SELECT 
      id, uuid_arquivo, nome, nome_arquivo, motivo_exclusao, versao_id, 
      tipo_arquivo_id, volume_armazenamento_id, extensao, tamanho_mb, 
      checksum, metadado, tipo_status_id, situacao_carregamento_id, 
      crs_original, descricao, data_cadastramento, usuario_cadastramento_uuid, 
      data_modificacao, usuario_modificacao_uuid, data_delete, usuario_delete_uuid
    FROM acervo.arquivo_deletado 
    ORDER BY data_delete DESC
    LIMIT $<total>`,
    { total }
  );
};

controller.getDownload = async () => {
  return db.conn.any(
    `
    SELECT * FROM
    (SELECT 
      d.id,
      d.arquivo_id,
      d.usuario_uuid,
      d.data_download,
      false AS apagado
    FROM acervo.download d
    UNION ALL
    SELECT 
      dd.id,
      dd.arquivo_deletado_id AS arquivo_id,
      dd.usuario_uuid,
      dd.data_download,
      true AS apagado
    FROM acervo.download_deletado dd) AS downloads
    ORDER BY data_download DESC
    LIMIT 50
    `
  );
}

// NEW DASHBOARD FUNCTIONS

controller.getProdutoActivityTimeline = async (months = 12) => {
  // Agregar o UNION por mês (antes saíam 2 linhas/mês em ordem DESC,
  // duplicando meses no gráfico do client)
  return db.conn.any(`
    SELECT month, SUM(new_products)::int AS new_products, SUM(modified_products)::int AS modified_products
    FROM (
      SELECT
        TO_CHAR(date_trunc('month', data_cadastramento), 'YYYY-MM') AS month,
        COUNT(*) AS new_products,
        0 AS modified_products
      FROM acervo.produto
      WHERE data_cadastramento > NOW() - ($1 * INTERVAL '1 month')
      GROUP BY month
      UNION ALL
      SELECT
        TO_CHAR(date_trunc('month', data_modificacao), 'YYYY-MM') AS month,
        0 AS new_products,
        COUNT(*) AS modified_products
      FROM acervo.produto
      WHERE
        data_modificacao IS NOT NULL AND
        data_modificacao > NOW() - ($1 * INTERVAL '1 month')
      GROUP BY month
    ) sub
    GROUP BY month
    ORDER BY month
  `, [months]);
}

controller.getVersionStatistics = async () => {
  return db.conn.task(async t => {
    const versionStats = await t.one(`
      SELECT
        COALESCE(SUM(versions_per_product), 0) AS total_versions,
        COUNT(*) AS products_with_versions,
        ROUND(AVG(versions_per_product), 2) AS avg_versions_per_product,
        MAX(versions_per_product) AS max_versions_per_product
      FROM (
        SELECT produto_id, COUNT(*) AS versions_per_product
        FROM acervo.versao
        GROUP BY produto_id
      ) subquery
    `);
    
    const versionDistribution = await t.any(`
      SELECT 
        versions_per_product,
        COUNT(*) AS product_count
      FROM (
        SELECT produto_id, COUNT(*) AS versions_per_product
        FROM acervo.versao
        GROUP BY produto_id
      ) subquery
      GROUP BY versions_per_product
      ORDER BY versions_per_product
    `);
    
    const versionTypeDistribution = await t.any(`
      SELECT 
        tv.nome AS version_type,
        COUNT(*) AS version_count
      FROM acervo.versao v
      JOIN dominio.tipo_versao tv ON v.tipo_versao_id = tv.code
      GROUP BY tv.nome
    `);
    
    return {
      stats: versionStats,
      distribution: versionDistribution,
      type_distribution: versionTypeDistribution
    };
  });
}

/**
 * Crescimento do armazenamento, mês a mês.
 *
 * O ACUMULADO INCLUI O SALDO ANTERIOR À JANELA. Somando a partir do zero no
 * primeiro mês mostrado, a série "GB Acumulados" termina no total dos últimos 12
 * meses enquanto o cartão "Armazenamento Total" mostra o acervo inteiro: dois
 * números com o mesmo nome, na mesma tela, discordando.
 *
 * O recorte nasce no INÍCIO DO MÊS (`date_trunc`), e não em "hoje menos N
 * meses", senão o mês mais antigo vem pela metade e o primeiro ponto do gráfico
 * fica sistematicamente menor sem razão visível.
 *
 * SOMA AS DUAS TABELAS DE ARQUIVO (`ARQUIVOS_DO_ACERVO`), como o cartão do total
 * e o alerta de volume cheio. Lendo só `acervo.arquivo`, o saldo anterior e cada
 * mês ficavam menores pelo tamanho do ponto de controle, e a série voltava a
 * terminar abaixo do cartão "Armazenamento Total" -- que é exatamente a
 * divergência que o saldo anterior veio corrigir.
 */
controller.getStorageGrowthTrends = async (months = 12) => {
  return db.conn.any(`
    WITH janela AS (
      SELECT date_trunc('month', NOW() - INTERVAL '${months - 1} months') AS inicio
    ),
    saldo_anterior AS (
      SELECT COALESCE(SUM(tamanho_mb) / 1024, 0) AS gb
      FROM (${ARQUIVOS_DO_ACERVO}) AS a, janela
      WHERE a.data_cadastramento < janela.inicio
    ),
    monthly_data AS (
      SELECT
        date_trunc('month', a.data_cadastramento) AS month,
        SUM(a.tamanho_mb) / 1024 AS gb_added
      FROM (${ARQUIVOS_DO_ACERVO}) AS a, janela
      WHERE a.data_cadastramento >= janela.inicio
      GROUP BY month
    ),
    months_series AS (
      SELECT generate_series(
        (SELECT inicio FROM janela),
        date_trunc('month', NOW()),
        '1 month'::interval
      ) AS month
    )
    SELECT
      TO_CHAR(ms.month, 'YYYY-MM') AS month,
      COALESCE(md.gb_added, 0) AS gb_added,
      (SELECT gb FROM saldo_anterior)
        + SUM(COALESCE(md.gb_added, 0)) OVER (ORDER BY ms.month) AS cumulative_gb
    FROM months_series ms
    LEFT JOIN monthly_data md ON ms.month = md.month
    ORDER BY ms.month
  `);
}

controller.getProjectStatusSummary = async () => {
  return db.conn.task(async t => {
    // Project status summary
    const projectStatus = await t.any(`
      SELECT 
        tse.nome AS status,
        COUNT(DISTINCT p.id) AS project_count
      FROM acervo.projeto p
      JOIN dominio.tipo_status_execucao tse ON p.status_execucao_id = tse.code
      GROUP BY tse.nome, tse.code
      ORDER BY tse.code
    `);
    
    // Lot status summary
    const lotStatus = await t.any(`
      SELECT 
        tse.nome AS status,
        COUNT(DISTINCT l.id) AS lot_count
      FROM acervo.lote l
      JOIN dominio.tipo_status_execucao tse ON l.status_execucao_id = tse.code
      GROUP BY tse.nome, tse.code
      ORDER BY tse.code
    `);
    
    // Projects without lots
    const projectsWithoutLots = await t.one(`
      SELECT 
        COUNT(*) AS count
      FROM acervo.projeto p
      WHERE NOT EXISTS (
        SELECT 1 FROM acervo.lote l WHERE l.projeto_id = p.id
      )
    `);
    
    return {
      project_status: projectStatus,
      lot_status: lotStatus,
      projects_without_lots: parseInt(projectsWithoutLots.count)
    };
  });
}

controller.getUserActivityMetrics = async (limit = 10) => {
  return db.conn.any(`
    WITH user_uploads AS (
      SELECT 
        usuario_cadastramento_uuid,
        COUNT(*) AS upload_count
      FROM acervo.arquivo
      GROUP BY usuario_cadastramento_uuid
    ),
    user_modifications AS (
      SELECT 
        usuario_modificacao_uuid,
        COUNT(*) AS modification_count
      FROM acervo.arquivo
      WHERE usuario_modificacao_uuid IS NOT NULL
      GROUP BY usuario_modificacao_uuid
    ),
    user_downloads AS (
      SELECT 
        usuario_uuid,
        COUNT(*) AS download_count
      FROM acervo.download
      GROUP BY usuario_uuid
    )
    SELECT 
      u.nome AS usuario_nome,
      u.login AS usuario_login,
      COALESCE(up.upload_count, 0) AS uploads,
      COALESCE(um.modification_count, 0) AS modifications,
      COALESCE(ud.download_count, 0) AS downloads,
      COALESCE(up.upload_count, 0) + 
      COALESCE(um.modification_count, 0) + 
      COALESCE(ud.download_count, 0) AS total_activity
    FROM dgeo.usuario u
    LEFT JOIN user_uploads up ON u.uuid = up.usuario_cadastramento_uuid
    LEFT JOIN user_modifications um ON u.uuid = um.usuario_modificacao_uuid
    LEFT JOIN user_downloads ud ON u.uuid = ud.usuario_uuid
    WHERE u.ativo = true
    ORDER BY total_activity DESC
    LIMIT $1
  `, [limit]);
}

// System health summary
controller.getSystemHealth = async () => {
  return db.conn.task(async t => {
    const volumeAlerts = await t.any(`
      SELECT va.id, va.nome, va.capacidade_gb,
        COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS usado_gb,
        CASE WHEN va.capacidade_gb > 0 THEN
          ROUND((COALESCE(SUM(a.tamanho_mb) / 1024, 0) / va.capacidade_gb * 100)::numeric, 1)
        ELSE 0 END AS percentual_uso
      FROM acervo.volume_armazenamento va
      LEFT JOIN (${ARQUIVOS_DO_ACERVO}) a ON a.volume_armazenamento_id = va.id
      GROUP BY va.id, va.nome, va.capacidade_gb
      HAVING va.capacidade_gb > 0
        AND (COALESCE(SUM(a.tamanho_mb) / 1024, 0) / va.capacidade_gb) > 0.8
      ORDER BY percentual_uso DESC
    `)

    const fileErrors = await t.one(`
      SELECT
        (SELECT COUNT(*) FROM acervo.arquivo WHERE tipo_status_id = $1) AS erros_carregamento,
        (SELECT COUNT(*) FROM acervo.arquivo_deletado WHERE tipo_status_id = $2) AS erros_exclusao
    `, [STATUS_ARQUIVO.ERRO_CARREGAMENTO, STATUS_ARQUIVO.ERRO_EXCLUSAO])

    // Sessões em andamento têm status 'pending' (não existe status 'active')
    const activeSessions = await t.one(
      `SELECT COUNT(*) AS sessoes_ativas FROM acervo.upload_session WHERE status = 'pending'`
    )

    const totals = await t.one(`
      SELECT
        (SELECT COUNT(*) FROM acervo.versao) AS total_versoes,
        (SELECT COUNT(*) FROM acervo.projeto) AS total_projetos,
        -- Janela de 30 DIAS, e não de 24 horas. Em 24 horas o
        -- cartão passava a maior parte do tempo em zero: download de acervo aqui
        -- é evento de dias, não de hora. O nome do campo acompanha a janela, para
        -- a tela não poder mostrar "30 dias" sobre um número de 24 horas.
        (SELECT COUNT(*) FROM acervo.download WHERE data_download > NOW() - INTERVAL '30 days') AS downloads_30d,
        (SELECT COUNT(*) FROM ponto_controle.ponto) AS total_pontos_controle,
        -- Carregamento do MÊS corrente, contado em VERSÕES: é a versão que
        -- carrega os arquivos, e é ela que o operador cadastra. Contar produtos
        -- responderia outra pergunta (quantas folhas novas), e produto antigo
        -- que ganha edição nova não apareceria em nenhuma das duas.
        (SELECT COUNT(*) FROM acervo.versao
          WHERE data_cadastramento >= date_trunc('month', NOW())) AS versoes_carregadas_mes
    `)

    return {
      volumes_alertas: volumeAlerts,
      erros_arquivo: {
        erros_carregamento: parseInt(fileErrors.erros_carregamento),
        erros_exclusao: parseInt(fileErrors.erros_exclusao)
      },
      sessoes_upload_ativas: parseInt(activeSessions.sessoes_ativas),
      total_versoes: parseInt(totals.total_versoes),
      total_projetos: parseInt(totals.total_projetos),
      downloads_30d: parseInt(totals.downloads_30d),
      total_pontos_controle: parseInt(totals.total_pontos_controle),
      versoes_carregadas_mes: parseInt(totals.versoes_carregadas_mes)
    }
  })
}

controller.getProdutosPorEscala = async () => {
  return db.conn.any(`
    SELECT te.nome AS tipo_escala, COUNT(*) AS quantidade
    FROM acervo.produto p
    JOIN dominio.tipo_escala te ON te.code = p.tipo_escala_id
    GROUP BY te.nome, te.code
    ORDER BY te.code
  `)
}

controller.getArquivosPorTipoArquivo = async () => {
  return db.conn.any(`
    SELECT ta.nome AS tipo_arquivo, COUNT(*) AS quantidade,
      COALESCE(SUM(a.tamanho_mb) / 1024, 0) AS total_gb
    FROM acervo.arquivo a
    JOIN dominio.tipo_arquivo ta ON ta.code = a.tipo_arquivo_id
    GROUP BY ta.nome, ta.code
    ORDER BY total_gb DESC
  `)
}

// Loading situation distribution
controller.getSituacaoCarregamento = async () => {
  return db.conn.any(`
    SELECT sc.nome AS situacao, COUNT(*) AS quantidade
    FROM acervo.arquivo a
    JOIN dominio.situacao_carregamento sc ON sc.code = a.situacao_carregamento_id
    GROUP BY sc.nome, sc.code
    ORDER BY sc.code
  `)
}

/**
 * A PRODUÇÃO, mês a mês: quantas folhas ficaram prontas.
 *
 * CONTA POR `data_edicao`, E NÃO POR `data_cadastramento`. Esta é a correção que
 * muda o que o gráfico responde, e ela foi medida na produção em 2026-08-07: as
 * versões de 2026 têm 26, 2, 65, 49, 25, 103 e 24 por mês de EDIÇÃO, de janeiro a
 * julho, e 0, 0, 0, 0, 0, 4.513 e 2.645 por mês de CADASTRAMENTO. O segundo
 * conjunto é o dia em que a linha entrou no SCA, ou seja, a MIGRAÇÃO: quem
 * olhasse o painel via um pico de 4.513 folhas em junho, que não existiu.
 *
 * `data_edicao` é a data que a folha carrega como edição, e é a mesma de onde o
 * PIT tira o realizado (ver `pit_execucao_ctrl.js`). Assim o painel do acervo e a
 * grade do PIT param de contar coisas diferentes com o mesmo nome.
 *
 * SÓ A VERSÃO REGULAR. A Planejada é promessa (não saiu nada) e o Registro
 * Histórico é catalogação de acervo antigo, com data_edicao de 1980: incluí-los
 * encheria a série de trabalho que não é do mês.
 *
 * SEM O ACUMULADO, e isso foi visto na tela. As duas séries dividiam o mesmo eixo
 * Y, e o acumulado (7.400) achatava as novas (dezenas) numa linha rente ao chão:
 * o gráfico virava seis barras verdes iguais, que não respondem pergunta nenhuma.
 * Quem quer o total do acervo tem o cartão "Total de Versões".
 */
controller.getVersaoActivityTimeline = async (months = 12) => {
  return db.conn.any(`
    WITH janela AS (
      SELECT date_trunc('month', NOW() - INTERVAL '${months - 1} months') AS inicio
    ),
    monthly AS (
      SELECT
        TO_CHAR(date_trunc('month', data_edicao), 'YYYY-MM') AS month,
        COUNT(*) AS novas_versoes
      FROM acervo.versao, janela
      WHERE data_edicao >= janela.inicio
        AND tipo_versao_id = ${TIPO_VERSAO.REGULAR}
      GROUP BY month
    ),
    months_series AS (
      SELECT TO_CHAR(generate_series(
        (SELECT inicio FROM janela),
        date_trunc('month', NOW()),
        '1 month'::interval
      ), 'YYYY-MM') AS month
    )
    SELECT ms.month, COALESCE(m.novas_versoes, 0) AS novas_versoes
    FROM months_series ms
    LEFT JOIN monthly m ON ms.month = m.month
    ORDER BY ms.month
  `)
}

/**
 * A PRODUZIR: a folha prometida que ainda não virou edição regular.
 *
 * A FOLHA É A UNIDADE, e não o lote. `acervo.versao.data_prevista` é a promessa
 * por folha, e é dela que sai o planejado do PIT (ver o comentário da coluna em
 * er/acervo.sql). O lote entra como rótulo, para quem lê saber de que corrida a
 * folha veio.
 *
 * O ATRASO SE CALCULA AQUI, e não na tela. A tela que subtrai datas erra o fuso
 * (a coluna é DATE e chega como texto), e duas telas subtraindo a mesma coisa
 * chegariam a dois números.
 *
 * NÃO INCLUI a meta do PIT, o lote em andamento nem o Extra-PIT. Os três moram
 * em tela própria (`/metas`, a administração do acervo, `/extra-pit`), com o
 * guarda que lhes cabe. Repeti-los aqui criava uma segunda contagem do plano,
 * calculada de outro jeito, dentro do painel do acervo.
 */
controller.getAProduzir = async () => {
  // Filtra por tipo, e não por ausência de arquivo. "Sem arquivo" também é o
  // estado do Registro Histórico (408 versões em 2026-08), que não é promessa
  // nenhuma: é acervo antigo catalogado sem o digital.
  return db.conn.any(`
      SELECT v.id, v.uuid_versao, v.versao, p.id AS produto_id, p.nome AS produto,
        p.mi, p.inom, tp.nome AS tipo_produto, te.nome AS tipo_escala,
        v.data_prevista::text AS data_prevista,
        l.pit AS lote, l.nome AS lote_nome,
        mv.item AS meta, mv.descricao AS meta_descricao,
        de.descricao AS demanda_extra,
        -- Dias de atraso contra HOJE, nulo quando não há promessa e zero quando
        -- o mês prometido ainda não venceu. O sinal negativo diria "faltam N
        -- dias", e isso a tela resolve sozinha com a data_prevista.
        CASE WHEN v.data_prevista IS NULL THEN NULL
             ELSE GREATEST(0, (CURRENT_DATE - v.data_prevista))
        END AS dias_atraso
      FROM acervo.versao AS v
      INNER JOIN acervo.produto AS p ON p.id = v.produto_id
      INNER JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
      INNER JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      LEFT JOIN acervo.lote AS l ON l.id = v.lote_id
      LEFT JOIN pit.meta_vigente AS mv ON mv.id = v.meta_pit_id
      LEFT JOIN pit.demanda_extra AS de ON de.id = v.demanda_extra_id
      WHERE v.tipo_versao_id = ${TIPO_VERSAO.PLANEJADA}
      -- Sem promessa vem PRIMEIRO, e de propósito: a folha planejada sem
      -- data_prevista é erro de cadastro, e esconder no fim da lista a faria
      -- passar despercebida. Ver GET /metas/execucao/diagnostico.
      ORDER BY v.data_prevista NULLS FIRST, p.mi, tp.nome
    `)
}

// Last 20 registered products
controller.getUltimosProdutos = async () => {
  return db.conn.any(`
    SELECT p.id, p.nome, p.mi, p.inom,
      tp.nome AS tipo_produto, te.nome AS tipo_escala,
      p.data_cadastramento,
      (SELECT COUNT(*) FROM acervo.versao v WHERE v.produto_id = p.id) AS total_versoes
    FROM acervo.produto p
    JOIN dominio.tipo_produto tp ON tp.code = p.tipo_produto_id
    JOIN dominio.tipo_escala te ON te.code = p.tipo_escala_id
    ORDER BY p.data_cadastramento DESC
    LIMIT 20
  `)
}

// Last 20 registered versions
controller.getUltimasVersoes = async () => {
  return db.conn.any(`
    SELECT v.id, v.versao, v.data_criacao, v.orgao_produtor,
      tv.nome AS tipo_versao,
      p.nome AS produto_nome, p.mi,
      (SELECT COUNT(*) FROM acervo.arquivo a WHERE a.versao_id = v.id) AS total_arquivos
    FROM acervo.versao v
    JOIN acervo.produto p ON p.id = v.produto_id
    JOIN dominio.tipo_versao tv ON tv.code = v.tipo_versao_id
    ORDER BY v.data_criacao DESC
    LIMIT 20
  `)
}

module.exports = controller