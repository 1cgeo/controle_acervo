# Path: gui\adicionar_produto\adicionar_produto_dialog.py
import os
import json
import uuid
import hashlib
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (
    QDialog, QMessageBox, QVBoxLayout, QHBoxLayout, QLabel, 
    QLineEdit, QComboBox, QTextEdit, QDateEdit, QFileDialog, 
    QPushButton, QGroupBox, QWidget, QTableWidget, QTableWidgetItem,
    QHeaderView, QCheckBox, QTabWidget, QScrollArea, QSpinBox
)
from qgis.PyQt.QtCore import Qt, QDate, pyqtSignal, QThread, QObject, QSize, QSortFilterProxyModel
from qgis.core import QgsGeometry, QgsFeature, QgsProject, QgsVectorLayer, Qgis
from qgis.gui import QgsMapToolEmitPoint, QgsRubberBand
from ..core.file_transfer import FileTransferThread
from ..config import Config

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'add_product_dialog.ui'))

class AddProductDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(AddProductDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        
        # Lista para controlar as versões e arquivos
        self.versoes = []
        self.transfer_threads = []
        self.current_geometry = None
        
        # Dicionários para armazenar dados de domínio
        self.escalas = {}
        self.tipos_produto = {}
        self.tipos_versao = {}
        self.subtipos_produto = {}
        self.tipos_arquivo = {}

        # Dados brutos para popular combos (preenchidos por load_domain_data)
        self._subtipos_data = []
        self._lotes_data = []

        # Dicionário para armazenar widgets de cada aba de versão por índice
        self._version_widgets = {}

        # Inicializar a interface
        self.setup_ui()
        
        # Carregar dados de domínio
        self.load_domain_data()
        
        # Conectar sinais
        self.connectSignals()
    
    def setup_ui(self):
        """Configurar a interface de usuário."""
        self.setWindowTitle("Adicionar Novo Produto")
        self.resize(900, 700)
        
        # Configurar a área de informações do produto
        self.setupProductInfoUI()
        
        # Configurar a área de versões
        self.setupVersionsUI()
        
        # Botões principais
        self.saveButton.clicked.connect(self.save_product)
        self.cancelButton.clicked.connect(self.reject)
        
        # Inicializar a barra de progresso
        self.progressBar.setVisible(False)
    
    def setupProductInfoUI(self):
        """Configurar a interface de informações do produto."""
        # Configurar limites e validações para campos
        self.denominadorSpinBox.setRange(1, 1000000)
        self.denominadorSpinBox.setEnabled(False)
        
        # Configurar o campo de geometria
        self.mapSelectionButton.clicked.connect(self.start_map_selection)
        self.clearGeometryButton.clicked.connect(self.clear_geometry)
        
    def setupVersionsUI(self):
        """Configurar a interface de versões."""
        # Limpar o layout existente
        if self.versionsTabWidget.count() > 0:
            self.versionsTabWidget.clear()
        
        # Configurar botão para adicionar nova versão
        self.addVersionButton.clicked.connect(self.add_version)
        
        # Adicionar primeira versão por padrão
        self.add_version()
    
    def add_version(self):
        """Adicionar uma nova aba de versão."""
        # Criar dados da versão
        versao_data = {
            'uuid_versao': str(uuid.uuid4()),
            'nome': '',
            'versao': '',
            'tipo_versao_id': None,
            'subtipo_produto_id': None,
            'lote_id': None,
            'metadado': {},
            'descricao': '',
            'orgao_produtor': '',
            'palavras_chave': [],
            'data_criacao': QDate.currentDate(),
            'data_edicao': QDate.currentDate(),
            'arquivos': []
        }
        
        # Adicionar à lista de versões
        self.versoes.append(versao_data)
        version_index = len(self.versoes) - 1
        
        # Criar a aba de versão
        version_tab = QWidget()
        version_layout = QVBoxLayout(version_tab)
        
        # Criar formulário para a versão
        form_group = QGroupBox("Informações da Versão")
        form_layout = QVBoxLayout()
        
        # Layout para campos em linha
        row1_layout = QHBoxLayout()
        row2_layout = QHBoxLayout()
        row3_layout = QHBoxLayout()
        row4_layout = QHBoxLayout()
        
        # Nome
        nome_layout = QVBoxLayout()
        nome_label = QLabel("Nome da Versão:")
        version_name_edit = QLineEdit()
        nome_layout.addWidget(nome_label)
        nome_layout.addWidget(version_name_edit)
        row1_layout.addLayout(nome_layout)

        # Número da versão
        versao_layout = QVBoxLayout()
        versao_label = QLabel("Número da Versão:")
        version_number_edit = QLineEdit()
        version_number_edit.setPlaceholderText("Ex: 1-DSGEO ou 2ª Edição")
        versao_layout.addWidget(versao_label)
        versao_layout.addWidget(version_number_edit)
        row1_layout.addLayout(versao_layout)

        # Tipo da versão
        tipo_versao_layout = QVBoxLayout()
        tipo_versao_label = QLabel("Tipo de Versão:")
        version_type_combo = QComboBox()
        for code, nome in self.tipos_versao.items():
            version_type_combo.addItem(nome, code)
        tipo_versao_layout.addWidget(tipo_versao_label)
        tipo_versao_layout.addWidget(version_type_combo)
        row2_layout.addLayout(tipo_versao_layout)

        # Subtipo de produto
        subtipo_layout = QVBoxLayout()
        subtipo_label = QLabel("Subtipo de Produto:")
        subtype_combo = QComboBox()
        subtipo_layout.addWidget(subtipo_label)
        subtipo_layout.addWidget(subtype_combo)
        row2_layout.addLayout(subtipo_layout)

        # Lote
        lote_layout = QVBoxLayout()
        lote_label = QLabel("Lote (opcional):")
        lot_combo = QComboBox()
        lot_combo.setEditable(False)
        lot_combo.addItem("Nenhum", None)
        lote_layout.addWidget(lote_label)
        lote_layout.addWidget(lot_combo)
        row3_layout.addLayout(lote_layout)

        # Órgão produtor
        orgao_layout = QVBoxLayout()
        orgao_label = QLabel("Órgão Produtor:")
        producer_edit = QLineEdit()
        producer_edit.setText("DSG")
        orgao_layout.addWidget(orgao_label)
        orgao_layout.addWidget(producer_edit)
        row3_layout.addLayout(orgao_layout)

        # Palavras-chave
        keywords_layout = QVBoxLayout()
        keywords_label = QLabel("Palavras-chave (separadas por vírgula):")
        keywords_edit = QLineEdit()
        keywords_layout.addWidget(keywords_label)
        keywords_layout.addWidget(keywords_edit)
        row4_layout.addLayout(keywords_layout)

        # Datas
        dates_layout = QHBoxLayout()

        creation_date_layout = QVBoxLayout()
        creation_date_label = QLabel("Data de Criação:")
        creation_date_edit = QDateEdit()
        creation_date_edit.setCalendarPopup(True)
        creation_date_edit.setDate(QDate.currentDate())
        creation_date_layout.addWidget(creation_date_label)
        creation_date_layout.addWidget(creation_date_edit)
        dates_layout.addLayout(creation_date_layout)

        edit_date_layout = QVBoxLayout()
        edit_date_label = QLabel("Data de Edição:")
        edit_date_edit = QDateEdit()
        edit_date_edit.setCalendarPopup(True)
        edit_date_edit.setDate(QDate.currentDate())
        edit_date_layout.addWidget(edit_date_label)
        edit_date_layout.addWidget(edit_date_edit)
        dates_layout.addLayout(edit_date_layout)

        row4_layout.addLayout(dates_layout)

        # Descrição
        descricao_label = QLabel("Descrição:")
        description_edit = QTextEdit()
        description_edit.setMaximumHeight(100)

        # Metadados (JSON)
        metadados_label = QLabel("Metadados (JSON):")
        metadados_edit = QTextEdit()
        metadados_edit.setMaximumHeight(100)
        metadados_edit.setText("{}")

        # Adicionar todos os layouts ao formulário
        form_layout.addLayout(row1_layout)
        form_layout.addLayout(row2_layout)
        form_layout.addLayout(row3_layout)
        form_layout.addLayout(row4_layout)
        form_layout.addWidget(descricao_label)
        form_layout.addWidget(description_edit)
        form_layout.addWidget(metadados_label)
        form_layout.addWidget(metadados_edit)

        form_group.setLayout(form_layout)
        version_layout.addWidget(form_group)

        # Seção de arquivos
        files_group = QGroupBox("Arquivos")
        files_layout = QVBoxLayout()

        # Botões para gerenciar arquivos
        buttons_layout = QHBoxLayout()
        add_file_button = QPushButton("Adicionar Arquivo")
        add_file_button.clicked.connect(lambda: self.add_file(version_index))
        remove_file_button = QPushButton("Remover Arquivo Selecionado")
        remove_file_button.clicked.connect(lambda: self.remove_file(version_index))
        buttons_layout.addWidget(add_file_button)
        buttons_layout.addWidget(remove_file_button)

        files_layout.addLayout(buttons_layout)

        # Tabela de arquivos
        files_table = QTableWidget()
        files_table.setColumnCount(5)
        files_table.setHorizontalHeaderLabels(["Nome", "Arquivo", "Tipo", "Tamanho (MB)", "Caminho"])
        files_table.setSelectionBehavior(files_table.SelectRows)
        files_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        files_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        files_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)

        files_layout.addWidget(files_table)

        files_group.setLayout(files_layout)
        version_layout.addWidget(files_group)

        # Botão para remover esta versão
        remove_version_layout = QHBoxLayout()
        remove_version_layout.addStretch(1)
        remove_version_button = QPushButton("Remover esta Versão")
        remove_version_button.setStyleSheet("background-color: #CF222E; color: white;")
        remove_version_button.clicked.connect(lambda: self.remove_version(version_index))
        remove_version_button.setEnabled(len(self.versoes) > 1)
        remove_version_layout.addWidget(remove_version_button)

        version_layout.addLayout(remove_version_layout)

        # Adicionar a aba ao widget de abas
        self.versionsTabWidget.addTab(version_tab, f"Versão {len(self.versoes)}")
        self.versionsTabWidget.setCurrentIndex(version_index)

        # Armazenar referências de widgets desta versão
        self._version_widgets[version_index] = {
            'subtype_combo': subtype_combo,
            'version_type_combo': version_type_combo,
            'lot_combo': lot_combo,
            'files_table': files_table,
            'remove_button': remove_version_button,
        }

        # Popupar subtipos filtrados para esta versão
        self._populate_subtype_combo(subtype_combo)

        # Popular combo de lotes para esta versão
        self._populate_lot_combo(lot_combo)

        # Conectar os campos desta versão
        version_name_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'nome', text))
        version_number_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'versao', text))
        version_type_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'tipo_versao_id', version_type_combo.itemData(version_type_combo.currentIndex())))
        subtype_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'subtipo_produto_id', subtype_combo.itemData(subtype_combo.currentIndex())))
        lot_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'lote_id', lot_combo.itemData(lot_combo.currentIndex())))
        producer_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'orgao_produtor', text))
        keywords_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'palavras_chave', [keyword.strip() for keyword in text.split(',') if keyword.strip()]))
        creation_date_edit.dateChanged.connect(lambda date: self.update_version_data(version_index, 'data_criacao', date))
        edit_date_edit.dateChanged.connect(lambda date: self.update_version_data(version_index, 'data_edicao', date))
        description_edit.textChanged.connect(lambda: self.update_version_data(version_index, 'descricao', description_edit.toPlainText()))
        metadados_edit.textChanged.connect(lambda: self._update_version_metadata(version_index, metadados_edit))

    def update_version_data(self, version_index, field, value):
        """Atualizar dados da versão."""
        if version_index < len(self.versoes):
            self.versoes[version_index][field] = value
    
    def remove_version(self, version_index):
        """Remover uma versão."""
        if len(self.versoes) <= 1:
            QMessageBox.warning(self, "Aviso", "Pelo menos uma versão é necessária.")
            return
        
        reply = QMessageBox.question(
            self, 'Confirmar exclusão',
            'Tem certeza que deseja remover esta versão?',
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            # Remover da lista de versões
            del self.versoes[version_index]
            
            # Recriar todas as abas de versão
            self.versionsTabWidget.clear()
            self._version_widgets = {}

            # Recriar as abas para cada versão
            for i in range(len(self.versoes)):
                # Atualizar UI com os valores existentes
                self.add_version_tab(i)
                
            # Atualizar estado dos botões de remoção
            self.update_remove_buttons()
    
    def add_version_tab(self, version_index):
        """Adicionar uma aba de versão recriando a UI com dados existentes."""
        versao_data = self.versoes[version_index]

        # Criar a aba de versão
        version_tab = QWidget()
        version_layout = QVBoxLayout(version_tab)

        # Criar formulário para a versão
        form_group = QGroupBox("Informações da Versão")
        form_layout = QVBoxLayout()

        row1_layout = QHBoxLayout()
        row2_layout = QHBoxLayout()
        row3_layout = QHBoxLayout()
        row4_layout = QHBoxLayout()

        # Nome
        nome_layout = QVBoxLayout()
        nome_label = QLabel("Nome da Versão:")
        version_name_edit = QLineEdit()
        version_name_edit.setText(versao_data.get('nome', ''))
        nome_layout.addWidget(nome_label)
        nome_layout.addWidget(version_name_edit)
        row1_layout.addLayout(nome_layout)

        # Número da versão
        versao_layout = QVBoxLayout()
        versao_label = QLabel("Número da Versão:")
        version_number_edit = QLineEdit()
        version_number_edit.setPlaceholderText("Ex: 1-DSGEO ou 2ª Edição")
        version_number_edit.setText(versao_data.get('versao', ''))
        versao_layout.addWidget(versao_label)
        versao_layout.addWidget(version_number_edit)
        row1_layout.addLayout(versao_layout)

        # Tipo da versão
        tipo_versao_layout = QVBoxLayout()
        tipo_versao_label = QLabel("Tipo de Versão:")
        version_type_combo = QComboBox()
        for code, nome in self.tipos_versao.items():
            version_type_combo.addItem(nome, code)
        # Selecionar o valor existente
        if versao_data.get('tipo_versao_id') is not None:
            idx = version_type_combo.findData(versao_data['tipo_versao_id'])
            if idx >= 0:
                version_type_combo.setCurrentIndex(idx)
        tipo_versao_layout.addWidget(tipo_versao_label)
        tipo_versao_layout.addWidget(version_type_combo)
        row2_layout.addLayout(tipo_versao_layout)

        # Subtipo de produto
        subtipo_layout = QVBoxLayout()
        subtipo_label = QLabel("Subtipo de Produto:")
        subtype_combo = QComboBox()
        for code, nome in self.subtipos_produto.items():
            subtype_combo.addItem(nome, code)
        if versao_data.get('subtipo_produto_id') is not None:
            idx = subtype_combo.findData(versao_data['subtipo_produto_id'])
            if idx >= 0:
                subtype_combo.setCurrentIndex(idx)
        subtipo_layout.addWidget(subtipo_label)
        subtipo_layout.addWidget(subtype_combo)
        row2_layout.addLayout(subtipo_layout)

        # Lote
        lote_layout = QVBoxLayout()
        lote_label = QLabel("Lote (opcional):")
        lot_combo = QComboBox()
        lot_combo.setEditable(False)
        lot_combo.addItem("Nenhum", None)
        try:
            response = self.api_client.get('projetos/lote')
            if response and 'dados' in response:
                for item in response['dados']:
                    lot_combo.addItem(f"{item['nome']} ({item['pit']})", item['id'])
        except Exception:
            pass
        if versao_data.get('lote_id') is not None:
            idx = lot_combo.findData(versao_data['lote_id'])
            if idx >= 0:
                lot_combo.setCurrentIndex(idx)
        lote_layout.addWidget(lote_label)
        lote_layout.addWidget(lot_combo)
        row3_layout.addLayout(lote_layout)

        # Órgão produtor
        orgao_layout = QVBoxLayout()
        orgao_label = QLabel("Órgão Produtor:")
        producer_edit = QLineEdit()
        producer_edit.setText(versao_data.get('orgao_produtor', 'DSG'))
        orgao_layout.addWidget(orgao_label)
        orgao_layout.addWidget(producer_edit)
        row3_layout.addLayout(orgao_layout)

        # Palavras-chave
        keywords_layout = QVBoxLayout()
        keywords_label = QLabel("Palavras-chave (separadas por vírgula):")
        keywords_edit = QLineEdit()
        palavras = versao_data.get('palavras_chave', [])
        keywords_edit.setText(', '.join(palavras) if isinstance(palavras, list) else str(palavras))
        keywords_layout.addWidget(keywords_label)
        keywords_layout.addWidget(keywords_edit)
        row4_layout.addLayout(keywords_layout)

        # Datas
        dates_layout = QHBoxLayout()

        creation_date_layout = QVBoxLayout()
        creation_date_label = QLabel("Data de Criação:")
        creation_date_edit = QDateEdit()
        creation_date_edit.setCalendarPopup(True)
        creation_date_edit.setDate(versao_data.get('data_criacao', QDate.currentDate()))
        creation_date_layout.addWidget(creation_date_label)
        creation_date_layout.addWidget(creation_date_edit)
        dates_layout.addLayout(creation_date_layout)

        edit_date_layout = QVBoxLayout()
        edit_date_label = QLabel("Data de Edição:")
        edit_date_edit = QDateEdit()
        edit_date_edit.setCalendarPopup(True)
        edit_date_edit.setDate(versao_data.get('data_edicao', QDate.currentDate()))
        edit_date_layout.addWidget(edit_date_label)
        edit_date_layout.addWidget(edit_date_edit)
        dates_layout.addLayout(edit_date_layout)

        row4_layout.addLayout(dates_layout)

        # Descrição
        descricao_label = QLabel("Descrição:")
        description_edit = QTextEdit()
        description_edit.setMaximumHeight(100)
        description_edit.setText(versao_data.get('descricao', ''))

        # Metadados (JSON)
        metadados_label = QLabel("Metadados (JSON):")
        metadados_edit = QTextEdit()
        metadados_edit.setMaximumHeight(100)
        metadado = versao_data.get('metadado', {})
        metadados_edit.setText(json.dumps(metadado, indent=2) if metadado else '{}')

        # Adicionar todos os layouts ao formulário
        form_layout.addLayout(row1_layout)
        form_layout.addLayout(row2_layout)
        form_layout.addLayout(row3_layout)
        form_layout.addLayout(row4_layout)
        form_layout.addWidget(descricao_label)
        form_layout.addWidget(description_edit)
        form_layout.addWidget(metadados_label)
        form_layout.addWidget(metadados_edit)

        form_group.setLayout(form_layout)
        version_layout.addWidget(form_group)

        # Seção de arquivos
        files_group = QGroupBox("Arquivos")
        files_layout = QVBoxLayout()

        buttons_layout = QHBoxLayout()
        add_file_button = QPushButton("Adicionar Arquivo")
        add_file_button.clicked.connect(lambda: self.add_file(version_index))
        remove_file_button = QPushButton("Remover Arquivo Selecionado")
        remove_file_button.clicked.connect(lambda: self.remove_file(version_index))
        buttons_layout.addWidget(add_file_button)
        buttons_layout.addWidget(remove_file_button)

        files_layout.addLayout(buttons_layout)

        files_table = QTableWidget()
        files_table.setColumnCount(5)
        files_table.setHorizontalHeaderLabels(["Nome", "Arquivo", "Tipo", "Tamanho (MB)", "Caminho"])
        files_table.setSelectionBehavior(files_table.SelectRows)
        files_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        files_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        files_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)

        # Preencher tabela com arquivos existentes
        arquivos = versao_data.get('arquivos', [])
        files_table.setRowCount(len(arquivos))
        for row, file_info in enumerate(arquivos):
            files_table.setItem(row, 0, QTableWidgetItem(file_info.get('nome', '')))
            file_name_ext = f"{file_info.get('nome_arquivo', '')}.{file_info.get('extensao', '')}"
            files_table.setItem(row, 1, QTableWidgetItem(file_name_ext))
            tipo_arquivo = self.tipos_arquivo.get(file_info.get('tipo_arquivo_id'), "Desconhecido")
            files_table.setItem(row, 2, QTableWidgetItem(tipo_arquivo))
            files_table.setItem(row, 3, QTableWidgetItem(f"{file_info.get('tamanho_mb', 0):.2f}"))
            files_table.setItem(row, 4, QTableWidgetItem(file_info.get('path', '')))

        files_layout.addWidget(files_table)

        files_group.setLayout(files_layout)
        version_layout.addWidget(files_group)

        # Botão para remover esta versão
        remove_version_layout = QHBoxLayout()
        remove_version_layout.addStretch(1)
        remove_version_button = QPushButton("Remover esta Versão")
        remove_version_button.setStyleSheet("background-color: #CF222E; color: white;")
        remove_version_button.clicked.connect(lambda: self.remove_version(version_index))
        remove_version_button.setEnabled(len(self.versoes) > 1)
        remove_version_layout.addWidget(remove_version_button)

        version_layout.addLayout(remove_version_layout)

        # Adicionar a aba ao widget de abas
        self.versionsTabWidget.addTab(version_tab, f"Versão {version_index + 1}")

        # Armazenar referências de widgets desta versão
        self._version_widgets[version_index] = {
            'subtype_combo': subtype_combo,
            'version_type_combo': version_type_combo,
            'lot_combo': lot_combo,
            'files_table': files_table,
            'remove_button': remove_version_button,
        }

        # Conectar os campos desta versão
        version_name_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'nome', text))
        version_number_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'versao', text))
        version_type_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'tipo_versao_id', version_type_combo.itemData(version_type_combo.currentIndex())))
        subtype_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'subtipo_produto_id', subtype_combo.itemData(subtype_combo.currentIndex())))
        lot_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'lote_id', lot_combo.itemData(lot_combo.currentIndex())))
        producer_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'orgao_produtor', text))
        keywords_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'palavras_chave', [keyword.strip() for keyword in text.split(',') if keyword.strip()]))
        creation_date_edit.dateChanged.connect(lambda date: self.update_version_data(version_index, 'data_criacao', date))
        edit_date_edit.dateChanged.connect(lambda date: self.update_version_data(version_index, 'data_edicao', date))
        description_edit.textChanged.connect(lambda: self.update_version_data(version_index, 'descricao', description_edit.toPlainText()))
        metadados_edit.textChanged.connect(lambda: self._update_version_metadata(version_index, metadados_edit))

    def _populate_subtype_combo(self, combo):
        """Popular combo de subtipo filtrado pelo tipo de produto selecionado."""
        combo.clear()
        tipo_produto_id = self.get_combo_value(self.tipoProdutoComboBox)
        if not tipo_produto_id:
            return
        for item in self._subtipos_data:
            if item.get('tipo_id') == tipo_produto_id:
                combo.addItem(item['nome'], item['code'])

    def _populate_lot_combo(self, combo):
        """Popular combo de lote."""
        combo.clear()
        combo.addItem("Nenhum", None)
        for item in self._lotes_data:
            combo.addItem(f"{item['nome']} ({item['pit']})", item['id'])

    def _update_version_metadata(self, version_index, metadados_edit):
        """Atualizar metadados da versão (validando JSON)."""
        if version_index < len(self.versoes):
            text = metadados_edit.toPlainText()
            try:
                if text.strip():
                    metadata = json.loads(text)
                    self.versoes[version_index]['metadado'] = metadata
                    metadados_edit.setStyleSheet("")
                else:
                    self.versoes[version_index]['metadado'] = {}
                    metadados_edit.setStyleSheet("")
            except json.JSONDecodeError:
                metadados_edit.setStyleSheet("background-color: #FFDDDD;")
    
    def update_remove_buttons(self):
        """Atualizar estado dos botões de remoção de versão."""
        for idx, widgets in self._version_widgets.items():
            remove_button = widgets.get('remove_button')
            if remove_button:
                remove_button.setEnabled(len(self.versoes) > 1)
    
    def add_file(self, version_index):
        """Adicionar um novo arquivo à versão."""
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Selecionar Arquivo", "", "Todos os Arquivos (*.*)"
        )
        
        if not file_path:
            return
        
        # Calcular o checksum do arquivo
        checksum = self.calculate_checksum(file_path)
        
        # Obter informações do arquivo
        file_info = {
            'nome': os.path.basename(file_path).split('.')[0],
            'nome_arquivo': os.path.basename(file_path).split('.')[0],
            'extensao': os.path.splitext(file_path)[1][1:],
            'tipo_arquivo_id': 1,  # Arquivo principal por padrão
            'tamanho_mb': os.path.getsize(file_path) / (1024 * 1024),
            'path': file_path,
            'checksum': checksum,
            'metadado': {},
            'situacao_carregamento_id': 1,  # Não carregado por padrão
            'descricao': '',
            'crs_original': ''
        }
        
        # Adicionar à lista de arquivos da versão
        self.versoes[version_index]['arquivos'].append(file_info)
        
        # Atualizar a tabela de arquivos
        self.update_files_table(version_index)
    
    def remove_file(self, version_index):
        """Remover o arquivo selecionado da versão."""
        widgets = self._version_widgets.get(version_index)
        if not widgets:
            return
        files_table = widgets['files_table']
        selected_rows = files_table.selectionModel().selectedRows()
        if not selected_rows:
            QMessageBox.warning(self, "Aviso", "Selecione um arquivo para remover.")
            return

        # Remover arquivo da lista (em ordem reversa para evitar problemas com índices)
        for row in sorted([index.row() for index in selected_rows], reverse=True):
            if row < len(self.versoes[version_index]['arquivos']):
                del self.versoes[version_index]['arquivos'][row]

        # Atualizar a tabela de arquivos
        self.update_files_table(version_index)
    
    def update_files_table(self, version_index):
        """Atualizar a tabela de arquivos para a versão."""
        widgets = self._version_widgets.get(version_index)
        if not widgets:
            return
        files_table = widgets['files_table']
        files_table.setRowCount(len(self.versoes[version_index]['arquivos']))

        for row, file_info in enumerate(self.versoes[version_index]['arquivos']):
            # Nome
            files_table.setItem(row, 0, QTableWidgetItem(file_info['nome']))

            # Nome do arquivo com extensão
            file_name_ext = f"{file_info['nome_arquivo']}.{file_info['extensao']}"
            files_table.setItem(row, 1, QTableWidgetItem(file_name_ext))

            # Tipo de arquivo
            tipo_arquivo = "Desconhecido"
            if file_info['tipo_arquivo_id'] in self.tipos_arquivo:
                tipo_arquivo = self.tipos_arquivo[file_info['tipo_arquivo_id']]
            files_table.setItem(row, 2, QTableWidgetItem(tipo_arquivo))

            # Tamanho
            tamanho = f"{file_info['tamanho_mb']:.2f}"
            files_table.setItem(row, 3, QTableWidgetItem(tamanho))

            # Caminho
            files_table.setItem(row, 4, QTableWidgetItem(file_info['path']))
    
    def calculate_checksum(self, file_path):
        """Calcular o checksum SHA-256 de um arquivo."""
        sha256_hash = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            return sha256_hash.hexdigest()
        except Exception as e:
            QMessageBox.warning(self, "Erro", f"Não foi possível calcular o checksum: {str(e)}")
            return ""
    
    def load_domain_data(self):
        """Carregar dados de domínio do servidor."""
        try:
            # Carregar escalas
            response = self.api_client.get('gerencia/dominio/tipo_escala')
            if response and 'dados' in response:
                self.tipoEscalaComboBox.clear()
                self.escalas = {item['code']: item['nome'] for item in response['dados']}
                for item in response['dados']:
                    self.tipoEscalaComboBox.addItem(item['nome'], item['code'])
            
            # Carregar tipos de produto
            response = self.api_client.get('gerencia/dominio/tipo_produto')
            if response and 'dados' in response:
                self.tipoProdutoComboBox.clear()
                self.tipos_produto = {item['code']: item['nome'] for item in response['dados']}
                for item in response['dados']:
                    self.tipoProdutoComboBox.addItem(item['nome'], item['code'])
            
            # Carregar tipos de versão
            response = self.api_client.get('gerencia/dominio/tipo_versao')
            if response and 'dados' in response:
                self.tipos_versao = {item['code']: item['nome'] for item in response['dados']}
                # Popular combo de tipo de versão em todas as abas existentes
                for idx, widgets in self._version_widgets.items():
                    combo = widgets['version_type_combo']
                    combo.clear()
                    for item in response['dados']:
                        combo.addItem(item['nome'], item['code'])

            # Carregar subtipos de produto
            response = self.api_client.get('gerencia/dominio/subtipo_produto')
            if response and 'dados' in response:
                self._subtipos_data = response['dados']
                self.subtipos_produto = {item['code']: item['nome'] for item in response['dados']}
                # Filtrar subtipos com base no tipo de produto selecionado
                self.filterSubtypes()

            # Carregar lotes
            response = self.api_client.get('projetos/lote')
            if response and 'dados' in response:
                self._lotes_data = response['dados']
                # Popular combo de lote em todas as abas existentes
                for idx, widgets in self._version_widgets.items():
                    self._populate_lot_combo(widgets['lot_combo'])
            
            # Carregar tipos de arquivo
            response = self.api_client.get('gerencia/dominio/tipo_arquivo')
            if response and 'dados' in response:
                self.tipos_arquivo = {item['code']: item['nome'] for item in response['dados']}
            
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Falha ao carregar dados: {str(e)}")
    
    def filterSubtypes(self):
        """Filtrar subtipos de produto com base no tipo de produto selecionado."""
        tipo_produto_id = self.get_combo_value(self.tipoProdutoComboBox)
        if not tipo_produto_id:
            return

        # Atualizar combo de subtipo em TODAS as abas de versão
        for idx, widgets in self._version_widgets.items():
            self._populate_subtype_combo(widgets['subtype_combo'])
    
    def connectSignals(self):
        """Conectar sinais aos slots."""
        # Tipo de escala afeta o denominador
        self.tipoEscalaComboBox.currentIndexChanged.connect(self.toggle_denominador_field)
        
        # Tipo de produto afeta os subtipos disponíveis
        self.tipoProdutoComboBox.currentIndexChanged.connect(self.filterSubtypes)
    
    def toggle_denominador_field(self):
        """Ativar/desativar campo de denominador baseado na escala selecionada."""
        escala_id = self.get_combo_value(self.tipoEscalaComboBox)
        is_custom_scale = escala_id == 5  # Escala personalizada (valor 5) requer denominador
        
        self.denominadorLabel.setVisible(is_custom_scale)
        self.denominadorSpinBox.setVisible(is_custom_scale)
        self.denominadorSpinBox.setEnabled(is_custom_scale)
        
        if not is_custom_scale:
            self.denominadorSpinBox.setValue(0)
    
    def get_combo_value(self, combo):
        """Obter o valor atual de um combobox."""
        return combo.itemData(combo.currentIndex())
    
    def start_map_selection(self):
        """Iniciar a seleção de geometria no mapa."""
        self.iface.mapCanvas().setMapTool(PolygonMapTool(self.iface, self))
        self.iface.messageBar().pushMessage(
            "Informação", 
            "Clique no mapa para adicionar pontos ao polígono. Clique com o botão direito para finalizar.",
            level=Qgis.Info
        )
    
    def set_geometry(self, geometry):
        """Definir a geometria do produto."""
        self.current_geometry = geometry
        self.geometryLabel.setText(f"Geometria definida: Polígono com {geometry.vertexCount()} vértices")
        self.geometryLabel.setStyleSheet("color: green;")
    
    def clear_geometry(self):
        """Limpar a geometria selecionada."""
        self.current_geometry = None
        self.geometryLabel.setText("Nenhuma geometria definida")
        self.geometryLabel.setStyleSheet("")
    
    def validate_data(self):
        """Validar os dados do formulário."""
        # Validar nome do produto
        if not self.nomeLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O nome do produto é obrigatório.")
            return False
        
        # Validar INOM ou MI
        if not self.inomLineEdit.text().strip() and not self.miLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "INOM ou MI é obrigatório.")
            return False
        
        # Validar tipo de escala
        if self.tipoEscalaComboBox.currentIndex() == -1:
            QMessageBox.warning(self, "Validação", "Selecione um tipo de escala.")
            return False
        
        # Validar denominador para escala personalizada
        escala_id = self.get_combo_value(self.tipoEscalaComboBox)
        if escala_id == 5 and self.denominadorSpinBox.value() <= 0:
            QMessageBox.warning(self, "Validação", "Para escala personalizada, o denominador é obrigatório.")
            return False
        
        # Validar tipo de produto
        if self.tipoProdutoComboBox.currentIndex() == -1:
            QMessageBox.warning(self, "Validação", "Selecione um tipo de produto.")
            return False
        
        # Validar geometria
        if not self.current_geometry:
            QMessageBox.warning(self, "Validação", "É necessário definir uma geometria para o produto.")
            return False
        
        # Validar versões
        for i, versao in enumerate(self.versoes):
            # Selecionar a aba da versão que está sendo validada
            self.versionsTabWidget.setCurrentIndex(i)
            
            # Validar número da versão
            if not versao['versao'].strip():
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: O número da versão é obrigatório.")
                return False
            
            # Validar tipo de versão
            if not versao['tipo_versao_id']:
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: Selecione um tipo de versão.")
                return False
            
            # Validar subtipo de produto
            if not versao['subtipo_produto_id']:
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: Selecione um subtipo de produto.")
                return False
            
            # Validar órgão produtor
            if not versao['orgao_produtor'].strip():
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: O órgão produtor é obrigatório.")
                return False
            
            # Validar arquivos (pelo menos um arquivo obrigatório)
            if not versao['arquivos']:
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: Pelo menos um arquivo é obrigatório.")
                return False
        
        return True
    
    def save_product(self):
        """Salvar o produto com suas versões e arquivos."""
        # Validar dados
        if not self.validate_data():
            return
        
        # Preparar dados do produto
        produto_data = {
            'nome': self.nomeLineEdit.text(),
            'mi': self.miLineEdit.text(),
            'inom': self.inomLineEdit.text(),
            'tipo_escala_id': self.get_combo_value(self.tipoEscalaComboBox),
            'denominador_escala_especial': self.denominadorSpinBox.value() if self.get_combo_value(self.tipoEscalaComboBox) == 5 else None,
            'tipo_produto_id': self.get_combo_value(self.tipoProdutoComboBox),
            'descricao': self.descricaoTextEdit.toPlainText(),
            'geom': f"SRID=4674;{self.current_geometry.asWkt()}"
        }

        # Preparar dados para upload
        upload_data = {
            'produtos': [{
                'produto': produto_data,
                'versoes': []
            }]
        }
        
        # Adicionar cada versão aos dados de upload
        for versao in self.versoes:
            versao_data = {
                'uuid_versao': versao['uuid_versao'],
                'versao': versao['versao'],
                'nome': versao['nome'],
                'tipo_versao_id': versao['tipo_versao_id'],
                'subtipo_produto_id': versao['subtipo_produto_id'],
                'lote_id': versao['lote_id'],
                'metadado': versao['metadado'],
                'descricao': versao['descricao'],
                'orgao_produtor': versao['orgao_produtor'],
                'palavras_chave': versao['palavras_chave'],
                'data_criacao': versao['data_criacao'].toString(Qt.ISODate),
                'data_edicao': versao['data_edicao'].toString(Qt.ISODate),
                'arquivos': []
            }
            
            # Adicionar cada arquivo à versão
            for arquivo in versao['arquivos']:
                arquivo_uuid = str(uuid.uuid4())
                arquivo['_uuid_arquivo'] = arquivo_uuid
                arquivo_data = {
                    'uuid_arquivo': arquivo_uuid,
                    'nome': arquivo['nome'],
                    'nome_arquivo': arquivo['nome_arquivo'],
                    'tipo_arquivo_id': arquivo['tipo_arquivo_id'],
                    'extensao': arquivo['extensao'],
                    'tamanho_mb': arquivo['tamanho_mb'],
                    'checksum': arquivo['checksum'],
                    'metadado': arquivo['metadado'],
                    'situacao_carregamento_id': arquivo['situacao_carregamento_id'],
                    'descricao': arquivo['descricao'],
                    'crs_original': arquivo['crs_original']
                }
                versao_data['arquivos'].append(arquivo_data)
            
            upload_data['produtos'][0]['versoes'].append(versao_data)
        
        # Iniciar o processo de upload
        self.start_upload_process(upload_data)
    
    def start_upload_process(self, upload_data):
        """Iniciar o processo de upload em duas fases."""
        try:
            # Fase 1: Preparação
            self.statusLabel.setText("Preparando upload...")
            self.progressBar.setVisible(True)
            self.progressBar.setValue(0)
            
            # Desabilitar botões durante o upload
            self.saveButton.setEnabled(False)
            self.cancelButton.setEnabled(False)
            
            # Enviar solicitação de preparação
            response = self.api_client.post('arquivo/prepare-upload/product', upload_data)
            
            if response and 'dados' in response:
                # Extrair dados de resposta
                session_uuid = response['dados']['session_uuid']
                produtos = response['dados']['produtos']
                
                # Estruturar arquivos para upload
                arquivos_para_upload = []
                
                # Construir mapa uuid_arquivo -> arquivo local para match preciso
                uuid_to_local = {}
                for v in self.versoes:
                    for a in v['arquivos']:
                        if '_uuid_arquivo' in a:
                            uuid_to_local[a['_uuid_arquivo']] = a

                for produto in produtos:
                    for versao in produto['versoes']:
                        for arquivo in versao['arquivos']:
                            # Encontrar o arquivo local por uuid_arquivo
                            arquivo_local = uuid_to_local.get(arquivo.get('uuid_arquivo'))

                            if arquivo_local:
                                arquivos_para_upload.append({
                                    'nome': arquivo['nome'],
                                    'source_path': arquivo_local['path'],
                                    'destination_path': arquivo['destination_path'],
                                    'checksum': arquivo['checksum']
                                })
                
                # Configurar barra de progresso
                total_arquivos = len(arquivos_para_upload)
                self.progressBar.setMaximum(total_arquivos)
                
                # Fase 2: Transferência sequencial
                self.statusLabel.setText(f"Iniciando transferência de {total_arquivos} arquivos...")

                # Configurar estado para upload sequencial
                self._upload_queue = list(arquivos_para_upload)
                self.arquivos_transferidos = 0
                self.arquivos_com_falha = 0
                self.failed_transfers = []
                self.current_session_uuid = session_uuid

                # Iniciar o primeiro upload
                self._upload_next_file()
            else:
                raise Exception("Resposta inválida do servidor")
                
        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            self.progressBar.setVisible(False)
            self.saveButton.setEnabled(True)
            self.cancelButton.setEnabled(True)
            QMessageBox.critical(self, "Erro", f"Falha na preparação do upload: {str(e)}")
    
    def _upload_next_file(self):
        """Inicia o upload do proximo arquivo na fila (sequencial)."""
        if not self._upload_queue:
            # Todos os arquivos processados
            total = self.arquivos_transferidos
            if self.arquivos_com_falha > 0:
                reply = QMessageBox.question(
                    self, "Falha na Transferência",
                    f"{self.arquivos_com_falha} arquivo(s) falharam na transferência.\n"
                    "Deseja tentar novamente apenas os arquivos que falharam?",
                    QMessageBox.Yes | QMessageBox.No
                )
                if reply == QMessageBox.Yes:
                    self._retry_failed_transfers()
                else:
                    self.statusLabel.setText(f"Erro: {self.arquivos_com_falha} arquivo(s) falharam")
                    self.saveButton.setEnabled(True)
                    self.cancelButton.setEnabled(True)
            else:
                self.confirm_upload()
            return

        arquivo = self._upload_queue[0]
        self.statusLabel.setText(f"Transferindo: {arquivo['nome']} ({self.arquivos_transferidos + 1}/{self.progressBar.maximum()})...")

        thread = FileTransferThread(
            arquivo['source_path'],
            arquivo['destination_path'],
            arquivo['checksum']
        )
        thread.progress_update.connect(self.update_file_progress)
        thread.file_transferred.connect(self._handle_upload_file_complete)
        self._current_upload_thread = thread
        thread.start()

    def update_file_progress(self, current_bytes, total_bytes):
        """Atualizar o progresso de transferência de um arquivo."""
        if total_bytes > 0 and self._upload_queue:
            nome = self._upload_queue[0].get('nome', '')
            current_mb = current_bytes / (1024 * 1024)
            total_mb = total_bytes / (1024 * 1024)
            idx = self.arquivos_transferidos + 1
            total_files = self.progressBar.maximum()
            self.statusLabel.setText(
                f"Transferindo: {nome} ({idx}/{total_files}) - {current_mb:.1f} / {total_mb:.1f} MB"
            )

    def _handle_upload_file_complete(self, success, file_path, identifier):
        """Manipular conclusão da transferência de um arquivo (sequencial)."""
        # Remover da fila
        if self._upload_queue:
            arquivo_info = self._upload_queue.pop(0)
        else:
            return

        self.arquivos_transferidos += 1
        if not success:
            self.arquivos_com_falha += 1
            self.failed_transfers.append({
                'source_path': arquivo_info['source_path'],
                'destination_path': arquivo_info['destination_path'],
                'identifier': identifier
            })
        self.progressBar.setValue(self.arquivos_transferidos)

        # Continuar com o proximo arquivo
        self._upload_next_file()

    def _retry_failed_transfers(self):
        """Retenta apenas os arquivos que falharam na transferência."""
        failed = self.failed_transfers[:]
        self.failed_transfers = []
        self.arquivos_transferidos = 0
        self.arquivos_com_falha = 0

        self.progressBar.setMaximum(len(failed))
        self.progressBar.setValue(0)
        self.statusLabel.setText(f"Retentando {len(failed)} arquivo(s)...")

        # Reusar a fila sequencial
        self._upload_queue = [
            {
                'nome': os.path.basename(info['source_path']),
                'source_path': info['source_path'],
                'destination_path': info['destination_path'],
                'checksum': info['identifier']
            }
            for info in failed
        ]
        self._upload_next_file()
    
    def confirm_upload(self):
        """Confirmar o upload após transferência dos arquivos."""
        try:
            self.statusLabel.setText("Confirmando upload...")
            
            # Enviar confirmação
            response = self.api_client.post('arquivo/confirm-upload', {'session_uuid': self.current_session_uuid})
            
            if response and response.get('success'):
                self.statusLabel.setText("Upload concluído com sucesso!")
                QMessageBox.information(self, "Sucesso", "Produto e arquivos carregados com sucesso!")
                self.accept()
            else:
                error_message = "Falha na confirmação do upload"
                if response and 'message' in response:
                    error_message = response['message']
                raise Exception(error_message)
                
        except Exception as e:
            self.statusLabel.setText(f"Erro na confirmação: {str(e)}")
            self.saveButton.setEnabled(True)
            self.cancelButton.setEnabled(True)
            QMessageBox.critical(self, "Erro", f"Falha na confirmação do upload: {str(e)}")

class PolygonMapTool(QgsMapToolEmitPoint):
    """Ferramenta de mapa para desenhar polígonos."""
    def __init__(self, iface, parent):
        self.iface = iface
        self.canvas = iface.mapCanvas()
        self.parent = parent
        QgsMapToolEmitPoint.__init__(self, self.canvas)
        self.points = []
        
        # Configurar rubber band para visualização
        self.rubber_band = QgsRubberBand(self.canvas, QgsWkbTypes.PolygonGeometry)
        self.rubber_band.setColor(QColor(255, 0, 0, 100))
        self.rubber_band.setWidth(2)
    
    def canvasReleaseEvent(self, event):
        if event.button() == Qt.LeftButton:
            # Adicionar ponto
            point = self.toMapCoordinates(event.pos())
            self.points.append(point)
            
            # Atualizar rubber band
            self.rubber_band.reset(QgsWkbTypes.PolygonGeometry)
            points = [QgsPointXY(p) for p in self.points]
            if len(points) > 1:
                self.rubber_band.setToGeometry(QgsGeometry.fromPolygonXY([points]), None)
                
        elif event.button() == Qt.RightButton and len(self.points) >= 3:
            # Finalizar polígono
            points = [QgsPointXY(p) for p in self.points]
            geometry = QgsGeometry.fromPolygonXY([points])
            
            # Definir a geometria no formulário
            self.parent.set_geometry(geometry)
            
            # Limpar e resetar
            self.points = []
            self.rubber_band.reset()
            self.canvas.unsetMapTool(self)
            self.canvas.setMapTool(self.iface.actionPan())
    
    def reset(self):
        self.points = []
        self.rubber_band.reset()