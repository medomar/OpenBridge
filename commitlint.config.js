export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'core',
        'whatsapp',
        'claude',
        'connector',
        'provider',
        'config',
        'discovery',
        'master',
        'deps',
        'ci',
        'docs',
        'scripts',
      ],
    ],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
  },
};
