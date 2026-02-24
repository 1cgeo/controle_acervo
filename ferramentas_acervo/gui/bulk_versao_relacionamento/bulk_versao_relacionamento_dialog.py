# Path: gui\bulk_versao_relacionamento\bulk_versao_relacionamento_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QProgressBar
from qgis.PyQt.QtCore import Qt
from qgis.core import QgsProject, QgsVectorLayer, QgsWkbTypes, Qgis, NULL

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_create_version_relationships_dialog.ui'))

def null_to_none(value):
    return None if value == NULL else value

class BulkCreateVersionRelationshipsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(BulkCreateVersionRelationshipsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Criar Relacionamentos entre Versões")

        # Configurar o combobox para selecionar a camada
        self.layerComboBox.clear()
        layers = QgsProject.instance().mapLayers().values()
        valid_layers = []
        for layer in layers:
            if isinstance(layer, QgsVectorLayer) and layer.geometryType() == QgsWkbTypes.NullGeometry:
                valid_layers.append(layer)
                self.layerComboBox.addItem(layer.name(), layer)

        # Se não houver camadas válidas, desabilitar o combobox e o botão de carregar
        if not valid_layers:
            self.layerComboBox.setEnabled(False)
            self.loadButton.setEnabled(False)
            self.statusLabel.setText("Nenhuma camada tabular encontrada no projeto.")

        # Adicionar barra de progresso
        self.progressBar = QProgressBar(self)
        self.progressBar.setVisible(False)
        self.verticalLayout.addWidget(self.progressBar)

        # Conectar sinais
        self.loadButton.clicked.connect(self.create_version_relationships)
        self.createModelLayerButton.clicked.connect(self.create_model_layer)

    def create_version_relationships(self):
        """Cria múltiplos relacionamentos entre versões"""
        layer = self.layerComboBox.currentData()
        if not layer:
            QMessageBox.warning(self, "Aviso", "Selecione uma camada válida.")
            return

        is_valid, error_message = self.validate_layer_structure(layer)
        if not is_valid:
            QMessageBox.critical(self, "Erro de Estrutura", f"A camada não possui a estrutura correta. {error_message}")
            return

        # Preparar os dados para envio
        relationships_data = self.prepare_data_from_layer(layer)
        if not relationships_data:
            QMessageBox.warning(self, "Aviso", "Nenhum relacionamento válido para criar.")
            return

        try:
            self.progressBar.setVisible(True)
            self.progressBar.setMaximum(len(relationships_data['versao_relacionamento']))
            self.progressBar.setValue(0)
            self.statusLabel.setText(f"Criando {len(relationships_data['versao_relacionamento'])} relacionamentos...")
            self.setCursor(Qt.WaitCursor)
            
            # Enviar dados para o servidor
            response = self.api_client.post('produtos/versao_relacionamento', relationships_data)
            
            if response and response.get('success'):
                self.statusLabel.setText("Relacionamentos criados com sucesso!")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.information(self, "Sucesso", f"Todos os {len(relationships_data['versao_relacionamento'])} relacionamentos foram criados com sucesso.")
                self.progressBar.setVisible(False)
            else:
                error_message = "Falha ao criar relacionamentos"
                if response and 'message' in response:
                    error_message = response['message']
                
                self.statusLabel.setText(f"Erro: {error_message}")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.critical(self, "Erro", f"Falha ao criar relacionamentos: {error_message}")
                
        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", f"Erro ao criar relacionamentos: {str(e)}")
            self.progressBar.setVisible(False)

    def validate_layer_structure(self, layer):
        """Valida se a camada tem a estrutura necessária"""
        required_fields = [
            'versao_id_1', 'versao_id_2', 'tipo_relacionamento_id'
        ]
        
        field_names = [field.name() for field in layer.fields()]
        
        # Verificar campos obrigatórios
        missing_fields = [field for field in required_fields if field not in field_names]
        if missing_fields:
            return False, f"Campos obrigatórios ausentes: {', '.join(missing_fields)}"
        
        return True, ""

    def prepare_data_from_layer(self, layer):
        """Prepara os dados da camada para o formato esperado pela API"""
        relationships = []
        invalid_features = []
        
        for feature in layer.getFeatures():
            # Verificação de campos não nulos obrigatórios
            non_null_fields = ['versao_id_1', 'versao_id_2', 'tipo_relacionamento_id']
            null_fields = [field for field in non_null_fields if feature[field] == NULL]
            
            if null_fields:
                invalid_features.append((feature.id(), f"Campos não podem ser nulos: {', '.join(null_fields)}"))
                continue
            
            # Verificar se não está relacionando uma versão com ela mesma
            if feature['versao_id_1'] == feature['versao_id_2']:
                invalid_features.append((feature.id(), "Uma versão não pode ser relacionada a ela mesma"))
                continue
            
            # Criar objeto de relacionamento
            relationship = {
                "versao_id_1": feature['versao_id_1'],
                "versao_id_2": feature['versao_id_2'],
                "tipo_relacionamento_id": feature['tipo_relacionamento_id']
            }
            
            relationships.append(relationship)
            
            # Atualizar barra de progresso
            self.progressBar.setValue(len(relationships))
        
        # Informar sobre features inválidas
        if invalid_features:
            error_msg = "As seguintes features têm problemas:\n"
            for id, reason in invalid_features:
                error_msg += f"ID {id}: {reason}\n"
            QMessageBox.warning(self, "Problemas encontrados", error_msg)
        
        if not relationships:
            return None
            
        return {"versao_relacionamento": relationships}

    def create_model_layer(self):
        """Cria uma camada modelo com a estrutura necessária"""
        layer_name = "Modelo de Relacionamentos entre Versões"
        
        # Definir a estrutura da camada (sem geometria)
        uri = ("NoGeometry?crs=EPSG:4326"
               "&field=versao_id_1:integer"
               "&field=versao_id_2:integer"
               "&field=tipo_relacionamento_id:integer")
        
        # Criar a camada
        layer = QgsVectorLayer(uri, layer_name, "memory")
        
        if not layer.isValid():
            QMessageBox.critical(self, "Erro", "Não foi possível criar a camada modelo.")
            return

        # Adicionar a camada ao projeto
        QgsProject.instance().addMapLayer(layer)
        
        # Selecionar a camada recém-criada no combobox
        self.layerComboBox.clear()
        self.layerComboBox.addItem(layer_name, layer)
        
        # Habilitar botões
        self.layerComboBox.setEnabled(True)
        self.loadButton.setEnabled(True)
        
        # Mensagem de sucesso
        self.iface.messageBar().pushMessage(
            "Sucesso", 
            "Camada modelo criada com sucesso. Agora você deve adicionar registros a esta camada.",
            level=Qgis.Success
        )
        
        # Instruções detalhadas
        QMessageBox.information(
            self,
            "Camada Modelo Criada",
            "Uma nova camada modelo foi criada com a estrutura necessária.\n\n"
            "Instruções de preenchimento:\n\n"
            "1. O campo 'versao_id_1' deve conter o ID da primeira versão no relacionamento\n"
            "2. O campo 'versao_id_2' deve conter o ID da segunda versão no relacionamento\n"
            "3. O campo 'tipo_relacionamento_id' deve conter o ID do tipo de relacionamento\n\n"
            "Tipos de relacionamento comuns:\n"
            "1 - É substituída por\n"
            "2 - Substitui\n"
            "3 - É compatível com\n"
            "4 - É derivada de\n"
            "5 - É origem de\n\n"
            "Note que uma versão não pode ser relacionada a ela mesma, ou seja,\n"
            "'versao_id_1' e 'versao_id_2' devem ser diferentes."
        )