import firebase_admin
from firebase_admin import credentials, db
from datetime import datetime

cred = credentials.Certificate("firebase-key.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': "https://sistemagestaocomercial-cf852-default-rtdb.firebaseio.com/"
})

UID = "Ri0iLC8RJWhOjbIdM053KlKvtAv1"
EMAIL = "samuelvitorbc23@gmail.com"
NOME = "Samuel"

db.reference(f'usuarios/{UID}').set({
    "nome": "Samuel",
    "email": "samuelvitorbc23@gmail.com",
    "status": "master",
    "role": "MASTER",
    "loja_id": "ALL",
    "data_criacao": datetime.now().isoformat()
})

print("Usuário master criado com sucesso!")

# Confirma a leitura de volta
print(db.reference(f'usuarios/{UID}').get())