"use strict";


const { caminhoNoVolume } = require('../utils/caminho_volume');
const { db } = require("../database");
const { AppError, httpCode, preserveOmitted, domainConstants: { SITUACAO_PEDIDO, TIPO_LOCALIZACAO, LOCALIZACOES_NA_CASA, TIPO_MOVIMENTO_MATERIAL, STATUS_ARQUIVO, TIPO_ARQUIVO } } = require("../utils");
const generateLocalizador = require("../utils/generate_localizador");
// A rastreabilidade e do SISTEMA, e nao da mapoteca. O `modulo`, a `entidade` e
// o `entidade_id` de cada evento saem do mapa (`../auditoria/mapa/mapoteca.js`),
// e nao daqui: dois controllers escrevendo na mesma tabela com entidades
// diferentes seria divergencia que nada acusa.
const auditoriaCtrl = require("../auditoria/auditoria_ctrl");
const {
  ESCALA_DISPLAY,
  ESCALA_DISPLAY_ITEM,
  JOIN_PRODUTO_ITEM,
  PRODUTO_NOME,
  PRODUTO_MI,
  ITEM_E_AVULSO,
  filtroAno,
  SITUACOES_FILA_IMPRESSAO,
  SITUACOES_FILA_ATENDIMENTO,
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
// O CODIGO DO ITEM ('4.1'). O NULLIF para '-' era defesa contra um sentinela
// textual que o cadastro antigo gravava no lugar do nulo; desde 1.30.0
// `pit.meta_item.item` e NOT NULL, e o COALESCE so cobre o pedido SEM meta.
const ROTULO_META = 'COALESCE(mp.item, mp.numero_meta::text)';

// Colunas de pedido/produto_pedido compartilhadas entre criação e atualização
// (pgp ColumnSet). `def` permite que o cliente omita campos opcionais.
const PEDIDO_COLS = [
  'data_pedido',
  { name: 'data_atendimento', def: null },
  'cliente_id', 'situacao_pedido_id',
  { name: 'ponto_contato', def: null },
  // O contato NOSSO, que o solicitante le na consulta publica. O de cima e o
  // contato DELES. Ver er/mapoteca.sql.
  { name: 'contato_mapoteca', def: null },
  { name: 'documento_solicitacao', def: null },
  { name: 'documento_solicitacao_nup', def: null },
  { name: 'endereco_entrega', def: null },
  // Como o material saiu. É do PEDIDO, e não do item.
  { name: 'forma_entrega_id', def: null },
  'palavras_chave',
  { name: 'operacao', def: null },
  { name: 'prazo', def: null },
  { name: 'demandante', def: null },
  // Sem `omds`: a coluna saiu em 2026-08-08 por medicao (124 linhas
  // preenchidas, UM valor distinto em todas). Ver er/mapoteca.sql.
  { name: 'previsto_pit', def: false },
  { name: 'meta_pit_id', def: null },
  // O mês em que este pedido PROMETE ser impresso, e de onde a meta 4 do PIT
  // tira o PLANEJADO. Não é `prazo`, que é o limite imposto pelo cliente.
  { name: 'data_prevista', def: null },
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
  // Sem `quantidade_fornecida`: a coluna saiu em 2026-08-08 por medicao (igual
  // a `quantidade` em 1759 de 1759 linhas preenchidas). Quem guarda o que de
  // fato saiu da impressora e `mapoteca.impressao_item`, com data e autor.
  'tipo_midia_id',
  // A MIDIA fornecida FICA, e o sufixo igual ao da coluna acima e coincidencia:
  // esta tem 25 divergencias reais (tyvek pedido, sulfite entregue).
  { name: 'tipo_midia_fornecida_id', def: null },
  // A meta do PIT que ESTE item cumpre, quando difere da do pedido. NULL = a
  // mesma do pedido (ver o comentário da coluna em er/mapoteca.sql).
  { name: 'meta_pit_id', def: null },
  // Sem `forma_entrega_id` e sem `data_entrega`: as duas sao do PEDIDO. O item
  // so descreve O QUE se imprime, nunca como sai daqui.
  { name: 'observacao', def: null },
  // O def aqui é só rede de segurança para id inexistente: no caminho normal o
  // preserveOmitted já preencheu a chave com o valor gravado (na criação o
  // default do Joi é que responde). Sem ele, atualizar um id que não existe
  // omitindo a chave viraria erro do pgp em vez do 404 do controller.
  { name: 'producao_especifica', def: false }
];

/**
 * O item só declara meta própria dentro de um pedido que É do PIT.
 *
 * POR QUE ISTO VIVE AQUI, e não num CHECK. A regra atravessa duas tabelas (a
 * meta está no item, `previsto_pit` está no pedido) e o Postgres não tem CHECK
 * que atravesse tabela. O que o banco garante é a chave estrangeira: a meta
 * apontada existe. Quem garante que ela FAZ SENTIDO ali é esta função, e ela
 * devolve 400 limpo em vez de deixar passar um vínculo órfão.
 *
 * SEM ELA o dado ficaria invisível: um item com meta declarada num pedido fora
 * do PIT não aparece em nenhuma consulta da execução (todas partem do vínculo do
 * pedido), então o erro não daria número errado, daria número ausente.
 *
 * `null` é sempre válido: significa "este item cumpre a meta do pedido".
 */
const conferirMetaDoItem = async (t, pedidoId, metaPitId) => {
  if (metaPitId === null || metaPitId === undefined) return;

  const pedido = await t.oneOrNone(
    `SELECT previsto_pit FROM mapoteca.pedido WHERE id = $1`,
    [pedidoId]
  );

  if (pedido && !pedido.previsto_pit) {
    throw new AppError(
      'Item só declara meta do PIT própria em pedido previsto no PIT. ' +
      'Marque o pedido como previsto no PIT antes, ou deixe a meta do item vazia.',
      httpCode.BadRequest
    );
  }
};

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
    ORDER BY code
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

// SQLSTATE de violacao de UNIQUE (23505). O par (nome, sigla) do cliente virou
// UNICO em 2026-08-12, contando nulo como igual, depois que a producao mostrou a
// mesma OM cadastrada duas vezes (ver a 3.4.0 e a 3.5.0 em migrations/).
//
// A traducao existe porque a recusa CRUA seria um 500 dizendo "erro no servidor"
// para quem so repetiu um nome que ja existe -- e o conserto esta na mao da
// pessoa. Vale no INSERT e no UPDATE: renomear uma ficha para o nome de outra
// cria a duplicata pelo mesmo caminho.
const UNIQUE_VIOLATION_CLIENTE = '23505';

const traduzirErroCliente = err => {
  if (err && err.code === UNIQUE_VIOLATION_CLIENTE &&
      /unique_cliente_nome_sigla/.test(err.message || '')) {
    throw new AppError(
      'Já existe um cliente com este nome e esta sigla. A mesma OM cadastrada ' +
      'duas vezes parte o histórico dela entre as duas fichas e faz a contagem ' +
      'de OM atendidas somar duas onde há uma. Se for outra unidade, diferencie ' +
      'o nome ou a sigla; se for a mesma, use a ficha que já existe.',
      httpCode.Conflict,
      err
    );
  }
  throw err;
};

// `mapoteca.cliente` NAO tem coluna de escrituracao (nem `usuario_criacao_id`
// nem `data_criacao`), e por isso as tres funcoes abaixo nao resolvem o id
// inteiro do usuario: ele nao teria onde ser gravado. Quem responde "quem mexeu"
// aqui e o evento de rastreabilidade, que grava o UUID do token.
controller.criaCliente = async (cliente, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome',
      { name: 'sigla', def: null },
      { name: 'ponto_contato_principal', def: null },
      { name: 'endereco_entrega_principal', def: null },
      'tipo_cliente_id'
    ]);

    // RETURNING * porque a linha gravada e o `dados_depois` do evento, e o id
    // dela e o `registro_id`. A rota nao devolve corpo, entao nada muda para o
    // cliente.
    const query = db.pgp.helpers.insert(cliente, cs, {
      table: 'cliente',
      schema: 'mapoteca'
    }) + ' RETURNING *';

    const criado = await t.one(query).catch(traduzirErroCliente);

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.cliente',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    });
  });
};

controller.atualizaCliente = async (cliente, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // A linha INTEIRA antes da mudanca, e o 404 de quebra: e a mesma ida ao
    // banco que o `SELECT id` de conferencia custava, agora servindo tambem de
    // `dados_antes`.
    const antes = await auditoriaCtrl.lerAntes(
      t, 'mapoteca.cliente', cliente.id, 'Cliente'
    );

    // A tela de cliente ainda nao conhece `sigla`. Sem isto, editar o endereco
    // pela tela apagaria a sigla carregada, com 200 e sem aviso. Ausente
    // preserva; null explicito ainda limpa.
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

    const query = db.pgp.helpers.update(cliente, cs) + ' WHERE id = $1 RETURNING *';

    const depois = await t.one(query, [cliente.id]).catch(traduzirErroCliente);

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.cliente',
      registroId: cliente.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    });
  });
};

controller.deleteClientes = async (clienteIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs de cliente existem.
    // SELECT * e nao SELECT id: a linha inteira vira o `dados_antes` do evento,
    // e depois do DELETE nao ha mais de onde tira-la.
    const existingClients = await t.any(
      `SELECT * FROM mapoteca.cliente WHERE id IN ($1:csv)`,
      [clienteIds]
    );

    if (existingClients.length !== clienteIds.length) {
      // BIGSERIAL retorna como string no driver, normalizar para número
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

    for (const cliente of existingClients) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.cliente',
        registroId: cliente.id,
        operacao: 'D',
        antes: cliente,
        usuarioUuid,
        contexto
      });
    }

    // Se não houver pedidos associados, deletar os clientes
    return t.any(
      `DELETE FROM mapoteca.cliente WHERE id IN ($1:csv)`,
      [clienteIds]
    );
  });
};

// Pedidos do ANO consultado, pela data do pedido.
//
// O que isso custa, e vale saber: um pedido de dezembro que só se conclui em
// janeiro deixa de aparecer quando vira o ano, e é preciso trocar o ano do
// filtro para achá-lo. Em troca, a lista para de crescer indefinidamente e casa
// com o Dashboard, que conta pedido pelo mesmo critério.
//
// `palavraChave` é OPCIONAL e casa a ETIQUETA INTEIRA, nunca um pedaço dela.
// Não é preguiça: `pedido.palavras_chave` é VARCHAR[] com índice GIN
// (`idx_pedido_palavras_chave`), e o opclass default de array só responde a
// `@>`, `<@`, `&&` e `=`. Um `ILIKE` sobre `unnest(palavras_chave)` leria a
// tabela inteira com o índice ao lado sem tocar nele, e a etiqueta existe
// justamente para ser escolhida de uma lista, e não digitada por aproximação.
//
// Por isso o filtro também é sensível a maiúscula: `lower(pk) = lower($1)`
// abandonaria o índice pelo mesmo motivo. É o preço de a busca ser da ETIQUETA,
// e a etiqueta é escrita uma vez no cadastro.
controller.getPedidos = async (ano, palavraChave = null) => {
  return db.conn.any(`
    SELECT p.id, p.data_pedido, p.data_atendimento,
           p.cliente_id, c.nome AS cliente_nome,
           -- tipo_cliente_id sustenta o filtro militar/civil da lista. Militar
           -- e 1 a 3 (OM EB, Aeronautica, Marinha); civil e 4 a 9.
           c.tipo_cliente_id, tc.nome AS tipo_cliente_nome,
           p.situacao_pedido_id, sp.nome AS situacao_pedido_nome,
           p.documento_solicitacao, p.documento_solicitacao_nup,
           p.prazo, p.demandante, p.previsto_pit, p.operacao,
           -- As etiquetas do pedido saem na LISTA desde 2026-08-08, porque é
           -- por elas que se filtra: uma lista que filtra por algo que não
           -- mostra deixa quem filtrou sem saber POR QUE aquela linha entrou.
           p.palavras_chave,
           -- A meta e chave estrangeira, e nunca o codigo digitado a mao. O id
           -- serve a escrita; o codigo serve a tela e a planilha.
           -- O ::int pela mesma razao do detalhe: BIGINT sai do driver como texto.
           p.meta_pit_id::int AS meta_pit_id, ${ROTULO_META} AS meta_pit_codigo,
           -- O mes PROMETIDO, de onde sai o planejado da meta 4. Distinto do
           -- prazo, que e o limite do cliente. (Sem crase: template literal.)
           p.data_prevista,
           p.localizador_pedido, p.localizador_envio, p.observacao_envio,
           p.forma_entrega_id, fe.nome AS forma_entrega_nome,
           u.nome AS usuario_criacao_nome,
           -- As duas datas do REGISTRO, distintas da data_pedido, que e a data
           -- do DIEx. A lista mostra a alteracao para quem procura o pedido
           -- parado; sem data_atualizacao ela cai para a criacao e diz que
           -- todo pedido e recente.
           p.data_criacao, p.data_atualizacao,
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
    LEFT JOIN pit.meta_vigente AS mp ON mp.id = p.meta_pit_id
    WHERE ${filtroAno('p.data_pedido')}
      ${palavraChave
        ? `-- O operador e @>, e o cast para varchar[] existe para ele: o GIN de
           -- array atende @>, <@, && e =, e nao atende = ANY(palavras_chave).
           AND p.palavras_chave @> ARRAY[$<palavraChave>]::varchar[]`
        : ''}
    ORDER BY p.data_pedido DESC
  `, { ano, palavraChave });
};

/**
 * AS ETIQUETAS QUE JÁ EXISTEM, com quantos pedidos cada uma tem.
 *
 * POR QUE ELA EXISTE. A busca por etiqueta casa o texto INTEIRO e diferencia
 * maiúscula de minúscula (é o que o índice GIN atende), e o cadastro era um
 * campo livre sem sugestão nenhuma. As duas coisas juntas produziram, em três
 * dias de 2026, 34 grafias em 50 usos, com 'excedente', 'excedentes' e
 * 'exemplares excedentes' separando sete pedidos do mesmo assunto em três
 * listas que não se encontram. Esta rota é o que o cadastro consulta para
 * oferecer a etiqueta que já existe ANTES de a pessoa inventar a variante.
 *
 * SEM FILTRO DE ANO, ao contrário da lista de pedidos. A etiqueta atravessa o
 * ano de propósito, e sugerir só as do ano corrente faria renascer em janeiro a
 * grafia que dezembro já tinha resolvido.
 *
 * ORDENADA PELA CONTAGEM, e o desempate é alfabético. A etiqueta usada em sete
 * pedidos é a que tem mais chance de ser a certa, e o `datalist` do navegador
 * respeita a ordem em que as opções chegam.
 *
 * @returns {Promise<Array<{etiqueta:string, pedidos:number}>>}
 */
controller.getPalavrasChave = async () => {
  return db.conn.any(`
    SELECT etiqueta, COUNT(*)::int AS pedidos
      FROM mapoteca.pedido AS p, unnest(p.palavras_chave) AS etiqueta
     GROUP BY etiqueta
     ORDER BY COUNT(*) DESC, etiqueta
  `);
};

/**
 * A FILA de pedidos abertos, do mais urgente para o menos.
 *
 * DUAS FILAS, UMA CONSULTA. O parâmetro `incluirRemetidos` escolhe qual. Falso
 * devolve a fila de IMPRESSÃO (o que falta imprimir), que é o que o plugin do
 * QGIS lê. Verdadeiro devolve a fila de ATENDIMENTO (o que falta FECHAR), que
 * acrescenta o pedido Remetido. As duas listas, e a razão de cada corte, estão
 * em `SITUACOES_FILA_IMPRESSAO` e `SITUACOES_FILA_ATENDIMENTO`.
 *
 * O default é a fila de impressão porque é o contrato que o plugin já instalado
 * espera. Quem quer o Remetido pede por `?incluir_remetidos=true`.
 *
 * NÃO filtra por ano, ao contrário da lista de pedidos. É deliberado: o pedido de
 * dezembro que ainda não foi atendido continua sendo trabalho em janeiro, e uma
 * fila que esconde o atrasado é pior que fila nenhuma.
 *
 * A ordem tem DOIS trechos. Primeiro quem tem prazo, do mais
 * próximo ao mais distante, porque data marcada decide o dia de quem atende.
 * Depois quem NÃO tem prazo, do pedido mais ANTIGO para o mais novo, porque
 * idade é o único sinal de urgência que sobra. O `dias_para_prazo` vem calculado
 * no banco, então a tela não precisa fazer conta de data (e não erra por fuso).
 *
 * Traz o endereço e o contato porque a etiqueta de envio sai desta tela: sem eles
 * seria uma segunda requisição por pedido só para imprimir um endereço.
 */
controller.getPedidosEmAberto = async ({ incluirRemetidos = false } = {}) => {
  const situacoes = incluirRemetidos
    ? SITUACOES_FILA_ATENDIMENTO
    : SITUACOES_FILA_IMPRESSAO;

  return db.conn.any(`
    SELECT p.id, p.localizador_pedido, p.data_pedido, p.prazo,
           (p.prazo - CURRENT_DATE)::int AS dias_para_prazo,
           p.cliente_id, c.nome AS cliente_nome,
           c.tipo_cliente_id, tc.nome AS tipo_cliente_nome,
           p.situacao_pedido_id, sp.nome AS situacao_pedido_nome,
           p.documento_solicitacao, p.documento_solicitacao_nup,
           p.ponto_contato, p.contato_mapoteca, c.ponto_contato_principal AS cliente_ponto_contato,
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
    -- A regua da fila: quem TEM prazo vem primeiro, do mais proximo
    -- ao mais distante; depois vem quem NAO tem prazo, do mais antigo para o
    -- mais novo. A ordem antiga era so "prazo ASC NULLS LAST", e ela punha o
    -- pedido menos urgente no topo: medido na producao, dos 25 pedidos da fila
    -- 1 tem prazo (vence em 31 dias) e 24 nao tem, alguns com 215 dias de idade.
    -- O unico com prazo, o mais folgado de todos, abria a lista.
    -- (p.prazo IS NULL) ordena falso antes de verdadeiro, e e o que separa os
    -- dois trechos. O id fecha o desempate e deixa a ordem unica e estavel.
    ORDER BY (p.prazo IS NULL) ASC,
             p.prazo ASC,
             p.data_pedido ASC NULLS LAST,
             p.id ASC
  `, { situacoes });
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
      // A forma de entrega vem do PEDIDO, e não do item.
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
 * Pela rota do acervo (`/acervo/arquivo/:uuid/download`) ele leva 403 no meio da
 * tela feita para ele.
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
             p.ponto_contato, p.contato_mapoteca, c.ponto_contato_principal AS cliente_ponto_contato,
             p.documento_solicitacao, p.documento_solicitacao_nup,
             -- Os DOIS enderecos, pela mesma razao dos dois contatos: o do
             -- pedido manda, e o cadastro da OM serve de reserva. A etiqueta de
             -- envio da tela de detalhe cai no segundo quando o pedido nao traz
             -- endereco nenhum.
             p.endereco_entrega, c.endereco_entrega_principal AS cliente_endereco_entrega,
             -- Do PEDIDO, e nao de cada item.
             p.forma_entrega_id, fe.nome AS forma_entrega_nome,
             p.palavras_chave, p.operacao, p.prazo,
             p.demandante, p.previsto_pit,
             -- O ::int porque a coluna e BIGINT, e o driver devolve int8 como
             -- TEXTO. O Joi da escrita e number().integer().strict(), sem
             -- coercao: quem lia o pedido e o reenviava (o comando
             -- mapoteca pedido corrigir, que e leitura-altera-reenvia) levava
             -- '"meta_pit_id" must be a number' em TODO pedido ligado a meta, e
             -- so neles. A tela escapava por acidente, porque o combo remonta o
             -- valor da propria lista de opcoes em vez de devolver o que o GET
             -- trouxe. Mesmo padrao das contagens deste arquivo.
             p.meta_pit_id::int AS meta_pit_id, ${ROTULO_META} AS meta_pit_codigo,
             mp.descricao AS meta_pit_descricao,
             p.data_prevista,
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
      LEFT JOIN pit.meta_vigente AS mp ON mp.id = p.meta_pit_id
      WHERE p.id = $1
    `, [pedidoId]);

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    const produtos = await t.any(`
      -- pedido_id vai junto porque o PUT /mapoteca/produto_pedido o exige:
      -- sem ele, o item que esta leitura devolve não serve de corpo de escrita
      SELECT pp.id, pp.pedido_id, pp.uuid_versao, pp.quantidade,
             pp.tipo_midia_id, tm.nome AS tipo_midia_nome,
             pp.tipo_midia_fornecida_id, tmf.nome AS tipo_midia_fornecida_nome,
             -- A meta que o item declara por conta própria, e NÃO a que ele
             -- cumpre: quem quiser a segunda faz o COALESCE com a do pedido, que
             -- vem na mesma resposta. Devolver aqui o valor já resolvido faria o
             -- formulário reenviar como declaração do item o que era herança do
             -- pedido, e a exceção viraria a regra em toda edição.
             -- O ::int pela mesma razao do pedido: BIGINT sai do driver como
             -- texto e o Joi do item tambem e strict.
             pp.meta_pit_id::int AS meta_pit_id, ${ROTULO_META} AS meta_pit_codigo,
             pp.observacao, pp.producao_especifica,
             pp.nome_avulso, pp.descricao_avulso,
             ${ITEM_E_AVULSO} AS item_avulso,
             v.versao, v.data_edicao, v.produto_id,
             -- Os fragmentos, e nao SQL proprio: esta era a QUINTA consulta que
             -- parte do item do pedido, e a unica que escrevia a escala a mao
             -- (te.nome). Escrevendo a escala a mao, a mesma carta sai
             -- "Escala personalizada" aqui e "1:30.000" no
             -- /pedido/:id/download_impressao, e o item avulso sai com escala
             -- NULA aqui e "Sem escala" la. Duas telas do mesmo pedido nao podem
             -- escrever a mesma carta de dois jeitos.
             ${PRODUTO_NOME} AS produto_nome,
             ${PRODUTO_MI} AS mi, prod.inom,
             ${ESCALA_DISPLAY_ITEM} AS escala,
             prod.tipo_produto_id, tp.nome AS tipo_produto_nome,
             COALESCE(imp.quantidade_impressa, 0)::int AS quantidade_impressa,
             GREATEST(pp.quantidade - COALESCE(imp.quantidade_impressa, 0), 0)::int AS quantidade_restante,
             (COALESCE(imp.quantidade_impressa, 0) >= pp.quantidade) AS impressao_concluida,
             pp.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
             pp.data_criacao, pp.usuario_atualizacao_id,
             ua.nome AS usuario_atualizacao_nome, pp.data_atualizacao
      FROM mapoteca.produto_pedido AS pp
      LEFT JOIN mapoteca.tipo_midia AS tm ON tm.code = pp.tipo_midia_id
      LEFT JOIN mapoteca.tipo_midia AS tmf ON tmf.code = pp.tipo_midia_fornecida_id
      LEFT JOIN pit.meta_vigente AS mp ON mp.id = pp.meta_pit_id
      ${JOIN_PRODUTO_ITEM}
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

controller.criaPedido = async (pedido, usuarioUuid, contexto) => {
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
      tabela: 'mapoteca.pedido',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    });

    return { id: criado.id, localizador_pedido: criado.localizador_pedido };
  });
};

controller.atualizaPedido = async (pedido, usuarioUuid, contexto) => {
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
    // LISTA (que na época não devolvia palavras_chave) zerava as palavras-chave
    // e desmarcava previsto_pit sem erro nenhum. A lista passou a devolver as
    // palavras-chave em 2026-08-08, junto com o filtro por elas, e a guarda
    // FICA: o que a protege não é a lista devolver o campo, é a chave ausente
    // nunca significar "apague".
    await preserveOmitted(t, {
      schema: 'mapoteca',
      table: 'pedido',
      id: pedido.id,
      // `data_prevista` anda com `meta_pit_id`: os dois formam o vínculo com o
      // PIT (a meta e o mês prometido). Preservar um e apagar o outro deixaria o
      // pedido ligado à meta sem mês, que conta zero no plano sem acusar nada.
      fields: ['palavras_chave', 'previsto_pit', 'meta_pit_id', 'data_prevista'],
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
      tabela: 'mapoteca.pedido',
      registroId: pedido.id,
      operacao: 'U',
      antes: pedidoAtual,
      depois: pedidoNovo,
      usuarioUuid,
      contexto
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
    // `p.data_atendimento` e o dia em que o material saiu, e a tela a mostra
    // como "data de envio/entrega": nao existe coluna de data de envio.
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
        -- Com quem o solicitante fala se tiver duvida. E o unico caminho de
        -- VOLTA que esta tela oferece: quem a abre meses depois nao tem mais o
        -- DIEx de resposta a mao.
        p.contato_mapoteca,
        p.data_atendimento,
        p.localizador_envio,
        p.observacao_envio,
        -- A forma de entrega e do PEDIDO, e sai aqui pelo nome: uma vez so, e
        -- nao uma vez por item.
        fe.nome AS forma_entrega_nome,
        p.motivo_cancelamento,
        -- De QUEM e esta tela. Ela e a unica que alguem de fora abre, e sem isto
        -- nao dizia. Vem no MESMO payload, e nao por rota propria: uma chamada
        -- ja traz tudo que o cabecalho precisa, e o simbolo (que e imagem) sai
        -- por '/instituicao/simbolo', tambem publica.
        inst.nome AS instituicao_nome,
        inst.sigla AS instituicao_sigla,
        (inst.simbolo IS NOT NULL) AS instituicao_tem_simbolo
      FROM mapoteca.pedido AS p
      LEFT JOIN dgeo.instituicao AS inst ON inst.id = 1
      LEFT JOIN mapoteca.cliente AS c ON c.id = p.cliente_id
      LEFT JOIN mapoteca.situacao_pedido AS sp ON sp.code = p.situacao_pedido_id
      LEFT JOIN mapoteca.forma_entrega AS fe ON fe.code = p.forma_entrega_id
      WHERE p.localizador_pedido = $1
    `, [localizador]);

    if (!pedido) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    // Itens do pedido, apenas campos seguros para consulta pública
    // (o que foi pedido + observação do item; sem dados internos/usuários).
    //
    // O item AVULSO (papel quadriculado, carta de outro CGEO) sai aqui como
    // qualquer outro. Os LEFT JOIN o trazem com todas as colunas de
    // identificação nulas, e sem os COALESCE abaixo o cliente veria uma linha em
    // branco com uma quantidade ao lado.
    //
    // descricao_avulso É PÚBLICA: ela guarda a descrição física do impresso ("80
    // x 68 cm, quadrícula de 4 x 4 cm"), que é justamente o que o cliente precisa
    // ler. Anotação interna sobre um avulso não vai aqui.
    // `versao_id` e `tem_miniatura` existem para a IMAGEM da folha, servida por
    // '/pedido/localizador/:localizador/miniatura/:versao_id'. O id sozinho não
    // abre nada: aquela rota só entrega a imagem se a versão pertencer a ESTE
    // pedido. E `tem_miniatura` evita a viagem que voltaria 404, que é o caso
    // normal de produto sem imagem (mesma disciplina da ficha do acervo).
    const produtos = await t.any(`
      SELECT
        pp.quantidade,
        tm.nome AS tipo_midia_nome,
        pp.observacao,
        v.id AS versao_id,
        (mv.versao_id IS NOT NULL AND mv.conteudo IS NOT NULL) AS tem_miniatura,
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
      LEFT JOIN acervo.miniatura_versao AS mv ON mv.versao_id = v.id
      WHERE pp.pedido_id = $1
      ORDER BY pp.data_criacao
    `, [pedido.id]);

    delete pedido.id;
    pedido.produtos = produtos;

    return pedido;
  });
};

/**
 * Miniatura de uma versão, para a tela PÚBLICA de acompanhamento.
 *
 * O acervo já serve a miniatura em '/acervo/versao/:id/miniatura', e aquela
 * rota exige perfil. Esta existe porque o acompanhamento não tem login, e o
 * caminho preguiçoso (tirar a guarda da rota do acervo) abriria a imagem de
 * QUALQUER versão a quem souber um id sequencial.
 *
 * Aqui o localizador é a chave: a imagem só sai se a versão for de um item do
 * pedido daquele localizador. Quem tem o código vê as folhas dele, e nada além.
 * O par (localizador, versao_id) é conferido no BANCO, numa consulta só, e não
 * por confiança no que o cliente mandou.
 *
 * Devolve null quando o par não casa e quando a miniatura não existe: para quem
 * chama, os dois são 404, e a distinção não interessa a quem está de fora.
 */
controller.getMiniaturaPorLocalizador = async (localizador, versaoId) => {
  return db.conn.oneOrNone(`
    SELECT mv.formato, mv.data_geracao, mv.conteudo,
           length(mv.conteudo) AS bytes
      FROM mapoteca.pedido AS p
      JOIN mapoteca.produto_pedido AS pp ON pp.pedido_id = p.id
      JOIN acervo.versao AS v ON v.uuid_versao = pp.uuid_versao
      JOIN acervo.miniatura_versao AS mv ON mv.versao_id = v.id
     WHERE p.localizador_pedido = $1
       AND v.id = $2
       AND mv.conteudo IS NOT NULL
     LIMIT 1
  `, [localizador, versaoId]);
};

controller.deletePedidos = async (pedidoIds, usuarioUuid, contexto) => {
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
        tabela: 'mapoteca.impressao_item',
        registroId: linha.id,
        operacao: 'D',
        antes: linha,
        usuarioUuid,
        contexto,
        // O mapa resolve o pedido da impressao por uma consulta a
        // produto_pedido, e aqui o item JA ESTA apagado quando esse caminho
        // rodaria. O pedido dono ja veio no JOIN acima: passa-lo evita a
        // consulta redundante e o nulo que ela devolveria.
        entidadeId: pedidoId
      });
    }

    for (const item of itens) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.produto_pedido',
        registroId: item.id,
        operacao: 'D',
        antes: item,
        usuarioUuid,
        contexto
      });
    }

    for (const pedido of existingOrders) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.pedido',
        registroId: pedido.id,
        operacao: 'D',
        antes: pedido,
        usuarioUuid,
        contexto
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
controller.criaProdutoPedido = async (produtoPedido, usuarioUuid, contexto) => {
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

    await conferirMetaDoItem(t, produtoPedido.pedido_id, produtoPedido.meta_pit_id);

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
      tabela: 'mapoteca.produto_pedido',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    });
  });
};

// VARIOS itens de UMA VEZ, no mesmo pedido.
//
// POR QUE EXISTE. A tela de adicionar item era de um produto por vez, e a
// demanda real e de conjunto: das 219 vezes em que um pedido levou folhas 25k da
// mesma folha 50k, 59 levaram as QUATRO e 62 levaram duas (medido na producao em
// 2026-08-13). Quatro folhas custavam quatro passagens pelo dialogo inteiro.
//
// UMA TRANSACAO, e nao N chamadas do client. Se a terceira falhasse, o pedido
// ficaria com duas folhas e ninguem saberia que faltam duas: e meia gravacao.
// Mesma razao do `registrarImpressao`, e o desenho aqui e o dele.
//
// O PEDIDO E UM SO, e vem de fora do array. Itens de pedidos diferentes no mesmo
// lote nao sao um lote: sao dois, e a auditoria de cada um tem agregado proprio.
//
// AS CONFERENCIAS SAO DE TODOS ANTES DE GRAVAR QUALQUER UM. Conferir dentro do
// laco de insercao gravaria os primeiros e so entao descobriria o defeito do
// ultimo -- dentro da transacao o ROLLBACK desfaria, mas a mensagem de erro
// nomearia o item errado e o custo de rede ja teria sido pago.
controller.criaProdutosPedido = async (pedidoId, itens, usuarioUuid, contexto) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    const pedidoExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.pedido WHERE id = $1`,
      [pedidoId]
    );
    if (!pedidoExiste) {
      throw new AppError('Pedido não encontrado', httpCode.NotFound);
    }

    // As versoes conferidas de UMA VEZ, e nao uma consulta por item: quatro
    // folhas dariam quatro idas ao banco para a mesma pergunta.
    const uuids = [...new Set(itens.map(i => i.uuid_versao).filter(Boolean))];
    if (uuids.length) {
      const achadas = await t.any(
        `SELECT uuid_versao FROM acervo.versao WHERE uuid_versao IN ($<uuids:csv>)`,
        { uuids }
      );
      if (achadas.length !== uuids.length) {
        const vivas = new Set(achadas.map(v => v.uuid_versao));
        const faltantes = uuids.filter(u => !vivas.has(u));
        throw new AppError(
          `As seguintes versões não foram encontradas: ${faltantes.join(', ')}`,
          httpCode.NotFound
        );
      }
    }

    // A meta se confere uma vez por valor distinto, e nao por item: a pergunta
    // que ela faz e sobre o PEDIDO, e o pedido e o mesmo para o lote inteiro.
    for (const meta of new Set(itens.map(i => i.meta_pit_id).filter(m => m != null))) {
      await conferirMetaDoItem(t, pedidoId, meta);
    }

    const linhas = itens.map(item => ({
      ...item,
      pedido_id: pedidoId,
      usuario_criacao_id: usuarioId,
      usuario_atualizacao_id: usuarioId
    }));

    const cs = new db.pgp.helpers.ColumnSet([
      ...PRODUTO_PEDIDO_COLS,
      'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    const query = db.pgp.helpers.insert(linhas, cs, {
      table: 'produto_pedido',
      schema: 'mapoteca'
    }) + ' RETURNING *';

    const criados = await t.many(query);

    // UM EVENTO POR ITEM, e nao um do lote. Quem abre o historico do pedido
    // pergunta "quando esta folha entrou", e um evento de quatro linhas nao
    // responde por nenhuma delas.
    //
    // SEM `entidadeId`, igual ao caminho de um item so: o mapa de auditoria
    // deriva o agregado de `linha.pedido_id` (mapa/mapoteca.js). Passar o id a
    // mao aqui criaria um segundo caminho para a mesma resposta.
    for (const criado of criados) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.produto_pedido',
        registroId: criado.id,
        operacao: 'I',
        depois: criado,
        usuarioUuid,
        contexto
      });
    }

    return criados.length;
  });
};

controller.atualizaProdutoPedido = async (produtoPedido, usuarioUuid, contexto) => {
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

    // O pedido vem do BANCO, e não do corpo: quem edita a partir da lista manda
    // o pedido_id de volta, e conferir contra o que ele mandou deixaria mover o
    // item e declarar a meta na mesma requisição sem ninguém validar o par.
    if (itemAtual) {
      await conferirMetaDoItem(t, itemAtual.pedido_id, produtoPedido.meta_pit_id);
    }

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
      tabela: 'mapoteca.produto_pedido',
      registroId: itemNovo.id,
      operacao: 'U',
      antes: itemAtual,
      depois: itemNovo,
      usuarioUuid,
      contexto
    });
  });
};

controller.deleteProdutosPedido = async (produtoPedidoIds, usuarioUuid, contexto) => {
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
        tabela: 'mapoteca.impressao_item',
        registroId: linha.id,
        operacao: 'D',
        antes: linha,
        usuarioUuid,
        contexto,
        // O pedido dono ja veio no JOIN: sem isto o mapa iria buscar o item
        // que este mesmo DELETE esta prestes a apagar.
        entidadeId: pedidoId
      });
    }

    for (const item of existingProducts) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.produto_pedido',
        registroId: item.id,
        operacao: 'D',
        antes: item,
        usuarioUuid,
        contexto
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
             ${ITEM_E_AVULSO} AS item_avulso,
             pp.descricao_avulso AS avulso_descricao,
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
    // `item_avulso` vai junto porque esta lista mistura DUAS coisas que o
    // operador trata de formas opostas: o item avulso (papel quadriculado,
    // carta de outro CGEO) nunca terá PDF no acervo e se imprime do original,
    // enquanto o item do acervo sem PDF é uma falta de verdade, que alguém tem
    // de carregar. Sem esta coluna o plugin anunciava os dois com a mesma
    // frase, mandando procurar arquivo que não existe.
    const itensSemPdf = itens
      .filter(i => !i.arquivo_id)
      .map(i => ({
        produto_pedido_id: i.produto_pedido_id,
        produto_nome: i.produto_nome,
        mi: i.mi,
        escala: i.escala,
        item_avulso: i.item_avulso,
        avulso_descricao: i.avulso_descricao,
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
 * Quem registra é o OPERADOR da mapoteca. É log operacional, e não gestão de
 * catálogo. O total impresso por item é a soma dos registros.
 */
controller.registrarImpressao = async (registros, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const ids = [...new Set(registros.map(r => r.produto_pedido_id))];

    // pedido_id vem junto porque o agregado da auditoria e o PEDIDO: o registro
    // nasce no item, mas quem le o historico procura pelo pedido dono dele.
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

    // `data_impressao` OMITIDA cai no default da coluna (agora), que e o caso
    // do plugin registrando o que acabou de sair da plotter. Informada, ela
    // manda: registrar na segunda o que se imprimiu na sexta tem de contar na
    // sexta, senao o consumo do papel cai no mes errado.
    const cs = new db.pgp.helpers.ColumnSet([
      'produto_pedido_id', 'quantidade',
      { name: 'observacao', def: null },
      'data_impressao',
      'usuario_uuid'
    ]);

    // A data se resolve AQUI, e nao por `skip` na ColumnSet: num insert de
    // varias linhas o pg-promise exige a MESMA lista de colunas em todas, e
    // pular a coluna numa delas fazia a consulta inteira devolver zero linha.
    // `new Date()` e o mesmo instante que o default da coluna daria.
    const agora = new Date();

    const query = db.pgp.helpers.insert(
      registros.map(r => ({
        ...r,
        data_impressao: r.data_impressao || agora,
        usuario_uuid: usuarioUuid
      })),
      cs,
      { table: 'impressao_item', schema: 'mapoteca' }
    ) + ' RETURNING *';

    const inseridos = await t.any(query);

    for (const registro of inseridos) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.impressao_item',
        registroId: registro.id,
        operacao: 'I',
        depois: registro,
        usuarioUuid,
        contexto,
        // O pedido dono ja saiu da consulta acima, para todos os itens de uma
        // vez: sem isto o mapa faria uma consulta a produto_pedido POR registro.
        entidadeId: pedidoDoItem.get(Number(registro.produto_pedido_id))
      });
    }
  });
};

/**
 * Corrige a DATA de um registro de impressao ja gravado.
 *
 * NAO e alterar o que foi impresso: a quantidade e o item nao passam por aqui.
 * E consertar QUANDO, que e transcricao, e a distincao e a mesma que separa
 * `corrigirTranscricao` de uma revisao do PIT.
 *
 * POR QUE A ROTA EXISTE: a impressao herdava a data da CARGA, e a carga de um
 * mes empilhava ali a impressao de varios. Sem ela, corrigir exigiria apagar e
 * recriar a linha, o que perde o registro e o rastro dele.
 *
 * A data continua importando depois de 2026-08-07, quando a impressao deixou de
 * contar como consumo (ver `getConsumoMensalPorTipo`): e ela que poe cada
 * impressao no mes certo do historico do pedido e da coluna de CONFERENCIA.
 *
 * O MOTIVO e obrigatorio e vai para o evento: mudar quando uma impressao
 * aconteceu muda o numero que a tela reporta naquele mes.
 */
controller.corrigirDataImpressao = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // As DUAS leituras sao separadas de proposito. O `pedido_id` vem do JOIN e
    // NAO e coluna de `impressao_item`: junto no `antes`, ele apareceria em
    // `campos_alterados` como campo que mudou, porque o `depois` (RETURNING *)
    // nao o tem. O diff compara linha com linha, e a linha tem de ser a mesma.
    const antes = await t.oneOrNone(
      'SELECT * FROM mapoteca.impressao_item WHERE id = $<id>', { id }
    );

    if (!antes) {
      throw new AppError('Registro de impressão não encontrado', httpCode.NotFound);
    }

    const dono = await t.one(
      'SELECT pedido_id FROM mapoteca.produto_pedido WHERE id = $<id>',
      { id: antes.produto_pedido_id }
    );

    const depois = await t.one(
      `UPDATE mapoteca.impressao_item
       SET data_impressao = $<dataImpressao>
       WHERE id = $<id>
       RETURNING *`,
      { id, dataImpressao: dados.data_impressao }
    );

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.impressao_item',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto,
      motivo: dados.motivo,
      // O agregado e o PEDIDO: o registro nasce no item, e quem le o historico
      // procura pelo pedido dono dele.
      entidadeId: dono.pedido_id
    });

    return { id, data_impressao: depois.data_impressao };
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

// Remove registros de impressão (correções, GERENTE da mapoteca)
controller.deleteImpressoes = async (impressaoIds, usuarioUuid, contexto) => {
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
        tabela: 'mapoteca.impressao_item',
        registroId: linha.id,
        operacao: 'D',
        antes: linha,
        usuarioUuid,
        contexto,
        entidadeId: pedidoId
      });
    }

    return t.any(
      `DELETE FROM mapoteca.impressao_item WHERE id IN ($<impressaoIds:csv>)`,
      { impressaoIds }
    );
  });
};

// Funções para Tipo de Material
//
// SÃO DOIS TOTAIS, e eles não são o mesmo:
//
//   estoque_total       o que existe em QUALQUER das quatro localizações;
//   estoque_disponivel  só Seção + Almoxarifado, que é o que de fato está aqui.
//
// 'Aquisição realizada' e 'Saldo no empenho' são material comprado e ainda não
// entregue. O ALERTA de estoque mínimo e a coluna "Estoque atual" da 7.2 do
// RPCMTec contam o disponível, e não o total: alertar contra o total esconderia
// a falta na Seção atrás de uma compra que ainda está com o fornecedor. Os dois
// saem na resposta porque quem olha a tela do material também quer saber o que
// vem vindo.
controller.getTiposMaterial = async () => {
  return db.conn.any(`
    SELECT tm.id, tm.nome, tm.descricao,
           tm.estoque_minimo, tm.ativo,
           COALESCE(est.estoque_total, 0) AS estoque_total,
           COALESCE(est.estoque_disponivel, 0) AS estoque_disponivel,
           COALESCE(est.localizacoes_armazenadas, 0) AS localizacoes_armazenadas,
           (
             tm.estoque_minimo IS NOT NULL AND
             COALESCE(est.estoque_disponivel, 0) < tm.estoque_minimo
           ) AS abaixo_minimo
    FROM mapoteca.tipo_material AS tm
    LEFT JOIN (
      SELECT tipo_material_id,
             SUM(quantidade) AS estoque_total,
             SUM(quantidade) FILTER (
               WHERE localizacao_id IN ($<naCasa:csv>)
             ) AS estoque_disponivel,
             COUNT(DISTINCT localizacao_id)::int AS localizacoes_armazenadas
      FROM mapoteca.estoque_material
      GROUP BY tipo_material_id
    ) est ON est.tipo_material_id = tm.id
    ORDER BY tm.nome
  `, { naCasa: LOCALIZACOES_NA_CASA });
};

controller.getTipoMaterialById = async (tipoMaterialId) => {
  return db.conn.task(async t => {
    // Buscar informações do tipo de material
    const tipoMaterial = await t.oneOrNone(`
      SELECT tm.id, tm.nome, tm.descricao, tm.estoque_minimo, tm.ativo
      FROM mapoteca.tipo_material AS tm
      WHERE tm.id = $1
    `, [tipoMaterialId]);

    if (!tipoMaterial) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    // O SALDO POR LOCALIZAÇÃO. Ele é derivado do livro desde 2026-08-08, e por
    // isso não há mais `PUT /estoque_material` que o edite: quem o move é um
    // movimento.
    const estoqueInfo = await t.any(`
      SELECT
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

    // O LIVRO deste material, os últimos primeiro. São os TRÊS tipos juntos, e
    // não só o consumo: a pergunta que a ficha responde é "o que aconteceu com
    // este material", e ela não se responde com um terço dos movimentos.
    const movimentosRecentes = await t.any(`
      SELECT
        mm.id, mm.tipo_material_id, mm.tipo_movimento_id,
        tmv.nome AS tipo_movimento_nome,
        mm.quantidade, mm.data_movimento,
        mm.localizacao_origem_id, lo.nome AS localizacao_origem_nome,
        mm.localizacao_destino_id, ld.nome AS localizacao_destino_nome,
        mm.motivo,
        mm.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
        mm.data_criacao
      FROM mapoteca.movimento_material AS mm
      INNER JOIN mapoteca.tipo_movimento_material AS tmv ON tmv.code = mm.tipo_movimento_id
      LEFT JOIN mapoteca.tipo_localizacao AS lo ON lo.code = mm.localizacao_origem_id
      LEFT JOIN mapoteca.tipo_localizacao AS ld ON ld.code = mm.localizacao_destino_id
      LEFT JOIN dgeo.usuario AS uc ON uc.id = mm.usuario_criacao_id
      WHERE mm.tipo_material_id = $1
      ORDER BY mm.data_movimento DESC, mm.id DESC
      LIMIT 10
    `, [tipoMaterialId]);

    // Estatísticas do CONSUMO, e não do livro inteiro: é o consumo que responde
    // "quanto deste material a Divisão gasta", e Entrada e Transferência não
    // gastam nada.
    const estatisticasConsumo = await t.oneOrNone(`
      SELECT
        SUM(quantidade) AS total_consumido,
        AVG(quantidade) AS media_por_consumo,
        COUNT(*) AS total_registros_consumo,
        MAX(data_movimento) AS ultimo_consumo
      FROM mapoteca.movimento_material
      WHERE tipo_material_id = $<tipoMaterialId>
        AND tipo_movimento_id = $<consumo>
    `, { tipoMaterialId, consumo: TIPO_MOVIMENTO_MATERIAL.CONSUMO });

    const naCasa = estoqueInfo.filter(
      e => LOCALIZACOES_NA_CASA.includes(Number(e.localizacao_id))
    );

    // Combinar resultados
    return {
      ...tipoMaterial,
      estoque: {
        registros: estoqueInfo,
        total: estoqueInfo.reduce((sum, item) => sum + parseFloat(item.quantidade), 0),
        // Seção + Almoxarifado, que é o que o alerta e a 7.2 do RPCMTec contam.
        disponivel: naCasa.reduce((sum, item) => sum + parseFloat(item.quantidade), 0),
        localizacoes: estoqueInfo.length
      },
      movimentos: {
        registros_recentes: movimentosRecentes
      },
      consumo: {
        total_consumido: parseFloat(estatisticasConsumo?.total_consumido || 0),
        media_por_consumo: parseFloat(estatisticasConsumo?.media_por_consumo || 0),
        total_registros: parseInt(estatisticasConsumo?.total_registros_consumo || 0),
        ultimo_consumo: estatisticasConsumo?.ultimo_consumo
      }
    };
  });
};

// `mapoteca.tipo_material` tambem nao tem coluna de escrituracao, e esta funcao
// recebia `usuarioUuid` e o ignorava. O autor passa a viver no evento.
//
// SQLSTATE de violacao de UNIQUE (23505). O nome do material virou UNICO em
// 2026-08-08, e a recusa diz algo que o usuario pode consertar: um 500 cru diria
// "erro no servidor" para quem so repetiu um nome que ja existe.
const UNIQUE_VIOLATION_MATERIAL = '23505';

const traduzirErroMaterial = err => {
  if (err && err.code === UNIQUE_VIOLATION_MATERIAL &&
      /unique_tipo_material_nome/.test(err.message || '')) {
    throw new AppError(
      'Já existe um material com este nome. O nome é único porque a tabela 7.2 ' +
      'do RPCMTec casa a linha do mês anterior por ele, e dois homônimos fariam ' +
      'a coluna "Estoque mês anterior" trazer o saldo do outro.',
      httpCode.Conflict,
      err
    );
  }
  throw err;
};

controller.criaTipoMaterial = async (tipoMaterial, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const cs = new db.pgp.helpers.ColumnSet([
      'nome',
      { name: 'descricao', def: null },
      { name: 'estoque_minimo', def: null },
      { name: 'ativo', def: true }
    ]);

    // RETURNING *, e nao RETURNING id: a linha inteira e o `dados_depois` do
    // evento. A rota continua devolvendo so o id, porque quem monta a resposta
    // e o valor devolvido aqui embaixo.
    const query = db.pgp.helpers.insert(tipoMaterial, cs, {
      table: 'tipo_material',
      schema: 'mapoteca'
    }) + ' RETURNING *';

    const criado = await t.one(query).catch(traduzirErroMaterial);

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.tipo_material',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    });

    return criado.id;
  });
};

controller.atualizaTipoMaterial = async (tipoMaterial, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'mapoteca.tipo_material', tipoMaterial.id, 'Tipo de material'
    );

    // Chave ausente = "não mexe": omitir `ativo` ressuscitava material
    // desativado, que é o caso que gerou a regra.
    await preserveOmitted(t, {
      schema: 'mapoteca',
      table: 'tipo_material',
      id: tipoMaterial.id,
      fields: ['ativo'],
      body: tipoMaterial
    });

    const cs = new db.pgp.helpers.ColumnSet([
      'nome',
      { name: 'descricao', def: null },
      { name: 'estoque_minimo', def: null },
      { name: 'ativo', def: true }
    ], { table: { table: 'tipo_material', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(tipoMaterial, cs) + ' WHERE id = $1 RETURNING *';

    const depois = await t.one(query, [tipoMaterial.id]).catch(traduzirErroMaterial);

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.tipo_material',
      registroId: tipoMaterial.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    });
  });
};

controller.deleteTiposMaterial = async (tipoMaterialIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // Verificar se todos os IDs existem.
    // SELECT * porque a linha inteira e o `dados_antes` do evento.
    const existingTypes = await t.any(
      `SELECT * FROM mapoteca.tipo_material WHERE id IN ($1:csv)`,
      [tipoMaterialIds]
    );

    if (existingTypes.length !== tipoMaterialIds.length) {
      const existingIds = existingTypes.map(type => type.id);
      const missingIds = tipoMaterialIds.filter(id => !existingIds.includes(parseInt(id)));
      throw new AppError(`Os seguintes tipos de material não foram encontrados: ${missingIds.join(', ')}`, httpCode.NotFound);
    }

    // O MOVIMENTO VEM ANTES DO ESTOQUE, e a ordem é a da causa: desde
    // 2026-08-08 o saldo é o acumulado do livro, então todo material com estoque
    // tem movimento, e a recusa por estoque diria a consequência em vez do
    // motivo. Apagar o material apagaria o LIVRO dele, que é a única coisa que
    // explica de onde veio o saldo: material com história se DESATIVA
    // (`ativo = false`), e não se exclui.
    const associatedMovement = await t.any(
      `SELECT tipo_material_id FROM mapoteca.movimento_material
       WHERE tipo_material_id IN ($1:csv)
       GROUP BY tipo_material_id`,
      [tipoMaterialIds]
    );

    if (associatedMovement.length > 0) {
      const typesWithMovement = associatedMovement.map(c => c.tipo_material_id);
      throw new AppError(
        `Não é possível excluir os tipos de material com IDs: ${typesWithMovement.join(', ')} pois possuem movimentos lançados. Desative o material em vez de excluí-lo: apagá-lo apagaria o histórico que explica o saldo.`,
        httpCode.BadRequest
      );
    }

    // O ESTOQUE, como segunda guarda. Ele não deveria existir sem movimento, e
    // se existir (carga direta, banco anterior à migração), a FK recusaria com
    // um 500 cru em vez desta frase.
    const associatedStock = await t.any(
      `SELECT tipo_material_id FROM mapoteca.estoque_material
       WHERE tipo_material_id IN ($1:csv)
       GROUP BY tipo_material_id`,
      [tipoMaterialIds]
    );

    if (associatedStock.length > 0) {
      const typesWithStock = associatedStock.map(s => s.tipo_material_id);
      throw new AppError(
        `Não é possível excluir os tipos de material com IDs: ${typesWithStock.join(', ')} pois possuem estoque associado. Desative o material em vez de excluí-lo.`,
        httpCode.BadRequest
      );
    }

    for (const tipo of existingTypes) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.tipo_material',
        registroId: tipo.id,
        operacao: 'D',
        antes: tipo,
        usuarioUuid,
        contexto
      });
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

// NÃO EXISTEM MAIS `criaEstoqueMaterial`, `atualizaEstoqueMaterial`,
// `deleteEstoqueMaterial` nem `transferirMaterial`, desde 2026-08-08.
//
// As quatro escreviam `mapoteca.estoque_material` DIRETO, sem data e sem motivo:
// o upsert REDEFINIA a quantidade, a transferência fazia dois UPDATEs, e nenhuma
// delas deixava rastro do que aconteceu, só do que ficou. O saldo era o único
// registro, e ele não responde "quando" nem "por quê".
//
// Hoje o saldo é o ACUMULADO do livro de movimentos, aplicado por gatilho. Uma
// porta de escrita ao lado do livro não é conveniência: é a garantia de que a
// soma do livro deixaria de bater com o saldo no primeiro uso, e aí nenhuma das
// duas explicaria mais nada. Cada uma das quatro tem hoje o seu movimento:
//
//   criar/definir estoque  ->  Entrada (tipo 1);
//   transferir             ->  Transferência (tipo 2);
//   corrigir para menos    ->  Consumo (tipo 3), quando o material de fato saiu.
//
// NÃO HÁ AJUSTE DE SALDO desde 2026-08-08, quando a Contagem (tipo 4) foi
// extinta: o saldo tem de estar certo pelos três movimentos acima, e lançamento
// ERRADO se conserta editando ou apagando a linha errada -- o gatilho desfaz o
// efeito dela e o saldo volta exato.

// ---------------------------------------------------------------------------
// O LIVRO DE MOVIMENTOS
// ---------------------------------------------------------------------------

const FILTROS_MOVIMENTO = {
  data_inicio: 'mm.data_movimento >= $<data_inicio>',
  data_fim: 'mm.data_movimento <= $<data_fim>',
  tipo_material_id: 'mm.tipo_material_id = $<tipo_material_id>',
  tipo_movimento_id: 'mm.tipo_movimento_id = $<tipo_movimento_id>'
};

const SELECT_MOVIMENTO = `
  SELECT mm.id, mm.tipo_material_id, tm.nome AS tipo_material_nome,
         mm.tipo_movimento_id, tmv.nome AS tipo_movimento_nome,
         mm.quantidade, mm.data_movimento,
         mm.localizacao_origem_id, lo.nome AS localizacao_origem_nome,
         mm.localizacao_destino_id, ld.nome AS localizacao_destino_nome,
         mm.motivo,
         mm.usuario_criacao_id, uc.nome AS usuario_criacao_nome,
         mm.data_criacao, mm.usuario_atualizacao_id,
         ua.nome AS usuario_atualizacao_nome, mm.data_atualizacao
  FROM mapoteca.movimento_material AS mm
  INNER JOIN mapoteca.tipo_material AS tm ON tm.id = mm.tipo_material_id
  INNER JOIN mapoteca.tipo_movimento_material AS tmv ON tmv.code = mm.tipo_movimento_id
  LEFT JOIN mapoteca.tipo_localizacao AS lo ON lo.code = mm.localizacao_origem_id
  LEFT JOIN mapoteca.tipo_localizacao AS ld ON ld.code = mm.localizacao_destino_id
  LEFT JOIN dgeo.usuario AS uc ON uc.id = mm.usuario_criacao_id
  LEFT JOIN dgeo.usuario AS ua ON ua.id = mm.usuario_atualizacao_id
`;

controller.getMovimentosMaterial = async (filtros = null) => {
  const condicoes = Object.entries(FILTROS_MOVIMENTO)
    .filter(([chave]) => filtros && filtros[chave] !== undefined && filtros[chave] !== null)
    .map(([, sql]) => sql);

  const onde = condicoes.length > 0 ? ` WHERE ${condicoes.join(' AND ')}` : '';

  // Do mais recente para o mais antigo, e o id desempata: dois movimentos no
  // mesmo dia sairiam em ordem que muda entre duas chamadas iguais.
  return db.conn.any(
    `${SELECT_MOVIMENTO}${onde} ORDER BY mm.data_movimento DESC, mm.id DESC`,
    filtros || {}
  );
};

controller.getMovimentoMaterialById = async (id) => {
  const movimento = await db.conn.oneOrNone(
    `${SELECT_MOVIMENTO} WHERE mm.id = $<id>`, { id }
  );

  if (!movimento) {
    throw new AppError('Movimento de material não encontrado', httpCode.NotFound);
  }

  return movimento;
};

/**
 * Consumo de material por mês, do LIVRO e só do tipo Consumo.
 *
 * O CONSUMO É O DECLARADO. É o que a Seção lança, e nada além disso. Decisão do
 * chefe em 2026-08-07, depois que a 7.2 de julho saiu com "consumo 802, estoque
 * 64": os 802 vinham da impressão, os 64 de uma contagem digitada, e nenhum
 * consumo de papel fora lançado no ano inteiro. Um número media o mundo, o outro
 * media o cadastro, e a subtração entre eles não significava nada.
 *
 * NÃO EXISTE MAIS `quantidade_impressa` AO LADO. Ela era o número de
 * conferência, derivado da mídia do item impresso, e morreu em 2026-08-08 com a
 * ponte impressão -> consumo: produto impresso e rolo de papel são coisas
 * separadas, e `tipo_material.tipo_midia_id` era a única coisa que ligava as
 * duas. Sem a coluna não há como saber qual papel uma impressão gastou -- e essa
 * é justamente a afirmação que a ponte fazia e não podia sustentar.
 *
 * A FONTE ÚNICA É O QUE TORNA A CONTA FECHÁVEL. O gatilho do livro baixa o
 * saldo: lançando o consumo, o estoque acompanha, e as duas colunas da 7.2
 * passam a falar da mesma coisa.
 */
controller.getConsumoMensalPorTipo = async (ano = new Date().getFullYear()) => {
  return db.conn.any(`
    WITH meses AS (
      SELECT generate_series(1, 12) AS mes
    ),
    tipos_material AS (
      SELECT id, nome FROM mapoteca.tipo_material
    ),
    declarado AS (
      SELECT
        tipo_material_id,
        EXTRACT(MONTH FROM data_movimento) AS mes,
        SUM(quantidade) AS quantidade
      FROM mapoteca.movimento_material
      WHERE tipo_movimento_id = $<consumo>
        AND EXTRACT(YEAR FROM data_movimento) = $<ano>
      GROUP BY tipo_material_id, EXTRACT(MONTH FROM data_movimento)
    )
    SELECT
      tm.id AS tipo_material_id,
      tm.nome AS tipo_material_nome,
      m.mes,
      COALESCE(d.quantidade, 0) AS quantidade
    FROM tipos_material tm
    CROSS JOIN meses m
    LEFT JOIN declarado d
      ON d.tipo_material_id = tm.id AND d.mes = m.mes
    ORDER BY tm.nome, m.mes
  `, { ano, consumo: TIPO_MOVIMENTO_MATERIAL.CONSUMO });
};

// O EFEITO DE GATILHO NO ESTOQUE, e por que ele vira evento
// ---------------------------------------------------------------------------
// O gatilho de `mapoteca.movimento_material` (er/mapoteca.sql) mexe em
// `mapoteca.estoque_material`: o que está em `localizacao_origem_id` sai, e o
// que está em `localizacao_destino_id` entra. Auditando só o movimento, o
// histórico do estoque ficaria VAZIO no exato momento em que o estoque muda, e a
// tela de estoque não teria como explicar de onde veio o saldo.
//
// A saída é o controller LER as linhas de estoque afetadas antes e depois,
// dentro da mesma transação, e gravar o evento com `origem: 'gatilho'` -- porque
// a pessoa não mexeu naquela linha diretamente, e um evento indistinguível de
// uma edição manual diria que alguém a editou.
//
// A alternativa (declarar o estoque derivado e não auditá-lo) foi descartada: o
// estoque é o número que a mapoteca confere, e "derivado" não é resposta para
// quem pergunta por que o saldo caiu.
const contextoDeGatilho = contexto => ({ ...(contexto || {}), origem: 'gatilho' });

// O saldo de UMA localização de um material. Devolve null quando a linha ainda
// não existe: o gatilho a CRIA no lado que recebe, então o `antes` pode ser
// legitimamente nulo e o evento é uma inserção.
const lerEstoqueLocal = (t, tipoMaterialId, localizacaoId) =>
  localizacaoId == null
    ? Promise.resolve(null)
    : t.oneOrNone(
      `SELECT * FROM mapoteca.estoque_material
        WHERE tipo_material_id = $<tipoMaterialId> AND localizacao_id = $<localizacaoId>`,
      { tipoMaterialId, localizacaoId }
    );

// As linhas de estoque que UM movimento pode tocar: até duas, uma por lado.
// Numa alteração, o movimento antigo e o novo podem tocar materiais e
// localizações diferentes -- por isso a lista é a UNIÃO dos dois, e não a do
// novo. Ler só o novo perderia metade do efeito, que é justamente a devolução.
const ladosTocados = (...movimentos) => {
  const pares = new Map();
  for (const mov of movimentos) {
    if (!mov) continue;
    for (const local of [mov.localizacao_origem_id, mov.localizacao_destino_id]) {
      if (local == null) continue;
      pares.set(`${mov.tipo_material_id}|${local}`, {
        tipoMaterialId: Number(mov.tipo_material_id),
        localizacaoId: Number(local)
      });
    }
  }
  return [...pares.values()];
};

const lerLados = async (t, lados) => {
  const mapa = new Map();
  for (const { tipoMaterialId, localizacaoId } of lados) {
    mapa.set(
      `${tipoMaterialId}|${localizacaoId}`,
      await lerEstoqueLocal(t, tipoMaterialId, localizacaoId)
    );
  }
  return mapa;
};

// Grava o evento do estoque quando (e só quando) o gatilho mexeu nele. Sem a
// comparação, um movimento que não muda quantidade nenhuma deixaria uma linha de
// histórico dizendo que o estoque mudou.
const registrarEfeitoNoEstoque = async (t, { antes, depois, usuarioUuid, contexto }) => {
  if (!depois) return;
  if (antes && String(antes.quantidade) === String(depois.quantidade)) return;

  await auditoriaCtrl.registrar(t, {
    tabela: 'mapoteca.estoque_material',
    registroId: depois.id,
    operacao: antes ? 'U' : 'I',
    antes,
    depois,
    usuarioUuid,
    contexto
  });
};

const registrarEfeitoDosLados = async (t, { lados, antes, usuarioUuid, contexto }) => {
  for (const { tipoMaterialId, localizacaoId } of lados) {
    await registrarEfeitoNoEstoque(t, {
      antes: antes.get(`${tipoMaterialId}|${localizacaoId}`),
      depois: await lerEstoqueLocal(t, tipoMaterialId, localizacaoId),
      usuarioUuid,
      contexto: contextoDeGatilho(contexto)
    });
  }
};

// SQLSTATE de violação de CHECK. Os dois CHECK do livro dizem coisas que quem
// lança pode consertar, e um 500 cru diria "erro no servidor" para quem só
// escolheu a localização errada. O `RAISE` do gatilho (saldo insuficiente) já
// chega com a frase que ensina o conserto, e é reemitido como 400.
const CHECK_VIOLATION = '23514';

const traduzirErroMovimento = err => {
  if (err && err.code === CHECK_VIOLATION &&
      /movimento_material_forma/.test(err.message || '')) {
    throw new AppError(
      'A forma deste movimento não confere com o tipo escolhido. ' +
      'Entrada não tem origem; Transferência tem origem e destino diferentes; ' +
      'Consumo sai da Seção e não tem destino. Não existe movimento de ajuste: ' +
      'o saldo se corrige pelo movimento que de fato aconteceu, e lançamento ' +
      'errado se conserta editando ou apagando a linha errada.',
      httpCode.BadRequest,
      err
    );
  }
  // A mensagem do gatilho já ensina o conserto ("transfira para a Seção antes"),
  // então ela sobe inteira em vez de virar a genérica de 500.
  if (err && err.message &&
      (err.message.includes('Estoque insuficiente') || err.message.includes('não tem estoque em'))) {
    throw new AppError(err.message, httpCode.BadRequest, err);
  }
  throw err;
};

const COLUNAS_MOVIMENTO = [
  'tipo_material_id', 'tipo_movimento_id', 'quantidade', 'data_movimento',
  { name: 'localizacao_origem_id', def: null },
  { name: 'localizacao_destino_id', def: null },
  { name: 'motivo', def: null }
];

controller.criaMovimentoMaterial = async (movimento, usuarioUuid, contexto) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    const tipoMaterialExiste = await t.oneOrNone(
      `SELECT id FROM mapoteca.tipo_material WHERE id = $<id>`,
      { id: movimento.tipo_material_id }
    );

    if (!tipoMaterialExiste) {
      throw new AppError('Tipo de material não encontrado', httpCode.NotFound);
    }

    const lados = ladosTocados(movimento);
    const estoqueAntes = await lerLados(t, lados);

    const cs = new db.pgp.helpers.ColumnSet([
      ...COLUNAS_MOVIMENTO, 'usuario_criacao_id', 'usuario_atualizacao_id'
    ]);

    // RETURNING * porque a linha gravada é o `dados_depois` do evento.
    const query = db.pgp.helpers.insert(
      { ...movimento, usuario_criacao_id: usuarioId, usuario_atualizacao_id: usuarioId },
      cs,
      { table: 'movimento_material', schema: 'mapoteca' }
    ) + ' RETURNING *';

    const criado = await t.one(query).catch(traduzirErroMovimento);

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.movimento_material',
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    });

    // O saldo DEPOIS, relido do banco: o gatilho já rodou, e o que interessa
    // auditar é o que o banco gravou, não a subtração que o JS faria de cabeça.
    await registrarEfeitoDosLados(t, { lados, antes: estoqueAntes, usuarioUuid, contexto });

    return criado.id;
  });
};

controller.atualizaMovimentoMaterial = async (movimento, usuarioUuid, contexto) => {
  const usuarioId = await getUsuarioId(usuarioUuid);

  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'mapoteca.movimento_material', movimento.id, 'Movimento de material'
    );

    const lados = ladosTocados(antes, movimento);
    const estoqueAntes = await lerLados(t, lados);

    const cs = new db.pgp.helpers.ColumnSet([
      ...COLUNAS_MOVIMENTO, 'usuario_atualizacao_id', 'data_atualizacao'
    ], { table: { table: 'movimento_material', schema: 'mapoteca' } });

    const query = db.pgp.helpers.update(
      { ...movimento, usuario_atualizacao_id: usuarioId, data_atualizacao: new Date() },
      cs
    ) + ' WHERE id = $1 RETURNING *';

    const depois = await t.one(query, [movimento.id]).catch(traduzirErroMovimento);

    await auditoriaCtrl.registrar(t, {
      tabela: 'mapoteca.movimento_material',
      registroId: movimento.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    });

    await registrarEfeitoDosLados(t, { lados, antes: estoqueAntes, usuarioUuid, contexto });
  });
};

controller.deleteMovimentosMaterial = async (movimentoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    // SELECT * porque a linha inteira é o `dados_antes` do evento.
    const existentes = await t.any(
      `SELECT * FROM mapoteca.movimento_material WHERE id IN ($1:csv)`,
      [movimentoIds]
    );

    if (existentes.length !== movimentoIds.length) {
      const achados = existentes.map(m => m.id);
      const faltando = movimentoIds.filter(id => !achados.includes(parseInt(id)));
      throw new AppError(
        `Os seguintes movimentos não foram encontrados: ${faltando.join(', ')}`,
        httpCode.NotFound
      );
    }

    // UM DELETE POR LINHA, e não o `IN (...)`.
    //
    // O gatilho é FOR EACH ROW: num delete em lote ele dispara N vezes, cada uma
    // desfazendo aquele movimento. Num comando só, o JS enxergaria apenas o
    // saldo inicial e o final, e os N eventos de estoque teriam de ser
    // INVENTADOS por subtração -- que é exatamente o que o desenho proíbe (os
    // dois lados do diff saem do BANCO). Apagando linha a linha, cada evento traz
    // uma leitura de verdade, e o `loteId` do contexto é o mesmo em todos: é ele
    // que diz que foi um ato só.
    for (const movimento of existentes) {
      const lados = ladosTocados(movimento);
      const estoqueAntes = await lerLados(t, lados);

      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.movimento_material',
        registroId: movimento.id,
        operacao: 'D',
        antes: movimento,
        usuarioUuid,
        contexto
      });

      await t.none(
        `DELETE FROM mapoteca.movimento_material WHERE id = $<id>`,
        { id: movimento.id }
      ).catch(traduzirErroMovimento);

      await registrarEfeitoDosLados(t, { lados, antes: estoqueAntes, usuarioUuid, contexto });
    }

    return existentes;
  });
};

// `getConsumoMaterialById` SAIU em 2026-08-08. Quem responde por um lançamento
// hoje é `getMovimentoMaterialById`, que serve os três tipos: uma leitura só
// para o consumo faria a tela do livro ter dois caminhos, e o segundo nasceria
// sem os campos de origem e destino.

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