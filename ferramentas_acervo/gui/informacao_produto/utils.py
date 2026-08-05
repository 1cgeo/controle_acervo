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
        date_dt = QDateTime.fromString(date_str, Qt.DateFormat.ISODate)
        return date_dt.toString('dd/MM/yyyy HH:mm:ss')
    except (TypeError, ValueError):
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


def campos_da_versao(versao):
    """Os pares rótulo/valor de uma versão, na ordem em que a ficha os mostra.

    A aba "Visão Geral" e a aba "Histórico de Versões" mostram a MESMA versão
    com os mesmos campos. Duas listas divergiriam ao primeiro campo novo.
    """
    palavras = versao.get('palavras_chave')
    lote = versao.get('lote_nome')
    if lote and versao.get('lote_pit'):
        lote = f"{lote} ({versao['lote_pit']})"

    return [
        ('UUID', versao.get('uuid_versao')),
        ('Versão', versao.get('versao')),
        ('Nome', versao.get('nome_versao')),
        ('Tipo de versão', versao.get('tipo_versao') or versao.get('tipo_versao_id')),
        ('Subtipo de produto', versao.get('subtipo_produto')
         or versao.get('subtipo_produto_id')),
        ('Lote', lote),
        ('Projeto', versao.get('projeto_nome')),
        ('Órgão produtor', versao.get('orgao_produtor')),
        ('Palavras-chave', ', '.join(palavras) if palavras else None),
        ('Descrição', versao.get('versao_descricao')),
        ('Data de criação', format_date(versao.get('versao_data_criacao'))),
        ('Data de edição', format_date(versao.get('versao_data_edicao'))),
        ('Data de cadastramento', format_date(versao.get('versao_data_cadastramento'))),
        ('Data de modificação', format_date(versao.get('versao_data_modificacao'))),
    ]


def bloco_html(pares):
    """Monta o texto rótulo/valor de um QLabel, uma linha por par.

    O `<br>` é obrigatório: o QLabel trata como HTML qualquer texto que traga
    uma etiqueta (o `<b>` do rótulo), e em HTML a quebra de linha do fonte é só
    um espaço. Sem o `<br>`, os catorze campos da versão saem grudados num
    parágrafo só.

    Valor None ou vazio vira "N/A", que é o que as fichas do plugin já usam.
    """
    linhas = []
    for rotulo, valor in pares:
        texto = 'N/A' if valor is None or valor == '' else escapar_html(valor)
        linhas.append(f"<b>{escapar_html(rotulo)}:</b> {texto}")
    return "<br>".join(linhas)


def escapar_html(valor):
    """Neutraliza `&`, `<` e `>` de um valor que vai para um QLabel em HTML.

    Descrição de produto e metadado são texto livre: um `<` cru some da tela,
    porque o Qt o lê como início de etiqueta.
    """
    return (str(valor).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))