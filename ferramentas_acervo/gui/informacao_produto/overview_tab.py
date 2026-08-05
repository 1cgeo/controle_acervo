# Path: gui\informacao_produto\overview_tab.py
"""
Componente da aba de Visão Geral para o diálogo de informações do produto.
"""

from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QCheckBox,
    QPushButton, QScrollArea, QSplitter
)
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QFont
from qgis.gui import QgsCollapsibleGroupBox
from .files_table import montar_tabela_arquivos, preencher_tabela_arquivos
from .utils import bloco_html, campos_da_versao, format_date, get_total_size

class OverviewTab(QWidget):
    def __init__(self, parent, is_admin=False):
        super(OverviewTab, self).__init__(parent)
        self.parent = parent
        self.is_admin = is_admin
        self.setup_ui()
        
    def setup_ui(self):
        """Configura a interface da aba de visão geral."""
        layout = QVBoxLayout(self)
        
        # Splitter para dividir informações e arquivos
        self.splitter = QSplitter(Qt.Orientation.Vertical)
        layout.addWidget(self.splitter)
        
        # Área de informações do produto
        self.info_area = self.create_info_area()
        self.splitter.addWidget(self.info_area)
        
        # Área de arquivos
        self.files_area = self.create_files_area()
        self.splitter.addWidget(self.files_area)
        
        # Definir proporções iniciais do splitter
        self.splitter.setSizes([300, 300])
        
    def create_info_area(self):
        """Cria a área de informações do produto e versão."""
        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        content = QWidget()
        content_layout = QVBoxLayout(content)
        
        # Grupos colapsáveis
        self.product_info_group = QgsCollapsibleGroupBox("Informações do Produto")
        product_layout = QVBoxLayout()
        self.product_info_label = QLabel()
        self.product_info_label.setWordWrap(True)
        self.product_info_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        product_layout.addWidget(self.product_info_label)
        self.product_info_group.setLayout(product_layout)
        content_layout.addWidget(self.product_info_group)
        
        self.version_info_group = QgsCollapsibleGroupBox("Última Versão")
        version_layout = QVBoxLayout()
        self.version_info_label = QLabel()
        self.version_info_label.setWordWrap(True)
        self.version_info_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        version_layout.addWidget(self.version_info_label)
        
        # Botões de administrador para versão
        if self.is_admin:
            admin_buttons = QWidget()
            admin_layout = QHBoxLayout(admin_buttons)
            admin_layout.setContentsMargins(0, 10, 0, 0)
            
            self.add_files_btn = QPushButton("Adicionar Arquivos")
            admin_layout.addWidget(self.add_files_btn)
            
            self.edit_version_btn = QPushButton("Editar Versão")
            admin_layout.addWidget(self.edit_version_btn)
            
            self.delete_version_btn = QPushButton("Excluir Versão")
            self.delete_version_btn.setStyleSheet("background-color: #CF222E; color: white;")
            admin_layout.addWidget(self.delete_version_btn)
            
            version_layout.addWidget(admin_buttons)
        
        self.version_info_group.setLayout(version_layout)
        content_layout.addWidget(self.version_info_group)
        
        self.stats_group = QgsCollapsibleGroupBox("Estatísticas")
        stats_layout = QVBoxLayout()
        self.stats_label = QLabel()
        self.stats_label.setWordWrap(True)
        self.stats_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        stats_layout.addWidget(self.stats_label)
        self.stats_group.setLayout(stats_layout)
        content_layout.addWidget(self.stats_group)
        
        scroll_area.setWidget(content)
        return scroll_area
        
    def create_files_area(self):
        """Cria a área de arquivos da versão."""
        widget = QWidget()
        layout = QVBoxLayout(widget)
        
        # Cabeçalho e controles
        header = QWidget()
        header_layout = QHBoxLayout(header)
        header_layout.setContentsMargins(0, 0, 0, 0)
        
        title = QLabel("Arquivos da Última Versão")
        font = QFont()
        font.setBold(True)
        title.setFont(font)
        header_layout.addWidget(title)
        
        self.select_all_check = QCheckBox("Selecionar Todos")
        header_layout.addWidget(self.select_all_check)
        
        self.download_btn = QPushButton("Baixar Selecionados")
        header_layout.addWidget(self.download_btn)
        
        layout.addWidget(header)
        
        # Tabela de arquivos
        self.files_table = montar_tabela_arquivos(self.is_admin)
        layout.addWidget(self.files_table)

        return widget
    
    def populate_product_info(self, product_data):
        """Preenche informações do produto."""
        if not product_data:
            return
            
        self.product_info_label.setText(bloco_html([
            ('ID', product_data['id']),
            ('Nome', product_data['nome']),
            ('MI', product_data['mi']),
            ('INOM', product_data['inom']),
            ('Escala', product_data['escala']),
            ('Denominador de escala especial', product_data['denominador_escala_especial']),
            ('Tipo de produto', product_data.get('tipo_produto')
             or product_data['tipo_produto_id']),
            ('Subtipo de produto', product_data.get('subtipo_produto')),
            ('Descrição', product_data['descricao']),
            ('Data de cadastramento', format_date(product_data['data_cadastramento'])),
            ('Usuário de cadastramento', product_data['usuario_cadastramento']),
            ('Data de modificação', format_date(product_data['data_modificacao'])),
            ('Usuário de modificação', product_data['usuario_modificacao']),
        ]))
    
    def populate_version_info(self, version_data):
        """Preenche informações da versão atual."""
        if not version_data:
            self.version_info_label.setText("Nenhuma versão disponível para este produto.")
            return
            
        self.version_info_label.setText(bloco_html(campos_da_versao(version_data)))
        
    def populate_stats(self, product_data, current_version):
        """Preenche estatísticas do produto."""
        if not product_data or not current_version:
            self.stats_label.setText("Sem dados para exibir estatísticas.")
            return
            
        self.stats_label.setText(bloco_html([
            ('Número total de versões', len(product_data['versoes'])),
            ('Número de arquivos na última versão', len(current_version['arquivos'])),
            ('Tamanho total dos arquivos da última versão',
             f"{get_total_size(current_version['arquivos'])} MB"),
        ]))
        
    def populate_files_table(self, files, create_actions_callback=None,
                             on_details=None):
        """Preenche a tabela de arquivos. Ver gui/informacao_produto/files_table.py."""
        preencher_tabela_arquivos(
            self.files_table, files, self.is_admin,
            criar_acoes=create_actions_callback,
            ao_pedir_detalhes=on_details,
            formatar_data=format_date,
        )