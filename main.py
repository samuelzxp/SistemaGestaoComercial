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

    # 1.1 Trava de segurança: sem metas do mês, 'unidades' sairia vazio e zeraria o dashboard
    ref_mes = f"{db['mes_vigente']:02d}/{db['ano_vigente']}"
    if metas_pdv.empty:
        print(f"❌ Abortando: a aba F_MetasPDV não tem linhas para {ref_mes}.")
        print("   Nada foi enviado. O dashboard continua exibindo os dados anteriores.")
        return
    print(f"📋 Metas de loja carregadas para {ref_mes}: {len(metas_pdv)}")

    # 2. Processa cálculos e exporta para dashboard/dados.js
    # Passamos os 3 objetos necessários para o calculos_vendas.py
    sucesso = exportar_dados_dashboard(db, metas_pdv, metas_vend)
    
    if sucesso:
        print("🏁 PROCESSO FINALIZADO COM SUCESSO! O dashboard já está com os dados novos.")
    else:
        print("❌ PROCESSO FINALIZADO COM FALHA: nada foi enviado. O dashboard continua com os dados anteriores.")

if __name__ == "__main__":
    rodar_sistema()