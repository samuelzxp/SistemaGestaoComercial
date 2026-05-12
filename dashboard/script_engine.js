// Configuração Global do Chart.js
Chart.register(ChartDataLabels);

// Estado Global da Aplicação
const AppState = { 
    filtro: { loja: 'ALL', modelo: 'ALL', gestao: 'ALL', dataInicio: '', dataFim: '' },
    sort: { coluna: 'faturamento', direcao: 'desc' },
    ranking: { ref: 'vendedor', metrica: 'REALIZADO', nomeMetrica: 'Geral' },
    perf: { 
        top10: { pdv: 'ALL', metrica: 'ALL' }, 
        bottom10: { pdv: 'ALL', metrica: 'ALL' }, 
        mesVigente: '', // NOVA TRAVA DE MÊS
        meses: [] 
    }
};

const CORES = {
    primary: '#f8b518',
    ace: '#2d5128',     // Verde (Sucesso)
    prt: '#bd0000',     // Vermelho (Alerta)
    trilha: '#121212',
    texto: '#888888',
    rastro: '#878787'
};

const PALETAS_MIX = {
    categorias:{ 'CEL': '#efe800', 'ACE': '#ffc72c', 'SOM': '#fff55e', 'PRT': '#f0d900' },
    planos: { 'CREDIÁRIO': '#ffd700', 'DINHEIRO': '#efcc25', 'CARTÃO': '#ebe000', 'BRASIL CARD': '#FFEE00', 'ODRES F': '#ebc400' }
};

// ==========================================
// INICIALIZAÇÃO
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof dadosDashboard === 'undefined') {
        console.error("❌ Erro: dados.js não encontrado.");
        return;
    }
    
    configurarEventosFiltro();
    configurarEventosTabela();
    configurarEventosRanking(); 
    
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);
    
    // Timeout para aguardar o auth.js validar a sessão do Firebase
    setTimeout(() => { if (window.usuarioLogado) processarEDataRender(); }, 500);
    
    iniciarRoteamento();
});

// Só re-renderiza se houver um usuário logado validado
window.addEventListener('resize', () => { if (window.usuarioLogado) processarEDataRender(); });

// ==========================================
// MOTOR DE FILTRAGEM GLOBAL (MACRO)
// ==========================================
// Adicionado o parâmetro 'ignoreStoreFilter' para a visão da Rede
function filtrarBase(base, ignoreStoreFilter = false) {
    if (!base) return [];
    return base.filter(item => {
        const id = Number(item['ID TIPO']);
        const modeloItem = (id === 1 || id === 2) ? 'LOJA' : 'QUIOSQUE';
        const gestaoItem = (id === 1 || id === 3) ? 'PRÓPRIA' : 'FRANQUIA';

        let matchLoja = true;
        if (!ignoreStoreFilter) {
            matchLoja = AppState.filtro.loja === 'ALL' || String(item['ID_LOJA']) === String(AppState.filtro.loja);
        }
        
        const matchModelo = AppState.filtro.modelo === 'ALL' || modeloItem === AppState.filtro.modelo;
        const matchGestao = AppState.filtro.gestao === 'ALL' || gestaoItem === AppState.filtro.gestao;

        return matchLoja && matchModelo && matchGestao;
    });
}

// ==========================================
// ORQUESTRADOR DE RENDERIZAÇÃO
// ==========================================
function processarEDataRender() {
    // 1. TRAVA DE SEGURANÇA: Só renderiza se estiver logado
    if (!window.usuarioLogado) return;

    const isLider = window.usuarioLogado.role === 'LIDER';
    const userLoja = String(window.usuarioLogado.loja_id);

    // 2. APLICAÇÃO DA VISÃO TÚNEL (RBAC)
    if (isLider) {
        // Trava o AppState na loja do Líder
        AppState.filtro.loja = userLoja;
        
        // Esconde o dropdown de loja no topo
        const elFiltroLoja = document.getElementById('container-filtro-loja');
        if (elFiltroLoja) elFiltroLoja.style.display = 'none';

        // Trava os dropdowns da aba Performance
        ['top10', 'bottom10'].forEach(id => {
            const sel = document.getElementById(`filtro-pdv-${id}`);
            if (sel) {
                sel.value = userLoja;
                sel.disabled = true;
                sel.style.opacity = '0.5';
            }
            AppState.perf[id].pdv = userLoja;
        });
    } else {
        // Se for Master/Diretor, garante que os filtros apareçam
        const elFiltroLoja = document.getElementById('container-filtro-loja');
        if (elFiltroLoja && document.getElementById('visao-geral').classList.contains('active')) {
            elFiltroLoja.style.display = 'flex';
        }
        ['top10', 'bottom10'].forEach(id => {
            const sel = document.getElementById(`filtro-pdv-${id}`);
            if (sel) { sel.disabled = false; sel.style.opacity = '1'; }
        });
    }

    const d = dadosDashboard;
    const atingIdeal = d.tempo?.ideal ?? 0;
    
    // 3. CRIAÇÃO DAS DUAS REALIDADES
    // baseLocal = Respeita o filtro de loja (Líder só vê a dele)
    // baseRede = Ignora o filtro de loja (Líder vê a rede toda na aba Unidades)
    const baseLocal = filtrarBase(d.unidades, false);
    const baseRede = filtrarBase(d.unidades, true);

    // --- VISÃO GERAL (TÚNEL SE LIDER) ---
    const stats = baseLocal.reduce((acc, curr) => {
        acc.faturamento += curr.REALIZADO || 0;
        acc.vendas += curr.N_VENDAS || 0;
        acc.pecas += curr.QTD_PEÇAS || 0;
        return acc;
    }, { faturamento: 0, vendas: 0, pecas: 0 });

    renderKpiCards(stats);

    const metas = baseLocal.reduce((acc, curr) => {
        acc.real_g += curr.REALIZADO || 0; acc.meta_g += curr.META_GERAL || 0;
        acc.real_a += curr.ACE || 0; acc.meta_a += curr.META_ACE || 0;
        acc.real_p += curr.PRT || 0; acc.meta_p += curr.META_PRT || 0;
        return acc;
    }, { real_g: 0, meta_g: 0, real_a: 0, meta_a: 0, real_p: 0, meta_p: 0 });

    renderGauge('chart-atg-geral', (metas.real_g / (metas.meta_g || 1) * 100), 'val-geral', atingIdeal);
    renderGauge('chart-atg-ace', (metas.real_a / (metas.meta_a || 1) * 100), 'val-ace', atingIdeal);
    renderGauge('chart-atg-prt', (metas.real_p / (metas.meta_p || 1) * 100), 'val-prt', atingIdeal);

    const dynSaz = { 'Seg': 0, 'Ter': 0, 'Qua': 0, 'Qui': 0, 'Sex': 0, 'Sáb': 0, 'Dom': 0 };
    const dynCat = { 'CEL': 0, 'SOM': 0, 'ACE': 0, 'PRT': 0 };
    const dynPlanos = {};

    baseLocal.forEach(loja => {
        const sazLocal = loja.sazonalidade || {};
        Object.keys(sazLocal).forEach(dia => { if(dynSaz.hasOwnProperty(dia)) dynSaz[dia] += sazLocal[dia] || 0; });

        const catLocal = loja.mix_categorias || {};
        Object.keys(catLocal).forEach(cat => { if(dynCat.hasOwnProperty(cat)) dynCat[cat] += catLocal[cat] || 0; });

        const planosLocal = loja.mix_planos || {};
        Object.keys(planosLocal).forEach(plano => {
            dynPlanos[plano] = (dynPlanos[plano] || 0) + (planosLocal[plano] || 0);
        });
    });

    const planosFinal = Object.fromEntries(Object.entries(dynPlanos).filter(([_, v]) => v > 0));

    renderSazonalidade(dynSaz);
    renderMixDonut('chart-mix-cat', dynCat, PALETAS_MIX.categorias);
    renderMixDonut('chart-mix-planos', planosFinal, PALETAS_MIX.planos);

    // --- VISÃO UNIDADES (REDE TODA) ---
    // Precisamos de um objeto de metas total para a Rede poder calcular o ritmo total da rede
    const metasRede = baseRede.reduce((acc, curr) => {
        acc.real_g += curr.REALIZADO || 0; acc.meta_g += curr.META_GERAL || 0;
        return acc;
    }, { real_g: 0, meta_g: 0 });

    renderCardsUnidades(baseRede, metasRede, d.tempo);
    renderGraficosHibridos(baseRede); 
    renderTabelaUnidades(baseRede, d.tempo);

    // --- VISÃO VENDEDORES (TÚNEL SE LIDER, EXCETO MAPA DE REGIÕES) ---
    renderVisaoVendedores(baseLocal);

    // --- VISÃO PERFORMANCE (PRODUTOS) ---
    if (typeof renderVisaoPerformance === 'function') {
        renderVisaoPerformance(); // Filtros PDV já foram travados no topo desta função
    }

    document.getElementById('last-update').innerText = d.ultima_atualizacao;
}

// ==========================================
// [VEND] MÓDULOS DA VISÃO VENDEDORES (COCKPIT)
// ==========================================

function configurarEventosRanking() {
    document.querySelectorAll('.btn-ranking-ref').forEach(btn => btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-ranking-ref').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        AppState.ranking.ref = e.currentTarget.getAttribute('data-ref'); 
        processarEDataRender();
    }));

    document.querySelectorAll('.btn-ranking-metric').forEach(btn => btn.addEventListener('click', (e) => {
        // Trava: Ignora botões da aba de performance para evitar conflito
        if (e.currentTarget.hasAttribute('data-target-chart')) return;
        
        document.querySelectorAll('.btn-ranking-metric:not([data-target-chart])').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        AppState.ranking.metrica = e.currentTarget.getAttribute('data-metric');
        AppState.ranking.nomeMetrica = e.currentTarget.innerText; 
        processarEDataRender();
    }));
}

function inicializarFiltroLojas(lojasUnicas, d) {
    const containerMetas = document.getElementById('quad-metas');
    if (!containerMetas) return;
    
    const filtroNativo = document.getElementById('filtro-metas-interno');
    if (filtroNativo) filtroNativo.style.display = 'none';

    if (document.getElementById('custom-dropdown-lojas')) return;

    const header = containerMetas.querySelector('.ranking-header');
    
    const ui = document.createElement('div');
    ui.id = 'custom-dropdown-lojas';
    ui.style.cssText = 'position: relative; min-width: 160px; font-family: var(--font-body); z-index: 100;';
    
    let optionsHtml = `<label style="display: flex; gap: 8px; padding: 6px; cursor: pointer; color: #fff; font-size: 0.75rem;"><input type="checkbox" value="ALL" checked class="cb-filtro-loja"> Selecionar Todas</label>`;
    
    lojasUnicas.forEach(idLoja => {
        let lojaNome = `Loja ${idLoja}`;
        if (d.unidades) {
            const lojaData = d.unidades.find(u => String(u['ID_LOJA']) === String(idLoja));
            if (lojaData) lojaNome = lojaData['NOME PDV'];
        }
        optionsHtml += `<label style="display: flex; gap: 8px; padding: 6px; cursor: pointer; color: #fff; font-size: 0.75rem;"><input type="checkbox" value="${idLoja}" class="cb-filtro-loja"> ${lojaNome}</label>`;
    });

    ui.innerHTML = `
        <div id="btn-drop-lojas" style="background: #1a1a1a; border: 1px solid var(--border); padding: 8px 12px; border-radius: 6px; cursor: pointer; color: var(--text-main); font-size: 0.75rem; display: flex; justify-content: space-between; align-items: center; font-weight: 600;">
            <span id="lbl-drop-lojas">Todas as Lojas</span>
            <span class="material-symbols-outlined" style="font-size: 16px;">expand_more</span>
        </div>
        <div id="list-drop-lojas" style="display: none; position: absolute; top: 100%; right: 0; width: 220px; background: #121212; border: 1px solid var(--border); border-radius: 6px; margin-top: 5px; max-height: 200px; overflow-y: auto; padding: 5px; box-shadow: 0 5px 15px rgba(0,0,0,0.8);">
            ${optionsHtml}
        </div>
    `;
    
    header.appendChild(ui);

    const btn = document.getElementById('btn-drop-lojas');
    const lista = document.getElementById('list-drop-lojas');
    const cbs = document.querySelectorAll('.cb-filtro-loja');

    // Se for Líder, esconde o botão de filtro, pois ele já tem visão túnel
    if (window.usuarioLogado && window.usuarioLogado.role === 'LIDER') {
        btn.style.display = 'none';
    }

    btn.addEventListener('click', () => {
        lista.style.display = lista.style.display === 'none' ? 'block' : 'none';
    });

    cbs.forEach(cb => cb.addEventListener('change', (e) => {
        if(e.target.value === 'ALL' && e.target.checked) {
            cbs.forEach(c => { if(c.value !== 'ALL') c.checked = false; });
        } else if (e.target.checked) {
            document.querySelector('.cb-filtro-loja[value="ALL"]').checked = false;
        }
        processarEDataRender();
    }));

    document.addEventListener('click', (e) => {
        if(!ui.contains(e.target)) lista.style.display = 'none';
    });
}

// ==========================================
// MOTOR DE DEDUPLICAÇÃO E LIMPEZA
// ==========================================
function unificarBase(base, ref) {
    const mapaMesmaLoja = {};
    base.forEach(v => {
        let nomeCru = (ref === 'pdv' ? (v['NOME PDV'] || 'N/A') : (v['NOME VENDEDOR'] || 'N/A')).trim();
        let nomeLimpo = nomeCru.replace(/\s*\(\s*\d+\s*\)\s*$/, '').replace(/\s+/g, ' ').toUpperCase();
        let chaveIdentidade = nomeLimpo + "_" + v['ID_LOJA'];

        if (!mapaMesmaLoja[chaveIdentidade]) {
            mapaMesmaLoja[chaveIdentidade] = { ...v, NOME_LIMPO: nomeLimpo, NOME_CRU: nomeCru };
        }
    });

    const agrupadoFinal = {};
    Object.values(mapaMesmaLoja).forEach(v => {
        let nome = v.NOME_LIMPO;
        if (!agrupadoFinal[nome]) {
            agrupadoFinal[nome] = { 
                ...v, 
                [ref === 'pdv' ? 'NOME PDV' : 'NOME VENDEDOR']: v.NOME_CRU,
                REALIZADO: 0, CEL: 0, ACE: 0, SOM: 0, PRT: 0, 
                QTD_PEÇAS: 0, N_VENDAS: 0, 
                META_GERAL: 0, META_ACE: 0, META_PRT: 0 
            };
        }
        
        let agg = agrupadoFinal[nome];
        agg.REALIZADO += (v.REALIZADO || 0);
        agg.CEL += (v.CEL || 0);
        agg.ACE += (v.ACE || 0);
        agg.SOM += (v.SOM || 0);
        agg.PRT += (v.PRT || 0);
        agg.QTD_PEÇAS += (v.QTD_PEÇAS || 0);
        agg.N_VENDAS += (v.N_VENDAS || 0);

        agg.META_GERAL = Math.max(agg.META_GERAL, (v.META_GERAL || 0));
        agg.META_ACE = Math.max(agg.META_ACE, (v.META_ACE || 0));
        agg.META_PRT = Math.max(agg.META_PRT, (v.META_PRT || 0));
    });

    Object.values(agrupadoFinal).forEach(obj => {
        obj.TICKET = obj.N_VENDAS > 0 ? (obj.REALIZADO / obj.N_VENDAS) : 0;
        obj.PA = obj.N_VENDAS > 0 ? (obj.QTD_PEÇAS / obj.N_VENDAS) : 0;
    });

    return Object.values(agrupadoFinal);
}

function calcularScoreVendedores(vendedoresBase) {
    const validos = vendedoresBase.filter(v => (v.REALIZADO || 0) > 0);
    if (validos.length === 0) return;

    const calcStats = (arr) => {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        const std = Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length) || 1; 
        return { mean, std };
    };

    const statsFat = calcStats(validos.map(v => v.REALIZADO || 0));
    const statsTicket = calcStats(validos.map(v => v.TICKET || 0));
    const statsPA = calcStats(validos.map(v => v.PA || 0));
    const statsAtg = calcStats(validos.map(v => (v.META_GERAL > 0 ? (v.REALIZADO / v.META_GERAL) * 100 : 0)));

    vendedoresBase.forEach(v => {
        if (!v.REALIZADO) { v.SCORE_FINAL = 0; return; }
        
        const atg = v.META_GERAL > 0 ? (v.REALIZADO / v.META_GERAL) * 100 : 0;
        
        const zFat = ((v.REALIZADO || 0) - statsFat.mean) / statsFat.std;
        const zTicket = ((v.TICKET || 0) - statsTicket.mean) / statsTicket.std;
        const zPA = ((v.PA || 0) - statsPA.mean) / statsPA.std;
        const zAtg = (atg - statsAtg.mean) / statsAtg.std;

        const darNota = (z) => Math.min(10, Math.max(0, 5 + (z * 1.66)));
        
        v.NOTA_FAT = darNota(zFat);
        v.NOTA_TICKET = darNota(zTicket);
        v.NOTA_PA = darNota(zPA);
        v.NOTA_ATG = darNota(zAtg);

        v.SCORE_FINAL = (v.NOTA_FAT * 0.3) + (v.NOTA_ATG * 0.3) + (v.NOTA_TICKET * 0.2) + (v.NOTA_PA * 0.2);
    });
}

function renderVisaoVendedores(baseUnidadesLocal) {
    const d = dadosDashboard;
    const { ref, metrica, nomeMetrica } = AppState.ranking;

    const isLider = window.usuarioLogado && window.usuarioLogado.role === 'LIDER';
    const userLoja = window.usuarioLogado ? String(window.usuarioLogado.loja_id) : 'ALL';

    const aplicarFiltroTopo = (base) => base.filter(item => {
        const idTipo = Number(item['ID TIPO'] || 0);
        const matchModelo = AppState.filtro.modelo === 'ALL' || ((idTipo === 1 || idTipo === 2) ? 'LOJA' : 'QUIOSQUE') === AppState.filtro.modelo;
        const matchGestao = AppState.filtro.gestao === 'ALL' || ((idTipo === 1 || idTipo === 3) ? 'PRÓPRIA' : 'FRANQUIA') === AppState.filtro.gestao;
        return matchModelo && matchGestao;
    });

    let baseRawRanking = ref === 'pdv' ? [...baseUnidadesLocal] : (d.vendedores ? [...d.vendedores] : []);
    let baseRawConsultores = d.vendedores ? [...d.vendedores] : [];

    baseRawRanking = aplicarFiltroTopo(baseRawRanking);
    baseRawConsultores = aplicarFiltroTopo(baseRawConsultores);

    // O Lider tem visão túnel dos seus vendedores, rankings, pódios
    if (isLider) {
        baseRawRanking = baseRawRanking.filter(v => String(v['ID_LOJA']) === userLoja);
        baseRawConsultores = baseRawConsultores.filter(v => String(v['ID_LOJA']) === userLoja);
    }

    const baseRanking = unificarBase(baseRawRanking, ref);
    const baseConsultores = unificarBase(baseRawConsultores, 'vendedor');

    // ===================================
    // QUADRANTE 1: Ranking Dinâmico
    // ===================================
    const tituloEl = document.getElementById('ranking-title');
    if (tituloEl) tituloEl.innerText = `Ranking - Visão ${nomeMetrica}`;
    
    if (baseRanking.length > 0) {
        const baseRank = [...baseRanking].sort((a, b) => (b[metrica] || 0) - (a[metrica] || 0)).slice(0, 10);
        const labels = baseRank.map(i => ref === 'pdv' ? (i['NOME PDV'] || 'N/A') : (i['NOME VENDEDOR'] || 'N/A'));
        const valores = baseRank.map(i => i[metrica] || 0);
        desenharGraficoRanking('chart-ranking', labels, valores, metrica);
    }

    // ===================================
    // QUADRANTES 2, 3 e 4
    // ===================================
    if (baseConsultores.length > 0) {
        calcularScoreVendedores(baseConsultores);

        const lojasUnicas = [...new Set(baseRawConsultores.map(v => v['ID_LOJA']))];
        inicializarFiltroLojas(lojasUnicas, d);

        let baseMetas;
        if (isLider) {
            baseMetas = baseConsultores; // Líder já está filtrado
        } else {
            const checkboxes = document.querySelectorAll('.cb-filtro-loja:checked');
            let lojasSelecionadas = Array.from(checkboxes).map(cb => cb.value);
            if (lojasSelecionadas.length === 0) lojasSelecionadas = ['ALL'];

            if (lojasSelecionadas.includes('ALL')) {
                baseMetas = baseConsultores;
            } else {
                const rawFiltrada = baseRawConsultores.filter(v => lojasSelecionadas.includes(String(v['ID_LOJA'])));
                baseMetas = unificarBase(rawFiltrada, 'vendedor');
            }
        }
            
        renderPodioMetas(baseMetas);
        renderHeatmapScore(baseConsultores);
        
        // MAPA DE REGIÕES: Exceção da regra! O Lider vê o mapa com a rede toda calculada.
        let baseRegioesRaw = d.vendedores ? [...d.vendedores] : [];
        baseRegioesRaw = aplicarFiltroTopo(baseRegioesRaw);
        const baseConsultoresRedeCompleta = unificarBase(baseRegioesRaw, 'vendedor');
        calcularScoreVendedores(baseConsultoresRedeCompleta);
        desenharMelhoresRegioes('chart-melhores-regioes', baseConsultoresRedeCompleta, d);
    }
}

let chartRankingInstancia = null;
let chartRegioesInstancia = null; 

function desenharGraficoRanking(id, labels, valores, metrica) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (chartRankingInstancia) chartRankingInstancia.destroy();
    
    const corBarra = PALETAS_MIX.categorias[metrica] || CORES.primary;
    
    chartRankingInstancia = new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: valores, backgroundColor: corBarra, borderRadius: 4, barThickness: 16 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            layout: { padding: { right: 60, left: 2 } },
            plugins: { 
                legend: { display: false }, 
                datalabels: { 
                    anchor: 'end', align: 'right', color: '#c6c6c6', font: { size: 10, weight: 'bold' }, clip: false,
                    formatter: (v) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)
                } 
            },
            scales: { 
                x: { display: false, grace: '30%' }, 
                y: { 
                    grid: { display: false }, 
                    ticks: { 
                        color: '#fff', font: { size: 10, weight: 'bold', family: 'Inter, sans-serif' },
                        crossAlign: 'near', align: 'start', padding: 5 
                    } 
                } 
            }
        }
    });
}

function renderPodioMetas(base) {
    document.querySelectorAll('.podio-avatar').forEach(el => {
        el.innerHTML = `<span class="material-symbols-outlined" style="font-size: 36px; text-shadow: 0 4px 10px rgba(0,0,0,0.5);">military_tech</span>`;
    });
    document.querySelector('.pos-1 .podio-avatar span').style.color = '#f8b518'; 
    document.querySelector('.pos-2 .podio-avatar span').style.color = '#e0e0e0'; 
    document.querySelector('.pos-3 .podio-avatar span').style.color = '#cd7f32'; 

    base.forEach(v => {
        const atgGeral = v.META_GERAL > 0 ? (v.REALIZADO / v.META_GERAL) * 100 : 0;
        const atgAce = v.META_ACE > 0 ? (v.ACE / v.META_ACE) * 100 : 0;
        const atgPrt = v.META_PRT > 0 ? (v.PRT / v.META_PRT) * 100 : 0;
        v.MEDIA_METAS = (atgGeral + atgAce + atgPrt) / 3;
    });

    const top3 = [...base].sort((a, b) => (b.MEDIA_METAS || 0) - (a.MEDIA_METAS || 0)).slice(0, 3);

    const atualizarPosicao = (posId, index) => {
        const cons = top3[index];
        const elNome = document.getElementById(`podio-nome-${posId}`);
        const elNota = document.getElementById(`podio-nota-${posId}`);
        
        if (elNome && elNota) {
            if (cons && cons.MEDIA_METAS > 0 && cons['NOME VENDEDOR']) {
                const nomeQuebrado = cons['NOME VENDEDOR'].replace(/\s+/g, ' ').split(" ");
                const nomeFormatado = nomeQuebrado[0] + (nomeQuebrado.length > 1 ? " " + nomeQuebrado[1] : "");
                elNome.innerText = nomeFormatado;
                elNota.innerText = `${cons.MEDIA_METAS.toFixed(1)}%`;
            } else {
                elNome.innerText = '--';
                elNota.innerText = '0%';
            }
        }
    };

    atualizarPosicao(1, 0); 
    atualizarPosicao(2, 1); 
    atualizarPosicao(3, 2); 
}

function renderHeatmapScore(base) {
    const container = document.getElementById('container-heatmap');
    if (!container) return;

    const top5 = [...base].sort((a, b) => (b.SCORE_FINAL || 0) - (a.SCORE_FINAL || 0)).slice(0, 5);

    const getCorCalor = (nota) => {
        if (nota >= 8) return 'rgba(45, 81, 40, 0.8)';
        if (nota >= 5) return 'rgba(248, 181, 24, 0.6)';
        return 'rgba(189, 0, 0, 0.6)';
    };

    let html = `<table class="heatmap-table">
        <thead>
            <tr>
                <th>Consultor</th>
                <th>Score</th>
                <th>Geral</th>
                <th>Faturamento</th>
                <th>Ticket</th>
                <th>P.A.</th>
            </tr>
        </thead>
        <tbody>`;

    top5.forEach(v => {
        const atg = v.META_GERAL > 0 ? (v.REALIZADO / v.META_GERAL) * 100 : 0;
        html += `<tr>
            <td class="nome-vend">${v['NOME VENDEDOR'] || 'N/A'}</td>
            <td style="font-weight: 800; color: #e0e0e0;">${(v.SCORE_FINAL || 0).toFixed(1)}</td>
            <td style="background-color: ${getCorCalor(v.NOTA_ATG)}">${atg.toFixed(1)}%</td>
            <td style="background-color: ${getCorCalor(v.NOTA_FAT)}">${fmt(v.REALIZADO)}</td>
            <td style="background-color: ${getCorCalor(v.NOTA_TICKET)}">${fmt(v.TICKET)}</td>
            <td style="background-color: ${getCorCalor(v.NOTA_PA)}">${(v.PA || 0).toFixed(2)}</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

function desenharMelhoresRegioes(id, baseConsultores, d) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (chartRegioesInstancia) chartRegioesInstancia.destroy();

    const scoreRegiao = {};
    const countRegiao = {};

    baseConsultores.forEach(v => {
        if (v.SCORE_FINAL > 0) {
            let regiaoStr = 'Sem Região';
            const idLojaStr = String(v['ID_LOJA']);

            if (d.regioes) {
                const r = d.regioes.find(loc => String(loc['ID_LOJA']) === idLojaStr);
                if (r && (r.LOCALIZACAO || r['cidade - estado'] || r.REGIAO)) {
                    regiaoStr = r.LOCALIZACAO || r['cidade - estado'] || r.REGIAO;
                }
            }
            
            if (regiaoStr === 'Sem Região' && d.unidades) {
                const u = d.unidades.find(loc => String(loc['ID_LOJA']) === idLojaStr);
                if (u) {
                    regiaoStr = u.REGIAO || u.LOCALIZACAO || u['cidade - estado'] || u['NOME PDV'] || 'Sem Região';
                }
            }

            regiaoStr = regiaoStr.toUpperCase();

            scoreRegiao[regiaoStr] = (scoreRegiao[regiaoStr] || 0) + v.SCORE_FINAL;
            countRegiao[regiaoStr] = (countRegiao[regiaoStr] || 0) + 1;
        }
    });

    const mediaRegiao = Object.keys(scoreRegiao).map(r => ({
        regiao: r, media: scoreRegiao[r] / countRegiao[r]
    })).sort((a, b) => b.media - a.media).slice(0, 5);

    const labels = mediaRegiao.map(r => r.regiao);
    const dados = mediaRegiao.map(r => r.media);

    chartRegioesInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dados,
                backgroundColor: [CORES.ace, CORES.primary, '#895129', '#555', CORES.prt],
                borderWidth: 1, borderColor: '#121212'
            }]
        },
        options: {
            cutout: '60%', responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#888', font: { size: 10 }, boxWidth: 12 } },
                datalabels: { color: '#fff', font: { weight: 'bold', size: 10 }, formatter: (v) => v.toFixed(1) }
            }
        }
    });
}

function renderCardsUnidades(baseRede, metasRede, tempo) {
    const diasTotalMes = tempo?.total ?? 30;
    const diaAtual = tempo?.dia ?? 1;

    const fatDiarioRede = {};
    const metaDiariaOriginalRede = {};
    
    baseRede.forEach(loja => {
        const metaGerLocal = loja.META_GERAL || 0;
        const metaDiariaOrigLocal = metaGerLocal / diasTotalMes; 
        
        if (loja.historico_diario && Array.isArray(loja.historico_diario)) {
            loja.historico_diario.forEach(diaExtrato => {
                const data = diaExtrato.Date;
                if (!fatDiarioRede[data]) {
                    fatDiarioRede[data] = 0;
                    metaDiariaOriginalRede[data] = 0;
                }
                fatDiarioRede[data] += diaExtrato.REALIZADO || 0;
                metaDiariaOriginalRede[data] += metaDiariaOrigLocal;
            });
        }
    });

    const datasOrdenadas = Object.keys(fatDiarioRede).sort((a,b) => new Date(a) - new Date(b));
    let fatD1 = 0;
    let fatD2 = 0;
    let crescimento = 0;

    if (datasOrdenadas.length > 0) {
        const dataD1 = datasOrdenadas[datasOrdenadas.length - 1]; 
        fatD1 = fatDiarioRede[dataD1];
        
        if (datasOrdenadas.length > 1) {
            const dataD2 = datasOrdenadas[datasOrdenadas.length - 2]; 
            fatD2 = fatDiarioRede[dataD2];
            
            if (fatD2 > 0) {
                crescimento = ((fatD1 - fatD2) / fatD2) * 100;
            }
        }
    }

    let totalDiasAvaliados = 0;
    let diasMetaBatida = 0;
    datasOrdenadas.forEach(data => {
        totalDiasAvaliados++;
        if (fatDiarioRede[data] >= metaDiariaOriginalRede[data]) diasMetaBatida++;
    });
    const constancia = totalDiasAvaliados > 0 ? (diasMetaBatida / totalDiasAvaliados) * 100 : 0;

    const esperadoHoje = (metasRede.meta_g / diasTotalMes) * diaAtual;
    const gapRitmo = metasRede.real_g - esperadoHoje;

    const elFatD1 = document.querySelector('#kpi-uni-fat-d1 b');
    const elCresc = document.getElementById('val-crescimento-d1');
    if (elFatD1) elFatD1.innerText = fmt(fatD1);
    if (elCresc) {
        if (datasOrdenadas.length > 1) {
            const icone = crescimento >= 0 ? '▲' : '▼';
            const cor = crescimento >= 0 ? CORES.ace : CORES.prt;
            elCresc.innerHTML = `<span style="color: ${cor}">${icone} ${Math.abs(crescimento).toFixed(1)}%</span>`;
        } else {
            elCresc.innerHTML = `<span style="color: var(--text-dim)">--</span>`;
        }
    }

    const elEsperado = document.querySelector('#kpi-uni-esperado b');
    if (elEsperado) elEsperado.innerText = fmt(esperadoHoje);

    const elGap = document.querySelector('#kpi-uni-gap b');
    if (elGap) {
        elGap.innerText = fmt(gapRitmo);
        elGap.style.color = gapRitmo >= 0 ? CORES.ace : CORES.prt;
    }

    const elConst = document.querySelector('#kpi-uni-constancia b');
    if (elConst) {
        elConst.innerText = `${constancia.toFixed(1)}%`;
        if (constancia >= 80) elConst.style.color = CORES.ace;
        else if (constancia >= 50) elConst.style.color = CORES.primary;
        else elConst.style.color = CORES.prt;
    }
}

function renderGraficosHibridos(baseFiltrada) {
    const dadosModelo = {
        'LOJA': { fat: 0, meta: 0 },
        'QUIOSQUE': { fat: 0, meta: 0 }
    };

    baseFiltrada.forEach(loja => {
        const id = Number(loja['ID TIPO']);
        const modelo = (id === 1 || id === 2) ? 'LOJA' : 'QUIOSQUE';
        dadosModelo[modelo].fat += loja.REALIZADO || 0;
        dadosModelo[modelo].meta += loja.META_GERAL || 0;
    });

    const labelsModelo = Object.keys(dadosModelo);
    const faturamentoModelo = labelsModelo.map(m => dadosModelo[m].fat);
    const atingimentoModelo = labelsModelo.map(m => (dadosModelo[m].meta > 0 ? (dadosModelo[m].fat / dadosModelo[m].meta) * 100 : 0));

    renderComboModelo('chart-hibrido-modelo', labelsModelo, faturamentoModelo, atingimentoModelo);

    const timelinePropria = {};
    const timelineFranquia = {};

    baseFiltrada.forEach(loja => {
        const id = Number(loja['ID TIPO']);
        const gestao = (id === 1 || id === 3) ? 'PRÓPRIA' : 'FRANQUIA';
        
        if (loja.historico_diario && Array.isArray(loja.historico_diario)) {
            loja.historico_diario.forEach(dia => {
                const dataStr = dia.Date; 
                if (gestao === 'PRÓPRIA') {
                    timelinePropria[dataStr] = (timelinePropria[dataStr] || 0) + (dia.REALIZADO || 0);
                } else {
                    timelineFranquia[dataStr] = (timelineFranquia[dataStr] || 0) + (dia.REALIZADO || 0);
                }
            });
        }
    });

    const datasOrdenadas = Object.keys({...timelinePropria, ...timelineFranquia}).sort((a,b) => new Date(a) - new Date(b));
    const datasetPropria = datasOrdenadas.map(d => timelinePropria[d] || 0);
    const datasetFranquia = datasOrdenadas.map(d => timelineFranquia[d] || 0);
    
    const labelsDatas = datasOrdenadas.map(d => d.split('-')[2]);

    renderLinhasGestao('chart-hibrido-gestao', labelsDatas, datasetPropria, datasetFranquia);
}

function renderComboModelo(id, labels, dataFat, dataAting) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (Chart.getChart(ctx)) Chart.getChart(ctx).destroy();

    new Chart(ctx, {
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'bar', label: 'Faturamento', data: dataFat, backgroundColor: '#895129',
                    borderRadius: 4, yAxisID: 'y', order: 2
                },
                {
                    type: 'line', label: 'Atingimento %', data: dataAting, borderColor: '#fff',
                    borderWidth: 2, pointBackgroundColor: CORES.ace, tension: 0.4, yAxisID: 'y1', order: 1,
                    datalabels: { align: 'top', formatter: (v) => v.toFixed(1) + '%' }
                }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                datalabels: {
                    color: '#c6c6c6', font: { size: 10, weight: 'bold' },
                    formatter: (v, context) => {
                        if (context.dataset.type === 'line') return v.toFixed(1) + '%';
                        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(v);
                    }
                }
            },
            scales: {
                y: { display: false, position: 'left' },
                y1: { display: false, position: 'right', min: 0, max: Math.max(...dataAting) + 20 },
                x: { grid: { display: false }, ticks: { color: '#888', font: { size: 10 } } }
            }
        }
    });
}

function renderLinhasGestao(id, labels, dataPropria, dataFranquia) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (Chart.getChart(ctx)) Chart.getChart(ctx).destroy();

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'PRÓPRIA', data: dataPropria, borderColor: CORES.primary, borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false },
                { label: 'FRANQUIA', data: dataFranquia, borderColor: '#555', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: true, position: 'top', align: 'end', labels: { color: '#888', boxWidth: 10, font: { size: 10 } } },
                datalabels: { display: false } 
            },
            scales: {
                y: { display: true, grid: { color: '#1a1a1a' }, ticks: { color: '#444', font: { size: 8 }, callback: (v) => 'R$ ' + (v/1000) + 'k' } },
                x: { grid: { display: false }, ticks: { color: '#888', font: { size: 9 } } }
            }
        }
    });
}

// ==========================================
// TABELA DINÂMICA
// ==========================================
function configurarEventosTabela() {
    const headers = document.querySelectorAll('th[data-sort]');
    headers.forEach(th => {
        th.addEventListener('click', () => {
            const colunaAlvo = th.getAttribute('data-sort');
            
            if (AppState.sort.coluna === colunaAlvo) {
                AppState.sort.direcao = AppState.sort.direcao === 'desc' ? 'asc' : 'desc';
            } else {
                AppState.sort.coluna = colunaAlvo;
                AppState.sort.direcao = 'desc';
            }
            
            document.querySelectorAll('.sort-icon').forEach(icon => icon.innerText = '');
            const seta = AppState.sort.direcao === 'desc' ? ' ↓' : ' ↑';
            th.querySelector('.sort-icon').innerText = seta;

            processarEDataRender();
        });
    });

    const thFat = document.querySelector('th[data-sort="faturamento"] .sort-icon');
    if(thFat) thFat.innerText = ' ↓';
}

function renderTabelaUnidades(baseFiltrada, tempo) {
    const tbody = document.getElementById('tbody-unidades');
    if (!tbody) return;
    tbody.innerHTML = ''; 
    
    const atingIdeal = tempo?.ideal ?? 0;
    const { dataInicio, dataFim } = AppState.filtro;
    const usaFiltroData = dataInicio !== '' || dataFim !== '';

    const baseTabela = baseFiltrada.map(loja => {
        const l = { ...loja }; 
        
        if (usaFiltroData) {
            const start = dataInicio || '2000-01-01';
            const end = dataFim || '2100-12-31';
            
            let fatPeriodo = 0;
            let diasComVendaNoPeriodo = 0;
            
            if (l.historico_diario) {
                l.historico_diario.forEach(dia => {
                    if (dia.Date >= start && dia.Date <= end) {
                        fatPeriodo += (dia.REALIZADO || 0);
                        diasComVendaNoPeriodo++;
                    }
                });
            }

            l.REALIZADO = fatPeriodo;
            
            const diasTotalMes = tempo?.total ?? 30;
            l.PROJECAO_VAL = diasComVendaNoPeriodo > 0 ? (fatPeriodo / diasComVendaNoPeriodo) * diasTotalMes : 0;
            l.PROJECAO_PERC = l.META_GERAL > 0 ? (l.PROJECAO_VAL / l.META_GERAL) * 100 : 0;
        }
        return l;
    });

    let somaTicket = 0, somaPA = 0, countReal = 0;
    baseTabela.forEach(l => { 
        somaTicket += (l.TICKET || 0); 
        somaPA += (l.PA || 0); 
        countReal++;
    });
    const avgTicket = countReal > 0 ? somaTicket / countReal : 0;
    const avgPA = countReal > 0 ? somaPA / countReal : 0;

    const baseOrdenada = [...baseTabela].sort((a, b) => {
        let valA, valB;
        const col = AppState.sort.coluna;
        const dir = AppState.sort.direcao === 'asc' ? 1 : -1;

        const fatA = a.REALIZADO || 0, metaA = a.META_GERAL || 0;
        const fatB = b.REALIZADO || 0, metaB = b.META_GERAL || 0;

        if (col === 'loja') {
            return (a['NOME PDV'] || '').localeCompare(b['NOME PDV'] || '') * dir;
        } else if (col === 'meta') { valA = metaA; valB = metaB; }
        else if (col === 'faturamento') { valA = fatA; valB = fatB; }
        else if (col === 'ating_geral') { valA = metaA > 0 ? fatA/metaA : 0; valB = metaB > 0 ? fatB/metaB : 0; }
        else if (col === 'projecao_val') { valA = a.PROJECAO_VAL || 0; valB = b.PROJECAO_VAL || 0; }
        else if (col === 'meta_diaria') { valA = Math.max(0, metaA-fatA); valB = Math.max(0, metaB-fatB); }
        else if (col === 'ticket') { valA = a.TICKET || 0; valB = b.TICKET || 0; }
        else if (col === 'pa') { valA = a.PA || 0; valB = b.PA || 0; }
        else { valA = 0; valB = 0; }

        return (valA > valB ? 1 : valA < valB ? -1 : 0) * dir;
    });

    const diasRestantesMes = Math.max((tempo?.total ?? 30) - (tempo?.dia ?? 1), 1);

    // Variáveis para destacar a loja do Líder
    const isLider = window.usuarioLogado && window.usuarioLogado.role === 'LIDER';
    const userLoja = window.usuarioLogado ? String(window.usuarioLogado.loja_id) : '';

    baseOrdenada.forEach(loja => {
        const idLoja = String(loja['ID_LOJA']);
        const pdv = loja['NOME PDV'] || 'N/A';
        const meta = loja.META_GERAL || 0;
        const fat = loja.REALIZADO || 0;
        
        const atingGeral = meta > 0 ? (fat / meta) * 100 : 0;
        
        let metaDiaria = (meta - fat) / diasRestantesMes;
        if (metaDiaria < 0) metaDiaria = 0; 

        const projVal = loja.PROJECAO_VAL || 0;
        const projPerc = loja.PROJECAO_PERC || 0;
        const ticket = loja.TICKET || 0;
        const pa = loja.PA || 0;

        let corProj = 'var(--text-main)';
        if (projPerc >= 100) corProj = CORES.ace; 
        else if (projPerc >= 80) corProj = CORES.primary; 
        else corProj = CORES.prt; 

        let corAting = CORES.prt;
        if (atingGeral >= atingIdeal) corAting = CORES.ace;
        else if (atingGeral >= atingIdeal * 0.8) corAting = CORES.primary;

        const iconTicket = ticket >= avgTicket 
            ? `<span style="color: ${CORES.ace}; font-size: 10px; margin-left: 4px;" title="Acima da média da rede">▲</span>` 
            : `<span style="color: ${CORES.prt}; font-size: 10px; margin-left: 4px;" title="Abaixo da média da rede">▼</span>`;
            
        const iconPA = pa >= avgPA 
            ? `<span style="color: ${CORES.ace}; font-size: 10px; margin-left: 4px;" title="Acima da média da rede">▲</span>` 
            : `<span style="color: ${CORES.prt}; font-size: 10px; margin-left: 4px;" title="Abaixo da média da rede">▼</span>`;

        const isMinhaLoja = isLider && idLoja === userLoja;
        const bgTr = isMinhaLoja ? 'background-color: rgba(248, 181, 24, 0.1); border-left: 3px solid var(--primary);' : '';

        const tr = document.createElement('tr');
        tr.style.cssText = bgTr;
        tr.innerHTML = `
            <td style="font-weight: 700; color: ${isMinhaLoja ? 'var(--primary)' : 'inherit'};">${isMinhaLoja ? `⭐ ${pdv}` : pdv}</td>
            <td>${fmt(meta)}</td>
            <td>${fmt(fat)}</td>
            <td style="color: ${corAting}; font-weight: 700;">${atingGeral.toFixed(1)}%</td>
            <td style="color: ${corProj}; font-weight: 800;">${fmt(projVal)}</td>
            <td style="color: var(--text-dim);">${fmt(metaDiaria)}</td>
            <td>${fmt(ticket)} ${iconTicket}</td>
            <td>${pa.toFixed(2)} ${iconPA}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// FUNÇÕES AUXILIARES GERAIS
// ==========================================

function renderKpiCards(stats) {
    document.querySelector('#kpi-fat b').innerText = fmt(stats.faturamento);
    document.querySelector('#kpi-vendas b').innerText = stats.vendas.toLocaleString();
    document.querySelector('#kpi-pecas b').innerText = stats.pecas.toLocaleString();
    document.querySelector('#kpi-ticket b').innerText = fmt(stats.faturamento / Math.max(stats.vendas, 1));
    document.querySelector('#kpi-pa b').innerText = (stats.pecas / Math.max(stats.vendas, 1)).toFixed(2);
}

function renderSazonalidade(dados) {
    const ctx = document.getElementById('chart-sazonalidade');
    if (!ctx) return;
    if (Chart.getChart(ctx)) Chart.getChart(ctx).destroy();

    new Chart(ctx, {
        type: 'bar',
        data: { labels: Object.keys(dados), datasets: [{ data: Object.values(dados), backgroundColor: CORES.primary, borderRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
            plugins: {
                legend: { display: false },
                datalabels: { 
                    display: true, anchor: 'end', align: 'end', color: '#888', font: { size: 10, weight: 'bold' },
                    formatter: (v) => v === 0 ? '' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(v)
                }
            },
            scales: { y: { grid: { color: '#1a1a1a', borderDash: [2, 2] }, ticks: { display: false }, beginAtZero: true, grace: '10%' }, x: { grid: { display: false }, ticks: { color: '#888', font: { size: 10 } } } }
        }
    });
}

function renderMixDonut(id, dados, paleta) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (Chart.getChart(ctx)) Chart.getChart(ctx).destroy();

    new Chart(ctx, {
        type: 'doughnut',
        data: { labels: Object.keys(dados), datasets: [{ data: Object.values(dados), backgroundColor: Object.keys(dados).map(chave => paleta[chave] || '#444444'), borderColor: '#121212', borderWidth: 2 }] },
        options: { 
            layout: { padding: { top: 10, bottom: 5, left: 25, right: 25 } }, radius: 70, cutout: 55, responsive: true, maintainAspectRatio: false,
            plugins: { 
                legend: { position: 'bottom', labels: { color: '#888', font: { size: 10 }, padding: 20, boxWidth: 10 } },
                datalabels: { anchor: 'end', align: 'end', offset: 8, color: '#fff', font: { size: 10, weight: 'bold' },
                    formatter: (v, ctx) => { 
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0); 
                        if (total === 0) return '';
                        const perc = (v / total) * 100;
                        return perc >= 2 ? perc.toFixed(1) + '%' : ''; 
                    }
                }
            }
        }
    });
}

function obterCorGauge(valorAtual, valorIdeal) {
    if (!valorIdeal) return CORES.trilha;
    const lim = valorIdeal * 0.8;
    if (valorAtual >= valorIdeal) return CORES.ace;
    if (valorAtual >= lim) return CORES.primary;
    return CORES.prt;
}

function renderGauge(id, valor, labelId, atingIdeal) {
    const ctx = document.getElementById(id);
    if (!ctx || Chart.getChart(ctx)) if(ctx) Chart.getChart(ctx).destroy();
    const v = Math.min(100, Math.max(0, valor));
    const cor = obterCorGauge(valor, atingIdeal);
    document.getElementById(labelId).innerText = `${v.toFixed(1)}%`;
    new Chart(ctx, { 
        type: 'doughnut', 
        data: { datasets: [{ data: [v, 100 - v], backgroundColor: [cor, CORES.rastro], borderWidth: 0 }] },
        options: { cutout: '88%', responsive: true, maintainAspectRatio: false, plugins: { datalabels: { display: false }, tooltip: { enabled: false } } }
    });
}

function configurarEventosFiltro() {
    const selLoja = document.getElementById('filter-loja');
    if (selLoja && dadosDashboard.unidades) {
        dadosDashboard.unidades.forEach(l => {
            const opt = document.createElement('option');
            opt.value = l['ID_LOJA']; opt.innerText = l['NOME PDV'];
            selLoja.appendChild(opt);
        });
    }

    const ids = ['filter-loja', 'filter-modelo', 'filter-gestao', 'filter-date-start', 'filter-date-end'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', e => {
            if (id === 'filter-date-start') AppState.filtro.dataInicio = e.target.value;
            else if (id === 'filter-date-end') AppState.filtro.dataFim = e.target.value;
            else AppState.filtro[id.replace('filter-', '')] = e.target.value;
            
            processarEDataRender();
        });
    });
}

function fmt(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v); }
function atualizarRelogio() { const el = document.getElementById('relogio'); if (el) el.innerText = new Date().toLocaleTimeString(); }

// ==========================================
// ROTEAMENTO SPA (CONTROLE DAS ABAS)
// ==========================================
function iniciarRoteamento() {
    const botoesMenu = document.querySelectorAll('.nav-item[data-target]');
    const secoes = document.querySelectorAll('.view-section');
    const tituloPagina = document.getElementById('current-view-title');
    
    const filtroLoja = document.getElementById('container-filtro-loja');
    const filtroData = document.getElementById('container-filtro-data');

    function aplicarRegraDeFiltros(targetId) {
        // Regra de Ocultação Mestra: Se for líder, NUNCA mostra o filtro de Loja Top
        const isLider = window.usuarioLogado && window.usuarioLogado.role === 'LIDER';

        if (targetId === 'visao-geral') {
            if (filtroLoja) filtroLoja.style.display = isLider ? 'none' : 'flex';
            if (filtroData) filtroData.style.display = 'none';
        } else if (targetId === 'visao-unidades') {
            if (filtroLoja) filtroLoja.style.display = 'none';
            if (filtroData) filtroData.style.display = 'flex';
        } else if (targetId === 'visao-vendedores') {
            if (filtroLoja) filtroLoja.style.display = 'none';
            if (filtroData) filtroData.style.display = 'none';
        } else {
            if (filtroLoja) filtroLoja.style.display = 'none';
            if (filtroData) filtroData.style.display = 'none';
        }
    }

    botoesMenu.forEach(botao => {
        botao.addEventListener('click', () => {
            botoesMenu.forEach(b => b.classList.remove('active'));
            secoes.forEach(s => s.classList.remove('active'));

            botao.classList.add('active');

            const targetId = botao.getAttribute('data-target');
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }

            const textoBotao = botao.querySelector('.nav-text');
            if (textoBotao) {
                tituloPagina.innerText = textoBotao.innerText;
            }

            aplicarRegraDeFiltros(targetId);
        });
    });

    aplicarRegraDeFiltros('visao-geral');
}

// ==========================================
// [PERF] MÓDULOS DA VISÃO PERFORMANCE (PRODUTOS)
// ==========================================

let chartTop10 = null;
let chartBottom10 = null;
let chartTier = null;
let chartTempo = null;
let agrupamentoTempoAtual = 'mes'; 
let filtrosPerfInicializados = false; 

function renderVisaoPerformance() {
    const d = dadosDashboard;
    if (!d.produtos || !d.historico_dias) return; 

    const baseProdutos = d.produtos;
    const baseTempo = d.historico_dias;

    inicializarFiltrosPerformance(baseProdutos, d.tempo);

    desenharTop10(baseProdutos);
    desenharBottom10(baseProdutos);
    desenharTiers(baseProdutos);
    
    document.querySelectorAll('.btn-time').forEach(btn => {
        btn.onclick = null; 
        btn.onclick = (e) => {
            document.querySelectorAll('.btn-time').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            agrupamentoTempoAtual = e.target.getAttribute('data-agrupamento');
            desenharTendenciaTemporal(baseTempo);
        };
    });
    desenharTendenciaTemporal(baseTempo);
}

function inicializarFiltrosPerformance(base, tempoObj) {
    if (filtrosPerfInicializados) return;
    
    // Calcula o Mês Vigente Dinamicamente
    const mesesDisponiveis = [...new Set(base.map(i => i.AnoMes))].filter(Boolean).sort();
    let mesAtualStr = String(tempoObj.mes).padStart(2, '0') + '/' + String(tempoObj.ano).slice(-2);
    if (!mesesDisponiveis.includes(mesAtualStr) && mesesDisponiveis.length > 0) {
        mesAtualStr = mesesDisponiveis[mesesDisponiveis.length - 1]; 
    }

    // Identifica se é Líder e força a loja inicial dele (ou ALL se for Master)
    const lojaInicial = (window.usuarioLogado && window.usuarioLogado.role === 'LIDER') ? String(window.usuarioLogado.loja_id) : 'ALL';

    AppState.perf = { 
        top10: { pdv: lojaInicial, metrica: 'ALL' }, 
        bottom10: { pdv: lojaInicial, metrica: 'ALL' }, 
        mesVigente: mesAtualStr, 
        meses: [mesAtualStr] 
    };
    
    const pdvs = [...new Set(base.map(i => i.PDV))].filter(Boolean).sort();
    
    // Filtros de PDV (Exclusivos)
    ['top10', 'bottom10'].forEach(id => {
        const sel = document.getElementById(`filtro-pdv-${id}`);
        if(sel) {
            pdvs.forEach(p => sel.add(new Option(p, p)));
            // Aplica a loja inicial
            sel.value = lojaInicial;
            sel.addEventListener('change', (e) => {
                AppState.perf[id].pdv = e.target.value;
                if(id === 'top10') desenharTop10(base);
                else desenharBottom10(base);
            });
        }
    });

    // Filtros de Métrica/Categoria (Exclusivos)
    document.querySelectorAll('.btn-perf-metric').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetChart = e.target.getAttribute('data-target-chart'); 
            const val = e.target.getAttribute('data-metric');
            
            AppState.perf[targetChart].metrica = val;
            
            document.querySelectorAll(`.btn-perf-metric[data-target-chart="${targetChart}"]`).forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            if(targetChart === 'top10') desenharTop10(base);
            else desenharBottom10(base);
        });
    });

    // Menu Dropdown Customizado de Meses (Tiers)
    const containerMes = document.getElementById('container-filtro-mes-tier');
    if (containerMes) {
        let optionsHtml = '';
        mesesDisponiveis.forEach(m => {
            const checked = m === mesAtualStr ? 'checked' : '';
            optionsHtml += `<label style="display: flex; gap: 8px; padding: 6px; cursor: pointer; color: #fff; font-size: 0.75rem;"><input type="checkbox" value="${m}" class="cb-filtro-mes-tier" ${checked}> ${m}</label>`;
        });

        containerMes.innerHTML = `
            <div id="btn-drop-mes-tier" style="background: #1a1a1a; border: 1px solid var(--border); padding: 4px 10px; border-radius: 6px; cursor: pointer; color: var(--text-main); font-size: 0.75rem; display: flex; justify-content: space-between; align-items: center; font-weight: 600; min-width: 100px;">
                <span id="lbl-drop-mes-tier">Mês: ${mesAtualStr}</span>
                <span class="material-symbols-outlined" style="font-size: 16px;">expand_more</span>
            </div>
            <div id="list-drop-mes-tier" style="display: none; position: absolute; top: 100%; right: 0; width: 140px; background: #121212; border: 1px solid var(--border); border-radius: 6px; margin-top: 5px; max-height: 200px; overflow-y: auto; padding: 5px; box-shadow: 0 5px 15px rgba(0,0,0,0.8);">
                ${optionsHtml}
            </div>
        `;

        const btnDrop = document.getElementById('btn-drop-mes-tier');
        const listDrop = document.getElementById('list-drop-mes-tier');
        const cbs = document.querySelectorAll('.cb-filtro-mes-tier');
        const lbl = document.getElementById('lbl-drop-mes-tier');

        btnDrop.addEventListener('click', () => {
            listDrop.style.display = listDrop.style.display === 'none' ? 'block' : 'none';
        });

        cbs.forEach(cb => cb.addEventListener('change', () => {
            const selecionados = Array.from(cbs).filter(c => c.checked).map(c => c.value);
            
            if (selecionados.length === 0) {
                cb.checked = true;
                return;
            }
            
            AppState.perf.meses = selecionados;
            lbl.innerText = selecionados.length > 1 ? `Meses (${selecionados.length})` : `Mês: ${selecionados[0]}`;
            desenharTiers(base);
        }));

        document.addEventListener('click', (e) => {
            if(!containerMes.contains(e.target)) listDrop.style.display = 'none';
        });
    }

    filtrosPerfInicializados = true;
}

function desenharTop10(base) {
    let baseFiltrada = base.filter(i => i.AnoMes === AppState.perf.mesVigente);

    if (AppState.perf.top10.pdv !== 'ALL') {
        baseFiltrada = baseFiltrada.filter(i => i.PDV === AppState.perf.top10.pdv);
    }
    
    if (AppState.perf.top10.metrica !== 'ALL') {
        const metricaDesejada = String(AppState.perf.top10.metrica).trim().toUpperCase();
        baseFiltrada = baseFiltrada.filter(i => String(i.CATEGORIA || '').trim().toUpperCase() === metricaDesejada);
    }

    const agrupado = {};
    baseFiltrada.forEach(i => {
        const nome = i.PRODUTO || 'Desconhecido';
        agrupado[nome] = (agrupado[nome] || 0) + (i.REALIZADO || 0);
    });

    const top10 = Object.entries(agrupado).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const ctx = document.getElementById('chart-top10-produtos');
    if (!ctx) return;
    if (chartTop10) chartTop10.destroy();

    chartTop10 = new Chart(ctx, {
        type: 'bar',
        data: { labels: top10.map(i => i[0]), datasets: [{ data: top10.map(i => i[1]), backgroundColor: CORES.ace, borderRadius: 4, barThickness: 12 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, 
            layout: { padding: { right: 80, left: 2 } }, 
            plugins: { 
                legend: { display: false }, 
                datalabels: { 
                    clip: false, 
                    anchor: 'end', align: 'right', color: '#c6c6c6', font: { size: 9, weight: 'bold' }, 
                    formatter: v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) 
                } 
            },
            scales: { 
                x: { display: false, grace: '40%' }, 
                y: { 
                    grid: { display: false }, 
                    ticks: { 
                        color: '#fff', font: { size: 9 }, crossAlign: 'near', align: 'start',
                        callback: function(value) {
                            let label = this.getLabelForValue(value) || '';
                            return label.length > 25 ? label.substr(0, 25) + '...' : label; 
                        }
                    } 
                } 
            }
        }
    });
}

function desenharBottom10(base) {
    let baseFiltrada = base.filter(i => i.AnoMes === AppState.perf.mesVigente);

    if (AppState.perf.bottom10.pdv !== 'ALL') {
        baseFiltrada = baseFiltrada.filter(i => i.PDV === AppState.perf.bottom10.pdv);
    }
    
    if (AppState.perf.bottom10.metrica !== 'ALL') {
        const metricaDesejada = String(AppState.perf.bottom10.metrica).trim().toUpperCase();
        baseFiltrada = baseFiltrada.filter(i => String(i.CATEGORIA || '').trim().toUpperCase() === metricaDesejada);
    }

    const agrupado = {};
    baseFiltrada.forEach(i => {
        const nome = i.PRODUTO || 'Desconhecido';
        agrupado[nome] = (agrupado[nome] || 0) + (i.REALIZADO || 0);
    });

    const bottom10 = Object.entries(agrupado).filter(i => i[1] > 0).sort((a, b) => a[1] - b[1]).slice(0, 10);

    const ctx = document.getElementById('chart-bottom10-produtos');
    if (!ctx) return;
    if (chartBottom10) chartBottom10.destroy();

    chartBottom10 = new Chart(ctx, {
        type: 'bar',
        data: { labels: bottom10.map(i => i[0]), datasets: [{ data: bottom10.map(i => i[1]), backgroundColor: CORES.prt, borderRadius: 4, barThickness: 12 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, 
            layout: { padding: { right: 80, left: 2 } }, 
            plugins: { 
                legend: { display: false }, 
                datalabels: { 
                    clip: false, 
                    anchor: 'end', align: 'right', color: '#c6c6c6', font: { size: 9, weight: 'bold' }, 
                    formatter: v => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) 
                } 
            },
            scales: { 
                x: { display: false, grace: '40%' }, 
                y: { 
                    grid: { display: false }, 
                    ticks: { 
                        color: '#fff', font: { size: 9 }, crossAlign: 'near', align: 'start',
                        callback: function(value) {
                            let label = this.getLabelForValue(value) || '';
                            return label.length > 25 ? label.substr(0, 25) + '...' : label; 
                        }
                    } 
                } 
            }
        }
    });
}

function desenharTiers(base) {
    const baseFiltrada = base.filter(i => AppState.perf.meses.includes(i.AnoMes));

    const ordemTiers = ['Low', 'Mid-E', 'Mid-S', 'High', 'Super High'];
    const metricas = { 'Low': { qtd: 0, fat: 0 }, 'Mid-E': { qtd: 0, fat: 0 }, 'Mid-S': { qtd: 0, fat: 0 }, 'High': { qtd: 0, fat: 0 }, 'Super High': { qtd: 0, fat: 0 } };

    baseFiltrada.forEach(i => {
        const t = i.TIER;
        if (metricas[t] !== undefined) {
            metricas[t].qtd += (i.QTD_FAT || 0);
            metricas[t].fat += (i.REALIZADO || 0);
        }
    });

    const ctx = document.getElementById('chart-tier-combo');
    if (!ctx) return;
    if (chartTier) chartTier.destroy();

    chartTier = new Chart(ctx, {
        data: {
            labels: ordemTiers,
            datasets: [
                { type: 'bar', label: 'Qtd Aparelhos', data: ordemTiers.map(t => metricas[t].qtd), backgroundColor: '#895129', borderRadius: 4, yAxisID: 'y' },
                { type: 'line', label: 'Faturamento', data: ordemTiers.map(t => metricas[t].fat), borderColor: CORES.primary, backgroundColor: CORES.primary, borderWidth: 3, pointRadius: 4, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { 
                legend: { display: true, position: 'bottom', labels: { color: '#888', font: { size: 10 }, boxWidth: 12 } },
                datalabels: {
                    color: '#fff', font: { size: 10, weight: 'bold' },
                    formatter: (v, ctx) => {
                        if (v === 0) return '';
                        return ctx.dataset.type === 'line' ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(v) : v;
                    },
                    align: (ctx) => ctx.dataset.type === 'line' ? 'top' : 'center',
                    anchor: (ctx) => ctx.dataset.type === 'line' ? 'bottom' : 'center'
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#888', font: { size: 10 } } },
                y: { display: false, position: 'left' },
                y1: { display: false, position: 'right', grid: { display: false } }
            }
        }
    });
}

function desenharTendenciaTemporal(baseTempo) {
    if (baseTempo.length === 0) return;

    const agrupado = {};
    
    baseTempo.forEach(dia => {
        const dataOriginal = new Date(dia.data + 'T12:00:00'); 
        let chaveLabel = '';

        if (agrupamentoTempoAtual === 'mes') {
            chaveLabel = dataOriginal.toLocaleString('pt-BR', { month: 'short', year: '2-digit' }).toUpperCase();
        } 
        else if (agrupamentoTempoAtual === 'quinzena') {
            const mes = dataOriginal.toLocaleString('pt-BR', { month: 'short' }).toUpperCase();
            const quinzena = dataOriginal.getDate() <= 15 ? '1ªQ' : '2ªQ';
            chaveLabel = `${quinzena} ${mes}`;
        } 

        agrupado[chaveLabel] = (agrupado[chaveLabel] || 0) + (dia.faturamento || 0);
    });

    const ctx = document.getElementById('chart-tendencia-tempo');
    if (!ctx) return;
    if (chartTempo) chartTempo.destroy();

    chartTempo = new Chart(ctx, {
        type: 'line',
        data: { 
            labels: Object.keys(agrupado), 
            datasets: [{ label: 'Faturamento', data: Object.values(agrupado), borderColor: CORES.primary, borderWidth: 3, pointBackgroundColor: '#121212', pointBorderColor: CORES.primary, pointRadius: 4, pointHoverRadius: 6, fill: true, backgroundColor: 'rgba(248, 181, 24, 0.1)', tension: 0.3 }] 
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            layout: { padding: { top: 20 } },
            plugins: {
                legend: { display: false },
                datalabels: { display: true, align: 'top', color: '#c6c6c6', font: { size: 10, weight: 'bold' }, formatter: v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(v) }
            },
            scales: {
                x: { grid: { color: '#2a2a2a', borderDash: [4, 4] }, ticks: { color: '#888', font: { size: 9 } } },
                y: { display: false, min: 0, grace: '20%' }
            }
        }
    });
}