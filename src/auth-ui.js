(() => {
  const $ = id => document.getElementById(id);
  const setup = location.pathname === '/setup';
  let configured = false;
  if (setup) {
    $('remember-field').hidden = true;
    $('auth-title').textContent = 'Shared salon account';
    $('auth-description').textContent = 'Choose a username and a password (at least 15 characters), then share them privately with your staff. Changing the password signs out every device; the turn board stays.';
    $('password').autocomplete = 'new-password'; $('password').minLength = 15;
    $('confirm-field').hidden = false; $('confirm-password').required = true;
    $('setup-link').hidden = true; $('back-login').hidden = false;
    $('auth-submit').textContent = 'Save account';
  }
  async function load() {
    try {
      const response = await fetch('/api/auth/status',{cache:'no-store'});
      if (!response.ok) throw new Error('Could not connect. Reload the page to try again.');
      const data = await response.json(); configured = data.configured;
      if (setup) {
        $('setup-key-field').hidden = !data.keyRequired;
        $('setup-key').required = !!data.keyRequired;
        $('auth-status').textContent = configured ? 'An account already exists. Changing it will sign out every device.' : '';
        $('auth-submit').disabled = false;
      } else {
        $('auth-status').textContent = !configured ? 'The owner must set up the account before signing in.' : '';
        $('auth-submit').disabled = !configured;
      }
    } catch(error) { $('auth-status').textContent = error.message; }
  }
  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (setup && $('password').value !== $('confirm-password').value) { $('auth-status').textContent = 'The two passwords do not match.'; return; }
    if (setup && configured && !confirm('Changing the account or password will sign out every device. Continue?')) return;
    $('auth-submit').disabled = true; $('auth-status').textContent = setup ? 'Saving…' : 'Signing in…';
    try {
      const response = await fetch(setup ? '/api/auth/setup' : '/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value,password:$('password').value,remember:!setup && $('remember-login').checked,...(setup ? {setupKey:$('setup-key').value} : {})})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      $('password').value = ''; $('confirm-password').value = ''; $('setup-key').value = '';
      if (setup) { configured = true; $('auth-status').textContent = 'Saved. Tap “Back to sign in” to open the board. Staff use this same link and account.'; }
      else location.replace('/');
    } catch(error) { $('auth-status').textContent = error.message; }
    finally { $('auth-submit').disabled = false; }
  });
  load();
})();
