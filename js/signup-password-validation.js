/**
 * Password strength checklist + confirm match + submit enablement for signup forms.
 */
(function (global) {
  'use strict';

  var RULES = [
    { key: 'length', label: 'At least 8 characters', test: function (p) { return p.length >= 8; } },
    { key: 'number', label: 'At least one number (0-9)', test: function (p) { return /\d/.test(p); } },
    { key: 'upper', label: 'At least one uppercase letter (A-Z)', test: function (p) { return /[A-Z]/.test(p); } },
    { key: 'lower', label: 'At least one lowercase letter (a-z)', test: function (p) { return /[a-z]/.test(p); } },
    {
      key: 'special',
      label: 'At least one special character (!@#$%^&*.)',
      test: function (p) { return /[!@#$%^&*.]/.test(p); }
    }
  ];

  function isPasswordStrong(password) {
    return RULES.every(function (rule) { return rule.test(password); });
  }

  function init(options) {
    var passwordInput = options.passwordInput;
    var confirmInput = options.confirmInput;
    var strengthPanel = options.strengthPanel;
    var submitBtn = options.submitBtn;
    var matchErrorEl = options.matchErrorEl || null;
    var matchOkEl = options.matchOkEl || null;
    var useTailwind = !!options.useTailwind;
    var strengthStarted = false;

    function passwordsMatch() {
      return passwordInput.value === confirmInput.value;
    }

    function setSubmitDisabled(disabled) {
      submitBtn.disabled = disabled;
      if (useTailwind) {
        submitBtn.classList.toggle('opacity-50', disabled);
        submitBtn.classList.toggle('cursor-not-allowed', disabled);
      } else {
        submitBtn.style.opacity = disabled ? '0.5' : '';
        submitBtn.style.cursor = disabled ? 'not-allowed' : '';
      }
    }

    function updateMatchMessages() {
      if (!matchErrorEl || !matchOkEl) return;
      var confirmVal = confirmInput.value;
      if (!confirmVal) {
        if (useTailwind) {
          matchErrorEl.classList.add('hidden');
          matchOkEl.classList.add('hidden');
        } else {
          matchErrorEl.style.display = 'none';
          matchOkEl.style.display = 'none';
        }
        return;
      }
      if (passwordsMatch()) {
        if (useTailwind) {
          matchErrorEl.classList.add('hidden');
          matchOkEl.classList.remove('hidden');
        } else {
          matchErrorEl.style.display = 'none';
          matchOkEl.style.display = 'block';
        }
      } else {
        if (useTailwind) {
          matchErrorEl.classList.remove('hidden');
          matchOkEl.classList.add('hidden');
        } else {
          matchErrorEl.style.display = 'block';
          matchOkEl.style.display = 'none';
        }
      }
    }

    function updateSubmitState() {
      var strong = isPasswordStrong(passwordInput.value);
      var confirmVal = confirmInput.value;
      var matchOk = !confirmVal || passwordsMatch();
      setSubmitDisabled(!(strong && matchOk));
      updateMatchMessages();
    }

    function updateStrengthUI() {
      var password = passwordInput.value;

      if (!strengthStarted) {
        if (password.length === 0) {
          if (useTailwind) {
            strengthPanel.classList.add('hidden');
          } else {
            strengthPanel.style.display = 'none';
          }
          updateSubmitState();
          return;
        }
        strengthStarted = true;
      }

      if (useTailwind) {
        strengthPanel.classList.remove('hidden');
      } else {
        strengthPanel.style.display = 'block';
      }

      RULES.forEach(function (rule) {
        var row = strengthPanel.querySelector('[data-pw-rule="' + rule.key + '"]');
        if (!row) return;
        var ok = rule.test(password);
        var icon = row.querySelector('.pw-rule-icon');
        var text = row.querySelector('.pw-rule-text');
        icon.textContent = ok ? '✓' : '✗';
        if (useTailwind) {
          icon.className = 'pw-rule-icon ' + (ok ? 'text-green-600' : 'text-red-500');
          text.className = 'pw-rule-text text-xs ' + (ok ? 'text-green-600' : 'text-red-500');
        } else {
          icon.style.color = ok ? '#16a34a' : '#ef4444';
          text.style.color = ok ? '#16a34a' : '#ef4444';
        }
      });

      updateSubmitState();
    }

    passwordInput.addEventListener('input', updateStrengthUI);
    passwordInput.addEventListener('change', updateStrengthUI);
    confirmInput.addEventListener('input', updateSubmitState);
    confirmInput.addEventListener('change', updateSubmitState);

    updateSubmitState();

    return {
      isPasswordStrong: function () { return isPasswordStrong(passwordInput.value); },
      passwordsMatch: passwordsMatch,
      updateSubmitState: updateSubmitState
    };
  }

  global.CarfoxSignupPassword = {
    init: init,
    isPasswordStrong: isPasswordStrong,
    RULES: RULES
  };
})(typeof window !== 'undefined' ? window : this);
