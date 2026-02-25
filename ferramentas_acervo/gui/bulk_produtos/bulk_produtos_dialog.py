# Path: gui\bulk_produtos\bulk_produtos_dialog.py
import os
import json
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QProgressBar
from qgis.PyQt.QtCore import Qt
from qgis.core import QgsProject, QgsVectorLayer, QgsWkbTypes, Qgis, NULL

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_produtos_dialog.ui'))

def null_to_none(value):
    return None if value == NULL else value

class BulkCreateProductsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(BulkCreateProductsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Criação em Massa de Produtos")

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
        self.loadButton.clicked.connect(self.bulk_create_products)
        self.createModelLayerButton.clicked.connect(self.create_model_layer)

    def bulk_create_products(self):
        """Cria múltiplos produtos sem versões"""
        layer = self.layerComboBox.currentData()
        if not layer:
            QMessageBox.warning(self, "Aviso", "Selecione uma camada válida.")
            return

        is_valid, error_message = self.validate_layer_structure(layer)
        if not is_valid:
            QMessageBox.critical(self, "Erro de Estrutura", f"A camada não possui a estrutura correta. {error_message}")
            return

        # Preparar os dados para envio
        produtos_data = self.prepare_data_from_layer(layer)
        if not produtos_data:
            QMessageBox.warning(self, "Aviso", "Nenhum produto válido para criar.")
            return

        try:
            self.progressBar.setVisible(True)
            self.progressBar.setMaximum(len(produtos_data['produtos']))
            self.progressBar.setValue(0)
            self.statusLabel.setText(f"Criando {len(produtos_data['produtos'])} produtos...")
            self.setCursor(Qt.WaitCursor)
            
            # Enviar dados para o servidor
            response = self.api_client.post('produtos/produtos', produtos_data)
            
            if response and response.get('success'):
                self.statusLabel.setText("Produtos criados com sucesso!")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.information(self, "Sucesso", f"Todos os {len(produtos_data['produtos'])} produtos foram criados com sucesso.")
                self.progressBar.setVisible(False)
            else:
                error_message = "Falha ao criar produtos"
                if response and 'message' in response:
                    error_message = response['message']
                
                self.statusLabel.setText(f"Erro: {error_message}")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.critical(self, "Erro", f"Falha ao criar produtos: {error_message}")
                
        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", f"Erro ao criar produtos: {str(e)}")
            self.progressBar.setVisible(False)

    def validate_layer_structure(self, layer):
        """Valida se a camada tem a estrutura necessária"""
        required_fields = [
            'nome', 'tipo_escala_id', 'tipo_produto_id', 'geom'
        ]
        
        field_names = [field.name() for field in layer.fields()]
        
        # Verificar campos obrigatórios
        missing_fields = [field for field in required_fields if field not in field_names]
        if missing_fields:
            return False, f"Campos obrigatórios ausentes: {', '.join(missing_fields)}"
        
        return True, ""

    def prepare_data_from_layer(self, layer):
        """Prepara os dados da camada para o formato esperado pela API"""
        field_names = [field.name() for field in layer.fields()]
        produtos = []
        invalid_features = []
        
        for feature in layer.getFeatures():
            # Verificação de campos não nulos obrigatórios
            non_null_fields = ['nome', 'tipo_escala_id', 'tipo_produto_id', 'geom']
            null_fields = [field for field in non_null_fields if feature[field] == NULL]
            
            if null_fields:
                invalid_features.append((feature.id(), f"Campos não podem ser nulos: {', '.join(null_fields)}"))
                continue
            
            # Verificar se a geometria é válida
            geom_text = feature['geom']
            if not geom_text or not (geom_text.startswith('POLYGON') or geom_text.startswith('MULTIPOLYGON')):
                invalid_features.append((feature.id(), "Geometria deve ser um POLYGON ou MULTIPOLYGON válido em formato WKT"))
                continue
            
            # Criar objeto de produto
            produto = {
                "nome": feature['nome'],
                "mi": null_to_none(feature['mi']) if 'mi' in field_names else "",
                "inom": null_to_none(feature['inom']) if 'inom' in field_names else "",
                "tipo_escala_id": feature['tipo_escala_id'],
                "denominador_escala_especial": null_to_none(feature['denominador_escala_especial']) if 'denominador_escala_especial' in field_names else None,
                "tipo_produto_id": feature['tipo_produto_id'],
                "descricao": null_to_none(feature['descricao']) if 'descricao' in field_names else "",
                "geom": feature['geom']
            }
            
            produtos.append(produto)
            
            # Atualizar barra de progresso
            self.progressBar.setValue(len(produtos))
        
        # Informar sobre features inválidas
        if invalid_features:
            error_msg = "As seguintes features têm problemas:\n"
            for id, reason in invalid_features:
                error_msg += f"ID {id}: {reason}\n"
            QMessageBox.warning(self, "Problemas encontrados", error_msg)
        
        if not produtos:
            return None
            
        return {"produtos": produtos}

    def create_model_layer(self):
        """Cria uma camada modelo com a estrutura necessária"""
        layer_name = "Modelo de Produtos em Massa"
        
        # Definir a estrutura da camada (sem geometria)
        uri = ("NoGeometry?crs=EPSG:4326"
               "&field=nome:string"
               "&field=mi:string"
               "&field=inom:string"
               "&field=tipo_escala_id:integer"
               "&field=denominador_escala_especial:integer"
               "&field=tipo_produto_id:integer"
               "&field=descricao:string"
               "&field=geom:string")
        
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
            "1. O campo 'nome' deve conter o nome do produto\n"
            "2. Os campos 'mi' e 'inom' são opcionais e identificam o produto\n"
            "3. O campo 'tipo_escala_id' é obrigatório e identifica o tipo de escala\n"
            "4. O campo 'denominador_escala_especial' só é necessário para escala tipo 5\n"
            "5. O campo 'tipo_produto_id' é obrigatório e identifica o tipo de produto\n"
            "6. O campo 'descricao' é opcional e pode conter detalhes adicionais\n"
            "7. O campo 'geom' deve conter a geometria WKT no formato POLYGON((...)) ou MULTIPOLYGON(((...))),\n"
            "   você pode utilizar ferramentas de QGIS para gerar esta string WKT a partir de geometrias.\n\n"
            "Os produtos criados não terão versões inicialmente. Você poderá adicionar versões posteriormente."
        )