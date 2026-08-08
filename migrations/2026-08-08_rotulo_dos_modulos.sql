-- OS MODULOS 1 E 3 PASSAM A SE CHAMAR "Acervo" E "Orçamento" NA INTERFACE.
--
-- A DECISAO E DO CHEFE, e e de rotulo: onde a tela escrevia "Controle do Acervo"
-- e "Controle Orçamentário" passa a escrever "Acervo" e "Orçamento". O nome
-- comprido nasceu do nome dos dois sistemas de origem, o SCA e o SCO absorvido em
-- 2026-07-27, e sobrou dentro de uma lista onde os vizinhos ja eram substantivo
-- seco: Mapoteca, Produção, Efetivo. Na coluna do menu e no cabecalho da tela de
-- usuarios o "Controle do" se repetia em toda linha sem distinguir nada, e ainda
-- fazia o modulo Acervo parecer o sistema inteiro, que se chama Sistema de
-- Controle do Acervo. O sistema NAO muda de nome; so o modulo.
--
-- O `nome_abrev` NAO MUDA, E ESTE E O PONTO INTEIRO DESTA MIGRACAO. A tabela tem
-- duas colunas de nome, e elas nao sao sinonimos:
--
--   `nome`       ROTULO. Ninguem decide nada com ele: ele so aparece na tela. E
--                a unica coluna que este arquivo toca.
--   `nome_abrev` IDENTIFICADOR ('acervo', 'mapoteca', 'orcamento', 'producao',
--                'efetivo'). O valor exato esta escrito a mao no codigo inteiro.
--
-- Quem "arrumar" o `nome_abrev` para casar com o rotulo novo derruba a
-- autorizacao de todo mundo, sem erro de sintaxe e sem teste vermelho no banco.
-- Ele e comparado por igualdade de string em, no minimo:
--
--   server/src/login/verify_perfil.js   o mapa `MODULO`, que traduz o nome para
--                                       o `code` antes de consultar
--                                       `dgeo.usuario_perfil`
--   toda rota fora do acervo            `verifyPerfil('operador', 'orcamento')`
--   server/src/routes.js                o prefixo `/api/orcamento/`
--   o login                             a chave do mapa `perfis` devolvido ao
--                                       client
--   client/src/js/modules/registry.js   o manifesto de cada modulo, que casa a
--                                       chave do perfil com o menu e as rotas
--
-- Nao ha chave estrangeira nem constraint que avise: `usuario_perfil.modulo_id`
-- aponta para o `code`, nao para o texto. O sintoma seria "usuario perde o acesso
-- ao modulo" em producao, e nada mais.
--
-- OS MODULOS 2, 4 E 5 NAO SAO TOCADOS: "Mapoteca", "Produção" e "Efetivo" ja sao
-- o substantivo seco que os outros dois passam a ser.
--
-- ESTA MIGRACAO NAO CARIMBA VERSAO, e e deliberado. A regra do README: o piso
-- `MIN_DATABASE_VERSION` (server/src/config.js) so sobe quando uma migracao
-- ACRESCENTA schema, tabela ou coluna que o codigo passa a ler. Aqui nao ha
-- schema novo, coluna nova, nem leitor novo: o mesmo `SELECT nome` de sempre
-- devolve um texto diferente. Um banco que nunca rodar este arquivo continua
-- servindo esta versao do codigo sem faltar nada, com o menu escrito do jeito
-- velho. Carimbar criaria uma obrigacao de migrar que a mudanca nao justifica, e
-- ainda desencontraria `er/versao.sql`, que descreve a instalacao nova e ja
-- carimba a versao corrente.
--
-- Como ela nao carimba, ela tambem nao tem lugar na fila: o README manda aplicar
-- as migracoes na ordem da VERSAO que cada uma carimba, e esta pode entrar antes
-- ou depois de qualquer outra. A unica coisa de que ela depende, `dominio.modulo`
-- com as linhas 1 e 3, existe desde a instalacao.
--
-- Idempotente: e um UPDATE de valor fixo por chave primaria. Rodar duas vezes
-- escreve o mesmo texto e nao levanta erro. Rodar num banco que ja nasceu com o
-- nome novo (instalacao nova pelo `er/`) tambem nao muda nada.

BEGIN;

UPDATE dominio.modulo SET nome = 'Acervo'    WHERE code = 1;
UPDATE dominio.modulo SET nome = 'Orçamento' WHERE code = 3;

COMMIT;

-- Para desfazer (rotulo de volta ao antigo; nada de negocio depende dele):
--
--   BEGIN;
--   UPDATE dominio.modulo SET nome = 'Controle do Acervo'    WHERE code = 1;
--   UPDATE dominio.modulo SET nome = 'Controle Orçamentário' WHERE code = 3;
--   COMMIT;
--
-- Sem `UPDATE public.versao` dos dois lados: a ida nao carimbou, a volta nao
-- descarimba.
