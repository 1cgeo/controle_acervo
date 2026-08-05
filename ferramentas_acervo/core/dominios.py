# Path: core\dominios.py
"""Códigos de domínio e o cache das listas que vêm do servidor.

As CONSTANTES espelham `server/src/utils/domain_constants.js`. Use a constante,
nunca o número na mão: número mágico espalhado deixa um domínio novo entrar no
servidor e a interface continuar concordando com o anterior, sem erro nenhum.

O CACHE guarda as listas de domínio, iguais em todo diálogo e imutáveis durante
a sessão. Elas são buscadas uma vez por sessão. `invalidar()` serve para quando
o plugin altera um domínio e para o teste.
"""

# dominio.tipo_arquivo
TIPO_ARQUIVO_PRINCIPAL = 1
TIPO_ARQUIVO_TILESERVER = 9

# dominio.tipo_escala
TIPO_ESCALA_PERSONALIZADA = 5

# dominio.situacao_carregamento
SITUACAO_CARREGAMENTO_NAO_CARREGADO = 1

# dominio.tipo_perfil
PERFIL_CONSULTA = 1
PERFIL_OPERADOR = 2
PERFIL_GERENTE = 3

NOME_PERFIL = {
    PERFIL_CONSULTA: 'Consulta',
    PERFIL_OPERADOR: 'Operador',
    PERFIL_GERENTE: 'Gerente',
}


def eh_tileserver(tipo_arquivo_id):
    """Tileserver é URL, não byte em volume: não tem extensão, tamanho,
    checksum, volume nem arquivo para transferir."""
    return tipo_arquivo_id == TIPO_ARQUIVO_TILESERVER


class Dominios:
    """Cache das listas de domínio de uma sessão.

    Uma instância por ``APIClient``, criada por ``api_client.dominios``. Falha de
    rede NÃO é cacheada: uma lista vazia devolvida por servidor fora do ar
    deixaria o combo vazio pelo resto da sessão, mesmo depois de a rede voltar.
    """

    # rótulo do plugin -> rota (sem o prefixo `api/`)
    ROTAS = {
        'tipo_produto': 'gerencia/dominio/tipo_produto',
        'subtipo_produto': 'gerencia/dominio/subtipo_produto',
        'tipo_escala': 'gerencia/dominio/tipo_escala',
        'tipo_arquivo': 'gerencia/dominio/tipo_arquivo',
        'tipo_versao': 'gerencia/dominio/tipo_versao',
        'tipo_relacionamento': 'gerencia/dominio/tipo_relacionamento',
        'tipo_status_arquivo': 'gerencia/dominio/tipo_status_arquivo',
        'tipo_status_execucao': 'gerencia/dominio/tipo_status_execucao',
        'situacao_carregamento': 'gerencia/dominio/situacao_carregamento',
        'lote': 'projetos/lote',
        'projeto': 'projetos/projeto',
        'volume': 'volumes/volume_armazenamento',
    }

    def __init__(self, api_client):
        self._api = api_client
        self._cache = {}

    def get(self, nome):
        """Lista do domínio, buscando no servidor apenas na primeira chamada."""
        if nome in self._cache:
            return self._cache[nome]

        rota = self.ROTAS.get(nome)
        if rota is None:
            raise KeyError(f"Domínio desconhecido: {nome}")

        resposta = self._api.get(rota)
        if not resposta or 'dados' not in resposta:
            # Sem cache: ver a docstring da classe.
            return []

        self._cache[nome] = resposta['dados']
        return self._cache[nome]

    def invalidar(self, nome=None):
        """Descarta o cache inteiro, ou só de um domínio."""
        if nome is None:
            self._cache.clear()
        else:
            self._cache.pop(nome, None)

    # --- Consultas que mais de um diálogo faz -----------------------------

    def subtipos_do_tipo(self, tipo_produto_id):
        """Subtipos que pertencem a um tipo de produto."""
        return [s for s in self.get('subtipo_produto')
                if s.get('tipo_id') == tipo_produto_id]

    def subtipo(self, code):
        """A linha de um subtipo, ou None."""
        for s in self.get('subtipo_produto'):
            if s.get('code') == code:
                return s
        return None

    def exige_produto_proprio(self, subtipo_produto_id):
        """Diz se o subtipo obriga o PRODUTO a ter esse mesmo subtipo.

        É o `dominio.subtipo_produto.define_produto` do servidor, e é a regra que
        o gatilho `acervo.validate_version` cobra. Pergunte ANTES de montar o
        corpo. A incompatibilidade descoberta no confirm-upload chega como erro
        500 sem explicação, com os bytes já copiados para o volume.
        """
        linha = self.subtipo(subtipo_produto_id)
        return bool(linha and linha.get('define_produto'))

    def nome_subtipo(self, code):
        linha = self.subtipo(code)
        return linha['nome'] if linha else str(code)

    def volumes_de_origem(self):
        """Volumes marcados com `layout_origem`, os únicos que a catalogação in
        loco aceita."""
        return [v for v in self.get('volume') if v.get('layout_origem')]
