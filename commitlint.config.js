export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['core', 'whatsapp', 'claude', 'connector', 'provider', 'config', 'deps', 'ci', 'docs'],
    ],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
};
