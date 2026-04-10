import js from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import reactRefreshPlugin from 'eslint-plugin-react-refresh'
import globals from 'globals'

const noEmDash = {
  meta: { type: 'suggestion', messages: { found: 'Em dash or en dash found; rewrite as a separate sentence or use a colon.' } },
  create(context) {
    const src = context.sourceCode
    return {
      Program() {
        const text = src.getText()
        const re = /[—–]/g
        let m
        while ((m = re.exec(text)) !== null) {
          const loc = src.getLocFromIndex(m.index)
          context.report({ loc, messageId: 'found' })
        }
      },
    }
  },
}

export default [
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    plugins: {
      '@eslint-react': eslintReact,
      'react-refresh': reactRefreshPlugin,
      'local': { rules: { 'no-em-dash': noEmDash } },
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'local/no-em-dash': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'electron/**'],
  },
]
