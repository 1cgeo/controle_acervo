'use strict'

// Contrato de corpo do CADASTRO da produção: os domínios (que não têm corpo) e o
// catálogo do QGIS (que é todo escrita em MASSA).
//
// AS CHAVES DO CORPO SÃO AS DO SAP 2.3.5, letra por letra, e isso não é
// nostalgia: quem manda estes corpos é o SAP Gerente e o plugin do QGIS, que são
// clientes COMPILADOS FORA DESTE REPOSITÓRIO. Renomear `grupo_estilos_ids` para
// `ids` custaria uma versão nova dos dois no mesmo dia do deploy, para ganhar
// nome nenhum. Por isso convivem aqui `grupo_estilos_ids`, `estilos_ids`,
// `alias_ids` e o desalinhado `servidores_id`, no singular, que é como o
// gerenciador do FME sempre chamou a própria lista.
//
// A FORMA É SEMPRE A MESMA, nos nove catálogos: uma chave que carrega um ARRAY
// de linhas. O POST manda linhas sem `id`, o PUT manda linhas COM `id`, e o
// DELETE manda só a lista de ids. Não existe rota de uma linha só: a tela do SAP
// Gerente publica o catálogo inteiro de uma vez.

const Joi = require('joi')

const models = {}

// O id de banco. `.strict()` vem do SAP e fica: sem ele o Joi aceitaria a string
// '3' e a converteria, e um cliente que mandasse id como texto passaria a
// funcionar por acidente até o dia em que mandasse '3a'.
//
// `.positive()` NÃO vem do SAP, e é acréscimo desta casa (o mesmo do
// `equipamento_schema.js`): SERIAL começa em 1, então `0` e `-3` são erro de
// quem chamou, e não um 404 depois de ir ao banco.
const id = () => Joi.number().integer().strict().positive()

// A lista de ids do DELETE. `.unique()` porque o mesmo id duas vezes na mesma
// exclusão é pedido ambíguo, e `.min(1)` porque exclusão de nada é sempre erro
// de quem montou a tela.
//
// SEM O `.required()` DENTRO DE `.items()`, que o SAP tinha. Num array do Joi
// aquilo não quer dizer "todo item é obrigatório": quer dizer "o array TEM de
// conter pelo menos um item que case com este". A lista vazia então falhava por
// `array.includesRequiredUnknowns` ('does not contain 1 required value(s)'), e
// não pelo `.min(1)`, que é a regra que a pessoa quebrou. Nada passa a ser
// aceito com a remoção: só muda a frase do 400.
const listaDeIds = () => Joi.array().items(id()).unique().required().min(1)

// A lista do POST: linhas SEM id.
//
// `.min(1)` NÃO vem do SAP, onde a maioria dos schemas de criação tinha só
// `.required()`. Lá o array vazio chegava ao `db.pgp.helpers.insert([])`, que
// lança, e a resposta era 500 num pedido que o Joi deveria ter recusado. Aqui
// ele é 400 com o motivo escrito.
const listaNova = campos =>
  Joi.array().items(Joi.object().keys(campos)).required().min(1)

// A lista do PUT: as mesmas colunas MAIS o `id`, que diz qual linha é.
//
// `.unique('id')` também é uniformizado: o SAP o tinha em cinco dos nove e
// esquecia nos outros quatro (regras, modelos, workflows e a atualização de
// alias). Duas linhas com o mesmo id num UPDATE em massa é ambiguidade pura, e
// qual delas vence dependia da ordem do array.
const listaComId = campos =>
  Joi.array()
    .items(Joi.object().keys({ id: id().required(), ...campos }))
    .unique('id')
    .required()
    .min(1)

// --- Grupo de estilos --------------------------------------------------------

// `qgis.group_styles`: só o nome, VARCHAR(255) e UNIQUE. É o grupo, e não o
// estilo camada a camada, que `producao.perfil_estilo` aponta.
const camposGrupoEstilos = {
  nome: Joi.string().max(255).required()
}

models.grupoEstilos = Joi.object().keys({
  grupo_estilos: listaNova(camposGrupoEstilos)
})

models.grupoEstilosAtualizacao = Joi.object().keys({
  grupo_estilos: listaComId(camposGrupoEstilos)
})

models.grupoEstilosIds = Joi.object().keys({
  grupo_estilos_ids: listaDeIds()
})

// --- Estilos -----------------------------------------------------------------

// `qgis.layer_styles`. A identidade é (f_table_schema, f_table_name,
// grupo_estilo_id), e a coluna de geometria NÃO entra nela: ver o comentário do
// UNIQUE em `er/qgis.sql`.
//
// `styleqml` é `required()` embora a coluna aceite nulo, e é o contrato do SAP:
// estilo sem QML não estiliza nada, e o catálogo existe para distribuir QML.
//
// `stylesld` ACEITA NULO TAMBÉM NA ATUALIZAÇÃO, e aqui a origem se corrigiu. No
// SAP a criação aceitava `null` e a atualização exigia string: um estilo criado
// sem SLD (o caso comum, porque o QGIS exporta QML) não podia mais ser editado
// pela mesma tela que o criou. Afrouxar não quebra cliente nenhum, porque quem
// mandava string continua mandando.
const camposEstilos = {
  f_table_schema: Joi.string().max(255).required(),
  f_table_name: Joi.string().max(255).required(),
  f_geometry_column: Joi.string().max(255).required(),
  grupo_estilo_id: id().required(),
  styleqml: Joi.string().required(),
  stylesld: Joi.string().allow('', null).required(),
  ui: Joi.string().allow('', null).required()
}

models.estilos = Joi.object().keys({
  estilos: listaNova(camposEstilos)
})

models.estilosAtualizacao = Joi.object().keys({
  estilos: listaComId(camposEstilos)
})

models.estilosIds = Joi.object().keys({
  estilos_ids: listaDeIds()
})

// --- Regras ------------------------------------------------------------------

// `qgis.layer_rules`: a regra de atributo que o DSGTools cobra na aquisição.
// `nome` é VARCHAR(255) e UNIQUE; `regra` é TEXT, e por isso sem teto.
const camposRegras = {
  nome: Joi.string().max(255).required(),
  regra: Joi.string().required()
}

models.regras = Joi.object().keys({
  regras: listaNova(camposRegras)
})

models.regrasAtualizacao = Joi.object().keys({
  regras: listaComId(camposRegras)
})

models.regrasIds = Joi.object().keys({
  regras_ids: listaDeIds()
})

// --- Menus -------------------------------------------------------------------

// `qgis.qgis_menus`. `nome` é TEXT (e não VARCHAR) no DDL, então NÃO leva
// `.max()`: pôr um teto que o banco não tem faria o Joi recusar o que a coluna
// guardaria. A definição do menu é o XML inteiro, de dezenas de KB.
const camposMenus = {
  nome: Joi.string().required(),
  definicao_menu: Joi.string().required()
}

models.menus = Joi.object().keys({
  menus: listaNova(camposMenus)
})

models.menusAtualizacao = Joi.object().keys({
  menus: listaComId(camposMenus)
})

models.menusIds = Joi.object().keys({
  menus_ids: listaDeIds()
})

// --- Modelos -----------------------------------------------------------------

// `qgis.qgis_models`: o .model3 do QGIS exportado como XML. `descricao` é NOT
// NULL no DDL, e por isso `required()` sem `allow('')`... que o SAP também não
// tinha. String vazia continua passando (o Joi só recusa `''` com
// `.min(1)`), e é o que a coluna aceita.
const camposModelos = {
  nome: Joi.string().max(255).required(),
  descricao: Joi.string().required(),
  model_xml: Joi.string().required()
}

models.modelos = Joi.object().keys({
  modelos: listaNova(camposModelos)
})

models.modelosAtualizacao = Joi.object().keys({
  modelos: listaComId(camposModelos)
})

models.modelosIds = Joi.object().keys({
  modelos_ids: listaDeIds()
})

// --- Alias -------------------------------------------------------------------

// `qgis.layer_alias`: o apelido dos campos, para o formulário de aquisição não
// mostrar o nome cru da coluna. `nome` é TEXT no DDL.
const camposAlias = {
  nome: Joi.string().required(),
  definicao_alias: Joi.string().required()
}

models.alias = Joi.object().keys({
  alias: listaNova(camposAlias)
})

models.aliasAtualizacao = Joi.object().keys({
  alias: listaComId(camposAlias)
})

models.aliasIds = Joi.object().keys({
  alias_ids: listaDeIds()
})

// --- Temas -------------------------------------------------------------------

// `qgis.qgis_themes`: quais camadas ficam visíveis em cada contexto. `nome` é
// TEXT no DDL.
const camposTemas = {
  nome: Joi.string().required(),
  definicao_tema: Joi.string().required()
}

models.temas = Joi.object().keys({
  temas: listaNova(camposTemas)
})

models.temasAtualizacao = Joi.object().keys({
  temas: listaComId(camposTemas)
})

models.temasIds = Joi.object().keys({
  temas_ids: listaDeIds()
})

// --- Workflow do DSGTools ----------------------------------------------------

// `qgis.workflow_dsgtools`: a sequência de modelos com os parâmetros dela.
// `workflow_json` é TEXT e viaja como STRING, e não como objeto: o cliente monta
// o JSON e o servidor o guarda inteiro, sem opinar sobre o conteúdo.
const camposWorkflows = {
  nome: Joi.string().max(255).required(),
  descricao: Joi.string().required(),
  workflow_json: Joi.string().required()
}

models.workflows = Joi.object().keys({
  workflows: listaNova(camposWorkflows)
})

models.workflowsAtualizacao = Joi.object().keys({
  workflows: listaComId(camposWorkflows)
})

models.workflowsIds = Joi.object().keys({
  workflows_ids: listaDeIds()
})

// --- Gerenciador do FME ------------------------------------------------------

// `qgis.gerenciador_fme`: o servidor de onde as rotinas de validação são
// chamadas. UMA coluna, `url` VARCHAR(255) UNIQUE.
//
// O `.unique('url')` na criação é do SAP e fica: dois cadastros do mesmo
// servidor fariam a mesma rotina aparecer duas vezes na lista da subfase. Ele
// pega a duplicata DENTRO do mesmo pedido; a duplicata contra o que já está
// gravado quem pega é o UNIQUE da coluna, traduzido no controlador.
//
// A URL não se valida com `Joi.string().uri()`, e é deliberado: o endereço é da
// INSTALAÇÃO, cadastrado pelo SAP Gerente, e já apareceu com porta, com caminho
// de serviço e sem esquema. Recusar aqui trocaria um cadastro que funciona por
// um 400 que ninguém sabe consertar.
const camposGerenciadorFme = {
  url: Joi.string().max(255).required()
}

models.gerenciadorFme = Joi.object().keys({
  gerenciador_fme: Joi.array()
    .items(Joi.object().keys(camposGerenciadorFme))
    .unique('url')
    .required()
    .min(1)
})

models.gerenciadorFmeAtualizacao = Joi.object().keys({
  gerenciador_fme: listaComId(camposGerenciadorFme)
})

// `servidores_id`, no SINGULAR e sem o `s` do plural, é o nome que o SAP usa e
// que o SAP Gerente manda. Ele é o único fora do padrão `<coisa>_ids`, e
// corrigi-lo aqui quebraria o cliente compilado.
models.gerenciadorFmeIds = Joi.object().keys({
  servidores_id: listaDeIds()
})

module.exports = models
