// Path: mapoteca\mapoteca_ctrl.js
"use strict";

const { db } = require("../database");
const { AppError, httpCode } = require("../utils");

const controller = {};

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

controller.getTipoLocalizacao = async () => {
  return db.conn.any(`
    SELECT code, nome
    FROM mapoteca.tipo_localizacao
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
        SUM(CASE WHEN situacao_pedido_id = 3 THEN 1 ELSE 0 END) AS pedidos_em_andamento,
        SUM(CASE WHEN situacao_pedido_id = 5 THEN 1 ELSE 0 END) AS pedidos_concluidos
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
        SUM(CASE WHEN situacao_pedido_id = 3 THEN 1 ELSE 0 END) AS pedidos_em_andamento,
        SUM(CASE WHEN situacao_pedido_id = 5 THEN 1 ELSE 0 END) AS pedidos_concluidos
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
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'ponto_contato_principal', 'endereco_entrega_principal', 'tipo_cliente_id'
    ]);

    const query = db.pgp.helpers.insert(cliente, cs, {
      table: 'cliente',
      schema: 'mapoteca'
    });

    await t.none(query);
  });
};

controller.atualizaCliente = async (cliente, usuarioUuid) => {
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'ponto_contato_principal', 'endereco_entrega_principal', 'tipo_cliente_id'
    ], { table: 'cliente', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(cliente, cs) + ' WHERE id = $1';

    await t.none(query, [cliente.id]);
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
      const existingIds = existingClients.map(c => c.id);
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
controller.getPedidos = async () => {
  return db.conn.any(`
    SELECT p.id, p.data_pedido, p.data_atendimento,
           p.cliente_id, c.nome AS cliente_nome,
           p.situacao_pedido_id, sp.nome AS situacao_pedido_nome,
           p.documento_solicitacao, p.documento_solicitacao_nup,
           p.prazo, p.localizador_pedido, p.localizador_envio, p.observacao_envio,
           u.nome AS usuario_criacao_nome,
           p.data_criacao,
           (SELECT COUNT(*) FROM mapoteca.produto_pedido WHERE pedido_id = p.id) AS quantidade_produtos
    FROM mapoteca.pedido AS p
    LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
    LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
    LEFT JOIN dgeo.usuario AS u ON u.id = p.usuario_criacao_id
    ORDER BY p.data_pedido DESC
  `);
};

controller.getPedidoById = async (pedidoId) => {
  return db.conn.task(async t => {
    // Obter informações básicas do pedido
    const pedido = await t.oneOrNone(`
      SELECT p.id, p.data_pedido, p.data_atendimento,
             p.cliente_id, c.nome AS cliente_nome, c.tipo_cliente_id, tc.nome AS tipo_cliente_nome,
             p.situacao_pedido_id, sp.nome AS situacao_pedido_nome,
             p.ponto_contato, p.documento_solicitacao, p.documento_solicitacao_nup,
             p.endereco_entrega, p.palavras_chave, p.operacao, p.prazo,
             p.observacao, p.localizador_envio, p.observacao_envio, p.motivo_cancelamento,
             p.localizador_pedido,
             p.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
             p.usuario_atualizacao_id, ua.nome AS usuario_atualizacao_nome,
             p.data_criacao, p.data_atualizacao
      FROM mapoteca.pedido AS p
      LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
      LEFT JOIN mapoteca.tipo_cliente AS tc ON tc.code = c.tipo_cliente_id
      LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
      LEFT JOIN dgeo.usuario AS uc ON uc.id = p.usuario_criacao_id
      LEFT JOIN dgeo.usuario AS ua ON ua.id = p.usuario_atualizacao_id
      WHERE p.id = $1
    `, [pedidoId]);

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    const produtos = await t.any(`
      SELECT pp.id, pp.uuid_versao, pp.quantidade, pp.tipo_midia_id, 
             tm.nome AS tipo_midia_nome, pp.producao_especifica,
             v.versao, v.produto_id, p.nome AS produto_nome, 
             p.mi, p.inom, te.nome AS escala,
             pp.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
             pp.data_criacao, pp.usuario_atualizacao_id, 
             ua.nome AS usuario_atualizacao_nome, pp.data_atualizacao
      FROM mapoteca.produto_pedido AS pp
      LEFT JOIN mapoteca.tipo_midia AS tm ON tm.code = pp.tipo_midia_id
      LEFT JOIN acervo.versao AS v ON v.uuid_versao = pp.uuid_versao
      LEFT JOIN acervo.produto AS p ON p.id = v.produto_id
      LEFT JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id
      LEFT JOIN dgeo.usuario AS uc ON uc.id = pp.usuario_criacao_id
      LEFT JOIN dgeo.usuario AS ua ON ua.id = pp.usuario_atualizacao_id
      WHERE pp.pedido_id = $1
      ORDER BY pp.data_criacao
    `, [pedidoId]);

    // Combinar os resultados
    pedido.produtos = produtos;

    return pedido;
  });
};

controller.criaPedido = async (pedido, usuarioUuid) => {
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
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
    pedido.usuario_criacao_id = usuarioInfo.id;
    pedido.usuario_atualizacao_id = usuarioInfo.id;

    const cs = new db.pgp.helpers.ColumnSet([
      'data_pedido', 'data_atendimento', 'cliente_id', 'situacao_pedido_id',
      'ponto_contato', 'documento_solicitacao', 'documento_solicitacao_nup',
      'endereco_entrega', 'palavras_chave', 'operacao', 'prazo',
      'observacao', 'localizador_envio', 'motivo_cancelamento',
      'localizador_pedido', 'observacao_envio',
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    const query = db.pgp.helpers.insert(pedido, cs, {
      table: 'pedido',
      schema: 'mapoteca'
    }) + ' RETURNING id, localizador_pedido';

    const result = await t.one(query);
    return result;
  });
};

controller.atualizaPedido = async (pedido, usuarioUuid) => {
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    // Verificar se o pedido existe e obter seu localizador atual
    const pedidoAtual = await t.oneOrNone(
      `SELECT localizador_pedido FROM mapoteca.pedido WHERE id = $1`,
      [pedido.id]
    );
    
    if (!pedidoAtual) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }
    
    // Não permitir modificar o localizador_pedido
    delete pedido.localizador_pedido;
    
    pedido.usuario_atualizacao_id = usuarioInfo.id;
    pedido.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'data_pedido', 'data_atendimento', 'cliente_id', 'situacao_pedido_id',
      'ponto_contato', 'documento_solicitacao', 'documento_solicitacao_nup',
      'endereco_entrega', 'palavras_chave', 'operacao', 'prazo',
      'observacao', 'localizador_envio', 'observacao_envio', 'motivo_cancelamento',
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: 'pedido', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(pedido, cs) + ' WHERE id = $1';

    await t.none(query, [pedido.id]);
  });
};

controller.getPedidoByLocalizador = async (localizador) => {
  return db.conn.task(async t => {
    const pedido = await t.oneOrNone(`
      SELECT 
        p.id,
        p.localizador_pedido,
        p.data_pedido,
        p.situacao_pedido_id,
        sp.nome AS situacao_pedido_nome,
        p.cliente_id,
        c.nome AS cliente_nome,
        p.prazo,
        p.localizador_envio,
        p.observacao_envio,
        p.motivo_cancelamento
      FROM mapoteca.pedido AS p
      LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
      LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
      WHERE p.localizador_pedido = $1
    `, [localizador]);

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    return pedido;
  });
};

controller.deletePedidos = async (pedidoIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs de pedido existem
    const existingOrders = await t.any(
      `SELECT id FROM mapoteca.pedido WHERE id IN ($1:csv)`,
      [pedidoIds]
    );

    if (existingOrders.length !== pedidoIds.length) {
      const existingIds = existingOrders.map(o => o.id);
      const missingIds = pedidoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes pedidos não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
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
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    // Verificar se a versão existe
    const versaoExiste = await t.oneOrNone(
      `SELECT uuid_versao FROM acervo.versao WHERE uuid_versao = $1`,
      [produtoPedido.uuid_versao]
    );

    if (!versaoExiste) {
      throw new AppError('Versão não encontrada', httpCode.NotFound);
    }

    // Verificar se o pedido existe
    const pedidoExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.pedido WHERE id = $1`,
      [produtoPedido.pedido_id]
    );

    if (!pedidoExiste) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    produtoPedido.usuario_criacao_id = usuarioInfo.id;
    produtoPedido.usuario_atualizacao_id = usuarioInfo.id;

    const cs = new db.pgp.helpers.ColumnSet([
      'uuid_versao', 'pedido_id', 'quantidade', 'tipo_midia_id', 'producao_especifica',
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    const query = db.pgp.helpers.insert(produtoPedido, cs, {
      table: 'produto_pedido',
      schema: 'mapoteca'
    });

    await t.none(query);
  });
};

controller.atualizaProdutoPedido = async (produtoPedido, usuarioUuid) => {
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    produtoPedido.usuario_atualizacao_id = usuarioInfo.id;
    produtoPedido.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'uuid_versao', 'pedido_id', 'quantidade', 'tipo_midia_id', 'producao_especifica',
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: 'produto_pedido', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(produtoPedido, cs) + ' WHERE id = $1';

    await t.none(query, [produtoPedido.id]);
  });
};

controller.deleteProdutosPedido = async (produtoPedidoIds) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs existem
    const existingProducts = await t.any(
      `SELECT id FROM mapoteca.produto_pedido WHERE id IN ($1:csv)`,
      [produtoPedidoIds]
    );

    if (existingProducts.length !== produtoPedidoIds.length) {
      const existingIds = existingProducts.map(p => p.id);
      const missingIds = produtoPedidoIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes produtos de pedido não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    return t.any(
      `DELETE FROM mapoteca.produto_pedido WHERE id IN ($1:csv)`,
      [produtoPedidoIds]
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
        mp.id, mp.data_manutencao, mp.valor, mp.descricao,
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
        SELECT AVG(EXTRACT(DAY FROM (data_manutencao - manutencao_anterior))) AS media_dias
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
      'ativo', 'nr_serie', 'modelo', 'data_aquisicao', 'vida_util'
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
      'ativo', 'nr_serie', 'modelo', 'data_aquisicao', 'vida_util'
    ], { table: 'plotter', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(plotter, cs) + ' WHERE id = $1';

    await t.none(query, [plotter.id]);
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
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    // Verificar se o plotter existe
    const plotterExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.plotter WHERE id = $1`,
      [manutencao.plotter_id]
    );

    if (!plotterExiste) {
      throw new AppError('Plotter não encontrado', httpCode.NotFound);
    }

    manutencao.usuario_criacao_id = usuarioInfo.id;
    manutencao.usuario_atualizacao_id = usuarioInfo.id;

    const cs = new db.pgp.helpers.ColumnSet([
      'plotter_id', 'data_manutencao', 'valor', 'descricao',
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
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    manutencao.usuario_atualizacao_id = usuarioInfo.id;
    manutencao.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'plotter_id', 'data_manutencao', 'valor', 'descricao',
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: 'manutencao_plotter', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(manutencao, cs) + ' WHERE id = $1';

    await t.none(query, [manutencao.id]);
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
           COALESCE((SELECT SUM(quantidade) FROM mapoteca.estoque_material WHERE tipo_material_id = tm.id), 0) AS estoque_total,
           COALESCE((SELECT COUNT(DISTINCT localizacao_id) FROM mapoteca.estoque_material WHERE tipo_material_id = tm.id), 0) AS localizacoes_armazenadas
    FROM mapoteca.tipo_material AS tm
    ORDER BY tm.nome
  `);
};

controller.getTipoMaterialById = async (tipoMaterialId) => {
  return db.conn.task(async t => {
    // Buscar informações do tipo de material
    const tipoMaterial = await t.oneOrNone(`
      SELECT tm.id, tm.nome, tm.descricao
      FROM mapoteca.tipo_material AS tm
      WHERE tm.id = $1
    `, [tipoMaterialId]);

    if (!tipoMaterial) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    // Buscar informações de estoque
    const estoqueInfo = await t.any(`
      SELECT 
        em.id, em.quantidade, em.localizacao_id, tl.nome AS localizacao_nome,
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
        cm.id, cm.quantidade, cm.data_consumo,
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
      'nome', 'descricao'
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
    const cs = new db.pgp.helpers.ColumnSet([
      'nome', 'descricao'
    ], { table: 'tipo_material', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(tipoMaterial, cs) + ' WHERE id = $1';

    await t.none(query, [tipoMaterial.id]);
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
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

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

    // Verificar se já existe registro para este material nesta localização
    const estoqueExistente = await t.oneOrNone(
      `SELECT id, quantidade FROM mapoteca.estoque_material 
       WHERE tipo_material_id = $1 AND localizacao_id = $2`,
      [estoqueMaterial.tipo_material_id, estoqueMaterial.localizacao_id]
    );

    // Se já existe, atualizar o registro existente
    if (estoqueExistente) {
      await t.none(
        `UPDATE mapoteca.estoque_material 
         SET quantidade = $1, 
             usuario_atualizacao_id = $2,
             data_atualizacao = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [estoqueMaterial.quantidade, usuarioInfo.id, estoqueExistente.id]
      );
      return estoqueExistente.id;
    } 
    // Caso contrário, criar um novo registro
    else {
      estoqueMaterial.usuario_criacao_id = usuarioInfo.id;
      estoqueMaterial.usuario_atualizacao_id = usuarioInfo.id;

      const cs = new db.pgp.helpers.ColumnSet([
        'tipo_material_id', 'quantidade', 'localizacao_id',
        'usuario_criacao_id', 'usuario_atualizacao_id'
      ]);

      const query = db.pgp.helpers.insert(estoqueMaterial, cs, {
        table: 'estoque_material',
        schema: 'mapoteca'
      }) + ' RETURNING id';

      const result = await t.one(query);
      return result.id;
    }
  });
};

controller.atualizaEstoqueMaterial = async (estoqueMaterial, usuarioUuid) => {
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    estoqueMaterial.usuario_atualizacao_id = usuarioInfo.id;
    estoqueMaterial.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_material_id', 'quantidade', 'localizacao_id',
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: 'estoque_material', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(estoqueMaterial, cs) + ' WHERE id = $1';

    await t.none(query, [estoqueMaterial.id]);
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
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    // Verificar se o tipo de material existe
    const tipoMaterialExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.tipo_material WHERE id = $1`,
      [consumoMaterial.tipo_material_id]
    );

    if (!tipoMaterialExiste) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    consumoMaterial.usuario_criacao_id = usuarioInfo.id;
    consumoMaterial.usuario_atualizacao_id = usuarioInfo.id;

    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_material_id', 'quantidade', 'data_consumo',
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    const query = db.pgp.helpers.insert(consumoMaterial, cs, {
      table: 'consumo_material',
      schema: 'mapoteca'
    }) + ' RETURNING id';

    const result = await t.one(query);
    return result.id;
  });
};

controller.atualizaConsumoMaterial = async (consumoMaterial, usuarioUuid) => {
  const usuarioInfo = await db.oneOrNone(
    "SELECT id FROM dgeo.usuario WHERE uuid = $<usuarioUuid>",
    { usuarioUuid }
  );
  
  if (!usuarioInfo) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest);
  }

  return db.conn.tx(async t => {
    consumoMaterial.usuario_atualizacao_id = usuarioInfo.id;
    consumoMaterial.data_atualizacao = new Date();

    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_material_id', 'quantidade', 'data_consumo',
      'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: 'consumo_material', schema: 'mapoteca' });

    const query = db.pgp.helpers.update(consumoMaterial, cs) + ' WHERE id = $1';

    await t.none(query, [consumoMaterial.id]);
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

    return t.any(
      `DELETE FROM mapoteca.consumo_material WHERE id IN ($1:csv)`,
      [consumoMaterialIds]
    );
  });
};

module.exports = controller;