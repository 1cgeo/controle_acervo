// Path: lib\recursos.js
'use strict'

const path = require('path')

// Registro dos recursos da mapoteca. Cada entrada aponta para as CHAVES do
// modulo de schema da feature no server/, e o CLI le dali o contrato (campos,
// tipos, obrigatorios). Nada de contrato e copiado para ca: se o schema mudar, o
// CLI muda junto no mesmo commit. Este arquivo so guarda o que NAO esta no
// schema: o caminho da rota, a forma do CRUD e a escolha de apresentacao.
//
// A forma do CRUD da mapoteca difere da de outras APIs do mesmo stack, e e por
// isso que ela precisa estar declarada aqui:
//   PUT    e na COLECAO, com o id dentro do CORPO (nao na URL);
//   DELETE e na COLECAO, com um ARRAY de ids no corpo, ou seja, e sempre em
//          LOTE, mesmo quando o agente quer excluir um so.
// Um CLI que assumisse o formato /recurso/:id levaria 404 no PUT e apagaria
// nada no DELETE, sem nunca dizer por que.
//
// O require e preguicoso (funcao) para que um schema faltando quebre so o
// comando daquele recurso, e nao o CLI inteiro.

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

/**
 * O modulo de schema VIVO da mapoteca, tal como o Express o usa. Tudo que o CLI
 * sabe sobre a forma dos corpos sai daqui, em tempo de execucao.
 */
function carregarSchema () {
  return require(path.join(RAIZ_SERVER, 'mapoteca', 'mapoteca_schema'))
}

// Todos os recursos da mapoteca saem do mesmo modulo de schema; o que muda por
// recurso e QUAL chave desse modulo vale para criar, atualizar e excluir.
function modulo (criar, atualizar, ids, filtro) {
  return () => {
    const models = carregarSchema()
    return {
      criar: models[criar],
      atualizar: models[atualizar],
      ids: models[ids],
      listarQuery: filtro ? models[filtro] : null
    }
  }
}

const RECURSOS = {
  pedido: {
    nome: 'pedido da mapoteca',
    caminho: '/mapoteca/pedido',
    schema: modulo('pedido', 'pedidoAtualizacao', 'pedidoIds'),
    chaveIds: 'pedido_ids',
    // Colunas padrao da listagem compacta. O listar do backend devolve tambem
    // os campos de auditoria e os contadores de impressao, que sao ruido para
    // quem so quer ver a fila: ficam de fora daqui e so aparecem com --campos
    // explicito ou --json.
    colunas: [
      'id', 'data_pedido', 'cliente_nome', 'situacao_pedido_nome', 'prazo',
      'documento_solicitacao', 'quantidade_produtos', 'localizador_pedido'
    ],
    anexo: true
  },

  cliente: {
    nome: 'cliente (OM ou solicitante civil)',
    caminho: '/mapoteca/cliente',
    schema: modulo('cliente', 'clienteAtualizacao', 'clienteIds'),
    chaveIds: 'cliente_ids',
    colunas: [
      'id', 'nome', 'tipo_cliente_nome', 'ponto_contato_principal',
      'total_pedidos', 'pedidos_em_andamento', 'data_ultimo_pedido'
    ]
  },

  item: {
    nome: 'item do pedido (produto_pedido)',
    caminho: '/mapoteca/produto_pedido',
    schema: modulo('produtoPedido', 'produtoPedidoAtualizacao', 'produtoPedidoIds'),
    chaveIds: 'produto_pedido_ids',
    // Nao ha GET de colecao nem GET por id de item: os itens so aparecem dentro
    // do GET /pedido/:id. Por isso "mapoteca pedido itens --id N" existe.
    semListar: true,
    colunas: [
      'id', 'mi', 'produto_nome', 'escala', 'quantidade', 'quantidade_fornecida',
      'tipo_midia_nome', 'quantidade_impressa', 'quantidade_restante'
    ]
  },

  plotter: {
    nome: 'plotter',
    caminho: '/mapoteca/plotter',
    schema: modulo('plotter', 'plotterAtualizacao', 'plotterIds'),
    chaveIds: 'plotter_ids',
    colunas: ['id', 'nr_serie', 'modelo', 'ativo', 'data_aquisicao', 'vida_util']
  },

  manutencao: {
    nome: 'manutencao de plotter',
    caminho: '/mapoteca/manutencao_plotter',
    schema: modulo('manutencaoPlotter', 'manutencaoPlotterAtualizacao', 'manutencaoPlotterIds'),
    chaveIds: 'manutencao_ids',
    colunas: ['id', 'plotter_id', 'data_manutencao', 'valor', 'descricao']
  },

  tipo_material: {
    nome: 'tipo de material de consumo',
    caminho: '/mapoteca/tipo_material',
    schema: modulo('tipoMaterial', 'tipoMaterialAtualizacao', 'tipoMaterialIds'),
    chaveIds: 'tipo_material_ids',
    colunas: ['id', 'nome', 'descricao', 'estoque_minimo', 'meta_anual', 'ativo']
  },

  estoque: {
    nome: 'estoque de material',
    caminho: '/mapoteca/estoque_material',
    schema: modulo('estoqueMaterial', 'estoqueMaterialAtualizacao', 'estoqueMaterialIds'),
    chaveIds: 'estoque_material_ids',
    colunas: ['id', 'tipo_material_id', 'tipo_material_nome', 'quantidade', 'localizacao_nome']
  },

  consumo: {
    nome: 'consumo de material',
    caminho: '/mapoteca/consumo_material',
    schema: modulo('consumoMaterial', 'consumoMaterialAtualizacao', 'consumoMaterialIds', 'consumoMaterialFiltro'),
    chaveIds: 'consumo_material_ids',
    colunas: ['id', 'tipo_material_id', 'tipo_material_nome', 'quantidade', 'data_consumo']
  }
}

// Os dominios da mapoteca sao GET publicos (servem para popular os selects do
// client web) e ficam sob /api/mapoteca/dominio/<sub>. Nao ha CRUD: sao tabelas
// fixas do banco, alteradas por migracao.
const DOMINIOS = [
  'tipo_cliente',
  'situacao_pedido',
  'tipo_midia',
  'canal_recebimento',
  'tipo_localizacao',
  'forma_entrega'
]

// Extensoes aceitas no anexo do pedido. Espelha a lista do multer
// (mapoteca/anexo_pedido_upload.js); conferir aqui evita gastar o upload de um
// arquivo grande para receber 400 no fim.
const EXTENSOES_ANEXO = [
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff',
  '.doc', '.docx', '.odt', '.xls', '.xlsx', '.ods', '.csv', '.txt', '.rtf',
  '.zip', '.rar', '.7z', '.kml', '.kmz', '.geojson', '.gpkg', '.dxf', '.dwg',
  '.xml', '.json', '.p7s'
]

const MAX_BYTES_ANEXO = 100 * 1024 * 1024

const MIMES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.zip': 'application/zip',
  '.kml': 'application/vnd.google-earth.kml+xml',
  '.kmz': 'application/vnd.google-earth.kmz',
  '.geojson': 'application/geo+json',
  '.json': 'application/json',
  '.xml': 'application/xml'
}

// Relatorios anuais da mapoteca (reproduzem as abas da planilha de controle) e
// as visoes do dashboard proprio dela que aceitam recorte por ano. O CLI nao
// remonta nenhum deles: so escolhe a rota e formata a saida.
const RELATORIOS = {
  mil: { caminho: '/mapoteca/relatorio/pedidos_mil', nome: 'pedidos militares (uma linha por pedido)' },
  detalhado: { caminho: '/mapoteca/relatorio/pedidos_detalhado', nome: 'entregas item a item' },
  civ: { caminho: '/mapoteca/relatorio/pedidos_civ', nome: 'pedidos civis e LAI' },
  tematicos: { caminho: '/mapoteca/relatorio/tematicos', nome: 'producao tematica' },
  impressao: { caminho: '/mapoteca/relatorio/impressao_detalhada', nome: 'impressao detalhada (recorte do detalhado)' },
  resumo: { caminho: '/mapoteca/relatorio/pedidos_resumo', nome: 'uma linha por pedido, com o entregue consolidado' },
  entregas_produto: { caminho: '/mapoteca/dashboard/entregas_por_tipo_produto', nome: 'entregas por tipo de produto e escala' },
  entregas_midia: { caminho: '/mapoteca/dashboard/entregas_por_midia', nome: 'entregas por tipo de midia' },
  entregas_mes: { caminho: '/mapoteca/dashboard/entregas_por_mes', nome: 'entregas mes a mes' },
  operacoes: { caminho: '/mapoteca/dashboard/operacoes_apoiadas', nome: 'operacoes apoiadas no ano' }
}

function obter (chave) {
  const recurso = RECURSOS[chave]
  if (!recurso) {
    throw new Error(
      `Recurso desconhecido: "${chave}". Disponiveis: ${Object.keys(RECURSOS).join(', ')}.`
    )
  }
  return recurso
}

function listarChaves () {
  return Object.keys(RECURSOS)
}

module.exports = {
  carregarSchema,
  RECURSOS,
  DOMINIOS,
  RELATORIOS,
  EXTENSOES_ANEXO,
  MAX_BYTES_ANEXO,
  MIMES,
  obter,
  listarChaves
}
