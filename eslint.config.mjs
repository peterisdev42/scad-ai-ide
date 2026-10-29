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
    {
        files: ['src/features/**/*.ts', 'src/extension.ts'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name=/^show(Error|Warning|Information)Message$/]',
                    message: 'Report notifications through platform/notifications so identity, wording and aggregation stay centralized.',
                },
            ],
        },
    },
    prettier,
]
