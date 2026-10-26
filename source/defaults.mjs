// First-run baseline only. It is written when this plugin has no settings file
// yet; any existing settings file keeps its own mapping and is never replaced
// automatically. The role page offers every model the hosting DSH instance
// currently advertises, so these free-model routes are a starting point rather
// than a whitelist. A role whose model is no longer advertised stays selected
// but is reported unavailable until the user picks another model.
export const DEFAULT_ROLES=Object.freeze({
  explorer:{provider:'trae',model:'deepseek-v4.1-flash'},
  worker:{provider:'codearts',model:'GLM-5.2'},
  tester:{provider:'trae',model:'glm-5.3-flash'},
  researcher:{provider:'trae',model:'deepseek-v4.1-flash'},
  reviewer:{provider:'trae',model:'kimi-k3'},
  visioner:{provider:'trae',model:'deepseek-v4.1-flash'},
  scribe:{provider:'trae',model:'deepseek-v4.1-flash'}
});