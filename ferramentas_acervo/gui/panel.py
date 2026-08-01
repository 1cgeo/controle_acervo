# Path: gui\panel.py
from .projetos.manage_projects_dialog import ManageProjectsDialog
from .lotes.manage_lotes_dialog import ManageLotesDialog
from .usuarios.manage_users_dialog import ManageUsersDialog
from .volumes.manage_volumes_dialog import ManageVolumesDialog
from .volume_tipo_produto.manage_volume_tipo_produto_dialog import ManageVolumeTipoProdutoDialog
from .verificar_inconsistencias.verificar_inconsistencias_dialog import VerificarInconsistenciasDialog
from .carregar_produtos.load_products_dialog import LoadProductsDialog
from .carregar_camadas_produto.load_product_layers_dialog import LoadProductLayersDialog
from .informacao_produto.product_info_dialog import ProductInfoDialog
from .limpeza_downloads.cleanup_expired_downloads_dialog import CleanupExpiredDownloadsDialog
from .materialized_views.refresh_materialized_views_dialog import RefreshMaterializedViewsDialog
from .materialized_views.create_materialized_view_dialog import CreateMaterializedViewDialog
from .arquivos_incorretos.manage_incorrect_files_dialog import ManageIncorrectFilesDialog
from .arquivos_deletados.arquivos_deletados_dialog import ArquivosDeletedDialog
from .download_produtos.download_produtos_dialog import DownloadProdutosDialog
from .adicionar_produto.adicionar_produto_dialog import AddProductDialog
from .adicionar_produto_historico.adicionar_produto_historico_dialog import AddHistoricalProductDialog
from .situacao_geral.situacao_geral_dialog import DownloadSituacaoGeralDialog
from .configuracoes.configuracoes_dialog import ConfiguracoesDialog
from .problem_uploads.problem_uploads_dialog import ProblemUploadsDialog
from .bulk_carrega_arquivos.bulk_carrega_arquivos_dialog import LoadSystematicFilesDialog as BulkLoadFilesDialog
from .bulk_carrega_produtos_versoes_arquivos.bulk_carrega_produtos_versoes_arquivos_dialog import LoadProductsDialog as BulkLoadProductsDialog
from .bulk_carrega_versoes_arquivos.bulk_carrega_versoes_arquivos_dialog import LoadVersionToProductsDialog
from .bulk_produtos.bulk_produtos_dialog import BulkCreateProductsDialog
from .bulk_produtos_versoes_historicas.bulk_produtos_versoes_historicas_dialog import LoadHistoricalProductsDialog
from .bulk_versao_relacionamento.bulk_versao_relacionamento_dialog import BulkCreateVersionRelationshipsDialog
from .bulk_versoes_historicas.bulk_versoes_historicas_dialog import LoadHistoricalVersionsDialog
from .busca_produtos.busca_produtos_dialog import BuscaProdutosDialog
from .upload_sessions.upload_sessions_dialog import UploadSessionsDialog
from .versao_relacionamento.versao_relacionamento_dialog import VersaoRelacionamentoDialog
from .downloads_deletados.downloads_deletados_dialog import DownloadsDeletadosDialog
from .auditoria.auditoria_dialog import AuditoriaDialog
from .nome_padrao.nome_padrao_dialog import NomePadraoDialog
from .catalogar_volume.catalogar_volume_dialog import CatalogarVolumeDialog
from .ponto_controle.ponto_controle_dialog import PontoControleDialog

PANEL_MAPPING = {
    # Funções Gerais (acessíveis a todos os usuários)
    "Carregar Camadas de Produtos": {
        "class": LoadProductLayersDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta'
    },
    "Informações do Produto": {
        "class": ProductInfoDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta'
    },
    "Download de Produtos": {
        "class": DownloadProdutosDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta'
    },
    "Download da Situação Geral": {
        "class": DownloadSituacaoGeralDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta'
    },
    "Buscar Produtos": {
        "class": BuscaProdutosDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta'
    },
    "Visualizar Relacionamentos entre Versões": {
        "class": VersaoRelacionamentoDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta'
    },
    # Perfil do ACERVO, e não um módulo próprio: ponto de controle é uma tela do
    # acervo, e quem tem consulta nele vê os pontos. Ver ponto_controle_route.js.
    "Pontos de Controle": {
        "class": PontoControleDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta'
    },
    "Configurações": {
        "class": ConfiguracoesDialog,
        "category": "Funções Gerais",
        "perfil_minimo": 'consulta',
        "modal": True  # Formulário de configurações permanece modal
    },

    # Funções de Administrador
    "Adicionar Produto": {
        "class": AddProductDialog,
        "category": "Funções de Administrador",
        "perfil_minimo": 'operador'
    },
    "Adicionar Produto com Versão Histórica": {
        "class": AddHistoricalProductDialog,
        "category": "Funções de Administrador",
        "perfil_minimo": 'operador'
    },
    "Carregar Produtos": {
        "class": LoadProductsDialog,
        "category": "Funções de Administrador",
        "perfil_minimo": 'operador'
    },
    # Funções de Administração Avançada
    "Gerenciar Volumes": {
        "class": ManageVolumesDialog,
        "category": "Administração Avançada",
        "perfil_minimo": 'operador'
    },
    "Gerenciar Relacionamento Volume e Tipo de Produto": {
        "class": ManageVolumeTipoProdutoDialog,
        "category": "Administração Avançada",
        "perfil_minimo": 'operador'
    },
    "Gerenciar Projetos": {
        "class": ManageProjectsDialog,
        "category": "Administração Avançada",
        "perfil_minimo": 'operador'
    },
    "Gerenciar Lotes": {
        "class": ManageLotesDialog,
        "category": "Administração Avançada",
        "perfil_minimo": 'operador'
    },
    "Gerenciar Usuários": {
        "class": ManageUsersDialog,
        "category": "Administração Avançada",
        "perfil_minimo": 'admin'
    },
    
    # Ferramentas de Diagnóstico e Manutenção
    # As duas perguntam coisas diferentes, e o nome de cada uma diz qual:
    # "Verificar Arquivos no Volume" compara o banco com o DISCO; "Auditoria do
    # Acervo" roda os invariantes de coerência, que não olham o disco.
    "Verificar Arquivos no Volume": {
        "class": VerificarInconsistenciasDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'gerente'
    },
    "Auditoria do Acervo": {
        "class": AuditoriaDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'gerente'
    },
    "Padronizar Nome dos Arquivos": {
        "class": NomePadraoDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'admin'
    },
    "Limpar Downloads Expirados": {
        "class": CleanupExpiredDownloadsDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'admin'
    },
    "Atualizar Visões Materializadas": {
        "class": RefreshMaterializedViewsDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'admin'
    },
    "Criar Visão Materializada": {
        "class": CreateMaterializedViewDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'admin'
    },
    "Gerenciar Arquivos com Problemas": {
        "class": ManageIncorrectFilesDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'gerente'
    },
    "Gerenciar Arquivos Excluídos": {
        "class": ArquivosDeletedDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'gerente'
    },
    "Visualizar Uploads com Problemas": {
        "class": ProblemUploadsDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'operador'
    },
    "Gerenciar Sessões de Upload": {
        "class": UploadSessionsDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'operador'
    },
    "Gerenciar Downloads Excluídos": {
        "class": DownloadsDeletadosDialog,
        "category": "Diagnóstico e Manutenção",
        "perfil_minimo": 'gerente'
    },

    # Operações em Lote
    "Adicionar Arquivos em Lote": {
        "class": BulkLoadFilesDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    },
    "Adicionar Produtos Completos em Lote": {
        "class": BulkLoadProductsDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    },
    "Adicionar Versões a Produtos em Lote": {
        "class": LoadVersionToProductsDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    },
    "Criar Produtos em Lote": {
        "class": BulkCreateProductsDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    },
    "Adicionar Produtos com Versões Históricas em Lote": {
        "class": LoadHistoricalProductsDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    },
    "Criar Relacionamentos entre Versões em Lote": {
        "class": BulkCreateVersionRelationshipsDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    },
    "Adicionar Versões Históricas em Lote": {
        "class": LoadHistoricalVersionsDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    },
    # Fica ao lado das outras cargas porque é o que a pessoa está procurando
    # quando chega aqui, mas NÃO transfere nada: registra o que já está no
    # volume. Ver gui/catalogar_volume/.
    "Catalogar Produtos já no Volume": {
        "class": CatalogarVolumeDialog,
        "category": "Operações em Lote",
        "perfil_minimo": 'operador'
    }
}