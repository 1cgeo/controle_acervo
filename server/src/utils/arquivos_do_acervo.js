'use strict'

/**
 * O ACERVO GUARDA ARQUIVO EM DUAS TABELAS, e as duas disputam o mesmo disco.
 *
 * `acervo.arquivo` é o do produto e `ponto_controle.arquivo` é o do ponto de
 * controle. As duas apontam `acervo.volume_armazenamento`, gravam no MESMO
 * volume físico e consomem a MESMA capacidade cadastrada: tudo que fala de
 * espaço ocupado tem de somar as duas. Contar só a primeira faz o volume do
 * ponto de controle aparecer vazio com dezenas de GB dentro.
 *
 * ESTE MÓDULO EXISTE PARA O PAR NÃO VOLTAR A DIVERGIR. O dashboard já somava as
 * duas e as três checagens de espaço do `prepare-upload` somavam só a primeira:
 * um volume de 100 GB com 90 GB de ponto de controle e 5 GB de acervo disparava
 * o alerta de 80% no `system_health` e, na mesma hora, aceitava uma sessão de
 * 60 GB no `prepare-upload`. O operador copiava por SMB até o disco encher, e a
 * falha aparecia no `cp`, não no servidor.
 *
 * `data_cadastramento` viaja junto porque a série de crescimento
 * (`getStorageGrowthTrends`) precisa dela.
 */
const ARQUIVOS_DO_ACERVO = `
  SELECT volume_armazenamento_id, tamanho_mb, data_cadastramento FROM acervo.arquivo
  UNION ALL
  SELECT volume_armazenamento_id, tamanho_mb, data_cadastramento FROM ponto_controle.arquivo`

/** Espaço livre no volume, em GB, contando as DUAS tabelas. */
const SQL_ESPACO_DISPONIVEL = `
  SELECT (va.capacidade_gb - COALESCE(SUM(a.tamanho_mb), 0) / 1024) AS espaco_disponivel
    FROM acervo.volume_armazenamento va
    LEFT JOIN (${ARQUIVOS_DO_ACERVO}) a ON a.volume_armazenamento_id = va.id
   WHERE va.id = $1
   GROUP BY va.id, va.capacidade_gb`

/**
 * Recusa o envio que não cabe no volume, ANTES de o cliente copiar byte.
 *
 * Era três blocos idênticos dentro do `arquivo_ctrl.js`, um por rota de
 * `prepare-upload`, e o envio pela web não tinha nenhum.
 *
 * @param {object} t          executor pg-promise (`db.conn` ou transação)
 * @param {number} volumeId   volume_armazenamento_id
 * @param {number} gbNecessarios espaço pedido, em GB
 * @param {Function} construirErro recebe (necessarioGb, disponivelGb) e devolve
 *   o erro a lançar. Fica com quem chama porque `AppError` e `httpCode` moram em
 *   `utils/index.js`, e importá-los daqui fecharia um ciclo.
 */
const assertEspacoNoVolume = async (t, volumeId, gbNecessarios, construirErro) => {
  const { espaco_disponivel: disponivel } = await t.one(SQL_ESPACO_DISPONIVEL, [volumeId])

  if (Number(disponivel) < Number(gbNecessarios)) {
    throw construirErro(Number(gbNecessarios), Number(disponivel))
  }
}

module.exports = { ARQUIVOS_DO_ACERVO, SQL_ESPACO_DISPONIVEL, assertEspacoNoVolume }
