'use strict'

const Joi = require('joi')

const models = {}

const id = () => Joi.number().integer().positive()

// --- A CONFIRMAÇÃO ------------------------------------------------------------
//
// TRES ROTAS DESTE MODULO APAGAM EM MASSA SEM RECEBER ALVO NENHUM: `DELETE
// /log`, `/ut_sem_atividade` e o `/atividades/usuario/:uuid`, que recebe uma
// pessoa e solta TUDO o que ela esta segurando. Um `DELETE` sem corpo, disparado
// por engano de uma aba aberta ou de um comando repetido no historico do
// terminal, e acidente esperando acontecer -- e nao ha desfazer.
//
// A FORMA E A DO `--confirmar` DOS CLIs DA CASA, e nao um `{ confirmar: true }`.
// `acervo_cli/comandos/editar.js` obriga a REPETIR O ID no `--confirmar`, e o
// comentario dele diz por que: "a confirmacao repete o id, para que confirmar
// seja um ato, e nao um enter". Um booleano nao e um ato -- ele se copia junto
// com a URL, sobrevive ao copiar e colar e some da atencao de quem o digita uma
// vez.
//
// AQUI O QUE SE REPETE E O NOME DA ACAO, porque duas das tres rotas nao tem id a
// repetir. Quem chama tem de escrever `apagar_ut_sem_atividade` para apagar a
// unidade de trabalho sem atividade: um token errado (o de outra rota, por
// exemplo) e recusado com 400 dizendo qual era o esperado. Na terceira, a que TEM
// alvo, o que se repete e o proprio uuid da pessoa -- que e literalmente a regra
// do CLI.
//
// O `motivo` E OPCIONAL E VAI PARA A TRILHA. `auditoria.evento` tem coluna
// `motivo`, e nas rotas onde a casa pergunta ela e gravada. Aqui a pergunta e
// exatamente "por que voce apagou isso", e a resposta so existe se for feita na
// hora: seis meses depois nao ha de onde tira-la.
//
// A MENSAGEM NAO CITA CHAVES, e a ausencia nao e estilo: a mensagem do Joi e um
// TEMPLATE, e `{` abre uma interpolacao. Um exemplo de corpo JSON escrito ali
// derruba o carregamento do modulo com "Formula missing expected operator" --
// no `require`, e nao na primeira requisicao. Por isso o exemplo se escreve em
// prosa, com o campo e o valor nomeados.
const confirmacao = (token, descricao) => {
  const exigencia =
    `Esta operação ${descricao} e não tem desfazer. Para confirmar, envie no ` +
    `corpo o campo "confirmar" com o valor exato "${token}".`

  return Joi.object().keys({
    confirmar: Joi.string()
      .valid(token)
      .required()
      .messages({ 'any.only': exigencia, 'any.required': exigencia }),
    motivo: Joi.string().max(255)
  })
}

// Os tokens ficam JUNTOS, e exportados: a rota os cita e o teste os confere. Dois
// lugares digitando a mesma palavra divergiriam na primeira correcao de grafia, e
// a rota passaria a recusar toda confirmacao correta.
models.TOKEN = {
  LOG: 'apagar_log',
  UT_SEM_ATIVIDADE: 'apagar_ut_sem_atividade'
}

models.limpaAtividadesParams = Joi.object().keys({
  uuid: Joi.string().guid().required()
})

// O ALVO E A CONFIRMACAO SAO O MESMO VALOR, e e de proposito: aqui existe um id
// a repetir, entao a regra do CLI vale ao pe da letra. O `.ref` amarra os dois
// no Joi, e nao no controlador -- a recusa sai antes de qualquer ida ao banco.
//
// `Joi.ref` NAO ALCANCA `req.params` a partir do `body`: os dois sao validados
// separadamente pelo `schemaValidation`. Por isso a conferencia mora na ROTA, e
// este schema so cobra que `confirmar` seja um uuid.
models.limpaAtividadesBody = Joi.object().keys({
  confirmar: Joi.string()
    .guid()
    .required()
    .messages({
      'string.guid': 'Para confirmar, repita o uuid do usuário em "confirmar".',
      'any.required': 'Esta operação solta todas as atividades que a pessoa está segurando e não tem desfazer. Para confirmar, repita o uuid do usuário em "confirmar".'
    }),
  motivo: Joi.string().max(255)
})

models.limpaLogBody = confirmacao(
  models.TOKEN.LOG, 'apaga o log combinado anterior a três dias'
)

models.utSemAtividadeBody = confirmacao(
  models.TOKEN.UT_SEM_ATIVIDADE, 'apaga toda unidade de trabalho sem atividade'
)

// --- Propriedades de camada ---------------------------------------------------

// OS TRES CAMPOS DE APONTAMENTO SAO TUDO OU NADA, e o DDL cobra isso pelo CHECK
// `propriedades_camada_apontamento_completo`. A regra vale aqui TAMBEM, e nao e
// duplicacao inutil: sem ela o erro que chega na tela e o texto cru do PostgreSQL
// citando o nome da constraint, em ingles, e quem lanca nao tem como saber qual
// dos tres campos faltou.
const propriedadesApontamento = objeto =>
  objeto.custom((valor, helpers) => {
    const marcada = valor.camada_apontamento === true
    const temAtributos =
      valor.atributo_situacao_correcao != null &&
      valor.atributo_justificativa_apontamento != null

    if (marcada && !temAtributos) {
      return helpers.message(
        'Camada de apontamento exige "atributo_situacao_correcao" e "atributo_justificativa_apontamento"'
      )
    }
    if (!marcada && (
      valor.atributo_situacao_correcao != null ||
      valor.atributo_justificativa_apontamento != null
    )) {
      return helpers.message(
        'Camada que não é de apontamento não pode declarar "atributo_situacao_correcao" nem "atributo_justificativa_apontamento"'
      )
    }
    return valor
  })

const camposPropriedadesCamada = {
  camada_id: id().required(),
  subfase_id: id().required(),
  camada_incomum: Joi.boolean().default(false),
  atributo_filtro_subfase: Joi.string().max(255).allow(null),
  camada_apontamento: Joi.boolean().default(false),
  atributo_situacao_correcao: Joi.string().max(255).allow(null),
  atributo_justificativa_apontamento: Joi.string().max(255).allow(null)
}

models.propriedadesCamadaCriar = Joi.object().keys({
  propriedades_camada: Joi.array()
    .items(propriedadesApontamento(Joi.object().keys(camposPropriedadesCamada)))
    .min(1)
    .required()
})

models.propriedadesCamadaAtualizar = Joi.object().keys({
  propriedades_camada: Joi.array()
    .items(propriedadesApontamento(Joi.object().keys({
      id: id().required(),
      ...camposPropriedadesCamada
    })))
    .min(1)
    .required()
})

models.propriedadesCamadaIds = Joi.object().keys({
  propriedades_camada_ids: Joi.array().items(id()).min(1).unique().required()
})

// --- Insumo -------------------------------------------------------------------

// VALIDADOR PROPRIO, e nao o `utils/geometria_schema.js` compartilhado. Aquele
// nasceu para o DESENHO feito na tela de busca, e por isso tem teto de 100
// vertices -- o recorte inteiro viaja na URL da busca. A pegada de um insumo nao
// viaja em URL nenhuma e pode ser o contorno de uma folha; herdar aquele teto
// recusaria insumo legitimo por uma razao que nao existe aqui. E o mesmo motivo
// pelo qual `campo/campo_schema.js` tambem escreveu o seu.
//
// POLYGON, E NAO MULTIPOLYGON: a coluna `producao.insumo.geom` e
// `geometry(POLYGON, 4674)`, e aceitar mais na porta produziria uma recusa do
// PostGIS falando de tipo de geometria, longe de quem cadastrou.
const geometriaInsumo = Joi.string().custom((valor, helpers) => {
  let geo
  try {
    geo = JSON.parse(valor)
  } catch {
    return helpers.message('a geometria precisa ser um GeoJSON válido')
  }
  if (!geo || geo.type !== 'Polygon' || !Array.isArray(geo.coordinates)) {
    return helpers.message('a geometria do insumo precisa ser um Polygon')
  }
  if (geo.coordinates.length < 1) {
    return helpers.message('a geometria precisa ter ao menos um anel')
  }
  for (const anel of geo.coordinates) {
    if (!Array.isArray(anel) || anel.length < 4) {
      return helpers.message('cada anel precisa de ao menos três vértices')
    }
    const coordenadaOk = c => Array.isArray(c) && c.length >= 2 &&
      Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
      c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90
    if (!anel.every(coordenadaOk)) {
      return helpers.message('a geometria tem coordenada inválida')
    }
    // Anel aberto entra no PostGIS como geometria invalida, e a mensagem de la
    // fala de "IllegalArgumentException", que nao ajuda ninguem.
    const primeiro = anel[0]
    const ultimo = anel[anel.length - 1]
    if (primeiro[0] !== ultimo[0] || primeiro[1] !== ultimo[1]) {
      return helpers.message(
        'o anel precisa ser fechado (primeiro vértice igual ao último)'
      )
    }
  }
  return JSON.stringify(geo)
})

const camposInsumo = {
  nome: Joi.string().max(255).required(),
  // PASTA DE REDE, e ela mora no BANCO. Nunca em arquivo versionado -- o
  // repositorio e publico, e caminho de maquina nao entra nele.
  caminho: Joi.string().max(255).required(),
  // A PROJECAO EM QUE O INSUMO ESTA, e nao o SRID da coluna `geom`, que e sempre
  // 4674. VARCHAR(5) no DDL, entao o codigo EPSG cabe como texto.
  epsg: Joi.string().max(5).allow(null),
  tipo_insumo_id: id().required(),
  grupo_insumo_id: id().required(),
  // NULA QUER DIZER INSUMO NAO ESPACIAL, e a ausencia e uma afirmacao: uma
  // tabela, um servico ou um documento vale para toda a area e nao tem recorte.
  geom: geometriaInsumo.allow(null)
}

models.insumoCriar = Joi.object().keys({
  insumo: Joi.array().items(Joi.object().keys(camposInsumo)).min(1).required()
})

models.insumoAtualizar = Joi.object().keys({
  insumo: Joi.array()
    .items(Joi.object().keys({ id: id().required(), ...camposInsumo }))
    .min(1)
    .required()
})

models.insumoIds = Joi.object().keys({
  insumo_ids: Joi.array().items(id()).min(1).unique().required()
})

module.exports = models
