# Tutorial do Client Web — Dashboard SCA

Guia de uso do **Dashboard Web do SCA**, uma aplicação de página única (SPA) em vanilla JavaScript que permite a administradores visualizar métricas, gráficos e relatórios do acervo geográfico.

---

## Pré-requisitos

- Servidor do SCA rodando e acessível na rede
- Servidor de autenticação externo rodando e acessível
- Conta de **administrador** cadastrada no sistema (o dashboard é exclusivo para admins)
- Navegador moderno (Chrome, Firefox, Edge, Safari)

---

## Passo 1 — Iniciar o Client

### Desenvolvimento

```bash
cd client
npm install
npm run dev
```

O Vite inicia o servidor de desenvolvimento na porta **3000**. As requisições para `/api` são automaticamente redirecionadas ao servidor SCA (padrão: `http://localhost:3013`).

### Produção

```bash
cd client
npm run build
```

Os arquivos são gerados em `client/dist/`. Sirva essa pasta com qualquer servidor HTTP estático (Nginx, Apache, etc.), configurando a reescrita de rotas para `index.html`.

---

## Passo 2 — Login

1. Acesse a aplicação no navegador (ex: `http://localhost:3000`)
2. A tela de login é exibida com um fundo de gradiente aleatório
3. Preencha os campos:
   - **Usuário** — seu login cadastrado no servidor de autenticação
   - **Senha** — sua senha
4. Clique em **Entrar**

Após autenticação bem-sucedida, o sistema redireciona para o Dashboard. O token JWT é salvo no navegador e expira em **1 hora** — após esse tempo, o sistema faz logout automático.

> Apenas administradores podem acessar o Dashboard. Usuários comuns são redirecionados para a página "Acesso Negado".

---

## Passo 3 — Navegação

### Navbar (barra superior)

| Elemento | Função |
|----------|--------|
| Hambúrguer (☰) | Abre/fecha a sidebar |
| Título | "SCA" no celular, "Sistema de Controle do Acervo" no desktop |
| Ícone sol/lua | Alterna entre tema claro e escuro |
| Avatar com nome | Abre menu dropdown com opção de **Sair** |

### Sidebar (menu lateral)

| Item | Descrição |
|------|-----------|
| Dashboard | Página principal com gráficos e métricas |
| Volumes | Placeholder para futura gestão de volumes |

No desktop, a sidebar pode ser colapsada clicando no hambúrguer (ícones ficam visíveis). No celular, ela abre como um drawer temporário sobre o conteúdo.

---

## Passo 4 — Dashboard: Visão Geral

A primeira aba do dashboard exibe **3 cards de estatísticas** com dados gerais do acervo:

| Card | O que mostra | Exemplo |
|------|-------------|---------|
| Total de Produtos | Quantidade de produtos geográficos cadastrados | `1.234` |
| Armazenamento Total | Espaço total utilizado em GB | `456,78 GB` |
| Total de Usuários | Quantidade de usuários no sistema | `42` |

Os dados são carregados automaticamente ao acessar a aba. Um indicador de carregamento (skeleton) é exibido enquanto os dados são buscados.

---

## Passo 5 — Dashboard: Distribuição

A segunda aba apresenta **3 gráficos** sobre a distribuição de produtos e armazenamento:

### Produtos por Tipo (gráfico de pizza)

Mostra a proporção de cada tipo de produto (Carta Topográfica, Ortoimagem, MDE, etc.) no acervo. Passe o mouse sobre uma fatia para ver o total e a porcentagem.

### Armazenamento por Tipo de Produto (gráfico de barras)

Mostra quantos GB cada tipo de produto ocupa. Útil para identificar quais tipos consomem mais espaço.

### Armazenamento por Volume (gráfico de barras empilhadas)

Para cada volume de armazenamento configurado, mostra:
- **Usado (GB)** — espaço efetivamente ocupado
- **Disponível (GB)** — espaço livre restante (baseado na capacidade configurada)

---

## Passo 6 — Dashboard: Atividade

A terceira aba mostra a **atividade recente** do sistema.

### Gráfico de Atividade Diária

Barras agrupadas mostrando o total de **uploads** e **downloads** por dia nos últimos 30 dias. Dias sem atividade aparecem com valor zero.

### Tabelas de Atividade (4 sub-abas)

| Sub-aba | O que mostra | Colunas |
|---------|-------------|---------|
| Uploads Recentes | 10 últimos arquivos carregados | Nome, Tamanho (MB), Tipo, Data |
| Modificações Recentes | 10 últimos arquivos modificados | Nome, Tamanho (MB), Tipo, Data |
| Exclusões Recentes | 10 últimos arquivos excluídos | Nome, Tamanho (MB), Tipo, Data, Motivo |
| Histórico de Downloads | 50 últimos downloads | ID, Arquivo ID, Data, Status |

Na tabela de downloads, o **Status** indica se o arquivo original ainda existe:
- **Disponível** (verde) — arquivo pode ser baixado
- **Arquivo Excluído** (vermelho) — arquivo original foi deletado

Todas as tabelas possuem **paginação** (5, 10 ou 25 itens por página) e botões de navegação.

---

## Passo 7 — Dashboard: Análises Avançadas

A quarta aba oferece **análises mais aprofundadas** com gráficos interativos.

### Timeline de Atividade de Produtos

Gráfico de barras mostrando a criação de **novos produtos** e **produtos modificados** ao longo do tempo. Use o seletor de período para escolher entre **6, 12 ou 24 meses**.

### Sub-abas de Análise

#### Estatísticas de Versões

- **4 cards resumo**: Total de versões, Produtos com versões, Média por produto, Máximo por produto
- **Gráfico de pizza**: Distribuição de versões por produto (ex: quantos produtos têm 1 versão, 2 versões, etc.)
- **Gráfico de pizza**: Distribuição por tipo de versão (Regular, Histórica, etc.)

#### Tendências de Armazenamento

Gráfico de barras com duas séries:
- **GB Adicionados** por mês — quanto espaço novo foi consumido
- **GB Acumulados** — total acumulado ao longo do tempo

Use o seletor para alternar entre 6, 12 ou 24 meses.

#### Status de Projetos

- **Card numérico**: Projetos sem lotes associados
- **Gráfico de pizza**: Distribuição de projetos por situação (Em andamento, Concluído, etc.)
- **Gráfico de pizza**: Distribuição de lotes por situação

#### Atividade de Usuários

Tabela com os **10 usuários mais ativos** do sistema, mostrando:

| Coluna | Descrição |
|--------|-----------|
| Usuário | Nome do usuário |
| Uploads | Quantidade de arquivos carregados |
| Modificações | Quantidade de arquivos modificados |
| Downloads | Quantidade de downloads realizados |
| Total | Soma de todas as atividades |

---

## Passo 8 — Tema Claro/Escuro

O dashboard suporta dois temas visuais:

1. Clique no **ícone de sol/lua** na navbar
2. O tema alterna entre claro e escuro instantaneamente
3. Todos os gráficos, tabelas e componentes se adaptam ao tema
4. A preferência é salva no navegador e mantida entre sessões

Se nenhuma preferência foi salva, o sistema respeita a configuração do sistema operacional.

---

## Passo 9 — Responsividade

O dashboard se adapta automaticamente ao tamanho da tela:

| Viewport | Comportamento |
|----------|---------------|
| Desktop (> 900px) | Sidebar permanente e colapsável, grids de 2-3 colunas, gráficos em tamanho completo |
| Tablet/Mobile (≤ 900px) | Sidebar como drawer temporário, grids de 1 coluna, gráficos com altura reduzida, título curto ("SCA") |

---

## Passo 10 — Logout

Para sair do sistema:

1. Clique no **avatar** com sua inicial no canto superior direito
2. Clique em **Sair** no menu dropdown
3. O token é removido e você é redirecionado para a tela de login

O logout também ocorre **automaticamente** quando:
- O token JWT expira (após 1 hora)
- O servidor retorna erro 401 ou 403 em qualquer requisição

---

## Resumo de Navegação

| Rota | Página | Acesso |
|------|--------|--------|
| `#/login` | Login | Público |
| `#/dashboard` | Dashboard | Administrador |
| `#/unauthorized` | Acesso Negado | Público |
| `#/404` | Página Não Encontrada | Público |

---

## Observações Importantes

- O Dashboard é **exclusivo para administradores** — usuários comuns não têm acesso
- Os dados são **cacheados por 1 minuto** no navegador para evitar requisições excessivas
- O Dashboard depende dos endpoints `/api/dashboard/*` estarem montados no servidor — verifique se o módulo `dashboard` está registrado em `routes.js`
- Os gráficos utilizam **Chart.js** e se adaptam automaticamente ao tema e ao tamanho da tela
- A aplicação é uma **SPA com roteamento por hash** — as URLs usam `#` (ex: `http://localhost:3000/#/dashboard`)
- Em produção, não é necessário configurar redirecionamento de SPA no servidor web, pois o hash routing funciona com qualquer servidor estático
