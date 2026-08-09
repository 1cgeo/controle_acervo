# scripts/

Ferramentas que rodam **fora** do serviço. Nada aqui é importado pelo servidor.
A lista do que cada uma faz está no [`README.md`](../README.md) da raiz; aqui
fica o modo de uso.

Testes: `npm run test-scripts` (na raiz). Eles usam `node:test`, e cobrem o que
dá para provar sem banco: leitura dos argumentos, montagem do plano de cópia e o
relatório.

---

## `copiar_usuarios_auth.js`

Copia, UMA vez, os hashes de senha do banco do
[Auth Server](https://github.com/1cgeo/auth_server) para o do SCA. A coluna
`dgeo.usuario.senha` é **anulável** justamente porque quem a preenche é este
script, rodando por fora do sistema. Enquanto ela é nula a pessoa não entra, e o
login diz exatamente isso em vez de responder "senha inválida".

O hash bcrypt é **portátil**: ele carrega o custo dentro de si, e o SCA usa o
mesmo custo 10 do Auth Server (`server/src/login/senha.js`). O hash copiado vale
como está, sem rehash e sem ninguém trocar de senha.

### Conexões: só por variável de ambiente

Credencial **nunca** entra por argumento de linha de comando: ali ela fica no
histórico do shell e aparece no `ps` para qualquer um logado na máquina. O script
recusa, com essa razão, qualquer opção com cara de credencial (`--senha`,
`--db-url`, `--conexao`...).

| | Chaves |
|---|---|
| destino (SCA) | `DB_SERVER`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` |
| origem (Auth Server) | `AUTH_DB_SERVER`, `AUTH_DB_PORT`, `AUTH_DB_NAME`, `AUTH_DB_USER`, `AUTH_DB_PASSWORD` |

As do destino são as que o servidor já usa. As da origem existem só para esta
cópia: o catálogo comentado está no `.env.example`. O script lê o
`server/config.env` (como os outros scripts daqui) e também aceita as chaves
exportadas no ambiente do shell, o que evita escrever a credencial do outro
banco em arquivo. As duas portas têm padrão 5432; as demais chaves são
obrigatórias, e faltando alguma o script para e diz **qual**.

Origem e destino apontando para o mesmo host, porta e base é recusado.

Rode de uma máquina confiável, com alcance de rede aos dois bancos. **Depois que
a cópia terminar, apague as cinco chaves `AUTH_DB_*` do `config.env`**:
credencial de um banco que o serviço não usa não tem por que continuar no
arquivo que ele lê no boot.

### Ensaio primeiro, sempre

```bash
node scripts/copiar_usuarios_auth.js            # ENSAIO: lê os dois bancos e não escreve nada
node scripts/copiar_usuarios_auth.js --aplicar  # transação única, ou tudo ou nada
```

Sem `--aplicar` ele monta o plano inteiro e imprime o que faria, com as
contagens e uma amostra. É o que permite conferir contra uma cópia de produção
antes de tocar no banco real. O plano do ensaio é o **mesmo objeto** que a
transação executa, então o que o relatório promete é o que acontece.

| Opção | Efeito |
|---|---|
| `--aplicar` | escreve de verdade, numa transação só, com rollback em qualquer erro |
| `--atualizar-dados` | copia também `nome`, `nome_guerra` e `tipo_posto_grad_id` de quem já existe |
| `--incluir-novos` | cria quem só existe na origem |
| `--amostra N` | quantas linhas de exemplo mostrar (padrão 10, `0` desliga) |
| `--ajuda` | a ajuda |

### As regras que ele não negocia

- **Casa por `uuid`**, que é a mesma chave nos dois bancos. Nunca por login: o
  mesmo login com uuid diferente nos dois lados daria a senha de uma pessoa a
  outra. Esse caso vira a linha **conflito de login** do relatório, não é tocado,
  e é trabalho de gente resolver.
- **De quem já existe no SCA, copia só o hash.** Com `--atualizar-dados`, copia
  também nome, nome de guerra e posto.
- **Nunca copia `administrador` nem `ativo`.** O modelo de autorização do SCA é
  dele, e não do Auth Server: sobrescrever essas duas colunas promoveria ou
  rebaixaria gente em silêncio, no meio de uma migração que ninguém lê linha a
  linha. As duas nem entram no `SELECT` da origem, porque o que não se lê não se
  copia por acidente.
- **Quem só existe na origem não entra por padrão.** Com `--incluir-novos`, entra
  sem perfil em módulo nenhum, com `administrador = FALSE` e `ativo = FALSE`.
  Conceder acesso é ato explícito, na tela de perfis, nunca efeito colateral de
  migração. O `ativo = FALSE` **não é cópia da origem**, é política do script:
  quem foi desligado lá entraria aqui com uma senha que funciona, e "consigo
  entrar sem dever" é falha que ninguém percebe, enquanto "não consigo entrar"
  aparece no mesmo dia e se resolve com um clique.
- **Idempotente.** Rodar duas vezes não estraga nada: quem já está com o hash
  igual aparece como "já em dia" e não é reescrito, e a criação usa
  `ON CONFLICT (uuid) DO NOTHING`.
- **Não imprime hash, senha nem string de conexão**, nem em erro: toda linha da
  saída passa por um filtro que troca hash bcrypt por `<hash>`, e a mensagem de
  falha sai sem o erro completo do driver, que traria a consulta e os parâmetros
  dela.
- **Confere `dominio.tipo_posto_grad` nos dois bancos** antes de gravar. Código
  que existe só na origem viraria FK estourada no meio da transação; assim ele
  vira erro no ensaio.

### O relatório, e o número que importa

Ele fecha com **quantos e quais ficaram com `senha` nula no SCA**, que é
exatamente a lista de quem não consegue entrar. Com `--aplicar` essa lista é
lida do banco, já com a cópia aplicada e ainda dentro da transação, e não
derivada da memória: é o número que decide o passo abaixo, e derivar seria
confiar no plano justamente onde ele precisa ser conferido.

Cada pessoa da lista cai num destes casos: não existe na origem, a origem também
não tem hash para ela, ou entrou agora sem hash. A saída é definir uma senha pela
tela de usuários ou desativar quem não entra mais.

### Passo final, do administrador

Com a lista acima **vazia**, acabou: todo usuário do SCA consegue entrar.

Não há `ALTER ... SET NOT NULL` a rodar: a coluna é anulável nos dois caminhos,
de propósito (ver `docs/decisoes.md`).

Quem sobrar na lista **não entra**, com mensagem própria no login ("Usuário sem
senha cadastrada no sistema"), e aparece marcado na tela `#/usuarios`. Dê-lhe uma
senha por ali (Resetar senha) ou pelo `efetivo_cli`.

---

## `carregar_campo_sap.py`

Carga do schema `campo` a partir do `controle_campo` do SAP. É a travessia da
subseção 2.5 do RPCMTec, que era digitada da tela de lá até 2026-08-08.

Dependência **zero**: quem fala com o banco é o `psql` já instalado.

### O que precisa estar pronto antes

1. A migração `migrations/2026-08-08_campo.sql` aplicada no banco do SCA.
2. O `controle_campo` do SAP restaurado **dentro** do banco do SCA, num schema de
   apoio. É de propósito: são cerca de 283 MB (179 de foto e vídeo, 97 de ponto
   de GPS), e fazer esses bytes atravessarem um processo Python seria pagar caro
   por nada. Dentro do mesmo banco, o `INSERT ... SELECT` os move sem sair do
   servidor.

### Modo leitura é o padrão

Sem `--aplicar` o script **não escreve nada**: lê os dois lados, confere e
imprime o relatório. Esse relatório é o produto de verdade. Ele diz quantos
exercícios do PIT vão ser criados, quantos militares casaram com `dgeo.usuario` e
quantos vão para `militares_externos`, e **quais campos estão sem polígono**.

`--aplicar --saida <caminho fora do repositório>.sql` gera o SQL, que é UMA
transação com guardas no início e conferência de contagem no fim. O repositório é
público, e o script recusa `--saida` apontando para dentro dele.

A senha vem de `PGPASSWORD`, como todo cliente do Postgres. Ela nunca é
argumento: argumento aparece na lista de processos da máquina.

### Carga em ETAPAS

`--ano 2026` (repetível) recorta a carga. Serve para implantar por partes: trazer
o ano corrente, conferir na tela, e só então trazer os treze anteriores. O
recorte vale para a carga inteira, e não só para a tabela `campo`: foto, trajeto
e vínculo entram pelo JOIN, então nenhum campo de fora do recorte deixa foto
órfã para trás. A guarda de "já tem linha" acompanha o recorte, senão a segunda
etapa seria recusada pela primeira.

### A carga PARA quando falta polígono

`campo.geom` é NOT NULL por decisão do chefe em 2026-08-08, e o script **não
inventa** um ponto no meio do município. Os campos sem polígono aparecem
nomeados no relatório e bloqueiam a geração do SQL. Quem os tiver os fornece num
arquivo `nome<TAB>WKT`, em EPSG:4326, fora do repositório:

    python scripts/carregar_campo_sap.py ... --geometrias <caminho>.tsv

`--sem-geometria pular` deixa esses campos **de fora** da carga em vez de
bloqueá-la. Eles saem nomeados no relatório e no cabeçalho do SQL gerado, e
continuam no SAP para entrar depois. **Nenhum dos dois caminhos inventa
geometria**: a diferença é só se a ausência bloqueia o resto.

### O que ela não faz

Não registra `auditoria.evento`. A auditoria do SCA é do **servidor** (usuário da
sessão HTTP, estado antes e depois lidos do banco), e carga inicial roda por fora
do serviço, como a implantação da mapoteca e a do equipamento. O relatório diz
isso em voz alta.
