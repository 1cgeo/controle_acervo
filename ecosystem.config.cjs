// Deploy de producao do Controle do Acervo (SCA) via PM2.
//
// Um unico processo: o server, na porta da chave PORT de server/config.env,
// serve a API REST e a INTERFACE INTEIRA em `/`, a partir de server/src/build
// (gerado por `npm run build`).
//
// A INTERFACE E UMA. O cabecalho aqui falava do "dashboard do acervo em /" e do
// "client da mapoteca em /mapoteca", e os dois clients por modulo foram apagados
// de proposito: hoje ha uma SPA so, com os modulos dentro dela. Ressuscitar a
// divisao e decisao, e decisao se registra em docs/decisoes.md.
//
// Pre-requisitos (uma vez): server/config.env de producao + `npm run build`.
// Subir/atualizar:  npm run deploy   (= build + pm2 startOrReload + pm2 save)

module.exports = {
  apps: [
    {
      name: 'controle-acervo',
      script: 'server/src/index.js',
      cwd: __dirname,
    },
  ],
}
