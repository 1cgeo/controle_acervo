'use strict'

// O CONTRATO DO TRABALHO: bloco, unidade de trabalho, atividade e dado de
// producao. Ele atravessa do `projeto_schema.js` do SAP 2.3.5, e as conversoes
// da 3.0.0 estao aplicadas aqui, campo a campo:
//
//   `status_id`          -> `status_execucao_id`, que aponta
//                           `dominio.tipo_status_execucao` (1 Nao iniciado,
//                           2 Em execucao, 3 Concluido, 4 Concluido
//                           parcialmente, 5 Pausado). O `dominio.status` do SAP
//                           nao atravessou.
//   `lote_id`            -> `acervo.lote (id)`, BIGINT. Nao existe
//                           `producao.lote` nem `producao.lote_linha`.
//   `tipo_situacao_id`   -> `tipo_situacao_atividade_id`.
//   SRID 4326            -> SRID 4674 em toda geometria.
//
// AS GEOMETRIAS CHEGAM COMO EWKT, e e o Joi quem cobra o SRID e o TIPO antes de
// o SQL tocar no banco. A coluna `geometry(POLYGON, 4674)` recusaria o mesmo,
// mas com um 500 citando "Geometry type (MultiPolygon) does not match column
// type (Polygon)" -- ingles, nome de tipo do PostGIS e nenhuma pista do que
// fazer. Aqui a recusa e 400 e diz o que corrigir.

const Joi = require('joi')

const {
  STATUS_EXECUCAO,
  SITUACAO_ATIVIDADE,
  TIPO_DADO_PRODUCAO
} = require('../utils/domain_constants')

const models = {}

// --- Pecas comuns -----------------------------------------------------------

// O SRID DE CONTROLE, e nao a projecao de edicao. Toda geometria deste modulo
// vive em 4674 (SIRGAS 2000 geografico), como `campo.geom` ja vive; o SAP usa
// 4326. Quem edita numa UTM local declara isso em `unidade_trabalho.epsg`, que
// e OUTRA coluna e outra coisa.
const SRID_CONTROLE = 4674

const id = () => Joi.number().integer().strict().positive()

// O IRMAO DE `id()` PARA QUERY E PARA PARAMETRO DE CAMINHO, e a ausencia do
// `.strict()` E o contrato dele.
//
// `req.query` CHEGA SEMPRE COMO TEXTO. O Express nao converte nada, e
// `utils/schema_validation.js` valida o objeto CRU: com `.strict()` o Joi recusa
// a coercao e `GET /api/producao/unidade_trabalho?lote_id=12` responde 400
// '"lote_id" must be a number' para todo lote, sempre -- a rota fica
// inalcancavel, e o `+req.query.lote_id` do controlador nunca chega a rodar.
//
// `insumo_schema.js` e `fluxo_schema.js` ja fazem assim, e o `.strict()` do
// `id()` acima continua certo onde ele e usado: o CORPO chega como JSON, e la a
// string '12' no lugar do numero 12 e erro de quem chamou.
const idDeQuery = () => Joi.number().integer().positive()

// O ITEM NAO LEVA `.required()`, e a diferenca nao e cosmetica: em Joi,
// `items(X.required())` quer dizer "o array PRECISA CONTER pelo menos um item
// que case com X", e a lista vazia passa a ser recusada por
// 'array.includesRequiredUnknowns' em vez de 'array.min'. Quem le a mensagem
// fica sabendo de um requisito que ninguem escreveu. Quem exige tamanho e o
// `.min()`.
const listaDeIds = (minimo = 1) =>
  Joi.array().items(id()).unique().required().min(minimo)

/**
 * Um POLYGON em EWKT, no SRID de controle.
 *
 * TRES MOTIVOS DE RECUSA, e nao um so: a mensagem de "geometria invalida" nao
 * diz se o problema e o formato, a projecao ou o tipo, e quem desenhou o
 * poligono no QGIS precisa saber qual dos tres corrigir. Os codigos abaixo
 * viram `detalhe.type` no Joi, entao o teste prende o MOTIVO e nao so a recusa.
 *
 * MULTIPOLYGON E RECUSADO DE PROPOSITO: a coluna e `geometry(POLYGON, 4674)`, e
 * o recorte de uma unidade de trabalho e uma peca so. Quem tem duas pecas cria
 * duas unidades, e e para isso que o `cut` existe.
 */
const poligonoEwkt = () =>
  Joi.string()
    .trim()
    .custom((valor, helpers) => {
      const casamento = /^SRID\s*=\s*(\d+)\s*;\s*([A-Za-z]+)/.exec(valor)
      if (!casamento) return helpers.error('geometria.formato')
      if (Number(casamento[1]) !== SRID_CONTROLE) {
        return helpers.error('geometria.srid')
      }
      if (casamento[2].toUpperCase() !== 'POLYGON') {
        return helpers.error('geometria.tipo')
      }
      return valor
    })
    .messages({
      'geometria.formato':
        '{{#label}} deve ser uma geometria em EWKT, no formato "SRID=4674;POLYGON((...))"',
      'geometria.srid': `{{#label}} deve estar no SRID ${SRID_CONTROLE}, que é a projeção de controle da produção`,
      'geometria.tipo':
        '{{#label}} deve ser um POLYGON: a coluna geom da unidade de trabalho não aceita outro tipo de geometria'
    })

// --- Bloco ------------------------------------------------------------------

// A LISTA ACEITA DOIS FILTROS, e nenhum e obrigatorio. No SAP eram 'execucao' e
// 'finalizado' contra o `dominio.status` de tres codigos; aqui o dominio tem
// cinco, e o corte que interessa e o mesmo do gatilho `chk_bloco_status`:
// ENCERRADO e `IN (3, 4)`, e PAUSADO NAO E ENCERRADO.
models.blocoQuery = Joi.object().keys({
  status: Joi.string().valid('execucao', 'encerrado')
})

// `status_execucao_id` E OBRIGATORIO na criacao, e nao tem default aqui: o
// banco tambem nao tem um, e adivinhar "Nao iniciado" esconderia o bloco que
// deveria nascer em execucao. Os cinco codigos vem de `domain_constants`.
const CODIGOS_STATUS = Object.values(STATUS_EXECUCAO)

const camposBloco = {
  nome: Joi.string().trim().max(255).required(),
  prioridade: Joi.number().integer().strict().required(),
  lote_id: id().required(),
  status_execucao_id: Joi.number()
    .integer()
    .strict()
    .valid(...CODIGOS_STATUS)
    .required()
}

models.blocoCriar = Joi.object().keys({
  blocos: Joi.array()
    .items(Joi.object().keys(camposBloco))
    .required()
    .min(1)
})

models.blocoAtualizar = Joi.object().keys({
  blocos: Joi.array()
    .items(Joi.object().keys({ id: id().required(), ...camposBloco }))
    .unique('id')
    .required()
    .min(1)
})

models.blocoIds = Joi.object().keys({
  bloco_ids: listaDeIds()
})

// --- Unidade de trabalho -----------------------------------------------------

// `idDeQuery()`, e nao `id()`: este e o unico schema de QUERY desta fatia, e o
// `.strict()` do `id()` tornava a rota inalcancavel (ver o comentario do
// helper).
models.unidadeTrabalhoQuery = Joi.object().keys({
  lote_id: idDeQuery().required()
})

// `epsg` E TEXTO DE ATE CINCO CARACTERES (VARCHAR(5) NOT NULL), e nao e o SRID
// da coluna `geom`: e a projecao em que a EDICAO acontece, uma UTM local, e e o
// que o cliente usa para abrir o projeto do QGIS. As UTM do SIRGAS 2000 vao de
// 31978 a 31985, cinco digitos.
//
// O SAP ACEITAVA `''` AQUI, e nao se copia: string vazia passa pelo NOT NULL e
// so falha la na frente, no QGIS, sem dizer de onde veio.
//
// A ORDEM DAS REGRAS E O CONTRATO: `.max(5)` vem ANTES do `.pattern()` para que
// um '319780' seja recusado por 'string.max' (o que ele de fato viola) e nao
// por um padrao generico.
const epsg = () =>
  Joi.string()
    .trim()
    .max(5)
    .pattern(/^\d{4,5}$/)
    .required()
    .messages({
      'string.pattern.base':
        '{{#label}} deve ser o código EPSG da projeção de edição, com 4 ou 5 dígitos (por exemplo "31982")'
    })

const camposUnidadeTrabalho = {
  // `nome` E ANULAVEL NO DDL, e o vazio e o caso normal da carga em massa: a
  // unidade de trabalho e identificada pelo recorte, e nem toda carga nomeia.
  nome: Joi.string().trim().max(255).allow(null, ''),
  epsg: epsg(),
  observacao: Joi.string().allow(null, ''),
  geom: poligonoEwkt().required(),
  dado_producao_id: id().required(),
  bloco_id: id().required(),
  // NASCE FALSO POR DEFAULT DO BANCO, e por isso ele nao e obrigatorio aqui: a
  // unidade de trabalho e criada antes de o insumo estar associado, e liberar
  // cedo entrega trabalho sem os dados para faze-lo.
  disponivel: Joi.boolean().default(false),
  prioridade: Joi.number().integer().strict().required(),
  // ZERO E O PADRAO E SIGNIFICA "NAO CALIBRADO", e nao "facil". Os dois CHECK
  // do DDL (`>= 0`) estao espelhados aqui para a recusa ser 400 e nao 500.
  dificuldade: Joi.number().integer().strict().min(0).default(0),
  tempo_estimado_minutos: Joi.number().integer().strict().min(0).default(0)
}

models.unidadeTrabalhoCriar = Joi.object().keys({
  unidades_trabalho: Joi.array()
    .items(Joi.object().keys(camposUnidadeTrabalho))
    .required()
    .min(1),
  // O PRODUTO CARTESIANO E DELIBERADO: o mesmo recorte vira uma unidade de
  // trabalho por subfase informada, que e como o SAP carrega um lote inteiro.
  subfase_ids: listaDeIds(),
  lote_id: id().required()
})

models.unidadeTrabalhoIds = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds()
})

models.unidadeTrabalhoBloco = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds(),
  bloco_id: id().required()
})

models.unidadeTrabalhoCopiar = Joi.object().keys({
  subfase_ids: listaDeIds(),
  unidade_trabalho_ids: listaDeIds(),
  associar_insumos: Joi.boolean().strict().required()
})

// --- As tres operacoes geometricas -------------------------------------------

models.unidadeTrabalhoReshape = Joi.object().keys({
  unidade_trabalho_id: id().required(),
  reshape_geom: poligonoEwkt().required()
})

// DUAS PECAS NO MINIMO: cortar em uma peca so e nao cortar. A primeira fica com
// a unidade de trabalho original e as demais viram unidades novas.
models.unidadeTrabalhoCut = Joi.object().keys({
  unidade_trabalho_id: id().required(),
  cut_geoms: Joi.array().items(poligonoEwkt()).unique().required().min(2)
})

// DUAS UNIDADES NO MINIMO, pela mesma razao invertida: juntar uma e nao juntar.
models.unidadeTrabalhoMerge = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds(2),
  merge_geom: poligonoEwkt().required()
})

// --- Atividade ---------------------------------------------------------------

models.atividadesCriar = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds(),
  etapa_ids: listaDeIds()
})

// AS TRES BANDEIRAS SAO ESTRITAS e obrigatorias: elas decidem se a carga cria
// tambem as etapas de revisao (2 e 3), de revisao de correcao (4) e de revisao
// final (5). A etapa de execucao (1) entra sempre. Omitir uma delas com
// `default(false)` faria a carga mais barata ser a silenciosa, e quem carrega um
// lote inteiro deve dizer o que quer.
models.todasAtividades = Joi.object().keys({
  lote_id: id().required(),
  atividades_revisao: Joi.boolean().strict().required(),
  atividades_revisao_correcao: Joi.boolean().strict().required(),
  atividades_revisao_final: Joi.boolean().strict().required()
})

models.atividadesIds = Joi.object().keys({
  atividades_ids: listaDeIds()
})

// A SITUACAO NAO E CAMPO DE ENTRADA DE NENHUMA ROTA DESTA FATIA: atividade nasce
// Nao iniciada (code 1) e quem a move e a distribuicao, que e outro modulo. A
// constante fica citada aqui para o leitor saber onde procurar.
models.SITUACAO_INICIAL_ATIVIDADE = SITUACAO_ATIVIDADE.NAO_INICIADA

// --- Dado de producao --------------------------------------------------------

// `configuracao_producao` GUARDA `servidor:porta/banco`, e o Joi NAO impoe
// padrao: e `Joi.string().max(255)`, de proposito.
//
// ESTE COMENTARIO DIZIA "e o nome do banco, e NUNCA o endereco" ate 2026-08-09,
// e a afirmacao era falsa. Medido no dump de producao do SAP: as 19 linhas de
// `macrocontrole.dado_producao` trazem servidor, porta e banco. Quem escreveu
// confundiu a regra do repositorio PUBLICO -- que e sobre arquivo VERSIONADO --
// com o conteudo do DADO, que a pessoa digita e que vive no banco.
//
// POR QUE SEM PADRAO. Quem consome e `database/permissoes_producao.js`, e ele ja
// analisa a string com `conexaoAdmin.separar()`, devolvendo 503 "corrija o
// cadastro" quando ela nao casa. Um regex aqui seria a segunda regra sobre a
// mesma forma, e as duas divergiriam no dia em que um alvo legitimo nao coubesse
// -- e o erro cairia no CADASTRO, longe de quem precisa conectar.
//
// ELE E OBRIGATORIO NOS DOIS TIPOS PostGIS e opcional no terceiro, e a regra sai
// do proprio DDL: a coluna e anulavel porque o tipo 1 ('Nao controlado') e dado
// que o sistema apenas aponta, sem banco nenhum. Sem esta condicao, um dado
// PostGIS sem destino entraria e o operador receberia atividade que ninguem
// consegue abrir.
const TIPOS_COM_BANCO = [
  TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO,
  TIPO_DADO_PRODUCAO.POSTGIS
]

const camposDadoProducao = {
  tipo_dado_producao_id: Joi.number()
    .integer()
    .strict()
    .valid(...Object.values(TIPO_DADO_PRODUCAO))
    .required(),
  // O `allow(null, '')` MORA NO `otherwise`, e nao na base: em Joi o `.when()`
  // CONCATENA o ramo sobre a base, entao um `allow(null, '')` declarado antes
  // sobreviveria ao `then` e o `required()` passaria a recusar so o campo
  // AUSENTE, deixando `''` entrar como nome de banco.
  configuracao_producao: Joi.string()
    .trim()
    .max(255)
    .when('tipo_dado_producao_id', {
      // `Joi.number().valid(...).required()` e nao `Joi.valid(...)`: sem o
      // `required()`, um `tipo_dado_producao_id` AUSENTE casaria com o `is` (um
      // schema opcional aceita `undefined`) e o ramo obrigatorio seria escolhido
      // pelo motivo errado.
      is: Joi.number().valid(...TIPOS_COM_BANCO).required(),
      then: Joi.required(),
      otherwise: Joi.allow(null, '')
    })
    .messages({
      'any.required':
        '{{#label}} é obrigatório para dado de produção em PostGIS: é o NOME do banco de produção'
    })
}

models.dadoProducaoCriar = Joi.object().keys({
  dado_producao: Joi.array()
    .items(Joi.object().keys(camposDadoProducao))
    .required()
    .min(1)
})

models.dadoProducaoAtualizar = Joi.object().keys({
  dado_producao: Joi.array()
    .items(Joi.object().keys({ id: id().required(), ...camposDadoProducao }))
    .unique('id')
    .required()
    .min(1)
})

models.dadoProducaoIds = Joi.object().keys({
  dado_producao_ids: listaDeIds()
})

// Exportado para o controlador e para o teste falarem do mesmo numero.
models.SRID_CONTROLE = SRID_CONTROLE

module.exports = models
