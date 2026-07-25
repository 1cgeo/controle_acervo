// Path: utils\preserve_omitted.js
'use strict'

/**
 * O PORQUÊ desta função (o bug que ela mata na raiz)
 *
 * As rotas de atualização do SCA montam o UPDATE com `pgp.helpers.update`, que
 * escreve TODAS as colunas do ColumnSet de uma vez. Quando o corpo da requisição
 * não traz uma chave, o valor gravado vem de um default (`Joi.default(...)` no
 * schema ou `def:` no ColumnSet). O efeito é perda SILENCIOSA: o servidor
 * responde 200 e o campo que o cliente nunca mencionou foi sobrescrito com o
 * default. Foi assim que uma Carta Militar podia deixar de ser militar, bastando
 * reenviar o que o GET devolveu (o GET não devolvia `subtipo_produto_id`, o
 * schema do PUT tinha `.default(null)`).
 *
 * A semântica correta para uma chave AUSENTE num PUT do SCA é "não mexe nesse
 * campo", nunca "apaga esse campo". Esta função implementa exatamente isso:
 * lê do banco, dentro da mesma transação, o valor atual de cada campo que o
 * cliente omitiu, e preenche o objeto antes do UPDATE.
 *
 * Enviar `null` explicitamente continua valendo como "limpa este campo": só a
 * AUSÊNCIA da chave (undefined) é tratada como "preserva".
 *
 * Pré-requisito: o schema Joi da atualização NÃO pode ter `.default(...)` nos
 * campos passados aqui, senão o Joi injeta a chave e ela nunca chega ausente.
 *
 * @param {object} t - Task/transação do pg-promise (a mesma do UPDATE)
 * @param {object} opts
 * @param {string} [opts.schema='acervo'] - Schema da tabela
 * @param {string} opts.table - Tabela do registro
 * @param {string} [opts.idColumn='id'] - Coluna que identifica o registro
 * @param {number|string} opts.id - Valor identificador do registro
 * @param {string[]} opts.fields - Campos cuja omissão deve preservar o valor atual
 * @param {object} opts.body - Corpo já validado, alterado no lugar
 * @returns {Promise<string[]>} Campos que foram preenchidos a partir do banco
 */
const preserveOmitted = async (
  t,
  { schema = 'acervo', table, idColumn = 'id', id, fields, body }
) => {
  const omitidos = fields.filter(campo => body[campo] === undefined)

  if (omitidos.length === 0) {
    return []
  }

  // `:name` escapa os identificadores (aqui sempre constantes do código, nunca
  // entrada do usuário, mas escapar mantém a função segura por construção)
  const atual = await t.oneOrNone(
    'SELECT $1:name FROM $2:name.$3:name WHERE $4:name = $5',
    [omitidos, schema, table, idColumn, id]
  )

  if (!atual) {
    // Registro inexistente: não inventar valor. O UPDATE seguinte não casa
    // nenhuma linha e o controller trata o 404 com a mensagem dele.
    return []
  }

  for (const campo of omitidos) {
    body[campo] = atual[campo]
  }

  return omitidos
}

module.exports = preserveOmitted
