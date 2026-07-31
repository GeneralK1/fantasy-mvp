// Получение токена из URL
function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('token');
}

// Сохранение токена
function saveToken(token) {
  localStorage.setItem('vk_token', token);
}

// Получение токена
function getToken() {
  return localStorage.getItem('vk_token');
}

// Проверка авторизации
async function checkAuth() {
  const token = getTokenFromUrl();
  if (token) {
    saveToken(token);
    window.history.replaceState({}, '', '/');
  }
  
  const savedToken = getToken();
  if (!savedToken) {
    window.location.href = '/auth/vk';
    return null;
  }
  
  try {
    const res = await fetch('/auth/me', {
      headers: { 'Authorization': `Bearer ${savedToken}` }
    });
    
    if (res.ok) {
      return await res.json();
    } else {
      localStorage.removeItem('vk_token');
      window.location.href = '/auth/vk';
      return null;
    }
  } catch (error) {
    console.error('Ошибка проверки авторизации:', error);
    return null;
  }
}

// Добавление токена ко всем запросам
async function apiRequest(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const res = await fetch(url, { ...options, headers });
  return res;
}