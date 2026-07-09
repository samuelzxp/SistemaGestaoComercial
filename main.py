# main.py
import database_engine
from calculos_vendas import exportar_dados_dashboard

def rodar_sistema():
    print("🚀 SISTEMA SMART-COMER | Iniciando...")
    
    # 1. Carrega o Banco de Dados
    db, metas_pdv, metas_vend = database_engine.carregar_banco_dados()
    
    if db is None or metas_pdv is None:
        print("❌ Abortando: Falha crítica na leitura dos arquivos Excel.")
        return

    # 2. Processa cálculos e exporta para dashboard/dados.js
    # Passamos os 3 objetos necessários para o calculos_vendas.py
    sucesso = exportar_dados_dashboard(db, metas_pdv, metas_vend)
    print(len(metas_pdv))
    
    if sucesso:
        print("🏁 PROCESSO FINALIZADO COM SUCESSO!")
        print("👉 Abra o arquivo index.html no navegador para visualizar.")
    else:
        print("❌ Falha na geração do arquivo de saída (dados.js).")

if __name__ == "__main__":
    rodar_sistema()