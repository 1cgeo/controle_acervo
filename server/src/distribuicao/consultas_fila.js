'use strict'

const path = require('path')

const { db } = require('../database')

/**
 * As quatro consultas de fila, e a de cabecalho do pacote, LIDAS DE ARQUIVO.
 *
 * POR QUE NAO SAO TEMPLATE STRING NO CONTROLLER, como o resto do SCA. As quatro
 * somam ~250 linhas de SQL e sao a regra de negocio mais densa do sistema: elas
 * decidem qual atividade cada pessoa recebe. Dentro de uma template string elas
 * perdem o realce de sintaxe, nao se comparam com a origem do SAP linha a linha
 * e nao se colam num psql para depurar sem editar. O SAP as mantinha em arquivo
 * pelo mesmo motivo, e o pedaco mais provavel de precisar de conserto e
 * justamente este.
 *
 * `QueryFile` E NAO `PreparedStatement`, e a diferenca importa aqui. O SAP usava
 * PS com parametro POSICIONAL (`$1`); o SCA parametriza por NOME
 * (`$<usuarioUuid>`), que e o que permite a mesma chave aparecer quatro vezes na
 * mesma consulta -- e ela aparece, nos filtros 3 e 4 da fila normal. O
 * `PreparedStatement` do pg-promise nao aceita nome, entao o par
 * PS + `$<...>` nao existe.
 *
 * `minify` LIGADO: `pg-minify` tira comentario e espaco antes de o texto ir ao
 * banco, e os comentarios acima de cada consulta sao longos de proposito.
 * `debug` desligado fora do desenvolvimento e o que evita reler o arquivo do
 * disco a cada requisicao.
 */
const arquivo = nome =>
  new db.pgp.QueryFile(path.join(__dirname, 'sql', nome), {
    minify: true,
    debug: process.env.NODE_ENV === 'development'
  })

module.exports = {
  calculaFilaPrioritaria: arquivo('calcula_fila_prioritaria.sql'),
  calculaFilaPrioritariaGrupo: arquivo('calcula_fila_prioritaria_grupo.sql'),
  calculaFilaPausada: arquivo('calcula_fila_pausada.sql'),
  calculaFila: arquivo('calcula_fila.sql'),
  retornaDadosProducao: arquivo('retorna_dados_producao.sql')
}
