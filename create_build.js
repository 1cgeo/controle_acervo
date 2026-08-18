import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// O PREFIXO DE PUBLICAÇÃO TEM UM NOME SÓ, a chave PUBLIC_PATH, e no host ele
// sai do server/config.env, o mesmo arquivo que o servidor lê no boot. O build precisa
// dela porque o `base` do Vite entra no `index.html` e nas URLs que o bundle
// monta, e o servidor precisa dela para remover o prefixo das requisições que
// chegam sem proxy na frente. Ler do MESMO arquivo dos dois lados é o que
// impede o par de sair de sincronia: com valores diferentes, o navegador pede
// os assets num caminho que o servidor não serve, e a tela fica branca.
//
// O AMBIENTE TEM PRECEDÊNCIA SOBRE O config.env, e é o que faz a instalação em
// CONTÊINER funcionar: lá o `config.env` é montado do host em tempo de EXECUÇÃO
// (bind mount), então durante o build da imagem ele não existe. Sem essa
// precedência, a imagem sairia sempre com a interface publicada na raiz, e o
// prefixo só apareceria no servidor, onde já é tarde: o `index.html` de dentro
// da imagem é o que o navegador recebe. No contêiner, passe PUBLIC_PATH como
// ENV (ou build arg) do build da imagem, e TROCAR O PREFIXO PEDE IMAGEM NOVA.
//
// Parse à mão, sem dotenv: este arquivo é da raiz e a dependência está no
// server. Só uma chave interessa, e ela é uma linha `CHAVE=valor`.
const lerPrefixoPublico = () => {
  if (process.env.PUBLIC_PATH) return process.env.PUBLIC_PATH.trim();

  const configEnv = join(__dirname, 'server', 'config.env');
  if (!existsSync(configEnv)) return '';
  const linha = readFileSync(configEnv, 'utf8')
    .split(/\r?\n/)
    .find((l) => /^\s*PUBLIC_PATH\s*=/.test(l));
  if (!linha) return '';
  return linha.slice(linha.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
};

// Builda o client Vite e copia o dist para o diretorio servido pelo Express
// (server/src/build).
const buildClient = (clientName, prefixoPublico) => {
  const clientDir = join(__dirname, clientName);

  if (!existsSync(clientDir)) {
    console.log(chalk.red(`Diretório ${clientName}/ não encontrado.`));
    process.exit(1);
  }

  console.log(chalk.blue(`Criando build de ${clientName}`));

  try {
    execSync('npm run build', {
      cwd: clientDir,
      stdio: 'inherit',
      env: { ...process.env, PUBLIC_PATH: prefixoPublico },
    });
  } catch {
    console.log(chalk.red(`Erro ao criar build de ${clientName}!`));
    process.exit(1);
  }

  const dest = join(__dirname, 'server', 'src', 'build');
  try {
    // APAGA o destino antes de copiar, e so depois de o build ter dado certo.
    // O Vite poe hash no nome de cada pedaco, entao copiar por cima nunca
    // sobrescreve o pedaco antigo: o `build/` acumulava um `index-<hash>.js` e
    // um `index-<hash>.css` por deploy, para sempre. Ninguem os serve (o
    // `index.html` novo aponta so para os de agora), mas eles crescem sem
    // limite e escondem qual e a build de verdade.
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(clientDir, 'dist'), dest, { recursive: true });
    console.log(chalk.blue(`Build de ${clientName} copiada para ${dest}`));
  } catch (error) {
    console.log(chalk.red(error.message));
    process.exit(1);
  }
};

// Uma interface so: client -> build/, servida na raiz do prefixo publicado. Os
// tres modulos (acervo, mapoteca e orcamento) vivem dentro dela, com rota por
// modulo e sessao unica.
const prefixoPublico = lerPrefixoPublico();
if (prefixoPublico) {
  console.log(chalk.blue(`Prefixo de publicação (PUBLIC_PATH): ${prefixoPublico}`));
}
buildClient('client', prefixoPublico);
console.log(chalk.green('Build da interface pronta.'));
