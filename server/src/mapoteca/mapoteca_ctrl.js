// Path: mapoteca\mapoteca_ctrl.js
"use strict";

const path = require("path");

const { caminhoNoVolume } = require('../utils/caminho_volume');
const { db } = require("../database");
const { AppError, httpCode, preserveOmitted, domainConstants: { SITUACAO_PEDIDO, TIPO_LOCALIZACAO, STATUS_ARQUIVO, TIPO_ARQUIVO } } = require("../utils");
const generateLocalizador = require("../utils/generate_localizador");
const auditoriaCtrl = require("./auditoria_ctrl");
const {
  ESCALA_DISPLAY,
  ESCALA_DISPLAY_ITEM,
  JOIN_PRODUTO_ITEM,
  PRODUTO_NOME,
  PRODUTO_MI,
  ITEM_E_AVULSO,
  filtroAno,
  SITUACOES_EM_ABERTO,
  JOIN_ARQUIVO_IMPRIMIVEL
} = require("./query_fragments");

const controller = {};

// Resolve o id inteiro do usuário a partir do uuid presente no token
const getUsuarioId = async (usuarioUuid) => {
  const usuarioInfo = await db.conn.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );

  if (!usuarioInfo) {
    throw new AppError("Usuário não encontrado", httpCode.BadRequest);
  }

  return usuarioInfo.id;
};

// O CÓDIGO da meta do PIT como a tela e a planilha o esperam: '4.1' quando a
// meta se subdivide, e o número da meta quando ela é indivisa (`item` NULO). O
// NULLIF cobre também o '-' literal, caso alguém o digite no cadastro.
// Uma expressão só, usada em toda consulta que devolve pedido, para as três não
// divergirem. A tabela pit.meta é de plataforma (er/pit.sql).
const ROTULO_META = "COALESCE(NULLIF(mp.item, '-'), mp.numero_meta::text)";

// Colunas de pedido/produto_pedido compartilhadas entre criação e atualização
// (pgp ColumnSet). `def` permite que o cliente omita campos opcionais.
const PEDIDO_COLS = [
  'data_pedido',
  { name: 'data_atendimento', def: null },
  'cliente_id', 'situacao_pedido_id',
  { name: 'ponto_contato', def: null },
  { name: 'documento_solicitacao', def: null },
  { name: 'documento_solicitacao_nup', def: null },
  { name: 'endereco_entrega', def: null },
  // Como o material saiu. Subiu do item para o pedido em 2026-07-30: 1 pedido
  // em 91 tinha mais de uma forma entre os itens.
  { name: 'forma_entrega_id', def: null },
  'palavras_chave',
  { name: 'operacao', def: null },
  { name: 'prazo', def: null },
  { name: 'demandante', def: null },
  { name: 'omds', def: null },
  { name: 'previsto_pit', def: false },
  { name: 'meta_pit_id', def: null },
  { name: 'canal_recebimento_id', def: null },
  { name: 'municipio', def: null },
  { name: 'qtd_imagens', def: null },
  { name: 'observacao', def: null },
  { name: 'localizador_envio', def: null },
  { name: 'observacao_envio', def: null },
  { name: 'observacao_interna', def: null },
  { name: 'motivo_cancelamento', def: null }
];

const PRODUTO_PEDIDO_COLS = [
  // Um destino vem nulo, SEMPRE: o CHECK produto_pedido_um_destino garante que
  // exatamente um esteja preenchido. Os tres precisam de def, porque o item de
  // acervo omite nome_avulso e o item avulso omite uuid_versao; sem o def o pgp
  // quebra antes de a linha chegar ao banco.
  { name: 'uuid_versao', def: null },
  { name: 'nome_avulso', def: null },
  { name: 'descricao_avulso', def: null },
  'pedido_id', 'quantidade',
  { name: 'quantidade_fornecida', def: null },
  'tipo_midia_id',
  { name: 'tipo_midia_fornecida_id', def: null },
  // Sem forma_entrega_id e sem data_entrega: as duas sao do PEDIDO desde
  // 2026-07-30. O item so descreve O QUE se imprime, nunca como sai daqui.
  { name: 'observacao', def: null },
  // O def aqui é só rede de segurança para id inexistente: no caminho normal o
  // preserveOmitted já preencheu a chave com o valor gravado (na criação o
  // default do Joi é que responde). Sem ele, atualizar um id que não existe
  // omitindo a chave viraria erro do pgp em vez do 404 do controller.
  { name: 'producao_especifica', def: false }
];

// Funções para Domínios
controller.getTipoCliente = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM mapoteca.tipo_cliente
  `);
};

controller.getSituacaoPedido = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM mapoteca.situacao_pedido
  `);
};

controller.getTipoMidia = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM mapoteca.tipo_midia
  `);
};

controller.getCanalRecebimento = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM mapoteca.canal_recebimento
  `);
};

controller.getTipoLocalizacao = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM mapoteca.tipo_localizacao
  `);
};

controller.getFormaEntrega = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM mapoteca.forma_entrega
    ORDER BY code
  `);
};

// Funções para Cliente
controller.getClientes = async () => {
  return db.conn.any(`
    WITH pedidos_info AS (
      SELECT 
        cliente_id,
        COUNT(*) AS total_pedidos,
        MAX(data_pedido) AS data_ultimo_pedido,
        SUM(CASE WHEN situacao_pedido_id = ${SITUACAO_PEDIDO.EM_ANDAMENTO} THEN 1 ELSE 0 END) AS pedidos_em_andamento,
        SUM(CASE WHEN situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO} THEN 1 ELSE 0 END) AS pedidos_concluidos
      FROM mapoteca.pedido
      GROUP BY cliente_id
    ),
    produtos_info AS (
      SELECT 
        p.cliente_id,
        SUM(pp.quantidade) AS total_produtos
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido p ON pp.pedido_id = p.id
      GROUP BY p.cliente_id
    )
    SELECT 
      c.id, 
      c.nome,
      c.sigla,
      c.ponto_contato_principal,
      c.endereco_entrega_principal,
      c.tipo_cliente_id,
      tc.nome AS tipo_cliente_nome,
      COALESCE(pi.total_pedidos, 0) AS total_pedidos,
      pi.data_ultimo_pedido,
      COALESCE(pi.pedidos_em_andamento, 0) AS pedidos_em_andamento,
      COALESCE(pi.pedidos_concluidos, 0) AS pedidos_concluidos,
      COALESCE(pri.total_produtos, 0) AS total_produtos
    FROM mapoteca.cliente AS c
    LEFT JOIN mapoteca.tipo_cliente AS tc ON tc.code = c.tipo_cliente_id
    LEFT JOIN pedidos_info pi ON pi.cliente_id = c.id
    LEFT JOIN produtos_info pri ON pri.cliente_id = c.id
    ORDER BY c.nome
  `);
};

controller.getClienteById = async (clienteId) => {
  return db.conn.task(async t => {
    // Buscar informações básicas do cliente
    const cliente = await t.oneOrNone(`
      SELECT 
        c.id,
        c.nome,
        c.sigla,
        c.ponto_contato_principal,
        c.endereco_entrega_principal,
        c.tipo_cliente_id,
        tc.nome AS tipo_cliente_nome
      FROM mapoteca.cliente AS c
      LEFT JOIN mapoteca.tipo_cliente AS tc ON tc.code = c.tipo_cliente_id
      WHERE c.id = $1
    `, [clienteId]);

    if (!cliente) {
      throw new AppError('Cliente não encontrado', httpCode.NotFound);
    }

    // Buscar estatísticas de pedidos
    const pedidosEstatisticas = await t.oneOrNone(`
      SELECT 
        COUNT(*) AS total_pedidos,
        MAX(data_pedido) AS data_ultimo_pedido,
        MIN(data_pedido) AS data_primeiro_pedido,
        SUM(CASE WHEN situacao_pedido_id = ${SITUACAO_PEDIDO.EM_ANDAMENTO} THEN 1 ELSE 0 END) AS pedidos_em_andamento,
        SUM(CASE WHEN situacao_pedido_id = ${SITUACAO_PEDIDO.CONCLUIDO} THEN 1 ELSE 0 END) AS pedidos_concluidos
      FROM mapoteca.pedido
      WHERE cliente_id = $1
    `, [clienteId]);

    // Buscar estatísticas de produtos
    const produtosEstatisticas = await t.oneOrNone(`
      SELECT 
        SUM(pp.quantidade) AS total_produtos
      FROM mapoteca.produto_pedido pp
      JOIN mapoteca.pedido p ON pp.pedido_id = p.id
      WHERE p.cliente_id = $1
    `, [clienteId]);

    // Buscar últimos pedidos
    const ultimosPedidos = await t.any(`
      SELECT 
        p.id, 
        p.data_pedido, 
        p.situacao_pedido_id, 
        sp.nome AS situacao_pedido_nome,
        p.documento_solicitacao,
        p.prazo,
        (SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id) AS quantidade_produtos
      FROM mapoteca.pedido p
      LEFT JOIN mapoteca.situacao_pedido sp ON sp.code = p.situacao_pedido_id
      WHERE p.cliente_id = $1
      ORDER BY p.data_pedido DESC
      LIMIT 5
    `, [clienteId]);

    // Combinar resultados
    return {
      ...cliente,
      estatisticas: {
        total_pedidos: parseInt(pedidosEstatisticas?.total_pedidos || 0),
        data_ultimo_pedido: pedidosEstatisticas?.data_ultimo_pedido,
        data_primeiro_pedido: pedidosEstatisticas?.data_primeiro_pedido,
        pedidos_em_andamento: parseInt(pedidosEstatisticas?.pedidos_em_andamento || 0),
        pedidos_concluidos: parseInt(pedidosEstatisticas?.pedidos_concluidos || 0),
        total_produtos: parseInt(produtosEstatisticas?.total_produtos || 0)
      },
      ultimos_pedidos: ultimosPedidos
    };
  });
};

controller.criaCliente = async (cliente, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome',
      { name: 'sigla', def: null },
      { name: 'ponto_contato_principal', def: null },
      { name: 'endereco_entrega_principal', def: null },
      'tipo_cliente_id'
    ]);

    const query = db.pgp.helpers.insert(cliente, cs, {
      table: 'cliente',
      schema: 'mapoteca'
    });

    await t.none(query);
  });
};

controller.atualizaCliente = async (cliente, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // A tela de cliente ainda nao conhece `sigla`. Sem isto, editar o endereco
    // pela tela apagaria a sigla carregada, com 200 e sem aviso: e a armadilha
    // do PUT de 2026-07-25. Ausente preserva; null explicito ainda limpa.
    await preserveOmitted(t, {
      schema: 'mapoteca',
      table: 'cliente',
      id: cliente.id,
      fields: ['sigla'],
      body: cliente
    });

    const cs = new db.pgp.helpers.ColumnSet([
      'nome',
      { name: 'sigla', def: null },
      { name: 'ponto_contato_principal', def: null },
      { name: 'endereco_entrega_principal', def: null },
      'tipo_cliente_id'
    ], { table: { table: 'cliente', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(cliente, cs) + ' WHERE id = $1';

    const result = await t.result(query, [cliente.id]);

    if (result.rowCount === 0) {
      throw new AppError('Cliente não encontrado', httpCode.NotFound);
    }
  });
};

controller.deleteClientes = async (clienteIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs de cliente existem
    const existingClients = await t.any(
      `SELECT id FROM mapoteca.cliente WHERE id IN ($1:csv)`,
      [clienteIds]
    );

    if (existingClients.length !== clienteIds.length) {
      // BIGSERIAL retorna como string no driver — normalizar para número
      const existingIds = existingClients.map(c => Number(c.id));
      const missingIds = clienteIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes clientes não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Verificar se há pedidos associados aos clientes
    const associatedOrders = await t.any(
      `SELECT cliente_id, COUNT(*) as count FROM mapoteca.pedido 
       WHERE cliente_id IN ($1:csv)
       GROUP BY cliente_id`,
      [clienteIds]
    );

    if (associatedOrders.length > 0) {
      const clientsWithOrders = associatedOrders.map(o => o.cliente_id);
      throw new AppError(
        `Não é possível excluir os clientes com IDs: ${clientsWithOrders.join(', ')} pois possuem pedidos associados`,
        httpCode.BadRequest
      );
    }

    // Se não houver pedidos associados, deletar os clientes
    return t.any(
      `DELETE FROM mapoteca.cliente WHERE id IN ($1:csv)`,
      [clienteIds]
    );
  });
};

// Funções para Pedido
// Pedidos do ANO consultado, pela data do pedido.
//
// A lista era do acervo inteiro, e o ano de contexto do módulo não valia aqui
// (decisão de 2026-07-28, revista pelo chefe no mesmo dia). O que ela custa, e
// vale saber: um pedido de dezembro que só se conclui em janeiro deixa de
// aparecer quando vira o ano, e é preciso trocar o ano na navbar para achá-lo.
// Em troca, a lista para de crescer indefinidamente e passa a casar com o
// Dashboard, que conta pedido pelo mesmo critério.
controller.getPedidos = async (ano) => {
  return db.conn.any(`
    SELECT p.id, p.data_pedido, p.data_atendimento,
           p.cliente_id, c.nome AS cliente_nome,
           -- tipo_cliente_id sustenta o filtro militar/civil da lista. Militar
           -- e 1 a 3 (OM EB, Aeronautica, Marinha); civil e 4 a 9.
           c.tipo_cliente_id, tc.nome AS tipo_cliente_nome,
           p.situacao_pedido_id, sp.nome AS situacao_pedido_nome,
           p.documento_solicitacao, p.documento_solicitacao_nup,
           p.prazo, p.demandante, p.omds, p.previsto_pit, p.operacao,
           -- A meta e chave estrangeira desde 2026-07-31 (era o codigo digitado
           -- a mao). O id serve a escrita; o codigo serve a tela e a planilha.
           p.meta_pit_id, ${ROTULO_META} AS meta_pit_codigo,
           p.localizador_pedido, p.localizador_envio, p.observacao_envio,
           p.forma_entrega_id, fe.nome AS forma_entrega_nome,
           u.nome AS usuario_criacao_nome,
           p.data_criacao,
           (SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id) AS quantidade_produtos,
           (SELECT COUNT(*) FROM mapoteca.produto_pedido pp
            WHERE pp.pedido_id = p.id
              AND COALESCE((SELECT SUM(ii.quantidade) FROM mapoteca.impressao_item ii WHERE ii.produto_pedido_id = pp.id), 0) >= pp.quantidade
           ) AS itens_impressos
    FROM mapoteca.pedido AS p
    LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
    LEFT JOIN mapoteca.tipo_cliente AS tc ON tc.code = c.tipo_cliente_id
    LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
    LEFT JOIN mapoteca.forma_entrega AS fe ON fe.code = p.forma_entrega_id
    LEFT JOIN dgeo.usuario AS u ON u.id = p.usuario_criacao_id
    LEFT JOIN pit.meta AS mp ON mp.id = p.meta_pit_id
    WHERE ${filtroAno('p.data_pedido')}
    ORDER BY p.data_pedido DESC
  `, { ano });
};

/**
 * A FILA de atendimento: pedidos em aberto, do mais urgente para o menos.
 *
 * NÃO filtra por ano, ao contrário da lista de pedidos. É deliberado: o pedido de
 * dezembro que ainda não foi atendido continua sendo trabalho em janeiro, e uma
 * fila que esconde o atrasado é pior que fila nenhuma. Em aberto é toda situação
 * menos Concluído, Cancelado e Aguardando produção (ver SITUACOES_EM_ABERTO).
 *
 * Aguardando produção saiu da fila em 2026-07-30: o pedido espera carta que
 * ainda não existe, então quem imprime não tem o que fazer com ele.
 *
 * A ordem é por PRAZO, com o pedido sem prazo no fim: o que tem data marcada
 * decide o dia de quem atende. O `dias_para_prazo` vem calculado no banco, então
 * a tela não precisa fazer conta de data (e não erra por fuso).
 *
 * Traz o endereço e o contato porque a etiqueta de envio sai desta tela: sem eles
 * seria uma segunda requisição por pedido só para imprimir um endereço.
 */
controller.getPedidosEmAberto = async () => {
  return db.conn.any(`
    SELECT p.id, p.localizador_pedido, p.data_pedido, p.prazo,
           (p.prazo - CURRENT_DATE)::int AS dias_para_prazo,
           p.cliente_id, c.nome AS cliente_nome,
           c.tipo_cliente_id, tc.nome AS tipo_cliente_nome,
           p.situacao_pedido_id, sp.nome AS situacao_pedido_nome,
           p.documento_solicitacao, p.documento_solicitacao_nup,
           p.ponto_contato, c.ponto_contato_principal AS cliente_ponto_contato,
           p.endereco_entrega, c.endereco_entrega_principal AS cliente_endereco_entrega,
           p.observacao, p.observacao_interna, p.localizador_envio, p.operacao,
           -- A forma de entrega sai aqui porque a ETIQUETA sai desta tela: quem
           -- monta o pacote precisa saber se vai aos Correios ou sai em maos.
           p.forma_entrega_id, fe.nome AS forma_entrega_nome,
           COALESCE(i.total_itens, 0)::int AS total_itens,
           COALESCE(i.itens_impressos, 0)::int AS itens_impressos,
           COALESCE(i.quantidade_pedida, 0)::int AS quantidade_pedida,
           COALESCE(i.quantidade_impressa, 0)::int AS quantidade_impressa
    FROM mapoteca.pedido AS p
    LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
    LEFT JOIN mapoteca.tipo_cliente AS tc ON tc.code = c.tipo_cliente_id
    LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
    LEFT JOIN mapoteca.forma_entrega AS fe ON fe.code = p.forma_entrega_id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total_itens,
             SUM(pp.quantidade)::int AS quantidade_pedida,
             SUM(LEAST(COALESCE(imp.impressa, 0), pp.quantidade))::int AS quantidade_impressa,
             count(*) FILTER (WHERE COALESCE(imp.impressa, 0) >= pp.quantidade)::int AS itens_impressos
      FROM mapoteca.produto_pedido pp
      LEFT JOIN LATERAL (
        SELECT SUM(ii.quantidade) AS impressa
        FROM mapoteca.impressao_item ii
        WHERE ii.produto_pedido_id = pp.id
      ) imp ON TRUE
      WHERE pp.pedido_id = p.id
    ) i ON TRUE
    WHERE p.situacao_pedido_id IN ($<situacoes:csv>)
    ORDER BY p.prazo ASC NULLS LAST, p.data_pedido ASC, p.id ASC
  `, { situacoes: SITUACOES_EM_ABERTO });
};

/**
 * O que IMPRIMIR de um pedido: um item por linha, com a carta e o que falta.
 *
 * Difere do prepareDownloadImpressao (o caminho do plugin) em duas coisas, e as
 * duas são o motivo de existir: aqui NÃO se cria token de download nem se devolve
 * caminho de volume. Devolve o `uuid_arquivo`, que é com o que o navegador chama
 * GET /acervo/arquivo/:uuid/download. Criar token aqui encheria acervo.download de
 * linhas pendentes que ninguém confirma, e o cron as marcaria como falhas.
 *
 * A escolha do arquivo é a MESMA do plugin (JOIN_ARQUIVO_IMPRIMIVEL): o PDF do
 * produto em si. Item sem PDF vem com uuid_arquivo nulo, e a tela diz por quê em
 * vez de esconder a linha: quem atende precisa saber que aquela carta não tem
 * arquivo para imprimir.
 */
controller.getImpressaoDoPedido = async (pedidoId) => {
  return db.conn.task(async t => {
    const pedido = await t.oneOrNone(
      // A forma de entrega vem do PEDIDO desde 2026-07-30. Ela ficava no item, e
      // saia repetida em cada linha da tela de impressao dizendo sempre a mesma
      // coisa.
      `SELECT p.id, p.localizador_pedido, p.situacao_pedido_id,
              p.forma_entrega_id, fe.nome AS forma_entrega_nome
       FROM mapoteca.pedido p
       LEFT JOIN mapoteca.forma_entrega fe ON fe.code = p.forma_entrega_id
       WHERE p.id = $<pedidoId>`,
      { pedidoId }
    );

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    const itens = await t.any(`
      SELECT pp.id AS produto_pedido_id,
             pp.quantidade,
             COALESCE(imp.quantidade_impressa, 0)::int AS quantidade_impressa,
             GREATEST(pp.quantidade - COALESCE(imp.quantidade_impressa, 0), 0)::int AS quantidade_restante,
             (COALESCE(imp.quantidade_impressa, 0) >= pp.quantidade) AS impressao_concluida,
             pp.tipo_midia_id, tm.nome AS tipo_midia_nome,
             pp.observacao,
             ${PRODUTO_NOME} AS produto_nome, ${PRODUTO_MI} AS mi, prod.inom,
             ${ESCALA_DISPLAY_ITEM} AS escala,
             COALESCE(tp.nome, pp.nome_avulso) AS tipo_produto_nome,
             ${ITEM_E_AVULSO} AS item_avulso,
             pp.descricao_avulso AS avulso_descricao,
             v.versao, v.data_edicao,
             a.uuid_arquivo, a.nome AS arquivo_nome, a.tamanho_mb,
             CASE WHEN a.uuid_arquivo IS NULL THEN NULL
                  WHEN a.extensao IS NULL THEN a.nome_arquivo
                  ELSE a.nome_arquivo || '.' || a.extensao
             END AS arquivo_nome_fisico
      FROM mapoteca.produto_pedido pp
      -- LEFT: esta e a FILA DE TRABALHO de quem imprime. O item avulso (papel
      -- quadriculado, carta de outro CGEO) nao tem PDF no acervo, e sai aqui com
      -- as colunas de arquivo nulas, mas TEM de aparecer: sem ele o operador nao
      -- ve o que imprimir nem consegue registrar a impressao.
      ${JOIN_PRODUTO_ITEM}
      LEFT JOIN mapoteca.tipo_midia tm ON tm.code = pp.tipo_midia_id
      LEFT JOIN LATERAL (
        SELECT SUM(ii.quantidade) AS quantidade_impressa
        FROM mapoteca.impressao_item ii
        WHERE ii.produto_pedido_id = pp.id
      ) imp ON TRUE
      ${JOIN_ARQUIVO_IMPRIMIVEL}
      WHERE pp.pedido_id = $<pedidoId>
      ORDER BY ${PRODUTO_MI} NULLS LAST, pp.id
    `, {
      pedidoId,
      statusCarregado: STATUS_ARQUIVO.CARREGADO,
      tiposImprimiveis: [TIPO_ARQUIVO.ARQUIVO_PRINCIPAL, TIPO_ARQUIVO.FORMATO_ALTERNATIVO]
    });

    return {
      pedido_id: Number(pedido.id),
      localizador_pedido: pedido.localizador_pedido,
      situacao_pedido_id: pedido.situacao_pedido_id,
      forma_entrega_id: pedido.forma_entrega_id,
      forma_entrega_nome: pedido.forma_entrega_nome,
      itens,
      impressao: {
        total_itens: itens.length,
        itens_concluidos: itens.filter(i => i.impressao_concluida).length,
        concluida: itens.length > 0 && itens.every(i => i.impressao_concluida),
        itens_sem_arquivo: itens.filter(i => !i.uuid_arquivo).length
      }
    };
  });
};

/**
 * O arquivo imprimível de um item DESTE pedido, pronto para stream.
 *
 * Existe porque a permissão segue o MÓDULO do trabalho, e não o do dado: quem
 * atende pedido tem operador na MAPOTECA e pode não ter perfil nenhum no acervo.
 * Pela rota do acervo (`/acervo/arquivo/:uuid/download`) ele levava 403 no meio da
 * tela feita para ele (medido em 2026-07-30, quando o operador passou a ver só as
 * duas telas dele).
 *
 * O par (pedido, arquivo) é conferido no banco: o uuid tem de ser o PDF imprimível
 * de um item daquele pedido. Sem isso, esta rota viraria um download de acervo
 * inteiro com perfil de mapoteca, bastando trocar o uuid.
 *
 * @param {number} pedidoId
 * @param {string} uuidArquivo
 */
controller.getArquivoDeImpressao = async (pedidoId, uuidArquivo) => {
  const arquivo = await db.conn.oneOrNone(`
    SELECT a.nome, a.nome_arquivo, a.extensao, a.checksum, a.tamanho_mb, vol.volume
    FROM mapoteca.produto_pedido pp
    -- INNER de proposito: isto e a checagem de que o arquivo pedido pertence a
    -- um item DESTE pedido. Item avulso nao tem arquivo no acervo, entao nunca
    -- casaria de qualquer forma, e o INNER deixa a intencao explicita.
    JOIN acervo.versao v ON v.uuid_versao = pp.uuid_versao
    ${JOIN_ARQUIVO_IMPRIMIVEL}
    WHERE pp.pedido_id = $<pedidoId>
      AND a.uuid_arquivo = $<uuidArquivo>
    LIMIT 1
  `, {
    pedidoId,
    uuidArquivo,
    statusCarregado: STATUS_ARQUIVO.CARREGADO,
    tiposImprimiveis: [TIPO_ARQUIVO.ARQUIVO_PRINCIPAL, TIPO_ARQUIVO.FORMATO_ALTERNATIVO]
  });

  if (!arquivo) {
    throw new AppError(
      'Este arquivo não é a carta de nenhum item deste pedido',
      httpCode.NotFound
    );
  }

  if (!arquivo.volume) {
    throw new AppError(
      `O arquivo "${arquivo.nome}" não tem volume de armazenamento registrado`,
      httpCode.BadRequest
    );
  }

  const nome = arquivo.extensao
    ? `${arquivo.nome_arquivo}.${arquivo.extensao}`
    : arquivo.nome_arquivo;

  return {
    caminho: caminhoNoVolume(arquivo.volume, nome),
    nome,
    checksum: arquivo.checksum,
    tamanho_mb: arquivo.tamanho_mb
  };
};

controller.getPedidoById = async (pedidoId) => {
  return db.conn.task(async t => {
    // Obter informações básicas do pedido
    const pedido = await t.oneOrNone(`
      SELECT p.id, p.data_pedido, p.data_atendimento,
             p.cliente_id, c.nome AS cliente_nome, c.tipo_cliente_id, tc.nome AS tipo_cliente_nome,
             p.situacao_pedido_id, sp.nome AS situacao_pedido_nome,
             -- DOIS contatos, de proposito. p.ponto_contato e o contato DESTE
             -- pedido, que costuma vir no DIEx. c.ponto_contato_principal e o
             -- contato geral da OM, que serve quando o pedido nao traz um.
             -- (Sem crase nestes comentarios: a consulta e um template literal.)
             p.ponto_contato, c.ponto_contato_principal AS cliente_ponto_contato,
             p.documento_solicitacao, p.documento_solicitacao_nup,
             -- Os DOIS enderecos, pela mesma razao dos dois contatos: o do
             -- pedido manda, e o cadastro da OM serve de reserva. A etiqueta de
             -- envio da tela de detalhe cai no segundo quando o pedido nao traz
             -- endereco nenhum.
             p.endereco_entrega, c.endereco_entrega_principal AS cliente_endereco_entrega,
             -- Do PEDIDO desde 2026-07-30, e nao mais de cada item.
             p.forma_entrega_id, fe.nome AS forma_entrega_nome,
             p.palavras_chave, p.operacao, p.prazo,
             p.demandante, p.omds, p.previsto_pit,
             p.meta_pit_id, ${ROTULO_META} AS meta_pit_codigo,
             mp.descricao AS meta_pit_descricao,
             p.canal_recebimento_id, cr.nome AS canal_recebimento_nome,
             p.municipio, p.qtd_imagens,
             p.observacao, p.localizador_envio, p.observacao_envio,
             p.observacao_interna, p.motivo_cancelamento,
             p.localizador_pedido,
             p.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
             p.usuario_atualizacao_id, ua.nome AS usuario_atualizacao_nome,
             p.data_criacao, p.data_atualizacao
      FROM mapoteca.pedido AS p
      LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
      LEFT JOIN mapoteca.tipo_cliente AS tc ON tc.code = c.tipo_cliente_id
      LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
      LEFT JOIN mapoteca.canal_recebimento AS cr ON cr.code = p.canal_recebimento_id
      LEFT JOIN mapoteca.forma_entrega AS fe ON fe.code = p.forma_entrega_id
      LEFT JOIN dgeo.usuario AS uc ON uc.id = p.usuario_criacao_id
      LEFT JOIN dgeo.usuario AS ua ON ua.id = p.usuario_atualizacao_id
      LEFT JOIN pit.meta AS mp ON mp.id = p.meta_pit_id
      WHERE p.id = $1
    `, [pedidoId]);

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    const produtos = await t.any(`
      -- pedido_id vai junto porque o PUT /mapoteca/produto_pedido o exige:
      -- sem ele, o item que esta leitura devolve não serve de corpo de escrita
      SELECT pp.id, pp.pedido_id, pp.uuid_versao, pp.quantidade, pp.quantidade_fornecida,
             pp.tipo_midia_id, tm.nome AS tipo_midia_nome,
             pp.tipo_midia_fornecida_id, tmf.nome AS tipo_midia_fornecida_nome,
             pp.observacao, pp.producao_especifica,
             pp.nome_avulso, pp.descricao_avulso,
             (pp.nome_avulso IS NOT NULL) AS item_avulso,
             v.versao, v.data_edicao, v.produto_id,
             -- COALESCE, e nao p.nome: o item avulso nao tem linha em
             -- acervo.produto, e sem isto a tela do pedido mostra a quantidade
             -- ao lado de um nome em branco.
             COALESCE(p.nome, pp.nome_avulso) AS produto_nome,
             p.mi, p.inom, te.nome AS escala, p.denominador_escala_especial,
             p.tipo_produto_id, tp.nome AS tipo_produto_nome,
             COALESCE(imp.quantidade_impressa, 0)::int AS quantidade_impressa,
             GREATEST(pp.quantidade - COALESCE(imp.quantidade_impressa, 0), 0)::int AS quantidade_restante,
             (COALESCE(imp.quantidade_impressa, 0) >= pp.quantidade) AS impressao_concluida,
             pp.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
             pp.data_criacao, pp.usuario_atualizacao_id,
             ua.nome AS usuario_atualizacao_nome, pp.data_atualizacao
      FROM mapoteca.produto_pedido AS pp
      LEFT JOIN mapoteca.tipo_midia AS tm ON tm.code = pp.tipo_midia_id
      LEFT JOIN mapoteca.tipo_midia AS tmf ON tmf.code = pp.tipo_midia_fornecida_id
      LEFT JOIN acervo.versao AS v ON v.uuid_versao = pp.uuid_versao
      LEFT JOIN acervo.produto AS p ON p.id = v.produto_id
      LEFT JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      LEFT JOIN dominio.tipo_produto AS tp ON tp.code = p.tipo_produto_id
      LEFT JOIN LATERAL (
        SELECT SUM(ii.quantidade) AS quantidade_impressa
        FROM mapoteca.impressao_item ii
        WHERE ii.produto_pedido_id = pp.id
      ) imp ON TRUE
      LEFT JOIN dgeo.usuario AS uc ON uc.id = pp.usuario_criacao_id
      LEFT JOIN dgeo.usuario AS ua ON ua.id = pp.usuario_atualizacao_id
      WHERE pp.pedido_id = $1
      ORDER BY pp.data_criacao
    `, [pedidoId]);

    // Combinar os resultados
    pedido.produtos = produtos;
    pedido.impressao = {
      total_itens: produtos.length,
      itens_concluidos: produtos.filter(p => p.impressao_concluida).length,
      concluida: produtos.length > 0 && produtos.every(p => p.impressao_concluida)
    };

    return pedido;
  });
};

controller.criaPedido = async (pedido, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // Checagem amigável da FK de cliente (evita 500 cru do Postgres)
    const clienteExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.cliente WHERE id = $1`,
      [pedido.cliente_id]
    );

    if (!clienteExiste) {
      throw new AppError('Cliente não encontrado', httpCode.NotFound);
    }

    // Gerar localizador único
    let localizador;
    let isUnique = false;
    
    while (!isUnique) {
      localizador = generateLocalizador();
      
      // Verificar se o localizador já existe
      const exists = await t.oneOrNone(
        `SELECT localizador_pedido FROM mapoteca.pedido WHERE localizador_pedido = $1`,
        [localizador]
      );
      
      isUnique = !exists;
    }
    
    pedido.localizador_pedido = localizador;
    pedido.usuario_criacao_id = usuarioId;
    pedido.usuario_atualizacao_id = usuarioId;

    const cs = new db.pgp.helpers.ColumnSet([
      ...PEDIDO_COLS,
      'localizador_pedido',
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    // RETURNING * (e nao so id/localizador) porque a linha inteira e o
    // dados_depois da auditoria. A rota continua recebendo so os dois campos de
    // sempre: quem monta a resposta e o objeto devolvido abaixo.
    const query = db.pgp.helpers.insert(pedido, cs, {
      table: 'pedido',
      schema: 'mapoteca'
    }) + ' RETURNING *';

    const criado = await t.one(query);

    await auditoriaCtrl.registrar(t, {
      pedidoId: criado.id,
      tabela: 'pedido',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid
    });

    return { id: criado.id, localizador_pedido: criado.localizador_pedido };
  });
};

controller.atualizaPedido = async (pedido, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // Verificar se o pedido existe e obter seu localizador atual.
    // SELECT * porque esta MESMA leitura vira o dados_antes da auditoria: ler as
    // colunas de novo depois do UPDATE traria a linha ja alterada.
    const pedidoAtual = await t.oneOrNone(
      `SELECT * FROM mapoteca.pedido WHERE id = $1`,
      [pedido.id]
    );

    if (!pedidoAtual) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }
    
    // Não permitir modificar o localizador_pedido
    delete pedido.localizador_pedido;

    // Chave ausente = "não mexe". Antes, quem editava um pedido a partir da
    // LISTA (que não devolve palavras_chave) zerava as palavras-chave e
    // desmarcava previsto_pit sem erro nenhum.
    await preserveOmitted(t, {
      schema: 'mapoteca',
      table: 'pedido',
      id: pedido.id,
      fields: ['palavras_chave', 'previsto_pit', 'meta_pit_id'],
      body: pedido
    });

    // A condicional "PIT exige meta" mora no Joi só na CRIAÇÃO: na atualização
    // o corpo pode omitir meta_pit_id de propósito, e quem resolve o valor final é
    // o preserveOmitted acima. Por isso a regra se confere aqui, depois da
    // mescla, e devolve 400 em vez de deixar o CHECK do banco virar 500.
    if (pedido.previsto_pit && !pedido.meta_pit_id) {
      throw new AppError(
        'Pedido previsto no PIT exige a meta do PIT (meta_pit_id).',
        httpCode.BadRequest
      );
    }

    pedido.usuario_atualizacao_id = usuarioId;
    pedido.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      ...PEDIDO_COLS,
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: { table: 'pedido', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(pedido, cs) + ' WHERE id = $1';

    await t.none(query, [pedido.id]);

    // A linha depois do UPDATE sai do banco, e nao do corpo da requisicao: o
    // corpo traz o que o cliente PEDIU, e o que interessa auditar e o que o
    // banco GRAVOU. Os dois lados do diff saem da mesma fonte.
    const pedidoNovo = await t.one(
      `SELECT * FROM mapoteca.pedido WHERE id = $1`,
      [pedido.id]
    );

    await auditoriaCtrl.registrar(t, {
      pedidoId: pedido.id,
      tabela: 'pedido',
      registroId: pedido.id,
      operacao: 'U',
      antes: pedidoAtual,
      depois: pedidoNovo,
      usuarioUuid
    });
  });
};

controller.getPedidoByLocalizador = async (localizador) => {
  return db.conn.task(async t => {
    // Rota PUBLICA (sem autenticacao). A lista de colunas e explicita, e nunca
    // vira SELECT *, porque e ela que decide o que o cliente ve. p.observacao e
    // p.observacao_envio SAEM de proposito; p.observacao_interna NAO sai, e e
    // justamente para isso que aquela coluna existe. Coberto por teste de rota.
    //
    // p.data_atendimento entra desde 2026-07-29: e o dia em que o material
    // saiu, e a tela a mostra como "data de envio/entrega". Nao existe coluna
    // de data de envio (ver a migracao 2026-07-29_pedido_observacao_interna).
    const pedido = await t.oneOrNone(`
      SELECT
        p.id,
        p.localizador_pedido,
        p.data_pedido,
        p.situacao_pedido_id,
        sp.nome AS situacao_pedido_nome,
        c.nome AS cliente_nome,
        p.prazo,
        p.observacao,
        p.data_atendimento,
        p.localizador_envio,
        p.observacao_envio,
        -- A forma de entrega e do pedido desde 2026-07-30, e sai aqui pelo nome.
        -- O cliente ja a via, uma vez por item; agora a ve uma vez so.
        fe.nome AS forma_entrega_nome,
        p.motivo_cancelamento
      FROM mapoteca.pedido AS p
      LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
      LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
      LEFT JOIN mapoteca.forma_entrega AS fe ON fe.code = p.forma_entrega_id
      WHERE p.localizador_pedido = $1
    `, [localizador]);

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    // Itens do pedido — apenas campos seguros para consulta pública
    // (o que foi pedido + observação do item; sem dados internos/usuários).
    //
    // O item AVULSO (papel quadriculado, carta de outro CGEO) sai aqui como
    // qualquer outro, por decisão do chefe de 2026-07-30. Os LEFT JOIN já o
    // traziam, mas com todas as colunas de identificação nulas: o cliente veria
    // uma linha em branco com uma quantidade ao lado. Os COALESCE abaixo é que
    // dão nome a ele.
    //
    // descricao_avulso É PÚBLICA: ela guarda a descrição física do impresso ("80
    // x 68 cm, quadrícula de 4 x 4 cm"), que é justamente o que o cliente precisa
    // ler. Anotação interna sobre um avulso não vai aqui.
    const produtos = await t.any(`
      SELECT
        pp.quantidade,
        tm.nome AS tipo_midia_nome,
        pp.observacao,
        v.versao,
        v.data_edicao,
        ${PRODUTO_NOME} AS produto_nome,
        ${PRODUTO_MI} AS mi,
        prod.inom,
        ${ESCALA_DISPLAY_ITEM} AS escala,
        COALESCE(tp.nome, pp.nome_avulso) AS tipo_produto_nome,
        ${ITEM_E_AVULSO} AS item_avulso,
        pp.descricao_avulso AS avulso_descricao
      FROM mapoteca.produto_pedido AS pp
      LEFT JOIN mapoteca.tipo_midia AS tm ON tm.code = pp.tipo_midia_id
      ${JOIN_PRODUTO_ITEM}
      WHERE pp.pedido_id = $1
      ORDER BY pp.data_criacao
    `, [pedido.id]);

    delete pedido.id;
    pedido.produtos = produtos;

    return pedido;
  });
};

controller.deletePedidos = async (pedidoIds, usuarioUuid) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs de pedido existem.
    // SELECT * e nao SELECT id: a linha inteira vira o dados_antes da auditoria,
    // e depois do DELETE nao ha mais de onde tira-la. Sem isso a exclusao nao
    // registra o que se perdeu, que e o caso principal desta auditoria.
    const existingOrders = await t.any(
      `SELECT * FROM mapoteca.pedido WHERE id IN ($1:csv)`,
      [pedidoIds]
    );

    if (existingOrders.length !== pedidoIds.length) {
      const existingIds = existingOrders.map(o => Number(o.id));
      const missingIds = pedidoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes pedidos não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Os filhos tambem se registram, um a um. O dados_antes do PEDIDO nao
    // contem os itens dele, entao sem estas linhas o historico diria que o
    // pedido sumiu sem dizer o que ele levava.
    const itens = await t.any(
      `SELECT * FROM mapoteca.produto_pedido WHERE pedido_id IN ($1:csv)`,
      [pedidoIds]
    );

    // As impressoes caem por ON DELETE CASCADE do produto_pedido, sem passar por
    // DELETE nenhum deste arquivo. Por isso se leem AGORA, enquanto existem.
    const impressoes = itens.length === 0
      ? []
      : await t.any(
        `SELECT ii.*, pp.pedido_id
           FROM mapoteca.impressao_item ii
           JOIN mapoteca.produto_pedido pp ON pp.id = ii.produto_pedido_id
          WHERE pp.pedido_id IN ($1:csv)`,
        [pedidoIds]
      );

    for (const impressao of impressoes) {
      const { pedido_id: pedidoId, ...linha } = impressao;
      await auditoriaCtrl.registrar(t, {
        pedidoId,
        tabela: 'impressao_item',
        registroId: linha.id,
        operacao: 'D',
        antes: linha,
        usuarioUuid
      });
    }

    for (const item of itens) {
      await auditoriaCtrl.registrar(t, {
        pedidoId: item.pedido_id,
        tabela: 'produto_pedido',
        registroId: item.id,
        operacao: 'D',
        antes: item,
        usuarioUuid
      });
    }

    for (const pedido of existingOrders) {
      await auditoriaCtrl.registrar(t, {
        pedidoId: pedido.id,
        tabela: 'pedido',
        registroId: pedido.id,
        operacao: 'D',
        antes: pedido,
        usuarioUuid
      });
    }

    // Primeiro, excluir os produtos do pedido associados
    await t.none(
      `DELETE FROM mapoteca.produto_pedido WHERE pedido_id IN ($1:csv)`,
      [pedidoIds]
    );

    // Em seguida, excluir os pedidos
    return t.any(
      `DELETE FROM mapoteca.pedido WHERE id IN ($1:csv)`,
      [pedidoIds]
    );
  });
};

// Funções para Produto do Pedido
controller.criaProdutoPedido = async (produtoPedido, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // O destino é um dos dois, e o Joi (.xor) já garantiu que veio exatamente
    // um. Aqui só se confere que o que veio EXISTE, cada um na sua tabela.
    if (produtoPedido.uuid_versao) {
      const versaoExiste = await t.oneOrNone(
        `SELECT uuid_versao FROM acervo.versao WHERE uuid_versao = $1`,
        [produtoPedido.uuid_versao]
      );
      if (!versaoExiste) {
        throw new AppError('Versão não encontrada', httpCode.NotFound);
      }
    }
    // O item avulso nao tem nada a conferir contra outra tabela: ele se descreve
    // no proprio item, e o Joi (.xor) mais o CHECK do banco ja garantem que veio
    // exatamente um destino.

    // Verificar se o pedido existe
    const pedidoExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.pedido WHERE id = $1`,
      [produtoPedido.pedido_id]
    );

    if (!pedidoExiste) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    produtoPedido.usuario_criacao_id = usuarioId;
    produtoPedido.usuario_atualizacao_id = usuarioId;

    const cs = new db.pgp.helpers.ColumnSet([
      ...PRODUTO_PEDIDO_COLS,
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    // RETURNING * pela auditoria: a linha gravada e o dados_depois, e o id dela
    // e o registro_id. A rota nao devolve corpo, entao nada muda para o cliente.
    const query = db.pgp.helpers.insert(produtoPedido, cs, {
      table: 'produto_pedido',
      schema: 'mapoteca'
    }) + ' RETURNING *';

    const criado = await t.one(query);

    await auditoriaCtrl.registrar(t, {
      pedidoId: criado.pedido_id,
      tabela: 'produto_pedido',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid
    });
  });
};

controller.atualizaProdutoPedido = async (produtoPedido, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // Linha antes da mudanca, para a auditoria. Vale tambem como fonte do
    // pedido_id: o corpo da requisicao traz pedido_id, mas quem manda e o banco.
    const itemAtual = await t.oneOrNone(
      `SELECT * FROM mapoteca.produto_pedido WHERE id = $1`,
      [produtoPedido.id]
    );

    // Chave ausente = "não mexe": omitir producao_especifica desmarcava a flag
    await preserveOmitted(t, {
      schema: 'mapoteca',
      table: 'produto_pedido',
      id: produtoPedido.id,
      fields: ['producao_especifica'],
      body: produtoPedido
    });

    produtoPedido.usuario_atualizacao_id = usuarioId;
    produtoPedido.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      ...PRODUTO_PEDIDO_COLS,
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: { table: 'produto_pedido', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(produtoPedido, cs) + ' WHERE id = $1';

    const result = await t.result(query, [produtoPedido.id]);

    if (result.rowCount === 0) {
      throw new AppError('Produto do pedido não encontrado', httpCode.NotFound);
    }

    const itemNovo = await t.one(
      `SELECT * FROM mapoteca.produto_pedido WHERE id = $1`,
      [produtoPedido.id]
    );

    await auditoriaCtrl.registrar(t, {
      pedidoId: itemNovo.pedido_id,
      tabela: 'produto_pedido',
      registroId: itemNovo.id,
      operacao: 'U',
      antes: itemAtual,
      depois: itemNovo,
      usuarioUuid
    });
  });
};

controller.deleteProdutosPedido = async (produtoPedidoIds, usuarioUuid) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs existem.
    // SELECT * e nao SELECT id: a linha inteira vira o dados_antes da auditoria,
    // e depois do DELETE nao ha mais de onde tira-la.
    const existingProducts = await t.any(
      `SELECT * FROM mapoteca.produto_pedido WHERE id IN ($1:csv)`,
      [produtoPedidoIds]
    );

    if (existingProducts.length !== produtoPedidoIds.length) {
      const existingIds = existingProducts.map(p => Number(p.id));
      const missingIds = produtoPedidoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes produtos de pedido não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // As impressoes do item caem por ON DELETE CASCADE, sem DELETE explicito
    // nenhum. Leem-se agora, enquanto ainda existem.
    const impressoes = await t.any(
      `SELECT ii.*, pp.pedido_id
         FROM mapoteca.impressao_item ii
         JOIN mapoteca.produto_pedido pp ON pp.id = ii.produto_pedido_id
        WHERE ii.produto_pedido_id IN ($1:csv)`,
      [produtoPedidoIds]
    );

    for (const impressao of impressoes) {
      const { pedido_id: pedidoId, ...linha } = impressao;
      await auditoriaCtrl.registrar(t, {
        pedidoId,
        tabela: 'impressao_item',
        registroId: linha.id,
        operacao: 'D',
        antes: linha,
        usuarioUuid
      });
    }

    for (const item of existingProducts) {
      await auditoriaCtrl.registrar(t, {
        pedidoId: item.pedido_id,
        tabela: 'produto_pedido',
        registroId: item.id,
        operacao: 'D',
        antes: item,
        usuarioUuid
      });
    }

    return t.any(
      `DELETE FROM mapoteca.produto_pedido WHERE id IN ($1:csv)`,
      [produtoPedidoIds]
    );
  });
};

// Funções para Impressão de Pedidos (plugin QGIS da mapoteca)

/**
 * Prepara o download dos PDFs das cartas de um pedido para impressão.
 * Para cada item retorna o arquivo PDF da versão no acervo (com token de
 * download em acervo.download, confirmado depois via /api/acervo/confirm-download)
 * e os quantitativos: pedido, já impresso e restante.
 * Itens cuja versão não possui PDF carregado são listados em itens_sem_pdf.
 */
controller.prepareDownloadImpressao = async (pedidoId, usuarioUuid) => {
  return db.conn.tx(async t => {
    const pedido = await t.oneOrNone(
      `SELECT id, localizador_pedido FROM mapoteca.pedido WHERE id = $<pedidoId>`,
      { pedidoId }
    );

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    const itens = await t.any(
      `
      SELECT pp.id AS produto_pedido_id,
             pp.quantidade,
             COALESCE(imp.quantidade_impressa, 0)::int AS quantidade_impressa,
             GREATEST(pp.quantidade - COALESCE(imp.quantidade_impressa, 0), 0)::int AS quantidade_restante,
             tm.nome AS tipo_midia_nome,
             ${PRODUTO_NOME} AS produto_nome,
             ${PRODUTO_MI} AS mi,
             ${ESCALA_DISPLAY_ITEM} AS escala,
             v.versao,
             a.id AS arquivo_id,
             a.nome,
             a.checksum,
             a.tamanho_mb,
             CONCAT(vol.volume, '/', a.nome_arquivo, '.', a.extensao) AS download_path
      FROM mapoteca.produto_pedido pp
      -- LEFT: o resultado alimenta DUAS listas, os arquivos a baixar e o
      -- itensSemPdf. O item avulso nao tem PDF e cai na segunda, que e
      -- justamente o aviso de "isto aqui nao vem por download". Com INNER ele
      -- sumia das duas, e quem imprime nunca saberia que existe.
      ${JOIN_PRODUTO_ITEM}
      JOIN mapoteca.tipo_midia tm ON tm.code = pp.tipo_midia_id
      LEFT JOIN LATERAL (
        SELECT SUM(ii.quantidade) AS quantidade_impressa
        FROM mapoteca.impressao_item ii
        WHERE ii.produto_pedido_id = pp.id
      ) imp ON TRUE
      ${JOIN_ARQUIVO_IMPRIMIVEL}
      WHERE pp.pedido_id = $<pedidoId>
      ORDER BY pp.id, a.id
      `,
      {
        pedidoId,
        statusCarregado: STATUS_ARQUIVO.CARREGADO,
        // Só o produto cartográfico em si (evita PDFs de metadados/documentos)
        tiposImprimiveis: [TIPO_ARQUIVO.ARQUIVO_PRINCIPAL, TIPO_ARQUIVO.FORMATO_ALTERNATIVO]
      }
    );

    const arquivos = itens.filter(i => i.arquivo_id);
    const itensSemPdf = itens
      .filter(i => !i.arquivo_id)
      .map(i => ({
        produto_pedido_id: i.produto_pedido_id,
        produto_nome: i.produto_nome,
        mi: i.mi,
        escala: i.escala,
        quantidade: i.quantidade,
        quantidade_restante: i.quantidade_restante
      }));

    if (arquivos.length > 0) {
      // expiration_time: tokens pendentes expiram e são limpos pelo cron (como no acervo)
      const cs = new db.pgp.helpers.ColumnSet([
        'arquivo_id',
        'usuario_uuid',
        { name: 'expiration_time', mod: ':raw', init: () => "NOW() + INTERVAL '24 hours'" }
      ]);
      const downloads = arquivos.map(a => ({
        arquivo_id: a.arquivo_id,
        usuario_uuid: usuarioUuid
      }));

      const query = db.pgp.helpers.insert(downloads, cs, {
        table: 'download',
        schema: 'acervo'
      }) + ' RETURNING download_token';

      // INSERT ... RETURNING preserva a ordem dos VALUES
      const tokens = await t.any(query);
      arquivos.forEach((a, idx) => {
        a.download_token = tokens[idx].download_token;
      });
    }

    return {
      pedido_id: pedido.id,
      localizador_pedido: pedido.localizador_pedido,
      arquivos,
      itens_sem_pdf: itensSemPdf
    };
  });
};

/**
 * Registra sessões de impressão (uma por item, com a quantidade impressa).
 * Qualquer usuário logado pode registrar — é log operacional, não gestão de
 * catálogo. O total impresso por item é a soma dos registros.
 */
controller.registrarImpressao = async (registros, usuarioUuid) => {
  return db.conn.tx(async t => {
    const ids = [...new Set(registros.map(r => r.produto_pedido_id))];

    // pedido_id vem junto porque a auditoria e POR PEDIDO: o registro nasce no
    // item, mas quem le o historico procura pelo pedido dono dele.
    const existentes = await t.any(
      `SELECT id, pedido_id FROM mapoteca.produto_pedido WHERE id IN ($<ids:csv>)`,
      { ids }
    );

    if (existentes.length !== ids.length) {
      const encontrados = existentes.map(e => Number(e.id));
      const faltantes = ids.filter(id => !encontrados.includes(id));
      throw new AppError(
        `Os seguintes itens de pedido não foram encontrados: ${faltantes.join(', ')}`,
        httpCode.NotFound
      );
    }

    const pedidoDoItem = new Map(
      existentes.map(e => [Number(e.id), e.pedido_id])
    );

    const cs = new db.pgp.helpers.ColumnSet([
      'produto_pedido_id', 'quantidade',
      { name: 'observacao', def: null },
      'usuario_uuid'
    ]);

    const query = db.pgp.helpers.insert(
      registros.map(r => ({ ...r, usuario_uuid: usuarioUuid })),
      cs,
      { table: 'impressao_item', schema: 'mapoteca' }
    ) + ' RETURNING *';

    const inseridos = await t.any(query);

    for (const registro of inseridos) {
      await auditoriaCtrl.registrar(t, {
        pedidoId: pedidoDoItem.get(Number(registro.produto_pedido_id)),
        tabela: 'impressao_item',
        registroId: registro.id,
        operacao: 'I',
        depois: registro,
        usuarioUuid
      });
    }
  });
};

// Histórico de impressão de um item de pedido, com resumo dos quantitativos
controller.getImpressoesItem = async (produtoPedidoId) => {
  return db.conn.task(async t => {
    const item = await t.oneOrNone(
      `SELECT pp.id, pp.quantidade
       FROM mapoteca.produto_pedido pp
       WHERE pp.id = $<produtoPedidoId>`,
      { produtoPedidoId }
    );

    if (!item) {
      throw new AppError('Item de pedido não encontrado', httpCode.NotFound);
    }

    const registros = await t.any(
      `SELECT ii.id, ii.quantidade, ii.observacao, ii.data_impressao,
              u.nome AS usuario_nome, u.nome_guerra AS usuario_nome_guerra
       FROM mapoteca.impressao_item ii
       JOIN dgeo.usuario u ON u.uuid = ii.usuario_uuid
       WHERE ii.produto_pedido_id = $<produtoPedidoId>
       ORDER BY ii.data_impressao DESC`,
      { produtoPedidoId }
    );

    const quantidadeImpressa = registros.reduce((sum, r) => sum + r.quantidade, 0);

    return {
      produto_pedido_id: item.id,
      quantidade: item.quantidade,
      quantidade_impressa: quantidadeImpressa,
      quantidade_restante: Math.max(item.quantidade - quantidadeImpressa, 0),
      impressao_concluida: quantidadeImpressa >= item.quantidade,
      registros
    };
  });
};

// Remove registros de impressão (correções — somente admin)
controller.deleteImpressoes = async (impressaoIds, usuarioUuid) => {
  return db.conn.tx(async t => {
    // A linha inteira, mais o pedido dono: e o dados_antes da auditoria, e
    // depois do DELETE nao ha mais de onde tira-la.
    const existentes = await t.any(
      `SELECT ii.*, pp.pedido_id
         FROM mapoteca.impressao_item ii
         JOIN mapoteca.produto_pedido pp ON pp.id = ii.produto_pedido_id
        WHERE ii.id IN ($<impressaoIds:csv>)`,
      { impressaoIds }
    );

    if (existentes.length !== impressaoIds.length) {
      const encontrados = existentes.map(e => Number(e.id));
      const faltantes = impressaoIds.filter(id => !encontrados.includes(parseInt(id)));
      throw new AppError(
        `Os seguintes registros de impressão não foram encontrados: ${faltantes.join(', ')}`,
        httpCode.NotFound
      );
    }

    for (const impressao of existentes) {
      const { pedido_id: pedidoId, ...linha } = impressao;
      await auditoriaCtrl.registrar(t, {
        pedidoId,
        tabela: 'impressao_item',
        registroId: linha.id,
        operacao: 'D',
        antes: linha,
        usuarioUuid
      });
    }

    return t.any(
      `DELETE FROM mapoteca.impressao_item WHERE id IN ($<impressaoIds:csv>)`,
      { impressaoIds }
    );
  });
};

// Funções para Plotter
controller.getPlotters = async () => {
  return db.conn.any(`
    WITH ultima_manutencao AS (
      SELECT 
        plotter_id,
        MAX(data_manutencao) AS data_ultima_manutencao
      FROM mapoteca.manutencao_plotter
      GROUP BY plotter_id
    )
    SELECT 
      p.id, p.ativo, p.nr_serie, p.modelo, 
      p.data_aquisicao, p.vida_util,
      um.data_ultima_manutencao,
      (SELECT COUNT(*) FROM mapoteca.manutencao_plotter WHERE plotter_id = p.id) AS quantidade_manutencoes
    FROM mapoteca.plotter AS p
    LEFT JOIN ultima_manutencao um ON um.plotter_id = p.id
    ORDER BY p.modelo, p.nr_serie
  `);
};

controller.getPlotterById = async (plotterId) => {
  return db.conn.task(async t => {
    // Buscar informações básicas do plotter
    const plotter = await t.oneOrNone(`
      SELECT 
        p.id, p.ativo, p.nr_serie, p.modelo, 
        p.data_aquisicao, p.vida_util
      FROM mapoteca.plotter AS p
      WHERE p.id = $1
    `, [plotterId]);

    if (!plotter) {
      throw new AppError('Plotter não encontrado', httpCode.NotFound);
    }

    // Buscar manutenções do plotter
    const manutencoes = await t.any(`
      SELECT 
        -- plotter_id é exigido pelo PUT /mapoteca/manutencao_plotter
        mp.id, mp.plotter_id, mp.data_manutencao, mp.valor, mp.descricao,
        mp.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
        mp.data_criacao, mp.usuario_atualizacao_id, 
        ua.nome AS usuario_atualizacao_nome, mp.data_atualizacao
      FROM mapoteca.manutencao_plotter AS mp
      LEFT JOIN dgeo.usuario AS uc ON uc.id = mp.usuario_criacao_id
      LEFT JOIN dgeo.usuario AS ua ON ua.id = mp.usuario_atualizacao_id
      WHERE mp.plotter_id = $1
      ORDER BY mp.data_manutencao DESC
    `, [plotterId]);

    // Buscar estatísticas de manutenção
    const estatisticasManutencao = await t.oneOrNone(`
      SELECT 
        COUNT(*) AS total_manutencoes,
        MAX(data_manutencao) AS data_ultima_manutencao,
        SUM(valor) AS valor_total_manutencoes,
        AVG(valor) AS valor_medio_manutencoes
      FROM mapoteca.manutencao_plotter
      WHERE plotter_id = $1
    `, [plotterId]);

    // Calcular tempo médio entre manutenções, se houver mais de uma
    let tempoMedioEntreManutencoesEmDias = null;
    if (parseInt(estatisticasManutencao?.total_manutencoes || 0) > 1) {
      const tempoEntreManutencoes = await t.oneOrNone(`
        WITH manutencoes_ordenadas AS (
          SELECT 
            data_manutencao,
            LAG(data_manutencao) OVER (ORDER BY data_manutencao) AS manutencao_anterior
          FROM mapoteca.manutencao_plotter
          WHERE plotter_id = $1
          ORDER BY data_manutencao
        )
        SELECT AVG(data_manutencao - manutencao_anterior) AS media_dias
        FROM manutencoes_ordenadas
        WHERE manutencao_anterior IS NOT NULL
      `, [plotterId]);
      
      tempoMedioEntreManutencoesEmDias = tempoEntreManutencoes?.media_dias;
    }

    // Combinar resultados
    return {
      ...plotter,
      estatisticas: {
        total_manutencoes: parseInt(estatisticasManutencao?.total_manutencoes || 0),
        data_ultima_manutencao: estatisticasManutencao?.data_ultima_manutencao,
        valor_total_manutencoes: parseFloat(estatisticasManutencao?.valor_total_manutencoes || 0),
        valor_medio_manutencoes: parseFloat(estatisticasManutencao?.valor_medio_manutencoes || 0),
        tempo_medio_entre_manutencoes_dias: tempoMedioEntreManutencoesEmDias ? parseFloat(tempoMedioEntreManutencoesEmDias) : null
      },
      manutencoes: manutencoes
    };
  });
};

controller.criaPlotter = async (plotter, usuarioUuid) => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'ativo', 'nr_serie', 'modelo',
      { name: 'data_aquisicao', def: null },
      { name: 'vida_util', def: null }
    ]);

    const query = db.pgp.helpers.insert(plotter, cs, {
      table: 'plotter',
      schema: 'mapoteca'
    });

    await t.none(query);
  });
};

controller.atualizaPlotter = async (plotter, usuarioUuid) => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'ativo', 'nr_serie', 'modelo',
      { name: 'data_aquisicao', def: null },
      { name: 'vida_util', def: null }
    ], { table: { table: 'plotter', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(plotter, cs) + ' WHERE id = $1';

    const result = await t.result(query, [plotter.id]);

    if (result.rowCount === 0) {
      throw new AppError('Plotter não encontrado', httpCode.NotFound);
    }
  });
};

controller.deletePlotters = async (plotterIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs de plotter existem
    const existingPlotters = await t.any(
      `SELECT id FROM mapoteca.plotter WHERE id IN ($1:csv)`,
      [plotterIds]
    );

    if (existingPlotters.length !== plotterIds.length) {
      const existingIds = existingPlotters.map(p => p.id);
      const missingIds = plotterIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes plotters não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Verificar se há manutenções associadas aos plotters
    const associatedMaintenance = await t.any(
      `SELECT plotter_id, COUNT(*) as count FROM mapoteca.manutencao_plotter 
       WHERE plotter_id IN ($1:csv)
       GROUP BY plotter_id`,
      [plotterIds]
    );

    if (associatedMaintenance.length > 0) {
      const plottersWithMaintenance = associatedMaintenance.map(m => m.plotter_id);
      throw new AppError(
        `Não é possível excluir os plotters com IDs: ${plottersWithMaintenance.join(', ')} pois possuem manutenções associadas`,
        httpCode.BadRequest
      );
    }

    // Se não houver manutenções associadas, deletar os plotters
    return t.any(
      `DELETE FROM mapoteca.plotter WHERE id IN ($1:csv)`,
      [plotterIds]
    );
  });
};

// Funções para Manutenção de Plotter
controller.getManutencoesPlotter = async () => {
  return db.conn.any(`
    SELECT mp.id, mp.plotter_id, p.nr_serie, p.modelo,
           mp.data_manutencao, mp.valor, mp.descricao,
           mp.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
           mp.data_criacao, mp.usuario_atualizacao_id, 
           ua.nome AS usuario_atualizacao_nome, mp.data_atualizacao
    FROM mapoteca.manutencao_plotter AS mp
    LEFT JOIN mapoteca.plotter AS p ON p.id = mp.plotter_id
    LEFT JOIN dgeo.usuario AS uc ON uc.id = mp.usuario_criacao_id
    LEFT JOIN dgeo.usuario AS ua ON ua.id = mp.usuario_atualizacao_id
    ORDER BY mp.data_manutencao DESC
  `);
};

controller.criaManutencaoPlotter = async (manutencao, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // Verificar se o plotter existe
    const plotterExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.plotter WHERE id = $1`,
      [manutencao.plotter_id]
    );

    if (!plotterExiste) {
      throw new AppError('Plotter não encontrado', httpCode.NotFound);
    }

    manutencao.usuario_criacao_id = usuarioId;
    manutencao.usuario_atualizacao_id = usuarioId;

    const cs = new db.pgp.helpers.ColumnSet([
      'plotter_id', 'data_manutencao', 'valor',
      { name: 'descricao', def: null },
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    const query = db.pgp.helpers.insert(manutencao, cs, {
      table: 'manutencao_plotter',
      schema: 'mapoteca'
    });

    await t.none(query);
  });
};

controller.atualizaManutencaoPlotter = async (manutencao, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    manutencao.usuario_atualizacao_id = usuarioId;
    manutencao.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'plotter_id', 'data_manutencao', 'valor',
      { name: 'descricao', def: null },
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: { table: 'manutencao_plotter', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(manutencao, cs) + ' WHERE id = $1';

    const result = await t.result(query, [manutencao.id]);

    if (result.rowCount === 0) {
      throw new AppError('Manutenção de plotter não encontrada', httpCode.NotFound);
    }
  });
};

controller.deleteManutencoesPlotter = async (manutencaoIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs existem
    const existingMaintenance = await t.any(
      `SELECT id FROM mapoteca.manutencao_plotter WHERE id IN ($1:csv)`,
      [manutencaoIds]
    );

    if (existingMaintenance.length !== manutencaoIds.length) {
      const existingIds = existingMaintenance.map(m => m.id);
      const missingIds = manutencaoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`As seguintes manutenções não foram encontradas: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    return t.any(
      `DELETE FROM mapoteca.manutencao_plotter WHERE id IN ($1:csv)`,
      [manutencaoIds]
    );
  });
};

// Funções para Tipo de Material
controller.getTiposMaterial = async () => {
  return db.conn.any(`
    SELECT tm.id, tm.nome, tm.descricao,
           tm.categoria_id, cm.nome AS categoria,
           tm.estoque_minimo, tm.meta_anual, tm.ativo,
           COALESCE(est.estoque_total, 0) AS estoque_total,
           COALESCE(est.localizacoes_armazenadas, 0) AS localizacoes_armazenadas,
           (
             tm.estoque_minimo IS NOT NULL AND
             COALESCE(est.estoque_total, 0) < tm.estoque_minimo
           ) AS abaixo_minimo
    FROM mapoteca.tipo_material AS tm
    JOIN dominio.categoria_material AS cm ON cm.code = tm.categoria_id
    LEFT JOIN (
      SELECT tipo_material_id,
             SUM(quantidade) AS estoque_total,
             COUNT(DISTINCT localizacao_id)::int AS localizacoes_armazenadas
      FROM mapoteca.estoque_material
      GROUP BY tipo_material_id
    ) est ON est.tipo_material_id = tm.id
    ORDER BY tm.nome
  `);
};

controller.getTipoMaterialById = async (tipoMaterialId) => {
  return db.conn.task(async t => {
    // Buscar informações do tipo de material
    const tipoMaterial = await t.oneOrNone(`
      SELECT tm.id, tm.nome, tm.descricao,
             tm.categoria_id, cm.nome AS categoria,
             tm.estoque_minimo, tm.meta_anual, tm.ativo
      FROM mapoteca.tipo_material AS tm
      JOIN dominio.categoria_material AS cm ON cm.code = tm.categoria_id
      WHERE tm.id = $1
    `, [tipoMaterialId]);

    if (!tipoMaterial) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    // Buscar informações de estoque
    const estoqueInfo = await t.any(`
      SELECT 
        -- tipo_material_id é exigido pelo PUT /mapoteca/estoque_material
        em.id, em.tipo_material_id, em.quantidade, em.localizacao_id, tl.nome AS localizacao_nome,
        em.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
        em.data_criacao, em.usuario_atualizacao_id, 
        ua.nome AS usuario_atualizacao_nome, em.data_atualizacao
      FROM mapoteca.estoque_material AS em
      LEFT JOIN mapoteca.tipo_localizacao AS tl ON tl.code = em.localizacao_id
      LEFT JOIN dgeo.usuario AS uc ON uc.id = em.usuario_criacao_id
      LEFT JOIN dgeo.usuario AS ua ON ua.id = em.usuario_atualizacao_id
      WHERE em.tipo_material_id = $1
      ORDER BY tl.nome
    `, [tipoMaterialId]);

    // Buscar histórico de consumo recente
    const consumoRecente = await t.any(`
      SELECT 
        -- tipo_material_id é exigido pelo PUT /mapoteca/consumo_material
        cm.id, cm.tipo_material_id, cm.quantidade, cm.data_consumo,
        cm.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
        cm.data_criacao
      FROM mapoteca.consumo_material AS cm
      LEFT JOIN dgeo.usuario AS uc ON uc.id = cm.usuario_criacao_id
      WHERE cm.tipo_material_id = $1
      ORDER BY cm.data_consumo DESC
      LIMIT 10
    `, [tipoMaterialId]);

    // Calcular estatísticas de consumo
    const estatisticasConsumo = await t.oneOrNone(`
      SELECT 
        SUM(quantidade) AS total_consumido,
        AVG(quantidade) AS media_por_consumo,
        COUNT(*) AS total_registros_consumo,
        MAX(data_consumo) AS ultimo_consumo
      FROM mapoteca.consumo_material
      WHERE tipo_material_id = $1
    `, [tipoMaterialId]);

    // Combinar resultados
    return {
      ...tipoMaterial,
      estoque: {
        registros: estoqueInfo,
        total: estoqueInfo.reduce((sum, item) => sum + parseFloat(item.quantidade), 0),
        localizacoes: estoqueInfo.length
      },
      consumo: {
        registros_recentes: consumoRecente,
        total_consumido: parseFloat(estatisticasConsumo?.total_consumido || 0),
        media_por_consumo: parseFloat(estatisticasConsumo?.media_por_consumo || 0),
        total_registros: parseInt(estatisticasConsumo?.total_registros_consumo || 0),
        ultimo_consumo: estatisticasConsumo?.ultimo_consumo
      }
    };
  });
};

controller.criaTipoMaterial = async (tipoMaterial, usuarioUuid) => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome',
      { name: 'descricao', def: null },
      // 3 = Outro, o mesmo default da coluna. Material sem categoria escolhida
      // não sai em nenhuma das duas tabelas de insumo do RPCMTec.
      { name: 'categoria_id', def: 3 },
      { name: 'estoque_minimo', def: null },
      { name: 'meta_anual', def: null },
      { name: 'ativo', def: true }
    ]);

    const query = db.pgp.helpers.insert(tipoMaterial, cs, {
      table: 'tipo_material',
      schema: 'mapoteca'
    }) + ' RETURNING id';

    const result = await t.one(query);
    return result.id;
  });
};

controller.atualizaTipoMaterial = async (tipoMaterial, usuarioUuid) => {
  return db.conn.tx(async t => {
    // Chave ausente = "não mexe": omitir ativo ressuscitava material desativado,
    // e omitir categoria_id jogaria o material de volta para Outro, tirando-o
    // da tabela 7.2 ou 7.3 do RPCMTec sem ninguém ter pedido.
    await preserveOmitted(t, {
      schema: 'mapoteca',
      table: 'tipo_material',
      id: tipoMaterial.id,
      fields: ['ativo', 'categoria_id'],
      body: tipoMaterial
    });

    const cs = new db.pgp.helpers.ColumnSet([
      'nome',
      { name: 'descricao', def: null },
      { name: 'categoria_id', def: 3 },
      { name: 'estoque_minimo', def: null },
      { name: 'meta_anual', def: null },
      { name: 'ativo', def: true }
    ], { table: { table: 'tipo_material', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(tipoMaterial, cs) + ' WHERE id = $1';

    const result = await t.result(query, [tipoMaterial.id]);

    if (result.rowCount === 0) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }
  });
};

controller.deleteTiposMaterial = async (tipoMaterialIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs existem
    const existingTypes = await t.any(
      `SELECT id FROM mapoteca.tipo_material WHERE id IN ($1:csv)`,
      [tipoMaterialIds]
    );

    if (existingTypes.length !== tipoMaterialIds.length) {
      const existingIds = existingTypes.map(type => type.id);
      const missingIds = tipoMaterialIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes tipos de material não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // Verificar se há estoque associado
    const associatedStock = await t.any(
      `SELECT tipo_material_id FROM mapoteca.estoque_material 
       WHERE tipo_material_id IN ($1:csv)
       GROUP BY tipo_material_id`,
      [tipoMaterialIds]
    );

    if (associatedStock.length > 0) {
      const typesWithStock = associatedStock.map(s => s.tipo_material_id);
      throw new AppError(
        `Não é possível excluir os tipos de material com IDs: ${typesWithStock.join(', ')} pois possuem estoque associado`,
        httpCode.BadRequest
      );
    }

    // Verificar se há consumo associado
    const associatedConsumption = await t.any(
      `SELECT tipo_material_id FROM mapoteca.consumo_material 
       WHERE tipo_material_id IN ($1:csv)
       GROUP BY tipo_material_id`,
      [tipoMaterialIds]
    );

    if (associatedConsumption.length > 0) {
      const typesWithConsumption = associatedConsumption.map(c => c.tipo_material_id);
      throw new AppError(
        `Não é possível excluir os tipos de material com IDs: ${typesWithConsumption.join(', ')} pois possuem consumo associado`,
        httpCode.BadRequest
      );
    }

    // Finalmente, excluir os tipos de material
    return t.any(
      `DELETE FROM mapoteca.tipo_material WHERE id IN ($1:csv)`,
      [tipoMaterialIds]
    );
  });
};

// Funções para Estoque de Material
controller.getEstoqueMaterial = async () => {
  return db.conn.any(`
    SELECT em.id, em.tipo_material_id, tm.nome AS tipo_material_nome,
           em.quantidade, em.localizacao_id, tl.nome AS localizacao_nome,
           em.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
           em.data_criacao, em.usuario_atualizacao_id, 
           ua.nome AS usuario_atualizacao_nome, em.data_atualizacao
    FROM mapoteca.estoque_material AS em
    LEFT JOIN mapoteca.tipo_material AS tm ON tm.id = em.tipo_material_id
    LEFT JOIN mapoteca.tipo_localizacao AS tl ON tl.code = em.localizacao_id
    LEFT JOIN dgeo.usuario AS uc ON uc.id = em.usuario_criacao_id
    LEFT JOIN dgeo.usuario AS ua ON ua.id = em.usuario_atualizacao_id
    ORDER BY tm.nome, tl.nome
  `);
};

controller.getEstoquePorLocalizacao = async () => {
  return db.conn.any(`
    SELECT tl.code AS localizacao_id, tl.nome AS localizacao_nome,
           COALESCE(SUM(em.quantidade), 0) AS quantidade_total,
           COUNT(DISTINCT em.tipo_material_id) AS tipos_materiais_diferentes
    FROM mapoteca.tipo_localizacao tl
    LEFT JOIN mapoteca.estoque_material em ON em.localizacao_id = tl.code
    GROUP BY tl.code, tl.nome
    ORDER BY tl.nome
  `);
};

controller.criaEstoqueMaterial = async (estoqueMaterial, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // Verificar se o tipo de material existe
    const tipoMaterialExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.tipo_material WHERE id = $1`,
      [estoqueMaterial.tipo_material_id]
    );

    if (!tipoMaterialExiste) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    // Verificar se a localização existe
    const localizacaoExiste = await t.oneOrNone(
      `SELECT code FROM mapoteca.tipo_localizacao WHERE code = $1`,
      [estoqueMaterial.localizacao_id]
    );

    if (!localizacaoExiste) {
      throw new AppError('Localização não encontrada', httpCode.NotFound);
    }

    // Upsert atômico (check-then-insert tinha corrida com a UNIQUE
    // tipo_material/localizacao). Semântica preservada: define o nível
    // de estoque (substitui a quantidade existente).
    const result = await t.one(
      `INSERT INTO mapoteca.estoque_material
         (tipo_material_id, quantidade, localizacao_id, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (tipo_material_id, localizacao_id)
       DO UPDATE SET quantidade = EXCLUDED.quantidade,
                     usuario_atualizacao_id = EXCLUDED.usuario_atualizacao_id,
                     data_atualizacao = CURRENT_TIMESTAMP
       RETURNING id`,
      [estoqueMaterial.tipo_material_id, estoqueMaterial.quantidade, estoqueMaterial.localizacao_id, usuarioId]
    );
    return result.id;
  });
};

controller.atualizaEstoqueMaterial = async (estoqueMaterial, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    estoqueMaterial.usuario_atualizacao_id = usuarioId;
    estoqueMaterial.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_material_id', 'quantidade', 'localizacao_id',
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: { table: 'estoque_material', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(estoqueMaterial, cs) + ' WHERE id = $1';

    let result;
    try {
      result = await t.result(query, [estoqueMaterial.id]);
    } catch (error) {
      // 23505: mover o registro para material+localização que já existem
      if (error.code === '23505') {
        throw new AppError('Já existe registro de estoque para este material nesta localização', httpCode.BadRequest, error);
      }
      throw error;
    }

    if (result.rowCount === 0) {
      throw new AppError('Registro de estoque não encontrado', httpCode.NotFound);
    }
  });
};

controller.deleteEstoqueMaterial = async (estoqueMaterialIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs existem
    const existingStock = await t.any(
      `SELECT id FROM mapoteca.estoque_material WHERE id IN ($1:csv)`,
      [estoqueMaterialIds]
    );

    if (existingStock.length !== estoqueMaterialIds.length) {
      const existingIds = existingStock.map(s => s.id);
      const missingIds = estoqueMaterialIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes registros de estoque não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    return t.any(
      `DELETE FROM mapoteca.estoque_material WHERE id IN ($1:csv)`,
      [estoqueMaterialIds]
    );
  });
};

// Transferência de material entre localizações
// FOR UPDATE na origem serializa transferências simultâneas do mesmo material;
// upsert no destino usa o UNIQUE (tipo_material_id, localizacao_id)
controller.transferirMaterial = async (data, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  const { tipo_material_id: tipoMaterialId, origem_id: origemId, destino_id: destinoId, quantidade } = data;

  return db.conn.tx(async t => {
    const tipoMaterialExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.tipo_material WHERE id = $<tipoMaterialId>`,
      { tipoMaterialId }
    );

    if (!tipoMaterialExiste) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    // Travar origem e destino em ordem determinística de localizacao_id —
    // transferências opostas simultâneas (A→B e B→A) não deadlockam
    const estoques = await t.any(
      `SELECT id, localizacao_id, quantidade
       FROM mapoteca.estoque_material
       WHERE tipo_material_id = $<tipoMaterialId>
         AND localizacao_id IN ($<origemId>, $<destinoId>)
       ORDER BY localizacao_id
       FOR UPDATE`,
      { tipoMaterialId, origemId, destinoId }
    );

    const origem = estoques.find(e => e.localizacao_id === origemId);

    if (!origem) {
      throw new AppError(
        'Não há estoque na localização de origem para este material',
        httpCode.BadRequest
      );
    }

    if (parseFloat(origem.quantidade) < quantidade) {
      throw new AppError(
        `Quantidade insuficiente na origem. Disponível: ${origem.quantidade}, solicitado: ${quantidade}`,
        httpCode.BadRequest
      );
    }

    await t.none(
      `UPDATE mapoteca.estoque_material
       SET quantidade = quantidade - $<quantidade>,
           data_atualizacao = CURRENT_TIMESTAMP,
           usuario_atualizacao_id = $<usuarioId>
       WHERE id = $<id>`,
      { id: origem.id, quantidade, usuarioId }
    );

    await t.none(
      `INSERT INTO mapoteca.estoque_material
         (tipo_material_id, localizacao_id, quantidade, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($<tipoMaterialId>, $<destinoId>, $<quantidade>, $<usuarioId>, $<usuarioId>)
       ON CONFLICT (tipo_material_id, localizacao_id)
       DO UPDATE SET quantidade = mapoteca.estoque_material.quantidade + EXCLUDED.quantidade,
                     data_atualizacao = CURRENT_TIMESTAMP,
                     usuario_atualizacao_id = EXCLUDED.usuario_atualizacao_id`,
      { tipoMaterialId, destinoId, quantidade, usuarioId }
    );
  });
};

// Funções para Consumo de Material
controller.getConsumoMaterial = async (filtros = null) => {
  let query = `
    SELECT cm.id, cm.tipo_material_id, tm.nome AS tipo_material_nome,
           cm.quantidade, cm.data_consumo,
           cm.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
           cm.data_criacao, cm.usuario_atualizacao_id, 
           ua.nome AS usuario_atualizacao_nome, cm.data_atualizacao
    FROM mapoteca.consumo_material AS cm
    LEFT JOIN mapoteca.tipo_material AS tm ON tm.id = cm.tipo_material_id
    LEFT JOIN dgeo.usuario AS uc ON uc.id = cm.usuario_criacao_id
    LEFT JOIN dgeo.usuario AS ua ON ua.id = cm.usuario_atualizacao_id
  `;

  const queryParams = [];
  const conditions = [];

  // Aplicar filtros se existirem
  if (filtros) {
    if (filtros.data_inicio) {
      queryParams.push(filtros.data_inicio);
      conditions.push(`cm.data_consumo >= $${queryParams.length}`);
    }
    if (filtros.data_fim) {
      queryParams.push(filtros.data_fim);
      conditions.push(`cm.data_consumo <= $${queryParams.length}`);
    }
    if (filtros.tipo_material_id) {
      queryParams.push(filtros.tipo_material_id);
      conditions.push(`cm.tipo_material_id = $${queryParams.length}`);
    }
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  query += ` ORDER BY cm.data_consumo DESC`;

  return db.conn.any(query, queryParams);
};

controller.getConsumoMensalPorTipo = async (ano = new Date().getFullYear()) => {
  return db.conn.any(`
    WITH meses AS (
      SELECT generate_series(1, 12) AS mes
    ),
    tipos_material AS (
      SELECT id, nome FROM mapoteca.tipo_material
    ),
    consumo_mensal AS (
      SELECT 
        tipo_material_id,
        EXTRACT(MONTH FROM data_consumo) AS mes,
        SUM(quantidade) AS quantidade
      FROM mapoteca.consumo_material
      WHERE EXTRACT(YEAR FROM data_consumo) = $1
      GROUP BY tipo_material_id, EXTRACT(MONTH FROM data_consumo)
    )
    SELECT 
      tm.id AS tipo_material_id, 
      tm.nome AS tipo_material_nome,
      m.mes,
      COALESCE(cm.quantidade, 0) AS quantidade
    FROM tipos_material tm
    CROSS JOIN meses m
    LEFT JOIN consumo_mensal cm 
      ON cm.tipo_material_id = tm.id AND cm.mes = m.mes
    ORDER BY tm.nome, m.mes
  `, [ano]);
};

controller.criaConsumoMaterial = async (consumoMaterial, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    // Verificar se o tipo de material existe
    const tipoMaterialExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.tipo_material WHERE id = $1`,
      [consumoMaterial.tipo_material_id]
    );

    if (!tipoMaterialExiste) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    // Verificar se há estoque suficiente na Seção
    // O consumo só pode ocorrer a partir do estoque da Seção (RN01)
    const estoqueSecao = await t.oneOrNone(
      `SELECT quantidade FROM mapoteca.estoque_material
       WHERE tipo_material_id = $1 AND localizacao_id = $2`,
      [consumoMaterial.tipo_material_id, TIPO_LOCALIZACAO.SECAO]
    );

    if (!estoqueSecao) {
      throw new AppError(
        'Não há estoque na Seção para o material informado. O material deve primeiro ser transferido para a Seção antes de ser consumido.',
        httpCode.BadRequest
      );
    }

    if (parseFloat(estoqueSecao.quantidade) < parseFloat(consumoMaterial.quantidade)) {
      throw new AppError(
        `Estoque insuficiente na Seção. Disponível: ${estoqueSecao.quantidade}, Solicitado: ${consumoMaterial.quantidade}`,
        httpCode.BadRequest
      );
    }

    consumoMaterial.usuario_criacao_id = usuarioId;
    consumoMaterial.usuario_atualizacao_id = usuarioId;

    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_material_id', 'quantidade', 'data_consumo',
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    // O trigger trg_consumo_material_insert decrementa automaticamente o estoque na Seção
    const query = db.pgp.helpers.insert(consumoMaterial, cs, {
      table: 'consumo_material',
      schema: 'mapoteca'
    }) + ' RETURNING id';

    let result;
    try {
      result = await t.one(query);
    } catch (error) {
      // Sob corrida, a pré-verificação pode passar e o trigger rejeitar — 400 amigável
      if (error.message && (error.message.includes('Estoque insuficiente') || error.message.includes('Não há estoque'))) {
        throw new AppError(error.message, httpCode.BadRequest, error);
      }
      throw error;
    }
    return result.id;
  });
};

controller.atualizaConsumoMaterial = async (consumoMaterial, usuarioUuid) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    consumoMaterial.usuario_atualizacao_id = usuarioId;
    consumoMaterial.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_material_id', 'quantidade', 'data_consumo',
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: { table: 'consumo_material', schema: 'mapoteca' } });

    // O trigger trg_consumo_material_update ajusta automaticamente o estoque na Seção
    const query = db.pgp.helpers.update(consumoMaterial, cs) + ' WHERE id = $1';

    let result;
    try {
      result = await t.result(query, [consumoMaterial.id]);
    } catch (error) {
      // Exceções de regra de negócio dos triggers viram 400 com a mensagem original
      if (error.message && (error.message.includes('Estoque insuficiente') || error.message.includes('Não há estoque'))) {
        throw new AppError(error.message, httpCode.BadRequest, error);
      }
      throw error;
    }

    if (result.rowCount === 0) {
      throw new AppError('Registro de consumo não encontrado', httpCode.NotFound);
    }
  });
};

controller.deleteConsumoMaterial = async (consumoMaterialIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs existem
    const existingConsumption = await t.any(
      `SELECT id FROM mapoteca.consumo_material WHERE id IN ($1:csv)`,
      [consumoMaterialIds]
    );

    if (existingConsumption.length !== consumoMaterialIds.length) {
      const existingIds = existingConsumption.map(c => c.id);
      const missingIds = consumoMaterialIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes registros de consumo não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // O trigger trg_consumo_material_delete restaura automaticamente o estoque na Seção
    return t.any(
      `DELETE FROM mapoteca.consumo_material WHERE id IN ($1:csv)`,
      [consumoMaterialIds]
    );
  });
};

controller.getManutencaoPlotterById = async (id) => {
  const manutencao = await db.conn.oneOrNone(
    `SELECT mp.id, mp.plotter_id, mp.data_manutencao, mp.valor, mp.descricao,
      mp.data_criacao, mp.usuario_criacao_id,
      mp.data_atualizacao, mp.usuario_atualizacao_id,
      p.modelo AS plotter_modelo, p.nr_serie AS plotter_nr_serie,
      u.nome AS usuario_nome
    FROM mapoteca.manutencao_plotter mp
    INNER JOIN mapoteca.plotter p ON p.id = mp.plotter_id
    LEFT JOIN dgeo.usuario u ON u.id = mp.usuario_criacao_id
    WHERE mp.id = $1`,
    [id]
  );

  if (!manutencao) {
    throw new AppError('Manutenção de plotter não encontrada', httpCode.NotFound);
  }

  return manutencao;
};

controller.getConsumoMaterialById = async (id) => {
  const consumo = await db.conn.oneOrNone(
    `SELECT cm.id, cm.tipo_material_id, cm.quantidade, cm.data_consumo,
      cm.data_criacao, cm.usuario_criacao_id,
      cm.data_atualizacao, cm.usuario_atualizacao_id,
      tm.nome AS tipo_material_nome,
      u.nome AS usuario_nome
    FROM mapoteca.consumo_material cm
    INNER JOIN mapoteca.tipo_material tm ON tm.id = cm.tipo_material_id
    LEFT JOIN dgeo.usuario u ON u.id = cm.usuario_criacao_id
    WHERE cm.id = $1`,
    [id]
  );

  if (!consumo) {
    throw new AppError('Registro de consumo não encontrado', httpCode.NotFound);
  }

  return consumo;
};

controller.getEstoqueMaterialById = async (id) => {
  const estoque = await db.conn.oneOrNone(
    `SELECT em.id, em.tipo_material_id, em.quantidade, em.localizacao_id,
      em.data_criacao, em.usuario_criacao_id,
      em.data_atualizacao, em.usuario_atualizacao_id,
      tm.nome AS tipo_material_nome,
      tl.nome AS localizacao_nome,
      u.nome AS usuario_nome
    FROM mapoteca.estoque_material em
    INNER JOIN mapoteca.tipo_material tm ON tm.id = em.tipo_material_id
    INNER JOIN mapoteca.tipo_localizacao tl ON tl.code = em.localizacao_id
    LEFT JOIN dgeo.usuario u ON u.id = em.usuario_criacao_id
    WHERE em.id = $1`,
    [id]
  );

  if (!estoque) {
    throw new AppError('Registro de estoque não encontrado', httpCode.NotFound);
  }

  return estoque;
};

module.exports = controller;