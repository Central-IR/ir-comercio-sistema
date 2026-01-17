const DEVELOPMENT_MODE = false;
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let cotacoes = [];
let currentMonth = new Date();
let editingId = null;
let currentTab = 0;
let currentInfoTab = 0;
let isOnline = false;
let sessionToken = null;
let lastDataHash = '';

const tabs = ['tab-geral', 'tab-transportadora', 'tab-detalhes'];

console.log('🚀 Cotações de Frete iniciada');
console.log('📍 API URL:', API_URL);
console.log('🔧 Modo desenvolvimento:', DEVELOPMENT_MODE);

function toUpperCase(value) {
    return value ? String(value).toUpperCase() : '';
}

function setupUpperCaseInputs() {
    const textInputs = document.querySelectorAll('input[type="text"]:not([readonly]), textarea');
    textInputs.forEach(input => {
        input.addEventListener('input', function(e) {
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = toUpperCase(this.value);
            this.setSelectionRange(start, end);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (DEVELOPMENT_MODE) {
        console.log('⚠️ MODO DESENVOLVIMENTO ATIVADO');
        sessionToken = 'dev-mode';
        inicializarApp();
    } else {
        verificarAutenticacao();
    }
});

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('cotacoesFreteSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('cotacoesFreteSession');
    }

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p>
            <a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Ir para o Portal</a>
        </div>
    `;
}

function inicializarApp() {
    updateDisplay();
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

async function checkServerStatus() {
    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(`${API_URL}/cotacoes`, {
            method: 'GET',
            headers: headers,
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('cotacoesFreteSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE');
            await loadCotacoes();
        }
        
        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        console.error('❌ Erro ao verificar servidor:', error);
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.className = isOnline ? 'connection-status online' : 'connection-status offline';
    }
}

function startPolling() {
    loadCotacoes();
    setInterval(() => {
        if (isOnline) loadCotacoes();
    }, 10000);
}

async function loadCotacoes() {
    if (!isOnline && !DEVELOPMENT_MODE) return;

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(`${API_URL}/cotacoes`, {
            method: 'GET',
            headers: headers,
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('cotacoesFreteSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            console.error('❌ Erro ao carregar cotações:', response.status);
            return;
        }

        const data = await response.json();
        cotacoes = data.map(c => ({
            ...c,
            negocioFechado: c.negocioFechado || c.status === 'fechado' || false
        }));
        
        const newHash = JSON.stringify(cotacoes.map(c => c.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            updateDisplay();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar:', error);
    }
}

function changeMonth(direction) {
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    updateDisplay();
}

function updateMonthDisplay() {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthName = months[currentMonth.getMonth()];
    const year = currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = `${monthName} ${year}`;
}

function switchTab(tabId) {
    const tabIndex = tabs.indexOf(tabId);
    if (tabIndex !== -1) {
        currentTab = tabIndex;
        showTab(currentTab);
        updateNavigationButtons();
    }
}

function showTab(index) {
    const tabButtons = document.querySelectorAll('#formModal .tab-btn');
    const tabContents = document.querySelectorAll('#formModal .tab-content');
    
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    if (tabButtons[index]) tabButtons[index].classList.add('active');
    if (tabContents[index]) tabContents[index].classList.add('active');
}

function updateNavigationButtons() {
    const btnPrevious = document.getElementById('btnPrevious');
    const btnNext = document.getElementById('btnNext');
    const btnSave = document.getElementById('btnSave');
    
    if (!btnPrevious || !btnNext || !btnSave) return;
    
    if (currentTab > 0) {
        btnPrevious.style.display = 'inline-flex';
    } else {
        btnPrevious.style.display = 'none';
    }
    
    if (currentTab < tabs.length - 1) {
        btnNext.style.display = 'inline-flex';
        btnSave.style.display = 'none';
    } else {
        btnNext.style.display = 'none';
        btnSave.style.display = 'inline-flex';
    }
}

function nextTab() {
    if (currentTab < tabs.length - 1) {
        currentTab++;
        showTab(currentTab);
        updateNavigationButtons();
    }
}

function previousTab() {
    if (currentTab > 0) {
        currentTab--;
        showTab(currentTab);
        updateNavigationButtons();
    }
}

function switchInfoTab(tabId) {
    const infoTabs = ['info-tab-geral', 'info-tab-transportadora', 'info-tab-detalhes'];
    const currentIndex = infoTabs.indexOf(tabId);
    
    if (currentIndex !== -1) {
        currentInfoTab = currentIndex;
    }
    
    document.querySelectorAll('#infoModal .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('#infoModal .tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const clickedBtn = event?.target?.closest('.tab-btn');
    if (clickedBtn) {
        clickedBtn.classList.add('active');
    } else {
        document.querySelectorAll('#infoModal .tab-btn')[currentIndex]?.classList.add('active');
    }
    document.getElementById(tabId).classList.add('active');
    
    updateInfoNavigationButtons();
}

function updateInfoNavigationButtons() {
    const btnInfoPrevious = document.getElementById('btnInfoPrevious');
    const btnInfoNext = document.getElementById('btnInfoNext');
    const btnInfoClose = document.getElementById('btnInfoClose');
    
    if (!btnInfoPrevious || !btnInfoNext || !btnInfoClose) return;
    
    const totalTabs = 3;
    
    if (currentInfoTab > 0) {
        btnInfoPrevious.style.display = 'inline-flex';
    } else {
        btnInfoPrevious.style.display = 'none';
    }
    
    if (currentInfoTab < totalTabs - 1) {
        btnInfoNext.style.display = 'inline-flex';
    } else {
        btnInfoNext.style.display = 'none';
    }
    
    btnInfoClose.style.display = 'inline-flex';
}

function nextInfoTab() {
    const infoTabs = ['info-tab-geral', 'info-tab-transportadora', 'info-tab-detalhes'];
    if (currentInfoTab < infoTabs.length - 1) {
        currentInfoTab++;
        switchInfoTab(infoTabs[currentInfoTab]);
    }
}

function previousInfoTab() {
    const infoTabs = ['info-tab-geral', 'info-tab-transportadora', 'info-tab-detalhes'];
    if (currentInfoTab > 0) {
        currentInfoTab--;
        switchInfoTab(infoTabs[currentInfoTab]);
    }
}

function openFormModal() {
    editingId = null;
    currentTab = 0;
    
    const today = new Date().toISOString().split('T')[0];
    
    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content" style="max-width: 1200px;">
                <div class="modal-header">
                    <h3 class="modal-title">Nova Cotação de Frete</h3>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchTab('tab-geral')">Geral</button>
                        <button class="tab-btn" onclick="switchTab('tab-transportadora')">Transportadora</button>
                        <button class="tab-btn" onclick="switchTab('tab-detalhes')">Detalhes</button>
                    </div>

                    <form id="cotacaoForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="">
                        
                        <div class="tab-content active" id="tab-geral">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="responsavel">Responsável pela Cotação *</label>
                                    <select id="responsavel" required>
                                        <option value="">Selecione...</option>
                                        <option value="ROBERTO">ROBERTO</option>
                                        <option value="ISAQUE">ISAQUE</option>
                                        <option value="MIGUEL">MIGUEL</option>
                                        <option value="GUSTAVO">GUSTAVO</option>
                                        <option value="LUIZ">LUIZ</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="documento">Documento *</label>
                                    <input type="text" id="documento" required>
                                </div>
                                <div class="form-group">
                                    <label for="vendedor">Vendedor</label>
                                    <select id="vendedor">
                                        <option value="">Selecione...</option>
                                        <option value="ROBERTO">ROBERTO</option>
                                        <option value="ISAQUE">ISAQUE</option>
                                        <option value="MIGUEL">MIGUEL</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-transportadora">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="transportadora">Transportadora</label>
                                    <select id="transportadora">
                                        <option value="">Selecione...</option>
                                        <option value="TNT MERCÚRIO">TNT MERCÚRIO</option>
                                        <option value="JAMEF">JAMEF</option>
                                        <option value="BRASPRESS">BRASPRESS</option>
                                        <option value="GENEROSO">GENEROSO</option>
                                        <option value="CONTINENTAL">CONTINENTAL</option>
                                        <option value="JEOLOG">JEOLOG</option>
                                        <option value="TG TRANSPORTES">TG TRANSPORTES</option>
                                        <option value="CORREIOS">CORREIOS</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="destino">Cidade-UF *</label>
                                    <input type="text" id="destino" required>
                                </div>
                                <div class="form-group">
                                    <label for="numeroCotacao">Número da Cotação</label>
                                    <input type="text" id="numeroCotacao">
                                </div>
                                <div class="form-group">
                                    <label for="valorFrete">Valor do Frete (R$) *</label>
                                    <input type="number" id="valorFrete" step="0.01" min="0" required>
                                </div>
                                <div class="form-group">
                                    <label for="previsaoEntrega">Previsão de Entrega</label>
                                    <input type="date" id="previsaoEntrega">
                                </div>
                                <div class="form-group">
                                    <label for="canalComunicacao">Canal de Comunicação</label>
                                    <input type="text" id="canalComunicacao" placeholder="Ex: WhatsApp, E-mail">
                                </div>
                                <div class="form-group">
                                    <label for="codigoColeta">Código de Coleta</label>
                                    <input type="text" id="codigoColeta">
                                </div>
                                <div class="form-group">
                                    <label for="responsavelTransportadora">Responsável da Transportadora</label>
                                    <input type="text" id="responsavelTransportadora">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-detalhes">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="dataCotacao">Data da Cotação *</label>
                                    <input type="date" id="dataCotacao" value="${today}" required>
                                </div>
                                <div class="form-group" style="grid-column: 1 / -1;">
                                    <label for="observacoes">Observações</label>
                                    <textarea id="observacoes" rows="4"></textarea>
                                </div>
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button type="button" id="btnPrevious" onclick="previousTab()" class="secondary" style="display: none;">Anterior</button>
                            <button type="button" id="btnNext" onclick="nextTab()" class="secondary">Próximo</button>
                            <button type="submit" id="btnSave" class="save" style="display: none;">Salvar Cotação</button>
                            <button type="button" onclick="closeFormModal(true)" class="secondary">Cancelar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    setTimeout(() => {
        setupUpperCaseInputs();
        updateNavigationButtons();
        document.getElementById('responsavel')?.focus();
    }, 100);
}

function closeFormModal(showCancelMessage = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        const editId = document.getElementById('editId')?.value;
        const isEditing = editId && editId !== '';
        
        if (showCancelMessage) {
            showToast(isEditing ? 'Atualização cancelada' : 'Registro cancelado', 'error');
        }
        
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

// Continuação do script.js

async function handleSubmit(event) {
    event.preventDefault();
    
    const formData = {
        responsavel: document.getElementById('responsavel').value,
        documento: toUpperCase(document.getElementById('documento').value),
        vendedor: document.getElementById('vendedor').value,
        transportadora: document.getElementById('transportadora').value,
        destino: toUpperCase(document.getElementById('destino').value),
        numeroCotacao: toUpperCase(document.getElementById('numeroCotacao').value),
        valorFrete: parseFloat(document.getElementById('valorFrete').value) || 0,
        previsaoEntrega: document.getElementById('previsaoEntrega').value,
        canalComunicacao: toUpperCase(document.getElementById('canalComunicacao').value),
        codigoColeta: toUpperCase(document.getElementById('codigoColeta').value),
        responsavelTransportadora: toUpperCase(document.getElementById('responsavelTransportadora').value),
        dataCotacao: document.getElementById('dataCotacao').value,
        observacoes: toUpperCase(document.getElementById('observacoes').value),
        negocioFechado: false
    };
    
    if (!isOnline && !DEVELOPMENT_MODE) {
        showToast('Sistema offline. Dados não foram salvos.', 'error');
        closeFormModal();
        return;
    }

    try {
        const url = editingId ? `${API_URL}/cotacoes/${editingId}` : `${API_URL}/cotacoes`;
        const method = editingId ? 'PUT' : 'POST';

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(url, {
            method,
            headers: headers,
            body: JSON.stringify(formData),
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('cotacoesFreteSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            let errorMessage = 'Erro ao salvar';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                errorMessage = `Erro ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const savedData = await response.json();

        if (editingId) {
            const index = cotacoes.findIndex(c => String(c.id) === String(editingId));
            if (index !== -1) cotacoes[index] = savedData;
            showToast('Cotação atualizada com sucesso!', 'success');
        } else {
            cotacoes.push(savedData);
            showToast('Cotação criada com sucesso!', 'success');
        }

        lastDataHash = JSON.stringify(cotacoes.map(c => c.id));
        updateDisplay();
        closeFormModal();
    } catch (error) {
        console.error('Erro completo:', error);
        showToast(`Erro: ${error.message}`, 'error');
    }
}

async function editCotacao(id) {
    const cotacao = cotacoes.find(c => String(c.id) === String(id));
    if (!cotacao) {
        showToast('Cotação não encontrada!', 'error');
        return;
    }
    
    editingId = id;
    currentTab = 0;
    
    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content" style="max-width: 1200px;">
                <div class="modal-header">
                    <h3 class="modal-title">Editar Cotação de Frete</h3>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchTab('tab-geral')">Geral</button>
                        <button class="tab-btn" onclick="switchTab('tab-transportadora')">Transportadora</button>
                        <button class="tab-btn" onclick="switchTab('tab-detalhes')">Detalhes</button>
                    </div>

                    <form id="cotacaoForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="${cotacao.id}">
                        
                        <div class="tab-content active" id="tab-geral">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="responsavel">Responsável pela Cotação *</label>
                                    <select id="responsavel" required>
                                        <option value="">Selecione...</option>
                                        <option value="ROBERTO" ${cotacao.responsavel === 'ROBERTO' ? 'selected' : ''}>ROBERTO</option>
                                        <option value="ISAQUE" ${cotacao.responsavel === 'ISAQUE' ? 'selected' : ''}>ISAQUE</option>
                                        <option value="MIGUEL" ${cotacao.responsavel === 'MIGUEL' ? 'selected' : ''}>MIGUEL</option>
                                        <option value="GUSTAVO" ${cotacao.responsavel === 'GUSTAVO' ? 'selected' : ''}>GUSTAVO</option>
                                        <option value="LUIZ" ${cotacao.responsavel === 'LUIZ' ? 'selected' : ''}>LUIZ</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="documento">Documento *</label>
                                    <input type="text" id="documento" value="${toUpperCase(cotacao.documento || '')}" required>
                                </div>
                                <div class="form-group">
                                    <label for="vendedor">Vendedor</label>
                                    <select id="vendedor">
                                        <option value="">Selecione...</option>
                                        <option value="ROBERTO" ${cotacao.vendedor === 'ROBERTO' ? 'selected' : ''}>ROBERTO</option>
                                        <option value="ISAQUE" ${cotacao.vendedor === 'ISAQUE' ? 'selected' : ''}>ISAQUE</option>
                                        <option value="MIGUEL" ${cotacao.vendedor === 'MIGUEL' ? 'selected' : ''}>MIGUEL</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-transportadora">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="transportadora">Transportadora</label>
                                    <select id="transportadora">
                                        <option value="">Selecione...</option>
                                        <option value="TNT MERCÚRIO" ${cotacao.transportadora === 'TNT MERCÚRIO' ? 'selected' : ''}>TNT MERCÚRIO</option>
                                        <option value="JAMEF" ${cotacao.transportadora === 'JAMEF' ? 'selected' : ''}>JAMEF</option>
                                        <option value="BRASPRESS" ${cotacao.transportadora === 'BRASPRESS' ? 'selected' : ''}>BRASPRESS</option>
                                        <option value="GENEROSO" ${cotacao.transportadora === 'GENEROSO' ? 'selected' : ''}>GENEROSO</option>
                                        <option value="CONTINENTAL" ${cotacao.transportadora === 'CONTINENTAL' ? 'selected' : ''}>CONTINENTAL</option>
                                        <option value="JEOLOG" ${cotacao.transportadora === 'JEOLOG' ? 'selected' : ''}>JEOLOG</option>
                                        <option value="TG TRANSPORTES" ${cotacao.transportadora === 'TG TRANSPORTES' ? 'selected' : ''}>TG TRANSPORTES</option>
                                        <option value="CORREIOS" ${cotacao.transportadora === 'CORREIOS' ? 'selected' : ''}>CORREIOS</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="destino">Cidade-UF *</label>
                                    <input type="text" id="destino" value="${toUpperCase(cotacao.destino || '')}" required>
                                </div>
                                <div class="form-group">
                                    <label for="numeroCotacao">Número da Cotação</label>
                                    <input type="text" id="numeroCotacao" value="${toUpperCase(cotacao.numeroCotacao || '')}">
                                </div>
                                <div class="form-group">
                                    <label for="valorFrete">Valor do Frete (R$) *</label>
                                    <input type="number" id="valorFrete" step="0.01" min="0" value="${cotacao.valorFrete || 0}" required>
                                </div>
                                <div class="form-group">
                                    <label for="previsaoEntrega">Previsão de Entrega</label>
                                    <input type="date" id="previsaoEntrega" value="${cotacao.previsaoEntrega || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="canalComunicacao">Canal de Comunicação</label>
                                    <input type="text" id="canalComunicacao" value="${toUpperCase(cotacao.canalComunicacao || '')}" placeholder="Ex: WhatsApp, E-mail">
                                </div>
                                <div class="form-group">
                                    <label for="codigoColeta">Código de Coleta</label>
                                    <input type="text" id="codigoColeta" value="${toUpperCase(cotacao.codigoColeta || '')}">
                                </div>
                                <div class="form-group">
                                    <label for="responsavelTransportadora">Responsável da Transportadora</label>
                                    <input type="text" id="responsavelTransportadora" value="${toUpperCase(cotacao.responsavelTransportadora || '')}">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-detalhes">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="dataCotacao">Data da Cotação *</label>
                                    <input type="date" id="dataCotacao" value="${cotacao.dataCotacao || ''}" required>
                                </div>
                                <div class="form-group" style="grid-column: 1 / -1;">
                                    <label for="observacoes">Observações</label>
                                    <textarea id="observacoes" rows="4">${toUpperCase(cotacao.observacoes || '')}</textarea>
                                </div>
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button type="button" id="btnPrevious" onclick="previousTab()" class="secondary" style="display: none;">Anterior</button>
                            <button type="button" id="btnNext" onclick="nextTab()" class="secondary">Próximo</button>
                            <button type="submit" id="btnSave" class="save" style="display: none;">Atualizar Cotação</button>
                            <button type="button" onclick="closeFormModal(true)" class="secondary">Cancelar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    setTimeout(() => {
        setupUpperCaseInputs();
        updateNavigationButtons();
    }, 100);
}

async function deleteCotacao(id) {
    if (!confirm('Tem certeza que deseja excluir esta cotação?')) return;

    if (!isOnline && !DEVELOPMENT_MODE) {
        showToast('Sistema offline. Não foi possível excluir.', 'error');
        return;
    }

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(`${API_URL}/cotacoes/${id}`, {
            method: 'DELETE',
            headers: headers,
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('cotacoesFreteSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao deletar');

        cotacoes = cotacoes.filter(c => String(c.id) !== String(id));
        lastDataHash = JSON.stringify(cotacoes.map(c => c.id));
        updateDisplay();
        showToast('Cotação excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao deletar:', error);
        showToast('Erro ao excluir cotação', 'error');
    }
}

async function toggleStatus(id) {
    const cotacao = cotacoes.find(c => String(c.id) === String(id));
    if (!cotacao) return;

    const novoStatus = !cotacao.negocioFechado;
    const old = { negocioFechado: cotacao.negocioFechado };
    cotacao.negocioFechado = novoStatus;
    updateDisplay();
    
    if (novoStatus) {
        showToast('Cotação marcada como aprovada!', 'success');
    } else {
        showToast('Cotação marcada como reprovada!', 'error');
    }

    if (isOnline || DEVELOPMENT_MODE) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            
            if (!DEVELOPMENT_MODE && sessionToken) {
                headers['X-Session-Token'] = sessionToken;
            }

            const response = await fetch(`${API_URL}/cotacoes/${id}`, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ negocioFechado: novoStatus }),
                mode: 'cors'
            });

            if (!DEVELOPMENT_MODE && response.status === 401) {
                sessionStorage.removeItem('cotacoesFreteSession');
                mostrarTelaAcessoNegado('Sua sessão expirou');
                return;
            }

            if (!response.ok) throw new Error('Erro ao atualizar');

            const data = await response.json();
            const index = cotacoes.findIndex(c => String(c.id) === String(id));
            if (index !== -1) cotacoes[index] = data;
        } catch (error) {
            cotacao.negocioFechado = old.negocioFechado;
            updateDisplay();
            showToast('Erro ao atualizar status', 'error');
        }
    }
}

function viewCotacao(id) {
    const cotacao = cotacoes.find(c => String(c.id) === String(id));
    if (!cotacao) return;
    
    currentInfoTab = 0;
    
    document.getElementById('modalDocumento').textContent = toUpperCase(cotacao.documento || 'S/N');
    
    document.getElementById('info-tab-geral').innerHTML = `
        <div class="info-section">
            <h4>Informações Gerais</h4>
            <p><strong>Responsável:</strong> ${cotacao.responsavel}</p>
            <p><strong>Documento:</strong> ${toUpperCase(cotacao.documento || '')}</p>
            ${cotacao.vendedor ? `<p><strong>Vendedor:</strong> ${cotacao.vendedor}</p>` : ''}
            <p><strong>Status:</strong> <span class="badge ${cotacao.negocioFechado ? 'aprovada' : 'reprovada'}">${cotacao.negocioFechado ? 'APROVADA' : 'REPROVADA'}</span></p>
        </div>
    `;
    
    document.getElementById('info-tab-transportadora').innerHTML = `
        <div class="info-section">
            <h4>Dados da Transportadora</h4>
            <p><strong>Transportadora:</strong> ${cotacao.transportadora}</p>
            <p><strong>Destino:</strong> ${toUpperCase(cotacao.destino || '')}</p>
            ${cotacao.numeroCotacao ? `<p><strong>Número da Cotação:</strong> ${toUpperCase(cotacao.numeroCotacao)}</p>` : ''}
            <p><strong>Valor do Frete:</strong> R$ ${parseFloat(cotacao.valorFrete || 0).toFixed(2)}</p>
            ${cotacao.previsaoEntrega ? `<p><strong>Previsão de Entrega:</strong> ${formatDate(cotacao.previsaoEntrega)}</p>` : ''}
            ${cotacao.canalComunicacao ? `<p><strong>Canal de Comunicação:</strong> ${toUpperCase(cotacao.canalComunicacao)}</p>` : ''}
            ${cotacao.codigoColeta ? `<p><strong>Código de Coleta:</strong> ${toUpperCase(cotacao.codigoColeta)}</p>` : ''}
            ${cotacao.responsavelTransportadora ? `<p><strong>Responsável:</strong> ${toUpperCase(cotacao.responsavelTransportadora)}</p>` : ''}
        </div>
    `;
    
    document.getElementById('info-tab-detalhes').innerHTML = `
        <div class="info-section">
            <h4>Detalhes Adicionais</h4>
            <p><strong>Data da Cotação:</strong> ${formatDate(cotacao.dataCotacao)}</p>
            ${cotacao.observacoes ? `<p><strong>Observações:</strong> ${toUpperCase(cotacao.observacoes)}</p>` : ''}
        </div>
    `;
    
    document.querySelectorAll('#infoModal .tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#infoModal .tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('#infoModal .tab-btn')[0].classList.add('active');
    document.getElementById('info-tab-geral').classList.add('active');
    
    document.getElementById('infoModal').classList.add('show');
    
    setTimeout(() => {
        updateInfoNavigationButtons();
    }, 100);
}

function closeInfoModal() {
    const modal = document.getElementById('infoModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function filterCotacoes() {
    updateTable();
}

function updateDisplay() {
    updateMonthDisplay();
    updateDashboard();
    updateTable();
    updateFilters();
}

function updateDashboard() {
    const monthCotacoes = getCotacoesForCurrentMonth();
    const totalAprovadas = monthCotacoes.filter(c => c.negocioFechado).length;
    const totalReprovadas = monthCotacoes.filter(c => !c.negocioFechado).length;
    
    document.getElementById('totalCotacoes').textContent = monthCotacoes.length;
    document.getElementById('totalAprovadas').textContent = totalAprovadas;
    document.getElementById('totalReprovadas').textContent = totalReprovadas;
}

function updateTable() {
    const container = document.getElementById('cotacoesContainer');
    let filteredCotacoes = getCotacoesForCurrentMonth();
    
    const search = document.getElementById('search').value.toLowerCase();
    const filterTransportadora = document.getElementById('filterTransportadora').value;
    const filterResponsavel = document.getElementById('filterResponsavel').value;
    const filterStatus = document.getElementById('filterStatus').value;
    
    if (search) {
        filteredCotacoes = filteredCotacoes.filter(c => 
            (c.documento || '').toLowerCase().includes(search) ||
            (c.transportadora || '').toLowerCase().includes(search) ||
            (c.destino || '').toLowerCase().includes(search) ||
            (c.responsavel || '').toLowerCase().includes(search)
        );
    }
    
    if (filterTransportadora) {
        filteredCotacoes = filteredCotacoes.filter(c => c.transportadora === filterTransportadora);
    }
    
    if (filterResponsavel) {
        filteredCotacoes = filteredCotacoes.filter(c => c.responsavel === filterResponsavel);
    }
    
    if (filterStatus) {
        if (filterStatus === 'reprovada') {
            filteredCotacoes = filteredCotacoes.filter(c => !c.negocioFechado);
        } else if (filterStatus === 'aprovada') {
            filteredCotacoes = filteredCotacoes.filter(c => c.negocioFechado);
        }
    }
    
    if (filteredCotacoes.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="9" style="text-align: center; padding: 2rem;">
                    Nenhuma cotação encontrada
                </td>
            </tr>
        `;
        return;
    }
    
    filteredCotacoes.sort((a, b) => new Date(b.dataCotacao) - new Date(a.dataCotacao));
    
    container.innerHTML = filteredCotacoes.map(cotacao => `
        <tr class="${cotacao.negocioFechado ? 'row-aprovada' : ''}">
            <td style="text-align: center; padding: 8px;">
                <div class="checkbox-wrapper">
                    <input 
                        type="checkbox" 
                        id="check-${cotacao.id}"
                        ${cotacao.negocioFechado ? 'checked' : ''}
                        onchange="toggleStatus('${cotacao.id}')"
                        class="styled-checkbox"
                    >
                    <label for="check-${cotacao.id}" class="checkbox-label-styled"></label>
                </div>
            </td>
            <td style="white-space: nowrap;">${formatDate(cotacao.dataCotacao)}</td>
            <td><strong>${cotacao.transportadora}</strong></td>
            <td>${toUpperCase(cotacao.destino || '')}</td>
            <td>${toUpperCase(cotacao.documento || 'N/A')}</td>
            <td><strong>R$ ${parseFloat(cotacao.valorFrete || 0).toFixed(2)}</strong></td>
            <td>${formatDate(cotacao.previsaoEntrega)}</td>
            <td>
                <span class="badge ${cotacao.negocioFechado ? 'aprovada' : 'reprovada'}">${cotacao.negocioFechado ? 'APROVADA' : 'REPROVADA'}</span>
            </td>
            <td class="actions-cell">
                <div class="actions">
                    <button onclick="viewCotacao('${cotacao.id}')" class="action-btn view" title="Ver detalhes">Ver</button>
                    <button onclick="editCotacao('${cotacao.id}')" class="action-btn edit" title="Editar">Editar</button>
                    <button onclick="deleteCotacao('${cotacao.id}')" class="action-btn delete" title="Excluir">Excluir</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateFilters() {
    const transportadoras = new Set();
    const responsaveis = new Set();
    
    cotacoes.forEach(c => {
        if (c.transportadora?.trim()) transportadoras.add(c.transportadora.trim());
        if (c.responsavel?.trim()) responsaveis.add(c.responsavel.trim());
    });

    const selectTransportadora = document.getElementById('filterTransportadora');
    if (selectTransportadora) {
        const currentValue = selectTransportadora.value;
        selectTransportadora.innerHTML = '<option value="">Transportadora</option>';
        Array.from(transportadoras).sort().forEach(t => {
            const option = document.createElement('option');
            option.value = t;
            option.textContent = t;
            selectTransportadora.appendChild(option);
        });
        selectTransportadora.value = currentValue;
    }

    const selectResponsavel = document.getElementById('filterResponsavel');
    if (selectResponsavel) {
        const currentValue = selectResponsavel.value;
        selectResponsavel.innerHTML = '<option value="">Responsável</option>';
        Array.from(responsaveis).sort().forEach(r => {
            const option = document.createElement('option');
            option.value = r;
            option.textContent = r;
            selectResponsavel.appendChild(option);
        });
        selectResponsavel.value = currentValue;
    }
}

function getCotacoesForCurrentMonth() {
    return cotacoes.filter(cotacao => {
        const cotacaoDate = new Date(cotacao.dataCotacao + 'T00:00:00');
        return cotacaoDate.getMonth() === currentMonth.getMonth() &&
               cotacaoDate.getFullYear() === currentMonth.getFullYear();
    });
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
}

function formatCurrency(value) {
    return `R$ ${parseFloat(value).toFixed(2).replace('.', ',')}`;
}

function showToast(message, type = 'success') {
    const oldMessages = document.querySelectorAll('.floating-message');
    oldMessages.forEach(msg => msg.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `floating-message ${type}`;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}
