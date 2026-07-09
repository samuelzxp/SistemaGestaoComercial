import pandas as pd
from datetime import datetime
import os
import firebase_admin
from firebase_admin import credentials, db

#* CONFIGURAÇÃO DE CAMINHOS
CAMINHO_DB = r"C:\Users\ti\OneDrive\Documentos\Análise de Dados PHONE STORE\Dados Phone Store Base.xlsx"
URL_BANCO = "https://sistemagestaocomercial-cf852-default-rtdb.firebaseio.com/"

#TODO ==> 0. PROTOCOLO DE ENVIO PARA O FIREBASE
def subir_para_firebase(dados_completos):
    print("☁️ Iniciando protocolo de upload para o Firebase...")
    try:
        # 1. Autenticação Segura (Evita logar duas vezes se o script rodar em loop)
        if not firebase_admin._apps:
            cred = credentials.Certificate("firebase-key.json")
            firebase_admin.initialize_app(cred, {
                'databaseURL': URL_BANCO
            })
        
        # 2. Aponta o laser para a pasta principal e injeta a carga
        ref = db.reference('dashboard_data')
        print("🚀 Enviando pacote de dados... (Isso pode levar de 2 a 5 segundos)")
        
        # O comando .set() sobrescreve a pasta antiga pela nova instantaneamente
        ref.set(dados_completos)
        
        print("✅ ALVO ATINGIDO! Nuvem atualizada com sucesso!")
    except Exception as e:
        print(f"❌ Falha crítica no envio: {e}")

#TODO ==> 1. TRATAMENTO DE DADOS BÁSICOS
#? Função auxiliar para limpeza de dados monetários (R$ -> Float)
def limpar_moedas(valor):
    if isinstance(valor, str):
        valor = valor.replace('R$', '').replace('.', '').replace(',', '.').strip()
        try:
            return float(valor) if valor not in ['-', ''] else 0.0
        except:
            return 0.0
    return float(valor) if pd.notnull(valor) else 0.0

#TODO ==> 2. CARGA PRINCIPAL DO BANCO DE DADOS
#? Lê os arquivos Excel, padroniza as colunas de ID, limpa os valores e retorna os DataFrames
def carregar_banco_dados(mes_referencia=None, ano_referencia=None):
    try:
        print(f"🔍 Conectando aos bancos de dados...")
        
        if not os.path.exists(CAMINHO_DB):
            raise FileNotFoundError("Arquivos de base (.xlsx) não encontrados.")

        #* 1. Carga das Dimensões
        df_lojas = pd.read_excel(CAMINHO_DB, sheet_name='Lojas')
        df_vendedores = pd.read_excel(CAMINHO_DB, sheet_name='D_Vendedores')
        df_planos = pd.read_excel(CAMINHO_DB, sheet_name='D_Plano')
        df_regioes = pd.read_excel(CAMINHO_DB, sheet_name='Regiões')
        df_produtos = pd.read_excel(CAMINHO_DB, sheet_name='Dim_produtos') #* Adicionado para Visão Performance
        
        #* 2. Carga das Vendas Fato
        df_cat = pd.read_excel(CAMINHO_DB, sheet_name='F_Vendas_cat')
        df_plano = pd.read_excel(CAMINHO_DB, sheet_name='F_Vendas_Plano')
        df_prod = pd.read_excel(CAMINHO_DB, sheet_name='F_Vendas_Prod')

        #* 3. Padronização Rigorosa de IDs para cruzamento (Merge)
        def limpar_id(serie):
            # Transforma em string, arranca o ".0" (se houver) e corta espaços em branco
            return serie.astype(str).str.replace(r'\.0$', '', regex=True).str.strip()

        # Aplica a limpeza nas colunas de Lojas (agora cobrindo todas as Fatos)
        for df in [df_lojas, df_cat]: 
            df['ID LOJA'] = limpar_id(df['ID LOJA'])
            
        if 'ID LOJA' in df_prod.columns: 
            df_prod['ID LOJA'] = limpar_id(df_prod['ID LOJA'])
            
        if 'ID LOJA' in df_plano.columns: 
            df_plano['ID LOJA'] = limpar_id(df_plano['ID LOJA'])

        # Aplica a limpeza nas colunas de Vendedores e Planos
        for df in [df_vendedores, df_cat, df_plano]: 
            if 'ID VENDEDOR' in df.columns:
                df['ID VENDEDOR'] = limpar_id(df['ID VENDEDOR'])
                
        for df in [df_planos, df_plano]: 
            if 'ID PLANO' in df.columns:
                df['ID PLANO'] = limpar_id(df['ID PLANO'])

        #* 4. Tratamento e Padronização de Datas
        df_cat['Date'] = pd.to_datetime(df_cat['Date'], dayfirst=True, errors='coerce')
        df_plano['Date'] = pd.to_datetime(df_plano['Date'], dayfirst=True, errors='coerce')
        
        hoje = datetime.now()
        mes = mes_referencia or hoje.month
        ano = ano_referencia or hoje.year

        #* 5. Limpeza de formatação monetária nas colunas de valor
        df_cat['REALIZADO'] = df_cat['REALIZADO'].apply(limpar_moedas)
        df_plano['FATURADO'] = df_plano['FATURADO'].apply(limpar_moedas)
        df_prod['REALIZADO'] = df_prod['REALIZADO'].apply(limpar_moedas)

        #* 6. Filtro de Mês Vigente (Recorte do Snapshot)
        df_snapshot = df_cat[(df_cat['Date'].dt.month == mes) & (df_cat['Date'].dt.year == ano)].copy()
        
        #* 6.1 LÓGICA DE FALLBACK D+1 (Proteção contra virada de mês sem vendas)
        if df_snapshot.empty or df_snapshot['REALIZADO'].sum() == 0:
            print(f"⚠️ Sem vendas registradas para {mes:02d}/{ano}. Acionando Fallback Automático D+1...")
            mes = mes - 1 if mes > 1 else 12
            ano = ano if mes != 12 else ano - 1
            df_snapshot = df_cat[(df_cat['Date'].dt.month == mes) & (df_cat['Date'].dt.year == ano)].copy()
            print(f"🔄 Painel redirecionado para os dados consolidados do mês {mes:02d}/{ano}.")

        #* 7. Carga das Metas do mês correspondente
        metas_pdv = carregar_metas_pdv(mes, ano)
        metas_vend = carregar_metas_vendedor(mes, ano)

        #* 8. Empacotamento de todas as bases para o motor de cálculos
        db_data = {
            'mes_vigente': mes,  # <- CHAVE MESTRA DO FALLBACK
            'ano_vigente': ano,  # <- CHAVE MESTRA DO FALLBACK
            'vendas_snapshot': df_snapshot,
            'vendas_plano': df_plano,
            'vendas_prod': df_prod,
            'vendas_cat_historico': df_cat, 
            'dim_lojas': df_lojas,
            'dim_vendedores': df_vendedores,
            'dim_planos': df_planos,
            'dim_regioes': df_regioes,
            'dim_produtos': df_produtos
        }

        print(f"✅ Sucesso: {len(df_snapshot)} linhas processadas no snapshot do mês {mes:02d}/{ano}.")
        return db_data, metas_pdv, metas_vend

    except Exception as e:
        print(f"❌ Erro no Database Engine: {e}")
        return None, None, None

#TODO ==> 3. PROCESSAMENTO DE METAS
#? Lê a aba de metas do PDV e filtra pelo mês/ano dinamicamente
def carregar_metas_pdv(mes, ano):
    df = pd.read_excel(CAMINHO_DB, sheet_name='F_MetasPDV')
    df.columns = ['Date', 'ID_LOJA', 'META_GERAL', 'META_CEL', 'META_ACE', 'META_SOM', 'META_PRT']
    
    # AJUSTE: Limpeza de ID para evitar falha no cruzamento
    df['ID_LOJA'] = df['ID_LOJA'].astype(str).str.replace(r'\.0$', '', regex=True).str.strip()
    
    #* Aplica limpeza de moeda apenas nas colunas financeiras (da 3ª em diante)
    for col in df.columns[2:]: df[col] = df[col].apply(limpar_moedas)
    
    #* Cria string de referência (ex: '04/26') para filtro exato
    ref = f"{str(mes).zfill(2)}/{str(ano)[2:]}"
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
    df['Date_Str'] = df['Date'].dt.strftime('%m/%y')
    return df[df['Date_Str'] == ref].copy()

#? Lê a aba de metas individuais de vendedores e filtra pelo mês/ano
def carregar_metas_vendedor(mes, ano):
    df = pd.read_excel(CAMINHO_DB, sheet_name='F_MetasVendedor')
    df.columns = ['Date', 'ID_LOJA2', 'ID_VENDEDOR', 'CARGO', 'VENDEDOR', 'PESO_REL', 'META_GERAL', 'META_ACE', 'META_PRT']
    
    # AJUSTE: Limpeza de ID para evitar falha no cruzamento
    df['ID_VENDEDOR'] = df['ID_VENDEDOR'].astype(str).str.replace(r'\.0$', '', regex=True).str.strip()
    
    #* Aplica limpeza de moeda nas colunas de meta
    for col in ['META_GERAL', 'META_ACE', 'META_PRT']: df[col] = df[col].apply(limpar_moedas)
    
    #* Cria string de referência (ex: '04/26') para filtro exato
    ref = f"{str(mes).zfill(2)}/{str(ano)[2:]}"
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce')
    df['Date_Str'] = df['Date'].dt.strftime('%m/%y')
    return df[df['Date_Str'] == ref].copy()