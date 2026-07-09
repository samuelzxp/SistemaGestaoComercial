import firebase_admin
from firebase_admin import credentials, db

cred = credentials.Certificate("firebase-key.json")
firebase_admin.initialize_app(cred, {
    'databaseURL': "https://sistemagestaocomercial-cf852-default-rtdb.firebaseio.com/"
})

usuarios = db.reference('usuarios').get()
print(usuarios)