"""Escenarios ficticios para un piloto académico. No son reseñas ni fraudes reales."""
import csv, json, re, unicodedata
from pathlib import Path
from datetime import datetime, timedelta, timezone

RAIZ = Path(__file__).resolve().parent
NOMBRES = ['enlaces','promocion','duplicado','similitud','frecuencia_hora','longitud','mayusculas','repeticion','contacto']
AHORA = datetime(2026,11,20,17,tzinfo=timezone.utc)
def normalizar(texto):
    return re.sub(r'[^\w]+', ' ', ''.join(c for c in unicodedata.normalize('NFKD', texto.lower()) if not unicodedata.combining(c)).replace('_',' ')).strip()
def indicadores(texto, previas):
    normal = normalizar(texto)
    palabras = [p for p in normal.split() if len(p) >= 2]
    unicas = set(palabras)
    letras = [c for c in texto if c.isalpha()]
    similitud = 0
    for anterior in previas:
        otras = {p for p in normalizar(anterior['comentario']).split() if len(p) >= 2}
        union = unicas | otras
        if union: similitud = max(similitud, len(unicas & otras)/len(union))
    enlaces = len(re.findall(r'\b(?:https?://|www\.)[^\s]+', texto, re.I))
    promo = bool(re.search(r'\b(?:compra ahora|oferta exclusiva|codigo promocional|haz clic|descuento solo hoy)\b', normal))
    duplicado = len(normal) >= 20 and any(normalizar(r['comentario']) == normal for r in previas)
    frecuencia = sum(r['minutos'] < 60 for r in previas)
    contacto = bool(re.search(r'\b(?:whatsapp|telegram)\b|\b\d{9}\b', texto, re.I))
    vector = [min(enlaces,3)/3, int(promo), int(duplicado), similitud, min(frecuencia,5)/5, min(len(palabras),100)/100, sum(c.isupper() for c in letras)/len(letras) if letras else 0, 1-len(unicas)/len(palabras) if palabras else 0, int(contacto)]
    reglas = (75 if duplicado else 0) + (75 if enlaces > 1 else 40 if enlaces else 0) + (35 if enlaces and promo else 0) + (35 if frecuencia >= 4 else 0)
    return vector, min(reglas,100)

# Cada grupo es un escenario distinto. Sus variantes se mantienen juntas al dividir.
ESCENARIOS = [
 (0,'El ingreso a {sitio} fue caro y no volvería.',0,'distinta','Crítica legítima, sin señales de manipulación.'),
 (0,'Disfruté la colección de {sitio}; el guía fue amable.',0,'distinta','Opinión favorable sin indicios.'),
 (0,'Visitamos {sitio} por la mañana y salimos al mediodía.',1,'distinta','Descripción neutral.'),
 (0,'En {sitio} faltan rampas y señalización; deberían mejorar.',0,'distinta','Reclamo legítimo de accesibilidad.'),
 (0,'El horario de {sitio} está en https://museo.example/horarios .',1,'distinta','Enlace informativo útil; no es publicidad.'),
 (0,'Consulten https://museo.example y https://cultura.example para las entradas de {sitio}.',0,'distinta','Dos referencias oficiales ficticias: caso difícil para las reglas.'),
 (0,'NO HAY SOMBRA EN {sitio}, lleven agua y sombrero.',0,'distinta','Mayúsculas en una advertencia legítima.'),
 (0,'Buen lugar, {sitio}.',1,'distinta','Opinión breve, sin evidencia de manipulación.'),
 (0,'En recepción de {sitio} me indicaron el teléfono 999000000 para reservas.',0,'distinta','Información de contacto, no spam por sí sola.'),
 (0,'Hicimos una excursión por varios sitios y {sitio} fue la última parada.',5,'distinta','Varias publicaciones de una excursión legítima.'),
 (0,'La entrada de {sitio} tiene descuento para estudiantes con carnet.',0,'distinta','Información sobre tarifa reducida.'),
 (0,'No me gustó ver anuncios de compra ahora durante la visita a {sitio}.',0,'distinta','Cita crítica de publicidad sin enlace promocional.'),
 (0,'El baño de {sitio} estaba cerrado, pero el recorrido fue interesante.',2,'distinta','Comentario mixto legítimo.'),
 (0,'Encontramos una fila larga en {sitio}; el personal nos orientó.',1,'distinta','Hecho y opinión contextualizados.'),
 (0,'Las salas de {sitio} muestran cerámica y herramientas antiguas.',3,'distinta','Descripción informativa sin promoción.'),
 (0,'Nos recomendaron escribir por whatsapp al local de {sitio} para reservar.',0,'distinta','Mencionar contacto no confirma spam.'),
 (0,'La visita guiada fue por la mañana.',1,'repetida','Frase genérica repetida legítimamente: falso positivo potencial.'),
 (0,'En {sitio} me ayudaron con la entrada, el mapa y el recorrido.',4,'distinta','Alta actividad pero reseñas distintas y concretas.'),
 (0,'Reservé por https://visita.example y disfruté {sitio}.',2,'distinta','Enlace relacionado con la experiencia.'),
 (0,'MALO EL ACCESO A {sitio}, PERO EL MUSEO VALE LA PENA.',1,'distinta','Crítica en mayúsculas, no fraude.'),
 (1,'Excelente recorrido en {sitio}, recomiendo repetirlo con toda la familia.',2,'repetida','Copia exacta en varios lugares: requiere revisión.'),
 (1,'Compra ahora en https://oferta.example y https://venta.example para {sitio}.',1,'distinta','Varios enlaces promocionales ajenos a la visita.'),
 (1,'Oferta exclusiva de {sitio}: https://promo.example escríbenos por whatsapp.',3,'distinta','Promoción y captación de contacto.'),
 (1,'BUENO BUENO BUENO BUENO {sitio} BUENO BUENO BUENO.',6,'distinta','Contenido repetitivo y ráfaga de publicaciones.'),
 (1,'El mejor paseo en {sitio}, todo increíble y perfecto, lo recomiendo siempre.',5,'repetida','Copia exacta y alta frecuencia.'),
 (1,'Descuento solo hoy en {sitio}, entra en https://cupon.example y llama 999000000.',2,'distinta','Captación comercial con enlace.'),
 (1,'Haz clic en https://premio.example para recibir una oferta exclusiva de {sitio}.',0,'distinta','Mensaje promocional sin experiencia de visita.'),
 (1,'Maravilloso {sitio} maravilloso maravilloso maravilloso maravilloso.',5,'repetida','Repetición y publicación masiva.'),
 (1,'Gana dinero en https://dinero.example y https://bono.example desde {sitio}.',0,'distinta','Promoción ajena al atractivo.'),
 (1,'Servicio excelente en {sitio} y experiencia perfecta para todos los visitantes.',4,'similar','Plantilla casi idéntica repetida en varios atractivos.'),
 (1,'CODIGO PROMOCIONAL {sitio} https://regalo.example TELEGRAM 999000000.',4,'distinta','Código promocional, contacto y alta frecuencia.'),
 (1,'COMPRa ahora https://tienda.example para {sitio}, oferta exclusiva.',1,'repetida','Promoción repetida con enlace.'),
 (1,'En {sitio} todo es bueno bueno bueno bueno bueno bueno bueno bueno.',6,'distinta','Baja diversidad y actividad en ráfaga.'),
 (1,'Miren https://a.example https://b.example https://c.example para {sitio}.',4,'distinta','Ráfaga con múltiples enlaces: revisar contexto.'),
 (1,'Visita perfecta en {sitio}; gran atención, paisajes únicos y experiencia inolvidable.',3,'repetida','Mismo comentario publicado en otro destino.'),
 (1,'Oferta exclusiva, compra ahora, {sitio}: contacto por whatsapp 999000000.',5,'distinta','Promoción reiterada y captación de contacto.'),
 (1,'Recomiendo {sitio}, la atención fue buena y el recorrido agradable.',6,'similar','Variantes mínimas de una plantilla a gran frecuencia.'),
 (1,'PESIMO PESIMO PESIMO PESIMO {sitio} PESIMO PESIMO.',5,'repetida','Crítica repetitiva copiada en ráfaga; el signo negativo no es la señal.'),
 (1,'Todo perfecto y muy recomendable en {sitio}; personal atento y visita excelente.',7,'repetida','Repetición exacta y alta frecuencia.'),
 (1,'Compra ahora una oferta exclusiva de {sitio} en https://regalo.example https://envio.example.',2,'distinta','Varios enlaces y lenguaje de venta.'),
]
def generar():
    filas=[]; fixtures=[]
    for grupo,(etiqueta, plantilla, cantidad, modo, motivo) in enumerate(ESCENARIOS):
        for variante,sitio in enumerate(['el museo del valle','el bosque del norte','el complejo cultural']):
            texto=plantilla.format(sitio=sitio)
            anteriores=[]
            for i in range(cantidad):
                anterior=texto if modo=='repetida' else texto + ' Fue una visita reciente.' if modo=='similar' else ['El sendero tenía piedras y señalización nueva.','Vimos una colección de tejidos en otra sala.','La playa estaba tranquila por la tarde.','El estacionamiento estuvo disponible.'][i%4]
                anteriores.append({'comentario':anterior, 'minutos':5+i*7})
            vector, reglas=indicadores(texto,anteriores)
            fila={'grupo':f'escenario-{grupo+1:02d}','variante':variante,'origen':'sintetico','texto':texto,'etiqueta':etiqueta,'motivo_etiqueta':motivo,'historial':json.dumps(anteriores,ensure_ascii=False),'riesgo_reglas':reglas,**dict(zip(NOMBRES,vector))}
            filas.append(fila)
            if variante==0:
                fixtures.append({'texto':texto,'ahora':AHORA.isoformat(),'anteriores':[{'comentario':r['comentario'],'creadaEn':(AHORA-timedelta(minutes=r['minutos'])).isoformat()} for r in anteriores],'indicadores':vector})
    with (RAIZ/'escenarios-sinteticos.csv').open('w',encoding='utf-8',newline='') as archivo:
        escritor=csv.DictWriter(archivo,fieldnames=list(filas[0])); escritor.writeheader(); escritor.writerows(filas)
    destino=RAIZ.parent.parent/'src/resenas/fixtures-indicadores-riesgo.json'
    destino.write_text(json.dumps(fixtures,ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{len(filas)} variantes de {len(ESCENARIOS)} escenarios sintéticos. No son observaciones independientes.')
if __name__=='__main__': generar()
