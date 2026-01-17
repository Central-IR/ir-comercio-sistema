require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURAÇÃO - IPS AUTORIZADOS
// ============================================================
const AUTHORIZED_IPS = process.env.AUTHORIZED_IPS 
  ? process.env.AUTHORIZED_IPS.split(',').map(ip => ip.trim())
  : ['187.36.172.217', '179.181.227.90', '187.36.170.127'];

// ============================================================
// CONFIGURAÇÃO DO SUPABASE - 2 PROJETOS DIFERENTES
// ============================================================

// PROJETO 1: PORTAL (users, sessions, login_attempts, etc)
const supabaseUrlPortal = process.env.SUPABASE_URL_PORTAL;
const supabaseKeyPortal = process.env.SUPABASE_ANON_KEY;

// PROJETO 2: APLICAÇÕES (precos, cotacoes, transportadoras, etc)
const supabaseUrlApps = process.env.SUPABASE_URL;
const supabaseKeyApps = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validar configurações
if (!supabaseUrlPortal || !supabaseKeyPortal) {
    console.error('❌ ERRO: Variáveis do Supabase PORTAL não configuradas');
    console.error('   Necessário: SUPABASE_URL_PORTAL e SUPABASE_ANON_KEY');
    process.exit(1);
}

if (!supabaseUrlApps || !supabaseKeyApps) {
    console.error('❌ ERRO: Variáveis do Supabase APPS não configuradas');
    console.error('   Necessário: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

// Cliente do Portal (para autenticação e gestão de usuários)
const supabasePortal = createClient(supabaseUrlPortal, supabaseKeyPortal);

// Cliente das Aplicações (para dados dos apps: precos, cotacoes, etc)
const supabaseApps = createClient(supabaseUrlApps, supabaseKeyApps);

console.log('✅ Supabase Portal configurado:', supabaseUrlPortal);
console.log('✅ Supabase Apps configurado:', supabaseUrlApps);

// ============================================================
// RATE LIMITING MANUAL
// ============================================================
const loginAttempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const attempt = loginAttempts.get(ip);
  
  if (!attempt) {
    loginAttempts.set(ip, { count: 1, resetTime: now + 15 * 60 * 1000 });
    return true;
  }
  
  if (now > attempt.resetTime) {
    loginAttempts.set(ip, { count: 1, resetTime: now + 15 * 60 * 1000 });
    return true;
  }
  
  if (attempt.count >= 5) {
    return false;
  }
  
  attempt.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of loginAttempts.entries()) {
    if (now > attempt.resetTime) {
      loginAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000);

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================
function getClientIP(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  const clientIP = xForwardedFor
    ? xForwardedFor.split(',')[0].trim()
    : req.socket.remoteAddress;
  
  return clientIP.replace('::ffff:', '');
}

function isIPAuthorized(ip) {
  if (AUTHORIZED_IPS.length === 0) {
    console.warn('⚠️ Nenhum IP autorizado configurado!');
    return false;
  }
  return AUTHORIZED_IPS.includes(ip);
}

function isBusinessHours() {
  const now = new Date();
  const brasiliaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dayOfWeek = brasiliaTime.getDay();
  const hour = brasiliaTime.getHours();
  
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour < 18;
}

function generateSecureToken() {
  return 'sess_' + crypto.randomBytes(32).toString('hex');
}

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/[<>]/g, '');
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9._-]{3,50}$/.test(username);
}

async function logLoginAttempt(username, success, reason, deviceToken, ip) {
  try {
    await supabasePortal.from('login_attempts').insert({
      username: sanitizeString(username),
      ip_address: ip,
      device_token: sanitizeString(deviceToken),
      success: success,
      failure_reason: reason,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erro ao registrar log:', error);
  }
}

// ============================================================
// MIDDLEWARES GLOBAIS
// ============================================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
  credentials: true
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ============================================================
// ARQUIVOS ESTÁTICOS - ANTES DO MIDDLEWARE DE AUTENTICAÇÃO
// ============================================================
// Adicionar ANTES dos outros arquivos estáticos
app.use('/app-loader.js', express.static(path.join(__dirname, 'app-loader.js')));
app.use('/portal', express.static(path.join(__dirname, 'apps', 'portal', 'public')));
app.use('/precos', express.static(path.join(__dirname, 'apps', 'precos', 'public')));
app.use('/cotacoes', express.static(path.join(__dirname, 'apps', 'cotacoes', 'public')));
app.use('/ordem-compra', express.static(path.join(__dirname, 'apps', 'ordem-compra', 'public')));

// ============================================================
// MIDDLEWARE DE AUTENTICAÇÃO PARA APPS
// ============================================================
async function verificarAutenticacao(req, res, next) {
  // Rotas públicas (INCLUINDO arquivos estáticos)
  const publicPaths = [
    '/',
    '/health',
    '/api/login',
    '/api/logout',
    '/api/verify-session',
    '/api/ip',
    '/api/check-ip-access',
    '/api/business-hours'
  ];
  
  // IMPORTANTE: Permitir todos os arquivos estáticos
  if (publicPaths.includes(req.path) || 
      req.path.startsWith('/portal/') || 
      req.path.startsWith('/precos/') ||
      req.path.startsWith('/cotacoes/') ||
      req.path.startsWith('/ordem-compra/')) {
    return next();
  }

  const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;

  if (!sessionToken) {
    return res.status(401).json({
      error: 'Não autenticado',
      redirectToLogin: true
    });
  }

  try {
    const sanitizedToken = sanitizeString(sessionToken);

    // USAR supabasePortal para validar sessão
    const { data: session, error } = await supabasePortal
      .from('active_sessions')
      .select(`
        *,
        users:user_id (
          id,
          username,
          name,
          sector,
          is_admin,
          is_active,
          apps
        )
      `)
      .eq('session_token', sanitizedToken)
      .eq('is_active', true)
      .single();

    if (error || !session) {
      return res.status(401).json({
        error: 'Sessão inválida',
        redirectToLogin: true
      });
    }

    if (!session.users.is_active) {
      return res.status(401).json({
        error: 'Usuário inativo',
        redirectToLogin: true
      });
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabasePortal
        .from('active_sessions')
        .update({ is_active: false })
        .eq('session_token', sanitizedToken);

      return res.status(401).json({
        error: 'Sessão expirada',
        redirectToLogin: true
      });
    }

    // Atualizar última atividade
    await supabasePortal
      .from('active_sessions')
      .update({ 
        last_activity: new Date().toISOString(),
        ip_address: getClientIP(req)
      })
      .eq('session_token', sanitizedToken);

    req.user = session.users;
    req.sessionToken = sanitizedToken;
    next();
  } catch (error) {
    console.error('Erro ao verificar autenticação:', error);
    return res.status(500).json({
      error: 'Erro ao verificar autenticação'
    });
  }
}

app.use(verificarAutenticacao);

// ============================================================
// ROTAS DO PORTAL
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'apps', 'portal', 'public', 'index.html'));
});

app.get('/api/ip', (req, res) => {
  const cleanIP = getClientIP(req);
  res.json({ ip: cleanIP });
});

app.get('/api/check-ip-access', (req, res) => {
  const cleanIP = getClientIP(req);
  const authorized = isIPAuthorized(cleanIP);

  res.json({ 
    authorized: authorized,
    ip: cleanIP,
    message: authorized ? 'IP autorizado' : 'IP não autorizado'
  });
});

app.get('/api/business-hours', (req, res) => {
  const now = new Date();
  const brasiliaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dayOfWeek = brasiliaTime.getDay();
  const hour = brasiliaTime.getHours();
  const inBusinessHours = isBusinessHours();

  res.json({
    isBusinessHours: inBusinessHours,
    currentTime: brasiliaTime.toLocaleString('pt-BR'),
    day: dayOfWeek,
    hour: hour
  });
});

// API - Login (USA supabasePortal)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password, deviceToken } = req.body;

    console.log('📥 Requisição de login recebida:', { username, hasPassword: !!password, hasDeviceToken: !!deviceToken });

    if (!username || !password || !deviceToken) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
    }

    const cleanIP = getClientIP(req);

    if (!checkRateLimit(cleanIP)) {
      console.log('❌ Rate limit excedido:', cleanIP);
      return res.status(429).json({ 
        error: 'Muitas tentativas de login',
        message: 'Tente novamente em 15 minutos.' 
      });
    }

    const sanitizedUsername = sanitizeString(username);
    const sanitizedDeviceToken = sanitizeString(deviceToken);

    if (!isValidUsername(sanitizedUsername)) {
      return res.status(400).json({ error: 'Formato de usuário inválido' });
    }

    if (password.length < 1 || password.length > 100) {
      return res.status(400).json({ error: 'Senha inválida' });
    }

    if (!isIPAuthorized(cleanIP)) {
      console.log('❌ IP não autorizado tentando fazer login:', cleanIP);
      await logLoginAttempt(sanitizedUsername, false, 'IP não autorizado', sanitizedDeviceToken, cleanIP);
      return res.status(403).json({ 
        error: 'Acesso negado',
        message: 'Este acesso não está autorizado fora do ambiente de trabalho.' 
      });
    }

    const usernameSearch = sanitizedUsername.toLowerCase();
    console.log('🔍 Buscando usuário:', usernameSearch);

    // USAR supabasePortal para buscar usuário
    const { data: userData, error: userError } = await supabasePortal
      .from('users')
      .select('id, username, password, name, is_admin, is_active, sector, apps')
      .ilike('username', usernameSearch)
      .single();

    if (userError || !userData) {
      console.log('❌ Usuário não encontrado:', usernameSearch);
      await logLoginAttempt(sanitizedUsername, false, 'Usuário não encontrado', sanitizedDeviceToken, cleanIP);
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    console.log('✅ Usuário encontrado:', userData.username, '| Setor:', userData.sector);

    if (userData.is_active === false) {
      console.log('❌ Usuário inativo:', sanitizedUsername);
      await logLoginAttempt(sanitizedUsername, false, 'Usuário inativo', sanitizedDeviceToken, cleanIP);
      return res.status(401).json({ error: 'Usuário inativo' });
    }

    if (!userData.is_admin && !isBusinessHours()) {
      console.log('❌ Tentativa de login fora do horário comercial:', sanitizedUsername);
      await logLoginAttempt(sanitizedUsername, false, 'Fora do horário comercial', sanitizedDeviceToken, cleanIP);
      return res.status(403).json({ 
        error: 'Fora do horário comercial',
        message: 'Este acesso é disponibilizado em conformidade com o horário comercial da empresa.' 
      });
    }

    if (password !== userData.password) {
      console.log('❌ Senha incorreta para usuário:', sanitizedUsername);
      await logLoginAttempt(sanitizedUsername, false, 'Senha incorreta', sanitizedDeviceToken, cleanIP);
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    console.log('✅ Senha correta');

    const deviceFingerprint = crypto.createHash('sha256')
      .update(sanitizedDeviceToken + cleanIP)
      .digest('hex');
    
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const truncatedUserAgent = sanitizeString(userAgent.substring(0, 95));
    const truncatedDeviceName = sanitizeString(userAgent.substring(0, 95));

    // USAR supabasePortal para registrar dispositivo
    await supabasePortal
      .from('authorized_devices')
      .upsert({
        user_id: userData.id,
        device_token: sanitizedDeviceToken,
        device_fingerprint: deviceFingerprint,
        device_name: truncatedDeviceName,
        ip_address: cleanIP,
        user_agent: truncatedUserAgent,
        is_active: true,
        last_access: new Date().toISOString()
      }, {
        onConflict: 'device_token',
        ignoreDuplicates: false
      });

    const sessionToken = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // USAR supabasePortal para gerenciar sessões
    const { data: existingSession } = await supabasePortal
      .from('active_sessions')
      .select('*')
      .eq('user_id', userData.id)
      .eq('device_token', sanitizedDeviceToken)
      .eq('is_active', true)
      .maybeSingle();

    if (existingSession) {
      await supabasePortal
        .from('active_sessions')
        .update({
          ip_address: cleanIP,
          session_token: sessionToken,
          expires_at: expiresAt.toISOString(),
          last_activity: new Date().toISOString()
        })
        .eq('id', existingSession.id);
    } else {
      await supabasePortal
        .from('active_sessions')
        .update({ is_active: false })
        .eq('user_id', userData.id)
        .eq('device_token', sanitizedDeviceToken);

      await supabasePortal
        .from('active_sessions')
        .insert({
          user_id: userData.id,
          device_token: sanitizedDeviceToken,
          ip_address: cleanIP,
          session_token: sessionToken,
          expires_at: expiresAt.toISOString(),
          is_active: true,
          last_activity: new Date().toISOString()
        });
    }

    await logLoginAttempt(sanitizedUsername, true, null, sanitizedDeviceToken, cleanIP);
    console.log('✅ Login realizado com sucesso:', sanitizedUsername, '| IP:', cleanIP);

    res.json({
      success: true,
      session: {
        userId: userData.id,
        username: userData.username,
        name: userData.name,
        sector: userData.sector,
        isAdmin: userData.is_admin,
        sessionToken: sessionToken,
        deviceToken: sanitizedDeviceToken,
        ip: cleanIP,
        expiresAt: expiresAt.toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// API - Logout (USA supabasePortal)
app.post('/api/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ error: 'Session token ausente' });
    }

    const sanitizedToken = sanitizeString(sessionToken);

    await supabasePortal
      .from('active_sessions')
      .update({ 
        is_active: false,
        logout_at: new Date().toISOString()
      })
      .eq('session_token', sanitizedToken);

    console.log('✅ Logout realizado');
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro no logout:', error);
    res.status(500).json({ error: 'Erro ao fazer logout' });
  }
});

// API - Verificar sessão (USA supabasePortal)
app.post('/api/verify-session', async (req, res) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json({ valid: false, reason: 'token_missing' });
    }

    const sanitizedToken = sanitizeString(sessionToken);

    const { data: session, error } = await supabasePortal
      .from('active_sessions')
      .select(`
        *,
        users:user_id (
          id,
          username,
          name,
          sector,
          is_admin,
          is_active,
          apps
        )
      `)
      .eq('session_token', sanitizedToken)
      .eq('is_active', true)
      .single();

    if (error || !session) {
      return res.status(401).json({ valid: false, reason: 'session_not_found' });
    }

    const currentIP = getClientIP(req);

    if (!session.users.is_active) {
      await supabasePortal
        .from('active_sessions')
        .update({ is_active: false })
        .eq('session_token', sanitizedToken);

      return res.status(401).json({ valid: false, reason: 'user_inactive' });
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabasePortal
        .from('active_sessions')
        .update({ is_active: false })
        .eq('session_token', sanitizedToken);

      return res.status(401).json({ valid: false, reason: 'session_expired' });
    }

    await supabasePortal
      .from('active_sessions')
      .update({ 
        last_activity: new Date().toISOString(),
        ip_address: currentIP
      })
      .eq('session_token', sanitizedToken);

    res.json({ 
      valid: true,
      session: {
        userId: session.users.id,
        username: session.users.username,
        name: session.users.name,
        sector: session.users.sector,
        isAdmin: session.users.is_admin
      }
    });
  } catch (error) {
    console.error('❌ Erro ao verificar sessão:', error);
    res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

// ============================================================
// ROTAS DA TABELA DE PREÇOS (USA supabaseApps)
// ============================================================

app.get('/precos/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'apps', 'precos', 'public', 'index.html'));
});

app.head('/api/precos', (req, res) => {
  res.status(200).end();
});

// Listar preços (USA supabaseApps)
app.get('/api/precos', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('precos')
      .select('*')
      .order('marca', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erro ao buscar preços:', error);
    res.status(500).json({ error: 'Erro ao buscar preços' });
  }
});

// Buscar preço específico (USA supabaseApps)
app.get('/api/precos/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('precos')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Preço não encontrado' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar preço:', error);
    res.status(500).json({ error: 'Erro ao buscar preço' });
  }
});

// Criar preço (USA supabaseApps)
app.post('/api/precos', async (req, res) => {
  try {
    const { marca, codigo, preco, descricao } = req.body;

    if (!marca || !codigo || !preco || !descricao) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    const { data, error } = await supabaseApps
      .from('precos')
      .insert([{
        marca: marca.trim(),
        codigo: codigo.trim(),
        preco: parseFloat(preco),
        descricao: descricao.trim(),
        timestamp: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Erro ao criar preço:', error);
    res.status(500).json({ error: 'Erro ao criar preço' });
  }
});

// Atualizar preço (USA supabaseApps)
app.put('/api/precos/:id', async (req, res) => {
  try {
    const { marca, codigo, preco, descricao } = req.body;

    if (!marca || !codigo || !preco || !descricao) {
      return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
    }

    const { data, error } = await supabaseApps
      .from('precos')
      .update({
        marca: marca.trim(),
        codigo: codigo.trim(),
        preco: parseFloat(preco),
        descricao: descricao.trim(),
        timestamp: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(404).json({ error: 'Preço não encontrado' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Erro ao atualizar preço:', error);
    res.status(500).json({ error: 'Erro ao atualizar preço' });
  }
});

// Deletar preço (USA supabaseApps)
app.delete('/api/precos/:id', async (req, res) => {
  try {
    const { error } = await supabaseApps
      .from('precos')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    console.error('Erro ao excluir preço:', error);
    res.status(500).json({ error: 'Erro ao excluir preço' });
  }
});

// ============================================================
// ROTAS DE COTAÇÕES DE FRETE (USA supabaseApps)
// ============================================================

app.get('/cotacoes/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'apps', 'cotacoes', 'public', 'index.html'));
});

app.head('/api/cotacoes', (req, res) => {
  res.status(200).end();
});

// Listar cotações (USA supabaseApps)
app.get('/api/cotacoes', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('cotacoes')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erro ao buscar cotações:', error);
    res.status(500).json({ error: 'Erro ao buscar cotações' });
  }
});

// Buscar cotação específica (USA supabaseApps)
app.get('/api/cotacoes/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('cotacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Cotação não encontrada' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar cotação:', error);
    res.status(500).json({ error: 'Erro ao buscar cotação' });
  }
});

// Criar cotação (USA supabaseApps)
app.post('/api/cotacoes', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('cotacoes')
      .insert([{
        ...req.body,
        timestamp: new Date().toISOString(),
        createdat: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Erro ao criar cotação:', error);
    res.status(500).json({ error: 'Erro ao criar cotação' });
  }
});

// Atualizar cotação (USA supabaseApps)
app.put('/api/cotacoes/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('cotacoes')
      .update({
        ...req.body,
        updatedat: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(404).json({ error: 'Cotação não encontrada' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Erro ao atualizar cotação:', error);
    res.status(500).json({ error: 'Erro ao atualizar cotação' });
  }
});

// Deletar cotação (USA supabaseApps)
app.delete('/api/cotacoes/:id', async (req, res) => {
  try {
    const { error } = await supabaseApps
      .from('cotacoes')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    console.error('Erro ao excluir cotação:', error);
    res.status(500).json({ error: 'Erro ao excluir cotação' });
  }
});

// ============================================================
// ROTAS DE ORDEM DE COMPRA (USA supabaseApps)
// ============================================================

app.get('/ordem-compra/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'apps', 'ordem-compra', 'public', 'index.html'));
});

app.head('/api/ordens', (req, res) => {
  res.status(200).end();
});

// Listar ordens
app.get('/api/ordens', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('ordens_compra')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('Erro ao buscar ordens:', error);
    res.status(500).json({ error: 'Erro ao buscar ordens' });
  }
});

// Buscar ordem específica
app.get('/api/ordens/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseApps
      .from('ordens_compra')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) {
      return res.status(404).json({ error: 'Ordem não encontrada' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Erro ao buscar ordem:', error);
    res.status(500).json({ error: 'Erro ao buscar ordem' });
  }
});

// Criar ordem
app.post('/api/ordens', async (req, res) => {
  try {
    const { 
      numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia, 
      cnpj, enderecoFornecedor, site, contato, telefone, email, items, 
      valorTotal, frete, localEntrega, prazoEntrega, transporte, 
      formaPagamento, prazoPagamento, dadosBancarios, status 
    } = req.body;

    const novaOrdem = {
      numero_ordem: numeroOrdem,
      responsavel,
      data_ordem: dataOrdem,
      razao_social: razaoSocial,
      nome_fantasia: nomeFantasia || null,
      cnpj,
      endereco_fornecedor: enderecoFornecedor || null,
      site: site || null,
      contato: contato || null,
      telefone: telefone || null,
      email: email || null,
      items: items || [],
      valor_total: valorTotal || 'R$ 0,00',
      frete: frete || null,
      local_entrega: localEntrega || null,
      prazo_entrega: prazoEntrega || null,
      transporte: transporte || null,
      forma_pagamento: formaPagamento,
      prazo_pagamento: prazoPagamento,
      dados_bancarios: dadosBancarios || null,
      status: status || 'aberta'
    };

    const { data, error } = await supabaseApps
      .from('ordens_compra')
      .insert([novaOrdem])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Erro ao criar ordem:', error);
    res.status(500).json({ error: 'Erro ao criar ordem' });
  }
});

// Atualizar ordem
app.put('/api/ordens/:id', async (req, res) => {
  try {
    const { 
      numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia, 
      cnpj, enderecoFornecedor, site, contato, telefone, email, items, 
      valorTotal, frete, localEntrega, prazoEntrega, transporte, 
      formaPagamento, prazoPagamento, dadosBancarios, status 
    } = req.body;

    const ordemAtualizada = {
      numero_ordem: numeroOrdem,
      responsavel,
      data_ordem: dataOrdem,
      razao_social: razaoSocial,
      nome_fantasia: nomeFantasia || null,
      cnpj,
      endereco_fornecedor: enderecoFornecedor || null,
      site: site || null,
      contato: contato || null,
      telefone: telefone || null,
      email: email || null,
      items: items || [],
      valor_total: valorTotal || 'R$ 0,00',
      frete: frete || null,
      local_entrega: localEntrega || null,
      prazo_entrega: prazoEntrega || null,
      transporte: transporte || null,
      forma_pagamento: formaPagamento,
      prazo_pagamento: prazoPagamento,
      dados_bancarios: dadosBancarios || null,
      status: status || 'aberta'
    };

    const { data, error } = await supabaseApps
      .from('ordens_compra')
      .update(ordemAtualizada)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(404).json({ error: 'Ordem não encontrada' });
    }
    
    res.json(data);
  } catch (error) {
    console.error('Erro ao atualizar ordem:', error);
    res.status(500).json({ error: 'Erro ao atualizar ordem' });
  }
});

// Deletar ordem
app.delete('/api/ordens/:id', async (req, res) => {
  try {
    const { error } = await supabaseApps
      .from('ordens_compra')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    console.error('Erro ao excluir ordem:', error);
    res.status(500).json({ error: 'Erro ao excluir ordem' });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', async (req, res) => {
  try {
    const { error } = await supabaseApps
      .from('precos')
      .select('count', { count: 'exact', head: true });
    
    res.json({
      status: error ? 'unhealthy' : 'healthy',
      database: error ? 'disconnected' : 'connected',
      timestamp: new Date().toISOString(),
      supabasePortal: supabaseUrlPortal ? 'configured' : 'not configured',
      supabaseApps: supabaseUrlApps ? 'configured' : 'not configured',
      authorizedIPs: AUTHORIZED_IPS.length > 0 ? 'configured' : 'not configured',
      apps: {
        portal: 'active',
        precos: 'active',
        cotacoes: 'active',
        'ordem-compra': 'active'
      }
    });
  } catch (error) {
    res.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================================
// ROTA 404
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error('❌ Erro não tratado:', err);
  
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Erro interno do servidor' 
    : err.message;
  
  res.status(500).json({ error: errorMessage });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 SISTEMA I.R. COMÉRCIO - MONOREPO COMPLETO');
  console.log('='.repeat(60));
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`✅ Supabase Portal: ${supabaseUrlPortal}`);
  console.log(`✅ Supabase Apps: ${supabaseUrlApps}`);
  console.log(`📍 Portal: http://localhost:${PORT}/`);
  console.log(`📍 Tabela de Preços: http://localhost:${PORT}/precos/app`);
  console.log(`📍 Cotações de Frete: http://localhost:${PORT}/cotacoes/app`);
  console.log(`📍 Ordem de Compra: http://localhost:${PORT}/ordem-compra/app`);
  console.log(`🔒 IPs autorizados: ${AUTHORIZED_IPS.join(', ')}`);
  console.log(`⏰ Horário comercial: Seg-Sex, 8h-18h (apenas LOGIN)`);
  console.log(`🛡️ Rate limiting: 5 tentativas/15min por IP`);
  console.log(`🔓 Sessão: 24 horas`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('='.repeat(60) + '\n');
});
