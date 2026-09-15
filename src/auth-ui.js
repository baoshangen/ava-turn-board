(() => {
  const $ = id => document.getElementById(id);
  const setup = location.pathname === '/setup';
  let configured = false;
  if (setup) {
    $('remember-field').hidden = true;
    $('auth-title').textContent = 'Tài khoản chung của tiệm';
    $('auth-description').textContent = 'Tự đặt tên đăng nhập và mật khẩu (ít nhất 15 ký tự) rồi chia sẻ riêng cho người trong tiệm. Đổi mật khẩu sẽ đăng xuất tất cả thiết bị; bảng turn vẫn giữ nguyên.';
    $('password').autocomplete = 'new-password'; $('password').minLength = 15;
    $('confirm-field').hidden = false; $('confirm-password').required = true;
    $('setup-link').hidden = true; $('back-login').hidden = false;
    $('auth-submit').textContent = 'Lưu tài khoản';
  }
  async function load() {
    try {
      const response = await fetch('/api/auth/status',{cache:'no-store'});
      if (!response.ok) throw new Error('Chưa kết nối được. Tải lại trang để thử lại.');
      const data = await response.json(); configured = data.configured;
      if (setup) {
        $('setup-key-field').hidden = !data.keyRequired;
        $('setup-key').required = !!data.keyRequired;
        $('auth-status').textContent = configured ? 'Đã có tài khoản chung. Đổi tài khoản/mật khẩu sẽ đăng xuất mọi thiết bị.' : '';
        $('auth-submit').disabled = false;
      } else {
        $('auth-status').textContent = !configured ? 'Chủ tiệm cần thiết lập tài khoản trước khi đăng nhập.' : '';
        $('auth-submit').disabled = !configured;
      }
    } catch(error) { $('auth-status').textContent = error.message; }
  }
  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (setup && $('password').value !== $('confirm-password').value) { $('auth-status').textContent = 'Hai mật khẩu chưa giống nhau.'; return; }
    if (setup && configured && !confirm('Đổi tài khoản hoặc mật khẩu sẽ đăng xuất tất cả thiết bị. Tiếp tục?')) return;
    $('auth-submit').disabled = true; $('auth-status').textContent = setup ? 'Đang lưu…' : 'Đang đăng nhập…';
    try {
      const response = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value,password:$('password').value,remember:!setup && $('remember-login').checked,...(setup ? {setupKey:$('setup-key').value} : {})})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thực hiện được. Vui lòng thử lại.');
      $('password').value = ''; $('confirm-password').value = ''; $('setup-key').value = '';
      if (setup) { configured = true; $('auth-status').textContent = 'Đã lưu. Bấm “Trở về đăng nhập” để mở bảng. Người trong tiệm dùng cùng link và tài khoản này.'; }
      else location.replace('/');
    } catch(error) { $('auth-status').textContent = error.message; }
    finally { $('auth-submit').disabled = false; }
  });
  load();
})();
