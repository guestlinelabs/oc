// Ambient module declarations for stylesheets imported by OC components.
//
// This file must stay a *script* (no top-level import/export): wildcard
// `declare module` patterns are only legal in ambient contexts. It is
// copied verbatim to `dist/client-ambient.d.ts` by the build and pulled
// into consumers' compilations through `types/client.d.ts`.
//
// OC semantics (see `src/vite/cssModulesPlugin.ts`): every CSS import with
// bindings is treated as a CSS module, so all of these patterns expose a
// default export mapping class names to hashed names. Plain stylesheet
// patterns are also declared so side-effect/default imports type-check;
// they merge harmlessly with `vite/client`'s own declarations.

type CSSModuleClasses = { readonly [key: string]: string };

// CSS modules
declare module '*.module.css' {
  const classes: CSSModuleClasses;
  export default classes;
}
declare module '*.module.scss' {
  const classes: CSSModuleClasses;
  export default classes;
}
declare module '*.module.sass' {
  const classes: CSSModuleClasses;
  export default classes;
}
declare module '*.module.less' {
  const classes: CSSModuleClasses;
  export default classes;
}
declare module '*.module.styl' {
  const classes: CSSModuleClasses;
  export default classes;
}
declare module '*.module.stylus' {
  const classes: CSSModuleClasses;
  export default classes;
}
declare module '*.module.pcss' {
  const classes: CSSModuleClasses;
  export default classes;
}
declare module '*.module.sss' {
  const classes: CSSModuleClasses;
  export default classes;
}

// Plain stylesheets imported with bindings are rewritten to CSS modules at
// build time by the oc() plugin (upstream `oc-vite/client` parity).
declare module '*.css' {
  const classes: CSSModuleClasses;
  export default classes;
}

// Side-effect-only stylesheets.
declare module '*.scss' {}
declare module '*.sass' {}
declare module '*.less' {}
declare module '*.styl' {}
declare module '*.stylus' {}
declare module '*.pcss' {}
declare module '*.sss' {}
