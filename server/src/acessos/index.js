'use strict'

// Historico de acesso ao SCA: quem entrou, quando e por qual cliente.
//
// Feature de PLATAFORMA, como `usuario` e `rpcmtec`, e nao de modulo: a
// passagem de uma pessoa pelo sistema nao pertence ao acervo, nem a mapoteca,
// nem ao orcamento. Por isso entra em `/api/acessos` e nao sob prefixo de
// modulo, e por isso a guarda de toda rota daqui e `verifyAdmin`.
//
// Ela nasceu em 2026-08-02 com a fusao da autenticacao: e o porte do
// `server/src/dashboard/` do Auth Server externo
// (https://github.com/1cgeo/auth_server), que era o unico lugar onde
// `dgeo.login` era lida. O que mudou no porte esta comentado em
// `acessos_ctrl.js`.

module.exports = {
  acessosRoute: require('./acessos_route'),
  acessosCtrl: require('./acessos_ctrl')
}
