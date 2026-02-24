# Path: gui\adicionar_produto_historico\adicionar_produto_historico_dialog.py
import os
import json
import uuid
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (
    QDialog, QMessageBox, QVBoxLayout, QHBoxLayout, QLabel, 
    QLineEdit, QComboBox, QTextEdit, QDateEdit, QPushButton, 
    QGroupBox, QWidget, QTableWidget, QTableWidgetItem,
    QHeaderView, QSpinBox, QTabWidget
)
from qgis.PyQt.QtCore import Qt, QDate, pyqtSignal
from qgis.core import QgsGeometry, QgsFeature, QgsProject, QgsVectorLayer, Qgis, QgsWkbTypes
from qgis.gui import QgsMapToolEmitPoint, QgsRubberBand
from qgis.PyQt.QtGui import QColor

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'add_historical_product_dialog.ui'))

class AddHistoricalProductDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(AddHistoricalProductDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        
        # Lista para controlar as versões históricas
        self.versoes = []
        self.current_geometry = None
        
        # Dicionários para armazenar dados de domínio
        self.escalas = {}
        self.tipos_produto = {}
        self.tipos_versao = {}
        self.subtipos_produto = {}
        
        # Inicializar a interface
        self.setup_ui()
        
        # Carregar dados de domínio
        self.load_domain_data()
        
        # Conectar sinais
        self.connectSignals()
    
    def setup_ui(self):
        """Configurar a interface de usuário."""
        self.setWindowTitle("Adicionar Produto com Versão Histórica")
        self.resize(900, 700)
        
        # Configurar a área de informações do produto
        self.setupProductInfoUI()
        
        # Configurar a área de versões
        self.setupVersionsUI()
        
        # Botões principais
        self.saveButton.clicked.connect(self.save_product)
        self.cancelButton.clicked.connect(self.reject)
    
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
        """Adicionar uma nova aba de versão histórica."""
        # Criar dados da versão
        versao_data = {
            'uuid_versao': str(uuid.uuid4()),
            'nome': '',
            'versao': '',
            'subtipo_produto_id': None,
            'lote_id': None,
            'metadado': {},
            'descricao': '',
            'orgao_produtor': '',
            'palavras_chave': [],
            'data_criacao': QDate.currentDate(),
            'data_edicao': QDate.currentDate(),
        }
        
        # Adicionar à lista de versões
        self.versoes.append(versao_data)
        version_index = len(self.versoes) - 1
        
        # Criar a aba de versão
        version_tab = QWidget()
        version_layout = QVBoxLayout(version_tab)
        
        # Criar formulário para a versão
        form_group = QGroupBox("Informações da Versão Histórica")
        form_layout = QVBoxLayout()
        
        # Layout para campos em linha
        row1_layout = QHBoxLayout()
        row2_layout = QHBoxLayout()
        row3_layout = QHBoxLayout()
        row4_layout = QHBoxLayout()
        
        # Nome
        nome_layout = QVBoxLayout()
        nome_label = QLabel("Nome da Versão:")
        self.version_name_edit = QLineEdit()
        nome_layout.addWidget(nome_label)
        nome_layout.addWidget(self.version_name_edit)
        row1_layout.addLayout(nome_layout)
        
        # Número da versão
        versao_layout = QVBoxLayout()
        versao_label = QLabel("Número da Versão:")
        self.version_number_edit = QLineEdit()
        self.version_number_edit.setPlaceholderText("Ex: 1-DSGEO ou 2ª Edição")
        versao_layout.addWidget(versao_label)
        versao_layout.addWidget(self.version_number_edit)
        row1_layout.addLayout(versao_layout)
        
        # Subtipo de produto
        subtipo_layout = QVBoxLayout()
        subtipo_label = QLabel("Subtipo de Produto:")
        self.subtype_combo = QComboBox()
        subtipo_layout.addWidget(subtipo_label)
        subtipo_layout.addWidget(self.subtype_combo)
        row2_layout.addLayout(subtipo_layout)
        
        # Lote
        lote_layout = QVBoxLayout()
        lote_label = QLabel("Lote (opcional):")
        self.lot_combo = QComboBox()
        self.lot_combo.setEditable(False)
        lote_layout.addWidget(lote_label)
        lote_layout.addWidget(self.lot_combo)
        row2_layout.addLayout(lote_layout)
        
        # Órgão produtor
        orgao_layout = QVBoxLayout()
        orgao_label = QLabel("Órgão Produtor:")
        self.producer_edit = QLineEdit()
        self.producer_edit.setText("DSG")
        orgao_layout.addWidget(orgao_label)
        orgao_layout.addWidget(self.producer_edit)
        row3_layout.addLayout(orgao_layout)
        
        # Palavras-chave
        keywords_layout = QVBoxLayout()
        keywords_label = QLabel("Palavras-chave (separadas por vírgula):")
        self.keywords_edit = QLineEdit()
        keywords_layout.addWidget(keywords_label)
        keywords_layout.addWidget(self.keywords_edit)
        row3_layout.addLayout(keywords_layout)
        
        # Datas
        dates_layout = QHBoxLayout()
        
        creation_date_layout = QVBoxLayout()
        creation_date_label = QLabel("Data de Criação:")
        self.creation_date_edit = QDateEdit()
        self.creation_date_edit.setCalendarPopup(True)
        self.creation_date_edit.setDate(QDate.currentDate())
        creation_date_layout.addWidget(creation_date_label)
        creation_date_layout.addWidget(self.creation_date_edit)
        dates_layout.addLayout(creation_date_layout)
        
        edit_date_layout = QVBoxLayout()
        edit_date_label = QLabel("Data de Edição:")
        self.edit_date_edit = QDateEdit()
        self.edit_date_edit.setCalendarPopup(True)
        self.edit_date_edit.setDate(QDate.currentDate())
        edit_date_layout.addWidget(edit_date_label)
        edit_date_layout.addWidget(self.edit_date_edit)
        dates_layout.addLayout(edit_date_layout)
        
        row4_layout.addLayout(dates_layout)
        
        # Descrição
        descricao_label = QLabel("Descrição:")
        self.description_edit = QTextEdit()
        self.description_edit.setMaximumHeight(100)
        
        # Metadados (JSON)
        metadados_label = QLabel("Metadados (JSON):")
        self.metadados_edit = QTextEdit()
        self.metadados_edit.setMaximumHeight(100)
        self.metadados_edit.setText("{}")
        
        # Adicionar todos os layouts ao formulário
        form_layout.addLayout(row1_layout)
        form_layout.addLayout(row2_layout)
        form_layout.addLayout(row3_layout)
        form_layout.addLayout(row4_layout)
        form_layout.addWidget(descricao_label)
        form_layout.addWidget(self.description_edit)
        form_layout.addWidget(metadados_label)
        form_layout.addWidget(self.metadados_edit)
        
        form_group.setLayout(form_layout)
        version_layout.addWidget(form_group)
        
        # Botão para remover esta versão
        remove_version_layout = QHBoxLayout()
        remove_version_layout.addStretch(1)
        self.remove_version_button = QPushButton("Remover esta Versão")
        self.remove_version_button.setStyleSheet("background-color: #CF222E; color: white;")
        self.remove_version_button.clicked.connect(lambda: self.remove_version(version_index))
        self.remove_version_button.setEnabled(len(self.versoes) > 1)  # Desabilitar se for a única versão
        remove_version_layout.addWidget(self.remove_version_button)
        
        version_layout.addLayout(remove_version_layout)
        
        # Adicionar a aba ao widget de abas
        self.versionsTabWidget.addTab(version_tab, f"Versão {len(self.versoes)}")
        self.versionsTabWidget.setCurrentIndex(version_index)
        
        # Conectar os campos desta versão
        self.version_name_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'nome', text))
        self.version_number_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'versao', text))
        self.subtype_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'subtipo_produto_id', self.get_combo_value(self.subtype_combo)))
        self.lot_combo.currentIndexChanged.connect(lambda idx: self.update_version_data(version_index, 'lote_id', self.get_combo_value(self.lot_combo)))
        self.producer_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'orgao_produtor', text))
        self.keywords_edit.textChanged.connect(lambda text: self.update_version_data(version_index, 'palavras_chave', [keyword.strip() for keyword in text.split(',') if keyword.strip()]))
        self.creation_date_edit.dateChanged.connect(lambda date: self.update_version_data(version_index, 'data_criacao', date))
        self.edit_date_edit.dateChanged.connect(lambda date: self.update_version_data(version_index, 'data_edicao', date))
        self.description_edit.textChanged.connect(lambda: self.update_version_data(version_index, 'descricao', self.description_edit.toPlainText()))
        self.metadados_edit.textChanged.connect(lambda: self.update_version_metadata(version_index, self.metadados_edit.toPlainText()))
    
    def update_version_data(self, version_index, field, value):
        """Atualizar dados da versão."""
        if version_index < len(self.versoes):
            self.versoes[version_index][field] = value
    
    def update_version_metadata(self, version_index, text):
        """Atualizar metadados da versão (validando JSON)."""
        if version_index < len(self.versoes):
            try:
                if text.strip():
                    metadata = json.loads(text)
                    self.versoes[version_index]['metadado'] = metadata
                    self.metadados_edit.setStyleSheet("")
                else:
                    self.versoes[version_index]['metadado'] = {}
                    self.metadados_edit.setStyleSheet("")
            except json.JSONDecodeError:
                # Marcar o campo como inválido, mas não atualizar os dados
                self.metadados_edit.setStyleSheet("background-color: #FFDDDD;")
    
    def remove_version(self, version_index):
        """Remover uma versão."""
        if len(self.versoes) <= 1:
            QMessageBox.warning(self, "Aviso", "Pelo menos uma versão histórica é necessária.")
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
            
            # Recriar as abas para cada versão
            for i in range(len(self.versoes)):
                # Atualizar UI com os valores existentes
                self.add_version_tab(i)
                
            # Atualizar estado dos botões de remoção
            self.update_remove_buttons()
    
    def add_version_tab(self, version_index):
        """Adicionar uma aba de versão com dados existentes."""
        # A implementar se necessário para recriar abas após a remoção
        pass
    
    def update_remove_buttons(self):
        """Atualizar estado dos botões de remoção de versão."""
        for i in range(self.versionsTabWidget.count()):
            tab = self.versionsTabWidget.widget(i)
            remove_button = tab.findChild(QPushButton, 'remove_version_button')
            if remove_button:
                remove_button.setEnabled(len(self.versoes) > 1)
    
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
            
            # Carregar subtipos de produto
            response = self.api_client.get('gerencia/dominio/subtipo_produto')
            if response and 'dados' in response:
                self.subtipos_produto = {item['code']: item['nome'] for item in response['dados']}
                # Filtrar subtipos com base no tipo de produto selecionado
                self.filterSubtypes()
            
            # Carregar lotes
            response = self.api_client.get('projetos/lote')
            if response and 'dados' in response:
                self.lot_combo.clear()
                self.lot_combo.addItem("Nenhum", None)
                for item in response['dados']:
                    self.lot_combo.addItem(f"{item['nome']} ({item['pit']})", item['id'])
            
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Falha ao carregar dados: {str(e)}")
    
    def filterSubtypes(self):
        """Filtrar subtipos de produto com base no tipo de produto selecionado."""
        tipo_produto_id = self.get_combo_value(self.tipoProdutoComboBox)
        if not tipo_produto_id:
            return
        
        try:
            response = self.api_client.get('gerencia/dominio/subtipo_produto')
            if response and 'dados' in response:
                self.subtype_combo.clear()
                filtered_subtypes = [item for item in response['dados'] if item['tipo_id'] == tipo_produto_id]
                for item in filtered_subtypes:
                    self.subtype_combo.addItem(item['nome'], item['code'])
        except Exception as e:
            QMessageBox.warning(self, "Aviso", f"Erro ao filtrar subtipos: {str(e)}")
    
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
            
            # Validar subtipo de produto
            if not versao['subtipo_produto_id']:
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: Selecione um subtipo de produto.")
                return False
            
            # Validar órgão produtor
            if not versao['orgao_produtor'].strip():
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: O órgão produtor é obrigatório.")
                return False
            
            # Validar metadados JSON
            try:
                if isinstance(versao['metadado'], str) and versao['metadado'].strip():
                    json.loads(versao['metadado'])
            except json.JSONDecodeError:
                QMessageBox.warning(self, "Validação", f"Versão {i+1}: O campo de metadados deve conter um JSON válido.")
                return False
        
        return True
    
    def save_product(self):
        """Salvar o produto com suas versões históricas."""
        # Validar dados
        if not self.validate_data():
            return
        
        try:
            # Preparar dados do produto
            produto_data = {
                'nome': self.nomeLineEdit.text(),
                'mi': self.miLineEdit.text(),
                'inom': self.inomLineEdit.text(),
                'tipo_escala_id': self.get_combo_value(self.tipoEscalaComboBox),
                'denominador_escala_especial': self.denominadorSpinBox.value() if self.get_combo_value(self.tipoEscalaComboBox) == 5 else None,
                'tipo_produto_id': self.get_combo_value(self.tipoProdutoComboBox),
                'descricao': self.descricaoTextEdit.toPlainText(),
                'geom': self.current_geometry.asJson()
            }
            
            # Preparar versões
            versoes_data = []
            for versao in self.versoes:
                versao_data = {
                    'uuid_versao': versao['uuid_versao'],
                    'versao': versao['versao'],
                    'nome': versao['nome'],
                    'subtipo_produto_id': versao['subtipo_produto_id'],
                    'lote_id': versao['lote_id'],
                    'metadado': versao['metadado'],
                    'descricao': versao['descricao'],
                    'orgao_produtor': versao['orgao_produtor'],
                    'palavras_chave': versao['palavras_chave'],
                    'data_criacao': versao['data_criacao'].toString(Qt.ISODate),
                    'data_edicao': versao['data_edicao'].toString(Qt.ISODate)
                }
                versoes_data.append(versao_data)
            
            # Combinar dados de produto e versões
            produto_versoes_data = {
                **produto_data,
                'versoes': versoes_data
            }
            
            # Enviar para o servidor
            self.statusLabel.setText("Enviando dados...")
            
            response = self.api_client.post('produtos/produto_versao_historica', [produto_versoes_data])
            
            if response and 'sucesso' in response and response['sucesso']:
                QMessageBox.information(self, "Sucesso", "Produto com versões históricas criado com sucesso!")
                self.accept()
            else:
                error_message = "Erro desconhecido"
                if 'mensagem' in response:
                    error_message = response['mensagem']
                raise Exception(error_message)
                
        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            QMessageBox.critical(self, "Erro", f"Falha ao criar produto: {str(e)}")

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
            points = [point for point in self.points]
            if len(points) > 1:
                self.rubber_band.setToGeometry(QgsGeometry.fromPolygonXY([points]), None)
                
        elif event.button() == Qt.RightButton and len(self.points) >= 3:
            # Finalizar polígono
            points = [point for point in self.points]
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