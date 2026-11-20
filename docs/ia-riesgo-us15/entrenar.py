"""Entrenamiento reproducible en Colab o Python. No requiere GPU ni credenciales."""
import csv, json, hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.dummy import DummyClassifier
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, confusion_matrix

NOMBRES=['enlaces','promocion','duplicado','similitud','frecuencia_hora','longitud','mayusculas','repeticion','contacto']
def entrenar(carpeta):
    carpeta=Path(carpeta)
    archivo=carpeta/'escenarios-sinteticos.csv'
    with archivo.open(encoding='utf-8') as entrada: filas=list(csv.DictReader(entrada))
    X=np.array([[float(f[c]) for c in NOMBRES] for f in filas]); y=np.array([int(f['etiqueta']) for f in filas]); grupos=np.array([f['grupo'] for f in filas])
    train,test=next(StratifiedGroupKFold(n_splits=5,shuffle=True,random_state=42).split(X,y,grupos))
    assert not set(grupos[train]) & set(grupos[test])
    modelo=LogisticRegression(C=4,max_iter=1000,random_state=42,class_weight='balanced').fit(X[train],y[train])
    probabilidades=modelo.predict_proba(X[test])[:,list(modelo.classes_).index(1)]
    puntuaciones=np.floor(probabilidades*100+0.5).astype(int)
    prediccion=(puntuaciones>70).astype(int)
    reglas=np.array([int(filas[i]['riesgo_reglas']) for i in test])
    hibrida=(np.maximum(puntuaciones,reglas)>70).astype(int)
    base=DummyClassifier(strategy='most_frequent').fit(X[train],y[train]).predict(X[test])
    def metricas(pred): return {'exactitud':float(accuracy_score(y[test],pred)), 'precision_revisar':float(precision_score(y[test],pred,zero_division=0)), 'recall_revisar':float(recall_score(y[test],pred,zero_division=0)), 'f1_revisar':float(f1_score(y[test],pred,zero_division=0)), 'matriz':confusion_matrix(y[test],pred,labels=[0,1]).tolist()}
    huella=hashlib.sha256(archivo.read_bytes()).hexdigest()
    evaluacion={'origen':'sintetico','sklearn':sklearn.__version__,'escenarios':len(set(grupos)),'variantes':len(filas),'entrenamiento':len(train),'prueba':len(test),'grupos_entrenamiento':sorted(set(grupos[train])),'grupos_prueba':sorted(set(grupos[test])),'umbral':70,'regla_umbral':'puntaje redondeado > 70','orden_clases':['sin_indicios','revisar'],'modelo':metricas(prediccion),'reglas':metricas((reglas>70).astype(int)),'hibrido':metricas(hibrida),'base_mayoritaria':metricas(base),'sha256_dataset':huella,'limitaciones':['Etiquetas ficticias por diseño, sin validación con usuarios reales.','Variantes de un escenario no son ejemplos independientes.','El índice no es una probabilidad calibrada de fraude.','No se detecta colusión ni se garantiza que una reseña sin alerta sea verdadera.','La comparación de políticas es exploratoria; falta una evaluación final independiente con datos reales.'],'casos_prueba':[{'grupo':filas[i]['grupo'],'texto':filas[i]['texto'],'esperada':int(y[i]),'puntaje_modelo':int(puntuaciones[j]),'puntaje_reglas':int(reglas[j]),'prediccion_hibrida':int(hibrida[j])} for j,i in enumerate(test)]}
    (carpeta/'evaluacion.json').write_text(json.dumps(evaluacion,ensure_ascii=False,indent=2),encoding='utf-8')
    artefacto={'version':'riesgo-lr-piloto-v1-'+huella[:12],'origen':'sintetico','clase_positiva':'revisar','indicadores':NOMBRES,'coeficientes':modelo.coef_[0].tolist(),'intercepto':float(modelo.intercept_[0]),'umbral':70,'evaluacion':{k:evaluacion[k] for k in ['escenarios','variantes','entrenamiento','prueba','modelo','hibrido']},'sha256_dataset':huella}
    (carpeta/'modelo-riesgo.json').write_text(json.dumps(artefacto,ensure_ascii=False,indent=2),encoding='utf-8')
    ahora=datetime(2026,11,20,17,tzinfo=timezone.utc)
    casos=[]
    for j,i in enumerate(test):
        previas=json.loads(filas[i]['historial'])
        casos.append({'texto':filas[i]['texto'],'ahora':ahora.isoformat(),'anteriores':[{'comentario':r['comentario'],'creadaEn':(ahora-timedelta(minutes=r['minutos'])).isoformat()} for r in previas],'etiqueta':int(y[i]),'puntajeEsperado':int(puntuaciones[j])})
    (carpeta/'fixtures-predicciones.json').write_text(json.dumps(casos,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:evaluacion[k] for k in ['entrenamiento','prueba','modelo','hibrido','base_mayoritaria']},ensure_ascii=False,indent=2))
    return artefacto,evaluacion

if __name__=='__main__':
    carpeta=Path(__file__).resolve().parent
    artefacto,_=entrenar(carpeta)
    destino=carpeta.parent.parent/'src/resenas/modelo-riesgo.json'
    destino.write_text(json.dumps(artefacto,ensure_ascii=False,indent=2),encoding='utf-8')
    (destino.parent/'fixtures-predicciones-riesgo.json').write_text((carpeta/'fixtures-predicciones.json').read_text(encoding='utf-8'),encoding='utf-8')
