import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Builda o client Vite e copia o dist para o diretorio servido pelo Express
// (server/src/build).
const buildClient = (clientName) => {
  const clientDir = join(__dirname, clientName);

  if (!existsSync(clientDir)) {
    console.log(chalk.red(`Diretório ${clientName}/ não encontrado.`));
    process.exit(1);
  }

  console.log(chalk.blue(`Criando build de ${clientName}`));

  try {
    execSync('npm run build', { cwd: clientDir, stdio: 'inherit' });
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

// Uma interface so: client -> build/, servida na raiz. Os tres modulos (acervo,
// mapoteca e orcamento) vivem dentro dela, com rota por modulo e sessao unica.
buildClient('client');
console.log(chalk.green('Build da interface pronta.'));
