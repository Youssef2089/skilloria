// scripts/_alias-register.mjs — branche le résolveur d'alias (cf. _alias-hooks.mjs).
//   node --import ./scripts/_alias-register.mjs scripts/<diagnostic>.mjs
import { register } from 'node:module'
register('./_alias-hooks.mjs', import.meta.url)
