'use strict'

const Joi = require('joi')

const models = {}

// A LISTA DE CLIENTES É FECHADA E VIVE AQUI, e não numa tabela de domínio: ela
// cabe numa linha, e um CRUD de catálogo desse tamanho seria administração
// inventada (`dgeo.login.cliente` é VARCHAR, e não FK, pelo mesmo motivo).
//
// SÃO CINCO DESDE 2026-08-09, e as DUAS ANTIGAS CONTINUAM ACEITAS. Com a
// renomeação para SAP entram os nomes que os clientes novos enviam:
// 'sap_web' (interface única), 'sap_fp' (plugin SAP Operador) e 'sap_fg'
// (plugin SAP Gerente). Apagar 'sca_web' e 'sca_qgis' na mesma troca derrubaria
// TODO CLIENTE QUE JÁ ESTÁ NO AR no segundo do deploy: o bundle que o navegador
// tem em cache e o plugin QGIS instalado em cada máquina continuam mandando o
// nome antigo, e o login responderia 400 sem que ninguém tivesse mexido neles.
// Os dois só saem quando não houver mais quem os envie, e quem responde essa
// pergunta é `dgeo.login.cliente`, que guarda o nome usado em cada acesso.
// OS DOIS PLUGINS DO QGIS DECLARAM O QUE ESTAO RODANDO, e os outros três nem
// podem. `plugins` e `qgis` são OBRIGATÓRIOS para 'sap_fp' e 'sap_fg' e
// PROIBIDOS para o resto, e as duas metades importam:
//
//   Obrigatórios NOS DOIS porque o corpo do login é o mesmo dos dois lados: os
//   dois rodam dentro do QGIS e os dois sabem responder o que estão rodando.
//   Para o 'sap_fp', é com eles que o gate de versão de `login_ctrl.js` decide
//   se aquele cliente pode trabalhar, e aceitá-los como opcionais faria o
//   plugin desatualizado passar batido simplesmente por omitir o campo, que é
//   exatamente o que o gate existe para impedir.
//
//   O GATE, PORÉM, SÓ SE APLICA AO 'sap_fp': `login_ctrl.js` o abre com
//   `if (cliente === 'sap_fp')`, e o SAP Gerente manda os dois campos para o
//   servidor descartá-los. Isso é decisão, e não esquecimento -- travar pela
//   versão do plugin justamente quem PUBLICA a versão nova trancaria a porta do
//   lado errado, e era assim no SAP 2.3.5. O caso que fixa a decisão é
//   `__tests__/unit/login_gate_versao.test.js`, "sap_fg com o MESMO QGIS
//   atrasado entra". Quem for mexer no gate leia este parágrafo inteiro: ele
//   cobre UM cliente, e o schema cobre dois.
//
//   Proibidos no navegador e no CLI porque ali eles não querem dizer nada: a
//   interface web não roda dentro de QGIS nenhum, e um campo aceito e ignorado
//   convida a mandar valor inventado.
//
// A LISTA CHEGA COM OS PLUGINS HABILITADOS, e é por isso que ela pode vir vazia:
// o QGIS com o plugin instalado mas DESLIGADO não o reporta, e o gate trata esse
// caso como "não instalado", que é o que ele é para efeito de trabalho.
const CLIENTES_DE_QGIS = /^(sap_fp|sap_fg)$/

models.login = Joi.object().keys({
  usuario: Joi.string().required(),
  senha: Joi.string().required(),
  cliente: Joi.string()
    .required()
    .valid('sca_qgis', 'sca_web', 'sap_web', 'sap_fp', 'sap_fg'),
  plugins: Joi.when('cliente', {
    is: Joi.string().regex(CLIENTES_DE_QGIS),
    then: Joi.array()
      .items(
        Joi.object().keys({
          nome: Joi.string().required(),
          versao: Joi.string().required()
        })
      )
      .unique('nome')
      .required(),
    otherwise: Joi.forbidden()
  }),
  qgis: Joi.when('cliente', {
    is: Joi.string().regex(CLIENTES_DE_QGIS),
    then: Joi.string().required(),
    otherwise: Joi.forbidden()
  })
})

module.exports = models
module.exports.CLIENTES_DE_QGIS = CLIENTES_DE_QGIS
