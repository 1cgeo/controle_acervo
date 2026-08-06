-- PRODUCAO E EFETIVO VIRAM MODULOS, PARA HAVER COMO DAR MENOS QUE ADMINISTRADOR.
--
-- A DECISAO, na palavra do chefe da DGEO: "Em Gestão temos controle só de
-- acervo, mapoteca, orçamentário, está faltando de produção e efetivo. Acredito
-- que o operador para Produção seja execução do pit, extra-pit e capacitação
-- ministrada. E o Operador para efetivo seja aproveitamento e capacitação
-- recebida."
--
-- O QUE O SISTEMA FAZIA. A autorizacao tinha duas camadas: a flag global
-- `dgeo.usuario.administrador`, que vale em qualquer modulo, e o perfil POR
-- MODULO em `dgeo.usuario_perfil`, com tres niveis (1 Consulta, 2 Operador,
-- 3 Gerente). So havia modulo para acervo, mapoteca e orcamento. O trabalho de
-- producao e o de efetivo nao tinham modulo nenhum, entao a unica guarda
-- disponivel para eles era `verifyAdmin`.
--
-- QUANTAS ROTAS ISSO PRENDIA, contado no fonte em 2026-08-06:
--
--   area                                     rotas   guarda de antes
--   /efetivo (periodos, impedimentos, mapa, mes)  10   todas verifyAdmin
--   /rpcmtec/capacitacao                           6   todas verifyAdmin
--   execucao do PIT (gravar e apagar)              2   verifyAdmin
--   Extra-PIT (criar, alterar, apagar)             3   verifyAdmin
--
-- Quem lanca um mes da execucao do PIT, cadastra um Extra-PIT ou registra uma
-- capacitacao precisava da MESMA flag que libera o orcamento inteiro e o
-- cadastro de usuarios.
--
-- O EFEITO ESTA MEDIDO EM PRODUCAO (2026-08-06, em transacao somente leitura,
-- com o banco carimbado 1.26.0). Das 28 contas ativas, 7 conseguem fazer alguma
-- coisa: 5 sao administradores globais e 2 tem perfil de modulo. Ou seja, 5 das
-- 7 contas que trabalham no sistema carregam a flag global. A causa nao e
-- descuido de quem concedeu: nao havia como dar menos.
--
-- Perfis de modulo concedidos hoje, contas ativas:
--
--   acervo     Gerente    1
--   mapoteca   Gerente    1
--   mapoteca   Operador   1
--   orcamento  Consulta   1
--
-- O QUE ESTA MIGRACAO FAZ. Acrescenta duas linhas em `dominio.modulo`, e nada
-- mais. Ela nao concede perfil a ninguem, nao mexe em `dgeo.usuario_perfil` e
-- nao tira a flag de ninguem: quem e administrador continua passando em tudo. O
-- que ela cria e a POSSIBILIDADE de conceder menos, pela tela de usuarios, que
-- monta uma coluna por linha de `dominio.modulo` e por isso ganha as duas novas
-- sozinha.
--
-- POR QUE E TABELA, E NAO CHECK NA COLUNA: `dominio.modulo` foi feita assim
-- justamente para que acrescentar um modulo fosse INSERT, e nao migracao de
-- constraint. Esta e a primeira vez que a promessa e cobrada.
--
-- OS CODIGOS 4 E 5 SAO FIXOS, e nao serial: `dgeo.usuario_perfil.modulo_id`
-- referencia `dominio.modulo.code`, e o mapa `MODULO` de
-- server/src/login/verify_perfil.js espelha estes numeros no codigo. Dois lugares
-- com o mesmo numero escrito a mao divergem no primeiro que alguem mudar, entao
-- eles nascem juntos aqui.
--
-- O QUE CONTINUA SENDO DO ADMINISTRADOR GLOBAL, de proposito: as METAS e as
-- REVISOES do PIT (alterar o PIT e ato da DSG, e o que esta no sistema e
-- transcricao de documento assinado), a EDICAO do RPCMTec (o relatorio que o
-- chefe assina), o de-para de midia, o cadastro de usuarios e o orcamento.

BEGIN;

-- Idempotente pelo `code`, que e a chave primaria. Rodar duas vezes nao
-- duplica nem levanta erro, que e o que o README promete de toda migracao.
INSERT INTO dominio.modulo (code, nome, nome_abrev) VALUES
(4, 'Produção', 'producao'),
(5, 'Efetivo', 'efetivo')
ON CONFLICT DO NOTHING;

UPDATE public.versao SET nome = '1.33.0' WHERE code = 1;

COMMIT;

-- Para desfazer:
--
--   BEGIN;
--   DELETE FROM dgeo.usuario_perfil WHERE modulo_id IN (4, 5);
--   DELETE FROM dominio.modulo WHERE code IN (4, 5);
--   UPDATE public.versao SET nome = '1.32.0' WHERE code = 1;
--   COMMIT;
--
-- O DELETE em `dgeo.usuario_perfil` VEM PRIMEIRO, e nao e zelo: a chave
-- estrangeira `usuario_perfil.modulo_id -> dominio.modulo.code` recusaria a
-- remocao do modulo enquanto houvesse uma concessao apontando para ele. E ele
-- APAGA ACESSO: quem tiver ganhado perfil em Producao ou Efetivo perde o acesso
-- aquelas telas, e volta a precisar da flag global. Desfazer depois de conceder
-- exige avisar quem perdeu.
