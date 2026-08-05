'use strict'

const { db } = require('../database')

const controller = {}

// Historico de acesso: quem entrou no SCA, quando e por qual cliente.
//
// TODO recorte e parametro do pg-promise, sem interpolacao crua: o intervalo se
// monta por aritmetica (`$<total> * INTERVAL '1 day'`) e o teto e `LIMIT $<max>`.
// Colar o valor no texto do SQL e injecao que depende de a validacao nunca
// afrouxar; aqui um valor que nao seja numero quebra na formatacao.

// O dia de calendario nesta feature e SEMPRE 'AAAA-MM-DD'.
//
// O `database/db.js` ja registra um type parser para o OID 1082 (DATE) que
// devolve a string crua, entao a coluna normalmente chega pronta. Esta funcao
// trata os DOIS casos assim mesmo: se alguem desfizer o parser global, ou se a
// consulta devolver um instante em vez de um `::date`, a serie continua saindo
// em dia de calendario em vez de escorregar um dia em silencio. Formate por
// componentes LOCAIS, nunca por `toISOString`, que fala UTC.
const paraDiaLocal = valor => {
  if (valor === null || valor === undefined) return null

  if (typeof valor === 'string') return valor.slice(0, 10)

  const ano = valor.getFullYear()
  const mes = String(valor.getMonth() + 1).padStart(2, '0')
  const dia = String(valor.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

// Inicio de uma janela de N dias que TERMINA hoje, contando hoje.
//
// O `- 1` e o que faz `total=14` devolver 14 pontos e nao 15: o
// `generate_series` inclui os dois extremos. Escrito uma vez porque as quatro
// consultas com recorte diario tem de usar exatamente a mesma regua -- a serie
// e o ranking do mesmo periodo divergirem por um dia e o tipo de defeito que
// ninguem confere.
//
// Compara contra `now()::date`, e nao contra `now()`, porque a pergunta da tela
// e por DIA de calendario: "ultimos 30 dias" comecando as 14h de 30 dias atras
// cortaria a manha daquele dia pela metade.
const INICIO_JANELA_DIAS = "(now()::date - ($<total> - 1) * INTERVAL '1 day')"

/**
 * Quem entrou HOJE: uma linha por PESSOA, com os clientes que ela usou na
 * coluna `clientes`. Quem abriu a interface web e o plugin do QGIS no mesmo dia
 * e UMA pessoa.
 *
 * DEVOLVE `u.uuid`, e nao um numero de ordem: e ele que faz a linha virar link
 * para o aproveitamento daquela pessoa (`#/aproveitamento?usuario_uuid=`).
 *
 * O recorte por data entra DENTRO do agrupamento, para o `login_data_login_idx`
 * servir para alguma coisa em vez de a consulta varrer a tabela inteira.
 *
 * INNER JOIN com `dgeo.usuario`, de proposito: quem foi apagado hoje some deste
 * painel, que responde "quem esta no sistema agora". A passagem dela nao se
 * perde -- `dgeo.login.usuario_id` e ON DELETE SET NULL, e a linha continua
 * aparecendo no ranking como 'Usuario deletado'.
 */
controller.logados = async () => {
  return db.conn.any(
    `SELECT u.uuid,
            u.login,
            u.nome_guerra,
            tpg.nome_abrev AS tipo_posto_grad,
            max(l.data_login) AS ultimo_login,
            count(*)::integer AS logins,
            array_agg(DISTINCT l.cliente) AS clientes
       FROM dgeo.login AS l
       INNER JOIN dgeo.usuario AS u ON u.id = l.usuario_id
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
      WHERE l.data_login >= now()::date
      GROUP BY u.uuid, u.login, u.nome_guerra, tpg.nome_abrev
      ORDER BY max(l.data_login) DESC`
  )
}

/**
 * Os quatro numeros do topo da aba de acessos.
 *
 * CADA UM CONTA PESSOA, e nunca linha de `dgeo.login`: com JWT de 8 horas e dois
 * clientes, a mesma pessoa registra varios logins por dia, e "quantos logins"
 * nao e pergunta de ninguem.
 *
 * `count(DISTINCT usuario_id)` IGNORA O NULO, e isso esta certo aqui: o login de
 * quem foi apagado nao pertence a nenhuma pessoa que se possa contar.
 *
 * `contas_ativas` e `contas_sem_senha` falam de CONTA, e nao de gente: `ativo` e
 * permissao de entrar, e `senha` nula e quem nao consegue entrar. Quantos
 * militares estao na Divisao e pergunta da aba Efetivo.
 *
 * A JANELA DE 30 DIAS E FIXA, ao contrario da serie e do ranking, que a tela
 * recorta: ela e o retrato do modulo, e nao a resposta ao filtro.
 *
 * `::integer` em cada uma porque `count()` e BIGINT, e o pg-promise o entrega
 * como STRING para nao perder precisao: sem o cast, qualquer soma no cliente
 * vira concatenacao. Mesma razao do `::integer` nas series abaixo.
 */
controller.resumo = async () => {
  return db.conn.one(
    `SELECT
       (SELECT count(*) FROM dgeo.usuario WHERE ativo IS TRUE)::integer AS contas_ativas,
       (SELECT count(*) FROM dgeo.usuario WHERE senha IS NULL)::integer AS contas_sem_senha,
       (SELECT count(DISTINCT usuario_id) FROM dgeo.login
         WHERE data_login >= now()::date)::integer AS pessoas_hoje,
       (SELECT count(DISTINCT usuario_id) FROM dgeo.login
         WHERE data_login >= (now()::date - 29 * INTERVAL '1 day'))::integer AS pessoas_30_dias`
  )
}

/**
 * Logins por DIA, um ponto por dia do periodo.
 *
 * O `generate_series` com LEFT JOIN e o que faz o dia SEM login sair como zero
 * em vez de sumir da resposta. Agrupar so a `dgeo.login` devolveria uma serie
 * esburacada, e um grafico de linha ligaria terca a sexta como se quinta nao
 * tivesse existido.
 */
controller.loginsDia = async total => {
  const linhas = await db.conn.any(
    `SELECT dia::date AS data, count(l.id)::integer AS logins
       FROM generate_series(
              ${INICIO_JANELA_DIAS}::date,
              now()::date,
              INTERVAL '1 day'
            ) AS dia
       LEFT JOIN dgeo.login AS l ON l.data_login >= dia::date
                                AND l.data_login < dia::date + INTERVAL '1 day'
      GROUP BY dia::date
      ORDER BY dia::date`,
    { total }
  )

  return linhas.map(l => ({ data: paraDiaLocal(l.data), logins: l.logins }))
}

/**
 * Quem mais entrou no periodo, do maior para o menor, cortado em `max`.
 *
 * O COALESCE existe porque `dgeo.login.usuario_id` e ANULAVEL de proposito:
 * apagar a pessoa nao apaga a passagem dela pelo sistema. Sem ele, o login de
 * quem saiu viraria uma linha com o rotulo nulo -- e ja apareceu neste
 * repositorio uma fatia chamada 'null' num grafico por exatamente esse motivo
 * (a escala do item avulso da mapoteca).
 *
 * O agrupamento e por `u.id`, e nao pelo rotulo montado: dois homonimos com o
 * mesmo posto ficariam somados num so, e o login (que e UNIQUE) so entra no
 * texto. As linhas de usuario apagado caem todas em `u.id IS NULL`, ou seja,
 * viram UMA linha 'Usuario deletado', que e o que a tela quer dizer.
 */
controller.loginsUsuarios = async (total, max) => {
  return db.conn.any(
    `SELECT COALESCE(
              tpg.nome_abrev || ' ' || u.nome_guerra || ' (' || u.login || ')',
              'Usuário deletado'
            ) AS usuario,
            count(l.id)::integer AS logins
       FROM dgeo.login AS l
       LEFT JOIN dgeo.usuario AS u ON u.id = l.usuario_id
       LEFT JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
      WHERE l.data_login >= ${INICIO_JANELA_DIAS}
      GROUP BY u.id, tpg.nome_abrev, u.nome_guerra, u.login
      ORDER BY count(l.id) DESC, usuario
      LIMIT $<max>`,
    { total, max }
  )
}

module.exports = controller
