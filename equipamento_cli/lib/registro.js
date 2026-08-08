'use strict'

// Ler um registro de volta QUANDO NAO EXISTE GET POR ID.
//
// O tipo de equipamento e os quatro historicos nao tem rota `/:id`: eles so
// aparecem em lista (e os historicos tambem dentro da ficha do bem). Como o PUT
// deste modulo SUBSTITUI a linha inteira, toda alteracao precisa do estado atual
// antes de reenviar, e e daqui que ele sai.
//
// A leitura e SEM FILTRO de proposito, e isso parece desperdicio. O filtro
// obvio seria `equipamento_id`, mas nos historicos essa mesma chave e um CAMPO
// DO CORPO: em `editar --equipamento_id 5` ela quer dizer "passe este lancamento
// para o bem 5", e usa-la tambem como filtro de leitura procuraria o lancamento
// no bem de DESTINO, onde ele ainda nao esta. Uma lista a mais custa uma
// requisicao; um filtro com dois significados custa um lancamento perdido.

const http = require('./http')

/**
 * @param {object} cfg
 * @param {string} caminho rota da colecao, sem /api
 * @param {string|number} id
 * @param {string} rotulo como o erro chama o registro
 */
async function lerDaLista (cfg, caminho, id, rotulo) {
  const r = await http.autenticada(cfg, 'GET', caminho)
  const linhas = Array.isArray(r.dados) ? r.dados : []
  const achado = linhas.find(l => String(l.id) === String(id))

  if (!achado) {
    throw new Error(
      `${rotulo} ${id} não foi encontrado. Este recurso não tem GET por id: ` +
      'o registro é procurado na lista, e ela trouxe ' +
      `${linhas.length} linha(s). Confira o id com o verbo \`listar\`.`
    )
  }

  return achado
}

module.exports = { lerDaLista }
