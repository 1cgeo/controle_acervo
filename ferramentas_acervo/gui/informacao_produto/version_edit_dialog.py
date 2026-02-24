# Path: gui\informacao_produto\version_edit_dialog.py
import os
import json
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QComboBox
from qgis.PyQt.QtCore import Qt, QDate, QDateTime

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'version_edit_dialog.ui'))

class VersionEditDialog(QDialog, FORM_CLASS):
    """
    Diálogo para edição de informações de uma versão.
    """
    def __init__(self, api_client, versao_data, parent=None):
        """
        Inicializa o diálogo de edição de versão.
        
        Args:
            api_client: Cliente da API para realizar requisições
            versao_data (dict): Dados atuais da versão
            parent: Widget pai
        """
        super(VersionEditDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.versao_data = versao_data
        
        # Carregar valores em comboboxes
        self.load_combos()
        
        # Preencher campos com dados atuais
        self.populate_fields()
        
        # Conectar sinais
        self.buttonBox.accepted.connect(self.save_version)
        self.buttonBox.rejected.connect(self.reject)
        
    def load_combos(self):
        """Carrega os dados nas caixas de combinação (combos)."""
        try:
            # Carregar tipos de versão
            versao_response = self.api_client.get('gerencia/dominio/tipo_versao')
            if versao_response and 'dados' in versao_response:
                self.tipoVersaoComboBox.clear()
                for tipo in versao_response['dados']:
                    self.tipoVersaoComboBox.addItem(tipo['nome'], tipo['code'])
            
            # Carregar subtipos de produto
            subtipo_response = self.api_client.get('gerencia/dominio/subtipo_produto')
            if subtipo_response and 'dados' in subtipo_response:
                self.subtipoComboBox.clear()
                for subtipo in subtipo_response['dados']:
                    self.subtipoComboBox.addItem(subtipo['nome'], subtipo['code'])
            
            # Carregar lotes
            lotes_response = self.api_client.get('projetos/lote')
            if lotes_response and 'dados' in lotes_response:
                self.loteComboBox.clear()
                self.loteComboBox.addItem("Nenhum", None)
                for lote in lotes_response['dados']:
                    self.loteComboBox.addItem(f"{lote['nome']} ({lote['pit']})", lote['id'])
                    
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar dados: {str(e)}")
        
    def populate_fields(self):
        """Preenche os campos do formulário com os dados da versão."""
        if not self.versao_data:
            return
            
        self.idLineEdit.setText(str(self.versao_data.get('versao_id', '')))
        self.uuidLineEdit.setText(self.versao_data.get('uuid_versao', ''))
        self.versaoLineEdit.setText(self.versao_data.get('versao', ''))
        self.nomeLineEdit.setText(self.versao_data.get('nome_versao', ''))
        self.orgaoProdutorLineEdit.setText(self.versao_data.get('orgao_produtor', ''))
        
        # Palavras-chave
        if self.versao_data.get('palavras_chave'):
            self.palavrasChaveLineEdit.setText(', '.join(self.versao_data['palavras_chave']))
            
        # Selecionar tipo de versão
        tipo_versao_id = self.versao_data.get('tipo_versao_id')
        index = self.tipoVersaoComboBox.findData(tipo_versao_id)
        if index >= 0:
            self.tipoVersaoComboBox.setCurrentIndex(index)
            
        # Selecionar subtipo de produto
        subtipo_id = self.versao_data.get('subtipo_produto_id')
        index = self.subtipoComboBox.findData(subtipo_id)
        if index >= 0:
            self.subtipoComboBox.setCurrentIndex(index)
            
        # Selecionar lote
        lote_id = self.versao_data.get('lote_id')
        index = self.loteComboBox.findData(lote_id)
        if index >= 0:
            self.loteComboBox.setCurrentIndex(index)
            
        # Datas
        if self.versao_data.get('versao_data_criacao'):
            date = QDateTime.fromString(self.versao_data['versao_data_criacao'], Qt.ISODate)
            self.dataCriacaoDateEdit.setDate(date.date())
            
        if self.versao_data.get('versao_data_edicao'):
            date = QDateTime.fromString(self.versao_data['versao_data_edicao'], Qt.ISODate)
            self.dataEdicaoDateEdit.setDate(date.date())
            
        # Descrição
        self.descricaoTextEdit.setPlainText(self.versao_data.get('versao_descricao', ''))
        
        # Metadados
        if self.versao_data.get('versao_metadado'):
            try:
                if isinstance(self.versao_data['versao_metadado'], str):
                    metadado_texto = self.versao_data['versao_metadado']
                else:
                    metadado_texto = json.dumps(self.versao_data['versao_metadado'], indent=2)
                self.metadadoTextEdit.setPlainText(metadado_texto)
            except:
                self.metadadoTextEdit.setPlainText(str(self.versao_data['versao_metadado']))
            
    def validate_inputs(self):
        """Valida os campos do formulário."""
        if not self.versaoLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O número da versão é obrigatório.")
            return False
            
        if not self.orgaoProdutorLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O órgão produtor é obrigatório.")
            return False
            
        try:
            # Validar formato JSON de metadados
            metadado_text = self.metadadoTextEdit.toPlainText().strip()
            if metadado_text:
                json.loads(metadado_text)
        except json.JSONDecodeError:
            QMessageBox.warning(self, "Validação", "O campo de metadados deve conter um JSON válido.")
            return False
            
        return True
        
    def save_version(self):
        """Salva as alterações na versão."""
        if not self.validate_inputs():
            return
            
        try:
            # Preparar palavras-chave
            palavras_chave = []
            if self.palavrasChaveLineEdit.text().strip():
                palavras_chave = [p.strip() for p in self.palavrasChaveLineEdit.text().split(',')]
                
            # Preparar metadados
            metadado_text = self.metadadoTextEdit.toPlainText().strip()
            metadado = json.loads(metadado_text) if metadado_text else {}
                
            # Preparar dados
            versao = {
                'id': int(self.idLineEdit.text()),
                'uuid_versao': self.uuidLineEdit.text(),
                'versao': self.versaoLineEdit.text(),
                'nome': self.nomeLineEdit.text(),
                'tipo_versao_id': self.tipoVersaoComboBox.currentData(),
                'subtipo_produto_id': self.subtipoComboBox.currentData(),
                'lote_id': self.loteComboBox.currentData(),
                'orgao_produtor': self.orgaoProdutorLineEdit.text(),
                'palavras_chave': palavras_chave,
                'data_criacao': self.dataCriacaoDateEdit.date().toString(Qt.ISODate),
                'data_edicao': self.dataEdicaoDateEdit.date().toString(Qt.ISODate),
                'descricao': self.descricaoTextEdit.toPlainText(),
                'metadado': metadado
            }
            
            # Enviar para API
            response = self.api_client.put('produtos/versao', versao)
            
            if response:
                QMessageBox.information(self, "Sucesso", "Versão atualizada com sucesso!")
                self.accept()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível atualizar a versão.")
                
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao salvar versão: {str(e)}")