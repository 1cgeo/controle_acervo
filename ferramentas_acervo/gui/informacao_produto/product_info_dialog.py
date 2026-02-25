# Path: gui\informacao_produto\product_info_dialog.py
"""
Diálogo principal para visualização e edição de informações detalhadas de produtos.
"""

import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (
    QDialog, QMessageBox, QVBoxLayout, QWidget, QHeaderView, 
    QPushButton, QHBoxLayout, QLabel, QFileDialog
)
from qgis.PyQt.QtCore import Qt
from qgis.core import QgsProject, QgsMapLayerType, Qgis

from .overview_tab import OverviewTab
from .versions_tab import VersionsTab
from .relationships_tab import RelationshipsTab
from .utils import format_date
from .admin_actions import AdminActions
from .deletion_confirmation_dialog import DeletionConfirmationDialog
from .relationship_edit_dialog import RelationshipEditDialog
from ..download_produtos.download_manager import DownloadManager
from .add_files_to_version_dialog import AddFilesToVersionDialog
from .add_version_to_product_dialog import AddVersionToProductDialog
from .add_historical_version_dialog import AddHistoricalVersionDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'product_info_dialog.ui'))

class ProductInfoDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None, product_id=None):
        super(ProductInfoDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.product_id = None
        self.product_data = None
        self.current_version = None
        self.is_admin = api_client.is_admin
        self.download_manager = DownloadManager(api_client)

        self.setup_ui()
        self.loadButton.clicked.connect(self.load_product_info)

        # Connect download manager signals
        self.download_manager.prepare_complete.connect(self.handle_download_prepare)
        self.download_manager.download_complete.connect(self.handle_download_complete)
        self.download_manager.download_error.connect(self.handle_download_error)

        # Se product_id foi fornecido, carregar diretamente
        if product_id is not None:
            self.product_id = product_id
            self.load_product_by_id()

    def setup_ui(self):
        """Configura a interface de usuário."""
        self.setWindowTitle("Informações do Produto")
        self.resize(900, 650)
        
        # Esconder algumas abas até que os dados sejam carregados
        self.tabWidget.setTabEnabled(1, False)  # Aba Histórico de Versões
        self.tabWidget.setTabEnabled(2, False)  # Aba Relacionamentos
        
        # Configurar cabeçalho do produto
        self.setup_header()
        
        # Inicializar abas
        self.setup_tabs()
        
    def setup_header(self):
        """Configura o cabeçalho com informações do produto."""
        self.headerWidget = QWidget()
        self.headerLayout = QVBoxLayout(self.headerWidget)
        self.headerLayout.setContentsMargins(0, 0, 0, 10)
        
        self.productTitleLabel = QLabel()
        font = self.productTitleLabel.font()
        font.setBold(True)
        font.setPointSize(12)
        self.productTitleLabel.setFont(font)
        self.headerLayout.addWidget(self.productTitleLabel)
        
        self.productDetailsLabel = QLabel()
        self.headerLayout.addWidget(self.productDetailsLabel)
        
        # Adicionar botões de administrador ao header se usuário for admin
        if self.is_admin:
            self.adminButtonsWidget = QWidget()
            self.adminButtonsLayout = QHBoxLayout(self.adminButtonsWidget)
            self.adminButtonsLayout.setContentsMargins(0, 5, 0, 0)
            
            self.editProductButton = QPushButton("Editar Produto")
            self.editProductButton.clicked.connect(self.edit_product)
            self.adminButtonsLayout.addWidget(self.editProductButton)
            
            self.addVersionButton = QPushButton("Adicionar Versão")
            self.addVersionButton.clicked.connect(self.add_version_to_product)
            self.adminButtonsLayout.addWidget(self.addVersionButton)
            
            self.addHistoricalVersionButton = QPushButton("Adicionar Versão Histórica")
            self.addHistoricalVersionButton.clicked.connect(self.add_historical_version)
            self.adminButtonsLayout.addWidget(self.addHistoricalVersionButton)
            
            self.deleteProductButton = QPushButton("Excluir Produto")
            self.deleteProductButton.setStyleSheet("background-color: #CF222E; color: white;")
            self.deleteProductButton.clicked.connect(self.delete_product)
            self.adminButtonsLayout.addWidget(self.deleteProductButton)
            
            self.headerLayout.addWidget(self.adminButtonsWidget)
        
        # Inserir o cabeçalho acima do tabWidget
        self.verticalLayout.insertWidget(0, self.headerWidget)
        self.headerWidget.setVisible(False)
        
    def setup_tabs(self):
        """Inicializa os componentes das abas."""
        # Aba de Visão Geral
        self.overview_tab = OverviewTab(self, self.is_admin)
        layout = QVBoxLayout(self.overviewTab)
        layout.addWidget(self.overview_tab)
        
        # Conectar eventos específicos da aba de visão geral
        if self.is_admin:
            self.overview_tab.add_files_btn.clicked.connect(lambda: self.add_files_to_version(self.current_version))
            self.overview_tab.edit_version_btn.clicked.connect(self.edit_current_version)
            self.overview_tab.delete_version_btn.clicked.connect(self.delete_current_version)
            
        self.overview_tab.select_all_check.stateChanged.connect(self.toggle_select_all_files)
        self.overview_tab.download_btn.clicked.connect(lambda: self.download_selected_files("overview"))
        
        # Configurar botões de detalhes dos arquivos
        for row in range(self.overview_tab.files_table.rowCount()):
            if self.overview_tab.files_table.cellWidget(row, 6):
                details_btn = self.overview_tab.files_table.cellWidget(row, 6)
                details_btn.clicked.connect(lambda _, r=row: self.show_file_details(
                    self.get_file_from_table(self.overview_tab.files_table, r)
                ))
        
        # Aba de Histórico de Versões
        self.versions_tab = VersionsTab(self, self.is_admin)
        layout = QVBoxLayout(self.versionsTab)
        layout.addWidget(self.versions_tab)
        
        # Conectar eventos da aba de versões
        if self.is_admin:
            self.versions_tab.version_actions_widget = QWidget()
            version_actions_layout = QHBoxLayout(self.versions_tab.version_actions_widget)
            version_actions_layout.setContentsMargins(0, 10, 0, 0)
            
            self.versions_tab.add_files_button = QPushButton("Adicionar Arquivos")
            self.versions_tab.add_files_button.clicked.connect(self.add_files_to_selected_version)
            version_actions_layout.addWidget(self.versions_tab.add_files_button)
            
            self.versions_tab.edit_version_btn = QPushButton("Editar Versão")
            version_actions_layout.addWidget(self.versions_tab.edit_version_btn)
            
            self.versions_tab.delete_version_btn = QPushButton("Excluir Versão")
            self.versions_tab.delete_version_btn.setStyleSheet("background-color: #CF222E; color: white;")
            version_actions_layout.addWidget(self.versions_tab.delete_version_btn)
            
            self.versions_tab.version_info_layout.addWidget(self.versions_tab.version_actions_widget)
            
            self.versions_tab.edit_version_btn.clicked.connect(self.edit_selected_version)
            self.versions_tab.delete_version_btn.clicked.connect(self.delete_selected_version)
            
        self.versions_tab.select_all_check.stateChanged.connect(self.toggle_select_all_version_files)
        self.versions_tab.download_btn.clicked.connect(lambda: self.download_selected_files("versions"))
        
        # Aba de Relacionamentos
        self.relationships_tab = RelationshipsTab(self, self.is_admin)
        layout = QVBoxLayout(self.relationshipsTab)
        layout.addWidget(self.relationships_tab)
        
        # Conectar eventos da aba de relacionamentos
        if self.is_admin:
            self.relationships_tab.edit_relationship_btn.clicked.connect(self.edit_relationship)
            self.relationships_tab.delete_relationship_btn.clicked.connect(self.delete_relationship)
            
        self.relationships_tab.navigate_btn.clicked.connect(self.navigate_to_related_product)
        
    def load_product_by_id(self):
        """Carrega as informações do produto diretamente pelo ID."""
        try:
            self.setCursor(Qt.WaitCursor)
            self.statusLabel.setText("Carregando informações do produto...")

            response = self.api_client.get(f'acervo/produto/detalhado/{self.product_id}')

            if response and 'dados' in response:
                self.product_data = response['dados']
                self.display_product_info()
                self.statusLabel.setText("Informações carregadas com sucesso")
            else:
                self.statusLabel.setText("Não foi possível carregar as informações detalhadas do produto")
                QMessageBox.warning(self, "Erro", "Não foi possível carregar as informações do produto")

        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            QMessageBox.critical(self, "Erro", f"Erro ao carregar informações do produto: {str(e)}")
        finally:
            self.setCursor(Qt.ArrowCursor)

    def load_product_info(self):
        """Carrega as informações do produto selecionado."""
        # Obter a camada ativa
        active_layer = self.iface.activeLayer()
        if not active_layer or active_layer.type() != QgsMapLayerType.VectorLayer:
            self.iface.messageBar().pushMessage("Erro", "Selecione uma camada de produto válida", level=Qgis.Warning)
            return

        # Verificar se a camada é uma view materializada de produto
        if not active_layer.name().startswith('mv_produto_'):
            self.iface.messageBar().pushMessage("Erro", "A camada selecionada não é uma camada de produto válida", level=Qgis.Warning)
            return

        # Obter as feições selecionadas
        selected_features = active_layer.selectedFeatures()
        if len(selected_features) != 1:
            self.iface.messageBar().pushMessage("Erro", "Selecione exatamente uma feição", level=Qgis.Warning)
            return

        # Obter o ID do produto
        self.product_id = selected_features[0]['id']

        try:
            # Mostrar mensagem de carregamento
            self.setCursor(Qt.WaitCursor)
            self.statusLabel.setText("Carregando informações do produto...")
            
            # Obter informações detalhadas do produto
            response = self.api_client.get(f'acervo/produto/detalhado/{self.product_id}')

            if response and 'dados' in response:
                self.product_data = response['dados']
                self.display_product_info()
                self.statusLabel.setText("Informações carregadas com sucesso")
            else:
                self.statusLabel.setText("Não foi possível carregar as informações detalhadas do produto")
                QMessageBox.warning(self, "Erro", "Não foi possível carregar as informações do produto")

        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            QMessageBox.critical(self, "Erro", f"Erro ao carregar informações do produto: {str(e)}")
        finally:
            self.setCursor(Qt.ArrowCursor)

    def display_product_info(self):
        """Exibe as informações do produto na interface."""
        if not self.product_data:
            return
            
        # Mostrar o cabeçalho
        self.headerWidget.setVisible(True)
        self.productTitleLabel.setText(f"{self.product_data['nome']}")
        self.productDetailsLabel.setText(f"MI: {self.product_data['mi'] or 'N/A'} | INOM: {self.product_data['inom'] or 'N/A'} | Escala: {self.product_data['escala']}")
        
        # Organizar as versões por data de edição (mais recente primeiro)
        versoes = sorted(self.product_data['versoes'], key=lambda v: v.get('versao_data_edicao', ''), reverse=True)
        
        # Preencher informações da última versão (se existir)
        if versoes:
            self.current_version = versoes[0]  # Versão mais recente
            
            # Preencher a aba de visão geral
            self.overview_tab.populate_product_info(self.product_data)
            self.overview_tab.populate_version_info(self.current_version)
            self.overview_tab.populate_stats(self.product_data, self.current_version)
            
            # Preencher a tabela de arquivos com ações de admin se necessário
            if self.is_admin:
                self.overview_tab.populate_files_table(
                    self.current_version['arquivos'],
                    lambda file: AdminActions.create_file_actions_widget(
                        self, file, self.edit_file, self.delete_file
                    )
                )
            else:
                self.overview_tab.populate_files_table(self.current_version['arquivos'])
            
            # Preencher a aba de histórico de versões
            self.versions_tab.populate_versions_list(versoes)
            
            # Configurar detalhes para a versão selecionada inicialmente
            if self.versions_tab.selected_version:
                if self.is_admin:
                    self.versions_tab.populate_files_table(
                        self.versions_tab.selected_version['arquivos'],
                        lambda file: AdminActions.create_file_actions_widget(
                            self, file, self.edit_file, self.delete_file
                        )
                    )
                else:
                    self.versions_tab.populate_files_table(self.versions_tab.selected_version['arquivos'])
            
            # Preparar relacionamentos para a aba de relacionamentos
            relationships = self.extract_relationships(versoes)
            self.relationships_tab.populate_relationships(relationships, self.get_version_product_info)
            
            # Habilitar as outras abas
            self.tabWidget.setTabEnabled(1, True)  # Aba Histórico de Versões
            self.tabWidget.setTabEnabled(2, True)  # Aba Relacionamentos
        else:
            # Tratar caso de produto sem versões
            self.overview_tab.populate_product_info(self.product_data)
            self.overview_tab.version_info_label.setText("Nenhuma versão disponível para este produto.")
            self.overview_tab.stats_label.setText("Sem versões para exibir estatísticas.")
            self.tabWidget.setTabEnabled(1, False)
            self.tabWidget.setTabEnabled(2, False)

    def extract_relationships(self, versions):
        """Extrai os relacionamentos de todas as versões."""
        all_relationships = []
        
        # Coletar todos os relacionamentos de todas as versões
        for version in versions:
            for rel in version.get('relacionamentos', []):
                relationship = {
                    'id': rel.get('id', 0),
                    'source_version_id': version['versao_id'],
                    'source_version_name': f"{version['versao']} - {version['nome_versao'] or 'Sem nome'}",
                    'source_product_id': version['produto_id'],
                    'source_product_name': self.product_data['nome'],
                    'target_version_id': rel['versao_relacionada_id'],
                    'target_version_name': "Carregando...",
                    'target_product_name': "Carregando...",
                    'relationship_type': rel['tipo_relacionamento'],
                    'relationship_type_id': rel.get('tipo_relacionamento_id', 0)
                }
                all_relationships.append(relationship)
                
        return all_relationships
    
    def get_version_product_info(self, version_id, tree_item):
        """Obtém informações do produto associado a uma versão para a árvore de relacionamentos."""
        try:
            # Obter dados da versão relacionada
            response = self.api_client.get(f'acervo/versao/{version_id}')
            
            if response and 'dados' in response:
                version_data = response['dados']
                
                # Obter dados do produto associado à versão
                product_response = self.api_client.get(f'acervo/produto/{version_data["produto_id"]}')
                
                if product_response and 'dados' in product_response:
                    product_data = product_response['dados']
                    
                    # Atualizar o item na árvore
                    tree_item.setText(2, product_data['nome'])
                    
                    # Atualizar os dados do relacionamento
                    relationship = tree_item.data(0, Qt.UserRole)
                    if relationship:
                        relationship['target_product_name'] = product_data['nome']
                        relationship['target_version_name'] = f"{version_data['versao']} - {version_data['nome_versao'] or 'Sem nome'}"
                        tree_item.setData(0, Qt.UserRole, relationship)
                else:
                    tree_item.setText(2, "Produto não encontrado")
            else:
                tree_item.setText(2, "Versão não encontrada")
        except Exception as e:
            self.iface.messageBar().pushMessage(
                "Erro", 
                f"Erro ao obter informações do produto: {str(e)}", 
                level=Qgis.Critical
            )
            tree_item.setText(2, "Erro ao carregar informações")

    def get_file_from_table(self, table, row):
        """Obtém dados de um arquivo da tabela pelo índice da linha."""
        file_id = table.item(row, 1).data(Qt.UserRole)
        if not file_id:
            return None
            
        # Buscar o arquivo pelo ID
        for version in self.product_data['versoes']:
            for file in version['arquivos']:
                if file['id'] == file_id:
                    return file
                    
        return None

    def show_file_details(self, file):
        """Exibe um diálogo com detalhes completos do arquivo."""
        if not file:
            return
            
        dialog = QDialog(self)
        dialog.setWindowTitle(f"Detalhes do Arquivo: {file['nome']}")
        dialog.setMinimumSize(600, 400)
        
        layout = QVBoxLayout(dialog)
        
        # Scroll area para os detalhes
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        content_widget = QWidget()
        content_layout = QVBoxLayout(content_widget)
        
        # Informações básicas
        basic_group = QgsCollapsibleGroupBox("Informações Básicas")
        basic_layout = QVBoxLayout()
        
        basic_info = f"""
        <b>ID:</b> {file['id']}
        <b>UUID:</b> {file['uuid_arquivo']}
        <b>Nome:</b> {file['nome']}
        <b>Nome do Arquivo:</b> {file['nome_arquivo']}
        <b>Tipo:</b> {file['tipo_arquivo']} (ID: {file['tipo_arquivo_id']})
        <b>Volume de Armazenamento ID:</b> {file['volume_armazenamento_id'] or 'N/A'}
        <b>Extensão:</b> {file['extensao'] or 'N/A'}
        <b>Tamanho (MB):</b> {file['tamanho_mb'] if file['tamanho_mb'] else 'N/A'}
        <b>Checksum:</b> {file['checksum'] or 'N/A'}
        <b>Tipo de Status ID:</b> {file['tipo_status_id']}
        <b>Situação de Carregamento ID:</b> {file['situacao_carregamento_id']}
        <b>Descrição:</b> {file['descricao'] or 'N/A'}
        <b>CRS Original:</b> {file['crs_original'] or 'N/A'}
        <b>Data de Cadastramento:</b> {format_date(file['data_cadastramento'])}
        <b>UUID do Usuário de Cadastramento:</b> {file['usuario_cadastramento_uuid']}
        <b>Data de Modificação:</b> {format_date(file['data_modificacao'])}
        <b>UUID do Usuário de Modificação:</b> {file['usuario_modificacao_uuid'] or 'N/A'}
        """
        
        basic_label = QLabel(basic_info)
        basic_label.setWordWrap(True)
        basic_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        basic_layout.addWidget(basic_label)
        basic_group.setLayout(basic_layout)
        content_layout.addWidget(basic_group)
        
        # Metadados (se disponíveis)
        if file.get('metadado'):
            metadata_group = QgsCollapsibleGroupBox("Metadados")
            metadata_layout = QVBoxLayout()
            
            try:
                from .utils import format_metadata
                metadata_text = format_metadata(file['metadado'])
            except:
                metadata_text = str(file['metadado'])
                
            metadata_label = QLabel(metadata_text)
            metadata_label.setWordWrap(True)
            metadata_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
            metadata_layout.addWidget(metadata_label)
            metadata_group.setLayout(metadata_layout)
            content_layout.addWidget(metadata_group)
        
        scroll_area.setWidget(content_widget)
        layout.addWidget(scroll_area)
        
        # Botões de ação
        button_box = QDialogButtonBox(QDialogButtonBox.Ok)
        button_box.accepted.connect(dialog.accept)
        layout.addWidget(button_box)
        
        dialog.exec_()

    # Métodos para ações administrativas - refatorados para usar AdminActions
    def edit_product(self):
        """Edita o produto atual."""
        AdminActions.edit_product(self, self.api_client, self.product_data, self.reload_product_info)
    
    def delete_product(self):
        """Exclui o produto atual."""
        AdminActions.delete_product(self, self.api_client, self.product_data, self.accept)
    
    def edit_current_version(self):
        """Edita a versão atual da aba de visão geral."""
        AdminActions.edit_version(self, self.api_client, self.current_version, self.reload_product_info)
    
    def delete_current_version(self):
        """Exclui a versão atual da aba de visão geral."""
        AdminActions.delete_version(self, self.api_client, self.current_version, self.reload_product_info)
    
    def edit_selected_version(self):
        """Edita a versão selecionada na aba de histórico."""
        if not self.versions_tab.selected_version:
            QMessageBox.warning(self, "Aviso", "Selecione uma versão para editar.")
            return
            
        AdminActions.edit_version(self, self.api_client, self.versions_tab.selected_version, self.reload_product_info)
    
    def delete_selected_version(self):
        """Exclui a versão selecionada na aba de histórico."""
        if not self.versions_tab.selected_version:
            QMessageBox.warning(self, "Aviso", "Selecione uma versão para excluir.")
            return
            
        AdminActions.delete_version(self, self.api_client, self.versions_tab.selected_version, self.reload_product_info)
    
    def edit_file(self, file):
        """Edita um arquivo."""
        AdminActions.edit_file(self, self.api_client, file, self.reload_product_info)
    
    def delete_file(self, file):
        """Exclui um arquivo."""
        AdminActions.delete_file(self, self.api_client, file, self.reload_product_info)
    
    def edit_relationship(self):
        """Edita o relacionamento selecionado."""
        relationship = self.relationships_tab.get_selected_relationship()
        if not relationship:
            QMessageBox.warning(self, "Aviso", "Selecione um relacionamento para editar.")
            return
            
        edit_dialog = RelationshipEditDialog(self.api_client, relationship)
        result = edit_dialog.exec_()
        
        if result:
            self.reload_product_info()
    
    def delete_relationship(self):
        """Exclui o relacionamento selecionado."""
        relationship = self.relationships_tab.get_selected_relationship()
        if not relationship:
            QMessageBox.warning(self, "Aviso", "Selecione um relacionamento para excluir.")
            return
            
        confirm_dialog = DeletionConfirmationDialog(
            "relacionamento", 
            f"{relationship['source_version_name']} - {relationship['relationship_type']}"
        )
        result = confirm_dialog.exec_()
        
        if result == QMessageBox.Accepted:
            try:
                response = self.api_client.delete('produtos/versao_relacionamento', {
                    'versao_relacionamento_ids': [relationship['id']]
                })
                
                if response:
                    QMessageBox.information(self, "Sucesso", "Relacionamento excluído com sucesso!")
                    self.reload_product_info()
                else:
                    QMessageBox.warning(self, "Erro", "Não foi possível excluir o relacionamento.")
            except Exception as e:
                QMessageBox.critical(self, "Erro", f"Erro ao excluir relacionamento: {str(e)}")
    
    def navigate_to_related_product(self):
        """Navega para o produto relacionado selecionado."""
        relationship = self.relationships_tab.get_selected_relationship()
        if not relationship:
            QMessageBox.warning(self, "Aviso", "Selecione um relacionamento para navegar.")
            return
            
        # Em uma implementação real, você buscaria o produto e carregaria seus detalhes
        QMessageBox.information(
            self, 
            "Navegação", 
            f"Navegação para o produto relacionado: {relationship['target_product_name']}"
        )
    
    def reload_product_info(self):
        """Recarrega as informações do produto após alterações."""
        if self.product_id:
            self.load_product_by_id()
    
    # Métodos para adicionar arquivos, versões e versões históricas
    def add_files_to_version(self, version_data):
        """Abre o diálogo para adicionar arquivos a uma versão."""
        dialog = AddFilesToVersionDialog(self.api_client, version_data)
        if dialog.exec_():
            self.reload_product_info()

    def add_files_to_selected_version(self):
        """Adiciona arquivos à versão selecionada na aba de histórico."""
        if not self.versions_tab.selected_version:
            QMessageBox.warning(self, "Aviso", "Selecione uma versão para adicionar arquivos.")
            return
            
        self.add_files_to_version(self.versions_tab.selected_version)

    def add_version_to_product(self):
        """Abre o diálogo para adicionar uma nova versão ao produto atual."""
        dialog = AddVersionToProductDialog(self.api_client, self.product_data)
        if dialog.exec_():
            self.reload_product_info()

    def add_historical_version(self):
        """Abre o diálogo para adicionar uma versão histórica ao produto atual."""
        dialog = AddHistoricalVersionDialog(self.api_client, self.product_data)
        if dialog.exec_():
            self.reload_product_info()
    
    # Métodos para controle de seleção e download de arquivos
    def toggle_select_all_files(self, state):
        """Seleciona ou desseleciona todos os arquivos na tabela principal."""
        for row in range(self.overview_tab.files_table.rowCount()):
            item = self.overview_tab.files_table.item(row, 0)
            if item:
                item.setCheckState(Qt.Checked if state else Qt.Unchecked)
    
    def toggle_select_all_version_files(self, state):
        """Seleciona ou desseleciona todos os arquivos na tabela de versão."""
        for row in range(self.versions_tab.files_table.rowCount()):
            item = self.versions_tab.files_table.item(row, 0)
            if item:
                item.setCheckState(Qt.Checked if state else Qt.Unchecked)
    
    def download_selected_files(self, source_tab):
        """Inicia o download dos arquivos selecionados."""
        table = None
        if source_tab == "overview":
            table = self.overview_tab.files_table
        elif source_tab == "versions":
            table = self.versions_tab.files_table
        else:
            return
            
        # Coletar IDs dos arquivos selecionados
        selected_file_ids = []
        for row in range(table.rowCount()):
            if table.item(row, 0).checkState() == Qt.Checked:
                file_id = table.item(row, 1).data(Qt.UserRole)
                if file_id:
                    selected_file_ids.append(file_id)
        
        if not selected_file_ids:
            QMessageBox.warning(self, "Aviso", "Nenhum arquivo selecionado para download.")
            return
        
        # Solicitar diretório de destino
        destination_dir = QFileDialog.getExistingDirectory(
            self, 
            "Selecione o Diretório de Destino", 
            "", 
            QFileDialog.ShowDirsOnly
        )
        
        if not destination_dir:
            return
        
        # Iniciar o processo de download
        self.statusLabel.setText(f"Preparando download de {len(selected_file_ids)} arquivo(s)...")
        self.setCursor(Qt.WaitCursor)
        
        # Método para preparar download de arquivos específicos
        self.prepare_download_arquivos(selected_file_ids, destination_dir)
    
    def prepare_download_arquivos(self, arquivo_ids, destination_dir):
        """Prepara o download de arquivos específicos pelos IDs."""
        # Armazenar diretório para uso posterior
        self.download_manager.destination_dir = destination_dir
        
        try:
            response = self.api_client.post('acervo/prepare-download/arquivos', {
                'arquivos_ids': arquivo_ids
            })
            
            if response and 'dados' in response:
                self.download_manager.prepare_complete.emit(response['dados'])
            else:
                self.download_manager.download_error.emit("Não foi possível preparar o download. Resposta inválida do servidor.")
        except Exception as e:
            self.download_manager.download_error.emit(f"Erro ao preparar o download: {str(e)}")

    def handle_download_prepare(self, file_infos):
        """Manipula o evento de preparação de download concluída."""
        self.statusLabel.setText(f"Iniciando download de {len(file_infos)} arquivo(s)...")
        
        # Iniciar o download efetivo
        destination_dir = getattr(self.download_manager, 'destination_dir', '')
        self.download_manager.start_download(file_infos, destination_dir)

    def handle_download_complete(self, results):
        """Manipula o evento de download concluído."""
        self.setCursor(Qt.ArrowCursor)
        
        # Contar sucessos e falhas
        successes = sum(1 for r in results if r['success'])
        failures = len(results) - successes
        
        if failures == 0:
            self.statusLabel.setText(f"Download concluído: {successes} arquivo(s) baixado(s) com sucesso.")
            QMessageBox.information(
                self,
                "Download Concluído",
                f"Todos os {successes} arquivos foram baixados com sucesso."
            )
        else:
            self.statusLabel.setText(f"Download concluído: {successes} sucesso(s), {failures} falha(s).")
            
            # Criar mensagem detalhada de erro
            error_details = "Os seguintes arquivos não puderam ser baixados:\n\n"
            for result in results:
                if not result['success']:
                    error_details += f"- {result['nome']}: {result['error_message']}\n"
                    
            QMessageBox.warning(
                self,
                "Download Parcial",
                f"{successes} arquivo(s) baixado(s) com sucesso, {failures} falha(s).\n\n{error_details}"
            )

    def handle_download_error(self, error_message):
        """Manipula o erro de download."""
        self.setCursor(Qt.ArrowCursor)
        self.statusLabel.setText(f"Erro no download: {error_message}")
        
        QMessageBox.critical(
            self,
            "Erro de Download",
            f"Ocorreu um erro durante o download: {error_message}"
        )