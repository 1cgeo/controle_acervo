import { cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const createBuild = () => {
  const clientDir = join(__dirname, 'client');

  if (!existsSync(clientDir)) {
    console.log(chalk.red('Diretório client/ não encontrado.'));
    console.log('O cliente antigo foi deprecado (client_deprecated/). Um novo cliente ainda não foi criado.');
    process.exit(1);
  }

  console.log(chalk.blue('Criando build do frontend'));
  console.log('Esta operação pode demorar alguns minutos');

  try {
    execSync('npm run build', {
      cwd: clientDir,
      stdio: 'inherit'
    });
  } catch {
    console.log(chalk.red('Erro ao criar build!'));
    process.exit(1);
  }

  console.log('Build criada com sucesso!');
  console.log('Copiando arquivos');

  try {
    cpSync(
      join(clientDir, 'dist'),
      join(__dirname, 'server', 'src', 'build'),
      { recursive: true }
    );
    console.log(chalk.blue('Arquivos copiados com sucesso!'));
  } catch (error) {
    console.log(chalk.red(error.message));
    console.log('-------------------------------------------------');
    console.log(error);
    process.exit(1);
  }
};

createBuild();
