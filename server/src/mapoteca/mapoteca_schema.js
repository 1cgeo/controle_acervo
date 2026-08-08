'use strict'

const Joi = require('joi')

const { SITUACAO_PEDIDO, TIPO_LOCALIZACAO, TIPO_MOVIMENTO_MATERIAL, TIPO_CLIENTE, TIPO_MIDIA, FORMA_ENTREGA, TIPO_ANEXO_PEDIDO, CANAL_RECEBIMENTO } = require('../utils/domain_constants')

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

// `sigla` e opcional e SEM .default(): quem nao e OM (orgao publico, cidadao da
// LAI) nao tem sigla, e na atualizacao a AUSENCIA da chave preserva o valor
// gravado (preserveOmitted no controller). Um .default aqui injetaria a chave e
// a tela que ainda nao conhece o campo apagaria a sigla ao editar o endereco.
models.cliente = Joi.object().keys({
  nome: Joi.string().max(255).required(),
  sigla: Joi.string().max(50).allow(null, ''),
  ponto_contato_principal: Joi.string().max(255).allow(null, ''),
  endereco_entrega_principal: Joi.string().max(255).allow(null, ''),
  tipo_cliente_id: Joi.number().integer().valid(...Object.values(TIPO_CLIENTE)).required()
})

models.clienteAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  nome: Joi.string().max(255).required(),
  sigla: Joi.string().max(50).allow(null, ''),
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
  data_pedido: Joi.date().iso().raw().required(),
  data_atendimento: Joi.when('situacao_pedido_id', {
    is: SITUACAO_PEDIDO.CONCLUIDO,
    then: Joi.date().iso().raw().min(Joi.ref('data_pedido')).required(),
    otherwise: Joi.date().iso().raw().min(Joi.ref('data_pedido')).allow(null)
  }),
  cliente_id: Joi.number().integer().required(),
  situacao_pedido_id: Joi.number().integer().valid(...Object.values(SITUACAO_PEDIDO)).required(),
  ponto_contato: Joi.string().max(255).allow(null, ''),
  documento_solicitacao: Joi.string().max(255).allow(null, ''),
  documento_solicitacao_nup: Joi.string().max(255).allow(null, ''),
  endereco_entrega: Joi.string().allow(null, ''),
  // Como o material sai daqui. É campo do PEDIDO, e não do item.
  forma_entrega_id: Joi.number().integer().valid(...Object.values(FORMA_ENTREGA)).allow(null),
  // Etiquetas livres. São o que o filtro `palavra_chave` de GET /pedido casa,
  // por etiqueta INTEIRA: quem digita aqui está escrevendo o termo de busca de
  // amanhã, e não uma observação.
  palavras_chave: Joi.array().items(Joi.string()).default([]),
  operacao: Joi.string().allow(null, ''),
  prazo: Joi.date().iso().raw().allow(null),
  demandante: Joi.string().max(255).allow(null, ''),
  // Sem `omds`: a coluna saiu em 2026-08-08, medida com 124 linhas preenchidas
  // e UM valor distinto em todas ('1º CGEO'). Corpo que ainda a mande cai no
  // `stripUnknown` do `schemaValidation`, com o aviso no envelope.
  previsto_pit: Joi.boolean().default(false),
  // Item do PIT que o pedido atende, por CHAVE ESTRANGEIRA para `pit.meta_item`, e
  // nunca pelo código digitado à mão. NÃO se deriva do material: a numeração das
  // metas é reescrita todo ano.
  meta_pit_id: Joi.when('previsto_pit', {
    is: true,
    then: Joi.number().integer().strict().required(),
    otherwise: Joi.number().integer().strict().allow(null)
  }),
  // O mês em que este pedido PROMETE ser impresso. É de onde sai o PLANEJADO da
  // meta 4 do PIT: a soma dos itens dos pedidos ligados à meta, pelo mês daqui.
  //
  // DISTINTO DE `prazo`, que é o limite imposto pelo CLIENTE. Medido em
  // 2026-08-05: `prazo` estava preenchido em 33 dos 164 pedidos e em nenhum dos
  // 16 ligados a meta, ou seja, os dois campos nunca foram a mesma coisa.
  //
  // NÃO é obrigatório quando `previsto_pit`, ao contrário de `meta_pit_id`. O
  // pedido que chega de um cliente real e por acaso cumpre meta é cadastrado no
  // meio do ano, já com data de pedido: forçar uma promessa retroativa ali faria
  // inventar mês. Quem cobra a ausência é o diagnóstico do PIT, que a MOSTRA em
  // vez de recusar o cadastro.
  data_prevista: Joi.date().iso().raw().allow(null),
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
  // não recebe meta_pit_id de volta, e a condicional do pedidoBase reprovaria o
  // corpo que só omite a chave. O controller preserva o valor atual (ver
  // preserveOmitted) e reprova a combinação inválida depois de mesclar.
  meta_pit_id: Joi.number().integer().strict().allow(null)
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

// RN08: todo item de pedido referencia EXATAMENTE UM produto identificado, que
// pode ser uma versão do acervo OU um produto avulso. O `.xor()` abaixo é o que
// garante o "exatamente um": sem ele passaria item sem destino nenhum, e o CHECK
// do banco viraria erro 500 em vez de 400 limpo.
const produtoPedidoBase = {
  uuid_versao: Joi.string().guid().allow(null),
  // O avulso se descreve no proprio item, sem catalogo: ele e impresso de
  // OCASIAO, e o que merecer cadastro estavel merece estar no acervo. A
  // descricao guarda a dimensao fisica e SAI na consulta publica do cliente.
  nome_avulso: Joi.string().max(255).allow(null, ''),
  descricao_avulso: Joi.string().allow(null, ''),
  pedido_id: Joi.number().integer().required(),
  quantidade: Joi.number().integer().min(1).required(),
  // Sem `quantidade_fornecida`: a coluna saiu em 2026-08-08, medida IGUAL a
  // `quantidade` em 1759 de 1759 linhas preenchidas. O que de fato saiu da
  // impressora se lança em `mapoteca.impressao_item`, com data e autor.
  tipo_midia_id: Joi.number().integer().valid(...Object.values(TIPO_MIDIA)).required(),
  // A MÍDIA fornecida FICA. O sufixo igual ao da coluna que acabou de sair é
  // coincidência: esta tem 25 divergências reais (tyvek pedido, sulfite
  // entregue), e é o único registro delas.
  tipo_midia_fornecida_id: Joi.number().integer().valid(...Object.values(TIPO_MIDIA)).allow(null),
  // A meta do PIT que ESTE item cumpre, quando difere da declarada no pedido.
  // NULL significa "a mesma do pedido", e não "fora do PIT": quem diz isso é
  // `pedido.previsto_pit`. O controller reprova a declaração em item de pedido
  // que não é do PIT, porque o Postgres não tem CHECK entre tabelas.
  meta_pit_id: Joi.number().integer().strict().allow(null),
  // Sem `forma_entrega_id` e sem `data_entrega`: as duas são do PEDIDO. Corpo
  // que ainda as mande cai no `stripUnknown` do `schemaValidation`, que descarta
  // a chave e devolve o aviso no envelope.
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

// CORRECAO de um registro de impressao ja gravado.
//
// A impressao herdava a data da CARGA, e a carga de um mes empilhava ali a
// impressao de varios. Sem esta rota, corrigir exigiria apagar e recriar, o que
// perde o registro e o rastro dele. O MOTIVO e obrigatorio: quem le o historico
// depois precisa saber por que o numero do mes mudou.
models.impressaoId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.corrigirImpressao = Joi.object().keys({
  data_impressao: Joi.date().iso().required(),
  motivo: Joi.string().min(3).max(500).required()
})

// Esquemas para Impressão (plugin QGIS da mapoteca)
models.registroImpressao = Joi.object().keys({
  registros: Joi.array()
    .items(
      Joi.object().keys({
        produto_pedido_id: Joi.number().integer().required(),
        quantidade: Joi.number().integer().min(1).required(),
        observacao: Joi.string().allow(null, ''),
        // QUANDO a impressao aconteceu. Sem ele, registrar na segunda o que se
        // imprimiu na sexta joga o consumo para o mes errado. Omitido, e agora.
        //
        // TIMESTAMP, e nao dia: a coluna e `TIMESTAMP WITH TIME ZONE`, e duas
        // impressoes do mesmo dia tem ordem.
        data_impressao: Joi.date().iso().allow(null)
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
  data_aquisicao: Joi.date().iso().raw().allow(null),
  vida_util: Joi.number().integer().allow(null).description('Vida útil em meses')
})

models.plotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ativo: Joi.boolean().required(),
  nr_serie: Joi.string().max(255).required(),
  modelo: Joi.string().max(255).required(),
  data_aquisicao: Joi.date().iso().raw().allow(null),
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
  data_manutencao: Joi.date().iso().raw().required(),
  valor: Joi.number().precision(2).positive().required(),
  descricao: Joi.string().allow(null, '')
})

models.manutencaoPlotterAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  plotter_id: Joi.number().integer().required(),
  data_manutencao: Joi.date().iso().raw().required(),
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

// NÃO EXISTEM MAIS `categoria_id`, `tipo_midia_id` e `meta_anual`, desde
// 2026-08-08. A categoria só decidia entre a 7.2 (Papel) e a 7.3 (Tintas) do
// RPCMTec, e o chefe fundiu as duas na 7.2; a mídia era a ponte impressão ->
// consumo, e a ponte morreu; a meta anual nunca teve leitor.
//
// A UNIDADE VAI NO NOME, e não em coluna própria: o "Papel Sulfite 120g" são
// rolos de 50 m e o "Cartucho MK - T730" é unidade avulsa. É decisão do chefe, e
// a pendência conhecida é que a 7.2 fundida soma rolo e cartucho na mesma coluna
// de total.
const tipoMaterialBase = {
  // O nome é ÚNICO no banco: a 7.2 do RPCMTec casa a linha do mês anterior por
  // ele, e com a fusão papel e tinta passaram a dividir um espaço de nomes só.
  nome: Joi.string().max(100).required(),
  descricao: Joi.string().allow(null, ''),
  // Inteiro: conta o MESMO material que o estoque e o livro, em unidade.
  estoque_minimo: Joi.number().integer().min(0).allow(null),
  ativo: Joi.boolean().default(true)
}

models.tipoMaterial = Joi.object().keys(tipoMaterialBase)

// Sem default no ativo: chave omitida quer dizer "não mexe". Com o default, um
// PUT que só corrige o nome ressuscitava material desativado, que é o caso que
// gerou a regra. Quem preserva de fato é o preserveOmitted do ctrl. Ver o
// comentário em pedidoAtualizacao.
models.tipoMaterialAtualizacao = Joi.object().keys({
  id: Joi.number().integer().required(),
  ...tipoMaterialBase,
  ativo: Joi.boolean()
})

// NÃO EXISTEM MAIS `estoqueMaterial`, `estoqueMaterialAtualizacao` nem
// `estoqueMaterialIds`: o saldo virou derivado do livro em 2026-08-08, e as
// rotas que o escreviam saíram. Só sobrou `estoqueMaterialId`, que a leitura por
// caminho usa.

// O LIVRO DE MOVIMENTOS
//
// A FORMA de cada tipo é cobrada AQUI e no CHECK do banco, e as duas cobranças
// existem por razões diferentes: o Joi devolve um 400 limpo que nomeia o campo,
// e o CHECK garante que nenhuma outra porta (CLI, carga, psql) grave a
// combinação inválida. Escrever a regra num lugar só sempre escolhe qual dos
// dois problemas aceitar.
models.movimentoMaterialIds = Joi.object().keys({
  movimento_material_ids: Joi.array()
    .items(Joi.number().integer().required())
    .min(1)
    .required()
})

const LOCALIZACAO = Joi.number()
  .integer()
  .valid(...Object.values(TIPO_LOCALIZACAO))

// A quantidade é SEMPRE POSITIVA, inclusive na Contagem: o sentido não mora no
// sinal, mora em qual dos dois lados está preenchido. INTEIRA porque material se
// conta em UNIDADE e meia folha não existe -- a coluna do banco também é
// INTEGER, então aceitar 1,5 aqui só produziria um 400 mais adiante ou um
// arredondamento silencioso.
// A REGRA DE FORMA mora em CADA CAMPO, e não num `.custom` sobre o objeto: assim
// a mensagem de recusa NOMEIA o campo que está errado, e o `recusaPor` dos testes
// consegue provar o MOTIVO, e não só que houve recusa.
//
// `Joi.any().when(...)` e não `LOCALIZACAO.when(...)`: o `when` CONCATENA a base
// com o ramo, e concatenar dois `.valid()` faz a UNIÃO dos valores permitidos.
// Com a base já restringindo as quatro localizações, o ramo do Consumo ("só a
// Seção") viraria "Seção ou qualquer uma das outras três", e a regra passaria a
// não recusar nada. Foi exatamente o que aconteceu na primeira versão deste
// schema.
const ORIGEM_POR_TIPO = Joi.any().when('tipo_movimento_id', {
  switch: [
    // Entrada: o material chega de fora, então não tem origem.
    { is: TIPO_MOVIMENTO_MATERIAL.ENTRADA, then: Joi.any().valid(null) },
    // Transferência: sai de algum lugar.
    { is: TIPO_MOVIMENTO_MATERIAL.TRANSFERENCIA, then: LOCALIZACAO.required() },
    // Consumo: SÓ DA SEÇÃO. As localizações são etapas da vida do material, e
    // não prateleiras: consumir de 'Saldo no empenho' seria gastar, no papel, o
    // que ainda está com o fornecedor.
    {
      is: TIPO_MOVIMENTO_MATERIAL.CONSUMO,
      then: Joi.number().integer().valid(TIPO_LOCALIZACAO.SECAO).required()
    },
    // Contagem: um lado ou o outro, e quem cobra o "exatamente um" é o `.xor`
    // abaixo.
    { is: TIPO_MOVIMENTO_MATERIAL.CONTAGEM, then: LOCALIZACAO.allow(null) }
  ],
  otherwise: LOCALIZACAO.allow(null)
})

const DESTINO_POR_TIPO = Joi.any().when('tipo_movimento_id', {
  switch: [
    { is: TIPO_MOVIMENTO_MATERIAL.ENTRADA, then: LOCALIZACAO.required() },
    // O "diferente da origem" NÃO cabe aqui, e a razão é do Joi: quem cobra é o
    // `.assert` do objeto, logo abaixo. Ver o comentário lá.
    { is: TIPO_MOVIMENTO_MATERIAL.TRANSFERENCIA, then: LOCALIZACAO.required() },
    // Consumo vai para FORA do controle.
    { is: TIPO_MOVIMENTO_MATERIAL.CONSUMO, then: Joi.any().valid(null) },
    { is: TIPO_MOVIMENTO_MATERIAL.CONTAGEM, then: LOCALIZACAO.allow(null) }
  ],
  otherwise: LOCALIZACAO.allow(null)
})

// A Contagem é o único movimento que ninguém viu acontecer: a Entrada tem nota,
// a Transferência tem quem carregou e o Consumo tem o trabalho que o gastou.
// Sem o porquê ela vira um ajuste mudo do saldo.
const MOTIVO_POR_TIPO = Joi.any().when('tipo_movimento_id', {
  is: TIPO_MOVIMENTO_MATERIAL.CONTAGEM,
  then: Joi.string().trim().min(1).required(),
  otherwise: Joi.string().allow(null, '')
})

const movimentoMaterialBase = {
  tipo_material_id: Joi.number().integer().required(),
  tipo_movimento_id: Joi.number()
    .integer()
    .valid(...Object.values(TIPO_MOVIMENTO_MATERIAL))
    .required(),
  quantidade: Joi.number().integer().positive().required(),
  // Dia de CALENDÁRIO: `.iso()` para '01/08/2026' não virar 8 de janeiro, e
  // `.raw()` para a coluna não guardar o dia anterior em UTC-3.
  data_movimento: Joi.date().iso().raw().required(),
  localizacao_origem_id: ORIGEM_POR_TIPO,
  localizacao_destino_id: DESTINO_POR_TIPO,
  motivo: MOTIVO_POR_TIPO
}

// AS DUAS REGRAS QUE SÃO SOBRE O PAR DE LADOS, e por isso não cabem num campo:
//
//   TRANSFERÊNCIA  destino DIFERENTE da origem. Sem isso, uma transferência de A
//                  para A somaria e subtrairia o mesmo saldo e passaria por
//                  lançamento válido.
//   CONTAGEM       EXATAMENTE UM lado. Sobrou material na prateleira e a
//                  diferença ENTRA (destino); faltou e ela SAI (origem). Os dois
//                  lados seriam uma transferência disfarçada, e nenhum não
//                  mexeria em saldo nenhum.
//
// A PRIMEIRA VIVE NUM `.assert` e não num `.invalid(Joi.ref(...))`, que seria o
// idiomático: `localizacao_destino_id` já tem `.valid(...)` com as quatro
// localizações, e `.valid()` põe o Joi em modo lista-branca, onde valor aceito
// sai antes de qualquer outra regra rodar. `.invalid()`, `.custom()` e `.not()`
// no mesmo campo simplesmente nunca são consultados: a transferência de A para A
// passava, e nada acusava. Medido em joi 18.2.3.
//
// As duas recusam com `path` VAZIO, porque o erro é da RELAÇÃO entre chaves, e
// não de uma delas. A mensagem nomeia as duas.
const comRegrasDoPar = schema => schema
  .assert(
    '.localizacao_destino_id',
    Joi.any().when('/tipo_movimento_id', {
      is: TIPO_MOVIMENTO_MATERIAL.TRANSFERENCIA,
      then: Joi.not(Joi.ref('/localizacao_origem_id'))
    }),
    'ser diferente da origem'
  )
  .when(
    Joi.object({ tipo_movimento_id: TIPO_MOVIMENTO_MATERIAL.CONTAGEM }).unknown(),
    { then: Joi.object().xor('localizacao_origem_id', 'localizacao_destino_id') }
  )

models.movimentoMaterial = comRegrasDoPar(
  Joi.object().keys(movimentoMaterialBase)
)

models.movimentoMaterialAtualizacao = comRegrasDoPar(
  Joi.object().keys({
    id: Joi.number().integer().required(),
    ...movimentoMaterialBase
  })
)

// Esquemas para GET by ID (sem .strict(): params de URL chegam como string
// e dependem da coerção do Joi)
models.manutencaoPlotterId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.movimentoMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.estoqueMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

models.tipoMaterialId = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Filtro da lista do LIVRO. O tipo de movimento entra aqui porque a tela é UMA:
// quem quer só o consumo filtra o tipo 3, em vez de existir uma segunda rota só
// para ele.
models.movimentoMaterialFiltro = Joi.object().keys({
  data_inicio: Joi.date().iso().raw(),
  data_fim: Joi.date().iso().raw(),
  tipo_material_id: Joi.number().integer(),
  tipo_movimento_id: Joi.number()
    .integer()
    .valid(...Object.values(TIPO_MOVIMENTO_MATERIAL))
})

// NÃO EXISTE MAIS `transferenciaEstoque`, desde 2026-08-08. Transferir virou o
// tipo 2 do livro (`movimentoMaterial`), com a mesma regra de origem diferente
// de destino, só que agora com DATA e com motivo, e somando no mesmo lugar que a
// entrada e o consumo.

// Query da fila de pedidos abertos (GET /pedido/em_aberto). Escolhe QUAL fila:
// falso é a de impressão (o que falta imprimir), verdadeiro é a de atendimento
// (o que falta fechar, com o pedido Remetido junto). As duas listas moram em
// `query_fragments.js`.
//
// O default é falso porque o plugin do QGIS já instalado chama a rota sem query
// nenhuma, e ele quer a fila de impressão. Quem quiser a outra pede.
//
// Sem `.strict()`, e de propósito: o valor vem da URL, e ali `true` é a STRING
// 'true'. O Joi converte por padrão, que é a única forma pela qual o parâmetro
// pode chegar. Exercitado: '' vira 400, 'true' vira true, ausente vira false.
models.filaQuery = Joi.object().keys({
  incluir_remetidos: Joi.boolean().default(false)
})

// Esquema de query para consultas anuais (dashboards sem export)
models.anoQuery = Joi.object().keys({
  ano: Joi.number()
    .integer()
    .min(2000)
    .max(2100)
    .default(() => new Date().getFullYear())
})

// A query da LISTA de pedidos: o ano de contexto, mais o filtro por etiqueta.
//
// `palavra_chave` casa a etiqueta INTEIRA, e não um pedaço dela, porque é assim
// que o índice GIN de `mapoteca.pedido.palavras_chave` responde (ver o
// comentário de `getPedidos`). O `.trim()` existe porque a etiqueta com espaço
// na ponta nunca casaria nada e a lista voltaria vazia sem dizer por quê; o
// `.min(1)` recusa a string em branco, que pediria "todo pedido com a etiqueta
// vazia" e é sempre engano de quem apagou o campo sem limpar a URL.
models.pedidoListaQuery = models.anoQuery.keys({
  palavra_chave: Joi.string().trim().min(1).max(255)
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

// O esquema do Anuário Estatístico vive em server/src/rpcmtec/, e é o mesmo
// `gerarQuery` do relatório: o Anuário e o RPCMTec são sempre do mesmo mês, e
// esquemas separados só permitiriam gerar os dois desencontrados.

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

// --- Etiqueta de envio do pedido --------------------------------------------

// Parâmetro de rota do pedido (id) para ler e gravar a etiqueta dele.
models.etiquetaPedidoParams = Joi.object().keys({
  id: Joi.number().integer().required()
})

// Corpo do PUT. É um upsert do registro INTEIRO: o diálogo manda sempre os
// quatro campos, e campo ausente apaga o valor antigo. Sem `.default(null)`, de
// propósito: o controller converte ausente e '' em NULL num lugar só.
//
// Só o destinatário é obrigatório. O endereço pode faltar de verdade (etiqueta
// que sai com o endereço colado à mão no pacote), e exigi-lo travaria o registro
// da correção que já existe.
models.etiquetaEnvio = Joi.object().keys({
  destinatario: Joi.string().max(255).required(),
  aos_cuidados: Joi.string().max(255).allow(null, ''),
  endereco: Joi.string().max(2000).allow(null, ''),
  cep: Joi.string().max(9).allow(null, '')
})

// --- Auditoria do pedido ----------------------------------------------------
//
// O `auditoriaPedidoParams` saiu junto com a rota `GET /pedido/:id/auditoria`
// que o usava. O histórico do pedido sai por
// `GET /api/auditoria/mapoteca/pedido/:id`, e os parâmetros dela moram em
// `auditoria/auditoria_schema.js`.

module.exports = models