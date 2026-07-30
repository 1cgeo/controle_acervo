// Path: mapoteca\mapoteca_schema.js
'use strict'

const Joi = require('joi')

const { SITUACAO_PEDIDO, TIPO_LOCALIZACAO, TIPO_CLIENTE, TIPO_MIDIA, FORMA_ENTREGA, TIPO_ANEXO_PEDIDO, CANAL_RECEBIMENTO, TIPO_ESCALA, TIPO_PRODUTO } = require('../utils/domain_constants')

const models = {}

// Esquemas para Cliente
models.clienteId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.clienteIds = Joi.object().keys({
  cliente_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.cliente = Joi.object().keys({
  nome: Joi.string().max(255).required(),
  ponto_contato_principal: Joi.string().max(255).allow(null, ''),
  endereco_entrega_principal: Joi.string().max(255).allow(null, ''),
  tipo_cliente_id: Joi.number().integer().valid(...Object.values(TIPO_CLIENTE)).required()
})

models.clienteAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  nome: Joi.string().max(255).required(),
  ponto_contato_principal: Joi.string().max(255).allow(null, ''),
  endereco_entrega_principal: Joi.string().max(255).allow(null, ''),
  tipo_cliente_id: Joi.number().integer().valid(...Object.values(TIPO_CLIENTE)).required()
})

// Esquemas para Pedido
models.pedidoId = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Download da carta de um item: o pedido mais o uuid do arquivo. O par e conferido
// no banco (o uuid tem de ser a carta de um item DAQUELE pedido), senao a rota
// viraria download do acervo inteiro com perfil de mapoteca.
models.arquivoImpressaoParams = Joi.object().keys({
  id: Joi.number().integer().required(),
  uuid_arquivo: Joi.string().guid().required()
})

models.pedidoIds = Joi.object().keys({
  pedido_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

// Campos compartilhados entre criação e atualização de pedido.
// RN02: pedido concluído exige data_atendimento.
// RN03: pedido cancelado exige motivo_cancelamento.
const pedidoBase = {
  // raw(): preserva a string 'AAAA-MM-DD' que o formulario manda. As colunas
  // sao DATE, entao nenhum fuso entra no caminho (nem o do Node, nem o da
  // sessao do banco). Sem raw(), o Joi converteria para Date e o D-1 voltaria.
  data_pedido: Joi.date().raw().required(),
  data_atendimento: Joi.when('situacao_pedido_id', {
    is: SITUACAO_PEDIDO.CONCLUIDO,
    then: Joi.date().raw().min(Joi.ref('data_pedido')).required(),
    otherwise: Joi.date().raw().min(Joi.ref('data_pedido')).allow(null)
  }),
  cliente_id: Joi.number().integer().required(),
  situacao_pedido_id: Joi.number().integer().valid(...Object.values(SITUACAO_PEDIDO)).required(),
  ponto_contato: Joi.string().max(255).allow(null, ''),
  documento_solicitacao: Joi.string().max(255).allow(null, ''),
  documento_solicitacao_nup: Joi.string().max(255).allow(null, ''),
  endereco_entrega: Joi.string().allow(null, ''),
  palavras_chave: Joi.array().items(Joi.string()).default([]),
  operacao: Joi.string().allow(null, ''),
  prazo: Joi.date().raw().allow(null),
  demandante: Joi.string().max(255).allow(null, ''),
  omds: Joi.string().max(255).allow(null, ''),
  previsto_pit: Joi.boolean().default(false),
  // Código do item da meta do PIT (ex.: '4.1'). NÃO se deriva do material: em
  // 2026 a Meta 4 é impressão e os sub-itens são o material (4.1 sulfite, 4.2
  // tyvek, 4.3 glossy), mas o PIT é reescrito todo ano e a numeração muda com
  // ele. Ver migrations/2026-07-30_pedido_meta_pit.sql.
  meta_pit: Joi.when('previsto_pit', {
    is: true,
    then: Joi.string().max(10).required(),
    otherwise: Joi.string().max(10).allow(null, '')
  }),
  // Campos de pedido de CIVIL (opcionais; NULL para OM)
  canal_recebimento_id: Joi.number().integer().valid(...Object.values(CANAL_RECEBIMENTO)).allow(null),
  municipio: Joi.string().max(255).allow(null, ''),
  qtd_imagens: Joi.number().integer().min(0).allow(null),
  observacao: Joi.string().allow(null, ''),
  localizador_envio: Joi.string().allow(null, ''),
  observacao_envio: Joi.string().allow(null, ''),
  // Anotação da equipe. observacao e observacao_envio SAEM na consulta pública
  // por localizador; esta não sai, e é onde vai o que é só nosso.
  observacao_interna: Joi.string().allow(null, ''),
  motivo_cancelamento: Joi.when('situacao_pedido_id', {
    is: SITUACAO_PEDIDO.CANCELADO,
    then: Joi.string().required(),
    otherwise: Joi.string().allow(null, '')
  })
}

models.pedido = Joi.object().keys(pedidoBase)

// Na CRIAÇÃO o default é legítimo (não existe valor anterior). Na ATUALIZAÇÃO
// ele é perda silenciosa: a chave ausente passa a valer o default e sobrescreve
// o que estava gravado. Por isso os campos com .default() são redeclarados sem
// default aqui, e o controller preserva o valor atual quando a chave não vem.
models.pedidoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ...pedidoBase,
  palavras_chave: Joi.array().items(Joi.string()),
  previsto_pit: Joi.boolean(),
  // Solto aqui pela mesma razão de previsto_pit: quem edita a partir da LISTA
  // não recebe meta_pit de volta, e a condicional do pedidoBase reprovaria o
  // corpo que só omite a chave. O controller preserva o valor atual (ver
  // preserveOmitted) e reprova a combinação inválida depois de mesclar.
  meta_pit: Joi.string().max(10).allow(null, '')
})

models.pedidoLocalizador = Joi.object().keys({
  localizador: Joi.string().pattern(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/).required()
})

// Esquemas para Produto do Pedido
models.produtoPedidoIds = Joi.object().keys({
  produto_pedido_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

// RN08: todo item de pedido referencia EXATAMENTE UM produto identificado.
//
// Até 2026-07-30 isso queria dizer "uma versão do acervo", e uuid_versao era
// obrigatório. Hoje o destino pode ser o acervo OU um produto avulso, e o
// .xor() abaixo é o que garante o "exatamente um": sem ele passaria item sem
// destino nenhum, e o CHECK do banco viraria erro 500 em vez de 400 limpo.
const produtoPedidoBase = {
  uuid_versao: Joi.string().guid().allow(null),
  // O avulso se descreve no proprio item, sem catalogo: ele e impresso de
  // OCASIAO, e o que merecer cadastro estavel merece estar no acervo. A
  // descricao guarda a dimensao fisica e SAI na consulta publica do cliente.
  nome_avulso: Joi.string().max(255).allow(null, ''),
  descricao_avulso: Joi.string().allow(null, ''),
  pedido_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().min(1).required(),
  quantidade_fornecida: Joi.number().integer().min(0).allow(null),
  tipo_midia_id: Joi.number().integer().valid(...Object.values(TIPO_MIDIA)).required(),
  tipo_midia_fornecida_id: Joi.number().integer().valid(...Object.values(TIPO_MIDIA)).allow(null),
  forma_entrega_id: Joi.number().integer().valid(...Object.values(FORMA_ENTREGA)).allow(null),
  // raw(): preserva a string da data para evitar shift de fuso na coluna DATE
  data_entrega: Joi.date().raw().allow(null),
  observacao: Joi.string().allow(null, ''),
  producao_especifica: Joi.boolean().default(false)
}

// .xor: um e só um dos dois destinos. É a RN08 dita em Joi, e devolve 400 com
// mensagem em vez de deixar o CHECK do banco estourar 500.
models.produtoPedido = Joi.object()
  .keys(produtoPedidoBase)
  .xor('uuid_versao', 'nome_avulso')

// Sem .default() na atualização: ver o comentário em pedidoAtualizacao
models.produtoPedidoAtualizacao = Joi.object()
  .keys({
    id: Joi.number().integer().required(),
    ...produtoPedidoBase,
    producao_especifica: Joi.boolean()
  })
  .xor('uuid_versao', 'nome_avulso')

models.produtoPedidoId = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Esquemas para Impressão (plugin QGIS da mapoteca)
models.registroImpressao = Joi.object().keys({
  registros: Joi.array()
    .items(
      Joi.object().keys({
        produto_pedido_id: Joi.number().integer().required(),
        quantidade: Joi.number().integer().min(1).required(),
        observacao: Joi.string().allow(null, '')
      })
    )
    .min(1)
    .required()
})

models.impressaoIds = Joi.object().keys({
  impressao_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

// Esquemas para Plotter
models.plotterId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.plotterIds = Joi.object().keys({
  plotter_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.plotter = Joi.object().keys({
  ativo: Joi.boolean().default(true),
  nr_serie: Joi.string().max(255).required(),
  modelo: Joi.string().max(255).required(),
  data_aquisicao: Joi.date().raw().allow(null),
  vida_util: Joi.number().integer().allow(null).description('Vida útil em meses')
})

models.plotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ativo: Joi.boolean().required(),
  nr_serie: Joi.string().max(255).required(),
  modelo: Joi.string().max(255).required(),
  data_aquisicao: Joi.date().raw().allow(null),
  vida_util: Joi.number().integer().allow(null).description('Vida útil em meses')
})

// Esquemas para Manutenção de Plotter
models.manutencaoPlotterIds = Joi.object().keys({
  manutencao_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.manutencaoPlotter = Joi.object().keys({
  plotter_id: Joi.number().integer().required(),
  data_manutencao: Joi.date().raw().required(),
  valor: Joi.number().precision(2).positive().required(),
  descricao: Joi.string().allow(null, '')
})

models.manutencaoPlotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  plotter_id: Joi.number().integer().required(),
  data_manutencao: Joi.date().raw().required(),
  valor: Joi.number().precision(2).positive().required(),
  descricao: Joi.string().allow(null, '')
})

// Esquemas para Tipo de Material
models.tipoMaterialIds = Joi.object().keys({
  tipo_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

const tipoMaterialBase = {
  nome: Joi.string().max(100).required(),
  descricao: Joi.string().allow(null, ''),
  // Inteiros: contam o MESMO material que o estoque e o consumo, em unidade.
  estoque_minimo: Joi.number().integer().min(0).allow(null),
  meta_anual: Joi.number().integer().min(0).allow(null),
  ativo: Joi.boolean().default(true)
}

models.tipoMaterial = Joi.object().keys(tipoMaterialBase)

// Sem .default(true) no ativo: omitir a chave ressuscitava material desativado.
// Ver o comentário em pedidoAtualizacao.
models.tipoMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ...tipoMaterialBase,
  ativo: Joi.boolean()
})

// Esquemas para Estoque de Material
models.estoqueMaterialIds = Joi.object().keys({
  estoque_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

// quantidade aceita 0 (CHECK do banco é >= 0; consumo/transferência podem
// zerar o estoque e correções manuais precisam poder registrar zero).
//
// INTEIRA desde 2026-07-30 (chefe): material conta-se em UNIDADE, e meia folha
// não existe. As colunas do banco também são INTEGER, então aceitar 1,5 aqui só
// produziria um 400 mais adiante, ou um arredondamento silencioso.
models.estoqueMaterial = Joi.object().keys({
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().min(0).required(),
  localizacao_id: Joi.number().integer().valid(...Object.values(TIPO_LOCALIZACAO)).required()
})

models.estoqueMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().min(0).required(),
  localizacao_id: Joi.number().integer().valid(...Object.values(TIPO_LOCALIZACAO)).required()
})

// Esquemas para Consumo de Material
models.consumoMaterialIds = Joi.object().keys({
  consumo_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

models.consumoMaterial = Joi.object().keys({
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().positive().required(),
  data_consumo: Joi.date().raw().required()
})

models.consumoMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  tipo_material_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().positive().required(),
  data_consumo: Joi.date().raw().required()
})

// Esquemas para GET by ID (sem .strict(): params de URL chegam como string
// e dependem da coerção do Joi)
models.manutencaoPlotterId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.consumoMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.estoqueMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.tipoMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Esquemas para filtragem de consumo
models.consumoMaterialFiltro = Joi.object().keys({
  data_inicio: Joi.date().raw(),
  data_fim: Joi.date().raw(),
  tipo_material_id: Joi.number().integer()
})

// Esquema para transferência de material entre localizações
models.transferenciaEstoque = Joi.object()
  .keys({
    tipo_material_id: Joi.number().integer().required(),
    origem_id: Joi.number()
      .integer()
      .valid(...Object.values(TIPO_LOCALIZACAO))
      .required(),
    destino_id: Joi.number()
      .integer()
      .valid(...Object.values(TIPO_LOCALIZACAO))
      .required(),
    // Inteira, como o estoque: transferir 1,5 folha nao existe.
    quantidade: Joi.number().integer().positive().required()
  })
  .custom((value, helpers) => {
    if (value.origem_id === value.destino_id) {
      return helpers.message('Origem e destino não podem ser iguais')
    }
    return value
  })

// Esquemas de query para dashboards legados
models.mesesQuery = Joi.object().keys({
  meses: Joi.number().integer().min(1).max(60)
})

models.limiteQuery = Joi.object().keys({
  limite: Joi.number().integer().min(1).max(100)
})

// Esquema de query para consultas anuais (dashboards sem export)
models.anoQuery = Joi.object().keys({
  ano: Joi.number()
    .integer()
    .min(2000)
    .max(2100)
    .default(() => new Date().getFullYear())
})

// Top N de clientes do ano: o limite, mais o ano de contexto.
models.limiteAnoQuery = models.anoQuery.keys({
  limite: Joi.number().integer().min(1).max(100)
})

// Esquema de query do mapa das entregas: o ano, mais os três filtros opcionais.
// A escala entra pelo RÓTULO ('1:50.000'), e não pelo código do domínio, porque
// a escala personalizada tem um código só para todos os denominadores; ver o
// comentário em dashboard_ctrl.getEntregasGeo.
models.entregasGeoQuery = models.anoQuery.keys({
  tipo_produto_id: Joi.number().integer().min(1),
  escala: Joi.string().max(50),
  cliente_id: Joi.number().integer().min(1)
})

// Esquema de query para relatórios e dashboards anuais com export
// formato=csv retorna text/csv para download
models.relatorioQuery = models.anoQuery.keys({
  formato: Joi.string().valid('json', 'csv').default('json')
})

// --- Anexos do pedido -------------------------------------------------------

// Parâmetro de rota do pedido (id) para listar/anexar anexos.
models.anexoPedidoParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Parâmetro de rota do próprio anexo (download/remoção).
models.anexoIdParams = Joi.object().keys({
  anexoId: Joi.number().integer().required()
})

// Campos de texto do multipart no upload (validados após o multer). O arquivo
// vem no campo "arquivo"; aqui só os metadados opcionais.
models.anexoUploadBody = Joi.object().keys({
  tipo_anexo_id: Joi.number()
    .integer()
    .valid(...Object.values(TIPO_ANEXO_PEDIDO))
    .default(TIPO_ANEXO_PEDIDO.OUTROS),
  descricao: Joi.string().max(1000).allow(null, '')
})

module.exports = models