'use strict'

const Joi = require('joi')

const models = {}

models.uuidParams = Joi.object().keys({
  uuid: Joi.string().guid().required()
})

models.listaUsuario = Joi.object().keys({
  usuarios: Joi.array()
    .items(Joi.string().guid().required())
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
        uuid: Joi.string().guid().required(),
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
