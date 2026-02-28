# Path: gui\informacao_produto\add_historical_version_dialog.py
import os
import json
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox
from qgis.PyQt.QtCore import Qt, QDate

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'add_historical_version_dialog.ui'))

class AddHistoricalVersionDialog(QDialog, FORM_CLASS):
    def __init__(self, api_client, produto_data, parent=None):
        """
        Inicializa o diálogo para adicionar uma versão histórica a um produto existente.
        
        Args:
            api_client: Cliente da API
            produto_data (dict): Dados do produto
            parent: Widget pai
        """
        super(AddHistoricalVersionDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.produto_data = produto_data
        
        self.setup_ui()
        self.load_domain_data()
        
    def setup_ui(self):
        """Configura a interface de usuário."""
        self.setWindowTitle(f"Adicionar Versão Histórica ao Produto: {self.produto_data['nome']}")
        self.resize(700, 600)
        
        # Configurar datas
        self.dataCriacaoDateEdit.setDate(QDate.currentDate())
        self.dataEdicaoDateEdit.setDate(QDate.currentDate())
        self.dataCriacaoDateEdit.setCalendarPopup(True)
        self.dataEdicaoDateEdit.setCalendarPopup(True)
        
        # Configurar valor padrão para órgão produtor
        self.orgaoProdutorLineEdit.setText("DSG")
        
        # Conectar botões
        self.saveButton.clicked.connect(self.save_historical_version)
        self.cancelButton.clicked.connect(self.reject)
        
    def load_domain_data(self):
        """Carrega dados de domínio dos combos da interface."""
        try:
            # Carregar subtipos de produto
            response = self.api_client.get('gerencia/dominio/subtipo_produto')
            if response and 'dados' in response:
                subtipos = [item for item in response['dados'] if item['tipo_id'] == self.produto_data['tipo_produto_id']]
                self.subtipoProdutoComboBox.clear()
                for subtipo in subtipos:
                    self.subtipoProdutoComboBox.addItem(subtipo['nome'], subtipo['code'])
            
            # Carregar lotes
            response = self.api_client.get('projetos/lote')
            if response and 'dados' in response:
                self.loteComboBox.clear()
                self.loteComboBox.addItem("Nenhum", None)
                for lote in response['dados']:
                    self.loteComboBox.addItem(f"{lote['nome']} ({lote['pit']})", lote['id'])
                    
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar dados de domínio: {str(e)}")
    
    def validate_form(self):
        """Valida o formulário antes de salvar."""
        if not self.nomeVersaoLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O nome da versão é obrigatório.")
            return False
            
        if not self.versaoLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O número da versão é obrigatório.")
            return False
            
        if self.subtipoProdutoComboBox.currentIndex() < 0:
            QMessageBox.warning(self, "Validação", "Selecione um subtipo de produto.")
            return False
            
        if not self.orgaoProdutorLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O órgão produtor é obrigatório.")
            return False
            
        # Validar metadados JSON
        metadado_text = self.metadadoTextEdit.toPlainText().strip()
        if metadado_text:
            try:
                json.loads(metadado_text)
            except json.JSONDecodeError:
                QMessageBox.warning(self, "Validação", "O campo de metadados deve conter um JSON válido.")
                return False
        
        return True
    
    def save_historical_version(self):
        """Salva a versão histórica."""
        if not self.validate_form():
            return
        
        try:
            # Preparar dados da versão
            palavras_chave = []
            if self.palavrasChaveLineEdit.text().strip():
                palavras_chave = [p.strip() for p in self.palavrasChaveLineEdit.text().split(',')]
                
            metadado = {}
            if self.metadadoTextEdit.toPlainText().strip():
                metadado = json.loads(self.metadadoTextEdit.toPlainText())
                
            versao_data = {
                "uuid_versao": None,
                "versao": self.versaoLineEdit.text(),
                "nome": self.nomeVersaoLineEdit.text(),
                "produto_id": self.produto_data['id'],
                "subtipo_produto_id": self.subtipoProdutoComboBox.currentData(),
                "lote_id": self.loteComboBox.currentData(),
                "metadado": metadado,
                "descricao": self.descricaoTextEdit.toPlainText(),
                "orgao_produtor": self.orgaoProdutorLineEdit.text(),
                "palavras_chave": palavras_chave,
                "data_criacao": self.dataCriacaoDateEdit.date().toString(Qt.ISODate),
                "data_edicao": self.dataEdicaoDateEdit.date().toString(Qt.ISODate)
            }

            # Enviar requisição para adicionar versão histórica ao produto existente
            response = self.api_client.post('produtos/versao_historica', [versao_data])
            
            if response and response.get('success'):
                QMessageBox.information(self, "Sucesso", "Versão histórica adicionada com sucesso!")
                self.accept()
            else:
                error_message = "Falha ao adicionar versão histórica"
                if response and 'message' in response:
                    error_message = response['message']
                raise Exception(error_message)
                
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Falha ao adicionar versão histórica: {str(e)}")