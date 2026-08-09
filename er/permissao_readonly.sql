-- Permissões do usuário somente leitura ($1) usado nas URIs de camada do QGIS.
-- Acesso mínimo: views materializadas e tabelas do acervo, domínios e estilos
-- de camada (public.layer_styles). Sem acesso a dgeo (logins) e mapoteca.
-- $2 é o usuário principal do serviço (DB_USER), dono das MVs criadas em runtime.

  GRANT USAGE ON SCHEMA public TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO $1:name;

  GRANT USAGE ON SCHEMA dominio TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA dominio TO $1:name;

  GRANT USAGE ON SCHEMA acervo TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA acervo TO $1:name;

  -- Limite politico-administrativo: publico por natureza, do IBGE.
  GRANT USAGE ON SCHEMA limites TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA limites TO $1:name;

  -- ponto_controle NÃO entra: a tabela ponto guarda cpf_engenheiro_responsavel,
  -- e este usuário aparece na URI de camada de projetos QGIS compartilhados.
  -- Para expor o ponto no QGIS, crie uma view sem as colunas pessoais e conceda
  -- SELECT só nela.

  -- MVs criadas em runtime por acervo.criar_views_materializadas() (owner = $2)
  ALTER DEFAULT PRIVILEGES FOR ROLE $2:name IN SCHEMA acervo GRANT SELECT ON TABLES TO $1:name;
  ALTER DEFAULT PRIVILEGES FOR ROLE $2:name IN SCHEMA public GRANT SELECT ON TABLES TO $1:name;

  -- `acompanhamento` entra na 3.0.0, e ele e a RAZAO de este usuario existir: as
  -- views `lote_<N>`, `lote_<N>_subfase_<M>` e `bloco` sao geradas para o gerente
  -- ABRIR NO QGIS, por URI de camada, e sao as unicas do sistema desenhadas para
  -- isso. As funcoes que as criam ja fazem `GRANT SELECT ... TO PUBLIC` em cada
  -- uma, mas sem `USAGE` no SCHEMA esse grant e INERTE: o Postgres cobra os dois,
  -- e a camada abriria com erro de permissao sem que nada no `er/` parecesse
  -- errado.
  GRANT USAGE ON SCHEMA acompanhamento TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA acompanhamento TO $1:name;
  ALTER DEFAULT PRIVILEGES FOR ROLE $2:name IN SCHEMA acompanhamento GRANT SELECT ON TABLES TO $1:name;

  -- `producao` entra so com LEITURA, e so porque a view de acompanhamento nao
  -- basta: o gerente abre tambem `unidade_trabalho` para ver o recorte do
  -- trabalho sobre o mapa. Sem INSERT, UPDATE ou DELETE, como todo o resto deste
  -- arquivo.
  --
  -- `qgis` NAO entra: ele guarda a configuracao que o operador recebe, e nao dado
  -- a desenhar. `metadado` NAO entra: a ficha ET-PCDG sai por rota, e a tabela
  -- `metadado.usuario` guarda nome e identificacao de pessoa, que e exatamente o
  -- criterio que ja deixou `ponto_controle` de fora.
  --
  -- `microcontrole` NAO entra, e ha duas metades nessa frase. A daqui sao duas
  -- tabelas de CADASTRO (o que monitorar), sem geometria nenhuma: nao ha camada
  -- a abrir. A outra metade -- a telemetria, que TEM geometria em
  -- `monitoramento_tela.geom` -- mora em OUTRO BANCO, e este arquivo nao alcanca
  -- outro banco: os GRANTs de la estao em `er_microcontrole/permissao.sql`, e sao
  -- de um papel que nao e este. Quem quiser abrir a cobertura de tela no QGIS
  -- aponta o QGIS para o banco da telemetria, e nao para este.
  GRANT USAGE ON SCHEMA producao TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA producao TO $1:name;
