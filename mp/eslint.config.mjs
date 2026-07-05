import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from 'eslint-config-prettier/flat'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/unpackage/**', '**/*.d.ts']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    name: 'app/globals',
    languageOptions: {
      globals: {
        uni: 'readonly',
        wx: 'readonly',
        getApp: 'readonly',
        getCurrentPages: 'readonly',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  skipFormatting,
)
