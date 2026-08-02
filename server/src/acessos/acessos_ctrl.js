'use strict'

const { db } = require('../database')

const controller = {}

// Historico de acesso. Portado do dashboard do Auth Server externo
// (https://github.com/1cgeo/auth_server, `server/src/dashboard/`), que saiu de
// cena em 2026-08-02 quando a autenticacao veio para dentro do SCA.
//
// O que MUDOU no porte, e por que:
//
//  1. NAO EXISTE MAIS `dgeo.aplicacao`. O Auth Server servia varios sistemas
//     (SAP, Gerenciador FME) e por isso trazia um catalogo de aplicacoes com
//     CRUD proprio. Aqui o autenticador serve UM sistema, e a lista fechada
//     ('sca_web', 'sca_qgis') vive no Joi de `login/login_schema.js`. Onde o
//     original dizia "aplicacao", aqui se diz "cliente", que e coluna VARCHAR
//     da propria `dgeo.login`. Some com isso a metade do painel que contava
//     aplicacoes ATIVAS: um catalogo de duas linhas nao tem o que contar.
//
//  2. SAIU `tipo_turno`. O `dgeo.usuario` do Auth Server tinha turno de
//     trabalho e o do SCA nao. Inventar a coluna aqui seria campo de dominio
//     que nao esta no DDL.
//
//  3. OS PARAMETROS DEIXARAM DE SER INTERPOLACAO CRUA. No original todo
//     recorte entrava como `interval '$<total:raw> day'` e o teto como
//     `LIMIT $<max:raw>`, ou seja, o valor era COLADO no texto do SQL, dentro
//     de um literal de intervalo. Funcionava porque o Zod validava antes, mas e
//     uma injecao que depende de a validacao nunca afrouxar -- e a regra da
//     casa e SQL parametrizado, sem excecao. Aqui o intervalo se monta por
//     aritmetica (`$<total> * INTERVAL '1 day'`) e o `LIMIT $<max>` e parametro
//     normal do pg-promise: os dois passam pelo formatador, e um valor que nao
//     seja numero quebra na formatacao em vez de virar SQL.

// O dia de calendario nesta feature e SEMPRE 'AAAA-MM-DD'.
//
// No Auth Server isto era `toLocalDateString`, e existia porque as colunas DATE
// chegavam do driver como Date na MEIA-NOITE LOCAL: um `toISOString()` (que fala
// UTC) devolvia o dia ANTERIOR em qualquer fuso de offset positivo, e a serie
// inteira deslizava um dia.
//
// No SCA o defeito ja foi fechado na raiz -- `database/db.js` registra um type
// parser para o OID 1082 (DATE) que devolve a string crua, pela mesma regressao
// vista na "Data de entrega" da mapoteca em 2026-07-27. Entao aqui a coluna ja
// chega como string e esta funcao normalmente nao tem trabalho.
//
// Ela fica assim mesmo, e trata os DOIS casos, porque o contrato desta rota e a
// string de dia: se alguem desfizer o parser global, ou se a consulta um dia
// devolver um instante em vez de um `::date`, a serie continua saindo em dia de
// calendario em vez de escorregar em silencio. Formatar por componentes LOCAIS
// (e nunca por `toISOString`) e o que o original ensinou.
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
 * Quem entrou HOJE: o ultimo login de cada par usuario + cliente no dia.
 *
 * O recorte por data entra DENTRO do agrupamento, e nao depois dele como no
 * original (`WHERE l.ultimo_login::date = now()::date` sobre o max de toda a
 * historia). O resultado e o mesmo -- para quem entrou hoje, o maior login de
 * hoje E o maior login de sempre --, mas assim o `login_data_login_idx` serve
 * para alguma coisa, em vez de a consulta varrer a tabela inteira e so entao
 * jogar fora quase tudo.
 *
 * INNER JOIN com `dgeo.usuario`, de proposito: quem foi apagado hoje some deste
 * painel. Ele responde "quem esta no sistema agora", e nao ha nome para
 * mostrar. A passagem dela nao se perde -- `dgeo.login.usuario_id` e ON DELETE
 * SET NULL, e a linha continua contando nos totais e aparecendo no ranking como
 * 'Usuario deletado'.
 */
controller.logados = async () => {
  return db.conn.any(
    `SELECT ROW_NUMBER() OVER (ORDER BY l.ultimo_login DESC)::integer AS id,
            l.ultimo_login,
            l.cliente,
            u.login,
            u.nome_guerra,
            tpg.nome_abrev AS tipo_posto_grad
       FROM (
             SELECT usuario_id, cliente, max(data_login) AS ultimo_login
               FROM dgeo.login
              WHERE data_login >= now()::date
                AND usuario_id IS NOT NULL
              GROUP BY usuario_id, cliente
            ) AS l
       INNER JOIN dgeo.usuario AS u ON u.id = l.usuario_id
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
      ORDER BY l.ultimo_login DESC`
  )
}

/**
 * Os tres numeros do topo da tela.
 *
 * Uma consulta so, com subselects: sao tres contagens independentes e sem
 * junção entre si, e tres idas ao banco para preencher tres caixinhas da mesma
 * tela nao se pagam.
 *
 * `::integer` em cada uma porque `count()` e BIGINT, e o pg-promise entrega
 * BIGINT como STRING para nao perder precisao. Sem o cast, `usuarios_ativos`
 * chegaria como '12' na tela e qualquer soma no cliente viraria concatenacao.
 * Mesma razao do `::integer` nas series abaixo.
 */
controller.resumo = async () => {
  return db.conn.one(
    `SELECT
       (SELECT count(*) FROM dgeo.usuario WHERE ativo IS TRUE)::integer AS usuarios_ativos,
       (SELECT count(*) FROM dgeo.login WHERE data_login >= now()::date)::integer AS logins_hoje,
       (SELECT count(*) FROM dgeo.login
         WHERE data_login >= (now()::date - 29 * INTERVAL '1 day'))::integer AS logins_30_dias`
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
 * Logins por MES, um ponto por mes do periodo. Mesma regra do zero da serie
 * diaria: mes sem login entra com 0.
 *
 * A data devolvida e o PRIMEIRO dia do mes, e nao 'AAAA-MM': quem consome
 * ordena e formata por conta propria, e um dia de calendario e mais facil de
 * ordenar do que um rotulo.
 */
controller.loginsMes = async total => {
  const linhas = await db.conn.any(
    `SELECT mes::date AS data, count(l.id)::integer AS logins
       FROM generate_series(
              date_trunc('month', now()) - ($<total> - 1) * INTERVAL '1 month',
              date_trunc('month', now()),
              INTERVAL '1 month'
            ) AS mes
       LEFT JOIN dgeo.login AS l
              ON l.data_login >= mes
             AND l.data_login < mes + INTERVAL '1 month'
      GROUP BY mes
      ORDER BY mes`,
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

/**
 * Logins por cliente no periodo: web contra QGIS.
 *
 * Sem `max`, ao contrario do ranking de usuarios: a lista de clientes e FECHADA
 * e tem duas entradas (`login/login_schema.js`). Um teto aqui so teria como
 * efeito esconder um cliente novo no dia em que ele entrasse.
 *
 * Sai o que EXISTE no periodo, e nao a lista do Joi com zeros: esta rota conta
 * o que aconteceu, e o proprio zero de um cliente e informacao que a tela sabe
 * mostrar a partir da ausencia.
 */
controller.loginsClientes = async total => {
  return db.conn.any(
    `SELECT l.cliente, count(l.id)::integer AS logins
       FROM dgeo.login AS l
      WHERE l.data_login >= ${INICIO_JANELA_DIAS}
      GROUP BY l.cliente
      ORDER BY count(l.id) DESC, l.cliente`,
    { total }
  )
}

module.exports = controller
