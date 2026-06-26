import { cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Builda um client Vite e copia o dist para o diretorio servido pelo Express
// (server/src/build). destSubdir != '' serve o client num subpath (ex.: /mapoteca).
const buildClient = (clientName, destSubdir = '') => {
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

  const dest = join(__dirname, 'server', 'src', 'build', destSubdir);
  try {
    cpSync(join(clientDir, 'dist'), dest, { recursive: true });
    console.log(chalk.blue(`Build de ${clientName} copiada para ${dest}`));
  } catch (error) {
    console.log(chalk.red(error.message));
    process.exit(1);
  }
};

// acervo_client -> build/ (servido em /); mapoteca_client -> build/mapoteca (servido em /mapoteca)
buildClient('acervo_client');
buildClient('mapoteca_client', 'mapoteca');
console.log(chalk.green('Builds dos dois clients prontas.'));
