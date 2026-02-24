# Path: gui\informacao_produto\versions_tab.py
"""
Componente da aba de Histórico de Versões para o diálogo de informações do produto.
"""

from qgis.PyQt.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel, QCheckBox,
    QPushButton, QTableWidget, QTableWidgetItem, QHeaderView, 
    QScrollArea, QSplitter, QListWidget, QListWidgetItem
)
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QFont
from qgis.gui import QgsCollapsibleGroupBox
from .utils import format_date

class VersionsTab(QWidget):
    def __init__(self, parent, is_admin=False):
        super(VersionsTab, self).__init__(parent)
        self.parent = parent
        self.is_admin = is_admin
        self.selected_version = None
        self.setup_ui()
        
    def setup_ui(self):
        """Configura a interface da aba de histórico de versões."""
        layout = QVBoxLayout(self)
        
        # Splitter para dividir lista de versões e detalhes
        self.splitter = QSplitter(Qt.Horizontal)
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
        self.version_info_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
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
        
    def on_version_selected(self, current, previous):
        """Manipula a seleção de uma versão na lista."""
        if not current:
            return
            
        # Obter dados da versão selecionada
        self.selected_version = current.data(Qt.UserRole)
        self.populate_version_info(self.selected_version)
    
    def populate_versions_list(self, versions):
        """Preenche a lista de versões."""
        self.versions_list.clear()
        
        # Adicionar as versões à lista
        for version in versions:
            item = QListWidgetItem(f"{version['versao']} - {version['nome_versao'] or 'Sem nome'}")
            item.setData(Qt.UserRole, version)
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
            
        # Preencher informações da versão
        version_info = f"""
        <b>UUID:</b> {version['uuid_versao']}
        <b>Versão:</b> {version['versao']}
        <b>Nome:</b> {version['nome_versao'] or 'N/A'}
        <b>Tipo de Versão ID:</b> {version['tipo_versao_id']}
        <b>Subtipo de Produto ID:</b> {version['subtipo_produto_id']}
        <b>Lote:</b> {version['lote_nome'] or 'N/A'} ({version['lote_pit'] or 'N/A'})
        <b>Projeto:</b> {version['projeto_nome'] or 'N/A'}
        <b>Órgão Produtor:</b> {version['orgao_produtor']}
        <b>Palavras-chave:</b> {', '.join(version['palavras_chave']) if version['palavras_chave'] else 'N/A'}
        <b>Descrição:</b> {version['versao_descricao'] or 'N/A'}
        <b>Data de Criação:</b> {format_date(version['versao_data_criacao'])}
        <b>Data de Edição:</b> {format_date(version['versao_data_edicao'])}
        <b>Data de Cadastramento:</b> {format_date(version['versao_data_cadastramento'])}
        <b>Data de Modificação:</b> {format_date(version['versao_data_modificacao'])}
        """
        self.version_info_label.setText(version_info)
    
    def populate_files_table(self, files, create_actions_callback=None):
        """Preenche a tabela de arquivos da versão selecionada."""
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
            
            # Botões de ação para administradores - verificar se callback existe
            if self.is_admin and create_actions_callback is not None:
                try:
                    actions_widget = create_actions_callback(file)
                    if actions_widget:  # Verificar se o widget foi criado corretamente
                        self.files_table.setCellWidget(row, 7, actions_widget)
                except Exception as e:
                    import logging
                    logging.error(f"Erro ao criar widget de ações para arquivo {file['nome']}: {str(e)}")
                    # Criar widget de erro como fallback
                    error_widget = QWidget()
                    error_layout = QHBoxLayout(error_widget)
                    error_layout.setContentsMargins(0, 0, 0, 0)
                    error_btn = QPushButton("Erro")
                    error_btn.setDisabled(True)
                    error_layout.addWidget(error_btn)
                    self.files_table.setCellWidget(row, 7, error_widget)
        
        self.files_table.resizeColumnsToContents()
        self.files_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)