# Path: __init__.py
from .main import Main

def classFactory(iface):
    return Main(iface)