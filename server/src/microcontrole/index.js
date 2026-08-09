'use strict'

// MICROCONTROLE: a medicao do trabalho no QGIS.
//
// PREFIXO DE ROTA PROPRIO (`/api/microcontrole`) E MODULO EMPRESTADO. Ele nao
// tem linha em `dominio.modulo`: a autorizacao das onze rotas e a de `producao`
// (code 7), porque medir producao e assunto de quem responde pela producao, e um
// modulo a mais obrigaria a conceder perfil duas vezes para a mesma pessoa ver o
// que ela ja gerencia. E o mesmo arranjo de `src/campo/`, que cobra `pit`.
//
// O prefixo continua sendo este porque e onde o plugin do QGIS e o SAP Gerente
// ja procuram: as onze rotas atravessaram do SAP 2.3.5 com o caminho intacto.
//
// A estrutura e a de quatro arquivos da casa (`index`, `*_ctrl`, `*_route`,
// `*_schema`). O que este modulo tem de diferente de todos os outros esta no
// controlador: ele fala com DOIS bancos.

module.exports = {
  microcontroleRoute: require('./microcontrole_route')
}
