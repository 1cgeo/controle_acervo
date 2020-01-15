import { api } from '../services'

const getDashboardData = async () => {
  return api.axiosAll({
    produtosCadastrados: api.getData('/api/dashboard/'),
    tamanhoArquivos: api.getData('/api/dashboard/'),
    downloads: api.getData('/api/dashboard/'),
    tiposProdutos: api.getData('/api/dashboard/'),
    produtosTipo: api.getData('/api/dashboard/'),
    tamanhoVolume: api.getData('/api/dashboard/'),
    downloadsUsuario: api.getData('/api/dashboard/'),
    situacaoBDGEx: api.getData('/api/dashboard/'),
    produtosTipoDia: api.getData('/api/dashboard/'),
    ultimasModificacoes: api.getData('/api/dashboard/')
  })
}

export { getDashboardData }
