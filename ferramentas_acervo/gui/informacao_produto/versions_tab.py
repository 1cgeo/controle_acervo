# Path: gui\informacao_produto\versions_tab.py
"""
Componente da aba de Histórico de Versões para o diálogo de informações do produto.
"""

from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QCheckBox,
    QPushButton, QScrollArea, QSplitter, QListWidget, QListWidgetItem
)
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QFont
from qgis.gui import QgsCollapsibleGroupBox
from .files_table import montar_tabela_arquivos, preencher_tabela_arquivos
from .utils import bloco_html, campos_da_versao, format_date

class VersionsTab(QWidget):
    def __init__(self, parent, is_admin=False):
        super(VersionsTab, self).__init__(parent)
        self.parent = parent
        self.is_admin = is_admin
        self.selected_version = None
        # O diálogo dono põe aqui o que recarrega a TABELA DE ARQUIVOS ao
        # trocar de versão. Sem isso a lista de arquivos fica na versão da
        # primeira carga enquanto o painel ao lado mostra outra, e "Baixar
        # Selecionados" baixaria o arquivo da versão errada.
        self.ao_trocar_versao = None
        self.setup_ui()
        
    def setup_ui(self):
        """Configura a interface da aba de histórico de versões."""
        layout = QVBoxLayout(self)
        
        # Splitter para dividir lista de versões e detalhes
        self.splitter = QSplitter(Qt.Orientation.Horizontal)
        layout.addWidget(self.splitter)
        
        # Painel esquerdo: lista de versões
        self.versions_list_widget = self.create_versions_list_widget()
        self.splitter.addWidget(self.versions_list_widget)
        
        # Painel direito: detalhes da versão e arquivos
        self.version_details_widget = self.create_version_details_widget()
        self.splitter.addWidget(self.version_details_widget)
        
        # Definir proporções iniciais do splitter
        self.splitter.setSizes([250, 550])
        
    def create_versions_list_widget(self):
        """Cria o widget de lista de versões."""
        widget = QWidget()
        layout = QVBoxLayout(widget)
        
        self.versions_list_label = QLabel("Histórico de Versões")
        font = QFont()
        font.setBold(True)
        self.versions_list_label.setFont(font)
        layout.addWidget(self.versions_list_label)
        
        self.versions_list = QListWidget()
        self.versions_list.currentItemChanged.connect(self.on_version_selected)
        layout.addWidget(self.versions_list)
        
        return widget
        
    def create_version_details_widget(self):
        """Cria o widget de detalhes da versão."""
        widget = QWidget()
        layout = QVBoxLayout(widget)
        
        # Scroll area para detalhes da versão
        self.version_details_scroll = QScrollArea()
        self.version_details_scroll.setWidgetResizable(True)
        self.version_details_content = QWidget()
        self.version_details_content_layout = QVBoxLayout(self.version_details_content)
        
        self.version_info_group = QgsCollapsibleGroupBox("Informações da Versão")
        self.version_info_layout = QVBoxLayout()
        self.version_info_label = QLabel()
        self.version_info_label.setWordWrap(True)
        self.version_info_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        self.version_info_layout.addWidget(self.version_info_label)
        
        # Botões de administrador para versão
        if self.is_admin:
            self.version_admin_buttons = QWidget()
            admin_layout = QHBoxLayout(self.version_admin_buttons)
            admin_layout.setContentsMargins(0, 10, 0, 0)
            
            self.edit_version_btn = QPushButton("Editar Versão")
            admin_layout.addWidget(self.edit_version_btn)
            
            self.delete_version_btn = QPushButton("Excluir Versão")
            self.delete_version_btn.setStyleSheet("background-color: #CF222E; color: white;")
            admin_layout.addWidget(self.delete_version_btn)
            
            self.version_info_layout.addWidget(self.version_admin_buttons)
        
        self.version_info_group.setLayout(self.version_info_layout)
        self.version_details_content_layout.addWidget(self.version_info_group)
        
        self.version_details_scroll.setWidget(self.version_details_content)
        layout.addWidget(self.version_details_scroll)
        
        # Arquivos da versão selecionada
        self.version_files_header = QWidget()
        files_header_layout = QHBoxLayout(self.version_files_header)
        files_header_layout.setContentsMargins(0, 0, 0, 0)
        
        self.version_files_label = QLabel("Arquivos da Versão")
        font = QFont()
        font.setBold(True)
        self.version_files_label.setFont(font)
        files_header_layout.addWidget(self.version_files_label)
        
        self.select_all_check = QCheckBox("Selecionar Todos")
        files_header_layout.addWidget(self.select_all_check)
        
        self.download_btn = QPushButton("Baixar Selecionados")
        files_header_layout.addWidget(self.download_btn)
        
        layout.addWidget(self.version_files_header)
        
        # Tabela de arquivos
        self.files_table = montar_tabela_arquivos(self.is_admin)
        layout.addWidget(self.files_table)

        return widget
        
    def on_version_selected(self, current, previous):
        """Manipula a seleção de uma versão na lista."""
        if not current:
            return
            
        # Obter dados da versão selecionada
        self.selected_version = current.data(Qt.ItemDataRole.UserRole)
        self.populate_version_info(self.selected_version)
        self.select_all_check.setChecked(False)
        if self.ao_trocar_versao is not None:
            self.ao_trocar_versao(self.selected_version)
    
    def populate_versions_list(self, versions):
        """Preenche a lista de versões."""
        self.versions_list.clear()
        
        # Adicionar as versões à lista
        for version in versions:
            item = QListWidgetItem(f"{version['versao']} - {version['nome_versao'] or 'Sem nome'}")
            item.setData(Qt.ItemDataRole.UserRole, version)
            self.versions_list.addItem(item)
        
        # Selecionar a primeira versão (se existir)
        if self.versions_list.count() > 0:
            self.versions_list.setCurrentRow(0)
    
    def populate_version_info(self, version):
        """Preenche as informações da versão selecionada."""
        if not version:
            self.version_info_label.setText("Nenhuma versão selecionada.")
            self.files_table.setRowCount(0)
            return
            
        self.version_info_label.setText(bloco_html(campos_da_versao(version)))
    
    def populate_files_table(self, files, create_actions_callback=None,
                             on_details=None):
        """Preenche a tabela de arquivos. Ver gui/informacao_produto/files_table.py."""
        preencher_tabela_arquivos(
            self.files_table, files, self.is_admin,
            criar_acoes=create_actions_callback,
            ao_pedir_detalhes=on_details,
            formatar_data=format_date,
        )