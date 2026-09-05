'use strict'

const Joi = require('joi')

const models = {}

// UUID NA FORMA CANONICA, e nao `Joi.string().guid()`.
//
// O `guid()` aceita QUATRO grafias do mesmo identificador -- minuscula,
// MAIUSCULA, entre chaves `{...}` e sem hifen -- e nao normaliza nenhuma. O tipo
// `uuid` do PostgreSQL tambem aceita as quatro, e devolve SEMPRE a canonica em
// minuscula com hifen. Quem casa em JAVASCRIPT o que o cliente mandou com o que
// o banco devolveu erra, e os dois desfechos ja aconteciam aqui:
//
//   - `atualizaUsuarioLista` indexa o mapa de `dados_antes` pelo uuid do BANCO.
//     Com a grafia maiuscula o `SELECT ... IN (...)` acha a linha, o UPDATE em
//     massa GRAVA, e so entao o `Map` devolve `undefined` para a auditoria: a
//     rota estoura 500 e desfaz a transacao inteira, sem dizer o porque.
//   - `resetaSenhas` compara as duas strings e responde
//     "Usuários não encontrados" para um uuid que existe. A mensagem mente
//     sobre a causa, e quem administra procura o defeito no lugar errado.
//
// Recusar na PORTA resolve os dois de uma vez, e a mensagem custom nao ecoa o
// valor recebido -- ela vai parar no `combined.log`, que `/logs` publica. As
// duas mensagens sao proprias porque a do `pattern` padrao do Joi ecoa o valor e
// a do `guid` sai em ingles.
//
// O `.guid()` FICA, ao lado do `pattern`, e nao e redundancia inutil: ele separa
// "isto nem parece um uuid" de "e um uuid, na grafia errada", e e por ele que o
// `efetivo_cli` (que le o Joi VIVO, e nunca uma copia) continua anunciando o
// campo como `uuid` em vez de despejar a expressao regular na ajuda.
const uuidCanonico = Joi.string()
  .guid()
  .message('{{#label}} deve ser um UUID')
  .pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .message('{{#label}} deve ser um UUID em minúsculas, com hífen e sem chaves')

models.uuidParams = Joi.object().keys({
  uuid: uuidCanonico.required()
})

models.listaUsuario = Joi.object().keys({
  usuarios: Joi.array()
    .items(uuidCanonico.required())
    .unique()
    .required()
    .min(1)
})

// Mapa modulo -> nivel (1 consulta, 2 operador, 3 gerente). null REMOVE o
// acesso da pessoa aquele modulo. Modulo omitido fica como esta.
const perfisPorModulo = Joi.object().pattern(
  Joi.string(),
  Joi.number().integer().min(1).max(3).allow(null)
)

// Regra de senha em PARIDADE com o Auth Server: qualquer coisa nao vazia. Ele
// nunca cobrou tamanho minimo, e subir o piso na fusao recusaria a senha que
// muita gente ja usa, no mesmo dia em que o sistema de login mudou de lugar.
// Se um dia virar politica, o lugar e AQUI: as tres rotas de senha saem daqui,
// entao a regra sobe nas tres de uma vez.
const senha = Joi.string().min(1)

models.criaUsuario = Joi.object().keys({
  login: Joi.string().required(),
  senha: senha.required(),
  nome: Joi.string().required(),
  nome_guerra: Joi.string().required(),
  tipo_posto_grad_id: Joi.number().integer().positive().required(),
  administrador: Joi.boolean().strict().required(),
  ativo: Joi.boolean().strict().required(),
  perfis: perfisPorModulo
})

// Os campos de identidade sao OPCIONAIS e NAO tem `.default()`: omitir vale
// "nao mexe nesse campo", e quem preenche o valor atual e o `preserveOmitted`
// do controller. Um `.default()` aqui injetaria a chave e a ausencia nunca
// chegaria la -- o campo seria sobrescrito em silencio, que e o defeito que
// aquele utilitario existe para matar.
//
// `administrador` e `ativo` seguem obrigatorios porque os botoes de alternar da
// tela de usuarios chamam esta rota so com eles.
models.updateUsuario = Joi.object().keys({
  login: Joi.string(),
  nome: Joi.string(),
  nome_guerra: Joi.string(),
  tipo_posto_grad_id: Joi.number().integer().positive(),
  administrador: Joi.boolean().strict().required(),
  ativo: Joi.boolean().strict().required(),
  perfis: perfisPorModulo
})

models.updateUsuarioLista = Joi.object().keys({
  usuarios: Joi.array()
    .items(
      Joi.object().keys({
        uuid: uuidCanonico.required(),
        administrador: Joi.boolean().strict().required(),
        ativo: Joi.boolean().strict().required(),
        perfis: perfisPorModulo
      })
    )
    .unique('uuid')
    .required()
    .min(1)
})

// O PROPRIO cadastro. Sem `login`, sem `administrador`, sem `ativo` e sem
// `perfis`: quem muda quem a pessoa e, e o que ela pode, e o administrador.
// Fossem aceitos aqui, "editar meu perfil" seria o caminho para se promover.
models.updatePerfilProprio = Joi.object().keys({
  nome: Joi.string().required(),
  nome_guerra: Joi.string().required(),
  tipo_posto_grad_id: Joi.number().integer().positive().required()
})

models.updateSenhaPropria = Joi.object().keys({
  senha_atual: senha.required(),
  senha_nova: senha.required()
})

module.exports = models
