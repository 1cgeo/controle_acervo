# Path: gui\informacao_produto\utils.py
"""
Funções utilitárias para o diálogo de informações do produto.
"""

import json
from qgis.PyQt.QtCore import Qt, QDateTime

def format_date(date_str):
    """Formata uma data ISO para exibição."""
    if not date_str:
        return "N/A"
            
    try:
        date_dt = QDateTime.fromString(date_str, Qt.ISODate)
        return date_dt.toString('dd/MM/yyyy HH:mm:ss')
    except:
        return date_str

def format_metadata(metadata):
    """Formata metadados para exibição."""
    if not metadata:
        return "N/A"
        
    try:
        if isinstance(metadata, str):
            # Tentar analisar se é uma string JSON
            try:
                parsed_json = json.loads(metadata)
                return json.dumps(parsed_json, indent=2)
            except json.JSONDecodeError:
                # Se não for JSON válido, retornar como texto
                return f"(Texto não-JSON) {metadata}"
        else:
            # Se já for um objeto Python (dict/list), formatar como JSON
            return json.dumps(metadata, indent=2)
    except json.JSONDecodeError:
        return f"Erro: Formato JSON inválido ({metadata[:100]}...)"
    except TypeError:
        return f"Erro: Tipo não serializável ({type(metadata).__name__})"
    except Exception as e:
        return f"Erro ao formatar metadados: {str(e)}"
    
def get_total_size(files):
    """Calcula o tamanho total dos arquivos em MB."""
    total = sum(file.get('tamanho_mb', 0) or 0 for file in files)
    return f"{total:.2f}"