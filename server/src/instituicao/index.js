'use strict'

// A INSTITUICAO que opera esta instalacao: nome, sigla e Unidade Gestora.
//
// Feature de PLATAFORMA, e nao de modulo: ela nao tem linha em `dominio.modulo`,
// nao tem perfil proprio e nao pertence a area nenhuma. "De quem e esta
// instalacao" e a pergunta que o acervo, a mapoteca, o orcamento e o RPCMTec
// fazem do mesmo jeito, e a resposta e uma so. E o mesmo arranjo de `/usuarios`,
// `/acessos` e `/auditoria`.
//
// A ESTRUTURA E A DE QUATRO ARQUIVOS DA CASA (`index`, `*_ctrl`, `*_route`,
// `*_schema`), a mesma de `equipamento/`, e ela nao encolhe por a feature ser
// pequena: sao duas rotas sobre uma linha, e mesmo assim o contrato do corpo
// mora num arquivo so, que e de onde os CLIs leem o Joi vivo.

module.exports = {
  instituicaoRoute: require('./instituicao_route')
}
