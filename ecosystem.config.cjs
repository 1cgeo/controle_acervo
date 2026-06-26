// Deploy de producao do Controle do Acervo (SCA) via PM2.
// Um unico processo: o server (porta 3015, do server/config.env) serve a API REST,
// o dashboard do acervo (em /) e o client da mapoteca (em /mapoteca) - tudo do
// server/src/build (gerado por `npm run build`, que builda os dois clients).
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
