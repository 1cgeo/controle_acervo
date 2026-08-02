'use strict'

module.exports = {
  loginRoute: require('./login_route'),
  // verifyLogin fica para as rotas que ainda nao migraram e para o /integracao;
  // verifyAdmin passa a valer so para o que e da plataforma (usuarios, views
  // materializadas, limpeza). O resto vai por verifyPerfil, com modulo.
  verifyLogin: require('./verify_login'),
  verifyAdmin: require('./verify_admin'),
  verifyPerfil: require('./verify_perfil'),
  // Administrador global OU gerente de qualquer modulo, lendo o perfil do BANCO.
  // Nasceu em 2026-08-02 para a leitura do PIT, que nao e de modulo nenhum e
  // deixou de ser de qualquer pessoa logada (chefe).
  verifyGerente: require('./verify_gerente'),
  // `senha` e `loginCtrl.conferirSenha` saem daqui porque autenticar e o que
  // ESTA feature faz. `usuario/` importa dos dois em vez de chamar o bcrypt por
  // conta propria: dois lugares escolhendo o custo do hash divergiriam no
  // primeiro ajuste, e o hash mais fraco seria o que ninguem estaria olhando.
  loginCtrl: require('./login_ctrl'),
  senha: require('./senha')
}
