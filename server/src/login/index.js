'use strict'

module.exports = {
  loginRoute: require('./login_route'),
  // verifyLogin fica para as rotas que ainda nao migraram e para o /integracao;
  // verifyAdmin passa a valer so para o que e da plataforma (usuarios, views
  // materializadas, limpeza). O resto vai por verifyPerfil, com modulo.
  verifyLogin: require('./verify_login'),
  // A MESMA pergunta do verifyLogin, mas aceitando o token na query string e
  // exigindo um token de AUDIENCIA `tile` (`POST /login/tile`), que vive minutos
  // e nao abre nenhuma outra rota. EXCLUSIVA das rotas de TILE (MVT): o QGIS e o
  // MapLibre pedem tile por uma URL que eles montam, sem cabecalho de
  // autenticacao. Token em query string vaza para log de acesso, historico do
  // navegador e Referer, entao ela nao se usa em mais nada -- e
  // `__tests__/routes/login_tile_exclusivo.test.js` varre os `*_route.js` para
  // provar isso.
  verifyLoginTile: require('./verify_login_tile'),
  // Tem acesso ao sistema: administrador global ou qualquer perfil em qualquer
  // modulo. E o piso do que nao e de modulo nenhum (o PIT do ano), e o que
  // separa "esta logado" de "entrou no sistema".
  verifyAcesso: require('./verify_acesso'),
  verifyAdmin: require('./verify_admin'),
  verifyPerfil: require('./verify_perfil'),
  // Administrador global OU gerente de qualquer módulo, lendo o perfil do BANCO.
  // Guarda a LEITURA do RPCMTec, que é a prestação de contas da Divisão inteira
  // e não cabe em módulo nenhum. A escrita de subseção encadeia
  // `rpcmtec/verify_modulo_subsecao.js` depois dele.
  verifyGerente: require('./verify_gerente'),
  // `senha` e `loginCtrl.conferirSenha` saem daqui porque autenticar e o que
  // ESTA feature faz. `usuario/` importa dos dois em vez de chamar o bcrypt por
  // conta propria: dois lugares escolhendo o custo do hash divergiriam no
  // primeiro ajuste, e o hash mais fraco seria o que ninguem estaria olhando.
  loginCtrl: require('./login_ctrl'),
  senha: require('./senha')
}
