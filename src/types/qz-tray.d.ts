// The qz-tray npm package ships as UMD JS with no bundled type definitions.
// A wildcard `any` module lets our thin wrapper in src/lib/print/qz.ts keep
// its own typed interface (QzModule) while still importing the actual code.
declare module 'qz-tray';
