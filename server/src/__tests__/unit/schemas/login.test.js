'use strict'

// Este arquivo tinha 6 casos, e 3 deles exercitavam o `.required()` do Joi.
// Sobrou o que e REGRA DO PROJETO: `cliente` e um enum fechado.
//
// A LISTA E FECHADA porque `dgeo.login.cliente` e VARCHAR, e nao FK: quem diz
// quais valores existem e o Joi, e mais nada. Recusar aqui devolve 400 dizendo o
// campo; aceitar qualquer string encheria o historico de acesso de nomes
// digitados errado, que ninguem consegue mais separar depois.
//
// OS DOIS NOMES ANTIGOS TEM CASO PROPRIO, e nao entram por costume. Com a
// renomeacao para SAP, em 2026-08-09, 'sca_web' e 'sca_qgis' continuam
// aceitos ao lado de 'sap_web', 'sap_fp' e 'sap_fg': o bundle em cache no
// navegador e o plugin QGIS instalado em cada maquina seguem mandando o nome
// velho, e apaga-los faria todo cliente que ja esta no ar tomar 400 no segundo
// do deploy. Este teste e o que impede alguem de "limpar" a lista sem medir.
//
// A SEGUNDA METADE DO ARQUIVO e de 2026-08-09: os dois clientes de QGIS passaram
// a declarar o que estao rodando (`plugins` e `qgis`), e o gate de versao de
// `login_ctrl.js` decide com isso. Ver `__tests__/unit/login_gate_versao.test.js`.

const loginSchema = require('../../../login/login_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

// O que um plugin do QGIS manda. Os tres clientes SEM QGIS nao mandam nada
// disso, e o schema os PROIBE de mandar.
const DO_QGIS = {
  plugins: [{ nome: 'sap', versao: '2.3.0' }],
  qgis: '3.22.2'
}

describe('Schema do login: o cliente', () => {
  it.each(['sap_web', 'sca_web', 'sca_qgis'])(
    'aceita o cliente %s sem plugins nem QGIS',
    (cliente) => {
      aceita(loginSchema.login.validate({ usuario: 'admin', senha: 'pass', cliente }))
    }
  )

  it.each(['sap_fp', 'sap_fg'])(
    'aceita o cliente de QGIS %s quando ele declara o que roda',
    (cliente) => {
      aceita(loginSchema.login.validate({
        usuario: 'admin', senha: 'pass', cliente, ...DO_QGIS
      }))
    }
  )

  it('recusa cliente fora do enum, em vez de guardar nome inventado no historico', () => {
    recusaPor(
      loginSchema.login.validate({
        usuario: 'admin', senha: 'pass', cliente: 'inexistente'
      }),
      'cliente',
      'any.only'
    )
  })

  it('exige o cliente: sem ele o acesso entra no historico sem dizer de onde veio', () => {
    recusaPor(
      loginSchema.login.validate({ usuario: 'admin', senha: 'pass' }),
      'cliente',
      'any.required'
    )
  })
})

describe('Schema do login: o que o QGIS declara', () => {
  // OBRIGATORIOS nos dois clientes de QGIS. Aceita-los como opcionais faria o
  // plugin desatualizado passar batido simplesmente por OMITIR o campo, que e
  // exatamente o que o gate de versao existe para impedir.
  it.each(['sap_fp', 'sap_fg'])('%s sem a versao do QGIS e recusado', (cliente) => {
    recusaPor(
      loginSchema.login.validate({
        usuario: 'admin', senha: 'pass', cliente, plugins: DO_QGIS.plugins
      }),
      'qgis',
      'any.required'
    )
  })

  it.each(['sap_fp', 'sap_fg'])('%s sem a lista de plugins e recusado', (cliente) => {
    recusaPor(
      loginSchema.login.validate({
        usuario: 'admin', senha: 'pass', cliente, qgis: DO_QGIS.qgis
      }),
      'plugins',
      'any.required'
    )
  })

  // A LISTA PODE VIR VAZIA, e a diferenca importa: o QGIS reporta so os plugins
  // HABILITADOS, entao "nenhum habilitado" e um estado real da maquina. Quem
  // recusa esse caso e o gate, com a mensagem que diz o que instalar -- e nao o
  // Joi, com um erro de formato.
  it.each(['sap_fp', 'sap_fg'])('%s pode declarar a lista de plugins vazia', (cliente) => {
    aceita(loginSchema.login.validate({
      usuario: 'admin', senha: 'pass', cliente, plugins: [], qgis: '3.22.2'
    }))
  })

  it('recusa o mesmo plugin duas vezes: nao ha como saber qual versao vale', () => {
    recusaPor(
      loginSchema.login.validate({
        usuario: 'admin',
        senha: 'pass',
        cliente: 'sap_fp',
        qgis: '3.22.2',
        plugins: [
          { nome: 'sap', versao: '2.3.0' },
          { nome: 'sap', versao: '1.0.0' }
        ]
      }),
      ['plugins', 1],
      'array.unique'
    )
  })

  it('exige nome e versao de cada plugin', () => {
    recusaPor(
      loginSchema.login.validate({
        usuario: 'admin',
        senha: 'pass',
        cliente: 'sap_fp',
        qgis: '3.22.2',
        plugins: [{ nome: 'sap' }]
      }),
      ['plugins', 0, 'versao'],
      'any.required'
    )
  })

  // PROIBIDOS no navegador e no CLI, e nao apenas ignorados. Ali eles nao querem
  // dizer nada -- a interface web nao roda dentro de QGIS nenhum --, e um campo
  // aceito e ignorado convida a mandar valor inventado.
  it.each(['sap_web', 'sca_web', 'sca_qgis'])(
    '%s nao pode mandar a versao do QGIS',
    (cliente) => {
      recusaPor(
        loginSchema.login.validate({
          usuario: 'admin', senha: 'pass', cliente, qgis: '3.22.2'
        }),
        'qgis',
        'any.unknown'
      )
    }
  )

  it.each(['sap_web', 'sca_web', 'sca_qgis'])(
    '%s nao pode mandar a lista de plugins',
    (cliente) => {
      recusaPor(
        loginSchema.login.validate({
          usuario: 'admin', senha: 'pass', cliente, plugins: DO_QGIS.plugins
        }),
        'plugins',
        'any.unknown'
      )
    }
  )
})
