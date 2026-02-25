# Path: gui\bulk_produtos_versoes_historicas\bulk_produtos_versoes_historicas_dialog.py
import os
import json
import datetime
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QProgressBar
from qgis.PyQt.QtCore import Qt, QDate
from qgis.core import QgsProject, QgsVectorLayer, QgsWkbTypes, Qgis, NULL

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'bulk_produtos_versoes_historicas_dialog.ui'))

def null_to_none(value):
    return None if value == NULL else value

class LoadHistoricalProductsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(LoadHistoricalProductsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Adicionar Produtos com Versões Históricas")

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
        self.loadButton.clicked.connect(self.load_historical_products)
        self.createModelLayerButton.clicked.connect(self.create_model_layer)

    def load_historical_products(self):
        """Carrega produtos com versões históricas"""
        layer = self.layerComboBox.currentData()
        if not layer:
            QMessageBox.warning(self, "Aviso", "Selecione uma camada válida.")
            return

        is_valid, error_message = self.validate_layer_structure(layer)
        if not is_valid:
            QMessageBox.critical(self, "Erro de Estrutura", f"A camada não possui a estrutura correta. {error_message}")
            return

        # Preparar os dados para envio
        produtos_versoes_historicas = self.prepare_data_from_layer(layer)
        if not produtos_versoes_historicas:
            QMessageBox.warning(self, "Aviso", "Nenhum produto válido para carregar.")
            return

        try:
            self.progressBar.setVisible(True)
            self.progressBar.setMaximum(len(produtos_versoes_historicas))
            self.progressBar.setValue(0)
            self.statusLabel.setText("Enviando produtos com versões históricas para o servidor...")
            self.setCursor(Qt.WaitCursor)
            
            # Enviar dados para o servidor
            response = self.api_client.post('produtos/produto_versao_historica', produtos_versoes_historicas)
            
            if response and response.get('success'):
                self.statusLabel.setText("Produtos com versões históricas adicionados com sucesso!")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.information(self, "Sucesso", "Todos os produtos com versões históricas foram adicionados com sucesso.")
                self.progressBar.setVisible(False)
            else:
                error_message = "Falha ao adicionar produtos com versões históricas"
                if response and 'message' in response:
                    error_message = response['message']
                
                self.statusLabel.setText(f"Erro: {error_message}")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.critical(self, "Erro", f"Falha ao adicionar produtos com versões históricas: {error_message}")
                
        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", f"Erro ao adicionar produtos com versões históricas: {str(e)}")
            self.progressBar.setVisible(False)

    def validate_layer_structure(self, layer):
        """Valida se a camada tem a estrutura necessária"""
        required_fields = [
            'produto_grupo_id', 'produto_nome', 'tipo_escala_id', 'tipo_produto_id', 'geom',
            'versao_grupo_id', 'versao', 'nome_versao', 'subtipo_produto_id',
            'orgao_produtor', 'data_criacao', 'data_edicao'
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
        
        # Dictionary para agrupar dados por produto e versão
        produtos_por_grupo = {}
        invalid_features = []
        
        for feature in layer.getFeatures():
            # Verificação de campos não nulos obrigatórios
            non_null_fields = [
                'produto_grupo_id', 'produto_nome', 'tipo_escala_id', 'tipo_produto_id', 'geom',
                'versao_grupo_id', 'versao', 'nome_versao', 'subtipo_produto_id',
                'orgao_produtor', 'data_criacao', 'data_edicao'
            ]
            null_fields = [field for field in non_null_fields if feature[field] == NULL]
            
            if null_fields:
                invalid_features.append((feature.id(), f"Campos não podem ser nulos: {', '.join(null_fields)}"))
                continue
            
            # Formatar palavras-chave
            palavras_chave = []
            if 'palavras_chave' in field_names and null_to_none(feature['palavras_chave']):
                palavras_chave = [palavra.strip() for palavra in feature['palavras_chave'].split(',')]
            
            # Formatar datas para ISO
            try:
                data_criacao = self.format_date_to_iso(feature['data_criacao'])
                data_edicao = self.format_date_to_iso(feature['data_edicao'])
            except Exception as e:
                invalid_features.append((feature.id(), f"Formato de data inválido: {str(e)}"))
                continue
            
            # Verificar metadado JSON (se existir)
            metadado_versao = {}
            if 'metadado_versao' in field_names and null_to_none(feature['metadado_versao']):
                try:
                    if isinstance(feature['metadado_versao'], str):
                        metadado_versao = json.loads(feature['metadado_versao'])
                    else:
                        metadado_versao = feature['metadado_versao']
                except Exception:
                    invalid_features.append((feature.id(), "Metadado da versão não é um JSON válido"))
                    continue
            
            # Chaves para agrupar dados
            produto_grupo_id = feature['produto_grupo_id']
            versao_grupo_id = feature['versao_grupo_id']
            produto_key = str(produto_grupo_id)
            versao_key = f"{produto_grupo_id}_{versao_grupo_id}"
            
            # Adicionar produto se ainda não existe no dicionário
            if produto_key not in produtos_por_grupo:
                produtos_por_grupo[produto_key] = {
                    "nome": feature['produto_nome'],
                    "mi": null_to_none(feature['mi']) if 'mi' in field_names else "",
                    "inom": null_to_none(feature['inom']) if 'inom' in field_names else "",
                    "tipo_escala_id": feature['tipo_escala_id'],
                    "denominador_escala_especial": null_to_none(feature['denominador_escala_especial']) if 'denominador_escala_especial' in field_names else None,
                    "tipo_produto_id": feature['tipo_produto_id'],
                    "descricao": null_to_none(feature['descricao_produto']) if 'descricao_produto' in field_names else "",
                    "geom": feature['geom'],
                    "versoes_por_grupo": {}
                }
            
            # Adicionar versão se ainda não existe no dicionário do produto
            if versao_key not in produtos_por_grupo[produto_key]["versoes_por_grupo"]:
                produtos_por_grupo[produto_key]["versoes_por_grupo"][versao_key] = {
                    "uuid_versao": null_to_none(feature['uuid_versao']) if 'uuid_versao' in field_names else None,
                    "versao": feature['versao'],
                    "nome": feature['nome_versao'],
                    "subtipo_produto_id": feature['subtipo_produto_id'],
                    "lote_id": null_to_none(feature['lote_id']) if 'lote_id' in field_names else None,
                    "metadado": metadado_versao,
                    "descricao": null_to_none(feature['descricao_versao']) if 'descricao_versao' in field_names else "",
                    "orgao_produtor": feature['orgao_produtor'],
                    "palavras_chave": palavras_chave,
                    "data_criacao": data_criacao,
                    "data_edicao": data_edicao,
                }
        
        # Informar sobre features inválidas
        if invalid_features:
            error_msg = "As seguintes features têm problemas:\n"
            for id, reason in invalid_features:
                error_msg += f"ID {id}: {reason}\n"
            QMessageBox.warning(self, "Problemas encontrados", error_msg)
        
        # Converter para o formato esperado pela API
        produtos_versoes_historicas = []
        for produto_key, produto_data in produtos_por_grupo.items():
            # Extrair versões do dicionário
            versoes = list(produto_data["versoes_por_grupo"].values())
            del produto_data["versoes_por_grupo"]
            
            if not versoes:
                continue  # Ignorar produtos sem versões
            
            produto_completo = {
                **produto_data,
                "versoes": versoes
            }
            
            produtos_versoes_historicas.append(produto_completo)
        
        return produtos_versoes_historicas

    def format_date_to_iso(self, date_value):
        """Converte uma data em formato QDate ou string para ISO 8601"""
        if isinstance(date_value, QDate):
            return date_value.toString(Qt.ISODate)
        elif isinstance(date_value, datetime.date):
            return date_value.isoformat()
        elif isinstance(date_value, str):
            # Tentar interpretar a string como data
            try:
                return QDate.fromString(date_value, Qt.ISODate).toString(Qt.ISODate)
            except:
                # Formato diferente, tentando outros padrões comuns
                try:
                    date_obj = datetime.datetime.strptime(date_value, "%d/%m/%Y")
                    return date_obj.isoformat().split('T')[0]
                except:
                    raise ValueError(f"Formato de data não reconhecido: {date_value}")
        else:
            raise ValueError(f"Tipo de data não suportado: {type(date_value)}")

    def create_model_layer(self):
        """Cria uma camada modelo com a estrutura necessária"""
        layer_name = "Modelo de Produtos com Versões Históricas"
        
        # Definir a estrutura da camada (sem geometria)
        uri = ("NoGeometry?crs=EPSG:4326"
               "&field=produto_grupo_id:integer"
               "&field=produto_nome:string"
               "&field=mi:string"
               "&field=inom:string"
               "&field=tipo_escala_id:integer"
               "&field=denominador_escala_especial:integer"
               "&field=tipo_produto_id:integer"
               "&field=descricao_produto:string"
               "&field=geom:string"
               "&field=versao_grupo_id:integer"
               "&field=versao:string"
               "&field=nome_versao:string"
               "&field=subtipo_produto_id:integer"
               "&field=lote_id:integer"
               "&field=descricao_versao:string"
               "&field=orgao_produtor:string"
               "&field=palavras_chave:string"
               "&field=data_criacao:date"
               "&field=data_edicao:date"
               "&field=metadado_versao:string")
        
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
            "1. Para cada produto, atribua um identificador único no campo 'produto_grupo_id'\n"
            "2. Para cada versão, atribua um identificador único no campo 'versao_grupo_id'\n"
            "3. Todos os registros de um mesmo produto devem ter o mesmo 'produto_grupo_id'\n"
            "4. Todos os registros de uma mesma versão devem ter o mesmo 'versao_grupo_id'\n"
            "5. O campo 'geom' deve conter a geometria em formato WKT (ex: POLYGON((...)))\n"
            "6. Datas devem estar no formato ISO (aaaa-mm-dd)\n"
            "7. O campo 'palavras_chave' deve conter valores separados por vírgula\n"
            "8. O campo 'metadado_versao' deve conter JSON válido\n\n"
            "Produtos com versões históricas são registros de produtos e versões passados\n"
            "dos quais temos conhecimento, mas não possuímos os arquivos."
        )