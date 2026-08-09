// Deploy de producao do SAP (Sistema de Apoio a Producao) via PM2.
//
// O NOME DO PROCESSO PM2 CONTINUA `controle-acervo`, e nao acompanhou a
// renomeacao de 2026-08-09: ele esta gravado no `pm2 save` de quem ja implantou,
// e troca-lo faria o `startOrReload` subir um SEGUNDO processo ao lado do que ja
// esta rodando, na mesma porta.
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
