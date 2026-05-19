// Importações da versão mais moderna do Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, setPersistence, inMemoryPersistence, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getDatabase, ref, set, get, child, update, remove, push } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

// Suas Chaves do Cofre (Realtime Database)
const firebaseConfig = {
  apiKey: "AIzaSyAtL1r7Z8k9V90Xq-jxvO7WN7wdUUF4JCM",
  authDomain: "phonestore-dashboard.firebaseapp.com",
  projectId: "phonestore-dashboard",
  storageBucket: "phonestore-dashboard.firebasestorage.app",
  messagingSenderId: "1040405872269",
  appId: "1:1040405872269:web:488619c22b66051f386cc4"
};

// Inicializando os Sistemas
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

// ==========================================
// REGRA MASTER DE SEGURANÇA 5: AUDITORIA TOTAL (DEMANDA P)
// ==========================================
window.registrarLog = async (acao, detalhes, ator = "Sistema") => {
    try {
        const novoLog = {
            data_hora: new Date().toISOString(),
            acao: acao,
            detalhes: detalhes,
            ator: ator // Pode ser o e-mail de quem fez a ação
        };
        // O "push" cria um ID único impossível de sobrescrever
        await push(ref(database, 'logs'), novoLog);
    } catch (e) {
        console.error("Erro na caixa-preta:", e);
    }
};

// ==========================================
// REGRA MASTER DE SEGURANÇA 1: LOGOUT NO F5
// ==========================================
// Força o Firebase a NUNCA salvar a sessão no disco do navegador. Deu F5 = Deslogou.
setPersistence(auth, inMemoryPersistence)
  .catch((error) => {
    console.error("Erro ao configurar persistência de segurança:", error);
  });

// Variável Global de Sessão
window.usuarioLogado = null; 

// Elementos HTML
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const btnShowRegister = document.getElementById('btn-show-register');
const btnShowLogin = document.getElementById('btn-show-login');
const loginBox = document.querySelector('.login-box:not(#register-box):not(#forgot-box)');
const registerBox = document.getElementById('register-box');

// Elementos Nova Tela Esqueci Minha Senha
const forgotBox = document.getElementById('forgot-box');
const btnShowForgot = document.getElementById('btn-show-forgot');
const btnBackLogin = document.getElementById('btn-back-login');
const forgotForm = document.getElementById('forgot-form');

btnShowRegister.addEventListener('click', (e) => {
    e.preventDefault(); 
    loginBox.style.display = 'none'; 
    forgotBox.style.display = 'none';
    registerBox.style.display = 'flex';
});

btnShowLogin.addEventListener('click', (e) => {
    e.preventDefault(); 
    registerBox.style.display = 'none'; 
    forgotBox.style.display = 'none';
    loginBox.style.display = 'flex';
});

btnShowForgot.addEventListener('click', (e) => {
    e.preventDefault(); 
    loginBox.style.display = 'none'; 
    registerBox.style.display = 'none';
    forgotBox.style.display = 'flex';
});

btnBackLogin.addEventListener('click', (e) => {
    e.preventDefault(); 
    forgotBox.style.display = 'none'; 
    registerBox.style.display = 'none';
    loginBox.style.display = 'flex';
});

// ==========================================
// REGRA MASTER DE SEGURANÇA 3: SANITIZAÇÃO (DEMANDA N)
// ==========================================
function sanitizarInput(texto) {
    if (!texto) return '';
    const mapaCaracteres = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        "/": '&#x2F;',
        "`": '&grave;'
    };
    const reg = /[&<>"'/`]/ig;
    // Escapa caracteres HTML e remove espaços duplos ou quebras de linha indesejadas
    return texto.replace(reg, (match) => (mapaCaracteres[match])).trim();
}

// ==========================================
// REGRA MASTER DE SEGURANÇA 4: MASCARAMENTO (DEMANDA M)
// ==========================================
function mascararEmail(email) {
    if (!email) return '--';
    const partes = email.split('@');
    if (partes.length !== 2) return email; // Retorna normal se não for um formato de e-mail padrão
    
    const nome = partes[0];
    const dominio = partes[1];
    
    // Pega os 3 primeiros caracteres do nome, ou apenas o 1º se o nome for muito curto
    const visivel = nome.length > 3 ? nome.substring(0, 3) : nome.charAt(0);
    return `${visivel}***@${dominio}`;
}


// ==========================================
// REGRA MASTER DE SEGURANÇA 2: INATIVIDADE
// ==========================================
let tempoInativo;

function resetarTimer() {
    clearTimeout(tempoInativo);
    
    // 90000 ms = 1 minuto e 30 segundos
    tempoInativo = setTimeout(() => {
        // A MÁGICA ACONTECE AQUI: Só desloga se houver usuário E o Modo TV estiver DESLIGADO
        if (window.usuarioLogado && !window.isModoTV) {
            registrarLog('LOGOUT_INATIVIDADE', 'Sessão derrubada por 1m30s de inatividade', window.usuarioLogado.email);
            alert("🔒 Sessão encerrada por inatividade de 1m 30s.");
            fazerLogout();
        }
    }, 90000);
}

// Qualquer movimento na tela reseta a bomba-relógio
window.addEventListener('mousemove', resetarTimer);
window.addEventListener('keypress', resetarTimer);
window.addEventListener('click', resetarTimer);
window.addEventListener('scroll', resetarTimer);

// ==========================================
// AÇÃO 1: SOLICITAR ACESSO (CRIAR CONTA)
// ==========================================
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Passando os dados pela Alfândega
    const nome = sanitizarInput(document.getElementById('reg-nome').value);
    const email = sanitizarInput(document.getElementById('reg-email').value);
    const password = document.getElementById('reg-password').value; // Senha limpa pelo próprio Firebase

    if (nome.length < 3) {
        alert("Por favor, insira um nome válido.");
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        await set(ref(database, 'usuarios/' + user.uid), {
            nome: nome, email: email, status: 'pendente', role: 'NONE', loja_id: 'ALL',
            data_criacao: new Date().toISOString()
        });

        alert("Solicitação enviada com sucesso! Aguarde a aprovação do Master.");
        registrarLog('CADASTRO_SOLICITADO', `Nova conta solicitada para ${nome}`, email);
        
        await signOut(auth); 
        btnShowLogin.click();
        registerForm.reset();
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') alert("Este e-mail já solicitou acesso.");
        else alert("Erro ao criar conta. Verifique o formato do e-mail.");
    }
});

// ==========================================
// AÇÃO 2: ENTRAR NO PAINEL (LOGIN)
// ==========================================
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
        registrarLog('LOGIN_SUCESSO', 'Usuário entrou no sistema', email);
    } catch (error) {
        registrarLog('LOGIN_FALHA', 'Tentativa de login com erro/senha incorreta', email);
        alert("E-mail ou senha incorretos.");
    }
});

// ==========================================
// AÇÃO 3: RECUPERAR SENHA (ESQUECI A SENHA)
// ==========================================
forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value;

    try {
        await sendPasswordResetEmail(auth, email);
        registrarLog('SENHA_RESET', 'Link de recuperação enviado', email);
        alert("E-mail de recuperação enviado! Verifique sua caixa de entrada (e a pasta de Spam).");
        btnBackLogin.click(); // Volta para a tela de login
        forgotForm.reset();
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            alert("E-mail não encontrado na base de dados.");
        } else if (error.code === 'auth/invalid-email') {
            alert("Formato de e-mail inválido.");
        } else {
            alert("Erro ao enviar o e-mail. Tente novamente mais tarde.");
        }
    }
});

// ==========================================
// O VIGIA DA PORTA (MONITORA O ESTADO DO LOGIN)
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const dbRef = ref(database);
        try {
            const snapshot = await get(child(dbRef, `usuarios/${user.uid}`));
            
            if (snapshot.exists()) {
                const userData = snapshot.val();

                if (userData.status === 'aprovado' || userData.status === 'master') {
                    // 1. Salva os dados do usuário na sessão
                    window.usuarioLogado = { uid: user.uid, nome: userData.nome, role: userData.role, loja_id: userData.loja_id, email: userData.email };

                    // 2. BAIXA OS DADOS DO FIREBASE ANTES DE ABRIR A TELA
                    // Muda o texto do botão para dar feedback visual de que está carregando 88k linhas
                    const btnSubmitLogin = document.querySelector('#login-form button[type="submit"]');
                    if (btnSubmitLogin) btnSubmitLogin.innerText = "Sincronizando Banco de Dados...";

                    try {
                        const snapshotDados = await get(child(dbRef, 'dashboard_data'));
                        if (snapshotDados.exists()) {
                            // A MÁGICA: Cria a variável global que o script_engine.js precisa!
                            window.dadosDashboard = snapshotDados.val();
                        } else {
                            alert("⚠️ Banco de dados em branco na nuvem. Aguardando sincronização do Python.");
                            window.dadosDashboard = {};
                        }
                    } catch (erroDB) {
                        console.error("Erro ao baixar dados do Firebase:", erroDB);
                        alert("Falha de conexão com a base de dados.");
                    }

                    // 3. CONTINUA O FLUXO NORMAL DA INTERFACE
                    const nomePartes = userData.nome.trim().split(' ');
                    const primeiroNome = nomePartes[0];
                    const ultimoNome = nomePartes.length > 1 ? nomePartes[nomePartes.length - 1] : '';
                    
                    const displayNome = ultimoNome ? `${primeiroNome} ${ultimoNome}` : primeiroNome;
                    const avatarStr = (primeiroNome[0] + (ultimoNome ? ultimoNome[0] : '')).toUpperCase();

                    const elUserName = document.querySelector('.user-name');
                    const elUserRole = document.querySelector('.user-role');
                    const elAvatar = document.querySelector('.avatar');

                    if(elUserName) elUserName.innerText = displayNome;
                    if(elUserRole) elUserRole.innerText = userData.role === 'NONE' ? 'Administrador' : userData.role;
                    if(elAvatar) elAvatar.innerText = avatarStr;

                    const btnAcessos = document.getElementById('nav-acessos');
                    if (userData.status === 'master' || userData.role === 'MASTER') {
                        if (btnAcessos) btnAcessos.style.display = 'flex';
                        // Como os dados já foram baixados, o painel master consegue montar o dropdown de Lojas
                        carregarPainelMaster();
                    } else {
                        if (btnAcessos) btnAcessos.style.display = 'none';
                    }

                    // 4. ESCONDE O LOGIN E RODA O MOTOR DE GRÁFICOS
                    loginOverlay.style.display = 'none';
                    if (btnSubmitLogin) btnSubmitLogin.innerText = "Entrar"; // Reseta o botão
                    resetarTimer(); // Inicia o timer de segurança ao logar

                    if (typeof processarEDataRender === 'function') processarEDataRender();

                } else {
                    alert(`Olá ${userData.nome}, sua conta ainda está aguardando aprovação do Master.`);
                    await signOut(auth);
                }
                
            } else {
                alert("Erro: Ficha de usuário não encontrada.");
                await signOut(auth);
            }
        } catch (error) {
            await signOut(auth);
        }
    } else {
        window.usuarioLogado = null;
        loginOverlay.style.display = 'flex';
        // Limpa o formulário de login por segurança
        document.getElementById('login-password').value = '';
    }
});

// ==========================================
// PAINEL MASTER & LOGOUT
// ==========================================
window.fazerLogout = () => {
    signOut(auth);
};

async function carregarPainelMaster() {
    const tbody = document.getElementById('tbody-acessos');
    if (!tbody) return;

    const snapshot = await get(ref(database, 'usuarios'));
    if (!snapshot.exists()) return;

    const usuarios = snapshot.val();
    tbody.innerHTML = '';

    let optionsLoja = '<option value="ALL">Rede Completa (ALL)</option>';
    if (typeof dadosDashboard !== 'undefined' && dadosDashboard.unidades) {
        const lojasUnicas = [...new Set(dadosDashboard.unidades.map(u => u['ID_LOJA']))].sort((a,b) => Number(a)-Number(b));
        lojasUnicas.forEach(id => {
            const info = dadosDashboard.unidades.find(u => String(u['ID_LOJA']) === String(id));
            optionsLoja += `<option value="${id}">${id} - ${info['NOME PDV'] || 'Desconhecida'}</option>`;
        });
    }

    for (let uid in usuarios) {
        const u = usuarios[uid];
        const dataFormatada = u.data_criacao ? new Date(u.data_criacao).toLocaleDateString('pt-BR') : '--/--/----';
        
        // --- APLICAÇÃO DO MASCARAMENTO (DEMANDA M) ---
        // Checa se quem está olhando a tela é um Master. Se for, vê tudo. Se não for (ex: Admin), vê mascarado.
        const usuarioAtualMaster = window.usuarioLogado && (window.usuarioLogado.role === 'MASTER' || window.usuarioLogado.status === 'master');
        const emailExibicao = usuarioAtualMaster ? u.email : mascararEmail(u.email);
        
        let corStatus = '#888';
        if (u.status === 'master') corStatus = '#f8b518';
        else if (u.status === 'aprovado') corStatus = '#2d5128';
        else if (u.status === 'pendente') corStatus = '#bd0000';

        const tr = document.createElement('tr');
        
        // --- LÓGICA DE EXIBIÇÃO DINÂMICA (LIDER VS SUPERVISOR) ---
        const isLider = u.role === 'LIDER';
        const isSupervisor = u.role === 'SUPERVISOR';
        
        // No tr.innerHTML, note que a linha do e-mail agora usa a variável emailExibicao
        tr.innerHTML = `
            <td style="color: ${corStatus}; font-weight: 800; text-transform: uppercase;">${u.status}</td>
            <td style="font-weight: 700;">${u.nome}</td>
            <td style="color: var(--text-dim);">${emailExibicao}</td>
            <td style="color: var(--text-dim);">${dataFormatada}</td>
            <td>
                <select id="role-${uid}" class="select-dark" style="padding: 4px; border-radius: 4px; ${u.status === 'master' ? 'pointer-events: none; opacity: 0.5;' : ''}">
                    <option value="NONE" ${u.role === 'NONE' ? 'selected' : ''}>Pendente/Nenhum</option>
                    <option value="ADMIN" ${u.role === 'ADMIN' ? 'selected' : ''}>Admin (Vê Tudo)</option>
                    <option value="DIRETOR" ${u.role === 'DIRETOR' ? 'selected' : ''}>Diretor (Vê Tudo)</option>
                    <option value="SUPERVISOR" ${u.role === 'SUPERVISOR' ? 'selected' : ''}>Supervisor (Múltiplas Lojas)</option>
                    <option value="LIDER" ${u.role === 'LIDER' ? 'selected' : ''}>Líder (1 Loja/Túnel)</option>
                </select>
            </td>
            <td>
                <select id="loja-select-${uid}" class="select-dark" style="padding: 4px; border-radius: 4px; max-width: 150px; ${isLider ? '' : 'display:none;'}">
                    ${optionsLoja.replace(`value="${u.loja_id}"`, `value="${u.loja_id}" selected`)}
                </select>

                <input type="text" id="loja-input-${uid}" class="select-dark" placeholder="Ex: 1, 4, 9" value="${isSupervisor ? u.loja_id : ''}" style="padding: 4px; border-radius: 4px; max-width: 150px; ${isSupervisor ? '' : 'display:none;'}">
                
                <span id="loja-all-${uid}" style="color: var(--text-dim); font-size: 0.75rem; font-weight: 600; ${!isLider && !isSupervisor ? '' : 'display:none;'}">REDE COMPLETA (ALL)</span>
            </td>
            <td>
                ${u.status === 'master' ? '<span style="color:#f8b518; font-size:10px; font-weight:bold;">DONO DO SISTEMA</span>' : `
                    <button class="btn-time active btn-salvar-rh" data-uid="${uid}" style="font-size: 0.65rem;">
                        ${u.status === 'pendente' ? 'Aprovar & Salvar' : 'Salvar'}
                    </button>
                    <button class="btn-time btn-rejeitar-rh" data-uid="${uid}" style="font-size: 0.65rem; border-color: #bd0000; color: #bd0000; margin-left: 5px;">
                        Deletar
                    </button>
                `}
            </td>
        `;
        tbody.appendChild(tr);
    }

    // Evento de Salvar as Alterações com TRAVA DE SEGURANÇA
    document.querySelectorAll('.btn-salvar-rh').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = e.target.getAttribute('data-uid');
            const novaRole = document.getElementById(`role-${uid}`).value;
            
            let novaLoja = 'ALL';

            if (novaRole === 'NONE') { 
                alert("Escolha um Cargo válido."); 
                return; 
            }

            // Coleta a Loja dependendo da Role
            if (novaRole === 'LIDER') {
                novaLoja = document.getElementById(`loja-select-${uid}`).value;
                if (novaLoja === 'ALL') { alert("Especifique a Loja do Líder no dropdown!"); return; }
            } else if (novaRole === 'SUPERVISOR') {
                novaLoja = document.getElementById(`loja-input-${uid}`).value.trim();
                if (novaLoja === '' || novaLoja === 'ALL') { alert("Digite os IDs das lojas do Supervisor separados por vírgula (Ex: 1, 4, 9)."); return; }
            }

            // --- INÍCIO DA VARREDURA DE SEGURANÇA (DEMANDA T AJUSTADA) ---
            if (novaRole === 'SUPERVISOR' || novaRole === 'LIDER') {
                // Transforma o input da loja em um array para checar
                const lojasNesteUsuario = novaLoja.split(',').map(s => s.trim()).filter(s => s);
                let temConflito = false;
                
                const snapBanco = await get(ref(database, 'usuarios'));
                if (snapBanco.exists()) {
                    const todosUsers = snapBanco.val();
                    
                    for (const outroUid in todosUsers) {
                        if (outroUid === uid) continue; // Pula a si mesmo
                        
                        const outroUser = todosUsers[outroUid];
                        
                        // REGRAS A, B e C: O conflito só existe se for a MESMA hierarquia
                        // Supervisor bate com Supervisor / Líder bate com Líder
                        if (outroUser.role === novaRole && outroUser.status !== 'pendente') {
                            const lojasDoOutro = String(outroUser.loja_id || '').split(',').map(s => s.trim()).filter(s => s);
                            
                            for (const lojaValidando of lojasNesteUsuario) {
                                if (lojasDoOutro.includes(lojaValidando)) {
                                    alert(`⚠️ TRAVA DE HIERARQUIA:\n\nO PDV ${lojaValidando} já está sob a gestão do ${outroUser.role} ${outroUser.nome}.\n\nNão é possível atribuir dois ${novaRole}S para o mesmo PDV.`);
                                    temConflito = true;
                                    break;
                                }
                            }
                        }
                        if (temConflito) break;
                    }
                }
                
                // Se achou conflito na mesma patente, aborta o salvamento
                if (temConflito) return; 
            }
            // --- FIM DA VARREDURA DE SEGURANÇA ---

            // Se passou ileso pela segurança, salva no banco!
            try {
                await update(ref(database, `usuarios/${uid}`), {
                    status: 'aprovado', 
                    role: novaRole, 
                    loja_id: novaLoja
                });
                
                const executor = window.usuarioLogado ? window.usuarioLogado.email : 'Master';
                registrarLog('EDICAO_RH', `Cargo ${novaRole} e PDV ${novaLoja} salvos para o UID: ${uid}`, executor);
                
                alert("Usuário atualizado e validado com sucesso!");
                carregarPainelMaster();
            } catch (err) { alert("Erro ao atualizar o banco de dados."); }
        });
    });

    // Evento de Deletar
    document.querySelectorAll('.btn-rejeitar-rh').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const uid = e.target.getAttribute('data-uid');
            if(confirm("Tem certeza que deseja DELETAR a ficha desse usuário?")) {
                try { 
                    await remove(ref(database, `usuarios/${uid}`)); 
                    
                    const executor = window.usuarioLogado ? window.usuarioLogado.email : 'Master';
                    registrarLog('DELECAO_RH', `Ficha do UID ${uid} foi DELETADA`, executor);
                    
                    alert("Ficha deletada com sucesso!"); 
                    carregarPainelMaster(); 
                } catch (err) { alert("Erro ao deletar."); }
            }
        });
    });

    // Alterna a interface entre Dropdown(Lider), Input(Supervisor) e Label(Outros)
    document.querySelectorAll('select[id^="role-"]').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const uid = e.target.id.replace('role-', '');
            const val = e.target.value;
            
            const selectLider = document.getElementById(`loja-select-${uid}`);
            const inputSuper = document.getElementById(`loja-input-${uid}`);
            const labelAll = document.getElementById(`loja-all-${uid}`);

            selectLider.style.display = 'none';
            inputSuper.style.display = 'none';
            labelAll.style.display = 'none';

            if (val === 'LIDER') {
                selectLider.style.display = 'block';
            } else if (val === 'SUPERVISOR') {
                inputSuper.style.display = 'block';
            } else {
                labelAll.style.display = 'block';
            }
        });
    });
}