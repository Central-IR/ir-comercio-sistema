// CONFIGURAÇÃO
const PORTAL_URL = window.location.origin;
const API_URL = `${window.location.origin}/api`;

let precos = [];
let isOnline = false;
let marcaSelecionada = 'TODAS';
let marcasDisponiveis = new Set();
let lastDataHash = '';
let sessionToken = null;

console.log('🚀 Tabela de Preços iniciada');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('tabelaPrecosSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('tabelaPrecosSession');
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
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

async function checkServerStatus() {
    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_URL}/precos`, {
            method: 'GET',
            headers: headers,
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE');
            await loadPrecos();
        }
        
        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        console.error('❌ Erro ao verificar servidor:', error.message);
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
    loadPrecos();
    setInterval(() => {
        if (isOnline) loadPrecos();
    }, 10000);
}

async function loadPrecos() {
    if (!isOnline) return;

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_URL}/precos`, {
            method: 'GET',
            headers: headers,
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            console.error('❌ Erro ao carregar preços:', response.status);
            return;
        }

        const data = await response.json();
        precos = data.map(item => ({ ...item, descricao: item.descricao.toUpperCase() }));
        
        const newHash = JSON.stringify(precos.map(p => p.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            atualizarMarcasDisponiveis();
            renderMarcasFilter();
            filterPrecos();
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('❌ Timeout ao carregar preços');
        } else {
            console.error('❌ Erro ao carregar:', error);
        }
    }
}

function atualizarMarcasDisponiveis() {
    marcasDisponiveis.clear();
    precos.forEach(p => {
        const marca = p.marca?.trim();
        if (marca && !marcasDisponiveis.has(marca)) {
            marcasDisponiveis.add(marca);
        }
    });
    console.log(`📋 ${marcasDisponiveis.size} marcas disponíveis`);
}

function renderMarcasFilter() {
    const container = document.getElementById('marcasFilter');
    if (!container) return;

    const marcasArray = Array.from(marcasDisponiveis).sort();
    
    container.innerHTML = '';
    
    ['TODAS', ...marcasArray].forEach(marca => {
        const button = document.createElement('button');
        button.className = `brand-button ${marca === marcaSelecionada ? 'active' : ''}`;
        button.textContent = marca;
        button.onclick = () => selecionarMarca(marca);
        container.appendChild(button);
    });
}

function selecionarMarca(marca) {
    marcaSelecionada = marca;
    renderMarcasFilter();
    filterPrecos();
}

window.toggleForm = function() {
    showFormModal(null);
};

function showFormModal(editingId = null) {
    const isEditing = editingId !== null;
    const preco = isEditing ? precos.find(p => p.id === editingId) : null;

    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content large">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Preço' : 'Novo Preço'}</h3>
                </div>
                <form id="modalPrecoForm" onsubmit="handleSubmit(event)">
                    <input type="hidden" id="modalEditId" value="${editingId || ''}">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="modalMarca">Marca *</label>
                            <input type="text" id="modalMarca" value="${preco?.marca || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="modalCodigo">Código *</label>
                            <input type="text" id="modalCodigo" value="${preco?.codigo || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="modalPreco">Preço (R$) *</label>
                            <input type="number" id="modalPreco" step="0.01" min="0" value="${preco?.preco || ''}" required>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="modalDescricao">Descrição *</label>
                            <textarea id="modalDescricao" rows="3" required>${preco?.descricao || ''}</textarea>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="button" onclick="closeFormModal(true)" class="secondary">Cancelar</button>
                        <button type="submit" class="save">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    setTimeout(() => {
        const descricaoField = document.getElementById('modalDescricao');
        descricaoField.addEventListener('input', (e) => {
            const start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
        });
        
        document.getElementById('modalMarca')?.focus();
    }, 100);
}

function closeFormModal(showCancelMessage = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        const editId = document.getElementById('modalEditId')?.value;
        const isEditing = editId && editId !== '';
        
        if (showCancelMessage) {
            showToast(isEditing ? 'Atualização cancelada' : 'Registro cancelado', 'error');
        }
        
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

async function handleSubmit(event) {
    event.preventDefault();

    const formData = {
        marca: document.getElementById('modalMarca').value.trim(),
        codigo: document.getElementById('modalCodigo').value.trim(),
        preco: parseFloat(document.getElementById('modalPreco').value),
        descricao: document.getElementById('modalDescricao').value.trim().toUpperCase()
    };

    const editId = document.getElementById('modalEditId').value;
    
    // Verificar código duplicado
    const codigoDuplicado = precos.find(p => 
        p.codigo.toLowerCase() === formData.codigo.toLowerCase() && p.id !== editId
    );

    if (codigoDuplicado) {
        showToast(`Código "${formData.codigo}" já existe`, 'error');
        return;
    }

    if (!isOnline) {
        showToast('Sistema offline. Dados não foram salvos.', 'error');
        closeFormModal();
        return;
    }

    try {
        const url = editId ? `${API_URL}/precos/${editId}` : `${API_URL}/precos`;
        const method = editId ? 'PUT' : 'POST';

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(url, {
            method,
            headers: headers,
            body: JSON.stringify(formData),
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
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
        savedData.descricao = savedData.descricao.toUpperCase();

        if (editId) {
            const index = precos.findIndex(p => p.id === editId);
            if (index !== -1) precos[index] = savedData;
            showToast('Preço atualizado com sucesso!', 'success');
        } else {
            precos.push(savedData);
            showToast('Preço criado com sucesso!', 'success');
        }

        filterPrecos();
        closeFormModal();
    } catch (error) {
        console.error('Erro completo:', error);
        if (error.name === 'AbortError') {
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            showToast(`Erro: ${error.message}`, 'error');
        }
    }
}

window.editPreco = function(id) {
    showFormModal(id);
};

window.deletePreco = async function(id) {
    if (!confirm('Tem certeza que deseja excluir este preço?')) return;

    if (!isOnline) {
        showToast('Sistema offline. Não foi possível excluir.', 'error');
        return;
    }

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_URL}/precos/${id}`, {
            method: 'DELETE',
            headers: headers,
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('tabelaPrecosSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao deletar');

        precos = precos.filter(p => p.id !== id);
        lastDataHash = JSON.stringify(precos.map(p => p.id));
        atualizarMarcasDisponiveis();
        renderMarcasFilter();
        filterPrecos();
        showToast('Preço excluído com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao deletar:', error);
        if (error.name === 'AbortError') {
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            showToast('Erro ao excluir preço', 'error');
        }
    }
};

function filterPrecos() {
    const searchTerm = document.getElementById('search').value.toLowerCase();
    let filtered = precos;

    if (marcaSelecionada !== 'TODAS') {
        filtered = filtered.filter(p => p.marca === marcaSelecionada);
    }

    if (searchTerm) {
        filtered = filtered.filter(p => 
            p.codigo.toLowerCase().includes(searchTerm) ||
            p.marca.toLowerCase().includes(searchTerm) ||
            p.descricao.toLowerCase().includes(searchTerm)
        );
    }

    filtered.sort((a, b) => {
        const marcaCompare = a.marca.localeCompare(b.marca);
        if (marcaCompare !== 0) return marcaCompare;
        return a.codigo.localeCompare(b.codigo, undefined, { numeric: true });
    });

    renderPrecos(filtered);
}

function getTimeAgo(timestamp) {
    if (!timestamp) return 'Sem data';
    const now = new Date();
    const past = new Date(timestamp);
    const diffInSeconds = Math.floor((now - past) / 1000);
    if (diffInSeconds < 60) return `${diffInSeconds}s`;
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}min`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d`;
    return past.toLocaleDateString('pt-BR');
}

function renderPrecos(precosToRender) {
    const container = document.getElementById('precosTableBody');
    
    if (!precosToRender || precosToRender.length === 0) {
        container.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem;">
                    Nenhum preço encontrado
                </td>
            </tr>
        `;
        return;
    }

    container.innerHTML = precosToRender.map(p => `
        <tr>
            <td><strong>${p.marca}</strong></td>
            <td>${p.codigo}</td>
            <td>R$ ${parseFloat(p.preco).toFixed(2)}</td>
            <td>${p.descricao}</td>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">${getTimeAgo(p.timestamp)}</td>
            <td class="actions-cell" style="text-align: center;">
                <button onclick="window.editPreco('${p.id}')" class="action-btn edit">Editar</button>
                <button onclick="window.deletePreco('${p.id}')" class="action-btn delete">Excluir</button>
            </td>
        </tr>
    `).join('');
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
