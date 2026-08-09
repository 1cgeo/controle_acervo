  -- GRANTs do BANCO DA TELEMETRIA. Não confundir com `er/permissao.sql`, que é
  -- do banco do SAP: este arquivo roda numa conexão a outro banco, e o `$1`
  -- que ele recebe é o papel de `MICRO_DB_USER`, e não o de `DB_USER`.
  --
  -- SELECT E INSERT, SEM UPDATE E SEM DELETE. É a mesma escolha de `auditoria`
  -- no banco principal, e pela mesma razão: a linha aqui é a PROVA de que o
  -- trabalho aconteceu, e uma medição que a própria aplicação pode reescrever
  -- não mede nada. Nenhum caminho de código altera nem apaga amostra: não
  -- existe PUT nem DELETE em `/api/microcontrole`, e as duas rotas de escrita
  -- (`POST /feicao` e `POST /tela`) só inserem.
  --
  -- ISTO É INTENÇÃO ESCRITA, E NÃO UMA TRAVA. Quando `create_config.js` cria
  -- este banco, quem executa os arquivos é o próprio `MICRO_DB_USER`, que fica
  -- DONO das tabelas -- e dono contorna GRANT. A trava real, se a instalação a
  -- quiser, é criar o banco com um papel administrativo e deixar o
  -- `MICRO_DB_USER` só com o que está aqui. O arquivo serve aos dois casos, e
  -- no primeiro ele documenta o que o código promete não fazer.
  --
  -- O PREÇO É O EXPURGO: apagar telemetria velha (e um dia isso vai ser
  -- decidido, porque a tabela cresce por turno) exige o dono do banco, e não uma
  -- rota. É o mesmo preço que `er/auditoria.sql` já paga, e ele é aceito pelo
  -- mesmo motivo.
  GRANT USAGE ON SCHEMA microcontrole TO $1:name;
  GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA microcontrole TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA microcontrole TO $1:name;

  -- `public` entra só por leitura, e o que há nele é `public.versao`, o carimbo
  -- deste banco. A extensão PostGIS também mora aqui: sem o USAGE, o
  -- `ST_MakeEnvelope` da rota de tela e o `ST_AsGeoJSON` da cobertura falhariam
  -- por função inexistente, que é um erro que não diz o que houve.
  GRANT USAGE ON SCHEMA public TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO $1:name;
