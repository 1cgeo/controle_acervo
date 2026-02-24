# Path: gui\informacao_produto\overview_tab.py
"""
Componente da aba de Visão Geral para o diálogo de informações do produto.
"""

from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QCheckBox,
    QPushButton, QTableWidget, QTableWidgetItem, QHeaderView, QScrollArea
)
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QFont
from qgis.gui import QgsCollapsibleGroupBox
from .utils import format_date

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
        from qgis.PyQt.QtWidgets import QSplitter
        self.splitter = QSplitter(Qt.Vertical)
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
        self.product_info_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        product_layout.addWidget(self.product_info_label)
        self.product_info_group.setLayout(product_layout)
        content_layout.addWidget(self.product_info_group)
        
        self.version_info_group = QgsCollapsibleGroupBox("Última Versão")
        version_layout = QVBoxLayout()
        self.version_info_label = QLabel()
        self.version_info_label.setWordWrap(True)
        self.version_info_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
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
        self.stats_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
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
        self.files_table = QTableWidget()
        cols = 8 if self.is_admin else 7
        self.files_table.setColumnCount(cols)
        headers = ["", "Nome", "Tipo", "Tamanho (MB)", "Extensão", "Data", "Detalhes"]
        if self.is_admin:
            headers.append("Ações")
        self.files_table.setHorizontalHeaderLabels(headers)
        self.files_table.setSelectionBehavior(QTableWidget.SelectRows)
        self.files_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.files_table.horizontalHeader().setSectionResizeMode(6, QHeaderView.ResizeToContents)
        if self.is_admin:
            self.files_table.horizontalHeader().setSectionResizeMode(7, QHeaderView.ResizeToContents)
        layout.addWidget(self.files_table)
        
        return widget
    
    def populate_product_info(self, product_data):
        """Preenche informações do produto."""
        if not product_data:
            return
            
        product_info = f"""
        <b>ID:</b> {product_data['id']}
        <b>Nome:</b> {product_data['nome'] or 'N/A'}
        <b>MI:</b> {product_data['mi'] or 'N/A'}
        <b>INOM:</b> {product_data['inom'] or 'N/A'}
        <b>Escala:</b> {product_data['escala']}
        <b>Denominador de Escala Especial:</b> {product_data['denominador_escala_especial'] or 'N/A'}
        <b>Tipo de Produto ID:</b> {product_data['tipo_produto_id']}
        <b>Descrição:</b> {product_data['descricao'] or 'N/A'}
        <b>Data de Cadastramento:</b> {format_date(product_data['data_cadastramento'])}
        <b>Usuário de Cadastramento:</b> {product_data['usuario_cadastramento']}
        <b>Data de Modificação:</b> {format_date(product_data['data_modificacao'])}
        <b>Usuário de Modificação:</b> {product_data['usuario_modificacao']}
        """
        self.product_info_label.setText(product_info)
    
    def populate_version_info(self, version_data):
        """Preenche informações da versão atual."""
        if not version_data:
            self.version_info_label.setText("Nenhuma versão disponível para este produto.")
            return
            
        version_info = f"""
        <b>UUID:</b> {version_data['uuid_versao']}
        <b>Versão:</b> {version_data['versao']}
        <b>Nome:</b> {version_data['nome_versao'] or 'N/A'}
        <b>Tipo de Versão ID:</b> {version_data['tipo_versao_id']}
        <b>Subtipo de Produto ID:</b> {version_data['subtipo_produto_id']}
        <b>Lote:</b> {version_data['lote_nome'] or 'N/A'} ({version_data['lote_pit'] or 'N/A'})
        <b>Projeto:</b> {version_data['projeto_nome'] or 'N/A'}
        <b>Órgão Produtor:</b> {version_data['orgao_produtor']}
        <b>Palavras-chave:</b> {', '.join(version_data['palavras_chave']) if version_data['palavras_chave'] else 'N/A'}
        <b>Descrição:</b> {version_data['versao_descricao'] or 'N/A'}
        <b>Data de Criação:</b> {format_date(version_data['versao_data_criacao'])}
        <b>Data de Edição:</b> {format_date(version_data['versao_data_edicao'])}
        <b>Data de Cadastramento:</b> {format_date(version_data['versao_data_cadastramento'])}
        <b>Data de Modificação:</b> {format_date(version_data['versao_data_modificacao'])}
        """
        self.version_info_label.setText(version_info)
        
    def populate_stats(self, product_data, current_version):
        """Preenche estatísticas do produto."""
        if not product_data or not current_version:
            self.stats_label.setText("Sem dados para exibir estatísticas.")
            return
            
        num_versions = len(product_data['versoes'])
        num_files = len(current_version['arquivos'])
        
        from .utils import get_total_size
        total_size = get_total_size(current_version['arquivos'])
        
        stats_info = f"""
        <b>Número total de versões:</b> {num_versions}
        <b>Número de arquivos na última versão:</b> {num_files}
        <b>Tamanho total dos arquivos da última versão:</b> {total_size} MB
        """
        self.stats_label.setText(stats_info)
        
    def populate_files_table(self, files, create_actions_callback=None):
        """Preenche a tabela de arquivos."""
        self.files_table.setRowCount(0)
        
        for row, file in enumerate(files):
            self.files_table.insertRow(row)
            
            # Checkbox para seleção
            checkbox = QTableWidgetItem()
            checkbox.setFlags(Qt.ItemIsUserCheckable | Qt.ItemIsEnabled)
            checkbox.setCheckState(Qt.Unchecked)
            self.files_table.setItem(row, 0, checkbox)
            
            # Informações básicas do arquivo
            self.files_table.setItem(row, 1, QTableWidgetItem(file['nome']))
            self.files_table.setItem(row, 2, QTableWidgetItem(file['tipo_arquivo']))
            
            size_item = QTableWidgetItem()
            if file['tamanho_mb']:
                size_item.setText(f"{file['tamanho_mb']:.2f}")
                size_item.setData(Qt.UserRole, float(file['tamanho_mb']))
            else:
                size_item.setText("N/A")
            self.files_table.setItem(row, 3, size_item)
            
            self.files_table.setItem(row, 4, QTableWidgetItem(file['extensao'] or "N/A"))
            self.files_table.setItem(row, 5, QTableWidgetItem(format_date(file['data_cadastramento'])))
            
            # Botão para mostrar detalhes
            details_btn = QPushButton("Detalhes")
            details_btn.setProperty("file_id", file['id'])
            self.files_table.setCellWidget(row, 6, details_btn)
            
            # Armazenar o ID do arquivo para download posterior
            self.files_table.setItem(row, 1, QTableWidgetItem(file['nome']))
            self.files_table.item(row, 1).setData(Qt.UserRole, file['id'])
            
            # Botões de ação para administradores
            if self.is_admin and create_actions_callback:
                actions_widget = create_actions_callback(file)
                self.files_table.setCellWidget(row, 7, actions_widget)
        
        self.files_table.resizeColumnsToContents()
        self.files_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)