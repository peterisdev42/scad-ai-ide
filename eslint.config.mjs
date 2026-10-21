import typescriptEslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default [
    {
        files: ['**/*.ts'],
        plugins: { '@typescript-eslint': typescriptEslint.plugin },
        languageOptions: {
            parser: typescriptEslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            curly: 'error',
            eqeqeq: 'error',
            'no-throw-literal': 'error',
            'max-len': 'off',
        },
    },
    prettier,
]
