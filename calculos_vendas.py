import pandas as pd
import numpy as np
from datetime import datetime
from calendar import monthrange
import json
import re  

#TODO ==> 1. SISTEMA DE TEMPO E MÉTRICAS DE CALENDÁRIO
#? Função central para controle de períodos e cálculos de projeção (Mês Vigente ou Fallback)
def obter_metricas_tempo(db=None):
    hoje = datetime.now()
    
    #* Se o motor passou pelo fallback, lê o mês ajustado. Caso contrário, usa o mês atual.
    if db and 'mes_vigente' in db and 'ano_vigente' in db:
        mes_atual = db['mes_vigente']
        ano_atual = db['ano_vigente']
    else:
        mes_atual = hoje.month
        ano_atual = hoje.year
        
    #* Cálculo de dias para Projeção e Atingimento Ideal
    _, total_dias = monthrange(ano_atual, mes_atual)
    
    #* Inteligência D+1: Se o mês consultado for o real, usa o dia atual.
    #* Se for de fallback (mês passado fechado), a projeção trava no dia final do mês (100%).
    if mes_atual == hoje.month and ano_atual == hoje.year:
        dia_atual = hoje.day
    else:
        dia_atual = total_dias
        
    atg_ideal = (dia_atual / total_dias) * 100
    
    return {
        "dia": dia_atual,
        "total": total_dias,
        "mes": mes_atual,
        "ano": ano_atual,
        "ideal": round(atg_ideal, 2)
    }

#* Função auxiliar para limpeza de dados monetários (R$ -> Float)
def limpar_moeda(valor):
    if valor is None or (isinstance(valor, float) and np.isnan(valor)):
        return 0.0
    if isinstance(valor, str):
        valor = valor.replace('R$', '').replace('.', '').replace(',', '.').strip()
        try:
            return float(valor) if valor != '' else 0.0
        except ValueError:
            return 0.0
    return float(valor)

#TODO ==> 2. KPIs GERAIS (VISÃO 1 - SNAPSHOT REDE)
#? Consolida os grandes números para os 5 cards do topo
def calcular_kpis_topo(db, df_meta):
    tempo = obter_metricas_tempo(db)
    df_snap = db['vendas_snapshot'].copy()
    
    #* Agregação de Realizados
    fat = df_snap['REALIZADO'].sum()
    vendas = df_snap['N_VENDAS'].sum()
    pecas = df_snap['QTD_PEÇAS'].sum()
    
    #* Agregação de Metas (Sincronizado com ID_LOJA do database_engine)
    meta_geral = df_meta['META_GERAL'].sum() if not df_meta.empty else 0
    
    return {
        'fat': float(fat),
        'vendas': int(vendas),
        'pecas': int(pecas),
        'ticket': float(fat / max(vendas, 1)),
        'pa': float(pecas / max(vendas, 1)),
        'atg_geral': float((fat / meta_geral * 100) if meta_geral > 0 else 0),
        'atg_ideal': tempo['ideal']
    }

#TODO ==> 3. ESTRUTURA TABULAR DE UNIDADES (BASE PARA TODAS AS VISÕES)
#? Cruza Fato e Dimensão para gerar performance por PDV
def preparar_base_unidades_completa(db, df_meta):
    tempo = obter_metricas_tempo(db)
    df_snap = db['vendas_snapshot'].copy()
    df_lojas = db['dim_lojas'].copy()
    
    #* Sanitização de IDs para evitar erro de Merge
    df_meta['ID_LOJA'] = pd.to_numeric(df_meta['ID_LOJA'], errors='coerce').fillna(-1).astype(int).astype(str)
    df_snap['ID LOJA'] = pd.to_numeric(df_snap['ID LOJA'], errors='coerce').fillna(-1).astype(int).astype(str)
    df_lojas['ID LOJA'] = pd.to_numeric(df_lojas['ID LOJA'], errors='coerce').fillna(-1).astype(int).astype(str)

    #* Base de Histórico Diário para a Visão Tabular
    df_snap['Date'] = pd.to_datetime(df_snap['Date'], dayfirst=True, errors='coerce')
    df_cat_daily = df_snap.groupby(['ID LOJA', 'Date', 'CATEGORIA'])['REALIZADO'].sum().unstack(fill_value=0).reset_index()
    for col in ['ACE', 'PRT', 'CEL', 'SOM']:
        if col not in df_cat_daily: df_cat_daily[col] = 0
    df_vendas_daily = df_snap.groupby(['ID LOJA', 'Date']).agg({
        'REALIZADO': 'sum', 'N_VENDAS': 'sum', 'QTD_PEÇAS': 'sum'
    }).reset_index()
    df_daily_master = df_vendas_daily.merge(df_cat_daily, on=['ID LOJA', 'Date'], how='left')

    #* 1. Realizado por Categoria
    rel_cat = df_snap.groupby(['ID LOJA', 'CATEGORIA'])['REALIZADO'].sum().unstack(fill_value=0).reset_index()
    for col in ['ACE', 'PRT', 'CEL', 'SOM']:
        if col not in rel_cat: rel_cat[col] = 0

    #* 1.1 Sazonalidade Quebrada por Loja
    dias_map = {'Monday':'Seg', 'Tuesday':'Ter', 'Wednesday':'Qua', 'Thursday':'Qui', 'Friday':'Sex', 'Saturday':'Sáb', 'Sunday':'Dom'}
    df_snap['Dia_Semana'] = df_snap['Date'].dt.day_name().map(dias_map)
    rel_saz = df_snap.groupby(['ID LOJA', 'Dia_Semana'])['REALIZADO'].sum().unstack(fill_value=0).reset_index()
    ordem_dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
    for dia in ordem_dias:
        if dia not in rel_saz: rel_saz[dia] = 0

    #* 1.2 Mix de Planos Quebrado por Loja
    df_plano = db['vendas_plano'].copy()
    df_plano['ID LOJA'] = pd.to_numeric(df_plano['ID LOJA'], errors='coerce').fillna(-1).astype(int).astype(str)
    
    df_plano['Date'] = pd.to_datetime(df_plano['Date'], dayfirst=True, errors='coerce')
    df_plano_vigente = df_plano[
        (df_plano['Date'].dt.month == tempo['mes']) & 
        (df_plano['Date'].dt.year == tempo['ano'])
    ].copy()
    df_plano_vigente['FATURADO'] = df_plano_vigente['FATURADO'].apply(limpar_moeda)
    df_plano_vigente = df_plano_vigente.merge(db['dim_planos'], on='ID PLANO', how='left')
    
    if not df_plano_vigente.empty:
        rel_planos = df_plano_vigente.groupby(['ID LOJA', 'PLANO'])['FATURADO'].sum().unstack(fill_value=0).reset_index()
    else:
        rel_planos = pd.DataFrame(columns=['ID LOJA'])
    planos_cols = [c for c in rel_planos.columns if c != 'ID LOJA']

    #* 2. Realizado Total por Loja
    rel_total = df_snap.groupby('ID LOJA').agg({
        'REALIZADO': 'sum',
        'N_VENDAS': 'sum',
        'QTD_PEÇAS': 'sum'
    }).reset_index()

    #* 3. Merge de Metas e Realizados
    df_tab = df_meta[['ID_LOJA', 'META_GERAL', 'META_ACE', 'META_PRT']].copy()
    df_tab = df_tab.merge(rel_total, left_on='ID_LOJA', right_on='ID LOJA', how='left').fillna(0)
    df_tab = df_tab.merge(rel_cat[['ID LOJA', 'ACE', 'PRT', 'CEL', 'SOM']], on='ID LOJA', how='left').fillna(0)
    df_tab = df_tab.merge(rel_saz[['ID LOJA'] + ordem_dias], on='ID LOJA', how='left').fillna(0)
    if planos_cols:
        df_tab = df_tab.merge(rel_planos, on='ID LOJA', how='left').fillna(0)
    
    #* 4. Merge com Dimensão Lojas
    df_tab = df_tab.merge(df_lojas[['ID LOJA', 'NOME PDV', 'ID TIPO', 'TIPO PDV']], 
                          left_on='ID_LOJA', right_on='ID LOJA', how='left')

    #* 5. Métricas Calculadas
    df_tab['PROJECAO_VAL'] = (df_tab['REALIZADO'] / tempo['dia']) * tempo['total']
    df_tab['PROJECAO_PERC'] = (df_tab['PROJECAO_VAL'] / df_tab['META_GERAL'] * 100).replace([np.inf, -np.inf], 0).fillna(0)
    df_tab['TICKET'] = df_tab['REALIZADO'] / df_tab['N_VENDAS'].replace(0, 1)
    df_tab['PA'] = df_tab['QTD_PEÇAS'] / df_tab['N_VENDAS'].replace(0, 1)
    
    #* Meta Diária Restante
    dias_restantes = max(tempo['total'] - tempo['dia'], 1)
    df_tab['META_DIARIA'] = (df_tab['META_GERAL'] - df_tab['REALIZADO']) / dias_restantes
    
    #* 6. Empacotamento de Dicionários para o Frontend (JS)
    df_tab['sazonalidade'] = df_tab.apply(lambda row: {dia: row.get(dia, 0) for dia in ordem_dias}, axis=1)
    df_tab['mix_categorias'] = df_tab.apply(lambda row: {c: row.get(c, 0) for c in ['CEL', 'SOM', 'ACE', 'PRT']}, axis=1)
    if planos_cols:
        df_tab['mix_planos'] = df_tab.apply(lambda row: {p: row.get(p, 0) for p in planos_cols}, axis=1)
    else:
        df_tab['mix_planos'] = df_tab.apply(lambda row: {}, axis=1) 

    #* Anexando o Histórico Diário
    def gerar_historico(id_loja):
        vendas_loja = df_daily_master[df_daily_master['ID LOJA'] == id_loja].copy()
        if vendas_loja.empty: return []
        vendas_loja['Date'] = vendas_loja['Date'].dt.strftime('%Y-%m-%d')
        return vendas_loja.to_dict(orient='records')

    df_tab['historico_diario'] = df_tab['ID_LOJA'].apply(gerar_historico)

    return df_tab.to_dict(orient='records')

#TODO ==> 4. ANÁLISE OPERACIONAL (SAZONALIDADE E MIXES)
#? Gera os dados para gráficos da Visão Geral
def preparar_analise_geral_completa(db):
    tempo = obter_metricas_tempo(db)
    df_snap = db['vendas_snapshot'].copy()
    
    #* 4.1 Sazonalidade
    dias_map = {'Monday':'Seg', 'Tuesday':'Ter', 'Wednesday':'Qua', 'Thursday':'Qui', 'Friday':'Sex', 'Saturday':'Sáb', 'Sunday':'Dom'}
    df_snap['Date'] = pd.to_datetime(df_snap['Date'], dayfirst=True, errors='coerce')
    df_snap['Dia_Semana'] = df_snap['Date'].dt.day_name().map(dias_map)
    ordem_dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
    sazonalidade = df_snap.groupby('Dia_Semana')['REALIZADO'].sum().reindex(ordem_dias).fillna(0).to_dict()

    #* 4.2 Mix de Categorias
    mix_cat = df_snap.groupby('CATEGORIA')['REALIZADO'].sum().to_dict()

    #* 4.3 Mix de Planos
    df_plano = db['vendas_plano'].copy()
    df_plano['Date'] = pd.to_datetime(df_plano['Date'], dayfirst=True, errors='coerce')
    df_plano_vigente = df_plano[
        (df_plano['Date'].dt.month == tempo['mes']) & 
        (df_plano['Date'].dt.year == tempo['ano'])
    ].copy()
    
    df_plano_vigente['FATURADO'] = df_plano_vigente['FATURADO'].apply(limpar_moeda)
    df_plano_vigente = df_plano_vigente.merge(db['dim_planos'], on='ID PLANO', how='left')
    mix_planos = df_plano_vigente.groupby('PLANO')['FATURADO'].sum().sort_values(ascending=False).to_dict()

    return {
        'sazonalidade': sazonalidade,
        'mix_categorias': mix_cat,
        'mix_planos': mix_planos
    }

#TODO ==> 4.5 ESTRUTURA TABULAR DE VENDEDORES (MOTOR DO COCKPIT DE RANKING)
#? Cruza Fato, Dimensão e aplica rateio de metas proporcionais
def preparar_base_vendedores_completa(db, df_metas_pdv, df_metas_vend):
    df_snap = db['vendas_snapshot'].copy()
    df_lojas = db['dim_lojas'].copy()

    #* TRATAMENTO: LIMPEZA DE DADOS (DEDUPLICAÇÃO)
    df_snap['VENDEDOR'] = df_snap['VENDEDOR'].astype(str).str.replace(r'\s*\(\s*\d+\s*\)$', '', regex=True).str.strip().str.upper()

    #* 1. Agrupamento Básico do Vendedor
    base_vend = df_snap.groupby(['ID VENDEDOR', 'VENDEDOR', 'ID LOJA']).agg({
        'REALIZADO': 'sum',
        'QTD_PEÇAS': 'sum',
        'N_VENDAS': 'sum'
    }).reset_index()

    #* 2. Pivot de Categorias (Gera colunas: CEL, ACE, SOM, PRT)
    cat_vend = df_snap.groupby(['ID VENDEDOR', 'CATEGORIA'])['REALIZADO'].sum().unstack(fill_value=0).reset_index()
    for c in ['CEL', 'ACE', 'SOM', 'PRT']:
        if c not in cat_vend: cat_vend[c] = 0

    base_vend = base_vend.merge(cat_vend[['ID VENDEDOR', 'CEL', 'ACE', 'SOM', 'PRT']], on='ID VENDEDOR', how='left').fillna(0)

    #* 3. Merge com Lojas para puxar Atributos (ID TIPO)
    base_vend = base_vend.merge(df_lojas[['ID LOJA', 'ID TIPO']], on='ID LOJA', how='left')

    #* 4. Tratamento Inteligente de Metas
    if not df_metas_vend.empty:
        metas = df_metas_vend[['ID_VENDEDOR', 'META_GERAL', 'META_ACE', 'META_PRT']].copy()
        metas['ID_VENDEDOR'] = metas['ID_VENDEDOR'].astype(str)
        base_vend = base_vend.merge(metas, left_on='ID VENDEDOR', right_on='ID_VENDEDOR', how='left')
    else:
        base_vend['META_GERAL'] = np.nan
        base_vend['META_ACE'] = np.nan
        base_vend['META_PRT'] = np.nan

    #* 4.1 Cálculo da Meta Proporcional (Descobre quantos vendedores a loja tem)
    qtd_vendedores = base_vend.groupby('ID LOJA')['ID VENDEDOR'].nunique().reset_index()
    qtd_vendedores.rename(columns={'ID VENDEDOR': 'QTD_VEND_LOJA'}, inplace=True)
    base_vend = base_vend.merge(qtd_vendedores, on='ID LOJA', how='left')

    #* 4.2 Puxa a meta total da Loja
    if not df_metas_pdv.empty:
        metas_loja = df_metas_pdv[['ID_LOJA', 'META_GERAL', 'META_ACE', 'META_PRT']].copy()
        metas_loja.columns = ['ID LOJA', 'META_LOJA_GERAL', 'META_LOJA_ACE', 'META_LOJA_PRT']
        metas_loja['ID LOJA'] = metas_loja['ID LOJA'].astype(str)
        base_vend = base_vend.merge(metas_loja, on='ID LOJA', how='left')
    else:
        base_vend['META_LOJA_GERAL'] = 0
        base_vend['META_LOJA_ACE'] = 0
        base_vend['META_LOJA_PRT'] = 0

    #* 4.3 Aplica o Rateio
    base_vend['META_GERAL'] = base_vend['META_GERAL'].fillna(base_vend['META_LOJA_GERAL'] / base_vend['QTD_VEND_LOJA'].replace(0, 1))
    base_vend['META_ACE'] = base_vend['META_ACE'].fillna(base_vend['META_LOJA_ACE'] / base_vend['QTD_VEND_LOJA'].replace(0, 1))
    base_vend['META_PRT'] = base_vend['META_PRT'].fillna(base_vend['META_LOJA_PRT'] / base_vend['QTD_VEND_LOJA'].replace(0, 1))
    base_vend.fillna(0, inplace=True)

    #* 5. Cálculo dos KPIs de Qualidade Individual
    base_vend['TICKET'] = base_vend['REALIZADO'] / base_vend['N_VENDAS'].replace(0, 1)
    base_vend['PA'] = base_vend['QTD_PEÇAS'] / base_vend['N_VENDAS'].replace(0, 1)

    #* 6. Padronização de Nomes para o JavaScript
    base_vend.rename(columns={
        'VENDEDOR': 'NOME VENDEDOR',
        'ID LOJA': 'ID_LOJA'
    }, inplace=True)

    return base_vend.to_dict(orient='records')

#TODO ==> 4.6 PERFORMANCE DE PRODUTOS E TEMPO (NOVO MOTOR DE LIMPEZA INTELIGENTE)
#? Função avançada para extrair o Modelo Canônico e a Capacidade (GB/RAM)
def limpar_nome_produto(nome_sujo):
    if pd.isna(nome_sujo):
        return "DESCONHECIDO"
        
    nome = str(nome_sujo).upper().strip().replace('"', '')
    
    # 1. Remove ID no final (ex: (1422))
    nome = re.sub(r'\s*\(\s*\d+\s*\)\s*$', '', nome)
    
    # 2. Tratamento Inteligente do Traço (-)
    if '-' in nome:
        partes = nome.split('-')
        partes_mantidas = [partes[0]]
        for p in partes[1:]:
            if re.search(r'\d', p) or 'GB' in p or 'RAM' in p:
                partes_mantidas.append(p)
        nome = ' '.join(partes_mantidas)
        
    # 3. Remove termos genéricos que sujam o agrupamento
    termos_remover = [
        r'\bCELULAR\b', r'\bSMARTPHONE\b', r'\bBARRINHA\b', r'\bTABLET\b',
        r'\bFONE BLUETOOTH\b', r'\bVITRINE\b', r'\bSEMINOVO\b', r'\bSEMI NOVO\b',
        r'\bANATEL\b', r'\bLOJA\b', r'\bKIT\b', r'\bINTERNET VIA SATELITE\b'
    ]
    for termo in termos_remover:
        nome = re.sub(termo, '', nome)
        
    # 4. Filtro de Cores (Dicionário Reverso)
    cores = [
        'PRETO', 'BRANCO', 'AZUL', 'VERDE', 'CINZA', 'PRATA', 'DOURADO', 'ROSA',
        'ROXO', 'LARANJA', 'COBRE', 'GRAFITE', 'LILAC', 'VIOLET', 'PURPLE',
        'RED', 'RUBY', 'ORANGE', 'YELLOW', 'AMARILLO', 'NEGRO', 'BLANCO',
        'CAFE', 'LILA', 'CORAL', 'BLACK', 'WHITE', 'BLUE', 'GREEN', 'GREY',
        'GRAY', 'SILVER', 'GOLD', 'TITANIUM', 'MIDNIGHT', 'STARLIGHT', 'OCEAN',
        'MAGIC', 'SKIN', 'ORBIT', 'STARTRAIL', 'GLITTERY', 'SWAN', 'FOREST',
        'PEACOCK', 'KINGFISHER', 'PARROT', 'LIGHTNING', 'STARRY', 'LUNAR',
        'SANDY', 'ICE', 'MINT', 'WAVE', 'SANDSTONE', 'AURORA', 'STARLIT',
        'MARBLE', 'VOYAGE', 'SAFARI', 'WILDERNESS', 'BEACH', 'OBSIDIAN', 'MIST'
    ]
    regex_cores = r'\b(?:' + '|'.join(cores) + r')\b'
    nome = re.sub(regex_cores, '', nome)
    
    # 5. Padroniza os separadores e limpa espaços duplos
    nome = nome.replace('/', ' ').replace('\\', ' ')
    nome = re.sub(r'\s+', ' ', nome).strip()
    
    return nome if nome else "PRODUTO SEM NOME"

#? Função auxiliar para definir o Tier
def classificar_tier(preco):
    if preco < 1100: return 'Low'
    elif preco < 1500: return 'Mid-E'
    elif preco < 2000: return 'Mid-S'
    elif preco <= 4000: return 'High'
    else: return 'Super High'

#? Motor para cruzamento de Produtos e Tiers
def preparar_base_produtos(df_dim_produtos, df_fatos_produtos):
    if df_dim_produtos.empty or df_fatos_produtos.empty:
        return []

    #* Preparação da Tabela da Verdade
    df_dim = df_dim_produtos.copy()
    df_dim['PRODUTO_LIMPO'] = df_dim['PRODUTO'].apply(limpar_nome_produto)
    
    if df_dim['PREÇO'].dtype == 'object':
        df_dim['PREÇO'] = df_dim['PREÇO'].apply(limpar_moeda)
        
    dim_agrupada = df_dim.groupby('PRODUTO_LIMPO')['PREÇO'].mean().reset_index()
    dim_agrupada['TIER'] = dim_agrupada['PREÇO'].apply(classificar_tier)
    
    #* Preparação da Tabela de Vendas
    df_fatos = df_fatos_produtos.copy()
    df_fatos['PRODUTO_LIMPO'] = df_fatos['PRODUTO'].apply(limpar_nome_produto)
    
    #* Merge
    df_final = df_fatos.merge(dim_agrupada[['PRODUTO_LIMPO', 'TIER']], on='PRODUTO_LIMPO', how='left')
    df_final['TIER'] = df_final['TIER'].fillna('Sem Categoria')
    
    colunas_finais = ['AnoMes', 'PDV', 'CATEGORIA', 'PRODUTO_LIMPO', 'TIER', 'QTD_FAT', 'REALIZADO']
    colunas_existentes = [col for col in colunas_finais if col in df_final.columns]
    
    df_dashboard = df_final[colunas_existentes].copy()
    df_dashboard.rename(columns={'PRODUTO_LIMPO': 'PRODUTO'}, inplace=True)
    
    #* Blindagem: Garante que o AnoMes volte a ser String, evitando erro de Timestamp
    if 'AnoMes' in df_dashboard.columns:
        df_dashboard['AnoMes'] = df_dashboard['AnoMes'].astype(str)
        
    return df_dashboard.to_dict(orient='records')

#? Motor para análise Quadrimestral via F_vendas_cat
def preparar_tendencia_temporal(df_fatos_cat):
    if df_fatos_cat.empty or 'Date' not in df_fatos_cat.columns:
        return []
        
    df = df_fatos_cat.copy()
    df['Date'] = pd.to_datetime(df['Date'], dayfirst=True, errors='coerce')
    
    if df['REALIZADO'].dtype == 'object':
        df['REALIZADO'] = df['REALIZADO'].apply(limpar_moeda)
        
    #* Identifica a coluna correta de Loja e injeta no agrupamento (Fallback de segurança)
    col_id = 'ID LOJA' if 'ID LOJA' in df.columns else 'ID_LOJA'
    if col_id not in df.columns:
        df[col_id] = 'ALL' 

    df['data_formatada'] = df['Date'].dt.strftime('%Y-%m-%d')
    
    #* Agora o GroupBy abraça também o ID da Loja!
    agrupado = df.groupby(['data_formatada', col_id])['REALIZADO'].sum().reset_index()
    
    #* Renomeia exatamente para as chaves que o JavaScript espera
    agrupado.rename(columns={'data_formatada': 'data', 'REALIZADO': 'faturamento', col_id: 'ID_LOJA'}, inplace=True)
    agrupado = agrupado.sort_values('data')
    
    return agrupado.to_dict(orient='records')

#TODO ==> 5. EXPORTADOR DE DADOS (INTEGRAÇÃO FIREBASE)
#? Compila todas as métricas em um JSON estruturado e envia diretamente para o Realtime Database
def exportar_dados_dashboard(db_data, df_metas_pdv, df_metas_vend, caminho_destino=None):
    try:
        #* Importa o motor de envio do database_engine dinamicamente
        from database_engine import subir_para_firebase

        #* Garantia de datas formatadas no Snapshot
        db_data['vendas_snapshot']['Date'] = pd.to_datetime(db_data['vendas_snapshot']['Date'], dayfirst=True, errors='coerce')
        
        #* Prepara a dimensão Regiões para o JSON (Quadrante 4)
        df_regioes = db_data.get('dim_regioes', pd.DataFrame()).copy()
        if not df_regioes.empty and 'ID LOJA' in df_regioes.columns:
            df_regioes.rename(columns={'ID LOJA': 'ID_LOJA', 'LOCALIZAÇÃO': 'LOCALIZACAO'}, inplace=True)
            df_regioes['ID_LOJA'] = df_regioes['ID_LOJA'].astype(str)
            regioes_export = df_regioes.to_dict(orient='records')
        else:
            regioes_export = []
        
        #* Construção do Dicionário Final (Payload que o Front-End espera)
        payload = {
            "ultima_atualizacao": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "tempo": obter_metricas_tempo(db_data), # <-- Aqui ativamos a leitura do Fallback no JSON Final
            "geral": calcular_kpis_topo(db_data, df_metas_pdv),
            "unidades": preparar_base_unidades_completa(db_data, df_metas_pdv),
            "analise_geral": preparar_analise_geral_completa(db_data),
            "regioes": regioes_export,
            "vendedores": preparar_base_vendedores_completa(db_data, df_metas_pdv, df_metas_vend),
            
            #* Adição da visão de Performance e Tempo ao Payload
            "produtos": preparar_base_produtos(db_data.get('dim_produtos', pd.DataFrame()), db_data.get('vendas_prod', pd.DataFrame())),
            "historico_dias": preparar_tendencia_temporal(db_data.get('vendas_cat_historico', pd.DataFrame()))
        }
        
        #* Converte o dicionário para o formato JSON nativo antes do upload
        dados_json_puros = json.loads(json.dumps(payload, default=str))
        subir_para_firebase(dados_json_puros)
        
        print("✅ Sucesso: Métricas processadas e transmitidas com segurança para a Nuvem!")
        return True
    except Exception as e:
        print(f"❌ Erro Crítico no Processamento/Envio: {e}")
        return False