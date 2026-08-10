'use strict'

// O CONTRATO DO INSUMO: o grupo, o insumo e a associação dele com a unidade de
// trabalho. Atravessou do `projeto_schema.js` do SAP 2.3.5 em 2026-08-09.
//
// A VERDADE É `er/producao.sql`, bloco DO INSUMO. Nada aqui declara campo que
// não esteja no DDL.

const Joi = require('joi')

// `tipo_insumo` é domínio de code FIXO, e por isso ele entra no Joi: um code que
// não existe recusado aqui vira 400 com a frase certa, e recusado só pela chave
// estrangeira viraria 500. É a mesma razão pela qual `TIPO_RESTRICAO` perdeu o
// code 3 em `domain_constants.js`.
//
// `dominio.tipo_estrategia_associacao` NÃO está aqui, e a ausência é a regra
// escrita em `utils/domain_constants.js`: ela é ARGUMENTO da rotina de
// associação, nenhuma coluna aponta para ela, e quem a enumera é o mapa de
// junções de `insumo_ctrl.js`, ao lado do SQL que implementa cada estratégia.
// Duas listas da mesma coisa divergiriam na primeira estratégia nova.
const { TIPO_INSUMO } = require('../utils/domain_constants')

const models = {}

// --- Peças comuns ------------------------------------------------------------

// `.positive()` porque SERIAL começa em 1: um `0` ou um `-3` são erro de quem
// chamou, e não um 404 depois de ir ao banco.
//
// `.strict()` ENTROU EM 2026-08-09, e a ausência dele era a única dos três
// schemas desta travessia: `{"insumo_ids": ["31"]}` era ACEITO em
// `DELETE /insumo` (a string virava 31 e a linha ia embora) enquanto o mesmo
// corpo em `DELETE /bloco` ou nos doze da fábrica de perfil dava 400. Apagar por
// coerção silenciosa é o pior lugar possível para essa gentileza.
const id = () => Joi.number().integer().strict().positive()

// O MESMO id, SEM `.strict()`, PARA SCHEMA DE QUERY. `req.query` chega SEMPRE
// como texto (o `utils/schema_validation.js` valida o objeto cru), então o
// `.strict()` que protege o CORPO torna a rota inalcançável quando aplicado à
// query: `?grupo_insumo_id=3` responderia 400 para todo grupo, sempre. É o mesmo
// desdobramento que `trabalho_schema.js` faz, e a varredura-guarda de
// `__tests__/routes/query_de_texto.test.js` cobra os dois lados: ela pegou
// exatamente este erro quando o `.strict()` entrou aqui em 2026-08-09.
const idDeQuery = () => Joi.number().integer().positive()

// A lista de ids que as rotas em massa recebem. `.unique()` porque o mesmo id
// repetido inflaria a contagem do evento de auditoria sem mudar nada no banco,
// e `.min(1)` porque uma lista vazia é pedido sem alvo.
//
// O `.required()` fica NO ARRAY e NÃO no item, e a diferença aparece na
// mensagem: com `items(id().required())` o Joi recusa a lista vazia por
// `array.includesRequiredUnknowns` ("does not contain 1 required value"), que
// não diz a quem lê que faltou informar o alvo. Sem ele, a mesma lista vazia
// recusa por `array.min`, que é a regra que se quis escrever.
const listaDeIds = () => Joi.array().items(id()).unique().min(1).required()

// A GEOMETRIA CHEGA COMO EWKT, e o SRID vai DENTRO dela.
//
// A coluna é `geometry(POLYGON, 4674)`: MULTIPOLYGON e SRID diferente são
// recusados pelo próprio typmod, mas lá a recusa chega como 500 com o texto do
// PostGIS. Aqui ela é 400 em português, antes de qualquer ida ao banco. O SAP
// fazia a metade disso (só o MULTIPOLYGON) dentro do controlador.
//
// 4674 e não o 4326 do SAP: é a conversão que vale para todo o core, e está em
// `docs/decisoes.md`.
const GEOM_POLIGONO_4674 = /^SRID=4674;\s*POLYGON\s*\(/i

const geomPoligono = () =>
  Joi.string()
    .pattern(GEOM_POLIGONO_4674)
    .messages({
      'string.pattern.base':
        'A geometria deve ser um POLYGON em EWKT com SRID=4674, no formato SRID=4674;POLYGON((...))'
    })

// --- Grupo de insumo ---------------------------------------------------------

// FILTRO DE TRÊS ESTADOS, e o SAP tinha dois. Lá o controlador recebia
// `req.query.disponivel === 'true'`, então `?disponivel=false` devolvia a lista
// INTEIRA -- o mesmo que não filtrar. Aqui ausente é "todos", `true` é só os
// disponíveis e `false` é só os indisponíveis, que é o filtro que a tela de
// cadastro precisa para achar o grupo que alguém desativou.
models.grupoInsumoQuery = Joi.object().keys({
  disponivel: Joi.boolean()
})

const camposGrupoInsumo = {
  // UNIQUE no DDL. O 23505 vira frase em `insumo_ctrl.js`.
  nome: Joi.string().max(255).required(),
  // O DDL nasce TRUE: grupo novo já serve para associar.
  disponivel: Joi.boolean().default(true)
}

models.grupoInsumoCriar = Joi.object().keys({
  grupo_insumos: Joi.array()
    .items(Joi.object().keys(camposGrupoInsumo))
    .min(1)
    .required()
})

models.grupoInsumoAtualizar = Joi.object().keys({
  grupo_insumos: Joi.array()
    .items(Joi.object().keys({ id: id().required(), ...camposGrupoInsumo }))
    .unique('id')
    .min(1)
    .required()
})

models.grupoInsumoIds = Joi.object().keys({
  grupo_insumos_ids: listaDeIds()
})

// --- Insumo ------------------------------------------------------------------

models.insumoQuery = Joi.object().keys({
  grupo_insumo_id: idDeQuery(),
  tipo_insumo_id: idDeQuery()
})

const camposInsumo = {
  nome: Joi.string().max(255).required(),
  // `caminho` É PASTA DE REDE DA INSTALAÇÃO, e nasce sem valor nenhum no DDL
  // por isso. Nenhum exemplo de valor real dele existe neste repositório, que é
  // público: o que existe é o tamanho da coluna.
  caminho: Joi.string().max(255).required(),
  // CINCO CARACTERES, como a coluna. Não é o SRID da geometria (que é sempre
  // 4674): é a projeção em que a EDIÇÃO acontece, e é o que o cliente usa para
  // abrir o projeto do QGIS. Anulável porque insumo que não é arquivo espacial
  // não tem projeção nenhuma.
  epsg: Joi.string().max(5).allow(null, ''),
  // NULO É UMA AFIRMAÇÃO, e não campo esquecido: insumo NÃO ESPACIAL (uma
  // tabela, um serviço, um documento) não tem recorte, e vale para toda a área.
  // É por isso que a coluna não é NOT NULL como `campo.campo.geom`, e é por isso
  // que o Joi tem de aceitar o nulo na CRIAÇÃO também -- no SAP a geometria era
  // obrigatória ao criar, porque lá o controlador chamava `ST_GeomFromEWKT` sem
  // olhar. A string vazia é aceita e vira nulo no controlador, porque é o que o
  // formulário manda quando ninguém desenhou nada.
  geom: geomPoligono().allow(null, '')
}

// O TIPO E O GRUPO SÃO DO LOTE INTEIRO, e não de cada linha: a criação de insumo
// é uma CARGA (uma cobertura de imagens, um conjunto de cartas antigas), e as
// centenas de linhas que entram juntas são do mesmo tipo e do mesmo grupo.
//
// OS NOMES GANHARAM O `_id`, que no SAP eram `tipo_insumo` e `grupo_insumo`.
// Eles são o código do domínio e o id do grupo, e a convenção da casa é o nome
// da COLUNA. Não há cliente instalado a quebrar: o módulo nasce nesta versão.
models.insumoCriar = Joi.object().keys({
  insumos: Joi.array().items(Joi.object().keys(camposInsumo)).min(1).required(),
  tipo_insumo_id: Joi.number()
    .integer()
    .valid(...Object.values(TIPO_INSUMO))
    .required(),
  grupo_insumo_id: id().required()
})

// NA ATUALIZAÇÃO O TIPO E O GRUPO SÃO DE CADA LINHA, e a assimetria com a
// criação é do SAP e está certa: corrigir o grupo de UM insumo carregado no
// lugar errado é exatamente o que esta rota serve para fazer.
models.insumoAtualizar = Joi.object().keys({
  insumos: Joi.array()
    .items(
      Joi.object().keys({
        id: id().required(),
        ...camposInsumo,
        tipo_insumo_id: Joi.number()
          .integer()
          .valid(...Object.values(TIPO_INSUMO))
          .required(),
        grupo_insumo_id: id().required()
      })
    )
    .unique('id')
    .min(1)
    .required()
})

models.insumoIds = Joi.object().keys({
  insumo_ids: listaDeIds()
})

// --- A associação com a unidade de trabalho ----------------------------------

models.unidadeTrabalhoInsumoQuery = Joi.object().keys({
  unidade_trabalho_id: idDeQuery().required()
})

// `caminho_padrao` é a MESMA classe de dado do `caminho` do insumo: pasta de
// rede da instalação. Ele é anulável na tabela, e a string vazia que o
// formulário manda vira nulo no controlador.
const caminhoPadrao = () => Joi.string().max(255).allow(null, '')

// `estrategia_id` é INTEIRO e nada mais aqui. Quem enumera as cinco estratégias
// é o mapa de junções de `insumo_ctrl.js`, porque cada uma delas É um pedaço de
// SQL: uma lista de `valid()` aqui seria a segunda cópia da mesma enumeração, e
// a que ninguém lembraria de atualizar. O código desconhecido vira 400 lá, com
// a frase em português.
models.associaInsumos = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds(),
  grupo_insumo_id: id().required(),
  estrategia_id: Joi.number().integer().positive().required(),
  caminho_padrao: caminhoPadrao()
})

models.associaInsumosBloco = Joi.object().keys({
  bloco_id: id().required(),
  subfase_ids: listaDeIds(),
  grupo_insumo_id: id().required(),
  estrategia_id: Joi.number().integer().positive().required(),
  caminho_padrao: caminhoPadrao()
})

// `grupo_insumo_id` é OBRIGATÓRIO, como no schema do SAP. O controlador de lá
// tinha um ramo para quando ele faltava (apagar TODA associação das unidades),
// e esse ramo era inalcançável: a única rota que chamava a função exigia o
// campo. Aqui o ramo morto não existe, e apagar tudo é chamar a rota uma vez por
// grupo.
models.deletaInsumosAssociados = Joi.object().keys({
  unidade_trabalho_ids: listaDeIds(),
  grupo_insumo_id: id().required()
})

module.exports = models
