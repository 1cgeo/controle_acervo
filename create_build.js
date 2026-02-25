import { cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const createBuild = () => {
  console.log(chalk.blue('Criando build do frontend'));
  console.log('Esta operação pode demorar alguns minutos');

  try {
    execSync('npm run build', {
      cwd: join(__dirname, 'client'),
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
      join(__dirname, 'client', 'dist'),
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
