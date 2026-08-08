-- A CONTAGEM SAI DO DOMINIO, e nao so das portas de escrita
--
-- Decisao do chefe em 2026-08-08, algumas horas depois da 1.45.0. Em uma frase:
-- a linha 4 de `mapoteca.tipo_movimento_material` foi guardada para um passado
-- que, medido, nao chegou a existir -- entao ela sai.
--
-- O QUE HAVIA. A 1.45.0 extinguiu a Contagem e DEIXOU o code 4 na tabela de
-- dominio, renomeado para "Contagem (extinta)". O argumento era bom e esta
-- escrito em `docs/decisoes.md`: `auditoria.evento` guarda o valor GRAVADO, e
-- quem o traduz para a tela e o catalogo VIVO desta tabela, lido por
-- `auditoria/renderizar.js`. Sem a linha, um evento antigo de movimento passaria
-- a exibir "Tipo de movimento: 4", cru.
--
-- O QUE A MEDICAO MOSTROU, e e o que derruba o argumento. A janela em que uma
-- Contagem podia ser lancada foi da 1.41.0 a 1.45.0, ambas de 2026-08-08:
--
--   `mapoteca.movimento_material` com tipo 4, no banco de desenvolvimento .. 0
--   eventos em `auditoria.evento` citando tipo 4 ............................ 0
--   movimentos de QUALQUER tipo, no banco de desenvolvimento ............... 0
--   `mapoteca.movimento_material` no dump de producao de 2026-08-08 ... nao existe
--
-- A tabela do livro nem estava criada em producao: ela nasceu na 1.41.0, DEPOIS
-- do dump. E a conversao feita pela `2026-08-08_fim_da_contagem.sql` tampouco
-- deixa rastro que precise da linha: ela troca o tipo com UPDATE direto
-- (linhas 80 a 91 daquele arquivo), sem escrever em `auditoria.evento`.
--
-- O QUE ISSO CUSTA. Se algum ambiente que ninguem mediu tiver lancado Contagem
-- entre a 1.41.0 e a 1.45.0, o evento daquele lancamento passa a exibir o codigo
-- cru. As duas guardas abaixo existem para que esse ambiente PARE aqui em vez de
-- descobrir isso na tela: a migracao levanta excecao e nao apaga nada.
--
-- O QUE PASSA A RECUSAR O LANCAMENTO. Antes eram dois: o `ELSE FALSE` do CHECK
-- `movimento_material_forma` e o Joi de `mapoteca_schema.js`. Agora sao tres --
-- a chave estrangeira `movimento_material.tipo_movimento_id` deixou de ter para
-- onde apontar.

BEGIN;

-- GUARDA 1: nenhuma linha do livro pode depender do code 4.
--
-- A chave estrangeira ja recusaria o DELETE, e a mensagem dela nomearia a
-- constraint em vez do problema. Esta guarda existe para a mensagem, e para o
-- numero: quem a ler sabe QUANTAS linhas precisam ser convertidas antes.
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM mapoteca.movimento_material
   WHERE tipo_movimento_id = 4;

  IF n > 0 THEN
    RAISE EXCEPTION
      'mapoteca.movimento_material tem % linha(s) de Contagem. Rode a 2026-08-08_fim_da_contagem.sql antes: ela CONVERTE essas linhas (falta vira Consumo, sobra vira Entrada) em vez de apaga-las, porque apaga-las zeraria o saldo.', n;
  END IF;
END $$;

-- GUARDA 2: nenhum evento de auditoria pode precisar traduzir o code 4.
--
-- Esta e a guarda que defende o ARGUMENTO da 1.45.0. O `dados_antes` e o
-- `dados_depois` guardam o valor gravado como JSON, e e ele que
-- `auditoria/renderizar.js` traduz pelo catalogo vivo. Se houver um, a linha do
-- dominio ainda tem leitor e nao pode sair.
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n
    FROM auditoria.evento
   WHERE dados_antes->>'tipo_movimento_id' = '4'
      OR dados_depois->>'tipo_movimento_id' = '4';

  IF n > 0 THEN
    RAISE EXCEPTION
      'auditoria.evento tem % evento(s) citando o tipo de movimento 4. A linha do dominio ainda tem leitor: sem ela esses eventos passariam a exibir "Tipo de movimento: 4", cru. Nao apague.', n;
  END IF;
END $$;

DELETE FROM mapoteca.tipo_movimento_material WHERE code = 4;

UPDATE public.versao SET nome = '1.48.0' WHERE code = 1;

COMMIT;

-- Para desfazer:
--
--   BEGIN;
--   INSERT INTO mapoteca.tipo_movimento_material (code, nome)
--     VALUES (4, 'Contagem (extinta)')
--     ON CONFLICT (code) DO NOTHING;
--   UPDATE public.versao SET nome = '1.47.0' WHERE code = 1;
--   COMMIT;
--
-- Desfazer devolve a linha do dominio e NADA MAIS: ela nao volta a ser lancavel,
-- porque quem a recusa e o `ELSE FALSE` do CHECK `movimento_material_forma` e o
-- Joi, e nenhum dos dois foi tocado aqui nem na 1.45.0. Ressuscitar a Contagem
-- de verdade e outra migracao, e e decisao que se registra em
-- `docs/decisoes.md`.
--
-- O PISO NAO SOBE. `MIN_DATABASE_VERSION` fica em 1.46.0: este servidor nao le a
-- linha 4 em lugar nenhum, e um banco que ainda a tenha responde igual. Quem
-- quebraria e o caminho contrario -- um servidor anterior a 1.45.0 contra este
-- banco -- e esse ja estava quebrado pela 1.45.0, que tirou o tipo do Joi.
