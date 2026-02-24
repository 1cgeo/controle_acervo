# Path: gui\informacao_produto\file_edit_dialog.py
import os
import json
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QComboBox
from qgis.PyQt.QtCore import Qt

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'file_edit_dialog.ui'))

class FileEditDialog(QDialog, FORM_CLASS):
    """
    Diálogo para edição de informações de um arquivo.
    """
    def __init__(self, api_client, arquivo_data, parent=None):
        """
        Inicializa o diálogo de edição de arquivo.
        
        Args:
            api_client: Cliente da API para realizar requisições
            arquivo_data (dict): Dados atuais do arquivo
            parent: Widget pai
        """
        super(FileEditDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.arquivo_data = arquivo_data
        
        # Carregar valores em comboboxes
        self.load_combos()
        
        # Preencher campos com dados atuais
        self.populate_fields()
        
        # Conectar sinais
        self.buttonBox.accepted.connect(self.save_file)
        self.buttonBox.rejected.connect(self.reject)
        self.tipoArquivoComboBox.currentIndexChanged.connect(self.toggle_fields_by_type)
        
    def load_combos(self):
        """Carrega os dados nas caixas de combinação (combos)."""
        try:
            # Carregar tipos de arquivo
            tipo_arquivo_response = self.api_client.get('gerencia/dominio/tipo_arquivo')
            if tipo_arquivo_response and 'dados' in tipo_arquivo_response:
                self.tipoArquivoComboBox.clear()
                for tipo in tipo_arquivo_response['dados']:
                    self.tipoArquivoComboBox.addItem(tipo['nome'], tipo['code'])
            
            # Carregar situações de carregamento
            situacao_response = self.api_client.get('gerencia/dominio/situacao_carregamento')
            if situacao_response and 'dados' in situacao_response:
                self.situacaoComboBox.clear()
                for situacao in situacao_response['dados']:
                    self.situacaoComboBox.addItem(situacao['nome'], situacao['code'])
                    
            # Carregar tipos de status
            status_response = self.api_client.get('gerencia/dominio/tipo_status_arquivo')
            if status_response and 'dados' in status_response:
                self.statusComboBox.clear()
                for status in status_response['dados']:
                    self.statusComboBox.addItem(status['nome'], status['code'])
                    
            # Carregar volumes
            volumes_response = self.api_client.get('volumes/volume_armazenamento')
            if volumes_response and 'dados' in volumes_response:
                self.volumeComboBox.clear()
                for volume in volumes_response['dados']:
                    self.volumeComboBox.addItem(f"{volume['nome']} ({volume['volume']})", volume['id'])
                    
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar dados: {str(e)}")
        
    def populate_fields(self):
        """Preenche os campos do formulário com os dados do arquivo."""
        if not self.arquivo_data:
            return
            
        self.idLineEdit.setText(str(self.arquivo_data.get('id', '')))
        self.nomeLineEdit.setText(self.arquivo_data.get('nome', ''))
        self.nomeArquivoLineEdit.setText(self.arquivo_data.get('nome_arquivo', ''))
        self.crsLineEdit.setText(self.arquivo_data.get('crs_original', ''))
        
        # Selecionar tipo de arquivo
        tipo_arquivo_id = self.arquivo_data.get('tipo_arquivo_id')
        index = self.tipoArquivoComboBox.findData(tipo_arquivo_id)
        if index >= 0:
            self.tipoArquivoComboBox.setCurrentIndex(index)
            
        # Selecionar volume
        volume_id = self.arquivo_data.get('volume_armazenamento_id')
        index = self.volumeComboBox.findData(volume_id)
        if index >= 0:
            self.volumeComboBox.setCurrentIndex(index)
            
        # Selecionar situação
        situacao_id = self.arquivo_data.get('situacao_carregamento_id')
        index = self.situacaoComboBox.findData(situacao_id)
        if index >= 0:
            self.situacaoComboBox.setCurrentIndex(index)
            
        # Selecionar status
        status_id = self.arquivo_data.get('tipo_status_id')
        index = self.statusComboBox.findData(status_id)
        if index >= 0:
            self.statusComboBox.setCurrentIndex(index)
            
        # Descrição
        self.descricaoTextEdit.setPlainText(self.arquivo_data.get('descricao', ''))
        
        # Metadados
        if self.arquivo_data.get('metadado'):
            try:
                if isinstance(self.arquivo_data['metadado'], str):
                    metadado_texto = self.arquivo_data['metadado']
                else:
                    metadado_texto = json.dumps(self.arquivo_data['metadado'], indent=2)
                self.metadadoTextEdit.setPlainText(metadado_texto)
            except:
                self.metadadoTextEdit.setPlainText(str(self.arquivo_data['metadado']))
                
        # Atualizar visibilidade dos campos baseado no tipo
        self.toggle_fields_by_type()
            
    def toggle_fields_by_type(self):
        """Ativa/desativa campos baseado no tipo de arquivo."""
        # Tipo 9 (Tileserver) tem tratamento especial
        is_tileserver = self.tipoArquivoComboBox.currentData() == 9
        
        self.volumeLabel.setVisible(not is_tileserver)
        self.volumeComboBox.setVisible(not is_tileserver)
        
        # O nome do arquivo para tileserver deve começar com http:// ou https://
        if is_tileserver:
            self.nomeArquivoLineEdit.setPlaceholderText("https://exemplo.com/tileserver")
        else:
            self.nomeArquivoLineEdit.setPlaceholderText("")
            
    def validate_inputs(self):
        """Valida os campos do formulário."""
        if not self.nomeLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O nome do arquivo é obrigatório.")
            return False
            
        if not self.nomeArquivoLineEdit.text().strip():
            QMessageBox.warning(self, "Validação", "O nome do arquivo físico é obrigatório.")
            return False
            
        # Validar URL para tileserver
        is_tileserver = self.tipoArquivoComboBox.currentData() == 9
        if is_tileserver:
            nome_arquivo = self.nomeArquivoLineEdit.text().strip()
            if not nome_arquivo.startswith(('http://', 'https://')):
                QMessageBox.warning(self, "Validação", "Para arquivos do tipo Tileserver, o nome do arquivo deve ser uma URL (começando com http:// ou https://).")
                return False
                
        # Volume é obrigatório para arquivos não-tileserver
        if not is_tileserver and self.volumeComboBox.currentIndex() < 0:
            QMessageBox.warning(self, "Validação", "O volume de armazenamento é obrigatório.")
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
        
    def save_file(self):
        """Salva as alterações no arquivo."""
        if not self.validate_inputs():
            return
            
        try:
            # Preparar metadados
            metadado_text = self.metadadoTextEdit.toPlainText().strip()
            metadado = json.loads(metadado_text) if metadado_text else {}
            
            # Tipo de arquivo
            tipo_arquivo_id = self.tipoArquivoComboBox.currentData()
            is_tileserver = tipo_arquivo_id == 9
                
            # Preparar dados
            arquivo = {
                'id': int(self.idLineEdit.text()),
                'nome': self.nomeLineEdit.text(),
                'tipo_arquivo_id': tipo_arquivo_id,
                'volume_armazenamento_id': None if is_tileserver else self.volumeComboBox.currentData(),
                'metadado': metadado,
                'tipo_status_id': self.statusComboBox.currentData(),
                'situacao_carregamento_id': self.situacaoComboBox.currentData(),
                'descricao': self.descricaoTextEdit.toPlainText(),
                'crs_original': self.crsLineEdit.text()
            }
            
            # Enviar para API
            response = self.api_client.put('arquivo/arquivo', arquivo)
            
            if response:
                QMessageBox.information(self, "Sucesso", "Arquivo atualizado com sucesso!")
                self.accept()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível atualizar o arquivo.")
                
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao salvar arquivo: {str(e)}")