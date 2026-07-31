// ТЕСТОВАЯ АВТОРИЗАЦИЯ (без ВК)
// В реальном проекте замените на настоящую авторизацию

const MOCK_VK_ID = 416323498; // <-- ЗАМЕНИТЕ НА СВОЙ VK ID
const MOCK_FIRST_NAME = 'Георгий';
const MOCK_LAST_NAME = 'Дмитриев';

function saveMockToken() {
  const mockToken = btoa(JSON.stringify({
    vk_id: MOCK_VK_ID,
    first_name: MOCK_FIRST_NAME,
    last_name: MOCK_LAST_NAME,
    is_admin: true // Для тестов даём админские права
  }));
  localStorage.setItem('vk_token', mockToken);
}

async function checkMockAuth() {
  if (!localStorage.getItem('vk_token')) {
    saveMockToken();
    console.log(' Создан тестовый токен для VK ID:', MOCK_VK_ID);
  }
  
  try {
    const token = localStorage.getItem('vk_token');
    const res = await fetch('/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok) {
      const user = await res.json();
      console.log('✅ Авторизован как:', user.first_name, user.last_name, '(VK ID:', user.vk_id + ')');
      return user;
    }
  } catch (e) {
    console.error('Ошибка авторизации:', e);
  }
  return null;
}

// Заменяем оригинальный checkAuth
window.checkAuth = checkMockAuth;