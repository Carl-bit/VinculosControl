# Regenera infra/templates/silo.compose.tpl desde el compose del ERP (R11).
# Uso (desde la raiz de este repo):
#   python infra/templates/generar.py "../SW Proyecto/infra/docker-compose.yml"
# Cambia solo: sin `build` e imagenes por digest del registro del host B (R1).
import re
import sys
from pathlib import Path

origen = sys.argv[1] if len(sys.argv) > 1 else '../SW Proyecto/infra/docker-compose.yml'
src = open(origen, encoding='utf-8').read()

out = []
saltar = False
for linea in src.split('\n'):
    if re.match(r'^    build:\s*$', linea):
        saltar = True
        continue
    if saltar:
        if linea.startswith('      '):
            continue
        saltar = False
    out.append(linea)
s = '\n'.join(out)

s = s.replace('image: vinculos-api:${VINCULOS_VERSION:-dev}', 'image: ${REGISTRO}/vinculos-api@${API_DIGEST}')
s = s.replace('image: vinculos-web:${VINCULOS_VERSION:-dev}', 'image: ${REGISTRO}/vinculos-web@${WEB_DIGEST}')
s = s.replace("""    # Imagen comun a todos los silos (R11). Con el registro (R1) pasa a
    # <registro>/vinculos-api@sha256:... sin `build`.
""", '')
s = s.replace("    # Imagen comun (R11): nombre, tema y dominio del centro entran en runtime.\n", '')
if 'build:' in s or s.count('@${API_DIGEST}') != 2 or s.count('@${WEB_DIGEST}') != 1:
    sys.exit('El compose del ERP cambio de forma: revisar este generador antes de usar la plantilla')

cabecera = """# =============================================================================
# silo.compose.tpl: plantilla del stack erp-<slug> que usara el job
# `aprovisionar` (P3). GENERADA por infra/templates/generar.py desde
# SW Proyecto/infra/docker-compose.yml (R11). No editar a mano: regenerar.
# Diferencias con el original, y nada mas:
#   - sin `build`: imagenes por digest del registro del host B (R1):
#       ${REGISTRO}/vinculos-api@${API_DIGEST}, ${REGISTRO}/vinculos-web@${WEB_DIGEST}
#   - VINCULOS_VERSION es el tag que corresponde al digest (label informativa).
# Se renderiza dentro de infra/ del repo del ERP en el host B (mismas rutas
# relativas: ./postgres/init, ./secrets/<slug>/).
# Variables del .env del silo: las de SW Proyecto/infra/.env.example, mas
# REGISTRO, API_DIGEST, WEB_DIGEST.
# =============================================================================
"""
Path(__file__).with_name('silo.compose.tpl').write_text(cabecera + s, encoding='utf-8', newline='\n')
print('silo.compose.tpl regenerada')
